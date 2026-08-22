/* Geometry engine: construction DAG + pure math.
   Free objects hold their own coords; dependent objects are recomputed
   from parents on every change (topological order). Degenerate results
   mark the object invalid instead of propagating NaN. */

'use strict';

const EPS = 1e-9;
const UNIT = 50; // world px per math unit; math y is up, world y is down

/* Compile "x^2/4", "sin(x)+1" … into a safe JS function of x (math units). */
function compileExpr(src) {
  if (typeof src !== 'string' || !src.trim()) return null;
  const cleaned = src.replace(/\s+/g, '').replace(/\^/g, '**');
  if (!/^[0-9a-zA-Z+\-*/().,%]*$/.test(cleaned.replace(/\*\*/g, ''))) return null;
  const names = cleaned.match(/[a-zA-Z]+/g) || [];
  const allowed = new Set(['x', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sqrt',
    'abs', 'log', 'ln', 'exp', 'floor', 'ceil', 'round', 'min', 'max', 'pow', 'pi', 'e']);
  if (!names.every((n) => allowed.has(n.toLowerCase()))) return null;
  const expr = cleaned
    .replace(/\bln\(/g, 'Math.log(')
    .replace(/\b(sin|cos|tan|asin|acos|atan|sqrt|abs|exp|floor|ceil|round|min|max|pow|log)\(/g, 'Math.$1(')
    .replace(/\bpi\b/gi, 'Math.PI')
    .replace(/\be\b/g, 'Math.E');
  try {
    const f = new Function('x', '"use strict"; return (' + expr + ');');
    const v = f(0.5);
    if (typeof v !== 'number') return null;
    return f;
  } catch { return null; }
}

/* world y for a graph object at world x */
function graphWorldY(fn, wx) {
  const y = fn(wx / UNIT);
  return Number.isFinite(y) ? -y * UNIT : NaN;
}

/* clamp a compiled f(x) to optional x/y limits (math units); outside → NaN (gap) */
function boundFn(raw, lims) {
  if (!raw || !lims) return raw;
  const { xmin, xmax, ymin, ymax } = lims;
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  if (![xmin, xmax, ymin, ymax].some(num)) return raw;
  return (x) => {
    if (num(xmin) && x < xmin) return NaN;
    if (num(xmax) && x > xmax) return NaN;
    const y = raw(x);
    if (num(ymin) && y < ymin) return NaN;
    if (num(ymax) && y > ymax) return NaN;
    return y;
  };
}

/* ---------------- pure math ---------------- */

const V = {
  add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y }),
  sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y }),
  scale: (a, s) => ({ x: a.x * s, y: a.y * s }),
  dot: (a, b) => a.x * b.x + a.y * b.y,
  cross: (a, b) => a.x * b.y - a.y * b.x,
  len: (a) => Math.hypot(a.x, a.y),
  dist: (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
  mid: (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }),
  lerp: (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }),
  norm: (a) => {
    const l = Math.hypot(a.x, a.y);
    return l < EPS ? null : { x: a.x / l, y: a.y / l };
  },
  perp: (a) => ({ x: -a.y, y: a.x }),
  angle: (a) => Math.atan2(a.y, a.x),
};

// Line represented as point p + direction d (unit). Infinite unless kind limits it.
function lineFromPoints(a, b) {
  const d = V.norm(V.sub(b, a));
  return d ? { p: a, d } : null;
}

function lineLineIntersect(l1, l2) {
  const denom = V.cross(l1.d, l2.d);
  if (Math.abs(denom) < EPS) return null; // parallel
  const t = V.cross(V.sub(l2.p, l1.p), l2.d) / denom;
  return V.add(l1.p, V.scale(l1.d, t));
}

// Returns 0..2 points. Ordered deterministically (by +perp side).
function lineCircleIntersect(l, c) {
  const f = V.sub(c.c, l.p);
  const t0 = V.dot(f, l.d);            // foot parameter
  const d2 = V.dot(f, f) - t0 * t0;    // squared dist center->line
  const r2 = c.r * c.r;
  if (d2 > r2 + EPS) return [];
  const h = Math.sqrt(Math.max(0, r2 - d2));
  if (h < EPS) return [V.add(l.p, V.scale(l.d, t0))];
  return [V.add(l.p, V.scale(l.d, t0 - h)), V.add(l.p, V.scale(l.d, t0 + h))];
}

