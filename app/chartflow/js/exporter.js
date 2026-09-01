/* ==========================================================================
 * exporter.js — render the current ChartFlow state to MP4 / WebM / GIF / PNG,
 * fully client-side (WebCodecs + mp4-muxer, MediaRecorder, gif.js).
 *
 * Every frame comes from the ONE render path: ChartFlow.engine.render(ctx,
 * state, tGlobal). The watermark is drawn by the engine — never stamped here.
 * ========================================================================== */
"use strict";

window.ChartFlow = window.ChartFlow || { charts: {} };

(function () {
  const OPAQUE_FALLBACK = "#0f1117"; // MP4 has no alpha channel

  /* ---------------- frame source ---------------- */

  /* Offscreen surface at state.style.canvas resolution. `even` snaps the
   * bitmap to even pixel dims (h264 requires it) while keeping the engine's
   * logical coordinate space untouched via a scale transform. */
  function makeFrameRenderer(state, opts) {
    opts = opts || {};
    const lw = Math.max(2, Math.round((state.style && state.style.canvas && state.style.canvas.w) || 1920));
    const lh = Math.max(2, Math.round((state.style && state.style.canvas && state.style.canvas.h) || 1080));
    const w = opts.even ? Math.max(2, Math.round(lw / 2) * 2) : lw;
    const h = opts.even ? Math.max(2, Math.round(lh / 2) * 2) : lh;

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { alpha: true, willReadFrequently: false });

    return {
      canvas,
      ctx,
      width: w,
      height: h,
      transparent: isTransparent(state),
      renderAt(tGlobal) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, w, h);
        if (opts.flood) {
          ctx.fillStyle = opts.flood;
          ctx.fillRect(0, 0, w, h);
        }
        ctx.scale(w / lw, h / lh);
        ChartFlow.engine.render(ctx, state, tGlobal);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      },
      destroy() {
        canvas.width = canvas.height = 0;
      },
    };
  }

  function isTransparent(state) {
    return !!(state && state.style && state.style.background &&
      state.style.background.type === "transparent");
  }

  function fpsOf(state) {
    const f = state && state.anim && state.anim.fps;
    return f === 60 ? 60 : (Number(f) > 0 ? Number(f) : 30);
  }

  function frameCountOf(state, fps) {
    const dur = Math.max(0.05, Number(ChartFlow.engine.totalDuration(state)) || 1);
    return Math.max(1, Math.round(dur * fps));
  }

  /* frame index → tGlobal ∈ [0,1] */
  function tAt(f, frames) {
    return frames <= 1 ? 1 : Math.min(1, f / (frames - 1));
  }

  /* setTimeout gets throttled to ~1s in background/occluded tabs, which makes
   * exports crawl — MessageChannel tasks are never throttled. */
  const yieldUI = () => new Promise((r) => {
    const mc = new MessageChannel();
    mc.port1.onmessage = () => r();
    mc.port2.postMessage(null);
  });

  const noop = () => {};

  /* ---------------- MP4 (WebCodecs + mp4-muxer) ---------------- */

  function mp4Supported() {
    return typeof VideoEncoder !== "undefined" &&
      typeof VideoFrame !== "undefined" &&
      typeof window.Mp4Muxer !== "undefined";
  }

  async function exportMP4(state, onProgress) {
    const progress = onProgress || noop;
    if (!mp4Supported()) {
      throw new Error(
        "MP4 export needs WebCodecs, which this browser doesn't support. " +
        "Try Chrome or Edge — or export WebM instead, which works here."
      );
    }

    // MP4/h264 has no alpha: composite a solid backdrop behind the chart.
    const r = makeFrameRenderer(state, { even: true, flood: OPAQUE_FALLBACK });
    try {
      const fps = fpsOf(state);
      const frames = frameCountOf(state, fps);
      const big = r.width * r.height > 921600; // > 720p
      const muxer = new Mp4Muxer.Muxer({
        target: new Mp4Muxer.ArrayBufferTarget(),
        video: { codec: "avc", width: r.width, height: r.height },
        fastStart: "in-memory",
      });

      let encError = null;
      const encoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (e) => { encError = e; },
      });
      encoder.configure({
        codec: big ? "avc1.640028" : "avc1.42001f", // high@4.0 / baseline@3.1
        width: r.width,
        height: r.height,
        bitrate: Math.min(16000000, Math.max(2000000, r.width * r.height * fps * 0.1)),
        framerate: fps,
      });

      for (let f = 0; f < frames; f++) {
        if (encError) throw encError;
        r.renderAt(tAt(f, frames));
        const frame = new VideoFrame(r.canvas, {
          timestamp: Math.round((f * 1e6) / fps),
          duration: Math.round(1e6 / fps),
        });
        encoder.encode(frame, { keyFrame: f % 60 === 0 });
        frame.close();
        while (encoder.encodeQueueSize > 4) await yieldUI(); // real backpressure
        if (f % 5 === 0) await yieldUI();
        progress(f / frames);
      }

      await encoder.flush();
      muxer.finalize();
      if (encError) throw encError;
      progress(1);
      return new Blob([muxer.target.buffer], { type: "video/mp4" });
    } finally {
      r.destroy();
    }
  }

  /* ---------------- WebM (MediaRecorder; keeps alpha in Chrome) ------------ */

  function pickWebMType(wantAlpha) {
    if (typeof MediaRecorder === "undefined") return null;
    // vp9 in a webm container carries an alpha plane in Chromium when the
    // captured canvas itself has alpha. vp8 is the fallback.
    const candidates = wantAlpha
      ? ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]
      : ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
    for (const t of candidates) {
      if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) return t;
    }
    return null;
  }

  async function exportWebM(state, onProgress) {
    const progress = onProgress || noop;
    const transparent = isTransparent(state);
    const mime = pickWebMType(transparent);
    if (!mime) throw new Error("WebM export isn't supported in this browser.");

    // No flood fill: when the background is transparent the canvas keeps its
    // alpha and the recorder encodes it; otherwise engine.drawBackground paints.
    const r = makeFrameRenderer(state, { even: false });
    const fps = fpsOf(state);
    const frames = frameCountOf(state, fps);

    const stream = r.canvas.captureStream(0);
    const track = stream.getVideoTracks()[0];
    const rec = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: Math.min(20000000, Math.max(3000000, r.width * r.height * fps * 0.12)),
    });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

    return await new Promise((resolve, reject) => {
      let settled = false;
      const fail = (err) => {
        if (settled) return;
        settled = true;
        try { r.destroy(); } catch (_) {}
        reject(err);
      };
      rec.onerror = (e) => fail((e && e.error) || new Error("Recording failed."));
      rec.onstop = () => {
        if (settled) return;
        settled = true;
        r.destroy();
        progress(1);
        resolve(new Blob(chunks, { type: "video/webm" }));
      };

      rec.start(200);

      // Realtime pacing without setTimeout (which throttles when occluded).
      (async () => {
        const t0 = performance.now();
        for (let f = 0; f < frames; f++) {
          const due = t0 + (f * 1000) / fps;
          while (performance.now() < due) await yieldUI();
          r.renderAt(tAt(f, frames));
          if (track && track.requestFrame) track.requestFrame();
          else if (stream.requestFrame) stream.requestFrame();
          progress(f / frames);
        }
        // let the last frame land in the muxer before stopping
        await yieldUI();
        rec.stop();
      })().catch(fail);
    });
  }

  /* ---------------- GIF (gif.js worker) ---------------- */

  async function exportGIF(state, onProgress) {
    const progress = onProgress || noop;
    if (typeof GIF === "undefined") throw new Error("GIF encoder failed to load.");

    const fps = fpsOf(state);
    const step = fps > 34 ? 2 : 1;          // GIF tops out near 30fps anyway
    const delay = Math.round((1000 * step) / fps);

    // GIF's 1-bit alpha makes anti-aliased edges ugly; composite onto a solid
    // backdrop when the project background is transparent.
    const flood = isTransparent(state) ? OPAQUE_FALLBACK : null;
    const r = makeFrameRenderer(state, { even: false, flood });
    try {
      const frames = frameCountOf(state, fps);
      const loop = !!(state.anim && state.anim.loop);
      const gif = new GIF({
        workers: 2,
        quality: 8,
        width: r.width,
        height: r.height,
        workerScript: "vendor/gif.worker.js",
        repeat: loop ? 0 : -1,              // 0 = forever, -1 = play once
        background: flood || OPAQUE_FALLBACK,
      });

      for (let f = 0; f < frames; f += step) {
        r.renderAt(tAt(f, frames));
        gif.addFrame(r.canvas, { copy: true, delay });
        if (f % 10 === 0) await yieldUI();
        progress((f / frames) * 0.5);       // first half: capturing
      }

      return await new Promise((resolve, reject) => {
        gif.on("progress", (p) => progress(0.5 + p * 0.5)); // second half: encoding
        gif.on("finished", (blob) => { progress(1); resolve(blob); });
        gif.on("abort", () => reject(new Error("GIF encode aborted.")));
        gif.render();
      });
    } finally {
      r.destroy();
    }
  }

  /* ---------------- PNG (single frame, keeps alpha) ---------------- */

  async function exportPNG(state, tGlobal) {
    const r = makeFrameRenderer(state, { even: false }); // no flood → alpha kept
    try {
      const t = Math.min(1, Math.max(0, Number(tGlobal) || 0));
      r.renderAt(t);
      const canvas = r.canvas;
      return await new Promise((resolve, reject) => {
        if (canvas.toBlob) {
          canvas.toBlob((b) => b ? resolve(b) : reject(new Error("PNG encode failed.")), "image/png");
        } else {
          try {
            const parts = canvas.toDataURL("image/png").split(",")[1];
            const bin = atob(parts);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            resolve(new Blob([bytes], { type: "image/png" }));
          } catch (e) { reject(e); }
        }
      });
    } finally {
      // toBlob has already copied the pixels by the time it resolves
      r.destroy();
    }
  }

  /* ---------------- download ---------------- */

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "chartflow-export";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 2000);
  }

  ChartFlow.exporter = { exportMP4, exportWebM, exportGIF, exportPNG, download };
})();
