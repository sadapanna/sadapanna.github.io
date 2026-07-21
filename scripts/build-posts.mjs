// ---------------------------------------------------------------------------
// Build static, fully-indexable article pages from the blog content.
//
// Reads scripts/seed-data.json + scripts/bodies/*.html and writes a complete
// static page per post at:  mind/<slug>/index.html
//
// Why: search engines and link-preview crawlers (Google, Bing, WhatsApp,
// LinkedIn, Slack, …) read the HTML as-sent and mostly don't run JavaScript.
// Pre-building the pages puts the full article, title, and social tags right
// in the HTML, so every post indexes and previews correctly.
//
// It also refreshes the blog-post URLs in ../sitemap.xml (between the
// BLOG_POSTS markers).
//
// Run:  node build-posts.mjs      (or, with seeding: npm run publish)
//
// No credentials needed — this reads local files only.
// ---------------------------------------------------------------------------
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, ".."); // repo root (the published site)
const read = (p) => readFileSync(join(here, p), "utf8");

const SITE = "https://sadapanna.com";
const DEFAULT_OG = SITE + "/assets/brand/og-image.png";

// Escape a value for use as HTML text or inside a double-quoted attribute.
const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

// Wrap the accent word in <em> (the handwritten style), matching the site.
const accentName = (name, accent) => {
  const safe = esc(name);
  if (accent && String(name).includes(accent)) {
    return safe.replace(esc(accent), "<em>" + esc(accent) + "</em>");
  }
  return safe;
};

function pageHTML(post) {
  const url = `${SITE}/mind/${post.slug}/`;
  const desc = post.excerpt || "";
  const ogImage = post.ogImage ? SITE + post.ogImage : DEFAULT_OG;
  const body = post.bodyFile ? read(post.bodyFile) : post.body || "";

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
    (post.date ? `<span>${esc(post.date)}</span>\n          ` : "") +
    (post.readTime ? `<span>·</span><span>${esc(post.readTime)}</span>` : "");

  const figure = post.coverEmoji
    ? `\n      <figure class="article-figure">
        <div class="figure-frame">${esc(post.coverEmoji)}</div>${
          post.coverCaption ? `\n        <figcaption>${esc(post.coverCaption)}</figcaption>` : ""
        }
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
  <link rel="stylesheet" href="/styles.css?v=2" />
  <link rel="icon" href="/assets/brand/favicon.ico" sizes="any" />
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
</body>

</html>
`;
}

// Refresh the blog-post <url> entries in sitemap.xml between the markers.
function updateSitemap(posts) {
  const path = join(root, "sitemap.xml");
  let xml = readFileSync(path, "utf8");
  const START = "<!-- BLOG_POSTS:START -->";
  const END = "<!-- BLOG_POSTS:END -->";
  const block = posts
    .map(
      (p) =>
        `  <url>\n    <loc>${SITE}/mind/${p.slug}/</loc>\n` +
        (p.createdAt ? `    <lastmod>${p.createdAt}</lastmod>\n` : "") +
        `  </url>`
    )
    .join("\n");
  const replacement = `${START}\n${block}\n  ${END}`;

  if (xml.includes(START) && xml.includes(END)) {
    xml = xml.replace(new RegExp(`${START}[\\s\\S]*${END}`), replacement);
  } else {
    // First run: insert the block just before </urlset>.
    xml = xml.replace("</urlset>", `${replacement}\n</urlset>`);
  }
  writeFileSync(path, xml);
}

const data = JSON.parse(read("seed-data.json"));
const posts = data.blogs || [];

console.log(`Building ${posts.length} article page(s)…`);
for (const post of posts) {
  const dir = join(root, "mind", post.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), pageHTML(post));
  console.log(`  ✓ mind/${post.slug}/index.html`);
}

updateSitemap(posts);
console.log("  ✓ sitemap.xml updated");
console.log("\nDone. Commit & push the generated pages to publish.");
