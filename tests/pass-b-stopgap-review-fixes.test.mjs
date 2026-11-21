// Regressions for Codex's code review of pass-b-research-stopgap (VSD-092): findings 6, 8, 9, 12 and 14.
// (Finding 1 lives in pass-b-corpus-collect.test.mjs; 13 and the persisted capture attempts in
// pass-b-research-stopgap.test.mjs.) Offline: no model calls, no network, no evidence writes.
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { pagePdf, bombPdf, textOps, HELVETICA, UNMAPPED_TYPE0, UNMAPPED_DIFFERENCES, UNMAPPED_TYPE0_INDIRECT, UNMAPPED_DIFFERENCES_INDIRECT, reorderFont, HELVETICA_BOLD, fontStatePdf } from './helpers/pdf-fixtures.mjs';
import * as ST from '../scripts/lib/pass-b-source-text.mjs';
import * as RS from '../scripts/lib/pass-b-research-stopgap.mjs';
import { createBroker } from '../scripts/lib/img-broker.mjs';
import { canaryEnv } from '../scripts/pass-b-research-canary.mjs';

let n = 0; const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const hash = b => createHash('sha256').update(b).digest('hex');
const ATTRIBUTION = 'The panel is attributed to Rogier van der Weyden.';
const REJECTION = 'Recent technical study rejects this attribution.';
// Review-3: content assertions must not depend on whether this host lets the parent observe the worker's RSS (a
// sandbox denying `ps` fails every extraction closed with pdf-memory-unobservable). They inject an observer; the
// fail-closed default and the real memory bound keep their own tests below.
const OBS = { rss: () => ({ mb: 1 }) };
const extract = buf => ST.extractPdfText(buf, ST.PDF_LIMITS, OBS);

