////////////////////////////////////////////////////////////////////////
//            JS-CODE FOR 2D ACTIVE FUNCTION LEARNING                 //
//        cordova version and refactoring: Federico Meini             //
//            original work: CHARLEY WU, ERIC SCHULZ                  //
//   edited by: ALISSA RIVERO, BEN PITT, CAROLINA DEUS, DORSA AMIR    //
////////////////////////////////////////////////////////////////////////

// Touch events support

/* START OF NEW */

// ==============================
// PHYSICS ENGINE (Matter.js, optional — bundled locally for offline use)
// ==============================

var matterPhysicsAvailable = typeof Matter !== "undefined";
var Engine, Render, Runner, Bodies, Composite;
if (matterPhysicsAvailable) {
  Engine = Matter.Engine;
  Render = Matter.Render;
  Runner = Matter.Runner;
  Bodies = Matter.Bodies;
  Composite = Matter.Composite;
}

var physicsEngine;
var physicsWorld;
var physicsRender;

function initCollectedPhysics() {
  if (!matterPhysicsAvailable || physicsEngine) return;

  var box = document.getElementById("collectedBox");

  physicsEngine = Engine.create();
  physicsWorld = physicsEngine.world;
  physicsWorld.gravity.y = 1; // gravity strength

  physicsRender = Render.create({
    element: box,
    engine: physicsEngine,
    options: {
      width: box.clientWidth,
      height: box.clientHeight,
      wireframes: false,
      background: "transparent"
    }
  });

  // Create boundaries (floor + walls)
  var w = box.clientWidth;
  var h = box.clientHeight;
  var thickness = 40;

  var floor = Bodies.rectangle(w/2, h + thickness/2, w, thickness, { isStatic: true });
  var leftWall = Bodies.rectangle(-thickness/2, h/2, thickness, h, { isStatic: true });
  var rightWall = Bodies.rectangle(w + thickness/2, h/2, thickness, h, { isStatic: true });

  Composite.add(physicsWorld, [floor, leftWall, rightWall]);

  Engine.run(physicsEngine);
  Render.run(physicsRender);
}

/* END OP NEW */

// Use click for maximum compatibility in Cordova WebViews.
// Some environments expose PointerEvent but don't consistently emit pointerdown.
var clickEventType = "click";
var customVolcanoSvg = null;
var customRockSvg = null;

// ==============================
// VISUAL SETTINGS (NEW)
// ==============================
var ROCK_GRAY = "#7a7a7a";
/** Kernel density (0–1) maps to reward points 0–REWARD_VALUE_MAX; rock size uses this range. */
var REWARD_VALUE_MAX = 50;
var BOARD_WEIGHT_VALUES = [0.75, 0.775, 0.8, 0.825, 0.85, 0.875, 0.9];
var BOARD_WEIGHTS_SEED = 27708;

// -----------------------------
// NEW: circle sizing + collected box animation helpers
// -----------------------------
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function rewardValueFromKernelY(kernelY, boardWeight) {
  var w = boardWeight == null ? 1 : boardWeight;
  return Math.max(0, Math.round(kernelY * REWARD_VALUE_MAX * w));
}

// Map reward value (0..REWARD_VALUE_MAX) to an SVG radius (0..45 within viewBox 0..100).
function radiusForValue(value) {
  var maxV = REWARD_VALUE_MAX;

  var t = value / maxV;
  t = clamp(t, 0, 1);

  var rMin = 0;
  var rMax = 45;
  return rMin + t * (rMax - rMin);
}

function rockScaleForValue(value) {
  var maxRadius = 45;
  return clamp(radiusForValue(value) / maxRadius, 0.001, 1.0);
}

/**
 * Gap (px) between stacked collection rows. Advance = getCollectionSlotHeightPx(w) + this.
 */
var COLLECTION_STACK_GAP_PX = 5;

/**
 * Tight Y crop in the default SVG (0..100 user space, path y ~7..73). `ROCK_COLLECTION_HOST_H_FRAC`
 * sets the actual row height in px as a fraction of cell width w; shorter than the raw viewBox
 * aspect (0.66) so stacked rows are tighter (SVG `meet`-scales inside the host). Board grid
 * is unchanged; only collection/escape + fly use this.
 */
var ROCK_COLLECTION_VIEWBOX_Y = 7;
var ROCK_COLLECTION_VIEWBOX_H = 66;
var ROCK_COLLECTION_HOST_H_FRAC = 0.5;
var collectionRockMetricsCache = {};

function getCollectionSlotHeightPx(w) {
  return Math.max(1, Math.round(ROCK_COLLECTION_HOST_H_FRAC * w));
}

function getCollectionStackRowAdvancePx(w) {
  return getCollectionSlotHeightPx(w) + COLLECTION_STACK_GAP_PX;
}

function getCollectionMetricsCacheKey(value, w) {
  return String(Math.round(value)) + "|" + String(Math.round(w));
}

function getCollectionRockLayoutMetrics(value, w) {
  var hSlot = getCollectionSlotHeightPx(w);
  var key = getCollectionMetricsCacheKey(value, w);
  if (collectionRockMetricsCache[key]) return collectionRockMetricsCache[key];

  var probe = document.createElement("div");
  probe.style.position = "fixed";
  probe.style.left = "-10000px";
  probe.style.top = "-10000px";
  probe.style.width = w + "px";
  probe.style.height = hSlot + "px";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.boxSizing = "border-box";
  probe.appendChild(buildRockGridCellSurfaceElement(value, true));
  document.body.appendChild(probe);

  var hostRect = probe.getBoundingClientRect();
  var pathNode = probe.querySelector("path");
  var pathRect = pathNode ? pathNode.getBoundingClientRect() : hostRect;
  var topInset = pathRect.top - hostRect.top;
  var bottomInset = hostRect.bottom - pathRect.bottom;
  var inkHeight = pathRect.height;

  document.body.removeChild(probe);

  var out = {
    slotHeight: hSlot,
    inkTopInset: topInset,
    inkBottomInset: bottomInset,
    inkHeight: Math.max(1, inkHeight),
  };
  collectionRockMetricsCache[key] = out;
  return out;
}

var gridRockInkHeightCache = {};

/** Visible rock ink height (px), excluding transparent SVG padding — matches on-grid display. */
function getGridRockInkHeightPx(rewardValue) {
  var w = getGridCellEdgePx();
  var key = String(Math.round(rewardValue)) + "|" + String(Math.round(w));
  if (gridRockInkHeightCache[key] != null) return gridRockInkHeightCache[key];
  if (typeof document === "undefined" || !document.body) {
    var scale = rockScaleForValue(rewardValue);
    var inkFrac = (ROCK_PATH_BBOX_Y_MAX - ROCK_PATH_BBOX_Y_MIN) / 100;
    return Math.round(w * scale * inkFrac);
  }

  var probe = document.createElement("div");
  probe.style.position = "fixed";
  probe.style.left = "-10000px";
  probe.style.top = "-10000px";
  probe.style.width = w + "px";
  probe.style.height = w + "px";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.boxSizing = "border-box";
  probe.appendChild(buildRockGridCellSurfaceElement(rewardValue, false));
  document.body.appendChild(probe);

  var hostRect = probe.getBoundingClientRect();
  var pathNode = probe.querySelector("path");
  var svgNode = probe.querySelector(".cell-svg");
  var inkRect = pathNode
    ? pathNode.getBoundingClientRect()
    : svgNode
      ? svgNode.getBoundingClientRect()
      : hostRect;
  var inkHeight = Math.max(0, inkRect.height);

  document.body.removeChild(probe);

  var out = Math.round(inkHeight * 100) / 100;
  gridRockInkHeightCache[key] = out;
  return out;
}

function collectionRockZIndexForValue(_value, stackIndex) {
  return 2000 - stackIndex;
}

function rockPath() {
  // One shared irregular-but-rounded silhouette for all rocks.
  return "M50 33 C66 28 83 30 91 37 C96 42 96 49 92 55 C86 63 73 69 56 71 C39 73 24 71 14 65 C6 60 4 52 7 45 C11 39 23 34 36 33 C41 30 46 29 50 33 Z";
}

/**
 * Y bounds of `rockPath()` in the 0..100 default viewBox (tight control points).
 * Used to nudge the group so the silhouette is vertically centered — even negative space
 * above/below the ink within the cell, without changing w×w, scale s, or grid/collection match.
 */
var ROCK_PATH_BBOX_Y_MIN = 7;
var ROCK_PATH_BBOX_Y_MAX = 73;
var ROCK_PATH_BBOX_NUDGE_Y = 50 - (ROCK_PATH_BBOX_Y_MIN + ROCK_PATH_BBOX_Y_MAX) / 2;

// Ensure the collected box exists and has enough slots.
// NOTE: You must add <div id="collectedBox"></div> somewhere on the right side in index.html
// and CSS for #collectedBox/.collected-item/.fly-circle.
function ensureCollectedBoxSlots() {
  var box = document.getElementById("collectedBox");
  if (!box) return;

  // visual cap so the UI doesn't explode
  var desired = 5;

  if (box.children.length >= desired) return;

  for (var i = box.children.length; i < desired; i++) {
    var slot = document.createElement("div");
    slot.className = "collected-item";
    slot.setAttribute("data-slot", i);
    box.appendChild(slot);
  }
}

function nextEmptyCollectedSlot() {
  var box = document.getElementById("collectedBox");
  if (!box) return null;

  var slots = box.querySelectorAll(".collected-item");
  for (var i = 0; i < slots.length; i++) {
    if (!slots[i].dataset.filled) return slots[i];
  }
  return null;
}

/**
 * One grid cell edge in CSS pixels — content box (use clientWidth so borders do not
 * inflate the size; SVG in td is 100% of content area, not offsetWidth).
 */
function getGridCellEdgePx() {
  var td = document.querySelector("#grid td");
  if (!td) return 48;
  var w = 0;
  if (typeof td.clientWidth === "number") w = td.clientWidth;
  if (!w && td.getBoundingClientRect) w = td.getBoundingClientRect().width;
  if (!w) w = td.offsetWidth;
  if (!w) return 48;
  return Math.max(1, Math.round(w));
}

/**
 * Fly + collection: same edge length (px) as a grid cell — single source of truth as #grid td.
 */
function getRockBoxEdgePxForFlyer(_sourceTd) {
  return getGridCellEdgePx();
}

/**
 * Landed rock width matches the grid cell (pixel-for-pixel with table.grid td); box arg unused, kept for call sites.
 */
function getRockBoxEdgePxForCollectionBox(_box) {
  return getGridCellEdgePx();
}

/**
 * @param {boolean} [forCollection] — tight viewBox and shorter row in bin; false = board grid (square cell).
 */
function buildRockSvgMarkup(value, forCollection) {
  if (customRockSvg) {
    var sfx = "rk" + Date.now() + "_" + Math.floor(Math.random() * 10000);
    return normalizeRockSvgMarkup(namespaceSvgIds(customRockSvg, sfx), rockScaleForValue(value));
  }
  forCollection = !!forCollection;
  var s = rockScaleForValue(value);
  var gid = "rg" + Date.now() + "_" + Math.floor(Math.random() * 100000);
  var defs =
    "<defs>" +
    '<radialGradient id="' +
    gid +
    '" cx="35%" cy="30%" r="65%">' +
    '<stop offset="0%" stop-color="#b8b8b8"></stop>' +
    '<stop offset="55%" stop-color="#8e8e8e"></stop>' +
    '<stop offset="100%" stop-color="#646464"></stop>' +
    "</radialGradient></defs>";
  if (forCollection) {
    var vby = ROCK_COLLECTION_VIEWBOX_Y;
    var vbH = ROCK_COLLECTION_VIEWBOX_H;
    return (
      '<svg class="cell-svg" viewBox="0 ' +
      vby +
      " 100 " +
      vbH +
      '" preserveAspectRatio="xMidYMid meet" style="overflow:visible">' +
      defs +
      '<g class="cell-rock-wrap" transform="translate(50 50) scale(' +
      s +
      ') translate(-50 -50)">' +
      '<path d="' +
      rockPath() +
      '" fill="url(#' +
      gid +
      ')" stroke="#595959" stroke-width="2" vector-effect="non-scaling-stroke"></path>' +
      "</g></svg>"
    );
  }
  return (
    '<svg class="cell-svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">' +
    defs +
    '<g class="cell-rock-wrap" transform="translate(50 50) scale(' +
    s +
    ') translate(-50 -50)">' +
    '<g transform="translate(0 ' +
    ROCK_PATH_BBOX_NUDGE_Y +
    ')">' +
    '<path d="' +
    rockPath() +
    '" fill="url(#' +
    gid +
    ')" stroke="#595959" stroke-width="2"></path>' +
    "</g></g></svg>"
  );
}

/**
 * @param {boolean} [forCollection] — w × tight-height host for the bin/escape; board stays w×w.
 */
function buildRockGridCellSurfaceElement(value, forCollection) {
  var w = getGridCellEdgePx();
  forCollection = !!forCollection;
  var d = document.createElement("div");
  d.className = "rock-grid-surface" + (forCollection ? " rock-grid-surface--collection" : "");
  d.style.width = w + "px";
  d.style.height = (forCollection ? getCollectionSlotHeightPx(w) : w) + "px";
  d.style.boxSizing = "border-box";
  d.innerHTML = buildRockSvgMarkup(value, forCollection);
  return d;
}

