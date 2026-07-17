/* ==========================================================================
 * font-stroke-flow builder
 * Converts font glyph outlines (opentype.js) or Hershey single-stroke
 * glyphs into an animated Lottie document.
 * ========================================================================== */
"use strict";

/* ---- Easing presets: cubic-bezier(x1, y1, x2, y2), CSS convention ------- */
const EASINGS = {
  "linear":            [0.00, 0.00, 1.00, 1.00],
  "ease":              [0.25, 0.10, 0.25, 1.00],
  "ease-in":           [0.42, 0.00, 1.00, 1.00],
  "ease-out":          [0.00, 0.00, 0.58, 1.00],
  "ease-in-out":       [0.42, 0.00, 0.58, 1.00],
  "ease-in-quad":      [0.11, 0.00, 0.50, 0.00],
  "ease-out-quad":     [0.50, 1.00, 0.89, 1.00],
  "ease-in-out-quad":  [0.45, 0.00, 0.55, 1.00],
  "ease-in-cubic":     [0.32, 0.00, 0.67, 0.00],
  "ease-out-cubic":    [0.33, 1.00, 0.68, 1.00],
  "ease-in-out-cubic": [0.65, 0.00, 0.35, 1.00],
  "ease-in-expo":      [0.70, 0.00, 0.84, 0.00],
  "ease-out-expo":     [0.16, 1.00, 0.30, 1.00],
  "ease-in-out-expo":  [0.87, 0.00, 0.13, 1.00],
};

function kfProp(pairs, easing) {
  const [x1, y1, x2, y2] = EASINGS[easing] || EASINGS["ease-in-out"];
  const k = pairs.map(([t, v], idx) => {
    const kf = { t, s: [v] };
    if (idx < pairs.length - 1) {
      kf.o = { x: [x1], y: [y1] };
      kf.i = { x: [x2], y: [y2] };
    }
    return kf;
  });
  return { a: 1, k };
}

const st = (v) => ({ a: 0, k: v });

/* Sampled cubic-bezier easing: at(x) -> eased progress, inv(p) -> time.
 * Used to spread ONE easing curve smoothly across a letter's many strokes. */
function easingLUT(name) {
  const [x1, y1, x2, y2] = EASINGS[name] || EASINGS["ease-in-out"];
  const N = 256;
  const xs = new Float64Array(N + 1), ys = new Float64Array(N + 1);
  for (let i = 0; i <= N; i++) {
    const t = i / N, mt = 1 - t;
    xs[i] = 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t;
    ys[i] = 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t;
  }
  const interp = (a, b, v) => {
    if (v <= a[0]) return b[0];
    if (v >= a[N]) return b[N];
    let lo = 0, hi = N;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (a[m] <= v) lo = m; else hi = m; }
    const f = (v - a[lo]) / (a[hi] - a[lo] || 1);
    return b[lo] + f * (b[hi] - b[lo]);
  };
  return { at: (x) => interp(xs, ys, x), inv: (p) => interp(ys, xs, p) };
}

/* Bake a value curve into per-frame linear keyframes over [t0, t1].
 * Dense baking = perfectly continuous motion, no per-stroke jerk. */
function bakedProp(t0, t1, fn) {
  const times = [t0];
  for (let t = Math.floor(t0) + 1; t < t1; t++) if (t > t0) times.push(t);
  times.push(t1);
  const k = times.map((t, i) => {
    const kf = { t: Math.round(t * 100) / 100, s: [Math.round(fn(t) * 100) / 100] };
    if (i < times.length - 1) {
      kf.o = { x: [0.5], y: [0.5] };
      kf.i = { x: [0.5], y: [0.5] };
    }
    return kf;
  });
  return { a: 1, k };
}

const TR_IDENTITY = () => ({
  ty: "tr", p: st([0, 0]), a: st([0, 0]), s: st([100, 100]),
  r: st(0), o: st(100), sk: st(0), sa: st(0),
});

/* ==========================================================================
 * Glyph extraction — common contour form:
 *   contour = { closed: bool, points: [[x,y],...], segs: [[c1,c2,end],...] }
 * where segs[i] connects points[i] -> points[i+1] with absolute cubic
 * control points; for straight lines c1 = start, c2 = end.
 * ========================================================================== */

