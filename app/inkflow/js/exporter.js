/* ==========================================================================
 * exporter.js — render the current Lottie doc to MP4 / GIF / WebM, fully
 * client-side (WebCodecs + mp4-muxer, gif.js, MediaRecorder).
 * ========================================================================== */
"use strict";

/* offscreen lottie canvas renderer + composite surface.
 * The canvas renderer needs a real, sized, DOM-attached container to build
 * its internal matte buffers — a detached div renders nothing. */
function makeFrameRenderer(doc, scale, bgColor) {
  const w = Math.max(2, Math.round((doc.w * scale) / 2) * 2); // even for h264
  const h = Math.max(2, Math.round((doc.h * scale) / 2) * 2);

  const host = document.createElement("div");
  host.style.cssText =
    `position:fixed;left:-99999px;top:0;width:${w}px;height:${h}px;pointer-events:none;`;
  document.body.appendChild(host);

  const anim = lottie.loadAnimation({
    container: host,
    renderer: "canvas",
    loop: false,
    autoplay: false,
    animationData: JSON.parse(JSON.stringify(doc)),
    rendererSettings: { clearCanvas: true, preserveAspectRatio: "xMidYMid meet", dpr: 1 },
  });
  const src = host.querySelector("canvas");

  const out = document.createElement("canvas");
  out.width = w; out.height = h;
  const outCtx = out.getContext("2d");

  return {
    width: w,
    height: h,
    canvas: out,
    renderFrame(f) {
      anim.goToAndStop(f, true);
      outCtx.clearRect(0, 0, w, h);
      if (bgColor) {
        outCtx.fillStyle = bgColor;
        outCtx.fillRect(0, 0, w, h);
      }
      outCtx.drawImage(src, 0, 0, w, h);
    },
    destroy() { anim.destroy(); host.remove(); },
  };
}

/* setTimeout gets throttled to ~1s in background/occluded views, which makes
 * exports crawl — MessageChannel tasks are never throttled. */
const yieldUI = () => new Promise((r) => {
  const mc = new MessageChannel();
  mc.port1.onmessage = () => r();
  mc.port2.postMessage(null);
});

/* ---------------- MP4 (WebCodecs + mp4-muxer) ---------------- */
function mp4Supported() {
  return typeof VideoEncoder !== "undefined" && typeof Mp4Muxer !== "undefined";
}

async function exportMP4(doc, scale, bgColor, onProgress) {
  const r = makeFrameRenderer(doc, scale, bgColor || "#ffffff");
  try {
    const fps = doc.fr;
    const frames = doc.op;
    const big = r.width * r.height > 921600;
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
      bitrate: Math.min(14_000_000, Math.max(1_500_000, r.width * r.height * fps * 0.1)),
      framerate: fps,
    });

    for (let f = 0; f < frames; f++) {
      if (encError) throw encError;
      r.renderFrame(f);
      const frame = new VideoFrame(r.canvas, {
        timestamp: Math.round((f * 1e6) / fps),
        duration: Math.round(1e6 / fps),
      });
      encoder.encode(frame, { keyFrame: f % 60 === 0 });
      frame.close();
      while (encoder.encodeQueueSize > 4) await yieldUI(); // real backpressure
      if (f % 5 === 0) await yieldUI();
      onProgress(f / frames);
    }
    await encoder.flush();
    muxer.finalize();
    if (encError) throw encError;
    return new Blob([muxer.target.buffer], { type: "video/mp4" });
  } finally {
    r.destroy();
  }
}

/* ---------------- GIF (gif.js) ---------------- */
async function exportGIF(doc, scale, bgColor, onProgress) {
  const r = makeFrameRenderer(doc, scale, bgColor || "#ffffff");
  try {
    const step = doc.fr > 34 ? 2 : 1; // GIF caps out around 30fps anyway
    const delay = Math.round((1000 * step) / doc.fr);
    const gif = new GIF({
      workers: 2,
      quality: 8,
      width: r.width,
      height: r.height,
      workerScript: "vendor/gif.worker.js",
      background: bgColor || "#ffffff",
    });

    for (let f = 0; f < doc.op; f += step) {
      r.renderFrame(f);
      gif.addFrame(r.canvas, { copy: true, delay });
      if (f % 10 === 0) await yieldUI();
      onProgress((f / doc.op) * 0.5); // first half: capturing
    }

    return await new Promise((resolve, reject) => {
      gif.on("progress", (p) => onProgress(0.5 + p * 0.5)); // second half: encoding
      gif.on("finished", (blob) => resolve(blob));
      gif.on("abort", () => reject(new Error("GIF encode aborted")));
      gif.render();
    });
  } finally {
    r.destroy();
  }
}

/* ---------------- WebM (MediaRecorder, keeps alpha in Chrome) ------------ */
function webmSupported() {
  return typeof MediaRecorder !== "undefined" &&
    MediaRecorder.isTypeSupported("video/webm;codecs=vp9");
}

async function exportWebM(doc, scale, bgColor, onProgress) {
  const r = makeFrameRenderer(doc, scale, bgColor); // bgColor null = transparent
  const fps = doc.fr;
  const stream = r.canvas.captureStream(0);
  const track = stream.getVideoTracks()[0];
  const rec = new MediaRecorder(stream, {
    mimeType: "video/webm;codecs=vp9",
    videoBitsPerSecond: 10_000_000,
  });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

  return await new Promise((resolve, reject) => {
    rec.onerror = (e) => { r.destroy(); reject(e.error || new Error("record error")); };
    rec.onstop = () => {
      r.destroy();
      resolve(new Blob(chunks, { type: "video/webm" }));
    };
    rec.start(200);
    // realtime pacing without setTimeout (which throttles when occluded)
    (async () => {
      const t0 = performance.now();
      for (let f = 0; f < doc.op; f++) {
        const due = t0 + (f * 1000) / fps;
        while (performance.now() < due) await yieldUI();
        r.renderFrame(f);
        if (track.requestFrame) track.requestFrame();
        else if (stream.requestFrame) stream.requestFrame();
        onProgress(f / doc.op);
      }
      rec.stop();
    })().catch(reject);
  });
}

/* ---------------- entry point ---------------- */
async function exportAnimation({ doc, format, scale, bgColor, onProgress }) {
  const progress = onProgress || (() => {});
  switch (format) {
    case "mp4":  return { blob: await exportMP4(doc, scale, bgColor, progress),  ext: "mp4" };
    case "gif":  return { blob: await exportGIF(doc, scale, bgColor, progress),  ext: "gif" };
    case "webm": return { blob: await exportWebM(doc, scale, bgColor, progress), ext: "webm" };
    default: throw new Error(`unknown format: ${format}`);
  }
}
