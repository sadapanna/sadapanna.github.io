# ReadFlow

Make the classic "article on screen, camera pans, key phrases get highlighted" YouTube video — entirely in the browser. Vanilla HTML/CSS/JS, no build step; everything renders on canvas and exports client-side.

**Live:** https://sadapanna.com/app/readflow/

## How it works

The UI is a guided four-step wizard — a numbered stepper (① Text → ② Style → ③ Beats → ④ Export) with Next/Back buttons. Steps are navigation, not gates: click any step at any time.

1. **① Text** — paste your article/quote (or hit *Try an example*); the Card theme adds an author line. `js/doc.js` lays the text onto a large virtual page word-by-word with `ctx.measureText`, recording `{x, y, w, h, charStart, charEnd}` per word — the layout oracle every highlight and camera move depends on.
2. **② Style** — page theme (clean / newspaper / dark / notebook / aged / plain / card), font picker (bundled + Google Fonts), text size. Colors, backdrop, gradient, page shadow, column width and spacing live under *Advanced*.
3. **③ Beats** — drag across the rendered page (canvas-native selection via the layout map) and click *+ Add beat*. Each beat row reads like a sentence (`2 "the hidden cost" · Marker · 2.4s`); click it to open the inline editor with highlight style, color and a single *Speed* slider (total seconds, scaled proportionally over the underlying timings). Exact timings (camera travel / highlight speed / pause after), *Track words* (the camera follows the highlight's leading point at a tighter zoom, then eases back out — focus path precomputed per beat so exports stay frame-identical), zoom/nudge, easings and bold sit under the row's *Advanced* disclosure. The step also holds *Sync timing to your voice* (tap-sync: tap Space per beat along your narration; fit-to-N-seconds), *Defaults for new beats*, *Camera* (establishing shot, handheld drift), *Stickers & overlays* (arrows, circles, emoji, images, labels pinned to page coordinates) and *Cinematic filters* (vignette, grain, progress bar).
4. **④ Export** — video size (16:9 / 9:16 / 1:1) and MP4 / WebM / GIF / PNG buttons up front; FPS and safe-area guides under *Advanced* (`js/exporter.js`). Named projects + JSON import/export auto-save to localStorage (`js/storage.js`).

## Architecture

| File | Role |
| --- | --- |
| `js/doc.js` | Text layout engine, page themes, charRange→rects API, page/text drawing |
| `js/camera.js` | Auto-framing, pan/zoom interpolation, handheld drift |
| `js/highlights.js` | One draw module per effect (marker, underline, box, circle, color pop, spotlight, word-reveal, typewriter), each animating over t∈[0,1] |
| `js/beats.js` | Beat model, beat list UI, canvas span selection, tap-sync, fit-to-duration |
| `js/engine.js` | State + `window.RF` contract, timeline, easing library, rAF player, and the pure `drawFrame(ctx, t, w, h)` shared by preview, scrub and export |
| `js/app.js` | UI wiring (stepper, controls, transport, overlay editor, frame presets) |
| `js/exporter.js` | MP4 (WebCodecs + mp4-muxer) / WebM / GIF / PNG export |
| `js/storage.js` | localStorage auto-save, named projects, JSON import/export |
| `js/fonts.js` | Curated Google Fonts catalog + on-demand `FontFace` loader |

## Fonts

The font picker lists the bundled faces (Poppins, Pacifico) and system stacks first — those work **fully offline**, and they stay the defaults. Below them is a static, curated catalog of ~250 popular Google Fonts (the list itself ships in `js/fonts.js`; no API key, no network call to browse it).

A request to Google (`fonts.googleapis.com` for the stylesheet, `fonts.gstatic.com` for the woff2) happens **only when you actually pick a Google font**, or when you open a project that references one. `js/fonts.js` fetches the `css2` stylesheet as text, parses the woff2 URLs and unicode-ranges out of it and registers each as a `FontFace` — a `<link>` alone isn't enough, because `ctx.measureText` only sees a face once it's genuinely loaded. When the face lands, the layout cache is dropped and the page re-flows with the real metrics. If the fetch fails (offline, blocked), the picker falls back to your previous font and shows a small notice; nothing else breaks.

`drawFrame` is pure — same `t` in produces the same pixels at any resolution, watermark included — so preview, scrubbing and every export format are frame-identical.

## Contract (`window.RF`)

```js
RF.state                          // full project state
RF.getTotalDuration()             // seconds
RF.drawFrame(ctx, t, w, h)        // pure renderer, watermark included
RF.getProjectJSON() / RF.loadProjectJSON(obj)
RF.frame                          // {width, height, fps}
// 'rf:change' CustomEvent fires on every state mutation
```

Everything stays on your device — nothing is uploaded.