function quadToCubic(p0, q, p2) {
  return [
    [p0[0] + (2 / 3) * (q[0] - p0[0]), p0[1] + (2 / 3) * (q[1] - p0[1])],
    [p2[0] + (2 / 3) * (q[0] - p2[0]), p2[1] + (2 / 3) * (q[1] - p2[1])],
    p2,
  ];
}

/* opentype.js path commands -> contours (coords already y-down, px) */
function commandsToContours(commands) {
  const contours = [];
  let cur = null, pos = null;
  for (const c of commands) {
    if (c.type === "M") {
      pos = [c.x, c.y];
      cur = { closed: false, start: pos, segs: [] };
      contours.push(cur);
    } else if (c.type === "L") {
      const end = [c.x, c.y];
      cur.segs.push([pos, end, end]);
      pos = end;
    } else if (c.type === "C") {
      const end = [c.x, c.y];
      cur.segs.push([[c.x1, c.y1], [c.x2, c.y2], end]);
      pos = end;
    } else if (c.type === "Q") {
      const end = [c.x, c.y];
      cur.segs.push(quadToCubic(pos, [c.x1, c.y1], end));
      pos = end;
    } else if (c.type === "Z") {
      if (cur && pos && (pos[0] !== cur.start[0] || pos[1] !== cur.start[1])) {
        cur.segs.push([pos, cur.start, cur.start]);
      }
      if (cur) cur.closed = true;
      pos = cur ? cur.start : null;
    }
  }
  return contours.filter((c) => c.segs.length);
}

/* Hershey "d" string ("M x,y L x,y x,y ... M ...") -> open polyline contours */
function hersheyToContours(d) {
  const contours = [];
  let cur = null;
  const tokens = d.match(/[ML]|-?[\d.]+,-?[\d.]+/g) || [];
  let mode = null;
  for (const tok of tokens) {
    if (tok === "M" || tok === "L") { mode = tok; continue; }
    const [x, y] = tok.split(",").map(Number);
    if (mode === "M") {
      cur = { closed: false, start: [x, y], segs: [] };
      contours.push(cur);
      mode = "L"; // subsequent bare pairs continue the line
    } else if (cur) {
      const prev = cur.segs.length ? cur.segs[cur.segs.length - 1][2] : cur.start;
      cur.segs.push([prev, [x, y], [x, y]]);
    }
  }
  return contours.filter((c) => c.segs.length);
}

/* Approximate contour length (flattens cubics) */
function contourLength(contour) {
  let len = 0, prev = contour.start;
  for (const [c1, c2, end] of contour.segs) {
    const straight = c1 === prev || (c1[0] === prev[0] && c1[1] === prev[1]);
    if (straight && c2[0] === end[0] && c2[1] === end[1]) {
      len += Math.hypot(end[0] - prev[0], end[1] - prev[1]);
    } else {
      let p = prev;
      for (let i = 1; i <= 8; i++) {
        const t = i / 8, mt = 1 - t;
        const x = mt*mt*mt*prev[0] + 3*mt*mt*t*c1[0] + 3*mt*t*t*c2[0] + t*t*t*end[0];
        const y = mt*mt*mt*prev[1] + 3*mt*mt*t*c1[1] + 3*mt*t*t*c2[1] + t*t*t*end[1];
        len += Math.hypot(x - p[0], y - p[1]);
        p = [x, y];
      }
    }
    prev = end;
  }
  return len;
}

/* contour -> Lottie "sh" shape (tangents relative to vertices) */
function contourToShape(contour, dx, dy) {
  const pts = [contour.start, ...contour.segs.map((s) => s[2])];
  const n = contour.closed ? pts.length - 1 : pts.length;
  const v = [], ins = [], outs = [];
  const inAbs = new Array(n).fill(null);
  const outAbs = new Array(n).fill(null);

  for (let i = 0; i < n; i++) v.push([pts[i][0] + dx, pts[i][1] + dy]);
  contour.segs.forEach(([c1, c2], i) => {
    const a = i % n, b = (i + 1) % n;
    outAbs[a] = [c1[0] + dx, c1[1] + dy];
    if (contour.closed || i < n - 1) inAbs[b] = [c2[0] + dx, c2[1] + dy];
    else inAbs[n - 1] = [c2[0] + dx, c2[1] + dy]; // open path last point
  });

  for (let i = 0; i < n; i++) {
    const o = outAbs[i] || v[i];
    const it = inAbs[i] || v[i];
    outs.push([o[0] - v[i][0], o[1] - v[i][1]]);
    ins.push([it[0] - v[i][0], it[1] - v[i][1]]);
  }
  return { ty: "sh", ks: st({ c: contour.closed, v, i: ins, o: outs }) };
}

