/* ChartFlow — area chart
 * The stroke draws on along the true path length; the fill wipes in beneath it
 * via a clip rect that advances with the drawing head.
 * Multiple series stack (semi-transparent) when all values are non-negative;
 * with negatives they overlay instead, so the baseline stays honest.
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

  function rgba(hex, a) {
    var c = hexToRgb(hex);
    if (!c) return hex;
    return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')';
  }

  function fg(state) {
    var bg = (state.style && state.style.background) || {};
    var col = null;
    if (bg.type === 'solid') col = bg.color;
    else if (bg.type === 'gradient' && bg.gradient && bg.gradient.stops && bg.gradient.stops.length) col = bg.gradient.stops[0].color;
    var rgbv = hexToRgb(col);
    var dark = { text: '#e8eaf0', dim: 'rgba(232,234,240,0.66)', grid: 'rgba(232,234,240,0.13)', axis: 'rgba(232,234,240,0.34)' };
    if (!rgbv) return dark;
    var lum = (0.299 * rgbv.r + 0.587 * rgbv.g + 0.114 * rgbv.b) / 255;
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

  function cumLengths(pts) {
    var out = [0], total = 0;
    for (var i = 1; i < pts.length; i++) {
      var dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y;
      total += Math.sqrt(dx * dx + dy * dy);
      out.push(total);
    }
    return { at: out, total: total };
  }

  function tracePartial(ctx, pts, cum, drawn) {
    if (!pts.length) return null;
    if (pts.length === 1) return pts[0];
    if (drawn <= 0) return null;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    var head = pts[0];
    for (var i = 1; i < pts.length; i++) {
      var segStart = cum.at[i - 1], segEnd = cum.at[i];
      if (drawn >= segEnd) {
        ctx.lineTo(pts[i].x, pts[i].y);
        head = pts[i];
      } else {
        var segLen = segEnd - segStart;
        var r = segLen > 0 ? (drawn - segStart) / segLen : 0;
        if (r > 0) {
          head = { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * r, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * r };
          ctx.lineTo(head.x, head.y);
        }
        break;
      }
    }
    return head;
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

  ChartFlow.charts.area = {
    id: 'area',
    name: 'Area chart',
    icon: '🏔️',
    dataShape: 'rows',

    defaults: { duration: 3.5, stagger: 0.3 },

    sampleDatasets: [
      {
        name: 'Watch hours by format',
        title: 'Watch hours by format',
        data: {
          labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'],
          series: [
            { name: 'Long-form', values: [1820, 2140, 2380, 2610, 3020, 3450, 3810, 4120, 4680] },
            { name: 'Shorts', values: [340, 520, 890, 1420, 1980, 2610, 3240, 3980, 4510] },
            { name: 'Livestreams', values: [180, 210, 260, 240, 390, 470, 520, 610, 740] }
          ]
        }
      },
      {
        name: 'Cumulative subscribers',
        title: 'Total subscribers over two years',
        data: {
          labels: ['Q1 24', 'Q2 24', 'Q3 24', 'Q4 24', 'Q1 25', 'Q2 25', 'Q3 25', 'Q4 25'],
          series: [{ name: 'Subscribers', values: [4200, 9800, 18400, 31200, 48600, 71400, 98200, 132500] }]
        }
      },
      {
        name: 'Revenue mix',
        title: 'Monthly revenue mix',
        data: {
          labels: ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'],
          series: [
            { name: 'AdSense', values: [1840, 2120, 2480, 3010, 3390, 4020] },
            { name: 'Sponsorships', values: [2500, 0, 5000, 3500, 7500, 6000] },
            { name: 'Memberships', values: [420, 510, 640, 780, 910, 1140] }
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

      /* stack only when every value is non-negative */
      var hasNeg = false, i, j;
      for (i = 0; i < S; i++) {
        var vv = series[i].values || [];
        for (j = 0; j < vv.length; j++) if (num(vv[j]) < 0) { hasNeg = true; break; }
        if (hasNeg) break;
      }
      var stacked = S > 1 && !hasNeg;

      /* per-series top values (stacked cumulative or raw) */
      var tops = [], base = [];
      var running = new Array(n);
      for (j = 0; j < n; j++) running[j] = 0;
      for (i = 0; i < S; i++) {
        var vals = series[i].values || [];
        var topRow = [], baseRow = [];
        for (j = 0; j < n; j++) {
          var v = num(vals[j]);
          if (stacked) { baseRow.push(running[j]); running[j] += v; topRow.push(running[j]); }
          else { baseRow.push(0); topRow.push(v); }
        }
        tops.push(topRow); base.push(baseRow);
      }

      var vmin = Infinity, vmax = -Infinity;
      for (i = 0; i < S; i++) for (j = 0; j < n; j++) {
        if (tops[i][j] < vmin) vmin = tops[i][j];
        if (tops[i][j] > vmax) vmax = tops[i][j];
        if (base[i][j] < vmin) vmin = base[i][j];
        if (base[i][j] > vmax) vmax = base[i][j];
      }
      if (!isFinite(vmin) || !isFinite(vmax)) { vmin = 0; vmax = 1; }
      if (vmin > 0) vmin = 0;
      if (vmin === vmax) vmax = vmin + 1;

      var scale = eng.niceScale(vmin, vmax, 6);
      var sMin = scale.min, sMax = scale.max;
      if (sMax === sMin) sMax = sMin + 1;

      var legendH = S > 1 ? sz.label * 1.6 : 0;

      ctx.save();
      ctx.font = fontStr(state, sz.label * 0.85);
      var gutterL = 0;
      if (fx.grid !== false) {
        for (var ti = 0; ti < scale.ticks.length; ti++) {
          gutterL = Math.max(gutterL, ctx.measureText(eng.fmt(scale.ticks[ti])).width);
        }
        gutterL = Math.min(gutterL + 14, area.w * 0.22);
      }
      ctx.restore();

      var plotX = area.x + gutterL;
      var plotW = Math.max(10, area.w - gutterL);
      var spacing = n > 1 ? plotW / (n - 1) : plotW;

      /* ---- x label strategy ---- */
      var strLabels = labels.map(function (l) { return String(l == null ? '' : l); });
      ctx.save();
      ctx.font = fontStr(state, sz.label);
      var maxLabelW = 0;
      for (var li = 0; li < n; li++) maxLabelW = Math.max(maxLabelW, ctx.measureText(strLabels[li]).width);
      var rotate = maxLabelW > spacing * 0.92 && n > 1;
      var every = 1, maxLabelTextW, bottomGutter;
      if (rotate) {
        every = Math.max(1, Math.ceil((sz.label * 1.15) / Math.max(1, spacing)));
        var budget = Math.min(area.h * 0.34, area.h - 60);
        maxLabelTextW = Math.max(20, (budget - sz.label * 0.5) / 0.7071);
        bottomGutter = Math.min(maxLabelW, maxLabelTextW) * 0.7071 + sz.label * 0.6;
      } else {
        maxLabelTextW = spacing * 0.94;
        bottomGutter = sz.label * 1.7;
      }
      ctx.restore();

      var plotY = area.y + legendH + sz.value * 0.6;
      var plotH = Math.max(10, area.h - legendH - sz.value * 0.6 - bottomGutter);
      var axisY = plotY + plotH;

      function xOf(k) { return n > 1 ? plotX + k * spacing : plotX + plotW / 2; }
      function yOf(v) { return plotY + plotH * (sMax - v) / (sMax - sMin); }

      /* ---- grid ---- */
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

      /* baseline / zero axis */
      ctx.save();
      ctx.strokeStyle = c.axis;
      ctx.lineWidth = 1.5;
      var zy = Math.round(yOf(Math.max(sMin, Math.min(0, sMax)))) + 0.5;
      ctx.beginPath();
      ctx.moveTo(plotX, zy);
      ctx.lineTo(plotX + plotW, zy);
      ctx.stroke();
      ctx.restore();

      var lw = Math.max(2, Math.round(plotH / 170));
      var fillAlpha = stacked ? 0.55 : (S > 1 ? 0.32 : 0.4);

      for (i = 0; i < S; i++) {
        var pts = [], basePts = [];
        for (j = 0; j < n; j++) {
          pts.push({ x: xOf(j), y: yOf(tops[i][j]) });
          basePts.push({ x: xOf(j), y: yOf(base[i][j]) });
        }
        var cum = cumLengths(pts);
        var p = clamp01(eng.progress(t, i, S, state.anim));
        if (p <= 0) continue;
        var drawn = cum.total * p;

        /* find the head x so the fill wipe tracks the stroke exactly */
        var headX = pts[0].x;
        if (n === 1) {
          headX = pts[0].x + spacing * 0.5 * p;
        } else {
          for (j = 1; j < n; j++) {
            if (drawn >= cum.at[j]) { headX = pts[j].x; }
            else {
              var segLen = cum.at[j] - cum.at[j - 1];
              var r = segLen > 0 ? (drawn - cum.at[j - 1]) / segLen : 0;
              headX = pts[j - 1].x + (pts[j].x - pts[j - 1].x) * Math.max(0, r);
              break;
            }
          }
        }

        /* ---- fill, clipped to the advancing wipe ---- */
        ctx.save();
        ctx.beginPath();
        ctx.rect(plotX - 2, plotY - plotH, Math.max(0, headX - plotX + 2), plotH * 3);
        ctx.clip();
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (j = 1; j < n; j++) ctx.lineTo(pts[j].x, pts[j].y);
        if (n === 1) ctx.lineTo(pts[0].x + spacing * 0.5, pts[0].y);
        for (j = n - 1; j >= 0; j--) ctx.lineTo(basePts[j].x, basePts[j].y);
        ctx.closePath();
        ctx.fillStyle = rgba(colors[i], fillAlpha);
        ctx.fill();
        ctx.restore();

        /* ---- stroke draw-on ---- */
        ctx.save();
        eng.applyEffects(ctx, fx);
        ctx.strokeStyle = colors[i];
        ctx.lineWidth = lw;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        var head = tracePartial(ctx, pts, cum, drawn);
        if (n > 1) ctx.stroke();
        ctx.restore();

        if (head) {
          ctx.save();
          eng.applyEffects(ctx, fx);
          ctx.fillStyle = colors[i];
          ctx.beginPath();
          ctx.arc(head.x, head.y, lw * (p < 1 ? 1.7 : 1.4), 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }

      /* ---- x labels ---- */
      ctx.save();
      ctx.font = fontStr(state, sz.label);
      ctx.fillStyle = c.dim;
      ctx.globalAlpha = clamp01(eng.progress(t, 0, S, state.anim) * 3);
      for (var m = 0; m < n; m++) {
        if (m % every !== 0 && m !== n - 1) continue;
        var lx = xOf(m);
        var txt = eng.measureFit(ctx, strLabels[m], maxLabelTextW);
        if (rotate) {
          ctx.save();
          ctx.translate(lx, axisY + sz.label * 0.55);
          ctx.rotate(-Math.PI / 4);
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          ctx.fillText(txt, 0, 0);
          ctx.restore();
        } else {
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(txt, lx, axisY + sz.label * 0.42);
        }
      }
      ctx.restore();

      drawLegend(ctx, state, eng, series, { x: area.x, y: area.y, w: area.w, h: area.h }, colors);
    }
  };
})();
