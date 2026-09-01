/* ReadFlow highlights.js — one draw module per effect.
 * Paint effects: draw(ctx, rects, t, opts) in PAGE coordinates, t ∈ [0,1], animates IN.
 * Text effects (colorpop / wordreveal / typewriter) restyle the document's own
 * glyphs — resolved via textStyle() which doc.drawText consults per word.
 * All deterministic: same (rects, t) → same pixels (export identity).
 */
(function () {
  'use strict';

  // ---------- deterministic wobble ----------
  function n1(x) { const s = Math.sin(x * 91.17 + 33.3) * 43758.5453; return (s - Math.floor(s)) * 2 - 1; }

  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    const v = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
  }
  function rgba(hex, a) { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }

  // total swipe "length" across multi-line rects so the sweep is continuous
  function totalLen(rects) { return rects.reduce((s, r) => s + r.w, 0); }

  // ---------- marker swipe ----------
  // shared progress→sweep-fraction shaping — used by BOTH draw and leadingPoint
  // so the tracking camera centers on the exact edge that is on screen
  function markerShape(t) {
    const over = 1.045; // overshoot width then settle back
    return t < 0.85 ? easeOutCubic(t / 0.85) * over : over - (over - 1) * ((t - 0.85) / 0.15);
  }

  // translucent highlighter sweeps left→right with slight overshoot + textured edge
  function marker(ctx, rects, t, opts) {
    if (t <= 0) return;
    const shaped = markerShape(t);
    const L = totalLen(rects);
    let done = shaped * L;
    ctx.save();
    ctx.globalAlpha = 0.42;
    ctx.fillStyle = opts.color;
    for (let ri = 0; ri < rects.length; ri++) {
      const r = rects[ri];
      if (done <= 0) break;
      const w = Math.min(r.w, done);
      done -= r.w;
      const seed = ri * 7.3;
      const y0 = r.y + r.h * 0.16, y1 = r.y + r.h * 0.92;
      // textured marker band: wobbly top/bottom edges
      ctx.beginPath();
      const steps = Math.max(4, Math.round(w / 26));
      ctx.moveTo(r.x, y0 + n1(seed) * 2.2);
      for (let i = 1; i <= steps; i++) {
        const px = r.x + (w * i) / steps;
        ctx.lineTo(px, y0 + n1(seed + i * 1.7) * 2.4);
      }
      // rounded sweep tip
      ctx.quadraticCurveTo(r.x + w + r.h * 0.16, (y0 + y1) / 2, r.x + w, y1 + n1(seed + 50) * 2);
      for (let i = steps; i >= 0; i--) {
        const px = r.x + (w * i) / steps;
        ctx.lineTo(px, y1 + n1(seed + 60 + i * 1.3) * 2.4);
      }
      ctx.closePath();
      ctx.fill();
      // denser core stripe for marker texture
      ctx.globalAlpha = 0.16;
      ctx.fillRect(r.x, r.y + r.h * 0.3, w, r.h * 0.45);
      ctx.globalAlpha = 0.42;
    }
    ctx.restore();
  }

  // ---------- underline draw ----------
  function underline(ctx, rects, t, opts) {
    if (t <= 0) return;
    const L = totalLen(rects);
    let done = easeInOutCubic(t) * L;
    ctx.save();
    ctx.strokeStyle = opts.color;
    ctx.lineWidth = Math.max(2.5, rects[0] ? rects[0].h * 0.07 : 3);
    ctx.lineCap = 'round';
    for (let ri = 0; ri < rects.length; ri++) {
      const r = rects[ri];
      if (done <= 0) break;
      const w = Math.min(r.w, done);
      done -= r.w;
      const y = r.y + r.h * 0.88;
      ctx.beginPath();
      ctx.moveTo(r.x, y + n1(ri * 3.1) * 1.2);
      const steps = Math.max(3, Math.round(w / 40));
      for (let i = 1; i <= steps; i++) {
        ctx.lineTo(r.x + (w * i) / steps, y + n1(ri * 3.1 + i) * 1.6);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---------- box / frame draw-on ----------
  function box(ctx, rects, t, opts) {
    if (t <= 0 || !rects.length) return;
    // one box per line-rect group; draw perimeter progressively
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of rects) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); }
    const pad = 6;
    x0 -= pad; y0 -= pad * 0.5; x1 += pad; y1 += pad * 0.5;
    const w = x1 - x0, h = y1 - y0, per = 2 * (w + h);
    let rem = easeInOutCubic(t) * per;
    ctx.save();
    ctx.strokeStyle = opts.color;
    ctx.lineWidth = 3.5;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    // start top-left, clockwise, with hand-drawn wobble
    const segs = [
      [x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]
    ];
    let started = false;
    for (let si = 0; si < segs.length && rem > 0; si++) {
      const [ax, ay, bx, by] = segs[si];
      const len = Math.hypot(bx - ax, by - ay);
      const f = Math.min(1, rem / len);
      rem -= len;
      const steps = Math.max(2, Math.round(len * f / 30));
      if (!started) { ctx.moveTo(ax + n1(si) * 1.5, ay + n1(si + 9) * 1.5); started = true; }
      for (let i = 1; i <= steps; i++) {
        const u = (i / steps) * f;
        ctx.lineTo(ax + (bx - ax) * u + n1(si * 11 + i) * 1.5, ay + (by - ay) * u + n1(si * 17 + i) * 1.5);
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  // ---------- circle scribble ----------
  // hand-drawn ellipse, ~1.7 loops
  function circle(ctx, rects, t, opts) {
    if (t <= 0 || !rects.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of rects) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const rx = (x1 - x0) / 2 * 1.22 + 8, ry = (y1 - y0) / 2 * 1.45 + 6;
    const LOOPS = 1.7;
    const end = easeOutCubic(t) * LOOPS * Math.PI * 2;
    ctx.save();
    ctx.strokeStyle = opts.color;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    const steps = Math.max(8, Math.round(end / 0.09));
    for (let i = 0; i <= steps; i++) {
      const a = (end * i) / steps - Math.PI * 0.7; // start upper-left
      const loop = a / (Math.PI * 2);
      const wob = 1 + 0.045 * Math.sin(a * 3.1 + 1) + 0.03 * loop; // each loop slightly larger
      const px = cx + Math.cos(a) * rx * wob + n1(i * 0.7) * 2;
      const py = cy + Math.sin(a) * ry * wob + n1(i * 0.9 + 5) * 2;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ---------- spotlight / dim ----------
  // page dims, span stays bright. Drawn OVER text; punches out span rects.
  // t: 0→1 fade in; caller passes fade-out t on the way back.
  function spotlight(ctx, rects, t, opts, pageW, pageH) {
    if (t <= 0) return;
    ctx.save();
    ctx.beginPath();
    // generous cover (page + margin so it also dims outside slightly)
    ctx.rect(-pageW, -pageH, pageW * 3, pageH * 3);
    for (const r of rects) {
      const p = 5;
      roundRectPath(ctx, r.x - p, r.y - p * 0.4, r.w + p * 2, r.h + p * 0.8, 7);
    }
    ctx.fillStyle = 'rgba(8,8,14,' + (0.62 * t).toFixed(3) + ')';
    ctx.fill('evenodd');
    ctx.restore();
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------- easings (local copies; engine exposes the full library) ----------
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  // ---------- effect registry ----------
  // kind: 'paint' → draw(ctx, rects, t, opts[, pageW, pageH]) over text
  //       'text'  → restyles glyphs via textStyle()
  const EFFECTS = {
    marker:     { label: 'Marker swipe',   kind: 'paint', draw: marker,   defaultColor: '#ffdf3d' },
    underline:  { label: 'Underline',      kind: 'paint', draw: underline, defaultColor: '#e8443a' },
    box:        { label: 'Box frame',      kind: 'paint', draw: box,      defaultColor: '#e8443a' },
    circle:     { label: 'Circle scribble', kind: 'paint', draw: circle,  defaultColor: '#e8443a' },
    colorpop:   { label: 'Color pop',      kind: 'text',  defaultColor: '#e8443a' },
    spotlight:  { label: 'Spotlight dim',  kind: 'paint', draw: spotlight, defaultColor: '#ffdf3d', dims: true },
    wordreveal: { label: 'Word-by-word',   kind: 'text',  defaultColor: '#1c1c28', hidesBefore: true },
    typewriter: { label: 'Typewriter',     kind: 'text',  defaultColor: '#1c1c28', hidesBefore: true }
  };

  // ---------- leading-edge companions (for the "track words" camera) ----------
  // Each returns the page-coordinate point of the effect's VISIBLE leading edge
  // at eased progress p — computed with the SAME math its draw / textStyle uses,
  // so the tracking camera stays glued to what is actually on screen.
  // Signature: leadingPoint(beat, rects, p, aux) — aux = {spanWords, rangeRects}.

  /** arc-length point `frac` of the way along multi-line rects (sweep fallback) */
  function sweepPoint(rects, frac) {
    if (!rects.length) return null;
    const total = totalLen(rects) || 1;
    let dist = Math.max(0, Math.min(1, frac)) * total;
    for (const r of rects) {
      if (dist <= r.w) return { x: r.x + dist, y: r.y + r.h / 2 };
      dist -= r.w;
    }
    const last = rects[rects.length - 1];
    return { x: last.x + last.w, y: last.y + last.h / 2 };
  }

  const clamp01 = t => Math.max(0, Math.min(1, t));

  // marker: sweep tip at markerShape(t)·L — the same shaped width marker() fills
  EFFECTS.marker.leadingPoint = (beat, rects, p) =>
    sweepPoint(rects, Math.min(1, markerShape(clamp01(p))));

  // underline: stroke tip at easeInOutCubic(t)·L, matching underline()
  EFFECTS.underline.leadingPoint = (beat, rects, p) =>
    sweepPoint(rects, easeInOutCubic(clamp01(p)));

  // colorpop: textStyle's sweep runs 25% ahead (k uses t·1.25)
  EFFECTS.colorpop.leadingPoint = (beat, rects, p) =>
    sweepPoint(rects, Math.min(1, clamp01(p) * 1.25));

  // wordreveal: the word currently brightening — textStyle brightens word i
  // over t ∈ [i/n, (i+0.8)/n], so at t the revealing word is floor(t·n)
  EFFECTS.wordreveal.leadingPoint = (beat, rects, p, aux) => {
    const words = (aux && aux.spanWords) || [];
    if (!words.length) return sweepPoint(rects, clamp01(p));
    const n = words.length;
    const w = words[Math.max(0, Math.min(n - 1, Math.floor(clamp01(p) * n)))];
    return { x: w.x + w.w / 2, y: w.y + w.h / 2 };
  };

  // typewriter: the caret — textStyle shows floor(t·total) chars, caret after them
  EFFECTS.typewriter.leadingPoint = (beat, rects, p, aux) => {
    const total = beat.end - beat.start;
    const cut = beat.start + Math.floor(clamp01(p) * total);
    if (aux && aux.rangeRects) {
      const rr = aux.rangeRects(beat.start, Math.max(beat.start + 1, cut));
      if (rr.length) { const r = rr[rr.length - 1]; return { x: r.x + r.w, y: r.y + r.h / 2 }; }
    }
    return sweepPoint(rects, clamp01(p));
  };

  // box / circle / spotlight draw around the whole span at once — no meaningful
  // left→right edge — so they use the sweep fallback via leadingPointFor().

  /** engine entry point: the effect's own leadingPoint, or the sweep fallback */
  function leadingPointFor(effect, beat, rects, p, aux) {
    const meta = EFFECTS[effect];
    if (meta && meta.leadingPoint) return meta.leadingPoint(beat, rects, p, aux);
    return sweepPoint(rects, clamp01(p));
  }

  /**
   * Per-word style for text effects.
   * fx = {effect, start, end, t, color, bold} — t is highlight progress (may be >1 after landing).
   * Returns null (no change) or {alpha, color, bold, visibleChars, caret}.
   */
  function textStyle(fx, word) {
    if (word.charEnd <= fx.start || word.charStart >= fx.end) return null;
    const t = Math.max(0, Math.min(1, fx.t));

    if (fx.effect === 'colorpop') {
      if (fx.t <= 0) return null;
      // letters transition to accent left→right across the span
      const span = fx.end - fx.start;
      const u = (word.charStart - fx.start) / Math.max(1, span);
      const k = Math.max(0, Math.min(1, (t * 1.25 - u) * 4));
      if (k <= 0) return null;
      return { color: k > 0.5 ? fx.color : undefined, bold: fx.bold && k > 0.5, alpha: 1 };
    }

    if (fx.effect === 'wordreveal') {
      if (fx.t <= 0) return { alpha: 0.13 };
      // karaoke pacing: words brighten sequentially
      const wordsIn = fx.spanWords || [];
      // match by char offset, not identity — the cached span list can outlive a
      // re-created layout, and indexOf() === -1 would flash the whole span in
      let idx = wordsIn.indexOf(word);
      if (idx < 0) idx = wordsIn.findIndex(w => w.charStart === word.charStart);
      if (idx < 0) idx = 0;
      const n = Math.max(1, wordsIn.length);
      const per = 1 / n;
      const wt = (t - idx * per) / (per * 0.8);
      const a = Math.max(0, Math.min(1, wt));
      return { alpha: 0.13 + 0.87 * a, color: a > 0.6 ? fx.color : undefined, bold: fx.bold && a > 0.6 };
    }

    if (fx.effect === 'typewriter') {
      if (fx.t <= 0) return { alpha: 0 };
      const total = fx.end - fx.start;
      const visible = Math.floor(t * total);
      const cut = fx.start + visible;
      if (word.charEnd <= cut) {
        // caret sits after the last fully visible word while typing
        const caret = t < 1 && cut >= word.charEnd && cut < word.charEnd + 1 && fx.showCaret;
        return { alpha: 1, color: fx.color, bold: fx.bold, caret };
      }
      if (word.charStart >= cut) return { alpha: 0 };
      return { alpha: 1, color: fx.color, bold: fx.bold, visibleChars: cut - word.charStart, caret: t < 1 && fx.showCaret };
    }
    return null;
  }

  window.RFHighlights = { EFFECTS, textStyle, leadingPointFor, rgba, hexToRgb };
})();
