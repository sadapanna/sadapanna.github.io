/* ============================================================
   ChartFlow — engine.js
   Timeline, easing, layout, the single render path, preview player.
   No libraries, no network. Everything deterministic.
   ============================================================ */
(function () {
  'use strict';

  window.ChartFlow = window.ChartFlow || { charts: {} };
  var CF = window.ChartFlow;
  if (!CF.charts) CF.charts = {};

  var WATERMARK_TEXT = 'Made with sadapanna.com/chartflow';

  /* ---------------- small math helpers ---------------- */

  function clamp01(x) {
    x = +x;
    if (!isFinite(x)) return 0;
    return x < 0 ? 0 : x > 1 ? 1 : x;
  }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /* ---------------- easing ---------------- */

  function cubicBezier(x1, y1, x2, y2) {
    // Standard CSS-style cubic-bezier solver (Newton + bisection fallback).
    var NEWTON_ITER = 5, NEWTON_EPS = 1e-6, SUBDIV_ITER = 12;

    function A(a1, a2) { return 1 - 3 * a2 + 3 * a1; }
    function B(a1, a2) { return 3 * a2 - 6 * a1; }
    function C(a1) { return 3 * a1; }
    function calc(t, a1, a2) { return ((A(a1, a2) * t + B(a1, a2)) * t + C(a1)) * t; }
    function slope(t, a1, a2) { return 3 * A(a1, a2) * t * t + 2 * B(a1, a2) * t + C(a1); }

    function tForX(x) {
      var t = x, i, d, xx;
      for (i = 0; i < NEWTON_ITER; i++) {
        d = slope(t, x1, x2);
        if (d === 0) break;
        xx = calc(t, x1, x2) - x;
        if (Math.abs(xx) < NEWTON_EPS) return t;
        t -= xx / d;
      }
      var lo = 0, hi = 1;
      t = x;
      for (i = 0; i < SUBDIV_ITER; i++) {
        xx = calc(t, x1, x2);
        if (Math.abs(xx - x) < NEWTON_EPS) return t;
        if (xx < x) lo = t; else hi = t;
        t = (lo + hi) / 2;
      }
      return t;
    }

    return function (t) {
      if (t <= 0) return 0;
      if (t >= 1) return 1;
      return calc(tForX(t), y1, y2);
    };
  }

  var ease = {
    linear: function (t) { return t; },
    easeOutCubic: function (t) { var u = 1 - t; return 1 - u * u * u; },
    easeInOutCubic: function (t) {
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    },
    easeOutBack: function (t) {
      var c1 = 1.70158, c3 = c1 + 1, u = t - 1;
      return 1 + c3 * u * u * u + c1 * u * u;
    },
    easeOutBounce: function (t) {
      var n1 = 7.5625, d1 = 2.75;
      if (t < 1 / d1) return n1 * t * t;
      if (t < 2 / d1) { t -= 1.5 / d1; return n1 * t * t + 0.75; }
      if (t < 2.5 / d1) { t -= 2.25 / d1; return n1 * t * t + 0.9375; }
      t -= 2.625 / d1; return n1 * t * t + 0.984375;
    },
    easeOutElastic: function (t) {
      var c4 = (2 * Math.PI) / 3;
      if (t <= 0) return 0;
      if (t >= 1) return 1;
      return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
    },
    cubicBezier: cubicBezier
  };

  function resolveEase(anim) {
    var e = anim && anim.easing;
    if (!e) return ease.easeOutCubic;
    if (typeof e === 'function') return e;
    if (typeof e === 'string') return ease[e] || ease.easeOutCubic;
    if (e && e.bezier && e.bezier.length === 4) {
      return cubicBezier(+e.bezier[0], +e.bezier[1], +e.bezier[2], +e.bezier[3]);
    }
    return ease.easeOutCubic;
  }

  /* ---------------- staggered progress ---------------- */

  function progress(t, i, n, anim) {
    var fn = resolveEase(anim);
    var d = Math.max(0.0001, (anim && +anim.duration) || 3);
    var count = Math.max(1, n | 0);
    var idx = Math.min(Math.max(0, i | 0), count - 1);
    var st = Math.max(0, (anim && +anim.stagger) || 0);
    if (count <= 1) st = 0;

    var totalStag = st * (count - 1);
    // Never let the stagger eat more than 80% of the timeline.
    if (totalStag > d * 0.8) {
      st = (d * 0.8) / (count - 1);
      totalStag = st * (count - 1);
    }
    var span = d - totalStag;
    var start = (st * idx) / d;
    var len = span / d;
    if (len <= 0) len = 1e-6;

    return fn(clamp01((clamp01(t) - start) / len));
  }

  /* ---------------- number formatting ---------------- */

  function group(intStr) {
    var neg = intStr.charAt(0) === '-';
    if (neg) intStr = intStr.slice(1);
    var out = intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + out;
  }

  function fmtAs(v, asInt) {
    if (!isFinite(v)) v = 0;
    var s;
    if (asInt) {
      s = String(Math.round(v));
      if (s === '-0') s = '0';
      return group(s);
    }
    var r = Math.round(v * 10) / 10;
    if (Object.is(r, -0)) r = 0;
    s = r.toFixed(1);
    var parts = s.split('.');
    return group(parts[0]) + '.' + parts[1];
  }

  function isIntish(v) { return isFinite(v) && Math.abs(v - Math.round(v)) < 1e-9; }

  function fmt(value) { return fmtAs(+value, isIntish(+value)); }
  function countUp(value, p) {
    var v = +value || 0;
    return fmtAs(v * clamp01(p), isIntish(v));
  }

  /* ---------------- nice scale ---------------- */

  function niceNum(range, round) {
    if (!(range > 0)) return 1;
    var exp = Math.floor(Math.log(range) / Math.LN10);
    var f = range / Math.pow(10, exp);
    var nf;
    if (round) {
      nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
    } else {
      nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    }
    return nf * Math.pow(10, exp);
  }

  function niceScale(min, max, maxTicks) {
    maxTicks = Math.max(2, maxTicks || 5);
    min = +min; max = +max;
    if (!isFinite(min)) min = 0;
    if (!isFinite(max)) max = 1;
    if (min > max) { var tmp = min; min = max; max = tmp; }
    if (min === max) {
      if (min === 0) { min = 0; max = 1; }
      else if (min > 0) { min = 0; max = max * 1.2; }
      else { min = min * 1.2; max = 0; }
    }
    var range = niceNum(max - min, false);
    var step = niceNum(range / (maxTicks - 1), true);
    var nmin = Math.floor(min / step) * step;
    var nmax = Math.ceil(max / step) * step;

    // kill floating-point dust
    var dec = Math.max(0, -Math.floor(Math.log(step) / Math.LN10));
    var pow = Math.pow(10, Math.min(12, dec + 2));
    function clean(v) { return Math.round(v * pow) / pow; }

    nmin = clean(nmin); nmax = clean(nmax); step = clean(step);

    var ticks = [];
    for (var v = nmin, guard = 0; v <= nmax + step * 1e-6 && guard < 500; v += step, guard++) {
      ticks.push(clean(v));
    }
    if (ticks.length < 2) ticks = [nmin, nmax];
    return { min: nmin, max: nmax, step: step, ticks: ticks };
  }

  /* ---------------- text + path helpers ---------------- */

  function measureFit(ctx, text, maxW) {
    text = text == null ? '' : String(text);
    if (!(maxW > 0)) return '';
    if (ctx.measureText(text).width <= maxW) return text;
    var ell = '…';
    if (ctx.measureText(ell).width > maxW) return '';
    var lo = 0, hi = text.length;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      if (ctx.measureText(text.slice(0, mid) + ell).width <= maxW) lo = mid;
      else hi = mid - 1;
    }
    return text.slice(0, lo) + ell;
  }

  function roundRect(ctx, x, y, w, h, r) {
    if (w < 0) { x += w; w = -w; }
    if (h < 0) { y += h; h = -h; }
    r = Math.max(0, Math.min(+r || 0, w / 2, h / 2));
    ctx.beginPath();
    if (r <= 0) { ctx.rect(x, y, w, h); return; }
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  /* ---------------- colors ---------------- */

  function parseHex(c) {
    if (typeof c !== 'string') return null;
    c = c.trim();
    var m = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(c);
    if (m) {
      var h = m[1];
      if (h.length === 3 || h.length === 4) {
        h = h.split('').map(function (ch) { return ch + ch; }).join('');
      }
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
        a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
      };
    }
    var rgb = /^rgba?\(([^)]+)\)$/i.exec(c);
    if (rgb) {
      var p = rgb[1].split(',').map(function (s) { return parseFloat(s); });
      return { r: p[0] || 0, g: p[1] || 0, b: p[2] || 0, a: p.length > 3 ? p[3] : 1 };
    }
    return null;
  }

  function luminance(color) {
    var c = parseHex(color);
    if (!c) return 0.1;
    function ch(v) {
      v = v / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }
    return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
  }

  function bgLuminance(state) {
    var bg = (state && state.style && state.style.background) || {};
    if (bg.type === 'gradient' && bg.gradient && bg.gradient.stops && bg.gradient.stops.length) {
      var sum = 0, n = 0;
      bg.gradient.stops.forEach(function (s) { sum += luminance(s.color); n++; });
      return n ? sum / n : 0.1;
    }
    if (bg.type === 'transparent') return 0.06; // assume dark editing/exported ground
    return luminance(bg.color || '#0f1117');
  }

  // Readable foreground for the current background (used for titles, axes, labels).
  function inkColor(state) { return bgLuminance(state) > 0.45 ? '#12151c' : '#ffffff'; }
  function mutedInk(state) {
    return bgLuminance(state) > 0.45 ? 'rgba(18,21,28,.62)' : 'rgba(255,255,255,.62)';
  }

  /* ---------------- style access ---------------- */

  function canvasSize(state) {
    var c = (state && state.style && state.style.canvas) || {};
    return { w: Math.max(16, +c.w || 1920), h: Math.max(16, +c.h || 1080) };
  }
  function fontOf(state) {
    var f = (state && state.style && state.style.font) || {};
    return {
      family: f.family || 'system-ui, -apple-system, sans-serif',
      titleSize: +f.titleSize || 48,
      labelSize: +f.labelSize || 24,
      valueSize: +f.valueSize || 28
    };
  }
  function watermarkSize(state) {
    var s = canvasSize(state);
    return Math.max(11, Math.round(s.h * 0.018));
  }

  /* ---------------- layout ---------------- */

  function chartArea(state) {
    var s = canvasSize(state);
    var f = fontOf(state);
    var padX = Math.round(s.w * 0.055);
    var padY = Math.round(s.h * 0.06);
    var top = padY;
    var hasTitle = !!(state && state.title && String(state.title).trim());
    if (hasTitle) top += Math.round(f.titleSize * 1.55);
    var bottom = padY + Math.round(watermarkSize(state) * 2.2);
    return {
      x: padX,
      y: top,
      w: Math.max(10, s.w - padX * 2),
      h: Math.max(10, s.h - top - bottom)
    };
  }

  /* ---------------- painters ---------------- */

  function drawBackground(ctx, state) {
    var bg = (state && state.style && state.style.background) || {};
    if (bg.type === 'transparent') return;
    var s = canvasSize(state);
    ctx.save();
    if (bg.type === 'gradient' && bg.gradient) {
      var g = bg.gradient;
      var grad;
      if (g.kind === 'radial') {
        grad = ctx.createRadialGradient(s.w / 2, s.h / 2, 0, s.w / 2, s.h / 2,
          Math.max(s.w, s.h) * 0.72);
      } else {
        var ang = ((+g.angle || 0) * Math.PI) / 180;
        var dx = Math.cos(ang - Math.PI / 2), dy = Math.sin(ang - Math.PI / 2);
        var len = Math.abs(s.w * dx) + Math.abs(s.h * dy);
        grad = ctx.createLinearGradient(
          s.w / 2 - (dx * len) / 2, s.h / 2 - (dy * len) / 2,
          s.w / 2 + (dx * len) / 2, s.h / 2 + (dy * len) / 2
        );
      }
      var stops = g.stops && g.stops.length ? g.stops
        : [{ at: 0, color: '#0f1117' }, { at: 1, color: '#1b2030' }];
      stops.forEach(function (st) {
        grad.addColorStop(clamp01(st.at), st.color || '#000');
      });
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = bg.color || '#0f1117';
    }
    ctx.fillRect(0, 0, s.w, s.h);
    ctx.restore();
  }

  function applyEffects(ctx, effects) {
    effects = effects || {};
    if (effects.glow) {
      var c = typeof ctx.fillStyle === 'string' ? ctx.fillStyle : '#ffffff';
      ctx.shadowColor = c;
      ctx.shadowBlur = 26;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    } else if (effects.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,.38)';
      ctx.shadowBlur = 22;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 8;
    } else {
      ctx.shadowColor = 'rgba(0,0,0,0)';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    }
  }

  function drawTitle(ctx, state, alpha) {
    var text = state && state.title ? String(state.title) : '';
    if (!text.trim()) return;
    var a = alpha == null ? 1 : clamp01(alpha);
    if (a <= 0) return;
    var s = canvasSize(state);
    var f = fontOf(state);
    var padX = Math.round(s.w * 0.055);
    var padY = Math.round(s.h * 0.06);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = '600 ' + f.titleSize + 'px ' + f.family;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = inkColor(state);
    var t = measureFit(ctx, text, s.w - padX * 2);
    ctx.fillText(t, padX, padY + f.titleSize * 0.82);
    ctx.restore();
  }

  function drawWatermark(ctx, state) {
    var s = canvasSize(state);
    var f = fontOf(state);
    var size = watermarkSize(state);
    var light = bgLuminance(state) > 0.45;
    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.font = '500 ' + size + 'px ' + f.family;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    if (ctx.fontVariantCaps !== undefined) ctx.fontVariantCaps = 'small-caps';
    if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '0.06em';
    ctx.fillStyle = light ? '#000000' : '#ffffff';
    ctx.fillText(WATERMARK_TEXT, s.w - Math.round(s.w * 0.028), s.h - Math.round(s.h * 0.032));
    ctx.restore();
  }

  function drawVignette(ctx, state) {
    var s = canvasSize(state);
    var r = Math.sqrt(s.w * s.w + s.h * s.h) / 2;
    var g = ctx.createRadialGradient(s.w / 2, s.h / 2, r * 0.35, s.w / 2, s.h / 2, r);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,.45)');
    ctx.save();
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s.w, s.h);
    ctx.restore();
  }

  var noiseTile = null;
  function getNoiseTile() {
    if (noiseTile) return noiseTile;
    var n = 128;
    var c = document.createElement('canvas');
    c.width = c.height = n;
    var cx = c.getContext('2d');
    var img = cx.createImageData(n, n);
    var seed = 1337;
    for (var i = 0; i < n * n; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      var v = seed % 256;
      img.data[i * 4] = v;
      img.data[i * 4 + 1] = v;
      img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    cx.putImageData(img, 0, 0);
    noiseTile = c;
    return c;
  }

  function drawNoise(ctx, state) {
    var s = canvasSize(state);
    var pat = ctx.createPattern(getNoiseTile(), 'repeat');
    if (!pat) return;
    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, s.w, s.h);
    ctx.restore();
  }

  /* ---------------- timeline ---------------- */

  function animOf(state) {
    var a = (state && state.anim) || {};
    return {
      duration: Math.max(0.05, +a.duration || 3),
      stagger: Math.max(0, +a.stagger || 0),
      hold: Math.max(0, a.hold == null ? 1.5 : +a.hold),
      easing: a.easing,
      intro: a.intro || { type: 'fade', duration: 0.5 },
      outro: a.outro || { type: 'hold' },
      loop: !!a.loop,
      fps: +a.fps || 30
    };
  }

  function introDuration(state) {
    var a = animOf(state);
    var it = a.intro || {};
    if (!it.type || it.type === 'none') return 0;
    if (!(state && state.title && String(state.title).trim())) return 0;
    return Math.max(0, it.duration == null ? 0.5 : +it.duration);
  }

  function outroDuration(state) {
    var a = animOf(state);
    var o = a.outro || {};
    if (o.type !== 'fade') return 0;
    return Math.max(0.05, o.duration == null ? 0.5 : +o.duration);
  }

  function totalDuration(state) {
    var a = animOf(state);
    return introDuration(state) + a.duration + a.hold + outroDuration(state);
  }

  function chartFor(state) {
    var id = state && state.type;
    return (CF.charts && CF.charts[id]) || null;
  }

  // draws one frame at absolute time (seconds), WITHOUT the outro fade
  function renderInner(ctx, state, time) {
    var a = animOf(state);
    var intro = introDuration(state);
    var s = canvasSize(state);

    ctx.save();
    ctx.clearRect(0, 0, s.w, s.h);
    drawBackground(ctx, state);
    ctx.restore();

    // --- title (intro) ---
    var titleAlpha = 1, slide = 0;
    if (intro > 0) {
      var ip = clamp01(time / intro);
      var ie = ease.easeOutCubic(ip);
      var it = (a.intro && a.intro.type) || 'fade';
      if (it === 'fade') titleAlpha = ie;
      else if (it === 'slide') { titleAlpha = ie; slide = (1 - ie) * (fontOf(state).titleSize * 0.9); }
    }
    ctx.save();
    if (slide) ctx.translate(0, slide);
    drawTitle(ctx, state, titleAlpha);
    ctx.restore();

    // --- chart main phase ---
    var tMain = clamp01((time - intro) / a.duration);
    var chart = chartFor(state);
    if (chart && typeof chart.drawFrame === 'function') {
      ctx.save();
      try {
        chart.drawFrame(ctx, state, tMain);
      } catch (err) {
        if (window.console) console.error('[ChartFlow] drawFrame error:', err);
      }
      ctx.restore();
    }

    // --- film effects ---
    var fx = (state.style && state.style.effects) || {};
    if (fx.vignette) drawVignette(ctx, state);
    if (fx.noise) drawNoise(ctx, state);

    drawWatermark(ctx, state);
  }

  var scratch = null;
  function getScratch(w, h) {
    if (!scratch) scratch = document.createElement('canvas');
    if (scratch.width !== w || scratch.height !== h) { scratch.width = w; scratch.height = h; }
    return scratch;
  }

  function render(ctx, state, tGlobal) {
    if (!ctx || !state) return;
    var total = totalDuration(state);
    var time = clamp01(tGlobal) * total;
    var outro = outroDuration(state);
    var s = canvasSize(state);

    var fadeAlpha = 1;
    if (outro > 0) {
      var fadeStart = total - outro;
      if (time > fadeStart) fadeAlpha = clamp01(1 - (time - fadeStart) / outro);
    }

    if (fadeAlpha >= 0.999) {
      renderInner(ctx, state, time);
      return;
    }

    // Fade the WHOLE composited frame: render offscreen, then blit with alpha.
    var off = getScratch(Math.round(s.w), Math.round(s.h));
    var octx = off.getContext('2d');
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, off.width, off.height);
    renderInner(octx, state, time);

    ctx.save();
    ctx.clearRect(0, 0, s.w, s.h);
    ctx.globalAlpha = fadeAlpha;
    ctx.drawImage(off, 0, 0, s.w, s.h);
    ctx.restore();
  }

  /* ---------------- preview player ---------------- */

  function createPlayer(canvasEl, getState) {
    var ctx = canvasEl.getContext('2d');
    var t = 0;
    var playing = false;
    var last = 0;
    var raf = 0;
    var ticks = [];
    var lastCssW = -1, lastCssH = -1, lastDpr = -1;

    function fitCanvas(state) {
      var s = canvasSize(state);
      var host = canvasEl.parentElement || canvasEl;
      var availW = host.clientWidth || s.w;
      var availH = host.clientHeight || Math.round(availW * s.h / s.w);
      if (!availW) return null;
      if (!availH) availH = Math.round(availW * s.h / s.w);

      var scale = Math.min(availW / s.w, availH / s.h);
      if (!(scale > 0) || !isFinite(scale)) scale = availW / s.w;
      var cssW = Math.max(1, Math.floor(s.w * scale));
      var cssH = Math.max(1, Math.floor(s.h * scale));
      var dpr = Math.min(window.devicePixelRatio || 1, 3);

      if (cssW !== lastCssW || cssH !== lastCssH || dpr !== lastDpr) {
        canvasEl.style.width = cssW + 'px';
        canvasEl.style.height = cssH + 'px';
        canvasEl.width = Math.max(1, Math.round(cssW * dpr));
        canvasEl.height = Math.max(1, Math.round(cssH * dpr));
        lastCssW = cssW; lastCssH = cssH; lastDpr = dpr;
      }
      return { sx: canvasEl.width / s.w, sy: canvasEl.height / s.h };
    }

    function draw() {
      var state = getState && getState();
      if (!state) return;
      var sc = fitCanvas(state);
      if (!sc) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
      ctx.setTransform(sc.sx, 0, 0, sc.sy, 0, 0);
      render(ctx, state, t);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    function emit() {
      for (var i = 0; i < ticks.length; i++) {
        try { ticks[i](t); } catch (e) { /* consumer error shouldn't kill the loop */ }
      }
    }

    function frame(now) {
      raf = requestAnimationFrame(frame);
      var dt = last ? (now - last) / 1000 : 0;
      last = now;
      if (dt > 0.5) dt = 1 / 60; // tab was backgrounded

      if (playing) {
        var state = getState && getState();
        var total = state ? totalDuration(state) : 1;
        t += dt / Math.max(0.05, total);
        if (t >= 1) {
          if (state && state.anim && state.anim.loop) t = t % 1;
          else { t = 1; playing = false; }
        }
        draw();
        emit();
      } else {
        draw();
      }
    }

    raf = requestAnimationFrame(frame);

    var api = {
      play: function () {
        if (t >= 1) t = 0;
        playing = true;
        last = 0;
      },
      pause: function () { playing = false; },
      toggle: function () { if (playing) api.pause(); else api.play(); },
      seek: function (t01) {
        t = clamp01(t01);
        draw();
        emit();
      },
      redraw: function () { draw(); },
      onTick: function (cb) { if (typeof cb === 'function') ticks.push(cb); },
      destroy: function () { playing = false; cancelAnimationFrame(raf); ticks.length = 0; }
    };
    Object.defineProperty(api, 't', { get: function () { return t; }, enumerable: true });
    Object.defineProperty(api, 'playing', { get: function () { return playing; }, enumerable: true });
    return api;
  }

  /* ---------------- export ---------------- */

  CF.engine = {
    ease: ease,
    resolveEase: resolveEase,
    clamp01: clamp01,
    lerp: lerp,
    progress: progress,
    countUp: countUp,
    fmt: fmt,
    niceScale: niceScale,
    measureFit: measureFit,
    roundRect: roundRect,
    chartArea: chartArea,
    drawTitle: drawTitle,
    applyEffects: applyEffects,
    drawBackground: drawBackground,
    drawWatermark: drawWatermark,
    totalDuration: totalDuration,
    render: render,
    createPlayer: createPlayer,
    // ---- extras (safe helpers charts/app may use) ----
    canvasSize: canvasSize,
    fontOf: fontOf,
    inkColor: inkColor,
    mutedInk: mutedInk,
    bgLuminance: bgLuminance,
    introDuration: introDuration,
    outroDuration: outroDuration,
    WATERMARK_TEXT: WATERMARK_TEXT
  };
})();
