/**
 * Technical-analysis feature engineering (mirrors the Python version).
 * All computations are pure JS — no backend required.
 *
 * Input:  { prices: number[], volumes: number[] }
 * Output: array of feature-row objects, one per bar from `from` onward.
 *         Every row uses only data up to and including its own bar.
 */

export function computeFeatures(prices, volumes, from = 0) {
  const n = prices.length;
  const rows = [];

  // Pre-compute helpers
  const logReturns = [0];
  for (let i = 1; i < n; i++) {
    logReturns.push(Math.log(prices[i] / prices[i - 1]));
  }

  // MACD (12/26/9)
  const ema12 = emaSeries(prices, 12);
  const ema26 = emaSeries(prices, 26);
  const macd = ema12.map((v, i) => v - ema26[i]);
  const macdSignal = emaSeries(macd, 9);

  for (let i = from; i < n; i++) {
    const row = {};
    row.price = prices[i];
    row.logReturn = logReturns[i];

    // 5-day and 10-day returns
    row.return5d = i >= 5 ? (prices[i] - prices[i - 5]) / prices[i - 5] : 0;
    row.return10d = i >= 10 ? (prices[i] - prices[i - 10]) / prices[i - 10] : 0;

    // Rolling mean/std 20
    if (i >= 19) {
      const window = prices.slice(i - 19, i + 1);
      const mean = window.reduce((a, b) => a + b, 0) / 20;
      const std = Math.sqrt(window.reduce((a, b) => a + (b - mean) ** 2, 0) / 20);
      row.rollingMean20 = mean;
      row.rollingStd20 = std;
    } else {
      row.rollingMean20 = prices[i];
      row.rollingStd20 = 0;
    }

    // RSI 14
    if (i >= 14) {
      let gainSum = 0, lossSum = 0;
      for (let j = i - 13; j <= i; j++) {
        const diff = prices[j] - prices[j - 1];
        if (diff > 0) gainSum += diff;
        else lossSum -= diff;
      }
      const avgGain = gainSum / 14;
      const avgLoss = lossSum / 14 + 1e-10;
      row.rsi14 = 100 - 100 / (1 + avgGain / avgLoss);
    } else {
      row.rsi14 = 50;
    }

    row.ema12 = ema12[i];
    row.ema26 = ema26[i];
    row.macd = macd[i];
    row.macdSignal = macdSignal[i];

    // Volume ratio
    if (volumes && volumes.length === n && i >= 19) {
      const vWindow = volumes.slice(i - 19, i + 1);
      const vMean = vWindow.reduce((a, b) => a + b, 0) / 20;
      row.volumeRatio = vMean > 0 ? volumes[i] / vMean : 1;
    } else {
      row.volumeRatio = 1;
    }

    rows.push(row);
  }

  return rows;
}

/** Simple EMA of a series for a given span, one value per bar. */
function emaSeries(arr, span) {
  const k = 2 / (span + 1);
  const out = [arr[0]];
  for (let i = 1; i < arr.length; i++) {
    out.push(arr[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

/** Convert feature rows to a flat float array for a given set of keys. */
export const FEATURE_KEYS = [
  "logReturn",
  "return5d",
  "return10d",
  "rollingMean20",
  "rollingStd20",
  "rsi14",
  "macd",
  "macdSignal",
  "volumeRatio",
];

export function featureVector(row) {
  return FEATURE_KEYS.map((k) => row[k] ?? 0);
}