function normalizeRockSvgMarkup(svgMarkup, scale) {
  if (!svgMarkup) return svgMarkup;
  var out = svgMarkup;
  if (!/\bclass=/.test(out)) {
    out = out.replace(/<svg\b/i, '<svg class="cell-svg"');
  } else if (!/\bcell-svg\b/.test(out)) {
    out = out.replace(/<svg\b([^>]*?)class=(['"])([^'"]*)\2/i, function (_m, attrs, q, cls) {
      return '<svg' + attrs + 'class=' + q + (cls ? cls + " " : "") + "cell-svg" + q;
    });
  }
  if (!/\bpreserveAspectRatio=/.test(out)) {
    out = out.replace(/<svg\b/i, '<svg preserveAspectRatio="xMidYMid meet"');
  }
  if (!/\bstyle=/.test(out)) {
    out = out.replace(
      /<svg\b/i,
      '<svg style="width:100%;height:100%;display:block;transform-origin:50% 50%;transform-box:fill-box;transform:scale(' +
        scale +
        ');"'
    );
  } else {
    out = out.replace(/<svg\b([^>]*?)style=(['"])([^'"]*)\2/i, function (_m, attrs, q, styleVal) {
      var base = styleVal ? styleVal.trim() : "";
      if (base && !/;\s*$/.test(base)) base += ";";
      base += "width:100%;height:100%;display:block;transform-origin:50% 50%;transform-box:fill-box;transform:scale(" + scale + ");";
      return "<svg" + attrs + "style=" + q + base + q;
    });
  }
  return out;
}

function sanitizeSvgText(svgText) {
  if (!svgText) return null;
  var clean = svgText
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "")
    .trim();
  if (clean.indexOf("<svg") === -1) return null;
  return clean;
}

function namespaceSvgIds(svgText, suffix) {
  if (!svgText) return svgText;
  var ids = [];
  var out = svgText.replace(/id=(['"])([^'"]+)\1/g, function (m, q, id) {
    ids.push(id);
    return "id=" + q + id + "-" + suffix + q;
  });
  for (var i = 0; i < ids.length; i++) {
    var src = ids[i];
    var dst = src + "-" + suffix;
    out = out.replace(new RegExp("url\\(#" + src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\)", "g"), "url(#" + dst + ")");
    out = out.replace(new RegExp("href=(['\"])#" + src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\1", "g"), "href=\"#" + dst + "\"");
    out = out.replace(new RegExp("xlink:href=(['\"])#" + src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\1", "g"), "xlink:href=\"#" + dst + "\"");
  }
  return out;
}

function updateVolcanoAsset() {
  var container = document.getElementById("volcanoAssetContainer");
  if (!container || !customVolcanoSvg) return;
  var sfx = "vol" + Date.now();
  container.innerHTML = namespaceSvgIds(customVolcanoSvg, sfx);
  var svg = container.querySelector("svg");
  if (svg) {
    svg.classList.add("volcano-svg");
    svg.setAttribute("role", "img");
    fitSvgViewBoxToVisibleContent(svg);
  }
}

function fitSvgViewBoxToVisibleContent(svg) {
  if (!svg || typeof svg.getBBox !== "function") return;
  try {
    var bb = svg.getBBox();
    if (!bb || bb.width <= 0 || bb.height <= 0) return;
    svg.setAttribute("viewBox", bb.x + " " + bb.y + " " + bb.width + " " + bb.height);
  } catch (e) {}
}

/** Crop SVG markup to visible geometry (drops transparent margins) for correct rock sizing. */
function cropSvgTextToVisibleBounds(svgText) {
  var clean = sanitizeSvgText(svgText);
  if (!clean || typeof document === "undefined" || !document.body) return svgText;
  var wrap = document.createElement("div");
  wrap.setAttribute(
    "style",
    "position:absolute;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;visibility:hidden;pointer-events:none;"
  );
  document.body.appendChild(wrap);
  wrap.innerHTML = clean;
  var svg = wrap.querySelector("svg");
  if (svg) fitSvgViewBoxToVisibleContent(svg);
  var out = svg ? svg.outerHTML : clean;
  document.body.removeChild(wrap);
  return out || svgText;
}

function setAssetStatus(msg, isError) {
  var el = document.getElementById("assetUploadStatus");
  if (!el) return;
  el.textContent = msg || "";
  el.style.color = isError ? "#b30000" : "#2f6f2f";
}

function loadSvgFromPath(path, onDone) {
  function finish(txt) {
    onDone(txt ? sanitizeSvgText(txt) : null);
  }

  function loadViaXhr() {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open("GET", path, true);
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        if (xhr.status === 200 || xhr.status === 0) finish(xhr.responseText);
        else finish(null);
      };
      xhr.onerror = function () {
        finish(null);
      };
      xhr.send();
    } catch (e) {
      finish(null);
    }
  }

  if (typeof fetch === "function") {
    fetch(path)
      .then(function (res) {
        if (!res.ok) throw new Error("failed");
        return res.text();
      })
      .then(function (txt) {
        finish(txt);
      })
      .catch(function () {
        loadViaXhr();
      });
    return;
  }

  loadViaXhr();
}

var scatterPlacements = [];
/** Next vertical stack offset (px) inside #collectedBox for bigger_reward mode. */
var collectionStackY = 0;

function resetCollectedBoxLayoutState() {
  scatterPlacements = [];
  collectionStackY = 0;
  collectionRockMetricsCache = {};
}

function scatterOverlaps(x, y, w, h, gap) {
  for (var i = 0; i < scatterPlacements.length; i++) {
    var p = scatterPlacements[i];
    if (!(x + w + gap < p.x || x > p.x + p.w + gap || y + h + gap < p.y || y > p.y + p.h + gap)) {
      return true;
    }
  }
  return false;
}

/** Bigger reward: vertical stack (top of each rock touches bottom of previous). */
function appendScatterRockToBox(box, value, stackY) {
  var bw = box.clientWidth || box.offsetWidth || 200;
  var w = getRockBoxEdgePxForCollectionBox(box);
  var metrics = getCollectionRockLayoutMetrics(value, w);
  var hSlot = metrics.slotHeight;
  var topPx = stackY - metrics.inkTopInset;

  var rock = document.createElement("div");
  rock.className = "scatter-rock";
  rock.setAttribute("data-rock-value", String(value));
  var stackIndex = box.querySelectorAll(".scatter-rock").length;
  rock.style.zIndex = String(collectionRockZIndexForValue(value, stackIndex));
  rock.style.left = Math.max(0, (bw - w) / 2) + "px";
  rock.style.top = topPx + "px";
  rock.style.width = w + "px";
  rock.style.height = hSlot + "px";
  rock.style.boxSizing = "border-box";
  rock.appendChild(buildRockGridCellSurfaceElement(value, true));
  box.appendChild(rock);
  return stackY + metrics.inkHeight + COLLECTION_STACK_GAP_PX;
}

function addRockToScatterCollection(value, layoutRetry, sessionTag, onAppended) {
  var box = document.getElementById("collectedBox");
  if (!box) {
    if (typeof onAppended === "function") onAppended();
    return;
  }

  if (typeof sessionTag === "number" && sessionTag !== flyRockSessionId) {
    if (typeof onAppended === "function") onAppended();
    return;
  }

  layoutRetry = layoutRetry || 0;
  var bw = box.clientWidth;
  var bh = box.clientHeight;
  if ((bw < 48 || bh < 48) && layoutRetry < 24) {
    var tag = typeof sessionTag === "number" ? sessionTag : flyRockSessionId;
    requestAnimationFrame(function () {
      if (tag !== flyRockSessionId) {
        if (typeof onAppended === "function") onAppended();
        return;
      }
      addRockToScatterCollection(value, layoutRetry + 1, tag, onAppended);
    });
    return;
  }

  collectionStackY = appendScatterRockToBox(box, value, collectionStackY);
  if (typeof onAppended === "function") onAppended();
}

function rebuildScatterRocksInShowcaseBox(showcaseBox, sourceBox) {
  showcaseBox.innerHTML = "";
  var rocks = sourceBox.querySelectorAll(".scatter-rock");
  var stackY = 0;
  for (var i = 0; i < rocks.length; i++) {
    var val = parseInt(rocks[i].getAttribute("data-rock-value"), 10);
    if (isNaN(val)) continue;
    stackY = appendScatterRockToBox(showcaseBox, val, stackY);
  }
}

function buildShowcaseCollectedBox(sourceBox) {
  var box = document.createElement("div");
  box.id = "roundRockShowcaseBox";

  if (sourceBox.classList.contains("collected-box--bigger-reward")) {
    box.className = "collected-box--bigger-reward";
    return { box: box, mode: "bigger_reward" };
  }

  box.className = sourceBox.className;
  if (sourceBox.classList.contains("collected-box--escape-path")) {
    var escapeRocks = sourceBox.querySelectorAll(".escape-path-rock");
    for (var i = 0; i < escapeRocks.length; i++) {
      box.appendChild(escapeRocks[i].cloneNode(true));
    }
  } else {
    box.innerHTML = sourceBox.innerHTML;
  }
  return { box: box, mode: "escape_path" };
}

var FLY_ROCK_MS = 520;
var clickDelayTimer = null;
var ROUND_ROCK_SHOWCASE_MS = 3500;

/**
 * Viewport (fixed) coords for the fly. Prefer a 1-frame probe with the same layout as the
 * next landed rock (fixes drift from manual scroll/border/padding math vs absolute/flex).
 */
function getFlyDestinationRect(box, sourceTd, value) {
  var w = getRockBoxEdgePxForCollectionBox(box) || getRockBoxEdgePxForFlyer(sourceTd);
  var useTightH =
    typeof uxMode !== "undefined" &&
    (uxMode === "bigger_reward" || uxMode === "volcano_escape");
  var metrics = useTightH ? getCollectionRockLayoutMetrics(value, w) : null;
  var h = useTightH ? metrics.slotHeight : w;

  if (box && typeof uxMode !== "undefined" && uxMode === "bigger_reward") {
    var ms = document.createElement("div");
    ms.setAttribute("aria-hidden", "true");
    ms.className = "scatter-rock";
    ms.style.position = "absolute";
    ms.style.left = Math.max(0, (box.clientWidth - w) / 2) + "px";
    ms.style.top = collectionStackY - metrics.inkTopInset + "px";
    ms.style.width = w + "px";
    ms.style.height = h + "px";
    ms.style.boxSizing = "border-box";
    ms.style.visibility = "hidden";
    ms.style.pointerEvents = "none";
    box.appendChild(ms);
    var brs = ms.getBoundingClientRect();
    box.removeChild(ms);
    return {
      left: Math.round(brs.left),
      top: Math.round(brs.top),
      width: w,
      height: h,
    };
  }

  if (box && typeof uxMode !== "undefined" && uxMode === "volcano_escape") {
    var refMetrics = getCollectionRockLayoutMetrics(REWARD_VALUE_MAX, w);
    var me = document.createElement("div");
    me.setAttribute("aria-hidden", "true");
    me.className = "escape-path-rock";
    me.style.boxSizing = "border-box";
    me.style.minHeight = h + "px";
    me.style.height = h + "px";
    me.style.marginTop = refMetrics.inkTopInset - metrics.inkTopInset + "px";
    me.style.marginBottom = refMetrics.inkBottomInset - metrics.inkBottomInset + "px";
    me.style.visibility = "hidden";
    me.style.pointerEvents = "none";
    me.style.width = "100%";
    me.appendChild(buildRockGridCellSurfaceElement(value, true));
    box.appendChild(me);
    var bre = me.getBoundingClientRect();
    var meW = me.clientWidth || bre.width || w;
    box.removeChild(me);
    return {
      left: Math.round(bre.left + Math.max(0, (meW - w) / 2)),
      top: Math.round(bre.top),
      width: w,
      height: h,
    };
  }

  var r = box.getBoundingClientRect();
  var st = box.scrollTop || 0;
  var sl = box.scrollLeft || 0;
  var cTop = box.clientTop || 0;
  var cLeft = box.clientLeft || 0;
  return {
    left: Math.round(r.left + cLeft + Math.max(0, (box.clientWidth - w) / 2) - sl),
    top: Math.round(r.top + cTop + collectionStackY - st),
    width: w,
    height: h,
  };
}

var flyRockQueue = [];
var flyRockRunning = false;
/** Incremented when a new trial starts; stale fly jobs must not add rocks or steal the pump. */
var flyRockSessionId = 0;

function invalidateFlyRockAnimations() {
  flyRockSessionId++;
  flyRockQueue = [];
  flyRockRunning = false;
  var nodes = document.querySelectorAll(".fly-rock");
  for (var i = 0; i < nodes.length; i++) {
    var n = nodes[i];
    if (n.parentNode) n.parentNode.removeChild(n);
  }
}

function flyRockToCollectedBox(value, sourceTd, onArrived) {
  var box = document.getElementById("collectedBox");
  if (!box || !sourceTd) {
    return;
  }
  flyRockQueue.push({ value: value, sourceTd: sourceTd, onArrived: onArrived });
  flyRockPumpQueue();
}

function flyRockPumpQueue() {
  if (flyRockRunning || flyRockQueue.length === 0) return;
  flyRockRunning = true;
  var job = flyRockQueue.shift();
  flyRockToCollectedBoxRun(job.value, job.sourceTd, function (afterAppend) {
    if (job.onArrived) {
      job.onArrived(afterAppend);
    } else if (typeof afterAppend === "function") {
      afterAppend();
    } else {
      flyRockRunning = false;
      flyRockPumpQueue();
    }
  });
}

function flyRockToCollectedBoxRun(value, sourceTd, onArrived) {
  var sessionAtStart = flyRockSessionId;
  var box = document.getElementById("collectedBox");
  if (!box || !sourceTd) {
    flyRockRunning = false;
    flyRockPumpQueue();
    return;
  }

  var flyer = document.createElement("div");
  flyer.className = "fly-rock";
  flyer.style.position = "fixed";
  flyer.style.left = "0";
  flyer.style.top = "0";
  flyer.style.pointerEvents = "none";
  flyer.style.zIndex = String(10000 + (Date.now() % 9000));
  flyer.style.willChange = "transform";
  flyer.style.transition = "none";
  flyer.style.backfaceVisibility = "hidden";
  flyer.style.opacity = "0";
  document.body.appendChild(flyer);

  requestAnimationFrame(function () {
    if (sessionAtStart !== flyRockSessionId) {
      if (flyer.parentNode) flyer.parentNode.removeChild(flyer);
      flyRockRunning = false;
      flyRockPumpQueue();
      return;
    }
    var dest2 = getFlyDestinationRect(box, sourceTd, value);
    var sr2 = sourceTd.getBoundingClientRect();
    var w2 = dest2.width;
    var h2 = dest2.height;
    var sx2 = Math.round(sr2.left + sr2.width / 2 - w2 / 2);
    var sy2 = Math.round(sr2.top + sr2.height / 2 - h2 / 2);
    var ex = Math.round(dest2.left);
    var ey = Math.round(dest2.top);
    flyer.style.width = w2 + "px";
    flyer.style.height = h2 + "px";
    flyer.style.boxSizing = "border-box";
    flyer.innerHTML = "";
    flyer.appendChild(
      buildRockGridCellSurfaceElement(
        value,
        typeof uxMode !== "undefined" &&
          (uxMode === "bigger_reward" || uxMode === "volcano_escape")
      )
    );
    flyer.style.transform = "translate3d(" + sx2 + "px," + sy2 + "px,0)";
    void flyer.offsetHeight;
    flyer.style.opacity = "1";
    void flyer.offsetHeight;
    flyer.style.transition =
      "transform " + FLY_ROCK_MS + "ms cubic-bezier(0.22, 1, 0.36, 1)";
    void flyer.offsetHeight;
    requestAnimationFrame(function () {
      if (sessionAtStart !== flyRockSessionId) {
        if (flyer.parentNode) flyer.parentNode.removeChild(flyer);
        flyRockRunning = false;
        flyRockPumpQueue();
        return;
      }
      flyer.style.transform = "translate3d(" + ex + "px," + ey + "px,0)";
    });
  });

  var ended = false;
  function markDonePumping() {
    flyRockRunning = false;
    flyRockPumpQueue();
  }

  function cleanupAndArrive() {
    if (ended) return;
    ended = true;
    clearTimeout(fallbackTimer);
    flyer.removeEventListener("transitionend", onTransitionEnd);
    flyer.style.willChange = "auto";
    if (flyer.parentNode) flyer.parentNode.removeChild(flyer);
    if (onArrived) {
      if (sessionAtStart === flyRockSessionId) {
        onArrived(markDonePumping);
      } else {
        markDonePumping();
      }
    } else {
      markDonePumping();
    }
  }

  function onTransitionEnd(ev) {
    if (ev.target !== flyer) return;
    var pn = ev.propertyName;
    if (pn !== "transform" && pn !== "-webkit-transform") return;
    cleanupAndArrive();
  }

  flyer.addEventListener("transitionend", onTransitionEnd);
  var fallbackTimer = setTimeout(cleanupAndArrive, FLY_ROCK_MS + 400);
}

function animateCircleToCollectedBox(value, sourceTd, onAfterLanded) {
  var sid = flyRockSessionId;
  flyRockToCollectedBox(value, sourceTd, function (markDonePumping) {
    function afterAppend() {
      if (typeof markDonePumping === "function") {
        markDonePumping();
      }
    }
    if (sid !== flyRockSessionId) {
      afterAppend();
      return;
    }
    if (typeof uxMode !== "undefined" && uxMode === "volcano_escape") {
      addRockToEscapePath(value);
      if (typeof onAfterLanded === "function") onAfterLanded();
      afterAppend();
    } else {
      addRockToScatterCollection(
        value,
        0,
        sid,
        function () {
          if (typeof onAfterLanded === "function") onAfterLanded();
          afterAppend();
        }
      );
    }
  });
}

/**
 * Volcano escape: one rock-grid-surface (w×w) per item — same host as grid + fly, not a “square
 * around” a smaller SVG; the inner surface matches the td’s content box.
 */
function addRockToEscapePath(value) {
  var box = document.getElementById("collectedBox");
  if (!box) return;
  var w = getRockBoxEdgePxForCollectionBox(box);
  var metrics = getCollectionRockLayoutMetrics(value, w);
  var hSlot = metrics.slotHeight;
  var refMetrics = getCollectionRockLayoutMetrics(REWARD_VALUE_MAX, w);
  var rock = document.createElement("div");
  rock.className = "escape-path-rock";
  rock.style.boxSizing = "border-box";
  rock.setAttribute("data-rock-value", String(value));
  rock.appendChild(buildRockGridCellSurfaceElement(value, true));
  rock.style.minHeight = hSlot + "px";
  rock.style.height = hSlot + "px";
  rock.style.marginTop = refMetrics.inkTopInset - metrics.inkTopInset + "px";
  rock.style.marginBottom = refMetrics.inkBottomInset - metrics.inkBottomInset + "px";
  var stackIndex = box.querySelectorAll(".escape-path-rock").length;
  rock.style.zIndex = String(collectionRockZIndexForValue(value, stackIndex));
  box.appendChild(rock);
  collectionStackY += metrics.inkHeight + COLLECTION_STACK_GAP_PX;
}

function setupEscapePathBox() {
  var box = document.getElementById("collectedBox");
  if (!box) return;
  resetCollectedBoxLayoutState();
  box.innerHTML = "";
  box.classList.add("collected-box--escape-path");
  box.classList.remove("collected-box--bigger-reward");
}

function setupBiggerRewardBox() {
  var box = document.getElementById("collectedBox");
  if (!box) return;
  resetCollectedBoxLayoutState();
  box.innerHTML = "";
  box.classList.remove("collected-box--escape-path");
  box.classList.add("collected-box--bigger-reward");
}

function resetCollectedVisualForNewTrial() {
  invalidateFlyRockAnimations();
  resetCollectedBoxLayoutState();
  var box = document.getElementById("collectedBox");
  if (box) box.innerHTML = "";
}

var UX_CONDITION_COUNTER_KEY = "gridsearch-ux-condition-counter";

function assignUxModeByAlternation() {
  var n = 0;
  try {
    n = parseInt(localStorage.getItem(UX_CONDITION_COUNTER_KEY) || "0", 10);
    if (isNaN(n)) n = 0;
  } catch (e) {
    n = 0;
  }
  uxMode = n % 2 === 0 ? "volcano_escape" : "bigger_reward";
  try {
    localStorage.setItem(UX_CONDITION_COUNTER_KEY, String(n + 1));
  } catch (e2) {}
  return uxMode;
}

var CONDITION_VIDEO_PATHS = {
  volcano_escape: "images/Volcano-Escape.mp4",
  bigger_reward: "images/Bigger-Reward.mp4",
};
var conditionIntroVideoCompleted = false;
var conditionVideoGateActive = false;
var conditionVideoMaxWatchedTime = 0;
var conditionIntroVideoBlobUrl = null;
var conditionIntroVideoHasStartedPlaying = false;
var conditionIntroVideoRelativePath = null;
var conditionIntroVideoUsingBlob = false;
var conditionIntroVideoSettleReady = null;
var CONDITION_VIDEO_LOAD_TIMEOUT_MS = 30000;

/** Same-origin relative paths for bundled www assets (WKWebView app://localhost). */
function resolveBundledAssetUrl(relativePath) {
  return relativePath;
}

function revokeConditionIntroVideoBlobUrl() {
  if (conditionIntroVideoBlobUrl) {
    try {
      URL.revokeObjectURL(conditionIntroVideoBlobUrl);
    } catch (e) {}
    conditionIntroVideoBlobUrl = null;
  }
  conditionIntroVideoUsingBlob = false;
}

function logConditionVideoError(video, context) {
  var parts = [context || "condition video error"];
  if (video && video.error) {
    parts.push("code=" + video.error.code);
    if (video.error.message) parts.push(video.error.message);
  }
  console.error(parts.join(" "));
}

function clearConditionIntroVideoElement(video) {
  if (!video) return;
  video.pause();
  var source = document.getElementById("conditionIntroVideoSource");
  if (source) source.removeAttribute("src");
  video.removeAttribute("src");
  video.load();
}

function setConditionIntroVideoSource(video, src) {
  if (!video || !src) return;
  var source = document.getElementById("conditionIntroVideoSource");
  video.removeAttribute("src");
  if (source) {
    source.src = src;
  } else {
    video.src = src;
  }
  video.load();
}

function fetchConditionVideoBlobUrl(relativePath, onDone) {
  if (typeof fetch !== "function") {
    onDone(null);
    return;
  }
  fetch(relativePath)
    .then(function (res) {
      if (!res.ok) throw new Error("fetch failed: " + res.status);
      return res.blob();
    })
    .then(function (blob) {
      onDone(URL.createObjectURL(blob));
    })
    .catch(function (err) {
      console.error("condition video blob fetch failed:", relativePath, err);
      onDone(null);
    });
}

function getConditionIntroVideoRelativePath() {
  return CONDITION_VIDEO_PATHS[uxMode] || CONDITION_VIDEO_PATHS.volcano_escape;
}

function getConditionIntroVideoSrc() {
  return resolveBundledAssetUrl(getConditionIntroVideoRelativePath());
}

function hideConditionVideoOverlays() {
  var start = document.getElementById("conditionVideoStartOverlay");
  var err = document.getElementById("conditionVideoErrorOverlay");
  if (start) start.style.display = "none";
  if (err) err.style.display = "none";
  hideConditionVideoFullscreenBtn();
}

function isConditionVideoFullscreen() {
  var video = document.getElementById("conditionIntroVideo");
  if (!video) return false;
  if (document.fullscreenElement === video) return true;
  if (video.webkitDisplayingFullscreen) return true;
  return false;
}

function hideConditionVideoFullscreenBtn() {
  var btn = document.getElementById("conditionVideoFullscreenBtn");
  if (btn) btn.style.display = "none";
}

function showConditionVideoFullscreenBtn() {
  if (!conditionVideoGateActive || !conditionIntroVideoHasStartedPlaying) return;
  if (isConditionVideoFullscreen()) return;
  var start = document.getElementById("conditionVideoStartOverlay");
  var err = document.getElementById("conditionVideoErrorOverlay");
  if (start && start.style.display === "flex") return;
  if (err && err.style.display === "flex") return;
  var btn = document.getElementById("conditionVideoFullscreenBtn");
  if (btn) btn.style.display = "block";
}

function enterConditionIntroVideoFullscreen() {
  var video = document.getElementById("conditionIntroVideo");
  if (!video || !conditionVideoGateActive) return;
  hideConditionVideoFullscreenBtn();
  if (typeof video.webkitEnterFullscreen === "function") {
    try {
      video.webkitEnterFullscreen();
    } catch (e) {
      console.warn("webkitEnterFullscreen failed:", e);
      showConditionVideoFullscreenBtn();
    }
    return;
  }
  var req = video.requestFullscreen || video.webkitRequestFullscreen;
  if (req) {
    req.call(video).catch(function () {
      showConditionVideoFullscreenBtn();
    });
  }
}

function setConditionVideoInlineWide(enabled) {
  document.body.classList.toggle("condition-video-inline-wide", !!enabled);
}

function updateConditionVideoFullscreenUi() {
  var inlineWide =
    conditionVideoGateActive &&
    conditionIntroVideoHasStartedPlaying &&
    !isConditionVideoFullscreen();
  setConditionVideoInlineWide(inlineWide);
  if (isConditionVideoFullscreen()) hideConditionVideoFullscreenBtn();
  else showConditionVideoFullscreenBtn();
}

function showConditionVideoStartOverlay() {
  var start = document.getElementById("conditionVideoStartOverlay");
  var err = document.getElementById("conditionVideoErrorOverlay");
  if (err) err.style.display = "none";
  if (start) start.style.display = "flex";
}

function showConditionVideoErrorOverlay(message) {
  var start = document.getElementById("conditionVideoStartOverlay");
  var err = document.getElementById("conditionVideoErrorOverlay");
  var msg = document.getElementById("conditionVideoErrorMessage");
  if (start) start.style.display = "none";
  if (msg) msg.textContent = message || "The instruction video could not be loaded.";
  if (err) err.style.display = "flex";
}

function resetConditionVideoWatchState() {
  conditionVideoMaxWatchedTime = 0;
  conditionIntroVideoHasStartedPlaying = false;
}

function stopConditionIntroVideo() {
  conditionVideoGateActive = false;
  conditionIntroVideoSettleReady = null;
  var page = document.getElementById("pageConditionVideo");
  var video = document.getElementById("conditionIntroVideo");
  hideConditionVideoOverlays();
  revokeConditionIntroVideoBlobUrl();
  if (video) clearConditionIntroVideoElement(video);
  conditionIntroVideoRelativePath = null;
  setConditionVideoInlineWide(false);
  if (page) page.style.display = "none";
}

function onConditionIntroVideoEnded() {
  var video = document.getElementById("conditionIntroVideo");
  if (!conditionVideoGateActive) return;
  if (!hasConditionIntroVideoFinishedNaturally(video)) {
    if (video) video.play().catch(function () {});
    return;
  }
  conditionVideoGateActive = false;
  conditionIntroVideoCompleted = true;
  stopConditionIntroVideo();
  showCompCheckPage(true);
}

function showConditionVideoLoadFailure() {
  showConditionVideoErrorOverlay(
    "The instruction video could not be loaded from this device. Check that the app was installed with its video files, then tap Try again."
  );
}

function retryConditionIntroVideoWithBlob(video, relativePath) {
  if (!conditionVideoGateActive || conditionIntroVideoUsingBlob) {
    showConditionVideoLoadFailure();
    return;
  }
  fetchConditionVideoBlobUrl(relativePath, function (blobUrl) {
    if (!conditionVideoGateActive) return;
    if (!blobUrl) {
      showConditionVideoLoadFailure();
      return;
    }
    revokeConditionIntroVideoBlobUrl();
    conditionIntroVideoBlobUrl = blobUrl;
    conditionIntroVideoUsingBlob = true;
    conditionIntroVideoHasStartedPlaying = false;
    setConditionIntroVideoSource(video, blobUrl);
    video.currentTime = 0;
    if (typeof conditionIntroVideoSettleReady === "function") {
      video.removeEventListener("loadeddata", conditionIntroVideoSettleReady);
      video.removeEventListener("canplay", conditionIntroVideoSettleReady);
      video.addEventListener("loadeddata", conditionIntroVideoSettleReady);
      video.addEventListener("canplay", conditionIntroVideoSettleReady);
    }
  });
}

function onConditionIntroVideoError(evt) {
  if (!conditionVideoGateActive) return;
  var video = evt && evt.currentTarget ? evt.currentTarget : document.getElementById("conditionIntroVideo");
  logConditionVideoError(video, "conditionIntroVideo error event");
  if (video) video.pause();
  if (!conditionIntroVideoUsingBlob && conditionIntroVideoRelativePath) {
    retryConditionIntroVideoWithBlob(video, conditionIntroVideoRelativePath);
    return;
  }
  showConditionVideoLoadFailure();
}

function onConditionIntroVideoTimeUpdate() {
  var video = document.getElementById("conditionIntroVideo");
  if (!video || !conditionVideoGateActive) return;
  if (video.currentTime > conditionVideoMaxWatchedTime + 0.35) {
    video.currentTime = conditionVideoMaxWatchedTime;
    return;
  }
  if (video.currentTime > conditionVideoMaxWatchedTime) {
    conditionVideoMaxWatchedTime = video.currentTime;
  }
}

function hasConditionIntroVideoFinishedNaturally(video) {
  if (!video) return false;
  if (!isFinite(video.duration) || video.duration <= 0) return false;
  return video.currentTime >= video.duration - 0.75;
}

function beginConditionIntroVideoPlayback() {
  var video = document.getElementById("conditionIntroVideo");
  if (!video || !conditionVideoGateActive) return;
  hideConditionVideoOverlays();
  var playPromise = video.play();
  if (playPromise && typeof playPromise.catch === "function") {
    playPromise.catch(function () {
      showConditionVideoStartOverlay();
    });
  }
}

function loadAndPlayConditionIntroVideo() {
  var page = document.getElementById("pageConditionVideo");
  var video = document.getElementById("conditionIntroVideo");
  if (!page || !video) {
    alert("Instruction video player is missing. Reinstall the app from a fresh build.");
    return;
  }

  conditionIntroVideoCompleted = false;
  conditionVideoGateActive = true;
  conditionIntroVideoUsingBlob = false;
  hideAllExperimentPages();
  hideConditionVideoOverlays();
  page.style.display = "block";
  resetConditionVideoWatchState();
  revokeConditionIntroVideoBlobUrl();
  clearConditionIntroVideoElement(video);

  var relativePath = getConditionIntroVideoRelativePath();
  conditionIntroVideoRelativePath = relativePath;
  var src = resolveBundledAssetUrl(relativePath);
  var loadSettled = false;
  var loadTimeoutId = null;

  var settleReady = function () {
    if (loadSettled || !conditionVideoGateActive) return;
    loadSettled = true;
    if (loadTimeoutId != null) {
      clearTimeout(loadTimeoutId);
      loadTimeoutId = null;
    }
    video.removeEventListener("loadeddata", settleReady);
    video.removeEventListener("canplay", settleReady);
    conditionIntroVideoSettleReady = null;
    beginConditionIntroVideoPlayback();
  };
  conditionIntroVideoSettleReady = settleReady;

  var onLoadTimeout = function () {
    if (loadSettled || !conditionVideoGateActive) return;
    logConditionVideoError(video, "condition video load timeout");
    if (!conditionIntroVideoUsingBlob) {
      retryConditionIntroVideoWithBlob(video, relativePath);
      loadTimeoutId = setTimeout(function () {
        if (!loadSettled && conditionVideoGateActive) showConditionVideoLoadFailure();
      }, CONDITION_VIDEO_LOAD_TIMEOUT_MS);
      return;
    }
    showConditionVideoLoadFailure();
  };

  video.removeEventListener("loadeddata", settleReady);
  video.removeEventListener("canplay", settleReady);
  video.addEventListener("loadeddata", settleReady);
  video.addEventListener("canplay", settleReady);

  loadTimeoutId = setTimeout(onLoadTimeout, CONDITION_VIDEO_LOAD_TIMEOUT_MS);

  setConditionIntroVideoSource(video, src);
  video.currentTime = 0;
}

function playConditionIntroVideo() {
  loadAndPlayConditionIntroVideo();
}

function preloadConditionIntroVideos() {
  if (typeof window !== "undefined" && window.cordova) return;
  var paths = [CONDITION_VIDEO_PATHS.volcano_escape, CONDITION_VIDEO_PATHS.bigger_reward];
  for (var i = 0; i < paths.length; i++) {
    var link = document.createElement("link");
    link.rel = "preload";
    link.as = "video";
    link.href = resolveBundledAssetUrl(paths[i]);
    document.head.appendChild(link);
  }
}

function verifyConditionIntroVideosAtBoot() {
  var paths = [CONDITION_VIDEO_PATHS.volcano_escape, CONDITION_VIDEO_PATHS.bigger_reward];
  if (typeof fetch !== "function") return;
  var pending = paths.length;
  var failed = [];
  for (var i = 0; i < paths.length; i++) {
    (function (path) {
      fetch(path, { method: "GET" })
        .then(function (res) {
          if (!res.ok) failed.push(path);
        })
        .catch(function () {
          failed.push(path);
        })
        .then(function () {
          pending -= 1;
          if (pending === 0 && failed.length > 0) {
            setAssetStatus(
              "Instruction videos missing from app bundle (" + failed.join(", ") + "). Reinstall from a fresh build.",
              true
            );
          }
        });
    })(paths[i]);
  }
}

function bindConditionIntroVideoHandlers() {
  var video = document.getElementById("conditionIntroVideo");
  if (!video || video.dataset.isrcBound === "1") return;
  video.dataset.isrcBound = "1";
  video.addEventListener("ended", onConditionIntroVideoEnded);
  video.addEventListener("error", onConditionIntroVideoError);
  video.addEventListener("timeupdate", onConditionIntroVideoTimeUpdate);
  video.addEventListener("seeking", onConditionIntroVideoTimeUpdate);
  video.addEventListener("playing", function () {
    conditionIntroVideoHasStartedPlaying = true;
    updateConditionVideoFullscreenUi();
  });
  video.addEventListener("webkitbeginfullscreen", hideConditionVideoFullscreenBtn);
  video.addEventListener("webkitendfullscreen", function () {
    if (!conditionVideoGateActive) return;
    updateConditionVideoFullscreenUi();
    if (!video.ended && video.paused) {
      var resume = video.play();
      if (resume && typeof resume.catch === "function") {
        resume.catch(function () {
          showConditionVideoStartOverlay();
        });
      }
    }
  });
  document.addEventListener("fullscreenchange", updateConditionVideoFullscreenUi);
  video.addEventListener(clickEventType, function () {
    if (!conditionVideoGateActive || !conditionIntroVideoHasStartedPlaying) return;
    if (isConditionVideoFullscreen()) return;
    var start = document.getElementById("conditionVideoStartOverlay");
    var err = document.getElementById("conditionVideoErrorOverlay");
    if (start && start.style.display === "flex") return;
    if (err && err.style.display === "flex") return;
    enterConditionIntroVideoFullscreen();
  });
  video.addEventListener("pause", function () {
    if (!conditionVideoGateActive || video.ended) return;
    if (!conditionIntroVideoHasStartedPlaying) return;
    if (hasConditionIntroVideoFinishedNaturally(video)) return;
    var resume = video.play();
    if (resume && typeof resume.catch === "function") {
      resume.catch(function () {
        showConditionVideoStartOverlay();
      });
    }
  });

  var startBtn = document.getElementById("conditionVideoStartBtn");
  if (startBtn) {
    startBtn.addEventListener(clickEventType, function () {
      beginConditionIntroVideoPlayback();
    });
  }
  var retryBtn = document.getElementById("conditionVideoRetryBtn");
  if (retryBtn) {
    retryBtn.addEventListener(clickEventType, function () {
      loadAndPlayConditionIntroVideo();
    });
  }
  var fullscreenBtn = document.getElementById("conditionVideoFullscreenBtn");
  if (fullscreenBtn) {
    fullscreenBtn.addEventListener(clickEventType, function (evt) {
      if (evt && evt.stopPropagation) evt.stopPropagation();
      enterConditionIntroVideoFullscreen();
    });
  }
}

function applyUxModeFromForm() {
  syncCollectedBoxToUxMode();
}

function resetTesterNotesForm() {
  var ids = ["option-a-included", "option-a-not-included"];
  for (var i = 0; i < ids.length; i++) {
    var el = document.getElementById(ids[i]);
    if (el) el.checked = false;
  }
  var notes = document.getElementById("tester-notes");
  if (notes) notes.value = "";
}

function syncCollectedBoxToUxMode() {
  var mainRow = document.getElementById("page5-main-row");
  var rightCol = document.getElementById("page5-right-column");
  var page5 = document.getElementById("page5");
  var ve = uxMode === "volcano_escape";
  if (mainRow) mainRow.classList.toggle("page5-main-row--volcano-escape", ve);
  if (rightCol) rightCol.classList.toggle("page5-right-column--volcano-escape", ve);
  if (page5) page5.classList.toggle("page5-game--volcano-escape", ve);
  document.body.classList.toggle("page5-volcano-escape-active", ve);
  if (uxMode === "bigger_reward") {
    setupBiggerRewardBox();
  } else {
    setupEscapePathBox();
  }
}

//EXPERIMENT PARAMETERS
var SCORED_ROUNDS = 6,
  fullurl = document.location.href, //url of incoming MTurk worker
  totalTrialsNumber = 1 + SCORED_ROUNDS, // practice round + scored rounds
  trials = totalTrialsNumber, //number of REMAINING trials
  trialCounter = -1, //counter for current trial number
  horizon = 15,
  tracker = new Array(0), //tracker array
  investigationIndex = -1, // increments before each logged click; first user tap -> 0 (no auto-reveal)
  scoretotal = [],
  scorecurrent = 0,
  reward = 0.0,
  gridMax = [],
  envOrder = getRandomSubarray(
    [
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
      21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39,
    ],
    totalTrialsNumber
  ),
  currentEnv = envOrder[0],
  environmentList = [],
  //Color parameters for heatmap (kept for compatibility; no longer used for circle color)
  colors = ["#fff7ec", "#fee8c8", "#fdd49e", "#fdbb84", "#fc8d59", "#ef6548", "#d7301f", "#b30000", "#7f0000"],
  heatmapColor =
    typeof d3 !== "undefined"
      ? d3.scale
          .linear()
          .domain(d3.range(0, 50, 50.0 / (colors.length - 1)))
          .range(colors)
      : null,
  testerNotes = {};

function resolveBoardWeights() {
  if (typeof boardWeights !== "undefined" && boardWeights && boardWeights.length === totalTrialsNumber) {
    return boardWeights.slice();
  }
  console.warn("boardWeights not loaded; using seeded fallback.");
  if (typeof KernelPrng !== "undefined" && KernelPrng.shuffleInPlace && KernelPrng.mulberry32) {
    return KernelPrng.shuffleInPlace(BOARD_WEIGHT_VALUES.slice(), KernelPrng.mulberry32(BOARD_WEIGHTS_SEED));
  }
  return [0.8, 0.85, 0.9, 0.875, 0.825, 0.75, 0.775];
}

function getBoardWeightForTrial(trialCounter) {
  return BOARD_WEIGHTS[trialCounter];
}

function buildBoardWeightByTrial() {
  return BOARD_WEIGHTS.slice();
}

var BOARD_WEIGHTS = resolveBoardWeights();
var boardWeightByTrial = buildBoardWeightByTrial();
var scale = boardWeightByTrial;

/** Second comprehension page: outcome per question. */
var rockQuizResponses = { q1: null, q2: null, q3: null, q1_why: null };
var rockQuizAttempts = { q1: 0, q2: 0, q3: 0 };

var ROCK_QUIZ_CORRECT = {
  q1: "rockQ1bigger",
  q2: "rockQ2yes",
  q3: "rockQ3yes",
};

function resetRockQuizState() {
  rockQuizResponses = { q1: null, q2: null, q3: null, q1_why: null };
  rockQuizAttempts = { q1: 0, q2: 0, q3: 0 };
  var ids = ["rockQ1bigger", "rockQ1smaller", "rockQ2yes", "rockQ2no", "rockQ3yes", "rockQ3no"];
  for (var i = 0; i < ids.length; i++) {
    var el = document.getElementById(ids[i]);
    if (el) el.checked = false;
  }
  var whyEl = document.getElementById("rockQ1Why");
  if (whyEl) {
    whyEl.value = "";
    resizeCompCheckWhyTextarea(whyEl);
  }
}

function resizeCompCheckWhyTextarea(el) {
  var ta = el || document.getElementById("rockQ1Why");
  if (!ta) return;
  ta.style.height = "auto";
  ta.style.height = Math.max(ta.scrollHeight, ta.offsetHeight) + "px";
}

function bindCompCheckWhyInput() {
  var whyEl = document.getElementById("rockQ1Why");
  if (!whyEl || whyEl.dataset.isrcBound === "1") return;
  whyEl.dataset.isrcBound = "1";
  whyEl.addEventListener("input", function () {
    resizeCompCheckWhyTextarea(whyEl);
  });
  whyEl.addEventListener("keydown", function (evt) {
    if (evt.key === " " || evt.keyCode === 32) {
      evt.stopPropagation();
    }
  });
  resizeCompCheckWhyTextarea(whyEl);
}

function getCheckedRockQuizId(name) {
  var picked = document.querySelector('input[name="' + name + '"]:checked');
  return picked ? picked.id : null;
}

function rockQuizAllFinalized() {
  return rockQuizResponses.q1 != null && rockQuizResponses.q2 != null && rockQuizResponses.q3 != null;
}

function checkRockQuizAnswers() {
  var keys = ["q1", "q2", "q3"];
  var names = { q1: "rockQ1", q2: "rockQ2", q3: "rockQ3" };
  var missing = false;

  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (rockQuizResponses[key] != null) continue;
    if (!getCheckedRockQuizId(names[key])) missing = true;
  }
  var whyEl = document.getElementById("rockQ1Why");
  if (!whyEl || !whyEl.value.trim()) missing = true;
  if (missing) {
    alert("Please answer all questions.");
    return;
  }

  var anyRetry = false;
  for (var j = 0; j < keys.length; j++) {
    var qKey = keys[j];
    if (rockQuizResponses[qKey] != null) continue;

    rockQuizAttempts[qKey]++;
    var selectedId = getCheckedRockQuizId(names[qKey]);
    var isCorrect = selectedId === ROCK_QUIZ_CORRECT[qKey];

    if (isCorrect) {
      rockQuizResponses[qKey] =
        rockQuizAttempts[qKey] === 1 ? "correct_first_try" : "correct_second_try";
    } else if (rockQuizAttempts[qKey] >= 2) {
      rockQuizResponses[qKey] = "incorrect_second_try";
    } else {
      anyRetry = true;
    }
  }

  if (!rockQuizAllFinalized()) {
    alert("Some answers were incorrect. Please try again.");
    return;
  }

  rockQuizResponses.q1_why = whyEl.value.replace(/^\s+|\s+$/g, "");

  applyUxModeFromForm();
  clicks = 0;
  gridDeactivated = false;
  clickStart("page3", "page4");
}

/** Show comprehension check (page3) after the intro video has finished. */
function showCompCheckPage(videoGateBypass) {
  if (!videoGateBypass && !conditionIntroVideoCompleted) {
    playConditionIntroVideo();
    return;
  }
  resetRockQuizState();
  hideAllExperimentPages();
  var page3 = document.getElementById("page3");
  if (page3) page3.style.display = "block";
  document.body.classList.remove("game-play-active");
  document.body.classList.remove("page5finished-active");
  document.body.classList.remove("page5-volcano-escape-active");
  window.scrollTo(0, 0);
}

//data collectors for search history
var tscollect = [],
  xcollect = [],
  ycollect = [],
  yKernelCollect = [],
  zcollect = [],
  zcollectScaled = [],
  rockHeightPxCollect = [],
  initcollect = [],
  bonusCollect = { bonusCells: [], finalChosenCell: null };
/** Gift box mini-game after all grid rounds (click timestamps ms from game start). */
var giftboxCollect = { timestamps: [] };
var giftboxStartEpochMs = null;
var giftboxIntroTimeoutId = null;
var giftboxCelebrateTimeoutId = null;
var giftboxConfettiAnimId = null;
var giftboxConfettiParticles = null;
var GIFTBOX_INTRO_MS = 6000;
var GIFTBOX_CELEBRATE_MS = 5000;
var GIFTBOX_MAX_CLICKS = 300;
var FOLLOW_UP_ORDER_COUNTER_KEY_PREFIX = "gridsearch-follow-up-order-counter-";
var followUpGameAssignment = null;
var followUpSequence = [];
var followUpSequenceIndex = 0;
var likingQuestionsCollect = { responses: [] };
var likingQuestionsStepIndex = 0;
var likingQuestionsStepTimeoutId = null;
var likingQuestionsStartEpochMs = null;
var likingPendingResponse = null;
var LIKING_QUESTIONS_STEPS = [
  { type: "image", src: "images/likert_scale.png", stepId: "likert_intro" },
  { type: "image", src: "images/candy_liking.png", stepId: "candy_liking" },
  { type: "likert", src: "images/likert_scale.png", stepId: "likert_candy" },
  { type: "image", src: "images/candy_dirt_liking.png", stepId: "candy_dirt_liking" },
  { type: "likert", src: "images/likert_scale.png", stepId: "likert_candy_dirt" },
  { type: "image", src: "images/game_liking.png", stepId: "game_liking" },
  { type: "likert", src: "images/likert_scale.png", stepId: "likert_game" },
];
/** Epoch (ms) when trial 1 grid is shown; click timestamps are relative across the full session. */
var gridStartEpochMs = null;
/** Set when experimenter ends the grid session from the between-round screen. */
var endedSessionEarly = false;
var endedSessionEarlyAfterRound = null;
/** Scored boards completed when session ended early (practice = 0; rounds 1–N = 1–N). */
var endedSessionEarlyScoredBoards = null;
var MIN_SCORED_BOARDS_FOR_EARLY_END_GIFTBOX = 3;

/*
- x,y of the 5 randomly selected tiles
- mean judgements (slider value): 0 - 50
- confidence (radios) 1 - 7
- index of chosen tile among the five (and this last tile gets also played and added to xcollect, ycollect....)
 */

//Populate data collectors with empty arrays
for (var i = 0; i < totalTrialsNumber; i++) {
  scoretotal[i] = 0;
  gridMax[i] = 0;
  tscollect[i] = [];
  xcollect[i] = [];
  ycollect[i] = [];
  yKernelCollect[i] = [];
  zcollect[i] = [];
  zcollectScaled[i] = [];
  rockHeightPxCollect[i] = [];
  initcollect[i] = [];
}

// Set initial counters
if (localStorage.getItem("gridsearch-counter-1") === null) localStorage.setItem("gridsearch-counter-1", 0);
if (localStorage.getItem("gridsearch-counter-2") === null) localStorage.setItem("gridsearch-counter-2", 0);
if (localStorage.getItem("gridsearch-counter-3") === null) localStorage.setItem("gridsearch-counter-3", 0);

//Declare variables not yet assigned
var condition,
  gender,
  age = 0,
  initials,
  searchHistory,
  initialEnvs,
  changeEnvs,
  xout,
  yout,
  zout,
  optimaGuess,
  uxMode = "bigger_reward",
  conditionBeginning = null,
  conditionEnd = null;

/** "smooth" | "rough" | "random" — chosen on page 1; random is y-shuffled smooth per board (see buildKernelRandom.js + js/kernelPrng.js). */
var kernelMap = "random";
/** Always "full" — grid rounds then gift-box game. */
var sessionMode = "full";

function applySessionModeFromForm() {
  sessionMode = "full";
}

function applyKernelMapFromForm() {
  var rough = document.getElementById("kernelMapRough");
  var rnd = document.getElementById("kernelMapRandom");
  if (rough && rough.checked) {
    kernelMap = "rough";
  } else if (rnd && rnd.checked) {
    kernelMap = "random";
  } else {
    kernelMap = "smooth";
  }
  if (kernelMap === "rough") condition = 1;
  else if (kernelMap === "random") condition = 2;
  else condition = 0;
}

function resolveInitialKernelObject() {
  if (kernelMap === "rough" && typeof roughKernel !== "undefined") return roughKernel;
  if (kernelMap === "random" && typeof randomKernel !== "undefined") return randomKernel;
  if (kernelMap === "random" && typeof randomKernel === "undefined") {
    console.warn("randomKernel not loaded; using smoothKernel.");
  }
  if (typeof smoothKernel !== "undefined") return smoothKernel;
  console.error("Kernel data failed to load. Reinstall the app from a fresh Cordova build.");
  return {};
}

function assertOfflineAssetsReady() {
  if (typeof d3 === "undefined") {
    console.error("d3 failed to load from the app bundle.");
    return false;
  }
  if (typeof smoothKernel === "undefined" && typeof roughKernel === "undefined") {
    console.error("Kernel scripts failed to load from the app bundle.");
    return false;
  }
  return true;
}

//Access the MySQL database and returns scenario id with a condition numnber, adding the now() date time to the start time field and marking the specific scenario as completed
function assignScenario() {
  //Extract gender and age
  if (document.getElementById("Male").checked) gender = "Male";
  if (document.getElementById("Female").checked) gender = "Female";

  var agePicked = document.querySelector('input[name="demographics-age"]:checked');
  var ageValue = agePicked ? agePicked.value : "";
  initials = document.getElementById("initialsInput").value.trim();

  //Check if any data missing
  var checksum = typeof gender !== "undefined" && ageValue !== "" && initials !== "";
  if (checksum) {
    age = parseInt(ageValue, 10);

    if (!assertOfflineAssetsReady()) {
      alert("Game assets did not load. Please close the app and open it again. If this continues, reinstall from a fresh build.");
      return;
    }

    clicks = horizon; //set initial number of clicks to horizon

    assignUxModeByAlternation();
    conditionBeginning = uxMode;
    applyKernelMapFromForm();
    applySessionModeFromForm();

    var initialEnvsLocal = resolveInitialKernelObject();

    //put environments from the randomized envOrder into environmentList
    for (i = 0; i < totalTrialsNumber; i++) {
      environmentList[envOrder[i]] = initialEnvsLocal[envOrder[i]];
    }

    playConditionIntroVideo();
  } else {
    alert("Please fill in all required fields.");
  }
}

var init = [];

function applyPage5UxLayout() {
  applyUxModeFromForm();
  if (uxMode === "bigger_reward") {
    setupBiggerRewardBox();
  } else {
    setupEscapePathBox();
  }
}

/**
 * App bootstrap (called from isrcUtils after Cordova deviceready, or below in browser).
 */
var gridSearchBootstrapped = false;

function bootGridSearchAfterCordova() {
  if (gridSearchBootstrapped) return;
  gridSearchBootstrapped = true;

  setButtonHandlers();
  bindEndSessionEarlyButton();
  bindEndSessionEarlyChooserButtons();
  bindRestartButton();

  var homeStart = document.getElementById("btn-initial-form");
  if (homeStart && homeStart.dataset.isrcBound !== "1") {
    homeStart.addEventListener("click", function () {
      var uid = document.getElementById("uid-input");
      if (!uid || uid.value == null || uid.value === "") return;
      if (typeof clickStart === "function") clickStart("rt-start", "page1");
      else if (typeof isrcUtils !== "undefined" && typeof isrcUtils.InitialFormSubmit === "function") {
        isrcUtils.InitialFormSubmit();
      }
    });
  }

  var assignBtn = document.getElementById("buttonAssignScenario");
  if (assignBtn) assignBtn.addEventListener("click", assignScenario);

  loadSvgFromPath("images/volcano.svg", function (svgText) {
    if (!svgText || customVolcanoSvg) return;
    customVolcanoSvg = svgText;
    updateVolcanoAsset();
    setAssetStatus("Default volcano.svg loaded.", false);
  });
  loadSvgFromPath("images/rock.svg", function (svgText) {
    if (!svgText || customRockSvg) return;
    customRockSvg = cropSvgTextToVisibleBounds(svgText);
    setAssetStatus("Default volcano.svg and rock.svg loaded.", false);
  });

  var inlineVolcano = document.querySelector("#volcanoAssetContainer svg");
  if (inlineVolcano) fitSvgViewBoxToVisibleContent(inlineVolcano);

  ensureCollectedBoxSlots();
  preloadConditionIntroVideos();
  verifyConditionIntroVideosAtBoot();
  bindConditionIntroVideoHandlers();
  bindCompCheckWhyInput();
  bindLikingQuestionsHandlers();

  window.addEventListener("resize", function () {
    requestAnimationFrame(sizeGridToViewport);
  });
}

if (typeof window !== "undefined" && !window.cordova) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootGridSearchAfterCordova, false);
  } else {
    bootGridSearchAfterCordova();
  }
}

