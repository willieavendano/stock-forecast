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