/* Smooth polyline -> Lottie "sh" shape using Catmull-Rom style tangents */
function polylineToSmoothShape(pts, dx, dy) {
  const n = pts.length;
  const v = pts.map(([x, y]) => [x + dx, y + dy]);
  const ins = [], outs = [];
  for (let i = 0; i < n; i++) {
    const prev = v[Math.max(0, i - 1)];
    const next = v[Math.min(n - 1, i + 1)];
    // tangent along the local direction; /6 ≈ Catmull-Rom to cubic
    const tx = (next[0] - prev[0]) / 6;
    const ty = (next[1] - prev[1]) / 6;
    outs.push([tx, ty]);
    ins.push([-tx, -ty]);
  }
  return { ty: "sh", ks: st({ c: false, v, i: ins, o: outs }) };
}

/* ==========================================================================
 * Letter extraction (all modes) ->
 *   { letters: [{ char, contours, x, length }], width, height, pad, baseline }
 * ========================================================================== */

function extractOutlineLetters(font, text, fontSize, pad, lineHeight) {
  const scale = fontSize / font.unitsPerEm;
  const lh = lineHeight || fontSize * 1.25;
  const letters = [];
  const missing = [];
  let x = pad, line = 0, maxX = 0;
  let prevGlyph = null;

  const ascent = font.ascender * scale;
  const descent = font.descender * scale; // negative

  for (const ch of text) {
    if (ch === "\n") {
      maxX = Math.max(maxX, x);
      x = pad;
      line++;
      prevGlyph = null;
      continue;
    }
    const glyph = font.charToGlyph(ch);
    const isMissing = glyph.index === 0 && ch !== " ";
    if (prevGlyph && glyph) x += font.getKerningValue(prevGlyph, glyph) * scale;

    if (!isMissing && ch !== " ") {
      const path = glyph.getPath(0, 0, fontSize); // y-down, baseline at 0
      const contours = commandsToContours(path.commands);
      if (contours.length) {
        letters.push({
          char: ch, contours, x, baseline: pad + ascent + line * lh,
          length: contours.reduce((s, c) => s + contourLength(c), 0),
        });
      }
    } else if (isMissing) missing.push(ch);

    x += (glyph.advanceWidth || font.unitsPerEm * 0.3) * scale;
    prevGlyph = glyph;
  }

  return {
    letters, missing,
    width: Math.ceil(Math.max(maxX, x) + pad),
    height: Math.ceil(ascent - descent + line * lh + 2 * pad),
  };
}

/* Brush mode: real font outlines (for the fill) + skeleton centerline
 * strokes (for the animated brush matte). Requires skeleton.js. */
function extractBrushLetters(font, text, fontSize, pad, lineHeight) {
  const scale = fontSize / font.unitsPerEm;
  const rasterScale = fontSize / RASTER_FONT_SIZE;
  const lh = lineHeight || fontSize * 1.25;
  const letters = [];
  const missing = [];
  let x = pad, line = 0, maxX = 0;
  let prevGlyph = null;

  const ascent = font.ascender * scale;
  const descent = font.descender * scale;

  for (const ch of text) {
    if (ch === "\n") {
      maxX = Math.max(maxX, x);
      x = pad;
      line++;
      prevGlyph = null;
      continue;
    }
    const glyph = font.charToGlyph(ch);
    const isMissing = glyph.index === 0 && ch !== " ";
    if (prevGlyph && glyph) x += font.getKerningValue(prevGlyph, glyph) * scale;

    if (!isMissing && ch !== " ") {
      const path = glyph.getPath(0, 0, fontSize);
      const contours = commandsToContours(path.commands);
      const skel = skeletonizeGlyph(glyph);
      if (contours.length && skel && skel.strokes.length) {
        // skeleton coords are raster px relative to (ox, oy) at RASTER_FONT_SIZE
        const strokes = skel.strokes.map((s) =>
          s.map(([px, py]) => [(px + skel.ox) * rasterScale, (py + skel.oy) * rasterScale]));
        letters.push({
          char: ch, contours, strokes, x, baseline: pad + ascent + line * lh,
          brushWidth: skel.maxRadius * 2 * rasterScale,
          length: strokes.reduce((sum, s) => {
            let l = 0;
            for (let i = 1; i < s.length; i++)
              l += Math.hypot(s[i][0]-s[i-1][0], s[i][1]-s[i-1][1]);
            return sum + l;
          }, 0),
        });
      }
    } else if (isMissing) missing.push(ch);

    x += (glyph.advanceWidth || font.unitsPerEm * 0.3) * scale;
    prevGlyph = glyph;
  }

  return {
    letters, missing,
    width: Math.ceil(Math.max(maxX, x) + pad),
    height: Math.ceil(ascent - descent + line * lh + 2 * pad),
  };
}

