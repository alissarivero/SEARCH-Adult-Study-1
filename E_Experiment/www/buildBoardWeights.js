#!/usr/bin/env node
/**
 * Regenerate boardWeights.json for per-trial board-level multipliers.
 * Usage: node buildBoardWeights.js [--seed N]
 */

var fs = require("fs");
var path = require("path");
var KernelPrng = require("./js/kernelPrng.js");

var BOARD_WEIGHTS_SEED = 27708;
var BOARD_WEIGHT_VALUES = [0.75, 0.775, 0.8, 0.825, 0.85, 0.875, 0.9];

var wwwDir = __dirname;
var outPath = path.join(wwwDir, "boardWeights.json");

function parseSeedArg() {
  for (var i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === "--seed" && process.argv[i + 1]) {
      return Number(process.argv[i + 1]) >>> 0;
    }
  }
  return BOARD_WEIGHTS_SEED;
}

function formatBoardWeights(weights, varName) {
  var parts = [];
  for (var i = 0; i < weights.length; i++) {
    parts.push(String(weights[i]));
  }
  return varName + " = [" + parts.join(", ") + "]";
}

var seed = parseSeedArg();
var boardWeights = KernelPrng.shuffleInPlace(BOARD_WEIGHT_VALUES.slice(), KernelPrng.mulberry32(seed));
var output = formatBoardWeights(boardWeights, "boardWeights");
fs.writeFileSync(outPath, output, "utf8");

console.log("Wrote " + outPath);
console.log("  weights: " + boardWeights.length);
console.log("  seed: " + seed);
console.log("  values: " + boardWeights.join(", "));
