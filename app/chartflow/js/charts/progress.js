/* ChartFlow — Progress bar
 * dataShape: 'single'  { value, label, prefix, suffix, target }
 * Horizontal rounded bar filling to value/target (clamped 0–100%), with the
 * percentage counting up inside the fill (or just past its end when the fill is
 * too short to hold text) and the label above.
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
  function ink(state) { return isLightBg(state) ? '#14171f' : '#f2f5fa'; }
  function inkSoft(state) { return isLightBg(state) ? 'rgba(20,23,31,0.66)' : 'rgba(242,245,250,0.7)'; }
  function trackColor(state) { return isLightBg(state) ? 'rgba(20,23,31,0.1)' : 'rgba(242,245,250,0.12)'; }

  function fontStr(state, size, weight) {
    var f = (state.style && state.style.font) || {};
    return (weight || 500) + ' ' + Math.max(8, Math.round(size)) + 'px ' + (f.family || 'system-ui, sans-serif');
  }

  // value/target as a 0–100 percentage; a missing/zero target means value is
  // already a percentage.
  function pctOf(d) {
    var v = Number(d.value);
    if (!isFinite(v)) v = 0;
    var target = Number(d.target);
    var pct = (isFinite(target) && target > 0) ? (v / target) * 100 : v;
    if (!isFinite(pct)) pct = 0;
    return Math.max(0, Math.min(100, pct));
  }

  ChartFlow.charts.progress = {
    id: 'progress',
    name: 'Progress bar',
    icon: '📶',
    dataShape: 'single',

    sampleDatasets: [
      {
        name: 'Watch-time goal',
        title: 'Road to monetisation',
        data: { value: 3120, label: 'Watch hours towards 4,000', prefix: '', suffix: ' hrs', target: 4000 }
      },
      {
        name: 'Subscriber goal',
        title: '100K or bust',
        data: { value: 68400, label: 'Subscribers towards 100K', prefix: '', suffix: '', target: 100000 }
      },
      {
        name: 'Upload streak',
        title: '52 videos in 52 weeks',
        data: { value: 38, label: 'Videos published this year', prefix: '', suffix: '', target: 52 }
      }
    ],

    defaults: { duration: 2.4, stagger: 0.2 },

    validate: function (data) {
      var errors = [];
      var d = data || {};
      if (d.value === '' || d.value == null || !isFinite(Number(d.value))) {
        errors.push('Enter a numeric value.');
      }
      if (d.target != null && d.target !== '' && !isFinite(Number(d.target))) {
        errors.push('Target must be a number.');
      } else if (d.target != null && d.target !== '' && Number(d.target) <= 0) {
        errors.push('Target must be greater than zero (leave it empty to treat the value as a percentage).');
      }
      if (isFinite(Number(d.value)) && Number(d.value) < 0) {
        errors.push('Value is negative — the bar will show 0%.');
      }
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

      var pct = pctOf(d);
      var label = d.label == null ? '' : String(d.label);
      var prefix = d.prefix == null ? '' : String(d.prefix);
      var suffix = d.suffix == null ? '' : String(d.suffix);
      var value = Number(d.value);
      if (!isFinite(value)) value = 0;
      var target = Number(d.target);
      var hasTarget = isFinite(target) && target > 0;

      var accent = seriesColor(state, 0, label);
      var textColor = ink(state);
      var soft = inkSoft(state);

      // Two staggered elements: label first, then the fill (+ its number).
      var pLabel = E.clamp01(E.progress(t, 0, 2, anim));
      var pFill = E.clamp01(E.progress(t, 1, 2, anim));

      var barW = Math.min(area.w, area.w * 0.92);
      var barH = Math.max(14, Math.min(area.h * 0.16, barW * 0.075, 110));
      var labelSize = Math.max(11, Math.min((st.font && st.font.labelSize) || 24, barH * 0.62, area.h * 0.1));
      var pctSize = Math.max(12, Math.min((st.font && st.font.valueSize) || 28, barH * 0.56));

      var subSize = labelSize * 0.78;
      var hasSub = hasTarget;
      var blockH = labelSize * 1.5 + barH + (hasSub ? subSize * 2.0 : 0);
      var x = area.x + (area.w - barW) / 2;
      var topY = area.y + (area.h - blockH) / 2;
      var barY = topY + labelSize * 1.5;

      var cr = fx.cornerRadius == null ? 8 : Number(fx.cornerRadius);
      if (!isFinite(cr) || cr < 0) cr = 0;
      var radius = Math.min(barH / 2, cr * (barH / 56));

      // ---- label above ----
      if (label) {
        ctx.save();
        ctx.font = fontStr(state, labelSize, 600);
        ctx.fillStyle = textColor;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.globalAlpha = pLabel;
        var slide = (1 - pLabel) * labelSize * 0.6;
        ctx.fillText(E.measureFit(ctx, label, barW), x, barY - labelSize * 0.55 + slide);
        ctx.restore();
      }

      // ---- track ----
      ctx.save();
      ctx.fillStyle = trackColor(state);
      E.roundRect(ctx, x, barY, barW, barH, radius);
      ctx.fill();
      ctx.restore();

      // ---- fill ----
      var fillW = barW * (pct / 100) * pFill;
      if (fillW > 0.5) {
        ctx.save();
        E.applyEffects(ctx, fx);
        ctx.fillStyle = accent;
        // Keep the left cap round even while the fill is narrower than the radius.
        ctx.beginPath();
        ctx.rect(x, barY - barH, Math.max(fillW, 0.5), barH * 3);
        ctx.clip();
        E.roundRect(ctx, x, barY, Math.max(fillW, radius * 2), barH, radius);
        ctx.fill();
        ctx.restore();
      }

      // ---- percentage: inside the fill when it fits, otherwise just past it ----
      var shownPct = pct * pFill;
      var pctTxt = (shownPct >= 10 || shownPct === 0 ? Math.round(shownPct) : Math.round(shownPct * 10) / 10) + '%';
      ctx.save();
      ctx.font = fontStr(state, pctSize, 700);
      ctx.textBaseline = 'middle';
      ctx.globalAlpha = E.clamp01(pFill * 4);
      var pad = barH * 0.42;
      var need = ctx.measureText(pctTxt).width + pad * 2;
      if (fillW >= need) {
        ctx.textAlign = 'right';
        ctx.fillStyle = hexLum(accent) > 0.62 ? '#14171f' : '#ffffff';
        ctx.fillText(pctTxt, x + fillW - pad, barY + barH / 2);
      } else {
        ctx.textAlign = 'left';
        ctx.fillStyle = textColor;
        var px = Math.min(x + fillW + pad, x + barW - ctx.measureText(pctTxt).width);
        ctx.fillText(pctTxt, px, barY + barH / 2);
      }
      ctx.restore();

      // ---- value / target caption ----
      if (hasSub) {
        ctx.save();
        ctx.font = fontStr(state, subSize, 500);
        ctx.fillStyle = soft;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.globalAlpha = E.clamp01(pFill * 2) * 0.95;
        var counted = prefix + E.countUp(value, pFill) + suffix;
        var cap = counted + '  /  ' + prefix + E.fmt(target) + suffix;
        ctx.fillText(E.measureFit(ctx, cap, barW), x, barY + barH + subSize * 0.7);
        ctx.restore();
      }
    }
  };
})();
