# sadapanna.github.io

Coming-soon website for Sadapanna, hosted on GitHub Pages.

## Pages

- `index.html` — landing page (coming soon, projects teaser, about, contact)
- `privacy/` — Privacy Policy (served at `/privacy/`)
- `terms/` — Terms & Conditions (served at `/terms/`)
- `arrow-flux/privacy-policy/` — Arrow Flux app Privacy Policy, for Play Store/App Store listing (served at `/arrow-flux/privacy-policy/`)
- `app/inkflow/` — InkFlow web app: font/text → animated write-on Lottie, runs entirely client-side (served at `/app/inkflow/`)
- `mind/` — Sadapanna Mind, the blog. Post list at `/mind/`; each article is a
  static page at `/mind/<slug>/`.

Fully static HTML/CSS — no database, no server, no JavaScript framework. The
home project cards, the blog list, and the article pages are all generated from
one file by a small build script; GitHub Pages serves the result.

## Content: one file → static pages

All content lives in [`scripts/seed-data.json`](scripts/seed-data.json) (plus one
HTML file per article in `scripts/bodies/`). Running the build turns it into:

- Home "What's in the works" cards (in `index.html`)
- The `/mind/` post list (in `mind/index.html`)
- Each article page at `/mind/<slug>/`
- The blog URLs in `sitemap.xml`

Because everything is baked into the HTML, articles index in search engines and
preview correctly when links are shared (crawlers mostly don't run JavaScript).
The old `/mind/post/?slug=…` route redirects to `/mind/<slug>/`.

**To add or edit a project or post, see [`scripts/README.md`](scripts/README.md).**
The short version:

```bash
# edit scripts/seed-data.json (+ scripts/bodies/<slug>.html for a post)
cd scripts && npm run build
cd .. && git add -A && git commit -m "Publish: ..." && git push
```

> **CSS cache-busting:** the shared stylesheet is linked as `styles.css?v=N`.
> When you change `styles.css`, bump `N` (search-replace `?v=` across the HTML)
> so browsers/Cloudflare fetch the new file instead of a cached copy.
