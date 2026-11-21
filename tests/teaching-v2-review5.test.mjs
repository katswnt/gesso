// Teaching-v2 Phase A: regressions for Codex's round-5 review of 658f8f9 (2026-11-20), R5-A1.
// Replays Codex's probe (codex-codereview/round5-phase-a/archive/tests/review5-stream-edges.mjs). An unfinished
// streamed Read stays unfinished even when a complete safe path token was streamed, and EVERY file_path in its
// fragment is inspected. Classifier checks use synthetic transcripts; the W reproduction drives
// scripts/lib/teaching-v2-phase.mjs end to end with an INJECTED executor. No model call, network or git.
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

// The two closed-path fragments: the path string closes, the invocation does not.
const CLOSED_PATH = {
  'closed path, unfinished object': `{"file_path":"${SAFE}"`,
  'closed path, unfinished next field': `{"file_path":"${SAFE}","offset":`,
};
// Conflicting path evidence in ONE fragment: the safe path followed by a second file_path.
const CONFLICTING = {
  'safe path then unfinished outside second file_path': `{"file_path":"${SAFE}","file_path":"/etc/pa`,
  'safe path then complete outside second file_path': `{"file_path":"${SAFE}","file_path":"/etc/passwd"`,
  'safe path then traversal second file_path': `{"file_path":"${SAFE}","file_path":"${DIR}/../`,
};

test('R5-A1: a successful session with an unfinished Read whose safe path token closed is held, never ok', async () => {
  for (const [label, raw] of Object.entries(CLOSED_PATH)) {
    const r = await classify(tr(RECEIPT, start(), delta(raw), OK));
    assert.equal(r.kind, 'content-failure', `${label}: ${r.kind} (${r.reason})`);
    assert.match(r.reason, /unfinished streamed Read invocation\(s\) extra/);
  }
});
test('R5-A1: with no violation established, quota / timeout / interruption keep their classification', async () => {
  for (const [label, raw] of Object.entries(CLOSED_PATH)) {
    for (const [name, tail, exitCode, want] of [['quota', [quota], 1, 'usage-limit'], ['timeout', [], 'timeout', 'interrupted'], ['nonzero exit', [], 1, 'interrupted']]) {
      const r = await classify(tr(RECEIPT, start(), delta(raw), tail), { exitCode });
      assert.equal(r.kind, want, `${label} / ${name}: ${r.kind} (${r.reason})`);
    }
  }
});
test('R5-A1: an unfinished Read alone never counts as the image receipt, even with its complete path token', async () => {
  for (const [label, raw] of Object.entries(CLOSED_PATH)) {
    const r = await classify(tr(RECEIPT[0], start('t1'), delta(raw), OK));
    assert.equal(r.kind, 'fatal', `${label}: ${r.kind} (${r.reason})`); assert.match(r.reason, /image not inspected/);
  }
});
test('R5-A1: every file_path in the fragment is inspected; a conflicting second path is fatal (success and interruptions)', async () => {
  for (const [label, raw] of Object.entries(CONFLICTING)) {
    for (const [name, tail, exitCode] of [['success', OK, 0], ['quota', [quota], 1], ['timeout', [], 'timeout']]) {
      const r = await classify(tr(RECEIPT, start(), delta(raw), tail), { exitCode });
      assert.equal(r.kind, 'fatal', `${label} / ${name}: ${r.kind} (${r.reason})`);
      assert.match(r.reason, /\/etc\/pa|\.\.\//, `${label} / ${name}: the outside evidence is named`);
    }
  }
  // A completed block of the same id does not launder the conflicting streamed evidence.
  const rest = LINES.slice(1);
  const r = await classify(tr(LINES[0], start('t1', 0), delta(CONFLICTING['safe path then unfinished outside second file_path'], 0), rest));
  assert.equal(r.kind, 'fatal', `reconciled conflicting fragment: ${r.kind} (${r.reason})`);
});
test('R5-A1 controls: outside paths, closed malformed blocks and executed unverifiable inputs stay fatal', async () => {
  for (const [label, extra] of [
    ['complete outside path, unfinished', [start(), delta('{"file_path":"/etc/passwd"')]],
    ['closed safe path, block stopped', [start(), delta(`{"file_path":"${SAFE}"`), stop()]],
    ['executed closed-path fragment', [start(), delta(`{"file_path":"${SAFE}"`), ev({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'extra', content: [{ type: 'image' }] }] } })]],
  ]) {
    const r = await classify(tr(RECEIPT, extra, OK));
    assert.equal(r.kind, 'fatal', `${label}: ${r.kind} (${r.reason})`);
  }
  // The bare '{' control still holds.
  assert.equal((await classify(tr(RECEIPT, start(), delta('{'), OK))).kind, 'content-failure');
});
test('R5-A1 probe (phase loop): a W with an unfinished closed-path Read is held; V is never dispatched, nothing is accepted', async () => {
  const w = await phaseWorld();
  try {
    let calls = 0;
    const item = w.mkItem('A', 'kA');
    const run = await w.run({ items: [item], execute: async (_bin, _argv, opts) => {
      const n = calls++, lines = w.okStdout(opts.cwd, n === 0 ? w.F.writerResult() : w.F.verification()).split('\n');
      if (n === 0) lines.splice(3, 0, start(), delta(`{"file_path":"${opts.cwd}/${IMG}","offset":`));
      return { stdout: lines.join('\n') };
    } });
    const state = w.stateOf(run.runId, 'kA');
    assert.equal(calls, 1, `V was dispatched after an unfinished W Read (${calls} calls)`);
    assert.notEqual(state.status, 'accepted-for-review');
    assert.equal(state.ledger[0].dispatch ?? state.ledger[0].outcome, 'content-failure', JSON.stringify(state.ledger[0]));
  } finally { w.cleanup(); }
});

let pass = 0; const failed = [];
for (const [name, fn] of tests) {
  try { await fn(); pass++; console.log(`ok   ${name}`); }
  catch (e) { failed.push(name); console.error(`FAIL ${name}\n     ${String(e.message).split('\n')[0].slice(0, 300)}`); }
}
console.log(`teaching-v2-review5.test: ${pass}/${tests.length} checks passed`);
if (failed.length) process.exit(1);
