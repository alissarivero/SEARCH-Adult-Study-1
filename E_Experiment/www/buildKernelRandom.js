#!/usr/bin/env node
/**
 * Regenerate kernelRandom.json from kernelSmooth.json using www/js/kernelPrng.js.
 * Output format matches kernelSmooth.json (spacing, key order).
 * Usage: node buildKernelRandom.js [--seed N]
 */

//loading required tools
var fs = require("fs");
var path = require("path");
var KernelPrng = require("./js/kernelPrng.js");

//setting seed (Duke zip code)
var KERNEL_RANDOM_SEED = 27708;

//setting the path to the smooth kernel and the output path for the random kernel
var wwwDir = __dirname;
var smoothPath = path.join(wwwDir, "kernelSmooth.json");
var outPath = path.join(wwwDir, "kernelRandom.json");

//removing smoothKernel prefix to return the JSON object, and telling it how to turn the new file into the same format as the smooth kernel
function loadKernelAssignment(filePath, varName) {
  var text = fs.readFileSync(filePath, "utf8");
  var prefix = varName + " = ";
  if (text.indexOf(prefix) !== 0) {
    throw new Error("Expected " + filePath + " to start with " + JSON.stringify(prefix));
  }
  return JSON.parse(text.slice(prefix.length));
}

/** Serialize like kernelSmooth.json: spaces after punctuation, keys x2, y, x1 */
function formatKernelAssignment(kernel, varName) {
  var boardIds = Object.keys(kernel).sort(function (a, b) {
    return Number(a) - Number(b);
  });
  var boardChunks = [];
  for (var bi = 0; bi < boardIds.length; bi++) {
    var boardId = boardIds[bi];
    var cellIds = Object.keys(kernel[boardId]).sort(function (a, b) {
      return Number(a) - Number(b);
    });
    var cellChunks = [];
    for (var ci = 0; ci < cellIds.length; ci++) {
      var cellId = cellIds[ci];
      var cell = kernel[boardId][cellId];
      cellChunks.push(
        '"' +
          cellId +
          '": {"x2": ' +
          cell.x2 +
          ', "y": ' +
          cell.y +
          ', "x1": ' +
          cell.x1 +
          "}"
      );
    }
    boardChunks.push('"' + boardId + '": {' + cellChunks.join(", ") + "}");
  }
  return varName + " = {" + boardChunks.join(", ") + "}";
}

function parseSeedArg() {
  for (var i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === "--seed" && process.argv[i + 1]) {
      return Number(process.argv[i + 1]) >>> 0;
    }
  }
  return KERNEL_RANDOM_SEED;
}

var seed = parseSeedArg();
var smoothKernel = loadKernelAssignment(smoothPath, "smoothKernel");
var randomKernel = KernelPrng.buildRandomKernelFromSmooth(smoothKernel, seed);
var output = formatKernelAssignment(randomKernel, "randomKernel");
fs.writeFileSync(outPath, output, "utf8");

console.log("Wrote " + outPath);
console.log("  boards: " + Object.keys(randomKernel).length);
console.log("  seed: " + seed);
console.log("  bytes: " + output.length);
