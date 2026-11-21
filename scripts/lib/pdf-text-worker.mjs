// Bounded PDF text worker (VSD-092 review fix 6). Runs ONLY as a child process of pass-b-source-text.mjs, which
// enforces the time, memory and output limits and kills this process on breach. Reads one PDF from stdin, writes one
// JSON object to stdout. Uses Mozilla pdf.js (pdfjs-dist, pinned in package.json) for parsing, every standard stream
// filter, fonts, CMaps and encodings. It never renders and never evaluates PDF JavaScript.
//
// Fidelity rule: nothing that cannot be decoded is silently dropped. Each page reports undecodable characters
// (U+FFFD, private-use code points, control characters), text-extraction errors and pdf.js warnings about fonts or
// streams; the parent fails the extraction when any of them is present.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fontStateReplay } from './pdf-font-state.mjs';

const MAX_PAGES = Number(process.env.PDF_WORKER_MAX_PAGES || 400);
const MAX_CHARS = Number(process.env.PDF_WORKER_MAX_CHARS || 4_000_000);
const warnings = [];
// pdf.js reports problems through console.log("Warning: …"); keep them as evidence, never on stdout.
console.log = (...a) => { if (warnings.length < 200) warnings.push(a.map(String).join(' ').slice(0, 300)); };
console.warn = console.log; console.info = () => {};

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve('pdfjs-dist/package.json'));
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const input = Buffer.concat(chunks), data = new Uint8Array(input);
const UNDECODED = /[�-\u0000-\u0008\u000B\u000C\u000E-\u001F]/gu;
const out = { ok: false, version: pdfjs.version, pages: [], warnings, error: null, truncated: false, unmappedFonts: [] };

// ---- font decodability audit (pdf.js silently GUESSES text for codes with no Unicode mapping) ----
// Audited from pdf.js's OWN resolved data, never from the raw bytes: for every glyph each page actually shows
// (the operator list's showText glyphs, which include forms and every content stream), look up the font pdf.js
// resolved for it (commonObjs, exported with fontExtraProperties) and require a real code->Unicode entry. pdf.js
// falls back to the raw character code when its toUnicode map has no entry, and uses an identity map for a Type0
// font with no ToUnicode; both are guesses. Dictionary key order, indirect objects and object streams are all
// resolved by pdf.js before this sees them (review-2 R2-2).
// Review-3 finding 1: the font of each shown glyph comes from replaying the graphics state (pdf-font-state.mjs).
function auditPageFonts(page, ops, unmapped) {
  const bad = new Map();
  const lookup = key => (page.commonObjs.has(key) ? page.commonObjs.get(key) : null);
  for (const { state, glyphs } of fontStateReplay(pdfjs.OPS, ops.fnArray, ops.argsArray, lookup)) {
    const font = state.font, name = font?.name || state.key || '?';
    let why = null, count = 0;
    const tu = font?.toUnicode;
    if (state.unknown) { why = `font association unavailable (${state.unknown})`; count = glyphs.length; }
    else if (!font || !tu) { why = 'pdf.js font data unavailable'; count = glyphs.length; }
    else if (!Array.isArray(tu._map) && Number.isInteger(tu.firstChar) && Number.isInteger(tu.lastChar)) {
      why = font.composite ? 'Type0 Identity encoding without ToUnicode' : 'identity code-to-text mapping'; count = glyphs.length;
    } else if (Array.isArray(tu._map)) {
      count = glyphs.filter(g => tu._map[g.originalCharCode] == null).length;
      if (count) why = 'shown code(s) without a Unicode mapping';
    } else { why = 'unrecognized pdf.js toUnicode data'; count = glyphs.length; }
    if (!why) continue;
    const k = `${name}\u0000${why}`, prev = bad.get(k);
    bad.set(k, { name, why, glyphs: (prev?.glyphs || 0) + count, page: prev?.page ?? page.pageNumber });
  }
  for (const f of bad.values()) if (unmapped.length < 50) unmapped.push(f);
}
try {
  const doc = await pdfjs.getDocument({
    data, isEvalSupported: false, disableFontFace: true, fontExtraProperties: true, useSystemFonts: false, enableXfa: false, stopAtErrors: false,
    standardFontDataUrl: `${join(pkgDir, 'standard_fonts')}/`, cMapUrl: `${join(pkgDir, 'cmaps')}/`, cMapPacked: true, verbosity: 1,
  }).promise;
  out.numPages = doc.numPages;
  let chars = 0;
  for (let i = 1; i <= Math.min(doc.numPages, MAX_PAGES); i++) {
    const page = { n: i, text: '', undecoded: 0, error: null };
    try {
      const p = await doc.getPage(i);
      auditPageFonts(p, await p.getOperatorList({ annotationMode: pdfjs.AnnotationMode.DISABLE }), out.unmappedFonts); // same scope as getTextContent
      const tc = await p.getTextContent({ includeMarkedContent: false, disableNormalization: false });
      // Lines from item positions; a vertical move of more than ~1.8 line heights starts a new paragraph.
      let text = '', lastY = null, lastH = 12;
      for (const it of tc.items) {
        if (typeof it.str !== 'string') continue;
        const y = it.transform?.[5] ?? lastY, h = Math.abs(it.transform?.[3] || it.height || lastH) || lastH;
        if (lastY != null && y !== lastY) text += Math.abs(y - lastY) > 1.8 * Math.max(h, lastH) ? '\n' : (/\s$/.test(text) ? '' : ' ');
        text += it.str;
        if (it.hasEOL && !/\s$/.test(text)) text += ' ';
        lastY = y; lastH = h;
      }
      page.text = text;
      page.undecoded = (text.match(UNDECODED) || []).length;
      p.cleanup();
    } catch (e) { page.error = String(e?.message || e).slice(0, 200); }
    out.pages.push(page);
    chars += page.text.length;
    if (chars > MAX_CHARS) { out.truncated = 'chars'; break; }
  }
  if (doc.numPages > MAX_PAGES) out.truncated = 'pages';
  out.ok = true;
  await doc.destroy();
} catch (e) { out.error = String(e?.message || e).slice(0, 300); }
process.stdout.write(JSON.stringify(out));
