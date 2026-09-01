/* ReadFlow fonts.js — curated Google Fonts catalog + on-demand loader.
 *
 * Local-first: the catalog below is static (no API key, no network call to list
 * fonts) and the app's default/bundled faces (Poppins, Pacifico) plus the system
 * stacks work with zero network. A request to fonts.googleapis.com /
 * fonts.gstatic.com happens ONLY when a Google family is actually selected
 * (by the user, or by a project file that references one).
 *
 * Canvas caveat: injecting a <link rel=stylesheet> is not enough — ctx.measureText
 * only sees a face once it is really loaded. So we fetch the css2 stylesheet as
 * text, parse the woff2 URLs + unicode-ranges out of it, register each as a
 * FontFace, and await the load before telling the app to re-layout.
 */
(function () {
  'use strict';

  // ---------- curated catalog ----------
  // Grouped by category so the list stays readable; ~200 of the most-used
  // families on Google Fonts. Poppins/Pacifico are omitted: they ship bundled.
  const GROUPS = {
    'sans-serif': [
      'Inter', 'Inter Tight', 'Roboto', 'Roboto Condensed', 'Roboto Flex', 'Open Sans',
      'Noto Sans', 'Noto Sans Display', 'Montserrat', 'Lato', 'Source Sans 3', 'Raleway',
      'Nunito', 'Nunito Sans', 'Ubuntu', 'Rubik', 'Work Sans', 'Mulish', 'Karla',
      'Manrope', 'DM Sans', 'Barlow', 'Barlow Condensed', 'Heebo', 'Oxygen', 'PT Sans',
      'Fira Sans', 'Cabin', 'Quicksand', 'Josefin Sans', 'Titillium Web', 'Hind',
      'Assistant', 'Exo 2', 'Archivo', 'Archivo Narrow', 'Public Sans', 'Figtree',
      'Outfit', 'Plus Jakarta Sans', 'Space Grotesk', 'Sora', 'Lexend', 'Urbanist',
      'Epilogue', 'Red Hat Display', 'Red Hat Text', 'Chivo', 'Asap', 'Catamaran',
      'Overpass', 'Prompt', 'Kanit', 'Signika', 'Varela Round', 'Maven Pro', 'Jost',
      'Syne', 'Schibsted Grotesk', 'Onest', 'Instrument Sans', 'Bricolage Grotesque',
      'Albert Sans', 'Be Vietnam Pro', 'Commissioner', 'Readex Pro', 'Familjen Grotesk',
      'Hanken Grotesk', 'Gabarito', 'Encode Sans', 'Saira', 'Saira Condensed', 'Mukta',
      'IBM Plex Sans', 'Libre Franklin', 'Cantarell', 'Dosis', 'Questrial', 'Sarabun',
      'Tajawal', 'M PLUS Rounded 1c'
    ],
    'serif': [
      'Lora', 'Merriweather', 'Playfair Display', 'PT Serif', 'Noto Serif',
      'Source Serif 4', 'EB Garamond', 'Libre Baskerville', 'Crimson Text', 'Crimson Pro',
      'Cormorant Garamond', 'Cormorant', 'Bitter', 'Domine', 'Arvo', 'Rokkitt',
      'Zilla Slab', 'Roboto Slab', 'Cardo', 'Neuton', 'Vollkorn', 'Alegreya',
      'Alegreya Sans', 'Spectral', 'Faustina', 'Frank Ruhl Libre', 'Gentium Book Plus',
      'Literata', 'Newsreader', 'Petrona', 'Fraunces', 'Bodoni Moda', 'Prata',
      'Marcellus', 'Cinzel', 'Old Standard TT', 'Rufina', 'Eczar', 'Gelasio', 'Tinos',
      'Amiri', 'Sorts Mill Goudy', 'Josefin Slab', 'Bree Serif', 'Podkova', 'Aleo',
      'Kreon', 'Instrument Serif', 'DM Serif Display', 'DM Serif Text', 'Young Serif',
      'Piazzolla', 'Lustria', 'Noticia Text', 'Playfair Display SC', 'IBM Plex Serif',
      'Libre Caslon Text', 'Playfair'
    ],
    'display': [
      'Oswald', 'Bebas Neue', 'Anton', 'Righteous', 'Fjalla One', 'Abril Fatface',
      'Alfa Slab One', 'Archivo Black', 'Lilita One', 'Passion One', 'Staatliches',
      'Teko', 'Russo One', 'Bungee', 'Bungee Shade', 'Monoton', 'Lobster', 'Lobster Two',
      'Titan One', 'Bangers', 'Fredoka', 'Baloo 2', 'Comfortaa', 'Chewy', 'Luckiest Guy',
      'Concert One', 'Rowdies', 'Secular One', 'Shrikhand', 'Ultra', 'Bowlby One',
      'Boogaloo', 'Creepster', 'Press Start 2P', 'Silkscreen', 'Orbitron', 'Audiowide',
      'Michroma', 'Rajdhani', 'Exo', 'Days One', 'Gruppo', 'Philosopher',
      'Special Elite', 'Rye', 'Cinzel Decorative', 'Unica One', 'Six Caps',
      'Yeseva One', 'Poller One', 'Racing Sans One', 'Krona One', 'Chonburi',
      'Climate Crisis', 'Tourney'
    ],
    'handwriting': [
      'Caveat', 'Caveat Brush', 'Shadows Into Light', 'Indie Flower', 'Dancing Script',
      'Satisfy', 'Great Vibes', 'Sacramento', 'Amatic SC', 'Permanent Marker',
      'Rock Salt', 'Architects Daughter', 'Patrick Hand', 'Gloria Hallelujah', 'Handlee',
      'Homemade Apple', 'Nothing You Could Do', 'Reenie Beanie', 'Covered By Your Grace',
      'Kalam', 'Marck Script', 'Yellowtail', 'Cookie', 'Allura', 'Parisienne',
      'Pinyon Script', 'Tangerine', 'Grand Hotel', 'Courgette', 'Kaushan Script',
      'Bad Script', 'Petit Formal Script', 'La Belle Aurore', 'Just Another Hand',
      'Zeyada', 'Neucha', 'Charm', 'Damion', 'Merienda', 'Sedgwick Ave'
    ],
    'monospace': [
      'JetBrains Mono', 'Fira Code', 'Source Code Pro', 'IBM Plex Mono', 'Roboto Mono',
      'Space Mono', 'Inconsolata', 'Ubuntu Mono', 'Courier Prime', 'PT Mono',
      'Anonymous Pro', 'Cousine', 'Overpass Mono', 'DM Mono', 'Azeret Mono',
      'Red Hat Mono', 'Martian Mono', 'Geist Mono', 'Chivo Mono', 'Share Tech Mono',
      'Nova Mono', 'Syne Mono', 'VT323'
    ]
  };

  const GENERIC = {
    'sans-serif': 'sans-serif',
    'serif': 'serif',
    'display': 'sans-serif',
    'handwriting': 'cursive',
    'monospace': 'monospace'
  };

  const CATALOG = [];
  const byFamily = new Map();
  for (const [category, list] of Object.entries(GROUPS)) {
    for (const family of list) {
      const entry = { family, category };
      CATALOG.push(entry);
      byFamily.set(family.toLowerCase(), entry);
    }
  }

  const CATEGORY_LABEL = {
    'sans-serif': 'Sans-serif',
    'serif': 'Serif',
    'display': 'Display',
    'handwriting': 'Handwriting',
    'monospace': 'Monospace'
  };

  // ---------- css value <-> family ----------

  /** the CSS font-family string stored in RF.state.doc.fontFamily for a Google font */
  function cssValue(family) {
    const e = byFamily.get(String(family).toLowerCase());
    return '"' + family + '", ' + (e ? GENERIC[e.category] : 'sans-serif');
  }

  /** given a doc.fontFamily string, return the Google family it names (or null) */
  function googleFamilyOf(cssFontFamily) {
    if (!cssFontFamily) return null;
    const m = String(cssFontFamily).trim().match(/^["']([^"']+)["']/);
    const name = m ? m[1] : String(cssFontFamily).trim().split(',')[0].trim();
    const e = byFamily.get(name.toLowerCase());
    return e ? e.family : null;
  }

  // ---------- loader ----------

  const loaded = new Set();     // families whose faces are registered + loaded
  const inflight = new Map();   // family -> Promise

  const LOAD_TIMEOUT = 12000;

  function cssUrl(family, withBold) {
    const name = family.replace(/ /g, '+');
    const axis = withBold ? ':wght@400;700' : '';
    return 'https://fonts.googleapis.com/css2?family=' + name + axis + '&display=swap';
  }

  function parseFaces(cssText) {
    const faces = [];
    const blockRe = /@font-face\s*\{([^}]*)\}/g;
    let m;
    while ((m = blockRe.exec(cssText)) !== null) {
      const body = m[1];
      const src = /src:\s*[^;]*url\(([^)]+)\)/.exec(body);
      if (!src) continue;
      const url = src[1].replace(/^["']|["']$/g, '');
      if (!/^https:\/\/fonts\.gstatic\.com\//.test(url)) continue;
      const wght = /font-weight:\s*([^;]+);/.exec(body);
      const styl = /font-style:\s*([^;]+);/.exec(body);
      const ur = /unicode-range:\s*([^;]+);/.exec(body);
      faces.push({
        url,
        weight: wght ? wght[1].trim() : '400',
        style: styl ? styl[1].trim() : 'normal',
        unicodeRange: ur ? ur[1].trim() : undefined
      });
    }
    return faces;
  }

  function withTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(label + ' timed out')), ms);
      promise.then(v => { clearTimeout(t); resolve(v); },
                   e => { clearTimeout(t); reject(e); });
    });
  }

  async function fetchCss(family) {
    // Families with a single weight 404 on :wght@400;700 — retry without the axis.
    for (const withBold of [true, false]) {
      let res;
      try {
        res = await fetch(cssUrl(family, withBold), { mode: 'cors', credentials: 'omit' });
      } catch (err) {
        throw new Error('network');
      }
      if (res.ok) return res.text();
      if (res.status !== 400 && res.status !== 404) throw new Error('http ' + res.status);
    }
    throw new Error('not available');
  }

  async function loadFamily(family) {
    if (!window.FontFace || !document.fonts) throw new Error('FontFace unsupported');
    const cssText = await fetchCss(family);
    const faces = parseFaces(cssText);
    if (!faces.length) throw new Error('no woff2 in stylesheet');

    const added = [];
    const primary = [];
    for (const f of faces) {
      let ff;
      try {
        ff = new FontFace(family, 'url(' + f.url + ') format("woff2")', {
          weight: f.weight, style: f.style, display: 'swap',
          unicodeRange: f.unicodeRange
        });
      } catch (err) { continue; }
      document.fonts.add(ff);
      added.push(ff);
      // Await the latin subsets of 400 and 700 up front: 400 is what measureText
      // needs, and 700 is used by the per-beat "bold" style — pre-loading it keeps
      // an export from switching mid-render from synthesised bold to the real face.
      if (f.style === 'normal' && /(^|\s)(400|700)(\s|$)/.test(f.weight) &&
          (!f.unicodeRange || /U\+0000-00FF|U\+0-00FF/i.test(f.unicodeRange))) {
        primary.push(ff);
      }
    }
    if (!added.length) throw new Error('no usable faces');
    if (!primary.length) primary.push(added[0]);

    const settled = await Promise.all(primary.map(ff => ff.load().then(() => true, () => false)));
    if (!settled.some(Boolean)) throw new Error('font download failed');
    // belt and braces: make sure the font set agrees the family is ready
    try { await document.fonts.load('400 30px "' + family + '"', 'AaBbGg 123'); } catch (e) { /* ignore */ }
    if (document.fonts.check && !document.fonts.check('400 30px "' + family + '"')) {
      throw new Error('face not usable');
    }
    loaded.add(family);
    return family;
  }

  /**
   * ensure(family) → Promise that resolves once the family is usable by
   * ctx.measureText, or rejects (offline / unknown family / blocked).
   * Safe to call repeatedly; results and in-flight requests are shared.
   */
  function ensure(family) {
    if (!family) return Promise.reject(new Error('no family'));
    if (loaded.has(family)) return Promise.resolve(family);
    if (inflight.has(family)) return inflight.get(family);
    const p = withTimeout(loadFamily(family), LOAD_TIMEOUT, family)
      .catch(err => { inflight.delete(family); throw err; });
    p.then(() => inflight.delete(family), () => {});
    inflight.set(family, p);
    return p;
  }

  function isLoaded(family) { return loaded.has(family); }
  function isLoading(family) { return inflight.has(family); }

  window.RFFonts = {
    CATALOG, GROUPS, GENERIC, CATEGORY_LABEL, byFamily,
    cssValue, googleFamilyOf, ensure, isLoaded, isLoading
  };
})();
