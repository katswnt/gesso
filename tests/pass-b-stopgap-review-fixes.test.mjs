// Regressions for Codex's code review of pass-b-research-stopgap (VSD-092): findings 6, 8, 9, 12 and 14.
// (Finding 1 lives in pass-b-corpus-collect.test.mjs; 13 and the persisted capture attempts in
// pass-b-research-stopgap.test.mjs.) Offline: no model calls, no network, no evidence writes.
import assert from 'node:assert';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { pagePdf, bombPdf, textOps, HELVETICA, UNMAPPED_TYPE0, UNMAPPED_DIFFERENCES, UNMAPPED_TYPE0_INDIRECT, UNMAPPED_DIFFERENCES_INDIRECT, reorderFont } from './helpers/pdf-fixtures.mjs';
import * as ST from '../scripts/lib/pass-b-source-text.mjs';
import * as RS from '../scripts/lib/pass-b-research-stopgap.mjs';
import { createBroker } from '../scripts/lib/img-broker.mjs';
import { canaryEnv } from '../scripts/pass-b-research-canary.mjs';

let n = 0; const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const hash = b => createHash('sha256').update(b).digest('hex');
const ATTRIBUTION = 'The panel is attributed to Rogier van der Weyden.';
const REJECTION = 'Recent technical study rejects this attribution.';

// ---- finding 6: PDF extraction never silently drops content ----
t('6: a later ASCIIHex-encoded qualification is decoded, not dropped (mixed encodings)', async () => {
  const r = await ST.extractPdfText(pagePdf([{ text: textOps([ATTRIBUTION]) }, { text: textOps([REJECTION], 600), filter: 'hex' }]));
  assert.ok(r.ok, r.reason);
  assert.ok(r.text.includes(ATTRIBUTION) && r.text.includes(REJECTION), `both statements survive: ${r.text}`);
});
t('6: an undecodable content stream fails the source explicitly', async () => {
  const r = await ST.extractPdfText(pagePdf([{ text: textOps([ATTRIBUTION]) }, { text: textOps([REJECTION], 600), filter: '/FooDecode' }]));
  assert.strictEqual(r.ok, false); assert.strictEqual(r.status, 'pdf-incomplete');
});
for (const [name, font] of [['a Type0 Identity font without ToUnicode', UNMAPPED_TYPE0], ['subset glyph names without ToUnicode', UNMAPPED_DIFFERENCES]])
  t(`6: missing glyph mappings (${name}) fail explicitly instead of guessing text`, async () => {
    const r = await ST.extractPdfText(pagePdf([{ text: textOps([ATTRIBUTION]) }, { text: name.startsWith('a Type0') ? 'BT /F2 12 Tf 72 600 Td <00410042> Tj ET' : 'BT /F2 12 Tf 72 600 Td (ABC) Tj ET' }], { fonts: { F1: HELVETICA, F2: font } }));
    assert.strictEqual(r.ok, false); assert.strictEqual(r.status, 'pdf-incomplete'); assert.match(r.reason, /Unicode mapping/);
  });
