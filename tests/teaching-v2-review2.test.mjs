// Teaching-v2 Phase A: regressions for Codex's round-2 code review of 7827c97 (2026-11-20), R2-1 and R2-3..R2-7.
// Each check replays Codex's probe (codex-codereview/round2/probes/phase-a/review2-probes.mjs) as its reproduction
// and fails on 7827c97. Modules are imported lazily inside each check, so on the old code a missing export fails
// that check only and the rest still run. The runner-level checks drive scripts/lib/teaching-v2-phase.mjs end to
// end with an INJECTED executor that returns synthetic transcripts: no model call, no network, no git.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const L = p => import(new URL(`../scripts/lib/${p}`, import.meta.url));
const clone = v => JSON.parse(JSON.stringify(v));
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---------- shared fixtures (the same fixture work as tests/teaching-v2-review.test.mjs) ----------
const MODEL = 'claude-sonnet-5-5', RT = '9.9.9', IMG = `${'c'.repeat(64)}.jpg`, DIR = '/tmp/tv2-call-fixture';
const ev = e => JSON.stringify(e);
const classify = async (stdout, o = {}) => (await L('teaching-v2-stage.mjs')).classifyTranscript(stdout, { exitCode: 0, callDir: DIR, imageFile: IMG, runtimeVersion: RT, ...o });
async function fixtures() {
  const C = await L('teaching-v2-contract.mjs');
  const { assemblePacket } = await L('teaching-v2-capture.mjs');
  const HTML = `<html><head><title>Example Jar | Museum</title></head><body><nav>Home Shop Visit</nav>
<p>This water jar was made in Athens around 505 BCE and shows Priam asking Achilles for the body of Hector.</p>
<p>The painter left the figures in the color of the clay and covered the background with black slip.</p>
<p>Jars like this were used for carrying water from the fountain house.</p></body></html>`;
  const snap = { meta: { contentType: 'text/html', status: 200, rawSha256: 'r'.repeat(64), retrievedAt: '2026-11-20T00:00:00Z', finalUrl: 'https://museum.example.org/jar', bytes: HTML.length, chain: [] }, raw: Buffer.from(HTML) };
  const vetted = [{ url: 'https://museum.example.org/jar', kind: 'holdingInstitution', relationshipToWork: 'thisObject (catalog id)', objectIds: ['1'] }];
  const { packet, texts } = assemblePacket({ workId: 'fx1', catalogId: 'fx1', vetted, snapshots: { [vetted[0].url]: snap } });
  const sec = packet.sources[0].sections[0];
  const QUOTE = 'shows Priam asking Achilles for the body of Hector.';
  const slots = fn => C.SLOTS.map(fn);
  const writerResult = () => ({
    dossier: {
      status: 'ready', identity: { status: 'matched', explanation: 'The record names this jar.', sourceRefs: ['S1#P1'] },
      catalogChecks: [], essentials: slots(slot => ({ slot, applicability: 'required', status: 'supported', answer: `answer for ${slot}`, sourceRefs: slot === 'transfer' ? [] : ['S1#P1'], limitation: '' })),
      facts: [{ id: 'F1', proposition: 'Priam asks Achilles for Hector.', scope: 'thisWork', sourceRefs: ['S1#P1'], qualifications: '' }],
      passages: [{ id: 'P1', sourceId: 'S1', sectionId: sec.id, quote: QUOTE }], visualBindings: [], gaps: [], conflicts: [],
    },
    draft: {
      status: 'candidate', holdReasons: [],
      lesson: { why: 'This Athenian jar shows the old king Priam asking Achilles to return the body of his son.',
        hotspots: [{ id: 'h1', tag: 'medium', head: 'Red figures', body: 'The figures are bare clay on black.', x: 0.25, y: 0.5 }, { id: 'h2', tag: 'style', head: 'Bodies in motion', body: 'Overlapping limbs show the new ambition.', x: null, y: null }, { id: 'h3', tag: 'format', head: 'Jar shape', body: 'Side handles mark a water jar.', x: 0.8, y: 0.3 }],
        questions: [{ id: 'q1', q: 'What is happening?', a: 'Priam asks for his son.' }, { id: 'q2', q: 'How does red-figure work?', a: 'Figures are reserved.' }, { id: 'q3', q: 'What was the jar for?', a: 'Carrying water.' }, { id: 'q4', q: 'How can I spot this elsewhere?', a: 'Look for red figures on black.' }] },
      anchors: [{ hotspotId: 'h1', scope: 'unique', targetDescription: 'the left figure', observationId: 'O1', bbox: [0.1, 0.3, 0.3, 0.4] }, { hotspotId: 'h2', scope: 'distributed', targetDescription: 'limbs', observationId: 'O2', bbox: null }, { hotspotId: 'h3', scope: 'unique', targetDescription: 'the right handle', observationId: 'O3', bbox: [0.7, 0.2, 0.2, 0.2] }],
      observations: [{ id: 'O1', description: 'two figures', region: [0.1, 0.3, 0.6, 0.4] }, { id: 'O2', description: 'limbs', region: null }, { id: 'O3', description: 'a handle', region: [0.7, 0.2, 0.2, 0.2] }],
      support: [{ surface: '/why', assertion: 'Priam asks Achilles', kind: 'sourced', observationIds: [], factIds: ['F1'], sourceRefs: ['S1#P1'], qualification: '' }, { surface: '/hotspots/0/body', assertion: 'bare clay', kind: 'visible', observationIds: ['O1'], factIds: [], sourceRefs: [], qualification: '' }, { surface: '/hotspots/2/body', assertion: 'handles', kind: 'visible', observationIds: ['O3'], factIds: [], sourceRefs: [], qualification: '' }],
      coverage: slots(slot => ({ slot, surfaces: ['/questions/3/a'], explanation: '' })),
    },
    localizationRequests: [],
  });
  const verification = (over = {}) => ({ decision: 'pass', coverage: slots(slot => ({ slot, result: 'adequate', explanation: '' })), issues: [], pins: [{ hotspotId: 'h1', targetMatches: 'yes', pointOnTarget: 'yes', explanation: '' }, { hotspotId: 'h3', targetMatches: 'yes', pointOnTarget: 'yes', explanation: '' }], replacement: null, ...over });
  const replacement = () => { const r = writerResult().draft; r.lesson.questions[0].a = 'Priam asks Achilles to return his son for burial.'; return r; };
  const work = { id: 'fx1', key: 'k', origin: 'synthetic', catalog: { title: 'Hydria with Priam' }, b1: { imageFitness: { ok: true, imageState: 'usable' }, playable: true, seen: 'a jar' }, b2: null, b3: null, image: { sha256: 'c'.repeat(64), ext: 'jpg' } };
  const gold = { sha256: C.FROZEN_GOLD_SHA256, text: 'gold' };
  const ok = s => ({ kind: 'ok', structured: s, usage: { outputTokens: 100, inputTokens: 5 }, wallMs: 10, transcriptSha256: 't' });
  const render = proj => ({ model: 'stub', whyShown: proj.entry.why, notesShown: [], questionsShown: [], cuesShown: [], dotSource: 'notes', dots: [], displayed: {}, losses: [] });
  return { C, packet, texts, writerResult, verification, replacement, work, gold, ok, render, sec };
}
// Drive one runWork. Every dispatch is recorded by seq, so `recover` can rebuild exactly what was dispatched.
async function drive(F, responses, state, extra = {}) {
  const { runWork } = await L('teaching-v2-controller.mjs');
  const calls = []; const q = [...responses];
  const invoke = extra.invoke || (async (stage, o = {}) => { calls.push(stage); const r = q.shift(); if (!r) throw new Error(`unexpected call ${stage}`); const out = typeof r === 'function' ? r() : r; if (extra.bySeq && o.seq != null) extra.bySeq.set(o.seq, out); return out; });
  const st = await runWork({ work: extra.work || F.work, packet: F.packet, texts: F.texts, gold: F.gold, state, render: F.render, ...extra, invoke });
  return { st, calls };
}

