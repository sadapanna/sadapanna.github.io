/* ChartFlow — Pie / Donut chart
 * dataShape: 'rows'  (uses labels + series[0].values)
 * Slices sweep in sequentially with stagger; labels + percentages fade in as
 * each slice completes. state.style.donut === true renders a donut with the
 * total counting up in the centre.
 */
(function () {
  'use strict';
  window.ChartFlow = window.ChartFlow || { charts: {} };
  ChartFlow.charts = ChartFlow.charts || {};

  var TAU = Math.PI * 2;

  // ---------- small local helpers (charts must not add shared files) ----------

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

  // Text colour that reads against the chosen background.
  function ink(state) {
    var bg = (state.style && state.style.background) || {};
    var base = '#0f1117';
    if (bg.type === 'gradient' && bg.gradient && bg.gradient.stops && bg.gradient.stops.length) {
      base = bg.gradient.stops[0].color;
    } else if (bg.type === 'solid') {
      base = bg.color || base;
    } else if (bg.type === 'transparent') {
      base = '#0f1117';
    }
    return hexLum(base) > 0.55 ? '#14171f' : '#f2f5fa';
  }

  function inkSoft(state) {
    return ink(state) === '#14171f' ? 'rgba(20,23,31,0.62)' : 'rgba(242,245,250,0.66)';
  }

  function bgInk(state) {
    var bg = (state.style && state.style.background) || {};
    if (bg.type === 'solid' && bg.color) return bg.color;
    if (bg.type === 'gradient' && bg.gradient && bg.gradient.stops && bg.gradient.stops.length) {
      return bg.gradient.stops[0].color;
    }
    return ink(state) === '#14171f' ? '#ffffff' : '#0f1117';
  }

  function font(state, size, weight) {
    var f = (state.style && state.style.font) || {};
    return (weight || 500) + ' ' + Math.max(8, Math.round(size)) + 'px ' + (f.family || 'system-ui, sans-serif');
  }

  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }

  // ---------- data prep ----------

  function prep(data) {
    var d = data || {};
    var labels = Array.isArray(d.labels) ? d.labels : [];
    var series = Array.isArray(d.series) ? d.series : [];
    var vals = (series[0] && Array.isArray(series[0].values)) ? series[0].values : [];
    var n = Math.max(labels.length, vals.length);
    var out = [];
    var total = 0;
    for (var i = 0; i < n; i++) {
      // Negative values are meaningless in a pie — treat them as zero magnitude.
      var v = Math.max(0, num(vals[i]));
      var lb = labels[i] == null ? ('Item ' + (i + 1)) : String(labels[i]);
      out.push({ label: lb, value: v, index: i });
      total += v;
    }
    return { slices: out, total: total };
  }

  // ---------- module ----------

  ChartFlow.charts.pie = {
    id: 'pie',
    name: 'Pie / Donut',
    icon: '🥧',
    dataShape: 'rows',

    sampleDatasets: [
      {
        name: 'Traffic sources',
        title: 'Where my views came from',
        data: {
          labels: ['Browse features', 'Suggested videos', 'YouTube search', 'External', 'Shorts feed', 'Other'],
          series: [{ name: 'Views', values: [412000, 358000, 197000, 84000, 52000, 21000] }]
        }
      },
      {
        name: 'Revenue split',
        title: 'How the channel actually earns',
        data: {
          labels: ['AdSense', 'Sponsorships', 'Memberships', 'Merch', 'Affiliate'],
          series: [{ name: 'Revenue', values: [4200, 6800, 1150, 940, 610] }]
        }
      },
      {
        name: 'Device mix',
        title: 'Watch time by device',
        data: {
          labels: ['Mobile', 'TV', 'Desktop', 'Tablet'],
          series: [{ name: 'Watch time (hrs)', values: [61200, 24800, 15400, 3900] }]
        }
      }
    ],

    defaults: { duration: 3, stagger: 0.12 },

    validate: function (data) {
      var errors = [];
      var d = data || {};
      if (!Array.isArray(d.labels) || !d.labels.length) errors.push('Add at least one label.');
      if (!Array.isArray(d.series) || !d.series.length || !Array.isArray(d.series[0].values)) {
        errors.push('Add a series of values (the pie uses the first series).');
      } else {
        var vals = d.series[0].values;
        if (Array.isArray(d.labels) && vals.length !== d.labels.length) {
          errors.push('The first series has ' + vals.length + ' values but there are ' + d.labels.length + ' labels.');
        }
        var pos = 0, bad = 0;
        for (var i = 0; i < vals.length; i++) {
          var v = Number(vals[i]);
          if (vals[i] === '' || vals[i] == null || !isFinite(v)) bad++;
          else if (v > 0) pos++;
        }
        if (bad) errors.push(bad + ' value' + (bad === 1 ? ' is' : 's are') + ' not a number.');
        if (!pos) errors.push('At least one value must be greater than zero.');
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
      var p = prep(state.data);
      var slices = p.slices;
      var total = p.total;
      var n = slices.length;
      var fs = st.font || {};
      var labelSize = fs.labelSize || 24;
      var valueSize = fs.valueSize || 28;
      var textColor = ink(state);
      var softColor = inkSoft(state);
      var donut = st.donut === true;

      if (!n || total <= 0) {
        // Nothing meaningful to draw — a quiet placeholder ring keeps the frame stable.
        var cx0 = area.x + area.w / 2, cy0 = area.y + area.h / 2;
        var r0 = Math.min(area.w, area.h) * 0.32;
        ctx.save();
        ctx.globalAlpha = 0.28;
        ctx.strokeStyle = softColor;
        ctx.lineWidth = Math.max(2, r0 * 0.12);
        ctx.beginPath();
        ctx.arc(cx0, cy0, r0, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = softColor;
        ctx.font = font(state, labelSize, 600);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('No data', cx0, cy0);
        ctx.restore();
        return;
      }

      // Leader-line labels need horizontal breathing room; keep the pie compact.
      var maxR = Math.min(area.w * 0.5, area.h * 0.5);
      var radius = maxR * (n > 1 ? 0.66 : 0.74);
      radius = Math.max(12, radius);
      var cx = area.x + area.w / 2;
      var cy = area.y + area.h / 2;
      var innerR = donut ? radius * 0.6 : 0;

      // Pre-compute geometry so labels can be laid out after every slice is drawn.
      var start = -Math.PI / 2;
      for (var i = 0; i < n; i++) {
        var s = slices[i];
        s.frac = s.value / total;
        s.a0 = start;
        s.sweep = s.frac * TAU;
        s.a1 = start + s.sweep;
        s.mid = start + s.sweep / 2;
        s.p = E.clamp01(E.progress(t, i, n, anim));
        start = s.a1;
      }

      var gapStroke = bgInk(state);
      var strokeW = (n > 1 && radius > 60) ? Math.max(1.5, radius * 0.012) : 0;

      // ---- slices ----
      ctx.save();
      E.applyEffects(ctx, fx);
      for (var j = 0; j < n; j++) {
        var sl = slices[j];
        if (sl.p <= 0 || sl.sweep <= 0) continue;
        var sweep = sl.sweep * sl.p;
        var full = sweep >= TAU - 1e-4;
        ctx.beginPath();
        if (full && innerR <= 0) {
          ctx.arc(cx, cy, radius, 0, TAU);
        } else {
          if (innerR > 0) {
            ctx.arc(cx, cy, radius, sl.a0, sl.a0 + sweep, false);
            ctx.arc(cx, cy, innerR, sl.a0 + sweep, sl.a0, true);
          } else {
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, radius, sl.a0, sl.a0 + sweep, false);
          }
          ctx.closePath();
        }
        ctx.fillStyle = seriesColor(state, j, sl.label);
        ctx.fill();
        if (strokeW && !full) {
          ctx.save();
          ctx.shadowColor = 'transparent';
          ctx.shadowBlur = 0;
          ctx.strokeStyle = gapStroke;
          ctx.lineWidth = strokeW;
          ctx.stroke();
          ctx.restore();
        }
      }
      ctx.restore();

      // ---- donut centre total ----
      if (donut) {
        var overall = E.clamp01(E.progress(t, n - 1, n, anim));
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        var totalSize = Math.min(valueSize * 1.9, innerR * 0.62);
        ctx.fillStyle = textColor;
        ctx.font = font(state, totalSize, 700);
        var totalTxt = E.measureFit(ctx, E.countUp(total, overall), innerR * 1.8);
        ctx.fillText(totalTxt, cx, cy + totalSize * 0.18);
        var capSize = Math.min(labelSize * 0.8, innerR * 0.24);
        ctx.font = font(state, capSize, 500);
        ctx.fillStyle = softColor;
        var seriesName = (state.data && state.data.series && state.data.series[0] && state.data.series[0].name) || 'Total';
        ctx.fillText(E.measureFit(ctx, String(seriesName), innerR * 1.8), cx, cy + totalSize * 0.18 + capSize * 1.5);
        ctx.restore();
      }

      // ---- labels ----
      // Slices that are too thin to hold text get an outside label + leader line.
      var thinCut = 0.42;        // radians below which we go outside
      var hideCut = 0.02;        // radians below which we skip the label entirely
      ctx.save();
      ctx.textBaseline = 'middle';
      var sideRight = [], sideLeft = [];

      for (var k = 0; k < n; k++) {
        var c = slices[k];
        if (c.sweep <= hideCut) continue;
        // Fade the label in over the tail of its own slice sweep.
        var la = E.clamp01((c.p - 0.62) / 0.38);
        if (la <= 0.001) continue;
        var color = seriesColor(state, k, c.label);
        var pct = (c.frac * 100);
        var pctTxt = (pct >= 10 ? Math.round(pct) : Math.round(pct * 10) / 10) + '%';
        var outside = c.sweep < thinCut;

        if (!outside) {
          var lr = innerR > 0 ? (innerR + radius) / 2 : radius * 0.62;
          var lx = cx + Math.cos(c.mid) * lr;
          var ly = cy + Math.sin(c.mid) * lr;
          var chordW = Math.max(40, 2 * lr * Math.sin(Math.min(c.sweep, Math.PI) / 2) * 0.8);
          var fitW = Math.min(chordW, radius * 1.1);
          var inColor = hexLum(color) > 0.62 ? '#14171f' : '#ffffff';
          ctx.globalAlpha = la;
          ctx.textAlign = 'center';
          ctx.fillStyle = inColor;
          ctx.font = font(state, valueSize * 0.92, 700);
          ctx.fillText(pctTxt, lx, ly - labelSize * 0.5);
          ctx.font = font(state, labelSize * 0.82, 500);
          ctx.globalAlpha = la * 0.86;
          ctx.fillText(E.measureFit(ctx, c.label, fitW), lx, ly + labelSize * 0.62);
        } else {
          var right = Math.cos(c.mid) >= 0;
          (right ? sideRight : sideLeft).push({ s: c, alpha: la, color: color, pct: pctTxt });
        }
      }

      // Outside labels, de-overlapped along the vertical axis per side.
      function drawSide(list, right) {
        if (!list.length) return;
        var lineH = labelSize * 1.55;
        list.sort(function (a, b) {
          return Math.sin(a.s.mid) - Math.sin(b.s.mid);
        });
        var ys = list.map(function (o) { return cy + Math.sin(o.s.mid) * radius * 1.12; });
        // push apart downward, then clamp back into the area
        for (var q = 1; q < ys.length; q++) {
          if (ys[q] - ys[q - 1] < lineH) ys[q] = ys[q - 1] + lineH;
        }
        var overflow = ys[ys.length - 1] - (area.y + area.h - lineH * 0.5);
        if (overflow > 0) for (var w = 0; w < ys.length; w++) ys[w] -= overflow;
        for (var u = 0; u < ys.length; u++) {
          if (ys[u] < area.y + lineH * 0.5) ys[u] = area.y + lineH * 0.5;
        }

        var elbowX = right ? cx + radius * 1.24 : cx - radius * 1.24;
        var textX = right ? elbowX + 10 : elbowX - 10;
        var maxTextW = right ? Math.max(30, area.x + area.w - textX - 4) : Math.max(30, textX - area.x - 4);

        for (var m = 0; m < list.length; m++) {
          var o = list[m], sy = ys[m];
          var sx = cx + Math.cos(o.s.mid) * radius * 1.02;
          var syAnchor = cy + Math.sin(o.s.mid) * radius * 1.02;
          ctx.globalAlpha = o.alpha * 0.8;
          ctx.strokeStyle = o.color;
          ctx.lineWidth = Math.max(1, radius * 0.008);
          ctx.beginPath();
          ctx.moveTo(sx, syAnchor);
          ctx.lineTo(elbowX, sy);
          ctx.lineTo(textX + (right ? -4 : 4), sy);
          ctx.stroke();

          ctx.globalAlpha = o.alpha;
          ctx.textAlign = right ? 'left' : 'right';
          ctx.font = font(state, labelSize * 0.8, 600);
          ctx.fillStyle = textColor;
          var txt = E.measureFit(ctx, o.s.label + '  ' + o.pct, maxTextW);
          ctx.fillText(txt, textX, sy);
        }
      }
      drawSide(sideRight, true);
      drawSide(sideLeft, false);
      ctx.restore();
    }
  };
})();
