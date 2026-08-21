/* Sadapanna Geometry — app layer: viewport, rendering, snapping, tools,
   selection + contextual construction actions, files. */

'use strict';

/* V and Engine come from engine.js (shared top-level script scope) */

/* ================= state ================= */

let engine = new Engine();

const view = { scale: 1, tx: 0, ty: 0 };   // world -> screen: s = w*scale + t

let tool = 'move';                          // move | point | line | circle | polygon
let lineMode = 'segment';                   // segment | ray | line
let polyMode = 'free';                      // 'free' (point-by-point) | 3..60 (regular n-gon)
let pending = [];                           // point ids collected by current tool op
let opCommits = 0;                          // undo steps created by the op in progress

let selection = [];                         // ordered ids
let hoverId = null;
let snapPreview = null;                     // current snap under cursor
let cursorWorld = null;

let divideN = 3;
const U = window.Geo.UNIT;   // world px per math unit
let showMeasure = false;
try { showMeasure = localStorage.getItem('geo.ui.measure') === '1'; } catch {}

let undoStack = [], redoStack = [];
let currentFileId = null;
let docName = 'Untitled';

let dirty = true;

/* ================= dom ================= */

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d', { alpha: false });
const hintEl = document.getElementById('hint');
const contextbar = document.getElementById('contextbar');
const toolbarEl = document.getElementById('toolbar');
const filesPanel = document.getElementById('filesPanel');
const filesList = document.getElementById('filesList');
const docNameEl = document.getElementById('docName');
const saveStateEl = document.getElementById('saveState');

const isTouch = matchMedia('(pointer: coarse)').matches;
const TOL = () => (isTouch ? 22 : 10);

const isShift = (e) => e.shiftKey;

/* ================= viewport ================= */

function w2s(p) { return { x: p.x * view.scale + view.tx, y: p.y * view.scale + view.ty }; }
function s2w(p) { return { x: (p.x - view.tx) / view.scale, y: (p.y - view.ty) / view.scale }; }

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  dirty = true;
}
window.addEventListener('resize', resize);

/* ================= colors ================= */

const C = {
  bg: '#fafafa', grid: '#ececf4', axis: '#dcdce8',
  stroke: '#52525b', circle: '#52525b',
  free: '#4f46e5', derived: '#0d9488',
  sel: '#4f46e5', hover: '#f59e0b', parentGlow: '#f59e0b',
  label: '#71717a', fill: 'rgba(79,70,229,0.06)',
  preview: '#a1a1aa', snap: '#0d9488', angle: '#d97706',
};

/* ================= rendering ================= */

function requestDraw() { dirty = true; }

function frame() {
  if (dirty) { dirty = false; draw(); }
  requestAnimationFrame(frame);
}

