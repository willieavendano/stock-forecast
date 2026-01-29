/**
 * Preprocessing utilities — time split, MinMax scaling, LSTM sequences.
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
 * MinMax scaler — fit on data, then transform / inverse.
 */
export function fitMinMaxScaler(data) {
  let min = Infinity,
    max = -Infinity;
  for (const v of data) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min || 1;
  return {
    min,
    max,
    range,
    transform(arr) {
      return arr.map((v) => (v - min) / range);
    },
    inverse(arr) {
      return arr.map((v) => v * range + min);
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
