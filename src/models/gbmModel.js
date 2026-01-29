/**
 * Geometric Brownian Motion (GBM) — Monte Carlo probabilistic forecast.
 *
 * Ported from: https://github.com/Harishangaran/geometric-brownian-motion
 * Original author: harishangaran  |  License: MIT
 *
 * GBM formula per path:
 *   S(t) = S0 * exp[ (mu - 0.5*sigma^2)*t  +  sigma * W(t) ]
 * where W(t) is a Brownian path (cumulative sum of N(0,sqrt(dt)) increments).
 *
 * Extended for Monte Carlo: simulate nPaths, return median + 5th/95th bands.
 */

// Seedable pseudo-RNG (Mulberry32) so results are reproducible in browser
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box-Muller transform for normal(0,1) from uniform
function normalRandom(rng) {
  const u1 = rng();
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Fit GBM parameters from a price series.
 * @param {number[]} prices — training prices
 * @returns {{ mu: number, sigma: number, lastPrice: number }}
 */
export function fitGBM(prices) {
  // Daily log returns
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push(Math.log(prices[i] / prices[i - 1]));
  }

  // Annualised drift and volatility (matching Harshan's code)
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
  const std = Math.sqrt(variance);

  const mu = mean * 252; // annualised
  const sigma = std * Math.sqrt(252); // annualised

  return { mu, sigma, lastPrice: prices[prices.length - 1] };
}

/**
 * Simulate nPaths GBM paths for `horizon` trading days.
 * @returns {{ median: number[], lower5: number[], upper95: number[] }}
 */
export function forecastGBM(
  { mu, sigma, lastPrice },
  horizon = 30,
  nPaths = 5000,
  seed = 42
) {
  const rng = mulberry32(seed);
  const forecastPeriod = horizon;
  const dt = 1 / forecastPeriod;
  const timeAxis = Array.from({ length: forecastPeriod + 1 }, (_, i) => i / forecastPeriod);

  // paths[p][t] — each path has horizon+1 points, first is lastPrice
  const paths = [];

  for (let p = 0; p < nPaths; p++) {
    // Brownian increments
    const b = [];
    for (let t = 0; t < forecastPeriod; t++) {
      b.push(normalRandom(rng) * Math.sqrt(dt));
    }
    // Cumulative Brownian path
    const W = [b[0]];
    for (let t = 1; t < forecastPeriod; t++) {
      W.push(W[t - 1] + b[t]);
    }

    const path = [lastPrice];
    for (let t = 1; t <= forecastPeriod; t++) {
      const drift = (mu - 0.5 * sigma * sigma) * timeAxis[t];
      const diffusion = sigma * W[t - 1];
      path.push(lastPrice * Math.exp(drift + diffusion));
    }
    paths.push(path);
  }

  // Statistics per day (skip day 0 = lastPrice)
  const median = [];
  const lower5 = [];
  const upper95 = [];

  for (let t = 1; t <= horizon; t++) {
    const col = paths.map((p) => p[t]).sort((a, b) => a - b);
    median.push(col[Math.floor(nPaths * 0.5)]);
    lower5.push(col[Math.floor(nPaths * 0.05)]);
    upper95.push(col[Math.floor(nPaths * 0.95)]);
  }

  return { median, lower5, upper95 };
}

/**
 * Evaluate GBM on test data via rolling 1-step median forecast.
 * @returns {{ MAE, RMSE, MAPE }}
 */
export function evaluateGBM(params, testPrices, contextLastPrice) {
  const preds = [];
  for (let i = 0; i < testPrices.length; i++) {
    const price = i === 0 ? contextLastPrice : testPrices[i - 1];
    const p = { ...params, lastPrice: price };
    const { median } = forecastGBM(p, 1, 500, 42 + i);
    preds.push(median[0]);
  }

  let maeSum = 0,
    mseSum = 0,
    mapeSum = 0;
  const n = testPrices.length;
  for (let i = 0; i < n; i++) {
    const err = Math.abs(preds[i] - testPrices[i]);
    maeSum += err;
    mseSum += err * err;
    mapeSum += err / (Math.abs(testPrices[i]) + 1e-10);
  }

  return {
    MAE: +(maeSum / n).toFixed(4),
    RMSE: +Math.sqrt(mseSum / n).toFixed(4),
    MAPE: +((mapeSum / n) * 100).toFixed(4),
  };
}
