/* Ekka — screens, table rendering, input and animations. */
(function () {
  'use strict';
  const { HostRoom, GuestClient, AVATARS, REACTIONS } = self.EkkaRoom;
  const Net = self.EkkaNet;
  const Sfx = self.EkkaSfx;
  const $ = (id) => document.getElementById(id);

  const app = $('app');
  const fx = $('fx');
  const tableEl = $('table');
  const seatsEl = $('seats');
  const handEl = $('hand');
  const handInner = $('handInner');
  const pileEl = $('pile');
  const deckEl = $('deck');
  const ringEl = $('ring');
  const statusEl = $('status');

  const COLOR_VAR = { r: 'var(--red)', y: 'var(--amber)', g: 'var(--green)', b: 'var(--blue)' };
  const COLOR_HEX = { r: '#f23d4f', y: '#ffc21a', g: '#1fba5e', b: '#2f80ff' };
  const COLOR_NAME = { r: 'Red', y: 'Yellow', g: 'Green', b: 'Blue' };
  const COLOR_ORDER = 'rygbw';
  const VALUE_ORDER = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'rev', 'all', 'd2', 'wild', 'd4', 'd6'];
  const MODE_NAME = { classic: 'Classic', timed: 'Timed', ruthless: 'Ruthless' };

  const SVG_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">';
  const twoTone = (paths) => SVG_OPEN + '<g class="bk" stroke-width="6.4">' + paths + '</g><g stroke="#fff" stroke-width="3.1">' + paths + '</g></svg>';
  const SVG_HOP = twoTone('<path d="M3.500 15c1.500-8 12-9.500 16-1.500"/><path d="M20.500 6.500v7h-7"/><path d="M7 19.500h.01"/>');
  const SVG_FLIP = twoTone('<path d="M4 8.500h14.500l-4-4"/><path d="M20 15.500H5.500l4 4"/>');
  const SVG_ALL = twoTone('<path d="M2.500 13.500c.8-5.500 6.200-6.500 8.500-1.500"/><path d="M11.500 7.500v5H7"/><path d="M12.500 13.500c.8-5.500 6.200-6.500 8.500-1.500"/><path d="M21.500 7.500v5H17"/><path d="M5 19h.01M12 19h.01M19 19h.01"/>');

  let session = null;
  let lobby = null;
  let V = null;            // the view currently on screen
  let animating = false;
  let queue = Promise.resolve();
  let wasMyTurn = false;
  let pendingWild = null;
  let qrFor = '';
  const handEls = new Map();
  let seatEls = {};
  let seatOrder = [];
  let HL = null;           // last hand layout, for hit-testing a finger sliding along the fan
  let drag = null;

  /* ---------- storage ---------- */
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* noop */ } },
  };
  function getPid() {
    const s = Net.local ? sessionStorage : localStorage;
    try {
      let p = s.getItem('ekka.pid');
      if (!p) { p = 'p-' + Math.random().toString(36).slice(2, 12); s.setItem('ekka.pid', p); }
      return p;
    } catch (e) { return 'p-' + Math.random().toString(36).slice(2, 12); }
  }
  const pid = getPid();
  let myAv = store.get('ekka.av');
  if (!AVATARS.includes(myAv)) myAv = AVATARS[Math.floor(Math.random() * AVATARS.length)];

  /* ---------- small helpers ---------- */
  const sleep = (ms) => new Promise((r) => setTimeout(r, document.hidden ? 0 : ms));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function buzz(p) { if (navigator.vibrate) { try { navigator.vibrate(p); } catch (e) { /* noop */ } } }
  function show(name) {
    if (app.dataset.screen === name) return false;
    app.dataset.screen = name;
    if (name === 'table') keepAwake();
    return true;
  }
  let toastTimer = null;
  function toast(text, ms) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms || 2200);
  }
  let wake = null;
  async function keepAwake() {
    try { if (navigator.wakeLock && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch (e) { /* not allowed */ }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && app.dataset.screen === 'table') keepAwake(); });
  function quake() {
    if (document.hidden) return;
    tableEl.classList.remove('quake'); void tableEl.offsetWidth; tableEl.classList.add('quake');
    setTimeout(() => tableEl.classList.remove('quake'), 420);
  }
  const fmtClock = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

  /* ---------- cards ---------- */
  function glyph(card, corner) {
    switch (card.v) {
      case 'skip': return SVG_HOP;
      case 'rev': return SVG_FLIP;
      case 'all': return SVG_ALL;
      case 'd2': return '+2';
      case 'wild': return '<span class="wheel"></span>';
      case 'd4': return corner ? '+4' : '<span class="wheel">+4</span>';
      case 'd6': return corner ? '+6' : '<span class="wheel">+6</span>';
      default: return card.v;
    }
  }
  function makeCard(card) {
    const el = document.createElement('div');
    el.className = 'card c-' + card.c;
    el.dataset.id = card.id;
    const ul = card.v === '6' || card.v === '9' ? ' ul' : '';
    const txt = card.v === 'd2' ? ' txt' : '';
    const g = glyph(card, true);
    el.innerHTML =
      '<span class="cn tl' + ul + '">' + g + '<i class="shape"></i></span>' +
      '<div class="page"><span class="big' + txt + '">' + glyph(card, false) + '</span></div>' +
      '<span class="cn br' + ul + '">' + g + '<i class="shape"></i></span>';
    return el;
  }
  function makeBack() {
    const el = document.createElement('div');
    el.className = 'card back';
    el.innerHTML = '<div class="page"><span class="big">E!</span></div>';
    return el;
  }
  const sortKey = (c) => COLOR_ORDER.indexOf(c.c) * 100 + VALUE_ORDER.indexOf(c.v);
  const sortedHand = () => V.hand.slice().sort((a, b) => sortKey(a) - sortKey(b));
  const cardW = () => $('probe').getBoundingClientRect().width || 70;

  /* ---------- geometry + flights ---------- */
  function rectOf(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width };
  }
  function seatPoint(pi) {
    if (V && pi === V.you) {
      const r = handEl.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height * 0.6, w: cardW() };
    }
    const el = seatEls[pi];
    if (!el) return { x: innerWidth / 2, y: 60, w: 18 };
    const r = el.querySelector('.fan').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height * 0.45, w: 18 };
  }
  function avatarPoint(pi) {
    const el = V && pi === V.you ? $('meChip') : seatEls[pi];
    if (!el) return { x: innerWidth / 2, y: innerHeight / 2 };
    const r = (el.querySelector('.av-wrap') || el).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, h: r.height };
  }
  const pileRot = (id) => ((id * 37) % 23) - 11;

  function fly(o) {
    if (document.hidden) return Promise.resolve();
    const cw = cardW();
    const g = document.createElement('div');
    g.className = 'ghost';
    const f = document.createElement('div');
    f.className = 'flip';
    const front = o.card ? makeCard(o.card) : makeBack();
    const rev = makeBack();
    rev.classList.add('rev');
    f.append(front, rev);
    g.append(f);
    const s0 = o.from.w / cw, s1 = o.to.w / cw;
    const t0 = `translate(${o.from.x}px, ${o.from.y}px) scale(${s0}) rotate(${o.rot0 || 0}deg)`;
    const mx = (o.from.x + o.to.x) / 2, my = (o.from.y + o.to.y) / 2 - 22;
    const tm = `translate(${mx}px, ${my}px) scale(${Math.max(s0, s1) * 1.14}) rotate(${((o.rot0 || 0) + (o.rot1 || 0)) / 2}deg)`;
    const t1 = `translate(${o.to.x}px, ${o.to.y}px) scale(${s1}) rotate(${o.rot1 || 0}deg)`;
    g.style.transform = t0;
    f.style.transform = `rotateY(${o.fromFace ? 0 : 180}deg)`;
    fx.append(g);
    const opts = { duration: o.dur || 400, delay: o.delay || 0, easing: 'cubic-bezier(.35,.6,.3,1)', fill: 'both' };
    const a = g.animate([{ transform: t0 }, { transform: tm }, { transform: t1 }], opts);
    f.animate([{ transform: `rotateY(${o.fromFace ? 0 : 180}deg)` }, { transform: `rotateY(${o.toFace ? 0 : 180}deg)` }], opts);
    const done = () => g.remove();
    return a.finished.then(done, done);
  }

  function burst(text, pt, cls, life) {
    if (document.hidden) return;
    const el = document.createElement('div');
    el.className = 'burst ' + (cls || '');
    el.textContent = text;
    fx.append(el);
    const half = el.offsetWidth / 2 + 8;
    const x = clamp(pt.x, half, Math.max(half, innerWidth - half));
    const base = `translate(${x}px, ${pt.y}px) translate(-50%, -50%)`;
    const a = el.animate([
      { transform: base + ' scale(.2) rotate(-14deg)', opacity: 0 },
      { transform: base + ' scale(1.2) rotate(-6deg)', opacity: 1, offset: 0.25 },
      { transform: base + ' scale(1) rotate(-6deg)', opacity: 1, offset: 0.7 },
      { transform: base + ' translateY(-26px) scale(1) rotate(-6deg)', opacity: 0 },
    ], { duration: life || 1000, easing: 'ease-out', fill: 'both' });
    a.finished.then(() => el.remove(), () => el.remove());
  }
  const centerPt = () => { const r = pileEl.getBoundingClientRect(); return { x: innerWidth / 2, y: r.top - 44 }; };
  const midPt = () => { const r = $('felt').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  function seatBurstPt(pi) {
    if (V && pi === V.you) { const p = seatPoint(pi); return { x: p.x, y: p.y - cardW() * 1.15 }; }
    const p = avatarPoint(pi);
    return { x: p.x, y: p.y + (p.h || 50) * 0.5 + 62 };
  }

  function wave(color) {
    if (document.hidden) return;
    const p = rectOf(pileEl);
    const el = document.createElement('div');
    el.className = 'wave';
    el.style.setProperty('--wc', COLOR_HEX[color]);
    fx.append(el);
    const base = `translate(${p.x}px, ${p.y}px)`;
    const a = el.animate([{ transform: base + ' scale(1)', opacity: 0.55 }, { transform: base + ' scale(34)', opacity: 0 }], { duration: 700, easing: 'ease-out', fill: 'both' });
    a.finished.then(() => el.remove(), () => el.remove());
  }

  function confetti(n) {
    if (document.hidden) return;
    const cols = Object.values(COLOR_HEX).concat('#ffc736', '#ffffff');
    for (let i = 0; i < n; i++) {
      const el = document.createElement('div');
      el.className = 'confetti';
      el.style.background = cols[i % cols.length];
      el.style.left = Math.random() * 100 + 'vw';
      fx.append(el);
      const dx = (Math.random() - 0.5) * 220;
      const a = el.animate([
        { transform: 'translate(0, 0) rotate(0deg)', opacity: 1 },
        { transform: `translate(${dx}px, ${innerHeight + 60}px) rotate(${(Math.random() - 0.5) * 1400}deg)`, opacity: 0.9 },
      ], { duration: 1700 + Math.random() * 1800, delay: Math.random() * 500, easing: 'cubic-bezier(.2,.5,.5,1)', fill: 'both' });
      a.finished.then(() => el.remove(), () => el.remove());
    }
  }

  /* a reaction pops out of whoever sent it */
  function showReact(pi, e) {
    if (!V || document.hidden || app.dataset.screen !== 'table') return;
    const p = avatarPoint(pi);
    const mine = pi === V.you;
    const el = document.createElement('div');
    el.className = 'react-pop';
    el.textContent = e;
    fx.append(el);
    const x = clamp(p.x + (mine ? 26 : 0), 30, innerWidth - 30);
    const y = mine ? p.y - 34 : p.y + 6;
    const base = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    const a = el.animate([
      { transform: base + ' scale(.2) rotate(-20deg)', opacity: 0 },
      { transform: base + ' scale(1.5) rotate(8deg)', opacity: 1, offset: 0.18 },
      { transform: base + ' scale(1.15) rotate(-4deg)', opacity: 1, offset: 0.4 },
      { transform: base + ' translateY(-8px) scale(1.2) rotate(4deg)', opacity: 1, offset: 0.75 },
      { transform: base + ' translateY(-48px) scale(1.1)', opacity: 0 },
    ], { duration: 1900, easing: 'ease-out', fill: 'both' });
    a.finished.then(() => el.remove(), () => el.remove());
    Sfx.play('pop');
  }

  /* ---------- rendering: seats ---------- */
  function renderSeats() {
    const n = V.players.length;
    const order = [];
    for (let k = 1; k < n; k++) order.push((V.you + k) % n);
    const key = order.join(',') + '|' + V.players.map((p) => p.name + p.av).join('\u0001');
    if (seatsEl.dataset.key !== key) {
      seatsEl.dataset.key = key;
      seatsEl.innerHTML = '';
      seatsEl.classList.toggle('compact', order.length > 3);
      seatEls = {};
      order.forEach((pi) => {
        const p = V.players[pi];
        const el = document.createElement('div');
        el.className = 'seat';
        el.innerHTML =
          '<div class="av-wrap"><svg class="tring" viewBox="0 0 60 60"><circle cx="30" cy="30" r="27"/></svg><div class="avatar">' + esc(p.av || '🙂') + '</div></div>' +
          '<span class="sname">' + esc(p.name) + '</span>' +
          '<div class="fan"><b class="count">0</b></div>';
        seatsEl.append(el);
        seatEls[pi] = el;
      });
    }
    seatOrder = order;
    placeSeats();
    order.forEach((pi) => {
      const el = seatEls[pi];
      el.classList.toggle('turn', V.phase === 'play' && V.turn === pi);
      el.classList.toggle('away', !!(V.away && V.away[pi]));
      el.classList.toggle('out', !!V.players[pi].out);
      setCount(pi, V.players[pi].count);
    });
    const me = V.players[V.you];
    $('meAv').textContent = me.av || '🙂';
    $('meCount').textContent = V.hand.length;
    $('meChip').classList.toggle('turn', V.phase === 'play' && V.turn === V.you);
    $('meChip').classList.toggle('out', !!me.out);
  }
  /* opponents sit around the top arc of the table, in turn order from my left */
  const SPANS = [0, 96, 150, 184, 200, 208, 214];
  function placeSeats() {
    const m = seatOrder.length;
    if (!m) return;
    const A = $('arena').getBoundingClientRect();
    const F = $('felt').getBoundingClientRect();
    if (!F.width) return;
    const cx = F.left - A.left + F.width / 2, cy = F.top - A.top + F.height / 2;
    const rx = F.width / 2 - 5, ry = F.height / 2 - 5;
    const span = SPANS[Math.min(m, SPANS.length) - 1];
    const pad = seatsEl.classList.contains('compact') ? 34 : 44;
    seatOrder.forEach((pi, idx) => {
      const deg = m > 1 ? 270 - span / 2 + (span * idx) / (m - 1) : 270;
      const a = (deg * Math.PI) / 180;
      const c = Math.cos(a), s = Math.sin(a);
      // superellipse: hugs the rounded-rectangle rim better than a plain ellipse
      let x = cx + rx * Math.sign(c) * Math.pow(Math.abs(c), 0.72);
      let y = cy + ry * Math.sign(s) * Math.pow(Math.abs(s), 0.72);
      x = clamp(x, pad, A.width - pad);
      y = Math.max(34, y);
      const el = seatEls[pi];
      el.style.setProperty('--sx', x.toFixed(1) + 'px');
      el.style.setProperty('--sy', y.toFixed(1) + 'px');
    });
  }

  function setCount(pi, n, bump) {
    const el = seatEls[pi];
    if (!el) return;
    const fan = el.querySelector('.fan');
    const c = fan.querySelector('.count');
    const k = Math.min(n, seatsEl.classList.contains('compact') ? 4 : 5);
    const have = fan.querySelectorAll('i');
    if (have.length !== k) {
      have.forEach((x) => x.remove());
      for (let i = 0; i < k; i++) {
        const card = document.createElement('i');
        card.style.setProperty('--i', i);
        card.style.setProperty('--n', k);
        fan.insertBefore(card, c);
      }
    }
    if (c.textContent !== String(n)) {
      c.textContent = n;
      if (bump) { c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump'); }
    }
    c.classList.toggle('hot', n === 1 || (V.bust > 0 && n >= V.bust - 3));
    let flag = el.querySelector('.flag');
    const showFlag = n === 1 && V.phase === 'play' && V.uncalled !== pi;
    if (showFlag && !flag) { flag = document.createElement('span'); flag.className = 'flag'; flag.textContent = 'Ekka!'; el.append(flag); }
    if (!showFlag && flag) flag.remove();
  }

  /* ---------- rendering: hand ---------- */
  function renderHand(hiddenIds) {
    const cards = sortedHand();
    const keep = new Set(cards.map((c) => c.id));
    for (const [id, el] of handEls) if (!keep.has(id)) { el.remove(); handEls.delete(id); }
    const myTurn = !animating && V.phase === 'play' && V.turn === V.you;
    const ok = new Set(myTurn ? V.playable : []);
    cards.forEach((c) => {
      let el = handEls.get(c.id);
      if (!el) {
        el = makeCard(c);
        if (hiddenIds && hiddenIds.has(c.id)) el.classList.add('hidden');
        handEls.set(c.id, el);
        handInner.append(el);
      }
      el.classList.toggle('ok', ok.has(c.id));
    });
    handEl.classList.toggle('myturn', myTurn);
    $('meCount').textContent = cards.length;
    layoutHand(cards);
  }
  /* one fanned row; a crowded hand splits into two so every card stays reachable */
  function layoutHand(cards) {
    cards = cards || sortedHand();
    const n = cards.length;
    const cw = cardW(), ch = cw * 1.45;
    const W = handEl.clientWidth - 20;
    const sideOf = (spread) => Math.sin((spread * Math.PI) / 180) * ch * 0.75 + 4;
    const fit1 = n > 1 ? (W - sideOf(Math.min(12, n * 1.7)) * 2 - cw) / (n - 1) : cw;
    const two = n > 7 && fit1 < cw * 0.34;
    const cut = Math.ceil(n / 2);
    const rows = two ? [cards.slice(0, cut), cards.slice(cut)] : [cards];
    const rowLift = two ? ch * 0.46 : 0;
    handInner.style.setProperty('--rowlift', rowLift.toFixed(1) + 'px');
    HL = { rows: [], rowLift, top: 40 };
    let z = 1;
    rows.forEach((row, ri) => {
      const m = row.length;
      const spread = Math.min(two ? 8 : 12, m * 1.7);
      const room = W - sideOf(spread) * 2;
      const fit = m > 1 ? (room - cw) / (m - 1) : 0;
      const gap = m > 1 ? clamp(fit, cw * 0.18, cw * 0.66) : 0;
      const total = cw + gap * (m - 1);
      const x0 = (W - total) / 2;
      const yBase = two && ri === 1 ? rowLift : 0;
      row.forEach((c, i) => {
        const el = handEls.get(c.id);
        if (!el) return;
        const t = m > 1 ? (i / (m - 1)) * 2 - 1 : 0;
        el.style.setProperty('--x', (x0 + i * gap).toFixed(1) + 'px');
        el.style.setProperty('--y', (yBase + t * t * cw * 0.14).toFixed(1) + 'px');
        el.style.setProperty('--r', (t * spread).toFixed(1) + 'deg');
        el.style.zIndex = z++;
      });
      HL.rows.push({ ids: row.map((c) => c.id), x0, gap, cw });
    });
  }
  /* which card is under a finger sliding along the hand */
  function cardAt(clientX, clientY) {
    if (!HL || !HL.rows.length) return null;
    const r = handInner.getBoundingClientRect();
    const x = clientX - r.left, y = clientY - r.top;
    const row = HL.rows.length > 1 && y >= HL.top + HL.rowLift ? HL.rows[1] : HL.rows[0];
    if (!row.ids.length) return null;
    const i = row.gap > 0 ? clamp(Math.floor((x - row.x0) / row.gap), 0, row.ids.length - 1) : 0;
    return row.ids[i];
  }

  /* ---------- rendering: piles + status ---------- */
  function pileCard(card, land) {
    const el = makeCard(card);
    el.style.setProperty('--rot', pileRot(card.id) + 'deg');
    el.style.setProperty('--dx', ((card.id * 13) % 11) - 5 + 'px');
    el.style.setProperty('--dy', ((card.id * 7) % 9) - 4 + 'px');
    if (land) el.classList.add('land');
    pileEl.append(el);
    while (pileEl.children.length > 5) pileEl.firstChild.remove();
    return el;
  }
  function renderPile(land) {
    if (!V.top) { pileEl.innerHTML = ''; return; }
    const last = pileEl.lastElementChild;
    if (!last || last.dataset.id !== String(V.top.id)) pileCard(V.top, land);
    const topEl = pileEl.lastElementChild;
    topEl.classList.toggle('tinted', V.top.c === 'w');
    applyColor();
  }
  function applyColor() {
    app.style.setProperty('--active', COLOR_VAR[V.color] || 'var(--purple)');
    const chip = $('colorChip');
    chip.className = 'color-chip k-' + V.color;
    chip.lastElementChild.textContent = COLOR_NAME[V.color] || '';
  }
  function renderStatus() {
    const me = V.you;
    const playing = V.phase === 'play';
    const myTurn = playing && V.turn === me && !animating;
    const out = V.players[me].out;
    let text = '';
    if (playing) {
      const cur = V.players[V.turn];
      if (V.turn === me) {
        const ruthless = V.mode === 'ruthless';
        if (V.pending > 0) text = V.playable.length ? `Stack it, or draw ${V.pending}` : `Ouch. Draw ${V.pending}`;
        else if (V.drewId != null) text = 'It fits! Play it or keep it';
        else if (V.playable.length) text = store.get('ekka.tip') ? 'Your turn' : 'Your turn: tap a card or flick it up';
        else text = ruthless ? 'Nothing fits. Draw until it does' : 'Nothing fits. Draw a card';
      } else if (out) text = `You're out this round · ${cur.name}'s turn`;
      else if (V.away && V.away[V.turn]) text = `Waiting for ${cur.name} to come back…`;
      else text = cur.bot ? `${cur.name} is thinking…` : `${cur.name}'s turn`;
    }
    $('statusText').textContent = text;
    statusEl.classList.toggle('empty', !text);
    statusEl.classList.toggle('mine', playing && V.turn === me);

    const canDraw = myTurn && V.drewId == null;
    deckEl.classList.toggle('can', canDraw);
    deckEl.classList.toggle('nudge', canDraw && !V.playable.length);
    $('deckHint').textContent = V.pending > 0 ? 'Draw ' + V.pending : 'Draw';

    $('btnPass').hidden = !(myTurn && V.drewId != null);
    const mustCall = playing && V.uncalled === me;
    const mayCall = myTurn && V.hand.length === 2 && V.playable.length > 0 && !V.called;
    const bc = $('btnCall');
    bc.hidden = !(mustCall || mayCall);
    bc.classList.toggle('urgent', mustCall);
    const canCatch = playing && V.uncalled != null && V.uncalled !== me && !out;
    const bt = $('btnCatch');
    bt.hidden = !canCatch;
    if (canCatch) bt.textContent = 'Catch ' + V.players[V.uncalled].name + '!';

    if (!myTurn && pendingWild != null) closePicker(); // the turn moved on while the colour wheel was open
    const pend = $('pending');
    pend.hidden = !(V.pending > 0);
    pend.textContent = '+' + V.pending;
    ringEl.classList.toggle('ccw', V.dir < 0);

    const mine = playing && V.turn === me;
    if (mine && !wasMyTurn) { Sfx.play('turn'); buzz(50); }
    wasMyTurn = mine;
  }

  /* ---------- timers: the turn countdown and the match clock ---------- */
  let ringAnim = null, barAnim = null, hurryTimer = null, tickTimer = null;
  function clearTimerFx() {
    if (ringAnim) { ringAnim.cancel(); ringAnim = null; }
    if (barAnim) { barAnim.cancel(); barAnim = null; }
    clearTimeout(hurryTimer); clearInterval(tickTimer);
    statusEl.classList.remove('hurry');
    for (const k in seatEls) seatEls[k].classList.remove('timed');
  }
  function armTimerFx() {
    clearTimerFx();
    if (!V || V.phase !== 'play' || V.turnLeft == null || animating || document.hidden) return;
    const total = V.turnTotal || 1;
    const left = Math.min(total, V.turnLeft - (Date.now() - V._at));
    if (left <= 0) return;
    if (V.turn === V.you) {
      barAnim = $('tbar').animate([{ transform: `scaleX(${left / total})` }, { transform: 'scaleX(0)' }], { duration: left, fill: 'forwards' });
      const hurryAt = Math.min(5000, total * 0.25);
      hurryTimer = setTimeout(() => {
        statusEl.classList.add('hurry');
        Sfx.play('tick'); buzz(30);
        tickTimer = setInterval(() => Sfx.play('tick'), 1000);
      }, Math.max(0, left - hurryAt));
    } else {
      const el = seatEls[V.turn];
      if (!el) return;
      el.classList.add('timed');
      const C = 2 * Math.PI * 27;
      ringAnim = el.querySelector('.tring circle').animate(
        [{ strokeDasharray: `${(C * left) / total} ${C}`, stroke: '#ffc736' }, { strokeDasharray: `0 ${C}`, stroke: '#f23d4f' }],
        { duration: left, fill: 'forwards' });
    }
  }
  function paintClock() {
    const el = $('clock');
    const c = V && V.clock;
    if (!c || app.dataset.screen !== 'table') { el.hidden = true; return; }
    const left = c.running && V.phase === 'play' ? c.left - (Date.now() - V._at) : c.left;
    el.hidden = false;
    el.textContent = '⏱ ' + fmtClock(left);
    el.classList.toggle('low', V.phase === 'play' && left < Math.min(30000, c.total * 0.15));
  }
  setInterval(paintClock, 250);

  /* ---------- round over ---------- */
  function renderOver() {
    const box = $('roundOver');
    if (V.phase !== 'over') { box.hidden = true; return; }
    const w = V.players[V.winner];
    const iWon = V.winner === V.you;
    const reveal = V.reveal || V.players.map(() => ({ cards: [], pts: 0 }));
    const rows = V.players.map((p, i) => ({ p, i, r: reveal[i] })).sort((a, b) => b.p.score - a.p.score || (a.i === V.winner ? -1 : b.i === V.winner ? 1 : 0));
    if (V.final) {
      const champ = rows[0];
      $('overKicker').textContent = 'Match over';
      $('overTitle').textContent = champ.i === V.you ? '🏆 You win the match!' : `🏆 ${champ.p.name} wins the match!`;
      $('overSub').textContent = V.why === 'time'
        ? `Time! ${iWon ? 'You were' : w.name + ' was'} holding the lightest hand: +${V.points}`
        : `${iWon ? 'You' : w.name} took the last round: +${V.points}`;
    } else {
      $('overKicker').textContent = 'Round ' + V.round + (V.clock ? ' · ' + fmtClock(V.clock.left) + ' left' : '');
      $('overTitle').textContent = iWon ? 'You win!' : w.name + ' wins!';
      $('overSub').textContent = V.why === 'last' ? `Last one standing: +${V.points} points`
        : V.points ? `+${V.points} points from the cards everyone was left holding` : 'A clean sweep';
    }
    const list = $('overScores');
    list.innerHTML = '';
    rows.forEach(({ p, i, r }) => {
      const li = document.createElement('li');
      const win = i === V.winner;
      if (win) li.className = 'win';
      li.innerHTML =
        '<div class="avatar">' + esc(p.av || '🙂') + '</div>' +
        '<div class="who"><span class="nm">' + (win ? '👑 ' : '') + esc(p.name) + (i === V.you ? ' <em>(you)</em>' : '') + '</span><div class="left"></div></div>' +
        '<div class="tot">' + p.score + '<small>' + (win ? '+' + V.points : r.out ? 'knocked out' : r.pts + ' in hand') + '</small></div>';
      const left = li.querySelector('.left');
      const cards = r.cards.slice().sort((a, b) => sortKey(a) - sortKey(b));
      if (!cards.length) {
        const note = document.createElement('span');
        note.className = 'note';
        note.textContent = win ? 'Played every card' : r.out ? `Held ${V.bust} cards · ${r.pts} points` : '';
        left.append(note);
      } else {
        cards.slice(0, 10).forEach((c) => left.append(makeCard(c)));
        if (cards.length > 10) { const more = document.createElement('span'); more.className = 'more'; more.textContent = '+' + (cards.length - 10); left.append(more); }
      }
      list.append(li);
    });
    const host = lobby && lobby.isHost;
    $('btnNext').hidden = !host;
    $('btnNext').textContent = V.final ? 'New match' : 'Next round';
    $('btnToLobby').hidden = !host;
    $('btnToLobby').textContent = lobby && lobby.solo ? 'Change mode' : 'Back to the room';
    $('overWait').hidden = !!host;
    box.hidden = false;
  }

  function renderAll() {
    const mode = MODE_NAME[V.mode] || 'Ekka';
    $('tableCode').innerHTML = esc(mode) + (lobby && !lobby.solo ? '<small>Room ' + esc(lobby.code) + '</small>' : '');
    renderSeats();
    renderPile(false);
    renderHand();
    renderStatus();
    renderOver();
    armTimerFx();
    paintClock();
  }

  /* ---------- event animations ---------- */
  async function animDeal(fin) {
    $('roundOver').hidden = true;
    closePicker();
    V = Object.assign({}, fin, {
      hand: [], top: null, phase: 'play',
      players: fin.players.map((p) => Object.assign({}, p, { count: 0 })),
    });
    pileEl.innerHTML = '';
    animating = true;
    renderAll();
    await sleep(380);
    const n = fin.players.length;
    const per = fin.hand.length || 7;
    const step = Math.min(48, 1500 / (per * n));
    const from = rectOf(deckEl);
    const flights = [];
    const counts = fin.players.map(() => 0);
    for (let r = 0; r < per; r++) {
      for (let k = 0; k < n; k++) {
        const pi = (fin.turn + k) % n;
        const delay = (r * n + k) * step;
        if (k === 0 && r % 2 === 0) setTimeout(() => Sfx.play('deal'), delay);
        flights.push(fly({ from, to: seatPoint(pi), card: null, fromFace: false, toFace: false, dur: 320, delay, rot1: (Math.random() - 0.5) * 30 }).then(() => {
          counts[pi]++;
          if (pi !== fin.you) setCount(pi, counts[pi]);
        }));
      }
    }
    await Promise.all(flights);
    V.hand = fin.hand.slice();
    V.players = fin.players.map((p) => Object.assign({}, p));
    renderSeats();
    renderHand();
    for (const el of handEls.values()) el.classList.add('fresh');
    await sleep(260);
    Sfx.play('play');
    await fly({ from, to: rectOf(pileEl), card: fin.top, fromFace: false, toFace: true, dur: 460, rot1: pileRot(fin.top.id) });
    V.top = fin.top;
    V.color = fin.color;
    renderPile(true);
    await sleep(200);
  }

  async function animPlay(ev) {
    const mine = ev.p === V.you;
    let from;
    let thrown = false;
    if (mine) {
      const el = handEls.get(ev.card.id);
      thrown = !!(el && el.classList.contains('drag'));
      from = el ? rectOf(el) : seatPoint(ev.p);
      if (thrown) from.w = cardW() * 1.1;
      if (el) { el.remove(); handEls.delete(ev.card.id); }
      V.hand = V.hand.filter((c) => c.id !== ev.card.id);
      $('meCount').textContent = V.hand.length;
      layoutHand();
      store.set('ekka.tip', '1');
    } else {
      from = seatPoint(ev.p);
    }
    V.players[ev.p].count = Math.max(0, V.players[ev.p].count - 1);
    if (!mine) setCount(ev.p, V.players[ev.p].count, true);
    Sfx.play('play');
    await fly({ from, to: rectOf(pileEl), card: ev.card, fromFace: mine, toFace: true, dur: thrown ? 230 : mine ? 330 : 430, rot0: mine ? 0 : -20, rot1: pileRot(ev.card.id) });
    V.top = ev.card;
    V.color = ev.color;
    renderPile(true);
    const v = ev.card.v;
    if (ev.card.c === 'w') { wave(ev.color); Sfx.play('wild'); }
    if (v === 'd2' || v === 'd4' || v === 'd6') {
      Sfx.play('plus');
      if (!V.opts.stack) burst('+' + v.slice(1), centerPt(), 'red', 900);
    }
    if (ev.card.c === 'w') await sleep(320);
    else await sleep(120);
  }

  async function animDraw(ev) {
    const mine = ev.p === V.you;
    const from = rectOf(deckEl);
    const flights = [];
    const hit = ev.why === 'penalty' || ev.why === 'caught';
    if (hit && (mine || ev.n >= 4)) { quake(); if (mine) buzz([40, 60, 90]); }
    const stepMs = ev.n > 4 ? 90 : 130;
    if (mine && ev.cards) {
      const ids = new Set(ev.cards.map((c) => c.id));
      V.hand = V.hand.concat(ev.cards);
      V.players[ev.p].count += ev.n;
      renderHand(ids);
      // let the hand settle so each flight lands on its slot
      await sleep(40);
      ev.cards.forEach((card, i) => {
        const el = handEls.get(card.id);
        const delay = i * stepMs;
        setTimeout(() => Sfx.play('draw'), delay);
        const to = el ? rectOf(el) : seatPoint(ev.p);
        flights.push(fly({ from, to, card, fromFace: false, toFace: true, dur: 430, delay }).then(() => {
          if (el) { el.classList.remove('hidden'); el.classList.add('fresh'); }
        }));
      });
    } else {
      const to = seatPoint(ev.p);
      for (let i = 0; i < ev.n; i++) {
        const delay = i * (stepMs - 10);
        setTimeout(() => Sfx.play('draw'), delay);
        flights.push(fly({ from, to, card: null, fromFace: false, toFace: false, dur: 380, delay, rot1: 25 }).then(() => {
          V.players[ev.p].count++;
          setCount(ev.p, V.players[ev.p].count, true);
        }));
      }
    }
    if (ev.why === 'penalty' && V.opts.stack) burst('+' + ev.n, seatBurstPt(ev.p), 'small red', 900);
    await Promise.all(flights);
    for (const el of handEls.values()) el.classList.remove('hidden');
    await sleep(80);
  }

  function zap(pi) {
    const el = seatEls[pi];
    if (!el) return;
    el.classList.remove('zap'); void el.offsetWidth; el.classList.add('zap');
    setTimeout(() => el.classList.remove('zap'), 520);
  }

  async function playEvent(ev, fin) {
    switch (ev.t) {
      case 'deal': await animDeal(fin); break;
      case 'play': await animPlay(ev); break;
      case 'draw': await animDraw(ev); break;
      case 'skip':
        Sfx.play('skip');
        zap(ev.p);
        if (ev.p === V.you) buzz(60);
        burst(ev.p === V.you ? 'You got hopped!' : 'Hopped!', seatBurstPt(ev.p), 'small white', 900);
        await sleep(420);
        break;
      case 'skipall':
        Sfx.play('skip');
        seatOrder.forEach((pi) => { if (pi !== ev.p) zap(pi); });
        burst(ev.p === V.you ? 'Hop all! Go again' : 'Hop all!', centerPt(), 'white', 950);
        await sleep(480);
        break;
      case 'rev':
        V.dir = ev.dir;
        Sfx.play('rev');
        ringEl.classList.toggle('ccw', V.dir < 0);
        ringEl.classList.add('flash');
        setTimeout(() => ringEl.classList.remove('flash'), 700);
        burst('Flip!', centerPt(), 'small white', 800);
        await sleep(420);
        break;
      case 'call':
        $('btnCatch').hidden = true; $('btnCall').hidden = true;
        Sfx.play('call');
        burst('EKKA!', seatBurstPt(ev.p), '', 1100);
        await sleep(520);
        break;
      case 'catch':
        $('btnCatch').hidden = true; $('btnCall').hidden = true;
        Sfx.play('caught');
        zap(ev.p);
        burst(ev.p === V.you ? 'Caught! +2' : `${V.players[ev.by].name} caught ${V.players[ev.p].name}!`, ev.p === V.you ? seatBurstPt(ev.p) : centerPt(), 'small red', 1300);
        await sleep(450);
        break;
      case 'bust':
        Sfx.play('out');
        quake();
        V.players[ev.p].out = true;
        V.players[ev.p].count = 0;
        if (ev.p === V.you) { V.hand = []; buzz([80, 60, 160]); renderHand(); }
        renderSeats();
        burst(ev.p === V.you ? "You're out!" : V.players[ev.p].name + ' is out!', ev.p === V.you ? seatBurstPt(ev.p) : midPt(), 'red', 1300);
        await sleep(800);
        break;
      case 'timeout':
        Sfx.play('nope');
        burst('Too slow!', seatBurstPt(ev.p), 'small white', 850);
        await sleep(350);
        break;
      case 'timeup':
        clearTimerFx();
        Sfx.play('time');
        quake();
        buzz([120, 80, 120]);
        burst("Time's up!", midPt(), 'huge', 1600);
        await sleep(1400);
        break;
      case 'shuffle': toast('Deck ran out. Reshuffled the pile.'); break;
      case 'win': {
        const match = fin.final;
        if (ev.p === fin.you) { Sfx.play('win'); confetti(match ? 140 : 90); burst(ev.why === 'last' ? 'Last one standing!' : 'You win!', centerPt(), '', 1400); buzz([60, 40, 60, 40, 160]); }
        else { Sfx.play('lose'); confetti(24); burst(fin.players[ev.p].name + ' wins!', centerPt(), 'white', 1400); }
        await sleep(1100);
        break;
      }
      default: break;
    }
  }

  /* ---------- sync from the host ---------- */
  function onSync(msg) {
    if (msg.view) msg.view._at = Date.now();
    queue = queue.then(() => applySync(msg)).catch((e) => { console.error(e); animating = false; });
  }

  async function applySync(msg) {
    if (!session) return;
    const prev = lobby;
    lobby = msg.lobby;
    if (!msg.view) {
      V = null;
      wasMyTurn = false;
      clearTimerFx();
      $('roundOver').hidden = true;
      closePicker();
      renderLobby();
      show('lobby');
      if (prev && lobby.players.length > prev.players.length) Sfx.play('join');
      return;
    }
    show('table');
    const v = msg.view;
    const evs = msg.events || [];
    const isDeal = evs.length && evs[0].t === 'deal';
    if (msg.full || !evs.length || document.hidden || (!V && !isDeal)) {
      V = v;
      animating = false;
      renderAll();
      return;
    }
    animating = true;
    clearTimerFx();
    handEl.classList.remove('myturn');
    for (const el of handEls.values()) el.classList.remove('ok');
    deckEl.classList.remove('can', 'nudge');
    if (statusEl.classList.contains('mine')) { $('statusText').textContent = ''; statusEl.classList.remove('mine'); statusEl.classList.add('empty'); }
    try {
      for (const ev of evs) await playEvent(ev, v);
    } finally {
      animating = false;
    }
    V = v;
    renderAll();
  }

  /* ---------- lobby ---------- */
  function inviteUrl(code) {
    return location.origin + location.pathname + '?room=' + code + (Net.local ? '&local=1' : '');
  }
  const MODE_NOTE = {
    classic: () => 'Play round after round. The scoreboard keeps a running total, and you stop when you like.',
    timed: (o) => `<b>${o.minutes} minute match.</b> Win a round to collect the points in everyone's leftover cards. When the clock runs out, the lightest hand takes the last pot and the highest total wins.`,
    ruthless: () => 'Draw cards always stack. Nothing to play? Keep drawing until something fits. <b>Wild +6</b> and <b>Hop all</b> join the deck, and holding <b>15 cards</b> knocks you out of the round.',
  };
  function renderLobby() {
    const L = lobby;
    const o = L.opts;
    $('lobbyTitle').textContent = L.solo ? 'Practice table' : 'Room';
    $('codeCard').hidden = L.solo;
    $('lobbyHint').hidden = L.solo;
    $('lobbyCode').textContent = L.code;
    if (!L.solo && qrFor !== L.code) {
      qrFor = L.code;
      try {
        const qr = self.qrcode(0, 'M');
        qr.addData(inviteUrl(L.code));
        qr.make();
        $('lobbyQr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
      } catch (e) { $('lobbyQr').textContent = ''; }
    }
    for (const b of $('modes').children) {
      b.setAttribute('aria-checked', String(b.dataset.mode === o.mode));
      b.disabled = !L.isHost;
    }
    let note = MODE_NOTE[o.mode](o);
    if (!L.isHost) {
      const bits = [o.turn ? `${o.turn}s per turn` : 'no turn timer'];
      if (o.mode !== 'ruthless') bits.push(o.stack ? 'stacking on' : 'stacking off');
      note += ' <b>' + bits.join(' · ') + '.</b>';
    }
    $('modeNote').innerHTML = note;
    $('hostControls').hidden = !L.isHost;
    $('rowMinutes').hidden = o.mode !== 'timed';
    $('rowStack').hidden = o.mode === 'ruthless';
    for (const group of document.querySelectorAll('.chips')) {
      for (const b of group.children) b.setAttribute('aria-pressed', String(Number(b.dataset.v) === o[group.dataset.opt]));
    }
    $('optStack').checked = !!o.stack;
    $('lobbyCount').textContent = `${L.players.length} / ${L.max}`;
    $('lobbyPlayers').innerHTML = L.players.map((p, i) => {
      const tags = [];
      if (i === L.you) tags.push('<span class="ptag you">You</span>');
      if (p.host && !L.solo) tags.push('<span class="ptag">Host</span>');
      if (p.bot) tags.push('<span class="ptag">Computer</span>');
      if (p.waiting) tags.push('<span class="ptag">Next round</span>');
      const kick = L.isHost && !p.host ? `<button class="kick" data-kick="${i}" aria-label="Remove ${esc(p.name)}">✕</button>` : '';
      return `<li class="${p.connected ? '' : 'off'}"><div class="avatar">${esc(p.av || '🙂')}</div><span class="pname">${esc(p.name)}</span>${tags.join('')}${kick}</li>`;
    }).join('');
    $('btnAddBot').hidden = !L.isHost;
    $('btnAddBot').disabled = L.players.length >= L.max;
    const start = $('btnStart');
    start.hidden = !L.isHost;
    start.disabled = L.players.length < 2;
    start.textContent = L.players.length < 2 ? 'Waiting for players…' : `Start ${MODE_NAME[o.mode]} · ${L.players.length} players`;
    const wait = $('lobbyWait');
    wait.hidden = L.isHost;
    wait.textContent = L.running ? "A round is on. You're in the next one!" : 'Waiting for the host to start…';
  }

  /* ---------- session control ---------- */
  const ERR = {
    notfound: "Can't find that room. Check the code, and that the host still has the game open.",
    network: "Couldn't connect. Check your internet and try again.",
    timeout: "Couldn't reach the room. Are you both online?",
    taken: "Couldn't open a room right now. Try again.",
    full: 'That room is full (8 players).',
    kicked: 'The host removed you from the room.',
    closed: 'The host closed the room.',
    lost: 'Lost the connection to the host.',
  };
  function setUrl(code) {
    const u = new URL(location.href);
    if (code) u.searchParams.set('room', code); else u.searchParams.delete('room');
    history.replaceState(null, '', u);
  }
  function busy(on) {
    for (const id of ['btnCreate', 'btnJoin', 'btnSolo']) $(id).disabled = on;
  }
  function goHome(message) {
    if (session) { const s = session; session = null; s.leave(); }
    lobby = null; V = null; wasMyTurn = false; animating = false; drag = null;
    queue = Promise.resolve();
    clearTimerFx();
    handEls.clear(); handInner.innerHTML = ''; pileEl.innerHTML = ''; seatsEl.innerHTML = ''; seatsEl.dataset.key = '';
    fx.innerHTML = '';
    for (const id of ['roundOver', 'colorPick', 'confirmLeave', 'netStatus', 'reactBar', 'clock']) $(id).hidden = true;
    setUrl(null);
    busy(false);
    $('homeMsg').textContent = message || '';
    show('home');
  }
  function myName() {
    const n = $('nameInput').value.replace(/\s+/g, ' ').trim().slice(0, 14);
    store.set('ekka.name', n);
    return n || 'Player';
  }
  function fatal(type) { goHome(ERR[type] || ERR.network); Sfx.play('nope'); }

  function createRoom(snapshot) {
    Sfx.unlock();
    busy(true);
    $('homeMsg').textContent = snapshot ? 'Reopening your room…' : 'Opening a room…';
    session = new HostRoom({ name: myName(), av: myAv, pid, snapshot, onSync, onReact: showReact, onError: fatal });
    const s = session;
    s.open(() => { if (session === s) { setUrl(s.code); $('homeMsg').textContent = ''; } });
  }
  function joinRoom(code) {
    code = String(code || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    if (code.length < 4) { $('homeMsg').textContent = 'Type the 4-letter room code first.'; $('codeInput').focus(); return; }
    Sfx.unlock();
    busy(true);
    $('homeMsg').textContent = 'Joining ' + code + '…';
    session = new GuestClient({
      code, name: myName(), av: myAv, pid, onSync, onReact: showReact, onError: fatal,
      onStatus: (text) => { const el = $('netStatus'); el.hidden = !text; el.textContent = text || ''; },
      onErrMsg: (m) => { toast(m); Sfx.play('nope'); },
    });
    const s = session;
    s.open(() => { if (session === s) { setUrl(code); $('homeMsg').textContent = ''; } });
  }
  function playSolo() {
    Sfx.unlock();
    session = new HostRoom({ name: myName(), av: myAv, pid, solo: true, onSync, onReact: showReact, onError: fatal });
    session.open();
  }

  function send(a) {
    if (!session) return;
    if (animating && a.type !== 'call' && a.type !== 'catch') return;
    const r = session.act(a);
    if (r && r.ok === false) { toast(r.err); Sfx.play('nope'); }
  }

  /* ---------- input: the hand ---------- */
  function closePicker() { $('colorPick').hidden = true; pendingWild = null; }
  const myTurnNow = () => !!V && !animating && V.phase === 'play' && V.turn === V.you;
  function nope(el) {
    el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
    Sfx.play('nope');
  }
  function tryPlay(id, el) {
    const card = V && V.hand.find((c) => c.id === id);
    if (!card || animating) return false;
    if (!el.classList.contains('ok')) { if (myTurnNow()) nope(el); return false; }
    if (card.c === 'w') { pendingWild = id; $('colorPick').hidden = false; return false; }
    send({ type: 'play', cardId: id });
    return true;
  }
  const overTable = (y) => y < handEl.getBoundingClientRect().top + 14;

  handInner.addEventListener('pointerdown', (e) => {
    if (drag || !V || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const el = e.target.closest('.card');
    if (!el) return;
    drag = { pid: e.pointerId, id: Number(el.dataset.id), el, x0: e.clientX, y0: e.clientY, ax: e.clientX, moved: false, lifted: false };
    try { handInner.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
    el.classList.add('peek');
  });
  handInner.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pid) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.moved && Math.hypot(dx, dy) > 9) drag.moved = true;
    if (!drag.moved) return;
    if (!drag.lifted) {
      if (dy < -cardW() * 0.42 && Math.abs(dy) > Math.abs(e.clientX - drag.ax) * 0.6) {
        // pulled up out of the fan: now it follows the finger
        drag.lifted = true;
        drag.ax = e.clientX;
        drag.el.classList.remove('peek');
        drag.el.classList.add('drag');
        Sfx.play('lift');
      } else {
        // sliding along the fan: lift whichever card is under the finger
        const id = cardAt(e.clientX, e.clientY);
        const el = id != null && handEls.get(id);
        if (el && id !== drag.id) {
          drag.el.classList.remove('peek');
          drag.id = id; drag.el = el; drag.ax = e.clientX;
          el.classList.add('peek');
          Sfx.play('lift');
        }
      }
    }
    if (drag.lifted) {
      const gx = e.clientX - drag.ax, gy = dy;
      drag.el.style.setProperty('--gx', gx.toFixed(1) + 'px');
      drag.el.style.setProperty('--gy', gy.toFixed(1) + 'px');
      drag.el.style.setProperty('--gr', clamp(gx * 0.05, -10, 10).toFixed(1) + 'deg');
      const hot = overTable(e.clientY) && drag.el.classList.contains('ok');
      drag.el.classList.toggle('over', hot);
      pileEl.classList.toggle('drop', hot);
    }
  });
  function endDrag(e, cancelled) {
    if (!drag || e.pointerId !== drag.pid) return;
    const d = drag;
    drag = null;
    pileEl.classList.remove('drop');
    const el = d.el;
    el.classList.remove('peek', 'over');
    if (cancelled) { el.classList.remove('drag'); return; }
    if (d.lifted) {
      const card = V && V.hand.find((c) => c.id === d.id);
      const wild = card && card.c === 'w';
      if (overTable(e.clientY) && !wild && tryPlay(d.id, el)) {
        // it stays where it was dropped until the throw lands on the pile
        setTimeout(() => { if (el.isConnected) el.classList.remove('drag'); }, 1500);
      } else {
        el.classList.remove('drag');
        if (overTable(e.clientY) && wild) tryPlay(d.id, el);
      }
      return;
    }
    if (!d.moved) tryPlay(d.id, el);
  }
  handInner.addEventListener('pointerup', (e) => endDrag(e, false));
  handInner.addEventListener('pointercancel', (e) => endDrag(e, true));
  handInner.addEventListener('lostpointercapture', (e) => endDrag(e, true));
  handInner.addEventListener('contextmenu', (e) => e.preventDefault());

  $('colorPick').addEventListener('click', (e) => {
    const b = e.target.closest('.pick');
    if (b && pendingWild != null) {
      const id = pendingWild;
      closePicker();
      send({ type: 'play', cardId: id, color: b.dataset.c });
    } else if (e.target.id === 'pickCancel' || e.target === $('colorPick')) closePicker();
  });
  deckEl.addEventListener('click', () => { if (deckEl.classList.contains('can')) send({ type: 'draw' }); });
  $('btnPass').addEventListener('click', () => send({ type: 'pass' }));
  $('btnCall').addEventListener('click', () => send({ type: 'call' }));
  $('btnCatch').addEventListener('click', () => send({ type: 'catch' }));

  /* ---------- input: reactions ---------- */
  const reactBar = $('reactBar');
  REACTIONS.forEach((e) => {
    const b = document.createElement('button');
    b.textContent = e;
    b.dataset.e = e;
    b.setAttribute('aria-label', 'React ' + e);
    reactBar.append(b);
  });
  function toggleReact(open) {
    reactBar.hidden = !open;
    $('btnReact').setAttribute('aria-expanded', String(open));
  }
  $('btnReact').addEventListener('click', (e) => { e.stopPropagation(); toggleReact(reactBar.hidden); });
  reactBar.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !session) return;
    session.myReact(b.dataset.e);
    toggleReact(false);
  });
  document.addEventListener('pointerdown', (e) => { if (!reactBar.hidden && !e.target.closest('#reactBar, #btnReact')) toggleReact(false); });

  /* ---------- input: home + lobby ---------- */
  const avPick = $('avPick');
  AVATARS.forEach((a) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = a;
    b.dataset.av = a;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(a === myAv));
    avPick.append(b);
  });
  avPick.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    myAv = b.dataset.av;
    store.set('ekka.av', myAv);
    for (const x of avPick.children) x.setAttribute('aria-checked', String(x === b));
    Sfx.play('pop');
  });

  $('btnCreate').addEventListener('click', () => createRoom(null));
  $('btnJoin').addEventListener('click', () => joinRoom($('codeInput').value));
  $('btnSolo').addEventListener('click', playSolo);
  $('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom($('codeInput').value); });
  $('codeInput').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); });
  $('nameInput').addEventListener('input', () => store.set('ekka.name', $('nameInput').value.trim()));

  $('btnLobbyLeave').addEventListener('click', () => goHome());
  $('btnAddBot').addEventListener('click', () => session && session.cmd({ type: 'addBot' }));
  $('modes').addEventListener('click', (e) => {
    const b = e.target.closest('.mode');
    if (b && session && !b.disabled) { session.cmd({ type: 'opt', key: 'mode', value: b.dataset.mode }); Sfx.play('pop'); }
  });
  $('hostControls').addEventListener('click', (e) => {
    const b = e.target.closest('.chips button');
    if (b && session) session.cmd({ type: 'opt', key: b.parentElement.dataset.opt, value: Number(b.dataset.v) });
  });
  $('optStack').addEventListener('change', (e) => session && session.cmd({ type: 'opt', key: 'stack', value: e.target.checked }));
  $('lobbyPlayers').addEventListener('click', (e) => {
    const b = e.target.closest('[data-kick]');
    if (b && session) session.cmd({ type: 'kick', index: Number(b.dataset.kick) });
  });
  $('btnStart').addEventListener('click', () => { Sfx.unlock(); if (session) session.cmd({ type: 'start' }); });
  $('btnNext').addEventListener('click', () => session && session.cmd({ type: 'next' }));
  $('btnToLobby').addEventListener('click', () => session && session.cmd({ type: 'lobby' }));

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fall through */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.append(ta); ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) { return false; }
  }
  $('btnCopy').addEventListener('click', async () => {
    if (!lobby) return;
    toast((await copyText(inviteUrl(lobby.code))) ? 'Invite link copied' : 'Could not copy. The code is ' + lobby.code);
  });
  $('btnShare').addEventListener('click', async () => {
    if (!lobby) return;
    const url = inviteUrl(lobby.code);
    if (navigator.share) {
      try { await navigator.share({ title: 'Ekka', text: `Join my Ekka room. Code: ${lobby.code}`, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    toast((await copyText(url)) ? 'Invite link copied' : 'Share the code ' + lobby.code);
  });

  $('btnLeave').addEventListener('click', () => {
    const solo = lobby && lobby.solo;
    $('confirmText').textContent = solo ? 'This game will end.'
      : lobby && lobby.isHost ? 'You are the host, so leaving closes the room for everyone.'
        : 'The computer will finish your hand.';
    $('confirmLeave').hidden = false;
  });
  $('btnStay').addEventListener('click', () => { $('confirmLeave').hidden = true; });
  $('btnReallyLeave').addEventListener('click', () => goHome());

  function soundIcon() { $('btnSound').textContent = Sfx.on ? '🔊' : '🔇'; }
  $('btnSound').addEventListener('click', () => { Sfx.toggle(); soundIcon(); Sfx.play('join'); });
  soundIcon();

  addEventListener('resize', () => { if (V && app.dataset.screen === 'table') { placeSeats(); layoutHand(); } });
  // the table shrinks and grows with the hand (one row or two): keep the seats on the rim
  if (self.ResizeObserver) new ResizeObserver(() => { if (V && app.dataset.screen === 'table') placeSeats(); }).observe($('arena'));
  addEventListener('pagehide', () => {
    // guests tell the host straight away; a host keeps its snapshot so a refresh reopens the room
    if (session && !session.isHost && session.conn) { try { session.conn.send({ t: 'ping' }); } catch (e) { /* noop */ } }
  });

  /* ---------- boot ---------- */
  (function boot() {
    const hero = $('heroCards');
    [{ id: 900, c: 'r', v: '7' }, { id: 901, c: 'y', v: 'skip' }, { id: 902, c: 'g', v: 'd2' }, { id: 903, c: 'w', v: 'wild' }]
      .forEach((c) => hero.append(makeCard(c)));
    const drift = $('drift');
    const samples = [['r', '3'], ['b', 'rev'], ['y', '8'], ['w', 'wild'], ['g', 'skip'], ['r', 'd2'], ['b', '5'], ['g', '0']];
    samples.forEach(([c, v], i) => {
      const el = makeCard({ id: 950 + i, c, v });
      el.style.setProperty('--l', (4 + ((i * 29) % 88)) + '%');
      el.style.setProperty('--d', 16 + ((i * 7) % 11) + 's');
      el.style.setProperty('--dl', -((i * 5.3) % 20) + 's');
      el.style.setProperty('--s', (0.8 + (i % 3) * 0.35).toFixed(2));
      el.style.setProperty('--r0', ((i * 47) % 60) - 30 + 'deg');
      el.style.setProperty('--r1', ((i * 83) % 240) - 120 + 'deg');
      el.style.setProperty('--dx', ((i * 31) % 120) - 60 + 'px');
      drift.append(el);
    });
    $('deck').querySelector('.deck-stack').append(makeBack(), makeBack(), makeBack());

    $('nameInput').value = store.get('ekka.name') || '';
    const room = (new URL(location.href).searchParams.get('room') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    const snap = HostRoom.snapshot();
    if (snap && room && snap.code === room && snap.members.some((m) => m.host && m.pid === pid)) {
      createRoom(snap);
    } else if (room.length === 4) {
      $('codeInput').value = room;
      if ($('nameInput').value) joinRoom(room);
      else { $('homeMsg').textContent = `Add your name, then tap Join room to enter ${room}.`; $('nameInput').focus(); }
    }
  })();

  self.__ekka = {
    get V() { return V; }, get lobby() { return lobby; }, get session() { return session; }, get animating() { return animating; },
    makeCard, makeBack,
  };
})();
