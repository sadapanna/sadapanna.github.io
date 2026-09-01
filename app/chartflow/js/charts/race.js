/* ChartFlow — Bar chart race
 * Data shape: 'wide'  { items:[names], periods:[labels], values:[ [perPeriod…] per item ] }
 *
 * Main phase t∈[0,1] maps linearly across the periods timeline.
 *   pos = t * (P-1);  k = floor(pos);  f = pos - k
 *   value_i  = lerp(values[i][k], values[i][k+1], f)                    (linear = truthful)
 *   rankPos_i= lerp(rank_k[i],    rank_k+1[i],  easeInOut(f))           (smooth slot slide)
 * Ranks are computed per period (not from the live interpolated values), then the *slot index*
 * is animated — that is what gives the classic "bars slide past each other" race feel instead
 * of bars teleporting the instant two values cross.
 */
(function () {
  'use strict';

  window.ChartFlow = window.ChartFlow || { charts: {} };
  ChartFlow.charts = ChartFlow.charts || {};

  var MAX_BARS = 10;

  /* ---------- tiny local helpers (no state, pure) ---------- */

  function eng() { return ChartFlow.engine; }

  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // negative / missing / NaN → 0 (never crashes, never draws backwards)
  function num(v) {
    if (v === null || v === undefined || v === '') return 0;
    var n = typeof v === 'number' ? v : parseFloat(v);
    if (!isFinite(n)) return 0;
    return n < 0 ? 0 : n;
  }

  function smoothstep(x) { x = clamp01(x); return x * x * (3 - 2 * x); }
  function easeInOut(x) { x = clamp01(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }

  function hexToRgb(hex) {
    if (typeof hex !== 'string') return null;
    var h = hex.trim().replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (h.length !== 6 || /[^0-9a-f]/i.test(h)) return null;
    var v = parseInt(h, 16);
    return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
  }

  function luminance(color) {
    var c = hexToRgb(color);
    if (!c) return 0.15; // assume dark
    return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
  }

  function rgba(color, a) {
    var c = hexToRgb(color);
    if (!c) return 'rgba(255,255,255,' + a + ')';
    return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')';
  }

  // Foreground ink that reads against the state background.
  function inkFor(state) {
    var bg = state.style && state.style.background;
    var base = '#0f1117';
    if (bg) {
      if (bg.type === 'gradient' && bg.gradient && bg.gradient.stops && bg.gradient.stops[0]) {
        base = bg.gradient.stops[0].color;
      } else if (bg.type === 'solid') {
        base = bg.color || base;
      } else {
        base = bg.color || base; // transparent → assume the dark editor ground
      }
    }
    return luminance(base) > 0.55 ? '#12151c' : '#ffffff';
  }

  function colorFor(state, itemIndex, itemName) {
    var st = state.style || {};
    var pal = (st.palette && st.palette.length) ? st.palette : ['#5b8cff'];
    var overrides = st.seriesColors || {};
    if (overrides && Object.prototype.hasOwnProperty.call(overrides, itemName) && overrides[itemName]) {
      return overrides[itemName];
    }
    if (overrides && Object.prototype.hasOwnProperty.call(overrides, itemIndex) && overrides[itemIndex]) {
      return overrides[itemIndex];
    }
    // Stable per ITEM index — never per rank, so a channel keeps its colour as it climbs.
    return pal[itemIndex % pal.length];
  }

  /* ---------- derived data, memoized purely on the data object ---------- */

  var memo = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;

  function prep(data) {
    var items = (data && Array.isArray(data.items)) ? data.items : [];
    var periods = (data && Array.isArray(data.periods)) ? data.periods : [];
    var raw = (data && Array.isArray(data.values)) ? data.values : [];
    var n = items.length, P = periods.length, i, k;

    // cheap signature so in-place edits can't serve a stale cache
    var sig = n * 131071 + P * 8191;
    for (i = 0; i < n; i++) {
      var rr = raw[i];
      if (!rr) continue;
      for (k = 0; k < P; k++) sig += num(rr[k]) * (k + 1);
    }

    if (memo) {
      var hit = memo.get(data);
      if (hit && hit.sig === sig) return hit;
    }

    var vals = [];
    for (i = 0; i < n; i++) {
      var row = Array.isArray(raw[i]) ? raw[i] : [];
      var out = new Array(P);
      for (k = 0; k < P; k++) out[k] = num(row[k]);
      vals.push(out);
    }

    var maxAt = new Array(P);
    var ranks = new Array(P);     // ranks[k][i] = 0-based standing at period k
    var globalMax = 0;
    for (k = 0; k < P; k++) {
      var order = [];
      var mx = 0;
      for (i = 0; i < n; i++) {
        order.push(i);
        if (vals[i][k] > mx) mx = vals[i][k];
      }
      // ties resolved by item index → deterministic, no flicker
      (function (kk) {
        order.sort(function (a, b) {
          var d = vals[b][kk] - vals[a][kk];
          return d !== 0 ? d : a - b;
        });
      })(k);
      var rk = new Array(n);
      for (var s = 0; s < order.length; s++) rk[order[s]] = s;
      ranks[k] = rk;
      maxAt[k] = mx;
      if (mx > globalMax) globalMax = mx;
    }

    var res = {
      sig: sig, items: items, periods: periods, vals: vals,
      ranks: ranks, maxAt: maxAt, n: n, P: P, globalMax: globalMax
    };
    if (memo) memo.set(data, res);
    return res;
  }

  /* ---------- sample datasets ---------- */

  var SAMPLES = [
    {
      name: 'Most-subscribed channels (M)',
      title: 'Most-subscribed YouTube channels',
      data: {
        items: ['MrBeast', 'T-Series', 'PewDiePie', 'Cocomelon', 'SET India', 'Kids Diana Show', 'Like Nastya', 'Zee Music'],
        periods: ['2016', '2017', '2018', '2019', '2020', '2021', '2022', '2023', '2024'],
        values: [
          [0.6, 3.2, 12.0, 28.0, 47.0, 87.0, 112.0, 231.0, 328.0],
          [10.0, 30.0, 72.0, 115.0, 155.0, 195.0, 226.0, 250.0, 271.0],
          [48.0, 57.0, 72.0, 102.0, 107.0, 110.0, 111.0, 111.0, 110.0],
          [0.0, 4.0, 21.0, 63.0, 96.0, 122.0, 148.0, 168.0, 180.0],
          [2.0, 6.0, 17.0, 40.0, 78.0, 122.0, 141.0, 156.0, 174.0],
          [0.3, 2.0, 8.0, 24.0, 55.0, 83.0, 103.0, 113.0, 123.0],
          [0.2, 1.5, 6.0, 30.0, 62.0, 85.0, 100.0, 111.0, 118.0],
          [1.0, 4.0, 12.0, 26.0, 45.0, 68.0, 87.0, 100.0, 110.0]
        ]
      }
    },
    {
      name: 'Programming language popularity',
      title: 'Most-used programming languages',
      data: {
        items: ['Python', 'JavaScript', 'Java', 'C#', 'TypeScript', 'PHP', 'C++', 'Rust', 'Go'],
        periods: ['2016', '2017', '2018', '2019', '2020', '2021', '2022', '2023', '2024'],
        values: [
          [24, 29, 36, 42, 49, 55, 61, 67, 72],
          [55, 58, 62, 66, 68, 69, 68, 66, 65],
          [48, 47, 45, 43, 41, 38, 35, 33, 31],
          [32, 33, 33, 32, 31, 30, 29, 28, 27],
          [3, 6, 12, 18, 25, 31, 36, 41, 45],
          [30, 29, 27, 26, 24, 22, 20, 18, 17],
          [22, 23, 23, 24, 24, 25, 25, 24, 24],
          [1, 2, 3, 5, 6, 8, 10, 13, 16],
          [4, 6, 8, 10, 12, 13, 14, 15, 16]
        ]
      }
    },
    {
      name: 'Social platforms MAU (M)',
      title: 'Social platform monthly active users',
      data: {
        items: ['Facebook', 'YouTube', 'Instagram', 'TikTok', 'X / Twitter', 'Snapchat', 'Reddit'],
        periods: ['2014', '2016', '2018', '2020', '2022', '2024'],
        values: [
          [1350, 1750, 2270, 2740, 2960, 3070],
          [1000, 1300, 1900, 2290, 2510, 2500],
          [300, 500, 1000, 1220, 1450, 2000],
          [0, 55, 500, 1100, 1450, 1580],
          [288, 319, 330, 353, 368, 420],
          [100, 150, 290, 400, 560, 800],
          [130, 250, 330, 430, 500, 730]
        ]
      }
    }
  ];

  /* ---------- module ---------- */

  ChartFlow.charts.race = {
    id: 'race',
    name: 'Bar chart race',
    icon: '🏁',
    dataShape: 'wide',
    sampleDatasets: SAMPLES,
    defaults: { duration: 8, stagger: 0 },

    validate: function (data) {
      var errors = [];
      if (!data || typeof data !== 'object') {
        return { ok: false, errors: ['No data.'] };
      }
      var items = data.items, periods = data.periods, values = data.values;

      if (!Array.isArray(items) || items.length < 2) {
        errors.push('Need at least 2 items (rows).');
      }
      if (!Array.isArray(periods) || periods.length < 2) {
        errors.push('Need at least 2 periods (columns) to animate a race.');
      }
      if (!Array.isArray(values)) {
        errors.push('Values must be an array of rows.');
      }

      if (Array.isArray(items) && Array.isArray(periods) && Array.isArray(values)) {
        if (values.length !== items.length) {
          errors.push('Got ' + values.length + ' value rows for ' + items.length + ' items.');
        }
        for (var i = 0; i < Math.min(values.length, items.length); i++) {
          var name = items[i];
          if (typeof name !== 'string' || !name.trim()) {
            errors.push('Item ' + (i + 1) + ' has no name.');
          }
          var row = values[i];
          if (!Array.isArray(row)) {
            errors.push('Row "' + (name || i + 1) + '" is not a list of numbers.');
            continue;
          }
          if (row.length !== periods.length) {
            errors.push('Row "' + (name || i + 1) + '" has ' + row.length +
              ' values but there are ' + periods.length + ' periods.');
          }
          for (var k = 0; k < row.length; k++) {
            var v = row[k];
            if (v === null || v === undefined || v === '') continue; // blanks allowed → 0
            var nv = typeof v === 'number' ? v : parseFloat(v);
            if (!isFinite(nv)) {
              errors.push('Row "' + (name || i + 1) + '", period ' + (k + 1) + ': "' + v + '" is not a number.');
              break;
            }
          }
        }
        for (var p = 0; p < periods.length; p++) {
          if (periods[p] === null || periods[p] === undefined || String(periods[p]).trim() === '') {
            errors.push('Period ' + (p + 1) + ' has no label.');
            break;
          }
        }
      }

      if (errors.length > 6) errors = errors.slice(0, 6).concat(['…and more.']);
      return errors.length ? { ok: false, errors: errors } : { ok: true };
    },

    drawFrame: function (ctx, state, t) {
      var E = eng();
      if (!E) return;

      var D = prep(state.data);
      var n = D.n, P = D.P;
      if (!n || !P) return;

      var st = state.style || {};
      var fontCfg = st.font || {};
      var fam = fontCfg.family || 'system-ui, -apple-system, sans-serif';
      var effects = st.effects || {};
      var canvas = st.canvas || { w: 1920, h: 1080 };
      var anim = state.anim || {};
      var area = E.chartArea(state);
      if (!area || area.w <= 4 || area.h <= 4) return;

      var ink = inkFor(state);
      var tt = clamp01(t);

      /* --- timeline position --- */
      var pos = (P > 1) ? tt * (P - 1) : 0;
      var k = Math.min(P - 2, Math.floor(pos));
      if (k < 0) k = 0;
      var f = (P > 1) ? clamp01(pos - k) : 0;
      var kNext = Math.min(P - 1, k + 1);
      var slideF = easeInOut(f);           // rank-slot interpolation (the race feel)

      /* --- live values, rank positions, running max --- */
      var N = Math.min(MAX_BARS, n);
      var rowsAll = [];
      var i;
      for (i = 0; i < n; i++) {
        var v = lerp(D.vals[i][k], D.vals[i][kNext], f);
        var rp = lerp(D.ranks[k][i], D.ranks[kNext][i], slideF);
        // visible if inside the top-N band; fades out across the last slot's height
        var vis = clamp01(N - rp);
        if (vis <= 0.001) continue;
        rowsAll.push({ i: i, v: v, rp: rp, vis: vis });
      }
      // bottom-first so higher-ranked bars paint over the ones they overtake
      rowsAll.sort(function (a, b) { return b.rp - a.rp; });

      var maxCur = lerp(D.maxAt[k], D.maxAt[kNext], f);
      if (!(maxCur > 0)) maxCur = 1;

      /* --- geometry --- */
      var labelSize = Math.max(10, fontCfg.labelSize || 24);
      var valueSize = Math.max(10, fontCfg.valueSize || 28);

      var axisH = effects.grid ? Math.round(labelSize * 1.6) : 0;
      var rowsTop = area.y + axisH;
      var rowsH = Math.max(20, area.h - axisH);
      var rowH = rowsH / N;

      labelSize = Math.min(labelSize, rowH * 0.46);
      valueSize = Math.min(valueSize, rowH * 0.5);
      var barH = Math.max(4, rowH * 0.68);
      var pad = Math.max(6, rowH * 0.12);

      // left gutter for names that don't fit inside their bar
      ctx.save();
      ctx.font = '600 ' + labelSize + 'px ' + fam;
      var widestName = 0;
      for (i = 0; i < n; i++) {
        var w = ctx.measureText(String(D.items[i] == null ? '' : D.items[i])).width;
        if (w > widestName) widestName = w;
      }
      var gutter = Math.min(widestName + pad * 2, area.w * 0.26);
      gutter = Math.max(gutter, 0);

      // right gutter for value labels (sized on the largest number in the set)
      ctx.font = '700 ' + valueSize + 'px ' + fam;
      var valGutter = ctx.measureText(E.fmt(D.globalMax)).width + pad * 2;
      valGutter = Math.min(valGutter, area.w * 0.24);
      ctx.restore();

      var barX = area.x + gutter;
      var barMaxW = Math.max(10, area.w - gutter - valGutter);

      /* --- grid / ticks (behind the bars) --- */
      if (effects.grid) {
        var ns = E.niceScale(0, maxCur, 5);
        var ticks = (ns && ns.ticks && ns.ticks.length) ? ns.ticks : [0, maxCur];
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.font = '500 ' + Math.round(labelSize * 0.78) + 'px ' + fam;
        ctx.lineWidth = 1;
        for (var ti = 0; ti < ticks.length; ti++) {
          var tv = ticks[ti];
          if (tv < 0 || tv > maxCur * 1.001) continue;
          var tx = barX + (tv / maxCur) * barMaxW;
          // fade ticks in as the growing scale pulls them off the right edge
          var edge = clamp01((barX + barMaxW - tx) / Math.max(24, barMaxW * 0.06));
          if (edge <= 0.01) continue;
          ctx.globalAlpha = 0.16 * edge;
          ctx.strokeStyle = ink;
          ctx.beginPath();
          ctx.moveTo(Math.round(tx) + 0.5, rowsTop);
          ctx.lineTo(Math.round(tx) + 0.5, rowsTop + rowsH);
          ctx.stroke();
          ctx.globalAlpha = 0.5 * edge;
          ctx.fillStyle = ink;
          ctx.fillText(E.fmt(tv), tx, rowsTop - Math.max(6, labelSize * 0.35));
        }
        ctx.restore();
      }

      /* --- bars --- */
      var stagger = anim.stagger || 0;
      var radiusCfg = (effects.cornerRadius === undefined || effects.cornerRadius === null)
        ? 8 : effects.cornerRadius;

      ctx.save();
      // clip so bars entering / leaving the top N slide past the bottom edge cleanly
      ctx.beginPath();
      ctx.rect(area.x - 2, rowsTop - 2, area.w + 4, rowsH + 4);
      ctx.clip();

      for (var r = 0; r < rowsAll.length; r++) {
        var row = rowsAll[r];
        i = row.i;
        var name = String(D.items[i] == null ? '' : D.items[i]);
        var color = colorFor(state, i, name);

        // optional staggered reveal — only when the user asks for stagger (race default is 0)
        var entry = 1;
        if (stagger > 0) {
          entry = clamp01(E.progress(clamp01(tt / 0.3), D.ranks[0][i], N, anim));
        }

        var alpha = row.vis * entry;
        if (alpha <= 0.004) continue;

        var w2 = Math.max(0, (row.v / maxCur) * barMaxW * entry);
        var cy = rowsTop + (row.rp + 0.5) * rowH;
        var by = cy - barH / 2;

        var rad = Math.max(0, Math.min(radiusCfg, barH / 2, w2 / 2));

        ctx.save();
        ctx.globalAlpha = alpha;
        E.applyEffects(ctx, effects);
        ctx.fillStyle = color;
        if (w2 > 0.5) {
          E.roundRect(ctx, barX, by, w2, barH, rad);
          ctx.fill();
        }
        ctx.restore();

        // ---- item name: inside the bar when it fits, otherwise in the left gutter
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.textBaseline = 'middle';
        ctx.font = '600 ' + labelSize + 'px ' + fam;
        var insideW = w2 - pad * 2;
        var nameW = ctx.measureText(name).width;
        if (insideW > pad * 3 && nameW <= insideW) {
          ctx.textAlign = 'right';
          ctx.fillStyle = luminance(color) > 0.6 ? 'rgba(10,12,18,0.92)' : 'rgba(255,255,255,0.96)';
          ctx.fillText(name, barX + w2 - pad, cy);
        } else if (gutter > pad * 2) {
          ctx.textAlign = 'right';
          ctx.fillStyle = rgba(ink, 0.86);
          ctx.fillText(E.measureFit(ctx, name, gutter - pad * 1.5), barX - pad * 0.75, cy);
        }
        ctx.restore();

        // ---- value at the bar end (live lerped value, formatted — not a separate count-up)
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.textBaseline = 'middle';
        ctx.font = '700 ' + valueSize + 'px ' + fam;
        var vtxt = E.fmt(row.v);
        var vw = ctx.measureText(vtxt).width;
        var vx = barX + w2 + pad * 0.9;
        if (vx + vw > area.x + area.w) {
          // no room outside → tuck it inside the bar
          ctx.textAlign = 'right';
          ctx.fillStyle = luminance(color) > 0.6 ? 'rgba(10,12,18,0.92)' : 'rgba(255,255,255,0.96)';
          ctx.fillText(vtxt, barX + w2 - pad, cy);
        } else {
          ctx.textAlign = 'left';
          ctx.fillStyle = color;
          ctx.fillText(vtxt, vx, cy);
        }
        ctx.restore();
      }
      ctx.restore();

      /* --- period ticker, bottom-right, clear of the watermark corner --- */
      var tickerSize = Math.max(22, Math.min(canvas.h * 0.085, (fontCfg.titleSize || 48) * 1.6));
      var clearance = 60;
      var tx2 = Math.min(area.x + area.w, canvas.w - clearance);
      var ty2 = Math.min(area.y + area.h, canvas.h - clearance) - tickerSize * 0.25;

      // hold the current label, then roll to the next over the tail of the segment
      var g = (P > 1) ? smoothstep((f - 0.7) / 0.3) : 0;
      var curLabel = String(D.periods[k] == null ? '' : D.periods[k]);
      var nextLabel = String(D.periods[kNext] == null ? '' : D.periods[kNext]);

      ctx.save();
      ctx.textAlign = 'right';
      ctx.textBaseline = 'alphabetic';
      ctx.font = '800 ' + Math.round(tickerSize) + 'px ' + fam;
      var maxTickerW = Math.max(60, tx2 - area.x);

      if (g < 0.999) {
        ctx.globalAlpha = 0.9 * (1 - g);
        ctx.fillStyle = ink;
        ctx.fillText(E.measureFit(ctx, curLabel, maxTickerW), tx2, ty2 - g * tickerSize * 0.55);
      }
      if (g > 0.001 && nextLabel !== curLabel) {
        ctx.globalAlpha = 0.9 * g;
        ctx.fillStyle = ink;
        ctx.fillText(E.measureFit(ctx, nextLabel, maxTickerW), tx2, ty2 + (1 - g) * tickerSize * 0.55);
      }
      ctx.restore();
    }
  };
})();