/**
 * Sets the button handlers
 */
function setButtonHandlers() {
  function bind(id, handler) {
    var el = document.getElementById(id);
    if (el) el.addEventListener(clickEventType, handler);
  }
  bind("goToPage7", function () { clickStart("page6", "page7"); });
  bind("finishButton", function () { onButtonFinishPressed(); });
  bind("nextTrialButton", function () {
    if (trialCounter >= totalTrialsNumber - 1 && clicks <= 0) {
      startFollowUpGame();
      return;
    }
    nexttrial();
  });
  bindEndSessionEarlyButton();
  bind("buttonGoToPageFive", function () {
    if (trialCounter < 0) {
      nexttrial();
    }
    clickStart("page4", "page5");
    applyPage5UxLayout();
  });
  bind("buttonInstructionsCheck", function () { checkRockQuizAnswers(); });
  bind("buttonGoToBonusLevel", function () { nextBonusLevelStep(); });
  bind("buttonNextBonus", function () { saveBonusStep(); });
  bind("buttonInstructions", function () { onButtonInstructionsPressed(); });
  bind("btnDownloadCsv", function () {
    onDownloadSessionCsv();
  });
  bind("giftboxStopBtn", function () {
    stopGiftboxGame();
  });
  bind("giftboxClickTarget", function () {
    onGiftboxClicked();
  });
  bindRestartButton();
}

