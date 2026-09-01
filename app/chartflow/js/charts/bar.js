/* ChartFlow — vertical bar chart
 * Bars grow from the zero baseline, staggered left→right.
 * Supports multi-series (grouped), negative values, grid + nice y-scale,
 * rounded bar tops, and crowded/long-label handling.
 */
(function () {
  'use strict';
  window.ChartFlow = window.ChartFlow || { charts: {} };
  ChartFlow.charts = ChartFlow.charts || {};

  /* ---------- shared tiny helpers (kept local: charts must not add globals) ---------- */

  function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }

  function fontStr(state, size, weight) {
    var f = (state.style && state.style.font) || {};
    return (weight ? weight + ' ' : '') + Math.max(8, Math.round(size)) + 'px ' +
      (f.family || 'system-ui, -apple-system, sans-serif');
  }

  function fontSizes(state) {
    var f = (state.style && state.style.font) || {};
    return {
      label: f.labelSize || 24,
      value: f.valueSize || 28
    };
  }

  function hexToRgb(hex) {
    if (typeof hex !== 'string') return null;
    var h = hex.trim().replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return null;
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }

  /* Readable foreground for the current background. */
  function fg(state) {
    var bg = (state.style && state.style.background) || {};
    var col = null;
    if (bg.type === 'solid') col = bg.color;
    else if (bg.type === 'gradient' && bg.gradient && bg.gradient.stops && bg.gradient.stops.length) {
      col = bg.gradient.stops[0].color;
    }
    var rgb = hexToRgb(col);
    if (!rgb) return { text: '#e8eaf0', dim: 'rgba(232,234,240,0.66)', grid: 'rgba(232,234,240,0.13)', axis: 'rgba(232,234,240,0.34)' };
    var lum = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
    if (lum > 0.6) {
      return { text: '#171a21', dim: 'rgba(23,26,33,0.62)', grid: 'rgba(23,26,33,0.12)', axis: 'rgba(23,26,33,0.30)' };
    }
    return { text: '#e8eaf0', dim: 'rgba(232,234,240,0.66)', grid: 'rgba(232,234,240,0.13)', axis: 'rgba(232,234,240,0.34)' };
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

  function effects(state) {
    return (state.style && state.style.effects) || {};
  }

  /* Rect with only the "far end" corners rounded (top for upward bars). */
  function barPath(ctx, x, y, w, h, r, up) {
    r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h)));
    ctx.beginPath();
    if (r <= 0.5) { ctx.rect(x, y, w, h); return; }
    if (up) {
      ctx.moveTo(x, y + h);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h);
    } else {
      ctx.moveTo(x, y);
      ctx.lineTo(x + w, y);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    }
    ctx.closePath();
  }

  function rowsOK(data) {
    var errors = [];
    if (!data || typeof data !== 'object') { return { ok: false, errors: ['No data.'] }; }
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

  /* Value extent across all series, always including zero (bars need a baseline). */
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

  ChartFlow.charts.bar = {
    id: 'bar',
    name: 'Bar chart',
    icon: '📊',
    dataShape: 'rows',

    defaults: { duration: 3, stagger: 0.08 },

    sampleDatasets: [
      {
        name: 'Monthly views',
        title: 'Channel views, month by month',
        data: {
          labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'],
          series: [{ name: 'Views', values: [182000, 214000, 198000, 305000, 412000, 388000, 521000, 604000] }]
        }
      },
      {
        name: 'Revenue by source',
        title: 'Where the money actually comes from',
        data: {
          labels: ['AdSense', 'Sponsorships', 'Memberships', 'Merch', 'Affiliate', 'Courses'],
          series: [{ name: 'Revenue ($)', values: [4820, 11500, 1240, 860, 1970, 3400] }]
        }
      },
      {
        name: 'Shorts vs long-form',
        title: 'Shorts vs long-form views by quarter',
        data: {
          labels: ['Q1', 'Q2', 'Q3', 'Q4'],
          series: [
            { name: 'Shorts', values: [420000, 690000, 1150000, 1480000] },
            { name: 'Long-form', values: [310000, 355000, 402000, 486000] }
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

      /* ---- gutters ---- */
      var legendH = S > 1 ? sz.label * 1.6 : 0;
      var valueRoom = sz.value * 1.5;

      ctx.save();
      ctx.font = fontStr(state, sz.label * 0.85);
      var gutterL = 0;
      if (fx.grid !== false) {
        for (var ti = 0; ti < scale.ticks.length; ti++) {
          gutterL = Math.max(gutterL, ctx.measureText(eng.fmt(scale.ticks[ti])).width);
        }
        gutterL = Math.min(gutterL + 14, area.w * 0.22);
      }

      var plotX = area.x + gutterL;
      var plotW = Math.max(10, area.w - gutterL);
      var bandW = plotW / n;

      /* ---- label strategy: straight, rotated, or thinned ---- */
      ctx.font = fontStr(state, sz.label);
      var maxLabelW = 0, strLabels = labels.map(function (l) { return String(l == null ? '' : l); });
      for (var li = 0; li < strLabels.length; li++) {
        maxLabelW = Math.max(maxLabelW, ctx.measureText(strLabels[li]).width);
      }
      var every = 1;
      var rotate = maxLabelW > bandW * 0.92;
      if (rotate) {
        /* very crowded → also thin the labels out so rotated text doesn't collide */
        var minSpacing = sz.label * 1.15;
        every = Math.max(1, Math.ceil(minSpacing / Math.max(1, bandW)));
      }
      var bottomGutter;
      var maxLabelTextW = area.w;
      if (rotate) {
        var budget = Math.min(area.h * 0.34, area.h - 60);
        maxLabelTextW = Math.max(20, (budget - sz.label * 0.5) / 0.7071);
        var used = Math.min(maxLabelW, maxLabelTextW);
        bottomGutter = used * 0.7071 + sz.label * 0.6;
      } else {
        maxLabelTextW = bandW * 0.94;
        bottomGutter = sz.label * 1.7;
      }
      ctx.restore();

      var plotY = area.y + legendH + valueRoom * 0.6;
      var plotH = Math.max(10, area.h - legendH - valueRoom * 0.6 - bottomGutter);
      var axisY = plotY + plotH;

      function yOf(v) { return plotY + plotH * (sMax - v) / (sMax - sMin); }
      var zeroY = yOf(0);

      /* ---- grid + tick labels ---- */
      if (fx.grid !== false) {
        ctx.save();
        ctx.strokeStyle = c.grid;
        ctx.lineWidth = 1;
        ctx.font = fontStr(state, sz.label * 0.85);
        ctx.fillStyle = c.dim;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        for (var g = 0; g < scale.ticks.length; g++) {
          var gv = scale.ticks[g];
          if (gv < sMin - 1e-9 || gv > sMax + 1e-9) continue;
          var gy = Math.round(yOf(gv)) + 0.5;
          ctx.beginPath();
          ctx.moveTo(plotX, gy);
          ctx.lineTo(plotX + plotW, gy);
          ctx.stroke();
          ctx.fillText(eng.fmt(gv), plotX - 10, gy);
        }
        ctx.restore();
      }

      /* zero / base axis */
      ctx.save();
      ctx.strokeStyle = c.axis;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(plotX, Math.round(zeroY) + 0.5);
      ctx.lineTo(plotX + plotW, Math.round(zeroY) + 0.5);
      ctx.stroke();
      ctx.restore();

      /* ---- bars ---- */
      var groupW = bandW * (n === 1 ? 0.4 : 0.74);
      var barGap = S > 1 ? Math.min(8, groupW * 0.07) : 0;
      var barW = Math.max(1.5, (groupW - barGap * (S - 1)) / S);
      var radius = Math.max(0, Math.min(fx.cornerRadius == null ? 8 : fx.cornerRadius, barW * 0.5));
      var total = n * S;
      var showValues = barW >= 22 && bandW >= sz.value * 1.6;

      for (var i = 0; i < n; i++) {
        var bandX = plotX + i * bandW + (bandW - groupW) / 2;
        for (var s = 0; s < S; s++) {
          var raw = num((series[s].values || [])[i]);
          var p = eng.progress(t, i * S + s, total, state.anim);
          var pc = clamp01(p);
          if (p <= 0) continue;

          var target = yOf(raw);
          var yEnd = zeroY + (target - zeroY) * p;
          var up = raw >= 0;
          var bx = bandX + s * (barW + barGap);
          var by = Math.min(zeroY, yEnd);
          var bh = Math.abs(yEnd - zeroY);
          if (bh < 0.6) bh = 0.6;
          if (!up) by = zeroY;

          ctx.save();
          eng.applyEffects(ctx, fx);
          ctx.fillStyle = colors[s];
          barPath(ctx, bx, by, barW, bh, radius, up);
          ctx.fill();
          ctx.restore();

          if (showValues) {
            ctx.save();
            ctx.globalAlpha = clamp01(pc * 1.6 - 0.15);
            ctx.fillStyle = c.text;
            ctx.font = fontStr(state, sz.value * (S > 1 ? 0.78 : 1), '600');
            ctx.textAlign = 'center';
            var txt = eng.countUp(raw, pc);
            var cx = bx + barW / 2;
            if (up) {
              ctx.textBaseline = 'bottom';
              ctx.fillText(txt, cx, by - 8);
            } else {
              ctx.textBaseline = 'top';
              ctx.fillText(txt, cx, by + bh + 8);
            }
            ctx.restore();
          }
        }
      }

      /* ---- category labels ---- */
      ctx.save();
      ctx.font = fontStr(state, sz.label);
      ctx.fillStyle = c.dim;
      for (var k = 0; k < n; k++) {
        if (k % every !== 0 && k !== n - 1) continue;
        var lx = plotX + k * bandW + bandW / 2;
        var txt2 = eng.measureFit(ctx, strLabels[k], maxLabelTextW);
        var lp = clamp01(eng.progress(t, k * S, total, state.anim) * 2);
        ctx.globalAlpha = lp;
        if (rotate) {
          ctx.save();
          ctx.translate(lx, axisY + sz.label * 0.55);
          ctx.rotate(-Math.PI / 4);
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          ctx.fillText(txt2, 0, 0);
          ctx.restore();
        } else {
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(txt2, lx, axisY + sz.label * 0.42);
        }
      }
      ctx.restore();

      drawLegend(ctx, state, eng, series, { x: area.x, y: area.y, w: area.w, h: area.h }, colors);
    }
  };
})();
