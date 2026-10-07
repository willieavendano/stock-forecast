/**
 * Decision Tree Regressor — pure JavaScript implementation.
 *
 * CART-style binary splits with MSE criterion.
 * Grid-searched hyperparameters (max_depth, min_samples_split,
 * min_samples_leaf) on the validation set, best by RMSE.
 *
 * The target is the next day's log return, not the next price: a tree can
 * only output values it saw in training, so a tree fitted on price levels
 * cannot follow a stock outside its training range.
 *
 * No external libraries required — runs in the browser.
 */

import { computeFeatures, featureVector, FEATURE_WARMUP } from "../data/features";
import { mulberry32 } from "./rng";

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

function buildTree(X, y, depth, maxDepth, minSplit, minLeaf, maxFeatures, rng) {
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
    featureIndices = randomSubset(nFeatures, k, rng);
  } else if (maxFeatures === "log2") {
    const k = Math.max(1, Math.floor(Math.log2(nFeatures)));
    featureIndices = randomSubset(nFeatures, k, rng);
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

  node.left = buildTree(leftX, leftY, depth + 1, maxDepth, minSplit, minLeaf, maxFeatures, rng);
  node.right = buildTree(rightX, rightY, depth + 1, maxDepth, minSplit, minLeaf, maxFeatures, rng);

  return node;
}

function predict(node, x) {
  if (node.left === null) return node.value;
  if (x[node.featureIdx] <= node.threshold) return predict(node.left, x);
  return predict(node.right, x);
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function randomSubset(n, k, rng) {
  return shuffle(Array.from({ length: n }, (_, i) => i), rng).slice(0, k);
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
 * Features are computed once over the whole series (each row only looks
 * backward), then rows are assigned to train or validation by target date.
 * @param {number[]} prices    full price series
 * @param {number[]} volumes   full volume series
 * @param {number}   trainEnd  index of the first validation bar
 * @param {number}   valEnd    index of the first test bar
 * @param {Function} onProgress — (tried, total) callback
 * @param {number}   seed      seeds the grid sample and feature subsets
 * @returns {{ tree, bestParams }}
 */
export function trainDecisionTree(prices, volumes, trainEnd, valEnd, onProgress, seed = 42) {
  const rng = mulberry32(seed);
  const feats = computeFeatures(prices.slice(0, valEnd), volumes.slice(0, valEnd));

  // Supervised: features at time t, target = log return from t to t+1
  const supervised = (from, to) => {
    const X = [], y = [];
    for (let t = from; t < to; t++) {
      X.push(featureVector(feats[t]));
      y.push(Math.log(prices[t + 1] / prices[t]));
    }
    return { X, y };
  };
  const { X: Xtrain, y: ytrain } = supervised(FEATURE_WARMUP, trainEnd - 1);
  const { X: Xval, y: yval } = supervised(trainEnd - 1, valEnd - 1);

  let bestRMSE = Infinity;
  let bestTree = null;
  let bestParams = {};

  const configs = [...gridConfigs()];
  // Sub-sample grid for browser speed: test ~50 random configs
  const maxConfigs = Math.min(configs.length, 50);
  const sampled =
    configs.length <= maxConfigs
      ? configs
      : shuffle(configs, rng).slice(0, maxConfigs);

  for (let ci = 0; ci < sampled.length; ci++) {
    const c = sampled[ci];
    const tree = buildTree(
      Xtrain, ytrain, 0,
      c.maxDepth, c.minSamplesSplit, c.minSamplesLeaf, c.maxFeatures, rng
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
 * Recursive multi-step forecast from each origin index.
 * @returns {number[][]} one path of predicted prices (length = horizon) per origin
 */
export function forecastDecisionTree(tree, allPrices, allVolumes, origins, horizon = 30) {
  return origins.map((o) => {
    const prices = allPrices.slice(0, o + 1);
    const volumes = allVolumes.slice(0, o + 1);
    const path = [];

    for (let step = 0; step < horizon; step++) {
      const [lastRow] = computeFeatures(prices, volumes, prices.length - 1);
      const pred = prices[prices.length - 1] * Math.exp(predict(tree, featureVector(lastRow)));
      path.push(pred);
      prices.push(pred);
      volumes.push(volumes[volumes.length - 1]); // carry forward last volume
    }

    return path;
  });
}