function bindEndSessionEarlyButton() {
  var btn = document.getElementById("endSessionEarlyBtn");
  if (!btn || btn.dataset.endEarlyBound === "1") return;
  btn.dataset.endEarlyBound = "1";
  btn.addEventListener("click", function (evt) {
    if (evt) {
      evt.preventDefault();
      evt.stopPropagation();
    }
    onEndSessionEarlyPressed();
  });
}

function bindRestartButton() {
  var btn = document.getElementById("btn-app-restart");
  if (!btn || btn.dataset.restartBound === "1") return;
  btn.dataset.restartBound = "1";
  btn.addEventListener("click", function (evt) {
    if (typeof isrcUtils !== "undefined" && typeof isrcUtils.Restart === "function") {
      isrcUtils.Restart(evt);
    } else {
      restartApp(evt);
    }
  });
}

// Instructions status
var instructionsCounter = 0;
var gridDeactivated = true;

/**
 *  button Instructions event handler
 */
function onButtonInstructionsPressed() {
  var s3 = document.getElementById("sidebarInstructions-3");
  if (instructionsCounter == 0) {
    document.getElementById("sidebarInstructions-1").style.display = "none";
    document.getElementById("sidebarInstructions-2").style.display = "block";
    if (clicks > 0) gridDeactivated = false;
    instructionsCounter++;
  } else if (instructionsCounter == 1) {
    if (clicks > 0) {
      alert("Please use all " + horizon + " clicks to explore the map.");
      return;
    }
    gridDeactivated = true;
    document.getElementById("sidebarInstructions-2").style.display = "none";
    if (s3) {
      s3.style.display = "block";
      instructionsCounter++;
    } else {
      document.getElementById("sidebarInstructions").style.display = "none";
      document.getElementById("sidebarInstructions-1").style.display = "block";
    }
  } else if (instructionsCounter == 2) {
    document.getElementById("sidebarInstructions").style.display = "none";
    if (s3) s3.style.display = "none";
    document.getElementById("sidebarInstructions-1").style.display = "block";
  }
}

