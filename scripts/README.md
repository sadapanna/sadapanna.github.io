# Content: seeding + building

This folder is how projects and blog posts get onto the site. You edit one JSON
file (plus an HTML file per article), run **one command**, then commit & push.

## How the content is served

| What | Where it comes from | Notes |
|---|---|---|
| Home "What's in the works" cards | Firestore `projects` (ordered by `order`) | Rendered in the browser with "Load more" |
| `/mind/` blog list | Firestore `blogs` (ordered by `createdAt`, newest first) | Rendered in the browser with "Load more" |
| `/mind/<slug>/` article pages | **Pre-built static HTML** from `seed-data.json` + `bodies/` | Full content in the HTML → indexes & previews correctly |

Two pieces work together:

- **Firestore** powers the *lists* (home + `/mind/`), so pagination scales as you
  add posts. It's **view-only** to the public (see [`../firestore.rules`](../firestore.rules));
  all writes go through the seed script, which uses the Admin SDK.
- **Static generation** (`build-posts.mjs`) turns each post into a real
  `/mind/<slug>/index.html` with the article, title, and social tags baked in.
  This is what makes articles show up in Google/Bing and give proper link
  previews in WhatsApp, Slack, LinkedIn, etc. — crawlers read the HTML as-sent
  and mostly don't run JavaScript, so the content has to already be there.

  The old `/mind/post/?slug=…` route now just redirects to `/mind/<slug>/`.

## One-time setup

Auth for seeding uses **Application Default Credentials (ADC)** — no key file.

1. **Log in** (needs the [gcloud CLI](https://cloud.google.com/sdk/docs/install)):
   ```bash
   gcloud auth application-default login
   ```
   Use an account with write access to the Firestore project. Credentials are
   stored locally and picked up automatically.

2. **Install deps:**
   ```bash
   cd scripts
   npm install
   ```

> In CI or on GCP, skip step 1 — ADC comes from the environment
> (`GOOGLE_APPLICATION_CREDENTIALS`, or the metadata server).
> The project id is read from [`../.firebaserc`](../.firebaserc).

## Publishing (the one command)

From `scripts/`:

```bash
npm run publish
```

That does both steps in order:

1. `node seed.mjs` — pushes `projects` + `blogs` to Firestore (powers the lists).
2. `node build-posts.mjs` — generates the static `/mind/<slug>/` article pages and
   refreshes the blog URLs in [`../sitemap.xml`](../sitemap.xml).

Then commit & push — GitHub Pages serves the result.

```bash
cd ..
git add -A
git commit -m "Publish: <what changed>"
git push
```

Everything is idempotent (docs are keyed by `id`, pages are overwritten), so
re-running is always safe.

### Running the steps separately

```bash
npm run seed            # Firestore only (projects + blogs)
npm run seed:projects   # just projects
npm run seed:blogs      # just blogs
npm run build           # just regenerate static article pages + sitemap
```

`npm run build` needs **no credentials** — it only reads local files. Handy when
you only changed article wording and don't need to touch Firestore.

## Adding content

Edit [`seed-data.json`](seed-data.json), then `npm run publish`.

### A new project

```jsonc
{
  "id": "my-thing",          // stable doc id
  "title": "My Thing",
  "accent": "Thing",         // word wrapped in the handwritten <em> style
  "emoji": "🚀",
  "description": "One or two sentences.",
  "status": "In development",
  "statusStyle": "light",    // "" | "light" | "dark"
  "cardStyle": "purple",     // "lav" | "purple" | "yellow"
  "href": "/my-thing/",      // optional — omit for a non-clickable card
  "order": 5,                // lower = shown earlier
  "published": true
}
```

### A new blog post

1. Add an entry to `blogs` in `seed-data.json`:

```jsonc
{
  "id": "my-post",
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
  "published": true,
  "createdAt": "2026-08-01"  // controls list order (newest first)
}
```

2. Write the body in `bodies/<slug>.html` as an HTML fragment (just the inner
   content — no `<html>`/`<body>`). It can use any of the site's article classes:
   `feature-grid` / `feature`, `callout`, `try-banner`, `blockquote`, `code`, etc.
   See [`bodies/introducing-inkflow.html`](bodies/introducing-inkflow.html) for a
   full example.

3. `npm run publish`, then commit & push.

The static page's `<title>`, meta description, Open Graph / Twitter tags, and
JSON-LD `BlogPosting` schema are all generated from these fields automatically.

> **Note on `published`.** The field is stored for future use, but the current
> Firestore queries order by a single field (`order` / `createdAt`) and do **not**
> filter on it, so every document is shown. Likewise `build-posts.mjs` generates a
> page for every blog entry. To support drafts, add `where("published","==",true)`
> to the queries in [`../assets/sada-firebase.js`](../assets/sada-firebase.js)
> (plus the matching composite index) and a filter in `build-posts.mjs`.

## Deploying the security rules

Only needed when the rules change (or the first time, to leave test mode):

```bash
# from the repo root
firebase deploy --only firestore:rules
```
