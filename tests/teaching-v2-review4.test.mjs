// Teaching-v2 Phase A: regressions for Codex's round-4 review of c1f4b02 (2026-11-20), R4-A1 and R4-A2.
// Replays Codex's probes (codex-codereview/round4-phase-a/archive/tests/review4-confinement.mjs and
// review4-torn-metadata.mjs). Classifier checks use synthetic transcripts; runner checks drive
// scripts/lib/teaching-v2-phase.mjs end to end with an INJECTED executor. No model call, network or git.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { L, MODEL, DIR, IMG, ev, classify, phaseWorld } from './teaching-v2-fixtures.mjs';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---- synthetic stream pieces (the probe's) ----
const start = (id = 'extra', name = 'Read', index = 2) => ev({ type: 'stream_event', event: { type: 'content_block_start', index, content_block: { type: 'tool_use', id, name, input: {} } } });
const delta = (text, index = 2) => ev({ type: 'stream_event', event: { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: text } } });
const stop = (index = 2) => ev({ type: 'stream_event', event: { type: 'content_block_stop', index } });
const quota = ev({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Claude AI usage limit reached' });
const completeRead = (id, file_path) => ev({ type: 'assistant', message: { model: MODEL, content: [{ type: 'tool_use', id, name: 'Read', input: { file_path } }] } });
const imageResult = id => ev({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'image' }] }] } });
const W0 = await phaseWorld(); const LINES = W0.okStdout(DIR, W0.F.writerResult()).split('\n'); W0.cleanup();
const RECEIPT = LINES.slice(0, 3); // init + the confined Read of the exact image + its image result
const tr = (...parts) => parts.flat().join('\n');

