/* ChartFlow — horizontal bar chart
 * Bars sweep right from the zero baseline, staggered top→bottom.
 * Category labels sit left of the bars; values count up at the bar ends.
 * Supports multi-series (grouped), negative values, grid, rounded ends.
 */
(function () {
  'use strict';
  window.ChartFlow = window.ChartFlow || { charts: {} };
  ChartFlow.charts = ChartFlow.charts || {};

  function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }

  function fontStr(state, size, weight) {
    var f = (state.style && state.style.font) || {};
    return (weight ? weight + ' ' : '') + Math.max(8, Math.round(size)) + 'px ' +
      (f.family || 'system-ui, -apple-system, sans-serif');
  }

  function fontSizes(state) {
    var f = (state.style && state.style.font) || {};
    return { label: f.labelSize || 24, value: f.valueSize || 28 };
  }

  function hexToRgb(hex) {
    if (typeof hex !== 'string') return null;
    var h = hex.trim().replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return null;
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }

  function fg(state) {
    var bg = (state.style && state.style.background) || {};
    var col = null;
    if (bg.type === 'solid') col = bg.color;
    else if (bg.type === 'gradient' && bg.gradient && bg.gradient.stops && bg.gradient.stops.length) col = bg.gradient.stops[0].color;
    var rgb = hexToRgb(col);
    var dark = { text: '#e8eaf0', dim: 'rgba(232,234,240,0.66)', grid: 'rgba(232,234,240,0.13)', axis: 'rgba(232,234,240,0.34)' };
    if (!rgb) return dark;
    var lum = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
    if (lum > 0.6) return { text: '#171a21', dim: 'rgba(23,26,33,0.62)', grid: 'rgba(23,26,33,0.12)', axis: 'rgba(23,26,33,0.30)' };
    return dark;
  }

  function seriesColor(state, i, name) {
    var st = state.style || {};
    var pal = (st.palette && st.palette.length) ? st.palette : ['#5b8ff9', '#61ddaa', '#f6bd16', '#ff6b6b', '#9270ca'];
    var ov = st.seriesColors || {};
    if (name != null && ov[name]) return ov[name];
    if (ov[i]) return ov[i];
    if (ov[String(i)]) return ov[String(i)];
    return pal[i % pal.length];
  }

  function effects(state) { return (state.style && state.style.effects) || {}; }

  /* Rect with only the far end (right for positive, left for negative) rounded. */
  function barPathH(ctx, x, y, w, h, r, right) {
    r = Math.max(0, Math.min(r, Math.abs(h) / 2, Math.abs(w)));
    ctx.beginPath();
    if (r <= 0.5) { ctx.rect(x, y, w, h); return; }
    if (right) {
      ctx.moveTo(x, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x, y + h);
    } else {
      ctx.moveTo(x + w, y);
      ctx.lineTo(x + r, y);
      ctx.quadraticCurveTo(x, y, x, y + r);
      ctx.lineTo(x, y + h - r);
      ctx.quadraticCurveTo(x, y + h, x + r, y + h);
      ctx.lineTo(x + w, y + h);
    }
    ctx.closePath();
  }

  function rowsOK(data) {
    var errors = [];
    if (!data || typeof data !== 'object') return { ok: false, errors: ['No data.'] };
    if (!Array.isArray(data.labels) || !data.labels.length) errors.push('data.labels must be a non-empty array.');
    if (!Array.isArray(data.series) || !data.series.length) errors.push('data.series must be a non-empty array.');
    if (errors.length) return { ok: false, errors: errors };
    data.series.forEach(function (s, i) {
      if (!s || typeof s !== 'object') { errors.push('Series ' + (i + 1) + ' is not an object.'); return; }
      if (!Array.isArray(s.values)) { errors.push('Series ' + (i + 1) + ' (' + (s.name || '?') + ') has no values array.'); return; }
      if (s.values.length !== data.labels.length) {
        errors.push('Series "' + (s.name || i + 1) + '" has ' + s.values.length + ' values but there are ' + data.labels.length + ' labels.');
      }
      for (var j = 0; j < s.values.length; j++) {
        var v = s.values[j];
        if (v === null || v === '' || typeof v === 'boolean' || !isFinite(Number(v))) {
          errors.push('Series "' + (s.name || i + 1) + '" value ' + (j + 1) + ' is not a number.');
          break;
        }
      }
    });
    return errors.length ? { ok: false, errors: errors } : { ok: true };
  }

  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }

  function extent(series) {
    var min = 0, max = 0;
    for (var i = 0; i < series.length; i++) {
      var vals = series[i].values || [];
      for (var j = 0; j < vals.length; j++) {
        var v = num(vals[j]);
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (min === 0 && max === 0) max = 1;
    return { min: min, max: max };
  }

  function drawLegend(ctx, state, eng, series, box, colors) {
    if (series.length < 2) return;
    var sz = fontSizes(state), c = fg(state);
    var h = sz.label * 0.9;
    ctx.save();
    ctx.font = fontStr(state, sz.label * 0.82, '600');
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    var items = series.map(function (s, i) {
      var t = eng.measureFit(ctx, String(s.name == null ? 'Series ' + (i + 1) : s.name), box.w * 0.3);
      return { t: t, w: ctx.measureText(t).width + h + 10, c: colors[i] };
    });
    var total = items.reduce(function (a, b) { return a + b.w + 22; }, -22);
    var x = box.x + box.w - Math.min(total, box.w);
    var y = box.y + h * 0.7;
    for (var i = 0; i < items.length; i++) {
      ctx.fillStyle = items[i].c;
      ctx.beginPath();
      ctx.arc(x + h * 0.35, y, h * 0.33, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = c.dim;
      ctx.fillText(items[i].t, x + h + 4, y);
      x += items[i].w + 22;
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------------ */

  ChartFlow.charts.barh = {
    id: 'barh',
    name: 'Horizontal bars',
    icon: '📈',
    dataShape: 'rows',

    defaults: { duration: 3, stagger: 0.1 },

    sampleDatasets: [
      {
        name: 'Top videos',
        title: 'My 6 biggest videos of the year',
        data: {
          labels: [
            'I edited for 100 hours straight',
            'Why your first 1,000 subs are the hardest',
            'The camera setup that changed my channel',
            'Reacting to my very first video',
            'How I write a script in 45 minutes',
            '10 thumbnail mistakes killing your CTR'
          ],
          series: [{ name: 'Views', values: [1420000, 860000, 645000, 512000, 398000, 274000] }]
        }
      },
      {
        name: 'Traffic sources',
        title: 'Where the views came from',
        data: {
          labels: ['Browse features', 'Suggested videos', 'YouTube search', 'External', 'Shorts feed', 'Channel pages', 'Notifications'],
          series: [{ name: 'Share of views (%)', values: [31.4, 27.8, 18.2, 9.6, 7.1, 3.8, 2.1] }]
        }
      },
      {
        name: 'Subscribers by country',
        title: 'Subscriber growth by country',
        data: {
          labels: ['United States', 'India', 'United Kingdom', 'Germany', 'Canada', 'Australia'],
          series: [
            { name: '2024', values: [42100, 38700, 15400, 9200, 8800, 6100] },
            { name: '2025', values: [58300, 61200, 18900, 11400, 10250, 7300] }
          ]
        }
      }
    ],

    validate: function (data) { return rowsOK(data); },

    drawFrame: function (ctx, state, t) {
      var eng = ChartFlow.engine;
      var data = state.data || {};
      var labels = data.labels || [];
      var series = data.series || [];
      if (!labels.length || !series.length) return;

      var area = eng.chartArea(state);
      if (!area || area.w <= 4 || area.h <= 4) return;

      var fx = effects(state), c = fg(state), sz = fontSizes(state);
      var n = labels.length, S = series.length;
      var colors = series.map(function (s, i) { return seriesColor(state, i, s.name); });

      var ext = extent(series);
      var scale = eng.niceScale(ext.min, ext.max, 6);
      var sMin = scale.min, sMax = scale.max;
      if (sMax === sMin) sMax = sMin + 1;

      var legendH = S > 1 ? sz.label * 1.6 : 0;
      var top = area.y + legendH;
      var availH = area.h - legendH;
      var bandH = availH / n;

      /* Category label font shrinks when rows get thin (50-row case). */
      var labelSize = Math.max(9, Math.min(sz.label, bandH * (S > 1 ? 0.55 : 0.62)));
      var valueSize = Math.max(9, Math.min(sz.value, bandH / S * 0.8));

      /* ---- left gutter for category labels ---- */
      var strLabels = labels.map(function (l) { return String(l == null ? '' : l); });
      ctx.save();
      ctx.font = fontStr(state, labelSize);
      var widest = 0;
      for (var li = 0; li < strLabels.length; li++) widest = Math.max(widest, ctx.measureText(strLabels[li]).width);
      var gutterL = Math.min(widest + 16, area.w * 0.34);
      var labelMaxW = gutterL - 16;

      /* ---- right gutter for value labels ---- */
      ctx.font = fontStr(state, valueSize, '600');
      var widestVal = 0;
      for (var si = 0; si < S; si++) {
        var vv = series[si].values || [];
        for (var vi = 0; vi < vv.length; vi++) widestVal = Math.max(widestVal, ctx.measureText(eng.fmt(num(vv[vi]))).width);
      }
      ctx.restore();
      var gutterR = Math.min(widestVal + 18, area.w * 0.2);

      var bottomGutter = (fx.grid !== false) ? sz.label * 1.4 : 0;

      var plotX = area.x + gutterL;
      var plotW = Math.max(10, area.w - gutterL - gutterR);
      var plotH = Math.max(10, availH - bottomGutter);
      var plotY = top;

      function xOf(v) { return plotX + plotW * (v - sMin) / (sMax - sMin); }
      var zeroX = xOf(0);

      /* ---- grid (vertical) + tick labels along the bottom ---- */
      if (fx.grid !== false) {
        ctx.save();
        ctx.strokeStyle = c.grid;
        ctx.lineWidth = 1;
        ctx.font = fontStr(state, sz.label * 0.8);
        ctx.fillStyle = c.dim;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (var g = 0; g < scale.ticks.length; g++) {
          var gv = scale.ticks[g];
          if (gv < sMin - 1e-9 || gv > sMax + 1e-9) continue;
          var gx = Math.round(xOf(gv)) + 0.5;
          ctx.beginPath();
          ctx.moveTo(gx, plotY);
          ctx.lineTo(gx, plotY + plotH);
          ctx.stroke();
          ctx.fillText(eng.fmt(gv), gx, plotY + plotH + 8);
        }
        ctx.restore();
      }

      /* zero / base axis */
      ctx.save();
      ctx.strokeStyle = c.axis;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(Math.round(zeroX) + 0.5, plotY);
      ctx.lineTo(Math.round(zeroX) + 0.5, plotY + plotH);
      ctx.stroke();
      ctx.restore();

      bandH = plotH / n;
      var groupH = bandH * (n === 1 ? 0.4 : 0.72);
      var barGap = S > 1 ? Math.min(6, groupH * 0.07) : 0;
      var barH = Math.max(1.5, (groupH - barGap * (S - 1)) / S);
      var radius = Math.max(0, Math.min(fx.cornerRadius == null ? 8 : fx.cornerRadius, barH * 0.5));
      var total = n * S;
      var showValues = barH >= 12;

      for (var i = 0; i < n; i++) {
        var bandY = plotY + i * bandH + (bandH - groupH) / 2;

        /* category label, fading in with its row */
        var rowP = clamp01(eng.progress(t, i * S, total, state.anim) * 2);
        ctx.save();
        ctx.globalAlpha = rowP;
        ctx.font = fontStr(state, labelSize);
        ctx.fillStyle = c.dim;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(eng.measureFit(ctx, strLabels[i], labelMaxW), plotX - 12, bandY + groupH / 2);
        ctx.restore();

        for (var s = 0; s < S; s++) {
          var raw = num((series[s].values || [])[i]);
          var p = eng.progress(t, i * S + s, total, state.anim);
          if (p <= 0) continue;
          var pc = clamp01(p);

          var target = xOf(raw);
          var xEnd = zeroX + (target - zeroX) * p;
          var right = raw >= 0;
          var by = bandY + s * (barH + barGap);
          var bx = Math.min(zeroX, xEnd);
          var bw = Math.abs(xEnd - zeroX);
          if (bw < 0.6) bw = 0.6;
          if (!right) bx = xEnd;

          ctx.save();
          eng.applyEffects(ctx, fx);
          ctx.fillStyle = colors[s];
          barPathH(ctx, bx, by, bw, barH, radius, right);
          ctx.fill();
          ctx.restore();

          if (showValues) {
            ctx.save();
            ctx.globalAlpha = clamp01(pc * 1.6 - 0.15);
            ctx.fillStyle = c.text;
            ctx.font = fontStr(state, valueSize, '600');
            ctx.textBaseline = 'middle';
            var txt = eng.countUp(raw, pc);
            var cy = by + barH / 2;
            if (right) {
              ctx.textAlign = 'left';
              ctx.fillText(txt, bx + bw + 10, cy);
            } else {
              ctx.textAlign = 'right';
              ctx.fillText(txt, bx - 10, cy);
            }
            ctx.restore();
          }
        }
      }

      drawLegend(ctx, state, eng, series, { x: area.x, y: area.y, w: area.w, h: area.h }, colors);
    }
  };
})();
