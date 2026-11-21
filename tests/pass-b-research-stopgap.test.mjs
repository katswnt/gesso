// Offline regressions for the VSD-092 research stopgap (no model calls, no network).
// The collector reads PASS_B_RESEARCH_VERSION at import, so it is imported dynamically after the env is set.
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync, readdirSync, cpSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { sha256, stableJson } from '../scripts/lib/vision-legacy.mjs';
import { stagePrompts, stopgapStagePrompts, STOPGAP_TEXT } from '../scripts/lib/pass-b-prompts.mjs';
import { validateStageBody, B2_CONTRACT_STOPGAP, B2_CORE_QUESTION_IDS } from '../scripts/lib/vision-content-schema.mjs';
import { wireSchemaFor, validateAgainstWire } from '../scripts/lib/pass-b-wire-schema.mjs';
import { extractPdfText, extractSourceText } from '../scripts/lib/pass-b-source-text.mjs';
import {
  b2PlanStopgap, b3DispatchPlan, appendB3DispatchReviews, loadB3DispatchReviews, deriveCoverage, captureTargets, captureSources,
  buildCaptureSidecar, verifyCaptureSidecar, captureIsTransient, passageText, classifyHold, CAPTURE_LIMITS, B3_DISPATCH_REQUEST_VERSION, sourceStore,
} from '../scripts/lib/pass-b-research-stopgap.mjs';
import { runWorkStages, syntheticFixture, trustedCatalog, b2Plan, b1PromptText, b2PromptText, b2InputFor, legacyContentInput, producerEvidence, IMAGE_TRANSPORT_VERSION, CALIBRATION_MODEL, STAGE_TOOLS } from '../scripts/lib/pass-b-calibration.mjs';
import { captureStageCompletion } from '../scripts/lib/vision-content-capture.mjs';
import { BROKER_POLICY_VERSION } from '../scripts/lib/img-broker.mjs';

process.env.PASS_B_RESEARCH_VERSION = 'stopgap-1';
const C = await import('../scripts/pass-b-corpus-collect.mjs');

let n = 0; const tests = [];
const t = (name, fn) => tests.push([name, fn]);
function tree(dir) {
  const out = {};
  const walk = (d, pre = '') => { for (const e of readdirSync(d, { withFileTypes: true })) { const k = `${pre}${e.name}`; if (e.isSymbolicLink()) { out[k] = 'symlink'; continue; } if (e.isDirectory()) { out[k] = 'dir'; walk(join(d, e.name), `${k}/`); } else out[k] = sha256(readFileSync(join(d, e.name))); } };
  walk(dir); return out;
}

