// ---------------------------------------------------------------------------
// Build the whole site's content from one source of truth: seed-data.json.
//
// No database, no network, no credentials — just reads local files and writes
// plain HTML. Everything ends up in the page as-sent, so search engines and
// link-preview crawlers (which mostly don't run JavaScript) see the real
// content.
//
// It generates:
//   • Home "What's in the works" project cards  → index.html   (PROJECTS markers)
//   • /mind/ post list cards                     → mind/index.html (POSTS markers)
//   • Article pages                              → mind/<slug>/index.html
//   • Blog URLs in the sitemap                   → sitemap.xml   (BLOG_POSTS markers)
//
// Run:  npm run build     (from scripts/)   — or:  node build.mjs
//
// To add/edit content, change seed-data.json (+ a bodies/<slug>.html for posts)
// and re-run. See README.md.
// ---------------------------------------------------------------------------
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, ".."); // repo root (the published site)
const readScript = (p) => readFileSync(join(here, p), "utf8");
const readSite = (p) => readFileSync(join(root, p), "utf8");
const writeSite = (p, c) => writeFileSync(join(root, p), c);

const SITE = "https://sadapanna.com";
const DEFAULT_OG = SITE + "/assets/brand/og-image.png";

// Escape a value for HTML text / double-quoted attributes.
const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

// Render the post date. When a full `datetime` is present, emit a <time> the
// client can turn into "3 hours ago" / "5 mins ago"; the human date stays as
// the text so no-JS visitors and crawlers still see it.
const dateCell = (b) => {
  if (!b.date) return "";
  if (b.datetime) {
    return (
      `<time class="post-date" datetime="${esc(b.datetime)}"` +
      ` data-ts="${esc(b.datetime)}">${esc(b.date)}</time>`
    );
  }
  return `<span>${esc(b.date)}</span>`;
};

// Small client script: swap recent post dates for a relative label. Older than
// a day (or a future/invalid stamp) keeps the absolute date already in the DOM.
const RELATIVE_TIME_SCRIPT = `<script>
(function () {
  function rel(iso) {
    var t = new Date(iso).getTime();
    if (isNaN(t)) return null;
    var d = Date.now() - t;
    if (d < 0) return null;
    var m = Math.floor(d / 6e4);
    if (m < 1) return "just now";
    if (m < 60) return m + " min" + (m === 1 ? "" : "s") + " ago";
    var h = Math.floor(m / 60);
    if (h < 24) return h + " hour" + (h === 1 ? "" : "s") + " ago";
    return null;
  }
  document.querySelectorAll(".post-date[data-ts]").forEach(function (el) {
    var r = rel(el.getAttribute("data-ts"));
    if (r) el.textContent = r;
  });
})();
</script>`;

// Wrap the accent word in <em> (the handwritten style), matching the site.
const accentName = (name, accent) => {
  const safe = esc(name);
  if (accent && String(name).includes(accent)) {
    return safe.replace(esc(accent), "<em>" + esc(accent) + "</em>");
  }
  return safe;
};

// Replace the content between `<!-- NAME:START -->` and `<!-- NAME:END -->`.
function replaceBlock(html, name, indent, block) {
  const START = `<!-- ${name}:START -->`;
  const END = `<!-- ${name}:END -->`;
  const re = new RegExp(`${START}[\\s\\S]*?${END}`);
  if (!re.test(html)) throw new Error(`Markers for "${name}" not found`);
  return html.replace(re, `${START}\n${block}\n${indent}${END}`);
}

// ---- card renderers -------------------------------------------------------

function projectCard(p, i) {
  const cls =
    "card card-" + (p.cardStyle || "lav") + (p.feature ? " card-feature" : "");
  const badgeCls = "card-badge" + (p.vtIcon ? " vt-flux-icon" : "");
  const statusCls =
    "status" +
    (p.statusStyle ? " status-" + p.statusStyle : "") +
    (p.vtStatus ? " vt-flux-status" : "");
  const num = String(i + 1).padStart(2, "0");
  const statusHTML = p.status
    ? `<span class="${statusCls}">` +
      (p.live ? `<span class="status-dot" aria-hidden="true"></span>` : "") +
      `${esc(p.status)}</span>`
    : "";
  const goHTML =
    p.href && p.cta
      ? `<span class="card-go">${esc(p.cta)} <span class="go-arrow">↗</span></span>`
      : "";
  const pillsHTML =
    Array.isArray(p.tags) && p.tags.length
      ? `\n          <div class="card-pills" aria-hidden="true">` +
        p.tags.map((t) => `<span class="card-pill">#${esc(t)}</span>`).join("") +
        `</div>`
      : "";
  const inner =
    `\n          <span class="card-num" aria-hidden="true">${num}</span>` +
    `\n          <span class="card-mark" aria-hidden="true">${esc(p.emoji || "✦")}</span>` +
    `\n          <span class="${badgeCls}">${esc(p.emoji || "✦")}</span>` +
    `\n          <h3>${accentName(p.title, p.accent)}</h3>` +
    `\n          <p>${esc(p.description)}</p>` +
    pillsHTML +
    (statusHTML || goHTML
      ? `\n          <div class="card-foot">${statusHTML}${goHTML}</div>`
      : "") +
    "\n        ";
  return p.href
    ? `        <a class="${cls}" href="${esc(p.href)}">${inner}</a>`
    : `        <article class="${cls}">${inner}</article>`;
}

