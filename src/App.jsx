import React, { useState, useCallback, useRef } from "react";
import InputPanel from "./components/InputPanel.jsx";
import OutputPanel from "./components/OutputPanel.jsx";
import LogPanel from "./components/LogPanel.jsx";

import { fetchStockData } from "./data/fetchStock";
import { timeSplit } from "./data/preprocessing";
import { trainLSTM, forecastLSTM } from "./models/lstmModel";
import { fitGBM, forecastGBM, gbmMedianPaths } from "./models/gbmModel";
import { trainDecisionTree, forecastDecisionTree } from "./models/decisionTree";
import { ensembleForecasts, averagePaths } from "./models/ensemble";
import { walkForwardOrigins, scorePaths, naivePaths } from "./models/evaluation";

const FORECAST_HORIZON = 30;

function tradingDatesAhead(lastDateStr, n) {
  const dates = [];
  // Date-only strings parse as UTC midnight, so read the weekday in UTC too
  let d = new Date(lastDateStr);
  while (dates.length < n) {
    d = new Date(d.getTime() + 86400000);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      dates.push(d.toISOString().split("T")[0]);
    }
  }
  return dates;
}

export default function App() {
  const [logs, setLogs] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [forecastResult, setForecastResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);

  // Store trained artifacts so forecast doesn't retrain
  const artifactsRef = useRef(null);

  const log = useCallback((msg, level = "info") => {
    setLogs((prev) => [...prev, { ts: new Date().toLocaleTimeString(), msg, level }]);
  }, []);

  // ────────── TRAIN + FORECAST in one flow ──────────
  const handleRun = useCallback(
    async (params) => {
      setLoading(true);
      setProgress(0);
      setMetrics(null);
      setForecastResult(null);
      artifactsRef.current = null;

      try {
        // 1) Fetch data
        log(`Fetching data for ${params.ticker}...`);
        if (params.apiKey) {
          log("Using Alpha Vantage (CORS-enabled).");
        } else {
          log("No API key — loading through the price proxy...", "info");
        }
        const stock = await fetchStockData(params.ticker, params.startDate, params.endDate, params.apiKey);
        log(`Got ${stock.prices.length} trading days${stock.source ? ` (source: ${stock.source})` : ""}.`, "success");

        if (stock.prices.length < params.lookback + FORECAST_HORIZON + 50) {
          throw new Error(
            `Not enough data: ${stock.prices.length} days. Need ≥${params.lookback + FORECAST_HORIZON + 50}.`
          );
        }

        // 2) Split
        const split = timeSplit(stock.prices);
        log(`Split — train: ${split.train.length}, val: ${split.val.length}, test: ${split.test.length}`);

        const metricsResult = {};
        const forecasts = {};
        const bands = {};
        const allPrices = stock.prices;
        const allVolumes = stock.volumes;

        // Walk-forward test: every model forecasts from the same origins, and
        // each test day is scored from 1 and from 30 trading days earlier.
        const trainEnd = split.train.length;
        const testStart = trainEnd + split.val.length;
        const lastBar = allPrices.length - 1;
        const origins = walkForwardOrigins(
          allPrices.length, testStart, FORECAST_HORIZON,
          Math.max(trainEnd - 1, params.lookback)
        );
        const testPaths = {};
        const score = (name, label, paths) => {
          const m = scorePaths(paths, origins, allPrices, testStart, FORECAST_HORIZON);
          metricsResult[name] = m;
          log(
            `${label} test — 1-day MAPE: ${m.day1.MAPE}%` +
            (m.dayH ? `, ${FORECAST_HORIZON}-day MAPE: ${m.dayH.MAPE}%` : "")
          );
        };

        // 3) LSTM
        if (params.models.includes("lstm")) {
          log("Training LSTM (TensorFlow.js, in-browser)...");
          const { model, scaler, history } = await trainLSTM(
            split.train,
            split.val,
            params.lookback,
            (epoch, l) => {
              setProgress((epoch / 50) * 30); // 0-30% for LSTM
              if (epoch % 5 === 0) log(`  LSTM epoch ${epoch}: loss=${l.loss.toFixed(6)}, val=${l.val_loss.toFixed(6)}`);
            }
          );
          log(`LSTM trained — ${history.loss.length} epochs.`, "success");

          testPaths.lstm = await forecastLSTM(model, scaler, allPrices, origins, params.lookback, FORECAST_HORIZON);
          score("lstm", "LSTM", testPaths.lstm);

          [forecasts.lstm] = await forecastLSTM(model, scaler, allPrices, [lastBar], params.lookback, FORECAST_HORIZON);
        }
        setProgress(35);

        // 4) GBM
        if (params.models.includes("gbm")) {
          log("Fitting GBM parameters (drift & volatility)...");
          const gbmParams = fitGBM(split.train);
          log(`GBM (train split) — mu=${gbmParams.mu.toFixed(4)}, sigma=${gbmParams.sigma.toFixed(4)}`);

          testPaths.gbm = gbmMedianPaths(gbmParams, allPrices, origins, FORECAST_HORIZON);
          score("gbm", "GBM", testPaths.gbm);

          // The test above uses train-only parameters; the forecast itself
          // refits on everything up to the last bar.
          const gbmLive = fitGBM(allPrices);
          log(`GBM (refit on full history) — mu=${gbmLive.mu.toFixed(4)}, sigma=${gbmLive.sigma.toFixed(4)}`);

          log(`Simulating ${params.gbmPaths.toLocaleString()} Monte Carlo paths...`);
          const gbmFc = forecastGBM(
            gbmLive,
            FORECAST_HORIZON,
            params.gbmPaths
          );
          forecasts.gbm = gbmFc.median;
          bands.gbm = { lower5: gbmFc.lower5, upper95: gbmFc.upper95 };
          log(`GBM forecast generated with 5–95% confidence bands.`, "success");
        }
        setProgress(55);

        // 5) Decision Tree
        if (params.models.includes("decision_tree")) {
          log("Training Decision Tree (grid search)...");
          const { tree, bestParams } = trainDecisionTree(
            allPrices, allVolumes, trainEnd, testStart,
            (done, total) => {
              setProgress(55 + (done / total) * 25);
              if (done % 10 === 0) log(`  DT grid search: ${done}/${total}`);
            }
          );
          log(`DT best params: depth=${bestParams.maxDepth}, split=${bestParams.minSamplesSplit}, leaf=${bestParams.minSamplesLeaf}`, "success");

          testPaths.decision_tree = forecastDecisionTree(tree, allPrices, allVolumes, origins, FORECAST_HORIZON);
          score("decision_tree", "DT", testPaths.decision_tree);

          [forecasts.decision_tree] = forecastDecisionTree(tree, allPrices, allVolumes, [lastBar], FORECAST_HORIZON);
        }
        setProgress(85);

        // 6) Ensemble
        if (params.ensemble && Object.keys(forecasts).length >= 2) {
          log("Blending ensemble...");
          const ens = ensembleForecasts(forecasts, Object.keys(bands).length > 0 ? bands : null);
          forecasts.ensemble = ens.point;
          bands.ensemble = { lower5: ens.lower5, upper95: ens.upper95 };

          score("ensemble", "Ensemble", averagePaths(Object.values(testPaths)));
          log("Ensemble forecast generated.", "success");
        }

        // Baseline every model has to beat: the last known price, unchanged
        score("naive", "Naive", naivePaths(allPrices, origins, FORECAST_HORIZON));

        // 7) Build output
        const lastDate = stock.dates[stock.dates.length - 1];
        const fDates = tradingDatesAhead(lastDate, FORECAST_HORIZON);
        const calendarSpan = `${fDates[0]} to ${fDates[fDates.length - 1]}`;

        const histTail = 120;
        const histDates = stock.dates.slice(-histTail);
        const histPrices = stock.prices.slice(-histTail);

        setMetrics({ ticker: params.ticker, horizon: FORECAST_HORIZON, metrics: metricsResult });
        setForecastResult({
          ticker: params.ticker,
          horizon: FORECAST_HORIZON,
          dates: fDates,
          calendarSpan,
          forecasts,
          bands,
          historicalDates: histDates,
          historicalPrices: histPrices,
        });

        setProgress(100);
        log(`Done! 30-day forecast for ${params.ticker}: ${calendarSpan}`, "success");
      } catch (err) {
        log(`Error: ${err.message}`, "error");
        console.error(err);
      } finally {
        setLoading(false);
      }
    },
    [log]
  );

  return (
    <div className="app-container">
      <header className="header">
        <h1>Stock Price Forecast</h1>
        <p>
          LSTM + Geometric Brownian Motion + Decision Tree — 30 Trading Days
          Ahead
        </p>
        <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: 4 }}>
          All models train and run in your browser. The server only relays price history.
        </p>
      </header>

      <div className="main-grid">
        <div>
          <InputPanel onRun={handleRun} loading={loading} progress={progress} />
          <LogPanel logs={logs} />
        </div>
        <div>
          <OutputPanel metrics={metrics} forecastResult={forecastResult} />
        </div>
      </div>
    </div>
  );
}
