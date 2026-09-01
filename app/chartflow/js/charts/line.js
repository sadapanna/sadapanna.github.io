/* ChartFlow — line chart
 * True draw-on: cumulative segment lengths are walked so a partial path is
 * built each frame (no setLineDash tricks, so per-series stagger works).
 * Dots pop in as the stroke reaches them; optional value labels at the dots.
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
    var dark = { text: '#e8eaf0', dim: 'rgba(232,234,240,0.66)', grid: 'rgba(232,234,240,0.13)', axis: 'rgba(232,234,240,0.34)', dot: '#0f1117' };
    if (!rgb) return dark;
    var lum = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
    if (lum > 0.6) return { text: '#171a21', dim: 'rgba(23,26,33,0.62)', grid: 'rgba(23,26,33,0.12)', axis: 'rgba(23,26,33,0.30)', dot: '#ffffff' };
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

  function extent(series) {
    var min = Infinity, max = -Infinity;
    for (var i = 0; i < series.length; i++) {
      var vals = series[i].values || [];
      for (var j = 0; j < vals.length; j++) {
        var v = num(vals[j]);
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (!isFinite(min) || !isFinite(max)) { min = 0; max = 1; }
    if (min === max) { min = min - Math.abs(min || 1) * 0.5; max = max + Math.abs(max || 1) * 0.5; }
    return { min: min, max: max };
  }

  /* Cumulative lengths along a polyline. */
  function cumLengths(pts) {
    var out = [0], total = 0;
    for (var i = 1; i < pts.length; i++) {
      var dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y;
      total += Math.sqrt(dx * dx + dy * dy);
      out.push(total);
    }
    return { at: out, total: total };
  }

  /* Trace the polyline up to `drawn` length. Returns the head point (or null). */
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

  function easeOutBack(x) {
    var c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
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

  ChartFlow.charts.line = {
    id: 'line',
    name: 'Line chart',
    icon: '📉',
    dataShape: 'rows',

    defaults: { duration: 3.5, stagger: 0.25 },

    sampleDatasets: [
      {
        name: 'Subscriber growth',
        title: 'Subscribers, month by month',
        data: {
          labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
          series: [{ name: 'Subscribers', values: [12400, 14100, 15800, 19200, 24600, 31500, 38900, 44200, 51700, 60300, 72800, 88400] }]
        }
      },
      {
        name: 'Shorts vs long-form',
        title: 'Daily views: Shorts vs long-form',
        data: {
          labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5', 'Week 6', 'Week 7', 'Week 8'],
          series: [
            { name: 'Shorts', values: [8200, 15400, 34800, 61200, 52300, 78900, 96400, 84100] },
            { name: 'Long-form', values: [14300, 15100, 16800, 18400, 21200, 23700, 25100, 28600] }
          ]
        }
      },
      {
        name: 'Profit after costs',
        title: 'Monthly profit after production costs',
        data: {
          labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'],
          series: [{ name: 'Net ($)', values: [-1240, -820, -310, 140, 960, 2380, 1870, 4120] }]
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

      /* ---- gutters ---- */
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

      var inset = Math.min(28, area.w * 0.04);
      var plotX = area.x + gutterL + inset;
      var plotW = Math.max(10, area.w - gutterL - inset * 2);
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

      var valueRoom = sz.value * 1.6;
      var plotY = area.y + legendH + valueRoom * 0.5;
      var plotH = Math.max(10, area.h - legendH - valueRoom * 0.5 - bottomGutter);
      var axisY = plotY + plotH;

      function xOf(i) { return n > 1 ? plotX + i * spacing : plotX + plotW / 2; }
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
          ctx.moveTo(plotX - inset, gy);
          ctx.lineTo(plotX + plotW + inset, gy);
          ctx.stroke();
          ctx.fillText(eng.fmt(gv), plotX - inset - 10, gy);
        }
        ctx.restore();
      }

      /* zero line when the scale straddles zero */
      if (sMin < 0 && sMax > 0) {
        ctx.save();
        ctx.strokeStyle = c.axis;
        ctx.lineWidth = 1.5;
        var zy = Math.round(yOf(0)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(plotX - inset, zy);
        ctx.lineTo(plotX + plotW + inset, zy);
        ctx.stroke();
        ctx.restore();
      }

      /* ---- lines ---- */
      var lw = Math.max(2, Math.round(plotH / 150));
      var dotR = lw * 1.7;
      var showValues = (fx.valueLabels != null) ? !!fx.valueLabels : (n <= 12 && S <= 2 && spacing > sz.value * 2.2);

      for (var s = 0; s < S; s++) {
        var vals = series[s].values || [];
        var pts = [];
        for (var i = 0; i < n; i++) pts.push({ x: xOf(i), y: yOf(num(vals[i])), v: num(vals[i]) });
        var cum = cumLengths(pts);
        var p = clamp01(eng.progress(t, s, S, state.anim));
        var drawn = cum.total * p;
        var popWin = Math.max(1, cum.total * 0.05);

        if (p > 0) {
          ctx.save();
          eng.applyEffects(ctx, fx);
          ctx.strokeStyle = colors[s];
          ctx.lineWidth = lw;
          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';
          var head = tracePartial(ctx, pts, cum, drawn);
          if (pts.length > 1) ctx.stroke();
          ctx.restore();

          /* head dot while still drawing */
          if (head && p < 1 && pts.length > 1) {
            ctx.save();
            eng.applyEffects(ctx, fx);
            ctx.fillStyle = colors[s];
            ctx.beginPath();
            ctx.arc(head.x, head.y, dotR * 1.15, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }

          /* dots pop in as the stroke passes them */
          for (var j = 0; j < pts.length; j++) {
            var reach = pts.length === 1 ? (p > 0 ? 1 : 0) : clamp01((drawn - cum.at[j]) / popWin);
            if (reach <= 0) continue;
            var k = clamp01(easeOutBack(reach));
            ctx.save();
            eng.applyEffects(ctx, fx);
            ctx.fillStyle = colors[s];
            ctx.beginPath();
            ctx.arc(pts[j].x, pts[j].y, dotR * k, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            if (showValues) {
              ctx.save();
              ctx.globalAlpha = reach;
              ctx.fillStyle = c.text;
              ctx.font = fontStr(state, sz.value * 0.8, '600');
              ctx.textAlign = 'center';
              var above = j === 0 || pts[j].v >= (pts[j - 1] ? pts[j - 1].v : pts[j].v);
              if (pts[j].y - dotR - sz.value < plotY) above = false;
              if (above) {
                ctx.textBaseline = 'bottom';
                ctx.fillText(eng.fmt(pts[j].v), pts[j].x, pts[j].y - dotR - 6);
              } else {
                ctx.textBaseline = 'top';
                ctx.fillText(eng.fmt(pts[j].v), pts[j].x, pts[j].y + dotR + 6);
              }
              ctx.restore();
            }
          }
        }
      }

      /* ---- x labels ---- */
      ctx.save();
      ctx.font = fontStr(state, sz.label);
      ctx.fillStyle = c.dim;
      var firstP = clamp01(eng.progress(t, 0, S, state.anim) * 3);
      ctx.globalAlpha = firstP;
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