// ---- finding 6: PDF extraction never silently drops content ----
t('6: a later ASCIIHex-encoded qualification is decoded, not dropped (mixed encodings)', async () => {
  const r = await extract(pagePdf([{ text: textOps([ATTRIBUTION]) }, { text: textOps([REJECTION], 600), filter: 'hex' }]));
  assert.ok(r.ok, r.reason);
  assert.ok(r.text.includes(ATTRIBUTION) && r.text.includes(REJECTION), `both statements survive: ${r.text}`);
});
t('6: an undecodable content stream fails the source explicitly', async () => {
  const r = await extract(pagePdf([{ text: textOps([ATTRIBUTION]) }, { text: textOps([REJECTION], 600), filter: '/FooDecode' }]));
  assert.strictEqual(r.ok, false); assert.strictEqual(r.status, 'pdf-incomplete');
});
for (const [name, font] of [['a Type0 Identity font without ToUnicode', UNMAPPED_TYPE0], ['subset glyph names without ToUnicode', UNMAPPED_DIFFERENCES]])
  t(`6: missing glyph mappings (${name}) fail explicitly instead of guessing text`, async () => {
    const r = await extract(pagePdf([{ text: textOps([ATTRIBUTION]) }, { text: name.startsWith('a Type0') ? 'BT /F2 12 Tf 72 600 Td <00410042> Tj ET' : 'BT /F2 12 Tf 72 600 Td (ABC) Tj ET' }], { fonts: { F1: HELVETICA, F2: font } }));
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
      const r = await extract(pagePdf([{ text: textOps([ATTRIBUTION]) }, { text: ops }], opts));
      assert.strictEqual(r.ok, false, `extracted as complete: ${JSON.stringify(r.text)}`);
      assert.strictEqual(r.status, 'pdf-incomplete'); assert.match(r.reason, /Unicode mapping/);
    });
}
t('R2-2: control: mapped fonts in an object stream, reordered and indirect, still extract completely', async () => {
  const r = await extract(pagePdf([{ text: textOps([ATTRIBUTION]) }, { text: textOps([REJECTION], 600, 'F2') }],
    { fonts: { F1: reorderFont(HELVETICA), F2: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding @X0 >>' }, extra: ['/WinAnsiEncoding'], objStm: true }));
  assert.ok(r.ok, r.reason); assert.ok(r.text.includes(ATTRIBUTION) && r.text.includes(REJECTION), r.text);
});
// ---- review-3 finding 1: the glyph audit uses the font of the actual graphics/text state ----
// Codex's probe (round3/probes/review3-font-state.mjs): the unmapped font is selected, then hidden behind q/Q or
// selected through an ExtGState, so the last `Tf` names mapped Helvetica. Before the fix all four returned ok:true
// (Type0 lost its text, Differences returned the guessed "ABC").
const FS_UNMAPPED = [['Type0 Identity', UNMAPPED_TYPE0, '<00410042>'], ['subset-name Differences', UNMAPPED_DIFFERENCES, '(ABC)']];
const fsFonts = f2 => ({ F1: HELVETICA, F2: f2 });
const SHOWN = s => `BT 72 600 Td ${s} Tj ET`;
const REJ = '(Recent technical study rejects this attribution.)';
const assertIncomplete = r => { assert.strictEqual(r.ok, false, `extracted as complete: ${JSON.stringify(r.text)}`); assert.strictEqual(r.status, 'pdf-incomplete'); assert.match(r.reason, /Unicode mapping|font association/); };
const assertComplete = r => { assert.ok(r.ok, r.reason); assert.ok(r.text.includes(ATTRIBUTION) && r.text.includes(REJECTION.slice(0, 20)), r.text); };
for (const [label, font, text] of FS_UNMAPPED) {
  t(`R3-1: ${label} selected, attribution shown in Helvetica inside q/Q, then shown after Q with no Tf, fails as incomplete`, async () =>
    assertIncomplete(await extract(fontStatePdf(`BT /F2 12 Tf ET q ${textOps([ATTRIBUTION])} Q ${SHOWN(text)}`, { fonts: fsFonts(font) }))));
  t(`R3-1: ${label} selected through an ExtGState /Font (gs, no Tf) fails as incomplete`, async () =>
    assertIncomplete(await extract(fontStatePdf(`${textOps([ATTRIBUTION])} /GS1 gs ${SHOWN(text)}`, { fonts: fsFonts(font), gstates: { GS1: 'F2' } }))));
  t(`R3-1: ${label} restored through nested q/q/Q/Q fails as incomplete`, async () =>
    assertIncomplete(await extract(fontStatePdf(`BT /F2 12 Tf ET q q ${textOps([ATTRIBUTION])} Q BT /F1 12 Tf ET Q ${SHOWN(text)}`, { fonts: fsFonts(font) }))));
  t(`R3-1: ${label} restored after a form XObject that selects Helvetica fails as incomplete`, async () =>
    assertIncomplete(await extract(fontStatePdf(`BT /F2 12 Tf ET /Fm1 Do ${SHOWN(text)}`, { fonts: fsFonts(font), forms: { Fm1: textOps([ATTRIBUTION]) } }))));
  t(`R3-1: ${label} selected through an ExtGState inside a form, shown in the form after a Helvetica Tf, fails as incomplete`, async () =>
    assertIncomplete(await extract(fontStatePdf(`${textOps([ATTRIBUTION])} /Fm1 Do`, { fonts: fsFonts(font), gstates: { GS1: 'F2' }, forms: { Fm1: `BT /F1 12 Tf ET /GS1 gs ${SHOWN(text)}` } }))));
}
// Mapped-font controls: the same structures, where the state replay (not the last Tf) proves the glyphs mapped. Each
// was a false pdf-incomplete before the fix, because the last `Tf` names the unmapped font that shows nothing.
t('R3-1: control: an unmapped Tf discarded by Q leaves the mapped font in force; the text extracts completely', async () =>
  assertComplete(await extract(fontStatePdf(`${textOps([ATTRIBUTION])} BT /F1 12 Tf ET q BT /F2 12 Tf ET Q ${SHOWN(REJ)}`, { fonts: fsFonts(UNMAPPED_TYPE0) }))));
t('R3-1: control: a mapped font selected through an ExtGState after an unmapped Tf extracts completely', async () =>
  assertComplete(await extract(fontStatePdf(`${textOps([ATTRIBUTION])} BT /F2 12 Tf ET /GS1 gs ${SHOWN(REJ)}`, { fonts: { F1: HELVETICA, F2: UNMAPPED_TYPE0, F3: HELVETICA_BOLD }, gstates: { GS1: 'F3' } }))));
t('R3-1: control: an unmapped Tf inside a form does not leak past the form; nested q/Q in the form is restored', async () =>
  assertComplete(await extract(fontStatePdf(`${textOps([ATTRIBUTION])} BT /F1 12 Tf ET /Fm1 Do ${SHOWN(REJ)}`, { fonts: fsFonts(UNMAPPED_TYPE0), forms: { Fm1: 'q BT /F1 12 Tf ET q BT /F2 12 Tf ET Q Q BT /F2 12 Tf ET' } }))));
// Fail closed whenever the association cannot be established (pure replay of synthetic pdf.js operator lists).
t('R3-1: the font-state replay fails closed on unbalanced restores/form ends, unreadable gs fonts and unnormalized text', async () => {
  const { fontStateReplay } = await import('../scripts/lib/pdf-font-state.mjs');
  const { OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const g = [{ originalCharCode: 65 }], fonts = { a: { name: 'A' }, b: { name: 'B' } }, look = k => fonts[k] ?? null;
  const run = ops => fontStateReplay(OPS, ops.map(o => o[0]), ops.map(o => o[1]), look).map(x => x.state.unknown || x.state.font?.name || null);
  assert.deepStrictEqual(run([[OPS.setFont, ['a', 12]], [OPS.restore, []], [OPS.showText, [g]]]), ['unbalanced restore']);
  assert.deepStrictEqual(run([[OPS.setFont, ['a', 12]], [OPS.paintFormXObjectEnd, []], [OPS.showText, [g]]]), ['unbalanced form end']);
  assert.deepStrictEqual(run([[OPS.setGState, [[['Font', 'b']]]], [OPS.showText, [g]]]), ['unreadable graphics-state font']);
  assert.deepStrictEqual(run([[OPS.setFont, ['a', 12]], [OPS.showSpacedText, [g]]]), ['unnormalized text operator']);
  assert.deepStrictEqual(run([[OPS.showText, [g]]]), [null], 'no font selected: font data unavailable');
  // a restore inside a form cannot pop the state saved outside it
  assert.deepStrictEqual(run([[OPS.setFont, ['a', 12]], [OPS.save, []], [OPS.paintFormXObjectBegin, []], [OPS.restore, []], [OPS.showText, [g]]]), ['unbalanced restore']);
  // the real state is tracked: q/Q, forms and gs
  assert.deepStrictEqual(run([[OPS.setFont, ['b', 12]], [OPS.save, []], [OPS.setFont, ['a', 12]], [OPS.restore, []], [OPS.showText, [g]],
    [OPS.paintFormXObjectBegin, []], [OPS.setGState, [[['LW', 1], ['Font', ['a', 12]]]]], [OPS.showText, [g]], [OPS.paintFormXObjectEnd, []], [OPS.showText, [g]]]), ['B', 'A', 'B']);
});
// review-2 RSS fail-open: Codex's memory probe completed with ok:true because `ps` was denied and rss read as 0.
for (const [name, rss] of [['ps denied', ST.makeRssObserver({ platform: 'darwin', psBin: '/nonexistent/ps' })], ['/proc unreadable', ST.makeRssObserver({ platform: 'linux', procRoot: '/nonexistent-proc' })]])
  t(`RSS: an unobservable worker RSS (${name}) fails closed, never reads as 0`, async () => {
    const r = await ST.runPdfWorker(bombPdf(90 * 1024 * 1024), { ...ST.PDF_LIMITS, maxRssMb: 60 }, { rss });
    assert.strictEqual(r.ok, false, 'worker ran with no enforced memory bound'); assert.strictEqual(r.status, 'pdf-memory-unobservable');
  });
t('6: the pdf.js child process is bounded by time and memory', async () => {
  const pdf = pagePdf([{ text: textOps([ATTRIBUTION]) }]);
  const slow = await ST.runPdfWorker(pdf, { ...ST.PDF_LIMITS, timeoutMs: 30 }, OBS);
  assert.strictEqual(slow.ok, false); assert.strictEqual(slow.status, 'pdf-timeout');
  const big = await ST.runPdfWorker(bombPdf(90 * 1024 * 1024), { ...ST.PDF_LIMITS, maxRssMb: 60 });
  // Where RSS can be observed the bound trips; where it cannot (a sandbox denying `ps`) the run fails closed instead.
  assert.strictEqual(big.ok, false); assert.ok(['pdf-memory-limit', 'pdf-memory-unobservable'].includes(big.status), big.status);
  const ok = await extract(pdf);
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

// ---- review-2 R2-1: every activity shape is inspected before any outcome branch ----
// Reproduction = Codex's probe (round2/probes/stopgap/review2-capabilities.mjs): an injected B1 execution with valid
// init/image/result evidence plus one extra activity shape. Before the fix the stream_event and server-usage cases
// returned accepted raw output. No command is executed (the executor is injected).
const { syntheticFixture, verifyStageCapabilities, parseStreamTranscript, verifyB1ImageRead } = await import('../scripts/lib/pass-b-calibration.mjs');
const { sha256: legacySha } = await import('../scripts/lib/vision-legacy.mjs');
const B1_BODY = syntheticFixture().bodies.B1;
const INIT = { type: 'system', subtype: 'init', apiKeySource: 'none', model: C.COLLECTION_MODEL, claude_code_version: '2.1.280', tools: ['Read', 'StructuredOutput'], mcp_servers: [] };
const STREAMED_BASH = { type: 'stream_event', event: { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'x', name: 'Bash', input: { command: 'id' } } } };
const USAGE_LIMIT = { type: 'result', subtype: 'error', is_error: true, api_error_status: 429, result: 'usage limit reached', structured_output: null };
async function b1Attempt({ init = true, extra = [], result = {}, exitCode = 0 }) {
  const root = mkdtempSync(join(tmpdir(), 'r2-cap-')), wd = join(root, 'works', 'work');
  makeDirs(root, wd);
  const img = legacySha('img'), file = `${img}.png`; writeFileSync(join(root, 'imgs', file), 'img');
  try {
    const r = await C.executeCorpusAttempt({ runDir: root, workRunDir: wd, id: 'work', imgSha256: img, ext: 'png', stage: 'B1', seq: 1, runtimeVersion: '2.1.280', imageFile: file,
      command: { bin: 'NEVER-EXECUTED', argv: ['-p', 'fixture', '--model', C.COLLECTION_MODEL, '--effort', 'medium'], env: { removeKeys: [] } }, now: () => new Date('2026-11-20T10:00:00Z'),
      execute: async (_bin, _argv, o) => {
        const evs = [...(init ? [INIT] : []), { type: 'assistant', message: { model: C.COLLECTION_MODEL, content: [{ type: 'tool_use', name: 'Read', id: 'r', input: { file_path: `${o.cwd}/${file}` } }] } },
          { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'r', content: [{ type: 'image' }] }] } }, ...extra,
          { type: 'result', subtype: 'success', is_error: false, structured_output: B1_BODY, modelUsage: { [C.COLLECTION_MODEL]: { output_tokens: 10, webSearchRequests: 0 } }, usage: { server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 } }, ...result }];
        const stdout = `${evs.map(e => JSON.stringify(e)).join('\n')}\n`;
        if (exitCode) throw Object.assign(new Error('exit'), { code: exitCode, stdout });
        return { stdout };
      } });
    return { accepted: !!r.raw, fatal: C.preservedFatal(root) };
  } catch (e) { return { error: e.message, fatal: C.preservedFatal(root) }; }
  finally { rmSync(root, { recursive: true, force: true }); }
}
function makeDirs(root, wd) { mkdirSync(wd, { recursive: true }); mkdirSync(join(root, 'imgs')); }
const FORBIDDEN = [
  ['a streamed Bash tool_use (stream_event content_block_start)', { extra: [STREAMED_BASH] }],
  ['a streamed server_tool_use block', { extra: [{ type: 'stream_event', event: { type: 'content_block_start', index: 1, content_block: { type: 'server_tool_use', id: 's', name: 'web_search', input: {} } } }] }],
  ['usage.server_tool_use.web_search_requests=1 on a stage without WebSearch', { result: { usage: { server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 } } } }],
  ['modelUsage webSearchRequests=1 on a stage without WebSearch', { result: { modelUsage: { [C.COLLECTION_MODEL]: { output_tokens: 10, webSearchRequests: 1 } } } }],
  ['a server-tool counter in a streamed message_delta', { extra: [{ type: 'stream_event', event: { type: 'message_delta', usage: { server_tool_use: { web_fetch_requests: 2 } } } }] }],
  ['a permission denial naming Bash (non-message activity)', { result: { permission_denials: [{ tool_name: 'Bash', tool_use_id: 'b', tool_input: { command: 'id' } }] } }],
  ['a streamed Bash tool_use with NO init and exit 1', { init: false, extra: [STREAMED_BASH], exitCode: 1 }],
  ['a streamed Bash tool_use with NO init behind a usage-limit result', { init: false, extra: [STREAMED_BASH], result: USAGE_LIMIT }],
  ['a client Bash tool_use with NO init behind a usage-limit result and exit 1', { init: false, extra: [{ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'b', name: 'Bash', input: { command: 'id' } }] } }], result: USAGE_LIMIT, exitCode: 1 }],
];
for (const [name, opts] of FORBIDDEN)
  t(`R2-1: ${name} is a pipeline-wide capability fatal, never accepted/usage-limit/operational`, async () => {
    const r = await b1Attempt(opts);
    assert.ok(!r.accepted, 'raw output was accepted');
    assert.match(r.error || '', /capability violation/); assert.match(r.fatal || '', /capability violation/, 'fatal persisted');
  });
