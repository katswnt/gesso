// Teaching-v2 Phase A: regressions for Codex's round-2 code review of 7827c97 (2026-11-20), R2-1 and R2-3..R2-7.
// Each check replays Codex's probe (codex-codereview/round2/probes/phase-a/review2-probes.mjs) as its reproduction
// and fails on 7827c97. Modules are imported lazily inside each check, so on the old code a missing export fails
// that check only and the rest still run. The runner-level checks drive scripts/lib/teaching-v2-phase.mjs end to
// end with an INJECTED executor that returns synthetic transcripts: no model call, no network, no git.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { L, clone, MODEL, ev, classify, fixtures, drive, phaseWorld } from './teaching-v2-fixtures.mjs';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

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
    // Review R3-A3: the clearance is a strict, evidence-bound record from the committed code-repo file (injected).
    const { attemptDigests, CLEARANCE_VERSION } = await L('teaching-v2-clearances.mjs');
    const clearances = [{ version: CLEARANCE_VERSION, runId: first.runId, workKey: 'kA', seq: e.seq, attemptKind: e.kind, stopKind: 'fatal', reviewer: 'owner', reviewedAt: '2026-11-20T12:00:00Z', reason: 'fixture: reviewed the synthetic WebFetch attempt', evidence: attemptDigests(join(w.phaseDir, 'runs', first.runId, 'works', 'kA', 'attempts'), `0${e.seq}-${e.kind}`) }];
    const cleared = await w.run({ items, responses: [w.F.writerResult(), w.F.verification()], clearances });
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
