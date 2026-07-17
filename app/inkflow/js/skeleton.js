/* ==========================================================================
 * Glyph skeletonizer — extracts brush "centerline" strokes from any glyph.
 *
 * Pipeline per glyph:
 *   rasterize (offscreen canvas) -> binary grid
 *   -> distance transform (stroke thickness)
 *   -> Zhang-Suen thinning (1px skeleton)
 *   -> trace pixel graph into polyline segments
 *   -> prune spur artifacts, merge aligned branches through junctions
 *   -> simplify (RDP) + natural stroke ordering/direction
 *
 * Result: { strokes: [[x,y],...][], maxRadius, totalLength } in raster px,
 * origin at glyph bbox top-left (offset returned separately).
 * ========================================================================== */
"use strict";

const RASTER_FONT_SIZE = 260; // glyphs are analyzed at this em size, then scaled

/* ---------------- rasterize ---------------- */
function rasterizeGlyph(glyph, fontSize) {
  const path = glyph.getPath(0, 0, fontSize);
  const bb = path.getBoundingBox();
  const margin = 4;
  const w = Math.max(1, Math.ceil(bb.x2 - bb.x1)) + margin * 2;
  const h = Math.max(1, Math.ceil(bb.y2 - bb.y1)) + margin * 2;
  if (w * h > 4_000_000) return null; // safety

  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.translate(margin - bb.x1, margin - bb.y1);
  ctx.fillStyle = "#000";
  path.fill = "#000";
  path.draw(ctx);

  const img = ctx.getImageData(0, 0, w, h).data;
  const grid = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) grid[i] = img[i * 4 + 3] > 127 ? 1 : 0;
  return { grid, w, h, ox: bb.x1 - margin, oy: bb.y1 - margin };
}

/* ---------------- distance transform (chamfer 3-4) ---------------- */
function distanceTransform(grid, w, h) {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = grid[i] ? INF : 0;
  // forward
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!d[i]) continue;
    let v = d[i];
    if (x > 0) v = Math.min(v, d[i - 1] + 3);
    if (y > 0) {
      v = Math.min(v, d[i - w] + 3);
      if (x > 0) v = Math.min(v, d[i - w - 1] + 4);
      if (x < w - 1) v = Math.min(v, d[i - w + 1] + 4);
    }
    d[i] = v;
  }
  // backward
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x;
    if (!d[i]) continue;
    let v = d[i];
    if (x < w - 1) v = Math.min(v, d[i + 1] + 3);
    if (y < h - 1) {
      v = Math.min(v, d[i + w] + 3);
      if (x < w - 1) v = Math.min(v, d[i + w + 1] + 4);
      if (x > 0) v = Math.min(v, d[i + w - 1] + 4);
    }
    d[i] = v;
  }
  return d; // radius in px ≈ d/3
}

/* ---------------- Zhang-Suen thinning ---------------- */
function thin(grid, w, h) {
  const g = Uint8Array.from(grid);
  const idx = (x, y) => y * w + x;
  const toDelete = [];
  let changed = true;

  const pass = (step) => {
    toDelete.length = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = idx(x, y);
      if (!g[i]) continue;
      const p2 = g[i - w], p3 = g[i - w + 1], p4 = g[i + 1], p5 = g[i + w + 1];
      const p6 = g[i + w], p7 = g[i + w - 1], p8 = g[i - 1], p9 = g[i - w - 1];
      const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
      if (B < 2 || B > 6) continue;
      const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
      let A = 0;
      for (let k = 0; k < 8; k++) if (!seq[k] && seq[k + 1]) A++;
      if (A !== 1) continue;
      if (step === 0) {
        if (p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0) continue;
      } else {
        if (p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0) continue;
      }
      toDelete.push(i);
    }
    for (const i of toDelete) g[i] = 0;
    return toDelete.length > 0;
  };

  let guard = 0;
  while (changed && guard++ < 500) {
    const a = pass(0);
    const b = pass(1);
    changed = a || b;
  }
  return g;
}

