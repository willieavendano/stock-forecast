/**
 * LSTM forecasting model — TensorFlow.js (runs 100% in the browser).
 *
 * Architecture (from 034adarsh/Stock-Price-Prediction-Using-LSTM):
 *   Input(lookback,1) → LSTM(64) → Dropout(0.2) →
 *   LSTM(64) → Dropout(0.2) → Dense(32,relu) → Dense(1)
 *
 * Walk-forward iterative 30-trading-day forecast.
 */
import * as tf from "@tensorflow/tfjs";
import {
  fitMinMaxScaler,
  buildSequences,
} from "../data/preprocessing";

/**
 * Train the LSTM.
 * @param {number[]} trainPrices  raw prices (train split)
 * @param {number[]} valPrices    raw prices (val split)
 * @param {number}   lookback     window length (default 60)
 * @param {Function} onEpoch      callback(epoch, logs) for progress
 * @returns {{ model, scaler, history }}
 */
export async function trainLSTM(trainPrices, valPrices, lookback = 60, onEpoch) {
  // Fit scaler on train only
  const scaler = fitMinMaxScaler(trainPrices);
  const trainScaled = scaler.transform(trainPrices);

  // For val sequences we need the tail of train as context
  const combined = [...trainPrices.slice(-lookback), ...valPrices];
  const combinedScaled = scaler.transform(combined);

  const trainSeq = buildSequences(trainScaled, lookback);
  const valSeq = buildSequences(combinedScaled, lookback);

  const xTrain = tf.tensor3d(trainSeq.X);
  const yTrain = tf.tensor1d(trainSeq.y);
  const xVal = tf.tensor3d(valSeq.X);
  const yVal = tf.tensor1d(valSeq.y);

  // Build model
  const model = tf.sequential();
  model.add(
    tf.layers.lstm({
      units: 64,
      returnSequences: true,
      inputShape: [lookback, 1],
    })
  );
  model.add(tf.layers.dropout({ rate: 0.2 }));
  model.add(tf.layers.lstm({ units: 64, returnSequences: false }));
  model.add(tf.layers.dropout({ rate: 0.2 }));
  model.add(tf.layers.dense({ units: 32, activation: "relu" }));
  model.add(tf.layers.dense({ units: 1 }));

  model.compile({ optimizer: "adam", loss: "meanSquaredError" });

  // Early stopping logic (manual — tfjs doesn't have keras callbacks)
  let bestValLoss = Infinity;
  let patience = 5;
  let wait = 0;
  let bestWeights = null;
  const epochs = 50;
  const history = { loss: [], val_loss: [] };

  for (let epoch = 0; epoch < epochs; epoch++) {
    const h = await model.fit(xTrain, yTrain, {
      epochs: 1,
      batchSize: 32,
      validationData: [xVal, yVal],
      verbose: 0,
    });

    const loss = h.history.loss[0];
    const valLoss = h.history.val_loss[0];
    history.loss.push(loss);
    history.val_loss.push(valLoss);

    if (onEpoch) onEpoch(epoch + 1, { loss, val_loss: valLoss });

    if (valLoss < bestValLoss) {
      bestValLoss = valLoss;
      wait = 0;
      bestWeights = model.getWeights().map((w) => w.clone());
    } else {
      wait++;
      if (wait >= patience) {
        if (bestWeights) model.setWeights(bestWeights);
        break;
      }
    }
  }

  // Cleanup tensors
  xTrain.dispose();
  yTrain.dispose();
  xVal.dispose();
  yVal.dispose();
  if (bestWeights) bestWeights.forEach((w) => w.dispose());

  return { model, scaler, history };
}

/**
 * Iterative walk-forward 30-day forecast.
 * @returns {number[]} array of predicted prices (length = horizon)
 */
export async function forecastLSTM(model, scaler, recentPrices, lookback = 60, horizon = 30) {
  const scaled = scaler.transform(recentPrices.slice(-lookback));
  const window = [...scaled];
  const predsScaled = [];

  for (let step = 0; step < horizon; step++) {
    const input = tf.tensor3d(
      [window.slice(-lookback).map((v) => [v])],
      [1, lookback, 1]
    );
    const pred = model.predict(input);
    const val = (await pred.data())[0];
    predsScaled.push(val);
    window.push(val);
    input.dispose();
    pred.dispose();
  }

  return scaler.inverse(predsScaled);
}

/**
 * Evaluate on test set — returns { MAE, RMSE, MAPE }.
 */
export async function evaluateLSTM(model, scaler, testPrices, contextPrices, lookback = 60) {
  const full = [...contextPrices.slice(-lookback), ...testPrices];
  const fullScaled = scaler.transform(full);
  const seq = buildSequences(fullScaled, lookback);

  const xTest = tf.tensor3d(seq.X);
  const predsTensor = model.predict(xTest);
  const predsScaled = await predsTensor.data();
  xTest.dispose();
  predsTensor.dispose();

  const preds = scaler.inverse(Array.from(predsScaled));
  const actuals = scaler.inverse(seq.y);

  let maeSum = 0, mseSum = 0, mapeSum = 0;
  const n = preds.length;
  for (let i = 0; i < n; i++) {
    const err = Math.abs(preds[i] - actuals[i]);
    maeSum += err;
    mseSum += err * err;
    mapeSum += err / (Math.abs(actuals[i]) + 1e-10);
  }

  return {
    MAE: +(maeSum / n).toFixed(4),
    RMSE: +Math.sqrt(mseSum / n).toFixed(4),
    MAPE: +((mapeSum / n) * 100).toFixed(4),
  };
}
