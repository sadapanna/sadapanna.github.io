/* ==========================================================================
 * exporter.js — render the current ReadFlow project to MP4 / WebM / GIF / PNG,
 * fully client-side (WebCodecs + mp4-muxer, MediaRecorder, gif.js).
 *
 * Talks to the app only through the window.RF contract:
 *   RF.getTotalDuration()                    -> seconds
 *   RF.drawFrame(ctx, tSeconds, w, h)        -> pure renderer (watermark included)
 *   RF.frame = { width, height, fps }
 * Nothing here draws a watermark — drawFrame already does.
 * ========================================================================== */
'use strict';

(function () {
  /* ---------------- small helpers ---------------- */

  /* setTimeout gets throttled to ~1s in background/occluded tabs, which makes
   * exports crawl — MessageChannel tasks are never throttled. */
  const yieldUI = () => new Promise((r) => {
    const mc = new MessageChannel();
    mc.port1.onmessage = () => r();
    mc.port2.postMessage(null);
  });

  function $(id) { return document.getElementById(id); }

  function frameSpec() {
    const f = (window.RF && RF.frame) || {};
    // h264 wants even dimensions; keep the same surface for every format so the
    // preview and the exports can't drift apart.
    const w = Math.max(2, Math.round((+f.width || 1080) / 2) * 2);
    const h = Math.max(2, Math.round((+f.height || 1920) / 2) * 2);
    let fps = Math.round(+f.fps || 30);
    if (!(fps > 0)) fps = 30;
    return { width: w, height: h, fps };
  }

  function makeSurface(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { alpha: false });
    return {
      canvas: c,
      ctx,
      width: w,
      height: h,
      renderAt(t) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, w, h);
        ctx.restore();
        RF.drawFrame(ctx, t, w, h);
      },
    };
  }

  function totalFrames(fps) {
    let dur = 0;
    try { dur = +RF.getTotalDuration() || 0; } catch (e) { dur = 0; }
    return Math.max(1, Math.round(dur * fps));
  }

  function download(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  /* ---------------- progress / button state ---------------- */

  const BUTTON_IDS = ['export-mp4', 'export-webm', 'export-gif', 'export-png'];
  let busy = false;

  function setStatus(text) {
    const el = $('export-progress');
    if (!el) return;
    el.textContent = text || '';
    // works whether the markup uses [hidden] or not
    if (text) el.removeAttribute('hidden');
    else el.setAttribute('hidden', '');
  }

  function setProgress(label, p) {
    const pct = Math.max(0, Math.min(100, Math.round(p * 100)));
    setStatus(label + ' ' + pct + '%');
  }

  function setBusy(on) {
    busy = on;
    for (const id of BUTTON_IDS) {
      const b = $(id);
      if (b) b.disabled = on;
    }
  }

  /* ---------------- MP4 (WebCodecs + mp4-muxer) ---------------- */

  function mp4Supported() {
    return typeof VideoEncoder !== 'undefined' && typeof Mp4Muxer !== 'undefined';
  }

  async function pickMP4Config(width, height, fps) {
    // Panning text is h264's worst case (full-frame motion, hard edges), so
    // budget ~0.25 bits/pixel/frame — 1080p30 lands around 15 Mbps.
    const bitrate = Math.min(35000000, Math.max(4000000, width * height * fps * 0.25));
    // best profile/level the browser will take: High 4.2 (1080p60), High 4.0,
    // Main 4.0, then Baseline 3.1 as the last resort
    const codecs = ['avc1.64002a', 'avc1.640028', 'avc1.4d0028', 'avc1.42001f'];
    for (const codec of codecs) {
      const cfg = { codec, width, height, bitrate, framerate: fps, latencyMode: 'quality' };
      try {
        const res = await VideoEncoder.isConfigSupported(cfg);
        if (res && res.supported) return cfg;
      } catch (e) { /* try the next one */ }
    }
    throw new Error('No supported H.264 encoder configuration in this browser.');
  }

  async function exportMP4(onProgress) {
    const { width, height, fps } = frameSpec();
    const s = makeSurface(width, height);
    const frames = totalFrames(fps);

    const muxer = new Mp4Muxer.Muxer({
      target: new Mp4Muxer.ArrayBufferTarget(),
      video: { codec: 'avc', width, height },
      fastStart: 'in-memory',
    });

    let encError = null;
    const encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => { encError = e; },
    });
    encoder.configure(await pickMP4Config(width, height, fps));

    // a keyframe every ~2s keeps players seekable without bloating the file
    const gop = Math.max(1, fps * 2);

    for (let f = 0; f < frames; f++) {
      if (encError) throw encError;
      s.renderAt(f / fps);
      const frame = new VideoFrame(s.canvas, {
        timestamp: Math.round((f * 1e6) / fps),
        duration: Math.round(1e6 / fps),
      });
      encoder.encode(frame, { keyFrame: f % gop === 0 });
      frame.close();
      while (encoder.encodeQueueSize > 4) await yieldUI(); // real backpressure
      if (f % 5 === 0) await yieldUI();
      onProgress(f / frames);
    }

    await encoder.flush();
    muxer.finalize();
    if (encError) throw encError;
    return new Blob([muxer.target.buffer], { type: 'video/mp4' });
  }

  /* ---------------- WebM (MediaRecorder) ---------------- */

  function webmMime() {
    if (typeof MediaRecorder === 'undefined') return null;
    const candidates = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ];
    for (const m of candidates) {
      try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) {}
    }
    return null;
  }

  async function exportWebM(onProgress) {
    const mime = webmMime();
    if (!mime) throw new Error('WebM recording is not supported in this browser.');

    const { width, height, fps } = frameSpec();
    const s = makeSurface(width, height);
    const frames = totalFrames(fps);

    const stream = s.canvas.captureStream(0); // 0 = we push frames by hand
    const track = stream.getVideoTracks()[0];
    const rec = new MediaRecorder(stream, {
      mimeType: mime,
      // same "text in motion" budget as MP4: ~0.25 bits/pixel/frame
      videoBitsPerSecond: Math.min(35000000, Math.max(4000000, width * height * fps * 0.25)),
    });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

    return await new Promise((resolve, reject) => {
      rec.onerror = (e) => reject((e && e.error) || new Error('record error'));
      rec.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
      rec.start(200);
      // MediaRecorder timestamps wall-clock, so the frames have to be paced in
      // real time — but with MessageChannel, not setTimeout (throttling again).
      (async () => {
        const t0 = performance.now();
        for (let f = 0; f < frames; f++) {
          const due = t0 + (f * 1000) / fps;
          while (performance.now() < due) await yieldUI();
          s.renderAt(f / fps);
          if (track && track.requestFrame) track.requestFrame();
          else if (stream.requestFrame) stream.requestFrame();
          onProgress(f / frames);
        }
        await yieldUI();
        rec.stop();
      })().catch(reject);
    });
  }

  /* ---------------- GIF (gif.js) ---------------- */

  async function exportGIF(onProgress) {
    if (typeof GIF === 'undefined') throw new Error('GIF encoder failed to load.');

    const spec = frameSpec();
    const fps = spec.fps;
    // GIF delays are centiseconds and big palettes are slow — cap at ~15fps and
    // scale the surface down so the encode stays interactive.
    const step = Math.max(1, Math.round(fps / 15));
    const gifFps = fps / step;
    const delay = Math.round(1000 / gifFps);

    const scale = Math.min(1, 720 / Math.max(spec.width, spec.height));
    const w = Math.max(2, Math.round(spec.width * scale));
    const h = Math.max(2, Math.round(spec.height * scale));
    const s = makeSurface(w, h);
    const frames = totalFrames(fps);

    const gif = new GIF({
      workers: 2,
      quality: 5, // gif.js: lower = better palette sampling

      dither: 'FloydSteinberg-serpentine',
      width: w,
      height: h,
      workerScript: 'vendor/gif.worker.js',
    });

    for (let f = 0; f < frames; f += step) {
      s.renderAt(f / fps);
      gif.addFrame(s.canvas, { copy: true, delay });
      if (f % 10 === 0) await yieldUI();
      onProgress((f / frames) * 0.5); // first half: capturing
    }

    return await new Promise((resolve, reject) => {
      gif.on('progress', (p) => onProgress(0.5 + p * 0.5)); // second half: encoding
      gif.on('finished', (blob) => resolve(blob));
      gif.on('abort', () => reject(new Error('GIF encode aborted')));
      gif.render();
    });
  }

  /* ---------------- PNG (single frame at the current scrub time) ---------- */

  function currentTime() {
    const rf = window.RF || {};
    if (typeof rf.getCurrentTime === 'function') {
      const t = +rf.getCurrentTime();
      if (isFinite(t)) return Math.max(0, t);
    }
    const st = rf.state || {};
    const cands = [rf.currentTime, rf.time, st.currentTime, st.time, st.playhead];
    for (const c of cands) {
      const t = +c;
      if (isFinite(t) && c !== undefined && c !== null) return Math.max(0, t);
    }
    return 0;
  }

  async function exportPNG() {
    const { width, height } = frameSpec();
    const s = makeSurface(width, height);
    s.renderAt(currentTime());
    return await new Promise((resolve, reject) => {
      s.canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Could not encode PNG.'));
      }, 'image/png');
    });
  }

  /* ---------------- entry points ---------------- */

  async function run(kind) {
    if (busy) return;
    if (!window.RF || typeof RF.drawFrame !== 'function') {
      setStatus('Nothing to export yet.');
      return;
    }
    if (kind === 'mp4' && !mp4Supported()) {
      setStatus('MP4 export needs WebCodecs, which this browser does not support. Try WebM instead (or use Chrome/Edge).');
      return;
    }

    setBusy(true);
    try {
      let blob, name;
      if (kind === 'mp4') {
        blob = await exportMP4((p) => setProgress('Encoding MP4…', p));
        name = 'readflow.mp4';
      } else if (kind === 'webm') {
        blob = await exportWebM((p) => setProgress('Recording WebM…', p));
        name = 'readflow.webm';
      } else if (kind === 'gif') {
        blob = await exportGIF((p) => setProgress('Encoding GIF…', p));
        name = 'readflow.gif';
      } else {
        setStatus('Saving PNG…');
        blob = await exportPNG();
        name = 'readflow.png';
      }
      download(blob, name);
      setStatus('Saved ' + name);
      setTimeout(() => { if (!busy) setStatus(''); }, 4000);
    } catch (err) {
      console.error('[readflow] export failed', err);
      const msg = (err && err.message) ? err.message : String(err);
      setStatus('Export failed: ' + msg + (kind === 'mp4' ? ' — try WebM instead.' : ''));
    } finally {
      setBusy(false);
    }
  }

  function bind(id, kind) {
    const el = $(id);
    if (!el) return; // the page may not offer every format — skip quietly
    el.addEventListener('click', (e) => { e.preventDefault(); run(kind); });
  }

  document.addEventListener('DOMContentLoaded', () => {
    bind('export-mp4', 'mp4');
    bind('export-webm', 'webm');
    bind('export-gif', 'gif');
    bind('export-png', 'png');
    if (!mp4Supported()) {
      const b = $('export-mp4');
      if (b) b.title = 'MP4 needs WebCodecs (Chrome/Edge). WebM works everywhere.';
    }
    setStatus('');
  });

  // handy for the console / other scripts
  window.RFExport = { run, mp4Supported };
})();