function circleCircleIntersect(c1, c2) {
  const d = V.dist(c1.c, c2.c);
  if (d < EPS) return [];
  if (d > c1.r + c2.r + EPS || d < Math.abs(c1.r - c2.r) - EPS) return [];
  const a = (c1.r * c1.r - c2.r * c2.r + d * d) / (2 * d);
  const h2 = c1.r * c1.r - a * a;
  const h = Math.sqrt(Math.max(0, h2));
  const u = V.scale(V.sub(c2.c, c1.c), 1 / d);
  const m = V.add(c1.c, V.scale(u, a));
  if (h < EPS) return [m];
  const pv = V.scale(V.perp(u), h);
  return [V.add(m, pv), V.sub(m, pv)];
}

function circumcircle(a, b, c) {
  const l1 = { p: V.mid(a, b), d: V.perp(V.sub(b, a)) };
  const l2 = { p: V.mid(b, c), d: V.perp(V.sub(c, b)) };
  const d1 = V.norm(l1.d), d2 = V.norm(l2.d);
  if (!d1 || !d2) return null;
  const center = lineLineIntersect({ p: l1.p, d: d1 }, { p: l2.p, d: d2 });
  if (!center) return null; // collinear
  return { c: center, r: V.dist(center, a) };
}

function footOfPerpendicular(pt, l) {
  const t = V.dot(V.sub(pt, l.p), l.d);
  return V.add(l.p, V.scale(l.d, t));
}

// Distance from point to segment ab
function distToSegment(p, a, b) {
  const ab = V.sub(b, a);
  const len2 = V.dot(ab, ab);
  if (len2 < EPS) return V.dist(p, a);
  let t = V.dot(V.sub(p, a), ab) / len2;
  t = Math.max(0, Math.min(1, t));
  return V.dist(p, V.add(a, V.scale(ab, t)));
}

function closestPointOnSegment(p, a, b) {
  const ab = V.sub(b, a);
  const len2 = V.dot(ab, ab);
  if (len2 < EPS) return { pt: { ...a }, t: 0 };
  let t = V.dot(V.sub(p, a), ab) / len2;
  t = Math.max(0, Math.min(1, t));
  return { pt: V.add(a, V.scale(ab, t)), t };
}

function polygonArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += V.cross(a, b);
  }
  return s / 2;
}

function pointInPolygon(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) &&
        p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/* ---------------- construction DAG ---------------- */

/*
Object record:
{
  id, type,            // 'point' | 'segment' | 'line' | 'ray' | 'circle' | 'polygon' | 'angle'
  kind,                // how it's constructed, e.g. 'free' | 'midpoint' | 'nsection' | 'onPath'
                       // | 'intersection' | 'twoPoint' | 'perpBisector' | 'perpThrough'
                       // | 'parallelThrough' | 'angleBisector' | 'centerPoint' | 'circum3'
                       // | 'centerRadiusPoint' | 'fromVertices' | 'threePoint'
  parents: [ids],
  params: {},          // e.g. {t}, {k,n}, {branch}, {r}
  // computed state:
  valid, x, y,         // points
  ax, ay, bx, by,      // segment/line/ray endpoints (line/ray: p + d stored as a=p, b=p+d)
  cx, cy, r,           // circles
  pts: [{x,y}],        // polygon vertex cache
  // presentation:
  label, color, style, hidden
}
*/

class Engine {
  constructor() {
    this.objects = new Map();   // id -> obj
    this.order = [];            // topological order of ids
    this.nextId = 1;
    this.labelCounters = { point: 0, other: 0 };
  }

  genId() { return 'o' + (this.nextId++); }

  nextPointLabel() {
    const n = this.labelCounters.point++;
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const suffix = Math.floor(n / 26);
    return letters[n % 26] + (suffix ? suffix : '');
  }