t('R2-1: control: the same B1 call with zero server-tool counters is accepted; B2 may report web counters', async () => {
  const r = await b1Attempt({});
  assert.ok(r.accepted, r.error); assert.strictEqual(r.fatal, null);
  const b2 = [{ ...INIT, tools: ['StructuredOutput', 'WebFetch', 'WebSearch'] }, { type: 'result', subtype: 'success', modelUsage: { m: { webSearchRequests: 1 } }, usage: { server_tool_use: { web_search_requests: 1, web_fetch_requests: 1 } } }];
  assert.deepStrictEqual(verifyStageCapabilities(b2.map(e => JSON.stringify(e)).join('\n'), 'B2'), { ok: true, bad: [], activity: [] });
});
t('R2-1: init-independent activity is reported for a preserved transcript with no init (resume re-check)', () => {
  const text = [{ type: 'assistant', message: { content: [] } }, STREAMED_BASH].map(e => JSON.stringify(e)).join('\n');
  const v = verifyStageCapabilities(text, 'B1');
  assert.strictEqual(v.ok, false); assert.deepStrictEqual(v.activity, ['tool_use Bash']);
});
// ---- review-3 finding 2: Read arguments are checked in every envelope, ahead of missing-init/exit/quota ----
// Reproduction = Codex's probe (round3/probes/review3-activity.mjs): the valid image Read plus one extra Read of
// /etc/passwd, as a streamed block or an ordinary block with no init and exit 1. Before the fix the streamed Read was
// accepted (the receipt parser read only message.content) and the no-init Read became an operational pause. Nothing is
// executed: the executor is injected and returns a transcript.
const { setAsideRecord } = await import('../scripts/lib/pass-b-set-aside.mjs');
const streamStart = (block, index = 1) => ({ type: 'stream_event', event: { type: 'content_block_start', index, content_block: block } });
const streamDelta = (partial_json, index = 1) => ({ type: 'stream_event', event: { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json } } });
const OUT_READ = { type: 'tool_use', id: 'bad', name: 'Read', input: { file_path: '/etc/passwd' } };
const READ_CASES = [
  ['a streamed Read of /etc/passwd (content_block_start input)', { extra: [streamStart(OUT_READ)] }],
  ['a streamed Read of /etc/passwd assembled from input_json_delta deltas', { extra: [streamStart({ ...OUT_READ, input: {} }), streamDelta('{"file_pa'), streamDelta('th":"/etc/passwd"}')] }],
  ['an interrupted streamed Read whose partial path already left the call folder', { extra: [streamStart({ ...OUT_READ, input: {} }), streamDelta('{"file_path":"/etc/pa')] }],
  ['an interrupted streamed Read that has a tool result (executed, input unverifiable)', { extra: [streamStart({ ...OUT_READ, input: {} }), streamDelta('{"file_pa'),
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'bad', content: 'root:x:0:0' }] } }] }],
  ['a streamed Read of /etc/passwd with NO init and exit 1', { init: false, extra: [streamStart(OUT_READ)], exitCode: 1 }],
  ['an ordinary Read of /etc/passwd with NO init and exit 1', { init: false, extra: [{ type: 'assistant', message: { content: [OUT_READ] } }], exitCode: 1 }],
  ['an ordinary Read of /etc/passwd with NO init behind a usage-limit result', { init: false, extra: [{ type: 'assistant', message: { content: [OUT_READ] } }], result: USAGE_LIMIT }],
];
// One fresh attempt through the real collector (B1 or B3), then a resume inspection of the preserved attempt with the
// convenience fatal.json removed. `setAside` models an older work-level set-aside receipt bound to the attempt.
async function readAttempt(stage, { init = true, extra = [], result = {}, exitCode = 0, setAside = false }) {
  const root = mkdtempSync(join(tmpdir(), 'r3-read-')), id = 'work', wd = join(root, 'works', legacySha(id).slice(0, 24));
  makeDirs(root, wd);
  const img = legacySha('img'), file = `${img}.png`; writeFileSync(join(root, 'imgs', file), 'img');
  writeFileSync(join(wd, 'b0-prep.json'), JSON.stringify({ work: { id }, trustedCatalog: {}, legacy: {}, image: { ok: true, imgSha256: img, ext: 'png' } }));
  const out = {};
  try {
    try {
      const r = await C.executeCorpusAttempt({ runDir: root, workRunDir: wd, id, imgSha256: img, ext: 'png', stage, seq: 1, runtimeVersion: '2.1.280', imageFile: file,
        command: { bin: 'NEVER-EXECUTED', argv: ['-p', 'fixture', '--model', C.COLLECTION_MODEL, '--effort', 'medium'], env: { removeKeys: [] } }, now: () => new Date('2026-11-20T10:00:00Z'),
        execute: async (_bin, _argv, o) => {
          const evs = [...(init ? [INIT] : []), { type: 'assistant', message: { model: C.COLLECTION_MODEL, content: [{ type: 'tool_use', name: 'Read', id: 'r', input: { file_path: `${o.cwd}/${file}` } }] } },
            { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'r', content: [{ type: 'image' }] }] } }, ...extra,
            { type: 'result', subtype: 'success', is_error: false, structured_output: B1_BODY, modelUsage: { [C.COLLECTION_MODEL]: { output_tokens: 10 } }, ...result }];
          const stdout = `${evs.map(e => JSON.stringify(e)).join('\n')}\n`;
          if (exitCode) throw Object.assign(new Error('exit'), { code: exitCode, stdout });
          return { stdout };
        } });
      out.accepted = !!r.raw;
    } catch (e) { out.error = e.message; }
    out.fatal = C.preservedFatal(root);
    const stem = `${stage.toLowerCase()}-000001`, metaPath = join(wd, 'attempts', `${stem}.meta.json`);
    if (setAside) {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8')); meta.kind = 'fatal'; meta.reason = 'model drift in answer'; writeFileSync(metaPath, JSON.stringify(meta));
      writeFileSync(join(wd, 'attempts', `${stem}.set-aside.json`), JSON.stringify(setAsideRecord({ workId: id, reason: meta.reason, boundFile: metaPath })));
    }
    if (existsSync(join(root, 'fatal.json'))) rmSync(join(root, 'fatal.json'));
    const row = C.inspectWork({ runDir: root, id, catalog: {}, legacy: {} });
    out.resumedFatal = row.fatal; out.resumedPause = row.pause;
    return out;
  } finally { rmSync(root, { recursive: true, force: true }); }
}
for (const stage of ['B1', 'B3'])
  for (const [name, opts] of READ_CASES)
    t(`R3-2: ${stage}: ${name} is a confinement fatal (fresh and on resume), never accepted/operational/usage-limit`, async () => {
      const r = await readAttempt(stage, opts);
      assert.ok(!r.accepted, 'raw output was accepted');
      assert.match(r.error || '', /confinement violation/); assert.match(r.fatal || '', /confinement violation/, 'fatal persisted');
      assert.match(r.resumedFatal || '', /confinement violation/, `resume: ${JSON.stringify(r)}`);
    });
