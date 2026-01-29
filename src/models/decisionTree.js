/**
 * Decision Tree Regressor — pure JavaScript implementation.
 *
 * CART-style binary splits with MSE criterion.
 * Grid-searched hyperparameters (max_depth, min_samples_split,
 * min_samples_leaf) on the validation set, best by RMSE.
 *
 * No external libraries required — runs in the browser.
 */

import { computeFeatures, FEATURE_KEYS, featureVector } from "../data/features";

// ─── Tree Node ──────────────────────────────────────────

class TreeNode {
  constructor() {
    this.featureIdx = -1;
    this.threshold = 0;
    this.value = 0; // leaf prediction (mean of targets)
    this.left = null;
    this.right = null;
  }
}

// ─── Build tree ─────────────────────────────────────────

function mse(targets) {
  if (targets.length === 0) return 0;
  const mean = targets.reduce((a, b) => a + b, 0) / targets.length;
  return targets.reduce((a, b) => a + (b - mean) ** 2, 0) / targets.length;
}

function buildTree(X, y, depth, maxDepth, minSplit, minLeaf, maxFeatures) {
  const node = new TreeNode();
  node.value = y.reduce((a, b) => a + b, 0) / y.length;

  if (
    y.length < minSplit ||
    y.length < 2 * minLeaf ||
    (maxDepth !== null && depth >= maxDepth) ||
    mse(y) < 1e-12
  ) {
    return node; // leaf
  }

  const nFeatures = X[0].length;
  // Which features to consider?
  let featureIndices;
  if (maxFeatures === "sqrt") {
    const k = Math.max(1, Math.floor(Math.sqrt(nFeatures)));
    featureIndices = randomSubset(nFeatures, k);
  } else if (maxFeatures === "log2") {
    const k = Math.max(1, Math.floor(Math.log2(nFeatures)));
    featureIndices = randomSubset(nFeatures, k);
  } else {
    featureIndices = Array.from({ length: nFeatures }, (_, i) => i);
  }

  let bestGain = -Infinity;
  let bestFeat = -1;
  let bestThresh = 0;
  let bestLeftIdx = [];
  let bestRightIdx = [];
  const parentMSE = mse(y);

  for (const fi of featureIndices) {
    // Unique sorted values for this feature
    const vals = X.map((row) => row[fi]);
    const sorted = [...new Set(vals)].sort((a, b) => a - b);

    for (let t = 0; t < sorted.length - 1; t++) {
      const thresh = (sorted[t] + sorted[t + 1]) / 2;
      const leftIdx = [];
      const rightIdx = [];
      for (let i = 0; i < X.length; i++) {
        if (X[i][fi] <= thresh) leftIdx.push(i);
        else rightIdx.push(i);
      }

      if (leftIdx.length < minLeaf || rightIdx.length < minLeaf) continue;

      const leftY = leftIdx.map((i) => y[i]);
      const rightY = rightIdx.map((i) => y[i]);
      const weightedMSE =
        (leftY.length * mse(leftY) + rightY.length * mse(rightY)) / y.length;
      const gain = parentMSE - weightedMSE;

      if (gain > bestGain) {
        bestGain = gain;
        bestFeat = fi;
        bestThresh = thresh;
        bestLeftIdx = leftIdx;
        bestRightIdx = rightIdx;
      }
    }
  }

  if (bestFeat === -1) return node; // no valid split found

  node.featureIdx = bestFeat;
  node.threshold = bestThresh;

  const leftX = bestLeftIdx.map((i) => X[i]);
  const leftY = bestLeftIdx.map((i) => y[i]);
  const rightX = bestRightIdx.map((i) => X[i]);
  const rightY = bestRightIdx.map((i) => y[i]);

  node.left = buildTree(leftX, leftY, depth + 1, maxDepth, minSplit, minLeaf, maxFeatures);
  node.right = buildTree(rightX, rightY, depth + 1, maxDepth, minSplit, minLeaf, maxFeatures);

  return node;
}

function predict(node, x) {
  if (node.left === null) return node.value;
  if (x[node.featureIdx] <= node.threshold) return predict(node.left, x);
  return predict(node.right, x);
}

function randomSubset(n, k) {
  const all = Array.from({ length: n }, (_, i) => i);
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, k);
}

// ─── Hyperparameter grid ────────────────────────────────

