// Teaching-v2 Phase A: regressions for Codex's round-3 review of f00dedc (2026-11-20), R3-A1..R3-A5.
// Each finding's checks replay Codex's probes (codex-codereview/round3-phase-a/verification/tests/review3-probes.mjs
// and review3-additional-probes.mjs). The runner-level checks drive scripts/lib/teaching-v2-phase.mjs end to end
// with an INJECTED executor returning synthetic transcripts: no model call, no network. The clearance-loader check
// uses a throwaway local git repository in the OS temp dir (never the evidence repo).
// Clearances are injected the way the runner passes them (committed records) AND written to the old runner-writable
// location phase-a/latch-clearances.json, so on f00dedc (which read that file) each check fails on behavior.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, unlinkSync, mkdirSync, copyFileSync, appendFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { L, MODEL, DIR, IMG, ev, classify, fixtures, phaseWorld } from './teaching-v2-fixtures.mjs';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const F0 = await fixtures();
const OUTCOME_FILES = ['transcript.jsonl', 'meta.json', 'done.json']; // in write order; done.json is the receipt written last

// A clearance record in the committed-file schema, its evidence digests computed here from the file bytes (the way
// an owner would, with shasum), independently of the module under test.
const fileDigest = p => (existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex') : 'absent');
async function clearanceFor(w, runId, key, e, stopKind, over = {}) {
  const stem = join(w.adirOf(runId, key), `${String(e.seq).padStart(2, '0')}-${e.kind}`);
  const evidence = { reservationSha256: fileDigest(`${stem}.reserved.json`), outcomeSha256: fileDigest(`${stem}.meta.json`), completionSha256: fileDigest(`${stem}.done.json`), transcriptSha256: fileDigest(`${stem}.transcript.jsonl`) };
  return { version: 'teachingV2LatchClearance/1', runId, workKey: key, seq: e.seq, attemptKind: e.kind, stopKind, reviewer: 'owner', reviewedAt: '2026-11-20T12:00:00Z', reason: 'reviewed the synthetic attempt evidence for this regression test', evidence, ...over };
}
const writeOldLocation = (w, list) => writeFileSync(join(w.phaseDir, 'latch-clearances.json'), JSON.stringify(list));

// ===================== R3-A1: a missing exit receipt never becomes success =====================
test('R3-A1 probe: a real timeout whose exit metadata is lost resumes as an unknown outcome and stops (no V, never accepted)', async () => {
  const w = await phaseWorld();
  try {
    const items = [w.mkItem('fxA', 'kA')];
    let observed = null;
    // Durable prefix after the crash: the reservation and transcript exist, the exit-status metadata does not.
    const persist = paths => { const mp = paths.find(p => p.endsWith('01-W.meta.json')); if (mp) { observed = JSON.parse(readFileSync(mp, 'utf8')); unlinkSync(mp); throw new Error('simulated crash: transcript written, metadata absent'); } return true; };
    const timeout = async (_b, _a, o) => { throw Object.assign(new Error('injected timeout'), { killed: true, stdout: w.okStdout(o.cwd, w.F.writerResult()) }); };
    const first = await w.run({ items, opsOver: { persist }, execute: timeout });
    assert.ok(first.result.stoppedAt); assert.equal(observed.kind, 'interrupted'); assert.equal(observed.exitCode, 'timeout');
    const again = await w.run({ items, responses: [w.F.verification()] });
    assert.deepEqual(again.calls, [], 'a call was dispatched on top of an attempt whose outcome is unknown');
    const st = w.stateOf(first.runId, 'kA');
    assert.notEqual(st.status, 'accepted-for-review'); assert.equal(st.ledger[0].outcome, 'unknown'); assert.ok(again.result.latched || again.result.stoppedAt);
  } finally { w.cleanup(); }
});
// Every crash point between the outcome-file writes (and the complete unit as the control), for a successful W.
for (let keep = 0; keep <= OUTCOME_FILES.length; keep++) {
  const kept = OUTCOME_FILES.slice(0, keep);
  test(`R3-A1: a crash after writing [${kept.join(', ') || 'nothing'}] of the W outcome files ${keep === OUTCOME_FILES.length ? 'recovers W with no new call' : 'is an unknown outcome that stops for review'}`, async () => {
    const w = await phaseWorld();
    try {
      const items = [w.mkItem('fxA', 'kA')];
      const first = await w.run({ items, responses: [w.F.writerResult()], opsOver: { persist: paths => { if (paths.some(p => p.endsWith('01-W.meta.json'))) throw new Error('crash before the outcome is pushed'); return true; } } });
      assert.ok(first.result.stoppedAt);
      for (const f of OUTCOME_FILES.slice(keep)) { const p = join(w.adirOf(first.runId, 'kA'), `01-W.${f}`); if (existsSync(p)) unlinkSync(p); }
      const again = await w.run({ items, responses: [w.F.verification()] });
      const st = w.stateOf(first.runId, 'kA');
      if (keep === OUTCOME_FILES.length) { assert.deepEqual(again.calls, ['V']); assert.equal(st.status, 'accepted-for-review'); assert.equal(st.ledger.length, 2); return; }
      assert.deepEqual(again.calls, [], `dispatched after an incomplete outcome (${kept.join(', ') || 'none'})`);
      assert.ok(again.result.latched || again.result.stoppedAt); assert.equal(st.ledger[0].outcome, 'unknown'); assert.equal(st.ledger.length, 1);
      assert.ok((await w.run({ items: [w.mkItem('fxB', 'kB')], responses: [w.F.writerResult(), w.F.verification()] })).calls.length === 0, 'another run dispatched past the unknown outcome');
    } finally { w.cleanup(); }
  });
}
test('R3-A1: an outcome whose exit status was removed after completion no longer reproduces (refused, no call)', async () => {
  const w = await phaseWorld();
  try {
    const items = [w.mkItem('fxA', 'kA')];
    const first = await w.run({ items, responses: [w.F.writerResult(), w.F.verification()] });
    assert.equal(w.stateOf(first.runId, 'kA').status, 'accepted-for-review');
    const mp = join(w.adirOf(first.runId, 'kA'), '01-W.meta.json'), meta = JSON.parse(readFileSync(mp, 'utf8')); delete meta.exitCode;
    writeFileSync(mp, `${JSON.stringify(meta)}\n`);
    const again = await w.run({ items, responses: [] });
    assert.ok(again.result.stoppedAt || again.result.latched, 'an attempt without an exit receipt was accepted'); assert.deepEqual(again.calls, []);
    const { classifyTranscript } = await L('teaching-v2-stage.mjs');
    assert.throws(() => classifyTranscript('', { callDir: DIR, imageFile: IMG, runtimeVersion: '9.9.9' }), /exit status/, 'a missing exit code must never default to 0');
  } finally { w.cleanup(); }
});

// ===================== R3-A2: malformed records and streamed Read inputs =====================
test('R3-A2 probe: a truncated nonempty line (WebFetch) with exit 1 is fatal, never an empty-session transport failure', async () => {
  const r = await classify('{"type":"assistant","message":{"content":[{"type":"tool_use","name":"WebFetch"', { exitCode: 1 });
  assert.notEqual(r.kind, 'transport-failure'); assert.notEqual(r.kind, 'usage-limit'); assert.equal(r.kind, 'fatal');
  for (const junk of ['[1,2]', '"text"', '{}', 'null', '{"no":"type"}']) assert.equal((await classify(junk, { exitCode: 1 })).kind, 'fatal', `non-event record ${junk}`);
});
test('R3-A2 probe: a streamed content_block Read of /etc/passwd in an otherwise confined transcript is fatal', async () => {
  const w = await phaseWorld();
  try {
    const tr = w.okStdout(DIR, w.F.writerResult()).split('\n');
    assert.equal((await classify(tr.join('\n'))).kind, 'ok', 'control');
    const streamed = ev({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'outside', name: 'Read', input: { file_path: '/etc/passwd' } } } });
    const r = await classify([tr[0], streamed, ...tr.slice(1)].join('\n'));
    assert.equal(r.kind, 'fatal', `streamed outside Read classified ${r.kind}`); assert.ok(r.toolUses.filter(n => n === 'Read').length >= 2, 'the streamed Read is not in the reported tool list');
    // The input arriving as input_json_delta fragments is reconstructed and validated the same way.
    const deltas = [ev({ type: 'stream_event', event: { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'd1', name: 'Read', input: {} } } }),
      ev({ type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"file_path":"/etc/' } } }),
      ev({ type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: 'passwd"}' } } }),
      ev({ type: 'stream_event', event: { type: 'content_block_stop', index: 1 } })];
    assert.equal((await classify([tr[0], ...deltas, ...tr.slice(1)].join('\n'))).kind, 'fatal', 'delta-streamed outside Read');
    // An input that cannot be reconstructed never establishes confinement.
    const broken = [deltas[0], ev({ type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"file_pa' } } }), deltas[3]];
    assert.equal((await classify([tr[0], ...broken, ...tr.slice(1)].join('\n'))).kind, 'fatal', 'unresolved streamed Read');
    // The same in-confinement Read seen streamed and complete stays ok.
    const same = ev({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: `${DIR}/${IMG}` } } } });
    assert.equal((await classify([tr[0], same, ...tr.slice(1)].join('\n'))).kind, 'ok', 'a duplicate streamed copy of the confined Read');
  } finally { w.cleanup(); }
});
test('R3-A2: a malformed line inside an otherwise valid successful transcript is fatal, not ok', async () => {
  const w = await phaseWorld();
  try {
    const tr = w.okStdout(DIR, w.F.writerResult()).split('\n');
    const r = await classify([tr[0], '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"cat /etc/pas', ...tr.slice(1)].join('\n'));
    assert.equal(r.kind, 'fatal'); assert.match(r.reason, /malformed/);
  } finally { w.cleanup(); }
});

