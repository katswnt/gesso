// Teaching-v2 Phase A: regressions for Codex's round-6 review of 3be7921 (2026-11-20), R6-A1.
// Replays Codex's probe (codex-codereview/round6-phase-a/archive/tests/review6-path-evidence.mjs): 16 classifier
// cases (4 raw Read fragments x success / quota / stopped / reconciled) and both W-to-V phase reproductions. The fix
// is a strict allowlist on the RAW argument evidence of every Read form, checked before parsing, reconciliation or
// dedup: only {"file_path":"<image>"} verifies; any other form that names an outside path is fatal; any other
// ambiguous form is a content-failure hold. Synthetic transcripts and an INJECTED executor; no model call, network or git.
import assert from 'node:assert/strict';
import { DIR, IMG, ev, classify, phaseWorld } from './teaching-v2-fixtures.mjs';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const start = (id = 'extra', index = 2) => ev({ type: 'stream_event', event: { type: 'content_block_start', index, content_block: { type: 'tool_use', id, name: 'Read', input: {} } } });
const delta = (text, index = 2) => ev({ type: 'stream_event', event: { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: text } } });
const stop = (index = 2) => ev({ type: 'stream_event', event: { type: 'content_block_stop', index } });
const quota = ev({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Claude AI usage limit reached' });
const W0 = await phaseWorld(); const LINES = W0.okStdout(DIR, W0.F.writerResult()).split('\n'); W0.cleanup();
const RECEIPT = LINES.slice(0, 3), OK = LINES.slice(3); // init + valid image receipt; StructuredOutput + success
const tr = (...parts) => parts.flat().join('\n');
const SAFE = `${DIR}/${IMG}`;
// The completed receipt Read (LINES[1]) with its input object written as `rawInput`, byte for byte.
const receiptWith = rawInput => { const line = LINES[1].replace(JSON.stringify({ file_path: SAFE }), rawInput); assert.ok(line.includes(rawInput)); return line; };

// Codex's four raw fragments (review6-path-evidence.mjs rawCases).
const RAW = {
  'plain-second-key-outside': `{"file_path":"${SAFE}","file_path":"/etc/passwd","offset":`,
  'escaped-second-key-outside': `{"file_path":"${SAFE}","file_\\u0070ath":"/etc/passwd","offset":`,
  'resolved-duplicate-outside-first': `{"file_path":"/etc/passwd","file_path":"${SAFE}"}`,
  'resolved-duplicate-outside-last': `{"file_path":"${SAFE}","file_path":"/etc/passwd"}`,
};
// Codex's four modes: [label, id, stopped, tail, exitCode]. `reconciled` streams the receipt's own id t1 ahead of its block.
const MODES = [['success', 'extra', false, OK, 0], ['quota', 'extra', false, [quota], 1], ['stopped-success', 'extra', true, OK, 0], ['reconciled-success', 't1', false, LINES.slice(1), 0]];
const caseTranscript = (raw, [mode, id, stopped, tail]) => tr(mode === 'reconciled-success' ? LINES.slice(0, 1) : RECEIPT, start(id), delta(raw), stopped ? [stop()] : [], tail);

const matrix = async names => {
  for (const name of names) {
    for (const m of MODES) {
      const r = await classify(caseTranscript(RAW[name], m), { exitCode: m[4] });
      assert.equal(r.kind, 'fatal', `${name}/${m[0]}: ${r.kind} (${r.reason})`);
      assert.match(r.reason, /\/etc\/passwd/, `${name}/${m[0]}: the outside path is named`);
    }
  }
};
test('R6-A1: an escaped key name (file_\\u0070ath) cannot hide an outside path: fatal in all four modes (plain-key control alongside)', () =>
  matrix(['escaped-second-key-outside', 'plain-second-key-outside']));
test('R6-A1: a parseable fragment with duplicate file_path keys is fatal whichever copy is outside, in all four modes', () =>
  matrix(['resolved-duplicate-outside-first', 'resolved-duplicate-outside-last']));

test('R6-A1: a COMPLETED Read block is judged on its raw input text: duplicate or escaped keys naming an outside path are fatal', async () => {
  for (const raw of [`{"file_path":"/etc/passwd","file_path":"${SAFE}"}`, `{"file_\\u0070ath":"/etc/passwd","file_path":"${SAFE}"}`, `{"note":"/etc/passwd","file_path":"${SAFE}"}`]) {
    for (const [mode, tail, exitCode] of [['success', OK, 0], ['quota', [quota], 1]]) {
      const r = await classify(tr(LINES[0], receiptWith(raw), LINES[2], tail), { exitCode });
      assert.equal(r.kind, 'fatal', `${raw} / ${mode}: ${r.kind} (${r.reason})`); assert.match(r.reason, /\/etc\/passwd/);
    }
  }
});
test('R6-A1: a non-canonical Read naming only the image is not a verified inspection: success is held, interruptions keep their kind', async () => {
  const NONCANON = [`{"file_path":"${SAFE}","offset":1}`, `{"limit":2,"file_path":"${SAFE}"}`, `{"file_\\u0070ath":"${SAFE}"}`, `{"file_path":"${SAFE.replaceAll('/', '\\/')}"}`, `{"file_path":"${SAFE}","file_path":"${SAFE}"}`];
  for (const raw of NONCANON) {
    const r = await classify(tr(LINES[0], receiptWith(raw), LINES.slice(2)));
    assert.equal(r.kind, 'content-failure', `${raw}: ${r.kind} (${r.reason})`); assert.match(r.reason, /non-canonical Read argument evidence/);
    for (const [name, tail, exitCode, want] of [['quota', [quota], 1, 'usage-limit'], ['timeout', [], 'timeout', 'interrupted'], ['nonzero exit', [], 1, 'interrupted']]) {
      const q = await classify(tr(LINES[0], receiptWith(raw), LINES[2], tail), { exitCode });
      assert.equal(q.kind, want, `${raw} / ${name}: ${q.kind} (${q.reason})`);
    }
  }
});
test('R6-A1: quota precedence: an established outside path is fatal ahead of usage-limit; none established keeps usage-limit', async () => {
  for (const name of ['escaped-second-key-outside', 'resolved-duplicate-outside-first']) {
    const r = await classify(tr(RECEIPT, start(), delta(RAW[name]), quota), { exitCode: 1 });
    assert.equal(r.kind, 'fatal', `${name}: ${r.kind} (${r.reason})`);
  }
  for (const raw of [`{"file_path":"${SAFE}"`, `{"file_path":"${SAFE}","offset":`, `{"file_\\u0070ath":"${SAFE}"`, '{']) {
    assert.equal((await classify(tr(RECEIPT, start(), delta(raw), quota), { exitCode: 1 })).kind, 'usage-limit', raw);
  }
});
test('R6-A1 controls: key order and stopped blocks (canonical forms verify; outside evidence anywhere is fatal)', async () => {
  // Key order: an outside value before or after the image path is fatal; any extra key is never a verified read.
  for (const raw of [`{"pages":"/etc/passwd","file_path":"${SAFE}"}`, `{"file_path":"${SAFE}","pages":"/etc/passwd"}`]) {
    assert.equal((await classify(tr(LINES[0], receiptWith(raw), LINES.slice(2)))).kind, 'fatal', raw);
  }
  for (const raw of [`{"offset":1,"file_path":"${SAFE}"}`, `{"file_path":"${SAFE}","offset":1}`]) {
    assert.equal((await classify(tr(LINES[0], receiptWith(raw), LINES.slice(2)))).kind, 'content-failure', raw);
  }
  // Stopped streamed blocks: a duplicate-key outside path is fatal even though the block closed and the JSON parses.
  for (const raw of [RAW['resolved-duplicate-outside-first'], RAW['resolved-duplicate-outside-last']]) {
    const r = await classify(tr(LINES[0], start('t1', 0), delta(raw, 0), stop(0), LINES.slice(1)));
    assert.equal(r.kind, 'fatal', `stopped ${raw}: ${r.kind} (${r.reason})`);
  }
  // Positive controls: the canonical object, with insignificant whitespace, streamed and stopped or as a completed
  // block, reconciles and verifies; the real CLI's {"file_path":"<abs>"} receipt stays ok.
  for (const raw of [`{"file_path":"${SAFE}"}`, ` { "file_path" :\n"${SAFE}" } `]) {
    const r = await classify(tr(LINES[0], start('t1', 0), delta(raw, 0), stop(0), LINES.slice(1)));
    assert.equal(r.kind, 'ok', `stopped canonical ${JSON.stringify(raw)}: ${r.reason}`);
  }
  assert.equal((await classify(tr(LINES[0], receiptWith(` { "file_path" : "${SAFE}" } `), LINES.slice(2)))).kind, 'ok', 'canonical with whitespace');
  assert.equal((await classify(tr(LINES))).kind, 'ok', 'the ordinary receipt');
  // Ordinary safe-prefix reconciliation and the R4/R5 holds are unchanged.
  for (const raw of ['{', `{"file_path":"${DIR}/`, `{"file_path":"${SAFE}"`]) assert.equal((await classify(tr(LINES[0], start('t1', 0), delta(raw, 0), LINES.slice(1)))).kind, 'ok', `prefix ${raw}`);
  assert.equal((await classify(tr(RECEIPT, start(), delta(`{"file_path":"${SAFE}"`), OK))).kind, 'content-failure');
});
for (const name of ['escaped-second-key-outside', 'resolved-duplicate-outside-first']) {
  test(`R6-A1 probe (phase loop, ${name}): the W is fatal and latches; V is never dispatched, nothing is accepted`, async () => {
    const w = await phaseWorld();
    try {
      let calls = 0;
      const item = w.mkItem('A', 'kA');
      const run = await w.run({ items: [item], execute: async (_bin, _argv, opts) => {
        const n = calls++, lines = w.okStdout(opts.cwd, n === 0 ? w.F.writerResult() : w.F.verification()).split('\n');
        if (n === 0) lines.splice(1, 0, start('t1'), delta(RAW[name].replaceAll(SAFE, `${opts.cwd}/${IMG}`)));
        return { stdout: lines.join('\n') };
      } });
      const state = w.stateOf(run.runId, 'kA');
      assert.equal(calls, 1, `V was dispatched after a W with outside path evidence (${calls} calls)`);
      assert.notEqual(state.status, 'accepted-for-review');
      assert.equal(state.ledger[0].dispatch ?? state.ledger[0].outcome, 'fatal', JSON.stringify(state.ledger[0]));
      assert.ok(run.result.latched || run.result.stoppedAt, JSON.stringify(run.result));
    } finally { w.cleanup(); }
  });
}

let pass = 0; const failed = [];
for (const [name, fn] of tests) {
  try { await fn(); pass++; console.log(`ok   ${name}`); }
  catch (e) { failed.push(name); console.error(`FAIL ${name}\n     ${String(e.message).split('\n')[0].slice(0, 300)}`); }
}
console.log(`teaching-v2-review6.test: ${pass}/${tests.length} checks passed`);
if (failed.length) process.exit(1);
