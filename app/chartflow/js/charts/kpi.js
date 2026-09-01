/* ChartFlow — KPI / big number
 * dataShape: 'single'  { value, label, prefix, suffix }  (target is ignored)
 * The number counts up, centred and scaled to the canvas (great for 9:16
 * Shorts), with the label fading and sliding in beneath it.
 */
(function () {
  'use strict';
  window.ChartFlow = window.ChartFlow || { charts: {} };
  ChartFlow.charts = ChartFlow.charts || {};

  function eng() { return ChartFlow.engine; }

  function seriesColor(state, i, key) {
    var st = state.style || {};
    var pal = (st.palette && st.palette.length) ? st.palette : ['#5b8cff'];
    var ov = st.seriesColors || {};
    if (key != null && Object.prototype.hasOwnProperty.call(ov, key)) return ov[key];
    if (Object.prototype.hasOwnProperty.call(ov, i)) return ov[i];
    if (Object.prototype.hasOwnProperty.call(ov, String(i))) return ov[String(i)];
    return pal[i % pal.length];
  }

  function hexLum(hex) {
    if (typeof hex !== 'string') return 0;
    var h = hex.trim().replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (h.length < 6) return 0;
    var r = parseInt(h.slice(0, 2), 16) / 255;
    var g = parseInt(h.slice(2, 4), 16) / 255;
    var b = parseInt(h.slice(4, 6), 16) / 255;
    if (isNaN(r) || isNaN(g) || isNaN(b)) return 0;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function isLightBg(state) {
    var bg = (state.style && state.style.background) || {};
    var base = '#0f1117';
    if (bg.type === 'gradient' && bg.gradient && bg.gradient.stops && bg.gradient.stops.length) base = bg.gradient.stops[0].color;
    else if (bg.type === 'solid') base = bg.color || base;
    return hexLum(base) > 0.55;
  }
  function inkSoft(state) { return isLightBg(state) ? 'rgba(20,23,31,0.66)' : 'rgba(242,245,250,0.7)'; }

  function fontStr(state, size, weight) {
    var f = (state.style && state.style.font) || {};
    return (weight || 500) + ' ' + Math.max(8, Math.round(size)) + 'px ' + (f.family || 'system-ui, sans-serif');
  }

  // Largest font size at which `text` fits within maxW (and maxSize).
  function fitSize(ctx, state, text, maxW, maxSize, weight) {
    var size = maxSize;
    ctx.font = fontStr(state, size, weight);
    var w = ctx.measureText(text).width;
    if (w > maxW && w > 0) size = Math.max(10, size * (maxW / w));
    return size;
  }

  ChartFlow.charts.kpi = {
    id: 'kpi',
    name: 'Big number (KPI)',
    icon: '🔢',
    dataShape: 'single',

    sampleDatasets: [
      {
        name: 'Subscriber milestone',
        title: 'We did it',
        data: { value: 100000, label: 'Subscribers', prefix: '', suffix: '', target: 100 }
      },
      {
        name: 'Watch hours',
        title: 'Last 28 days',
        data: { value: 148920, label: 'Hours watched', prefix: '', suffix: ' hrs', target: 100 }
      },
      {
        name: 'Channel revenue',
        title: 'What one year of uploads paid',
        data: { value: 42750, label: 'Earned in 2025', prefix: '$', suffix: '', target: 100 }
      }
    ],

    defaults: { duration: 2.2, stagger: 0.25 },

    validate: function (data) {
      var errors = [];
      var d = data || {};
      if (d.value === '' || d.value == null || !isFinite(Number(d.value))) {
        errors.push('Enter a numeric value.');
      }
      if (d.label != null && String(d.label).length > 120) errors.push('Label is too long (keep it under 120 characters).');
      return errors.length ? { ok: false, errors: errors } : { ok: true };
    },

    drawFrame: function (ctx, state, t) {
      var E = eng();
      var area = E.chartArea(state);
      if (!area || area.w <= 4 || area.h <= 4) return;

      var d = state.data || {};
      var st = state.style || {};
      var fx = st.effects || {};
      var anim = state.anim || {};
      var value = Number(d.value);
      if (!isFinite(value)) value = 0;
      var prefix = d.prefix == null ? '' : String(d.prefix);
      var suffix = d.suffix == null ? '' : String(d.suffix);
      var label = d.label == null ? '' : String(d.label);

      var accent = seriesColor(state, 0, label);
      var soft = inkSoft(state);

      // Two staggered elements: the number, then the label.
      var pNum = E.clamp01(E.progress(t, 0, 2, anim));
      var pLbl = E.clamp01(E.progress(t, 1, 2, anim));

      // Size from the FINAL string so digits never jitter mid-count.
      var finalTxt = prefix + E.fmt(value) + suffix;
      var maxW = area.w * 0.94;
      var hasLabel = label.length > 0;
      var numMaxH = area.h * (hasLabel ? 0.56 : 0.7);
      var numSize = fitSize(ctx, state, finalTxt, maxW, numMaxH, 800);

      var labelSize = Math.min((st.font && st.font.labelSize) || 24, numSize * 0.28, area.h * 0.14);
      labelSize = Math.max(10, labelSize);
      if (hasLabel) {
        labelSize = fitSize(ctx, state, label, maxW, labelSize, 600);
      }

      var gap = hasLabel ? labelSize * 0.9 : 0;
      var blockH = numSize + (hasLabel ? gap + labelSize * 1.15 : 0);
      var cx = area.x + area.w / 2;
      var topY = area.y + (area.h - blockH) / 2;

      // ---- big number ----
      ctx.save();
      E.applyEffects(ctx, fx);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = fontStr(state, numSize, 800);
      ctx.fillStyle = accent;
      // Gentle scale-in on top of the count-up.
      var scale = 0.94 + 0.06 * pNum;
      var numCy = topY + numSize * 0.54;
      ctx.globalAlpha = E.clamp01(pNum * 3);
      ctx.translate(cx, numCy);
      ctx.scale(scale, scale);
      var txt = prefix + E.countUp(value, pNum) + suffix;
      ctx.fillText(txt, 0, 0);
      ctx.restore();

      if (!hasLabel) return;

      // ---- accent rule that grows with the label ----
      var ruleY = topY + numSize + gap * 0.42;
      var ruleW = Math.min(area.w * 0.34, numSize * 1.4) * pLbl;
      if (ruleW > 1) {
        ctx.save();
        ctx.globalAlpha = 0.55 * pLbl;
        ctx.fillStyle = accent;
        var rh = Math.max(2, labelSize * 0.13);
        var rr = Math.min(rh / 2, Math.max(0, fx.cornerRadius == null ? 8 : fx.cornerRadius));
        E.roundRect(ctx, cx - ruleW / 2, ruleY, ruleW, rh, rr);
        ctx.fill();
        ctx.restore();
      }

      // ---- label: fade + slide up ----
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = fontStr(state, labelSize, 600);
      ctx.fillStyle = soft;
      ctx.globalAlpha = pLbl;
      var slide = (1 - pLbl) * labelSize * 0.8;
      ctx.fillText(E.measureFit(ctx, label, maxW), cx, topY + numSize + gap + labelSize * 0.6 + slide);
      ctx.restore();
    }
  };
})();
