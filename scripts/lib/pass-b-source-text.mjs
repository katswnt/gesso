// Deterministic source-text extraction for public documentation pages (no model, no network).
// HTML/JSON rules moved here unchanged from scripts/pass-b-audit-evidence.mjs (passBSourceText/1 and /2, which
// re-exports them), so the research collector can use them without importing that script's audit graph.
// passBSourceText/4 (VSD-092 review fix 6) extracts PDF text with Mozilla pdf.js (pdfjs-dist, pinned) in a child
// process bounded by time, memory, decoded-stream size and output size. The /3 hand-written parser silently dropped
// undecodable streams and glyphs; /4 fails explicitly whenever any content cannot be decoded. Failure is always an
// explicit status, never empty or partial success.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

// ---- passBSourceText/4: one entry point by detected type ----
export const SOURCE_TEXT_EXTRACTION = 'passBSourceText/4';
// The exact pdf.js version is part of the extraction identity (package.json pins it; the cloud wrapper installs it).
export const PDFJS_VERSION = '5.6.205';
export function sourceKind(contentType, buf) {
  const ct = String(contentType || '').split(';')[0].trim().toLowerCase();
  if ((buf && buf.subarray(0, 5).toString('latin1') === '%PDF-') || ct === 'application/pdf') return 'pdf';
  if (ct === 'text/html' || ct === 'application/xhtml+xml') return 'html';
  if (ct === 'application/json' || ct.endsWith('+json')) return 'json';
  if (ct === 'text/plain') return 'text';
  return null;
}
// Returns { ok:true, kind, text, pdf? } or { ok:false, kind, status, detail }. `text` lines are complete paragraphs.
export async function extractSourceText(buf, contentType, opts = {}) {
  const kind = sourceKind(contentType, buf);
  if (!kind) return { ok: false, kind: null, status: 'unsupported-type', detail: String(contentType || 'none').slice(0, 100) };
  try {
    let text, pdf;
    if (kind === 'pdf') {
      const r = await extractPdfText(buf, opts.pdf);
      if (!r.ok) return { ok: false, kind, status: r.status || 'pdf-extraction-failed', detail: r.reason, pdf: r.facts ?? null };
      text = r.text; pdf = r.facts;
    } else if (kind === 'html') text = extractTextV2(buf.toString('utf8'));
    else if (kind === 'json') text = extractJsonText(buf.toString('utf8'));
    else text = buf.toString('utf8').split(/\r?\n\s*\r?\n/).map(p => p.replace(/\s+/g, ' ').trim()).filter(p => p.length >= 3).join('\n').normalize('NFC');
    if (!text.trim()) return { ok: false, kind, status: 'empty-text', detail: null };
    return { ok: true, kind, text, ...(pdf ? { pdf } : {}) };
  } catch (e) { return { ok: false, kind, status: `${kind}-extraction-failed`, detail: String(e.message).slice(0, 120) }; }
}

