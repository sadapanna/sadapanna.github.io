/* ReadFlow beats.js — beat model, beat list UI, canvas-native span selection,
 * tap-sync mode, and fit-to-N-seconds scaling.
 * A beat: target char range + effect + camera framing nudges + four timings
 * (move-in, highlight, hold; camera easing and highlight easing kept separate).
 */
(function () {
  'use strict';

  let uid = 1;

  function makeBeat(start, end, text) {
    const d = (window.RF && RF.state.defaults) || { effect: 'marker', color: '#ffdf3d', moveDur: 0.9, fxDur: 0.8, hold: 1.6, camEase: 'settle', fxEase: 'easeInOut' };
    const meta = window.RFHighlights && RFHighlights.EFFECTS[d.effect];
    return {
      id: 'b' + (uid++) + '_' + Date.now().toString(36),
      start, end,
      text: (text || '').slice(0, 60),
      effect: d.effect,
      color: d.color || (meta && meta.defaultColor) || '#ffdf3d',
      bold: false,
      moveDur: d.moveDur, fxDur: d.fxDur, hold: d.hold,
      camEase: d.camEase, fxEase: d.fxEase,
      zoom: 1, offsetX: 0, offsetY: 0
    };
  }

  // =================== canvas span selection ===================
  // Click-drag over the rendered page, using the layout map (the oracle).
  const selection = { active: false, anchor: -1, start: -1, end: -1 };

  function screenToPage(canvas, clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const fw = RF.state.frame.width, fh = RF.state.frame.height;
    const fx = (clientX - rect.left) / rect.width * fw;
    const fy = (clientY - rect.top) / rect.height * fh;
    const cam = RFEngine.getCameraAt(RFEngine.player.time);
    const { dx, dy } = RFEngine.driftAt(RFEngine.player.time); // must match drawFrame exactly
    return {
      x: (fx - fw / 2 - dx) / cam.s + cam.x,
      y: (fy - fh / 2 - dy) / cam.s + cam.y
    };
  }

  function attachSelection(canvas, onChange) {
    let dragging = false;

    canvas.addEventListener('pointerdown', e => {
      if (window.RFApp && RFApp.placingOverlay) return; // overlay placement owns the click
      if (!RF.state.doc.text) return;
      canvas.setPointerCapture(e.pointerId);
      dragging = true;
      const p = screenToPage(canvas, e.clientX, e.clientY);
      selection.anchor = RFDoc.hitChar(RF.state.doc, p.x, p.y);
      selection.start = selection.end = selection.anchor;
      selection.active = false;
      onChange();
    });
    canvas.addEventListener('pointermove', e => {
      if (!dragging) return;
      const p = screenToPage(canvas, e.clientX, e.clientY);
      const c = RFDoc.hitChar(RF.state.doc, p.x, p.y);
      selection.start = Math.min(selection.anchor, c);
      selection.end = Math.max(selection.anchor, c);
      selection.active = selection.end > selection.start;
      onChange();
    });
    const up = e => {
      if (!dragging) return;
      dragging = false;
      // snap outward to word boundaries for a clean range
      if (selection.active) {
        const text = RF.state.doc.text;
        while (selection.start > 0 && /\S/.test(text[selection.start - 1])) selection.start--;
        while (selection.end < text.length && /\S/.test(text[selection.end])) selection.end++;
      }
      onChange();
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
  }

  function clearSelection() { selection.active = false; selection.start = selection.end = selection.anchor = -1; }

  function selectedText() {
    if (!selection.active) return '';
    return RF.state.doc.text.slice(selection.start, selection.end);
  }

  // =================== beat list UI ===================
  const els = {};
  let dragIndex = -1;

  function init() {
    els.list = document.getElementById('beat-list');
    els.count = document.getElementById('beat-count');
    els.addBtn = document.getElementById('add-beat');
    els.selInfo = document.getElementById('selection-info');
    els.total = document.getElementById('total-duration');

    els.addBtn.addEventListener('click', addFromSelection);

    // fit to N seconds
    document.getElementById('fit-apply').addEventListener('click', () => {
      const n = parseFloat(document.getElementById('fit-seconds').value);
      if (!n || n <= 0 || !RF.state.beats.length) return;
      fitToSeconds(n);
    });

    // tap-sync
    document.getElementById('tapsync-toggle').addEventListener('click', toggleTapSync);
    document.addEventListener('keydown', tapSyncKey);

    renderList();
  }

  function addFromSelection() {
    if (!selection.active) return;
    const b = makeBeat(selection.start, selection.end, selectedText());
    RF.state.beats.push(b);
    clearSelection();
    updateSelectionUI();
    renderList();
    // jump the scrubber to this beat's landing so the user sees it
    const segs = RFEngine.beatSegments();
    RFEngine.player.seek(segs[segs.length - 1].tHold);
    RFEngine.emitChange();
  }

  function updateSelectionUI() {
    if (selection.active) {
      const txt = selectedText().trim().replace(/\s+/g, ' ');
      els.selInfo.textContent = '“' + (txt.length > 46 ? txt.slice(0, 46) + '…' : txt) + '”';
      els.selInfo.classList.add('has');
      els.addBtn.disabled = false;
    } else {
      els.selInfo.textContent = RF.state.doc.text ? 'Drag across the page to select text' : 'Paste some text in the Document tab first';
      els.selInfo.classList.remove('has');
      els.addBtn.disabled = true;
    }
  }

  function fmtTime(s) { return (Math.round(s * 10) / 10).toFixed(1); }

  function renderList() {
    const beats = RF.state.beats;
    els.count.textContent = beats.length ? '(' + beats.length + ')' : '';
    els.total.textContent = fmtTime(RF.getTotalDuration()) + 's';
    els.list.innerHTML = '';
    if (!beats.length) {
      els.list.innerHTML = '<p class="empty-note">No beats yet. Select a phrase on the page, then “Add Beat”.</p>';
      return;
    }
    beats.forEach((b, i) => els.list.appendChild(beatItem(b, i)));
  }

  function beatItem(b, i) {
    const div = document.createElement('div');
    div.className = 'beat-item';
    div.draggable = true;
    div.dataset.index = i;

    // --- head: grip, number, snippet, delete ---
    const head = document.createElement('div');
    head.className = 'beat-head';
    head.innerHTML = '<span class="bi-grip" title="Drag to reorder">⠿</span>' +
      '<span class="bi-num">' + (i + 1) + '</span>';
    const snippet = document.createElement('span');
    snippet.className = 'bi-text';
    snippet.textContent = '“' + (b.text || RF.state.doc.text.slice(b.start, b.end).slice(0, 40)) + '”';
    snippet.title = 'Click to jump to this beat';
    snippet.addEventListener('click', () => {
      const segs = RFEngine.beatSegments();
      if (segs[i]) RFEngine.player.seek(segs[i].tHold);
    });
    const del = document.createElement('button');
    del.className = 'bi-del'; del.textContent = '✕'; del.title = 'Delete beat';
    del.addEventListener('click', () => {
      RF.state.beats.splice(i, 1);
      RFEngine.invalidateBeat(b.id);
      renderList(); RFEngine.emitChange();
    });
    head.append(snippet, del);

    // --- effect + color ---
    const row1 = document.createElement('div');
    row1.className = 'beat-row';
    const effSel = document.createElement('select');
    for (const [key, meta] of Object.entries(RFHighlights.EFFECTS)) {
      const o = document.createElement('option');
      o.value = key; o.textContent = meta.label;
      if (key === b.effect) o.selected = true;
      effSel.appendChild(o);
    }
    effSel.addEventListener('change', () => {
      b.effect = effSel.value;
      const meta = RFHighlights.EFFECTS[b.effect];
      if (meta && meta.defaultColor && !b._userColor) { b.color = meta.defaultColor; colorInp.value = meta.defaultColor; }
      RFEngine.emitChange();
    });
    const colorInp = document.createElement('input');
    colorInp.type = 'color'; colorInp.value = b.color;
    colorInp.addEventListener('input', () => { b.color = colorInp.value; b._userColor = true; RFEngine.emitChange(); });
    row1.append(effSel, colorInp);

    // --- timings (inline) ---
    const row2 = document.createElement('div');
    row2.className = 'beat-row';
    row2.append(
      timeInput('move', b, 'moveDur', 0),
      timeInput('fx', b, 'fxDur', 0.05),
      timeInput('hold', b, 'hold', 0)
    );

    // --- more: zoom nudge, offsets, easings, bold ---
    const more = document.createElement('details');
    more.className = 'beat-more';
    more.innerHTML = '<summary>camera &amp; easing</summary>';
    const zRow = document.createElement('div');
    zRow.className = 'beat-row';
    zRow.innerHTML = '<span class="lbl">zoom</span>';
    const zoom = document.createElement('input');
    zoom.type = 'range'; zoom.min = '0.45'; zoom.max = '2.2'; zoom.step = '0.05'; zoom.value = b.zoom;
    zoom.addEventListener('input', () => { b.zoom = parseFloat(zoom.value); RFEngine.invalidateBeat(b.id); RFEngine.emitChange(); });
    const zReset = document.createElement('button');
    zReset.className = 'mini'; zReset.textContent = 'auto';
    zReset.addEventListener('click', () => { b.zoom = 1; b.offsetX = 0; b.offsetY = 0; zoom.value = 1; RFEngine.invalidateBeat(b.id); RFEngine.emitChange(); });
    zRow.append(zoom, zReset);

    const oRow = document.createElement('div');
    oRow.className = 'beat-row';
    oRow.innerHTML = '<span class="lbl">nudge</span>';
    const nx = nudgeInput(b, 'offsetX', '↔'), ny = nudgeInput(b, 'offsetY', '↕');
    oRow.append(nx, ny);

    const eRow = document.createElement('div');
    eRow.className = 'beat-row';
    eRow.append(easeSelect('cam', b, 'camEase'), easeSelect('fx', b, 'fxEase'));

    const bRow = document.createElement('label');
    bRow.className = 'check'; bRow.style.fontSize = '12px';
    const bold = document.createElement('input');
    bold.type = 'checkbox'; bold.checked = !!b.bold;
    bold.addEventListener('change', () => { b.bold = bold.checked; RFEngine.emitChange(); });
    bRow.append(bold, document.createTextNode(' bold text (color pop / reveal)'));
    bRow.style.marginBottom = '8px';

    more.append(zRow, oRow, eRow, bRow);

    div.append(head, row1, row2, more);

    // --- drag reorder ---
    div.addEventListener('dragstart', e => {
      dragIndex = i;
      div.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    div.addEventListener('dragend', () => { div.classList.remove('dragging'); dragIndex = -1; });
    div.addEventListener('dragover', e => { e.preventDefault(); div.classList.add('dropover'); });
    div.addEventListener('dragleave', () => div.classList.remove('dropover'));
    div.addEventListener('drop', e => {
      e.preventDefault();
      div.classList.remove('dropover');
      if (dragIndex < 0 || dragIndex === i) return;
      const [moved] = RF.state.beats.splice(dragIndex, 1);
      RF.state.beats.splice(i, 0, moved);
      renderList(); RFEngine.emitChange();
    });

    return div;
  }

  function timeInput(label, b, prop, min) {
    const wrap = document.createElement('span');
    wrap.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:1px;min-width:0';
    const l = document.createElement('span');
    l.className = 'lbl'; l.textContent = label + ' s';
    const inp = document.createElement('input');
    inp.type = 'number'; inp.className = 'bt';
    inp.min = min; inp.max = 30; inp.step = 0.1; inp.value = b[prop];
    inp.addEventListener('change', () => {
      b[prop] = Math.max(min, parseFloat(inp.value) || min);
      inp.value = b[prop];
      els.total.textContent = fmtTime(RF.getTotalDuration()) + 's';
      RFEngine.emitChange();
    });
    wrap.append(l, inp);
    return wrap;
  }

  function nudgeInput(b, prop, label) {
    const wrap = document.createElement('span');
    wrap.style.cssText = 'flex:1;display:flex;align-items:center;gap:3px;min-width:0';
    const l = document.createElement('span'); l.className = 'lbl'; l.textContent = label;
    const inp = document.createElement('input');
    inp.type = 'number'; inp.className = 'bt'; inp.step = 20; inp.value = b[prop] || 0;
    inp.addEventListener('change', () => { b[prop] = parseFloat(inp.value) || 0; RFEngine.invalidateBeat(b.id); RFEngine.emitChange(); });
    wrap.append(l, inp);
    return wrap;
  }

  function easeSelect(label, b, prop) {
    const wrap = document.createElement('span');
    wrap.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:1px;min-width:0';
    const l = document.createElement('span'); l.className = 'lbl'; l.textContent = label + ' ease';
    const sel = document.createElement('select');
    for (const name of RFEngine.EASING_NAMES) {
      const o = document.createElement('option');
      o.value = name; o.textContent = name;
      if (name === b[prop]) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => { b[prop] = sel.value; RFEngine.emitChange(); });
    wrap.append(l, sel);
    return wrap;
  }

  // =================== fit to N seconds ===================
  function fitToSeconds(n) {
    const cur = RF.getTotalDuration();
    if (cur <= 0) return;
    const est = RFEngine.estDur();
    const k = Math.max(0.01, (n - est) / Math.max(0.01, cur - est));
    for (const b of RF.state.beats) {
      b.moveDur = Math.round(b.moveDur * k * 100) / 100;
      b.fxDur = Math.max(0.05, Math.round(b.fxDur * k * 100) / 100);
      b.hold = Math.round(b.hold * k * 100) / 100;
    }
    renderList();
    RFEngine.emitChange();
  }

  // =================== tap-sync mode ===================
  // Start → playback runs from 0; each Space tap marks when the NEXT beat's
  // highlight should land. Timings are rescaled so landings match the taps.
  const tap = { on: false, taps: [], t0: 0 };

  function toggleTapSync() {
    const btn = document.getElementById('tapsync-toggle');
    const status = document.getElementById('tapsync-status');
    if (tap.on) { endTapSync(false); return; }
    if (!RF.state.beats.length) { status.hidden = false; status.textContent = 'Add some beats first.'; setTimeout(() => status.hidden = true, 1800); return; }
    tap.on = true; tap.taps = [];
    btn.textContent = 'Stop tap-sync';
    btn.classList.add('armed');
    status.hidden = false;
    status.textContent = 'Tap SPACE when beat 1 of ' + RF.state.beats.length + ' should land…';
    RFEngine.player.seek(0);
    RFEngine.player.play();
    tap.t0 = performance.now();
  }

  function tapSyncKey(e) {
    if (!tap.on || e.code !== 'Space') return;
    e.preventDefault();
    tap.taps.push((performance.now() - tap.t0) / 1000);
    const status = document.getElementById('tapsync-status');
    const n = RF.state.beats.length;
    if (tap.taps.length >= n) { endTapSync(true); }
    else status.textContent = 'Beat ' + tap.taps.length + ' ✓ — tap SPACE for beat ' + (tap.taps.length + 1) + ' of ' + n + '…';
  }

  function endTapSync(apply) {
    const btn = document.getElementById('tapsync-toggle');
    const status = document.getElementById('tapsync-status');
    tap.on = false;
    btn.textContent = 'Start tap-sync';
    btn.classList.remove('armed');
    RFEngine.player.pause();

    if (apply && tap.taps.length) {
      const beats = RF.state.beats;
      const est = RFEngine.estDur();
      let prevEnd = est; // running end of the previous beat's segment
      for (let i = 0; i < tap.taps.length && i < beats.length; i++) {
        const b = beats[i];
        const land = Math.max(prevEnd + 0.15, tap.taps[i]); // tap = when the highlight lands
        // window from prevEnd to land holds move-in + highlight; keep their ratio
        const win = land - prevEnd;
        const ratio = b.moveDur / Math.max(0.05, b.moveDur + b.fxDur);
        b.moveDur = Math.round(win * ratio * 100) / 100;
        b.fxDur = Math.max(0.05, Math.round(win * (1 - ratio) * 100) / 100);
        // hold runs until the next tap (or keeps its own length on the last beat)
        if (i + 1 < tap.taps.length) {
          const next = Math.max(land + 0.1, tap.taps[i + 1]);
          b.hold = Math.round(Math.max(0, next - land) * 100) / 100;
          prevEnd = land + b.hold;
        } else {
          prevEnd = land + b.hold;
        }
      }
      status.textContent = 'Synced ' + Math.min(tap.taps.length, beats.length) + ' beats to your taps ✓';
      setTimeout(() => { status.hidden = true; }, 2200);
      renderList();
      RFEngine.emitChange();
      RFEngine.player.seek(0);
      RFEngine.player.play();
    } else {
      status.hidden = true;
    }
  }

  window.RFBeats = {
    makeBeat, selection, attachSelection, clearSelection, selectedText,
    init, renderList, updateSelectionUI, fitToSeconds,
    isTapSyncOn: () => tap.on
  };
})();