// ===================== R3-A3: clearance authority and evidence binding =====================
test('R3-A3 probe: a clearance the runner can write under the evidence tree (minimal or complete) clears nothing', async () => {
  const w = await phaseWorld();
  try {
    const items = [w.mkItem('fxA', 'kA')], first = await w.run({ items, responses: ['fatal'] });
    const before = w.P.phaseStop({ phaseDir: w.phaseDir }).stops.length; assert.ok(before >= 1);
    writeOldLocation(w, [{ runId: first.runId, workKey: 'kA', seq: 1 }]); // Codex's three-field record, same UID as the runner
    assert.equal(w.P.phaseStop({ phaseDir: w.phaseDir }).stops.length, before, 'a runner-writable three-field record cleared the stop');
    const e = w.stateOf(first.runId, 'kA').ledger[0];
    writeOldLocation(w, [await clearanceFor(w, first.runId, 'kA', e, 'fatal')]); // even a complete record there is not authority
    assert.equal(w.P.phaseStop({ phaseDir: w.phaseDir }).stops.length, before, 'a record in the evidence tree cleared the stop');
    unlinkSync(join(w.phaseDir, 'fatal.json'));
    const next = await w.run({ items: [w.mkItem('fxB', 'kB')], responses: [w.F.writerResult(), w.F.verification()] });
    assert.deepEqual(next.calls, [], 'another run dispatched on a runner-written clearance');
    // Only the committed record (as the runner passes it) clears, and only for that exact evidence.
    assert.equal(w.P.phaseStop({ phaseDir: w.phaseDir, clearances: [await clearanceFor(w, first.runId, 'kA', e, 'fatal')] }).stops.length, 0);
  } finally { w.cleanup(); }
});
test('R3-A3 probe (cross-run): a clearance is stale once the cleared transcript changes; other runs stop again', async () => {
  const w = await phaseWorld();
  try {
    const first = await w.run({ items: [w.mkItem('fxA', 'kA')], responses: ['fatal'] });
    const e = w.stateOf(first.runId, 'kA').ledger[0], clearances = [await clearanceFor(w, first.runId, 'kA', e, 'fatal')];
    writeOldLocation(w, [{ ...clearances[0], transcriptSha256: e.transcriptSha256 }]);
    unlinkSync(join(w.phaseDir, 'fatal.json'));
    const ok = await w.run({ items: [w.mkItem('fxB', 'kB')], responses: [w.F.writerResult(), w.F.verification()], clearances });
    assert.deepEqual(ok.calls, ['W', 'V'], 'a valid clearance should let a later run proceed');
    appendFileSync(join(w.adirOf(first.runId, 'kA'), '01-W.transcript.jsonl'), `\n${ev({ type: 'assistant', message: { model: MODEL, content: [{ type: 'tool_use', id: 'new', name: 'Bash', input: { command: 'synthetic-only' } }] } })}`);
    const stops = w.P.phaseStop({ phaseDir: w.phaseDir, clearances }).stops;
    assert.ok(stops.some(s => s.runId === first.runId && s.kind === 'fatal'), 'changed evidence kept its clearance');
    const next = await w.run({ items: [w.mkItem('fxC', 'kC')], responses: [w.F.writerResult(), w.F.verification()], clearances });
    assert.deepEqual(next.calls, [], 'a third run dispatched on a stale clearance'); assert.ok(next.result.latched);
  } finally { w.cleanup(); }
});
test('R3-A3: the clearance schema is strict (reviewer, time, reason, exact digests; absent is explicit, never a wildcard)', async () => {
  const { validateClearances, CLEARANCE_VERSION, ClearanceError } = await L('teaching-v2-clearances.mjs');
  const h = 'a'.repeat(64);
  const good = { version: CLEARANCE_VERSION, runId: 'tv2a-0123456789ab', workKey: 'kA', seq: 1, attemptKind: 'W', stopKind: 'unknown-outcome', reviewer: 'owner', reviewedAt: '2026-11-20T12:00:00Z', reason: 'transcript lost in a crash; reviewed and held', evidence: { reservationSha256: h, outcomeSha256: 'absent', completionSha256: 'absent', transcriptSha256: 'absent' } };
  assert.equal(validateClearances([good]).length, 1);
  const bad = [{ runId: 'tv2a-0123456789ab', workKey: 'kA', seq: 1 }, { ...good, reviewer: '' }, { ...good, reviewedAt: '2026-11-20' }, { ...good, reason: 'ok' },
    { ...good, evidence: { ...good.evidence, transcriptSha256: null } }, { ...good, evidence: { reservationSha256: h } }, { ...good, evidence: { ...good.evidence, reservationSha256: 'absent' } },
    { ...good, note: 'extra' }, { ...good, stopKind: 'any' }, { ...good, version: 'x' }];
  for (const b of bad) assert.throws(() => validateClearances([b]), ClearanceError, JSON.stringify(b).slice(0, 120));
  assert.throws(() => validateClearances([good, good]), /duplicate/);
});
test('R3-A3: only a clearance committed at the checked-out HEAD counts; any uncommitted change refuses the start', async () => {
  const { loadCommittedClearances, validateClearances, CLEARANCES_FILE, CLEARANCE_VERSION, ClearanceError } = await L('teaching-v2-clearances.mjs');
  const repo = mkdtempSync(join(tmpdir(), 'tv2-clr-')), g = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    g('init', '-q'); g('config', 'user.email', 'fixture@example.invalid'); g('config', 'user.name', 'fixture'); g('config', 'commit.gpgsign', 'false');
    writeFileSync(join(repo, 'README'), 'x'); g('add', 'README'); g('commit', '-q', '-m', 'init');
    assert.deepEqual(loadCommittedClearances({ repoDir: repo }).clearances, [], 'no file at HEAD: no clearances');
    const p = join(repo, CLEARANCES_FILE); mkdirSync(dirname(p), { recursive: true });
    const rec = { version: CLEARANCE_VERSION, runId: 'tv2a-0123456789ab', workKey: 'kA', seq: 1, attemptKind: 'W', stopKind: 'fatal', reviewer: 'owner', reviewedAt: '2026-11-20T12:00:00Z', reason: 'reviewed the synthetic WebFetch attempt', evidence: { reservationSha256: 'a'.repeat(64), outcomeSha256: 'b'.repeat(64), completionSha256: 'c'.repeat(64), transcriptSha256: 'd'.repeat(64) } };
    writeFileSync(p, JSON.stringify([rec]));
    assert.throws(() => loadCommittedClearances({ repoDir: repo }), ClearanceError, 'an untracked (runner-writable) clearance file counted');
    g('add', CLEARANCES_FILE); assert.throws(() => loadCommittedClearances({ repoDir: repo }), ClearanceError, 'a staged but uncommitted clearance counted');
    g('commit', '-q', '-m', 'owner clearance');
    const loaded = loadCommittedClearances({ repoDir: repo }); assert.equal(loaded.clearances.length, 1); assert.equal(loaded.commit, g('rev-parse', 'HEAD').trim());
    writeFileSync(p, JSON.stringify([rec, { ...rec, seq: 2 }])); // a working-tree edit after the commit
    assert.throws(() => loadCommittedClearances({ repoDir: repo }), /uncommitted/);
    g('checkout', '-q', '--', CLEARANCES_FILE);
    writeFileSync(p, JSON.stringify([{ runId: 'tv2a-0123456789ab', workKey: 'kA', seq: 1 }])); g('commit', '-q', '-am', 'minimal record');
    assert.throws(() => loadCommittedClearances({ repoDir: repo }), ClearanceError, 'a committed record that fails the schema counted');
    assert.throws(() => validateClearances('not a list'), ClearanceError);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

// ===================== R3-A4: a cleared unknown outcome is an explicit terminal hold =====================
test('R3-A4 probe: an owner-cleared unknown attempt becomes a terminal hold (consumed, never retried); later works and the rest run proceed', async () => {
  const w = await phaseWorld();
  try {
    const A = w.mkItem('fxA', 'kA'), B = w.mkItem('fxB', 'kB'), items = [A, B];
    const first = await w.run({ items, responses: [w.F.writerResult()], opsOver: { persist: paths => { if (paths.some(p => p.endsWith('01-W.meta.json'))) throw new Error('crash'); return true; } } });
    for (const f of OUTCOME_FILES) { const p = join(w.adirOf(first.runId, 'kA'), `01-W.${f}`); if (existsSync(p)) unlinkSync(p); }
    const unk = await w.run({ items }); assert.deepEqual(unk.calls, []);
    const e = w.stateOf(first.runId, 'kA').ledger[0]; assert.equal(e.outcome, 'unknown');
    const clearances = [await clearanceFor(w, first.runId, 'kA', e, 'unknown-outcome', { reason: 'known lost transcript; reviewed, keep the work held' })];
    assert.deepEqual(Object.values(clearances[0].evidence).slice(1), ['absent', 'absent', 'absent'], 'absent evidence is explicit');
    writeOldLocation(w, [{ runId: first.runId, workKey: 'kA', seq: 1, transcriptSha256: null, reviewedBy: 'owner', at: '2026-11-20', note: 'known lost transcript; keep held' }]);
    if (existsSync(join(w.phaseDir, 'fatal.json'))) unlinkSync(join(w.phaseDir, 'fatal.json'));
    const next = await w.run({ items, responses: [w.F.writerResult(), w.F.verification()], clearances });
    assert.ok(next.result.completed, JSON.stringify(next.result)); assert.deepEqual(next.calls, ['W', 'V'], 'only B runs; A is never retried');
    const a = w.stateOf(first.runId, 'kA');
    assert.equal(a.status, 'hold'); assert.equal(a.ledger.length, 1); assert.equal(a.ledger[0].outcome, 'unknown'); assert.match(a.holdReasons.join(' '), /owner-cleared unknown outcome/);
    assert.equal(w.stateOf(first.runId, 'kB').status, 'accepted-for-review');
    const replay = await w.run({ items, responses: [], clearances }); assert.ok(replay.result.completed); assert.deepEqual(replay.calls, []);
    // Parent-run verification: the held work verifies as terminal, so the remaining run may start.
    const identity = w.identityOf(items), parent = { runId: first.runId, identity, items };
    const rest = await w.run({ items: [w.mkItem('fxC', 'kC')], parent, responses: [w.F.writerResult(), w.F.verification()], clearances });
    assert.deepEqual(rest.calls, ['W', 'V']); assert.ok(rest.result.completed);
    // Without the clearance the same evidence stops everything again.
    assert.ok((await w.run({ items: [w.mkItem('fxD', 'kD')], responses: [] })).result.latched);
  } finally { w.cleanup(); }
});

// ===================== R3-A5: recovered evidence is re-persisted before anything else =====================
// persist() that mirrors each pushed file into a second filesystem view (only what was successfully persisted).
const mirrorPersist = (w, mirror, failWhen = () => false) => paths => {
  if (failWhen(paths)) throw new Error('simulated persistence failure before staging');
  for (const p of paths) { if (!p || !existsSync(p)) continue; const t = join(mirror, relative(w.root, p)); mkdirSync(dirname(t), { recursive: true }); copyFileSync(p, t); }
  return true;
};
test('R3-A5 probe: recovered W outcome files are re-persisted before V, and the result verifies from persisted files alone', async () => {
  const w = await phaseWorld(), mirror = mkdtempSync(join(tmpdir(), 'tv2-mirror-'));
  try {
    const items = [w.mkItem('fxA', 'kA')], wfiles = f => join(w.adirOf(w.P.runIdOf(w.identityOf(items)), 'kA'), `01-W.${f}`);
    const first = await w.run({ items, responses: [w.F.writerResult()], opsOver: { persist: mirrorPersist(w, mirror, paths => paths.some(p => p.endsWith('01-W.meta.json'))) } });
    assert.ok(first.result.stoppedAt);
    const pushed = [];
    const again = await w.run({ items, responses: [w.F.verification()], opsOver: { persist: paths => { pushed.push(...paths); return mirrorPersist(w, mirror)(paths); } } });
    assert.deepEqual(again.calls, ['V']); assert.equal(w.stateOf(first.runId, 'kA').status, 'accepted-for-review');
    for (const f of ['transcript.jsonl', 'meta.json']) assert.ok(pushed.includes(wfiles(f)), `W ${f} was never re-offered to persistence`);
    const firstV = pushed.findIndex(p => p.endsWith('02-V.reserved.json'));
    assert.ok(pushed.indexOf(wfiles('transcript.jsonl')) < firstV, 'W evidence must be persisted before the V reservation');
    // Second view: a fresh "checkout" holding only persisted files must reproduce the accepted result.
    const v = await w.P.verifyRun({ phaseDir: join(mirror, 'phase-a'), runId: first.runId, items, gold: w.F.gold, renderFor: () => w.F.render });
    assert.ok(v.ok, JSON.stringify(v.rows.map(r => r.reason))); assert.equal(v.rows[0].status, 'accepted-for-review');
  } finally { w.cleanup(); rmSync(mirror, { recursive: true, force: true }); }
});
test('R3-A5: when recovered evidence still cannot be persisted, the run stops before any acceptance', async () => {
  const w = await phaseWorld();
  try {
    const items = [w.mkItem('fxA', 'kA')];
    const first = await w.run({ items, responses: [w.F.writerResult(), w.F.verification()], opsOver: { persist: paths => { if (paths.some(p => p.endsWith('02-V.meta.json'))) throw new Error('V outcome push failed'); return true; } } });
    assert.ok(first.result.stoppedAt); assert.notEqual(w.stateOf(first.runId, 'kA').status, 'accepted-for-review');
    const again = await w.run({ items, responses: [], opsOver: { persist: paths => { if (paths.some(p => p.endsWith('02-V.transcript.jsonl'))) throw new Error('V evidence still cannot be pushed'); return true; } } });
    assert.ok(again.result.stoppedAt, JSON.stringify(again.result)); assert.deepEqual(again.calls, []);
    assert.notEqual(w.stateOf(first.runId, 'kA').status, 'accepted-for-review', 'accepted on top of evidence that never reached shared persistence');
  } finally { w.cleanup(); }
});

let pass = 0; const failed = [];
for (const [name, fn] of tests) {
  try { await fn(); pass++; console.log(`ok   ${name}`); }
  catch (e) { failed.push(name); console.error(`FAIL ${name}\n     ${String(e.message).split('\n')[0].slice(0, 300)}`); }
}
console.log(`teaching-v2-review3.test: ${pass}/${tests.length} checks passed`);
if (failed.length) process.exit(1);