for (const stage of ['B1', 'B3'])
  t(`R3-2: ${stage}: resume re-checks an out-of-directory Read ahead of a prior set-aside receipt`, async () => {
    for (const extra of [[streamStart(OUT_READ)], [{ type: 'assistant', message: { content: [OUT_READ] } }]]) {
      const r = await readAttempt(stage, { extra, setAside: true });
      assert.match(r.resumedFatal || '', /confinement violation/, `resume: ${JSON.stringify(r)}`);
    }
  });
t('R3-2: the receipt check normalizes streamed Reads without double-counting or treating payloads as tools', () => {
  const dir = '/tmp/corpus-x', img = 'abc.png', ok = { type: 'tool_use', id: 'r', name: 'Read', input: { file_path: `${dir}/${img}` } };
  const res = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'r', content: [{ type: 'image' }] }] } };
  const v = evs => verifyB1ImageRead(parseStreamTranscript(evs.map(e => JSON.stringify(e)).join('\n')), { callDir: dir, imageBasename: img });
  // the same block in both envelopes is one call
  const both = v([streamStart({ ...ok, input: {} }, 0), streamDelta(JSON.stringify(ok.input), 0), { type: 'assistant', message: { content: [ok] } }, res]);
  assert.deepStrictEqual([both.ok, both.good, both.reads], [true, 1, 1]);
  // an interrupted streamed Read still on the image path, never executed, is not proven bad
  assert.ok(v([{ type: 'assistant', message: { content: [ok] } }, res, streamStart({ ...ok, id: 'p', input: {} }), streamDelta(`{"file_path":"${dir}/ab`)]).ok);
  // a streamed id reused with a different input keeps both inputs (fail closed)
  assert.deepStrictEqual(v([streamStart({ ...ok, input: { file_path: '/etc/passwd' } }), { type: 'assistant', message: { content: [ok] } }, res]).bad, ['/etc/passwd']);
  // tool-shaped data inside a tool input or a text block is payload, not a Read
  const payload = { type: 'tool_use', id: 's', name: 'StructuredOutput', input: { note: { type: 'tool_use', name: 'Read', input: { file_path: '/etc/passwd' } } } };
  assert.ok(v([{ type: 'assistant', message: { content: [ok, payload, { type: 'text', text: JSON.stringify(OUT_READ) }] } }, res]).ok);
  // traversal in an interrupted streamed path is proven bad
  assert.ok(!v([{ type: 'assistant', message: { content: [ok] } }, res, streamStart({ ...ok, id: 'q', input: {} }), streamDelta(`{"file_path":"${dir}/../`)]).ok);
});
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
