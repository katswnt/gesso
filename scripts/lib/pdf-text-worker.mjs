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
import { inflateSync, constants as zc } from 'node:zlib';

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

// ---- font decodability audit (pdf.js silently GUESSES text for fonts with no Unicode mapping) ----
// A Type0 font with an Identity encoding and no ToUnicode, or a simple font whose /Differences use subset glyph names
// (g17, glyph12, cid40, …) with no ToUnicode, has no honest code→text mapping: pdf.js emits code points as letters.
// Objects are found in the file body and in Flate object streams (each inflate capped).
const SUBSET_GLYPH = /^(g|glyph|cid|index|c|G)\d+$|^\.notdef$/;
function fontAudit(buf) {
  const src = buf.toString('latin1'), dicts = [];
  for (const m of src.matchAll(/\d+\s+\d+\s+obj\b([\s\S]*?)endobj/g)) {
    const body = m[1], si = body.search(/\bstream\r?\n/);
    if (si < 0) { dicts.push(body); continue; }
    const dict = body.slice(0, si); dicts.push(dict);
    if (!/\/Type\s*\/ObjStm\b/.test(dict) || !/\/FlateDecode\b/.test(dict)) continue;
    const start = m.index + m[0].indexOf(body) + si + body.slice(si).match(/^stream\r?\n/)[0].length;
    const end = src.indexOf('endstream', start);
    try { dicts.push(inflateSync(buf.subarray(start, end), { maxOutputLength: 32 * 1024 * 1024, finishFlush: zc.Z_SYNC_FLUSH }).toString('latin1')); } catch { /* pdf.js reports real stream errors */ }
  }
  const fonts = [];
  for (const d of dicts) for (const m of d.matchAll(/<<\s*\/Type\s*\/Font\b/g)) {
    let depth = 0, j = m.index;
    for (; j < d.length - 1 && j < m.index + 20000; j++) {
      if (d[j] === '<' && d[j + 1] === '<') { depth++; j++; } else if (d[j] === '>' && d[j + 1] === '>') { depth--; j++; if (!depth) break; }
    }
    const f = d.slice(m.index, j + 1), name = /\/BaseFont\s*\/([^\s/<>\[\]()]+)/.exec(f)?.[1] || '?';
    if (/\/ToUnicode\b/.test(f)) continue;
    if (/\/Subtype\s*\/Type0\b/.test(f) && /\/Encoding\s*\/Identity-[HV]\b/.test(f)) { fonts.push({ name, why: 'Type0 Identity encoding without ToUnicode' }); continue; }
    const diffs = /\/Differences\s*\[([^\]]*)\]/.exec(f)?.[1];
    if (diffs && (diffs.match(/\/[^\s/\[\]]+/g) || []).some(g => SUBSET_GLYPH.test(g.slice(1)))) fonts.push({ name, why: 'subset glyph names without ToUnicode' });
  }
  return fonts.slice(0, 50);
}
try {
  out.unmappedFonts = fontAudit(input);
  const doc = await pdfjs.getDocument({
    data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, enableXfa: false, stopAtErrors: false,
    standardFontDataUrl: `${join(pkgDir, 'standard_fonts')}/`, cMapUrl: `${join(pkgDir, 'cmaps')}/`, cMapPacked: true, verbosity: 1,
  }).promise;
  out.numPages = doc.numPages;
  let chars = 0;
  for (let i = 1; i <= Math.min(doc.numPages, MAX_PAGES); i++) {
    const page = { n: i, text: '', undecoded: 0, error: null };
    try {
      const p = await doc.getPage(i);
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