function extractHersheyLetters(fontData, text, fontSize, pad, lineHeight) {
  // Hershey units: baseline y=22, cap height ~21 units (y=1). Map cap height
  // to ~0.7em so sizes roughly match outline fonts.
  const scale = (fontSize * 0.7) / 21;
  const lh = lineHeight || fontSize * 1.25;
  const letters = [];
  const missing = [];
  let x = pad, line = 0, maxX = 0;
  let minY = 0, maxY = 24;

  for (const ch of text) {
    if (ch === "\n") {
      maxX = Math.max(maxX, x);
      x = pad;
      line++;
      continue;
    }
    if (ch === " ") { x += 12 * scale; continue; }
    const code = ch.charCodeAt(0);
    const rec = code >= 33 && code <= 127 ? fontData.chars[code - 33] : null;
    if (!rec || !rec.d) { missing.push(ch); x += 12 * scale; continue; }

    const contours = hersheyToContours(rec.d).map((c) => ({
      closed: false,
      start: [c.start[0] * scale, c.start[1] * scale],
      segs: c.segs.map(([a, b, e]) => [
        [a[0] * scale, a[1] * scale], [b[0] * scale, b[1] * scale],
        [e[0] * scale, e[1] * scale],
      ]),
    }));
    for (const c of contours) {
      for (const p of [c.start, ...c.segs.map((s) => s[2])]) {
        minY = Math.min(minY, p[1] / scale);
        maxY = Math.max(maxY, p[1] / scale);
      }
    }
    letters.push({
      char: ch, contours, x, line, baseline: 0, // patched below
      length: contours.reduce((s, c) => s + contourLength(c), 0),
    });
    x += rec.o * 2 * scale;
  }

  // shift everything down so minY sits at pad; offset each line
  const shift = pad - minY * scale;
  for (const l of letters) l.baseline = shift + l.line * lh;

  return {
    letters, missing,
    width: Math.ceil(Math.max(maxX, x) + pad),
    height: Math.ceil((maxY - minY) * scale + line * lh + 2 * pad),
  };
}

/* ==========================================================================
 * Lottie assembly
 * ========================================================================== */

function hexToRgb01(hex) {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}

/**
 * params: {
 *   mode: "brush" | "outline" | "stroke",
 *     brush   = skeleton strokes revealed via alpha matte (painted look)
 *     outline = trace outline then fade the fill in
 *     stroke  = single-line pen fonts (Hershey)
 *   fps, letterDuration (s), overlap (0-120), easing,
 *   timingMode: "uniform" | "natural",
 *   strokeColor, strokeWidth, fillColor, brushScale (% of letter thickness),
 *   fillMode: "fade" | "none", fillStart (0-100), fillDuration (5-150),
 *   holdSeconds, bgColor | null, name
 * }
 * extracted: result of extract*Letters()
 */