// ===================== R2-1: activity is inspected before every outcome branch =====================
test('R2-1 probe: an init-less WebFetch with a quota message or exit 1 is fatal, not usage-limit / transport-failure', async () => {
  const bad = ev({ type: 'assistant', message: { model: MODEL, content: [{ type: 'tool_use', id: 'bad', name: 'WebFetch', input: { url: 'https://example.org' } }] } });
  assert.equal((await classify([bad, ev({ type: 'result', is_error: true, result: 'usage limit reached' })].join('\n'), { exitCode: 1 })).kind, 'fatal');
  assert.equal((await classify(bad, { exitCode: 1 })).kind, 'fatal');
  const streamed = ev({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'tool_use', id: 'b', name: 'Bash', input: {} } } });
  assert.equal((await classify(streamed, { exitCode: 1 })).kind, 'fatal', 'a streamed forbidden block without init');
});
test('R2-1 probe: an init-less exhausted-structured-output result with exit 1 is never a transport failure', async () => {
  const r = await classify(ev({ type: 'result', subtype: 'error_max_structured_output_retries', is_error: true }), { exitCode: 1 });
  assert.notEqual(r.kind, 'transport-failure'); assert.notEqual(r.kind, 'usage-limit');
  assert.equal(r.kind, 'fatal', 'session activity without init: provenance unverifiable');
});
test('R2-1: only affirmative evidence of no session activity is a pre-session transient', async () => {
  assert.equal((await classify('', { exitCode: 1 })).kind, 'transport-failure', 'an empty stream from a failed process');
  assert.equal((await classify(ev({ type: 'result', is_error: true, num_turns: 0, result: 'Claude AI usage limit reached' }), { exitCode: 1 })).kind, 'usage-limit', 'an explicit zero-turn quota refusal');
  assert.equal((await classify(ev({ type: 'result', is_error: true, result: 'Claude AI usage limit reached' }), { exitCode: 1 })).kind, 'fatal', 'no turn count: not affirmative');
  assert.equal((await classify(ev({ type: 'result', is_error: true, num_turns: 0, usage: { server_tool_use: { web_search_requests: 1 } } }), { exitCode: 1 })).kind, 'fatal', 'server tool usage without init');
});