  add(obj) {
    obj.id = obj.id || this.genId();
    obj.valid = true;
    obj.hidden = obj.hidden || false;
    // center handles are quiet helpers, not lettered construction points
    if (obj.type === 'point' && !obj.label && !(obj.params && obj.params.role === 'center')) {
      obj.label = this.nextPointLabel();
    }
    this.objects.set(obj.id, obj);
    if (!this._batch) {
      this.rebuildOrder();
      this.recomputeAll();
    }
    return obj;
  }

  // group many add() calls into ONE rebuild+recompute (big shapes lag otherwise)
  batch(fn) {
    this._batch = true;
    try { fn(); } finally {
      this._batch = false;
      this.rebuildOrder();
      this.recomputeAll();
    }
  }

  get(id) { return this.objects.get(id); }

  children(id) {
    const out = [];
    for (const o of this.objects.values()) {
      if (o.parents && o.parents.includes(id)) out.push(o);
    }
    return out;
  }

  // Unlink a dependent object: keep its current geometry, drop its parents.
  // Children keep working — they still reference the same id.
  // Returns true if the object was detached.
  detach(id) {
    const o = this.objects.get(id);
    if (!o || !o.valid) return false;
    if (o.type === 'point') {
      if (o.kind === 'free') return false;
      o.kind = 'free';
      o.parents = [];
      o.params = {};
    } else if (o.type === 'segment' || o.type === 'ray' || o.type === 'line' || o.type === 'circle') {
      if (o.kind === 'frozen') return false;
      o.kind = 'frozen';
      o.parents = [];
      o.params = {};
      if (o.type !== 'circle' && !o.extent) o.extent = o.type;
    } else {
      return false; // polygons/angles stay tied to their points
    }
    this.rebuildOrder();
    this.recomputeAll();
    return true;
  }

  // Delete an object and everything that depends on it.
  delete(id) {
    const doomed = new Set();
    const mark = (i) => {
      if (doomed.has(i)) return;
      doomed.add(i);
      for (const o of this.objects.values()) {
        if (o.parents && o.parents.includes(i)) mark(o.id);
      }
    };
    mark(id);
    for (const i of doomed) this.objects.delete(i);
    this.rebuildOrder();
    return doomed;
  }

  rebuildOrder() {
    const visited = new Set();
    const order = [];
    const visit = (id) => {
      if (visited.has(id)) return;
      visited.add(id);
      const o = this.objects.get(id);
      if (!o) return;
      for (const p of o.parents || []) visit(p);
      order.push(id);
    };
    for (const id of this.objects.keys()) visit(id);
    this.order = order;
  }

  recomputeAll() {
    for (const id of this.order) this.recompute(this.objects.get(id));
  }

  // Move a draggable point, then update dependents.
  // free: moves directly (and rigidly carries a regular polygon it centers).
  // onPath: re-projects onto its host curve.
  // regularVertex: rotates/scales the whole regular polygon by back-driving its rim.
  moveFree(id, x, y) {
    const o = this.objects.get(id);
    if (!o) return;
    if (o.kind === 'free') {
      const dx = x - o.x, dy = y - o.y;
      o.x = x; o.y = y;
      // dragging the CENTER of a regular polygon translates the whole shape:
      // shift each free rim point that spins around this center by the same delta
      const rims = new Set();
      for (const c of this.objects.values()) {
        if (c.kind === 'regularVertex' && c.parents[0] === id) rims.add(c.parents[1]);
      }
      for (const rid of rims) {
        const rim = this.objects.get(rid);
        if (rim && rim.kind === 'free') { rim.x += dx; rim.y += dy; }
      }
    } else if (o.kind === 'onPath') {
      const path = this.objects.get(o.parents[0]);
      const proj = this.projectOntoPath({ x, y }, path);
      if (proj) o.params.t = proj.t;
    } else if (o.kind === 'regularVertex') {
      // target position of vertex i → rotate back by -i*2π/n to get the rim
      const c = this.objects.get(o.parents[0]);
      const rim = this.objects.get(o.parents[1]);
      if (!c || !rim || rim.kind !== 'free') return;
      const a = -(o.params.i * 2 * Math.PI) / o.params.n;
      const dx = x - c.x, dy = y - c.y;
      if (Math.hypot(dx, dy) < EPS) return;
      const cos = Math.cos(a), sin = Math.sin(a);
      rim.x = c.x + dx * cos - dy * sin;
      rim.y = c.y + dx * sin + dy * cos;
    } else {
      return;
    }
    this.recomputeAll();
  }

