import React, { useState } from "react";

const DEFAULT_TICKERS = ["AAPL", "MSFT", "SPY", "NVDA", "TSM", "JNJ"];
const MODEL_OPTIONS = [
  { key: "lstm", label: "LSTM" },
  { key: "gbm", label: "GBM (Geometric Brownian Motion)" },
  { key: "decision_tree", label: "Decision Tree" },
];

function fiveYearsAgo() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 5);
  return d.toISOString().split("T")[0];
}
function today() {
  return new Date().toISOString().split("T")[0];
}

export default function InputPanel({ onRun, loading, progress }) {
  const [ticker, setTicker] = useState("AAPL");
  const [customTicker, setCustomTicker] = useState("");
  const [startDate, setStartDate] = useState(fiveYearsAgo());
  const [endDate, setEndDate] = useState(today());
  const [lookback, setLookback] = useState(60);
  const [models, setModels] = useState(["lstm", "gbm", "decision_tree"]);
  const [ensemble, setEnsemble] = useState(true);
  const [gbmPaths, setGbmPaths] = useState(5000);

  const toggleModel = (key) =>
    setModels((prev) =>
      prev.includes(key) ? prev.filter((m) => m !== key) : [...prev, key]
    );

  const activeTicker = customTicker.trim().toUpperCase() || ticker;

  const handleRun = () => {
    onRun({
      ticker: activeTicker,
      startDate,
      endDate,
      lookback,
      models,
      ensemble,
      gbmPaths,
    });
  };

  return (
    <div className="card">
      <h3>Configuration</h3>

      <label>Ticker (preset)</label>
      <select value={ticker} onChange={(e) => { setTicker(e.target.value); setCustomTicker(""); }}>
        {DEFAULT_TICKERS.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>

      <label>Or enter custom ticker</label>
      <input
        type="text"
        placeholder="e.g. GOOGL"
        value={customTicker}
        onChange={(e) => setCustomTicker(e.target.value)}
      />

      <label>Start Date</label>
      <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />

      <label>End Date</label>
      <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />

      <label>Lookback Window (trading days)</label>
      <input
        type="number" min={10} max={252}
        value={lookback}
        onChange={(e) => setLookback(Number(e.target.value))}
      />

      <label>Forecast Horizon</label>
      <input type="text" value="30 trading days" disabled />

      <label>Models</label>
      <div className="checkbox-group">
        {MODEL_OPTIONS.map((m) => (
          <label key={m.key} className="checkbox-label">
            <input
              type="checkbox"
              checked={models.includes(m.key)}
              onChange={() => toggleModel(m.key)}
            />
            {m.label}
          </label>
        ))}
      </div>

      <label className="checkbox-label" style={{ marginTop: 12 }}>
        <input type="checkbox" checked={ensemble} onChange={() => setEnsemble(!ensemble)} />
        Enable Ensemble (blends selected models)
      </label>

      {models.includes("gbm") && (
        <>
          <label>GBM Monte Carlo Paths</label>
          <input
            type="number" min={100} max={50000} step={500}
            value={gbmPaths}
            onChange={(e) => setGbmPaths(Number(e.target.value))}
          />
        </>
      )}

      <button
        className="btn btn-primary"
        onClick={handleRun}
        disabled={loading || models.length === 0}
      >
        {loading ? (
          <><span className="spinner" /> Running...</>
        ) : (
          "Train & Forecast"
        )}
      </button>

      {loading && (
        <div className="progress-bar-outer">
          <div className="progress-bar-inner" style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
}
