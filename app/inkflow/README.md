# Font Stroke Flow — web app

Any font + your text → an animated **write-on Lottie** file, built entirely in
the browser. No backend, no build step — a fully static site.

## Run locally

```bash
npx serve web          # or: python3 -m http.server -d web 8000
```

Then open the printed URL. (Opening `index.html` via `file://` won't work —
the app fetches bundled fonts/data, which browsers block from disk.)

## Deploy

The `web/` folder **is** the site. Deploy it anywhere that serves static files:

| Platform | How |
|---|---|
| **Netlify** | drag & drop the `web` folder at [app.netlify.com/drop](https://app.netlify.com/drop) |
| **Vercel** | `cd web && npx vercel deploy --prod` |
| **GitHub Pages** | push the repo, set Pages source to the `web/` folder |
| **Cloudflare Pages** | create project → upload the `web` folder |

## Features

- **Two animation styles**
  - *Outline + Fill* — the letter's outline is traced by a stroke, then the
    fill fades in. Works with any `.ttf` / `.otf` / `.woff` you upload
    (parsed client-side with opentype.js — your font never leaves the browser).
  - *Handwriting* — true single-line pen strokes in real stroke order, using
    the classic Hershey engraving fonts (11 pen styles: sans, script, cursive,
    serif, gothic…). Uses Lottie Trim Paths in "individually" mode so strokes
    draw one after another like actual writing.
- **Controls**: easing (14 presets), per-letter duration, letter overlap
  0–120 %, uniform vs. natural (length-proportional) letter timing, end hold,
  FPS, font size, stroke width, stroke/fill colors, fill fade start + length,
  transparent or colored background.
- **Player**: play/pause, restart, scrubber, loop, preview speed.
- **Export**:
  - **Lottie JSON** — tiny, editable in After Effects, plays in every Lottie
    player (web, iOS, Android).
  - **MP4 video** — encoded fully in the browser (WebCodecs H.264 + mp4-muxer),
    at 0.5×/1×/2× resolution.
  - **GIF** — gif.js, capped at ~30fps.
  - **WebM** — MediaRecorder VP9; keeps transparency in Chrome, ideal for
    overlaying in video edits.
  Nothing is uploaded anywhere — all encoding happens client-side.

## Credits / licenses

- [opentype.js](https://github.com/opentypejs/opentype.js) (MIT) — font parsing
- [lottie-web](https://github.com/airbnb/lottie-web) (MIT) — preview player
- [hersheytextjs](https://github.com/techninja/hersheytextjs) — Hershey font
  JSON (Hershey fonts: public-domain US-government data)
- Bundled fonts: Poppins, Pacifico (SIL Open Font License)