  isDraggable(o) {
    if (o.type !== 'point') return false;
    if (o.kind === 'free' || o.kind === 'onPath') return true;
    if (o.kind === 'regularVertex') {
      const rim = this.objects.get(o.parents[1]);
      return !!(rim && rim.kind === 'free');
    }
    return false;
  }

  projectOntoPath(p, path) {
    if (!path || !path.valid) return null;
    if (path.type === 'function') {
      const fn = path._fn;
      if (!fn) return null;
      // coarse sample around p.x, then refine
      let bestX = p.x, bestD = Infinity;
      for (let dx = -240; dx <= 240; dx += 4) {
        const wx = p.x + dx;
        const wy = graphWorldY(fn, wx);
        if (!Number.isFinite(wy)) continue;
        const d = (wx - p.x) ** 2 + (wy - p.y) ** 2;
        if (d < bestD) { bestD = d; bestX = wx; }
      }
      for (let step = 2; step > 0.02; step /= 2) {
        for (const wx of [bestX - step, bestX + step]) {
          const wy = graphWorldY(fn, wx);
          if (!Number.isFinite(wy)) continue;
          const d = (wx - p.x) ** 2 + (wy - p.y) ** 2;
          if (d < bestD) { bestD = d; bestX = wx; }
        }
      }
      const y = graphWorldY(fn, bestX);
      if (!Number.isFinite(y)) return null;
      return { t: bestX, pt: { x: bestX, y } };
    }
    if (path.type === 'circle') {
      const d = V.sub(p, { x: path.cx, y: path.cy });
      const n = V.norm(d);
      if (!n) return null;
      return { t: Math.atan2(n.y, n.x), pt: V.add({ x: path.cx, y: path.cy }, V.scale(n, path.r)) };
    }
    const a = { x: path.ax, y: path.ay }, b = { x: path.bx, y: path.by };
    if (path.type === 'segment') {
      const { pt, t } = closestPointOnSegment(p, a, b);
      return { t, pt };
    }
    // line / ray: unclamped (ray clamps at 0)
    const d = V.norm(V.sub(b, a));
    if (!d) return null;
    let t = V.dot(V.sub(p, a), d);
    if (path.type === 'ray') t = Math.max(0, t);
    return { t, pt: V.add(a, V.scale(d, t)) };
  }

  pathPointAt(path, t) {
    if (path.type === 'function') {
      const fn = path._fn;
      const y = fn ? graphWorldY(fn, t) : NaN;
      return { x: t, y: Number.isFinite(y) ? y : 0 };
    }
    if (path.type === 'circle') {
      return { x: path.cx + path.r * Math.cos(t), y: path.cy + path.r * Math.sin(t) };
    }
    const a = { x: path.ax, y: path.ay }, b = { x: path.bx, y: path.by };
    if (path.type === 'segment') return V.lerp(a, b, t);
    const d = V.norm(V.sub(b, a));
    if (!d) return a;
    return V.add(a, V.scale(d, t));
  }

  parentPts(o) {
    return o.parents.map((id) => {
      const p = this.objects.get(id);
      return p && p.valid ? { x: p.x, y: p.y } : null;
    });
  }

  setLine(o, p, d, extent) {
    // store as a=p, b=p+d for uniform rendering math
    o.ax = p.x; o.ay = p.y;
    o.bx = p.x + d.x; o.by = p.y + d.y;
    o.extent = extent; // 'segment' | 'ray' | 'line'
  }

  asLine(o) {
    const a = { x: o.ax, y: o.ay }, b = { x: o.bx, y: o.by };
    const d = V.norm(V.sub(b, a));
    return d ? { p: a, d } : null;
  }

