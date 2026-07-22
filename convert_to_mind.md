# convert_to_mind.md — turn a brainstorm into a published Mind article

**How to use:** After a brainstorming session, invoke this file (e.g. "follow
`convert_to_mind.md`"). Claude reads the whole conversation, distills the single
best idea, and produces a finished **Sadapanna Mind** article that matches the
house style exactly — then builds and publishes it.

Follow every step below. The goal is that the output is indistinguishable from a
post written by hand, so the blog stays consistent over time.

---

## 0. What you're working with

The site is fully static. All content lives in **one file** —
`scripts/seed-data.json` — plus **one HTML body fragment per article** in
`scripts/bodies/<slug>.html`. A small Node build script turns those into the real
pages, the `/mind/` list, and the sitemap. You do **not** hand-write the page
wrapper; the build generates it.

Key paths (relative to the site root, `sadapanna.github.io/`):

- `scripts/seed-data.json` — add the post's metadata here (in the `blogs` array).
- `scripts/bodies/<slug>.html` — write the article body here (an HTML fragment).
- `scripts/build.mjs` — run it to generate everything. Node 18+, no dependencies.
- `mind/<slug>/index.html` — generated output. Don't edit by hand.
- `styles.css` — shared styles; the body uses existing classes only.

---

## 1. Pick the one idea (don't summarize the whole chat)

A brainstorm is messy. An article is one sharp idea. From the session, choose the
**single most interesting, non-obvious thing** — the "here's the part almost
nobody knows" — and build the whole piece around it. Everything else from the
chat is either supporting detail or gets cut.

If the session clearly points at more than one strong article, pick the best one
and, at the end, tell the user the other candidates so they can ask for those
next. Don't try to cram two ideas into one post.

---

## 2. Research and verify before you write

The house rule is that **every factual claim is backed by a real, checkable
source.** Do not rely on memory for numbers, dates, or "firsts."

- Use web search / fetch to confirm each figure and find a citable source.
- Prefer primary or reputable sources (government data, research institutes,
  established outlets). One good source per claim.
- If a claim can't be sourced, either soften it to what you can support, or drop
  it. Never invent a statistic or a link.
- Keep the exact URLs — they go in the Sources list and as inline links.

---

## 3. Voice and writing rules (this is what keeps it consistent)

Write like a smart friend explaining something over chai — clear, warm, and
never stiff. Concretely:

- **Layered disclosure.** Start at the surface so anyone gets it, then go deeper
  as the reader continues. The reader "can stop at any line and still have the
  whole story."
- **Plain language.** Short sentences. Explain any jargon inline the first time
  ("ethanol is just fermented sugar"). Prefer everyday examples.
- **Second person.** Talk to "you." Make it personal and specific.
- **Human, not AI-flavoured.** No "in today's world," "moreover," "furthermore,"
  "delve," "it's important to note," "in conclusion," or listy hedging. Use
  contractions. Vary sentence length. Let a sentence be short.
- **Honest and balanced.** Include the catch, the trade-off, or why it isn't the
  full story. End on a real thought, not a sales pitch.
- **British-ish spelling** to match existing posts (fertiliser, litre,
  kilometre, colour) — follow whatever the latest posts use.
- Length: aim for the site norm, roughly a **7–9 min read** (~1,400–1,900 words).

---

## 4. Structure blueprint (match this exactly)

Write the body fragment (`scripts/bodies/<slug>.html`) as inner HTML only — no
`<html>`/`<body>`, no `<h1>` (the build adds the title). Use these blocks in this
order. Copy an existing post like `bodies/fuel-from-the-sea.html` as your
template.

1. **Two opening paragraphs.** First para: the hook — the surprising idea in
   plain words. Second para: the one sentence that frames why it matters, ending
   with the "you can stop at any line below and still have the whole story" move
   (reworded naturally).

2. **"The short version" box** — the whole article in 4–6 bullets:
   ```html
   <div class="key-points">
     <p class="eyebrow">The short version</p>
     <ul>
       <li>…</li>
     </ul>
   </div>
   ```

3. **Body sections.** Each section is an `<h2>` with a short, conversational
   heading, then a plain paragraph anyone can read, then the depth hidden in a
   fold so it never clutters the main flow:
   ```html
   <h2>Conversational section heading</h2>
   <p>The plain-language version, no jargon.</p>
   <details class="unfold">
     <summary>Go deeper: what the curious reader wants next</summary>
     <div class="unfold-body">
       <p>The detail, the numbers, the nuance — with inline
         <a href="URL">source links</a> on the key claims.</p>
     </div>
   </details>
   ```
   Use **4–5 sections** that build on each other, surface → deep. Put inline
   `<a href>` links on the important facts inside the `unfold-body`.

4. **"The bottom line"** — a final `<h2>The bottom line</h2>` with one or two
   paragraphs that land the point and leave the reader with a real question or
   takeaway. No new facts here.

5. **Sources** — a numbered list, one entry per source, same format as existing
   posts:
   ```html
   <section class="sources">
     <h2>Sources</h2>
     <ol>
       <li><span class="src-pub">Publication</span> —
         <a href="URL">"Title or headline."</a> One short line on what this
         source backs up.</li>
     </ol>
   </section>
   ```
   Every inline link used above should also appear here. Keep the order roughly
   in the order claims appear.

Allowed body classes (from `styles.css`): `key-points` / `eyebrow`,
`details.unfold` / `summary` / `unfold-body`, `sources` / `src-pub`, plus
`callout`, `feature-grid` / `feature`, `try-banner`, `blockquote`, `code` if
useful. Use `<strong>` for key claims and `<em>` for conceptual turns —
sparingly.

---

## 5. Add the metadata entry

Add a new object as the **first item** of the `blogs` array in
`scripts/seed-data.json` (newest first). Fields and conventions:

```jsonc
{
  "id": "your-slug",
  "slug": "your-slug",                 // kebab-case → URL /mind/your-slug/
  "title": "A plain, curiosity-driven title",
  "accent": "word",                    // ONE word from the title, wrapped in the
                                       // handwritten <em> style + shown in breadcrumb
  "emoji": "🌊",                        // pick one that fits the idea
  "coverEmoji": "🌊",                   // usually same as emoji
  "coverCaption": "One sentence under the big cover — the idea in a breath.",
  "tag": "Energy",                     // ONE primary tag (Energy, Privacy, Product, Economy…)
  "date": "July 22, 2026",             // display date = the day you publish
  "datetime": "2026-07-22T18:00:00+05:30", // ISO, Asia/Kolkata (+05:30); use a time
                                       // later than the current newest post so it sorts on top
  "readTime": "8 min read",
  "author": "Rohit Gupta",             // default author for these idea posts
  "excerpt": "2–3 sentence summary — shown on the card, as the lede, and as the
              social/meta description. Make it inviting, not clickbait.",
  "tags": ["Energy", "India", "Topic", "Explainer"], // 3–4 tags for the footer
  "bodyFile": "bodies/your-slug.html",
  "published": true,
  "createdAt": "2026-07-22"            // controls list order (newest first)
}
```

Consistency defaults: **author** is `Rohit Gupta` unless the user says otherwise;
**date/createdAt** are today; pick a **datetime** slightly later than the current
newest post so the new one sorts first. The build auto-generates the page
`<title>`, meta description, Open Graph/Twitter tags, and JSON-LD from these
fields, so fill them thoughtfully.

---

## 6. Build, then publish

From the site root:

```bash
cd scripts && npm run build      # or: node build.mjs   (Node 18+, no install needed)
cd .. && git add -A && git commit -m "Publish: <short title>" && git push
```

`npm run build` regenerates `mind/<slug>/index.html`, the `/mind/` list, and
`sitemap.xml` from `seed-data.json`. Re-running is always safe.

Notes for the environment you may be running in:

- **Running the build:** `build.mjs` uses only Node built-ins and needs no
  network, so it works offline (including on the local machine via the device
  bridge). Run it against the real repo files.
- **Pushing:** `git push` needs network access and the user's credentials. If the
  current environment can't reach the network (e.g. a sandboxed local shell),
  do the build and commit, then tell the user to run `git push` themselves — give
  them the exact command. Don't claim it's published if you couldn't push.
- **CSS cache-busting:** only relevant if you touched `styles.css` (you normally
  won't). If you did, bump the `?v=N` on the stylesheet link across the HTML.

---

## 7. Before you call it done — checklist

- [ ] The article is built on **one** clear idea, not a chat summary.
- [ ] Every number, date, and "first" has a real source; every inline link
      resolves and also appears in the Sources list.
- [ ] Structure present and in order: two-paragraph hook → `key-points` box →
      4–5 `<h2>` sections each with a `details.unfold` → `The bottom line` →
      `sources` `<ol>`.
- [ ] Voice is plain, human, second-person; no AI filler phrases.
- [ ] `seed-data.json` entry added as the newest item, all fields filled,
      `slug`/`bodyFile`/`id` consistent, and the JSON still parses.
- [ ] Body fragment is inner HTML only (no `<h1>`, no `<html>`/`<body>`).
- [ ] Build ran clean; the new page renders and shows on `/mind/`.
- [ ] Committed; pushed (or the user has been given the push command).
- [ ] Delivered the finished page to the user to preview, and mentioned any
      other article ideas the brainstorm could still become.

Keep this file the single source of truth. If the house style evolves, update
this file so future posts stay consistent.