// ===================== R4-A1: an unfinished stream placeholder is not a completed invocation =====================
// The interruption controls: [name, tail, exitCode, expected kind]. Each is run plain (control), with an unfinished
// `{}` start (no delta), with the bare `{` prefix, and with a prefix of the confined image's own path; and, under the
// same interruption, every negative control below must stay fatal: proven outside paths, closed or executed Reads
// whose input cannot be verified, and forbidden tools.
const NEGATIVES = {
  'outside prefix (/etc/pa), unfinished': [start(), delta('{"file_path":"/etc/pa')],
  'traversal prefix, unfinished': [start(), delta(`{"file_path":"${DIR}/../`)],
  'complete outside path, unfinished JSON': [start(), delta('{"file_path":"/etc/passwd","offset":')],
  'correct basename in another directory, unfinished JSON': [start(), delta(`{"file_path":"/elsewhere/${IMG}",`)],
  'completed empty Read (assistant block)': [ev({ type: 'assistant', message: { model: MODEL, content: [{ type: 'tool_use', id: 'extra', name: 'Read', input: {} }] } })],
  'closed empty streamed Read (content_block_stop, no delta)': [start(), stop()],
  'closed streamed Read with an unparseable input': [start(), delta('{"file_pa'), stop()],
  'executed empty start (tool_result for it)': [start(), imageResult('extra')],
  "executed '{' prefix (tool_result for it)": [start(), delta('{'), imageResult('extra')],
  'forbidden tool start with no delta': [start('w1', 'WebFetch')],
  'forbidden server tool start with no delta': [ev({ type: 'stream_event', event: { type: 'content_block_start', index: 3, content_block: { type: 'server_tool_use', id: 's1', name: 'web_search', input: {} } } })],
};
const INTERRUPTIONS = [['quota', [quota], 1, 'usage-limit'], ['timeout', [], 'timeout', 'interrupted'], ['nonzero exit', [], 1, 'interrupted']];
for (const [name, tail, exitCode, want] of INTERRUPTIONS) {
  test(`R4-A1: ${name} after a valid image receipt keeps ${want} with an unfinished Read start (no delta, '{', in-image prefix); outside/executed/forbidden stay fatal`, async () => {
    assert.equal((await classify(tr(RECEIPT, tail), { exitCode })).kind, want, 'control');
    for (const [label, extra] of [['no delta', [start()]], ["'{' prefix", [start(), delta('{')]], ['whitespace prefix', [start(), delta(' { ')]], ['in-image path prefix', [start(), delta(`{"file_path":"${DIR}/cc`)]]]) {
      const r = await classify(tr(RECEIPT, extra, tail), { exitCode });
      assert.equal(r.kind, want, `${label}: ${r.kind} (${r.reason})`);
    }
    for (const [label, extra] of Object.entries(NEGATIVES)) {
      const r = await classify(tr(RECEIPT, extra, tail), { exitCode });
      assert.equal(r.kind, 'fatal', `negative ${label}: ${r.kind} ${r.reason}`);
    }
  });
}
test('R4-A1: an unfinished Read start never counts as successful image inspection', async () => {
  const init = RECEIPT[0], ok = LINES.slice(3); // StructuredOutput + success result, but no completed image Read
  for (const extra of [[start('t1')], [start('t1'), delta('{')], [start('t1'), delta(`{"file_path":"${DIR}/${IMG}`)]]) {
    const r = await classify(tr(init, extra, ok));
    assert.notEqual(r.kind, 'ok', `accepted with only an unfinished Read: ${r.reason}`); assert.equal(r.kind, 'fatal'); assert.match(r.reason, /image not inspected/);
    assert.equal((await classify(tr(init, extra, quota), { exitCode: 1 })).kind, 'usage-limit', 'with no outside path the quota stays a quota');
  }
  // A completed session that also holds an unfinished extra Read start is not a clean success: held, not fatal.
  const r = await classify(tr(RECEIPT, start(), ok));
  assert.equal(r.kind, 'content-failure', `${r.kind}: ${r.reason}`); assert.match(r.reason, /unfinished streamed Read/);
});
test('R4-A1: a later completed block reconciles an unfinished start by invocation id; conflicting evidence is kept and fatal', async () => {
  const { normalizedToolUses, parseRecords } = await L('teaching-v2-stage.mjs');
  const reads = t => normalizedToolUses(parseRecords(t).evs).filter(u => u.name === 'Read');
  const rest = LINES.slice(1); // the completed t1 Read, its image result, StructuredOutput and success
  for (const [label, extra] of [['no delta', [start('t1', 'Read', 0)]], ["'{'", [start('t1', 'Read', 0), delta('{', 0)]], ['path prefix', [start('t1', 'Read', 0), delta(`{"file_path":"${DIR}/`, 0)]], ['full path, unfinished JSON', [start('t1', 'Read', 0), delta(`{"file_path":"${DIR}/${IMG}"`, 0)]]]) {
    const t = tr(LINES[0], extra, rest), r = await classify(t);
    assert.equal(r.kind, 'ok', `${label}: ${r.reason}`); assert.equal(reads(t).length, 1, `${label}: the reconciled invocation is kept once`);
  }
  // The completed block arriving FIRST reconciles the same way.
  assert.equal((await classify(tr(LINES[0], LINES[1], start('t1', 'Read', 0), LINES.slice(2)))).kind, 'ok', 'completed block before the start');
  // Conflict: the stream had begun naming /etc/ but the completed block of the same id names the image. Both are
  // kept on record and the call is fatal.
  for (const [label, extra] of [['outside prefix', [start('t1', 'Read', 0), delta('{"file_path":"/etc/', 0)]], ['different complete streamed input', [start('t1', 'Read', 0), delta('{"file_path":"/etc/passwd"}', 0)]]]) {
    const t = tr(LINES[0], extra, rest), r = await classify(t);
    assert.equal(r.kind, 'fatal', `${label}: ${r.kind} ${r.reason}`); assert.equal(reads(t).length, 2, `${label}: conflicting evidence was discarded`);
  }
  // An unfinished start of a DIFFERENT id is not reconciled by t1.
  assert.equal((await classify(tr(LINES[0], start('other', 'Read', 0), rest))).kind, 'content-failure');
});
test('R4-A1 probe (phase loop): a quota stop with an unfinished Read start pauses as a usage limit, with no fatal latch', async () => {
  const w = await phaseWorld();
  try {
    let dispatched = 0;
    const items = [w.mkItem('newA', 'kA'), w.mkItem('newB', 'kB')];
    const run = await w.run({ items, execute: async (_b, _a, opts) => {
      dispatched++;
      throw Object.assign(new Error('synthetic quota'), { code: 1, stdout: [...w.okStdout(opts.cwd, w.F.writerResult()).split('\n').slice(0, 3), start(), quota].join('\n') });
    } });
    assert.equal(dispatched, 1);
    const st = w.stateOf(run.runId, 'kA');
    assert.equal(st.ledger[0].dispatch ?? st.ledger[0].outcome, 'usage-limit', JSON.stringify(st.ledger[0]));
    assert.equal(existsSync(join(w.phaseDir, 'fatal.json')), false, 'an ordinary quota interruption wrote a phase-wide fatal latch');
    assert.equal(w.P.phaseStop({ phaseDir: w.phaseDir }).stops.filter(s => s.kind === 'fatal').length, 0, 'the preserved evidence re-derives a fatal');
    assert.notEqual(st.status, 'accepted-for-review');
  } finally { w.cleanup(); }
});

