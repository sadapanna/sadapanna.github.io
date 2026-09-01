# ReadFlow

Make the classic "article on screen, camera pans, key phrases get highlighted" YouTube video — entirely in the browser. Vanilla HTML/CSS/JS, no build step, no network requests; everything renders on canvas and exports client-side.

**Live:** https://sadapanna.com/app/readflow/

## How it works

1. **Document** — paste text; pick a page theme (clean / newspaper / dark / notebook / aged / plain / card) and typography. `js/doc.js` lays the text onto a large virtual page word-by-word with `ctx.measureText`, recording `{x, y, w, h, charStart, charEnd}` per word — the layout oracle every highlight and camera move depends on.
2. **Beats** — drag across the rendered page (canvas-native selection via the layout map) and click *Add Beat*. Each beat = char range + highlight effect + auto-framed camera pan/zoom + timings (move-in / highlight / hold, with separate camera & highlight easing). Reorder by drag, edit timings inline. *Tap-sync*: play your narration and tap Space per beat. *Fit to N seconds* scales all timings proportionally.
3. **Overlays** — arrows, scribble circles, emoji, image stickers and labels pinned to page coordinates (they move with the camera), plus vignette / grain / page shadow / backdrop / progress bar.
4. **Export** — MP4 / WebM / GIF / PNG at 16:9, 9:16 or 1:1, 30 or 60 fps (`js/exporter.js`). Projects auto-save to localStorage (`js/storage.js`).

## Architecture

| File | Role |
| --- | --- |
| `js/doc.js` | Text layout engine, page themes, charRange→rects API, page/text drawing |
| `js/camera.js` | Auto-framing, pan/zoom interpolation, handheld drift |
| `js/highlights.js` | One draw module per effect (marker, underline, box, circle, color pop, spotlight, word-reveal, typewriter), each animating over t∈[0,1] |
| `js/beats.js` | Beat model, beat list UI, canvas span selection, tap-sync, fit-to-duration |
| `js/engine.js` | State + `window.RF` contract, timeline, easing library, rAF player, and the pure `drawFrame(ctx, t, w, h)` shared by preview, scrub and export |
| `js/app.js` | UI wiring (tabs, controls, transport, overlay editor, frame presets) |
| `js/exporter.js` | MP4 (WebCodecs + mp4-muxer) / WebM / GIF / PNG export |
| `js/storage.js` | localStorage auto-save, named projects, JSON import/export |

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