function postCard(b) {
  const meta =
    `<div class="post-meta">` +
    (b.tag ? `<span class="post-tag">${esc(b.tag)}</span>` : "") +
    dateCell(b) +
    (b.readTime ? `<span>·</span><span>${esc(b.readTime)}</span>` : "") +
    `</div>`;
  return (
    `          <a class="post-card" href="/mind/${encodeURIComponent(b.slug)}/">` +
    `\n            <span class="post-thumb">${
      b.coverImage
        ? `<img src="${esc(b.coverImage)}" alt="" loading="lazy" />`
        : esc(b.emoji || "📝")
    }</span>` +
    `\n            <div class="post-card-body">` +
    `\n              ${meta}` +
    `\n              <h2>${accentName(b.title, b.accent)}</h2>` +
    `\n              <p>${esc(b.excerpt)}</p>` +
    `\n            </div>\n          </a>`
  );
}

// ---- full article page ----------------------------------------------------

function articleHTML(post) {
  const url = `${SITE}/mind/${post.slug}/`;
  const desc = post.excerpt || "";
  const ogImage = post.ogImage ? SITE + post.ogImage : DEFAULT_OG;
  const body = post.bodyFile ? readScript(post.bodyFile) : post.body || "";

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: desc,
    image: ogImage,
    datePublished: post.createdAt || undefined,
    dateModified: post.createdAt || undefined,
    author: { "@type": "Organization", name: post.author || "Sadapanna", url: SITE + "/" },
    publisher: {
      "@type": "Organization",
      name: "Sadapanna",
      logo: { "@type": "ImageObject", url: SITE + "/assets/brand/logo-white.png" },
    },
    isPartOf: { "@type": "Blog", name: "Sadapanna Mind", url: SITE + "/mind/" },
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
  };

  const metaRow =
    (post.tag ? `<span class="post-tag">${esc(post.tag)}</span>\n          ` : "") +
    (post.date ? `${dateCell(post)}\n          ` : "") +
    (post.readTime ? `<span>·</span><span>${esc(post.readTime)}</span>` : "");

  // Cover: a real image (coverImage, pre-cropped to the frame's 16:8.5 ratio)
  // wins over the emoji frame. coverCredit is trusted HTML (may contain links).
  const figcaption =
    post.coverCaption || post.coverCredit
      ? `\n        <figcaption>${esc(post.coverCaption || "")}${
          post.coverCredit ? ` <span class="figure-credit">${post.coverCredit}</span>` : ""
        }</figcaption>`
      : "";
  const figure = post.coverImage
    ? `\n      <figure class="article-figure">
        <div class="figure-frame"><img src="${esc(post.coverImage)}" alt="${esc(
          post.coverAlt || ""
        )}" /></div>${figcaption}
      </figure>\n`
    : post.coverEmoji
    ? `\n      <figure class="article-figure">
        <div class="figure-frame">${esc(post.coverEmoji)}</div>${figcaption}
      </figure>\n`
    : "";

  const tags =
    Array.isArray(post.tags) && post.tags.length
      ? `<div class="article-tags">${post.tags
          .map((t) => `<span class="post-tag">${esc(t)}</span>`)
          .join("")}</div>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(post.title)} · Sadapanna Mind</title>
  <meta name="description" content="${esc(desc)}" />
  <link rel="canonical" href="${url}" />
  <meta name="theme-color" content="#ffffff" />

  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="Sadapanna" />
  <meta property="og:title" content="${esc(post.title)}" />
  <meta property="og:description" content="${esc(desc)}" />
  <meta property="og:url" content="${url}" />
  <meta property="og:image" content="${esc(ogImage)}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  ${post.createdAt ? `<meta property="article:published_time" content="${esc(post.createdAt)}" />` : ""}
  <meta property="article:author" content="Sadapanna" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:image" content="${esc(ogImage)}" />
  <meta name="twitter:title" content="${esc(post.title)}" />
  <meta name="twitter:description" content="${esc(desc)}" />

  <link rel="preload" href="/assets/fonts/madimi-one-latin.woff2" as="font" type="font/woff2" crossorigin />
  <link rel="preload" href="/assets/fonts/poppins-400.woff2" as="font" type="font/woff2" crossorigin />
  <link rel="stylesheet" href="/styles.css?v=12" />
  <link rel="icon" href="/assets/brand/favicon.ico" sizes="any" />
  <link rel="icon" type="image/png" sizes="96x96" href="/assets/brand/favicon-96.png" />
  <link rel="icon" type="image/png" sizes="32x32" href="/assets/brand/favicon-32.png" />
  <link rel="icon" type="image/png" sizes="16x16" href="/assets/brand/favicon-16.png" />
  <link rel="apple-touch-icon" href="/assets/brand/apple-touch-icon.png" />

  <script type="application/ld+json">
${JSON.stringify(jsonLd, null, 2)}
  </script>
  <script type='module' src='https://static.cloudflareinsights.com/beacon.min.js'
    data-cf-beacon='{"token": "decf7f7fdb114793be902266b9912861"}'></script>
</head>

<body>
  <header class="site-header">
    <div class="container">
      <a class="brand" href="/">
        <img class="brand-icon" src="/assets/brand/icon-192.webp" alt="" width="192" height="186" />
        <span class="brand-word">Sadapanna</span>
      </a>
      <nav class="site-nav">
        <a class="nav-pill" href="/#projects">Projects</a>
        <a class="nav-pill" href="/mind/">Mind</a>
        <a class="nav-pill" href="/#about">About</a>
        <a class="nav-pill" href="/#contact">Contact</a>
      </nav>
      <a class="btn btn-outline header-cta" href="mailto:hello@sadapanna.com">Say hello <span
          class="btn-arrow">↗</span></a>
    </div>
  </header>

  <main>
    <article class="container article">
      <nav class="breadcrumb">
        <a href="/mind/">Mind</a><span>/</span>${esc(post.accent || post.title)}
      </nav>

      <header class="article-header">
        <div class="post-meta">
          ${metaRow}
        </div>
        <h1>${accentName(post.title, post.accent)}</h1>
        ${desc ? `<p class="article-lede">${esc(desc)}</p>` : ""}
        <div class="byline">
          <img src="/assets/brand/icon-192.webp" alt="" />
          <div>
            <div class="byline-name">${esc(post.author || "The Sadapanna team")}</div>
            ${post.date ? `<div class="byline-sub">Published ${esc(post.date)}</div>` : ""}
          </div>
        </div>
      </header>
${figure}
      <div class="prose">
${body}
      </div>

      <div class="article-foot">
        <a class="back-link" href="/mind/">← Back to Mind</a>
        ${tags}
      </div>
    </article>
  </main>

  <footer class="site-footer">
    <div class="container">
      <span>© 2026 Sadapanna <img class="foot-icon" src="/assets/brand/icon-192.webp" alt="" width="192"
          height="186" /> made slowly</span>
      <nav class="footer-links">
        <a href="/mind/">Mind</a>
        <a href="/privacy/">Privacy</a>
        <a href="/terms/">Terms</a>
        <a href="/backyard/">Backyard</a>
        <a href="/#contact">Contact</a>
      </nav>
    </div>
  </footer>
  ${RELATIVE_TIME_SCRIPT}
</body>

</html>
`;
}