function onButtonFinishPressed() {
  var optionA = document.querySelector('input[name="option-a"]:checked');
  if (optionA == null) {
    return alert("Fill option A!");
  }

  var notes = document.getElementById("tester-notes").value;
  conditionEnd = uxMode;

  testerNotes = {
    "option-a": parseInt(optionA.value),
    notes: notes,
  };

  senddata();
}

function getRoundLabel(trialCounter) {
  if (trialCounter === 0) {
    return '<b>Practice Round</b><br><span class="text-s practice-round-note">This round does not count toward your score.</span>';
  }
  if (trialCounter === totalTrialsNumber - 1) return "Final Round";
  return "Round <b>" + trialCounter + "</b>";
}

/** Scored rounds left after the board just finished (practice finished -> SCORED_ROUNDS). */
function getRemainingRoundsAfterCurrentBoard() {
  return Math.max(0, totalTrialsNumber - 1 - trialCounter);
}

function syncTrialsRemainingCounter() {
  trials = getRemainingRoundsAfterCurrentBoard();
}

function resetNextTrialButtonHandler() {
  var nextBtn = document.getElementById("nextTrialButton");
  if (nextBtn) nextBtn.onclick = null;
}

/** Progress bar shows clicks *remaining*; label shows the number (no separate grid counter). */
function updateRoundProgressUI() {
  var fill = document.getElementById("roundProgressFill");
  var label = document.getElementById("roundProgressLabel");
  var h = typeof horizon !== "undefined" ? horizon : 15;
  var cl = typeof clicks !== "undefined" ? clicks : 0;
  cl = Math.max(0, Math.min(h, cl));
  var pct = h <= 0 ? 0 : (cl / h) * 100;
  if (fill) fill.style.height = pct + "%";
  if (label) label.textContent = String(cl);
}

function setGridClickLimitOverlayVisible(show) {
  var gridContainer = document.getElementById("gridDiv");
  if (!gridContainer) return;
  if (show) gridContainer.classList.add("grid-click-limit-reached");
  else gridContainer.classList.remove("grid-click-limit-reached");
}

function page5IsDisplayed() {
  var page = document.getElementById("page5");
  if (!page) return false;
  if (page.style.display === "none") return false;
  try {
    return window.getComputedStyle(page).display !== "none";
  } catch (e) {
    return true;
  }
}

/** Ensure 8x8 grid is always fully visible and each cell is a perfect square. */
function sizeGridToViewport() {
  var page = document.getElementById("page5");
  var gridContainer = document.getElementById("gridDiv");
  var table = document.getElementById("grid");
  if (!page || !gridContainer || !table || !page5IsDisplayed()) return;

  var containerRect = gridContainer.getBoundingClientRect();
  var row = document.getElementById("page5-main-row");
  var rowRect = row ? row.getBoundingClientRect() : containerRect;

  var availableW = Math.max(120, Math.floor(containerRect.width - 10));
  var availableH = Math.max(120, Math.floor(rowRect.height - 10));
  var side = Math.max(120, Math.min(availableW, availableH));
  var cell = Math.floor(side / 8);
  side = cell * 8;

  table.style.width = side + "px";
  table.style.height = side + "px";
  table.style.tableLayout = "fixed";

  var rows = table.querySelectorAll("tr");
  for (var r = 0; r < rows.length; r++) {
    rows[r].style.height = cell + "px";
    rows[r].style.maxHeight = cell + "px";
  }

  var tds = table.querySelectorAll("td");
  for (var i = 0; i < tds.length; i++) {
    tds[i].style.width = cell + "px";
    tds[i].style.height = cell + "px";
    tds[i].style.minWidth = cell + "px";
    tds[i].style.minHeight = cell + "px";
    tds[i].style.maxWidth = cell + "px";
    tds[i].style.maxHeight = cell + "px";
  }

  try {
    document.documentElement.style.setProperty("--grid-cell-px", cell + "px");
  } catch (e) {}
}

/**
 * Creates the grid in the DOM
 */
function createGrid() {
  var WIDTH = 8,
    HEIGHT = 8;

  var table = document.createElement("table");
  table.setAttribute("id", "grid");
  table.setAttribute("class", "grid");

  for (var y = 0; y < HEIGHT; y++) {
    var tr = document.createElement("tr");
    for (var x = 0; x < WIDTH; x++) {
      var td = document.createElement("td");
      td.setAttribute("data-x", x);
      td.setAttribute("data-y", y);
      td.addEventListener(clickEventType, onCellTappedHandler);

      // SVG rock.
      // IMPORTANT: do NOT overwrite td.innerHTML elsewhere; update rock size only.
      td.innerHTML = buildRockSvgMarkup(0);

      tr.appendChild(td);
    }
    table.appendChild(tr);
  }

  var gridContainer = document.getElementById("gridDiv");
  gridContainer.innerHTML = "";
  gridContainer.appendChild(table);
  requestAnimationFrame(sizeGridToViewport);
  updateRoundProgressUI();
}

/**
 *  onCellTappedHandler()
 */
function onCellTappedHandler(evt) {
  // Robustly resolve the parent <td> for taps on nested SVG elements.
  var td = evt.target;
  if (td && td.closest) {
    td = td.closest("td");
  } else {
    while (td && td.tagName !== "TD") td = td.parentNode;
  }
  if (!td || !td.getAttribute) return;

  var x = td.getAttribute("data-x");
  var y = td.getAttribute("data-y");
  var cell = Cell.getCell(x, y);

  if (playingBonusRound) return onBonusCellTapped(cell);
  return onCellTapped(cell);
}

function countCollectedRocksInBox(box) {
  if (!box) return 0;
  return box.querySelectorAll(".scatter-rock, .escape-path-rock").length;
}

function showRoundRockShowcaseThen(onDone) {
  var page = document.getElementById("page5");
  var srcBox = document.getElementById("collectedBox");
  if (!page || !srcBox || countCollectedRocksInBox(srcBox) === 0) {
    if (typeof onDone === "function") onDone();
    return;
  }

  // Do not call applyUxModeFromForm() here — it clears collectedBox via setupBiggerRewardBox/setupEscapePathBox.
  var isBiggerReward =
    srcBox.classList.contains("collected-box--bigger-reward") ||
    (typeof uxMode !== "undefined" && uxMode === "bigger_reward");

  var overlay = document.createElement("div");
  overlay.className = "round-rock-showcase";

  var panel = document.createElement("div");
  panel.className =
    "round-rock-showcase__panel" +
    (isBiggerReward ? " round-rock-showcase__panel--bigger-reward" : " round-rock-showcase__panel--volcano-escape");

  var title = document.createElement("div");
  title.className = "round-rock-showcase__title";
  title.textContent = "Rocks collected this round";

  var built = buildShowcaseCollectedBox(srcBox);
  var showcaseBox = built.box;
  showcaseBox.style.maxHeight = "40vh";
  showcaseBox.style.minHeight = "140px";
  showcaseBox.style.overflowY = "auto";

  panel.appendChild(title);
  panel.appendChild(showcaseBox);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  requestAnimationFrame(function () {
    if (built.mode === "bigger_reward") {
      rebuildScatterRocksInShowcaseBox(showcaseBox, srcBox);
    }
    overlay.classList.add("is-visible");
  });

  setTimeout(function () {
    // Navigate first so the grid never flashes between showcase and text screen.
    if (typeof onDone === "function") onDone();
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }, ROUND_ROCK_SHOWCASE_MS);
}

function showEndSessionEarlyChooser() {
  var el = document.getElementById("endSessionEarlyChooser");
  if (!el) return;
  el.style.display = "flex";
  el.setAttribute("aria-hidden", "false");
  el.classList.add("is-visible");
}

function hideEndSessionEarlyChooser() {
  var el = document.getElementById("endSessionEarlyChooser");
  if (!el) return;
  el.classList.remove("is-visible");
  el.style.display = "none";
  el.setAttribute("aria-hidden", "true");
}

function recordSessionEndedEarly() {
  endedSessionEarly = true;
  endedSessionEarlyAfterRound = trialCounter;
  endedSessionEarlyScoredBoards = getScoredBoardsCompleted();
  trials = -1;
}

function applyEarlyEndSessionChoice(choice) {
  hideEndSessionEarlyChooser();
  if (choice === "return") return;

  document.body.classList.remove("page5finished-active");
  recordSessionEndedEarly();

  if (choice === "complete") {
    goToTesterNotesScreen();
  } else if (choice === "giftbox") {
    startFollowUpGame();
  }
}

function getScoredBoardsCompleted() {
  return Math.max(0, trialCounter);
}

function goToTesterNotesScreen() {
  if (giftboxIntroTimeoutId != null) {
    window.clearTimeout(giftboxIntroTimeoutId);
    giftboxIntroTimeoutId = null;
  }
  resetGiftboxClickTarget();
  stopLikingQuestionsGame();
  hideEndSessionEarlyChooser();
  hideAllExperimentPages();
  var page7 = document.getElementById("page7");
  if (page7) page7.style.display = "block";
  document.body.classList.remove("game-play-active");
  document.body.classList.remove("page5-volcano-escape-active");
  document.body.classList.remove("giftbox-game-active");
  document.body.classList.remove("liking-questions-active");
  window.scrollTo(0, 0);
}

function onEndSessionEarlyPressed() {
  showEndSessionEarlyChooser();
}

function bindEndSessionEarlyChooserButtons() {
  function bind(id, choice) {
    var btn = document.getElementById(id);
    if (!btn || btn.dataset.earlyChooserBound === "1") return;
    btn.dataset.earlyChooserBound = "1";
    btn.addEventListener("click", function (evt) {
      if (evt) {
        evt.preventDefault();
        evt.stopPropagation();
      }
      applyEarlyEndSessionChoice(choice);
    });
  }
  bind("endSessionEarlyCompleteBtn", "complete");
  bind("endSessionEarlyGiftboxBtn", "giftbox");
  bind("endSessionEarlyReturnBtn", "return");
}

function getBetweenRoundsCompletionHtml(remaining) {
  var conditionLine;
  if (uxMode === "bigger_reward") {
    conditionLine =
      "I wonder how big the rocks you'll get this time are, and what sized prize you'll get in the end.";
  } else {
    conditionLine =
      "I wonder how big the rocks you'll get this time are, and how far you'll get away from the volcano.";
  }
  var mapsLeftLine;
  if (remaining === 1) {
    mapsLeftLine = "There is <b>1</b> more map to play.";
  } else {
    mapsLeftLine = "There are <b>" + remaining + "</b> more maps to play.";
  }
  return (
    '<br><br><br><br><h1 class="text-xl">Great job! Time for a new map.</h1>' +
    '<p class="text-l">' +
    conditionLine +
    "</p>" +
    '<p class="text-l">' +
    mapsLeftLine +
    "</p><br><br><br>"
  );
}

function runPage5EndOfBoardUI() {
  showRoundRockShowcaseThen(function () {
    clickStart("page5", "page5finished");
    document.body.classList.add("page5finished-active");
    syncTrialsRemainingCounter();

    var remaining = getRemainingRoundsAfterCurrentBoard();
    var completionDiv;
    if (trialCounter === 0) {
      completionDiv =
        '<br><br><br><br><h1 class="text-xl">You finished the <b>practice round</b>.</h1>' +
        '<p class="text-l">Ready to start the game? There are <b>' +
        SCORED_ROUNDS +
        "</b> rounds to play.</p><br><br><br>";
    } else if (remaining === 0) {
      completionDiv =
        '<br><br><br><br><h1 class="text-xl">You finished the final round.</h1><br><br><br>';
    } else {
      completionDiv = getBetweenRoundsCompletionHtml(remaining);
    }
    change("trials", completionDiv);
    setGridClickLimitOverlayVisible(clicks <= 0);

    if (trialCounter >= totalTrialsNumber - 1 && clicks <= 0) {
      GameOverScore = finalPerformance(scoretotal);
      var thankDiv = '<h1 class="text-xl">Great job! Thank you for playing.</h1>';
      change("thanksforcompleting", thankDiv);
    }
  });
}

/**
 *  onCellTapped()
 */
function onCellTapped(cell) {
  if (cell == null || gridDeactivated) return;
  if (clicks <= 0) return;

  // As soon as we start the final allowed tap, block further input (even while the last rock
  // is still flying and the next-round slide is deferred).
  var isLastClickOfRound = clicks === 1;
  if (isLastClickOfRound) {
    gridDeactivated = true;
    setGridClickLimitOverlayVisible(true);
  } else {
    // Keep cadence predictable: one tap per fly duration.
    gridDeactivated = true;
    if (clickDelayTimer) clearTimeout(clickDelayTimer);
    clickDelayTimer = setTimeout(function () {
      clickDelayTimer = null;
      if (clicks > 0 && !playingBonusRound && page5IsDisplayed()) {
        gridDeactivated = false;
      }
    }, FLY_ROCK_MS);
  }

  // normal click -> animate to collected box; defer round end UI to fly completion on last click
  cell.clicked(true, isLastClickOfRound ? runPage5EndOfBoardUI : undefined);

  // update counters
  currentEnvNum = envOrder[trialCounter];
  investigationIndex = investigationIndex + 1;
  tracker[investigationIndex] = cell.x + "x" + cell.y;

  //update number of clicks left
  clicks = clicks - 1;
  updateRoundProgressUI();

  //Update maximum reward found
  if (cell.rewardValue > gridMax[trialCounter]) {
    gridMax[trialCounter] = cell.rewardValue;
  }

  //keep track of tapped cell
  var d = new Date();
  if (gridStartEpochMs == null) gridStartEpochMs = d.getTime();
  tscollect[trialCounter][investigationIndex] = Math.max(0, d.getTime() - gridStartEpochMs);
  xcollect[trialCounter][investigationIndex] = cell.x;
  ycollect[trialCounter][investigationIndex] = cell.y;
  yKernelCollect[trialCounter][investigationIndex] = cell.kernelY;
  zcollect[trialCounter][investigationIndex] = cell.rewardValue;
  zcollectScaled[trialCounter][investigationIndex] = cell.baseRewardValue;
  rockHeightPxCollect[trialCounter][investigationIndex] = getGridRockInkHeightPx(cell.rewardValue);

  // update score
  scorecurrent = cell.rewardValue;
  scoretotal[trialCounter] = scoretotal[trialCounter] + scorecurrent;
  reward = rewardCum(scoretotal);

  // last click: grid was already disabled at handler start; keep enabled through click 2..(horizon-1) only

}

////////////////////////////////////////
// BONUS LEVEL
////////////////////////////////////////
var bonusLevelStep = 0;
var bonusCells = [];
var currentBonusCell = null;
var playingBonusRound = false;
var sliderMoved = false;
var confidenceSliderMoved = false;

function nextBonusLevelStep() {
  // bonus level init
  if (bonusLevelStep == 0) {
    playingBonusRound = true;
    bonusCells = Cell.getRandomCells(5);
    document.getElementById("gridDiv").style.display = "block";
    setGridClickLimitOverlayVisible(false);
    document.getElementById("alertGridDiv").style.display = "none";
    document.getElementById("bonusProgress").style.display = "block";
  }

  sliderMoved = false;
  confidenceSliderMoved = false;

  currentBonusCell = bonusCells[bonusLevelStep];
  currentBonusCell.getTd().classList.toggle("border-blink");
}

function saveBonusStep() {
  var confidenceSlider = document.getElementById("confidenceSlider");
  var sicherValue = confidenceSlider != null ? confidenceSlider.value : null;

  var range = document.getElementById("valueSlider");
  var rangeValue = range != null ? range.value : null;

  if (sicherValue == null || !sliderMoved || !confidenceSliderMoved) {
    alert("Please set both sliders.");
    return;
  }

  // clear previous bonus cell
  if (currentBonusCell != null) {
    currentBonusCell.clearTempValue();
    currentBonusCell.getTd().classList.toggle("border-blink");
    currentBonusCell.getTd().classList.toggle("border-dashed");
  }

  bonusCollect.bonusCells[bonusLevelStep] = {
    x: currentBonusCell.x,
    y: currentBonusCell.y,
    givenValue: parseInt(rangeValue),
    howSecure: parseInt(sicherValue),
  };

  document.getElementById("bonusRemainingCounter").innerHTML = 5 - (bonusLevelStep + 1);

  confidenceSlider.value = 5;
  range.value = 25;

  bonusLevelStep++;

  if (bonusLevelStep == 5) return saveBonusLevel();
  nextBonusLevelStep();
}

function saveBonusLevel() {
  currentBonusCell = null;
  document.getElementById("bonusInstructions2").style.display = "block";
  document.getElementById("bonusInstructions").style.display = "none";
}

function chooseBonusCellToPlay() {
  for (var i = 0; i < bonusCells.length; i++) {
    bonusCells[i].getTd().classList.toggle("border-dashed");
  }
}

function onBonusCellTapped(cell) {
  if (bonusCells.indexOf(cell) == -1 || bonusLevelStep <= 4) return;

  var r = confirm("Are you sure?");
  if (!r) return;

  document.getElementById("bonusSidebarInstructions").style.display = "none";
  document.getElementById("bonusSidebarInstructions2").style.display = "block";

  playingBonusRound = false;
  for (var i = 0; i < bonusCells.length; i++) {
    bonusCells[i].getTd().classList.toggle("border-dashed");
  }

  bonusCollect.finalChosenCell = {
    x: cell.x,
    y: cell.y,
    scaledValue: cell.scaledValue,
  };

  onCellTapped(cell);

  document.getElementById("gridDiv").style.display = "block";
  document.getElementById("bonusProgress").style.display = "none";
  document.getElementById("progress").style.display = "block";
}