// ===================== R2-3: the phase-wide stop is derived from preserved evidence =====================
test('R2-3 probe: resuming the state a fatal call left (latch never written) throws the latch again', async () => {
  const F = await fixtures(); const { LatchStop } = await L('teaching-v2-controller.mjs');
  const state = {};
  await assert.rejects(drive(F, [{ kind: 'fatal', reason: 'forbidden WebFetch' }], state), LatchStop);
  assert.equal(state.status, 'hold');
  const reloaded = clone(state); let resumed = null;
  await assert.rejects((async () => { resumed = await drive(F, [], reloaded); })(), e => e instanceof LatchStop && e.latch === 'fatal');
  assert.equal(resumed, null);
});
test('R2-3: a saved unknown outcome also re-latches on resume instead of holding quietly', async () => {
  const F = await fixtures(); const { LatchStop, candidateBinding, bindingSha } = await L('teaching-v2-controller.mjs');
  const binding = candidateBinding({ work: F.work, packet: F.packet, texts: F.texts, gold: F.gold });
  const state = { ledger: [{ seq: 1, kind: 'W', reason: 'planned', outcome: 'unknown', detail: 'reservation without a recoverable transcript' }], artifacts: {}, binding, bindingSha256: bindingSha(binding) };
  await assert.rejects(drive(F, [], state), e => e instanceof LatchStop && e.latch === 'unknown-outcome');
});