// ---- bounded PDF extraction (pdf.js in a child process) ----
export const PDF_LIMITS = Object.freeze({ timeoutMs: 30_000, maxRssMb: 768, heapMb: 384, maxDecodedBytes: 96 * 1024 * 1024, maxStdoutBytes: 24 * 1024 * 1024, maxPages: 400, maxChars: 4_000_000 });
const WORKER = fileURLToPath(new URL('./pdf-text-worker.mjs', import.meta.url));
// Compressed-size amplification guard, before pdf.js sees the file: inflate every Flate stream with a hard output cap
// (Node's maxOutputLength) against one total. A stream that would exceed it fails the whole PDF explicitly.
export function flateBudgetCheck(buf, maxDecodedBytes = PDF_LIMITS.maxDecodedBytes) {
  const src = buf.toString('latin1'); let total = 0, streams = 0;
  for (const m of src.matchAll(/<<((?:(?!>>\s*stream)[\s\S]){0,4000})>>\s*stream\r?\n/g)) {
    if (!/\/(FlateDecode|Fl)\b/.test(m[1])) continue;
    const start = m.index + m[0].length, end = src.indexOf('endstream', start); if (end < 0) break;
    const left = maxDecodedBytes - total;
    if (left <= 0) return { ok: false, total, streams };
    try { total += inflateSync(buf.subarray(start, end), { maxOutputLength: left, finishFlush: zc.Z_SYNC_FLUSH }).length; }
    catch (e) { if (e?.code === 'ERR_BUFFER_TOO_LARGE' || /Cannot create a Buffer larger|maxOutputLength|too large/i.test(e?.message)) return { ok: false, total: maxDecodedBytes + 1, streams: streams + 1 }; }
    streams++;
  }
  return { ok: true, total, streams };
}
// Resident-memory observation of the worker (review-2: never fail open). Returns { mb } for a live process, { gone }
// once it has exited (or is a zombie), and { unobservable } when the platform refuses the reading (e.g. `ps` denied
// by a sandbox, /proc unreadable). The heap flag alone does not bound pdf.js typed arrays, and RLIMIT_AS is not
// enforced on macOS (and breaks V8's address-space reservations on Linux), so an unobservable RSS fails the PDF.
export function makeRssObserver({ platform = process.platform, procRoot = '/proc', psBin = 'ps' } = {}) {
  const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e?.code === 'EPERM'; } };
  return pid => {
    let why;
    try {
      if (platform === 'linux') {
        const st = readFileSync(`${procRoot}/${pid}/status`, 'utf8');
        if (/^State:\s+Z/m.test(st)) return { gone: true };
        const kb = /VmRSS:\s+(\d+)/.exec(st)?.[1];
        if (kb != null) return { mb: Number(kb) / 1024 };
        why = 'no VmRSS in /proc status';
      } else {
        const r = spawnSync(psBin, ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8', timeout: 2000 });
        const kb = String(r.stdout ?? '').trim();
        if (!r.error && r.status === 0 && /^\d+$/.test(kb)) return { mb: Number(kb) / 1024 };
        why = r.error ? `ps: ${r.error.code || r.error.message}` : `ps exit ${r.status}`;
      }
    } catch (e) { why = String(e?.code || e?.message || e); }
    return alive(pid) ? { unobservable: why } : { gone: true };
  };
}
const observeRss = makeRssObserver();
// Runs the worker under the limits; resolves { ok, result } or { ok:false, status, reason }.
export function runPdfWorker(buf, limits = PDF_LIMITS, { rss = observeRss } = {}) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [`--max-old-space-size=${limits.heapMb}`, WORKER], {
      stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH || '', PDF_WORKER_MAX_PAGES: String(limits.maxPages), PDF_WORKER_MAX_CHARS: String(limits.maxChars) } });
    let out = [], n = 0, err = '', settled = false, breach = null;
    const finish = v => { if (settled) return; settled = true; clearTimeout(timer); clearInterval(watch); resolve(v); };
    const kill = why => { breach ||= why; try { child.kill('SIGKILL'); } catch { /* gone */ } };
    const timer = setTimeout(() => kill({ status: 'pdf-timeout', reason: `pdf extraction exceeded ${limits.timeoutMs} ms` }), limits.timeoutMs);
    let exited = false; child.on('exit', () => { exited = true; });
    const sample = () => {
      if (exited || settled) return;
      const o = rss(child.pid);
      if (o.unobservable) kill({ status: 'pdf-memory-unobservable', reason: `worker memory cannot be observed (${String(o.unobservable).slice(0, 80)}); the ${limits.maxRssMb} MB bound would not be enforced` });
      else if (o.mb > limits.maxRssMb) kill({ status: 'pdf-memory-limit', reason: `pdf extraction exceeded ${limits.maxRssMb} MB (rss ${Math.round(o.mb)} MB)` });
    };
    const watch = setInterval(sample, 100);
    sample(); // prove the bound is observable before the worker is handed any input
    child.stdout.on('data', d => { n += d.length; if (n > limits.maxStdoutBytes) kill({ status: 'pdf-output-limit', reason: 'pdf extraction output over the cap' }); else out.push(d); });
    child.stderr.on('data', d => { if (err.length < 2000) err += d; });
    child.on('error', e => finish({ ok: false, status: 'pdf-extraction-failed', reason: `worker: ${String(e.message).slice(0, 100)}` }));
    child.on('close', code => {
      if (breach) return finish({ ok: false, ...breach });
      if (code !== 0) return finish({ ok: false, status: 'pdf-extraction-failed', reason: `worker exit ${code}: ${err.trim().split('\n').at(-1)?.slice(0, 120) || ''}` });
      try { finish({ ok: true, result: JSON.parse(Buffer.concat(out).toString('utf8')) }); }
      catch { finish({ ok: false, status: 'pdf-extraction-failed', reason: 'worker returned unreadable output' }); }
    });
    child.stdin.on('error', () => { /* worker exited early; close handler reports it */ });
    child.stdin.end(buf);
  });
}
// pdf.js warnings that mean some content was not decoded (fonts, streams, structure). TrueType hinting notices
// ("TT: …") and xref reindexing do not affect text and are kept as facts only.
const LOSSY_WARNING = /not supported|unsupported|unimplemented|invalid (stream|font|cmap)|bad fcheck|unable to (decode|load|parse)|font loading|translatefont|loadfont|tounicode|cmap|glyph|corrupt|stream.*(error|truncated|missing)|error during|failed to/i;
const BENIGN_WARNING = /^Warning: (TT: |Indexing all PDF objects)/;
export async function extractPdfText(buf, limits = PDF_LIMITS) {
  if (!Buffer.isBuffer(buf) || buf.subarray(0, 5).toString('latin1') !== '%PDF-') return { ok: false, status: 'pdf-extraction-failed', reason: 'not a PDF' };
  const budget = flateBudgetCheck(buf, limits.maxDecodedBytes);
  if (!budget.ok) return { ok: false, status: 'pdf-decompression-limit', reason: `compressed streams decode past ${limits.maxDecodedBytes} bytes` };
  const run = await runPdfWorker(buf, limits);
  if (!run.ok) return run;
  const r = run.result;
  const facts = { extractor: `pdfjs-dist@${r.version}`, pages: r.numPages ?? null, decodedFlateBytes: budget.total, warnings: (r.warnings || []).slice(0, 20), unmappedFonts: r.unmappedFonts || [] };
  if (r.version !== PDFJS_VERSION) return { ok: false, status: 'pdf-extractor-version', reason: `pdfjs-dist ${r.version} != pinned ${PDFJS_VERSION}`, facts };
  if (!r.ok) return { ok: false, status: /password|encrypt/i.test(r.error || '') ? 'pdf-encrypted' : 'pdf-extraction-failed', reason: String(r.error || 'unreadable PDF'), facts };
  if (r.truncated) return { ok: false, status: 'pdf-incomplete', reason: `extraction stopped at the ${r.truncated === 'pages' ? `${limits.maxPages}-page` : `${limits.maxChars}-character`} cap`, facts };
  const pageErrors = r.pages.filter(p => p.error), undecoded = r.pages.reduce((s, p) => s + p.undecoded, 0);
  const lossy = (r.warnings || []).filter(w => !BENIGN_WARNING.test(w) && LOSSY_WARNING.test(w));
  // Any undecodable content fails the source explicitly: a missing qualification must never read as complete text.
  if (pageErrors.length) return { ok: false, status: 'pdf-incomplete', reason: `text extraction failed on page(s) ${pageErrors.map(p => p.n).join(',')}: ${pageErrors[0].error}`, facts };
  if (facts.unmappedFonts.length) return { ok: false, status: 'pdf-incomplete', reason: `font(s) without a Unicode mapping: ${facts.unmappedFonts.map(f => `${f.name} (${f.why})`).join('; ').slice(0, 200)}`, facts };
  if (undecoded) return { ok: false, status: 'pdf-incomplete', reason: `${undecoded} undecodable character(s)`, facts };
  if (lossy.length) return { ok: false, status: 'pdf-incomplete', reason: `pdf.js reported lossy decoding: ${lossy[0]}`, facts };
  const paras = [];
  for (const p of r.pages) for (const para of p.text.split('\n')) { const t = para.replace(/\s+/g, ' ').trim(); if (t.length >= 3) paras.push(t); }
  const text = paras.join('\n').normalize('NFC');
  if (text.length < 40) return { ok: false, status: 'pdf-no-text', reason: 'no extractable text (scanned or image-only PDF)', facts };
  return { ok: true, text, pages: r.numPages, facts };
}