t('6: compressed-size amplification is refused before pdf.js runs', async () => {
  const bomb = bombPdf(200 * 1024 * 1024);
  assert.ok(bomb.length < 1024 * 1024, 'a sub-megabyte file');
  const r = await ST.extractPdfText(bomb);
  assert.strictEqual(r.ok, false); assert.strictEqual(r.status, 'pdf-decompression-limit');
});
// review-2 R2-2 (Codex probe round2/probes/stopgap/review2-pdf.mjs): the same unmapped fonts, serialized so a raw-byte
// audit cannot see them. Every variant must still fail; the text before the unmapped stream must not pass as complete.
const UNMAPPED_CASES = [
  ['Type0 Identity', UNMAPPED_TYPE0, UNMAPPED_TYPE0_INDIRECT, 'BT /F2 12 Tf 72 600 Td <00410042> Tj ET'],
  ['subset-name Differences', UNMAPPED_DIFFERENCES, UNMAPPED_DIFFERENCES_INDIRECT, 'BT /F2 12 Tf 72 600 Td (ABC) Tj ET'],
];
for (const [label, font, indirect, ops] of UNMAPPED_CASES) {
  const variants = [
    ['reordered keys (/Subtype before /Type /Font)', { fonts: { F1: HELVETICA, F2: reorderFont(font) } }],
    ['encoding reached through indirect objects', { fonts: { F1: HELVETICA, F2: indirect.font }, extra: indirect.extra }],
    ['font inside a compressed object stream', { fonts: { F1: HELVETICA, F2: font }, objStm: true }],
    ['reordered, indirect and in an object stream', { fonts: { F1: HELVETICA, F2: reorderFont(indirect.font) }, extra: indirect.extra, objStm: true }],
  ];
  for (const [vname, opts] of variants)
    t(`R2-2: ${label} font, ${vname}, still fails as incomplete`, async () => {
      const r = await ST.extractPdfText(pagePdf([{ text: textOps([ATTRIBUTION]) }, { text: ops }], opts));
      assert.strictEqual(r.ok, false, `extracted as complete: ${JSON.stringify(r.text)}`);
      assert.strictEqual(r.status, 'pdf-incomplete'); assert.match(r.reason, /Unicode mapping/);
    });
}
t('R2-2: control: mapped fonts in an object stream, reordered and indirect, still extract completely', async () => {
  const r = await ST.extractPdfText(pagePdf([{ text: textOps([ATTRIBUTION]) }, { text: textOps([REJECTION], 600, 'F2') }],
    { fonts: { F1: reorderFont(HELVETICA), F2: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding @X0 >>' }, extra: ['/WinAnsiEncoding'], objStm: true }));
  assert.ok(r.ok, r.reason); assert.ok(r.text.includes(ATTRIBUTION) && r.text.includes(REJECTION), r.text);
});
// review-2 RSS fail-open: Codex's memory probe completed with ok:true because `ps` was denied and rss read as 0.
for (const [name, rss] of [['ps denied', ST.makeRssObserver({ platform: 'darwin', psBin: '/nonexistent/ps' })], ['/proc unreadable', ST.makeRssObserver({ platform: 'linux', procRoot: '/nonexistent-proc' })]])
  t(`RSS: an unobservable worker RSS (${name}) fails closed, never reads as 0`, async () => {
    const r = await ST.runPdfWorker(bombPdf(90 * 1024 * 1024), { ...ST.PDF_LIMITS, maxRssMb: 60 }, { rss });
    assert.strictEqual(r.ok, false, 'worker ran with no enforced memory bound'); assert.strictEqual(r.status, 'pdf-memory-unobservable');
  });
t('6: the pdf.js child process is bounded by time and memory', async () => {
  const pdf = pagePdf([{ text: textOps([ATTRIBUTION]) }]);
  const slow = await ST.runPdfWorker(pdf, { ...ST.PDF_LIMITS, timeoutMs: 30 });
  assert.strictEqual(slow.ok, false); assert.strictEqual(slow.status, 'pdf-timeout');
  const big = await ST.runPdfWorker(bombPdf(90 * 1024 * 1024), { ...ST.PDF_LIMITS, maxRssMb: 60 });
  // Where RSS can be observed the bound trips; where it cannot (a sandbox denying `ps`) the run fails closed instead.
  assert.strictEqual(big.ok, false); assert.ok(['pdf-memory-limit', 'pdf-memory-unobservable'].includes(big.status), big.status);
  const ok = await ST.extractPdfText(pdf);
  assert.ok(ok.ok); assert.strictEqual(ok.facts.extractor, `pdfjs-dist@${ST.PDFJS_VERSION}`);
});

// ---- finding 8: raw bytes retained outside the packet, with a genuine byte hash ----
const HTML = `<html><nav>Menu</nav><h1>Panel</h1>${Array.from({ length: 40 }, (_, i) => `<p>Paragraph ${i} ${'describes the panel in detail and its condition. '.repeat(8)}</p>`).join('')}<p>${REJECTION}</p></html>`;
const fetchOk = buf => async url => ({ ok: true, buffer: buf, declaredMime: 'text/html', finalUrl: url, chain: [url] });
t('8: bytesSha256 is SHA-256 of the received bytes; raw bytes and full text are stored on disk and verified', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rf8-'));
  try {
    const buf = Buffer.from(HTML);
    const [s] = await RS.captureSources({ targets: [{ url: 'https://m.example/a', why: 'cited', sourceIds: ['s1'] }], fetchDoc: fetchOk(buf), catalog: { title: 'Panel' }, store: RS.sourceStore(dir) });
    assert.strictEqual(s.bytesSha256, hash(buf), 'createHash over the exact bytes');
    assert.deepStrictEqual(gunzipSync(readFileSync(join(dir, s.raw.file))), buf, 'raw bytes retained');
    assert.ok(!('text' in JSON.parse(JSON.stringify({ raw: s.raw }))), 'raw lives outside the packet');
    const full = readFileSync(join(dir, s.fullText.file), 'utf8');
    assert.ok(full.includes(REJECTION) && hash(full) === s.fullTextSha256);
    assert.ok(s.truncated && !s.text.includes(REJECTION), 'the packet is capped…');
    assert.deepStrictEqual(s.omitted.map(o => [o.fromOffset, o.reason]), [[s.text.length + 1, 'per-source packet cap']], '…with an explicit gap pointing at the full text');
    const side = RS.buildCaptureSidecar({ runId: 'r', workId: 'w', b2Completion: { bodySha256: 'a', transcriptSha256: 'b' }, b2Body: { factChecks: [], guideAnswers: [] }, sources: [s], attemptedAt: 'x' });
    assert.strictEqual(side.rawBytesRetained, buf.length);
    const v = () => RS.verifyCaptureSidecar(side, { runId: 'r', workId: 'w', b2Completion: { bodySha256: 'a', transcriptSha256: 'b' }, researchDir: dir });
    assert.ok(v().ok, JSON.stringify(v()));
    writeFileSync(join(dir, s.raw.file), readFileSync(join(dir, s.raw.file)).subarray(0, 10));
    assert.ok(!v().ok && v().errors.some(e => /raw bytes/.test(e)), 'changed raw bytes are detected');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
t('8: a source past the per-work raw cap is an explicit failure, never text without its bytes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rf8b-'));
  try {
    const big = Buffer.from(`${"word ".repeat(200)}\n\n`.repeat(Math.floor((RS.CAPTURE_LIMITS.maxRawBytesPerWork - 10) / 1002))), small = Buffer.from(HTML);
    const docs = { 'https://m.example/big': big, 'https://m.example/small': small };
    const out = await RS.captureSources({ targets: Object.keys(docs).map(url => ({ url, why: 'cited', sourceIds: [] })), fetchDoc: async url => ({ ok: true, buffer: docs[url], declaredMime: 'text/plain', finalUrl: url, chain: [url] }), catalog: {}, store: RS.sourceStore(dir) });
    assert.strictEqual(out[0].status, 'captured'); assert.strictEqual(out[1].status, 'raw-retention-cap'); assert.strictEqual(out[1].text, undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- finding 9: redirect and error bodies are destroyed, not drained ----
function endlessBroker(routes) {
  const seen = [];
  const lookup = (host, opts, cb) => setImmediate(() => cb(null, [{ address: '93.184.216.34', family: 4 }]));
  const request = (options, cb) => {
    const req = new EventEmitter(); req.destroyed = false;
    req.destroy = () => { req.destroyed = true; };
    req.end = () => {
      const route = routes[options.path];
      const res = new EventEmitter(); res.statusCode = route.status; res.headers = route.headers || {}; res.socket = { remoteAddress: '93.184.216.34' };
      const rec = { path: options.path, chunks: 0, destroyed: false, resumed: false }; seen.push(rec);
      res.destroy = () => { rec.destroyed = true; }; res.resume = () => { rec.resumed = true; };
      setImmediate(() => {
        cb(res);
        if (route.endless) { const timer = setInterval(() => { if (rec.destroyed || req.destroyed) return clearInterval(timer); rec.chunks++; res.emit('data', Buffer.alloc(64 * 1024)); }, 1); }
        else setImmediate(() => { res.emit('data', Buffer.from(route.body)); res.emit('end'); });
      });
    };
    return req;
  };
  return { broker: createBroker({ lookup, request }), seen };
}
t('9: an endless redirect body is destroyed before the next hop; an endless error body is destroyed at once', async () => {
  const { broker, seen } = endlessBroker({
    '/r': { status: 302, headers: { location: 'https://m.example/final' }, endless: true },
    '/final': { status: 200, headers: { 'content-type': 'text/html' }, body: '<p>ok page</p>' },
    '/e': { status: 500, endless: true },
  });
  const ok = await broker.fetchSourceDocument('https://m.example/r', { timeoutMs: 2000 });
  assert.ok(ok.ok); assert.deepStrictEqual(ok.chain, ['https://m.example/r', 'https://m.example/final']);
  const bad = await broker.fetchSourceDocument('https://m.example/e', { timeoutMs: 2000 });
  assert.strictEqual(bad.ok, false); assert.strictEqual(bad.reason, 'http-status');
  await new Promise(r => setTimeout(r, 30));
  for (const p of ['/r', '/e']) {
    const rec = seen.find(x => x.path === p);
    assert.ok(rec.destroyed, `${p} response destroyed`); assert.ok(!rec.resumed, `${p} body is never drained`);
    const at = rec.chunks; await new Promise(r => setTimeout(r, 20)); assert.strictEqual(rec.chunks, at, `${p} stops streaming`);
  }
});

// ---- finding 12: broad stopgap collection refuses without a gap-routing manifest ----
process.env.PASS_B_RESEARCH_VERSION = 'stopgap-1';
const C = await import('../scripts/pass-b-corpus-collect.mjs');
const clean = { PASS_B_RESEARCH_CANARY: '', PASS_B_RESEARCH_ROUTING: '' };
t('12: a live stopgap run with no canary and no routing manifest is refused (the gate runs before any lease or call)', () => {
  assert.throws(() => C.stopgapSpendGate({ live: true, env: clean }), /needs PASS_B_RESEARCH_ROUTING/);
  assert.deepStrictEqual(C.stopgapSpendGate({ live: false, env: clean }), { canary: null, routing: null }, 'the read-only plan still works');
});
t('12: the routing manifest must be bound to the run and name the gap for every model-call route', async () => {
  const G = await import('../scripts/lib/pass-b-research-gates.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'rf12-'));
  try {
    const write = m => { const p = join(dir, `${Math.random()}.json`); writeFileSync(p, JSON.stringify(m)); return p; };
    const base = { version: G.ROUTING_VERSION, runId: 'run-x', reviewedBy: 'owner', reviewedAt: '2026-11-20T00:00:00Z', reason: 'screened bank' };
    const m = G.loadRoutingManifest(write({ ...base, works: [{ workId: 'a', route: 'focused-repair', gaps: ['core-function: original use unresearched'] }, { workId: 'b', route: 'reuse' }, { workId: 'c', route: 'capture-and-synthesize' }] }), 'run-x');
    assert.deepStrictEqual([...m.callIds], ['a'], 'only named-gap model routes are queued');
    assert.throws(() => G.loadRoutingManifest(write({ ...base, works: [{ workId: 'a', route: 'fresh-research', gaps: [] }] }), 'run-x'), /must name its unresolved gaps/);
    assert.throws(() => G.loadRoutingManifest(write({ ...base, works: [{ workId: 'a', route: 'reuse' }] }), 'other-run'), /runId/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- finding 14: the canary's cap and settings survive the launcher, per phase ----
const boostBlock = () => { const s = readFileSync('scripts/pass-b-cloud-nightly.sh', 'utf8'); return s.slice(s.indexOf('# BOOST-BEGIN'), s.indexOf('# BOOST-END')); };
t('14: an active boost in the routine environment cannot replace the canary cap', () => {
  const env = { ...process.env, PASS_B_BOOST_UNTIL: '2099-01-01T00:00:00Z', PASS_B_BOOST_MAX_CALLS: '1000', ...canaryEnv(1) };
  const r = spawnSync('bash', ['-c', `${boostBlock()}\necho "$PASS_B_MAX_CALLS"`], { encoding: 'utf8', env });
  assert.strictEqual(r.stdout.trim(), '14');
});
t('14: phase allocations are separate allowances (14 + 6 = 20) and are verified after the wrapper', async () => {
  const G = await import('../scripts/lib/pass-b-research-gates.mjs');
  const [p1, p2] = [canaryEnv(1), canaryEnv(2)];
  assert.notStrictEqual(p1.PASS_B_CALL_BUDGET_ID, p2.PASS_B_CALL_BUDGET_ID);
  assert.strictEqual(Number(p1.PASS_B_MAX_CALLS) + Number(p2.PASS_B_MAX_CALLS), 20);
  assert.deepStrictEqual(G.verifyCanaryEnv(p1).stages, ['B1', 'B2']); assert.deepStrictEqual(G.verifyCanaryEnv(p2).stages, ['B3']);
  assert.throws(() => G.verifyCanaryEnv({ ...p1, PASS_B_MAX_CALLS: '1000' }), /settings changed/);
  assert.throws(() => G.verifyCanaryEnv({ ...p1, PASS_B_BOOST_UNTIL: '2099-01-01' }), /settings changed/);
  assert.throws(() => G.verifyCanaryEnv({ ...p1, PASS_B_CORPUS_ONLY: `${p1.PASS_B_CORPUS_ONLY},met1` }), /settings changed/);
  assert.throws(() => C.stopgapSpendGate({ live: true, env: { ...p1, PASS_B_MAX_CALLS: '1000' } }), /settings changed after the wrapper/);
  assert.strictEqual(C.stopgapSpendGate({ live: true, env: p2 }).canary.phase, 2);
});

const failed = [];
for (const [name, fn] of tests) { try { await fn(); n++; console.log('ok', name); } catch (e) { failed.push(name); console.log('FAIL', name, '-', String(e?.message || e).split('\n')[0].slice(0, 200)); } }
if (failed.length) { console.log(`pass-b-stopgap-review-fixes.test: ${failed.length} FAILED, ${n} passed`); process.exit(1); }
console.log(`pass-b-stopgap-review-fixes.test: ${n} checks passed`);
