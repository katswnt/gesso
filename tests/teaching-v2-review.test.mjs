// Teaching-v2 Phase A: regressions for the Codex code review of 0bbddb2 (2026-11-20). Each check reproduces a
// review finding (1, 2, 3, 4, 5, 7, 9, 10, 15, 17 and the 11/16 refusal) and fails on 0bbddb2. Modules are imported
// lazily inside each check, so on the old code a missing export fails that check only and the rest still run.
// No model calls, no network (git fixtures are local bare repos), no data/incoming dependency.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

process.env.PASS_B_PUSH_BACKOFF_MS ??= '0,0,0';
const L = p => import(new URL(`../scripts/lib/${p}`, import.meta.url));
const clone = v => JSON.parse(JSON.stringify(v));
const sha = b => createHash('sha256').update(b).digest('hex');
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---------- shared fixtures (built lazily from the modules under test) ----------
const MODEL = 'claude-sonnet-5-5', RT = '9.9.9', IMG = `${'c'.repeat(64)}.jpg`, DIR = '/tmp/tv2-call-fixture';
const ev = e => JSON.stringify(e);
function transcript({ init = {}, readPath = `${DIR}/${IMG}`, extra = [], result = {} } = {}) {
  return [
    ev({ type: 'system', subtype: 'init', apiKeySource: 'none', model: MODEL, claude_code_version: RT, cwd: DIR, tools: ['Read', 'StructuredOutput'], mcp_servers: [], permissionMode: 'dontAsk', ...init }),
    ev({ type: 'assistant', message: { model: MODEL, content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: readPath } }] } }),
    ev({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'image' }] }] } }),
    ...extra.map(ev),
    ev({ type: 'assistant', message: { model: MODEL, content: [{ type: 'tool_use', id: 't9', name: 'StructuredOutput', input: { ok: 1 } }] } }),
    ev({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't9', content: 'ok' }] } }),
    ev({ type: 'result', subtype: 'success', is_error: false, structured_output: { ok: 1 }, usage: { input_tokens: 10, output_tokens: 20 }, modelUsage: { [MODEL]: { outputTokens: 20 } }, ...result }),
  ].join('\n');
}
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
  const work = { id: 'fx1', key: 'k', catalog: { title: 'Hydria with Priam' }, b1: { imageFitness: { ok: true, imageState: 'usable' }, playable: true, seen: 'a jar' }, b2: null, b3: null, image: { sha256: 'c'.repeat(64), ext: 'jpg' } };
  const gold = { sha256: C.FROZEN_GOLD_SHA256, text: 'gold' };
  const ok = s => ({ kind: 'ok', structured: s, usage: { outputTokens: 100, inputTokens: 5 }, wallMs: 10, transcriptSha256: 't' });
  const render = proj => ({ model: 'stub', whyShown: proj.entry.why, notesShown: [], questionsShown: [], cuesShown: [], dotSource: 'notes', dots: [], displayed: {}, losses: [] });
  return { C, packet, texts, writerResult, verification, work, gold, ok, render, sec };
}
// Drive one runWork with a response queue; gate/attempts/finalize optional. Returns dispatched stage list.
async function drive(F, responses, state, extra = {}) {
  const { runWork } = await L('teaching-v2-controller.mjs');
  const calls = []; const q = [...responses];
  const invoke = extra.invoke || (async stage => { calls.push(stage); const r = q.shift(); if (!r) throw new Error(`unexpected call ${stage}`); return typeof r === 'function' ? r() : r; });
  const st = await runWork({ work: extra.work || F.work, packet: F.packet, texts: F.texts, gold: F.gold, state, invoke, render: F.render, ...extra, invoke });
  return { st, calls };
}

