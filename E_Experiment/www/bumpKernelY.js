#!/usr/bin/env node
/**
 * Add a constant to every cell's kernel density (y) in smooth, rough, and random kernels.
 * Usage: node bumpKernelY.js [--delta 0.1]
 */

var fs = require("fs");
var path = require("path");

var wwwDir = __dirname;
var KERNEL_FILES = [
  { file: "kernelSmooth.json", varName: "smoothKernel" },
  { file: "kernelRough.json", varName: "roughKernel" },
  { file: "kernelRandom.json", varName: "randomKernel" },
];

function loadKernelAssignment(filePath, varName) {
  var text = fs.readFileSync(filePath, "utf8");
  var prefix = varName + " = ";
  if (text.indexOf(prefix) !== 0) {
    throw new Error("Expected " + filePath + " to start with " + JSON.stringify(prefix));
  }
  return JSON.parse(text.slice(prefix.length));
}

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

function parseDeltaArg() {
  for (var i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === "--delta" && process.argv[i + 1]) {
      return Number(process.argv[i + 1]);
    }
  }
  return 0.1;
}

var delta = parseDeltaArg();
if (!isFinite(delta)) {
  console.error("Invalid --delta value");
  process.exit(1);
}

for (var fi = 0; fi < KERNEL_FILES.length; fi++) {
  var spec = KERNEL_FILES[fi];
  var filePath = path.join(wwwDir, spec.file);
  var kernel = loadKernelAssignment(filePath, spec.varName);
  var cellCount = 0;
  for (var boardId in kernel) {
    for (var cellId in kernel[boardId]) {
      kernel[boardId][cellId].y += delta;
      cellCount++;
    }
  }
  var output = formatKernelAssignment(kernel, spec.varName);
  fs.writeFileSync(filePath, output, "utf8");
  console.log("Wrote " + filePath + " (" + cellCount + " cells, y += " + delta + ")");
}
