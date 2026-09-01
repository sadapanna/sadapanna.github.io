/* ReadFlow app.js — UI wiring: ① Text → ② Style → ③ Beats → ④ Export wizard.
 * Owns the preview canvas (device-pixel crisp), transport, stepper, doc/theme
 * controls, overlay editor, filters and frame presets. Export/storage buttons
 * exist in the DOM but are wired by exporter.js / storage.js.
 */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const canvas = $('preview');
  const ctx = canvas.getContext('2d');

  const SAMPLE_TEXT =
    'The internet never forgets — but it rarely remembers correctly either.\n' +
    'A single sentence, pulled from a longer story, can travel further in an hour than the article it came from will travel in a year. That is the whole game of attention: not what was written, but what gets highlighted.\n' +
    'So the question worth asking is simple. Who is holding the highlighter?';

  const PRESETS = {
    landscape: { width: 1920, height: 1080 },
    portrait: { width: 1080, height: 1920 },
    square: { width: 1080, height: 1080 }
  };

  const app = {
    placingOverlay: null,  // {type, src?} while waiting for a canvas click
    safeGuides: false
  };
  window.RFApp = app;

  // =================== rendering ===================
  let renderQueued = false;
  function requestRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => { renderQueued = false; render(); });
  }

  function sizeCanvas() {
    const holder = $('canvas-holder');
    const fw = RF.state.frame.width, fh = RF.state.frame.height;
    const availW = holder.clientWidth - 44, availH = holder.clientHeight - 44;
    if (availW <= 0 || availH <= 0) return;
    const scale = Math.min(availW / fw, availH / fh);
    const cssW = Math.max(80, fw * scale), cssH = Math.max(80, fh * scale);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.round(cssW * dpr), ph = Math.round(cssH * dpr);
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
    requestRender();
  }

  function render() {
    const t = RFEngine.player.time;
    RF.drawFrame(ctx, t, canvas.width, canvas.height);
    drawSelectionOverlay(t);
    drawSafeGuides();
    updateTransportUI();
  }

  // selection tint + safe guides are preview-only chrome — never in drawFrame,
  // so exports stay clean.
  function drawSelectionOverlay(t) {
    const sel = RFBeats.selection;
    if (!sel.active) return;
    const rects = RFDoc.rangeRects(RF.state.doc, sel.start, sel.end);
    if (!rects.length) return;
    const fw = RF.state.frame.width, fh = RF.state.frame.height;
    const cam = RFEngine.getCameraAt(t);
    const { dx, dy } = RFEngine.driftAt(t);   // same drift drawFrame used
    ctx.save();
    ctx.scale(canvas.width / fw, canvas.height / fh);
    ctx.translate(fw / 2 + dx, fh / 2 + dy);
    ctx.scale(cam.s, cam.s);
    ctx.translate(-cam.x, -cam.y);
    ctx.fillStyle = 'rgba(79,70,229,0.25)';
    ctx.strokeStyle = 'rgba(79,70,229,0.7)';
    ctx.lineWidth = 1.5 / cam.s;
    for (const r of rects) { ctx.fillRect(r.x, r.y, r.w, r.h); ctx.strokeRect(r.x, r.y, r.w, r.h); }
    ctx.restore();
  }

  function drawSafeGuides() {
    if (!app.safeGuides) return;
    const w = canvas.width, h = canvas.height;
    ctx.save();
    ctx.strokeStyle = 'rgba(79,70,229,0.55)';
    ctx.setLineDash([8, 7]);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(w * 0.05, h * 0.05, w * 0.9, h * 0.9);   // action safe
    ctx.strokeStyle = 'rgba(232,68,58,0.5)';
    ctx.strokeRect(w * 0.1, h * 0.1, w * 0.8, h * 0.8);     // title safe
    ctx.restore();
  }

  // =================== transport ===================
  function updateTransportUI() {
    const total = RF.getTotalDuration();
    const t = RFEngine.player.time;
    const scrub = $('scrubber');
    scrub.max = Math.max(0.001, total);
    if (document.activeElement !== scrub) scrub.value = t;
    $('time-readout').textContent = t.toFixed(1) + ' / ' + total.toFixed(1) + 's';
    $('ic-play').style.display = RFEngine.player.playing ? 'none' : '';
    $('ic-pause').style.display = RFEngine.player.playing ? '' : 'none';
  }

  RFEngine.player.onTick = () => requestRender();

  $('btn-play').addEventListener('click', () => {
    RFEngine.player.playing ? RFEngine.player.pause() : RFEngine.player.play();
  });
  $('scrubber').addEventListener('input', e => {
    RFEngine.player.pause();
    RFEngine.player.seek(parseFloat(e.target.value));
  });
  document.addEventListener('keydown', e => {
    if (RFBeats.isTapSyncOn()) return; // tap-sync owns Space
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
    if (e.code === 'Space') {
      e.preventDefault();
      RFEngine.player.playing ? RFEngine.player.pause() : RFEngine.player.play();
    }
  });

  // =================== stepper (① Text → ② Style → ③ Beats → ④ Export) ===================
  // Steps are navigation, never gates — every step is always one click away.
  const STEP_IDS = ['step-text', 'step-style', 'step-beats', 'step-export'];

  function goStep(i) {
    i = Math.max(0, Math.min(STEP_IDS.length - 1, i));
    STEP_IDS.forEach((id, k) => { $(id).hidden = k !== i; });
    document.querySelectorAll('#stepper button').forEach(b => {
      const k = parseInt(b.dataset.step, 10);
      b.classList.toggle('active', k === i);
      b.classList.toggle('done', k < i);
    });
    const panel = document.getElementById('panel');
    if (panel) panel.scrollTop = 0;
    const sec = $(STEP_IDS[i]);
    if (sec) sec.scrollTop = 0;
  }
  app.goStep = goStep;

  document.querySelectorAll('#stepper button').forEach(btn => {
    btn.addEventListener('click', () => goStep(parseInt(btn.dataset.step, 10)));
  });
  document.querySelectorAll('.step-nav button[data-go]').forEach(btn => {
    btn.addEventListener('click', () => goStep(parseInt(btn.dataset.go, 10)));
  });

  // =================== document tab ===================
  function initThemeGrid() {
    const grid = $('theme-grid');
    grid.innerHTML = '';
    for (const [key, th] of Object.entries(RFDoc.THEMES)) {
      const b = document.createElement('button');
      b.dataset.theme = key;
      b.innerHTML = '<span class="sw" style="background:' + th.sw + '"></span>' + th.label;
      if (key === RF.state.doc.theme) b.classList.add('active');
      b.addEventListener('click', () => {
        RF.state.doc.theme = key;
        if (th.suggestFont) { RF.state.doc.fontFamily = th.suggestFont; syncFontUI(); }
        if (th.suggestWidth) { RF.state.doc.maxWidth = th.suggestWidth; $('doc-maxwidth').value = th.suggestWidth; $('out-maxwidth').value = th.suggestWidth; }
        $('author-field').hidden = !th.hasAuthor;
        grid.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
        docChanged();
      });
      grid.appendChild(b);
    }
    $('author-field').hidden = !(RFDoc.THEMES[RF.state.doc.theme] || {}).hasAuthor;
  }

  // =================== font picker ===================
  // Bundled + system faces stay first and work with zero network. Google families
  // come from the static catalog in js/fonts.js and are fetched only on demand.
  const BUNDLED_FONTS = [
    { label: 'Poppins (sans)', value: 'Poppins' },
    { label: 'Georgia (serif)', value: "Georgia, 'Times New Roman', serif" },
    { label: 'Monospace', value: 'ui-monospace, Menlo, Consolas, monospace' },
    { label: 'Pacifico (handwriting)', value: 'Pacifico' }
  ];

  function fontLabelFor(value) {
    const b = BUNDLED_FONTS.find(f => f.value === value);
    if (b) return b.label;
    const g = RFFonts.googleFamilyOf(value);
    if (g) return g;
    return String(value || '').split(',')[0].replace(/["']/g, '') || 'Default';
  }

  function showFontNote(msg) {
    const el = $('font-note');
    if (!el) return;
    if (!msg) { el.hidden = true; el.textContent = ''; return; }
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(showFontNote._t);
    showFontNote._t = setTimeout(() => { el.hidden = true; }, 9000);
  }

  function buildFontList() {
    const list = $('font-list');
    if (!list || list.childElementCount) return;
    const frag = document.createDocumentFragment();

    const addGroup = name => {
      const h = document.createElement('div');
      h.className = 'fp-group';
      h.textContent = name;
      frag.appendChild(h);
    };
    const addItem = (value, label, search, cat) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.value = value;
      b.dataset.search = search.toLowerCase();
      b.textContent = label;
      if (cat) {
        const s = document.createElement('span');
        s.className = 'fp-cat';
        s.textContent = cat;
        b.appendChild(s);
      }
      frag.appendChild(b);
    };

    addGroup('Bundled (offline)');
    for (const f of BUNDLED_FONTS) addItem(f.value, f.label, f.label);

    addGroup('Google Fonts (fetched on pick)');
    for (const e of RFFonts.CATALOG) {
      addItem(RFFonts.cssValue(e.family), e.family,
              e.family + ' ' + e.category, RFFonts.CATEGORY_LABEL[e.category] || e.category);
    }
    list.appendChild(frag);
  }

  function filterFontList(q) {
    const list = $('font-list');
    const needle = q.trim().toLowerCase();
    let visible = 0, lastGroup = null, groupHas = false;
    for (const el of list.children) {
      if (el.classList.contains('fp-group')) {
        if (lastGroup) lastGroup.hidden = !groupHas;
        lastGroup = el; groupHas = false;
        continue;
      }
      const show = !needle || el.dataset.search.indexOf(needle) !== -1;
      el.hidden = !show;
      if (show) { visible++; groupHas = true; }
    }
    if (lastGroup) lastGroup.hidden = !groupHas;
    $('font-empty').hidden = visible > 0;
  }

  function openFontMenu(open) {
    const menu = $('font-menu');
    menu.hidden = !open;
    $('font-trigger').setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      buildFontList();
      $('font-search').value = '';
      filterFontList('');
      syncFontUI();
      const active = $('font-list').querySelector('button.active');
      if (active) active.scrollIntoView({ block: 'nearest' });
      $('font-search').focus();
    }
  }

  /** reflect RF.state.doc.fontFamily into the trigger label + list selection */
  function syncFontUI() {
    const v = RF.state.doc.fontFamily;
    $('font-current').textContent = fontLabelFor(v);
    const list = $('font-list');
    if (list.childElementCount) {
      for (const el of list.children) {
        if (el.tagName === 'BUTTON') el.classList.toggle('active', el.dataset.value === v);
      }
    }
  }

  function setFontLoading(on) {
    $('font-picker').classList.toggle('loading', !!on);
  }

  /** a Google font finished loading after layout ran → drop cached metrics, re-render */
  function fontBecameReady() {
    RFDoc.clearCache();
    RFEngine.invalidateAll();
    RFEngine.emitChange();
    requestRender();
  }

  /**
   * Make sure whatever family the state names is actually loaded. Called on boot
   * and after a project load, so a project that references a Google font pulls it
   * in automatically; falls back silently-but-visibly if it can't be fetched.
   */
  function ensureFontForState() {
    const fam = RFFonts.googleFamilyOf(RF.state.doc.fontFamily);
    if (!fam || RFFonts.isLoaded(fam)) return;
    setFontLoading(true);
    RFFonts.ensure(fam).then(() => {
      setFontLoading(false);
      fontBecameReady();
    }).catch(() => {
      setFontLoading(false);
      showFontNote('Couldn’t fetch “' + fam + '” from Google Fonts — showing a system fallback. Bundled fonts still work offline.');
      fontBecameReady();
    });
  }

  /** user picked a font in the list */
  function chooseFont(value) {
    const prev = RF.state.doc.fontFamily;
    const fam = RFFonts.googleFamilyOf(value);
    showFontNote('');

    if (!fam || RFFonts.isLoaded(fam)) {
      RF.state.doc.fontFamily = value;
      syncFontUI();
      RFDoc.clearCache();
      docChanged();
      return;
    }

    // apply optimistically (the CSS value carries a generic fallback), then
    // re-layout for real once the woff2 has landed
    RF.state.doc.fontFamily = value;
    syncFontUI();
    setFontLoading(true);
    RFDoc.clearCache();
    docChanged();

    RFFonts.ensure(fam).then(() => {
      setFontLoading(false);
      if (RF.state.doc.fontFamily === value) fontBecameReady();
    }).catch(() => {
      setFontLoading(false);
      if (RF.state.doc.fontFamily !== value) return;
      RF.state.doc.fontFamily = prev;          // graceful fallback to the last font
      syncFontUI();
      showFontNote('Couldn’t fetch “' + fam + '” from Google Fonts. Check your connection — bundled fonts work offline.');
      RFDoc.clearCache();
      docChanged();
    });
  }

  function bindFontPicker() {
    $('font-trigger').addEventListener('click', () => {
      openFontMenu($('font-menu').hidden);
    });
    $('font-search').addEventListener('input', e => filterFontList(e.target.value));
    $('font-search').addEventListener('keydown', e => {
      if (e.key === 'Escape') { openFontMenu(false); $('font-trigger').focus(); }
      if (e.key === 'Enter') {
        const first = Array.from($('font-list').children)
          .find(el => el.tagName === 'BUTTON' && !el.hidden);
        if (first) { chooseFont(first.dataset.value); openFontMenu(false); }
      }
      e.stopPropagation(); // don't let the transport's space/arrow shortcuts fire
    });
    $('font-list').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b || !b.dataset.value) return;
      chooseFont(b.dataset.value);
      openFontMenu(false);
    });
    document.addEventListener('click', e => {
      if (!$('font-menu').hidden && !$('font-picker').contains(e.target)) openFontMenu(false);
    });
  }

  function docChanged() {
    RFEngine.invalidateAll();
    RFBeats.clearSelection();
    RFBeats.updateSelectionUI();
    RFEngine.emitChange();
  }

  function bindDocControls() {
    $('doc-text').addEventListener('input', e => {
      const old = RF.state.doc.text;
      RF.state.doc.text = e.target.value;
      // beats reference char ranges; if the text changed, drop beats that no longer fit
      if (old !== e.target.value) {
        RF.state.beats = RF.state.beats.filter(b => b.end <= e.target.value.length);
        RFBeats.renderList();
      }
      docChanged();
    });
    $('doc-author').addEventListener('input', e => { RF.state.doc.author = e.target.value; docChanged(); });
    $('btn-example').addEventListener('click', () => {
      const ta = $('doc-text');
      ta.value = SAMPLE_TEXT;
      // run the same path as typing so beats that no longer fit are dropped
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    bindRange('doc-fontsize', 'out-fontsize', v => { RF.state.doc.fontSize = v; docChanged(); });
    bindRange('doc-lineheight', 'out-lineheight', v => { RF.state.doc.lineHeight = v; docChanged(); });
    bindRange('doc-paragap', 'out-paragap', v => { RF.state.doc.paraSpacing = v; docChanged(); });
    bindRange('doc-maxwidth', 'out-maxwidth', v => { RF.state.doc.maxWidth = v; docChanged(); });
    $('doc-textcolor').addEventListener('input', e => { RF.state.doc.textColor = e.target.value; docChanged(); });
    $('doc-textcolor-reset').addEventListener('click', () => { RF.state.doc.textColor = ''; docChanged(); });
  }

  function bindRange(id, outId, fn) {
    $(id).addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      $(outId).value = v;
      fn(v);
    });
  }

  // =================== beats step (camera + defaults) ===================
  const round2 = v => Math.round(v * 100) / 100;

  /** reflect the sum of the three default timings into the "Speed" slider */
  function syncDefSpeedUI() {
    const d = RF.state.defaults;
    const t = d.moveDur + d.fxDur + d.hold;
    $('def-speed').value = t;
    $('out-defspeed').value = (Math.round(t * 10) / 10).toFixed(1);
  }

  function bindBeatControls() {
    const defEff = $('def-effect');
    for (const [key, meta] of Object.entries(RFHighlights.EFFECTS)) {
      const o = document.createElement('option');
      o.value = key; o.textContent = meta.label;
      defEff.appendChild(o);
    }
    defEff.value = RF.state.defaults.effect;
    defEff.addEventListener('change', () => {
      RF.state.defaults.effect = defEff.value;
      const meta = RFHighlights.EFFECTS[defEff.value];
      if (meta && meta.defaultColor) { RF.state.defaults.color = meta.defaultColor; $('def-color').value = meta.defaultColor; }
      RFEngine.emitChange();
    });
    $('def-color').addEventListener('input', e => { RF.state.defaults.color = e.target.value; RFEngine.emitChange(); });
    $('def-move').addEventListener('change', e => { RF.state.defaults.moveDur = Math.max(0, parseFloat(e.target.value) || 0); syncDefSpeedUI(); RFEngine.emitChange(); });
    $('def-fx').addEventListener('change', e => { RF.state.defaults.fxDur = Math.max(0.05, parseFloat(e.target.value) || 0.8); syncDefSpeedUI(); RFEngine.emitChange(); });
    $('def-hold').addEventListener('change', e => { RF.state.defaults.hold = Math.max(0, parseFloat(e.target.value) || 0); syncDefSpeedUI(); RFEngine.emitChange(); });

    // one "Speed" concept: total seconds per beat, distributed proportionally
    // over camera travel / highlight / pause so their character is kept
    $('def-speed').addEventListener('input', e => {
      const d = RF.state.defaults;
      const target = Math.max(0.5, parseFloat(e.target.value) || 3.3);
      const cur = Math.max(0.15, d.moveDur + d.fxDur + d.hold);
      const k = target / cur;
      d.moveDur = round2(d.moveDur * k);
      d.fxDur = Math.max(0.05, round2(d.fxDur * k));
      d.hold = round2(d.hold * k);
      $('def-move').value = d.moveDur;
      $('def-fx').value = d.fxDur;
      $('def-hold').value = d.hold;
      $('out-defspeed').value = (Math.round(target * 10) / 10).toFixed(1);
      RFEngine.emitChange();
    });
    $('def-track').addEventListener('change', e => { RF.state.defaults.track = e.target.checked; RFEngine.emitChange(); });

    $('cam-establishing').addEventListener('change', e => {
      RF.state.camera.establishing = e.target.checked;
      $('estholdfield').hidden = !e.target.checked;
      RFBeats.renderList();
      RFEngine.emitChange();
    });
    bindRange('cam-esthold', 'out-esthold', v => { RF.state.camera.establishingHold = v; RFBeats.renderList(); RFEngine.emitChange(); });
    $('cam-drift').addEventListener('change', e => { RF.state.camera.drift = e.target.checked; RFEngine.emitChange(); });
    bindRange('cam-driftamt', 'out-drift', v => { RF.state.camera.driftAmount = v; RFEngine.emitChange(); });
  }

  // =================== overlays tab ===================
  let ovUid = 1;

  function bindOverlayControls() {
    document.querySelectorAll('.ov-add').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.ovtype;
        if (type === 'image') { $('overlay-image-input').click(); return; }
        let extra = {};
        if (type === 'emoji') {
          const em = prompt('Emoji to place:', '😱');
          if (!em) return;
          extra.emoji = em;
        } else if (type === 'label') {
          const txt = prompt('Label text:', 'wait for it…');
          if (!txt) return;
          extra.text = txt;
        }
        armPlacement(Object.assign({ type }, extra));
      });
    });
    $('overlay-image-input').addEventListener('change', e => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => armPlacement({ type: 'image', src: reader.result });
      reader.readAsDataURL(file);
      e.target.value = '';
    });
    $('overlay-place-cancel').addEventListener('click', disarmPlacement);

    canvas.addEventListener('pointerdown', e => {
      if (!app.placingOverlay) return;
      e.stopImmediatePropagation(); // the selection handler must not see this click
      const rect = canvas.getBoundingClientRect();
      const fw = RF.state.frame.width, fh = RF.state.frame.height;
      const fx = (e.clientX - rect.left) / rect.width * fw;
      const fy = (e.clientY - rect.top) / rect.height * fh;
      const cam = RFEngine.getCameraAt(RFEngine.player.time);
      const { dx, dy } = RFEngine.driftAt(RFEngine.player.time);
      const px = (fx - fw / 2 - dx) / cam.s + cam.x;
      const py = (fy - fh / 2 - dy) / cam.s + cam.y;

      const segs = RFEngine.beatSegments();
      let beatIdx = 0;
      for (let i = 0; i < segs.length; i++) if (RFEngine.player.time >= segs[i].tStart) beatIdx = i;

      const ov = Object.assign({
        id: ovUid++,
        x: Math.round(px), y: Math.round(py),
        beat: beatIdx, hideBeat: -1,
        fadeIn: 0.5, fadeOut: 0.35,
        size: Math.round(60 / Math.min(1, cam.s)),
        color: app.placingOverlay.type === 'label' ? '#4f46e5' : '#e8443a'
      }, app.placingOverlay);
      RF.state.overlays.push(ov);
      disarmPlacement();
      renderOverlayList();
      RFEngine.emitChange();
    }, true); // capture: runs before the selection handler

    // filters
    $('flt-vignette').addEventListener('change', e => { RF.state.filters.vignette = e.target.checked; RFEngine.emitChange(); });
    $('flt-grain').addEventListener('change', e => { RF.state.filters.grain = e.target.checked; RFEngine.emitChange(); });
    $('flt-shadow').addEventListener('change', e => { RF.state.filters.pageShadow = e.target.checked; RFEngine.emitChange(); });
    $('flt-progress').addEventListener('change', e => { RF.state.filters.progressBar = e.target.checked; RFEngine.emitChange(); });
    $('flt-bg').addEventListener('input', e => { RF.state.filters.bg = e.target.value; RFEngine.emitChange(); });
    $('flt-bg-reset').addEventListener('click', () => { RF.state.filters.bg = ''; RFEngine.emitChange(); });
    $('flt-bggrad').addEventListener('change', e => { RF.state.filters.bgGradient = e.target.checked; RFEngine.emitChange(); });
  }

  function armPlacement(placing) {
    app.placingOverlay = placing;
    canvas.classList.add('placing');
    $('overlay-place-hint').hidden = false;
  }
  function disarmPlacement() {
    app.placingOverlay = null;
    canvas.classList.remove('placing');
    $('overlay-place-hint').hidden = true;
  }

  const OV_ICONS = { arrow: '→', circle: '◯', emoji: '😀', label: 'Aa', image: '🖼' };

  function renderOverlayList() {
    const list = $('overlay-list');
    list.innerHTML = '';
    if (!RF.state.overlays.length) {
      list.innerHTML = '<p class="empty-note">No overlays yet.</p>';
      return;
    }
    RF.state.overlays.forEach((ov, i) => {
      const item = document.createElement('div');
      item.className = 'ov-item';

      const head = document.createElement('div');
      head.className = 'ov-head';
      head.innerHTML = '<span>' + OV_ICONS[ov.type] + '</span><span>' +
        (ov.type === 'label' ? '“' + (ov.text || '') + '”' : ov.type === 'emoji' ? ov.emoji : ov.type) + '</span>';
      const del = document.createElement('button');
      del.className = 'ov-del'; del.textContent = '✕';
      del.addEventListener('click', () => { RF.state.overlays.splice(i, 1); renderOverlayList(); RFEngine.emitChange(); });
      head.appendChild(del);

      const row1 = document.createElement('div');
      row1.className = 'ov-row';
      row1.append('appears at', beatSelect(ov, 'beat', false), 'hide at', beatSelect(ov, 'hideBeat', true));

      const row2 = document.createElement('div');
      row2.className = 'ov-row';
      row2.append('size');
      const size = document.createElement('input');
      size.type = 'range'; size.min = 20; size.max = 400; size.value = ov.size || 60;
      size.addEventListener('input', () => { ov.size = parseInt(size.value, 10); RFEngine.emitChange(); });
      row2.append(size);
      if (ov.type === 'arrow' || ov.type === 'circle' || ov.type === 'label') {
        const col = document.createElement('input');
        col.type = 'color'; col.value = ov.color || '#e8443a';
        col.addEventListener('input', () => { ov.color = col.value; RFEngine.emitChange(); });
        row2.append(col);
      }

      const row3 = document.createElement('div');
      row3.className = 'ov-row';
      row3.append('fade in', numInput(ov, 'fadeIn', 0.05), 'out', numInput(ov, 'fadeOut', 0.05));

      item.append(head, row1, row2, row3);
      list.appendChild(item);
    });
  }

  function beatSelect(ov, prop, allowNever) {
    const sel = document.createElement('select');
    if (allowNever) {
      const o = document.createElement('option');
      o.value = '-1'; o.textContent = 'never';
      sel.appendChild(o);
    }
    RF.state.beats.forEach((b, i) => {
      const o = document.createElement('option');
      o.value = i; o.textContent = 'beat ' + (i + 1);
      sel.appendChild(o);
    });
    sel.value = String(ov[prop]);
    if (sel.selectedIndex < 0) sel.selectedIndex = 0;
    sel.addEventListener('change', () => { ov[prop] = parseInt(sel.value, 10); RFEngine.emitChange(); });
    return sel;
  }

  function numInput(obj, prop, min) {
    const inp = document.createElement('input');
    inp.type = 'number'; inp.step = 0.1; inp.min = min;
    inp.style.width = '58px';
    inp.value = obj[prop];
    inp.addEventListener('change', () => { obj[prop] = Math.max(min, parseFloat(inp.value) || min); RFEngine.emitChange(); });
    return inp;
  }

  // =================== export tab (frame + guides; buttons owned elsewhere) ===================
  function bindFrameControls() {
    document.querySelectorAll('#frame-presets button').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = PRESETS[btn.dataset.preset];
        RF.state.frame.width = p.width;
        RF.state.frame.height = p.height;
        RF.state.frame.preset = btn.dataset.preset;
        document.querySelectorAll('#frame-presets button').forEach(b => b.classList.toggle('active', b === btn));
        RFEngine.invalidateAll();
        sizeCanvas();
        RFEngine.emitChange();
      });
    });
    $('frame-fps').addEventListener('change', e => {
      RF.state.frame.fps = parseInt(e.target.value, 10);
      RFEngine.emitChange();
    });
    $('safe-guides').addEventListener('change', e => { app.safeGuides = e.target.checked; requestRender(); });
  }

  // =================== load: refresh every control from state ===================
  function refreshUIFromState() {
    const s = RF.state;
    $('doc-text').value = s.doc.text;
    $('doc-author').value = s.doc.author || '';
    syncFontUI();
    ensureFontForState();
    $('doc-fontsize').value = s.doc.fontSize; $('out-fontsize').value = s.doc.fontSize;
    $('doc-lineheight').value = s.doc.lineHeight; $('out-lineheight').value = s.doc.lineHeight;
    $('doc-paragap').value = s.doc.paraSpacing; $('out-paragap').value = s.doc.paraSpacing;
    $('doc-maxwidth').value = s.doc.maxWidth; $('out-maxwidth').value = s.doc.maxWidth;
    if (s.doc.textColor) $('doc-textcolor').value = s.doc.textColor;
    initThemeGrid();

    $('def-effect').value = s.defaults.effect;
    $('def-color').value = s.defaults.color;
    $('def-move').value = s.defaults.moveDur;
    $('def-fx').value = s.defaults.fxDur;
    $('def-hold').value = s.defaults.hold;
    $('def-track').checked = !!s.defaults.track;
    syncDefSpeedUI();

    $('cam-establishing').checked = s.camera.establishing;
    $('estholdfield').hidden = !s.camera.establishing;
    $('cam-esthold').value = s.camera.establishingHold; $('out-esthold').value = s.camera.establishingHold;
    $('cam-drift').checked = s.camera.drift;
    $('cam-driftamt').value = s.camera.driftAmount; $('out-drift').value = s.camera.driftAmount;

    $('flt-vignette').checked = s.filters.vignette;
    $('flt-grain').checked = s.filters.grain;
    $('flt-shadow').checked = s.filters.pageShadow;
    $('flt-progress').checked = s.filters.progressBar;
    if (s.filters.bg) $('flt-bg').value = s.filters.bg;
    $('flt-bggrad').checked = !!s.filters.bgGradient;

    document.querySelectorAll('#frame-presets button').forEach(b =>
      b.classList.toggle('active', b.dataset.preset === s.frame.preset));
    $('frame-fps').value = String(s.frame.fps);

    RFBeats.renderList();
    RFBeats.clearSelection();
    RFBeats.updateSelectionUI();
    renderOverlayList();
    sizeCanvas();
  }

  // =================== boot ===================
  function boot() {
    if (!RF.state.doc.text) RF.state.doc.text = SAMPLE_TEXT;

    RFBeats.init();
    RFBeats.attachSelection(canvas, () => { RFBeats.updateSelectionUI(); requestRender(); });
    initThemeGrid();
    bindFontPicker();
    bindDocControls();
    bindBeatControls();
    bindOverlayControls();
    bindFrameControls();
    refreshUIFromState();

    document.addEventListener('rf:change', () => {
      $('total-duration').textContent = (Math.round(RF.getTotalDuration() * 10) / 10).toFixed(1) + 's';
      requestRender();
    });
    document.addEventListener('rf:tick', requestRender); // async resources (images) became ready
    document.addEventListener('rf:load', refreshUIFromState);

    window.addEventListener('resize', sizeCanvas);
    sizeCanvas();

    // re-layout once bundled fonts are ready (metrics change)
    if (document.fonts && document.fonts.ready) {
      Promise.all([
        document.fonts.load('30px Poppins').catch(() => {}),
        document.fonts.load('30px Pacifico').catch(() => {})
      ]).then(() => document.fonts.ready).then(() => {
        RFDoc.clearCache();
        RFEngine.invalidateAll();
        requestRender();
      });
    }

    requestRender();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