// ===================== finding 1: capability policy before outcome classification =====================
test('F1 review repro: API-key init + /etc/passwd Read + WebFetch + "usage limit reached" is fatal, not usage-limit', async () => {
  const s = transcript({ init: { apiKeySource: 'ANTHROPIC_API_KEY' }, readPath: '/etc/passwd', extra: [{ type: 'assistant', message: { model: MODEL, content: [{ type: 'tool_use', id: 't2', name: 'WebFetch', input: {} }] } }],
    result: { subtype: 'error_during_execution', is_error: true, result: 'Claude AI usage limit reached', structured_output: null } });
  assert.equal((await classify(s)).kind, 'fatal');
});
test('F1 review repro: a successful transcript whose init advertises Bash and WebFetch is fatal', async () => {
  assert.equal((await classify(transcript({ init: { tools: ['Read', 'StructuredOutput', 'Bash', 'WebFetch'] } }))).kind, 'fatal');
});
test('F1: server_tool_use blocks and server tool usage counters are fatal', async () => {
  assert.equal((await classify(transcript({ extra: [{ type: 'assistant', message: { model: MODEL, content: [{ type: 'server_tool_use', id: 's1', name: 'web_search', input: {} }] } }] }))).kind, 'fatal');
  assert.equal((await classify(transcript({ result: { usage: { input_tokens: 1, output_tokens: 1, server_tool_use: { web_fetch_requests: 1 } } } }))).kind, 'fatal');
});
test('F1: an unpinned CLI runtime in init is fatal; the pinned one with an exact image receipt is ok', async () => {
  assert.equal((await classify(transcript({ init: { claude_code_version: '1.0.0' } }))).kind, 'fatal');
  assert.equal((await classify(transcript())).kind, 'ok');
});

// ===================== finding 2: shared lease, ledger, pacer and a persistent latch =====================
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
function evidenceWorld() {
  const root = mkdtempSync(join(tmpdir(), 'tv2-ev-')), bare = join(root, 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'claude/pass-b-state', bare]);
  const cl = name => { const d = join(root, name); execFileSync('git', ['clone', '-q', bare, d], { stdio: 'ignore' }); git(d, 'config', 'user.email', 't@t'); git(d, 'config', 'user.name', 't'); try { git(d, 'checkout', '-q', '-b', 'claude/pass-b-state'); } catch { git(d, 'checkout', '-q', 'claude/pass-b-state'); } return d; };
  const a = cl('a'); writeFileSync(join(a, 'README.md'), 'x'); git(a, 'add', '.'); git(a, 'commit', '-q', '-m', 'init'); git(a, 'push', '-q', '-u', 'origin', 'claude/pass-b-state');
  return { root, a, clone: cl };
}
const phaseEnv = (root, holder, extra = {}) => ({ PASS_B_REMOTE_EVIDENCE: root, PASS_B_LEASE_HOLDER: holder, PASS_B_CALL_BUDGET_ID: 'teaching-v2-phase-a-first10', PASS_B_MAX_CALLS: '27', ...extra });
const opsArgs = (root, env) => ({ env, phaseDir: join(root, 'incoming', 'teaching-v2', 'phase-a'), runDir: join(root, 'incoming', 'teaching-v2', 'phase-a', 'runs', 'tv2a-test'), runId: 'tv2a-test', maxCallsForPhase: 27, usageLog: join(root, 'incoming', 'vision-ops', 'usage-observations.jsonl') });
test('F2: Phase A paces from the SAME usage-observation ledger as the corpus collector', async () => {
  const { SHARED_USAGE_LOG } = await L('teaching-v2-stage.mjs');
  const { USAGE_LOG } = await import(new URL('../scripts/pass-b-corpus-collect.mjs', import.meta.url));
  assert.equal(SHARED_USAGE_LOG, USAGE_LOG);
});
test('F2: Phase A refuses while the cloud routine holds the shared lease, and the routine cannot take a Phase A lease', async () => {
  const { openPhaseAOperations } = await L('teaching-v2-ops.mjs');
  const { acquireLease, releaseLease, LeaseBusyError } = await L('pass-b-remote-evidence.mjs');
  const w = evidenceWorld();
  try {
    acquireLease(w.a, 'routine-20261120T000000Z-1');
    assert.throws(() => openPhaseAOperations(opsArgs(w.a, phaseEnv(w.a, 'laptop-teaching-v2-1'))), LeaseBusyError);
    assert.ok(!existsSync(join(w.a, 'incoming', 'teaching-v2', 'phase-a', 'runs', 'tv2a-test', 'allowance.json')), 'nothing bound or reserved under a foreign lease');
    releaseLease(w.a, 'routine-20261120T000000Z-1');
    acquireLease(w.a, 'laptop-teaching-v2-1');
    const ops = openPhaseAOperations(opsArgs(w.a, phaseEnv(w.a, 'laptop-teaching-v2-1')));
    assert.equal(ops.gate().go, true, 'the shared pacer grants a probe allowance');
    const b = w.clone('b');
    assert.throws(() => acquireLease(b, 'routine-20261121T000000Z-2', { now: new Date(Date.now() + 24 * 3600e3) }), LeaseBusyError, 'routine recovered a Phase A lease as stale');
    assert.throws(() => openPhaseAOperations(opsArgs(w.a, phaseEnv(w.a, 'laptop-teaching-v2-1', { PASS_B_MAX_CALLS: '20' }))), /allowance binding changed/);
  } finally { rmSync(w.root, { recursive: true, force: true }); }
});
test('F2: Phase A never holds the lease under an automation name', async () => {
  const { openPhaseAOperations } = await L('teaching-v2-ops.mjs');
  const { acquireLease } = await L('pass-b-remote-evidence.mjs');
  const w = evidenceWorld();
  try { acquireLease(w.a, 'routine-x'); assert.throws(() => openPhaseAOperations(opsArgs(w.a, phaseEnv(w.a, 'routine-x'))), /non-automation/); }
  finally { rmSync(w.root, { recursive: true, force: true }); }
});
test('F2: a fatal latches the whole phase: later gates and restarts refuse, on any work', async () => {
  const { openPhaseAOperations } = await L('teaching-v2-ops.mjs');
  const { acquireLease } = await L('pass-b-remote-evidence.mjs');
  const { LatchStop } = await L('teaching-v2-controller.mjs');
  const F = await fixtures();
  await assert.rejects(drive(F, [{ kind: 'fatal', reason: 'forbidden tool activity: tool_use:WebFetch' }], {}), e => e instanceof LatchStop && e.latch === 'fatal');
  const w = evidenceWorld();
  try {
    acquireLease(w.a, 'laptop-teaching-v2-1');
    const ops = openPhaseAOperations(opsArgs(w.a, phaseEnv(w.a, 'laptop-teaching-v2-1')));
    ops.latch({ kind: 'fatal', reason: 'fixture fatal', workId: 'fx1' });
    assert.throws(() => ops.gate(), /latch/);
    assert.throws(() => openPhaseAOperations(opsArgs(w.a, phaseEnv(w.a, 'laptop-teaching-v2-1'))), /latch/);
  } finally { rmSync(w.root, { recursive: true, force: true }); }
});

