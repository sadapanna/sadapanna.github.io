# Firestore content seeding

The site reads two Firestore collections at runtime and renders them:

| Collection | Used by | Order |
|---|---|---|
| `projects` | Home page "What's in the works" cards | `order` ascending |
| `blogs` | `/mind/` list + `/mind/post/?slug=…` articles | `createdAt` descending |

Both are **view-only** to the public (see [`../firestore.rules`](../firestore.rules)).
All writes happen here, server-side, with the Firebase Admin SDK — which bypasses
the rules. This is the only way content gets in or changes.

## One-time setup

Auth uses **Application Default Credentials (ADC)** — no key file to manage.

1. **Log in.** (Requires the [gcloud CLI](https://cloud.google.com/sdk/docs/install).)
   ```bash
   gcloud auth application-default login
   ```
   Log in as an account with write access to the Firestore project. This stores
   local credentials the Admin SDK picks up automatically.

2. **Install deps.**
   ```bash
   cd scripts
   npm install
   ```

> In CI or on GCP, skip step 1 — ADC comes from the environment instead
> (`GOOGLE_APPLICATION_CREDENTIALS`, or the instance metadata server).
> The project id is read from [`../.firebaserc`](../.firebaserc).

## Seeding / updating

```bash
node seed.mjs            # projects + blogs
node seed.mjs projects   # projects only
node seed.mjs blogs      # blogs only
```

Every document is keyed by its `id`, so re-running **updates in place** — safe to
run as often as you like.

## Adding content

Edit [`seed-data.json`](seed-data.json) and re-run `node seed.mjs`.

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

```jsonc
{
  "id": "my-post",
  "slug": "my-post",         // the ?slug= in the URL
  "title": "My Post Title",
  "accent": "Post",
  "emoji": "📝",             // thumbnail on the /mind/ list
  "coverEmoji": "📝",        // big cover on the article page (optional)
  "coverCaption": "Optional caption under the cover.",
  "tag": "Product",
  "date": "August 1, 2026",  // display date
  "readTime": "3 min read",
  "author": "The Sadapanna team",
  "excerpt": "Short summary shown on the card and as the article lede.",
  "tags": ["Tools", "Update"],
  "bodyFile": "bodies/my-post.html",  // article body (HTML fragment)
  "published": true,
  "createdAt": "2026-08-01"  // controls ordering (newest first)
}
```

Write the article body as an HTML fragment in `bodies/<slug>.html` (just the
inner content — no `<html>`/`<body>`). It can use any of the site's article
classes: `feature-grid` / `feature`, `callout`, `try-banner`, `blockquote`, etc.
See [`bodies/introducing-inkflow.html`](bodies/introducing-inkflow.html) for a
full example.

> **Note on `published`.** The field is stored for future use, but the current
> queries order by a single field (`order` / `createdAt`) and do **not** filter
> on it, so every document in the collection is shown. To support drafts, add a
> `where("published", "==", true)` to the queries in
> [`../assets/sada-firebase.js`](../assets/sada-firebase.js) and create the
> matching composite index in `../firestore.indexes.json`.

## Deploying the rules

```bash
# from the repo root
firebase deploy --only firestore:rules
```