  recompute(o) {
    if (!o) return;
    const parents = (o.parents || []).map((id) => this.objects.get(id));
    if (parents.some((p) => !p || !p.valid)) { o.valid = false; return; }
    o.valid = true;

    switch (o.type + ':' + o.kind) {
      case 'point:free':
        break;

      // an unlinked object: keeps its geometry, depends on nothing
      case 'segment:frozen':
      case 'ray:frozen':
      case 'line:frozen':
      case 'circle:frozen':
        break;

      case 'point:onPath': {
        // clamp for segment
        if (parents[0].type === 'segment') o.params.t = Math.max(0, Math.min(1, o.params.t));
        if (parents[0].type === 'function') {
          const fn = parents[0]._fn;
          const y = fn ? graphWorldY(fn, o.params.t) : NaN;
          if (!Number.isFinite(y)) { o.valid = false; break; }
          o.x = o.params.t; o.y = y;
          break;
        }
        const pt = this.pathPointAt(parents[0], o.params.t);
        o.x = pt.x; o.y = pt.y;
        break;
      }

      case 'point:midpoint': {
        const [a, b] = this.parentPts(o);
        const m = V.mid(a, b);
        o.x = m.x; o.y = m.y;
        break;
      }

      case 'point:nsection': {
        // params: {k, n} -> point at k/n along segment from parent0 to parent1
        const [a, b] = this.parentPts(o);
        const p = V.lerp(a, b, o.params.k / o.params.n);
        o.x = p.x; o.y = p.y;
        break;
      }

      case 'point:segMidpoint': {
        const s = parents[0];
        o.x = (s.ax + s.bx) / 2; o.y = (s.ay + s.by) / 2;
        break;
      }

      case 'point:segNsection': {
        const s = parents[0];
        const p = V.lerp({ x: s.ax, y: s.ay }, { x: s.bx, y: s.by }, o.params.k / o.params.n);
        o.x = p.x; o.y = p.y;
        break;
      }

      case 'point:regularVertex': {
        // vertex i of a regular n-gon: rim point rotated around center by i*2π/n
        const [c, rim] = this.parentPts(o);
        const dx = rim.x - c.x, dy = rim.y - c.y;
        if (Math.hypot(dx, dy) < EPS) { o.valid = false; break; }
        const a = (o.params.i * 2 * Math.PI) / o.params.n;
        const cos = Math.cos(a), sin = Math.sin(a);
        o.x = c.x + dx * cos - dy * sin;
        o.y = c.y + dx * sin + dy * cos;
        break;
      }

      case 'point:centerPoint': {
        const c = parents[0];
        o.x = c.cx; o.y = c.cy;
        break;
      }

      case 'point:intersection': {
        const pts = this.intersectObjects(parents[0], parents[1]);
        if (!pts.length) { o.valid = false; break; }
        // continuity: pick branch nearest to previous position if we have one
        let chosen;
        if (pts.length === 1) chosen = pts[0];
        else if (Number.isFinite(o.x)) {
          chosen = pts.reduce((best, p) =>
            V.dist(p, o) < V.dist(best, o) ? p : best);
        } else {
          chosen = pts[Math.min(o.params.branch || 0, pts.length - 1)];
        }
        // remember branch index for serialization stability
        o.params.branch = pts.indexOf(chosen);
        o.x = chosen.x; o.y = chosen.y;
        break;
      }

      case 'segment:twoPoint':
      case 'line:twoPoint':
      case 'ray:twoPoint': {
        const [a, b] = this.parentPts(o);
        const d = V.sub(b, a);
        if (V.len(d) < EPS) { o.valid = false; break; }
        o.ax = a.x; o.ay = a.y; o.bx = b.x; o.by = b.y;
        o.extent = o.type;
        break;
      }

      case 'line:perpBisector': {
        // parents: two points, or one segment
        let a, b;
        if (parents.length === 2) { [a, b] = this.parentPts(o); }
        else { a = { x: parents[0].ax, y: parents[0].ay }; b = { x: parents[0].bx, y: parents[0].by }; }
        const d = V.norm(V.perp(V.sub(b, a)));
        if (!d) { o.valid = false; break; }
        this.setLine(o, V.mid(a, b), d, 'line');
        break;
      }

      case 'line:perpThrough': {
        // parents: [point, linear]
        const pt = { x: parents[0].x, y: parents[0].y };
        const l = this.asLine(parents[1]);
        if (!l) { o.valid = false; break; }
        this.setLine(o, pt, V.perp(l.d), 'line');
        break;
      }

      case 'line:parallelThrough': {
        const pt = { x: parents[0].x, y: parents[0].y };
        const l = this.asLine(parents[1]);
        if (!l) { o.valid = false; break; }
        this.setLine(o, pt, l.d, 'line');
        break;
      }

      case 'ray:angleBisector': {
        // parents: [A, V, B] -> bisector of angle AVB from V
        const [a, v, b] = this.parentPts(o);
        const da = V.norm(V.sub(a, v)), db = V.norm(V.sub(b, v));
        if (!da || !db) { o.valid = false; break; }
        let d = V.norm(V.add(da, db));
        if (!d) d = V.perp(da); // straight angle
        this.setLine(o, v, d, 'ray');
        break;
      }

      case 'circle:centerPoint2': {
        // parents: [center point, rim point]
        const [c, p] = this.parentPts(o);
        const r = V.dist(c, p);
        if (r < EPS) { o.valid = false; break; }
        o.cx = c.x; o.cy = c.y; o.r = r;
        break;
      }

      case 'circle:centerRadius': {
        const [c] = this.parentPts(o);
        o.cx = c.x; o.cy = c.y; o.r = o.params.r;
        break;
      }

      case 'circle:circum3': {
        const [a, b, c] = this.parentPts(o);
        const cc = circumcircle(a, b, c);
        if (!cc) { o.valid = false; break; }
        o.cx = cc.c.x; o.cy = cc.c.y; o.r = cc.r;
        break;
      }

      case 'function:graph': {
        const key = o.params.expr + '|' +
          [o.params.xmin, o.params.xmax, o.params.ymin, o.params.ymax].join(',');
        if (o._src !== key) {
          o._fn = boundFn(compileExpr(o.params.expr), o.params);
          o._src = key;
        }
        if (!o._fn) { o.valid = false; break; }
        break;
      }

      case 'polygon:fromVertices': {
        o.pts = this.parentPts(o);
        break;
      }

      case 'angle:threePoint': {
        // parents: [A, V, B]; value = angle AVB in radians (0..PI)
        const [a, v, b] = this.parentPts(o);
        const da = V.norm(V.sub(a, v)), db = V.norm(V.sub(b, v));
        if (!da || !db) { o.valid = false; break; }
        o.x = v.x; o.y = v.y;
        o.a1 = V.angle(da); o.a2 = V.angle(db);
        let val = Math.acos(Math.max(-1, Math.min(1, V.dot(da, db))));
        o.value = val;
        break;
      }

      case 'angle:twoLines': {
        // acute angle between two linear objects, marked at their crossing
        // (or at a shared endpoint if the two share a defining point)
        const [la, lb] = parents;
        const A = this.asLine(la), B = this.asLine(lb);
        if (!A || !B) { o.valid = false; break; }
        let v = null, da = A.d, db = B.d;
        const shared = (la.parents || []).find((p) => (lb.parents || []).includes(p));
        if (shared) {
          const sp = this.objects.get(shared);
          if (sp && sp.valid && sp.type === 'point') {
            v = { x: sp.x, y: sp.y };
            // aim each direction away from the shared vertex
            const otherOf = (lin) => {
              const oid = lin.parents.find((p) => p !== shared);
              const op = this.objects.get(oid);
              return op && op.valid ? V.norm(V.sub(op, v)) : null;
            };
            da = otherOf(la) || da;
            db = otherOf(lb) || db;
          }
        }
        if (!v) {
          v = lineLineIntersect(A, B);
          if (!v) { o.valid = false; break; }
          if (V.dot(da, db) < 0) db = V.scale(db, -1); // acute sector
        }
        o.x = v.x; o.y = v.y;
        o.a1 = V.angle(da); o.a2 = V.angle(db);
        o.value = Math.acos(Math.max(-1, Math.min(1, V.dot(da, db))));
        break;
      }

      case 'line:angledAt': {
        // a line through a point, rotated params.deg° from a base direction:
        // the host line (2 parents), or the tangent of the curve the point rides
        const p = parents[0];
        let base = null;
        if (parents.length === 2) {
          const L = this.asLine(parents[1]);
          base = L && L.d;
        } else if (p.kind === 'onPath') {
          const host = this.objects.get(p.parents[0]);
          if (host && host.valid) {
            if (host.type === 'circle') {
              base = V.norm(V.perp(V.sub(p, { x: host.cx, y: host.cy })));
            } else if (host.type === 'function' && host._fn) {
              const h = 0.5;
              const y1 = graphWorldY(host._fn, p.x - h), y2 = graphWorldY(host._fn, p.x + h);
              if (Number.isFinite(y1) && Number.isFinite(y2)) base = V.norm({ x: 2 * h, y: y2 - y1 });
            } else {
              const L = this.asLine(host);
              base = L && L.d;
            }
          }
        }
        if (!base) { o.valid = false; break; }
        const a = (-(o.params.deg || 0) * Math.PI) / 180; // positive deg turns CCW on screen
        const d = {
          x: base.x * Math.cos(a) - base.y * Math.sin(a),
          y: base.x * Math.sin(a) + base.y * Math.cos(a),
        };
        this.setLine(o, { x: p.x, y: p.y }, d, 'line');
        break;
      }

      case 'line:tangentAt': {
        // tangent to the host curve at a glider point
        const p = parents[0];
        if (p.kind !== 'onPath') { o.valid = false; break; }
        const host = this.objects.get(p.parents[0]);
        if (!host || !host.valid) { o.valid = false; break; }
        let d = null;
        if (host.type === 'circle') {
          d = V.norm(V.perp(V.sub(p, { x: host.cx, y: host.cy })));
        } else if (host.type === 'function' && host._fn) {
          const h = 0.5;
          const y1 = graphWorldY(host._fn, p.x - h), y2 = graphWorldY(host._fn, p.x + h);
          if (Number.isFinite(y1) && Number.isFinite(y2)) {
            d = V.norm({ x: 2 * h, y: y2 - y1 });
          }
        } else {
          d = this.asLine(host) ? this.asLine(host).d : null;
        }
        if (!d) { o.valid = false; break; }
        this.setLine(o, { x: p.x, y: p.y }, d, 'line');
        break;
      }

      default:
        o.valid = false;
    }
  }

