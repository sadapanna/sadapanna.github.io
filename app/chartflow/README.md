# ChartFlow

A free, in-browser maker for animated chart and graph videos — the stat clip that sits in
the middle of a YouTube video. Type or import your numbers, pick one of nine chart types
(vertical bar, horizontal bar, bar chart race, line, area, pie/donut, scatter, big-number
KPI counter, progress bar), style it with palettes and theme presets, animate it with a
preset plus an easing curve, then export MP4, WebM, GIF or PNG — including transparent
backgrounds — at 16:9, 9:16 (Shorts) or 1:1.

Everything runs client-side. No accounts, no server, no upload: data lives in the page and
saved projects live in `localStorage`. Exports carry a small
`Made with sadapanna.com/chartflow` watermark, drawn by the engine so the preview and the
export always agree.

Live at <https://sadapanna.com/app/chartflow/>.

## No build step

Vanilla JS, plain `<script>` tags, no bundler, no npm, no transpile. Edit a file, reload
the page. Everything hangs off one global, `window.ChartFlow`; chart modules register
themselves into `ChartFlow.charts`. Serve the directory over any static file server (the
site itself is GitHub Pages) — opening `index.html` from `file://` will trip worker and
`WebCodecs` restrictions.

## Architecture

| File | Responsibility |
| --- | --- |
| `index.html` | Markup for the whole app plus the SEO head. Loads every script in order. |
| `style.css` | All styling. Dark editor chrome; the chart itself is canvas, not DOM. |
| `js/app.js` | The controller: builds the UI, wires every control to state, owns the state object and the undo/redo of it. Largest module. |
| `js/data.js` | `ChartFlow.data` — the spreadsheet-style table editor, paste handling and CSV import. Normalises input into three shapes: `rows` (labels + series), `wide` (items × periods, for the race) and `single` (one KPI value). |
| `js/engine.js` | The single render path. Timeline and easing, frame layout, the preview player and scrubber, and the watermark. Deterministic: `render(state, tGlobal)` draws the same frame every time. |
| `js/exporter.js` | Encoding only. Drives the engine frame by frame and muxes to MP4 (WebCodecs + `mp4-muxer`), WebM, GIF (`gif.js`) or a PNG still. Never draws anything itself. |
| `js/storage.js` | Autosave, named projects in `localStorage`, JSON project export/import. |
| `js/charts/*.js` | One module per chart type, each registering into `ChartFlow.charts`: `bar`, `barh`, `race`, `line`, `area`, `pie`, `scatter`, `kpi`, `progress`. Each takes a normalised data shape plus a time value and draws to the supplied 2D context. |
| `vendor/` | Third-party: `mp4-muxer.min.js`, `gif.js` and its worker. Vendored, not fetched. |

The important invariant: **the engine is the only thing that draws.** Preview, scrubber
and every exported frame go through the same `render()`, so what you scrub past is exactly
what lands in the file.

## Adding a chart type

Drop a new module in `js/charts/`, register it on `ChartFlow.charts`, add its `<script>`
tag to `index.html`, and add it to the chart-type list in `js/app.js`. Declare which data
shape it consumes (`rows`, `wide` or `single`) so `data.js` presents the right table.