// ===================== finding 3: attempt state machine =====================
test('F3 review repro: W ok, pacing blocks V, resumed V revises -> V2 still allowed (the unmade V spent nothing)', async () => {
  const F = await fixtures(); const { PauseRun } = await L('teaching-v2-controller.mjs');
  const rep = clone(F.writerResult().draft); rep.lesson.questions[0].a = 'Priam asks Achilles to return his son for burial.';
  let blocked = false; const dispatched = [];
  const gate = async kind => { if (kind === 'V' && !blocked) { blocked = true; throw new PauseRun('pacing: weekly ahead of pace'); } };
  const q = [F.ok(F.writerResult()), F.ok(F.verification({ decision: 'revise', replacement: rep })), F.ok(F.verification())];
  // An implementation without a pre-reservation gate paced inside the dispatch; emulate that refusal there too.
  const invoke = async kind => { if (kind === 'V' && !blocked) { blocked = true; throw new PauseRun('pacing: weekly ahead of pace'); } dispatched.push(kind); return q.shift(); };
  const state = {};
  await assert.rejects(drive(F, [], state, { gate, invoke }), PauseRun);
  const { st } = await drive(F, [], state, { gate, invoke });
  assert.deepEqual(dispatched, ['W', 'V', 'V2']); assert.equal(st.status, 'accepted-for-review');
});
test('F3 review repro: usage-limit attempts are counted, so repeated rejections can never exceed five dispatches', async () => {
  const F = await fixtures(); const { PauseRun, telemetry } = await L('teaching-v2-controller.mjs');
  const state = {}; let dispatched = 0;
  const invoke = async () => { dispatched++; return { kind: 'usage-limit', reason: 'usage limit', usage: null }; };
  for (let i = 0; i < 8 && state.status !== 'hold'; i++) { try { await drive(F, [], state, { invoke }); } catch (e) { if (!(e instanceof PauseRun)) throw e; } }
  assert.ok(dispatched <= 2, `dispatched ${dispatched}: one planned W plus at most one transient retry`);
  assert.equal(state.status, 'hold'); assert.equal(telemetry(state).calls, dispatched, 'telemetry reads the same history as the budget');
});
test('F3: exhausted structured-output retries are a content failure, never a transport retry', async () => {
  const s = transcript({ result: { subtype: 'error_max_structured_output_retries', is_error: true, structured_output: null } });
  assert.equal((await classify(s)).kind, 'content-failure');
  const F = await fixtures();
  const { st, calls } = await drive(F, [{ kind: 'content-failure', reason: 'result error_max_structured_output_retries' }], {});
  assert.deepEqual(calls, ['W']); assert.equal(st.status, 'hold');
});