function buildLottie(params, extracted) {
  const { letters, width, height } = extracted;
  const fps = params.fps;
  const baseFrames = Math.max(2, Math.round(params.letterDuration * fps));

  // per-letter frame counts
  let durations;
  if (params.timingMode === "natural" && letters.length) {
    const avg = letters.reduce((s, l) => s + l.length, 0) / letters.length;
    durations = letters.map((l) => {
      const ratio = Math.min(2.5, Math.max(0.35, l.length / (avg || 1)));
      return Math.max(2, Math.round(baseFrames * ratio));
    });
  } else {
    durations = letters.map(() => baseFrames);
  }

  const strokeRgb = hexToRgb01(params.strokeColor);
  const fillRgb = hexToRgb01(params.fillColor);
  const layers = [];
  let cursor = 0, animEnd = 0;

  let layerInd = 1;

  letters.forEach((letter, idx) => {
    const dur = durations[idx];
    const start = Math.round(cursor);
    const drawEnd = start + dur;
    cursor += dur * (params.overlap / 100);

    const makePaths = () =>
      letter.contours.map((c) => contourToShape(c, letter.x, letter.baseline));

    const baseKs = () => ({
      o: st(100), r: st(0), p: st([0, 0, 0]),
      a: st([0, 0, 0]), s: st([100, 100, 100]),
    });

    /* ---- brush mode: matte layer (brush strokes) + revealed fill --------
     * One easing curve is applied across the WHOLE letter; every stroke gets
     * its slice of that curve baked to per-frame keyframes, so the pen moves
     * with one continuous motion instead of restarting its ease per stroke. */
    if (params.mode === "brush") {
      const ease = easingLUT(params.easing);
      const brushW = letter.brushWidth * (params.brushScale / 100);

      const segLen = (pts) => {
        let l = 0;
        for (let i = 1; i < pts.length; i++)
          l += Math.hypot(pts[i][0]-pts[i-1][0], pts[i][1]-pts[i-1][1]);
        return l;
      };
      const lens = letter.strokes.map(segLen);
      // effective length floors give dots/short bars a visible time share
      const effs = lens.map((l) => Math.max(l, brushW * 0.55));
      const total = effs.reduce((a, b) => a + b, 0) || 1;

      // pen lifts: a short pause between strokes reads as a real hand
      const nLifts = letter.strokes.length - 1;
      const gap = nLifts > 0 ? Math.min(dur * 0.045, 3) : 0;
      const drawTime = Math.max(letter.strokes.length * 2, dur - gap * nLifts);

      let cumF = 0;
      const strokeGroups = letter.strokes.map((pts, k) => {
        const f0 = cumF;
        cumF = Math.min(1, cumF + effs[k] / total);
        const f1 = k === letter.strokes.length - 1 ? 1 : cumF;
        // time window = where the letter-level eased progress crosses f0/f1
        const off = start + gap * k;
        const t0 = off + ease.inv(f0) * drawTime;
        const t1 = Math.max(t0 + 0.5, off + ease.inv(f1) * drawTime);
        const isDot = lens[k] < brushW * 0.5;

        const items = [polylineToSmoothShape(pts, letter.x, letter.baseline)];
        if (isDot) {
          // a dot is a pen press: grow the brush width instead of trimming
          items.push({ ty: "st", nm: "brush", c: st([1, 1, 1]), o: st(100),
            w: bakedProp(t0, t1, (t) =>
              Math.max(0, Math.min(1, (t - t0) / (t1 - t0))) * brushW),
            lc: 2, lj: 2 });
        } else {
          const span = Math.max(1e-6, f1 - f0);
          items.push({ ty: "tm", nm: "reveal", s: st(0),
            e: bakedProp(t0, t1, (t) => {
              const p = (ease.at((t - off) / drawTime) - f0) / span;
              return Math.max(0, Math.min(1, p)) * 100;
            }),
            o: st(0), m: 1 });
          // pressure onset: the brush blooms to full width as the pen lands
          // (width only ever grows, so nothing already revealed disappears)
          const onset = Math.min(6, (t1 - t0) * 0.35);
          items.push({ ty: "st", nm: "brush", c: st([1, 1, 1]), o: st(100),
            w: onset > 0.75
              ? kfProp([[t0, brushW * 0.55], [t0 + onset, brushW]], "ease-out")
              : st(brushW),
            lc: 2, lj: 2 });
        }
        items.push(TR_IDENTITY());
        return { ty: "gr", nm: `brush stroke ${k}`, it: items };
      });

      // settle pass: fade the full letter in right after the last stroke —
      // guarantees complete coverage (serifs/slivers the skeleton missed)
      const settle = Math.max(4, Math.round(dur * 0.12));
      animEnd = Math.max(animEnd, drawEnd + settle);

      // matte layer (drawn brush strokes) must sit directly above the fill
      layers.push({
        ddd: 0, ind: layerInd++, ty: 4, sr: 1, ao: 0, st: 0, bm: 0,
        nm: `brush matte '${letter.char}'`, td: 1,
        ks: baseKs(), shapes: strokeGroups, ip: 0, op: 0,
      });
      layers.push({
        ddd: 0, ind: layerInd++, ty: 4, sr: 1, ao: 0, st: 0, bm: 0,
        nm: `letter ${idx}: '${letter.char}'`, tt: 1, // alpha matte
        ks: baseKs(),
        shapes: [{
          ty: "gr", nm: `fill '${letter.char}'`,
          it: [...makePaths(),
            { ty: "fl", nm: "fill", r: 1, c: st(fillRgb), o: st(100) },
            TR_IDENTITY()],
        }],
        ip: 0, op: 0,
      });
      layers.push({
        ddd: 0, ind: layerInd++, ty: 4, sr: 1, ao: 0, st: 0, bm: 0,
        nm: `backfill '${letter.char}'`,
        ks: baseKs(),
        shapes: [{
          ty: "gr", nm: `backfill '${letter.char}'`,
          it: [...makePaths(),
            { ty: "fl", nm: "fill", r: 1, c: st(fillRgb),
              o: kfProp([[drawEnd, 0], [drawEnd + settle, 100]], "ease") },
            TR_IDENTITY()],
        }],
        ip: 0, op: 0,
      });
      return;
    }

    const groups = [];

    // stroke group: write-on via trim paths
    groups.push({
      ty: "gr", nm: `stroke '${letter.char}'`,
      it: [
        ...makePaths(),
        {
          ty: "tm", nm: "write-on",
          s: st(0),
          e: kfProp([[start, 0], [drawEnd, 100]], params.easing),
          o: st(0),
          // outline: trim contours in parallel; handwriting: sequential strokes
          m: params.mode === "stroke" ? 2 : 1,
        },
        {
          ty: "st", nm: "stroke",
          c: st(strokeRgb), o: st(100), w: st(params.strokeWidth),
          lc: 2, lj: 2,
        },
        TR_IDENTITY(),
      ],
    });

    let letterEnd = drawEnd;

    // fill group (outline mode only)
    if (params.mode === "outline" && params.fillMode === "fade") {
      const fadeStart = start + Math.round((dur * params.fillStart) / 100);
      const fadeEnd = fadeStart + Math.max(1, Math.round((dur * params.fillDuration) / 100));
      groups.unshift({
        ty: "gr", nm: `fill '${letter.char}'`,
        it: [
          ...makePaths(),
          {
            ty: "fl", nm: "fill", r: 1,
            c: st(fillRgb),
            o: kfProp([[fadeStart, 0], [fadeEnd, 100]], params.easing),
          },
          TR_IDENTITY(),
        ],
      });
      letterEnd = Math.max(letterEnd, fadeEnd);
    }

    animEnd = Math.max(animEnd, letterEnd);

    layers.push({
      ddd: 0, ind: layerInd++, ty: 4, sr: 1, ao: 0, st: 0, bm: 0,
      nm: `letter ${idx}: '${letter.char}'`,
      ks: {
        o: st(100), r: st(0), p: st([0, 0, 0]),
        a: st([0, 0, 0]), s: st([100, 100, 100]),
      },
      shapes: groups,
      ip: 0, op: 0, // patched below
    });
  });

  const op = animEnd + Math.round(params.holdSeconds * fps);
  for (const l of layers) l.op = op;

  if (params.bgColor) {
    layers.push({
      ddd: 0, ind: layerInd++, ty: 1, sr: 1, ao: 0, st: 0, bm: 0,
      nm: "background", sc: params.bgColor, sw: width, sh: height,
      ks: {
        o: st(100), r: st(0), p: st([width / 2, height / 2, 0]),
        a: st([width / 2, height / 2, 0]), s: st([100, 100, 100]),
      },
      ip: 0, op,
    });
  }

  return {
    v: "5.7.4", fr: fps, ip: 0, op: Math.max(op, 1),
    w: width, h: height,
    nm: params.name || "font-stroke-flow",
    ddd: 0, assets: [], layers,
    meta: { g: "font-stroke-flow" },
  };
}