/* ---------------- skeleton pixel graph -> polyline segments ------------- */
function traceSkeleton(sk, w, h) {
  const NB = [[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]];
  const pixels = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
    if (sk[y * w + x]) pixels.push([x, y]);
  if (!pixels.length) return [];

  const has = (x, y) => x >= 0 && y >= 0 && x < w && y < h && sk[y * w + x];
  // 8-connectivity, but a diagonal link only counts when there is no
  // orthogonal 2-step path between the pixels — otherwise staircase pixels
  // on diagonal lines read as fake junctions and shred the skeleton.
  const neighbors = (x, y) =>
    NB.map(([dx, dy]) => [x + dx, y + dy, dx, dy])
      .filter(([a, b, dx, dy]) => {
        if (!has(a, b)) return false;
        if (dx && dy && (has(x + dx, y) || has(x, y + dy))) return false;
        return true;
      })
      .map(([a, b]) => [a, b]);
  const degree = new Map();
  for (const [x, y] of pixels) degree.set(y * w + x, neighbors(x, y).length);

  const edgeKey = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;
  const visited = new Set();
  const segments = [];

  const walk = (sx, sy, nx, ny) => {
    const path = [[sx, sy]];
    let px = sx, py = sy, cx = nx, cy = ny;
    visited.add(edgeKey(py * w + px, cy * w + cx));
    for (;;) {
      path.push([cx, cy]);
      const deg = degree.get(cy * w + cx);
      if (deg !== 2) break; // endpoint or junction
      const nbs = neighbors(cx, cy).filter(([a, b]) => !(a === px && b === py));
      if (!nbs.length) break;
      const [tx, ty] = nbs[0];
      const k = edgeKey(cy * w + cx, ty * w + tx);
      if (visited.has(k)) break;
      visited.add(k);
      px = cx; py = cy; cx = tx; cy = ty;
    }
    return path;
  };

  // start walks from every endpoint / junction
  for (const [x, y] of pixels) {
    const deg = degree.get(y * w + x);
    if (deg === 2) continue;
    for (const [nx, ny] of neighbors(x, y)) {
      const k = edgeKey(y * w + x, ny * w + nx);
      if (!visited.has(k)) segments.push(walk(x, y, nx, ny));
    }
  }
  // isolated loops (e.g. 'O'): all pixels degree 2
  for (const [x, y] of pixels) {
    if (degree.get(y * w + x) !== 2) continue;
    const unvisitedNb = neighbors(x, y).find(([a, b]) =>
      !visited.has(edgeKey(y * w + x, b * w + a)));
    if (unvisitedNb) segments.push(walk(x, y, unvisitedNb[0], unvisitedNb[1]));
  }
  // isolated single pixels (dots)
  for (const [x, y] of pixels)
    if (degree.get(y * w + x) === 0) segments.push([[x, y], [x + 0.01, y]]);

  return segments;
}

/* ---------------- helpers ---------------- */
function polyLength(pts) {
  let l = 0;
  for (let i = 1; i < pts.length; i++)
    l += Math.hypot(pts[i][0] - pts[i-1][0], pts[i][1] - pts[i-1][1]);
  return l;
}