// ===================== R4-A2: torn outcome JSON is preserved incomplete evidence =====================
const digest = p => (existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex') : 'absent');
const clearanceFor = (w, runId, key, stem, reason) => {
  const s = join(w.adirOf(runId, key), stem);
  return { version: 'teachingV2LatchClearance/1', runId, workKey: key, seq: 1, attemptKind: 'W', stopKind: 'unknown-outcome', reviewer: 'owner', reviewedAt: '2026-11-20T12:00:00Z', reason,
    evidence: { reservationSha256: digest(`${s}.reserved.json`), outcomeSha256: digest(`${s}.meta.json`), completionSha256: digest(`${s}.done.json`), transcriptSha256: digest(`${s}.transcript.jsonl`) } };
};
const snapshot = adir => Object.fromEntries(readdirSync(adir).sort().map(n => [n, digest(join(adir, n))]));
// tear(adir): leave the durable prefix of a crash INSIDE one outcome write.
const TEARS = {
  'metadata write': adir => { const p = join(adir, '01-W.meta.json'); writeFileSync(p, readFileSync(p).subarray(0, 24)); unlinkSync(join(adir, '01-W.done.json')); },
  'completion-marker write': adir => { const p = join(adir, '01-W.done.json'); writeFileSync(p, readFileSync(p).subarray(0, 24)); },
};
for (const [label, tear] of Object.entries(TEARS)) {
  test(`R4-A2 probe: a crash inside the ${label} stops with no parse error until an exact clearance, then is a terminal hold; repeat resume and parent verification pass`, async () => {
    const w = await phaseWorld();
    try {
      const A = w.mkItem('A', 'kA'), B = w.mkItem('B', 'kB'), items = [A, B];
      const first = await w.run({ items, responses: [w.F.writerResult()], opsOver: { persist: paths => { if (paths.some(p => p.endsWith('01-W.meta.json'))) throw new Error('injected stop at the outcome write boundary'); return true; } } });
      assert.ok(first.result.stoppedAt);
      const adir = w.adirOf(first.runId, 'kA'); tear(adir);
      const torn = snapshot(adir);
      assert.equal(w.P.completionOf(adir, '01-W', { seq: 1, kind: 'W' }).state, 'incomplete');
      // Uncleared: no throw, no dispatch, a stop; repeated resumes stay stopped.
      for (let i = 0; i < 2; i++) {
        let calls = 0;
        const r = await w.run({ items, execute: async () => { calls++; throw new Error('unexpected dispatch'); } });
        assert.equal(calls, 0); assert.ok(r.result.latched || r.result.stoppedAt, JSON.stringify(r.result));
        assert.ok(w.P.phaseStop({ phaseDir: w.phaseDir }).stops.length >= 1, 'the torn attempt does not stop the phase');
        assert.notEqual(w.stateOf(first.runId, 'kA').status, 'accepted-for-review');
      }
      assert.equal(w.stateOf(first.runId, 'kA').ledger[0].outcome, 'unknown');
      // A clearance naming different bytes (e.g. the untorn metadata) clears nothing.
      const stale = { ...clearanceFor(w, first.runId, 'kA', '01-W', 'reviewed an earlier copy of this torn attempt; hold it permanently'), evidence: { ...clearanceFor(w, first.runId, 'kA', '01-W', 'x').evidence, outcomeSha256: 'f'.repeat(64) } };
      assert.ok((await w.run({ items, clearances: [stale] })).calls.length === 0);
      assert.ok(w.P.phaseStop({ phaseDir: w.phaseDir, clearances: [stale] }).stops.length >= 1, 'a stale clearance cleared the torn attempt');
      // The exact clearance: A becomes a terminal hold (reservation consumed, never retried), B runs.
      const clearances = [clearanceFor(w, first.runId, 'kA', '01-W', `reviewed the synthetic crash inside the ${label}; hold this work permanently`)];
      const next = await w.run({ items, responses: [w.F.writerResult(), w.F.verification()], clearances });
      assert.ok(next.result.completed, JSON.stringify(next.result)); assert.deepEqual(next.calls, ['W', 'V'], 'only B runs; A is never retried');
      const a = w.stateOf(first.runId, 'kA');
      assert.equal(a.status, 'hold'); assert.equal(a.ledger.length, 1); assert.equal(a.ledger[0].outcome, 'unknown'); assert.match(a.holdReasons.join(' '), /owner-cleared unknown outcome/);
      assert.equal(a.final ?? null, null, 'the torn result was accepted');
      assert.equal(w.stateOf(first.runId, 'kB').status, 'accepted-for-review');
      assert.deepEqual(snapshot(adir), torn, 'the original torn bytes were changed, removed or added to');
      // Repeat resume: nothing runs, the hold reproduces.
      const replay = await w.run({ items, responses: [], clearances }); assert.ok(replay.result.completed, JSON.stringify(replay.result)); assert.deepEqual(replay.calls, []);
      // Parent verification: the held work verifies as terminal; the rest run may start.
      const v = await w.P.verifyRun({ phaseDir: w.phaseDir, runId: first.runId, items, gold: w.F.gold, renderFor: () => w.F.render, clearances });
      assert.ok(v.ok, JSON.stringify(v.rows.map(r => r.reason))); assert.equal(v.rows[0].status, 'hold');
      const parent = { runId: first.runId, identity: w.identityOf(items), items };
      const rest = await w.run({ items: [w.mkItem('C', 'kC')], parent, responses: [w.F.writerResult(), w.F.verification()], clearances });
      assert.deepEqual(rest.calls, ['W', 'V']); assert.ok(rest.result.completed);
      // Without the clearance the same evidence stops everything again.
      assert.ok((await w.run({ items: [w.mkItem('D', 'kD')], responses: [] })).result.latched);
      assert.deepEqual(snapshot(adir), torn);
    } finally { w.cleanup(); }
  });
}
test('R4-A2: an unreadable reservation receipt is an unknown-outcome stop, not a parse error', async () => {
  const w = await phaseWorld();
  try {
    const items = [w.mkItem('A', 'kA')];
    const first = await w.run({ items, responses: [w.F.writerResult()], opsOver: { persist: paths => { if (paths.some(p => p.endsWith('01-W.meta.json'))) throw new Error('crash'); return true; } } });
    const p = join(w.adirOf(first.runId, 'kA'), '01-W.reserved.json'); writeFileSync(p, readFileSync(p).subarray(0, 20));
    const stops = w.P.phaseStop({ phaseDir: w.phaseDir }).stops;
    assert.ok(stops.some(s => s.kind === 'unknown-outcome' && /unreadable/.test(s.reason)), JSON.stringify(stops));
    const r = await w.run({ items, responses: [] }); assert.deepEqual(r.calls, []); assert.ok(r.result.latched || r.result.stoppedAt);
  } finally { w.cleanup(); }
});
test('R4-A2: attempt files are written once and atomically (an existing file is refused intact, no temp file left)', async () => {
  const { writeOnceAtomic } = await L('teaching-v2-phase.mjs');
  const d = mkdtempSync(join(tmpdir(), 'tv2-atomic-'));
  try {
    const p = join(d, '01-W.meta.json');
    writeOnceAtomic(p, '{"a":1}\n'); assert.equal(readFileSync(p, 'utf8'), '{"a":1}\n');
    assert.throws(() => writeOnceAtomic(p, '{"b":2}\n'), /EEXIST/); assert.equal(readFileSync(p, 'utf8'), '{"a":1}\n');
    assert.deepEqual(readdirSync(d), ['01-W.meta.json']);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

let pass = 0; const failed = [];
for (const [name, fn] of tests) {
  try { await fn(); pass++; console.log(`ok   ${name}`); }
  catch (e) { failed.push(name); console.error(`FAIL ${name}\n     ${String(e.message).split('\n')[0].slice(0, 300)}`); }
}
console.log(`teaching-v2-review4.test: ${pass}/${tests.length} checks passed`);
if (failed.length) process.exit(1);
