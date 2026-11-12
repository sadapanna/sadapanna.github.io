/* Ekka — tiny synthesised sound effects (WebAudio, no files). */
(function (root) {
  'use strict';
  let ctx = null;
  let on = true;
  try { on = localStorage.getItem('ekka.sound') !== '0'; } catch (e) { /* noop */ }

  function ac() {
    if (!ctx) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, t0, dur, type, vol, slideTo) {
    const a = ac(); if (!a) return;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type || 'sine';
    const t = a.currentTime + t0;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.15, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(a.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function noise(t0, dur, vol, freq) {
    const a = ac(); if (!a) return;
    const len = Math.floor(a.sampleRate * dur);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = a.createBufferSource();
    src.buffer = buf;
    const f = a.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq || 1800; f.Q.value = 0.8;
    const g = a.createGain();
    g.gain.value = vol || 0.2;
    src.connect(f); f.connect(g); g.connect(a.destination);
    src.start(a.currentTime + t0);
  }

  const sounds = {
    play() { noise(0, 0.09, 0.28, 2400); tone(220, 0, 0.08, 'triangle', 0.12, 140); },
    draw() { noise(0, 0.07, 0.16, 1200); },
    deal() { noise(0, 0.05, 0.12, 1700); },
    skip() { tone(520, 0, 0.1, 'square', 0.07, 300); tone(300, 0.1, 0.14, 'square', 0.07, 180); },
    rev() { tone(380, 0, 0.12, 'triangle', 0.14, 620); tone(620, 0.12, 0.14, 'triangle', 0.14, 380); },
    plus() { tone(196, 0, 0.16, 'sawtooth', 0.09); tone(147, 0.12, 0.22, 'sawtooth', 0.09); },
    wild() { [392, 494, 587, 784].forEach((f, i) => tone(f, i * 0.06, 0.22, 'triangle', 0.11)); },
    call() { tone(660, 0, 0.1, 'square', 0.09); tone(880, 0.1, 0.1, 'square', 0.09); tone(1320, 0.2, 0.25, 'square', 0.09); },
    caught() { tone(300, 0, 0.18, 'sawtooth', 0.11, 150); tone(150, 0.18, 0.3, 'sawtooth', 0.11, 80); },
    turn() { tone(784, 0, 0.12, 'sine', 0.14); tone(1047, 0.1, 0.2, 'sine', 0.14); },
    win() { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.11, 0.26, 'triangle', 0.14)); },
    lose() { [392, 349, 294, 262].forEach((f, i) => tone(f, i * 0.16, 0.3, 'triangle', 0.11)); },
    nope() { tone(160, 0, 0.14, 'square', 0.06); },
    join() { tone(587, 0, 0.1, 'sine', 0.1); tone(880, 0.09, 0.16, 'sine', 0.1); },
    tick() { tone(1200, 0, 0.05, 'square', 0.05); },
    pop() { tone(500, 0, 0.09, 'sine', 0.12, 980); },
    lift() { noise(0, 0.04, 0.08, 3000); },
    out() { tone(260, 0, 0.2, 'sawtooth', 0.12, 110); tone(110, 0.2, 0.4, 'sawtooth', 0.12, 55); noise(0.2, 0.25, 0.2, 500); },
    time() { [880, 880, 880].forEach((f, i) => tone(f, i * 0.2, 0.14, 'square', 0.09)); tone(440, 0.6, 0.5, 'square', 0.1, 220); },
  };

  root.EkkaSfx = {
    play(name) { if (on && sounds[name]) { try { sounds[name](); } catch (e) { /* audio blocked */ } } },
    unlock() { if (on) ac(); },
    get on() { return on; },
    toggle() {
      on = !on;
      try { localStorage.setItem('ekka.sound', on ? '1' : '0'); } catch (e) { /* noop */ }
      return on;
    },
  };
})(self);
