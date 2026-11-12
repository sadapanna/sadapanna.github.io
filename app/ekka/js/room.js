/* Ekka — rooms. HostRoom owns the game state and runs in the host's browser;
   GuestClient is the thin connection every other player holds. */
(function (root) {
  'use strict';
  const E = root.EkkaEngine;
  const Net = root.EkkaNet;

  const MAX_PLAYERS = 8;
  const BOT_NAMES = ['Chai', 'Jalebi', 'Momo', 'Kulfi', 'Pixel', 'Biscuit', 'Mishti'];
  const SNAP_KEY = 'ekka.host';
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const SPEED = /[?&]fast=1/.test(location.search) ? 0.12 : 1; // test hook

  function makeCode() {
    let s = '';
    for (let i = 0; i < 4; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    return s;
  }
  const cleanName = (n) => String(n || '').replace(/\s+/g, ' ').trim().slice(0, 14) || 'Player';

  /* ============================ HOST ============================ */
  class HostRoom {
    /* o: {name, pid, solo, onSync(msg), onError(type), snapshot} */
    constructor(o) {
      this.o = o;
      this.isHost = true;
      this.solo = !!o.solo;
      this.state = null;
      this.opts = { stack: false };
      this.timer = null; this.callTimer = null; this.catchTimer = null;
      this.rolled = '';
      this.closed = false;
      this.tries = 0;
      if (o.snapshot) {
        const sn = o.snapshot;
        this.code = sn.code;
        this.opts = sn.opts;
        this.state = sn.state;
        this.members = sn.members.map((m) => Object.assign({}, m, { conn: null, connected: !!(m.host || m.bot), seen: 0 }));
      } else {
        this.code = this.solo ? 'SOLO' : makeCode();
        this.members = [{ pid: o.pid, name: cleanName(o.name), bot: false, host: true, conn: null, connected: true, seen: 0 }];
      }
    }

    open(onReady) {
      if (this.solo) {
        for (let i = 0; i < 3; i++) this.addBot();
        onReady && onReady();
        this.start();
        return;
      }
      this.net = Net.host(this.code, {
        onOpen: () => {
          onReady && onReady();
          this.sync([], true);
          this.schedule(1500);
          this.beat = setInterval(() => this.checkAlive(), 3000);
        },
        onConn: (conn) => this.handleConn(conn),
        onError: (type) => {
          if (this.closed) return;
          if (type === 'taken' && !this.o.snapshot && this.tries++ < 5) {
            this.code = makeCode();
            this.open(onReady);
          } else if (type === 'taken' && this.o.snapshot && this.tries++ < 6) {
            // our old tab's id has not been released yet — retry shortly
            setTimeout(() => { if (!this.closed) this.open(onReady); }, 1500);
          } else {
            this.o.onError && this.o.onError(type);
          }
        },
      });
    }

    /* ----- connections ----- */
    handleConn(conn) {
      let member = null;
      conn.onData = (m) => {
        if (!m || typeof m !== 'object') return;
        if (m.t === 'join') {
          member = this.attach(conn, m);
        } else if (!member || member.conn !== conn) {
          return;
        } else if (m.t === 'ping') {
          member.seen = Date.now();
          if (!member.connected) { member.connected = true; this.sync([], true); this.schedule(); }
          conn.send({ t: 'pong' });
        } else if (m.t === 'act') {
          const pi = this.seatOf(member);
          if (pi < 0) return;
          const r = this.apply(pi, m.a);
          if (!r.ok) conn.send({ t: 'err', msg: r.err });
        } else if (m.t === 'leave') {
          this.remove(member);
        }
      };
      conn.onClose = () => {
        if (!member || member.conn !== conn) return;
        member.conn = null;
        member.connected = false;
        if (!this.state) this.members = this.members.filter((x) => x !== member);
        this.sync([], true);
        this.schedule();
      };
    }

    attach(conn, m) {
      const pid = String(m.pid || '').slice(0, 40);
      let member = this.members.find((x) => x.pid === pid && !x.bot);
      if (member) {
        if (member.conn && member.conn !== conn) { const old = member.conn; member.conn = null; old.close(); }
        if (!member.host) member.name = cleanName(m.name);
      } else {
        if (this.members.length >= MAX_PLAYERS) {
          conn.send({ t: 'bye', why: 'full' });
          return null;
        }
        member = { pid, name: cleanName(m.name), bot: false, host: false, conn: null, connected: true, seen: 0 };
        this.members.push(member);
      }
      member.conn = conn;
      member.connected = true;
      member.seen = Date.now();
      this.sync([], true);
      this.schedule();
      return member;
    }

    checkAlive() {
      const now = Date.now();
      let changed = false;
      for (const m of this.members) {
        if (m.bot || m.host || !m.connected) continue;
        if (now - m.seen > 9000) { m.connected = false; changed = true; }
      }
      if (changed) {
        if (!this.state) this.members = this.members.filter((m) => m.bot || m.host || m.connected);
        this.sync([], true);
        this.schedule();
      }
    }

    remove(member, why) {
      if (!member || member.host) return;
      this.members = this.members.filter((x) => x !== member);
      if (member.conn) {
        const c = member.conn; member.conn = null;
        if (why) c.send({ t: 'bye', why });
        setTimeout(() => c.close(), 150);
      }
      if (this.state) {
        const sp = this.state.players.find((p) => p.pid === member.pid);
        if (sp) sp.bot = true; // the computer finishes their hand
      }
      this.sync([], true);
      this.schedule();
    }

    seatOf(member) {
      return this.state ? this.state.players.findIndex((p) => p.pid === member.pid) : -1;
    }

    /* ----- host commands ----- */
    addBot() {
      if (this.members.length >= MAX_PLAYERS) return;
      const used = this.members.map((m) => m.name);
      const name = BOT_NAMES.find((n) => !used.includes(n)) || 'Bot';
      this.members.push({ pid: 'bot-' + Math.random().toString(36).slice(2, 8), name, bot: true, host: false, conn: null, connected: true, seen: 0 });
    }

    cmd(c) {
      if (c.type === 'addBot') { this.addBot(); this.sync([], true); }
      else if (c.type === 'kick') { this.remove(this.members[c.index], 'kicked'); }
      else if (c.type === 'opt') { this.opts[c.key] = c.value; this.sync([], true); }
      else if (c.type === 'start' || c.type === 'next') { this.start(); }
      else if (c.type === 'lobby') { this.state = null; this.clearTimers(); this.sync([], true); }
      this.save();
    }

    start() {
      // drop humans who are gone; everyone present plays
      this.members = this.members.filter((m) => m.bot || m.host || m.connected);
      if (this.members.length < 2) return;
      const players = this.members.map((m) => ({ pid: m.pid, name: m.name, bot: m.bot }));
      this.state = E.newRound(players, this.opts, this.state);
      this.rolled = '';
      this.sync([{ t: 'deal' }]);
      this.schedule(2600);
      this.save();
    }

    /* ----- game ----- */
    act(a) { return this.apply(this.seatOf(this.members.find((m) => m.host)), a); }

    apply(pi, a) {
      if (!this.state) return { ok: false, err: 'No round running' };
      const r = E.act(this.state, pi, a);
      if (!r.ok) return r;
      this.sync(r.events);
      const heavy = r.events.some((e) => e.t === 'draw' && e.n > 1);
      this.schedule(heavy ? 500 : 0);
      this.save();
      return r;
    }

    clearTimers() {
      clearTimeout(this.timer); clearTimeout(this.callTimer); clearTimeout(this.catchTimer);
      this.timer = this.callTimer = this.catchTimer = null;
    }

    isAuto(sp) {
      if (sp.bot) return 'bot';
      const m = this.members.find((x) => x.pid === sp.pid);
      if (!m) return 'bot';
      return m.connected ? null : 'away';
    }

    schedule(extra) {
      clearTimeout(this.timer);
      this.timer = null;
      const s = this.state;
      if (!s || s.phase !== 'play' || this.closed) { this.clearTimers(); return; }
      const cur = s.players[s.turn];
      const auto = this.isAuto(cur);
      if (auto) {
        const delay = ((auto === 'bot' ? 1100 + Math.random() * 800 : 8000) + (extra || 0)) * SPEED;
        const turn = s.turn;
        this.timer = setTimeout(() => {
          if (this.state !== s || s.turn !== turn || s.phase !== 'play') return;
          if (!this.isAuto(s.players[turn])) return;
          this.apply(turn, E.botMove(s, turn));
        }, delay);
      }
      // someone is on one card and has not called it
      if (s.uncalled != null) {
        const key = s.round + ':' + s.discard.length + ':' + s.uncalled;
        if (this.rolled !== key) {
          this.rolled = key;
          clearTimeout(this.callTimer); clearTimeout(this.catchTimer);
          const u = s.uncalled;
          if (this.isAuto(s.players[u])) {
            if (Math.random() < 0.85) {
              this.callTimer = setTimeout(() => { if (this.state === s && s.uncalled === u) this.apply(u, { type: 'call' }); }, 700);
            }
          } else {
            const bots = s.players.map((p, i) => (p.bot && i !== u ? i : -1)).filter((i) => i >= 0);
            if (bots.length && Math.random() < 0.45) {
              const by = bots[Math.floor(Math.random() * bots.length)];
              this.catchTimer = setTimeout(() => { if (this.state === s && s.uncalled === u) this.apply(by, { type: 'catch' }); }, 1700 + Math.random() * 900);
            }
          }
        }
      }
    }

    /* ----- sync ----- */
    lobbyFor(member) {
      const s = this.state;
      return {
        code: this.code,
        solo: this.solo,
        opts: this.opts,
        max: MAX_PLAYERS,
        running: !!s,
        isHost: !!member.host,
        you: this.members.indexOf(member),
        players: this.members.map((m) => ({
          name: m.name, bot: m.bot, host: m.host, connected: m.connected,
          waiting: !!s && !s.players.some((p) => p.pid === m.pid),
        })),
      };
    }

    sync(events, full) {
      if (this.closed) return;
      const s = this.state;
      for (const m of this.members) {
        if (m.bot) continue;
        const pi = this.seatOf(m);
        let view = null;
        if (s && pi >= 0) {
          view = E.view(s, pi);
          view.away = s.players.map((p) => this.isAuto(p) === 'away');
          view.players.forEach((vp, i) => { vp.bot = s.players[i].bot; });
        }
        const msg = {
          t: 'sync', lobby: this.lobbyFor(m), view,
          events: view ? E.eventsFor(events || [], pi) : [],
          full: !!full,
        };
        if (m.host) this.o.onSync(msg);
        else if (m.conn) m.conn.send(msg);
      }
    }

    save() {
      if (this.solo || this.closed) return;
      try {
        sessionStorage.setItem(SNAP_KEY, JSON.stringify({
          code: this.code, opts: this.opts, state: this.state, t: Date.now(),
          members: this.members.map((m) => ({ pid: m.pid, name: m.name, bot: m.bot, host: m.host })),
        }));
      } catch (e) { /* storage full or blocked — hosting still works */ }
    }

    leave() {
      this.closed = true;
      this.clearTimers();
      clearInterval(this.beat);
      try { sessionStorage.removeItem(SNAP_KEY); } catch (e) { /* noop */ }
      for (const m of this.members) if (m.conn) m.conn.send({ t: 'bye', why: 'closed' });
      const net = this.net;
      if (net) setTimeout(() => net.close(), 200);
    }
  }

  HostRoom.snapshot = function () {
    try {
      const sn = JSON.parse(sessionStorage.getItem(SNAP_KEY) || 'null');
      if (sn && Date.now() - sn.t < 15 * 60 * 1000) return sn;
    } catch (e) { /* noop */ }
    return null;
  };

  /* ============================ GUEST ============================ */
  class GuestClient {
    /* o: {code, name, pid, onSync, onStatus(text|null), onError(type), onErrMsg(msg)} */
    constructor(o) {
      this.o = o;
      this.isHost = false;
      this.code = o.code;
      this.conn = null;
      this.left = false;
      this.everOpen = false;
      this.retries = 0;
      this.lastPong = 0;
    }

    open(onReady) {
      this.onReady = onReady;
      this.connect();
    }

    connect() {
      if (this.left) return;
      this.pending = Net.join(this.code, {
        onOpen: (conn) => {
          this.conn = conn;
          this.retries = 0;
          this.lastPong = Date.now();
          conn.onData = (m) => this.onData(m);
          conn.onClose = () => this.lost(conn);
          conn.send({ t: 'join', name: this.o.name, pid: this.o.pid });
          clearInterval(this.beat);
          this.beat = setInterval(() => {
            if (this.conn !== conn) return;
            if (Date.now() - this.lastPong > 7000) { this.lost(conn); return; }
            conn.send({ t: 'ping' });
          }, 2000);
          if (!this.everOpen) { this.everOpen = true; this.onReady && this.onReady(); }
          this.o.onStatus(null);
        },
        onError: (type) => {
          if (this.left) return;
          if (!this.everOpen) { this.o.onError(type); return; }
          this.retry();
        },
      });
    }

    lost(conn) {
      if (this.left || this.conn !== conn) return;
      this.conn = null;
      clearInterval(this.beat);
      try { conn.close(); } catch (e) { /* noop */ }
      this.retry();
    }

    retry() {
      if (this.left) return;
      if (this.retries++ >= 12) { this.left = true; this.o.onError('lost'); return; }
      this.o.onStatus('Reconnecting…');
      setTimeout(() => this.connect(), 2200);
    }

    onData(m) {
      if (!m || typeof m !== 'object') return;
      if (m.t === 'sync') this.o.onSync(m);
      else if (m.t === 'pong') this.lastPong = Date.now();
      else if (m.t === 'err') this.o.onErrMsg(m.msg);
      else if (m.t === 'bye') { this.left = true; clearInterval(this.beat); this.o.onError(m.why); if (this.conn) this.conn.close(); }
    }

    act(a) { if (this.conn) this.conn.send({ t: 'act', a }); return { ok: true }; }
    cmd() { /* guests cannot run host commands */ }

    leave() {
      this.left = true;
      clearInterval(this.beat);
      if (this.conn) { const c = this.conn; c.send({ t: 'leave' }); setTimeout(() => c.close(), 200); }
      else if (this.pending) this.pending.close();
    }
  }

  root.EkkaRoom = { HostRoom, GuestClient, MAX_PLAYERS };
})(self);
