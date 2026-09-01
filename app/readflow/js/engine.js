/* ReadFlow engine.js — state, timeline, the PURE drawFrame renderer, rAF player,
 * easing library, and the window.RF contract object.
 * drawFrame(ctx, tSeconds, width, height) renders the complete frame — including
 * the watermark — at any resolution; preview, scrub and export all use it.
 */
(function () {
  'use strict';

  // ---------- easing library ----------
  const EASINGS = {
    linear: t => t,
    easeIn: t => t * t * t,
    easeOut: t => 1 - Math.pow(1 - t, 3),
    easeInOut: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    settle: t => { // ease-in-out with a slight settle at the end (default camera feel)
      if (t <= 0) return 0; if (t >= 1) return 1;
      if (t < 0.5) { const u = 2 * t; return 0.5 * u * u * u; }
      const u = 2 * t - 1, s = 0.7;
      return 0.5 + 0.5 * (1 + (s + 1) * Math.pow(u - 1, 3) + s * Math.pow(u - 1, 2));
    },
    backOut: t => { const s = 1.70158; const u = t - 1; return 1 + (s + 1) * u * u * u + s * u * u; }
  };
  const EASING_NAMES = ['settle', 'easeInOut', 'easeOut', 'easeIn', 'linear'];

  // ---------- default state ----------
  function defaultState() {
    return {
      version: 1,
      doc: {
        text: '',
        theme: 'clean',
        fontFamily: 'Poppins',
        fontSize: 30,
        lineHeight: 1.65,
        paraSpacing: 0.8,
        textColor: '',          // '' = theme default
        maxWidth: 760,
        author: ''
      },
      defaults: { effect: 'marker', color: '#ffdf3d', moveDur: 0.9, fxDur: 0.8, hold: 1.6, camEase: 'settle', fxEase: 'easeInOut' },
      beats: [],                // see beats.js makeBeat()
      camera: { establishing: true, establishingHold: 1.5, drift: true, driftAmount: 5 },
      overlays: [],             // {id,type,x,y,beat,fadeIn,hideBeat,fadeOut,...per-type}
      filters: { vignette: false, grain: false, pageShadow: true, progressBar: false, bg: '', bgGradient: false },
      frame: { width: 1920, height: 1080, fps: 30, preset: 'landscape' }
    };
  }

  const state = defaultState();

  // ---------- timeline ----------
  function estDur() { return state.camera.establishing ? state.camera.establishingHold : 0; }

  function beatSegments() {
    // [{beat, tStart, tFx, tHold, tEnd}]
    const segs = [];
    let t = estDur();
    for (const b of state.beats) {
      const move = Math.max(0, b.moveDur), fx = Math.max(0.05, b.fxDur), hold = Math.max(0, b.hold);
      segs.push({ beat: b, tStart: t, tFx: t + move, tHold: t + move + fx, tEnd: t + move + fx + hold });
      t += move + fx + hold;
    }
    return segs;
  }

  function getTotalDuration() {
    const segs = beatSegments();
    return segs.length ? segs[segs.length - 1].tEnd : estDur();
  }

  // ---------- per-beat caches (layout-dependent, invalidated by key) ----------
  const beatCache = new Map(); // beat.id -> {key, cam, rects, spanWords}
  function beatData(beat, L) {
    const key = L.settingsKeyStr + '|' + state.frame.width + 'x' + state.frame.height + '|' +
      beat.start + ',' + beat.end + ',' + (beat.zoom || 1) + ',' + (beat.offsetX || 0) + ',' + (beat.offsetY || 0);
    let d = beatCache.get(beat.id);
    if (!d || d.key !== key) {
      d = {
        key,
        cam: RFCamera.frameForBeat(beat, state.doc, L, state.frame.width, state.frame.height),
        rects: RFDoc.rangeRects(state.doc, beat.start, beat.end),
        spanWords: L.words.filter(w => w.charEnd > beat.start && w.charStart < beat.end)
      };
      beatCache.set(beat.id, d);
    }
    return d;
  }

  // ---------- camera at time t ----------
  function getCameraAt(t) {
    const L = RFDoc.layout(state.doc);
    const full = RFCamera.fullPageCamera(L, state.frame.width, state.frame.height);
    const segs = beatSegments();
    if (!segs.length) return full;

    let prevCam = full;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      const cam = beatData(s.beat, L).cam;
      if (t < s.tFx) {
        const move = s.tFx - s.tStart;
        const u = move > 0.0001 ? Math.max(0, Math.min(1, (t - s.tStart) / move)) : 1;
        const ease = EASINGS[s.beat.camEase] || EASINGS.settle;
        return RFCamera.lerpCamera(prevCam, cam, ease(u));
      }
      if (t < s.tEnd) return cam;
      prevCam = cam;
    }
    return prevCam;
  }

  /* How "handheld" the shot is at time t: 0 while the camera is deliberately
   * moving in, ramping smoothly to 1 across the highlight + hold. Smooth in t,
   * so it can never introduce a jerk of its own. */
  function driftWeight(t) {
    const segs = beatSegments();
    if (!segs.length) return 1;
    for (const s of segs) {
      if (t < s.tStart) return 1;              // establishing shot: fully handheld
      if (t < s.tFx) {
        const move = s.tFx - s.tStart;
        if (move < 0.0001) return 1;
        const u = (t - s.tStart) / move;
        return EASINGS.easeInOut(u < 0.5 ? 1 - u * 2 : (u - 0.5) * 2); // dip to 0 mid-move
      }
      if (t < s.tEnd) return 1;
    }
    return 1;
  }

  function driftAt(t) {
    if (!state.camera.drift) return { dx: 0, dy: 0 };
    const d = RFCamera.drift(t, state.camera.driftAmount, driftWeight(t));
    return d;
  }

  // ---------- noise tile for film grain (deterministic) ----------
  let grainTile = null;
  function getGrainTile() {
    if (grainTile) return grainTile;
    const c = document.createElement('canvas');
    c.width = c.height = 160;
    const gx = c.getContext('2d');
    const img = gx.createImageData(160, 160);
    let seed = 1234567;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 128 + (rnd() - 0.5) * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 26;
    }
    gx.putImageData(img, 0, 0);
    grainTile = c;
    return c;
  }

  // ---------- overlay images ----------
  const imgCache = new Map(); // src -> {img, ready}
  function getImage(src) {
    let e = imgCache.get(src);
    if (!e) {
      const img = new Image();
      e = { img, ready: false };
      img.onload = () => { e.ready = true; document.dispatchEvent(new CustomEvent('rf:tick')); };
      img.src = src;
      imgCache.set(src, e);
    }
    return e.ready ? e.img : null;
  }

  // ---------- backdrop + watermark helpers ----------
  function luminance(hex) {
    if (!hex) return 0.9;
    const [r, g, b] = RFHighlights.hexToRgb(hex);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }

  function backdropInfo(theme) {
    const f = state.filters;
    if (f.bg) return { color: f.bg, gradient: f.bgGradient, luma: luminance(f.bg) };
    if (theme.gradient) return { color: null, themeGradient: theme.gradient, luma: 0.8 };
    return { color: theme.backdrop || '#e9e9f2', gradient: f.bgGradient, luma: luminance(theme.backdrop || '#e9e9f2') };
  }

  function shade(hex, amt) { // lighten(+)/darken(-) a hex color
    const [r, g, b] = RFHighlights.hexToRgb(hex);
    const f = v => Math.max(0, Math.min(255, Math.round(v + amt * 255)));
    return `rgb(${f(r)},${f(g)},${f(b)})`;
  }

  // =====================================================================
  // drawFrame — PURE renderer. Same t → same pixels, at any resolution.
  // =====================================================================
  function drawFrame(ctx, tSeconds, width, height) {
    const fw = state.frame.width, fh = state.frame.height;
    const t = Math.max(0, Math.min(getTotalDuration(), tSeconds));
    const L = RFDoc.layout(state.doc);
    const theme = L.theme;
    const segs = beatSegments();

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(width / fw, height / fh);

    // ----- backdrop -----
    const bd = backdropInfo(theme);
    if (bd.themeGradient) {
      const g = ctx.createLinearGradient(0, 0, fw, fh);
      g.addColorStop(0, bd.themeGradient[0]); g.addColorStop(1, bd.themeGradient[1]);
      ctx.fillStyle = g;
    } else if (bd.gradient) {
      const g = ctx.createLinearGradient(0, 0, fw, fh);
      g.addColorStop(0, shade(bd.color, 0.10)); g.addColorStop(1, shade(bd.color, -0.12));
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = bd.color;
    }
    ctx.fillRect(0, 0, fw, fh);

    // ----- camera -----
    const cam = getCameraAt(t);
    const { dx, dy } = driftAt(t);
    ctx.save();
    ctx.translate(fw / 2 + dx, fh / 2 + dy);
    ctx.scale(cam.s, cam.s);
    ctx.translate(-cam.x, -cam.y);

    // ----- page -----
    RFDoc.drawPage(ctx, state.doc, { shadow: state.filters.pageShadow });

    // ----- per-beat effect states -----
    const paints = [];    // {beat, rects, p}
    const spots = [];     // spotlight with fade in/out
    const textFx = [];    // text-restyle effects
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i], b = s.beat;
      const meta = RFHighlights.EFFECTS[b.effect];
      if (!meta) continue;
      if (t < s.tFx && !meta.hidesBefore && b.effect !== 'colorpop') continue; // not started
      const fxDur = s.tHold - s.tFx;
      const ease = EASINGS[b.fxEase] || EASINGS.easeInOut;
      const raw = (t - s.tFx) / fxDur;
      const p = raw <= 0 ? 0 : raw >= 1 ? 1 : ease(raw);
      const d = beatData(b, L);

      if (meta.kind === 'text') {
        textFx.push({
          effect: b.effect, start: b.start, end: b.end,
          t: raw <= 0 ? (meta.hidesBefore ? 0 : raw) : p,
          rawT: raw,
          color: b.color, bold: !!b.bold, spanWords: d.spanWords, showCaret: b.effect === 'typewriter'
        });
      } else if (meta.dims) {
        // spotlight: fade in over fx, hold, fade out over the next beat's move (or 0.5s)
        const next = segs[i + 1];
        const outDur = next ? Math.max(0.25, next.tFx - next.tStart) : 0.5;
        const fadeIn = Math.max(0, Math.min(1, raw));
        const fadeOut = t <= s.tEnd ? 1 : Math.max(0, 1 - (t - s.tEnd) / outDur);
        const st = Math.min(EASINGS.easeInOut(fadeIn), EASINGS.easeInOut(fadeOut));
        if (st > 0) spots.push({ rects: d.rects, t: st, color: b.color });
      } else {
        if (raw > 0) paints.push({ beat: b, rects: d.rects, p });
      }
    }

    // ----- text (with text-effect restyling) -----
    const styleFor = textFx.length ? (word => {
      let out = null;
      for (const fx of textFx) {
        const st = RFHighlights.textStyle(fx, word);
        if (st) out = out ? Object.assign(out, st) : st;
      }
      return out;
    }) : null;
    RFDoc.drawText(ctx, state.doc, styleFor);

    // ----- paint highlights (marker/underline/box/circle) -----
    for (const ph of paints) {
      const meta = RFHighlights.EFFECTS[ph.beat.effect];
      meta.draw(ctx, ph.rects, ph.p, { color: ph.beat.color });
    }

    // ----- spotlight dims (over everything on the page) -----
    for (const sp of spots) {
      RFHighlights.EFFECTS.spotlight.draw(ctx, sp.rects, sp.t, { color: sp.color }, L.pageWidth, L.pageHeight);
    }

    // ----- overlays (page coordinates — they move with the camera) -----
    for (const ov of state.overlays) drawOverlay(ctx, ov, t, segs);

    ctx.restore(); // back to frame space

    // ----- screen-space filters -----
    if (state.filters.vignette) {
      const g = ctx.createRadialGradient(fw / 2, fh / 2, Math.min(fw, fh) * 0.42, fw / 2, fh / 2, Math.max(fw, fh) * 0.75);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(10,8,20,0.34)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, fw, fh);
    }
    if (state.filters.grain) {
      const tile = getGrainTile();
      const fi = Math.floor(t * state.frame.fps);
      const ox = (fi * 53) % 160, oy = (fi * 97) % 160;
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.globalCompositeOperation = 'overlay';
      const pat = ctx.createPattern(tile, 'repeat');
      ctx.translate(-ox, -oy);
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, fw + 160, fh + 160);
      ctx.restore();
    }
    if (state.filters.progressBar) {
      const total = getTotalDuration() || 1;
      const barH = Math.max(5, fh * 0.007);
      ctx.fillStyle = 'rgba(127,127,140,0.25)';
      ctx.fillRect(0, fh - barH, fw, barH);
      ctx.fillStyle = '#4f46e5';
      ctx.fillRect(0, fh - barH, fw * (t / total), barH);
    }

    // ----- watermark (always; exports reuse this) -----
    const dark = bd.luma < 0.45;
    const wmPx = Math.max(13, Math.round(fh * 0.0165));
    ctx.font = '600 ' + wmPx + 'px Poppins, -apple-system, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = dark ? '#ffffff' : '#101018';
    ctx.fillText('sadapanna.com/readflow', fw - wmPx * 1.1, fh - wmPx * 0.9);
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';

    ctx.restore();
  }

  // ---------- overlays ----------
  function overlayWindow(ov, segs) {
    const total = getTotalDuration();
    const bi = Math.max(0, Math.min(segs.length - 1, ov.beat | 0));
    const appear = segs.length ? segs[bi].tFx : 0;
    let gone = total + 1;
    if (ov.hideBeat >= 0 && ov.hideBeat < segs.length) gone = segs[ov.hideBeat].tStart;
    return { appear, gone };
  }

  function drawOverlay(ctx, ov, t, segs) {
    const { appear, gone } = overlayWindow(ov, segs);
    const fin = Math.max(0.05, ov.fadeIn || 0.5);
    const fout = Math.max(0.05, ov.fadeOut || 0.35);
    if (t < appear) return;
    const inT = Math.min(1, (t - appear) / fin);
    const outT = t < gone ? 1 : Math.max(0, 1 - (t - gone) / fout);
    if (outT <= 0) return;
    const p = EASINGS.easeOut(inT); // draw-on progress
    const alpha = Math.min(1, inT * 2) * outT;

    ctx.save();
    ctx.globalAlpha = alpha;
    const sz = ov.size || 60;

    if (ov.type === 'arrow') {
      const x2 = ov.x, y2 = ov.y;                       // tip = click point
      const x1 = x2 - (ov.dx !== undefined ? ov.dx : sz * 2.2);
      const y1 = y2 - (ov.dy !== undefined ? ov.dy : -sz * 1.3);
      ctx.strokeStyle = ov.color || '#e8443a';
      ctx.lineWidth = Math.max(4, sz * 0.09);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      // curved shaft draws on
      const mx = (x1 + x2) / 2 + (y2 - y1) * 0.18, my = (y1 + y2) / 2 - (x2 - x1) * 0.18;
      ctx.beginPath();
      const steps = 24, n = Math.max(2, Math.round(steps * p));
      for (let i = 0; i <= n; i++) {
        const u = (i / steps);
        const px = (1 - u) * (1 - u) * x1 + 2 * (1 - u) * u * mx + u * u * x2;
        const py = (1 - u) * (1 - u) * y1 + 2 * (1 - u) * u * my + u * u * y2;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.stroke();
      if (p > 0.85) { // head
        const hu = Math.min(1, (p - 0.85) / 0.15);
        const ang = Math.atan2(y2 - my, x2 - mx);
        const hl = sz * 0.5 * hu;
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - hl * Math.cos(ang - 0.5), y2 - hl * Math.sin(ang - 0.5));
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - hl * Math.cos(ang + 0.5), y2 - hl * Math.sin(ang + 0.5));
        ctx.stroke();
      }
    } else if (ov.type === 'circle') {
      ctx.strokeStyle = ov.color || '#e8443a';
      ctx.lineWidth = Math.max(4, sz * 0.07);
      ctx.lineCap = 'round';
      const rx = sz * 1.4, ry = sz * 0.9;
      const end = p * Math.PI * 2 * 1.15;
      ctx.beginPath();
      const steps = Math.max(6, Math.round(end / 0.12));
      for (let i = 0; i <= steps; i++) {
        const a = (end * i) / steps - Math.PI * 0.6;
        const wob = 1 + 0.05 * Math.sin(a * 2.7 + ov.id % 7);
        const px = ov.x + Math.cos(a) * rx * wob;
        const py = ov.y + Math.sin(a) * ry * wob;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.stroke();
    } else if (ov.type === 'emoji') {
      ctx.font = sz + 'px -apple-system, "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const pop = 0.6 + 0.4 * EASINGS.backOut(inT);
      ctx.translate(ov.x, ov.y); ctx.scale(pop, pop);
      ctx.fillText(ov.emoji || '⭐', 0, 0);
    } else if (ov.type === 'label') {
      const fs = Math.max(14, sz * 0.42);
      ctx.font = '600 ' + fs + 'px Poppins, sans-serif';
      const txt = ov.text || 'Label';
      const tw = ctx.measureText(txt).width;
      const padX = fs * 0.6, padY = fs * 0.42;
      RFDoc.roundRect(ctx, ov.x - tw / 2 - padX, ov.y - fs / 2 - padY, tw + padX * 2, fs + padY * 2, fs * 0.45);
      ctx.fillStyle = ov.color || '#4f46e5';
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(txt, ov.x, ov.y + fs * 0.06);
    } else if (ov.type === 'image' && ov.src) {
      const img = getImage(ov.src);
      if (img) {
        const w = sz * 2.4, h = w * (img.height / img.width || 1);
        const pop = 0.7 + 0.3 * EASINGS.backOut(inT);
        ctx.translate(ov.x, ov.y); ctx.scale(pop, pop);
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
      }
    }
    ctx.restore();
  }

  // ---------- rAF player ----------
  const player = {
    playing: false,
    time: 0,
    _raf: 0,
    _last: 0,
    onTick: null, // (time, playing) => void
    play() {
      if (this.playing) return;
      if (this.time >= getTotalDuration() - 0.01) this.time = 0;
      this.playing = true;
      this._last = performance.now();
      const step = (now) => {
        if (!this.playing) return;
        this.time += (now - this._last) / 1000;
        this._last = now;
        if (this.time >= getTotalDuration()) { this.time = getTotalDuration(); this.playing = false; }
        if (this.onTick) this.onTick(this.time, this.playing);
        if (this.playing) this._raf = requestAnimationFrame(step);
      };
      this._raf = requestAnimationFrame(step);
      if (this.onTick) this.onTick(this.time, true);
    },
    pause() {
      this.playing = false;
      cancelAnimationFrame(this._raf);
      if (this.onTick) this.onTick(this.time, false);
    },
    seek(t) {
      this.time = Math.max(0, Math.min(getTotalDuration(), t));
      if (this.onTick) this.onTick(this.time, this.playing);
    }
  };

  // ---------- state change plumbing ----------
  function emitChange() { document.dispatchEvent(new CustomEvent('rf:change')); }

  function getProjectJSON() { return JSON.parse(JSON.stringify(state)); }

  function loadProjectJSON(obj) {
    const fresh = defaultState();
    // deep-merge known sections so old/partial projects stay loadable
    for (const k of ['doc', 'defaults', 'camera', 'filters', 'frame']) {
      Object.assign(fresh[k], (obj && obj[k]) || {});
    }
    fresh.beats = Array.isArray(obj && obj.beats) ? obj.beats.map(b => Object.assign(RFBeats.makeBeat(0, 0, ''), b)) : [];
    fresh.overlays = Array.isArray(obj && obj.overlays) ? obj.overlays : [];
    // replace contents of the live state object (RF.state identity must survive)
    for (const k of Object.keys(state)) delete state[k];
    Object.assign(state, fresh);
    RF.frame = state.frame;
    beatCache.clear();
    player.pause();
    player.time = 0;
    document.dispatchEvent(new CustomEvent('rf:load'));
    emitChange();
  }

  // ---------- the public contract ----------
  window.RF = {
    state,
    getTotalDuration,
    drawFrame,
    getProjectJSON,
    loadProjectJSON,
    // the scrub/playback head — exporter.js reads this for the PNG snapshot
    getCurrentTime: () => player.time,
    frame: state.frame // {width, height, fps}
  };

  window.RFEngine = {
    EASINGS, EASING_NAMES,
    player,
    beatSegments,
    getCameraAt,
    driftAt,
    estDur,
    emitChange,
    invalidateBeat: id => beatCache.delete(id),
    invalidateAll: () => beatCache.clear(),
    defaultState
  };
})();
