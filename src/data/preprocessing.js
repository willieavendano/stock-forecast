/**
 * Preprocessing utilities — time split, log returns, scaling, LSTM sequences.
 * Pure JavaScript, runs in-browser.
 */

/**
 * Time-based train / val / test split (no leakage).
 * Returns { train, val, test } each as plain number arrays.
 */
export function timeSplit(arr, trainFrac = 0.8, valFrac = 0.1) {
  const n = arr.length;
  const trainEnd = Math.floor(n * trainFrac);
  const valEnd = Math.floor(n * (trainFrac + valFrac));
  return {
    train: arr.slice(0, trainEnd),
    val: arr.slice(trainEnd, valEnd),
    test: arr.slice(valEnd),
  };
}

/**
 * Daily log returns: ln(P[i] / P[i-1]). One shorter than the price series.
 */
export function logReturns(prices) {
  const out = [];
  for (let i = 1; i < prices.length; i++) {
    out.push(Math.log(prices[i] / prices[i - 1]));
  }
  return out;
}

/**
 * Standard (z-score) scaler — fit on data, then transform / inverse.
 */
export function fitStandardScaler(data) {
  const mean = data.reduce((a, b) => a + b, 0) / data.length;
  const std =
    Math.sqrt(data.reduce((a, b) => a + (b - mean) ** 2, 0) / data.length) || 1;
  return {
    mean,
    std,
    transform(arr) {
      return arr.map((v) => (v - mean) / std);
    },
    inverse(arr) {
      return arr.map((v) => v * std + mean);
    },
  };
}

/**
 * Build LSTM sliding-window sequences.
 * Returns { X: number[][][], y: number[] }
 * X shape: [samples, lookback, 1]
 */
export function buildSequences(scaledArr, lookback = 60) {
  const X = [];
  const y = [];
  for (let i = lookback; i < scaledArr.length; i++) {
    X.push(scaledArr.slice(i - lookback, i).map((v) => [v]));
    y.push(scaledArr[i]);
  }
  return { X, y };
}