  intersectObjects(a, b) {
    const isLin = (o) => o.type === 'segment' || o.type === 'line' || o.type === 'ray';
    if (a.type === 'function' || b.type === 'function') {
      const fnObj = a.type === 'function' ? a : b;
      const other = a.type === 'function' ? b : a;
      return this.functionIntersections(fnObj, other);
    }
    if (isLin(a) && isLin(b)) {
      const la = this.asLine(a), lb = this.asLine(b);
      if (!la || !lb) return [];
      const p = lineLineIntersect(la, lb);
      if (!p) return [];
      if (!this.onExtent(a, p) || !this.onExtent(b, p)) return [];
      return [p];
    }
    if (isLin(a) && b.type === 'circle') return this.lineCircle(a, b);
    if (a.type === 'circle' && isLin(b)) return this.lineCircle(b, a);
    if (a.type === 'circle' && b.type === 'circle') {
      return circleCircleIntersect({ c: { x: a.cx, y: a.cy }, r: a.r },
                                   { c: { x: b.cx, y: b.cy }, r: b.r });
    }
    return [];
  }

  /* Numeric roots of graph vs line/segment/ray, another graph, or circle.
     Sign-change scan over a wide world-x domain, then bisection. */
  functionIntersections(fnObj, other) {
    const fn = fnObj._fn;
    if (!fn) return [];
    let g; // g(worldX): signed difference; roots are intersections
    const isLin = other.type === 'segment' || other.type === 'line' || other.type === 'ray';
    if (isLin) {
      const l = this.asLine(other);
      if (!l) return [];
      if (Math.abs(l.d.x) < 1e-6) {
        // vertical line: single candidate at that x
        const wx = l.p.x;
        const wy = graphWorldY(fn, wx);
        if (!Number.isFinite(wy)) return [];
        const p = { x: wx, y: wy };
        return this.onExtent(other, p) ? [p] : [];
      }
      const m = l.d.y / l.d.x, c = l.p.y - m * l.p.x;
      g = (wx) => graphWorldY(fn, wx) - (m * wx + c);
    } else if (other.type === 'function') {
      const fn2 = other._fn;
      if (!fn2) return [];
      g = (wx) => graphWorldY(fn, wx) - graphWorldY(fn2, wx);
    } else if (other.type === 'circle') {
      g = (wx) => {
        const wy = graphWorldY(fn, wx);
        return Math.hypot(wx - other.cx, wy - other.cy) - other.r;
      };
    } else return [];

    const out = [];
    const LO = -3000, HI = 3000, STEP = 3;
    let px = LO, pv = g(LO);
    for (let wx = LO + STEP; wx <= HI && out.length < 8; wx += STEP) {
      const v = g(wx);
      if (Number.isFinite(pv) && Number.isFinite(v) && pv * v <= 0 && !(pv === 0 && v === 0)) {
        let lo = px, hi = wx, flo = pv;
        for (let i = 0; i < 50; i++) {
          const mid = (lo + hi) / 2, fm = g(mid);
          if (!Number.isFinite(fm)) break;
          if (flo * fm <= 0) hi = mid; else { lo = mid; flo = fm; }
        }
        const rx = (lo + hi) / 2;
        const ry = graphWorldY(fn, rx);
        if (Number.isFinite(ry)) {
          const p = { x: rx, y: ry };
          if ((!isLin || this.onExtent(other, p)) &&
              !out.some((q) => Math.abs(q.x - p.x) < 0.5)) out.push(p);
        }
      }
      px = wx; pv = v;
    }
    return out;
  }