function onValueSliderChange(value) {
  if (currentBonusCell != null) currentBonusCell.setTempValue(value);
  sliderMoved = true;
}

function onConfidenceSliderChange() {
  confidenceSliderMoved = true;
}

////////////////////////////////////////
// Cell class
////////////////////////////////////////
function Cell(x, y, kernelY, boardWeight) {
  this.x = x;
  this.y = y;
  this.kernelY = kernelY;
  this.boardWeight = boardWeight == null ? 1 : boardWeight;
  this.baseRewardValue = rewardValueFromKernelY(kernelY, 1);
  this.rewardValue = rewardValueFromKernelY(kernelY, this.boardWeight);
  this.scaledValue = this.baseRewardValue;
  this.history = [];

  this.getTd = function () {
    var cells = document.querySelectorAll('td[data-x="' + this.x + '"][data-y="' + this.y + '"]');
    if (cells.length > 0) return cells[0];
    return null;
  };

  this.getRockWrap = function () {
    var td = this.getTd();
    return td ? td.querySelector(".cell-rock-wrap") : null;
  };

  this.addToHistory = function (value) {
    this.history.push(value);
    if (this.getTd()) this.getTd().setAttribute("title", this.history.toString());
  };

  this.hasHistory = function () {
    return this.history.length > 0;
  };

  // Update visual rendering: ONLY size changes with value; style stays rock-like.
  this.renderValue = function (valueToRender, updateTitle) {
    var td = this.getTd();
    var rockWrap = this.getRockWrap();

    if (rockWrap) {
      var s = rockScaleForValue(valueToRender);
      rockWrap.setAttribute("transform", "translate(50 50) scale(" + s + ") translate(-50 -50)");
    } else if (td) {
      var svg = td.querySelector(".cell-svg");
      if (svg) {
        var svgScale = rockScaleForValue(valueToRender);
        svg.style.transformOrigin = "50% 50%";
        svg.style.transformBox = "fill-box";
        svg.style.transform = "scale(" + svgScale + ")";
      }
    }

    if (td && updateTitle) {
      td.setAttribute("title", valueToRender.toString());
    }
  };

  // shouldCollect: if true, animate this circle into the collectedBox.
  // onAfterCollect: runs after the rock lands in the box (fly transition + DOM add).
  this.clicked = function (shouldCollect, onAfterCollect) {
    if (typeof shouldCollect === "undefined") shouldCollect = true;

    var td = this.getTd();
    if (!td) return;

    this.renderValue(this.rewardValue, true);
    this.addToHistory(this.rewardValue);

    // Animate into collected box only for actual user clicks (not auto-reveal)
    if (shouldCollect) {
      animateCircleToCollectedBox(this.rewardValue, td, onAfterCollect);
    } else if (typeof onAfterCollect === "function") {
      onAfterCollect();
    }

    td.classList.toggle("highlight");
    setTimeout(function () {
      td.classList.toggle("highlight");
    }, 300);
  };

  // Bonus UI: show guessed value as rock size.
  this.setTempValue = function (value) {
    var v = parseInt(value);
    if (isNaN(v)) return;
    this.renderValue(v, false);
  };

  this.clearTempValue = function () {
    var rockWrap = this.getRockWrap();
    if (rockWrap) {
      rockWrap.setAttribute("transform", "translate(50 50) scale(0.001) translate(-50 -50)");
    } else {
      var td2 = this.getTd();
      if (td2) {
        var svg = td2.querySelector(".cell-svg");
        if (svg) svg.style.transform = "scale(0.001)";
      }
    }
  };

  /**
   * Static properties and methods
   */
  Cell.updateEnvironment = function () {
    Cell.cells = [];
    for (i = 0; i < 8; i++) {
      Cell.cells[i] = [];
    }
    console.log("trialCounter in updateEnvironment() is: " + trialCounter);
    var env = environmentList[envOrder[trialCounter]];
    var boardWeight = getBoardWeightForTrial(trialCounter);
    for (var k = 0; k <= 63; k++) {
      var x = env[k].x1;
      var y = env[k].x2;
      var cell = new Cell(x, y, env[k].y, boardWeight);
      Cell.cells[x][y] = cell;
    }
  };

  Cell.getCell = function (x, y) {
    return Cell.cells[x][y];
  };

  Cell.getRandomCell = function () {
    var x = Math.floor(Math.random() * Cell.cells.length);
    var y = Math.floor(Math.random() * Cell.cells[x].length);
    return Cell.getCell(x, y);
  };

  Cell.getRandomCells = function (n) {
    var randomCells = [];
    for (var i = 0; i < n; i++) {
      var found = false;
      while (!found) {
        var cell = this.getRandomCell();
        if (!cell.hasHistory() && randomCells.indexOf(cell) == -1) {
          randomCells.push(cell);
          found = true;
        }
      }
    }
    return randomCells;
  };
}
new Cell();

function nexttrial() {
  console.log("nexttrial called");

  if (trialCounter >= totalTrialsNumber - 1) {
    startFollowUpGame();
    return;
  }

  trialCounter = trialCounter + 1;
  syncTrialsRemainingCounter();
  console.log("[Debug] You have now " + trials + " remaining trials");

  // Keep grid active when a board starts so taps always work.
  gridDeactivated = false;
  setGridClickLimitOverlayVisible(false);
  initcollect[trialCounter] = init;

  if (trialCounter > 0) resetCollectedVisualForNewTrial();
  if (trialCounter === 0 && gridStartEpochMs == null) gridStartEpochMs = Date.now();

  clicks = horizon;

  createGrid();
  Cell.updateEnvironment();

  // All squares start covered; first logged click is the player's first tap (index 0).
  investigationIndex = -1;
  gridMax[trialCounter] = 0;
  scoretotal[trialCounter] = 0;

  document.body.classList.remove("page5finished-active");
  clickStart("page5finished", "page5");

  change("remaining1", getRoundLabel(trialCounter));
  updateRoundProgressUI();

  if (trialCounter === 0) {
    var sb = document.getElementById("sidebarInstructions");
    var sb1 = document.getElementById("sidebarInstructions-1");
    var sb2 = document.getElementById("sidebarInstructions-2");
    if (sb) sb.style.display = "block";
    if (sb1) sb1.style.display = "block";
    if (sb2) sb2.style.display = "none";
    instructionsCounter = 0;
  } else {
    var sbHide = document.getElementById("sidebarInstructions");
    if (sbHide) sbHide.style.display = "none";
  }
}

function resetGiftboxClickTarget() {
  var target = document.getElementById("giftboxClickTarget");
  if (!target) return;
  target.classList.remove(
    "giftbox-jiggle",
    "giftbox-click-target--intro",
    "giftbox-click-target--locked",
    "giftbox-click-target--ready"
  );
}

function finishGiftboxIntro() {
  giftboxIntroTimeoutId = null;
  var target = document.getElementById("giftboxClickTarget");
  if (!target) return;
  target.classList.remove("giftbox-click-target--intro", "giftbox-click-target--locked");
  target.classList.add("giftbox-click-target--ready");
  giftboxStartEpochMs = Date.now();
}

function startGiftboxGame() {
  if (giftboxIntroTimeoutId != null) {
    window.clearTimeout(giftboxIntroTimeoutId);
    giftboxIntroTimeoutId = null;
  }
  hideEndSessionEarlyChooser();

  giftboxCollect = { timestamps: [] };
  giftboxStartEpochMs = null;

  var p5 = document.getElementById("page5");
  var p5f = document.getElementById("page5finished");
  var pg = document.getElementById("pageGiftbox");
  if (p5) p5.style.display = "none";
  if (p5f) p5f.style.display = "none";
  if (pg) pg.style.display = "block";

  resetGiftboxClickTarget();
  var target = document.getElementById("giftboxClickTarget");
  if (target) {
    target.classList.add("giftbox-click-target--intro", "giftbox-click-target--locked");
    void target.offsetWidth;
    giftboxIntroTimeoutId = window.setTimeout(finishGiftboxIntro, GIFTBOX_INTRO_MS);
  }

  document.body.classList.remove("game-play-active");
  document.body.classList.remove("page5-volcano-escape-active");
  document.body.classList.remove("page5finished-active");
  document.body.classList.add("giftbox-game-active");
  window.scrollTo(0, 0);
}

function resizeGiftboxConfettiCanvas(canvas) {
  if (!canvas) return;
  var w = window.innerWidth || document.documentElement.clientWidth || 320;
  var h = window.innerHeight || document.documentElement.clientHeight || 480;
  canvas.width = w;
  canvas.height = h;
}

