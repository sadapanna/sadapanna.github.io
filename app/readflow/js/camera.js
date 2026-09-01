/* ReadFlow camera.js — auto-framing + pan/zoom interpolation.
 * A camera is {x, y, s}: page point (x,y) sits at frame center, page is scaled by s.
 * All functions are pure; engine.js asks for cameraAt(t).
 */
(function () {
  'use strict';

  const MIN_TEXT_PX = 14;   // never zoom out so far text on screen < this
  const MAX_TEXT_PX = 118;  // never zoom in past this (readable limit)

  /** camera that shows the whole page with margin */
  function fullPageCamera(layoutObj, frameW, frameH) {
    const s = Math.min(frameW / (layoutObj.pageWidth * 1.08), frameH / (layoutObj.pageHeight * 1.08), 2.5);
    return { x: layoutObj.pageWidth / 2, y: layoutObj.pageHeight / 2, s };
  }

  /**
   * Auto-frame a span: centered-ish with headroom, zoom proportional to span size,
   * clamped to readable limits. beat.zoom (multiplier) and offsetX/Y nudge it.
   */
  function frameForBeat(beat, doc, layoutObj, frameW, frameH) {
    const b = RFDoc.rangeBounds(doc, beat.start, beat.end);
    if (!b) return fullPageCamera(layoutObj, frameW, frameH);

    // desired: span occupies ~62% of frame width / ≤48% of height
    let s = Math.min(frameW * 0.62 / Math.max(b.w, 40), frameH * 0.48 / Math.max(b.h, 20));
    // readable clamps (driven by rendered font size)
    const fs = doc.fontSize;
    s = Math.min(s, MAX_TEXT_PX / fs);
    s = Math.max(s, MIN_TEXT_PX / fs);
    // never wider than the page itself allows (with slack)
    s = Math.max(s, Math.min(frameW / (layoutObj.pageWidth * 1.15), frameH / (layoutObj.pageHeight * 1.15)));
    s *= (beat.zoom || 1);

    // center span slightly above frame center (headroom for reading flow)
    let cx = b.x + b.w / 2;
    let cy = b.y + b.h / 2 + frameH * 0.045 / s;

    // keep the view roughly on the page (soft clamp)
    const viewW = frameW / s, viewH = frameH / s;
    const mX = Math.min(viewW * 0.5, layoutObj.pageWidth * 0.5);
    cx = clamp(cx, mX - viewW * 0.12, layoutObj.pageWidth - mX + viewW * 0.12);
    if (layoutObj.pageHeight > viewH * 0.8) {
      cy = clamp(cy, viewH * 0.35, layoutObj.pageHeight - viewH * 0.3);
    }

    cx += (beat.offsetX || 0);
    cy += (beat.offsetY || 0);
    return { x: cx, y: cy, s };
  }

  function clamp(v, lo, hi) { return lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)); }

  /**
   * Tighter "track words" zoom: frame ~45% of the frame width around the local
   * words at the focus point, clamped to the same readable limits as frameForBeat.
   * beat.zoom stays a relative multiplier on top.
   */
  function trackingZoom(beat, doc, bounds, frameW) {
    const local = Math.max(doc.fontSize * 6, Math.min(bounds.w, doc.fontSize * 13));
    let s = frameW * 0.45 / local;
    s = Math.min(s, MAX_TEXT_PX / doc.fontSize);
    s = Math.max(s, MIN_TEXT_PX / doc.fontSize);
    return s * (beat.zoom || 1);
  }

  /**
   * Camera center for a tracked focus point: same headroom as frameForBeat,
   * with beat.offsetX/Y applied as relative nudges. The horizontal clamp is
   * much looser than frameForBeat's (0.34 vs 0.12 view-widths of overhang):
   * tracking must be able to keep the highlight edge near frame center even
   * at the start/end of a line, which means letting the view hang off the
   * page — otherwise the camera pins at the clamp and visibly trails the
   * highlight across every line.
   */
  function trackingCenter(focus, beat, layoutObj, frameW, frameH, s) {
    let cx = focus.x + (beat.offsetX || 0);
    let cy = focus.y + frameH * 0.03 / s + (beat.offsetY || 0);
    const viewW = frameW / s, viewH = frameH / s;
    const mX = Math.min(viewW * 0.5, layoutObj.pageWidth * 0.5);
    cx = clamp(cx, mX - viewW * 0.34, layoutObj.pageWidth - mX + viewW * 0.34);
    if (layoutObj.pageHeight > viewH * 0.8) {
      cy = clamp(cy, viewH * 0.35, layoutObj.pageHeight - viewH * 0.3);
    }
    return { x: cx, y: cy };
  }

  /** interpolate cameras; zoom in log space so pan+zoom feel coupled */
  function lerpCamera(a, b, t) {
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      s: Math.exp(Math.log(a.s) + (Math.log(b.s) - Math.log(a.s)) * t)
    };
  }

  /**
   * Handheld drift: smooth, continuous position noise (screen px), zero-jerk
   * because it's a fixed smooth function of absolute time.
   * `weight` (0..1, default 1) lets the engine fade the wobble out during
   * deliberate camera moves and back in over the holds — still smooth in t.
   */
  function drift(t, amount, weight) {
    const a = (amount || 5) * (weight === undefined ? 1 : Math.max(0, Math.min(1, weight)));
    return {
      dx: a * (Math.sin(t * 0.53 + 1.7) * 0.7 + Math.sin(t * 1.31 + 4.2) * 0.3),
      dy: a * (Math.sin(t * 0.47 + 0.6) * 0.7 + Math.sin(t * 1.11 + 2.9) * 0.3)
    };
  }

  window.RFCamera = { fullPageCamera, frameForBeat, trackingZoom, trackingCenter, lerpCamera, drift, MIN_TEXT_PX, MAX_TEXT_PX };
})();
