/**
 * Technical-analysis feature engineering (mirrors the Python version).
 * All computations are pure JS — no backend required.
 *
 * Input:  { prices: number[], volumes: number[] }
 * Output: array of feature-row objects, one per valid bar.
 */

export function computeFeatures(prices, volumes) {
  const n = prices.length;
  const rows = [];

  // Pre-compute helpers
  const logReturns = [0];
  for (let i = 1; i < n; i++) {
    logReturns.push(Math.log(prices[i] / prices[i - 1]));
  }

  for (let i = 0; i < n; i++) {
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

    // MACD (12/26/9)
    row.ema12 = ema(prices, 12, i);
    row.ema26 = ema(prices, 26, i);
    row.macd = row.ema12 - row.ema26;

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

  // MACD signal (9-period EMA of MACD)
  const macds = rows.map((r) => r.macd);
  for (let i = 0; i < rows.length; i++) {
    rows[i].macdSignal = ema(macds, 9, i);
  }

  return rows;
}

/** Simple EMA at index i for a given span. */
function ema(arr, span, idx) {
  const k = 2 / (span + 1);
  let val = arr[0];
  for (let i = 1; i <= Math.min(idx, arr.length - 1); i++) {
    val = arr[i] * k + val * (1 - k);
  }
  return val;
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
