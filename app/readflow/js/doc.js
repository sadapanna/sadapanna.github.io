/* ReadFlow doc.js — text layout engine.
 * Lays pasted text onto a large virtual "page" with ctx.measureText, word by word.
 * Every word records {x, y, w, h, charStart, charEnd} in PAGE coordinates.
 * The charRange→rects API is the layout oracle highlights and the camera depend on.
 * Pure functions of the doc settings; results memoized on a settings key.
 */
(function () {
  'use strict';

  const measureCanvas = document.createElement('canvas');
  const mctx = measureCanvas.getContext('2d');

  // ---------- page themes ----------
  // Each theme: page/backdrop colors, decorations, optional typography suggestions.
  const THEMES = {
    clean: {
      label: 'Clean', pageBg: '#ffffff', text: '#1c1c28', backdrop: '#e9e9f2',
      radius: 6, sw: '#ffffff'
    },
    newspaper: {
      label: 'News', pageBg: '#faf7f0', text: '#1a1a1a', backdrop: '#d8d4ca',
      radius: 2, suggestFont: "Georgia, 'Times New Roman', serif", suggestWidth: 980,
      rule: true, sw: '#faf7f0'
    },
    dark: {
      label: 'Dark', pageBg: '#16161f', text: '#e8e8f0', backdrop: '#08080c',
      radius: 8, darkPage: true, sw: '#16161f'
    },
    notebook: {
      label: 'Notes', pageBg: '#fffef8', text: '#232338', backdrop: '#e3e0d5',
      radius: 4, ruled: true, margin: true, sw: '#fffef8'
    },
    aged: {
      label: 'Aged', pageBg: '#f0e6cf', text: '#3d3020', backdrop: '#c9bda2',
      radius: 3, aged: true, sw: '#f0e6cf'
    },
    transparent: {
      label: 'Plain', pageBg: null, text: '#1c1c28', backdrop: '#f2f2f7',
      radius: 0, sw: '#f2f2f7'
    },
    screenshot: {
      label: 'Card', pageBg: '#ffffff', text: '#1c1c28', backdrop: null, // gradient backdrop
      radius: 26, card: true, gradient: ['#c7d2fe', '#fbcfe8'], hasAuthor: true, sw: '#dcd4f4'
    }
  };

  const PAGE_PAD = 84;         // inner padding of the page
  const CACHE_MAX = 4;
  const cache = new Map();     // settingsKey -> layout

  function settingsKey(doc) {
    return [doc.text, doc.theme, doc.fontFamily, doc.fontSize, doc.lineHeight,
            doc.paraSpacing, doc.maxWidth, doc.author || ''].join('');
  }

  function fontString(doc, bold) {
    return (bold ? '700 ' : '400 ') + doc.fontSize + 'px ' + doc.fontFamily;
  }

  /**
   * layout(doc) → {
   *   words: [{text, x, y, w, h, charStart, charEnd, line, baseline}],
   *   lines: [{y, h, baseline, wordStart, wordEnd, charStart, charEnd}],
   *   pageWidth, pageHeight, pad, lineStep, theme
   * }
   * y is the TOP of the line box; baseline is the text baseline y.
   */
  function layout(doc) {
    const key = settingsKey(doc);
    if (cache.has(key)) return cache.get(key);

    const theme = THEMES[doc.theme] || THEMES.clean;
    const colW = doc.maxWidth;
    const pageWidth = colW + PAGE_PAD * 2;
    const lineStep = doc.fontSize * doc.lineHeight;
    const paraGap = doc.paraSpacing * doc.fontSize;

    mctx.font = fontString(doc, false);
    const spaceW = mctx.measureText(' ').width;
    const ascent = doc.fontSize * 0.8; // stable across fonts; good enough for boxes
    const words = [];
    const lines = [];

    let y = PAGE_PAD;
    const text = doc.text || '';
    const paragraphs = [];
    { // split into paragraphs, tracking char offsets
      let off = 0;
      for (const part of text.split('\n')) {
        paragraphs.push({ text: part, offset: off });
        off += part.length + 1;
      }
    }

    for (let p = 0; p < paragraphs.length; p++) {
      const para = paragraphs[p];
      if (p > 0) y += paraGap;
      if (para.text.trim() === '') { y += lineStep; continue; }

      // tokenize into words with char offsets (splits on runs of spaces/tabs)
      const tokens = [];
      const re = /[^ \t]+/g;
      let m;
      while ((m = re.exec(para.text)) !== null) {
        tokens.push({ text: m[0], charStart: para.offset + m.index, charEnd: para.offset + m.index + m[0].length });
      }

      let x = PAGE_PAD;
      let lineWords = [];

      const flushLine = () => {
        if (!lineWords.length) return;
        lines.push({
          y: y, h: lineStep, baseline: y + (lineStep + ascent) / 2 - doc.fontSize * 0.1,
          wordStart: words.length - lineWords.length, wordEnd: words.length,
          charStart: lineWords[0].charStart, charEnd: lineWords[lineWords.length - 1].charEnd
        });
        const bl = lines[lines.length - 1].baseline;
        for (const w of lineWords) { w.line = lines.length - 1; w.baseline = bl; }
        lineWords = [];
        y += lineStep;
      };

      for (const tok of tokens) {
        let tw = mctx.measureText(tok.text).width;
        if (x > PAGE_PAD && x + tw > PAGE_PAD + colW) flushLine(), x = PAGE_PAD;
        // hard-break a single word wider than the column
        if (tw > colW) {
          let rest = tok.text, cs = tok.charStart;
          while (rest.length) {
            let n = rest.length;
            while (n > 1 && mctx.measureText(rest.slice(0, n)).width > colW) n--;
            const piece = rest.slice(0, n);
            const pw = mctx.measureText(piece).width;
            const word = { text: piece, x, y, w: pw, h: lineStep, charStart: cs, charEnd: cs + n, line: -1, baseline: 0 };
            words.push(word); lineWords.push(word);
            cs += n; rest = rest.slice(n);
            if (rest.length) { flushLine(); x = PAGE_PAD; } else { x += pw + spaceW; }
          }
          continue;
        }
        const word = { text: tok.text, x, y, w: tw, h: lineStep, charStart: tok.charStart, charEnd: tok.charEnd, line: -1, baseline: 0 };
        words.push(word); lineWords.push(word);
        x += tw + spaceW;
      }
      flushLine();
    }

    let contentBottom = y + PAGE_PAD;
    let authorY = 0;
    if (theme.hasAuthor && doc.author) {
      authorY = y + doc.fontSize * 1.2;
      contentBottom = authorY + doc.fontSize * 1.1 + PAGE_PAD * 0.8;
    }
    const pageHeight = Math.max(contentBottom, pageWidth * 0.4);

    const result = {
      words, lines, pageWidth, pageHeight, pad: PAGE_PAD, lineStep, theme,
      authorY, settingsKeyStr: key
    };
    cache.set(key, result);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    return result;
  }

  /**
   * charRange → array of line rects {x, y, w, h, line} in page coords.
   * Handles partial words by measuring substrings.
   */
  function rangeRects(doc, start, end) {
    const L = layout(doc);
    if (end <= start) return [];
    mctx.font = fontString(doc, false);
    const rects = [];
    let cur = null;
    for (const w of L.words) {
      if (w.charEnd <= start || w.charStart >= end) { continue; }
      let x0 = w.x, x1 = w.x + w.w;
      if (start > w.charStart) x0 = w.x + mctx.measureText(w.text.slice(0, start - w.charStart)).width;
      if (end < w.charEnd) x1 = w.x + mctx.measureText(w.text.slice(0, end - w.charStart)).width;
      if (cur && cur.line === w.line) {
        cur.w = Math.max(cur.w, x1 - cur.x);
      } else {
        cur = { x: x0, y: w.y, w: x1 - x0, h: w.h, line: w.line };
        rects.push(cur);
      }
    }
    // pad slightly for nicer highlight boxes
    for (const r of rects) { r.x -= 3; r.w += 6; }
    return rects;
  }

  /** union bounding box of a char range, page coords; null if empty */
  function rangeBounds(doc, start, end) {
    const rects = rangeRects(doc, start, end);
    if (!rects.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of rects) {
      x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
      x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /** page point → char index (word-snapped inside, char-accurate at edges) */
  function hitChar(doc, px, py) {
    const L = layout(doc);
    if (!L.lines.length) return 0;
    // nearest line
    let best = 0, bestD = Infinity;
    for (let i = 0; i < L.lines.length; i++) {
      const ln = L.lines[i];
      const d = py < ln.y ? ln.y - py : (py > ln.y + ln.h ? py - (ln.y + ln.h) : 0);
      if (d < bestD) { bestD = d; best = i; }
    }
    const ln = L.lines[best];
    mctx.font = fontString(doc, false);
    for (let wi = ln.wordStart; wi < ln.wordEnd; wi++) {
      const w = L.words[wi];
      if (px < w.x + w.w) {
        if (px <= w.x) return w.charStart;
        // char-accurate within the word
        let acc = w.x;
        const chars = Array.from(w.text); // emoji-safe iteration
        let ci = w.charStart;
        for (const ch of chars) {
          const cw = mctx.measureText(ch).width;
          if (px < acc + cw / 2) return ci;
          acc += cw; ci += ch.length;
        }
        return w.charEnd;
      }
    }
    return ln.charEnd;
  }

  // ---------- drawing ----------

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // deterministic pseudo-random for aged blotches
  function prand(i) { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }

  /** draws the page background + decorations in page coords */
  function drawPage(ctx, doc, opts) {
    const L = layout(doc);
    const theme = L.theme;
    const W = L.pageWidth, H = L.pageHeight;

    if (opts && opts.shadow && theme.pageBg) {
      ctx.save();
      ctx.shadowColor = 'rgba(20,20,40,0.28)';
      ctx.shadowBlur = 48; ctx.shadowOffsetY = 14;
      ctx.fillStyle = theme.pageBg;
      roundRect(ctx, 0, 0, W, H, theme.radius);
      ctx.fill();
      ctx.restore();
    }
    if (theme.pageBg) {
      ctx.fillStyle = theme.pageBg;
      roundRect(ctx, 0, 0, W, H, theme.radius);
      ctx.fill();
    }

    ctx.save();
    roundRect(ctx, 0, 0, W, H, theme.radius);
    ctx.clip();

    if (theme.aged) {
      const g = ctx.createRadialGradient(W / 2, H / 2, W * 0.1, W / 2, H / 2, Math.max(W, H) * 0.75);
      g.addColorStop(0, 'rgba(255,250,230,0.35)');
      g.addColorStop(1, 'rgba(120,90,40,0.28)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 26; i++) {
        const bx = prand(i) * W, by = prand(i + 40) * H, br = 14 + prand(i + 80) * 60;
        ctx.fillStyle = 'rgba(140,105,55,' + (0.02 + prand(i + 120) * 0.045).toFixed(3) + ')';
        ctx.beginPath(); ctx.ellipse(bx, by, br, br * (0.6 + prand(i + 160) * 0.7), prand(i) * 3, 0, Math.PI * 2); ctx.fill();
      }
    }

    if (theme.ruled) {
      ctx.strokeStyle = 'rgba(120,160,220,0.35)'; ctx.lineWidth = 1.4;
      for (let ly = L.pad + L.lineStep; ly < H - 20; ly += L.lineStep) {
        ctx.beginPath(); ctx.moveTo(14, ly + 4); ctx.lineTo(W - 14, ly + 4); ctx.stroke();
      }
      if (theme.margin) {
        ctx.strokeStyle = 'rgba(230,110,110,0.45)'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(L.pad * 0.62, 0); ctx.lineTo(L.pad * 0.62, H); ctx.stroke();
      }
    }

    if (theme.rule) { // newspaper top rule
      ctx.strokeStyle = 'rgba(26,26,26,0.75)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(L.pad, L.pad * 0.55); ctx.lineTo(W - L.pad, L.pad * 0.55); ctx.stroke();
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(L.pad, L.pad * 0.55 + 6); ctx.lineTo(W - L.pad, L.pad * 0.55 + 6); ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * draws the document text in page coords.
   * styleFor(word) may return null (default) or
   *   { alpha, color, bold, visibleChars (typewriter partial), caret }
   */
  function drawText(ctx, doc, styleFor) {
    const L = layout(doc);
    const theme = L.theme;
    const baseColor = doc.textColor || theme.text;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    const normalFont = fontString(doc, false);
    const boldFont = fontString(doc, true);
    ctx.font = normalFont;
    ctx.fillStyle = baseColor;
    let curBold = false, curColor = baseColor, curAlpha = 1;
    ctx.globalAlpha = 1;

    for (const w of L.words) {
      const st = styleFor ? styleFor(w) : null;
      const bold = !!(st && st.bold);
      const color = (st && st.color) || baseColor;
      const alpha = st && st.alpha !== undefined ? st.alpha : 1;
      if (alpha <= 0.004 && !(st && st.caret)) continue;
      if (bold !== curBold) { ctx.font = bold ? boldFont : normalFont; curBold = bold; }
      if (color !== curColor) { ctx.fillStyle = color; curColor = color; }
      if (alpha !== curAlpha) { ctx.globalAlpha = alpha; curAlpha = alpha; }

      if (st && st.visibleChars !== undefined && st.visibleChars < (w.charEnd - w.charStart)) {
        const part = w.text.slice(0, Math.max(0, st.visibleChars));
        if (part) ctx.fillText(part, w.x, w.baseline);
        if (st.caret) {
          const cw = mctxMeasure(ctx, part);
          ctx.fillRect(w.x + cw + 1, w.baseline - doc.fontSize * 0.78, Math.max(2, doc.fontSize * 0.07), doc.fontSize * 0.9);
        }
      } else {
        ctx.fillText(w.text, w.x, w.baseline);
        if (st && st.caret) {
          ctx.fillRect(w.x + w.w + 2, w.baseline - doc.fontSize * 0.78, Math.max(2, doc.fontSize * 0.07), doc.fontSize * 0.9);
        }
      }
    }
    ctx.globalAlpha = 1;

    // author line (screenshot/card theme)
    if (theme.hasAuthor && doc.author) {
      ctx.font = '400 ' + Math.round(doc.fontSize * 0.72) + 'px ' + doc.fontFamily;
      ctx.fillStyle = baseColor;
      ctx.globalAlpha = 0.55;
      ctx.fillText(doc.author, L.pad, L.authorY + doc.fontSize * 0.72);
      ctx.globalAlpha = 1;
    }
  }

  function mctxMeasure(ctx, s) { return ctx.measureText(s).width; }

  function clearCache() { cache.clear(); }

  window.RFDoc = { THEMES, layout, rangeRects, rangeBounds, hitChar, drawPage, drawText, roundRect, fontString, PAGE_PAD, clearCache };
})();
