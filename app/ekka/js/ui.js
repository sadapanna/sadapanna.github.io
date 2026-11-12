/* Ekka — screens, table rendering and animations. */
(function () {
  'use strict';
  const { HostRoom, GuestClient } = self.EkkaRoom;
  const Net = self.EkkaNet;
  const Sfx = self.EkkaSfx;
  const $ = (id) => document.getElementById(id);

  const app = $('app');
  const fx = $('fx');
  const seatsEl = $('seats');
  const handEl = $('hand');
  const handInner = $('handInner');
  const pileEl = $('pile');
  const deckEl = $('deck');
  const ringEl = $('ring');

  const COLOR_VAR = { c: 'var(--coral)', m: 'var(--mango)', t: 'var(--teal)', v: 'var(--violet)' };
  const COLOR_HEX = { c: '#ff5d5d', m: '#ffb020', t: '#12b5a4', v: '#7c5cff' };
  const COLOR_NAME = { c: 'Coral', m: 'Mango', t: 'Teal', v: 'Violet' };
  const AVATARS = ['#ff5d5d', '#12b5a4', '#ffb020', '#7c5cff', '#ff7ac3', '#3aa0ff', '#7cb342', '#ff8a3d'];
  const COLOR_ORDER = 'cmtvw';
  const VALUE_ORDER = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'rev', 'd2', 'wild', 'd4'];

  const SVG_HOP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 14c1.500-8 13-9.500 17-1.500"/><path d="M21 5.500v7.500h-7.500"/><circle cx="8.500" cy="19" r="1.800" fill="currentColor" stroke="none"/></svg>';
  const SVG_FLIP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h14l-4-4"/><path d="M20 15H6l4 4"/></svg>';

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

  /* ---------- small helpers ---------- */
  const sleep = (ms) => new Promise((r) => setTimeout(r, document.hidden ? 0 : ms));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
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

  /* ---------- cards ---------- */
  function glyph(card, corner) {
    switch (card.v) {
      case 'skip': return SVG_HOP;
      case 'rev': return SVG_FLIP;
      case 'd2': return '+2';
      case 'wild': return '<span class="wheel"></span>';
      case 'd4': return corner ? '+4' : '<span class="wheel">+4</span>';
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
      '<div class="page"><span class="big' + ul + txt + '">' + glyph(card, false) + '</span></div>' +
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
  const cardW = () => pileEl.getBoundingClientRect().width || 70;

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
    if (!el) return { x: innerWidth / 2, y: 60, w: 20 };
    const r = el.querySelector('.count').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: 26 };
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
    const mx = (o.from.x + o.to.x) / 2, my = (o.from.y + o.to.y) / 2 - 18;
    const tm = `translate(${mx}px, ${my}px) scale(${Math.max(s0, s1) * 1.12}) rotate(${((o.rot0 || 0) + (o.rot1 || 0)) / 2}deg)`;
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
    const x = Math.max(70, Math.min(innerWidth - 70, pt.x));
    const base = `translate(${x}px, ${pt.y}px) translate(-50%, -50%)`;
    const a = el.animate([
      { transform: base + ' scale(.2) rotate(-14deg)', opacity: 0 },
      { transform: base + ' scale(1.2) rotate(-6deg)', opacity: 1, offset: 0.25 },
      { transform: base + ' scale(1) rotate(-6deg)', opacity: 1, offset: 0.7 },
      { transform: base + ' translateY(-26px) scale(1) rotate(-6deg)', opacity: 0 },
    ], { duration: life || 1000, easing: 'ease-out', fill: 'both' });
    a.finished.then(() => el.remove(), () => el.remove());
  }
  const centerPt = () => { const r = pileEl.getBoundingClientRect(); return { x: innerWidth / 2, y: r.top - 46 }; };
  function seatBurstPt(pi) {
    const p = seatPoint(pi);
    return V && pi === V.you ? { x: p.x, y: p.y - cardW() * 1.1 } : { x: p.x - 14, y: p.y + 58 };
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

  /* ---------- rendering: seats ---------- */
  function renderSeats() {
    const n = V.players.length;
    const order = [];
    for (let k = 1; k < n; k++) order.push((V.you + k) % n);
    const key = order.join(',') + '|' + V.players.map((p) => p.name).join('\u0001');
    if (seatsEl.dataset.key !== key) {
      seatsEl.dataset.key = key;
      seatsEl.innerHTML = '';
      seatsEl.classList.toggle('compact', order.length > 4);
      seatEls = {};
      order.forEach((pi, idx) => {
        const p = V.players[pi];
        const el = document.createElement('div');
        el.className = 'seat';
        el.innerHTML =
          '<div class="avatar" style="--av:' + AVATARS[pi % AVATARS.length] + '">' + esc((p.name[0] || '?').toUpperCase()) + '</div>' +
          '<span class="count">0</span>' +
          '<span class="sname">' + esc(p.name) + '</span>';
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
      setCount(pi, V.players[pi].count);
    });
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
    const pad = seatsEl.classList.contains('compact') ? 30 : 36;
    seatOrder.forEach((pi, idx) => {
      const deg = m > 1 ? 270 - span / 2 + (span * idx) / (m - 1) : 270;
      const a = (deg * Math.PI) / 180;
      const c = Math.cos(a), s = Math.sin(a);
      // superellipse: hugs the rounded-rectangle rim better than a plain ellipse
      let x = cx + rx * Math.sign(c) * Math.pow(Math.abs(c), 0.72);
      let y = cy + ry * Math.sign(s) * Math.pow(Math.abs(s), 0.72);
      x = Math.max(pad, Math.min(A.width - pad, x));
      y = Math.max(30, y);
      const el = seatEls[pi];
      el.style.setProperty('--sx', x.toFixed(1) + 'px');
      el.style.setProperty('--sy', y.toFixed(1) + 'px');
    });
  }

  function setCount(pi, n, bump) {
    const el = seatEls[pi];
    if (!el) return;
    const c = el.querySelector('.count');
    if (c.textContent !== String(n)) {
      c.textContent = n;
      if (bump) { c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump'); }
    }
    let flag = el.querySelector('.flag');
    const showFlag = n === 1 && V.phase === 'play' && V.uncalled !== pi;
    if (showFlag && !flag) { flag = document.createElement('span'); flag.className = 'flag'; flag.textContent = 'Ekka!'; el.append(flag); }
    if (!showFlag && flag) flag.remove();
  }

  /* ---------- rendering: hand ---------- */
  function renderHand(hiddenIds) {
    const cards = V.hand.slice().sort((a, b) => sortKey(a) - sortKey(b));
    const keep = new Set(cards.map((c) => c.id));
    for (const [id, el] of handEls) if (!keep.has(id)) { el.remove(); handEls.delete(id); }
    const myTurn = !animating && V.phase === 'play' && V.turn === V.you;
    const ok = new Set(myTurn ? V.playable : []);
    cards.forEach((c, i) => {
      let el = handEls.get(c.id);
      if (!el) {
        el = makeCard(c);
        if (hiddenIds && hiddenIds.has(c.id)) el.classList.add('hidden');
        handEls.set(c.id, el);
        handInner.append(el);
      }
      el.classList.toggle('ok', ok.has(c.id));
      el._i = i;
    });
    handEl.classList.toggle('myturn', myTurn);
    layoutHand(cards);
  }
  function layoutHand(cards) {
    cards = cards || V.hand.slice().sort((a, b) => sortKey(a) - sortKey(b));
    const n = cards.length;
    const cw = cardW();
    const W = handEl.clientWidth - 20;
    const spread = Math.min(12, n * 1.7);
    // rotated end cards swing outwards; keep them on screen
    const side = Math.sin((spread * Math.PI) / 180) * cw * 1.45 * 0.75 + 4;
    const room = W - side * 2;
    const fit = n > 1 ? (room - cw) / (n - 1) : 0;
    const gap = n > 1 ? Math.max(cw * 0.3, Math.min(cw * 0.66, fit)) : 0;
    const total = cw + gap * (n - 1);
    const full = Math.max(W, total + side * 2);
    handInner.style.width = full + 'px';
    const x0 = (full - total) / 2;
    cards.forEach((c, i) => {
      const el = handEls.get(c.id);
      if (!el) return;
      const t = n > 1 ? (i / (n - 1)) * 2 - 1 : 0;
      el.style.setProperty('--x', (x0 + i * gap).toFixed(1) + 'px');
      el.style.setProperty('--y', (t * t * cw * 0.14).toFixed(1) + 'px');
      el.style.setProperty('--r', (t * spread).toFixed(1) + 'deg');
      el.style.zIndex = i + 1;
    });
  }

  /* ---------- rendering: piles + status ---------- */
  function pileCard(card, land) {
    const el = makeCard(card);
    el.style.setProperty('--rot', pileRot(card.id) + 'deg');
    el.style.setProperty('--dx', ((card.id * 13) % 9) - 4 + 'px');
    el.style.setProperty('--dy', ((card.id * 7) % 7) - 3 + 'px');
    if (land) el.classList.add('land');
    pileEl.append(el);
    while (pileEl.children.length > 4) pileEl.firstChild.remove();
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
    const st = $('status');
    let text = '';
    if (playing) {
      const cur = V.players[V.turn];
      if (V.turn === me) {
        if (V.pending > 0) text = V.playable.length ? `Stack it, or draw ${V.pending}` : `Ouch. Draw ${V.pending}`;
        else if (V.drewId != null) text = 'It fits! Play it or keep it';
        else if (V.playable.length) text = 'Your turn';
        else text = 'Nothing fits. Draw a card';
      } else if (V.away && V.away[V.turn]) text = `Waiting for ${cur.name} to come back…`;
      else text = cur.bot ? `${cur.name} is thinking…` : `${cur.name}'s turn`;
    }
    st.textContent = text;
    st.classList.toggle('mine', playing && V.turn === me);

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
    const canCatch = playing && V.uncalled != null && V.uncalled !== me;
    const bt = $('btnCatch');
    bt.hidden = !canCatch;
    if (canCatch) bt.textContent = 'Catch ' + V.players[V.uncalled].name + '!';

    const pend = $('pending');
    pend.hidden = !(V.pending > 0);
    pend.textContent = '+' + V.pending;
    ringEl.classList.toggle('ccw', V.dir < 0);

    const mine = playing && V.turn === me;
    if (mine && !wasMyTurn) {
      Sfx.play('turn');
      if (navigator.vibrate) { try { navigator.vibrate(50); } catch (e) { /* noop */ } }
    }
    wasMyTurn = mine;
  }

  function renderOver() {
    const box = $('roundOver');
    if (V.phase !== 'over') { box.hidden = true; return; }
    const w = V.players[V.winner];
    const iWon = V.winner === V.you;
    $('overKicker').textContent = 'Round ' + V.round;
    $('overTitle').textContent = iWon ? 'You win!' : w.name + ' wins!';
    $('overSub').textContent = V.points ? `+${V.points} points from the cards everyone was left holding` : 'A clean sweep';
    const rows = V.players.map((p, i) => ({ p, i })).sort((a, b) => b.p.score - a.p.score || b.p.wins - a.p.wins);
    $('overScores').innerHTML =
      '<tr><th>Player</th><th>Cards left</th><th>Wins</th><th>Points</th></tr>' +
      rows.map(({ p, i }) => `<tr class="${i === V.winner ? 'win' : ''} ${i === V.you ? 'you' : ''}"><td>${esc(p.name)}</td><td>${p.count}</td><td>${p.wins}</td><td>${p.score}</td></tr>`).join('');
    const host = lobby && lobby.isHost;
    $('btnNext').hidden = !host;
    $('btnToLobby').hidden = !host || (lobby && lobby.solo);
    $('overWait').hidden = !!host;
    box.hidden = false;
  }

  function renderAll() {
    $('tableCode').textContent = lobby && !lobby.solo ? 'Room ' + lobby.code : 'Ekka';
    renderSeats();
    renderPile(false);
    renderHand();
    renderStatus();
    renderOver();
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
    if (mine) {
      const el = handEls.get(ev.card.id);
      from = el ? rectOf(el) : seatPoint(ev.p);
      if (el) { el.remove(); handEls.delete(ev.card.id); }
      V.hand = V.hand.filter((c) => c.id !== ev.card.id);
      layoutHand();
    } else {
      from = seatPoint(ev.p);
    }
    V.players[ev.p].count = Math.max(0, V.players[ev.p].count - 1);
    if (!mine) setCount(ev.p, V.players[ev.p].count, true);
    Sfx.play('play');
    await fly({ from, to: rectOf(pileEl), card: ev.card, fromFace: mine, toFace: true, dur: mine ? 330 : 430, rot0: mine ? 0 : -20, rot1: pileRot(ev.card.id) });
    V.top = ev.card;
    V.color = ev.color;
    renderPile(true);
    const v = ev.card.v;
    if (ev.card.c === 'w') { wave(ev.color); Sfx.play('wild'); }
    if (v === 'd2' || v === 'd4') {
      Sfx.play('plus');
      if (!V.opts.stack) burst(v === 'd2' ? '+2' : '+4', centerPt(), 'red', 900);
    }
    if (ev.card.c === 'w') await sleep(320);
    else await sleep(120);
  }

  async function animDraw(ev) {
    const mine = ev.p === V.you;
    const from = rectOf(deckEl);
    const flights = [];
    if (mine && ev.cards) {
      const ids = new Set(ev.cards.map((c) => c.id));
      V.hand = V.hand.concat(ev.cards);
      V.players[ev.p].count += ev.n;
      renderHand(ids);
      // let the hand settle so each flight lands on its slot
      await sleep(40);
      ev.cards.forEach((card, i) => {
        const el = handEls.get(card.id);
        const delay = i * 130;
        setTimeout(() => Sfx.play('draw'), delay);
        const to = el ? rectOf(el) : seatPoint(ev.p);
        flights.push(fly({ from, to, card, fromFace: false, toFace: true, dur: 430, delay }).then(() => {
          if (el) { el.classList.remove('hidden'); el.classList.add('fresh'); }
        }));
      });
    } else {
      const to = seatPoint(ev.p);
      for (let i = 0; i < ev.n; i++) {
        const delay = i * 120;
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

  async function playEvent(ev, fin) {
    switch (ev.t) {
      case 'deal': await animDeal(fin); break;
      case 'play': await animPlay(ev); break;
      case 'draw': await animDraw(ev); break;
      case 'skip':
        Sfx.play('skip');
        burst(ev.p === V.you ? 'You got hopped!' : 'Hopped!', seatBurstPt(ev.p), 'small white', 900);
        await sleep(420);
        break;
      case 'rev':
        V.dir = ev.dir;
        Sfx.play('rev');
        ringEl.classList.toggle('ccw', V.dir < 0);
        ringEl.classList.add('flash');
        setTimeout(() => ringEl.classList.remove('flash'), 600);
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
        burst(ev.p === V.you ? 'Caught! +2' : `${V.players[ev.by].name} caught ${V.players[ev.p].name}!`, ev.p === V.you ? seatBurstPt(ev.p) : centerPt(), 'small red', 1300);
        await sleep(450);
        break;
      case 'shuffle': toast('Deck ran out. Reshuffled the pile.'); break;
      case 'win':
        if (ev.p === fin.you) { Sfx.play('win'); confetti(90); burst('You win!', centerPt(), '', 1400); }
        else { Sfx.play('lose'); confetti(24); burst(fin.players[ev.p].name + ' wins!', centerPt(), 'white', 1400); }
        await sleep(1100);
        break;
      default: break;
    }
  }

  /* ---------- sync from the host ---------- */
  function onSync(msg) {
    queue = queue.then(() => applySync(msg)).catch((e) => { console.error(e); animating = false; });
  }

  async function applySync(msg) {
    if (!session) return;
    const prev = lobby;
    lobby = msg.lobby;
    if (!msg.view) {
      V = null;
      wasMyTurn = false;
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
    handEl.classList.remove('myturn');
    for (const el of handEls.values()) el.classList.remove('ok');
    deckEl.classList.remove('can', 'nudge');
    const st = $('status');
    if (st.classList.contains('mine')) { st.textContent = ''; st.classList.remove('mine'); }
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
  function renderLobby() {
    const L = lobby;
    $('lobbyCode').textContent = L.code;
    if (qrFor !== L.code) {
      qrFor = L.code;
      try {
        const qr = self.qrcode(0, 'M');
        qr.addData(inviteUrl(L.code));
        qr.make();
        $('lobbyQr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
      } catch (e) { $('lobbyQr').textContent = ''; }
    }
    $('lobbyCount').textContent = `${L.players.length} / ${L.max}`;
    $('lobbyPlayers').innerHTML = L.players.map((p, i) => {
      const tags = [];
      if (i === L.you) tags.push('<span class="ptag you">You</span>');
      if (p.host) tags.push('<span class="ptag">Host</span>');
      if (p.bot) tags.push('<span class="ptag">Computer</span>');
      if (p.waiting) tags.push('<span class="ptag">Next round</span>');
      const kick = L.isHost && !p.host ? `<button class="kick" data-kick="${i}" aria-label="Remove ${esc(p.name)}">✕</button>` : '';
      return `<li class="${p.connected ? '' : 'off'}"><div class="avatar" style="--av:${AVATARS[i % AVATARS.length]}">${esc((p.name[0] || '?').toUpperCase())}</div><span class="pname">${esc(p.name)}</span>${tags.join('')}${kick}</li>`;
    }).join('');
    $('hostControls').hidden = !L.isHost;
    $('btnAddBot').disabled = L.players.length >= L.max;
    $('optStack').checked = !!L.opts.stack;
    const start = $('btnStart');
    start.hidden = !L.isHost;
    start.disabled = L.players.length < 2;
    start.textContent = L.players.length < 2 ? 'Waiting for players…' : `Start game · ${L.players.length} players`;
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
    lobby = null; V = null; wasMyTurn = false; animating = false;
    queue = Promise.resolve();
    handEls.clear(); handInner.innerHTML = ''; pileEl.innerHTML = ''; seatsEl.innerHTML = ''; seatsEl.dataset.key = '';
    fx.innerHTML = '';
    for (const id of ['roundOver', 'colorPick', 'confirmLeave', 'netStatus']) $(id).hidden = true;
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
    session = new HostRoom({ name: myName(), pid, snapshot, onSync, onError: fatal });
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
      code, name: myName(), pid, onSync, onError: fatal,
      onStatus: (text) => { const el = $('netStatus'); el.hidden = !text; el.textContent = text || ''; },
      onErrMsg: (m) => { toast(m); Sfx.play('nope'); },
    });
    const s = session;
    s.open(() => { if (session === s) { setUrl(code); $('homeMsg').textContent = ''; } });
  }
  function playSolo() {
    Sfx.unlock();
    session = new HostRoom({ name: myName(), pid, solo: true, onSync, onError: fatal });
    session.open();
  }

  function send(a) {
    if (!session) return;
    if (animating && a.type !== 'call' && a.type !== 'catch') return;
    const r = session.act(a);
    if (r && r.ok === false) { toast(r.err); Sfx.play('nope'); }
  }

  /* ---------- input ---------- */
  function closePicker() { $('colorPick').hidden = true; pendingWild = null; }

  handInner.addEventListener('click', (e) => {
    const el = e.target.closest('.card');
    if (!el || !V || animating) return;
    const id = Number(el.dataset.id);
    const card = V.hand.find((c) => c.id === id);
    if (!card) return;
    if (!el.classList.contains('ok')) {
      if (V.phase === 'play' && V.turn === V.you) {
        el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
        Sfx.play('nope');
      }
      return;
    }
    if (card.c === 'w') { pendingWild = id; $('colorPick').hidden = false; return; }
    send({ type: 'play', cardId: id });
  });
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

  $('btnCreate').addEventListener('click', () => createRoom(null));
  $('btnJoin').addEventListener('click', () => joinRoom($('codeInput').value));
  $('btnSolo').addEventListener('click', playSolo);
  $('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom($('codeInput').value); });
  $('codeInput').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); });
  $('nameInput').addEventListener('input', () => store.set('ekka.name', $('nameInput').value.trim()));

  $('btnLobbyLeave').addEventListener('click', () => goHome());
  $('btnAddBot').addEventListener('click', () => session && session.cmd({ type: 'addBot' }));
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
  addEventListener('pagehide', () => {
    // guests tell the host straight away; a host keeps its snapshot so a refresh reopens the room
    if (session && !session.isHost && session.conn) { try { session.conn.send({ t: 'ping' }); } catch (e) { /* noop */ } }
  });

  /* ---------- boot ---------- */
  (function boot() {
    const hero = $('heroCards');
    [{ id: 900, c: 'c', v: '7' }, { id: 901, c: 'm', v: 'skip' }, { id: 902, c: 't', v: 'd2' }, { id: 903, c: 'w', v: 'wild' }]
      .forEach((c) => hero.append(makeCard(c)));
    const drift = $('drift');
    const samples = [['c', '3'], ['v', 'rev'], ['m', '8'], ['w', 'wild'], ['t', 'skip'], ['c', 'd2'], ['v', '5'], ['t', '0']];
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
    const back = makeBack();
    $('deck').querySelector('.deck-stack').append(makeBack(), makeBack(), back);

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

  self.__ekka = { get V() { return V; }, get lobby() { return lobby; }, get session() { return session; }, get animating() { return animating; } };
})();