// ---- sitemap --------------------------------------------------------------

function updateSitemap(posts) {
  let xml = readSite("sitemap.xml");
  const block = posts
    .map(
      (p) =>
        `  <url>\n    <loc>${SITE}/mind/${p.slug}/</loc>\n` +
        (p.createdAt ? `    <lastmod>${p.createdAt}</lastmod>\n` : "") +
        `  </url>`
    )
    .join("\n");
  xml = replaceBlock(xml, "BLOG_POSTS", "  ", block);
  writeSite("sitemap.xml", xml);
}

// ---- run ------------------------------------------------------------------

const data = JSON.parse(readScript("seed-data.json"));
const projects = [...(data.projects || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
const posts = [...(data.blogs || [])].sort((a, b) =>
  String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
);

// 1) Home project cards
let index = readSite("index.html");
index = replaceBlock(index, "PROJECTS", "        ", projects.map(projectCard).join("\n"));
writeSite("index.html", index);
console.log(`✓ index.html — ${projects.length} project card(s)`);

// 2) /mind/ post list
let mind = readSite("mind/index.html");
mind = replaceBlock(mind, "POSTS", "          ", posts.map(postCard).join("\n"));
writeSite("mind/index.html", mind);
console.log(`✓ mind/index.html — ${posts.length} post card(s)`);

// 3) Article pages
for (const post of posts) {
  const dir = join(root, "mind", post.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), articleHTML(post));
  console.log(`✓ mind/${post.slug}/index.html`);
}

// 4) Sitemap
updateSitemap(posts);
console.log("✓ sitemap.xml");

console.log("\nDone. Commit & push to publish.");