  lineCircle(lin, cir) {
    const l = this.asLine(lin);
    if (!l) return [];
    return lineCircleIntersect(l, { c: { x: cir.cx, y: cir.cy }, r: cir.r })
      .filter((p) => this.onExtent(lin, p));
  }

  // Is point p (already on the infinite line) within the extent of lin?
  onExtent(lin, p) {
    if (lin.type === 'line') return true;
    const a = { x: lin.ax, y: lin.ay }, b = { x: lin.bx, y: lin.by };
    const d = V.sub(b, a);
    const t = V.dot(V.sub(p, a), d) / Math.max(V.dot(d, d), EPS);
    if (lin.type === 'ray') return t >= -1e-6;
    return t >= -1e-6 && t <= 1 + 1e-6;
  }

  /* ---------- serialization: save the recipe, not the results ---------- */

  serialize() {
    const objs = [];
    for (const id of this.order) {
      const o = this.objects.get(id);
      const rec = {
        id: o.id, type: o.type, kind: o.kind,
        parents: o.parents || [], params: o.params || {},
        label: o.label, color: o.color, style: o.style, hidden: o.hidden,
      };
      if (o.kind === 'free') { rec.x = o.x; rec.y = o.y; }
      if (o.kind === 'frozen') {
        if (o.type === 'circle') { rec.cx = o.cx; rec.cy = o.cy; rec.r = o.r; }
        else { rec.ax = o.ax; rec.ay = o.ay; rec.bx = o.bx; rec.by = o.by; rec.extent = o.extent; }
      }
      objs.push(rec);
    }
    return { version: 1, nextId: this.nextId, labelCounters: this.labelCounters, objects: objs };
  }

  static deserialize(data) {
    const e = new Engine();
    e.nextId = data.nextId || 1;
    e.labelCounters = data.labelCounters || { point: 0, other: 0 };
    for (const rec of data.objects || []) {
      const o = { ...rec, valid: true };
      e.objects.set(o.id, o);
    }
    e.rebuildOrder();
    e.recomputeAll();
    return e;
  }
}

/* exported for app.js (plain script include, no modules — offline-simple) */
window.Geo = {
  V, EPS, UNIT, Engine, compileExpr, graphWorldY, boundFn,
  lineFromPoints, lineLineIntersect, lineCircleIntersect, circleCircleIntersect,
  circumcircle, footOfPerpendicular, distToSegment, closestPointOnSegment,
  polygonArea, pointInPolygon,
};