function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const sq = (a) => a * a;
  const dSeg = (p, a, b) => {
    const l2 = sq(b[0]-a[0]) + sq(b[1]-a[1]);
    if (!l2) return Math.hypot(p[0]-a[0], p[1]-a[1]);
    let t = ((p[0]-a[0])*(b[0]-a[0]) + (p[1]-a[1])*(b[1]-a[1])) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0]-(a[0]+t*(b[0]-a[0])), p[1]-(a[1]+t*(b[1]-a[1])));
  };
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxD = 0, maxI = -1;
    for (let i = s + 1; i < e; i++) {
      const d = dSeg(pts[i], pts[s], pts[e]);
      if (d > maxD) { maxD = d; maxI = i; }
    }
    if (maxD > eps) { keep[maxI] = 1; stack.push([s, maxI], [maxI, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/* Uniform arc-length resampling — evens out point spacing before smoothing */
function resample(pts, step) {
  if (pts.length < 3) return pts;
  const out = [pts[0].slice()];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1], b = pts[i];
    let d = Math.hypot(b[0]-a[0], b[1]-a[1]);
    let t = step - carry;
    while (t <= d) {
      const f = t / d;
      out.push([a[0] + (b[0]-a[0]) * f, a[1] + (b[1]-a[1]) * f]);
      t += step;
    }
    carry = (carry + d) % step;
  }
  const last = pts[pts.length - 1];
  const tail = out[out.length - 1];
  if (Math.hypot(last[0]-tail[0], last[1]-tail[1]) > step * 0.25) out.push(last.slice());
  else out[out.length - 1] = last.slice();
  return out;
}

/* "StreamLine": iterative neighbor-averaging to remove pixel-thinning wobble.
 * Open paths keep their endpoints pinned; closed loops smooth around. */
function smoothPolyline(pts, iterations, closed) {
  let p = pts.map((q) => q.slice());
  const n = p.length;
  if (n < 3) return p;
  for (let it = 0; it < iterations; it++) {
    const next = p.map((q) => q.slice());
    const lo = closed ? 0 : 1;
    const hi = closed ? n - 1 : n - 2;
    for (let i = lo; i <= hi; i++) {
      const a = p[(i - 1 + n) % n], c = p[(i + 1) % n];
      next[i][0] = 0.25 * a[0] + 0.5 * p[i][0] + 0.25 * c[0];
      next[i][1] = 0.25 * a[1] + 0.5 * p[i][1] + 0.25 * c[1];
    }
    p = next;
  }
  if (closed) p[n - 1] = p[0].slice(); // keep the loop sealed
  return p;
}

function tangentAt(seg, atStart, span = 6) {
  const n = Math.min(span, seg.length - 1);
  const a = atStart ? seg[0] : seg[seg.length - 1];
  const b = atStart ? seg[n] : seg[seg.length - 1 - n];
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  return [dx / l, dy / l]; // points from the end INTO the segment
}

/* ---------------- prune + merge ---------------- */
function pruneAndMerge(segments, avgRadius) {
  const near = (a, b) => Math.hypot(a[0]-b[0], a[1]-b[1]) <= 2.5;

  // prune short spurs: segments with a "free" end shorter than the stroke is thick
  const pruneLen = Math.max(4, avgRadius * 1.6);
  let segs = segments.slice();
  for (let round = 0; round < 3; round++) {
    if (segs.length <= 1) break;
    const next = segs.filter((s, i) => {
      const len = polyLength(s);
      if (len >= pruneLen) return true;
      // count connections of each end to other segments
      const ends = [s[0], s[s.length - 1]];
      const conn = ends.map((e) =>
        segs.some((o, j) => j !== i && (near(o[0], e) || near(o[o.length-1], e))));
      // drop spur: attached at one end only, and tiny
      return !(conn[0] !== conn[1]);
    });
    if (next.length === segs.length || !next.length) break;
    segs = next;
  }

  // merge segments through junctions when their tangents are aligned
  let merged = true;
  let guard = 0;
  while (merged && guard++ < 60) {
    merged = false;
    outer:
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const a = segs[i], b = segs[j];
        const combos = [
          [false, true],  // a end   -> b start
          [false, false], // a end   -> b end
          [true,  true],  // a start -> b start
          [true,  false], // a start -> b end
        ];
        for (const [aStart, bStart] of combos) {
          const pa = aStart ? a[0] : a[a.length - 1];
          const pb = bStart ? b[0] : b[b.length - 1];
          if (!near(pa, pb)) continue;
          const ta = tangentAt(a, aStart);
          const tb = tangentAt(b, bStart);
          // both tangents point *into* their segments; a straight-through
          // junction means they point in opposite directions
          if (ta[0] * tb[0] + ta[1] * tb[1] > -0.55) continue;
          const left = aStart ? a.slice().reverse() : a.slice();
          const right = bStart ? b.slice(1) : b.slice(0, -1).reverse();
          segs.splice(j, 1);
          segs.splice(i, 1, left.concat(right));
          merged = true;
          break outer;
        }
      }
    }
  }
  return segs;
}