// ---------- runner-level world: real teaching-v2-phase.mjs, injected executor, local files only ----------
async function phaseWorld() {
  const F = await fixtures();
  const C = F.C, { candidateBinding, bindingSha } = await L('teaching-v2-controller.mjs');
  const P = await L('teaching-v2-phase.mjs'), { writeLatch } = await L('teaching-v2-ops.mjs');
  const root = mkdtempSync(join(tmpdir(), 'tv2-r2-')), phaseDir = join(root, 'phase-a');
  const imgPath = join(root, IMG); writeFileSync(imgPath, 'image-bytes');
  const runtime = { version: RT, bin: '/fixture/claude' };
  const mkItem = (id, key) => { const work = { ...clone(F.work), id, key, image: { ...F.work.image, path: imgPath } }; return { id, work, packet: F.packet, texts: F.texts, binding: candidateBinding({ work, packet: F.packet, texts: F.texts, gold: F.gold }) }; };
  const stageOf = argv => { const s = argv[argv.indexOf('--json-schema') + 1]; return s === JSON.stringify(C.WRITER_RESULT_WIRE) ? 'W' : s === JSON.stringify(C.VERIFICATION_WIRE) ? 'V' : 'V2'; };
  const okStdout = (cwd, structured) => [
    ev({ type: 'system', subtype: 'init', apiKeySource: 'none', model: MODEL, claude_code_version: RT, cwd, tools: ['Read', 'StructuredOutput'], mcp_servers: [], permissionMode: 'dontAsk' }),
    ev({ type: 'assistant', message: { model: MODEL, content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: `${cwd}/${IMG}` } }] } }),
    ev({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'image' }] }] } }),
    ev({ type: 'assistant', message: { model: MODEL, content: [{ type: 'tool_use', id: 't9', name: 'StructuredOutput', input: structured }] } }),
    ev({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't9', content: 'ok' }] } }),
    ev({ type: 'result', subtype: 'success', is_error: false, structured_output: structured, usage: { input_tokens: 10, output_tokens: 20 }, modelUsage: { [MODEL]: { outputTokens: 20 } } }),
  ].join('\n');
  const fatalStdout = cwd => [ev({ type: 'system', subtype: 'init', apiKeySource: 'none', model: MODEL, claude_code_version: RT, cwd, tools: ['Read', 'StructuredOutput'], mcp_servers: [], permissionMode: 'dontAsk' }),
    ev({ type: 'assistant', message: { model: MODEL, content: [{ type: 'tool_use', id: 'w', name: 'WebFetch', input: { url: 'https://example.org' } }] } })].join('\n');
  // responses: 'fatal' | structured object, consumed in order; calls records each dispatched stage.
  const executor = responses => { const calls = [], q = [...responses]; return { calls, execute: async (bin, argv, opts) => { calls.push(stageOf(argv)); const r = q.shift(); if (r === undefined) throw new Error(`unexpected ${stageOf(argv)} call`); return { stdout: r === 'fatal' ? fatalStdout(opts.cwd) : okStdout(opts.cwd, r) }; } }; };
  const ops = (over = {}) => ({ allowance: { budgetId: 'teaching-v2-phase-a-test' }, gate: () => ({ go: true }), persist: () => true, record: () => null, latch: info => writeLatch(phaseDir, info), ...over });
  const base = { fixture: 'tv2-review2' };
  const identityOf = (items, parent = null) => P.runIdentity({ base, items, bindingSha, parent });
  const run = async ({ items, responses = [], opsOver = {}, parent = null, runId = null }) => {
    const identity = identityOf(items, parent?.runId ?? null), id = runId ?? P.runIdOf(identity), ex = executor(responses);
    const result = await P.runPhase({ phaseDir, runId: id, identity, items, gold: F.gold, ops: ops(opsOver), runtime, execute: ex.execute, renderFor: () => F.render, parent, log: () => {}, logError: process.env.TV2_DEBUG ? console.error : () => {} });
    return { result, calls: ex.calls, runId: id };
  };
  const stateOf = (runId, key) => JSON.parse(readFileSync(join(phaseDir, 'runs', runId, 'works', key, 'state.json'), 'utf8'));
  return { F, P, root, phaseDir, runtime, mkItem, run, stateOf, identityOf, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('R2-3 fatal latch: a crash between saving the fatal state and writing the latch cannot let the next work dispatch', async () => {
  const w = await phaseWorld();
  try {
    const A = w.mkItem('fxA', 'kA'), B = w.mkItem('fxB', 'kB'), items = [A, B];
    // The fatal W outcome and the hold are saved; the process dies before fatal.json is written.
    await assert.rejects(w.run({ items, responses: ['fatal'], opsOver: { latch: () => { throw new Error('simulated crash before the latch is written'); } } }), /simulated crash/);
    const id = w.P.runIdOf(w.identityOf(items));
    assert.equal(w.stateOf(id, 'kA').status, 'hold'); assert.ok(!existsSync(join(w.phaseDir, 'fatal.json')), 'the latch was never written');
    // Restart: the stop is DERIVED from the preserved fatal outcome before any dispatch, and the latch is re-cached.
    const again = await w.run({ items, responses: [w.F.writerResult(), w.F.verification()] });
    assert.ok(again.result.latched, 'restart did not latch'); assert.deepEqual(again.calls, [], 'the next work was dispatched after a fatal');
    assert.ok(existsSync(join(w.phaseDir, 'fatal.json')), 'the derived stop re-writes the latch cache');
  } finally { w.cleanup(); }
});
test('R2-3 fatal latch: after a failed latch persistence (latch file lost) restarts still refuse; only an owner clearance lifts it', async () => {
  const w = await phaseWorld();
  try {
    const A = w.mkItem('fxA', 'kA'), B = w.mkItem('fxB', 'kB'), items = [A, B];
    const first = await w.run({ items, responses: ['fatal'] }); // writeLatch's push fails (no evidence root) but the local file is written
    assert.deepEqual(first.calls, ['W']); assert.ok(existsSync(join(w.phaseDir, 'fatal.json')));
    unlinkSync(join(w.phaseDir, 'fatal.json')); // the latch never reached the shared evidence: a fresh checkout has none
    const again = await w.run({ items, responses: [w.F.writerResult(), w.F.verification()] });
    assert.ok(again.result.latched); assert.deepEqual(again.calls, []);
    unlinkSync(join(w.phaseDir, 'fatal.json')); // deleting the cache alone clears nothing
    assert.ok((await w.run({ items, responses: [] })).result.latched);
    // The owner's reviewed clearance of that exact attempt is the only way past it.
    const st = w.stateOf(first.runId, 'kA'), e = st.ledger.find(x => x.outcome === 'fatal');
    writeFileSync(join(w.phaseDir, 'latch-clearances.json'), JSON.stringify([{ runId: first.runId, workKey: 'kA', seq: e.seq, transcriptSha256: e.transcriptSha256, reviewedBy: 'owner', at: '2026-11-20', note: 'fixture' }]));
    const cleared = await w.run({ items, responses: [w.F.writerResult(), w.F.verification()] });
    assert.deepEqual(cleared.calls, ['W', 'V']); assert.equal(w.stateOf(first.runId, 'kA').status, 'hold'); assert.equal(w.stateOf(first.runId, 'kB').status, 'accepted-for-review');
  } finally { w.cleanup(); }
});

// ===================== R2-4: decisions, final draft and projection come from verified evidence =====================
test('R2-4 probe: a cached verifier outcome changed to pass is recomputed from the verified report (holds)', async () => {
  const F = await fixtures(); const bySeq = new Map();
  const badVerdict = F.verification(); badVerdict.coverage.find(c => c.slot === 'subjectAction').result = 'misleading';
  const state = {};
  await assert.rejects(drive(F, [F.ok(F.writerResult()), F.ok(badVerdict)], state, { bySeq, save: s => { if (s.artifacts.verify) throw new Error('stop after the verified outcome is saved'); } }));
  state.artifacts.verify.outcome = { decision: 'pass', reasons: [], minors: 0 };
  const { st } = await drive(F, [], state, { attempts: { recover: e => bySeq.get(e.seq) } });
  assert.equal(st.status, 'hold'); assert.notEqual(st.status, 'accepted-for-review');
});
test('R2-4 probe: a changed state.final on an accepted state is refused on resume, not accepted', async () => {
  const F = await fixtures(); const { EvidenceMismatch } = await L('teaching-v2-controller.mjs'); const bySeq = new Map();
  let altered = {}; await drive(F, [F.ok(F.writerResult()), F.ok(F.verification())], altered, { bySeq });
  altered = clone(altered); altered.final.draft.lesson.why = 'A different unverified lesson';
  await assert.rejects(drive(F, [], altered, { attempts: { recover: e => bySeq.get(e.seq) } }), e => e instanceof EvidenceMismatch && /final/.test(e.message));
  assert.equal(altered.final.draft.lesson.why, 'A different unverified lesson', 'the tampered state is preserved for review, not overwritten');
});
test('R2-4: resuming an accepted state re-opens and compares the immutable final payload', async () => {
  const F = await fixtures(); const bySeq = new Map(); let file = null; const opened = [];
  const finalize = (p, o = {}) => { opened.push(!!o.replay); if (!file) file = JSON.stringify(p); return JSON.parse(file); };
  const state = {}; await drive(F, [F.ok(F.writerResult()), F.ok(F.verification())], state, { bySeq, finalize });
  const resumed = clone(state);
  await drive(F, [], resumed, { attempts: { recover: e => bySeq.get(e.seq) }, finalize });
  assert.deepEqual(opened, [false, true], 'the final payload was not re-opened on resume');
  const p = JSON.parse(file); p.projection.entry.why = 'Changed on disk.'; file = JSON.stringify(p);
  await assert.rejects(drive(F, [], clone(state), { attempts: { recover: e => bySeq.get(e.seq) }, finalize }), /does not reproduce/);
});
test('R2-4: the runtime is bound into the candidate, and a frozen run runtime refuses a changed CLI', async () => {
  const F = await fixtures(); const { candidateBinding, bindingSha, BindingChanged } = await L('teaching-v2-controller.mjs');
  const at = v => candidateBinding({ work: F.work, packet: F.packet, texts: F.texts, gold: F.gold, runtime: { version: v, bin: '/x/claude' } });
  assert.notEqual(bindingSha(at('9.9.9')), bindingSha(at('9.9.10')), 'runtime is not part of the candidate binding');
  const state = {}; const { PauseRun } = await L('teaching-v2-controller.mjs');
  await assert.rejects(drive(F, [F.ok(F.writerResult()), { kind: 'usage-limit', reason: 'u' }], state, { binding: at('9.9.9') }), PauseRun);
  await assert.rejects(drive(F, [F.ok(F.verification())], state, { binding: at('9.9.10') }), e => e instanceof BindingChanged && /runtime/.test(e.message));
  const { freezeRuntime } = await L('teaching-v2-phase.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'tv2-rt-'));
  try {
    freezeRuntime(dir, { version: '9.9.9', bin: '/x/claude' });
    assert.deepEqual(freezeRuntime(dir, { version: '9.9.9', bin: '/x/claude' }), { version: '9.9.9', bin: '/x/claude' });
    assert.throws(() => freezeRuntime(dir, { version: '9.9.10', bin: '/x/claude' }), /runtime changed/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('R2-4: a recorded request receipt that differs from the effective request refuses reuse', async () => {
  const F = await fixtures(); const { PauseRun, EvidenceMismatch } = await L('teaching-v2-controller.mjs'); const bySeq = new Map();
  const state = {};
  await assert.rejects(drive(F, [F.ok(F.writerResult()), { kind: 'usage-limit', reason: 'u' }], state, { bySeq }), PauseRun);
  state.ledger[0].promptSha256 = '0'.repeat(64);
  await assert.rejects(drive(F, [F.ok(F.verification())], state, { attempts: { recover: e => bySeq.get(e.seq) } }), e => e instanceof EvidenceMismatch && /receipt/.test(e.message));
});
test('R2-4: on disk, a tampered reservation receipt (prompt bytes) refuses recovery', async () => {
  const w = await phaseWorld();
  try {
    const A = w.mkItem('fxA', 'kA');
    const first = await w.run({ items: [A], responses: [w.F.writerResult(), w.F.verification()] });
    assert.equal(w.stateOf(first.runId, 'kA').status, 'accepted-for-review');
    writeFileSync(join(w.phaseDir, 'runs', first.runId, 'works', 'kA', 'attempts', '01-W.prompt.txt'), 'a different prompt');
    const again = await w.run({ items: [A], responses: [] });
    assert.ok(again.result.stoppedAt, 'resume accepted a tampered receipt'); assert.deepEqual(again.calls, []);
  } finally { w.cleanup(); }
});

// ===================== R2-5: a dispatched attempt whose artifact is missing is rebuilt with no call =====================
for (const stage of ['W', 'V', 'V2']) {
  test(`R2-5 probe: a crash after the successful ${stage} outcome is saved (before its artifact) is rebuilt from the transcript`, async () => {
    const F = await fixtures(); const bySeq = new Map();
    const responses = stage === 'V2' ? [F.ok(F.writerResult()), F.ok(F.verification({ decision: 'revise', replacement: F.replacement() })), F.ok(F.verification())] : [F.ok(F.writerResult()), F.ok(F.verification())];
    const art = { W: 'writer', V: 'verify', V2: 'verify2' }[stage];
    const state = {};
    await assert.rejects(drive(F, responses, state, { bySeq, save: s => { const e = s.ledger.at(-1); if (e?.kind === stage && e.outcome === 'ok' && !s.artifacts[art]) throw new Error('simulated crash after outcome save'); } }), /simulated crash/);
    let recoverCalls = 0; const before = state.ledger.length;
    const rest = responses.slice(before);
    const { st, calls } = await drive(F, rest, state, { bySeq, attempts: { recover: e => { recoverCalls++; return bySeq.get(e.seq); } } });
    assert.ok(recoverCalls >= 1, 'the successful transcript was never opened');
    assert.ok(!calls.includes(stage), `${stage} was dispatched again`);
    assert.equal(st.status, 'accepted-for-review', `held: ${st.holdReasons?.[0]}`);
    assert.equal(st.ledger.length, responses.length, 'no extra attempt was spent');
  });
}

// ===================== R2-6: finalization is idempotent =====================
test('R2-6 probe: a failure after final-payload.json is written resumes to acceptance with no new call', async () => {
  const w = await phaseWorld(); const { PersistError } = await L('pass-b-remote-evidence.mjs');
  try {
    const A = w.mkItem('fxA', 'kA');
    const first = await w.run({ items: [A], responses: [w.F.writerResult(), w.F.verification()], opsOver: { persist: paths => { if (paths.some(p => p.endsWith('final-payload.json'))) throw new PersistError('simulated persistence failure after final file write'); return true; } } });
    assert.ok(first.result.stoppedAt); const fp = join(w.phaseDir, 'runs', first.runId, 'works', 'kA', 'final-payload.json');
    assert.ok(existsSync(fp)); assert.notEqual(w.stateOf(first.runId, 'kA').status, 'accepted-for-review');
    const pushed = [];
    const again = await w.run({ items: [A], responses: [], opsOver: { persist: paths => { pushed.push(...paths); return true; } } });
    assert.ok(again.result.completed, JSON.stringify(again.result)); assert.deepEqual(again.calls, []);
    assert.equal(w.stateOf(first.runId, 'kA').status, 'accepted-for-review'); assert.ok(pushed.includes(fp), 'persistence was not retried');
  } finally { w.cleanup(); }
});
test('R2-6: an existing final payload with different bytes is refused, never overwritten', async () => {
  const { makeFinalize, FinalPayloadConflict } = await L('teaching-v2-phase.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'tv2-fin-'));
  try {
    const payload = { version: 'teachingV2FinalPayload/1', workId: 'fx1', projection: { entry: { why: 'x' } } };
    let pushes = 0; const fin = makeFinalize({ wdir: dir, persist: () => { pushes++; } });
    assert.deepEqual(fin(payload), payload); assert.deepEqual(fin(payload), payload, 'a second identical finalize is idempotent'); assert.equal(pushes, 2);
    assert.throws(() => fin({ ...payload, projection: { entry: { why: 'y' } } }), FinalPayloadConflict);
    assert.equal(JSON.parse(readFileSync(join(dir, 'final-payload.json'), 'utf8')).projection.entry.why, 'x');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ===================== R2-7: the remaining-40 continuation binds the verified first-ten parent run =====================
test('R2-7: first-ten -> rest integration: the rest run binds its parent id and starts only after the parent verifies', async () => {
  const w = await phaseWorld();
  try {
    const first = [w.mkItem('fxA', 'kA')], rest = [w.mkItem('fxB', 'kB')];
    const parentIdentity = w.identityOf(first), parentId = w.P.runIdOf(parentIdentity);
    const parent = { runId: parentId, identity: parentIdentity, items: first };
    const restId = w.P.runIdOf(w.identityOf(rest, parentId));
    assert.notEqual(restId, parentId); assert.equal(w.identityOf(rest, parentId).parentRun, parentId, 'the parent id is part of the rest identity');
    await assert.rejects(w.run({ items: rest, parent, responses: [] }), /first-ten parent run|first ten/);
    const ten = await w.run({ items: first, responses: [w.F.writerResult(), w.F.verification()] });
    assert.equal(ten.runId, parentId); assert.equal(w.stateOf(parentId, 'kA').status, 'accepted-for-review');
    const forty = await w.run({ items: rest, parent, responses: [w.F.writerResult(), w.F.verification()] });
    assert.equal(forty.runId, restId); assert.deepEqual(forty.calls, ['W', 'V']); assert.equal(w.stateOf(restId, 'kB').status, 'accepted-for-review');
    // A parent whose stored conclusion no longer reproduces from its evidence blocks the continuation.
    const sp = join(w.phaseDir, 'runs', parentId, 'works', 'kA', 'state.json'), s = JSON.parse(readFileSync(sp, 'utf8'));
    s.final.draft.lesson.why = 'Tampered.'; writeFileSync(sp, JSON.stringify(s));
    await assert.rejects(w.run({ items: rest, parent, responses: [] }), /verified/);
  } finally { w.cleanup(); }
});

let pass = 0; const failed = [];
for (const [name, fn] of tests) {
  try { await fn(); pass++; console.log(`ok   ${name}`); }
  catch (e) { failed.push(name); console.error(`FAIL ${name}\n     ${String(e.message).split('\n')[0].slice(0, 300)}`); }
}
console.log(`teaching-v2-review2.test: ${pass}/${tests.length} checks passed`);
if (failed.length) process.exit(1);