function draw() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, w, h);
  drawGrid(w, h);

  const parentIds = new Set();
  const focus = hoverId || (selection.length === 1 ? selection[0] : null);
  if (focus) {
    const o = engine.get(focus);
    if (o) for (const p of o.parents || []) parentIds.add(p);
  }
  // while a ⊥/∥ direction snap is active, glow the line it refers to
  if (snapPreview && snapPreview.refId) parentIds.add(snapPreview.refId);

  // draw order: polygons, lines/circles, angles, points, labels
  const byLayer = { polygon: [], curve: [], angle: [], point: [] };
  for (const id of engine.order) {
    const o = engine.get(id);
    if (!o || !o.valid || o.hidden) continue;
    if (o.type === 'polygon') byLayer.polygon.push(o);
    else if (o.type === 'point') byLayer.point.push(o);
    else if (o.type === 'angle') byLayer.angle.push(o);
    else byLayer.curve.push(o);
  }

  for (const o of byLayer.polygon) drawPolygon(o);
  for (const o of byLayer.curve) drawCurve(o, parentIds);
  drawGraphLivePreview();
  for (const o of byLayer.angle) drawAngle(o);
  drawPending();
  // shift-drag shape preview: dashed circle + radius spoke from the center point
  const sPrev = (pdown && pdown.mode === 'shiftCircle' && pdown.circlePreview)
    ? { c: pdown.obj, r: pdown.circlePreview }
    : shapePreview ? { c: shapePreview.center, r: shapePreview.rim } : null;
  if (sPrev) {
    const c = w2s(sPrev.c);
    const rim = w2s(sPrev.r);
    ctx.strokeStyle = C.preview;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.arc(c.x, c.y, V.dist(c, rim), 0, Math.PI * 2);
    ctx.moveTo(c.x, c.y); ctx.lineTo(rim.x, rim.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  for (const o of byLayer.point) drawPoint(o, parentIds);
  if (showMeasure) drawMeasurements(byLayer.curve);
  drawSnapPreview();
  if (marqueeRect) {
    const r = marqueeRect;
    ctx.strokeStyle = C.sel;
    ctx.fillStyle = 'rgba(79,70,229,.07)';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([5, 4]);
    ctx.fillRect(r.x1, r.y1, r.x2 - r.x1, r.y2 - r.y1);
    ctx.strokeRect(r.x1, r.y1, r.x2 - r.x1, r.y2 - r.y1);
    ctx.setLineDash([]);
  }
}

function drawGrid(w, h) {
  // pick step so grid spacing is 40..100 px: 1,2,5 * 10^k
  let step = 50 / view.scale;
  const pow = Math.pow(10, Math.floor(Math.log10(step)));
  const m = step / pow;
  step = (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * pow;
  const sPx = step * view.scale;
  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const x0 = Math.floor(-view.tx / view.scale / step) * step;
  for (let x = x0; ; x += step) {
    const sx = x * view.scale + view.tx;
    if (sx > w) break;
    ctx.moveTo(sx, 0); ctx.lineTo(sx, h);
  }
  const y0 = Math.floor(-view.ty / view.scale / step) * step;
  for (let y = y0; ; y += step) {
    const sy = y * view.scale + view.ty;
    if (sy > h) break;
    ctx.moveTo(0, sy); ctx.lineTo(w, sy);
  }
  ctx.stroke();
  window._gridStep = step;
  void sPx;
  drawAxes(w, h, step);
}

/* coordinate axes with numbers in math units (1 unit = U world px, y up) */
function drawAxes(w, h, step) {
  const ox = view.tx, oy = view.ty; // screen position of world origin
  ctx.strokeStyle = C.axis;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (oy >= -2 && oy <= h + 2) { ctx.moveTo(0, oy); ctx.lineTo(w, oy); }
  if (ox >= -2 && ox <= w + 2) { ctx.moveTo(ox, 0); ctx.lineTo(ox, h); }
  ctx.stroke();

  ctx.fillStyle = C.label;
  ctx.font = '11px system-ui, sans-serif';
  const fmt = (v) => {
    const r = Math.round(v * 1000) / 1000;
    return Object.is(r, -0) ? '0' : String(r);
  };
  // x numbers along the x-axis (clamped to view edge so they stay visible)
  const yLab = Math.max(14, Math.min(h - 6, oy + 14));
  const x0 = Math.floor(-view.tx / view.scale / step) * step;
  ctx.textAlign = 'center';
  for (let x = x0; ; x += step) {
    const sx = x * view.scale + view.tx;
    if (sx > w) break;
    if (Math.abs(x) < 1e-9) continue;
    ctx.fillText(fmt(x / U), sx, yLab);
  }
  // y numbers (math y = -world y / U)
  const xLab = Math.max(6, Math.min(w - 30, ox + 6));
  ctx.textAlign = 'left';
  const y0b = Math.floor(-view.ty / view.scale / step) * step;
  for (let y = y0b; ; y += step) {
    const sy = y * view.scale + view.ty;
    if (sy > h) break;
    if (Math.abs(y) < 1e-9) continue;
    ctx.fillText(fmt(-y / U), xLab, sy - 4);
  }
  if (oy >= -2 && oy <= h + 2 && ox >= -2 && ox <= w + 2) ctx.fillText('0', ox + 5, oy + 14);
  ctx.textAlign = 'start';
}

function strokeFor(o, parentIds) {
  if (selection.includes(o.id)) return { c: C.sel, w: 3 };
  if (o.id === hoverId) return { c: C.hover, w: 3 };
  if (parentIds.has(o.id)) return { c: C.parentGlow, w: 2.5 };
  return { c: C.stroke, w: 2 };
}

function drawCurve(o, parentIds) {
  const st = strokeFor(o, parentIds);
  ctx.strokeStyle = st.c;
  ctx.lineWidth = st.w;
  ctx.setLineDash(o.style === 'dashed' ? [6, 5] : []);
  if (o.type === 'function') { drawFunction(o, st); return; }
  ctx.beginPath();
  if (o.type === 'circle') {
    const c = w2s({ x: o.cx, y: o.cy });
    ctx.arc(c.x, c.y, o.r * view.scale, 0, Math.PI * 2);
  } else {
    const [p1, p2] = lineDrawPoints(o);
    ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

// screen endpoints for segment / ray / line
function lineDrawPoints(o) {
  const a = w2s({ x: o.ax, y: o.ay }), b = w2s({ x: o.bx, y: o.by });
  const ext = o.extent || o.type;
  if (ext === 'segment') return [a, b];
  const d = V.norm(V.sub(b, a)) || { x: 1, y: 0 };
  const L = canvas.clientWidth + canvas.clientHeight + 200;
  const p2 = V.add(a, V.scale(d, L));
  if (ext === 'ray') return [a, p2];
  return [V.sub(a, V.scale(d, L)), p2];
}

function drawFunction(o, st) {
  const fn = o._fn;
  if (!fn) return;
  const w = canvas.clientWidth;
  ctx.strokeStyle = st ? st.c : C.stroke;
  ctx.lineWidth = st ? st.w : 2;
  ctx.beginPath();
  let pen = false;
  const H = canvas.clientHeight;
  for (let sx = 0; sx <= w; sx += 2) {
    const wx = (sx - view.tx) / view.scale;
    const wy = window.Geo.graphWorldY(fn, wx);
    if (!Number.isFinite(wy)) { pen = false; continue; }
    const sy = wy * view.scale + view.ty;
    if (sy < -2 * H || sy > 3 * H) { pen = false; continue; } // off-screen asymptote
    if (pen) ctx.lineTo(sx, sy); else { ctx.moveTo(sx, sy); pen = true; }
  }
  ctx.stroke();
  // f(x) label near the left edge of its visible run
  if (o.params && o.params.expr) {
    const wx = (30 - view.tx) / view.scale;
    const wy = window.Geo.graphWorldY(fn, wx);
    if (Number.isFinite(wy)) {
      ctx.fillStyle = st ? st.c : C.stroke;
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.fillText('f(x)=' + o.params.expr, 32, Math.max(140, Math.min(canvas.clientHeight - 12, wy * view.scale + view.ty - 8)));
    }
  }
}

/* dashed preview of the formula being typed in the graph editor */
function drawGraphLivePreview() {
  if (!graphPreviewFn) return;
  const w = canvas.clientWidth, H = canvas.clientHeight;
  ctx.strokeStyle = C.sel;
  ctx.lineWidth = 2.5;
  ctx.setLineDash([7, 5]);
  ctx.beginPath();
  let pen = false;
  for (let sx = 0; sx <= w; sx += 2) {
    const wx = (sx - view.tx) / view.scale;
    const wy = window.Geo.graphWorldY(graphPreviewFn, wx);
    if (!Number.isFinite(wy)) { pen = false; continue; }
    const sy = wy * view.scale + view.ty;
    if (sy < -2 * H || sy > 3 * H) { pen = false; continue; }
    if (pen) ctx.lineTo(sx, sy); else { ctx.moveTo(sx, sy); pen = true; }
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

function fmtUnits(worldLen) {
  const v = worldLen / U;
  return (Math.round(v * 100) / 100).toString();
}

function drawMeasurements(objs) {
  ctx.font = '600 11.5px system-ui, sans-serif';
  for (const o of objs) {
    if (o.type === 'segment') {
      const a = w2s({ x: o.ax, y: o.ay }), b = w2s({ x: o.bx, y: o.by });
      const mid = V.mid(a, b);
      const d = V.norm(V.sub(b, a)) || { x: 1, y: 0 };
      const n = { x: -d.y, y: d.x };
      const t = fmtUnits(V.dist({ x: o.ax, y: o.ay }, { x: o.bx, y: o.by }));
      drawTag(mid.x + n.x * 12, mid.y + n.y * 12, t);
    } else if (o.type === 'circle') {
      const c = w2s({ x: o.cx, y: o.cy });
      const r = o.r * view.scale;
      const a = -Math.PI / 4;
      drawTag(c.x + Math.cos(a) * r * 0.6, c.y + Math.sin(a) * r * 0.6, 'r=' + fmtUnits(o.r));
    }
  }
}

function drawTag(x, y, text) {
  const tw = ctx.measureText(text).width;
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  roundRect(x - tw / 2 - 4, y - 9, tw + 8, 17, 5);
  ctx.fill();
  ctx.fillStyle = '#3f3f50';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
  ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
}

function drawPolygon(o) {
  if (!o.pts || o.pts.length < 3) return;
  ctx.fillStyle = C.fill;
  ctx.beginPath();
  const s0 = w2s(o.pts[0]);
  ctx.moveTo(s0.x, s0.y);
  for (let i = 1; i < o.pts.length; i++) { const s = w2s(o.pts[i]); ctx.lineTo(s.x, s.y); }
  ctx.closePath();
  ctx.fill();
}

function drawAngle(o) {
  const v = w2s({ x: o.x, y: o.y });
  const r = 26;
  let delta = o.a2 - o.a1;
  delta = ((delta % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const anticlockwise = delta > Math.PI;
  ctx.strokeStyle = C.angle;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(v.x, v.y, r, o.a1, o.a2, anticlockwise);
  ctx.stroke();
  // degrees label along the bisector
  const sweep = anticlockwise ? delta - 2 * Math.PI : delta;
  const midA = o.a1 + sweep / 2;
  const lx = v.x + Math.cos(midA) * (r + 14);
  const ly = v.y + Math.sin(midA) * (r + 14);
  ctx.fillStyle = C.angle;
  ctx.font = '600 12px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(Math.round(o.value * 180 / Math.PI) + '°', lx, ly);
  ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
}

function drawPoint(o, parentIds) {
  const s = w2s(o);
  const draggable = engine.isDraggable(o);
  const fill = draggable ? C.free : C.derived;
  const selected = selection.includes(o.id);
  const hovered = o.id === hoverId;

  if (selected || hovered || parentIds.has(o.id)) {
    ctx.fillStyle = selected ? 'rgba(79,70,229,.18)' :
      hovered ? 'rgba(245,158,11,.22)' : 'rgba(245,158,11,.18)';
    ctx.beginPath(); ctx.arc(s.x, s.y, 11, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = fill;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(s.x, s.y, draggable ? 5.2 : 4.4, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();

  if (o.label) {
    ctx.fillStyle = C.label;
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.fillText(o.label, s.x + 8, s.y - 8);
  }
}

function drawPending() {
  if (!pending.length || !cursorWorld) return;
  const cur = snapPreview ? snapPreview.world : cursorWorld;
  ctx.strokeStyle = C.preview;
  ctx.lineWidth = 1.6;
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  const pts = pending.map((id) => engine.get(id)).filter(Boolean);
  if (tool === 'line' && pts.length === 1) {
    const a = w2s(pts[0]);
    if (lineMode === 'segment') {
      const b = w2s(cur);
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    } else {
      const fake = { ax: pts[0].x, ay: pts[0].y, bx: cur.x, by: cur.y, extent: lineMode };
      const [p1, p2] = lineDrawPoints(fake);
      ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
    }
  } else if (tool === 'circle' && pts.length === 1) {
    const c = w2s(pts[0]);
    ctx.arc(c.x, c.y, V.dist(pts[0], cur) * view.scale, 0, Math.PI * 2);
  } else if (tool === 'polygon' && typeof polyMode === 'number' && pts.length === 1) {
    // preset preview: dashed regular n-gon around the chosen center
    const c = pts[0];
    const n = polyMode;
    for (let i = 0; i <= n; i++) {
      const a = (i % n) * 2 * Math.PI / n;
      const cos = Math.cos(a), sin = Math.sin(a);
      const vx = c.x + (cur.x - c.x) * cos - (cur.y - c.y) * sin;
      const vy = c.y + (cur.x - c.x) * sin + (cur.y - c.y) * cos;
      const s = w2s({ x: vx, y: vy });
      if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
    }
  } else if (tool === 'polygon') {
    const s0 = w2s(pts[0]);
    ctx.moveTo(s0.x, s0.y);
    for (let i = 1; i < pts.length; i++) { const s = w2s(pts[i]); ctx.lineTo(s.x, s.y); }
    const c = w2s(cur);
    ctx.lineTo(c.x, c.y);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // closing hint ring on first polygon vertex
  if (tool === 'polygon' && pts.length >= 3) {
    const s0 = w2s(pts[0]);
    ctx.strokeStyle = C.snap;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(s0.x, s0.y, 10, 0, Math.PI * 2); ctx.stroke();
  }
}

function drawSnapPreview() {
  if (!snapPreview) return;
  const s = w2s(snapPreview.world);
  if (snapPreview.kind !== 'free') {
    ctx.strokeStyle = C.snap;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(s.x, s.y, 9, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = C.snap;
    ctx.beginPath(); ctx.arc(s.x, s.y, 3, 0, Math.PI * 2); ctx.fill();
    if (snapPreview.label) {
      ctx.font = '600 12px system-ui, sans-serif';
      const tw = ctx.measureText(snapPreview.label).width;
      const bx = s.x + 12, by = s.y + 12;
      ctx.fillStyle = 'rgba(13,148,136,.92)';
      roundRect(bx, by, tw + 12, 20, 6);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(snapPreview.label, bx + 6, by + 14);
    }
  }
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ================= hit testing ================= */

/* objects the current drag must not snap to (the dragged point + everything
   built from it, plus rim points a center-drag carries along) */
let snapExclude = null;

function descendantsOf(...roots) {
  const s = new Set(roots);
  let grew = true;
  while (grew) {
    grew = false;
    for (const o of engine.objects.values()) {
      if (!s.has(o.id) && (o.parents || []).some((p) => s.has(p))) { s.add(o.id); grew = true; }
    }
  }
  return s;
}

function hitTest(screenPt, { pointsOnly = false } = {}) {
  const tol = TOL();
  let bestPoint = null, bestPointD = tol;
  let bestCurve = null, bestCurveD = tol;
  for (const id of engine.order) {
    if (snapExclude && snapExclude.has(id)) continue;
    const o = engine.get(id);
    if (!o || !o.valid || o.hidden) continue;
    if (o.type === 'point') {
      const d = V.dist(w2s(o), screenPt);
      if (d <= bestPointD) { bestPointD = d; bestPoint = o; }
    } else if (!pointsOnly && (o.type === 'segment' || o.type === 'line' || o.type === 'ray')) {
      const d = screenDistToLinear(screenPt, o);
      if (d <= bestCurveD) { bestCurveD = d; bestCurve = o; }
    } else if (!pointsOnly && o.type === 'circle') {
      const c = w2s({ x: o.cx, y: o.cy });
      const d = Math.abs(V.dist(screenPt, c) - o.r * view.scale);
      if (d <= bestCurveD) { bestCurveD = d; bestCurve = o; }
    } else if (!pointsOnly && o.type === 'function') {
      const proj = engine.projectOntoPath(s2w(screenPt), o);
      if (proj) {
        const d = V.dist(w2s(proj.pt), screenPt);
        if (d <= bestCurveD) { bestCurveD = d; bestCurve = o; }
      }
    } else if (!pointsOnly && o.type === 'polygon' && o.pts && o.pts.length >= 3) {
      // interior counts weakly (only if nothing else) — handled after loop
    }
  }
  if (bestPoint) return bestPoint;
  if (bestCurve) return bestCurve;
  if (!pointsOnly) {
    for (const id of [...engine.order].reverse()) {
      const o = engine.get(id);
      if (o && o.valid && !o.hidden && o.type === 'polygon' && o.pts && o.pts.length >= 3) {
        if (window.Geo.pointInPolygon(s2w(screenPt), o.pts)) return o;
      }
    }
  }
  return null;
}

function screenDistToLinear(sp, o) {
  const [p1, p2] = lineDrawPoints(o);
  return window.Geo.distToSegment(sp, p1, p2);
}

/* ================= snapping ================= */

/* Returns {kind, label, world, make()} — make() returns a point id. */
function findSnap(screenPt) {
  const tol = TOL() + 2;
  const wp = s2w(screenPt);

  // 1. existing point
  const pt = hitTest(screenPt, { pointsOnly: true });
  if (pt && pt.type === 'point') {
    return { kind: 'existing', label: pt.label || '', world: { x: pt.x, y: pt.y }, make: () => pt.id };
  }

  // gather curves near cursor
  const near = [];
  for (const id of engine.order) {
    if (snapExclude && snapExclude.has(id)) continue;
    const o = engine.get(id);
    if (!o || !o.valid || o.hidden) continue;
    if (o.type === 'segment' || o.type === 'line' || o.type === 'ray') {
      if (screenDistToLinear(screenPt, o) <= tol) near.push(o);
    } else if (o.type === 'circle') {
      const c = w2s({ x: o.cx, y: o.cy });
      if (Math.abs(V.dist(screenPt, c) - o.r * view.scale) <= tol) near.push(o);
    } else if (o.type === 'function') {
      const proj = engine.projectOntoPath(wp, o);
      if (proj && V.dist(w2s(proj.pt), screenPt) <= tol) near.push(o);
    }
  }

  // 2. intersection of two near curves
  for (let i = 0; i < near.length; i++) {
    for (let j = i + 1; j < near.length; j++) {
      const pts = engine.intersectObjects(near[i], near[j]);
      for (let b = 0; b < pts.length; b++) {
        if (V.dist(w2s(pts[b]), screenPt) <= tol) {
          const a = near[i], c = near[j], seed = pts[b];
          return {
            kind: 'intersection',
            label: `Intersection of ${nameOf(a)}, ${nameOf(c)}`,
            world: seed,
            make: () => {
              const ex = findExistingPoint('intersection', [a.id, c.id], seed);
              if (ex) return ex.id;
              const o = engine.add({
                type: 'point', kind: 'intersection', parents: [a.id, c.id],
                params: { branch: b }, x: seed.x, y: seed.y,
              });
              return o.id;
            },
          };
        }
      }
    }
  }

  // 3. special points on one near curve: center, midpoint, n-sections
  for (const o of near) {
    if (o.type === 'circle') {
      const c = w2s({ x: o.cx, y: o.cy });
      if (V.dist(c, screenPt) <= tol) {
        return {
          kind: 'center', label: 'Center', world: { x: o.cx, y: o.cy },
          make: () => makeSpecialPoint('centerPoint', [o.id], {}),
        };
      }
    }
  }
  for (const o of near) {
    if (o.type !== 'segment') continue;
    const a = { x: o.ax, y: o.ay }, b = { x: o.bx, y: o.by };
    // midpoint + n-section detents (k/n for n up to 5)
    const fracs = [];
    for (let n = 2; n <= 5; n++) {
      for (let k = 1; k < n; k++) {
        if (n > 2 && (k * 2) % n === 0) continue; // skip duplicates of 1/2
        if (n === 4 && k === 2) continue;
        fracs.push({ k, n });
      }
    }
    let best = null, bestD = tol;
    for (const f of fracs) {
      const p = V.lerp(a, b, f.k / f.n);
      const d = V.dist(w2s(p), screenPt);
      if (d < bestD) { bestD = d; best = { ...f, p }; }
    }
    if (best) {
      const isMid = best.k * 2 === best.n;
      return {
        kind: 'nsection',
        label: isMid ? 'Midpoint' : `${best.k}/${best.n} point`,
        world: best.p,
        make: () => isMid
          ? makeSpecialPoint('segMidpoint', [o.id], {})
          : makeSpecialPoint('segNsection', [o.id], { k: best.k, n: best.n }),
      };
    }
  }

  // 4. on-path glider
  if (near.length) {
    const o = near[0];
    const proj = engine.projectOntoPath(wp, o);
    if (proj) {
      return {
        kind: 'onPath',
        label: 'On ' + (o.type === 'circle' && !o.label ? 'circle' : nameOf(o)),
        world: proj.pt,
        make: () => engine.add({
          type: 'point', kind: 'onPath', parents: [o.id], params: { t: proj.t },
        }).id,
      };
    }
  }

  // 5. grid crossing (only if close, so it never fights)
  const step = window._gridStep || 50;
  const gp = { x: Math.round(wp.x / step) * step, y: Math.round(wp.y / step) * step };
  if (V.dist(w2s(gp), screenPt) <= 8) {
    return { kind: 'grid', label: 'Grid', world: gp, make: () => makeFreePoint(gp) };
  }

  // 6. free
  return { kind: 'free', label: '', world: wp, make: () => makeFreePoint(wp) };
}

/* human name for any object: its label, or endpoint labels ("TU"), or type */
function nameOf(o) {
  if (!o) return '';
  if (o.label) return o.label;
  if (o.kind === 'twoPoint') {
    const [a, b] = (o.parents || []).map((id) => engine.get(id));
    if (a && a.label && b && b.label) return a.label + b.label;
  }
  return o.type === 'function' ? 'graph' : o.type;
}

/* ---- direction snapping while drawing: 0/45/90/135° and ⊥/∥ to visible lines ---- */

function directionSnap(fromPt, wp) {
  const v = V.sub(wp, fromPt);
  const len = V.len(v);
  if (len < 24) return null;
  const ang = Math.atan2(v.y, v.x);
  let best = null, bestDiff = (4 * Math.PI) / 180; // 4° capture
  const consider = (dirAng, lbl, ref, rel) => {
    for (const a of [dirAng, dirAng + Math.PI]) {
      const d = Math.abs((((ang - a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);
      if (d < bestDiff) { bestDiff = d; best = { a, lbl, ref, rel }; }
    }
  };
  for (const o of engine.objects.values()) {
    if (!o.valid || o.hidden) continue;
    if (o.type === 'segment' || o.type === 'line' || o.type === 'ray') {
      const l = engine.asLine(o);
      if (!l) continue;
      const la = Math.atan2(l.d.y, l.d.x);
      consider(la + Math.PI / 2, '⊥ to ' + nameOf(o), o.id, 'perp');
      consider(la, '∥ to ' + nameOf(o), o.id, 'para');
    }
  }
  consider(0, '0°'); consider(Math.PI / 4, '45°');
  consider(Math.PI / 2, '90°'); consider(3 * Math.PI / 4, '45°');
  if (!best) return null;
  const dir = { x: Math.cos(best.a), y: Math.sin(best.a) };
  const t = V.dot(v, dir);
  if (t < 8) return null;
  return { label: best.lbl, world: V.add(fromPt, V.scale(dir, t)), refId: best.ref || null, rel: best.rel || null };
}

/* full snap for tool clicks: object snaps win, then direction, then grid/free */
function resolveSnap(sp) {
  let s = findSnap(sp);
  const drawingFrom =
    (tool === 'line' && pending.length === 1) || (tool === 'polygon' && pending.length >= 1)
      ? engine.get(pending[pending.length - 1]) : null;
  if (drawingFrom && (s.kind === 'free' || s.kind === 'grid')) {
    const ds = directionSnap(drawingFrom, s2w(sp));
    if (ds) {
      const w = ds.world;
      return {
        kind: 'direction', label: ds.label, world: w,
        refId: ds.refId, rel: ds.rel,
        make: () => makeFreePoint(w),
      };
    }
  }
  // circle tool: snap the radius to clean half-unit values
  if (tool === 'circle' && pending.length === 1 && (s.kind === 'free' || s.kind === 'grid')) {
    const center = engine.get(pending[0]);
    if (center) {
      const rs = radiusSnap(center, s2w(sp));
      if (rs) return { kind: 'radius', label: rs.label, world: rs.world, make: () => makeFreePoint(rs.world) };
    }
  }
  return s;
}

/* rim within 8px of a half-unit radius → pull it onto that exact radius */
function radiusSnap(center, wp) {
  const v = V.sub(wp, center);
  const r = V.len(v);
  if (r < 12) return null;
  const units = r / U;
  const m = Math.round(units * 2) / 2;
  if (m <= 0) return null;
  if (Math.abs(units - m) * U * view.scale > 8) return null;
  const d = V.norm(v);
  if (!d) return null;
  return { label: 'r = ' + m, world: V.add(center, V.scale(d, m * U)) };
}

function gridSnapPoint(wp) {
  const step = window._gridStep || 50;
  const gp = { x: Math.round(wp.x / step) * step, y: Math.round(wp.y / step) * step };
  return V.dist(w2s(gp), w2s(wp)) <= 8 ? gp : null;
}

function makeFreePoint(p) {
  return engine.add({ type: 'point', kind: 'free', parents: [], params: {}, x: p.x, y: p.y }).id;
}

function makeSpecialPoint(kind, parents, params) {
  const ex = findExistingPoint(kind, parents, null, params);
  if (ex) return ex.id;
  return engine.add({ type: 'point', kind, parents, params }).id;
}

function findExistingPoint(kind, parents, nearPt, params) {
  for (const o of engine.objects.values()) {
    if (o.type !== 'point' || o.kind !== kind) continue;
    if (o.parents.length !== parents.length) continue;
    if (!o.parents.every((p, i) => p === parents[i] || parents.includes(p))) continue;
    if (params && (o.params.k !== params.k || o.params.n !== params.n)) continue;
    if (nearPt && V.dist(o, nearPt) > 1e-6 * Math.max(1, V.len(nearPt))) {
      if (V.dist(w2s(o), w2s(nearPt)) > 4) continue;
    }
    return o;
  }
  return null;
}

/* ================= tools ================= */

const TOOLS = [
  { id: 'move', name: 'Move', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="#1c1c28" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3l14 8-6 2 4 6-3 2-4-6-5 4z"/></svg>' },
  { id: 'point', name: 'Point', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="#1c1c28" stroke-width="1.8"><circle cx="12" cy="12" r="3.4" fill="#1c1c28"/></svg>' },
  { id: 'line', name: 'Line', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="#1c1c28" stroke-width="1.8" stroke-linecap="round"><path d="M4 20L20 4"/><circle cx="5" cy="19" r="2" fill="#1c1c28" stroke="none"/><circle cx="19" cy="5" r="2" fill="#1c1c28" stroke="none"/></svg>' },
  { id: 'circle', name: 'Circle', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="#1c1c28" stroke-width="1.8"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="1.6" fill="#1c1c28" stroke="none"/></svg>' },
  { id: 'polygon', name: 'Shape', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="#1c1c28" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3l9 7-3.5 10h-11L3 10z"/></svg>' },
];

const HINTS = {
  move: '',
  point: 'Tap anywhere for a point — hover lines for midpoints, thirds & intersections',
  'line-0': 'Tap the first point',
  'line-1': 'Tap the second point · Esc to cancel',
  'circle-0': 'Tap the center',
  'circle-1': 'Tap a point on the circle · Esc to cancel',
  'polygon-0': 'Tap the first corner',
  'polygon-n': 'Tap the next corner — tap the first corner again to close',
};

const toolwrap = document.getElementById('toolwrap');

function buildToolbar() {
  const grip = document.getElementById('toolgrip');
  while (toolbarEl.lastChild !== grip) toolbarEl.removeChild(toolbarEl.lastChild);
  for (const t of TOOLS) {
    const b = document.createElement('button');
    b.innerHTML = t.icon + '<span>' + t.name + '</span>';
    b.title = t.name;
    b.dataset.tool = t.id;
    b.addEventListener('click', () => setTool(t.id));
    toolbarEl.appendChild(b);
  }
  const g = document.createElement('button');
  g.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#1c1c28" stroke-width="1.8" stroke-linecap="round"><path d="M3 17 Q 8 4 12 12 T 21 8"/></svg><span>Graph</span>';
  g.title = 'Plot a function f(x)';
  g.dataset.tool = 'graph';
  g.addEventListener('click', () => toggleGraphInput());
  toolbarEl.appendChild(g);
  const rz = document.createElement('div');
  rz.id = 'toolresize';
  rz.title = 'Drag to resize toolbar';
  rz.textContent = '‖';
  toolbarEl.appendChild(rz);
  initToolbarResize(rz);
  initToolbarDrag(grip);
  updateToolbar();
}

/* horizontal resize: tools re-wrap into rows; width clamped, persisted */
function initToolbarResize(handle) {
  const MIN_W = 92, MAX_W = 520;
  try {
    const w = parseInt(localStorage.getItem('geo.ui.toolw'), 10);
    if (Number.isFinite(w)) toolbarEl.style.width = Math.max(MIN_W, Math.min(MAX_W, w)) + 'px';
  } catch {}
  let startX = null, startW = null;
  handle.addEventListener('pointerdown', (e) => {
    handle.setPointerCapture(e.pointerId);
    startX = e.clientX;
    startW = toolbarEl.getBoundingClientRect().width;
    e.preventDefault(); e.stopPropagation();
  });
  handle.addEventListener('pointermove', (e) => {
    if (startX === null) return;
    const w = Math.max(MIN_W, Math.min(MAX_W, startW + (e.clientX - startX)));
    toolbarEl.style.width = w + 'px';
  });
  handle.addEventListener('pointerup', () => {
    if (startX === null) return;
    startX = null;
    try { localStorage.setItem('geo.ui.toolw', String(Math.round(toolbarEl.getBoundingClientRect().width))); } catch {}
  });
  handle.addEventListener('dblclick', () => {
    toolbarEl.style.width = '';
    try { localStorage.removeItem('geo.ui.toolw'); } catch {}
  });
}

function updateToolbar() {
  for (const b of toolbarEl.children) {
    if (b.dataset && b.dataset.tool) b.classList.toggle('active', b.dataset.tool === tool);
  }
  canvas.classList.toggle('tool-move', tool === 'move');
  let sub = document.getElementById('subtools');
  if (tool === 'line' || tool === 'polygon') {
    if (!sub) {
      sub = document.createElement('div');
      sub.id = 'subtools';
      toolwrap.appendChild(sub);
    }
    sub.innerHTML = '';
    if (tool === 'line') {
      for (const m of ['segment', 'ray', 'line']) {
        const b = document.createElement('button');
        b.textContent = m[0].toUpperCase() + m.slice(1);
        b.classList.toggle('active', lineMode === m);
        b.addEventListener('click', () => { lineMode = m; updateToolbar(); });
        sub.appendChild(b);
      }
    } else {
      const opts = [['Free', 'free'], ['△', 3], ['◻', 4], ['⬠', 5], ['⬡', 6]];
      for (const [txt, m] of opts) {
        const b = document.createElement('button');
        b.textContent = txt;
        b.title = m === 'free' ? 'Point by point' : 'Regular ' + m + '-gon';
        b.classList.toggle('active', polyMode === m);
        b.addEventListener('click', () => { cancelPending(true); polyMode = m; updateToolbar(); });
        sub.appendChild(b);
      }
      const inp = document.createElement('input');
      inp.type = 'number'; inp.min = '3'; inp.max = '60'; inp.placeholder = 'n';
      inp.style.width = '4ch';
      inp.style.border = 'none'; inp.style.font = 'inherit'; inp.style.fontSize = '12px';
      inp.style.background = 'var(--bg)'; inp.style.borderRadius = '6px'; inp.style.textAlign = 'center';
      if (typeof polyMode === 'number' && ![3, 4, 5, 6].includes(polyMode)) inp.value = polyMode;
      inp.addEventListener('change', () => {
        const n = Math.max(3, Math.min(60, parseInt(inp.value, 10) || 0));
        if (n >= 3) { cancelPending(true); polyMode = n; updateToolbar(); }
      });
      inp.addEventListener('keydown', (e) => e.stopPropagation());
      sub.appendChild(inp);
    }
  } else if (sub) sub.remove();
  updateHint();
}

/* --- graph editor: big input, live preview, autocomplete, chips --- */

let graphEditTarget = null;   // object id being edited, or null for new
let graphPreviewFn = null;    // compiled fn drawn as a dashed preview while typing

const GRAPH_FUNCS = [
  { t: 'sin', fn: true, d: 'sine' }, { t: 'cos', fn: true, d: 'cosine' },
  { t: 'tan', fn: true, d: 'tangent' }, { t: 'sqrt', fn: true, d: 'square root' },
  { t: 'abs', fn: true, d: 'absolute value' }, { t: 'ln', fn: true, d: 'natural log' },
  { t: 'log', fn: true, d: 'natural log' }, { t: 'exp', fn: true, d: 'e^x' },
  { t: 'asin', fn: true, d: 'inverse sine' }, { t: 'acos', fn: true, d: 'inverse cosine' },
  { t: 'atan', fn: true, d: 'inverse tangent' }, { t: 'floor', fn: true, d: 'round down' },
  { t: 'ceil', fn: true, d: 'round up' }, { t: 'round', fn: true, d: 'nearest whole' },
  { t: 'min', fn: true, d: 'smaller of two' }, { t: 'max', fn: true, d: 'larger of two' },
  { t: 'pow', fn: true, d: 'pow(x, n)' },
  { t: 'pi', fn: false, d: 'π ≈ 3.14159' }, { t: 'e', fn: false, d: '≈ 2.71828' },
];

const GRAPH_CHIPS = [
  ['x²', 'x^2'], ['√x', 'sqrt(x)'], ['|x|', 'abs(x)'], ['sin x', 'sin(x)'],
  ['1/x', '1/x'], ['eˣ', 'exp(x)'], ['ln x', 'ln(x)'], ['π', 'pi'],
];

function closeGraphInput() {
  const gi = document.getElementById('graphInput');
  if (gi) gi.remove();
  graphEditTarget = null;
  graphPreviewFn = null;
  requestDraw();
}

function toggleGraphInput(prefill, editId) {
  const existing = document.getElementById('graphInput');
  if (existing && prefill === undefined) { closeGraphInput(); return; }
  closeGraphInput();

  const gi = document.createElement('div');
  gi.id = 'graphInput';
  gi.innerHTML = `
    <div class="gi-row">
      <span class="gi-fx">f(x) =</span>
      <input spellcheck="false" autocomplete="off" autocapitalize="off"
        placeholder="try  x^2/4   or   sin(x)*2" aria-label="Function of x">
      <button class="gi-plot">Plot</button>
    </div>
    <div class="gi-sug" hidden></div>
    <div class="gi-msg">Use <b>x</b> as the variable · <b>^</b> for powers · functions need brackets, like sin(x)</div>
    <div class="gi-chips"></div>`;
  toolwrap.appendChild(gi);

  const input = gi.querySelector('input');
  const sugEl = gi.querySelector('.gi-sug');
  const msgEl = gi.querySelector('.gi-msg');
  const defaultMsg = msgEl.innerHTML;
  let sugs = [], sugIndex = 0;

  // quick-insert chips
  const chipsEl = gi.querySelector('.gi-chips');
  for (const [label, code] of GRAPH_CHIPS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('mousedown', (ev) => ev.preventDefault()); // keep input focus
    b.addEventListener('click', () => {
      insertAtCaret(input, input.value.trim() ? code : code);
      refresh();
    });
    chipsEl.appendChild(b);
  }

  function insertAtCaret(el, text) {
    const s = el.selectionStart ?? el.value.length, epos = el.selectionEnd ?? s;
    el.value = el.value.slice(0, s) + text + el.value.slice(epos);
    // land the caret inside freshly inserted brackets
    const inner = text.indexOf('(x)');
    const caret = inner >= 0 ? s + inner + 3 : (text.endsWith('(') ? s + text.length : s + text.length);
    el.setSelectionRange(caret, caret);
    el.focus();
  }

  function currentWord() {
    const pos = input.selectionStart ?? input.value.length;
    const before = input.value.slice(0, pos);
    const m = before.match(/[a-zA-Z]+$/);
    return m ? { word: m[0], start: pos - m[0].length, end: pos } : null;
  }

  function renderSugs() {
    if (!sugs.length) { sugEl.hidden = true; return; }
    sugEl.hidden = false;
    sugEl.innerHTML = '';
    sugs.forEach((f, i) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'gi-sug-row' + (i === sugIndex ? ' active' : '');
      row.innerHTML = `<b>${f.t}${f.fn ? '(…)' : ''}</b><span>${f.d}</span>`;
      row.addEventListener('mousedown', (ev) => ev.preventDefault());
      row.addEventListener('click', () => acceptSug(i));
      sugEl.appendChild(row);
    });
  }

  function acceptSug(i) {
    const f = sugs[i];
    const w = currentWord();
    if (!f || !w) return;
    const insert = f.fn ? f.t + '()' : f.t;
    input.value = input.value.slice(0, w.start) + insert + input.value.slice(w.end);
    const caret = w.start + (f.fn ? f.t.length + 1 : insert.length);
    input.setSelectionRange(caret, caret);
    sugs = []; renderSugs();
    refresh();
  }

  function refresh() {
    // autocomplete for the word being typed (but not the bare variable x)
    const w = currentWord();
    sugs = [];
    if (w && w.word.toLowerCase() !== 'x') {
      const q = w.word.toLowerCase();
      sugs = GRAPH_FUNCS.filter((f) => f.t.startsWith(q) && f.t !== q).slice(0, 6);
    }
    sugIndex = 0;
    renderSugs();
    // live validation + on-canvas preview
    const expr = input.value.trim();
    input.classList.remove('bad');
    if (!expr) {
      graphPreviewFn = null;
      msgEl.innerHTML = defaultMsg;
    } else {
      const fn = window.Geo.compileExpr(expr);
      graphPreviewFn = fn;
      if (fn) {
        msgEl.innerHTML = '✓ looks good — <b>Enter</b> to plot';
        msgEl.classList.add('ok');
      } else {
        msgEl.innerHTML = 'Keeps typing… brackets balanced? functions like <b>sin(x)</b> need brackets';
        msgEl.classList.remove('ok');
      }
    }
    if (!expr) msgEl.classList.remove('ok');
    requestDraw();
  }

  const go = () => {
    const expr = input.value.trim();
    if (!expr) return;
    if (!window.Geo.compileExpr(expr)) {
      input.classList.add('bad');
      msgEl.classList.remove('ok');
      msgEl.innerHTML = 'Could not read that — try <b>x^2/4</b>, <b>sin(x)*2</b>, or <b>1/x</b>';
      return;
    }
    if (graphEditTarget && engine.get(graphEditTarget)) {
      engine.get(graphEditTarget).params.expr = expr;
      engine.recomputeAll();
    } else {
      engine.add({ type: 'function', kind: 'graph', parents: [], params: { expr } });
    }
    commit();
    closeGraphInput();
    updateHint('Tip: points snap onto the curve — try the Point tool on it');
  };

  gi.querySelector('.gi-plot').addEventListener('click', go);
  input.addEventListener('keydown', (e) => {
    if (!sugEl.hidden && sugs.length) {
      if (e.key === 'ArrowDown') { sugIndex = (sugIndex + 1) % sugs.length; renderSugs(); e.preventDefault(); e.stopPropagation(); return; }
      if (e.key === 'ArrowUp') { sugIndex = (sugIndex + sugs.length - 1) % sugs.length; renderSugs(); e.preventDefault(); e.stopPropagation(); return; }
      if (e.key === 'Tab' || e.key === 'Enter') { acceptSug(sugIndex); e.preventDefault(); e.stopPropagation(); return; }
      if (e.key === 'Escape') { sugs = []; renderSugs(); e.stopPropagation(); return; }
    }
    // typing ")" right before an existing ")" just steps over it,
    // so autocompleted sin() doesn't end up as sin(x))
    if (e.key === ')' && input.value[input.selectionStart] === ')' &&
        input.selectionStart === input.selectionEnd) {
      input.setSelectionRange(input.selectionStart + 1, input.selectionStart + 1);
      e.preventDefault();
      e.stopPropagation();
      refresh();
      return;
    }
    if (e.key === 'Enter') go();
    if (e.key === 'Escape') closeGraphInput();
    e.stopPropagation();
  });
  input.addEventListener('input', refresh);
  input.addEventListener('click', refresh);

  if (typeof prefill === 'string') input.value = prefill;
  graphEditTarget = editId || null;
  refresh();
  input.focus();
  if (prefill) input.setSelectionRange(input.value.length, input.value.length);
}

/* --- movable toolbar --- */

function initToolbarDrag(grip) {
  try {
    const saved = JSON.parse(localStorage.getItem('geo.ui.toolpos'));
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) placeToolwrap(saved.x, saved.y);
  } catch {}
  let start = null;
  grip.addEventListener('pointerdown', (e) => {
    grip.setPointerCapture(e.pointerId);
    const r = toolwrap.getBoundingClientRect();
    start = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    e.preventDefault();
  });
  grip.addEventListener('pointermove', (e) => {
    if (!start) return;
    placeToolwrap(e.clientX - start.dx, e.clientY - start.dy);
  });
  grip.addEventListener('pointerup', () => {
    if (!start) return;
    start = null;
    const r = toolwrap.getBoundingClientRect();
    try { localStorage.setItem('geo.ui.toolpos', JSON.stringify({ x: r.left, y: r.top })); } catch {}
  });
}

function placeToolwrap(x, y) {
  const r = toolwrap.getBoundingClientRect();
  x = Math.max(4, Math.min(window.innerWidth - r.width - 4, x));
  y = Math.max(4, Math.min(window.innerHeight - 60, y));
  toolwrap.classList.add('moved');
  toolwrap.style.left = x + 'px';
  toolwrap.style.top = y + 'px';
}

function setTool(t) {
  cancelPending(true);
  tool = t;
  clearSelection();
  updateToolbar();
  requestDraw();
}

function updateHint(msg) {
  if (msg !== undefined) { hintEl.textContent = msg; return; }
  let key = tool;
  if (tool === 'line' || tool === 'circle') key = tool + '-' + Math.min(pending.length, 1);
  if (tool === 'polygon') {
    if (typeof polyMode === 'number') {
      hintEl.textContent = pending.length === 0
        ? `Tap the center of the ${polyMode}-gon`
        : 'Tap where a corner should be · Esc to cancel';
      return;
    }
    key = 'polygon-' + (pending.length === 0 ? '0' : 'n');
  }
  if (tool === 'move' && engine.objects.size === 0 && !selection.length) {
    hintEl.textContent = 'Empty canvas — pick a tool above, or press ? for a 1-minute guide';
    return;
  }
  if (tool === 'move' && !selection.length && engine.objects.size > 0) {
    hintEl.textContent = 'Click things to select · drag empty space to box-select · shift-drag to pan';
    return;
  }
  hintEl.textContent = HINTS[key] || '';
}

/* Esc mid-construction: pop exactly the undo steps this op created. */
function cancelPending(restore) {
  if (pending.length && restore) {
    while (opCommits > 0 && undoStack.length) {
      lastCommitted = undoStack.pop();
      opCommits--;
    }
    engine = Engine.deserialize(JSON.parse(lastCommitted));
    updateUndoButtons();
    scheduleSave();
  }
  pending = [];
  opCommits = 0;
  updateHint();
  requestDraw();
}

/* one tool click at a snap result; every click is its own undo step */
function toolClick(snap) {
  if (tool === 'point') {
    snap.make();
    commit();
    return;
  }

  // second click of the line tool on a ⊥/∥ snap: build a LINKED construction —
  // the endpoint rides a (hidden) perpendicular/parallel line, so the relation
  // survives dragging. "Unlink" on the result breaks it.
  if (tool === 'line' && pending.length === 1 && snap.kind === 'direction' && snap.refId && snap.rel) {
    const A = engine.get(pending[0]);
    const ref = engine.get(snap.refId);
    if (A && ref) {
      const guide = engine.add({
        type: 'line',
        kind: snap.rel === 'perp' ? 'perpThrough' : 'parallelThrough',
        parents: [A.id, ref.id], params: {},
        hidden: lineMode === 'segment',
      });
      if (lineMode === 'segment') {
        const proj = engine.projectOntoPath(snap.world, guide);
        const B = engine.add({
          type: 'point', kind: 'onPath', parents: [guide.id],
          params: { t: proj ? proj.t : 0 },
        });
        engine.add({ type: 'segment', kind: 'twoPoint', parents: [A.id, B.id], params: {} });
      }
      commit();
      pending = []; opCommits = 0;
      updateHint((snap.rel === 'perp' ? 'Linked ⊥ to ' : 'Linked ∥ to ') + nameOf(ref) +
        ' — it stays that way when dragged. Select it and press Unlink to break the link');
      requestDraw();
      return;
    }
  }

  if (pending.length === 0) opCommits = 0;
  const before = engine.objects.size;
  const pid = snap.make();
  if (engine.objects.size > before) { commit(); opCommits++; }

  if (tool === 'line') {
    pending.push(pid);
    if (pending.length === 2) {
      if (pending[0] !== pending[1]) {
        engine.add({ type: lineMode, kind: 'twoPoint', parents: [...pending], params: {} });
        commit();
      }
      pending = []; opCommits = 0;
    }
  } else if (tool === 'circle') {
    pending.push(pid);
    if (pending.length === 2) {
      if (pending[0] !== pending[1]) {
        engine.add({ type: 'circle', kind: 'centerPoint2', parents: [...pending], params: {} });
        commit();
      }
      pending = []; opCommits = 0;
    }
  } else if (tool === 'polygon') {
    if (typeof polyMode === 'number') {
      // preset: first click = center, second click = a vertex
      pending.push(pid);
      if (pending.length === 2) {
        if (pending[0] !== pending[1]) {
          buildRegularPolygon(pending[0], pending[1], polyMode);
          commit();
        }
        pending = []; opCommits = 0;
      }
    } else {
      if (pending.length >= 3 && pid === pending[0]) {
        closePolygon();
        return;
      }
      if (!pending.includes(pid)) pending.push(pid);
    }
  }
  updateHint();
  requestDraw();
}

function closePolygon() {
  const ids = [...pending];
  for (let i = 0; i < ids.length; i++) {
    const a = ids[i], b = ids[(i + 1) % ids.length];
    if (!segmentExists(a, b)) {
      engine.add({ type: 'segment', kind: 'twoPoint', parents: [a, b], params: {} });
    }
  }
  engine.add({ type: 'polygon', kind: 'fromVertices', parents: ids, params: {} });
  pending = []; opCommits = 0;
  commit();
  updateHint();
}

function segmentExists(a, b) {
  for (const o of engine.objects.values()) {
    if (o.type === 'segment' &&
        ((o.parents[0] === a && o.parents[1] === b) || (o.parents[0] === b && o.parents[1] === a))) return true;
  }
  return false;
}

/* ================= selection & context actions ================= */

function clearSelection() { selection = []; renderContextbar(); }

function toggleSelect(id, additive) {
  if (!additive) {
    selection = selection.length === 1 && selection[0] === id ? [] : [id];
  } else {
    const i = selection.indexOf(id);
    if (i >= 0) selection.splice(i, 1); else selection.push(id);
  }
  renderContextbar();
  updateHint();
  requestDraw();
}

function selObjs() { return selection.map((id) => engine.get(id)).filter(Boolean); }

function renderContextbar() {
  const objs = selObjs();
  contextbar.innerHTML = '';
  if (!objs.length) { contextbar.hidden = true; return; }

  const pts = objs.filter((o) => o.type === 'point');
  const segs = objs.filter((o) => o.type === 'segment');
  const linears = objs.filter((o) => o.type === 'segment' || o.type === 'line' || o.type === 'ray');
  const circles = objs.filter((o) => o.type === 'circle');
  const funcs = objs.filter((o) => o.type === 'function');
  const curves = linears.length + circles.length + funcs.length;
  const actions = [];

  const label = (o) => o.label || '';

  if (objs.length === 1 && segs.length === 1) {
    const s = segs[0];
    actions.push(['Midpoint', () => { makeSpecialPoint('segMidpoint', [s.id], {}); commit(); }]);
    actions.push(['⊥ bisector', () => { engine.add({ type: 'line', kind: 'perpBisector', parents: [s.id], params: {} }); commit(); }]);
    actions.push(['divider', null]);
  }
  if (pts.length === 2) {
    const [a, b] = pts;
    actions.push(['Segment', () => { engine.add({ type: 'segment', kind: 'twoPoint', parents: [a.id, b.id], params: {} }); commit(); }]);
    actions.push(['Midpoint', () => { makeSpecialPoint('midpoint', [a.id, b.id], {}); commit(); }]);
    actions.push(['⊥ bisector', () => { engine.add({ type: 'line', kind: 'perpBisector', parents: [a.id, b.id], params: {} }); commit(); }]);
    actions.push([`Circle ${label(a)}→${label(b)}`, () => { engine.add({ type: 'circle', kind: 'centerPoint2', parents: [a.id, b.id], params: {} }); commit(); }]);
    const d = V.dist(a, b) / U;
    addInfo(`|${label(a)}${label(b)}| = ${d.toFixed(2)}`);
  }
  if (pts.length === 1 && linears.length >= 1) {
    const p = pts[0], l = linears[0];
    actions.push(['⊥ through ' + label(p), () => { engine.add({ type: 'line', kind: 'perpThrough', parents: [p.id, l.id], params: {} }); commit(); }]);
    actions.push(['⊥ + foot', () => {
      const perp = engine.add({ type: 'line', kind: 'perpThrough', parents: [p.id, l.id], params: {} });
      engine.add({ type: 'point', kind: 'intersection', parents: [perp.id, l.id], params: { branch: 0 } });
      commit();
    }]);
    actions.push(['∥ through ' + label(p), () => { engine.add({ type: 'line', kind: 'parallelThrough', parents: [p.id, l.id], params: {} }); commit(); }]);
  }
  if (pts.length === 3) {
    const [a, v, b] = pts;
    actions.push(['Triangle', () => {
      const ids = [a.id, v.id, b.id];
      for (let i = 0; i < 3; i++) {
        if (!segmentExists(ids[i], ids[(i + 1) % 3])) {
          engine.add({ type: 'segment', kind: 'twoPoint', parents: [ids[i], ids[(i + 1) % 3]], params: {} });
        }
      }
      engine.add({ type: 'polygon', kind: 'fromVertices', parents: ids, params: {} });
      commit();
    }]);
    actions.push([`Angle at ${label(v)}`, () => { engine.add({ type: 'angle', kind: 'threePoint', parents: [a.id, v.id, b.id], params: {} }); commit(); }]);
    actions.push([`Bisector at ${label(v)}`, () => { engine.add({ type: 'ray', kind: 'angleBisector', parents: [a.id, v.id, b.id], params: {} }); commit(); }]);
    actions.push(['◯ through 3', () => { engine.add({ type: 'circle', kind: 'circum3', parents: [a.id, v.id, b.id], params: {} }); commit(); }]);
  }
  if (pts.length >= 4) {
    // any 4+ points (e.g. gliders along a graph) → close them into a shape
    actions.push(['Shape from points', () => {
      const ids = pts.map((p) => p.id);
      for (let i = 0; i < ids.length; i++) {
        if (!segmentExists(ids[i], ids[(i + 1) % ids.length])) {
          engine.add({ type: 'segment', kind: 'twoPoint', parents: [ids[i], ids[(i + 1) % ids.length]], params: {} });
        }
      }
      engine.add({ type: 'polygon', kind: 'fromVertices', parents: ids, params: {} });
      commit();
    }]);
  }
  if (curves === 2 && pts.length === 0) {
    const [a, b] = [...linears, ...circles, ...funcs];
    actions.push(['Intersect', () => {
      const ipts = engine.intersectObjects(a, b);
      for (let i = 0; i < ipts.length; i++) {
        engine.add({
          type: 'point', kind: 'intersection', parents: [a.id, b.id],
          params: { branch: i }, x: ipts[i].x, y: ipts[i].y,
        });
      }
      commit();
    }]);
  }
  if (circles.length === 1 && objs.length === 1) {
    const c = circles[0];
    actions.push(['Center', () => { makeSpecialPoint('centerPoint', [c.id], {}); commit(); }]);
    addInfo('r = ' + (c.r / U).toFixed(2));
  }
  if (funcs.length === 1 && objs.length === 1) {
    const f = funcs[0];
    actions.push(['Edit f(x)', () => { toggleGraphInput(f.params.expr, f.id); }]);
  }
  if (pts.length === 1 && objs.length === 1) {
    // a point that lives on a line (midpoint, n-section, glider, foot, …)
    // can raise a perpendicular there directly — no second selection needed
    const p = pts[0];
    const isLin = (t) => t === 'segment' || t === 'line' || t === 'ray';
    const hosts = (p.parents || []).map((id) => engine.get(id)).filter((o) => o && isLin(o.type));
    for (const l of hosts) {
      actions.push(['⊥ here' + (l.label ? ' to ' + l.label : hosts.length > 1 ? ' (' + l.type + ')' : ''), () => {
        engine.add({ type: 'line', kind: 'perpThrough', parents: [p.id, l.id], params: {} });
        commit();
      }]);
    }
    if (!engine.isDraggable(p)) addInfo(describeKind(p));
  }
  if (objs.length === 1) {
    addInfo('click another object to add it → more actions');
  }

  for (const [name, fn] of actions) {
    if (name === 'divider') { addDivideStepper(segs[0]); continue; }
    const b = document.createElement('button');
    b.textContent = name;
    b.addEventListener('click', () => { fn(); renderContextbar(); requestDraw(); });
    contextbar.appendChild(b);
  }

  // Unlink: break an object's dependence on what it was built from.
  // A segment unlinks by freeing its constrained endpoints (e.g. the one that
  // rides a hidden ⊥ guide); other objects freeze in place.
  const hasDerivedEndpoint = (o) =>
    o.parents.some((pid) => { const p = engine.get(pid); return p && p.type === 'point' && p.kind !== 'free'; });
  const canUnlink = objs.some((o) =>
    (o.type === 'point' && o.kind !== 'free') ||
    ((o.type === 'line' || o.type === 'ray') && o.kind !== 'frozen' &&
      (o.kind !== 'twoPoint' || hasDerivedEndpoint(o))) ||
    (o.type === 'circle' && o.kind !== 'frozen') ||
    (o.type === 'segment' && o.kind === 'twoPoint' && hasDerivedEndpoint(o)) ||
    (o.type === 'polygon' && hasDerivedEndpoint(o)));
  if (canUnlink) {
    const ub = document.createElement('button');
    ub.textContent = '🔗 Unlink';
    ub.title = 'Break the link to what this was built from — it keeps its current position';
    ub.addEventListener('click', unlinkSelection);
    contextbar.appendChild(ub);
  }

  // universal: hide, delete
  const hideB = document.createElement('button');
  hideB.textContent = 'Hide';
  hideB.addEventListener('click', hideSelection);
  contextbar.appendChild(hideB);

  const delB = document.createElement('button');
  delB.textContent = 'Delete';
  delB.className = 'danger';
  delB.addEventListener('click', deleteSelection);
  contextbar.appendChild(delB);

  contextbar.hidden = false;

  function addInfo(text) {
    const s = document.createElement('button');
    s.textContent = text;
    s.style.background = 'transparent';
    s.style.color = 'var(--muted)';
    s.style.cursor = 'default';
    contextbar.appendChild(s);
  }
}

function addDivideStepper(seg) {
  const wrap = document.createElement('div');
  wrap.className = 'stepper';
  const minus = document.createElement('button'); minus.textContent = '−';
  const label = document.createElement('span'); label.textContent = '÷' + divideN;
  const plus = document.createElement('button'); plus.textContent = '+';
  const go = document.createElement('button'); go.textContent = 'Divide';
  minus.addEventListener('click', () => { divideN = Math.max(2, divideN - 1); label.textContent = '÷' + divideN; });
  plus.addEventListener('click', () => { divideN = Math.min(12, divideN + 1); label.textContent = '÷' + divideN; });
  go.addEventListener('click', () => {
    for (let k = 1; k < divideN; k++) {
      if (k * 2 === divideN) makeSpecialPoint('segMidpoint', [seg.id], {});
      else makeSpecialPoint('segNsection', [seg.id], { k, n: divideN });
    }
    commit(); renderContextbar(); requestDraw();
  });
  wrap.append(minus, label, plus, go);
  contextbar.appendChild(wrap);
}

function describeKind(o) {
  switch (o.kind) {
    case 'midpoint': case 'segMidpoint': return 'Midpoint (derived)';
    case 'segNsection': return `${o.params.k}/${o.params.n} point (derived)`;
    case 'intersection': return 'Intersection (derived)';
    case 'centerPoint': return 'Center (derived)';
    case 'onPath': return 'On path — drag along it';
    default: return 'Derived point';
  }
}

function unlinkSelection() {
  let changed = 0;
  const cleanupHidden = (ids) => {
    for (const hid of ids) {
      const h = engine.get(hid);
      if (h && h.hidden && engine.children(hid).length === 0) engine.delete(hid);
    }
  };
  const freeVertices = (o) => {
    for (const pid of o.parents) {
      const p = engine.get(pid);
      if (p && p.type === 'point' && p.kind !== 'free') {
        const hosts = [...(p.parents || [])];
        if (engine.detach(pid)) { changed++; cleanupHidden(hosts); }
      }
    }
  };
  for (const id of [...selection]) {
    const o = engine.get(id);
    if (!o) continue;
    // segments/lines/polygons unlink by freeing their derived defining points
    // (so a regular polygon becomes n independent draggable corners)
    if (o.kind === 'twoPoint' || o.type === 'polygon') {
      freeVertices(o);
      continue;
    }
    const hosts = [...(o.parents || [])];
    if (engine.detach(id)) { changed++; cleanupHidden(hosts); }
  }
  if (changed) {
    commit();
    updateHint('Unlinked — it now moves on its own');
  }
  renderContextbar();
  requestDraw();
}

function hideSelection() {
  if (!selection.length) return;
  for (const o of selObjs()) o.hidden = true;
  clearSelection();
  commit();
  requestDraw();
}

/* arrow-key nudge: move selected draggable points; commits once, debounced */
let nudgeTimer = null;

function nudgeSelection(dx, dy) {
  let moved = false;
  for (const o of selObjs()) {
    if (o.type === 'point' && engine.isDraggable(o) && o.kind !== 'onPath') {
      engine.moveFree(o.id, o.x + dx, o.y + dy);
      moved = true;
    }
  }
  if (!moved) return false;
  requestDraw();
  clearTimeout(nudgeTimer);
  nudgeTimer = setTimeout(() => { commit(); renderContextbar(); }, 500);
  return true;
}

function zoomBy(factor) {
  const cx = canvas.clientWidth / 2, cy = canvas.clientHeight / 2;
  const wp = s2w({ x: cx, y: cy });
  view.scale = Math.min(40, Math.max(0.05, view.scale * factor));
  view.tx = cx - wp.x * view.scale;
  view.ty = cy - wp.y * view.scale;
  requestDraw();
}

function deleteSelection() {
  for (const id of [...selection]) engine.delete(id);
  clearSelection();
  commit();
  updateHint();
  requestDraw();
}

/* ================= pointer interaction ================= */

let marqueeRect = null;   // screen-space rect while shift-drag selecting
let pdown = null;    // {screen, world, obj, moved, mode}
let pinch = null;    // {d0, scale0, mid0, tx0, ty0}
const activePointers = new Map();

canvas.addEventListener('pointerdown', (e) => {
  if (document.getElementById('shapeMenu')) { closeShapeMenu(); return; }
  canvas.setPointerCapture(e.pointerId);
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (activePointers.size === 2) {
    const [p1, p2] = [...activePointers.values()];
    pinch = {
      d0: V.dist(p1, p2), scale0: view.scale,
      mid0: V.mid(p1, p2), tx0: view.tx, ty0: view.ty,
      midW: s2w(V.mid(p1, p2)),
    };
    pdown = null;
    return;
  }

  const sp = { x: e.clientX, y: e.clientY };
  const obj = hitTest(sp);
  pdown = {
    screen: sp, world: s2w(sp), obj, moved: false,
    shift: isShift(e), mode: null, id: e.pointerId,
  };

  if (obj && obj.type === 'point' && isShift(e)) {
    // shift-drag from a point: rubber-band a shape centered there
    pdown.mode = 'shiftCircle';
  } else if (obj && obj.type === 'point' && engine.isDraggable(obj)) {
    pdown.mode = 'maybeDragPoint';
  } else if (!obj && tool === 'move' && !isShift(e)) {
    // Move mode: dragging on empty canvas box-selects by default
    // (shift-drag pans instead; other tools always pan on empty drag)
    pdown.mode = 'marquee';
  } else {
    pdown.mode = 'maybePan';
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (activePointers.has(e.pointerId)) {
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }
  if (pinch && activePointers.size === 2) {
    const [p1, p2] = [...activePointers.values()];
    const d = V.dist(p1, p2);
    const mid = V.mid(p1, p2);
    view.scale = Math.min(40, Math.max(0.05, pinch.scale0 * (d / Math.max(pinch.d0, 1))));
    view.tx = mid.x - pinch.midW.x * view.scale;
    view.ty = mid.y - pinch.midW.y * view.scale;
    requestDraw();
    return;
  }

  const sp = { x: e.clientX, y: e.clientY };
  cursorWorld = s2w(sp);

  if (pdown && pdown.id === e.pointerId) {
    if (!pdown.moved && V.dist(sp, pdown.screen) > 4) pdown.moved = true;

    if (pdown.moved) {
      if (pdown.mode === 'maybeDragPoint' || pdown.mode === 'dragPoint') {
        if (pdown.mode === 'maybeDragPoint') {
          pdown.mode = 'dragPoint';
          canvas.classList.add('dragging');
          // never snap to yourself or anything built from you; a center-drag
          // also carries its polygon's rim, so exclude that family too
          const roots = [pdown.obj.id];
          if (pdown.obj.kind === 'free') {
            for (const c of engine.objects.values()) {
              if (c.kind === 'regularVertex' && c.parents[0] === pdown.obj.id) roots.push(c.parents[1]);
            }
          }
          snapExclude = descendantsOf(...roots);
        }
        const wp = s2w(sp);
        if (pdown.obj.kind === 'free') {
          // full snapping while dragging: points, midpoints, intersections,
          // curves, grid — same named previews as when placing
          const snap = findSnap(sp);
          const use = snap.kind !== 'free' ? snap.world : wp;
          engine.moveFree(pdown.obj.id, use.x, use.y);
          snapPreview = snap.kind !== 'free'
            ? { kind: snap.kind, label: snap.label, world: snap.world } : null;
        } else {
          engine.moveFree(pdown.obj.id, wp.x, wp.y);
          snapPreview = null;
        }
        requestDraw();
        return;
      }
      if (pdown.mode === 'maybePan' || pdown.mode === 'pan') {
        pdown.mode = 'pan';
        view.tx += sp.x - pdown.screen.x;
        view.ty += sp.y - pdown.screen.y;
        pdown.screen = sp;
        requestDraw();
        return;
      }
      if (pdown.mode === 'shiftCircle') {
        const wp = s2w(sp);
        const rs = radiusSnap(pdown.obj, wp);
        pdown.circlePreview = rs ? rs.world : wp;
        snapPreview = rs ? { kind: 'radius', label: rs.label, world: rs.world } : null;
        requestDraw();
        return;
      }
      if (pdown.mode === 'marquee') {
        marqueeRect = { x1: pdown.screen.x, y1: pdown.screen.y, x2: sp.x, y2: sp.y };
        requestDraw();
        return;
      }
    }
    return;
  }

  // hover feedback (no button down)
  const prevHover = hoverId, prevSnap = snapPreview && snapPreview.label;
  if (tool === 'move') {
    const obj = hitTest(sp);
    hoverId = obj ? obj.id : null;
    snapPreview = null;
    canvas.classList.toggle('over-draggable', !!(obj && obj.type === 'point' && engine.isDraggable(obj)));
  } else {
    snapPreview = resolveSnap(sp);
    const obj = hitTest(sp);
    hoverId = obj && obj.type !== 'point' ? null : (obj ? obj.id : null);
  }
  if (hoverId !== prevHover || (snapPreview && snapPreview.label) !== prevSnap || pending.length) requestDraw();
});

canvas.addEventListener('pointerup', (e) => {
  activePointers.delete(e.pointerId);
  if (pinch) { if (activePointers.size < 2) pinch = null; return; }
  if (!pdown || pdown.id !== e.pointerId) return;
  const p = pdown; pdown = null;
  canvas.classList.remove('dragging');

  const sp = { x: e.clientX, y: e.clientY };

  if (p.mode === 'dragPoint') { snapPreview = null; snapExclude = null; commit(); return; }

  if (p.mode === 'marquee') {
    if (!p.moved || !marqueeRect) {
      // no drag happened: a plain click — a point's name label edits in
      // place; anything else on empty space clears the selection
      marqueeRect = null;
      const labeled = labelHitAt(sp);
      if (labeled) { openRenameInput(labeled); return; }
      clearSelection();
      updateHint();
      requestDraw();
      return;
    }
    {
      const r = marqueeRect;
      marqueeRect = null;
      const x1 = Math.min(r.x1, r.x2), x2 = Math.max(r.x1, r.x2);
      const y1 = Math.min(r.y1, r.y2), y2 = Math.max(r.y1, r.y2);
      const inRect = (w) => { const s = w2s(w); return s.x >= x1 && s.x <= x2 && s.y >= y1 && s.y <= y2; };
      for (const id of engine.order) {
        const o = engine.get(id);
        if (!o || !o.valid || o.hidden || selection.includes(id)) continue;
        let hit = false;
        if (o.type === 'point') hit = inRect(o);
        else if (o.type === 'segment') hit = inRect({ x: o.ax, y: o.ay }) && inRect({ x: o.bx, y: o.by });
        else if (o.type === 'circle') hit = inRect({ x: o.cx, y: o.cy });
        else if (o.type === 'polygon') hit = o.pts && o.pts.every(inRect);
        if (hit) selection.push(id);
      }
      renderContextbar();
      updateHint();
      requestDraw();
    }
    return;
  }

  if (p.mode === 'shiftCircle') {
    snapPreview = null;
    if (p.moved) {
      let snap = findSnap(sp);
      if (snap.kind === 'free' || snap.kind === 'grid') {
        const rs = radiusSnap(p.obj, s2w(sp));
        if (rs) snap = { kind: 'radius', label: rs.label, world: rs.world, make: () => makeFreePoint(rs.world) };
      }
      openShapeMenu(p.obj, snap, sp);
    } else {
      // no drag happened: it was a plain shift-click — multi-select
      toggleSelect(p.obj.id, true);
    }
    requestDraw();
    return;
  }

  if (p.moved) return; // pan ended

  // plain click
  if (tool === 'move') {
    // selection is additive by default: each click toggles the object
    // in/out of the selection; clicking empty space clears it.
    // clicking a point's name label edits the name in place instead.
    if (p.obj) toggleSelect(p.obj.id, true);
    else {
      const labeled = labelHitAt(sp);
      if (labeled) { openRenameInput(labeled); return; }
      clearSelection(); updateHint(); requestDraw();
    }
    return;
  }
  const snap = resolveSnap(sp);
  toolClick(snap);
});

canvas.addEventListener('pointercancel', (e) => {
  activePointers.delete(e.pointerId);
  pinch = null;
  if (pdown && pdown.id === e.pointerId) pdown = null;
  snapExclude = null;
  canvas.classList.remove('dragging');
});

// double-click a graph to edit its formula; double-click a point to rename it
canvas.addEventListener('dblclick', (e) => {
  const obj = hitTest({ x: e.clientX, y: e.clientY });
  if (!obj) return;
  if (obj.type === 'function') {
    toggleGraphInput(obj.params.expr, obj.id);
  } else if (obj.type === 'point') {
    openRenameInput(obj);
  }
});

/* was the click on a point's name label? (labels draw at point + (8,-8)) */
function labelHitAt(sp) {
  ctx.font = '600 12px system-ui, sans-serif';
  for (const id of engine.order) {
    const o = engine.get(id);
    if (!o || o.type !== 'point' || !o.valid || o.hidden || !o.label) continue;
    const s = w2s(o);
    const w = ctx.measureText(o.label).width;
    if (sp.x >= s.x + 5 && sp.x <= s.x + 11 + w &&
        sp.y >= s.y - 22 && sp.y <= s.y - 2) return o;
  }
  return null;
}

/* inline rename box, floating right next to the point itself */
function closeRenameInput() {
  const el = document.getElementById('renameInput');
  if (el) el.remove();
}

function openRenameInput(pt) {
  closeRenameInput();
  const s = w2s(pt);
  const inp = document.createElement('input');
  inp.id = 'renameInput';
  inp.value = pt.label || '';
  inp.maxLength = 16;
  inp.spellcheck = false;
  inp.setAttribute('aria-label', 'Point name');
  // sit right where the label is drawn, so it edits "in place"
  inp.style.left = Math.max(6, Math.min(window.innerWidth - 120, s.x + 4)) + 'px';
  inp.style.top = Math.max(6, Math.min(window.innerHeight - 44, s.y - 36)) + 'px';
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    if (save) {
      const name = inp.value.trim().slice(0, 16);
      if (name !== (pt.label || '')) { pt.label = name; commit(); }
    }
    inp.remove();
    requestDraw();
  };
  inp.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') finish(true);
    else if (ev.key === 'Escape') finish(false);
    ev.stopPropagation();
  });
  inp.addEventListener('blur', () => finish(true));
  document.getElementById('stage').appendChild(inp);
  inp.focus();
  inp.select();
}

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const factor = Math.exp(-e.deltaY * 0.0015);
  const ns = Math.min(40, Math.max(0.05, view.scale * factor));
  const wp = s2w({ x: e.clientX, y: e.clientY });
  view.scale = ns;
  view.tx = e.clientX - wp.x * ns;
  view.ty = e.clientY - wp.y * ns;
  requestDraw();
}, { passive: false });

/* regular n-gon: rim is vertex 0, the rest are dependent points spun around the center */
function buildRegularPolygon(centerId, rimId, n) {
  const vids = [rimId];
  for (let i = 1; i < n; i++) {
    vids.push(engine.add({
      type: 'point', kind: 'regularVertex',
      parents: [centerId, rimId], params: { i, n },
    }).id);
  }
  for (let i = 0; i < n; i++) {
    engine.add({ type: 'segment', kind: 'twoPoint', parents: [vids[i], vids[(i + 1) % n]], params: {} });
  }
  engine.add({ type: 'polygon', kind: 'fromVertices', parents: vids, params: {} });
}

/* ================= shape menu (after shift-drag from a point) ================= */

let shapePreview = null; // {center:{x,y}, rim:{x,y}} kept while the menu is open

function openShapeMenu(centerObj, rimSnap, screenPt) {
  closeShapeMenu();
  shapePreview = { center: { x: centerObj.x, y: centerObj.y }, rim: rimSnap.world };
  const menu = document.createElement('div');
  menu.id = 'shapeMenu';
  const mkBtn = (txt, title, fn) => {
    const b = document.createElement('button');
    b.textContent = txt; b.title = title;
    b.addEventListener('click', fn);
    menu.appendChild(b);
    return b;
  };
  const finish = (fn) => { fn(); closeShapeMenu(); commit(); updateHint(); };
  const makeNgon = (n) => finish(() => {
    const rimId = rimSnap.make();
    if (rimId !== centerObj.id) buildRegularPolygon(centerObj.id, rimId, n);
  });
  mkBtn('◯', 'Circle', () => finish(() => {
    const rimId = rimSnap.make();
    if (rimId !== centerObj.id) {
      engine.add({ type: 'circle', kind: 'centerPoint2', parents: [centerObj.id, rimId], params: {} });
    }
  }));
  mkBtn('△', 'Equilateral triangle', () => makeNgon(3));
  mkBtn('◻', 'Square', () => makeNgon(4));
  mkBtn('⬠', 'Regular pentagon', () => makeNgon(5));
  mkBtn('⬡', 'Regular hexagon', () => makeNgon(6));
  const inp = document.createElement('input');
  inp.type = 'number'; inp.min = '3'; inp.max = '60'; inp.placeholder = 'n';
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const n = Math.max(3, Math.min(60, parseInt(inp.value, 10) || 0));
      if (n >= 3) makeNgon(n);
    }
    if (e.key === 'Escape') closeShapeMenu();
    e.stopPropagation();
  });
  menu.appendChild(inp);
  document.getElementById('stage').appendChild(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.max(6, Math.min(window.innerWidth - r.width - 6, screenPt.x + 14)) + 'px';
  menu.style.top = Math.max(6, Math.min(window.innerHeight - r.height - 6, screenPt.y - r.height / 2)) + 'px';
  updateHint('Pick a shape — center stays at ' + (centerObj.label || 'the point') + ' · Esc cancels');
}

function closeShapeMenu() {
  const m = document.getElementById('shapeMenu');
  if (m) m.remove();
  shapePreview = null;
  requestDraw();
}

/* ================= undo / redo / commit ================= */

function snapshot() { return JSON.stringify(engine.serialize()); }

function commit() {
  undoStack.push(lastCommitted);
  if (undoStack.length > 100) undoStack.shift();
  redoStack = [];
  lastCommitted = snapshot();
  updateUndoButtons();
  scheduleSave();
  requestDraw();
}

let lastCommitted = null;

function undo() {
  if (!undoStack.length) return;
  cancelPending(false);
  redoStack.push(lastCommitted);
  lastCommitted = undoStack.pop();
  engine = Engine.deserialize(JSON.parse(lastCommitted));
  clearSelection();
  updateUndoButtons();
  scheduleSave();
  requestDraw();
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(lastCommitted);
  lastCommitted = redoStack.pop();
  engine = Engine.deserialize(JSON.parse(lastCommitted));
  clearSelection();
  updateUndoButtons();
  scheduleSave();
  requestDraw();
}

function updateUndoButtons() {
  document.getElementById('btnUndo').disabled = !undoStack.length;
  document.getElementById('btnRedo').disabled = !redoStack.length;
}

/* ================= persistence ================= */

let saveTimer = null;

function scheduleSave() {
  saveStateEl.textContent = '';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(doSave, 500);
}

function doSave() {
  const data = engine.serialize();
  const hasContent = data.objects.length > 0;
  Store.autosave({ fileId: currentFileId, name: docName, data });
  if (hasContent) {
    const meta = Store.saveFile(currentFileId, docName, data, makeThumb());
    if (meta) { currentFileId = meta.id; saveStateEl.textContent = 'saved'; }
    else saveStateEl.textContent = 'storage full';
  }
}

function makeThumb() {
  try {
    const t = document.createElement('canvas');
    t.width = 104; t.height = 80;
    const tc = t.getContext('2d');
    // center-crop the canvas to the thumb's aspect ratio (no squashing)
    const aspect = 104 / 80;
    let sw = canvas.width, sh = canvas.height, sx = 0, sy = 0;
    if (sw / sh > aspect) { sw = sh * aspect; sx = (canvas.width - sw) / 2; }
    else { sh = sw / aspect; sy = (canvas.height - sh) / 2; }
    tc.drawImage(canvas, sx, sy, sw, sh, 0, 0, 104, 80);
    return t.toDataURL('image/jpeg', 0.6);
  } catch { return null; }
}

function loadDoc(fileId, name, data) {
  cancelPending(false);
  engine = data ? Engine.deserialize(data) : new Engine();
  currentFileId = fileId;
  docName = name || 'Untitled';
  docNameEl.value = docName;
  fitDocName();
  undoStack = []; redoStack = [];
  lastCommitted = snapshot();
  clearSelection();
  updateUndoButtons();
  updateHint();
  requestDraw();
}

function newDoc() {
  doSave();
  loadDoc(null, 'Untitled', null);
  closeFiles();
}

/* files panel */

function openFiles() {
  renderFiles();
  filesPanel.hidden = false;
  // if the toolbar sits where the panel opens, nudge it out of the way
  const panelW = Math.min(320, window.innerWidth * 0.92);
  const r = toolwrap.getBoundingClientRect();
  if (r.left < panelW + 12) {
    toolwrap.style.transition = 'margin-left .2s';
    toolwrap.style.marginLeft = (panelW + 12 - r.left) + 'px';
  }
}
function closeFiles() {
  filesPanel.hidden = true;
  toolwrap.style.marginLeft = '';
}

function renderFiles() {
  const files = Store.listFiles();
  filesList.innerHTML = '';
  if (!files.length) {
    filesList.innerHTML = '<div class="empty-note">Nothing saved yet.<br>Constructions save automatically as you work.</div>';
    return;
  }
  for (const f of files) {
    const row = document.createElement('div');
    row.className = 'file-row';
    const img = document.createElement('img');
    if (f.thumb) img.src = f.thumb;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.innerHTML = '<b></b><small></small>';
    meta.querySelector('b').textContent = f.name || 'Untitled';
    meta.querySelector('small').textContent = new Date(f.updatedAt).toLocaleString();
    const del = document.createElement('button');
    del.className = 'del';
    del.textContent = '🗑';
    del.title = 'Delete';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm('Delete "' + (f.name || 'Untitled') + '"?')) return;
      Store.deleteFile(f.id);
      if (currentFileId === f.id) {
        // the open file was deleted: clear the canvas too, and the autosave,
        // so the work doesn't linger or resurrect the file on next save
        clearTimeout(saveTimer);
        loadDoc(null, 'Untitled', null);
        Store.autosave({ fileId: null, name: 'Untitled', data: engine.serialize() });
      }
      renderFiles();
    });
    row.append(img, meta, del);
    row.addEventListener('click', () => {
      doSave();
      const data = Store.loadFile(f.id);
      if (data) { loadDoc(f.id, f.name, data); closeFiles(); }
    });
    filesList.appendChild(row);
  }
}

function exportFile() {
  const blob = new Blob([JSON.stringify({ name: docName, data: engine.serialize() }, null, 1)],
    { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (docName || 'construction') + '.geometry.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function importFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      const data = parsed.data || parsed;
      doSave();
      loadDoc(null, parsed.name || file.name.replace(/\.geometry\.json$|\.json$/i, ''), data);
      doSave();
      closeFiles();
    } catch { alert('Could not read that file.'); }
  };
  reader.readAsText(file);
}

/* ================= keyboard ================= */

window.addEventListener('keydown', (e) => {
  if (e.target === docNameEl) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if ((mod && e.key.toLowerCase() === 'y') || (mod && e.shiftKey && e.key.toLowerCase() === 'z')) { e.preventDefault(); redo(); }
  else if (e.key === 'Escape') {
    if (document.getElementById('shapeMenu')) closeShapeMenu();
    else if (pending.length) cancelPending(true);
    else if (!filesPanel.hidden) closeFiles();
    else { clearSelection(); requestDraw(); }
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && selection.length) {
    e.preventDefault();
    deleteSelection();
  } else if (e.key.startsWith('Arrow') && selection.length) {
    const step = (e.shiftKey ? 25 : 5) / view.scale;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (d && nudgeSelection(d[0], d[1])) e.preventDefault();
  } else if (e.key === '1' || e.key === 'v' || e.key === 'm') setTool('move');
  else if (e.key === '2' || e.key === 'p') setTool('point');
  else if (e.key === '3' || e.key === 'l') setTool('line');
  else if (e.key === '4' || e.key === 'c') setTool('circle');
  else if (e.key === '5' || e.key === 's') setTool('polygon');
  else if (e.key === '6' || e.key === 'g') toggleGraphInput();
  else if (e.key === 'u' && selection.length) unlinkSelection();
  else if (e.key === 'h' && selection.length) hideSelection();
  else if (e.key === '+' || e.key === '=') zoomBy(1.2);
  else if (e.key === '-' || e.key === '_') zoomBy(1 / 1.2);
  else if (e.key === '0') { view.scale = 1; view.tx = canvas.clientWidth / 2; view.ty = canvas.clientHeight / 2; requestDraw(); }
});

/* ================= wiring ================= */

document.getElementById('btnUndo').addEventListener('click', undo);
document.getElementById('btnRedo').addEventListener('click', redo);
const btnMeasure = document.getElementById('btnMeasure');
btnMeasure.classList.toggle('on', showMeasure);
btnMeasure.addEventListener('click', () => {
  showMeasure = !showMeasure;
  btnMeasure.classList.toggle('on', showMeasure);
  try { localStorage.setItem('geo.ui.measure', showMeasure ? '1' : '0'); } catch {}
  requestDraw();
});
document.getElementById('zoomIn').addEventListener('click', () => zoomBy(1.25));
document.getElementById('zoomOut').addEventListener('click', () => zoomBy(1 / 1.25));
document.getElementById('zoomReset').addEventListener('click', () => {
  view.scale = 1; view.tx = canvas.clientWidth / 2; view.ty = canvas.clientHeight / 2;
  requestDraw();
});
document.getElementById('btnHelp').addEventListener('click', () => {
  document.getElementById('helpPanel').hidden = false;
});
document.getElementById('btnCloseHelp').addEventListener('click', () => {
  document.getElementById('helpPanel').hidden = true;
});
document.getElementById('helpPanel').addEventListener('click', (e) => {
  if (e.target.id === 'helpPanel') e.target.hidden = true;
});
document.getElementById('btnFiles').addEventListener('click', openFiles);
document.getElementById('btnCloseFiles').addEventListener('click', closeFiles);
document.getElementById('btnNew').addEventListener('click', newDoc);
document.getElementById('btnExport').addEventListener('click', exportFile);
document.getElementById('btnImport').addEventListener('click', () => document.getElementById('importInput').click());
document.getElementById('importInput').addEventListener('change', (e) => {
  if (e.target.files[0]) importFile(e.target.files[0]);
  e.target.value = '';
});
/* grow the title field with its content so long names never get clipped */
const docNameMeasure = document.createElement('canvas').getContext('2d');

function fitDocName() {
  docNameMeasure.font = getComputedStyle(docNameEl).font;
  const w = docNameMeasure.measureText(docNameEl.value || 'Untitled').width;
  docNameEl.style.width = Math.max(90, Math.ceil(w) + 26) + 'px';
}

docNameEl.addEventListener('input', () => {
  docName = docNameEl.value || 'Untitled';
  fitDocName();
  scheduleSave();
});
fitDocName();

/* ================= first-run demo ================= */

function buildDemo() {
  const A = engine.add({ type: 'point', kind: 'free', parents: [], params: {}, x: -120, y: -70 });
  const B = engine.add({ type: 'point', kind: 'free', parents: [], params: {}, x: 140, y: -40 });
  const Cc = engine.add({ type: 'point', kind: 'free', parents: [], params: {}, x: 10, y: 130 });
  const ids = [A.id, B.id, Cc.id];
  for (let i = 0; i < 3; i++) {
    engine.add({ type: 'segment', kind: 'twoPoint', parents: [ids[i], ids[(i + 1) % 3]], params: {} });
  }
  engine.add({ type: 'polygon', kind: 'fromVertices', parents: ids, params: {} });
  const pb1 = engine.add({ type: 'line', kind: 'perpBisector', parents: [A.id, B.id], params: {}, style: 'dashed' });
  const pb2 = engine.add({ type: 'line', kind: 'perpBisector', parents: [B.id, Cc.id], params: {}, style: 'dashed' });
  const O = engine.add({ type: 'point', kind: 'intersection', parents: [pb1.id, pb2.id], params: { branch: 0 } });
  O.label = 'O';
  engine.add({ type: 'circle', kind: 'centerPoint2', parents: [O.id, A.id], params: {} });
  engine.recomputeAll();
  docName = 'Circumcircle demo';
  docNameEl.value = docName;
  fitDocName();
  lastCommitted = snapshot();
  updateUndoButtons();
  updateHint('Drag A, B or C — the ⊥ bisectors, center O and circle all follow. ? explains everything');
}

/* ================= boot ================= */

function boot() {
  resize();
  buildToolbar();
  view.tx = canvas.clientWidth / 2;
  view.ty = canvas.clientHeight / 2;

  const auto = Store.loadAutosave();
  if (auto && auto.data && auto.data.objects && auto.data.objects.length) {
    loadDoc(auto.fileId || null, auto.name, auto.data);
  } else if (!Store.listFiles().length && !localStorage.getItem('geo.seen')) {
    // very first run: show the circumcircle construction, ready to drag
    try { localStorage.setItem('geo.seen', '1'); } catch {}
    buildDemo();
  } else {
    lastCommitted = snapshot();
    updateUndoButtons();
    updateHint('Pick a tool above — try Point, then drag things with Move');
  }
  requestAnimationFrame(frame);

  if (location.protocol.startsWith('http') && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();

/* test hooks */
window.__eng = () => engine;
window.__sel = () => [...selection];