function stopGiftboxConfetti() {
  if (giftboxConfettiAnimId != null) {
    window.cancelAnimationFrame(giftboxConfettiAnimId);
    giftboxConfettiAnimId = null;
  }
  giftboxConfettiParticles = null;
  var canvas = document.getElementById("giftboxConfettiCanvas");
  if (canvas) {
    var ctx = canvas.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

function startGiftboxConfetti() {
  var canvas = document.getElementById("giftboxConfettiCanvas");
  if (!canvas) return;
  var ctx = canvas.getContext("2d");
  if (!ctx) return;

  stopGiftboxConfetti();
  resizeGiftboxConfettiCanvas(canvas);

  var colors = ["#ff8c14", "#ff9f40", "#ff5a00", "#ffb366", "#cc6600", "#ffa64d"];
  var particles = [];
  var i;
  var count = Math.max(70, Math.floor((canvas.width * canvas.height) / 12000));
  for (i = 0; i < count; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height - canvas.height,
      w: 8 + Math.random() * 12,
      h: 5 + Math.random() * 10,
      vy: 1.8 + Math.random() * 3.8,
      vx: -1.2 + Math.random() * 2.4,
      rot: Math.random() * Math.PI * 2,
      vr: -0.12 + Math.random() * 0.24,
      color: colors[Math.floor(Math.random() * colors.length)],
    });
  }
  giftboxConfettiParticles = particles;

  function frame() {
    if (!giftboxConfettiParticles) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (i = 0; i < giftboxConfettiParticles.length; i++) {
      var p = giftboxConfettiParticles[i];
      p.y += p.vy;
      p.x += p.vx;
      p.rot += p.vr;
      if (p.y > canvas.height + 24) {
        p.y = -16 - Math.random() * canvas.height * 0.25;
        p.x = Math.random() * canvas.width;
      }
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    giftboxConfettiAnimId = window.requestAnimationFrame(frame);
  }

  frame();
}

function finishGiftboxCelebrateScreen() {
  if (giftboxCelebrateTimeoutId != null) {
    window.clearTimeout(giftboxCelebrateTimeoutId);
    giftboxCelebrateTimeoutId = null;
  }
  stopGiftboxConfetti();
  var celebrate = document.getElementById("pageGiftboxCelebrate");
  if (celebrate) celebrate.style.display = "none";
  document.body.classList.remove("giftbox-game-active");
  onFollowUpGameCompleted("giftbox");
}

function startGiftboxCelebrateScreen() {
  if (giftboxIntroTimeoutId != null) {
    window.clearTimeout(giftboxIntroTimeoutId);
    giftboxIntroTimeoutId = null;
  }
  if (giftboxCelebrateTimeoutId != null) {
    window.clearTimeout(giftboxCelebrateTimeoutId);
    giftboxCelebrateTimeoutId = null;
  }
  stopGiftboxConfetti();
  resetGiftboxClickTarget();

  var pg = document.getElementById("pageGiftbox");
  var celebrate = document.getElementById("pageGiftboxCelebrate");
  if (pg) pg.style.display = "none";
  if (celebrate) celebrate.style.display = "flex";

  document.body.classList.add("giftbox-game-active");
  window.scrollTo(0, 0);
  startGiftboxConfetti();

  giftboxCelebrateTimeoutId = window.setTimeout(finishGiftboxCelebrateScreen, GIFTBOX_CELEBRATE_MS);
}

function stopGiftboxGame() {
  startGiftboxCelebrateScreen();
}

function onGiftboxClicked() {
  var target = document.getElementById("giftboxClickTarget");
  if (!target || !target.classList.contains("giftbox-click-target--ready")) return;
  if (giftboxStartEpochMs == null) return;
  if (giftboxCollect.timestamps.length >= GIFTBOX_MAX_CLICKS) return;

  var ts = Math.max(0, Date.now() - giftboxStartEpochMs);
  giftboxCollect.timestamps.push(ts);
  target.classList.remove("giftbox-jiggle");
  void target.offsetWidth;
  target.classList.add("giftbox-jiggle");
  window.setTimeout(function () {
    target.classList.remove("giftbox-jiggle");
  }, 400);

  if (giftboxCollect.timestamps.length >= GIFTBOX_MAX_CLICKS) {
    stopGiftboxGame();
  }
}

function assignFollowUpOrderByCondition() {
  var condition = uxMode === "bigger_reward" ? "bigger_reward" : "volcano_escape";
  var key = FOLLOW_UP_ORDER_COUNTER_KEY_PREFIX + condition;
  var n = 0;
  try {
    n = parseInt(localStorage.getItem(key) || "0", 10);
    if (isNaN(n)) n = 0;
  } catch (e) {
    n = 0;
  }
  followUpGameAssignment = n % 2 === 0 ? "giftbox_then_liking" : "liking_then_giftbox";
  try {
    localStorage.setItem(key, String(n + 1));
  } catch (e2) {}
  followUpSequence =
    followUpGameAssignment === "giftbox_then_liking"
      ? ["giftbox", "liking_questions"]
      : ["liking_questions", "giftbox"];
  followUpSequenceIndex = 0;
  return followUpGameAssignment;
}

function startNextFollowUpInSequence() {
  if (!followUpSequence || followUpSequenceIndex >= followUpSequence.length) {
    finishAllFollowUpGames();
    return;
  }
  var game = followUpSequence[followUpSequenceIndex];
  if (game === "giftbox") {
    startGiftboxGame();
  } else {
    startLikingQuestionsGame();
  }
}

function onFollowUpGameCompleted(completedGame) {
  if (!followUpSequence || followUpSequence.length === 0) {
    finishAllFollowUpGames();
    return;
  }
  if (followUpSequence[followUpSequenceIndex] !== completedGame) {
    console.warn("Follow-up sequence mismatch:", followUpSequenceIndex, completedGame, followUpSequence);
  }
  followUpSequenceIndex += 1;
  if (followUpSequenceIndex >= followUpSequence.length) {
    finishAllFollowUpGames();
    return;
  }
  startNextFollowUpInSequence();
}

function finishAllFollowUpGames() {
  stopGiftboxConfetti();
  resetGiftboxClickTarget();
  clearLikingQuestionsStepTimeout();
  clearLikingPendingResponse();
  setLikingQuestionsLikertOverlayVisible(false);
  hideAllExperimentPages();
  document.body.classList.remove("giftbox-game-active");
  document.body.classList.remove("liking-questions-active");
  var page6 = document.getElementById("page6");
  if (page6) page6.style.display = "block";
  window.scrollTo(0, 0);
}

function startFollowUpGame() {
  assignFollowUpOrderByCondition();
  startNextFollowUpInSequence();
}

function clearLikingQuestionsStepTimeout() {
  if (likingQuestionsStepTimeoutId != null) {
    window.clearTimeout(likingQuestionsStepTimeoutId);
    likingQuestionsStepTimeoutId = null;
  }
}

function resetLikertFaceSelection() {
  var hits = document.querySelectorAll(".likert-face-hit");
  for (var i = 0; i < hits.length; i++) {
    hits[i].classList.remove("likert-face-hit--selected");
  }
}

function setLikingQuestionsLikertOverlayVisible(visible) {
  var overlay = document.getElementById("likertClickOverlay");
  if (!overlay) return;
  overlay.style.display = visible ? "block" : "none";
  overlay.setAttribute("aria-hidden", visible ? "false" : "true");
  if (!visible) resetLikertFaceSelection();
}

function setLikingQuestionsImageSrc(img, relativePath) {
  if (!img || !relativePath) return;
  var url = resolveBundledAssetUrl(relativePath);
  img.onerror = function () {
    console.error("Liking question image failed to load:", url);
  };
  var resolved = img.src;
  try {
    resolved = new URL(img.src, window.location.href).href;
  } catch (e) {}
  if (resolved === url || img.getAttribute("src") === url) {
    img.removeAttribute("src");
    void img.offsetWidth;
  }
  img.src = url;
}

function showLikingQuestionsPage() {
  var page = document.getElementById("pageLikingQuestions");
  if (page) page.style.display = "flex";
}

function getLikertChoiceDisplayLabel(label) {
  var labels = {
    really_like: "Really Like",
    like: "Like",
    okay: "Okay",
    dont_like: "Don't Like",
    really_dont_like: "Really Don't Like",
  };
  return labels[label] || label;
}

function hideLikertAnswerChooser() {
  var chooser = document.getElementById("likertAnswerChooser");
  if (!chooser) return;
  chooser.classList.remove("is-visible");
  chooser.style.display = "none";
  chooser.setAttribute("aria-hidden", "true");
}

function showLikertAnswerChooser(displayLabel) {
  var chooser = document.getElementById("likertAnswerChooser");
  var title = document.getElementById("likertAnswerChooserTitle");
  if (title) title.textContent = displayLabel || "";
  if (!chooser) return;
  chooser.style.display = "block";
  chooser.classList.add("is-visible");
  chooser.setAttribute("aria-hidden", "false");
}

function clearLikingPendingResponse() {
  likingPendingResponse = null;
  hideLikertAnswerChooser();
}

function getLikingResponseForStep(stepId) {
  var responses = likingQuestionsCollect.responses || [];
  for (var i = 0; i < responses.length; i++) {
    if (responses[i].stepId === stepId) return responses[i];
  }
  return null;
}

function hasLikingResponseForStep(stepId) {
  return getLikingResponseForStep(stepId) != null;
}

function removeLikingResponseForStepId(stepId) {
  var responses = likingQuestionsCollect.responses || [];
  var kept = [];
  for (var i = 0; i < responses.length; i++) {
    if (responses[i].stepId !== stepId) kept.push(responses[i]);
  }
  likingQuestionsCollect.responses = kept;
}

function restoreLikertFaceSelectionForStep(stepId) {
  resetLikertFaceSelection();
  var saved = getLikingResponseForStep(stepId);
  if (!saved) return;
  var hits = document.querySelectorAll(".likert-face-hit");
  for (var i = 0; i < hits.length; i++) {
    if (parseInt(hits[i].getAttribute("data-likert-value"), 10) === saved.value) {
      hits[i].classList.add("likert-face-hit--selected");
      break;
    }
  }
}

function updateLikingQuestionsNavButtons() {
  var backBtn = document.getElementById("likingQuestionsBackBtn");
  var nextBtn = document.getElementById("likingQuestionsNextBtn");
  var step = LIKING_QUESTIONS_STEPS[likingQuestionsStepIndex];

  if (backBtn) {
    backBtn.disabled = likingQuestionsStepIndex <= 0;
  }
  if (nextBtn) {
    if (!step) {
      nextBtn.disabled = false;
    } else if (step.type === "image") {
      nextBtn.disabled = false;
    } else if (step.type === "likert") {
      nextBtn.disabled = !hasLikingResponseForStep(step.stepId);
    } else {
      nextBtn.disabled = false;
    }
  }
}

function onLikingQuestionsBack() {
  if (likingQuestionsStepIndex <= 0) return;
  clearLikingPendingResponse();
  clearLikingQuestionsStepTimeout();

  var currentStep = LIKING_QUESTIONS_STEPS[likingQuestionsStepIndex];
  if (currentStep && currentStep.type === "likert") {
    removeLikingResponseForStepId(currentStep.stepId);
  }

  likingQuestionsStepIndex -= 1;
  runLikingQuestionsStep();
}

function onLikingQuestionsNext() {
  if (likingPendingResponse) return;
  var step = LIKING_QUESTIONS_STEPS[likingQuestionsStepIndex];
  if (step && step.type === "likert" && !hasLikingResponseForStep(step.stepId)) {
    return;
  }
  if (likingQuestionsStepIndex >= LIKING_QUESTIONS_STEPS.length - 1) {
    finishLikingQuestionsGame();
    return;
  }
  advanceLikingQuestionsStep();
}

function confirmLikingPendingResponse() {
  if (!likingPendingResponse) return;
  var step = LIKING_QUESTIONS_STEPS[likingQuestionsStepIndex];
  if (!step || step.type !== "likert") {
    clearLikingPendingResponse();
    return;
  }

  var ts =
    likingQuestionsStartEpochMs == null ? 0 : Math.max(0, Date.now() - likingQuestionsStartEpochMs);
  removeLikingResponseForStepId(step.stepId);
  likingQuestionsCollect.responses.push({
    stepId: step.stepId,
    value: likingPendingResponse.value,
    label: likingPendingResponse.label,
    timestamp_ms: ts,
  });

  clearLikingPendingResponse();
  advanceLikingQuestionsStep();
}

function onLikertAnswerChangePressed() {
  clearLikingPendingResponse();
  resetLikertFaceSelection();
  updateLikingQuestionsNavButtons();
}

function finishLikingQuestionsGame() {
  clearLikingQuestionsStepTimeout();
  clearLikingPendingResponse();
  setLikingQuestionsLikertOverlayVisible(false);
  var page = document.getElementById("pageLikingQuestions");
  if (page) page.style.display = "none";
  document.body.classList.remove("liking-questions-active");
  onFollowUpGameCompleted("liking_questions");
}

function advanceLikingQuestionsStep() {
  clearLikingQuestionsStepTimeout();
  likingQuestionsStepIndex += 1;
  if (likingQuestionsStepIndex >= LIKING_QUESTIONS_STEPS.length) {
    finishLikingQuestionsGame();
    return;
  }
  runLikingQuestionsStep();
}

function onLikertFaceClicked(evt) {
  if (likingPendingResponse) return;
  if (likingQuestionsStepIndex < 0 || likingQuestionsStepIndex >= LIKING_QUESTIONS_STEPS.length) return;
  var step = LIKING_QUESTIONS_STEPS[likingQuestionsStepIndex];
  if (!step || step.type !== "likert") return;
  var btn = evt.currentTarget;
  if (!btn) return;
  var value = parseInt(btn.getAttribute("data-likert-value"), 10);
  var label = btn.getAttribute("data-likert-label") || "";
  if (isNaN(value)) return;

  resetLikertFaceSelection();
  btn.classList.add("likert-face-hit--selected");

  likingPendingResponse = { value: value, label: label };
  showLikertAnswerChooser(getLikertChoiceDisplayLabel(label));
}

function runLikingQuestionsStep() {
  var step = LIKING_QUESTIONS_STEPS[likingQuestionsStepIndex];
  if (!step) {
    finishLikingQuestionsGame();
    return;
  }

  var img = document.getElementById("likingQuestionsImage");
  if (!img) {
    finishLikingQuestionsGame();
    return;
  }

  setLikingQuestionsImageSrc(img, step.src);
  if (step.type === "image") {
    setLikingQuestionsLikertOverlayVisible(false);
  } else if (step.type === "likert") {
    setLikingQuestionsLikertOverlayVisible(true);
    restoreLikertFaceSelectionForStep(step.stepId);
  }
  updateLikingQuestionsNavButtons();
}

function stopLikingQuestionsGame() {
  clearLikingQuestionsStepTimeout();
  clearLikingPendingResponse();
  setLikingQuestionsLikertOverlayVisible(false);
  var page = document.getElementById("pageLikingQuestions");
  if (page) page.style.display = "none";
  document.body.classList.remove("liking-questions-active");
}

function startLikingQuestionsGame() {
  if (giftboxIntroTimeoutId != null) {
    window.clearTimeout(giftboxIntroTimeoutId);
    giftboxIntroTimeoutId = null;
  }
  hideEndSessionEarlyChooser();

  likingQuestionsCollect = { responses: [] };
  likingQuestionsStepIndex = 0;
  likingQuestionsStartEpochMs = Date.now();
  clearLikingPendingResponse();
  clearLikingQuestionsStepTimeout();

  var p5 = document.getElementById("page5");
  var p5f = document.getElementById("page5finished");
  var pg = document.getElementById("pageGiftbox");
  var celebrate = document.getElementById("pageGiftboxCelebrate");
  if (p5) p5.style.display = "none";
  if (p5f) p5f.style.display = "none";
  if (pg) pg.style.display = "none";
  if (celebrate) celebrate.style.display = "none";
  showLikingQuestionsPage();

  document.body.classList.remove("game-play-active");
  document.body.classList.remove("page5-volcano-escape-active");
  document.body.classList.remove("page5finished-active");
  document.body.classList.remove("giftbox-game-active");
  document.body.classList.add("liking-questions-active");
  window.scrollTo(0, 0);

  runLikingQuestionsStep();
  updateLikingQuestionsNavButtons();
}

function bindLikingQuestionsHandlers() {
  var hits = document.querySelectorAll(".likert-face-hit");
  for (var i = 0; i < hits.length; i++) {
    if (hits[i].dataset.likingBound === "1") continue;
    hits[i].dataset.likingBound = "1";
    hits[i].addEventListener(clickEventType, onLikertFaceClicked);
  }

  var yesBtn = document.getElementById("likertAnswerYesBtn");
  if (yesBtn && yesBtn.dataset.likingBound !== "1") {
    yesBtn.dataset.likingBound = "1";
    yesBtn.addEventListener(clickEventType, confirmLikingPendingResponse);
  }
  var changeBtn = document.getElementById("likertAnswerChangeBtn");
  if (changeBtn && changeBtn.dataset.likingBound !== "1") {
    changeBtn.dataset.likingBound = "1";
    changeBtn.addEventListener(clickEventType, onLikertAnswerChangePressed);
  }

  var backBtn = document.getElementById("likingQuestionsBackBtn");
  if (backBtn && backBtn.dataset.likingBound !== "1") {
    backBtn.dataset.likingBound = "1";
    backBtn.addEventListener(clickEventType, onLikingQuestionsBack);
  }
  var nextBtn = document.getElementById("likingQuestionsNextBtn");
  if (nextBtn && nextBtn.dataset.likingBound !== "1") {
    nextBtn.dataset.likingBound = "1";
    nextBtn.addEventListener(clickEventType, onLikingQuestionsNext);
  }
}

function csvEscapeCell(v) {
  if (v == null || typeof v === "undefined") return "";
  if (v instanceof Date) return csvEscapeCell(v.toISOString());
  var str = typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/[",\n\r]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
  return str;
}

/** Flatten merged session payload (isrcUtils.data) into a two-part CSV: metadata + click stream. */
function buildExperimentCsvFromPayload(data) {
  var lines = [];
  lines.push("meta_key,meta_value");

  var metaKeys = [
    "uid",
    "duration",
    "date",
    "condition_beginning",
    "condition_end",
    "kernelCondition",
    "kernelMap",
    "sessionMode",
    "endedSessionEarly",
    "endedSessionEarlyAfterRound",
    "endedSessionEarlyScoredBoards",
    "age",
    "gender",
    "initials",
  ];
  for (var mi = 0; mi < metaKeys.length; mi++) {
    var mk = metaKeys[mi];
    if (!Object.prototype.hasOwnProperty.call(data, mk)) continue;
    lines.push(csvEscapeCell(mk) + "," + csvEscapeCell(data[mk]));
  }
  // Backward compatibility: older sessions store UX condition under `condition` or `uxMode`.
  if (
    !Object.prototype.hasOwnProperty.call(data, "condition_beginning") &&
    Object.prototype.hasOwnProperty.call(data, "condition")
  ) {
    lines.push("condition_beginning," + csvEscapeCell(data.condition));
  }
  if (!Object.prototype.hasOwnProperty.call(data, "condition") && Object.prototype.hasOwnProperty.call(data, "uxMode")) {
    lines.push("condition_beginning," + csvEscapeCell(data.uxMode));
  }
  if (data.testerNotes != null) {
    lines.push("testerNotes," + csvEscapeCell(data.testerNotes));
  }
  if (data.rockQuizResponses != null && typeof data.rockQuizResponses === "object") {
    var rq = data.rockQuizResponses;
    if (rq.q1 != null) lines.push("comp_check_1," + csvEscapeCell(rq.q1));
    if (rq.q1_why != null) lines.push("comp_check_1_why," + csvEscapeCell(rq.q1_why));
    if (rq.q2 != null) lines.push("comp_check_2," + csvEscapeCell(rq.q2));
    if (rq.q3 != null) lines.push("comp_check_3," + csvEscapeCell(rq.q3));
  }
  if (data.testerNotes != null && typeof data.testerNotes === "object" && !Array.isArray(data.testerNotes)) {
    if (Object.prototype.hasOwnProperty.call(data.testerNotes, "option-a")) {
      var oa = data.testerNotes["option-a"];
      if (oa === 0) {
        lines.push("included," + csvEscapeCell("yes"));
        lines.push("included_label," + csvEscapeCell("Included"));
      } else if (oa === 1) {
        lines.push("included," + csvEscapeCell("no"));
        lines.push("included_label," + csvEscapeCell("Not included"));
      } else {
        lines.push("included," + csvEscapeCell(String(oa)));
      }
    }
  }
  if (data.scale != null) lines.push("scale," + csvEscapeCell(data.scale));
  if (data.boardWeights != null) lines.push("boardWeights," + csvEscapeCell(data.boardWeights));
  if (data.boardWeightByTrial != null) lines.push("boardWeightByTrial," + csvEscapeCell(data.boardWeightByTrial));
  if (data.envOrder != null) lines.push("envOrder," + csvEscapeCell(data.envOrder));
  if (data.bonusLevel != null) lines.push("bonusLevel," + csvEscapeCell(data.bonusLevel));
  if (data.giftboxCollect != null) {
    var gbTs = data.giftboxCollect.timestamps || [];
    lines.push("bonus_rock_click_count," + csvEscapeCell(gbTs.length));
  }
  if (data.followUpGameAssignment != null) {
    lines.push("followUpGameAssignment," + csvEscapeCell(data.followUpGameAssignment));
  }
  if (data.likingQuestionsCollect != null) {
    var lq = data.likingQuestionsCollect.responses || [];
    lines.push("liking_questions_response_count," + csvEscapeCell(lq.length));
  }

  lines.push("");
  lines.push(
    "trial,click_number,timestamp_ms,reward_density,scaled_reward,grid_x,grid_y,grid_number,board_weight,rock_height_px"
  );

  var sh = data.searchHistory || {};
  var tc = sh.tscollect || [];
  var xc = sh.xcollect || [];
  var yc = sh.ycollect || [];
  var yk = sh.yKernelCollect || [];
  var rh = sh.rockHeightPxCollect || [];
  var zc = sh.zcollect || [];
  var weightsByTrial = data.boardWeightByTrial || data.scale || [];
  var envOrderList = data.envOrder || [];

  for (var t = 0; t < tc.length; t++) {
    if (!tc[t]) continue;
    var trialWeight = weightsByTrial[t] != null ? weightsByTrial[t] : "";
    var gridNumber = envOrderList[t] != null ? envOrderList[t] : "";
    for (var c = 0; c < tc[t].length; c++) {
      var rewardVal = zc[t] && zc[t][c];
      var rockHeight =
        rh[t] && rh[t][c] != null
          ? rh[t][c]
          : rewardVal != null
            ? getGridRockInkHeightPx(rewardVal)
            : "";
      lines.push(
        [
          String(t),
          String(c),
          csvEscapeCell(tc[t][c]),
          csvEscapeCell(yk[t] && yk[t][c]),
          csvEscapeCell(rewardVal),
          csvEscapeCell(xc[t] && xc[t][c]),
          csvEscapeCell(yc[t] && yc[t][c]),
          csvEscapeCell(gridNumber),
          csvEscapeCell(trialWeight),
          csvEscapeCell(rockHeight),
        ].join(",")
      );
    }
  }

  lines.push("");
  lines.push("bonus_rock_click,click_index,timestamp_ms");
  var gb = data.giftboxCollect || {};
  var giftTs = gb.timestamps || [];
  for (var gi = 0; gi < giftTs.length; gi++) {
    lines.push(["bonus_rock", String(gi), csvEscapeCell(giftTs[gi])].join(","));
  }

  lines.push("");
  lines.push("liking_step,likert_value,likert_label,timestamp_ms");
  var lqData = data.likingQuestionsCollect || {};
  var lqResponses = lqData.responses || [];
  for (var li = 0; li < lqResponses.length; li++) {
    var lr = lqResponses[li];
    lines.push(
      [
        csvEscapeCell(lr.stepId),
        csvEscapeCell(lr.value),
        csvEscapeCell(lr.label),
        csvEscapeCell(lr.timestamp_ms),
      ].join(",")
    );
  }

  lines.push("");
  return lines.join("\n");
}

function downloadTextFileAs(filename, text, mime) {
  mime = mime || "text/plain;charset=utf-8";
  if (typeof window.navigator !== "undefined" && window.navigator.msSaveOrOpenBlob) {
    try {
      window.navigator.msSaveOrOpenBlob(new Blob([text], { type: mime }), filename);
      return;
    } catch (e0) {}
  }
  try {
    var blob = new Blob([text], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    a.setAttribute("download", filename);
    a.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;";
    document.body.appendChild(a);
    a.click();
    // WKWebView / Safari often cancel the download if the node is removed or the blob URL
    // is revoked before the browser has started the save dialog.
    setTimeout(function () {
      try {
        if (a.parentNode) a.parentNode.removeChild(a);
      } catch (e1) {}
    }, 800);
    setTimeout(function () {
      try {
        URL.revokeObjectURL(url);
      } catch (e2) {}
    }, 120000);
  } catch (e) {
    console.log(e);
    if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () {});
      alert(
        "This browser blocked the file download. The full CSV was copied to the clipboard — paste into Notes or Mail, then save or send."
      );
      return;
    }
    alert("Could not start download in this environment.");
  }
}

/**
 * FileWriter + cordova.file are only reliable after `deviceready` (and a short init window on iOS).
 * If we miss the event, poll briefly; otherwise the write silently fails and the UI falls back to a
 * blob download (which WKWebView blocks).
 */
function runWhenCordovaFileApiReady(onReady, onTimeout) {
  var attempts = 0;
  var maxAttempts = 40;
  function tryRun() {
    if (
      typeof window !== "undefined" &&
      typeof window.resolveLocalFileSystemURL === "function" &&
      typeof cordova !== "undefined" &&
      cordova.file
    ) {
      if (typeof onReady === "function") onReady();
      return true;
    }
    return false;
  }
  if (tryRun()) return;
  var id = setInterval(function () {
    attempts++;
    if (tryRun()) {
      clearInterval(id);
      return;
    }
    if (attempts >= maxAttempts) {
      clearInterval(id);
      if (typeof onTimeout === "function") onTimeout(new Error("Cordova File API not ready (timeout)"));
    }
  }, 100);
  document.addEventListener(
    "deviceready",
    function () {
      clearInterval(id);
      if (tryRun()) return;
      if (typeof onTimeout === "function") onTimeout(new Error("deviceready fired but cordova.file missing"));
    },
    false
  );
}

function writeTextFileCordova(filename, text, onOk, onErr) {
  try {
    if (typeof window === "undefined" || typeof window.resolveLocalFileSystemURL !== "function") {
      if (typeof onErr === "function") onErr(new Error("resolveLocalFileSystemURL not available"));
      return;
    }
    if (typeof cordova === "undefined" || !cordova.file) {
      if (typeof onErr === "function") onErr(new Error("cordova.file not available yet"));
      return;
    }
    var baseDir = cordova.file.documentsDirectory || cordova.file.dataDirectory || cordova.file.cacheDirectory;
    if (!baseDir) {
      if (typeof onErr === "function") onErr(new Error("No writable Cordova directory"));
      return;
    }
    window.resolveLocalFileSystemURL(
      baseDir,
      function (dirEntry) {
        dirEntry.getFile(
          filename,
          { create: true, exclusive: false },
          function (fileEntry) {
            fileEntry.createWriter(
              function (writer) {
                writer.onerror = function (evt) {
                  if (typeof onErr === "function") onErr(evt);
                };
                writer.onwriteend = function () {
                  if (typeof onOk === "function") onOk(fileEntry);
                };
                writer.write(text);
              },
              function (err) {
                if (typeof onErr === "function") onErr(err);
              }
            );
          },
          function (err) {
            if (typeof onErr === "function") onErr(err);
          }
        );
      },
      function (err) {
        if (typeof onErr === "function") onErr(err);
      }
    );
  } catch (e) {
    if (typeof onErr === "function") onErr(e);
  }
}

function sessionPayloadHasSearchHistory(raw) {
  if (!raw || !raw.searchHistory || typeof raw.searchHistory !== "object") return false;
  return Object.prototype.hasOwnProperty.call(raw.searchHistory, "tscollect");
}

var lastSessionCsvFilename = null;

function sanitizeInitialsForFilename(initials) {
  var s = (initials == null ? "" : String(initials)).trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s || "XX";
}

function getLocalDateStamp(d) {
  d = d || new Date();
  var y = d.getFullYear();
  var m = d.getMonth() + 1;
  var day = d.getDate();
  return y + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
}

function allocateDailyCsvSequence(dateStamp) {
  var key = "gridsearch-csv-day-count-" + dateStamp;
  var n = parseInt(localStorage.getItem(key) || "0", 10);
  if (isNaN(n)) n = 0;
  n += 1;
  try {
    localStorage.setItem(key, String(n));
  } catch (e) {}
  return n;
}

function buildSessionCsvFilename(raw, opts) {
  opts = opts || {};
  if (!opts.forceNew && lastSessionCsvFilename) {
    return lastSessionCsvFilename;
  }
  var init = sanitizeInitialsForFilename(raw && raw.initials);
  var dateStamp = getLocalDateStamp(new Date());
  var seq = allocateDailyCsvSequence(dateStamp);
  lastSessionCsvFilename = init + "_" + dateStamp + "_" + seq + ".csv";
  return lastSessionCsvFilename;
}

function loadSessionPayloadForExport() {
  var raw = null;
  if (typeof isrcUtils !== "undefined" && isrcUtils.data && sessionPayloadHasSearchHistory(isrcUtils.data)) {
    raw = isrcUtils.data;
  }
  if (!raw) {
    try {
      var stored = localStorage.getItem("gridsearch-last-data");
      if (stored) raw = JSON.parse(stored);
    } catch (e) {}
  }
  return raw;
}

function appendCsvExportStatusToDebugOut(message, isError) {
  var debugOut = document.getElementById("debug-out");
  if (!debugOut) return;
  var color = isError ? "#e07070" : "#6fcf6f";
  debugOut.innerHTML =
    (debugOut.innerHTML || "") + '<br><span style="color:' + color + '">' + message + "</span>";
}

function exportSessionCsv(raw, options) {
  options = options || {};
  if (!raw || !sessionPayloadHasSearchHistory(raw)) {
    if (!options.silent) {
      alert("No session data found. Complete the study and tap Save and Finish first.");
    }
    return;
  }
  var csv;
  try {
    csv = buildExperimentCsvFromPayload(raw);
  } catch (e) {
    console.log(e);
    if (!options.silent) {
      alert("Could not build the CSV (data error). Check the console for details.");
    } else {
      appendCsvExportStatusToDebugOut("CSV export failed (data error).", true);
      alert("Could not build the CSV. Check the console for details.");
    }
    return;
  }

  var filename = buildSessionCsvFilename(raw, { forceNew: options.forceNew });

  function onWriteSuccess(fileEntry) {
    var p =
      fileEntry &&
      ((fileEntry.toURL && fileEntry.toURL()) || fileEntry.nativeURL || fileEntry.fullPath);
    if (options.silent) {
      appendCsvExportStatusToDebugOut("CSV saved to Documents: " + filename, false);
      console.log("CSV auto-exported:", filename, p || "");
    } else {
      alert("CSV saved to Files (On My iPad → GridSearch).\nFile: " + filename + (p ? "\n" + p : ""));
    }
  }

  function onWriteError(err) {
    console.log("writeTextFileCordova error:", err);
    var errMsg = err && err.message ? err.message : String(err);
    if (options.silent) {
      appendCsvExportStatusToDebugOut("CSV export failed: " + errMsg, true);
      alert("Could not save CSV to Documents. " + errMsg);
      if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(csv).catch(function () {});
      }
      return;
    }
    alert(
      "Could not save CSV to device storage. " + errMsg + " — copying CSV to clipboard as fallback."
    );
    if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(csv).catch(function () {});
    }
  }

  function onFileApiTimeout(err) {
    console.log("runWhenCordovaFileApiReady:", err);
    if (options.silent) {
      appendCsvExportStatusToDebugOut("CSV export failed: File API not ready.", true);
    }
    alert(
      "File API not ready. " + (err && err.message ? err.message : "") + " — trying download fallback (may not work in-app)."
    );
    downloadTextFileAs(filename, csv, "text/csv;charset=utf-8");
  }

  var isCordovaRuntime = typeof window !== "undefined" && !!window.cordova;
  if (isCordovaRuntime) {
    runWhenCordovaFileApiReady(
      function () {
        writeTextFileCordova(filename, csv, onWriteSuccess, onWriteError);
      },
      onFileApiTimeout
    );
    return;
  }
  downloadTextFileAs(filename, csv, "text/csv;charset=utf-8");
  if (options.silent) {
    appendCsvExportStatusToDebugOut("CSV downloaded: " + filename, false);
  }
}

