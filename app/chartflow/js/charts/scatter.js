/* ChartFlow — Scatter plot
 * dataShape: 'rows'
 *   series[i].values are the y values; x comes from labels — Number(label) on a
 *   nice numeric scale when every label parses as a number, otherwise evenly
 *   spaced categories.
 * Points pop in left-to-right with a scale overshoot; multi-series gets a legend.
 */
(function () {
  'use strict';
  window.ChartFlow = window.ChartFlow || { charts: {} };
  ChartFlow.charts = ChartFlow.charts || {};

  var TAU = Math.PI * 2;

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
  function inkSoft(state) { return isLightBg(state) ? 'rgba(20,23,31,0.6)' : 'rgba(242,245,250,0.62)'; }
  function gridColor(state) { return isLightBg(state) ? 'rgba(20,23,31,0.12)' : 'rgba(242,245,250,0.13)'; }
  function axisColor(state) { return isLightBg(state) ? 'rgba(20,23,31,0.3)' : 'rgba(242,245,250,0.3)'; }

  function font(state, size, weight) {
    var f = (state.style && state.style.font) || {};
    return (weight || 500) + ' ' + Math.max(8, Math.round(size)) + 'px ' + (f.family || 'system-ui, sans-serif');
  }

  function numericLabel(v) {
    if (v == null) return NaN;
    var s = String(v).trim().replace(/,/g, '');
    if (s === '') return NaN;
    var n = Number(s);
    return isFinite(n) ? n : NaN;
  }

  function prep(data) {
    var d = data || {};
    var labels = Array.isArray(d.labels) ? d.labels : [];
    var seriesIn = Array.isArray(d.series) ? d.series : [];
    var series = [];
    var maxLen = labels.length;
    for (var s = 0; s < seriesIn.length; s++) {
      var vs = Array.isArray(seriesIn[s].values) ? seriesIn[s].values : [];
      maxLen = Math.max(maxLen, vs.length);
      series.push({ name: seriesIn[s].name == null ? ('Series ' + (s + 1)) : String(seriesIn[s].name), values: vs });
    }

    // Numeric x only when every label present parses as a number.
    var allNumeric = labels.length > 0;
    for (var i = 0; i < labels.length; i++) {
      if (isNaN(numericLabel(labels[i]))) { allNumeric = false; break; }
    }

    var pts = [];
    for (var si = 0; si < series.length; si++) {
      for (var pi = 0; pi < maxLen; pi++) {
        var raw = series[si].values[pi];
        if (raw === '' || raw == null) continue;
        var y = Number(raw);
        if (!isFinite(y)) continue;
        var x = allNumeric ? numericLabel(labels[pi]) : pi;
        if (!isFinite(x)) continue;
        pts.push({ x: x, y: y, si: si, pi: pi, label: labels[pi] == null ? String(pi + 1) : String(labels[pi]) });
      }
    }
    // Reveal order: left to right, so the plot builds along the x axis.
    var order = pts.slice().sort(function (a, b) { return a.x - b.x || a.si - b.si; });
    for (var o = 0; o < order.length; o++) order[o].order = o;

    return { labels: labels, series: series, points: pts, allNumeric: allNumeric, count: maxLen };
  }

  ChartFlow.charts.scatter = {
    id: 'scatter',
    name: 'Scatter plot',
    icon: '⚬',
    dataShape: 'rows',

    sampleDatasets: [
      {
        name: 'Title length vs CTR',
        title: 'Do shorter titles get clicked more?',
        data: {
          labels: ['21', '27', '33', '38', '42', '47', '52', '58', '63', '69', '74', '81'],
          series: [{ name: 'CTR %', values: [11.2, 10.4, 9.8, 9.1, 8.4, 7.9, 7.2, 6.6, 6.1, 5.4, 5.0, 4.3] }]
        }
      },
      {
        name: 'Length vs retention',
        title: 'Video length vs average view duration',
        data: {
          labels: ['4', '6', '8', '10', '12', '15', '18', '22', '26', '30'],
          series: [
            { name: 'Long-form %', values: [62, 58, 54, 49, 47, 42, 39, 35, 31, 28] },
            { name: 'Shorts %', values: [88, 81, 74, 66, 61, 55, 48, 44, 40, 36] }
          ]
        }
      },
      {
        name: 'Upload day',
        title: 'First-48h views by upload day',
        data: {
          labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
          series: [
            { name: 'Tutorials', values: [18400, 21200, 24800, 26100, 31500, 29800, 22400] },
            { name: 'Vlogs', values: [9200, 8800, 11400, 12900, 17600, 21300, 19100] }
          ]
        }
      }
    ],

    defaults: { duration: 2.6, stagger: 0.05 },

    validate: function (data) {
      var errors = [];
      var d = data || {};
      if (!Array.isArray(d.labels) || !d.labels.length) errors.push('Add at least one x label.');
      if (!Array.isArray(d.series) || !d.series.length) {
        errors.push('Add at least one series of y values.');
      } else {
        var any = false;
        for (var i = 0; i < d.series.length; i++) {
          var vs = d.series[i].values;
          if (!Array.isArray(vs)) { errors.push('Series ' + (i + 1) + ' has no values.'); continue; }
          if (Array.isArray(d.labels) && vs.length !== d.labels.length) {
            errors.push('Series ' + (i + 1) + ' has ' + vs.length + ' values but there are ' + d.labels.length + ' labels.');
          }
          for (var j = 0; j < vs.length; j++) {
            if (vs[j] === '' || vs[j] == null) continue;
            if (!isFinite(Number(vs[j]))) { errors.push('Series ' + (i + 1) + ' contains a value that is not a number.'); break; }
            any = true;
          }
        }
        if (!any) errors.push('At least one numeric point is needed.');
      }
      return errors.length ? { ok: false, errors: errors } : { ok: true };
    },

    drawFrame: function (ctx, state, t) {
      var E = eng();
      var area = E.chartArea(state);
      if (!area || area.w <= 4 || area.h <= 4) return;

      var st = state.style || {};
      var fx = st.effects || {};
      var anim = state.anim || {};
      var fs = st.font || {};
      var labelSize = Math.max(9, Math.min(fs.labelSize || 24, area.h * 0.06));
      var P = prep(state.data);
      var pts = P.points;
      var textColor = ink(state);
      var soft = inkSoft(state);

      if (!pts.length) return;

      // ---------- legend (multi-series only) ----------
      var multi = P.series.length > 1;
      var legendH = 0;
      var top = area.y;
      if (multi) {
        legendH = labelSize * 2.1;
        top += legendH;
      }

      // ---------- scales ----------
      var yMin = Infinity, yMax = -Infinity, xMin = Infinity, xMax = -Infinity;
      for (var i = 0; i < pts.length; i++) {
        if (pts[i].y < yMin) yMin = pts[i].y;
        if (pts[i].y > yMax) yMax = pts[i].y;
        if (pts[i].x < xMin) xMin = pts[i].x;
        if (pts[i].x > xMax) xMax = pts[i].x;
      }
      if (yMin === yMax) { yMin -= Math.abs(yMin || 1) * 0.5; yMax += Math.abs(yMax || 1) * 0.5; }
      // Baseline at zero when the data sits comfortably above it.
      if (yMin > 0 && yMin < (yMax - yMin) * 1.2) yMin = 0;
      if (yMax < 0 && yMax > yMin * -0.2) yMax = 0;

      var yTicks = Math.max(3, Math.min(7, Math.round(area.h / (labelSize * 3.4))));
      var yScale = E.niceScale(yMin, yMax, yTicks);

      var xScale = null;
      if (P.allNumeric) {
        if (xMin === xMax) { xMin -= 1; xMax += 1; }
        var xTicks = Math.max(3, Math.min(8, Math.round(area.w / (labelSize * 6))));
        xScale = E.niceScale(xMin, xMax, xTicks);
      }

      // ---------- gutters ----------
      ctx.save();
      ctx.font = font(state, labelSize * 0.82, 500);
      var yLabelW = 0;
      for (var yi = 0; yi < yScale.ticks.length; yi++) {
        yLabelW = Math.max(yLabelW, ctx.measureText(E.fmt(yScale.ticks[yi])).width);
      }
      ctx.restore();

      var padL = Math.min(area.w * 0.28, yLabelW + labelSize * 0.9);
      var padB = labelSize * 2.1;
      var padR = Math.max(labelSize * 0.8, area.w * 0.02);
      var padT = labelSize * 0.9;

      var plot = {
        x: area.x + padL,
        y: top + padT,
        w: Math.max(10, area.w - padL - padR),
        h: Math.max(10, (area.y + area.h) - top - padT - padB)
      };

      function yPos(v) {
        var f = (v - yScale.min) / (yScale.max - yScale.min || 1);
        return plot.y + plot.h - f * plot.h;
      }
      function xPos(v) {
        if (xScale) {
          var f = (v - xScale.min) / (xScale.max - xScale.min || 1);
          return plot.x + f * plot.w;
        }
        var n = Math.max(1, P.count);
        if (n === 1) return plot.x + plot.w / 2;
        var inset = plot.w * 0.06;
        return plot.x + inset + (v / (n - 1)) * (plot.w - inset * 2);
      }

      // ---------- grid + axes ----------
      ctx.save();
      ctx.lineWidth = 1;
      if (fx.grid !== false) {
        ctx.strokeStyle = gridColor(state);
        for (var g = 0; g < yScale.ticks.length; g++) {
          var gy = Math.round(yPos(yScale.ticks[g])) + 0.5;
          ctx.beginPath();
          ctx.moveTo(plot.x, gy);
          ctx.lineTo(plot.x + plot.w, gy);
          ctx.stroke();
        }
        if (xScale) {
          for (var xg = 0; xg < xScale.ticks.length; xg++) {
            var gx = Math.round(xPos(xScale.ticks[xg])) + 0.5;
            if (gx < plot.x - 1 || gx > plot.x + plot.w + 1) continue;
            ctx.beginPath();
            ctx.moveTo(gx, plot.y);
            ctx.lineTo(gx, plot.y + plot.h);
            ctx.stroke();
          }
        }
      }
      // zero line + axis lines
      ctx.strokeStyle = axisColor(state);
      ctx.beginPath();
      ctx.moveTo(Math.round(plot.x) + 0.5, plot.y);
      ctx.lineTo(Math.round(plot.x) + 0.5, plot.y + plot.h);
      ctx.stroke();
      var zeroY = (yScale.min < 0 && yScale.max > 0) ? yPos(0) : plot.y + plot.h;
      ctx.beginPath();
      ctx.moveTo(plot.x, Math.round(zeroY) + 0.5);
      ctx.lineTo(plot.x + plot.w, Math.round(zeroY) + 0.5);
      ctx.stroke();
      ctx.restore();

      // ---------- tick labels ----------
      ctx.save();
      ctx.fillStyle = soft;
      ctx.font = font(state, labelSize * 0.82, 500);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (var yt = 0; yt < yScale.ticks.length; yt++) {
        ctx.fillText(E.fmt(yScale.ticks[yt]), plot.x - labelSize * 0.4, yPos(yScale.ticks[yt]));
      }
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      var xLabelY = plot.y + plot.h + labelSize * 0.55;
      if (xScale) {
        for (var xt = 0; xt < xScale.ticks.length; xt++) {
          var tx = xPos(xScale.ticks[xt]);
          if (tx < plot.x - 1 || tx > plot.x + plot.w + 1) continue;
          ctx.fillText(E.fmt(xScale.ticks[xt]), tx, xLabelY);
        }
      } else {
        var slotW = P.count > 1 ? (plot.w * 0.88) / (P.count - 1) : plot.w;
        var every = Math.max(1, Math.ceil((P.count * labelSize * 3.2) / Math.max(1, plot.w)));
        for (var ci = 0; ci < P.count; ci++) {
          if (ci % every !== 0 && ci !== P.count - 1) continue;
          var lbl = P.labels[ci] == null ? String(ci + 1) : String(P.labels[ci]);
          ctx.fillText(E.measureFit(ctx, lbl, Math.max(30, slotW * 0.96)), xPos(ci), xLabelY);
        }
      }
      ctx.restore();

      // ---------- points ----------
      var nPts = pts.length;
      var baseR = Math.max(3, Math.min(Math.min(plot.w, plot.h) * 0.022, 18));
      if (nPts > 60) baseR *= 0.75;
      var pop = (E.ease && E.ease.easeOutBack) ? E.ease.easeOutBack : function (v) { return v; };
      var ringColor = isLightBg(state) ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.16)';

      ctx.save();
      ctx.beginPath();
      ctx.rect(plot.x - baseR * 2.2, plot.y - baseR * 2.2, plot.w + baseR * 4.4, plot.h + baseR * 4.4);
      ctx.clip();
      E.applyEffects(ctx, fx);
      for (var pi2 = 0; pi2 < nPts; pi2++) {
        var pt = pts[pi2];
        var prog = E.clamp01(E.progress(t, pt.order, nPts, anim));
        if (prog <= 0) continue;
        var scale = Math.max(0, pop(prog));
        var r = baseR * scale;
        if (r <= 0.2) continue;
        ctx.globalAlpha = E.clamp01(prog * 1.6) * 0.92;
        ctx.fillStyle = seriesColor(state, pt.si, P.series[pt.si] && P.series[pt.si].name);
        ctx.beginPath();
        ctx.arc(xPos(pt.x), yPos(pt.y), r, 0, TAU);
        ctx.fill();
        if (baseR > 6) {
          ctx.globalAlpha *= 0.85;
          ctx.strokeStyle = ringColor;
          ctx.lineWidth = Math.max(1, baseR * 0.16);
          ctx.stroke();
        }
      }
      ctx.restore();

      // ---------- legend chips ----------
      if (multi) {
        ctx.save();
        ctx.font = font(state, labelSize * 0.85, 600);
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        var chipR = labelSize * 0.32;
        var gap = labelSize * 1.4;
        var items = [];
        var totalW = 0;
        for (var li = 0; li < P.series.length; li++) {
          var nm = E.measureFit(ctx, P.series[li].name, area.w * 0.3);
          var w = chipR * 2 + labelSize * 0.5 + ctx.measureText(nm).width;
          items.push({ name: nm, w: w, color: seriesColor(state, li, P.series[li].name) });
          totalW += w + (li ? gap : 0);
        }
        var lx = area.x + Math.max(0, (area.w - totalW) / 2);
        var ly = area.y + legendH / 2;
        var legendAlpha = E.clamp01(t / 0.18);
        ctx.globalAlpha = legendAlpha;
        for (var m = 0; m < items.length; m++) {
          ctx.fillStyle = items[m].color;
          ctx.beginPath();
          ctx.arc(lx + chipR, ly, chipR, 0, TAU);
          ctx.fill();
          ctx.fillStyle = textColor;
          ctx.fillText(items[m].name, lx + chipR * 2 + labelSize * 0.4, ly);
          lx += items[m].w + gap;
        }
        ctx.restore();
      }
    }
  };
})();
