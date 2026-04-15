/**
 * Ensemble blending of LSTM, GBM, and Decision Tree forecasts.
 *
 * Default: equal-weight average of point forecasts.
 * Bands: averaged from GBM bands, widened by model disagreement.
 */

/**
 * @param {Object} forecasts  — { lstm: number[], gbm: number[], decision_tree: number[] }
 * @param {Object} [bands]    — { gbm: { lower5: number[], upper95: number[] } }
 * @returns {{ point: number[], lower5: number[], upper95: number[] }}
 */
export function ensembleForecasts(forecasts, bands) {
  const models = Object.keys(forecasts);
  if (models.length === 0) throw new Error("No forecasts to ensemble.");

  const horizon = forecasts[models[0]].length;
  const w = 1 / models.length;

  const point = new Array(horizon).fill(0);
  for (const m of models) {
    for (let t = 0; t < horizon; t++) {
      point[t] += w * forecasts[m][t];
    }
  }

  // Model disagreement (std across models at each timestep)
  const modelStd = new Array(horizon).fill(0);
  for (let t = 0; t < horizon; t++) {
    const vals = models.map((m) => forecasts[m][t]);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    modelStd[t] = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
  }

  // Base bands from GBM if available, else ±5%
  let lower5, upper95;
  if (bands?.gbm) {
    lower5 = [...bands.gbm.lower5];
    upper95 = [...bands.gbm.upper95];
  } else {
    lower5 = point.map((p) => p * 0.95);
    upper95 = point.map((p) => p * 1.05);
  }

  // Widen by model disagreement
  for (let t = 0; t < horizon; t++) {
    const halfSpread = (upper95[t] - lower5[t]) / 2;
    lower5[t] = point[t] - halfSpread - modelStd[t];
    upper95[t] = point[t] + halfSpread + modelStd[t];
  }

  return { point, lower5, upper95 };
}

/**
 * Evaluate ensemble on test set using individual model test predictions.
 *
 * LSTM and GBM predict testPrices[0..n-1] (length n).
 * Decision Tree predicts testPrices[1..n-1] (length n-1).
 * Slicing all arrays to the shortest length aligns them to the same actuals.
 *
 * @param {Object} evalResults — { [modelName]: { preds: number[], actuals: number[] } }
 * @returns {{ MAE: number, RMSE: number, MAPE: number }}
 */
export function evaluateEnsemble(evalResults) {
  const models = Object.keys(evalResults);
  if (models.length < 2) throw new Error("Need at least 2 models for ensemble evaluation.");

  // Align to the shortest prediction array (handles LSTM/GBM vs DT 1-step offset)
  const minLen = Math.min(...models.map((m) => evalResults[m].preds.length));
  const w = 1 / models.length;

  const ensemblePreds = new Array(minLen).fill(0);
  for (const m of models) {
    const p = evalResults[m].preds.slice(-minLen);
    for (let i = 0; i < minLen; i++) {
      ensemblePreds[i] += w * p[i];
    }
  }

  // Use actuals from the model with the shortest array (naturally aligned after slice)
  const shortestModel = models.find((m) => evalResults[m].preds.length === minLen);
  const actuals = evalResults[shortestModel].actuals;

  let maeSum = 0, mseSum = 0, mapeSum = 0;
  for (let i = 0; i < minLen; i++) {
    const err = Math.abs(ensemblePreds[i] - actuals[i]);
    maeSum += err;
    mseSum += err * err;
    mapeSum += err / (Math.abs(actuals[i]) + 1e-10);
  }

  return {
    MAE: +(maeSum / minLen).toFixed(4),
    RMSE: +Math.sqrt(mseSum / minLen).toFixed(4),
    MAPE: +((mapeSum / minLen) * 100).toFixed(4),
  };
}