// ===================== finding 4: immutable bindings and reconstruction =====================
test('F4 review repro: changing the image SHA after W refuses reuse instead of accepting under the new binding', async () => {
  const F = await fixtures(); const { PauseRun } = await L('teaching-v2-controller.mjs');
  const state = {};
  await assert.rejects(drive(F, [F.ok(F.writerResult()), { kind: 'usage-limit', reason: 'usage limit' }], state), PauseRun);
  const moved = { ...F.work, image: { ...F.work.image, sha256: 'd'.repeat(64) } };
  let threw = null; try { await drive(F, [{ kind: 'transport-failure', reason: 'x' }, F.ok(F.verification())], state, { work: moved }); } catch (e) { threw = e; }
  assert.notEqual(state.status, 'accepted-for-review'); assert.ok(threw && /binding|changed/i.test(threw.message), `expected a binding refusal, got ${threw?.message}`);
});
test('F4: the packet hash is recomputed, never trusted', async () => {
  const F = await fixtures();
  const t = clone(F.packet); t.sources[0].kind = 'scholarly';
  assert.ok(!F.C.validatePacketIntegrity(t, F.texts).ok);
});
test('F4: a terminal state with a changed binding is refused, not silently skipped', async () => {
  const F = await fixtures(); const state = {};
  await drive(F, [F.ok(F.writerResult()), F.ok(F.verification())], state);
  assert.equal(state.status, 'accepted-for-review');
  const moved = { ...F.work, catalog: { title: 'Another jar' } };
  await assert.rejects(drive(F, [], state, { work: moved }), /binding|changed/i);
});
test('F4: a stored writer result must reproduce from its transcript before reuse', async () => {
  const F = await fixtures(); const { PauseRun } = await L('teaching-v2-controller.mjs');
  const state = {};
  await assert.rejects(drive(F, [F.ok(F.writerResult()), { kind: 'usage-limit', reason: 'u' }], state), PauseRun);
  const other = F.writerResult(); other.draft.lesson.questions[0].a = 'A different answer than the one stored.';
  await assert.rejects(drive(F, [F.ok(F.verification())], state, { attempts: { recover: e => e.kind === 'W' ? F.ok(other) : { kind: 'usage-limit', reason: 'u' } } }), /reproduce/);
});
test('F4: acceptance re-reads the immutable final payload; a mismatch holds', async () => {
  const F = await fixtures();
  const { st } = await drive(F, [F.ok(F.writerResult()), F.ok(F.verification())], {}, { finalize: p => ({ ...clone(p), projectionSha256: 'tampered' }) });
  assert.equal(st.status, 'hold');
});

