// Deterministic source-text extraction for public documentation pages (no model, no network).
// HTML/JSON rules moved here unchanged from scripts/pass-b-audit-evidence.mjs (passBSourceText/1 and /2, which
// re-exports them), so the research collector can use them without importing that script's audit graph.
// passBSourceText/3 (VSD-092) adds explicit PDF text extraction: the /1–/2 snapshot helper rejected PDF content
// types, the format behind the Peacock Room payer reversal. Failure is always an explicit status, never empty success.
import { inflateSync, constants as zc } from 'node:zlib';

// ---- deterministic HTML -> text (passBSourceText/1) ----
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç', ouml: 'ö', uuml: 'ü', auml: 'ä' };
export function extractText(html) {
  let t = String(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|nav|header|footer|form|template|iframe)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<sup\b[^>]*class="[^"]*reference[^"]*"[\s\S]*?<\/sup>/gi, '') // Wikipedia citation markers
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article|\/blockquote|\/dd|\/dt)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
  return t.split('\n').map(l => l.replace(/[ \t\r\f\v]+/g, ' ').trim()).filter(l => l.length >= 3).join('\n').normalize('NFC');
}
// passBSourceText/2: /1 plus the spacing repair before punctuation and inside quotes.
export function extractTextV2(html) {
  return extractText(html).split('\n').map(l => l
    .replace(/\s+([,.;:!?)\]}»”’])/g, '$1').replace(/([(\[{«“‘])\s+/g, '$1')
    .replace(/"\s+([^"]*?)\s+"/g, '"$1"')).join('\n');
}
// Museum API records come back as JSON: keep every string field as "key: value". Deterministic.
export function extractJsonText(raw) {
  const lines = [];
  const walk = (v, key) => {
    if (typeof v === 'string') { const t = /<[a-z!/]/i.test(v) ? extractTextV2(v).replace(/\n+/g, ' ') : v.replace(/\s+/g, ' ').trim(); if (t.length >= 3) lines.push(`${key}: ${t}`); }
    else if (Array.isArray(v)) v.forEach(x => walk(x, key));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(JSON.parse(raw), 'record');
  return lines.join('\n').normalize('NFC');
}

// ---- passBSourceText/3: one entry point by detected type ----
export const SOURCE_TEXT_EXTRACTION = 'passBSourceText/3';
export function sourceKind(contentType, buf) {
  const ct = String(contentType || '').split(';')[0].trim().toLowerCase();
  if ((buf && buf.subarray(0, 5).toString('latin1') === '%PDF-') || ct === 'application/pdf') return 'pdf';
  if (ct === 'text/html' || ct === 'application/xhtml+xml') return 'html';
  if (ct === 'application/json' || ct.endsWith('+json')) return 'json';
  if (ct === 'text/plain') return 'text';
  return null;
}
// Returns { ok:true, kind, text } or { ok:false, kind, status, detail }. `text` lines are complete paragraphs.
export function extractSourceText(buf, contentType) {
  const kind = sourceKind(contentType, buf);
  if (!kind) return { ok: false, kind: null, status: 'unsupported-type', detail: String(contentType || 'none').slice(0, 100) };
  try {
    let text;
    if (kind === 'pdf') { const r = extractPdfText(buf); if (!r.ok) return { ok: false, kind, status: 'pdf-extraction-failed', detail: r.reason }; text = r.text; }
    else if (kind === 'html') text = extractTextV2(buf.toString('utf8'));
    else if (kind === 'json') text = extractJsonText(buf.toString('utf8'));
    else text = buf.toString('utf8').split(/\r?\n\s*\r?\n/).map(p => p.replace(/\s+/g, ' ').trim()).filter(p => p.length >= 3).join('\n').normalize('NFC');
    if (!text.trim()) return { ok: false, kind, status: 'empty-text', detail: null };
    return { ok: true, kind, text };
  } catch (e) { return { ok: false, kind, status: `${kind}-extraction-failed`, detail: String(e.message).slice(0, 120) }; }
}

// ---- minimal deterministic PDF text extraction ----
// Supports: indirect objects, FlateDecode streams, object streams (ObjStm), the page tree, per-page font resources,
// ToUnicode CMaps (bfchar/bfrange), WinAnsi single-byte text, and Tj/TJ/'/" text operators with line/paragraph
// breaks inferred from text-matrix moves. Unsupported encodings fail the quality check and return an explicit failure.
const WINANSI = { 0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ' };
const MAX_PDF_OBJECTS = 200000, MAX_PDF_TEXT = 2_000_000;
function inflate(buf) {
  try { return inflateSync(buf); } catch { /* fall through: truncated streams are common */ }
  try { return inflateSync(buf, { finishFlush: zc.Z_SYNC_FLUSH }); } catch { return null; }
}
function decodeStream(dict, raw) {
  const filt = /\/Filter\s*(\[[^\]]*\]|\/\w+)/.exec(dict)?.[1] || '';
  const names = filt.match(/\/\w+/g) || [];
  if (!names.length) return raw;
  if (names.length === 1 && (names[0] === '/FlateDecode' || names[0] === '/Fl')) {
    if (/\/Predictor\s+(1[0-5])/.test(dict)) return null; // predictor streams are xref data, never page text
    return inflate(raw);
  }
  return null; // ASCII85/LZW/DCT/etc.: not text we can read deterministically here
}
function parseObjects(src, buf) {
  const objs = new Map();
  const re = /(\d+)\s+(\d+)\s+obj\b/g; let m;
  while ((m = re.exec(src)) && objs.size < MAX_PDF_OBJECTS) {
    const num = Number(m[1]), start = m.index + m[0].length;
    const end = src.indexOf('endobj', start); if (end < 0) break;
    let body = src.slice(start, end), stream = null;
    const si = body.search(/\bstream\r?\n/);
    if (si >= 0) {
      const dict = body.slice(0, si);
      const dataStart = start + si + body.slice(si).match(/^stream\r?\n/)[0].length;
      const len = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
      let dataEnd = len ? dataStart + Number(len[1]) : -1;
      if (dataEnd < dataStart || src.slice(dataEnd, dataEnd + 20).search(/^\s*endstream/) < 0) dataEnd = src.lastIndexOf('endstream', end);
      if (dataEnd > dataStart) stream = buf.subarray(dataStart, dataEnd).subarray(0, dataEnd - dataStart);
      body = dict;
    }
    objs.set(num, { dict: body, raw: stream });
    re.lastIndex = end + 6;
  }
  // Object streams: compressed indirect objects (PDF 1.5+), typically fonts/resources/pages.
  for (const [, o] of [...objs]) {
    if (!o.raw || !/\/Type\s*\/ObjStm\b/.test(o.dict)) continue;
    const data = decodeStream(o.dict, o.raw); if (!data) continue;
    const n = Number(/\/N\s+(\d+)/.exec(o.dict)?.[1] || 0), first = Number(/\/First\s+(\d+)/.exec(o.dict)?.[1] || 0);
    const s = data.toString('latin1'), head = s.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < n && 2 * i + 1 < head.length; i++) {
      const from = first + head[2 * i + 1], to = i + 1 < n ? first + head[2 * i + 3] : s.length;
      if (!objs.has(head[2 * i])) objs.set(head[2 * i], { dict: s.slice(from, to), raw: null });
    }
  }
  return objs;
}
const refOf = (dict, key) => { const m = new RegExp(`/${key}\\s+(\\d+)\\s+\\d+\\s+R`).exec(dict); return m ? Number(m[1]) : null; };
const refsIn = text => [...String(text).matchAll(/(\d+)\s+\d+\s+R/g)].map(x => Number(x[1]));
// The balanced << >> dictionary that follows /Key, or the dictionary of the object it references.
function subDict(objs, dict, key) {
  const i = dict.search(new RegExp(`/${key}\\b`)); if (i < 0) return null;
  const rest = dict.slice(i + key.length + 1).trimStart();
  const ref = /^(\d+)\s+\d+\s+R/.exec(rest); if (ref) return objs.get(Number(ref[1]))?.dict ?? null;
  if (!rest.startsWith('<<')) return null;
  let depth = 0;
  for (let j = 0; j < rest.length - 1; j++) {
    if (rest[j] === '<' && rest[j + 1] === '<') { depth++; j++; }
    else if (rest[j] === '>' && rest[j + 1] === '>') { depth--; j++; if (!depth) return rest.slice(0, j + 1); }
  }
  return null;
}
function parseCMap(text) {
  const map = new Map(); let bytes = 1;
  const cs = /begincodespacerange\s*<([0-9a-fA-F]+)>/.exec(text); if (cs) bytes = Math.max(1, cs[1].length / 2);
  const hexStr = h => { let s = ''; for (let i = 0; i + 4 <= h.length; i += 4) s += String.fromCharCode(parseInt(h.slice(i, i + 4), 16)); return s; };
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) map.set(parseInt(m[1], 16), hexStr(m[2]));
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(\[[^\]]*\]|<[0-9a-fA-F]+>)/g)) {
      const lo = parseInt(m[1], 16), hi = parseInt(m[2], 16); if (hi - lo > 65535) continue;
      if (m[3].startsWith('[')) [...m[3].matchAll(/<([0-9a-fA-F]+)>/g)].forEach((x, k) => map.set(lo + k, hexStr(x[1])));
      else { const base = m[3].slice(1, -1); const head = base.slice(0, -4), last = parseInt(base.slice(-4), 16); for (let c = lo; c <= hi; c++) map.set(c, hexStr(head) + String.fromCharCode(last + c - lo)); }
    }
  }
  return { map, bytes };
}
// Glyph names used by /Differences encodings (letters/digits map by name; uniXXXX by code point).
const GLYPHS = { space: ' ', quotedblleft: '“', quotedblright: '”', quoteleft: '‘', quoteright: '’', quotesingle: "'", quotedbl: '"', endash: '–', emdash: '—', hyphen: '-', minus: '−', bullet: '•', ellipsis: '…', fi: 'fi', fl: 'fl', ff: 'ff', ffi: 'ffi', ffl: 'ffl', period: '.', comma: ',', colon: ':', semicolon: ';', exclam: '!', question: '?', parenleft: '(', parenright: ')', bracketleft: '[', bracketright: ']', slash: '/', ampersand: '&', percent: '%', dollar: '$', numbersign: '#', at: '@', asterisk: '*', plus: '+', equal: '=', less: '<', greater: '>', underscore: '_', degree: '°', copyright: '©', registered: '®', trademark: '™', section: '§', paragraph: '¶', dagger: '†', daggerdbl: '‡', zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', eacute: 'é', egrave: 'è', agrave: 'à', aacute: 'á', ccedil: 'ç', ccedilla: 'ç', odieresis: 'ö', udieresis: 'ü', adieresis: 'ä', idieresis: 'ï', ntilde: 'ñ', oacute: 'ó', iacute: 'í', uacute: 'ú', ecircumflex: 'ê', acircumflex: 'â', ocircumflex: 'ô', germandbls: 'ß', Eacute: 'É' };
const glyphChar = name => GLYPHS[name] ?? (/^[A-Za-z]$/.test(name) ? name : /^uni([0-9A-Fa-f]{4})$/.test(name) ? String.fromCharCode(parseInt(name.slice(3), 16)) : '');
function differences(objs, fontDict) {
  const enc = subDict(objs, fontDict, 'Encoding'); if (!enc) return null;
  const arr = /\/Differences\s*\[([^\]]*)\]/.exec(enc)?.[1]; if (!arr) return null;
  const map = new Map(); let code = 0;
  for (const t of arr.match(/\d+|\/[^\s/\[\]]+/g) || []) { if (t[0] === '/') map.set(code++, glyphChar(t.slice(1))); else code = Number(t); }
  return map;
}
function fontDecoder(objs, fontDict) {
  if (!fontDict) return { bytes: 1, map: null };
  const tu = refOf(fontDict, 'ToUnicode');
  if (tu != null) { const o = objs.get(tu); const data = o?.raw ? decodeStream(o.dict, o.raw) : null; if (data) return parseCMap(data.toString('latin1')); }
  if (/\/Subtype\s*\/Type0\b/.test(fontDict)) return { bytes: 2, map: null };
  const mac = /\/Encoding\s*\/MacRomanEncoding\b/.test(fontDict) || /\/BaseEncoding\s*\/MacRomanEncoding\b/.test(subDict(objs, fontDict, 'Encoding') || '');
  return { bytes: 1, map: null, diff: differences(objs, fontDict), mac, ...simpleWidths(objs, fontDict) };
}
// /FirstChar + /Widths (simple fonts) give the real pen advance in thousandths of an em.
function simpleWidths(objs, fontDict) {
  const first = Number(/\/FirstChar\s+(\d+)/.exec(fontDict)?.[1]);
  let w = /\/Widths\s*\[([^\]]*)\]/.exec(fontDict)?.[1];
  if (w == null) { const r = refOf(fontDict, 'Widths'); const o = r != null ? objs.get(r) : null; w = /\[([^\]]*)\]/.exec(o?.dict || '')?.[1]; }
  return Number.isFinite(first) && w ? { firstChar: first, widths: w.trim().split(/\s+/).map(Number) } : {};
}
// Mac OS Roman 0x80–0xFF (PDF MacRomanEncoding); only the printable subset matters for text.
const MACROMAN = 'ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔ\uF8FFÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ';
function decodeBytes(bytes, dec) {
  let s = '', adv = 0, known = true;
  for (let i = 0; i + dec.bytes <= bytes.length; i += dec.bytes) {
    let code = 0; for (let k = 0; k < dec.bytes; k++) code = code * 256 + bytes[i + k];
    if (dec.map) s += dec.map.get(code) ?? '';
    else if (dec.bytes === 1) s += dec.diff?.get(code) ?? (dec.mac && code >= 0x80 ? MACROMAN[code - 0x80] : WINANSI[code]) ?? (code >= 32 ? String.fromCharCode(code) : '');
    else s += '\uFFFD'; // a 2-byte font without ToUnicode cannot be decoded honestly
    const w = dec.widths?.[code - dec.firstChar];
    if (Number.isFinite(w)) adv += w; else known = false;
  }
  return { text: s, adv: known ? adv : null };
}
// Tokenize a content stream into operands/operators.
function* tokens(s) {
  let i = 0; const n = s.length;
  while (i < n) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '%') { while (i < n && s[i] !== '\n' && s[i] !== '\r') i++; continue; }
    if (c === '(') {
      const out = []; let depth = 1; i++;
      while (i < n && depth) {
        const ch = s[i];
        if (ch === '\\') {
          const e = s[i + 1]; i += 2;
          if (e === 'n') out.push(10); else if (e === 'r') out.push(13); else if (e === 't') out.push(9); else if (e === 'b') out.push(8); else if (e === 'f') out.push(12);
          else if (e >= '0' && e <= '7') { let o = e; while (o.length < 3 && s[i] >= '0' && s[i] <= '7') o += s[i++]; out.push(parseInt(o, 8) & 255); }
          else if (e === '\r' || e === '\n') { if (e === '\r' && s[i] === '\n') i++; }
          else if (e !== undefined) out.push(e.charCodeAt(0) & 255);
          continue;
        }
        if (ch === '(') depth++; else if (ch === ')') { depth--; if (!depth) { i++; break; } }
        out.push(ch.charCodeAt(0) & 255); i++;
      }
      yield { t: 'str', v: Buffer.from(out) }; continue;
    }
    if (c === '<' && s[i + 1] === '<') { yield { t: 'op', v: '<<' }; i += 2; continue; }
    if (c === '>' && s[i + 1] === '>') { yield { t: 'op', v: '>>' }; i += 2; continue; }
    if (c === '<') { const j = s.indexOf('>', i); const h = s.slice(i + 1, j < 0 ? n : j).replace(/\s+/g, ''); i = j < 0 ? n : j + 1; yield { t: 'str', v: Buffer.from(h.length % 2 ? `${h}0` : h, 'hex') }; continue; }
    if (c === '[' || c === ']') { yield { t: c }; i++; continue; }
    if (c === '/') { let j = i + 1; while (j < n && !/[\s/\[\]()<>{}%]/.test(s[j])) j++; yield { t: 'name', v: s.slice(i + 1, j) }; i = j; continue; }
    let j = i; while (j < n && !/[\s/\[\]()<>{}%]/.test(s[j])) j++;
    if (j === i) { i++; continue; }
    const word = s.slice(i, j); i = j;
    yield /^[+-]?(\d+\.?\d*|\.\d+)$/.test(word) ? { t: 'num', v: Number(word) } : { t: 'op', v: word };
  }
}
// Glyph widths are not parsed, so the pen advance is estimated at half an em per character; a horizontal move that
// clears that estimate by more than a third of an em is a word gap. Vertical moves within ~1.8 lines are soft wraps
// (joined with a space); larger ones start a new paragraph.
function pageText(content, fonts, forms = new Map(), depth = 0) {
  let out = '', stack = [], arr = null, dec = { bytes: 1, map: null }, size = 12, leading = 0;
  let tlm = [1, 0, 0, 1, 0, 0], lastY = null, penX = null, tc = 0, tw = 0;
  const show = str => {
    const { text, adv } = decodeBytes(str, dec); out += text;
    const glyphs = str.length / dec.bytes, spaces = dec.bytes === 1 ? str.filter(b => b === 32).length : 0;
    penX = (penX ?? tlm[4]) + ((adv ?? text.length * 500) / 1000 * size + glyphs * tc + spaces * tw) * Math.abs(tlm[0] || 1);
  };
  const move = m => {
    const y = m[5], eff = Math.abs(size * (m[3] || 1)) || 12;
    if (lastY != null && y !== lastY) out += Math.abs(y - lastY) <= 1.8 * eff ? ' ' : '\n';
    else if (penX != null && m[4] - penX > 0.2 * size * Math.abs(m[0] || 1) && !/\s$/.test(out)) out += ' ';
    penX = null; lastY = y; tlm = m;
  };
  for (const tok of tokens(content)) {
    if (tok.t === '[') { arr = []; continue; }
    if (tok.t === ']') { stack.push({ t: 'arr', v: arr || [] }); arr = null; continue; }
    if (arr) { arr.push(tok); continue; }
    if (tok.t !== 'op') { stack.push(tok); continue; }
    const nums = stack.filter(x => x.t === 'num').map(x => x.v);
    const next = () => { const [a, b, c, d, e, f] = tlm; move([a, b, c, d, -leading * c + e, -leading * d + f]); };
    switch (tok.v) {
      case 'Tf': { const name = stack.find(x => x.t === 'name')?.v; dec = fonts.get(name) || { bytes: 1, map: null }; size = nums.at(-1) ?? size; break; }
      case 'TL': leading = nums.at(-1) ?? leading; break;
      case 'Tc': tc = nums.at(-1) ?? tc; break;
      case 'Tw': tw = nums.at(-1) ?? tw; break;
      case 'Tm': if (nums.length >= 6) move(nums.slice(-6)); break;
      case 'Td': case 'TD': if (nums.length >= 2) { const [tx, ty] = nums.slice(-2); if (tok.v === 'TD') leading = -ty; const [a, b, c, d, e, f] = tlm; move([a, b, c, d, tx * a + ty * c + e, tx * b + ty * d + f]); } break;
      case 'T*': next(); break;
      case 'Tj': { const s = stack.findLast(x => x.t === 'str'); if (s) show(s.v); break; }
      case "'": case '"': { next(); const s = stack.findLast(x => x.t === 'str'); if (s) show(s.v); break; }
      case 'TJ': { const a = stack.findLast(x => x.t === 'arr'); for (const x of a?.v || []) { if (x.t === 'str') show(x.v); else if (x.t === 'num') { if (x.v < -250 && !/\s$/.test(out)) out += ' '; if (penX != null) penX -= x.v / 1000 * size * Math.abs(tlm[0] || 1); } } break; }
      case 'Do': { const name = stack.find(x => x.t === 'name')?.v, form = forms.get(name); if (form && depth < 4) { const t = pageText(form.content, form.fonts, form.forms, depth + 1); if (t) out += `\n${t}\n`; } break; }
      default: break;
    }
    stack = [];
    if (out.length > MAX_PDF_TEXT) break;
  }
  return out;
}
// Fonts and Form XObjects of one resource dictionary (forms recurse into their own resources, bounded).
function resourcesOf(objs, res, depth = 0) {
  const fonts = new Map(), forms = new Map();
  if (!res) return { fonts, forms };
  const fontDict = subDict(objs, res, 'Font');
  for (const m of String(fontDict || '').matchAll(/\/([^\s/<>\[\]()]+)\s+(\d+)\s+\d+\s+R/g)) fonts.set(m[1], fontDecoder(objs, objs.get(Number(m[2]))?.dict));
  const xo = subDict(objs, res, 'XObject');
  if (depth < 4) for (const m of String(xo || '').matchAll(/\/([^\s/<>\[\]()]+)\s+(\d+)\s+\d+\s+R/g)) {
    const o = objs.get(Number(m[2]));
    if (!o?.raw || !/\/Subtype\s*\/Form\b/.test(o.dict)) continue;
    const data = decodeStream(o.dict, o.raw); if (!data) continue;
    const inner = resourcesOf(objs, subDict(objs, o.dict, 'Resources') || res, depth + 1);
    forms.set(m[1], { content: data.toString('latin1'), ...inner });
  }
  return { fonts, forms };
}
export function extractPdfText(buf) {
  if (!Buffer.isBuffer(buf) || buf.subarray(0, 5).toString('latin1') !== '%PDF-') return { ok: false, reason: 'not a PDF' };
  if (/\/Encrypt\s/.test(buf.toString('latin1').slice(-4096))) return { ok: false, reason: 'encrypted PDF' };
  const src = buf.toString('latin1'), objs = parseObjects(src, buf);
  const pages = [];
  const visit = (num, inherited, seen = new Set()) => {
    if (seen.has(num)) return; seen.add(num);
    const o = objs.get(num); if (!o) return;
    const res = subDict(objs, o.dict, 'Resources') || inherited;
    if (/\/Type\s*\/Pages\b/.test(o.dict)) { const kids = /\/Kids\s*\[([^\]]*)\]/.exec(o.dict); for (const k of refsIn(kids?.[1] || '')) visit(k, res, seen); }
    else if (/\/Type\s*\/Page\b/.test(o.dict)) pages.push({ dict: o.dict, res });
  };
  const rootRef = [...src.matchAll(/\/Root\s+(\d+)\s+\d+\s+R/g)].at(-1)?.[1];
  const root = rootRef != null ? objs.get(Number(rootRef)) : null;
  const pagesRef = root ? refOf(root.dict, 'Pages') : null;
  if (pagesRef != null) visit(pagesRef, null);
  if (!pages.length) for (const [, o] of objs) if (/\/Type\s*\/Page\b/.test(o.dict)) pages.push({ dict: o.dict, res: subDict(objs, o.dict, 'Resources') });
  if (!pages.length) return { ok: false, reason: 'no pages found' };
  const paras = [];
  for (const pg of pages) {
    const { fonts, forms } = resourcesOf(objs, pg.res);
    const contents = /\/Contents\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/.exec(pg.dict)?.[1] || '';
    const data = refsIn(contents).map(r => objs.get(r)).filter(o => o?.raw).map(o => decodeStream(o.dict, o.raw)).filter(Boolean);
    const text = pageText(Buffer.concat(data).toString('latin1'), fonts, forms);
    for (const p of text.split('\n')) { const t = p.replace(/\s+/g, ' ').trim(); if (t.length >= 3) paras.push(t); }
  }
  const text = paras.join('\n').normalize('NFC');
  const letters = (text.match(/\p{L}/gu) || []).length, bad = (text.match(/[�\u0000-\u0008]/g) || []).length;
  if (text.length < 40) return { ok: false, reason: 'no extractable text (scanned or unsupported font encoding)' };
  if (bad / text.length > 0.02 || letters / text.length < 0.5) return { ok: false, reason: 'text fails the quality check (unsupported font encoding)' };
  return { ok: true, text, pages: pages.length };
}
