/**
 * Walk-forward evaluation shared by every model.
 *
 * Each test-set day is scored twice: predicted from 1 trading day earlier,
 * and from `horizon` trading days earlier (the horizon the chart forecasts).
 * A model is anything that can produce a forecast path from an origin index
 * using only prices up to and including that index.
 *
 * Paths are number[][] — paths[k][h - 1] is the forecast for bar
 * origins[k] + h.
 */

/** MAE, RMSE and MAPE (%) over paired predictions and actuals. */
export function errorMetrics(preds, actuals) {
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
    n,
  };
}

/**
 * Origin indices (the last known bar) for the walk-forward test.
 * Starts `horizon` bars before the test set so every test day can get a
 * horizon-step prediction, but never before `minOrigin` (the first bar
 * after the data the models were fitted on).
 */
export function walkForwardOrigins(n, testStart, horizon, minOrigin) {
  const origins = [];
  for (let o = Math.max(testStart - horizon, minOrigin); o <= n - 2; o++) {
    origins.push(o);
  }
  return origins;
}

/**
 * Score forecast paths against the test set at 1 step and at `horizon` steps.
 * @returns {{ day1: Object|null, dayH: Object|null }} — null where no origin
 *          has a target inside the test set at that step
 */
export function scorePaths(paths, origins, prices, testStart, horizon) {
  const scoreAt = (h) => {
    const preds = [], actuals = [];
    origins.forEach((o, k) => {
      const target = o + h;
      if (target < testStart || target >= prices.length) return;
      preds.push(paths[k][h - 1]);
      actuals.push(prices[target]);
    });
    return preds.length ? errorMetrics(preds, actuals) : null;
  };

  return { day1: scoreAt(1), dayH: scoreAt(horizon) };
}

/** Naive baseline: the last known price carried forward unchanged. */
export function naivePaths(prices, origins, horizon) {
  return origins.map((o) => new Array(horizon).fill(prices[o]));
}