// ===================== finding 5: imported-stage provenance =====================
async function cal50World() {
  const { captureStageCompletion } = await L('vision-content-capture.mjs');
  const cal = await L('pass-b-calibration.mjs'); const { promptHashes, stagePrompts } = await L('pass-b-prompts.mjs');
  const { workKey, CAL50_RUN, CAL50_IMGS } = await L('teaching-v2-inputs.mjs');
  // The calibration run's exact B1 effective prompt (pass-b-calibration.mjs runWorkStages), written out here.
  const b1Prompt = imageFile => `${stagePrompts().B1}\n\nThe working directory contains exactly one image file: ./${imageFile}\nCall the Read tool on ./${imageFile} to view the artwork, then inventory ONLY what you actually see. If Read fails or returns no image, set imageFitness.ok=false and do not invent content.`;
  const root = mkdtempSync(join(tmpdir(), 'tv2-cal-'));
  mkdirSync(join(root, CAL50_RUN, 'works'), { recursive: true }); mkdirSync(join(root, CAL50_IMGS), { recursive: true });
  writeFileSync(join(root, CAL50_RUN, 'run-manifest.json'), JSON.stringify({ model: cal.CALIBRATION_MODEL, imageTransportVersion: cal.IMAGE_TRANSPORT_VERSION, brokerPolicyVersion: 'img-broker/1', promptHashes: promptHashes() }));
  const B1 = cal.syntheticFixture().bodies.B1;
  const addWork = (id, { b1For = id } = {}) => {
    const bytes = Buffer.from(`image-${id}`), imgSha = sha(bytes); writeFileSync(join(root, CAL50_IMGS, `${imgSha}.jpg`), bytes);
    const wd = join(root, CAL50_RUN, 'works', workKey(id)); mkdirSync(join(wd, 'attempts'), { recursive: true });
    const image = { imgSha256: imgSha, ext: 'jpg', width: 10, height: 10 };
    writeFileSync(join(wd, 'b0-prep.json'), JSON.stringify({ work: { id }, trustedCatalog: { title: id }, legacy: null, image }));
    const tr = [ev({ type: 'system', subtype: 'init', apiKeySource: 'none', model: cal.CALIBRATION_MODEL }), ev({ type: 'assistant', message: { model: cal.CALIBRATION_MODEL, content: [{ type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: `/tmp/passb-call-x/${imgSha}.jpg` } }] } }),
      ev({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'r1', content: [{ type: 'image' }] }] } }), ev({ type: 'result', subtype: 'success', is_error: false, structured_output: B1, modelUsage: { [cal.CALIBRATION_MODEL]: { outputTokens: 5 } } })].join('\n');
    writeFileSync(join(wd, 'attempts', `b1-${sha(tr).slice(0, 12)}.transcript.jsonl`), tr);
    captureStageCompletion({ runDir: wd, stage: 'B1', rawResponse: JSON.stringify(B1), createdAt: '2026-09-04T00:00:00Z', producer: cal.producerEvidence('B1', { model: cal.CALIBRATION_MODEL, runtimeVersion: 'unknown' }),
      trusted: { workId: b1For, imgSha256: imgSha, promptHash: sha(b1Prompt(`${imgSha}.jpg`)), brokerPolicyVersion: 'img-broker/1', imageTransportVersion: cal.IMAGE_TRANSPORT_VERSION, transcriptSha256: sha(tr) } });
    return wd;
  };
  return { root, addWork };
}
test('F5 review repro: a self-consistent B1 completion belonging to another work is rejected', async () => {
  const { loadCalibrationWork } = await L('teaching-v2-inputs.mjs');
  const w = await cal50World();
  try {
    w.addWork('workA', { b1For: 'workX' }); // a valid, hash-consistent completion for workX sitting in workA's folder
    assert.throws(() => loadCalibrationWork('workA', { evidenceRoot: w.root }));
  } finally { rmSync(w.root, { recursive: true, force: true }); }
});
test('F5: a correctly bound historical stage verifies with the shared verifiers and keeps its Sonnet 4.6 provenance', async () => {
  const { loadCalibrationWork } = await L('teaching-v2-inputs.mjs');
  const w = await cal50World();
  try {
    w.addWork('workB');
    const work = loadCalibrationWork('workB', { evidenceRoot: w.root });
    assert.equal(work.receipts.B1.producerModel, 'claude-sonnet-4-6'); assert.match(work.receipts.B1.verifiedWith, /verifyCapturedStage/);
  } finally { rmSync(w.root, { recursive: true, force: true }); }
});
test('F5: playable:false and unplayable image states hold before W; body-only regression imports hold too', async () => {
  const F = await fixtures(); const { preflight } = await L('teaching-v2-controller.mjs');
  const w1 = clone(F.work); w1.b1.playable = false;
  const w2 = clone(F.work); w2.b1.imageFitness.imageState = 'unplayable';
  assert.ok(!preflight({ work: w1, packet: F.packet, texts: F.texts }).ok);
  assert.ok(!preflight({ work: w2, packet: F.packet, texts: F.texts }).ok);
  const { loadRegressionWork } = await L('teaching-v2-inputs.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'tv2-reg-'));
  try {
    writeFileSync(join(dir, 'b1.json'), JSON.stringify(F.work.b1)); writeFileSync(join(dir, 'image.jpg'), 'img'); writeFileSync(join(dir, 'catalog.json'), JSON.stringify({ id: 'r1', title: 'R' }));
    writeFileSync(join(dir, 'import-receipt.json'), JSON.stringify({ id: 'r1', files: ['b1.json', 'image.jpg', 'catalog.json'].map(f => ({ f, sha256: sha(readFileSync(join(dir, f))) })) }));
    const reg = loadRegressionWork(dir, { id: 'r1', label: 'research-audit-01' });
    assert.ok(!preflight({ work: reg, packet: F.packet, texts: F.texts }).ok, 'body-only import ran W');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ===================== finding 7: no substantive line deleted by a word-count rule =====================
test('F7 review repro: "Attribution remains uncertain." survives next to the attribution it qualifies', async () => {
  const { assemblePacket } = await L('teaching-v2-capture.mjs');
  const html = '<html><body><nav>Home Shop</nav><p>The painting is currently attributed to a famous local artist.</p><p>Attribution remains uncertain.</p><p>Menu</p></body></html>';
  const snap = { meta: { contentType: 'text/html', status: 200, rawSha256: 'r'.repeat(64), retrievedAt: 'x', finalUrl: 'https://m.example.org/a', bytes: html.length, chain: [] }, raw: Buffer.from(html) };
  const { packet } = assemblePacket({ workId: 'w', catalogId: 'w', vetted: [{ url: 'https://m.example.org/a', kind: 'holdingInstitution', relationshipToWork: 'thisObject', objectIds: [] }], snapshots: { 'https://m.example.org/a': snap } });
  const text = packet.sources[0].sections.map(s => s.text).join('\n');
  assert.match(text, /currently attributed to a famous local artist\.\nAttribution remains uncertain\./);
  assert.deepEqual(packet.sources[0].extractionOmissions.map(o => o.text), ['Menu'], 'every removed line is recorded');
});

// ===================== finding 9: redirect and error bodies are destroyed, not drained =====================
function spyNet({ status, headers }) {
  const seen = { resumed: 0, destroyed: 0, chunksAfterDone: 0 };
  const resolve = (h, o, cb) => cb(null, [{ address: '93.184.216.34', family: 4 }]);
  const request = (opts, onRes) => {
    const req = new EventEmitter(); req.destroy = () => { seen.destroyed++; };
    req.end = () => setImmediate(() => {
      const res = new EventEmitter(); Object.assign(res, { statusCode: status(opts), headers: headers(opts), socket: { remoteAddress: '93.184.216.34' }, resume() { seen.resumed++; }, destroy() { seen.destroyed++; } });
      onRes(res);
    });
    return req;
  };
  return { seen, resolve, request };
}
test('F9 review repro: an endless redirect body and an error body are destroyed at once (never resumed/drained)', async () => {
  const { createSourceCapture } = await L('teaching-v2-capture.mjs');
  const r = spyNet({ status: o => (o.path === '/a' ? 302 : 500), headers: o => (o.path === '/a' ? { location: 'https://museum.example.org/b' } : {}) });
  const out = await createSourceCapture({ resolve: r.resolve, request: r.request }).captureUrl('https://museum.example.org/a', { limits: { maxBytes: 1000, timeoutMs: 2000, maxRedirects: 4 } });
  assert.equal(out.error, 'http 500');
  assert.equal(r.seen.resumed, 0, 'a redirect/error body was resumed outside the byte cap and deadline');
  assert.ok(r.seen.destroyed >= 2, 'both unwanted responses destroyed');
});

// ===================== finding 10: self-contradicting verifier reports =====================
test('F10 review repro: a pass reporting subjectAction "misleading" (central subject wrong) holds', async () => {
  const F = await fixtures(); const wr = F.writerResult();
  const v = F.verification(); v.coverage.find(c => c.slot === 'subjectAction').result = 'misleading'; v.coverage.find(c => c.slot === 'subjectAction').explanation = 'The central subject is wrong.';
  assert.equal(F.C.verificationOutcome(v, { draft: wr.draft, allowReplacement: true, packet: F.packet, dossier: wr.dossier }).decision, 'hold');
});
test('F10 review repro: verifier issue source refs must resolve ("BOGUS#BAD" is rejected)', async () => {
  const F = await fixtures(); const wr = F.writerResult();
  const v = F.verification({ issues: [{ surface: '/why', severity: 'minor', category: 'voice', explanation: 'x', sourceRefs: ['BOGUS#BAD'], observation: '' }] });
  assert.equal(F.C.verificationOutcome(v, { draft: wr.draft, allowReplacement: true, packet: F.packet, dossier: wr.dossier }).decision, 'hold');
});
test('F10: required slots cannot be judged notApplicable; dossier essentials need meaningful answer/limitation', async () => {
  const F = await fixtures(); const wr = F.writerResult();
  const v = F.verification(); v.coverage.find(c => c.slot === 'functionContext').result = 'notApplicable';
  assert.equal(F.C.verificationOutcome(v, { draft: wr.draft, allowReplacement: true, packet: F.packet, dossier: wr.dossier }).decision, 'hold');
  const d1 = clone(wr.dossier); d1.essentials.find(e => e.slot === 'subjectAction').answer = '';
  assert.ok(!F.C.validateDossier(d1, { packet: F.packet }).ok, 'supported essential with no answer');
  const d2 = clone(wr.dossier); Object.assign(d2.essentials.find(e => e.slot === 'functionContext'), { status: 'unknown', sourceRefs: [], limitation: '' });
  assert.ok(!F.C.validateDossier(d2, { packet: F.packet }).ok, 'unknown essential with no stated limitation');
});

// ===================== finding 15: the current renderer is index.html itself =====================
test('F15 review repro: real index.html declutter moves (50,50),(51,50) to (46.5,50),(54.5,50) on a 300x300 plate', async () => {
  const { loadCurrentRenderer } = await L('teaching-v2-current-render.mjs');
  const R = loadCurrentRenderer();
  const entry = { why: 'One sentence about the jar.', cues: [], notes: [{ head: 'a', body: 'b', x: 50, y: 50 }, { head: 'c', body: 'd', x: 51, y: 50 }], guide: [{ q: 'q1?', a: 'a' }, { q: 'q2?', a: 'a' }, { q: 'q3?', a: 'a' }, { q: 'q4?', a: 'a' }] };
  const cur = R.render({ workId: 'harvard216218', entry, hotspotEntry: [{ n: 1, x: 50, y: 50 }, { n: 2, x: 51, y: 50 }], imageSize: { width: 300, height: 300 }, viewports: [{ name: 'small', plateWidth: 300 }] });
  assert.deepEqual(cur.displayed.small.dots.map(d => [d.x, d.y]), [[46.5, 50], [54.5, 50]]);
  assert.ok(cur.losses.some(l => /declutter moves/.test(l)));
  const { renderManifest, projectLesson } = await L('teaching-v2-projection.mjs');
  const m = renderManifest({ entry, hotspotEntry: [] }, { current: cur });
  assert.deepEqual(m.currentRenderer.displayedAfterDeclutter.small.dots.map(d => d.x), [46.5, 54.5], 'V sees the displayed coordinates');
  void projectLesson;
});
test('F15: a held work previews the frozen legacy copy, not "No candidate lesson"', async () => {
  const { loadCurrentRenderer } = await L('teaching-v2-current-render.mjs');
  const { renderPreviewPage } = await L('teaching-v2-projection.mjs');
  const legacy = { why: 'The frozen legacy why stays live on a hold. More text.', cues: [], notes: [{ head: 'Legacy note', body: 'Old body.', x: 40, y: 40 }, { head: 'Legacy two', body: 'Old body two.', x: 60, y: 60 }], guide: [{ q: 'Legacy question?', a: 'Old answer.' }] };
  const cur = loadCurrentRenderer().render({ workId: 'harvard216218', entry: legacy, imageSize: { width: 300, height: 300 } });
  const page = renderPreviewPage({ kind: 'current', works: [{ id: 'harvard216218', title: 'T', imageRel: 'img/x.jpg', status: 'hold', projection: null, current: cur, shown: 'frozen legacy', entry: legacy }] });
  assert.doesNotMatch(page, /No candidate lesson/); assert.match(page, /Frozen legacy/); assert.match(page, /The frozen legacy why stays live on a hold\./); assert.match(page, /Legacy note/);
});

// ===================== finding 17: separate denominators, renamed metric, guide amendment =====================
test('F17: all-50, gold-contaminated and non-gold results are reported separately; the 35/50 wording is kept', async () => {
  const { denominators } = await L('teaching-v2-report.mjs');
  const flags = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`w${i}`, { goldOverlap: i < 4 }]));
  const rows = Object.keys(flags).map((id, i) => ({ id, status: i % 2 ? 'hold' : 'accepted-for-review', calls: 2 }));
  const d = denominators(rows, flags);
  assert.equal(d.allOperational.works, 50); assert.equal(d.goldContaminated.works, 4); assert.equal(d.nonGold.works, 46);
  assert.match(d.feasibilityGate.wording, /35\/50/); assert.equal(d.feasibilityGate.denominatorAsWritten, 50); assert.match(d.feasibilityGate.reportedAlongside, /46 of the 50/);
});
test('F17: the lexical metric is renamed keyword hits and never reported as slot coverage', async () => {
  const cap = await L('teaching-v2-capture.mjs');
  assert.equal(typeof cap.lexicalKeywordHits, 'function'); assert.equal(cap.lexicalSlotCandidates, undefined);
  const cov = JSON.parse(readFileSync(new URL('../tasks/teaching-v2-phase-a/packet-coverage.json', import.meta.url), 'utf8'));
  assert.ok(cov.calibration.all50 && cov.calibration.goldContaminated && cov.calibration.nonGold);
  assert.equal(cov.calibration.all50.works, 50); assert.equal(cov.calibration.nonGold.works, 46);
  assert.ok(!JSON.stringify(cov).includes('SourceSlots'), 'old "allFourSourceSlots" coverage wording');
});
test('F17: the teaching guide carries the teaching-v2 rules (no-dot notes, 4-7 questions) and keeps the old B4 rules', async () => {
  const g = readFileSync(new URL('../docs/teaching-copy-guide.md', import.meta.url), 'utf8');
  const sec = g.split(/^## Teaching-v2 path/m)[1] || '';
  assert.ok(sec, 'no teaching-v2 section'); assert.match(sec, /no dot/i); assert.match(sec, /4[–-]7 questions/);
  assert.match(g, /The strongest 5–7\. Answers of 2–4 sentences/); assert.match(g, /There is no separate list of unpinned notes\./);
});

// ===================== findings 11 and 16: the pin diagnostic refuses to spend calls =====================
test('F11/F16: the pin diagnostic refuses --live with a clear message (and makes no state)', async () => {
  const out = mkdtempSync(join(tmpdir(), 'tv2-pin-'));
  try {
    const r = spawnSync(process.execPath, ['scripts/teaching-v2-pin-diagnostic.mjs', '--run', 'tv2a-none', '--live', '--out', out], { env: { ...process.env, TEACHING_V2_LIVE: '1', CI: '' }, encoding: 'utf8' });
    assert.equal(r.status, 2); assert.match(r.stderr, /REFUSED.*findings 11 and 16/);
    assert.ok(!existsSync(join(out, 'phase-a')), 'the refused run wrote state');
  } finally { rmSync(out, { recursive: true, force: true }); }
});

let pass = 0; const failed = [];
for (const [name, fn] of tests) {
  try { await fn(); pass++; console.log(`ok   ${name}`); }
  catch (e) { failed.push(name); console.error(`FAIL ${name}\n     ${String(e.message).split('\n')[0].slice(0, 300)}`); }
}
console.log(`teaching-v2-review.test: ${pass}/${tests.length} checks passed`);
if (failed.length) process.exit(1);
