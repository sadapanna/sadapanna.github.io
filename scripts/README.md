# Content build

All the site's content lives in **one file** — [`seed-data.json`](seed-data.json)
(plus one HTML file per article in [`bodies/`](bodies/)). A small script turns it
into plain HTML pages. No database, no server, no credentials.

## What the build generates

Running `npm run build` reads `seed-data.json` and writes:

| Output | From |
|---|---|
| Home "What's in the works" cards → `../index.html` | `projects` |
| `/mind/` post list → `../mind/index.html` | `blogs` |
| `/mind/<slug>/` article pages | `blogs` + `bodies/<slug>.html` |
| Blog URLs in `../sitemap.xml` | `blogs` |

Everything is written as real HTML, so search engines and link-preview crawlers
(which mostly don't run JavaScript) get the full content — that's what makes the
articles index and preview correctly.

The generated regions in `index.html`, `mind/index.html`, and `sitemap.xml` sit
between `<!-- NAME:START -->` / `<!-- NAME:END -->` markers — **don't edit inside
them by hand**, the build overwrites them.

## Setup (once)

```bash
cd scripts
npm install     # no dependencies — this just creates a lockfile; optional
```

The script only uses Node's built-ins, so `node build.mjs` works even without
`npm install`. Needs Node 18+.

## Publishing

```bash
cd scripts
npm run build          # or: node build.mjs
cd ..
git add -A
git commit -m "Publish: <what changed>"
git push               # GitHub Pages serves the result
```

Re-running is always safe — pages are overwritten from `seed-data.json`.

## Adding content

Edit [`seed-data.json`](seed-data.json), run `npm run build`, commit & push.

### A new project (home page card)

Add to the `projects` array:

```jsonc
{
  "title": "My Thing",
  "accent": "Thing",         // word wrapped in the handwritten <em> style
  "emoji": "🚀",
  "description": "One or two sentences.",
  "status": "In development",
  "statusStyle": "light",    // "" | "light" | "dark"
  "cardStyle": "purple",     // "lav" | "purple" | "yellow"
  "href": "/my-thing/",      // optional — omit for a non-clickable card
  "order": 5                 // lower = shown earlier
}
```

### A new blog post

1. Add to the `blogs` array:

```jsonc
{
  "slug": "my-post",         // becomes the URL: /mind/my-post/
  "title": "My Post Title",
  "accent": "Post",          // word wrapped in the handwritten <em> style
  "emoji": "📝",             // thumbnail on the /mind/ list
  "coverEmoji": "📝",        // big cover on the article page (optional)
  "coverCaption": "Optional caption under the cover.",
  "tag": "Product",
  "date": "August 1, 2026",  // display date
  "readTime": "3 min read",
  "author": "The Sadapanna team",
  "excerpt": "Short summary — shown on the card, as the lede, and as the
              social/meta description.",
  "tags": ["Tools", "Update"],
  "ogImage": "/path/to/share-image.png", // optional; defaults to the site OG image
  "bodyFile": "bodies/my-post.html",     // the article body
  "createdAt": "2026-08-01"  // controls list order (newest first)
}
```

2. Write the body in `bodies/<slug>.html` as an HTML fragment (just the inner
   content — no `<html>`/`<body>`). It can use any of the site's article classes:
   `feature-grid` / `feature`, `callout`, `try-banner`, `blockquote`, `code`, etc.
   See [`bodies/introducing-inkflow.html`](bodies/introducing-inkflow.html) for a
   full example.

3. `npm run build`, then commit & push.

The article's `<title>`, meta description, Open Graph / Twitter tags, and JSON-LD
`BlogPosting` schema are all generated from these fields automatically.

## Notes

- **Ordering:** projects by `order` (ascending), posts by `createdAt` (newest
  first).
- **Old links:** `/mind/post/?slug=…` redirects to `/mind/<slug>/`, so anything
  shared before the switch still works.
- **CSS cache-busting:** the stylesheet is linked as `styles.css?v=N`. If you edit
  `../styles.css`, bump `N` across the HTML so browsers fetch the new file.
