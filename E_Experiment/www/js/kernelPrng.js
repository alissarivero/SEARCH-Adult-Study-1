/**
 * Seeded PRNG for reproducible kernel generation.
 * Mulberry32 + Fisher–Yates shuffle (per-board y permutation).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.KernelPrng = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  var DEFAULT_SEED = 27708;

//creating pseudorandom algorithm
  /** @returns {() => number} uniform in [0, 1) */
  function mulberry32(seed) {
    var state = seed >>> 0;
    return function () {
      state = (state + 0x6d2b79f5) >>> 0;
      var t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t = Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  //writing the shuffleInPlace function
  /** In-place Fisher–Yates shuffle; returns the same array reference. */
  function shuffleInPlace(arr, rand) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  /**
   * Build randomKernel from smoothKernel: shuffle y within each board.
   * @param {object} smoothKernel
   * @param {number} [seed]
   */
  function buildRandomKernelFromSmooth(smoothKernel, seed) {
    seed = seed == null ? DEFAULT_SEED : seed >>> 0;
    var out = {};
    var boardIds = Object.keys(smoothKernel).sort(function (a, b) {
      return Number(a) - Number(b);
    });

    //randomizing the y values within each board
    for (var bi = 0; bi < boardIds.length; bi++) {
      var boardId = boardIds[bi];
      var board = smoothKernel[boardId];
      var cellIds = Object.keys(board).sort(function (a, b) {
        return Number(a) - Number(b);
      });
      var ys = cellIds.map(function (cid) {
        return board[cid].y;
      });
      var rand = mulberry32((seed + Number(boardId) * 0x9e3779b9) >>> 0);
      shuffleInPlace(ys, rand);

      out[boardId] = {};
      for (var ci = 0; ci < cellIds.length; ci++) {
        var cellId = cellIds[ci];
        var cell = board[cellId];
        out[boardId][cellId] = {
          x2: cell.x2,
          y: ys[ci],
          x1: cell.x1,
        };
      }
    }

    return out;
  }

  /**
   * Generate uniform board weights in [minW, maxW].
   * @param {number} count
   * @param {number} minW
   * @param {number} maxW
   * @param {number} [seed]
   */
  function generateBoardWeights(count, minW, maxW, seed) {
    seed = seed == null ? DEFAULT_SEED : seed >>> 0;
    var rand = mulberry32(seed);
    var out = [];
    for (var i = 0; i < count; i++) {
      out.push(Math.min(maxW, Math.max(minW, minW + rand() * (maxW - minW))));
    }
    return out;
  }

  return {
    DEFAULT_SEED: DEFAULT_SEED,
    mulberry32: mulberry32,
    shuffleInPlace: shuffleInPlace,
    buildRandomKernelFromSmooth: buildRandomKernelFromSmooth,
    generateBoardWeights: generateBoardWeights,
  };
});