const GRID = {
  maxDepth: [3, 5, 8, 12, null],
  minSamplesSplit: [2, 5, 10, 20],
  minSamplesLeaf: [1, 2, 5, 10],
  maxFeatures: [null, "sqrt", "log2"],
};

function* gridConfigs() {
  for (const md of GRID.maxDepth)
    for (const mss of GRID.minSamplesSplit)
      for (const msl of GRID.minSamplesLeaf)
        for (const mf of GRID.maxFeatures)
          yield { maxDepth: md, minSamplesSplit: mss, minSamplesLeaf: msl, maxFeatures: mf };
}

// ─── Public API ─────────────────────────────────────────

/**
 * Train a Decision Tree with grid search on validation RMSE.
 * @param {number[]} trainPrices
 * @param {number[]} trainVolumes
 * @param {number[]} valPrices
 * @param {number[]} valVolumes
 * @param {Function} onProgress — (tried, total) callback
 * @returns {{ tree, bestParams }}
 */
export function trainDecisionTree(
  trainPrices,
  trainVolumes,
  valPrices,
  valVolumes,
  onProgress
) {
  const trainFeats = computeFeatures(trainPrices, trainVolumes);
  const valFeats = computeFeatures(valPrices, valVolumes);

  // Supervised: features at time t, target = price at t+1
  const Xtrain = [];
  const ytrain = [];
  for (let i = 0; i < trainFeats.length - 1; i++) {
    Xtrain.push(featureVector(trainFeats[i]));
    ytrain.push(trainPrices[i + 1]);
  }

  const Xval = [];
  const yval = [];
  for (let i = 0; i < valFeats.length - 1; i++) {
    Xval.push(featureVector(valFeats[i]));
    yval.push(valPrices[i + 1]);
  }

  let bestRMSE = Infinity;
  let bestTree = null;
  let bestParams = {};

  const configs = [...gridConfigs()];
  // Sub-sample grid for browser speed: test ~50 random configs
  const maxConfigs = Math.min(configs.length, 50);
  const sampled =
    configs.length <= maxConfigs
      ? configs
      : configs.sort(() => Math.random() - 0.5).slice(0, maxConfigs);

  for (let ci = 0; ci < sampled.length; ci++) {
    const c = sampled[ci];
    const tree = buildTree(
      Xtrain, ytrain, 0,
      c.maxDepth, c.minSamplesSplit, c.minSamplesLeaf, c.maxFeatures
    );

    // Evaluate on val
    let mseSum = 0;
    for (let i = 0; i < Xval.length; i++) {
      const p = predict(tree, Xval[i]);
      mseSum += (p - yval[i]) ** 2;
    }
    const rmse = Math.sqrt(mseSum / Xval.length);

    if (rmse < bestRMSE) {
      bestRMSE = rmse;
      bestTree = tree;
      bestParams = c;
    }

    if (onProgress) onProgress(ci + 1, sampled.length);
  }

  return { tree: bestTree, bestParams };
}

/**
 * Recursive multi-step forecast.
 */
export function forecastDecisionTree(tree, recentPrices, recentVolumes, horizon = 30) {
  const prices = [...recentPrices];
  const volumes = [...recentVolumes];
  const predictions = [];

  for (let step = 0; step < horizon; step++) {
    const feats = computeFeatures(prices, volumes);
    const lastRow = feats[feats.length - 1];
    const x = featureVector(lastRow);
    const pred = predict(tree, x);
    predictions.push(pred);
    prices.push(pred);
    volumes.push(volumes[volumes.length - 1]); // carry forward last volume
  }

  return predictions;
}

/**
 * Evaluate on test set (1-step).
 */
export function evaluateDecisionTree(tree, testPrices, testVolumes) {
  const feats = computeFeatures(testPrices, testVolumes);
  let maeSum = 0, mseSum = 0, mapeSum = 0;
  let n = 0;

  for (let i = 0; i < feats.length - 1; i++) {
    const x = featureVector(feats[i]);
    const pred = predict(tree, x);
    const actual = testPrices[i + 1];
    const err = Math.abs(pred - actual);
    maeSum += err;
    mseSum += err * err;
    mapeSum += err / (Math.abs(actual) + 1e-10);
    n++;
  }

  if (n === 0) return { MAE: 0, RMSE: 0, MAPE: 0 };
  return {
    MAE: +(maeSum / n).toFixed(4),
    RMSE: +Math.sqrt(mseSum / n).toFixed(4),
    MAPE: +((mapeSum / n) * 100).toFixed(4),
  };
}