/* ---------------- ordering / direction ---------------- */
function orderStrokes(segs, avgRadius) {
  const dotLen = avgRadius * 2.2;
  const oriented = segs.map((s) => {
    const a = s[0], b = s[s.length - 1];
    const dx = Math.abs(b[0] - a[0]), dy = Math.abs(b[1] - a[1]);
    let pts = s;
    if (dy >= dx) { if (a[1] > b[1]) pts = s.slice().reverse(); }      // top -> bottom
    else if (a[0] > b[0]) pts = s.slice().reverse();                   // left -> right
    const len = polyLength(pts);
    const minX = Math.min(...pts.map((p) => p[0]));
    const minY = Math.min(...pts.map((p) => p[1]));
    return { pts, len, minX, minY, isDot: len < dotLen };
  });
  oriented.sort((p, q) => {
    if (p.isDot !== q.isDot) return p.isDot ? 1 : -1;  // dots & accents last
    if (Math.abs(p.minX - q.minX) > avgRadius * 2) return p.minX - q.minX;
    return p.minY - q.minY;
  });
  return oriented.map((o) => o.pts);
}

/* ---------------- public API ---------------- */
function skeletonizeGlyph(glyph) {
  if (!glyph._fsfSkeleton) {
    const raster = rasterizeGlyph(glyph, RASTER_FONT_SIZE);
    if (!raster) return null;
    const { grid, w, h, ox, oy } = raster;

    let area = 0;
    for (let i = 0; i < grid.length; i++) area += grid[i];
    if (!area) return (glyph._fsfSkeleton = { strokes: [], maxRadius: 1, ox, oy });

    const dist = distanceTransform(grid, w, h);
    let maxRadius = 0, sumR = 0, nR = 0;
    for (let i = 0; i < grid.length; i++) if (grid[i]) {
      const r = dist[i] / 3;
      if (r > maxRadius) maxRadius = r;
      sumR += r; nR++;
    }
    const avgRadius = Math.max(1.5, (sumR / nR) * 1.8); // rough stroke radius

    const sk = thin(grid, w, h);
    let segs = traceSkeleton(sk, w, h);
    segs = pruneAndMerge(segs, avgRadius);

    // tiny blob (dot glyphs: '.', accents) -> single tap stroke at centroid
    const total = segs.reduce((s, p) => s + polyLength(p), 0);
    if (!segs.length || total < avgRadius) {
      let cx = 0, cy = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
        if (grid[y * w + x]) { cx += x; cy += y; }
      segs = [[[cx / area, cy / area], [cx / area + 0.01, cy / area]]];
    }

    segs = segs.map((s) => rdp(s, 1.25));
    segs = orderStrokes(segs, avgRadius);

    // extend open stroke ends to the glyph tips — the skeleton stops about
    // one stroke-radius short, which made letter tips pop in all at once.
    // ONLY true tips are extended. An end that lies within the brush
    // coverage of another stroke (or a far part of its own stroke) is a
    // junction end — extending it would slice through the other stroke and
    // pre-reveal patches of it (e.g. H's crossbar cutting into the stems).
    const fg = (x, y) => x >= 0 && y >= 0 && x < w && y < h && grid[y * w + x];
    const distToSeg = (p, a, b) => {
      const l2 = (b[0]-a[0])**2 + (b[1]-a[1])**2;
      if (!l2) return Math.hypot(p[0]-a[0], p[1]-a[1]);
      let t = ((p[0]-a[0])*(b[0]-a[0]) + (p[1]-a[1])*(b[1]-a[1])) / l2;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(p[0]-(a[0]+t*(b[0]-a[0])), p[1]-(a[1]+t*(b[1]-a[1])));
    };
    const isJunctionEnd = (pt, selfIdx, fromStart, r) => {
      for (let j = 0; j < segs.length; j++) {
        const s = segs[j];
        let cum = 0;
        // for the own stroke, walk from the end in question so we can skip
        // the first 2.5r of path (it is trivially close to its own end)
        const pts = j === selfIdx && fromStart ? s : s;
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i], b = pts[i + 1];
          if (j === selfIdx) {
            // skip segments within 2.5r along-path of this end
            const dA = fromStart ? cum : polyLength(s) - cum;
            cum += Math.hypot(b[0]-a[0], b[1]-a[1]);
            const dB = fromStart ? cum : polyLength(s) - cum;
            if (Math.min(dA, dB) < r * 2.5) continue;
          }
          if (distToSeg(pt, a, b) < r * 1.1) return true;
        }
      }
      return false;
    };
    // pull a polyline end back along its path by `amount`
    const retract = (pts, fromStart, amount) => {
      const p = fromStart ? pts : pts.slice().reverse();
      let rem = amount;
      while (p.length > 1) {
        const d = Math.hypot(p[1][0]-p[0][0], p[1][1]-p[0][1]);
        if (d > rem) {
          const f = rem / d;
          p[0] = [p[0][0] + (p[1][0]-p[0][0]) * f, p[0][1] + (p[1][1]-p[0][1]) * f];
          break;
        }
        rem -= d;
        p.shift();
      }
      return fromStart ? p : p.reverse();
    };

    segs = segs.map((seg, selfIdx) => {
      if (seg.length < 2 || polyLength(seg) < 2) return seg;
      const s0 = seg[0], sN = seg[seg.length - 1];
      if (Math.hypot(s0[0]-sN[0], s0[1]-sN[1]) < 2.5) return seg; // closed loop
      let out = seg.slice();

      const handleEnd = (fromStart) => {
        const p = fromStart ? out[0] : out[out.length - 1];
        const q = fromStart ? out[1] : out[out.length - 2];
        let dx = p[0] - q[0], dy = p[1] - q[1];
        const l = Math.hypot(dx, dy);
        if (!l) return;
        dx /= l; dy /= l;
        const xi = Math.min(w - 1, Math.max(0, Math.round(p[0])));
        const yi = Math.min(h - 1, Math.max(0, Math.round(p[1])));
        const r = Math.max(dist[yi * w + xi] / 3, avgRadius / 1.8);

        if (isJunctionEnd(p, selfIdx, fromStart, r)) {
          // junction end: retract so the brush cap doesn't pre-reveal a
          // blob of the stroke it abuts (the other stroke paints that area)
          if (polyLength(out) > r * 2.2) out = retract(out, fromStart, r * 0.7);
          return;
        }
        // true tip: extend outward, stop where the glyph ends
        const maxS = Math.ceil(r * 1.35);
        for (let s = 1; s <= maxS; s++) {
          if (!fg(Math.round(p[0] + dx * s), Math.round(p[1] + dy * s))) {
            if (s > 1) {
              const e = [p[0] + dx * (s - 1), p[1] + dy * (s - 1)];
              fromStart ? out.unshift(e) : out.push(e);
            }
            return;
          }
        }
      };
      handleEnd(true);
      handleEnd(false);
      return out;
    });

    // human-style loops + StreamLine smoothing (kills pixel-thinning wobble)
    const step = Math.max(2.5, avgRadius * 0.3);
    segs = segs.map((seg) => {
      if (seg.length < 3 || polyLength(seg) < 4) return seg;
      const closed =
        Math.hypot(seg[0][0]-seg[seg.length-1][0], seg[0][1]-seg[seg.length-1][1]) < 2.5;
      let pts = seg;
      if (closed) {
        // a human draws 'o' from the top, sweeping left first (counterclockwise)
        const ring = pts.slice(0, -1);
        let top = 0;
        for (let i = 1; i < ring.length; i++) if (ring[i][1] < ring[top][1]) top = i;
        let rot = ring.slice(top).concat(ring.slice(0, top));
        if (rot.length > 2 && rot[1][0] > rot[rot.length - 1][0])
          rot = [rot[0]].concat(rot.slice(1).reverse());
        pts = rot.concat([rot[0].slice()]);
      }
      pts = resample(pts, step);
      return smoothPolyline(pts, 3, closed);
    });

    glyph._fsfSkeleton = { strokes: segs, maxRadius: Math.max(maxRadius, 1.5), ox, oy };
  }
  return glyph._fsfSkeleton;
}
