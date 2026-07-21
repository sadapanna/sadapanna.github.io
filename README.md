# sadapanna.github.io

Coming-soon website for Sadapanna, hosted on GitHub Pages.

## Pages

- `index.html` — landing page (coming soon, projects teaser, about, contact)
- `privacy/` — Privacy Policy (served at `/privacy/`)
- `terms/` — Terms & Conditions (served at `/terms/`)
- `arrow-flux/privacy-policy/` — Arrow Flux app Privacy Policy, for Play Store/App Store listing (served at `/arrow-flux/privacy-policy/`)
- `app/inkflow/` — InkFlow web app: font/text → animated write-on Lottie, runs entirely client-side (served at `/app/inkflow/`)
- `mind/` — Sadapanna Mind, the blog. Post list at `/mind/`; individual posts render dynamically at `/mind/post/?slug=<slug>`.

Plain HTML/CSS, no build step. Push to `main` and GitHub Pages serves it.

## Dynamic content (Firestore)

Projects (home page) and blog posts (`/mind/`) are stored in Cloud Firestore and
rendered client-side with cursor-based "Load more" pagination. Data is **view-only**
to the public — see [`firestore.rules`](firestore.rules).

- [`assets/firebase-config.js`](assets/firebase-config.js) — public web config.
  **Fill in the three `REPLACE_ME_*` values** from the Firebase console before the
  live data will load. Until then, each page falls back to its built-in static cards.
- [`assets/sada-firebase.js`](assets/sada-firebase.js) — small Firestore data layer
  (loads the Firebase SDK from the CDN; no build step).
- [`scripts/`](scripts/) — Admin-SDK seeder to add/update projects and posts. See
  [`scripts/README.md`](scripts/README.md).

Collections: `projects` (ordered by `order` asc) and `blogs` (ordered by `createdAt`
desc). Both are read-only from the browser; all writes go through the seed script.
