/* Ekka — transport. Two interchangeable back ends:
   - PeerJS (WebRTC data channels): devices talk to each other directly; a public
     broker is only used to introduce them by room code.
   - BroadcastChannel (?local=1): tabs of one browser, used for testing.
   Both give the same tiny API:
     Net.host(code, {onOpen, onConn(conn), onError(type)})  -> {close()}
     Net.join(code, {onOpen(conn), onError(type)})          -> {close()}
     conn: {send(obj), close(), onData, onClose}                                  */
(function (root) {
  'use strict';

  const PREFIX = 'sadapanna-ekka-';
  const LOCAL = /[?&]local=1/.test(location.search);

  /* ---------- PeerJS ---------- */
  function wrapPeerConn(dc) {
    const conn = {
      onData: null, onClose: null, closed: false,
      send(obj) { if (dc.open) { try { dc.send(obj); } catch (e) { /* closing */ } } },
      close() { conn.closed = true; try { dc.close(); } catch (e) { /* noop */ } },
    };
    const shut = () => {
      if (conn.closed) return;
      conn.closed = true;
      if (conn.onClose) conn.onClose();
    };
    dc.on('data', (d) => { if (conn.onData) conn.onData(d); });
    dc.on('close', shut);
    dc.on('error', shut);
    // 'close' is unreliable when a phone drops off wifi — watch ICE too
    dc.on('iceStateChanged', (st) => { if (st === 'failed' || st === 'closed' || st === 'disconnected') shut(); });
    return conn;
  }

  function peerHost(code, h) {
    const peer = new Peer(PREFIX + code, { debug: 0 });
    let closed = false;
    peer.on('open', () => h.onOpen && h.onOpen());
    peer.on('connection', (dc) => {
      dc.on('open', () => h.onConn(wrapPeerConn(dc)));
    });
    peer.on('disconnected', () => { if (!closed) setTimeout(() => { if (!closed && !peer.destroyed) peer.reconnect(); }, 1500); });
    peer.on('error', (err) => {
      if (err.type === 'unavailable-id') h.onError && h.onError('taken');
      else if (err.type === 'peer-unavailable') { /* a guest vanished mid-handshake */ }
      else if (!peer.open) h.onError && h.onError('network');
    });
    return { close() { closed = true; peer.destroy(); } };
  }

  function peerJoin(code, h) {
    const peer = new Peer({ debug: 0 });
    let done = false;
    const failOnce = (type) => { if (!done) { done = true; h.onError && h.onError(type); peer.destroy(); } };
    const timer = setTimeout(() => failOnce('timeout'), 12000);
    peer.on('open', () => {
      const dc = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
      dc.on('open', () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        const conn = wrapPeerConn(dc);
        const close0 = conn.close;
        conn.close = () => { close0(); peer.destroy(); };
        h.onOpen(conn);
      });
    });
    peer.on('error', (err) => {
      clearTimeout(timer);
      failOnce(err.type === 'peer-unavailable' ? 'notfound' : 'network');
    });
    return { close() { done = true; clearTimeout(timer); peer.destroy(); } };
  }

  /* ---------- BroadcastChannel (same browser, for tests) ---------- */
  function bcHost(code, h) {
    const ch = new BroadcastChannel(PREFIX + code);
    const conns = {};
    ch.onmessage = (e) => {
      const m = e.data;
      if (m.to !== 'host') return;
      if (m.k === 'open') {
        const conn = {
          onData: null, onClose: null,
          send(obj) { ch.postMessage({ to: m.from, k: 'data', d: obj }); },
          close() { ch.postMessage({ to: m.from, k: 'close' }); delete conns[m.from]; },
        };
        conns[m.from] = conn;
        ch.postMessage({ to: m.from, k: 'ack' });
        h.onConn(conn);
      } else if (m.k === 'data') {
        const c = conns[m.from];
        if (c && c.onData) c.onData(m.d);
      } else if (m.k === 'close') {
        const c = conns[m.from];
        delete conns[m.from];
        if (c && c.onClose) c.onClose();
      }
    };
    setTimeout(() => h.onOpen && h.onOpen(), 0);
    return {
      close() {
        for (const id in conns) ch.postMessage({ to: id, k: 'close' });
        ch.close();
      },
    };
  }

  function bcJoin(code, h) {
    const ch = new BroadcastChannel(PREFIX + code);
    const me = 'g' + Math.random().toString(36).slice(2, 9);
    let open = false;
    const conn = {
      onData: null, onClose: null,
      send(obj) { try { ch.postMessage({ to: 'host', from: me, k: 'data', d: obj }); } catch (e) { /* closed */ } },
      close() { try { ch.postMessage({ to: 'host', from: me, k: 'close' }); ch.close(); } catch (e) { /* closed */ } },
    };
    ch.onmessage = (e) => {
      const m = e.data;
      if (m.to !== me) return;
      if (m.k === 'ack') { open = true; h.onOpen(conn); }
      else if (m.k === 'data') { if (conn.onData) conn.onData(m.d); }
      else if (m.k === 'close') { if (conn.onClose) conn.onClose(); }
    };
    ch.postMessage({ to: 'host', from: me, k: 'open' });
    const timer = setTimeout(() => { if (!open) { ch.close(); h.onError && h.onError('notfound'); } }, 1200);
    addEventListener('pagehide', () => { try { conn.close(); } catch (e) { /* noop */ } });
    return { close() { clearTimeout(timer); try { ch.close(); } catch (e) { /* noop */ } } };
  }

  root.EkkaNet = {
    local: LOCAL,
    host: LOCAL ? bcHost : peerHost,
    join: LOCAL ? bcJoin : peerJoin,
  };
})(self);
