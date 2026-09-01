/* ============================================================
   ChartFlow — app.js
   The conductor: state, tabs, live preview, all five step
   panels, transport, save/load, export UI, keyboard.
   Vanilla JS, no network. Everything else is consumed via the
   ChartFlow.* contracts (engine/data/charts/exporter/storage).
   ============================================================ */
(function () {
  'use strict';

  window.ChartFlow = window.ChartFlow || { charts: {} };
  var CF = window.ChartFlow;
  var engine = CF.engine;

  /* ============================================================
     Palettes — curated categorical sets, validated (dataviz
     six-checks: chroma floor, adjacent CVD ΔE ≥ 8, normal-vision
     ΔE ≥ 15 in light AND dark). Bright sets intentionally exceed
     the dark lightness band (video-on-dark aesthetic); charts
     always direct-label values, which satisfies the relief rule.
     ============================================================ */
  CF.palettes = [
    { id: 'vivid',   name: 'Vivid',     colors: ['#3987e5', '#e0602e', '#1baf7a', '#c98500', '#d55181', '#9085e9'] },
    { id: 'sunset',  name: 'Sunset',    colors: ['#e39428', '#e14e46', '#a878e8', '#cf3d7f', '#3b55c4'] },
    { id: 'ocean',   name: 'Ocean',     colors: ['#5fd4e3', '#2a5fd0', '#3ecfa5', '#9b8bf4', '#b7e05a', '#3aa7f0'] },
    { id: 'forest',  name: 'Forest',    colors: ['#8fd45f', '#2e9e63', '#e0b23f', '#c07a3a', '#2ec4b6'] },
    { id: 'softpop', name: 'Soft Pop',  colors: ['#f06a9e', '#6d9ce8', '#e6b33c', '#a983e8', '#3fbfa0', '#e8865a'] },
    { id: 'retro',   name: 'Retro',     colors: ['#e2a13b', '#c14a33', '#4a7fc1', '#2f9e7a', '#a05583'] },
    { id: 'neon',    name: 'Neon',      colors: ['#00cfe8', '#ff2ec4', '#9edb2f', '#8b5cf6', '#ffb300', '#ff5e5e'] }
  ];

  function paletteById(id) {
    for (var i = 0; i < CF.palettes.length; i++) {
      if (CF.palettes[i].id === id) return CF.palettes[i];
    }
    return CF.palettes[0];
  }

  /* ============================================================
     Fonts + themes
     ============================================================ */
  var FONTS = [
    { name: 'Poppins',      css: '"Poppins", system-ui, -apple-system, sans-serif' },
    { name: 'Madimi One',   css: '"Madimi One", "Poppins", sans-serif' },
    { name: 'Caveat',       css: '"Caveat", "Comic Sans MS", cursive' },
    { name: 'System sans',  css: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
    { name: 'Serif',        css: 'Georgia, "Times New Roman", serif' },
    { name: 'Monospace',    css: '"Menlo", "Consolas", monospace' }
  ];

  var THEMES = [
    {
      id: 'darkstat', name: 'Dark Stat',
      apply: {
        paletteId: 'vivid',
        background: { type: 'solid', color: '#0f1117' },
        fontFamily: FONTS[0].css,
        effects: { shadow: true, glow: false, cornerRadius: 10, grid: true, noise: false, vignette: false }
      }
    },
    {
      id: 'newsroom', name: 'Newsroom',
      apply: {
        paletteId: 'retro',
        background: { type: 'solid', color: '#f5f2ea' },
        fontFamily: FONTS[4].css,
        effects: { shadow: false, glow: false, cornerRadius: 2, grid: true, noise: false, vignette: false }
      }
    },
    {
      id: 'neon', name: 'Neon',
      apply: {
        paletteId: 'neon',
        background: {
          type: 'gradient',
          gradient: { kind: 'linear', angle: 135, stops: [{ at: 0, color: '#0b0218' }, { at: 1, color: '#1c0736' }] }
        },
        fontFamily: FONTS[0].css,
        effects: { shadow: false, glow: true, cornerRadius: 12, grid: false, noise: false, vignette: true }
      }
    },
    {
      id: 'cleanlight', name: 'Clean Light',
      apply: {
        paletteId: 'softpop',
        background: { type: 'solid', color: '#ffffff' },
        fontFamily: FONTS[3].css,
        effects: { shadow: false, glow: false, cornerRadius: 8, grid: true, noise: false, vignette: false }
      }
    },
    {
      id: 'hand', name: 'Hand-drawn',
      apply: {
        paletteId: 'forest',
        background: { type: 'solid', color: '#fbf3e2' },
        fontFamily: FONTS[2].css,
        effects: { shadow: false, glow: false, cornerRadius: 16, grid: false, noise: true, vignette: false }
      }
    }
  ];

  /* ============================================================
     State
     ============================================================ */
  function defaultState() {
    var pal = paletteById('vivid');
    return {
      version: 1,
      type: 'bar',
      title: 'My chart',
      data: null, // filled from sample below / data.js
      style: {
        paletteId: pal.id,
        palette: pal.colors.slice(),
        seriesColors: {},
        background: {
          type: 'solid',
          color: '#0f1117',
          gradient: { kind: 'linear', angle: 135, stops: [{ at: 0, color: '#141a2e' }, { at: 1, color: '#301b4d' }] }
        },
        font: { family: FONTS[0].css, titleSize: 48, labelSize: 24, valueSize: 28 },
        effects: { shadow: false, glow: false, cornerRadius: 8, grid: true, noise: false, vignette: false },
        donut: false,
        canvas: { w: 1920, h: 1080, preset: '16:9' }
      },
      anim: {
        duration: 3,
        stagger: 0.08,
        hold: 1.5,
        easing: 'easeOutCubic',
        intro: { type: 'fade', duration: 0.5 },
        outro: { type: 'hold' },
        loop: false,
        fps: 30
      }
    };
  }

  function isObj(o) { return o && typeof o === 'object' && !Array.isArray(o); }

  function deepMerge(base, over) {
    if (!isObj(over)) return base;
    var out = Array.isArray(base) ? base.slice() : isObj(base) ? {} : {};
    var k;
    if (isObj(base)) { for (k in base) if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k]; }
    for (k in over) {
      if (!Object.prototype.hasOwnProperty.call(over, k)) continue;
      if (isObj(over[k]) && isObj(out[k])) out[k] = deepMerge(out[k], over[k]);
      else if (Array.isArray(over[k])) out[k] = JSON.parse(JSON.stringify(over[k]));
      else out[k] = over[k];
    }
    return out;
  }

  function normalizeState(raw) {
    var s = deepMerge(defaultState(), raw || {});
    if (!CF.charts[s.type]) s.type = 'bar';
    // keep resolved palette in sync with paletteId unless it's a custom array
    var pal = paletteById(s.style.paletteId);
    if (!Array.isArray(s.style.palette) || !s.style.palette.length) s.style.palette = pal.colors.slice();
    if (!isObj(s.style.seriesColors)) s.style.seriesColors = {};
    return s;
  }

  var state = null;
  var player = null;

  /* ============================================================
     Small DOM helpers
     ============================================================ */
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function field(labelText, control, valueOut) {
    var f = el('div', 'field');
    var lab = el('label', null, labelText);
    if (valueOut) lab.appendChild(valueOut);
    f.appendChild(lab);
    f.appendChild(control);
    return f;
  }

  function range(min, max, step, value) {
    var r = el('input');
    r.type = 'range';
    r.min = min; r.max = max; r.step = step; r.value = value;
    return r;
  }

  function seg(options, activeId, onPick) {
    var wrap = el('div', 'seg');
    options.forEach(function (o) {
      var b = el('button', 'seg-btn' + (o.id === activeId ? ' active' : ''), o.name);
      b.type = 'button';
      b.dataset.id = o.id;
      b.addEventListener('click', function () {
        wrap.querySelectorAll('.seg-btn').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        onPick(o.id);
      });
      wrap.appendChild(b);
    });
    return wrap;
  }
  function segSet(wrap, id) {
    wrap.querySelectorAll('.seg-btn').forEach(function (x) {
      x.classList.toggle('active', x.dataset.id === id);
    });
  }

  function toast(msg) {
    var t = el('div', 'cf-toast', msg);
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2300);
  }

  /* ============================================================
     Modal
     ============================================================ */
  var modal = null, modalTitle = null, modalBody = null, modalFoot = null;

  function openModal(title, build) {
    modalTitle.textContent = title;
    clear(modalBody); clear(modalFoot);
    build(modalBody, modalFoot);
    modal.hidden = false;
    var first = modalBody.querySelector('input, button, select, textarea');
    if (first) setTimeout(function () { first.focus(); }, 30);
  }
  function closeModal() { modal.hidden = true; }

  /* ============================================================
     Autosave + change plumbing
     ============================================================ */
  var autosaveTimer = 0;
  function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(function () {
      CF.storage.autosave(state);
    }, 500);
  }

  var seriesUIDirty = false;

  /** Central "something in state changed" hook. The player redraws
   *  continuously on rAF, so no explicit redraw is needed. */
  function changed(opts) {
    opts = opts || {};
    scheduleAutosave();
    syncStageChrome();
    updateTimeReadout(player ? player.t : 0);
    if (opts.data) {
      seriesUIDirty = true;
      renderDataErrors();
      if (!$('step-style').hidden) buildSeriesOverrides();
    }
    if (opts.resolution) updateResolutionReadout();
  }

  function syncStageChrome() {
    var stage = $('stage');
    var transparent = state.style.background.type === 'transparent';
    stage.classList.toggle('checker', transparent);
    drawSafeOverlay();
  }

  /* ============================================================
     Tabs (free navigation)
     ============================================================ */
  var STEPS = ['type', 'data', 'style', 'animate', 'export'];
  var activeStep = 'type';

  function showStep(id) {
    activeStep = id;
    STEPS.forEach(function (s) {
      var tab = $('tab-' + s), panel = $('step-' + s);
      var on = s === id;
      tab.classList.toggle('active', on);
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      panel.hidden = !on;
    });
    if (id === 'style' && seriesUIDirty) buildSeriesOverrides();
    if (id === 'export') { updateResolutionReadout(); updateFormatNotes(); }
    syncThumbLoops();
  }

  /* ============================================================
     TYPE step — gallery with live animated thumbnails
     ============================================================ */
  var thumbs = [];           // {canvas, ctx, chartId, mini}
  var thumbRaf = 0;
  var thumbLast = 0;
  var THUMB_W = 168, THUMB_H = 94;   // backing px (low res, dpr 1)
  var THUMB_LOGICAL_W = 480, THUMB_LOGICAL_H = 270;
  var THUMB_PERIOD = 1900, THUMB_ANIM = 1500; // ms loop, ms of animation

  function miniStateFor(chartId) {
    var chart = CF.charts[chartId];
    var sample = (chart.sampleDatasets && chart.sampleDatasets[0] && chart.sampleDatasets[0].data) || null;
    return {
      version: 1,
      type: chartId,
      title: '', // no title → intro skipped
      data: sample ? JSON.parse(JSON.stringify(sample)) : null,
      style: {
        paletteId: state.style.paletteId,
        palette: state.style.palette,
        seriesColors: {},
        background: { type: 'solid', color: '#10131c' },
        font: { family: FONTS[0].css, titleSize: 26, labelSize: 15, valueSize: 16 },
        effects: { shadow: false, glow: false, cornerRadius: 4, grid: false, noise: false, vignette: false },
        donut: chartId === 'pie',
        canvas: { w: THUMB_LOGICAL_W, h: THUMB_LOGICAL_H, preset: '16:9' }
      },
      anim: {
        duration: 1.05, stagger: 0.06, hold: 0.45,
        easing: 'easeOutCubic',
        intro: { type: 'none' }, outro: { type: 'hold' },
        loop: true, fps: 30
      }
    };
  }

  function buildTypeGallery() {
    var host = $('type-gallery');
    clear(host);
    thumbs = [];
    Object.keys(CF.charts).forEach(function (id) {
      var chart = CF.charts[id];
      var card = el('button', 'type-card' + (id === state.type ? ' active' : ''));
      card.type = 'button';
      card.dataset.type = id;

      var cnv = el('canvas', 'type-thumb');
      cnv.width = THUMB_W; cnv.height = THUMB_H;
      card.appendChild(cnv);

      var label = el('span', 'type-name');
      label.appendChild(el('span', 'type-icon', chart.icon + ' '));
      label.appendChild(document.createTextNode(chart.name));
      card.appendChild(label);

      card.addEventListener('click', function () { pickType(id); });
      host.appendChild(card);

      thumbs.push({ canvas: cnv, ctx: cnv.getContext('2d'), chartId: id, mini: miniStateFor(id) });
    });
    syncThumbLoops();
  }

  function refreshThumbPalettes() {
    thumbs.forEach(function (th) {
      th.mini.style.paletteId = state.style.paletteId;
      th.mini.style.palette = state.style.palette;
    });
  }

  function thumbFrame(now) {
    thumbRaf = requestAnimationFrame(thumbFrame);
    if (now - thumbLast < 60) return; // ~16fps is plenty for thumbnails
    thumbLast = now;
    var t = Math.min(1, (now % THUMB_PERIOD) / THUMB_ANIM);
    var sx = THUMB_W / THUMB_LOGICAL_W, sy = THUMB_H / THUMB_LOGICAL_H;
    thumbs.forEach(function (th) {
      th.ctx.setTransform(1, 0, 0, 1, 0, 0);
      th.ctx.clearRect(0, 0, THUMB_W, THUMB_H);
      th.ctx.setTransform(sx, 0, 0, sy, 0, 0);
      engine.render(th.ctx, th.mini, t);
      th.ctx.setTransform(1, 0, 0, 1, 0, 0);
    });
  }

  function syncThumbLoops() {
    var shouldRun = activeStep === 'type' && !document.hidden;
    if (shouldRun && !thumbRaf) {
      thumbLast = 0;
      thumbRaf = requestAnimationFrame(thumbFrame);
    } else if (!shouldRun && thumbRaf) {
      cancelAnimationFrame(thumbRaf);
      thumbRaf = 0;
    }
    syncEaseLoops();
  }

  function pickType(id) {
    if (!CF.charts[id]) return;
    state.type = id;
    var defs = CF.charts[id].defaults || {};
    if (defs.duration != null) state.anim.duration = defs.duration;
    if (defs.stagger != null) state.anim.stagger = defs.stagger;
    $('type-gallery').querySelectorAll('.type-card').forEach(function (c) {
      c.classList.toggle('active', c.dataset.type === id);
    });
    var next = CF.data.refresh();  // swaps/preserves data per shape, emits onChange
    state.data = next;
    buildSampleChips();
    buildAnimateControls();        // reflect per-type duration/stagger defaults
    buildStyleDynamic();           // donut toggle visibility + series overrides
    changed({ data: true });
    player.seek(0);
    player.play();
    showStep('data');
  }

  /* ============================================================
     DATA step — data.js mount + sample chips + chart validation
     ============================================================ */
  function buildDataStep() {
    var stepEl = $('step-data');
    var chips = el('div', 'chip-row');
    chips.id = 'sample-chips';
    stepEl.insertBefore(chips, $('data-table'));

    CF.data.mount($('data-table'), {
      getType: function () { return state.type; },
      onChange: function (data) {
        state.data = data;
        changed({ data: true });
      }
    });

    var errs = el('div');
    errs.id = 'data-errors';
    stepEl.appendChild(errs);

    buildSampleChips();
    renderDataErrors();
  }

  function buildSampleChips() {
    var chips = $('sample-chips');
    if (!chips) return;
    clear(chips);
    var chart = CF.charts[state.type];
    var n = CF.data.sampleCount(state.type);
    if (!n) return;
    chips.appendChild(el('span', 'chip-label', 'Samples:'));
    for (var i = 0; i < n; i++) {
      (function (idx) {
        var ds = chart.sampleDatasets[idx];
        var b = el('button', 'chip', ds.name || ('Sample ' + (idx + 1)));
        b.type = 'button';
        b.addEventListener('click', function () {
          var loaded = CF.data.loadSample(state.type, idx);
          state.data = loaded.data;
          if (loaded.title != null) {
            state.title = loaded.title;
            var ti = $('chart-title-input');
            if (ti) ti.value = state.title;
          }
          changed({ data: true });
          player.seek(0);
          player.play();
        });
        chips.appendChild(b);
      })(i);
    }
  }

  function renderDataErrors() {
    var host = $('data-errors');
    if (!host) return;
    clear(host);
    var chart = CF.charts[state.type];
    if (!chart || typeof chart.validate !== 'function') return;
    var v;
    try { v = chart.validate(state.data); } catch (e) { v = { ok: true }; }
    if (v && v.ok === false && v.errors && v.errors.length) {
      var box = el('div', 'err');
      box.textContent = 'Heads up: ' + v.errors.join(' ');
      host.appendChild(box);
    }
  }

  /* ============================================================
     STYLE step
     ============================================================ */
  var styleRefs = {}; // live element references for rebuild-lite updates

  function buildStyleControls() {
    var host = $('style-controls');
    clear(host);
    styleRefs = {};

    /* ---- chart title ---- */
    var title = el('input');
    title.type = 'text';
    title.id = 'chart-title-input';
    title.value = state.title;
    title.placeholder = 'Leave empty for no title';
    title.setAttribute('autocomplete', 'off');
    title.addEventListener('input', function () {
      state.title = title.value;
      changed();
    });
    host.appendChild(field('Chart title', title));

    /* ---- theme presets ---- */
    host.appendChild(el('h3', null, 'Theme presets'));
    var themeRow = el('div', 'theme-row');
    THEMES.forEach(function (th) {
      var b = el('button', 'chip theme-chip', th.name);
      b.type = 'button';
      b.addEventListener('click', function () { applyTheme(th); });
      themeRow.appendChild(b);
    });
    host.appendChild(themeRow);

    /* ---- palette ---- */
    host.appendChild(el('h3', null, 'Palette'));
    var palGrid = el('div', 'palette-grid');
    palGrid.id = 'palette-grid';
    CF.palettes.forEach(function (p) {
      var card = el('button', 'palette-card' + (p.id === state.style.paletteId ? ' active' : ''));
      card.type = 'button';
      card.dataset.pal = p.id;
      var sw = el('div', 'palette-swatches');
      p.colors.forEach(function (c) {
        var i = el('i');
        i.style.background = c;
        sw.appendChild(i);
      });
      card.appendChild(sw);
      card.appendChild(el('span', 'palette-name', p.name));
      card.addEventListener('click', function () { pickPalette(p.id); });
      palGrid.appendChild(card);
    });
    host.appendChild(palGrid);

    /* ---- per-series overrides ---- */
    host.appendChild(el('h3', null, 'Series colors'));
    var so = el('div', 'series-overrides');
    so.id = 'series-overrides';
    host.appendChild(so);

    /* ---- background ---- */
    host.appendChild(el('h3', null, 'Background'));
    var bgSeg = seg(
      [{ id: 'solid', name: 'Solid' }, { id: 'gradient', name: 'Gradient' }, { id: 'transparent', name: 'Transparent' }],
      state.style.background.type,
      function (id) {
        state.style.background.type = id;
        syncBgEditors();
        changed();
      }
    );
    styleRefs.bgSeg = bgSeg;
    host.appendChild(bgSeg);

    var bgSolid = el('div', 'bg-editor');
    bgSolid.id = 'bg-solid';
    var solidColor = el('input');
    solidColor.type = 'color';
    solidColor.value = safeHex(state.style.background.color, '#0f1117');
    solidColor.addEventListener('input', function () {
      state.style.background.color = solidColor.value;
      changed();
    });
    bgSolid.appendChild(field('Color', solidColor));
    host.appendChild(bgSolid);

    var bgGrad = el('div', 'bg-editor');
    bgGrad.id = 'bg-gradient';
    buildGradientEditor(bgGrad);
    host.appendChild(bgGrad);

    var bgTrans = el('div', 'bg-editor');
    bgTrans.id = 'bg-transparent';
    bgTrans.appendChild(el('p', 'hint',
      'Transparent background — export as WebM or PNG to keep the alpha channel, then drop it over your footage. MP4 and GIF fill it with a solid dark ground.'));
    host.appendChild(bgTrans);

    /* ---- font ---- */
    host.appendChild(el('h3', null, 'Text'));
    var fsel = el('select');
    fsel.id = 'font-select';
    FONTS.forEach(function (f) {
      var o = el('option', null, f.name);
      o.value = f.css;
      fsel.appendChild(o);
    });
    fsel.value = state.style.font.family;
    if (fsel.selectedIndex < 0) fsel.selectedIndex = 0;
    fsel.addEventListener('change', function () {
      state.style.font.family = fsel.value;
      changed();
    });
    host.appendChild(field('Font', fsel));

    host.appendChild(sizeSlider('Title size', 'titleSize', 20, 120));
    host.appendChild(sizeSlider('Label size', 'labelSize', 10, 60));
    host.appendChild(sizeSlider('Value size', 'valueSize', 10, 72));

    /* ---- effects ---- */
    host.appendChild(el('h3', null, 'Effects'));
    var fxRow = el('div', 'fx-grid');
    fxRow.appendChild(fxToggle('Shadow', 'shadow'));
    fxRow.appendChild(fxToggle('Glow', 'glow'));
    fxRow.appendChild(fxToggle('Grid lines', 'grid'));
    fxRow.appendChild(fxToggle('Noise', 'noise'));
    fxRow.appendChild(fxToggle('Vignette', 'vignette'));
    host.appendChild(fxRow);

    var crOut = el('output', null, String(state.style.effects.cornerRadius) + 'px');
    var cr = range(0, 40, 1, state.style.effects.cornerRadius);
    cr.addEventListener('input', function () {
      state.style.effects.cornerRadius = +cr.value;
      crOut.textContent = cr.value + 'px';
      changed();
    });
    host.appendChild(field('Corner radius', cr, crOut));

    var donutWrap = el('div', 'field');
    donutWrap.id = 'donut-field';
    var donutLab = el('label', 'inline');
    var donutChk = el('input');
    donutChk.type = 'checkbox';
    donutChk.checked = !!state.style.donut;
    donutChk.addEventListener('change', function () {
      state.style.donut = donutChk.checked;
      changed();
    });
    donutLab.appendChild(donutChk);
    donutLab.appendChild(document.createTextNode(' Donut style (with centre total)'));
    donutWrap.appendChild(donutLab);
    host.appendChild(donutWrap);
    styleRefs.donutField = donutWrap;

    /* ---- canvas ---- */
    host.appendChild(el('h3', null, 'Canvas'));
    var PRESETS = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080] };
    var canvasSeg = seg(
      [{ id: '16:9', name: '16:9' }, { id: '9:16', name: '9:16' }, { id: '1:1', name: '1:1' }, { id: 'custom', name: 'Custom' }],
      state.style.canvas.preset,
      function (id) {
        state.style.canvas.preset = id;
        if (PRESETS[id]) {
          state.style.canvas.w = PRESETS[id][0];
          state.style.canvas.h = PRESETS[id][1];
          wIn.value = state.style.canvas.w;
          hIn.value = state.style.canvas.h;
        }
        customRow.hidden = id !== 'custom';
        changed({ resolution: true });
      }
    );
    host.appendChild(canvasSeg);

    var customRow = el('div', 'row2 canvas-custom');
    var wIn = el('input'); wIn.type = 'number'; wIn.min = 320; wIn.max = 4096; wIn.value = state.style.canvas.w;
    var hIn = el('input'); hIn.type = 'number'; hIn.min = 320; hIn.max = 4096; hIn.value = state.style.canvas.h;
    function applyCustom() {
      var w = Math.max(320, Math.min(4096, Math.round(+wIn.value || 1920)));
      var h = Math.max(320, Math.min(4096, Math.round(+hIn.value || 1080)));
      state.style.canvas.w = w;
      state.style.canvas.h = h;
      changed({ resolution: true });
    }
    wIn.addEventListener('change', applyCustom);
    hIn.addEventListener('change', applyCustom);
    customRow.appendChild(field('Width px', wIn));
    customRow.appendChild(field('Height px', hIn));
    customRow.hidden = state.style.canvas.preset !== 'custom';
    host.appendChild(customRow);

    var safeLab = el('label', 'inline');
    var safeChk = el('input');
    safeChk.type = 'checkbox';
    safeChk.id = 'chk-safe';
    safeChk.checked = safeGuidesOn;
    safeChk.addEventListener('change', function () {
      safeGuidesOn = safeChk.checked;
      drawSafeOverlay();
    });
    safeLab.appendChild(safeChk);
    safeLab.appendChild(document.createTextNode(' Safe-area guides (preview only, never exported)'));
    var safeField = el('div', 'field');
    safeField.appendChild(safeLab);
    host.appendChild(safeField);

    buildStyleDynamic();
    syncBgEditors();
  }

  function sizeSlider(labelText, key, min, max) {
    var out = el('output', null, String(state.style.font[key]) + 'px');
    var r = range(min, max, 1, state.style.font[key]);
    r.addEventListener('input', function () {
      state.style.font[key] = +r.value;
      out.textContent = r.value + 'px';
      changed();
    });
    return field(labelText, r, out);
  }

  function fxToggle(labelText, key) {
    var lab = el('label', 'inline fx-toggle');
    var c = el('input');
    c.type = 'checkbox';
    c.checked = !!state.style.effects[key];
    c.addEventListener('change', function () {
      state.style.effects[key] = c.checked;
      changed();
    });
    lab.appendChild(c);
    lab.appendChild(document.createTextNode(' ' + labelText));
    return lab;
  }

  function safeHex(c, fallback) {
    return (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)) ? c : fallback;
  }

  function syncBgEditors() {
    var t = state.style.background.type;
    $('bg-solid').hidden = t !== 'solid';
    $('bg-gradient').hidden = t !== 'gradient';
    $('bg-transparent').hidden = t !== 'transparent';
  }

  function buildGradientEditor(hostEl) {
    clear(hostEl);
    var g = state.style.background.gradient;
    if (!g || !Array.isArray(g.stops) || g.stops.length < 2) {
      g = state.style.background.gradient = {
        kind: 'linear', angle: 135,
        stops: [{ at: 0, color: '#141a2e' }, { at: 1, color: '#301b4d' }]
      };
    }

    var kindSeg = seg(
      [{ id: 'linear', name: 'Linear' }, { id: 'radial', name: 'Radial' }],
      g.kind || 'linear',
      function (id) {
        g.kind = id;
        angleField.hidden = id !== 'linear';
        changed();
      }
    );
    hostEl.appendChild(kindSeg);

    var angOut = el('output', null, (g.angle || 0) + '°');
    var ang = range(0, 360, 5, g.angle || 0);
    ang.addEventListener('input', function () {
      g.angle = +ang.value;
      angOut.textContent = ang.value + '°';
      changed();
    });
    var angleField = field('Angle', ang, angOut);
    angleField.hidden = (g.kind || 'linear') !== 'linear';
    hostEl.appendChild(angleField);

    var stopsBox = el('div', 'stops-box');
    function rebuildStops() {
      clear(stopsBox);
      g.stops.forEach(function (st, i) {
        var row = el('div', 'stop-row');
        var col = el('input');
        col.type = 'color';
        col.value = safeHex(st.color, '#888888');
        col.addEventListener('input', function () { st.color = col.value; changed(); });
        row.appendChild(col);

        var at = range(0, 100, 1, Math.round((+st.at || 0) * 100));
        at.addEventListener('input', function () { st.at = (+at.value) / 100; changed(); });
        row.appendChild(at);

        if (g.stops.length > 2) {
          var del = el('button', 'btn icon ghost small', '×');
          del.type = 'button';
          del.title = 'Remove stop';
          del.addEventListener('click', function () {
            g.stops.splice(i, 1);
            rebuildStops();
            changed();
          });
          row.appendChild(del);
        }
        stopsBox.appendChild(row);
      });
      if (g.stops.length < 4) {
        var add = el('button', 'btn ghost small', '+ Stop');
        add.type = 'button';
        add.addEventListener('click', function () {
          var last = g.stops[g.stops.length - 1];
          g.stops.push({ at: Math.min(1, (+last.at || 0.5) + 0.2), color: last.color || '#888888' });
          rebuildStops();
          changed();
        });
        stopsBox.appendChild(add);
      }
    }
    rebuildStops();
    hostEl.appendChild(field('Color stops', stopsBox));
  }

  function pickPalette(id) {
    var p = paletteById(id);
    state.style.paletteId = p.id;
    state.style.palette = p.colors.slice();
    state.style.seriesColors = {}; // overrides belong to the old palette
    var grid = $('palette-grid');
    if (grid) {
      grid.querySelectorAll('.palette-card').forEach(function (c) {
        c.classList.toggle('active', c.dataset.pal === id);
      });
    }
    refreshThumbPalettes();
    buildSeriesOverrides();
    changed();
  }

  function applyTheme(theme) {
    var a = theme.apply;
    var p = paletteById(a.paletteId);
    state.style.paletteId = p.id;
    state.style.palette = p.colors.slice();
    state.style.seriesColors = {};
    state.style.background = deepMerge(state.style.background, JSON.parse(JSON.stringify(a.background)));
    state.style.background.type = a.background.type; // deepMerge keeps, but be explicit
    state.style.font.family = a.fontFamily;
    state.style.effects = deepMerge(state.style.effects, a.effects);
    refreshThumbPalettes();
    buildStyleControls(); // reflect everything at once
    changed();
    toast('Theme “' + theme.name + '” applied');
  }

  /** Names of the colorable series/items for the current data. */
  function seriesNames() {
    var d = state.data || {};
    var shape = CF.data.shapeOf(state.type);
    if (shape === 'single') return [(d.label || 'Value')];
    if (shape === 'wide') return (d.items || []).slice(0, 12);
    if (state.type === 'pie') return (d.labels || []).slice(0, 12);
    return (d.series || []).map(function (s, i) { return s.name || ('Series ' + (i + 1)); }).slice(0, 12);
  }

  function buildSeriesOverrides() {
    seriesUIDirty = false;
    var host = $('series-overrides');
    if (!host) return;
    clear(host);
    var names = seriesNames();
    var pal = state.style.palette;
    names.forEach(function (name, i) {
      var row = el('div', 'series-row');
      var col = el('input');
      col.type = 'color';
      col.className = 'series-color';
      var override = state.style.seriesColors[i] || state.style.seriesColors[String(i)];
      col.value = safeHex(override || pal[i % pal.length], '#888888');
      col.addEventListener('input', function () {
        state.style.seriesColors[i] = col.value;
        reset.hidden = false;
        changed();
      });
      row.appendChild(col);
      row.appendChild(el('span', 'series-name', name));
      var reset = el('button', 'btn ghost small', 'reset');
      reset.type = 'button';
      reset.hidden = override == null;
      reset.addEventListener('click', function () {
        delete state.style.seriesColors[i];
        delete state.style.seriesColors[String(i)];
        col.value = safeHex(pal[i % pal.length], '#888888');
        reset.hidden = true;
        changed();
      });
      row.appendChild(reset);
      host.appendChild(row);
    });
  }

  /** Per-type dynamic bits of the style panel (donut visibility, series list). */
  function buildStyleDynamic() {
    if (styleRefs.donutField) styleRefs.donutField.hidden = state.type !== 'pie';
    buildSeriesOverrides();
  }

  /* ============================================================
     Safe-area guides — overlay on the PREVIEW only
     ============================================================ */
  var safeGuidesOn = false;
  var safeCanvas = null;

  function drawSafeOverlay() {
    if (!safeCanvas) return;
    var preview = $('preview');
    var stage = $('stage');
    if (!safeGuidesOn) {
      safeCanvas.hidden = true;
      return;
    }
    safeCanvas.hidden = false;
    var pr = preview.getBoundingClientRect();
    var sr = stage.getBoundingClientRect();
    var w = Math.max(1, Math.round(pr.width));
    var h = Math.max(1, Math.round(pr.height));
    safeCanvas.style.left = Math.round(pr.left - sr.left) + 'px';
    safeCanvas.style.top = Math.round(pr.top - sr.top) + 'px';
    safeCanvas.style.width = w + 'px';
    safeCanvas.style.height = h + 'px';
    if (safeCanvas.width !== w || safeCanvas.height !== h) {
      safeCanvas.width = w;
      safeCanvas.height = h;
    }
    var c = safeCanvas.getContext('2d');
    c.clearRect(0, 0, w, h);
    function rect(inset, color) {
      c.strokeStyle = color;
      c.lineWidth = 1;
      c.setLineDash([6, 5]);
      c.strokeRect(w * inset, h * inset, w * (1 - inset * 2), h * (1 - inset * 2));
    }
    rect(0.05, 'rgba(53,211,154,.75)');  // action-safe 90%
    rect(0.10, 'rgba(255,199,54,.75)');  // title-safe 80%
    c.setLineDash([]);
    c.strokeStyle = 'rgba(255,255,255,.28)';
    c.beginPath();
    c.moveTo(w / 2, h / 2 - 9); c.lineTo(w / 2, h / 2 + 9);
    c.moveTo(w / 2 - 9, h / 2); c.lineTo(w / 2 + 9, h / 2);
    c.stroke();
  }

  /* ============================================================
     ANIMATE step
     ============================================================ */
  var EASE_PRESETS = ['linear', 'easeOutCubic', 'easeInOutCubic', 'easeOutBack', 'easeOutBounce', 'easeOutElastic'];
  var EASE_LABELS = {
    linear: 'Linear', easeOutCubic: 'Smooth', easeInOutCubic: 'Ease both',
    easeOutBack: 'Overshoot', easeOutBounce: 'Bounce', easeOutElastic: 'Elastic'
  };
  var easeCards = [];   // {canvas, ctx, fn, key}
  var easeRaf = 0;
  var easeLast = 0;
  var bezierRef = null; // {canvas, redraw}

  function buildAnimateControls() {
    var host = $('animate-controls');
    clear(host);
    easeCards = [];
    bezierRef = null;

    host.appendChild(animSlider('Duration', 'duration', 0.5, 15, 0.1, 's'));
    host.appendChild(animSlider('Stagger', 'stagger', 0, 1, 0.01, 's'));
    host.appendChild(animSlider('Hold at end', 'hold', 0, 6, 0.1, 's'));

    /* ---- easing gallery ---- */
    host.appendChild(el('h3', null, 'Easing'));
    var grid = el('div', 'ease-grid');
    grid.id = 'ease-grid';
    EASE_PRESETS.forEach(function (key) {
      var card = el('button', 'ease-card' + (state.anim.easing === key ? ' active' : ''));
      card.type = 'button';
      card.dataset.ease = key;
      var cnv = el('canvas', 'ease-canvas');
      cnv.width = 96; cnv.height = 64;
      card.appendChild(cnv);
      card.appendChild(el('span', 'ease-name', EASE_LABELS[key] || key));
      card.addEventListener('click', function () {
        state.anim.easing = key;
        markEaseActive();
        changed();
      });
      grid.appendChild(card);
      easeCards.push({ canvas: cnv, ctx: cnv.getContext('2d'), fn: engine.ease[key], key: key });
    });
    host.appendChild(grid);

    /* ---- custom bezier ---- */
    var det = el('details', 'adv');
    if (state.anim.easing && state.anim.easing.bezier) det.open = true;
    det.appendChild(el('summary', null, 'Custom curve (cubic-bezier)'));
    var bwrap = el('div', 'bezier-wrap');
    var bcnv = el('canvas', 'bezier-canvas');
    bcnv.width = 260; bcnv.height = 200;
    bwrap.appendChild(bcnv);
    var bOut = el('div', 'bezier-readout');
    bOut.id = 'bezier-readout';
    bwrap.appendChild(bOut);
    var bUse = el('button', 'btn small', 'Use this curve');
    bUse.type = 'button';
    bwrap.appendChild(bUse);
    det.appendChild(bwrap);
    host.appendChild(det);
    setupBezierEditor(bcnv, bOut, bUse);

    /* ---- intro / outro ---- */
    host.appendChild(el('h3', null, 'Intro (title)'));
    var it = state.anim.intro || { type: 'fade', duration: 0.5 };
    state.anim.intro = it;
    host.appendChild(seg(
      [{ id: 'none', name: 'None' }, { id: 'fade', name: 'Fade' }, { id: 'slide', name: 'Slide' }],
      it.type || 'fade',
      function (id) { it.type = id; introDur.parentElement.hidden = id === 'none'; changed(); }
    ));
    var idOut = el('output', null, (it.duration == null ? 0.5 : it.duration) + 's');
    var introDur = range(0.1, 2, 0.1, it.duration == null ? 0.5 : it.duration);
    introDur.addEventListener('input', function () {
      it.duration = +introDur.value;
      idOut.textContent = introDur.value + 's';
      changed();
    });
    var introField = field('Intro duration', introDur, idOut);
    introField.hidden = (it.type || 'fade') === 'none';
    host.appendChild(introField);
    host.appendChild(el('p', 'hint', 'The intro animates the chart title in. With an empty title it is skipped automatically.'));

    host.appendChild(el('h3', null, 'Outro'));
    var ot = state.anim.outro || { type: 'hold' };
    state.anim.outro = ot;
    host.appendChild(seg(
      [{ id: 'hold', name: 'Hold last frame' }, { id: 'fade', name: 'Fade out' }],
      ot.type || 'hold',
      function (id) { ot.type = id; changed(); }
    ));

    var loopLab = el('label', 'inline');
    var loopChk = el('input');
    loopChk.type = 'checkbox';
    loopChk.id = 'anim-loop';
    loopChk.checked = !!state.anim.loop;
    loopChk.addEventListener('change', function () {
      state.anim.loop = loopChk.checked;
      $('chk-loop').checked = loopChk.checked;
      changed();
    });
    loopLab.appendChild(loopChk);
    loopLab.appendChild(document.createTextNode(' Loop the preview'));
    var loopField = el('div', 'field');
    loopField.appendChild(loopLab);
    host.appendChild(loopField);

    syncEaseLoops();
  }

  function animSlider(labelText, key, min, max, step, unit) {
    var out = el('output', null, (+state.anim[key]).toFixed(2).replace(/\.?0+$/, '') + unit);
    var r = range(min, max, step, state.anim[key]);
    r.addEventListener('input', function () {
      state.anim[key] = +r.value;
      out.textContent = (+r.value).toFixed(2).replace(/\.?0+$/, '') + unit;
      changed();
    });
    return field(labelText, r, out);
  }

  function markEaseActive() {
    var isCustom = !!(state.anim.easing && state.anim.easing.bezier);
    var grid = $('ease-grid');
    if (grid) {
      grid.querySelectorAll('.ease-card').forEach(function (c) {
        c.classList.toggle('active', !isCustom && c.dataset.ease === state.anim.easing);
      });
    }
  }

  /* small animated curve previews (shared rAF, active only on Animate tab) */
  function easeFrame(now) {
    easeRaf = requestAnimationFrame(easeFrame);
    if (now - easeLast < 50) return;
    easeLast = now;
    var tp = Math.min(1, (now % 1700) / 1300);
    easeCards.forEach(function (card) { drawEaseCurve(card.ctx, card.canvas, card.fn, tp); });
    if (bezierRef) bezierRef.redraw(tp);
  }

  function syncEaseLoops() {
    var shouldRun = activeStep === 'animate' && !document.hidden;
    if (shouldRun && !easeRaf) {
      easeLast = 0;
      easeRaf = requestAnimationFrame(easeFrame);
    } else if (!shouldRun && easeRaf) {
      cancelAnimationFrame(easeRaf);
      easeRaf = 0;
    }
  }

  function drawEaseCurve(ctx, cnv, fn, tp) {
    var w = cnv.width, h = cnv.height;
    var padX = 10, padTop = 14, padBot = 12;
    var iw = w - padX * 2, ih = h - padTop - padBot;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,.14)';
    ctx.lineWidth = 1;
    ctx.strokeRect(padX, padTop, iw, ih);
    ctx.strokeStyle = '#9aa2ba';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (var i = 0; i <= 40; i++) {
      var x = i / 40;
      var y = fn(x);
      var px = padX + x * iw;
      var py = padTop + ih - y * ih;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    // travelling dot
    var dx = padX + tp * iw;
    var dy = padTop + ih - fn(tp) * ih;
    ctx.fillStyle = '#7c5cff';
    ctx.beginPath();
    ctx.arc(dx, dy, 3.6, 0, Math.PI * 2);
    ctx.fill();
  }

  function setupBezierEditor(cnv, outEl, useBtn) {
    var pts = (state.anim.easing && state.anim.easing.bezier) ?
      state.anim.easing.bezier.slice() : [0.33, 0.0, 0.2, 1.0];
    var ctx = cnv.getContext('2d');
    var PAD = 24;
    var iw = cnv.width - PAD * 2;
    var ih = cnv.height - PAD * 2;
    var dragging = -1;

    function toPx(x, y) { return [PAD + x * iw, PAD + ih - y * ih]; }
    function fromPx(px, py) {
      return [
        Math.min(1, Math.max(0, (px - PAD) / iw)),
        Math.min(1.6, Math.max(-0.6, (PAD + ih - py) / ih))
      ];
    }

    function fmtPts() {
      return pts.map(function (v) { return Math.round(v * 100) / 100; });
    }

    function redraw(tp) {
      var w = cnv.width, h = cnv.height;
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,.14)';
      ctx.lineWidth = 1;
      ctx.strokeRect(PAD, PAD, iw, ih);
      var fn = engine.ease.cubicBezier(pts[0], pts[1], pts[2], pts[3]);
      // control lines
      var p0 = toPx(0, 0), p3 = toPx(1, 1);
      var p1 = toPx(pts[0], pts[1]), p2 = toPx(pts[2], pts[3]);
      ctx.strokeStyle = 'rgba(124,92,255,.45)';
      ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(p3[0], p3[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke();
      // curve
      ctx.strokeStyle = '#eef0f7';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (var i = 0; i <= 60; i++) {
        var x = i / 60, y = fn(x);
        var px = PAD + x * iw, py = PAD + ih - y * ih;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
      // handles
      [p1, p2].forEach(function (p, i) {
        ctx.fillStyle = i === dragging ? '#ffc736' : '#7c5cff';
        ctx.beginPath(); ctx.arc(p[0], p[1], 7, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(p[0], p[1], 7, 0, Math.PI * 2); ctx.stroke();
      });
      // travelling dot
      if (tp != null) {
        var dx = PAD + tp * iw, dy = PAD + ih - fn(tp) * ih;
        ctx.fillStyle = '#35d39a';
        ctx.beginPath(); ctx.arc(dx, dy, 4, 0, Math.PI * 2); ctx.fill();
      }
      outEl.textContent = 'cubic-bezier(' + fmtPts().join(', ') + ')';
    }

    function ptAt(e) {
      var r = cnv.getBoundingClientRect();
      var px = (e.clientX - r.left) * (cnv.width / r.width);
      var py = (e.clientY - r.top) * (cnv.height / r.height);
      return [px, py];
    }

    cnv.addEventListener('pointerdown', function (e) {
      var p = ptAt(e);
      var h1 = toPx(pts[0], pts[1]), h2 = toPx(pts[2], pts[3]);
      var d1 = Math.hypot(p[0] - h1[0], p[1] - h1[1]);
      var d2 = Math.hypot(p[0] - h2[0], p[1] - h2[1]);
      dragging = (d1 <= d2 && d1 < 26) ? 0 : (d2 < 26 ? 1 : -1);
      if (dragging >= 0) cnv.setPointerCapture(e.pointerId);
    });
    cnv.addEventListener('pointermove', function (e) {
      if (dragging < 0) return;
      var p = ptAt(e);
      var xy = fromPx(p[0], p[1]);
      pts[dragging * 2] = xy[0];
      pts[dragging * 2 + 1] = xy[1];
      if (state.anim.easing && state.anim.easing.bezier) {
        state.anim.easing = { bezier: fmtPts() };
        changed();
      }
      redraw(null);
    });
    function endDrag() { dragging = -1; redraw(null); }
    cnv.addEventListener('pointerup', endDrag);
    cnv.addEventListener('pointercancel', endDrag);

    useBtn.addEventListener('click', function () {
      state.anim.easing = { bezier: fmtPts() };
      markEaseActive();
      changed();
      toast('Custom easing curve applied');
    });

    bezierRef = { canvas: cnv, redraw: redraw };
    redraw(null);
  }

  /* ============================================================
     EXPORT step
     ============================================================ */
  var FORMATS = [
    { id: 'mp4',  name: 'MP4',  sub: 'Video · best for editors' },
    { id: 'webm', name: 'WebM', sub: 'Video · keeps transparency' },
    { id: 'gif',  name: 'GIF',  sub: 'Loops anywhere' },
    { id: 'png',  name: 'PNG',  sub: 'Current frame · keeps alpha' }
  ];
  var exportFormat = 'mp4';
  var exporting = false;
  var exportRefs = {};

  function buildExportControls() {
    var host = $('export-controls');
    clear(host);
    exportRefs = {};

    var grid = el('div', 'fmt-grid');
    FORMATS.forEach(function (f) {
      var card = el('button', 'fmt-card' + (f.id === exportFormat ? ' active' : ''));
      card.type = 'button';
      card.dataset.fmt = f.id;
      card.appendChild(el('span', 'fmt-name', f.name));
      card.appendChild(el('span', 'fmt-sub', f.sub));
      card.addEventListener('click', function () {
        exportFormat = f.id;
        grid.querySelectorAll('.fmt-card').forEach(function (c) {
          c.classList.toggle('active', c.dataset.fmt === f.id);
        });
        updateFormatNotes();
      });
      grid.appendChild(card);
    });
    host.appendChild(grid);

    var fpsField = el('div', 'field');
    var fpsLab = el('label', null, 'Frame rate');
    fpsField.appendChild(fpsLab);
    var fpsSeg = seg(
      [{ id: '30', name: '30 fps' }, { id: '60', name: '60 fps' }],
      String(state.anim.fps === 60 ? 60 : 30),
      function (id) {
        state.anim.fps = +id;
        changed();
      }
    );
    fpsField.appendChild(fpsSeg);
    exportRefs.fpsSeg = fpsSeg;
    host.appendChild(fpsField);

    var res = el('p', 'hint');
    res.id = 'resolution-readout';
    host.appendChild(res);

    var note = el('p', 'hint');
    note.id = 'format-note';
    host.appendChild(note);

    var gifHalfLab = el('label', 'inline');
    var gifHalf = el('input');
    gifHalf.type = 'checkbox';
    gifHalf.checked = true;
    gifHalfLab.appendChild(gifHalf);
    gifHalfLab.appendChild(document.createTextNode(' Export GIF at half size (recommended)'));
    var gifField = el('div', 'field');
    gifField.id = 'gif-half-field';
    gifField.appendChild(gifHalfLab);
    host.appendChild(gifField);
    exportRefs.gifHalf = gifHalf;
    exportRefs.gifField = gifField;

    var btn = el('button', 'btn primary export-btn', 'Export');
    btn.type = 'button';
    btn.id = 'btn-export';
    host.appendChild(btn);

    var prog = el('div', 'progress');
    prog.id = 'export-progress';
    var bar = el('div', 'progress-bar');
    prog.appendChild(bar);
    host.appendChild(prog);
    var status = el('p', 'export-status');
    status.id = 'export-status';
    host.appendChild(status);
    exportRefs.btn = btn; exportRefs.prog = prog; exportRefs.bar = bar; exportRefs.status = status;

    host.appendChild(el('p', 'hint',
      'Every export carries a small “Made with sadapanna.com/chartflow” watermark, rendered exactly as you see it in the preview. Everything is encoded in your browser — nothing is uploaded.'));

    btn.addEventListener('click', runExport);
    updateResolutionReadout();
    updateFormatNotes();
  }

  function updateResolutionReadout() {
    var r = $('resolution-readout');
    if (!r) return;
    var c = state.style.canvas;
    var total = engine.totalDuration(state);
    r.textContent = 'Output: ' + c.w + '×' + c.h + ' (' + (c.preset || 'custom') + ') · ' +
      total.toFixed(1) + 's at ' + (state.anim.fps === 60 ? 60 : 30) + ' fps';
  }

  function updateFormatNotes() {
    var n = $('format-note');
    if (!n) return;
    var transparent = state.style.background.type === 'transparent';
    var big = state.style.canvas.w * state.style.canvas.h > 1280 * 720;
    var msg = '';
    if (exportFormat === 'mp4') {
      msg = 'MP4 (H.264) drops into any editor. ' +
        (transparent ? 'Transparency is not supported in MP4 — the background will be filled with solid dark.' : 'No transparency support.');
    } else if (exportFormat === 'webm') {
      msg = 'WebM records in real time — the export takes as long as the animation. ' +
        (transparent ? 'Your transparent background is kept (alpha WebM, plays in Chrome and Premiere/Resolve via plugins).' : 'Keeps transparency when the background is set to transparent.');
    } else if (exportFormat === 'gif') {
      msg = (transparent ? 'GIF has crude 1-bit transparency, so the background is filled with solid dark. ' : '') +
        (big ? 'GIF at ' + state.style.canvas.w + '×' + state.style.canvas.h + ' is memory-heavy — half size is recommended below.' : '');
      if (!msg) msg = 'GIF loops automatically when “loop” is on.';
    } else {
      msg = 'PNG saves the exact frame at the scrubber position' + (transparent ? ' with its transparency intact.' : '.');
    }
    n.textContent = msg;
    if (exportRefs.gifField) exportRefs.gifField.hidden = exportFormat !== 'gif';
  }

  function exportFilename(ext) {
    var base = (state.title && state.title.trim()) || ($('project-name').value || '').trim() || 'chartflow';
    base = base.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 60) || 'chartflow';
    return base + '.' + ext;
  }

  function runExport() {
    if (exporting) return;
    exporting = true;
    var btn = exportRefs.btn, prog = exportRefs.prog, bar = exportRefs.bar, status = exportRefs.status;
    btn.disabled = true;
    prog.classList.add('active');
    bar.style.width = '0%';
    status.textContent = 'Rendering…';
    player.pause();
    syncPlayButton();

    function onProgress(p) {
      var pct = Math.round(Math.min(1, Math.max(0, p)) * 100);
      bar.style.width = pct + '%';
      status.textContent = 'Rendering… ' + pct + '%';
    }
    function done(blob, ext) {
      CF.exporter.download(blob, exportFilename(ext));
      status.textContent = 'Done — ' + exportFilename(ext) + ' (' + humanSize(blob.size) + ')';
      finish();
    }
    function fail(err) {
      var msg = (err && err.message) ? err.message : 'Export failed.';
      if (exportFormat === 'mp4' && !/WebM/i.test(msg)) msg += ' You can also try the WebM format.';
      status.textContent = msg;
      finish();
    }
    function finish() {
      exporting = false;
      btn.disabled = false;
      setTimeout(function () { prog.classList.remove('active'); }, 800);
    }

    var exportState = state;
    if (exportFormat === 'gif' && exportRefs.gifHalf && exportRefs.gifHalf.checked) {
      exportState = JSON.parse(JSON.stringify(state));
      exportState.style.canvas.w = Math.max(160, Math.round(state.style.canvas.w / 2));
      exportState.style.canvas.h = Math.max(160, Math.round(state.style.canvas.h / 2));
    }

    try {
      if (exportFormat === 'mp4') {
        CF.exporter.exportMP4(exportState, onProgress).then(function (b) { done(b, 'mp4'); }, fail);
      } else if (exportFormat === 'webm') {
        CF.exporter.exportWebM(exportState, onProgress).then(function (b) { done(b, 'webm'); }, fail);
      } else if (exportFormat === 'gif') {
        CF.exporter.exportGIF(exportState, onProgress).then(function (b) { done(b, 'gif'); }, fail);
      } else {
        CF.exporter.exportPNG(state, player.t).then(function (b) { done(b, 'png'); }, fail);
      }
    } catch (err) { fail(err); }
  }

  function humanSize(bytes) {
    if (bytes > 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
    if (bytes > 1024) return Math.round(bytes / 1024) + ' KB';
    return bytes + ' B';
  }

  /* ============================================================
     Transport
     ============================================================ */
  function syncPlayButton() {
    $('btn-play').textContent = player.playing ? '❚❚' : '▶';
  }

  function updateTimeReadout(t) {
    var total = engine.totalDuration(state);
    $('time-readout').textContent = (t * total).toFixed(1) + 's / ' + total.toFixed(1) + 's';
  }

  function buildTransport() {
    var scrub = $('scrubber');

    player.onTick(function (t) {
      scrub.value = Math.round(t * 1000);
      updateTimeReadout(t);
      syncPlayButton();
    });

    $('btn-play').addEventListener('click', function () {
      player.toggle();
      syncPlayButton();
    });
    $('btn-replay').addEventListener('click', function () {
      player.seek(0);
      player.play();
      syncPlayButton();
    });
    scrub.addEventListener('input', function () {
      player.seek((+scrub.value) / 1000);
    });
    $('chk-loop').addEventListener('change', function () {
      state.anim.loop = $('chk-loop').checked;
      var a = $('anim-loop');
      if (a) a.checked = state.anim.loop;
      changed();
    });
  }

  /* ============================================================
     Save / open / import / export project
     ============================================================ */
  function buildHeader() {
    $('btn-save').addEventListener('click', function () {
      openModal('Save project', function (body, foot) {
        var name = el('input');
        name.type = 'text';
        name.value = ($('project-name').value || '').trim() || 'Untitled chart';
        name.setAttribute('autocomplete', 'off');
        body.appendChild(field('Project name', name));
        body.appendChild(el('p', 'hint', 'Saved in this browser (localStorage). Saving with an existing name overwrites it.'));
        var cancel = el('button', 'btn ghost', 'Cancel');
        cancel.type = 'button';
        cancel.addEventListener('click', closeModal);
        foot.appendChild(cancel);
        var save = el('button', 'btn primary', 'Save');
        save.type = 'button';
        function doSave() {
          var n = name.value.trim() || 'Untitled chart';
          var id = CF.storage.saveProject(n, state);
          closeModal();
          if (id) {
            $('project-name').value = n;
            toast('Saved “' + n + '”');
          } else {
            toast('Could not save — storage may be full');
          }
        }
        save.addEventListener('click', doSave);
        name.addEventListener('keydown', function (e) { if (e.key === 'Enter') doSave(); });
        foot.appendChild(save);
      });
    });

    $('btn-open').addEventListener('click', openProjectsModal);
  }

  function openProjectsModal() {
    openModal('Your projects', function (body, foot) {
      var list = CF.storage.listProjects();
      if (!list.length) {
        body.appendChild(el('p', 'empty-note', 'No saved projects yet. Hit Save to keep the current chart.'));
      } else {
        var box = el('div', 'proj-list');
        list.forEach(function (p) {
          var row = el('div', 'proj-item');
          row.appendChild(el('span', 'proj-name', p.name || '(unnamed)'));
          row.appendChild(el('span', 'proj-date', relDate(p.updatedAt)));
          var load = el('button', 'btn small', 'Load');
          load.type = 'button';
          load.addEventListener('click', function () {
            var st = CF.storage.loadProject(p.id);
            if (!st) { toast('Could not load that project'); return; }
            applyLoadedState(st, p.name);
            closeModal();
            toast('Loaded “' + p.name + '”');
          });
          row.appendChild(load);
          var del = el('button', 'btn small danger', 'Delete');
          del.type = 'button';
          del.addEventListener('click', function () {
            CF.storage.deleteProject(p.id);
            row.remove();
            if (!box.children.length) {
              box.replaceWith(el('p', 'empty-note', 'No saved projects.'));
            }
          });
          row.appendChild(del);
          box.appendChild(row);
        });
        body.appendChild(box);
      }

      var exp = el('button', 'btn ghost', 'Export JSON');
      exp.type = 'button';
      exp.addEventListener('click', function () {
        CF.storage.exportJSON(state);
      });
      foot.appendChild(exp);

      var impLabel = el('label', 'btn ghost file-btn', 'Import JSON');
      var impFile = el('input');
      impFile.type = 'file';
      impFile.accept = '.json,application/json';
      impFile.addEventListener('change', function () {
        var f = impFile.files && impFile.files[0];
        if (!f) return;
        CF.storage.importJSON(f).then(function (st) {
          applyLoadedState(st, null);
          closeModal();
          toast('Project imported');
        }, function (err) {
          toast(err && err.message ? err.message : 'Import failed');
        });
        impFile.value = '';
      });
      impLabel.appendChild(impFile);
      foot.appendChild(impLabel);

      var close = el('button', 'btn', 'Close');
      close.type = 'button';
      close.addEventListener('click', closeModal);
      foot.appendChild(close);
    });
  }

  function relDate(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    var diff = Date.now() - ts;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.round(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.round(diff / 3600000) + 'h ago';
    return d.toLocaleDateString();
  }

  /** Replace the whole state (project load / JSON import) and rebuild UI. */
  function applyLoadedState(raw, projectName) {
    state = normalizeState(raw);
    if (projectName) $('project-name').value = projectName;
    CF.data.setData(state.data);           // push data into the editor (no emit)
    var next = CF.data.refresh();          // rebuild table for the (possibly new) type
    state.data = next;
    buildTypeGalleryActive();
    buildSampleChips();
    buildStyleControls();
    buildAnimateControls();
    buildExportControls();
    refreshThumbPalettes();
    renderDataErrors();
    $('chk-loop').checked = !!state.anim.loop;
    syncStageChrome();
    player.seek(0);
    player.play();
    syncPlayButton();
    scheduleAutosave();
  }

  function buildTypeGalleryActive() {
    $('type-gallery').querySelectorAll('.type-card').forEach(function (c) {
      c.classList.toggle('active', c.dataset.type === state.type);
    });
  }

  /* ============================================================
     Keyboard
     ============================================================ */
  function isTyping(e) {
    var t = e.target;
    if (!t) return false;
    var tag = (t.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable;
  }

  function buildKeyboard() {
    document.addEventListener('keydown', function (e) {
      if (!modal.hidden && e.key === 'Escape') { closeModal(); return; }
      if (isTyping(e)) return;
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        player.toggle();
        syncPlayButton();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        var step = e.shiftKey ? 0.05 : 0.01;
        var dir = e.key === 'ArrowRight' ? 1 : -1;
        player.pause();
        player.seek(Math.min(1, Math.max(0, player.t + dir * step)));
        syncPlayButton();
      }
    });
  }

  /* ============================================================
     Boot
     ============================================================ */
  function boot() {
    modal = $('modal'); modalTitle = $('modal-title');
    modalBody = $('modal-body'); modalFoot = $('modal-foot');
    $('modal-close').addEventListener('click', closeModal);
    modal.querySelector('.cf-modal-backdrop').addEventListener('click', closeModal);

    // ---- state: autosave, else bar + first sample ----
    var saved = CF.storage.loadAutosave();
    state = normalizeState(saved);
    var fromScratch = !saved;

    // safe-area overlay canvas
    safeCanvas = el('canvas', 'safe-overlay');
    safeCanvas.hidden = true;
    $('stage').appendChild(safeCanvas);

    // ---- data module (needs state.type) ----
    buildDataStep();
    if (fromScratch) {
      var loaded = CF.data.loadSample(state.type, 0);
      state.data = loaded.data;
      if (loaded.title != null) state.title = loaded.title;
    } else if (state.data) {
      CF.data.setData(state.data);
      state.data = CF.data.refresh();
    } else {
      state.data = CF.data.getData();
    }
    renderDataErrors();

    // ---- preview player ----
    player = engine.createPlayer($('preview'), function () { return state; });

    // ---- tabs (free navigation) ----
    STEPS.forEach(function (s) {
      $('tab-' + s).addEventListener('click', function () { showStep(s); });
    });

    // ---- panels ----
    buildTypeGallery();
    buildStyleControls();
    buildAnimateControls();
    buildExportControls();
    buildTransport();
    buildHeader();
    buildKeyboard();

    $('chk-loop').checked = !!state.anim.loop;
    syncStageChrome();
    showStep('type');

    document.addEventListener('visibilitychange', syncThumbLoops);
    window.addEventListener('resize', drawSafeOverlay);

    updateTimeReadout(0);
    player.play();
    syncPlayButton();
    scheduleAutosave();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  CF.app = {
    getState: function () { return state; },
    getPlayer: function () { return player; },
    showStep: showStep
  };
})();