function onDownloadSessionCsv() {
  exportSessionCsv(loadSessionPayloadForExport(), { silent: false, source: "manual" });
}

function debugData() {
  console.log(tscollect);
  console.log(xcollect);
  console.log(ycollect);
  console.log(zcollect);
}

function senddata() {
  searchHistory = {
    tscollect: tscollect,
    xcollect: xcollect,
    ycollect: ycollect,
    yKernelCollect: yKernelCollect,
    zcollect: zcollect,
    zcollectScaled: zcollectScaled,
    rockHeightPxCollect: rockHeightPxCollect,
  };

  saveDataArray = {
    condition_beginning: conditionBeginning,
    condition_end: conditionEnd,
    kernelCondition: condition,
    kernelMap: kernelMap,
    sessionMode: sessionMode,
    endedSessionEarly: endedSessionEarly,
    endedSessionEarlyAfterRound: endedSessionEarlyAfterRound,
    endedSessionEarlyScoredBoards: endedSessionEarlyScoredBoards,
    boardWeights: BOARD_WEIGHTS,
    boardWeightByTrial: boardWeightByTrial,
    scale: boardWeightByTrial,
    envOrder: envOrder,
    searchHistory: searchHistory,
    bonusLevel: bonusCollect,
    giftboxCollect: giftboxCollect,
    followUpGameAssignment: followUpGameAssignment,
    likingQuestionsCollect: likingQuestionsCollect,
    age: age,
    gender: gender,
    initials: initials,
    rockQuizResponses: rockQuizResponses,
    testerNotes: testerNotes,
  };

  incrementCounter();

  console.log("[DEBUG] SavaData Array:");
  console.log(saveDataArray);

  try {
    isrcUtils.SaveAndEnd(saveDataArray);
    if (typeof isrcUtils !== "undefined" && isrcUtils.data) {
      exportSessionCsv(isrcUtils.data, { silent: true, source: "auto" });
    }
  } catch (e) {
    console.log(e);
  } finally {
    showEndScreen();
  }
}

//*************UTILITIES***************************************

var EXPERIMENT_PAGE_IDS = [
  "page1",
  "pageConditionVideo",
  "page3",
  "page4",
  "page5",
  "page5finished",
  "pageGiftbox",
  "pageGiftboxCelebrate",
  "pageLikingQuestions",
  "page6",
  "page7",
];

function hideAllExperimentPages() {
  for (var pi = 0; pi < EXPERIMENT_PAGE_IDS.length; pi++) {
    var pageEl = document.getElementById(EXPERIMENT_PAGE_IDS[pi]);
    if (pageEl) pageEl.style.display = "none";
  }
}

function showEndScreen() {
  hideAllExperimentPages();
  if (typeof isrcUtils !== "undefined" && typeof isrcUtils.Goto === "function") {
    isrcUtils.Goto("rt-end");
  } else {
    var routes = document.querySelectorAll("div.route");
    for (var ri = 0; ri < routes.length; ri++) routes[ri].style.display = "none";
    var rtEnd = document.getElementById("rt-end");
    if (rtEnd) rtEnd.style.display = "block";
  }
  window.scrollTo(0, 0);
}

function resetGridSearchSession() {
  if (giftboxIntroTimeoutId != null) {
    window.clearTimeout(giftboxIntroTimeoutId);
    giftboxIntroTimeoutId = null;
  }
  if (giftboxCelebrateTimeoutId != null) {
    window.clearTimeout(giftboxCelebrateTimeoutId);
    giftboxCelebrateTimeoutId = null;
  }
  stopGiftboxConfetti();
  resetGiftboxClickTarget();

  trials = totalTrialsNumber;
  trialCounter = -1;
  resetNextTrialButtonHandler();
  clicks = horizon;
  investigationIndex = -1;
  scorecurrent = 0;
  reward = 0.0;
  gridStartEpochMs = null;
  lastSessionCsvFilename = null;
  giftboxCollect = { timestamps: [] };
  giftboxStartEpochMs = null;
  followUpGameAssignment = null;
  followUpSequence = [];
  followUpSequenceIndex = 0;
  likingQuestionsCollect = { responses: [] };
  likingQuestionsStepIndex = 0;
  likingQuestionsStartEpochMs = null;
  likingPendingResponse = null;
  stopLikingQuestionsGame();
  bonusCollect = { bonusCells: [], finalChosenCell: null };
  bonusLevelStep = 0;
  bonusCells = [];
  currentBonusCell = null;
  playingBonusRound = false;
  gridDeactivated = true;
  instructionsCounter = 0;
  sessionMode = "full";
  resetRockQuizState();
  resetTesterNotesForm();
  conditionBeginning = null;
  conditionEnd = null;
  endedSessionEarly = false;
  endedSessionEarlyAfterRound = null;
  endedSessionEarlyScoredBoards = null;
  environmentList = [];
  conditionIntroVideoCompleted = false;
  stopConditionIntroVideo();
  envOrder = getRandomSubarray(
    [
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
      21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39,
    ],
    totalTrialsNumber
  );
  currentEnv = envOrder[0];

  for (var i = 0; i < totalTrialsNumber; i++) {
    scoretotal[i] = 0;
    gridMax[i] = 0;
    tscollect[i] = [];
    xcollect[i] = [];
    ycollect[i] = [];
    yKernelCollect[i] = [];
    zcollect[i] = [];
    zcollectScaled[i] = [];
    rockHeightPxCollect[i] = [];
    initcollect[i] = [];
  }
}

function restartApp(evt) {
  if (evt && evt.preventDefault) evt.preventDefault();

  resetGridSearchSession();
  hideEndSessionEarlyChooser();
  hideAllExperimentPages();
  document.body.classList.remove("game-play-active");
  document.body.classList.remove("page5-volcano-escape-active");
  document.body.classList.remove("giftbox-game-active");
  document.body.classList.remove("page5finished-active");

  if (typeof isrcUtils !== "undefined") {
    isrcUtils.initialTimeStamp = null;
    isrcUtils.data = { uid: 0, duration: 0, date: null };
    var uidInput = document.getElementById("uid-input");
    if (uidInput) uidInput.value = "";
    var topbarUid = document.getElementById("user-id");
    if (topbarUid) topbarUid.innerHTML = "";
    isrcUtils.Goto("rt-start");
    window.scrollTo(0, 0);
    return;
  }

  var routes = document.querySelectorAll("div.route");
  for (var r = 0; r < routes.length; r++) routes[r].style.display = "none";
  var rtStart = document.getElementById("rt-start");
  if (rtStart) rtStart.style.display = "block";
  window.scrollTo(0, 0);
}

function clickStart(hide, show) {
  var hideEl = document.getElementById(hide);
  var showEl = document.getElementById(show);
  if (!hideEl || !showEl) {
    console.warn("clickStart: missing page element", hide, show);
    return;
  }
  hideEl.style.display = "none";
  showEl.style.display = "block";
  window.scrollTo(0, 0);

  var preGamePages = { page3: 1, page4: 1 };
  if (preGamePages[show]) {
    document.body.classList.remove("game-play-active");
    document.body.classList.remove("page5-volcano-escape-active");
  }
  if (show === "page5") {
    document.body.classList.add("game-play-active");
    requestAnimationFrame(function () {
      sizeGridToViewport();
      requestAnimationFrame(sizeGridToViewport);
    });
    syncCollectedBoxToUxMode();
  }
  if (hide === "page5") {
    document.body.classList.remove("game-play-active");
    document.body.classList.remove("page5-volcano-escape-active");
  }
}

function change(x, y) {
  document.getElementById(x).innerHTML = y;
}

function addToDiv(x, y) {
  document.getElementById(x).innerHTML += y;
}

function shuffle(o) {
  for (var j, x, i = o.length; i; j = Math.floor(Math.random() * i), x = o[--i], o[i] = o[j], o[j] = x);
  return o;
}

function getRandomSubarray(arr, size) {
  var shuffled = arr.slice(0),
    i = arr.length,
    temp,
    index;
  while (i--) {
    index = Math.floor((i + 1) * Math.random());
    temp = shuffled[index];
    shuffled[index] = shuffled[i];
    shuffled[i] = temp;
  }
  return shuffled.slice(0, size);
}

function loadJSON(file, callback) {
  var rawFile = new XMLHttpRequest();
  rawFile.overrideMimeType("application/json");
  rawFile.open("GET", file, true);
  rawFile.onreadystatechange = function () {
    if (rawFile.readyState === 4 && rawFile.status == "200") {
      callback(rawFile.responseText);
    }
  };
  rawFile.send(null);
}

function average(inputArray) {
  var total = 0;
  for (var i = 0; i < inputArray.length; i++) {
    total += inputArray[i];
  }
  return total / inputArray.length;
}

function rewardCum(scoreTotal) {
  var r = 0,
    r_i;
  for (var i = 0; i < scoreTotal.length; i++) {
    r_i = scoreTotal[i] / REWARD_VALUE_MAX / 300 * 1.5;
    r = r + r_i;
  }
  if (r > 1.5) r = 1.5;
  return toFixed(r, 2);
}

function performanceScore(points) {
  return toFixed((points / (REWARD_VALUE_MAX * horizon)) * 100);
}

function finalPerformance(scoreArray) {
  var finalScore = 0;
  for (i = 0; i < scoreArray.length; i++) {
    finalScore += parseInt(performanceScore(parseInt(scoreArray[i])));
  }
  return toFixed(finalScore / scoreArray.length);
}

function randomNum(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

function toFixed(value, precision) {
  var precision = precision || 0,
    power = Math.pow(10, precision),
    absValue = Math.abs(Math.round(value * power)),
    result = (value < 0 ? "-" : "") + String(Math.floor(absValue / power));

  if (precision > 0) {
    var fraction = String(absValue % power),
      padding = new Array(Math.max(precision - fraction.length, 0) + 1).join("0");
    result += "." + padding + fraction;
  }
  return result;
}

function turkGetParam(name) {
  var regexS = "[\\?&]" + name + "=([^&#]*)";
  var regex = new RegExp(regexS);
  var tmpURL = fullurl;
  var results = regex.exec(tmpURL);
  if (results == null) return "";
  return results[1];
}

function getCounter(counterName) {
  if (localStorage.getItem(counterName) === null) return 0;
  return parseInt(localStorage.getItem(counterName));
}

function incrementCounter() {
  var counter = 0;
  if (age <= 9) {
    counter = getCounter("gridsearch-counter-1");
    localStorage.setItem("gridsearch-counter-1", counter + 1);
  } else if (age > 9 && age < 18) {
    counter = getCounter("gridsearch-counter-2");
    localStorage.setItem("gridsearch-counter-2", counter + 1);
  } else if (age > 18) {
    counter = getCounter("gridsearch-counter-3");
    localStorage.setItem("gridsearch-counter-3", counter + 1);
  }
}

//END
