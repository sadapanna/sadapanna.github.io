/* Ekka — rules engine. Pure state machine, no DOM, no network.
   Runs in the host's browser (and in Node for tests). */
(function (root) {
  'use strict';

  const COLORS = ['c', 'm', 't', 'v']; // coral, mango, teal, violet
  const ACTIONS = ['skip', 'rev', 'd2'];

  function buildDeck() {
    const d = [];
    let id = 0;
    for (const c of COLORS) {
      d.push({ id: id++, c, v: '0' });
      for (let k = 0; k < 2; k++) {
        for (let n = 1; n <= 9; n++) d.push({ id: id++, c, v: String(n) });
        for (const a of ACTIONS) d.push({ id: id++, c, v: a });
      }
    }
    for (let k = 0; k < 4; k++) {
      d.push({ id: id++, c: 'w', v: 'wild' });
      d.push({ id: id++, c: 'w', v: 'd4' });
    }
    return d;
  }

  function shuffle(a, rnd) {
    rnd = rnd || Math.random;
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  const isNumber = (card) => card.v.length === 1;

  function cardPoints(card) {
    if (card.c === 'w') return 50;
    if (isNumber(card)) return Number(card.v);
    return 20;
  }

  /* players: [{pid, name, bot}] ; opts: {stack:boolean, handSize:number}
     prev: previous state (to carry scores) or null */
  function newRound(players, opts, prev, rnd) {
    const o = Object.assign({ stack: false, handSize: 7 }, opts || {});
    const prevBy = {};
    if (prev) for (const p of prev.players) prevBy[p.pid] = p;
    const deck = shuffle(buildDeck(), rnd);
    const ps = players.map((p) => ({
      pid: p.pid, name: p.name, bot: !!p.bot,
      hand: [], called: false,
      score: prevBy[p.pid] ? prevBy[p.pid].score : 0,
      wins: prevBy[p.pid] ? prevBy[p.pid].wins : 0,
    }));
    for (let k = 0; k < o.handSize; k++) for (const p of ps) p.hand.push(deck.pop());
    // start card is always a plain number
    let idx = deck.length - 1;
    while (!isNumber(deck[idx])) idx--;
    const start = deck.splice(idx, 1)[0];
    const round = prev ? prev.round + 1 : 1;
    let turn;
    if (prev && prev.winner != null) {
      const w = ps.findIndex((p) => p.pid === prev.players[prev.winner].pid);
      turn = w >= 0 ? w : 0;
    } else {
      turn = Math.floor((rnd || Math.random)() * ps.length);
    }
    return {
      players: ps, deck, discard: [start], color: start.c,
      turn, dir: 1, pending: 0, drewId: null, uncalled: null,
      phase: 'play', winner: null, points: 0, opts: o, round,
    };
  }

  const top = (s) => s.discard[s.discard.length - 1];

  function matches(s, card) {
    const t = top(s);
    if (s.pending > 0) {
      if (!s.opts.stack) return false;
      return card.v === 'd4' || (card.v === 'd2' && t.v === 'd2');
    }
    return card.c === 'w' || card.c === s.color || card.v === t.v;
  }

  function canPlay(s, pi, card) {
    if (s.phase !== 'play' || s.turn !== pi) return false;
    if (s.drewId != null && card.id !== s.drewId) return false;
    return matches(s, card);
  }

  function playable(s, pi) {
    if (s.phase !== 'play' || s.turn !== pi) return [];
    return s.players[pi].hand.filter((c) => canPlay(s, pi, c)).map((c) => c.id);
  }

  function nextIndex(s, steps) {
    const n = s.players.length;
    return (((s.turn + s.dir * steps) % n) + n) % n;
  }

  function advance(s, steps) {
    s.turn = nextIndex(s, steps);
    s.drewId = null;
  }

  function drawCards(s, pi, n, ev, why) {
    const got = [];
    for (let k = 0; k < n; k++) {
      if (!s.deck.length) {
        if (s.discard.length <= 1) break;
        const keep = s.discard.pop();
        s.deck = shuffle(s.discard);
        s.discard = [keep];
        ev.push({ t: 'shuffle' });
      }
      got.push(s.deck.pop());
    }
    if (got.length) {
      s.players[pi].hand.push(...got);
      ev.push({ t: 'draw', p: pi, n: got.length, cards: got, why: why || 'draw' });
    }
    return got;
  }

  function bestColor(hand) {
    const cnt = { c: 0, m: 0, t: 0, v: 0 };
    for (const c of hand) if (c.c !== 'w') cnt[c.c]++;
    let best = COLORS[Math.floor(Math.random() * 4)];
    let max = 0;
    for (const c of COLORS) if (cnt[c] > max) { max = cnt[c]; best = c; }
    return best;
  }

  function fail(err) { return { ok: false, err, events: [] }; }

  function finish(s, pi, ev) {
    let pts = 0;
    for (const p of s.players) for (const c of p.hand) pts += cardPoints(c);
    s.phase = 'over';
    s.winner = pi;
    s.points = pts;
    s.players[pi].score += pts;
    s.players[pi].wins += 1;
    s.uncalled = null;
    s.pending = 0;
    s.drewId = null;
    ev.push({ t: 'win', p: pi, points: pts });
  }

  function play(s, pi, cardId, color) {
    if (s.phase !== 'play') return fail('Round is over');
    if (s.turn !== pi) return fail('Not your turn');
    const p = s.players[pi];
    const i = p.hand.findIndex((c) => c.id === cardId);
    if (i < 0) return fail('Card not in hand');
    const card = p.hand[i];
    if (!canPlay(s, pi, card)) return fail('That card does not match');
    const ev = [];
    p.hand.splice(i, 1);
    s.discard.push(card);
    s.drewId = null;
    s.uncalled = null;
    if (card.c === 'w') s.color = COLORS.includes(color) ? color : bestColor(p.hand);
    else s.color = card.c;
    ev.push({ t: 'play', p: pi, card, color: s.color });

    const out = p.hand.length === 0;
    if (!out && p.hand.length === 1) {
      if (p.called) ev.push({ t: 'call', p: pi });
      else s.uncalled = pi;
    }
    p.called = false;

    const n = s.players.length;
    if (card.v === 'skip') {
      if (!out) ev.push({ t: 'skip', p: nextIndex(s, 1) });
      advance(s, 2);
    } else if (card.v === 'rev') {
      s.dir = -s.dir;
      ev.push({ t: 'rev', dir: s.dir });
      if (n === 2) advance(s, 2); else advance(s, 1);
    } else if (card.v === 'd2' || card.v === 'd4') {
      const amt = card.v === 'd2' ? 2 : 4;
      if (s.opts.stack && !out) {
        s.pending += amt;
        advance(s, 1);
      } else {
        const victim = nextIndex(s, 1);
        drawCards(s, victim, amt + s.pending, ev, 'penalty');
        s.pending = 0;
        if (!out) ev.push({ t: 'skip', p: victim });
        advance(s, 2);
      }
    } else {
      advance(s, 1);
    }
    if (out) finish(s, pi, ev);
    return { ok: true, events: ev };
  }

  function draw(s, pi) {
    if (s.phase !== 'play') return fail('Round is over');
    if (s.turn !== pi) return fail('Not your turn');
    if (s.drewId != null) return fail('Play the card you drew, or pass');
    const ev = [];
    s.uncalled = null;
    s.players[pi].called = false;
    if (s.pending > 0) {
      const n = s.pending;
      s.pending = 0;
      drawCards(s, pi, n, ev, 'penalty');
      advance(s, 1);
      return { ok: true, events: ev };
    }
    const got = drawCards(s, pi, 1, ev, 'draw');
    if (got.length && matches(s, got[0])) {
      s.drewId = got[0].id; // may play it or pass
    } else {
      if (!got.length) ev.push({ t: 'pass', p: pi });
      advance(s, 1);
    }
    return { ok: true, events: ev };
  }

  function pass(s, pi) {
    if (s.phase !== 'play') return fail('Round is over');
    if (s.turn !== pi) return fail('Not your turn');
    if (s.drewId == null) return fail('Draw a card first');
    advance(s, 1);
    return { ok: true, events: [{ t: 'pass', p: pi }] };
  }

  function call(s, pi) {
    if (s.phase !== 'play') return fail('Round is over');
    const p = s.players[pi];
    if (s.uncalled === pi) {
      s.uncalled = null;
      return { ok: true, events: [{ t: 'call', p: pi }] };
    }
    if (s.turn === pi && p.hand.length === 2 && !p.called && playable(s, pi).length) {
      p.called = true;
      return { ok: true, events: [{ t: 'call', p: pi, early: true }] };
    }
    return fail('Nothing to call yet');
  }

  function catchOut(s, by) {
    if (s.phase !== 'play') return fail('Round is over');
    if (s.uncalled == null || s.uncalled === by) return fail('Too late');
    const target = s.uncalled;
    s.uncalled = null;
    const ev = [{ t: 'catch', p: target, by }];
    drawCards(s, target, 2, ev, 'caught');
    return { ok: true, events: ev };
  }

  function act(s, pi, a) {
    switch (a && a.type) {
      case 'play': return play(s, pi, a.cardId, a.color);
      case 'draw': return draw(s, pi);
      case 'pass': return pass(s, pi);
      case 'call': return call(s, pi);
      case 'catch': return catchOut(s, pi);
      default: return fail('Unknown action');
    }
  }

  /* What player `pi` is allowed to know. pi = -1 for a spectator. */
  function view(s, pi) {
    const me = s.players[pi];
    return {
      you: pi,
      round: s.round,
      phase: s.phase,
      players: s.players.map((p) => ({
        name: p.name, bot: p.bot, count: p.hand.length, score: p.score, wins: p.wins,
      })),
      hand: me ? me.hand.slice() : [],
      top: top(s),
      color: s.color,
      turn: s.turn,
      dir: s.dir,
      pending: s.pending,
      drewId: s.turn === pi ? s.drewId : null,
      uncalled: s.uncalled,
      called: me ? me.called : false,
      playable: playable(s, pi),
      deckCount: s.deck.length,
      winner: s.winner,
      points: s.points,
      opts: s.opts,
    };
  }

  /* Hide other players' drawn cards. */
  function eventsFor(events, pi) {
    return events.map((e) => {
      if (e.t === 'draw' && e.p !== pi) return { t: 'draw', p: e.p, n: e.n, why: e.why };
      return e;
    });
  }

  /* Computer player: returns the action it wants to take on its turn. */
  function botMove(s, pi) {
    const p = s.players[pi];
    const ids = playable(s, pi);
    if (!ids.length) return s.drewId != null ? { type: 'pass' } : { type: 'draw' };
    const cards = p.hand.filter((c) => ids.includes(c.id));
    const nextCount = s.players[nextIndex(s, 1)].hand.length;
    const colorCount = (c) => p.hand.filter((h) => h.c === c.c).length;
    const score = (c) => {
      let v = 0;
      if (c.c === 'w') v = c.v === 'd4' ? 2 : 1; // keep wilds for later
      else if (isNumber(c)) v = 10 + Number(c.v) / 2 + colorCount(c);
      else v = 14 + colorCount(c);
      if (nextCount <= 2 && (c.v === 'd2' || c.v === 'd4' || c.v === 'skip')) v += 30;
      if (p.hand.length <= 2 && c.c === 'w') v += 5;
      return v + Math.random();
    };
    cards.sort((a, b) => score(b) - score(a));
    const pick = cards[0];
    const rest = p.hand.filter((c) => c.id !== pick.id);
    return { type: 'play', cardId: pick.id, color: pick.c === 'w' ? bestColor(rest) : undefined };
  }

  const api = {
    COLORS, buildDeck, shuffle, newRound, act, view, eventsFor, botMove,
    playable, canPlay, cardPoints, isNumber,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EkkaEngine = api;
})(typeof self !== 'undefined' ? self : this);