// ---- prompts ----
t('banked prompts and run identity are unchanged; the stopgap has its own identity', () => {
  assert.strictEqual(C.BANKED_RUN_ID, 'corpus-b3-6401bc543ead');
  assert.notStrictEqual(C.CORPUS_RUN_ID, C.BANKED_RUN_ID);
  const out = execFileSync(process.execPath, ['-e', "import('./scripts/pass-b-corpus-collect.mjs').then(m=>console.log(m.CORPUS_RUN_ID))"], { encoding: 'utf8', env: { ...process.env, PASS_B_RESEARCH_VERSION: '' } }).trim();
  assert.strictEqual(out, 'corpus-b3-6401bc543ead', 'without the env the collector is the banked run');
});
t('stopgap B2 replaces the legacy-agenda scope rule and the five-answer rule; adds the image-only request rule', () => {
  const banked = stagePrompts().B2, s = stopgapStagePrompts().B2;
  assert.match(banked, /Run research only where B1 questions or consequential legacy claims/);
  assert.doesNotMatch(s, /Run research only where B1 questions/);
  assert.doesNotMatch(s, /at least five guideAnswers/);
  assert.ok(s.includes(STOPGAP_TEXT.b2Scope) && s.includes(STOPGAP_TEXT.b2Targets) && s.includes(STOPGAP_TEXT.b2Fetch));
  for (const q of B2_CORE_QUESTION_IDS) assert.ok(s.includes(q), q);
  assert.match(s.split('\n\n').at(-1), /^Schema: exactly \{catalog/, 'schema line stays last');
});
t('stopgap B1 appends the relational rule; B3 defines found as physical, documentary -> found:false', () => {
  const p = stopgapStagePrompts();
  assert.ok(p.B1.includes(STOPGAP_TEXT.b1Relational) && !stagePrompts().B1.includes(STOPGAP_TEXT.b1Relational));
  assert.match(p.B1.split('\n\n').at(-1), /^Schema: exactly \{imageFitness/);
  assert.ok(p.B3.includes('If the request is documentary, asks for identity') && p.B3.includes('found=false and bbox=null'));
  assert.strictEqual(p.B4, stagePrompts().B4, 'B4 is not part of the stopgap');
});

// ---- validator ----
const base = syntheticFixture(), ctx = base.contexts.B2;
const noAnswers = { ...structuredClone(base.bodies.B2), guideAnswers: [] };
t('B2 validator: minimum 0 under the stopgap contract only; banked stays 5 (wire schema too)', () => {
  assert.ok(!validateStageBody('B2', noAnswers, ctx).ok, 'banked contract still requires five');
  assert.ok(validateStageBody('B2', noAnswers, { ...ctx, b2Contract: B2_CONTRACT_STOPGAP }).ok, 'stopgap: zero answers structurally valid');
  assert.ok(validateAgainstWire(wireSchemaFor('B2', { ...ctx }), noAnswers).length > 0);
  assert.deepStrictEqual(validateAgainstWire(wireSchemaFor('B2', { ...ctx, b2Contract: B2_CONTRACT_STOPGAP }), noAnswers), []);
});
t('core gaps are reported separately from stage validity and never read as complete coverage', () => {
  const cov = deriveCoverage(noAnswers);
  assert.strictEqual(cov.stageValid, true); assert.deepStrictEqual(cov.gaps, B2_CORE_QUESTION_IDS); assert.strictEqual(cov.coverageStatus, 'gaps-reported');
  const all = { ...noAnswers, guideAnswers: B2_CORE_QUESTION_IDS.map(q => ({ questionId: q, q: `${q}?`, a: 'Answer.', kind: 'context', evidenceRef: null, sourceRefs: ['s1'] })) };
  assert.strictEqual(deriveCoverage(all).coverageStatus, 'core-answers-present-unverified');
});

// ---- triggers ----
t('B2 runs for every usable work, even with no B1 topics and no legacy claims (banked trigger would skip it)', () => {
  const b1 = { ...structuredClone(base.bodies.B1), researchQuestions: [] };
  assert.strictEqual(b2Plan(b1, { counts: {}, teaching: null }).run, false, 'banked trigger skips this work');
  assert.strictEqual(b2PlanStopgap(b1).run, true);
  assert.strictEqual(b2PlanStopgap({ ...b1, playable: false, imageFitness: { ...b1.imageFitness, imageState: 'unplayable' } }).run, false);
});
const req = (requestId, whatToLocate) => ({ requestId, claimId: 'c1', whatToLocate });
const b2WithReqs = { ...structuredClone(base.bodies.B2), targetedVerificationRequests: [req('r1', 'the museum record for the attribution'), req('r2', 'the small cross shape in the upper right')] };
t('B3 never dispatches unattended: requests await inspection until a bound review approves physical ones', () => {
  const none = b3DispatchPlan('w', b2WithReqs, []);
  assert.strictEqual(none.run, false); assert.strictEqual(none.status, 'awaiting-inspection'); assert.deepStrictEqual(none.pending, ['r1', 'r2']);
  const d = mkdtempSync(join(tmpdir(), 'b3rev-'));
  try {
    const decision = (r, decision) => ({ requestId: r.requestId, whatToLocateSha256: sha256(r.whatToLocate), decision });
    const request = { version: B3_DISPATCH_REQUEST_VERSION, runId: 'run', reviewedBy: 'Codex', reason: 'canary inspection', reviewedAt: '2026-11-21T00:00:00Z',
      works: [{ workId: 'w', decisions: [decision(b2WithReqs.targetedVerificationRequests[0], 'reject'), decision(b2WithReqs.targetedVerificationRequests[1], 'dispatch')] }] };
    assert.throws(() => appendB3DispatchReviews(d, 'run', { ...request, works: [{ workId: 'w', decisions: request.works[0].decisions.slice(1) }] }, new Map([['w', b2WithReqs]])), /every request/);
    const undecided = structuredClone(request); undecided.works[0].decisions[0].decision = null;
    assert.throws(() => appendB3DispatchReviews(d, 'run', undecided, new Map([['w', b2WithReqs]])), /"dispatch" or "reject"/);
    appendB3DispatchReviews(d, 'run', request, new Map([['w', b2WithReqs]]));
    const plan = b3DispatchPlan('w', b2WithReqs, loadB3DispatchReviews(d, 'run'));
    assert.deepStrictEqual(plan.requests, [{ requestId: 'r2', whatToLocate: 'the small cross shape in the upper right' }], 'the documentary request never reaches B3');
    assert.throws(() => appendB3DispatchReviews(d, 'run', request, new Map([['w', b2WithReqs]])), /already reviewed/);
    const changed = structuredClone(b2WithReqs); changed.uncertainty = 'edited';
    assert.throws(() => b3DispatchPlan('w', changed, loadB3DispatchReviews(d, 'run')), /different B2 body/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// ---- PDF + source capture ----
function minimalPdf(lines) {
  const content = `BT /F1 12 Tf 72 720 Td (${lines[0]}) Tj 0 -14 Td (${lines[1]}) Tj 0 -40 Td (${lines[2]}) Tj ET`;
  const z = deflateSync(Buffer.from(content, 'latin1'));
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const parts = [Buffer.from('%PDF-1.4\n', 'latin1')];
  objs.forEach((o, i) => parts.push(Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, 'latin1')));
  parts.push(Buffer.from(`5 0 obj\n<< /Length ${z.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'), z, Buffer.from('\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1'));
  return Buffer.concat(parts);
}
const PEACOCK = ['Eventually Leyland agreed to half that amount, but he further insulted Whistler', 'by writing his check in pounds, the currency of trade.', 'Leyland kept his dining room as Whistler had left it.'];
t('PDF text is extracted explicitly (FlateDecode page stream; wraps joined, paragraphs split)', async () => {
  const r = await extractPdfText(minimalPdf(PEACOCK));
  assert.ok(r.ok, r.reason);
  assert.strictEqual(r.text, `${PEACOCK[0]} ${PEACOCK[1]}\n${PEACOCK[2]}`);
  assert.strictEqual((await extractSourceText(minimalPdf(PEACOCK), 'application/pdf')).kind, 'pdf');
  const bad = await extractSourceText(Buffer.from('%PDF-1.4\n%%EOF'), 'application/pdf');
  assert.strictEqual(bad.ok, false); assert.strictEqual(bad.status, 'pdf-extraction-failed', 'a failed PDF is an explicit status, not empty success');
});
const catalog = { title: 'The Peacock Room', artist: 'Whistler', date: '1876', place: 'London', medium: 'oil', style: '', catalogId: 'sifsg_F1904.61' };
const HTML = '<html><nav>Menu Shop</nav><h1>The Peacock Room</h1><p>Harmony in Blue and Gold: The Peacock Room, F1904.61, was the dining room of Frederick Leyland.</p><p>Whistler painted the shutters with fighting peacocks.</p></html>';
const capB2 = { ...structuredClone(base.bodies.B2),
  factChecks: [{ claimId: 'c1', claim: 'Leyland paid Whistler.', verdict: 'supported', confidence: 0.8, sources: [{ sourceId: 's1', url: 'https://museum.example/peacock', title: 'Record', retrievedAt: '2026-11-20T00:00:00Z' }, { sourceId: 's2', url: 'https://museum.example/peacock.pdf', title: 'PDF', retrievedAt: '2026-11-20T00:00:00Z' }] }],
  guideAnswers: [{ questionId: 'core-function', q: 'What was it for?', a: 'A dining room for porcelain display.', kind: 'context', evidenceRef: null, sourceRefs: ['s2'] }], targetedVerificationRequests: [] };
const fakeFetch = async url => url.endsWith('.pdf') ? { ok: true, buffer: minimalPdf(PEACOCK), declaredMime: 'application/pdf', finalUrl: url, chain: [url] }
  : url.endsWith('/peacock') ? { ok: true, buffer: Buffer.from(HTML), declaredMime: 'text/html; charset=utf-8', finalUrl: `${url}/`, chain: [url, `${url}/`] }
    : { ok: false, reason: 'http-status', status: 404, chain: [url] };
const b2Transcript = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'f9', name: 'WebFetch', input: { url: 'https://other.example/missing' } }] } });
t('capture targets: core-answer sources first, then cited, then fetched-uncited; bounded', () => {
  const targets = captureTargets(capB2, b2Transcript);
  assert.deepStrictEqual(targets.map(x => [x.url, x.why]), [['https://museum.example/peacock.pdf', 'core-answer'], ['https://museum.example/peacock', 'cited'], ['https://other.example/missing', 'fetched-uncited']]);
  const many = structuredClone(capB2); many.factChecks[0].sources = Array.from({ length: 9 }, (_, i) => ({ sourceId: `x${i}`, url: `https://m.example/${i}`, title: 't', retrievedAt: '2026-11-20T00:00:00Z' }));
  assert.strictEqual(captureTargets(many, '').length, CAPTURE_LIMITS.maxSources);
});
t('literal capture keeps URL, redirect chain, time, byte hash, extraction version, text hash, identity and exact passages', async () => {
  const researchDir = mkdtempSync(join(tmpdir(), 'stopgap-cap-'));
  const sources = await captureSources({ targets: captureTargets(capB2, b2Transcript), fetchDoc: fakeFetch, catalog, store: sourceStore(researchDir), now: () => new Date('2026-11-21T01:00:00Z') });
  const [pdf, html, missing] = sources;
  assert.strictEqual(pdf.status, 'captured'); assert.strictEqual(pdf.kind, 'pdf'); assert.strictEqual(pdf.bytesSha256, createHash('sha256').update(minimalPdf(PEACOCK)).digest('hex'));
  assert.ok(passageText(pdf, 'p1').includes('he further insulted Whistler by writing his check in pounds'), 'the payer passage survives literally');
  assert.deepStrictEqual(html.chain, ['https://museum.example/peacock', 'https://museum.example/peacock/']);
  assert.ok(html.identity.titleInText && html.identity.idTokens.some(x => x.token === 'F1904.61' && x.inText));
  assert.ok(!html.text.includes('Menu Shop'), 'navigation stripped');
  for (const s of [pdf, html]) for (const p of s.passages) assert.strictEqual(s.text.slice(p.start, p.end).length, p.chars);
  assert.strictEqual(missing.status, 'http-status'); assert.strictEqual(missing.httpStatus, 404); assert.strictEqual(missing.text, undefined);
  const b2Completion = { bodySha256: sha256(stableJson(capB2)), transcriptSha256: sha256('t') };
  const side = buildCaptureSidecar({ runId: 'run', workId: 'w', b2Completion, b2Body: capB2, sources, attemptedAt: '2026-11-21T01:00:00Z' });
  assert.strictEqual(side.status, 'partial');
  assert.deepStrictEqual(side.coreLinks.find(x => x.questionId === 'core-function').capturedSourceIds, ['src1']);
  assert.ok(verifyCaptureSidecar(side, { runId: 'run', workId: 'w', b2Completion, researchDir }).ok);
  const tampered = structuredClone(side); tampered.sources[0].text = tampered.sources[0].text.replace('pounds', 'guineas');
  assert.ok(!verifyCaptureSidecar(tampered, { runId: 'run', workId: 'w', b2Completion }).ok, 'edited text is detected');
  assert.ok(!verifyCaptureSidecar(side, { runId: 'run', workId: 'w', b2Completion: { ...b2Completion, bodySha256: sha256('other') } }).ok, 'bound to its B2');
  assert.ok(captureIsTransient({ status: 'timeout' }) && !captureIsTransient({ status: 'http-status', httpStatus: 404 }));
  rmSync(researchDir, { recursive: true, force: true });
});
t('daily-hold diagnosis separates image, retrieval, catalog and evidence problems', () => {
  assert.deepStrictEqual(['B0:http-status @x', 'evidence:B2:invalid body: guideAnswers', 'B2 research-not-performed: WebSearch=0', 'w: B0 input drift; preserve and review'].map(classifyHold), ['image', 'evidence', 'retrieval', 'catalog']);
});
t('stopgap queue: window first (date order), then a balanced round-robin across tiers', () => {
  const pool = ['w1', 'e1', 'e2', 'm1', 'm2', 'i1', 'i2', 'i3'].map(id => ({ id, img: 'https://x.test/a', region: 'Europe' }));
  const daily = { easy: ['e1', 'e2'], medium: ['m1', 'm2'], impossible: ['i1', 'i2', 'i3'], byDate: { '2026-11-21': { easy: ['w1'] } } };
  const q = C.stopgapPriorityQueue(pool, daily, { today: '2026-11-21', windowOnly: false });
  assert.deepStrictEqual(q.slice(0, 1), ['w1']);
  assert.deepStrictEqual(q.slice(1, 4).map(x => x[0]).sort(), ['e', 'i', 'm'], 'one from each tier before any tier repeats');
  assert.deepStrictEqual(C.stopgapPriorityQueue(pool, daily, { today: '2026-11-21' }), ['w1']);
});

// ---- migration: banked import into the stopgap run ----
function bankedFixture() {
  const root = mkdtempSync(join(tmpdir(), 'stopgap-')), banked = join(root, 'banked'), cur = join(root, 'current');
  const id = 'met999', p = { id, title: 'Test', artist: 'Anon', y: 1650, place: 'Somewhere', medium: 'oil', style: 'Baroque', img: 'https://example.test/i.jpg' };
  const catalog = trustedCatalog(p), legacy = { workId: id, teaching: null, counts: {} };
  const imgSha256 = sha256('image bytes'), ext = 'png', imageFile = `${imgSha256}.${ext}`, wd = join(banked, 'works', sha256(id).slice(0, 24));
  mkdirSync(join(wd, 'attempts'), { recursive: true }); mkdirSync(join(banked, 'imgs'));
  writeFileSync(join(banked, 'imgs', imageFile), 'image bytes');
  writeFileSync(join(wd, 'b0-prep.json'), JSON.stringify({ version: 'passBCalibrationB0/1', work: { id }, trustedCatalog: catalog, legacy, image: { id, ok: true, imgSha256, ext } }));
  const B1 = { ...structuredClone(base.bodies.B1), researchQuestions: [] };
  const transcript = (stage, body) => {
    const blocks = stage === 'B2' ? [{ type: 'tool_use', id: 's', name: 'WebSearch', input: { query: 'q' } }, { type: 'tool_use', id: 'f', name: 'WebFetch', input: { url: 'https://museum.example/peacock' } }] : [{ type: 'tool_use', id: 'r', name: 'Read', input: { file_path: `./${imageFile}` } }];
    const results = stage === 'B2' ? ['s', 'f'].map(x => ({ type: 'tool_result', tool_use_id: x, content: [{ type: 'text', text: 'Museum record text with object details. '.repeat(10) }] })) : [{ type: 'tool_result', tool_use_id: 'r', content: [{ type: 'image' }] }];
    return [{ type: 'system', subtype: 'init', apiKeySource: 'none', claude_code_version: '2.1.280', model: CALIBRATION_MODEL, tools: STAGE_TOOLS[stage], mcp_servers: [] }, { type: 'assistant', message: { model: CALIBRATION_MODEL, content: blocks } }, { type: 'user', message: { content: results } }, { type: 'result', subtype: 'success', is_error: false, structured_output: body, modelUsage: { [CALIBRATION_MODEL]: { output_tokens: 10 } } }].map(x => JSON.stringify(x)).join('\n') + '\n';
  };
  const bank = (dir, stage, body, promptText, seq, context = {}) => {
    const text = transcript(stage, body); writeFileSync(join(dir, 'attempts', C.attemptFilename(stage, seq, text)), text);
    captureStageCompletion({ runDir: dir, stage, rawResponse: JSON.stringify(body), trusted: { workId: id, imgSha256, promptHash: sha256(promptText), brokerPolicyVersion: BROKER_POLICY_VERSION, imageTransportVersion: IMAGE_TRANSPORT_VERSION, transcriptSha256: sha256(text) }, producer: producerEvidence(stage, { runtimeVersion: 'unknown' }), createdAt: '2026-11-20T10:00:00Z', context });
  };
  bank(wd, 'B1', B1, b1PromptText(stagePrompts().B1, imageFile), 1);
  writeFileSync(join(banked, 'ledger.json'), JSON.stringify({ runId: C.BANKED_RUN_ID, heldIds: [], doneIds: [id] }));
  const nwd = join(cur, 'works', sha256(id).slice(0, 24)); mkdirSync(join(nwd, 'attempts'), { recursive: true });
  return { root, banked, cur, id, catalog, legacy, imageFile, imgSha256, B1, wd, nwd, bank, inspect: () => C.inspectWork({ runDir: cur, id, catalog, legacy, priorDir: join(root, 'none') }) };
}
t('import reuses the banked B0/image and B1 with a receipt, never writes the banked run, and re-verifies the copies', () => {
  const f = bankedFixture();
  try {
    const before = tree(f.banked);
    const m = C.importBanked({ id: f.id, workRunDir: f.nwd, catalog: f.catalog, legacy: f.legacy, bankedRunDir: f.banked, imgsDir: join(f.cur, 'imgs'), now: new Date('2026-11-21T00:00:00Z') });
    assert.strictEqual(m.sourceRunId, 'corpus-b3-6401bc543ead'); assert.strictEqual(m.b1.model, CALIBRATION_MODEL); assert.strictEqual(m.b1.promptVersion, 'banked');
    assert.deepStrictEqual(tree(f.banked), before, 'banked B1/B2/B3 bytes, ledger and done state untouched');
    const r = f.inspect();
    assert.strictEqual(r.research.b1Imported, true); assert.deepStrictEqual(r.bodies.B1, f.B1); assert.strictEqual(r.attempts, 0, 'no new B1 call');
    assert.strictEqual(r.done, false, 'needs the new-version B2 even with no B1 topics or legacy');
    assert.strictEqual(r.research.status.coverageStatus, 'not-researched');
    assert.strictEqual(C.importBanked({ id: f.id, workRunDir: f.nwd, catalog: f.catalog, legacy: f.legacy, bankedRunDir: f.banked, imgsDir: join(f.cur, 'imgs') }), null, 'idempotent');
    const copy = join(f.nwd, 'imports', 'b1', 'raw', readdirSync(join(f.nwd, 'imports', 'b1', 'raw'))[0]);
    writeFileSync(copy, '{}'); assert.throws(() => f.inspect(), /imported B1 copy/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
t('a banked B0 whose catalog drifted is not imported (normal B0/B1 path instead)', () => {
  const f = bankedFixture();
  try { assert.strictEqual(C.importBanked({ id: f.id, workRunDir: f.nwd, catalog: { ...f.catalog, title: 'Changed' }, legacy: f.legacy, bankedRunDir: f.banked, imgsDir: join(f.cur, 'imgs') }), null); }
  finally { rmSync(f.root, { recursive: true, force: true }); }
});
t('new-version B2 + coverage + literal capture complete the work; old B2 is never consulted or rewritten', async () => {
  const f = bankedFixture();
  try {
    // A banked B2 exists and must stay byte-identical and unused.
    f.bank(f.wd, 'B2', base.bodies.B2, 'old prompt', 2, { evidenceIds: b2InputFor(f.id, f.catalog, f.B1).visibleSignals.map(s => s.evidenceId) });
    const before = tree(f.banked);
    C.importBanked({ id: f.id, workRunDir: f.nwd, catalog: f.catalog, legacy: f.legacy, bankedRunDir: f.banked, imgsDir: join(f.cur, 'imgs') });
    const b2in = b2InputFor(f.id, f.catalog, f.B1), body = { ...structuredClone(capB2), guideAnswers: [] }; // zero answers: valid, gaps reported
    f.bank(f.nwd, 'B2', body, b2PromptText(stopgapStagePrompts().B2, b2in, legacyContentInput(f.legacy)), 1, { evidenceIds: b2in.visibleSignals.map(s => s.evidenceId), b2Contract: B2_CONTRACT_STOPGAP });
    let r = f.inspect();
    assert.ok(r.bodies.B2 && !r.done, 'valid B2 alone is not done');
    assert.strictEqual(r.research.status.sourceCaptureStatus, 'not-attempted');
    const deferred = await C.writeResearchSidecars({ id: f.id, workRunDir: f.nwd, catalog: f.catalog, legacy: f.legacy, runDir: f.cur, fetchDoc: async () => ({ ok: false, reason: 'dns-failed' }) });
    assert.strictEqual(deferred, true, 'an all-transient outage is recorded as an attempt and retried once later');
    assert.strictEqual(f.inspect().done, false);
    assert.strictEqual(await C.writeResearchSidecars({ id: f.id, workRunDir: f.nwd, catalog: f.catalog, legacy: f.legacy, runDir: f.cur, fetchDoc: fakeFetch }), false);
    r = f.inspect();
    assert.strictEqual(r.done, true);
    assert.deepStrictEqual(r.research.status, { operationalStatus: 'done', sourceCaptureStatus: 'captured', coverageStatus: 'gaps-reported', b3DispatchStatus: 'no-requests', copyEligibility: r.research.status.copyEligibility });
    assert.match(r.research.status.copyEligibility, /^not-eligible/);
    assert.deepStrictEqual(tree(f.banked), before, 'old B2 preserved unchanged');
    const capPath = join(f.nwd, 'research', 'source-capture.json'), cap = JSON.parse(readFileSync(capPath, 'utf8'));
    cap.sources[0].text += ' invented'; writeFileSync(capPath, JSON.stringify(cap));
    assert.throws(() => f.inspect(), /source capture sidecar invalid/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
t('stopgap execution epochs bind the research contract and the min-0 B2 wire schema', () => {
  const p = C.executionPolicy('2.1.280');
  assert.strictEqual(p.research, 'passBResearchStopgap/1'); assert.strictEqual(p.b2Contract, B2_CONTRACT_STOPGAP);
  assert.strictEqual(p.b3Dispatch, 'inspected-review-only'); assert.strictEqual(p.evidenceRunId, C.CORPUS_RUN_ID);
});

// ---- CLI containment ----
t('banked --run refuses (VSD-092); the stopgap plan is read-only and write-free', () => {
  const r = spawnSync(process.execPath, ['scripts/pass-b-corpus-collect.mjs', '--run'], { encoding: 'utf8', env: { ...process.env, PASS_B_RESEARCH_VERSION: '', PASS_B_CORPUS_LIVE: '1' } });
  assert.notStrictEqual(r.status, 0); assert.match(r.stderr, /banked B2\/B3 research is paused \(VSD-092\)/);
  const d = mkdtempSync(join(tmpdir(), 'stopgap-cli-'));
  try {
    mkdirSync(join(d, 'scripts'));
    cpSync('scripts/pass-b-corpus-collect.mjs', join(d, 'scripts/pass-b-corpus-collect.mjs'));
    symlinkSync(resolve('scripts/lib'), join(d, 'scripts/lib'));
    mkdirSync(join(d, 'data'));
    for (const [file, g] of [['pool.js', 'ARTEFACTUM_POOL'], ['daily-order.js', 'ARTEFACTUM_DAILY'], ['teach-works.js', 'ARTEFACTUM_CUES'], ['hotspots.js', 'ARTEFACTUM_HOTSPOTS'], ['vision.js', 'ARTEFACTUM_VISION']]) writeFileSync(join(d, 'data', file), `window.${g}=${file === 'pool.js' ? '[]' : '{}'};`);
    writeFileSync(join(d, 'data/vision-audit.json'), '{"ids":[]}');
    const before = tree(d);
    const out = execFileSync(process.execPath, ['scripts/pass-b-corpus-collect.mjs'], { cwd: d, encoding: 'utf8', env: { ...process.env, PASS_B_RESEARCH_VERSION: 'stopgap-1' } });
    assert.match(out, new RegExp(`^runId: ${C.CORPUS_RUN_ID}`, 'm')); assert.match(out, /research stopgap-1 \(passBResearchStopgap\/1\)/); assert.match(out, /READ-ONLY PLAN/);
    assert.deepStrictEqual(tree(d), before);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// ---- review: failed capture attempts are persisted; the four-fetch envelope cannot repeat indefinitely ----
t('an all-transient capture session is recorded; one retry session, then the failures become the sidecar', async () => {
  const f = bankedFixture();
  try {
    C.importBanked({ id: f.id, workRunDir: f.nwd, catalog: f.catalog, legacy: f.legacy, bankedRunDir: f.banked, imgsDir: join(f.cur, 'imgs') });
    const b2in = b2InputFor(f.id, f.catalog, f.B1);
    f.bank(f.nwd, 'B2', structuredClone(capB2), b2PromptText(stopgapStagePrompts().B2, b2in, legacyContentInput(f.legacy)), 1, { evidenceIds: b2in.visibleSignals.map(s => s.evidenceId), b2Contract: B2_CONTRACT_STOPGAP });
    let fetches = 0; const down = async () => { fetches++; return { ok: false, reason: 'dns-failed' }; };
    const run = () => C.writeResearchSidecars({ id: f.id, workRunDir: f.nwd, catalog: f.catalog, legacy: f.legacy, runDir: f.cur, fetchDoc: down });
    assert.strictEqual(await run(), true, 'first outage: deferred');
    const attempts = join(f.nwd, 'research', 'capture-attempts');
    assert.deepStrictEqual(readdirSync(attempts), ['000001.json'], 'the failed session is persisted');
    assert.strictEqual(JSON.parse(readFileSync(join(attempts, '000001.json'), 'utf8')).sources.length, 2);
    assert.strictEqual(await run(), false, 'second outage: no more deferral');
    assert.deepStrictEqual(readdirSync(attempts), ['000001.json', '000002.json']);
    const r = f.inspect();
    assert.strictEqual(r.research.status.sourceCaptureStatus, 'failed'); assert.strictEqual(r.done, true);
    const side = JSON.parse(readFileSync(join(f.nwd, 'research', 'source-capture.json'), 'utf8'));
    assert.deepStrictEqual(side.priorAttempts.map(a => a.file), ['000001.json', '000002.json']);
    assert.strictEqual(fetches, 4, 'two sessions of two targets; never a third');
    assert.strictEqual(await run(), false); assert.strictEqual(fetches, 4, 'a finished sidecar never re-fetches');
    writeFileSync(join(attempts, '000001.json'), '{}');
    assert.throws(() => f.inspect(), /prior capture attempt/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
// ---- review finding 13: stopgap B1/B2/B3 effort is explicit (medium) and epoch-bound ----
t('stopgap B1/B2/B3 commands carry --effort medium, bound into the execution policy', async () => {
  assert.strictEqual(C.executionPolicy('2.1.280').effort, 'medium');
  const fx = syntheticFixture(), seen = {}, cat = trustedCatalog({ id: 'w', title: 'T', artist: 'A', y: 1650, place: 'P', medium: 'oil', style: '' });
  await runWorkStages({ workId: 'w', catalog: cat, legacy: null, imgSha256: 'a'.repeat(64), ext: 'png', prompts: stopgapStagePrompts(), runtimeVersion: '2.1.280', skipB4: true,
    plans: { effort: C.STOPGAP_EFFORT, b2Plan: b2PlanStopgap, b3Plan: () => ({ run: true, requests: [{ requestId: 'r1', whatToLocate: 'the halo' }], requestIds: ['r1'], dropped: 0 }) },
    spawnStage: async (stage, { command }) => { seen[stage] = command.argv.includes('--effort') ? command.argv[command.argv.indexOf('--effort') + 1] : null; throw new Error('stop here'); },
    capture: async () => { throw new Error('unused'); }, loadCompletion: stage => (stage === 'B1' ? fx.bodies.B1 : stage === 'B2' ? fx.bodies.B2 : null) });
  assert.strictEqual(seen.B3, 'medium');
  await runWorkStages({ workId: 'w', catalog: cat, legacy: null, imgSha256: 'a'.repeat(64), ext: 'png', prompts: stopgapStagePrompts(), runtimeVersion: '2.1.280', skipB4: true, plans: { effort: C.STOPGAP_EFFORT, b2Plan: b2PlanStopgap },
    spawnStage: async (stage, { command }) => { seen[stage] = command.argv[command.argv.indexOf('--effort') + 1]; throw new Error('stop'); }, capture: async () => null });
  assert.strictEqual(seen.B1, 'medium');
  await runWorkStages({ workId: 'w', catalog: cat, legacy: null, imgSha256: 'a'.repeat(64), ext: 'png', prompts: stopgapStagePrompts(), runtimeVersion: '2.1.280', skipB4: true, plans: { effort: C.STOPGAP_EFFORT, b2Plan: b2PlanStopgap },
    spawnStage: async (stage, { command }) => { seen[stage] = command.argv[command.argv.indexOf('--effort') + 1]; throw new Error('stop'); }, capture: async () => null, loadCompletion: stage => (stage === 'B1' ? fx.bodies.B1 : null) });
  assert.strictEqual(seen.B2, 'medium');
});
const failed = [];
for (const [name, fn] of tests) { try { await fn(); n++; console.log('ok', name); } catch (e) { failed.push(name); console.log('FAIL', name, '-', String(e?.message || e).split('\n')[0].slice(0, 200)); } }
if (failed.length) { console.log(`pass-b-research-stopgap.test: ${failed.length} FAILED, ${n} passed`); process.exit(1); }
console.log(`pass-b-research-stopgap.test: ${n} checks passed`);
