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
 * Iterative walk-forward forecast from each origin index, batched so every
 * origin advances one step per model call.
 * @param {number[]} prices   full price series
 * @param {number[]} origins  indices of the last known bar (each >= lookback - 1)
 * @returns {number[][]} one path of predicted prices (length = horizon) per origin
 */
export async function forecastLSTM(model, scaler, prices, origins, lookback = 60, horizon = 30) {
  const windows = origins.map((o) =>
    scaler.transform(prices.slice(o + 1 - lookback, o + 1))
  );
  const pathsScaled = origins.map(() => []);

  for (let step = 0; step < horizon; step++) {
    const input = tf.tensor3d(
      windows.map((w) => w.map((v) => [v])),
      [origins.length, lookback, 1]
    );
    const pred = model.predict(input);
    const vals = await pred.data();
    for (let k = 0; k < origins.length; k++) {
      pathsScaled[k].push(vals[k]);
      windows[k] = [...windows[k].slice(1), vals[k]];
    }
    input.dispose();
    pred.dispose();
  }

  return pathsScaled.map((path) => scaler.inverse(path));
}
