// Teaching-v2 Phase A: regressions for Codex's round-7 review of 321664e (2026-11-20), R7-A1 and R7-A2.
// Replays Codex's probe (codex-codereview/round7-phase-a/archive/tests/review7-copy-evidence.mjs) and its five
// W-to-V phase reproductions, which all reached accepted-for-review on 321664e.
//   R7-A1: every transcript line is parsed by a STRICT parser that rejects duplicate member names at any depth
//          (compared after escape decoding). A duplicate-name record carrying a tool block or an outside path is
//          fatal (ahead of quota); any other duplicate-name record holds the session (never ok).
//   R7-A2: a populated content_block_start input is its own argument copy, kept beside the joined deltas and the
//          completed input; nothing overwrites earlier evidence. Only the exact empty `{}` start is a placeholder.
// Synthetic transcripts and an INJECTED executor; no model call, network or git.
import assert from 'node:assert/strict';
import { DIR, IMG, MODEL, ev, classify, phaseWorld } from './teaching-v2-fixtures.mjs';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const SAFE = `${DIR}/${IMG}`;
const W0 = await phaseWorld(); const LINES = W0.okStdout(DIR, W0.F.writerResult()).split('\n'); W0.cleanup();
// LINES: [0] init, [1] completed Read t1, [2] its image tool_result, [3] StructuredOutput, [4] its result, [5] success.
const tr = (...parts) => parts.flat().join('\n');
const quota = ev({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Claude AI usage limit reached' });
const start = (input, index = 0, id = 't1') => ev({ type: 'stream_event', event: { type: 'content_block_start', index, content_block: { type: 'tool_use', id, name: 'Read', ...(input === undefined ? {} : { input }) } } });
const delta = (text, index = 0) => ev({ type: 'stream_event', event: { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: text } } });
const stop = (index = 0) => ev({ type: 'stream_event', event: { type: 'content_block_stop', index } });
// A completed assistant Read whose block members after name are written byte for byte.
const readLine = (members, safe = SAFE) => `{"type":"assistant","message":{"model":"${MODEL}","content":[{"type":"tool_use","id":"t1","name":"Read",${members.replaceAll('SAFE', safe)}}]}}`;
const canon = '{"file_path":"SAFE"}';
// Tails after the receipt Read: [label, lines, exitCode]. `success` keeps the image result and the successful output.
const TAILS = [['success', LINES.slice(2), 0], ['quota', [LINES[2], quota], 1], ['timeout', [LINES[2]], 'timeout']];

// ---------- R7-A1: duplicate `input` members on a COMPLETED Read block ----------
const COMPLETED = {
  'outside-first': `"input":{"file_path":"/etc/passwd"},"input":${canon}`,
  'outside-last (reversed control)': `"input":${canon},"input":{"file_path":"/etc/passwd"}`,
  'escaped-key outside-first': `"in\\u0070ut":{"file_path":"/etc/passwd"},"input":${canon}`,
  'escaped-key outside-last': `"input":${canon},"in\\u0070ut":{"file_path":"/etc/passwd"}`,
  'harmless extra field first': `"input":{"file_path":"SAFE","offset":1},"input":${canon}`,
  'harmless extra field last': `"input":${canon},"input":{"file_path":"SAFE","offset":1}`,
  'identical canonical copies': `"input":${canon},"input":${canon}`,
};
// With and without a streamed (canonical, `{}`-start) twin of the same id ahead of the completed block, stopped or not.
const TWINS = [['no stream twin', []], ['stopped stream twin', [start({}), delta(JSON.stringify({ file_path: SAFE })), stop()]], ['unstopped stream twin', [start({}), delta(JSON.stringify({ file_path: SAFE }))]]];
test('R7-A1: a duplicate `input` member on a completed Read is fatal in both member orders, escaped or not, harmless or not, in every tail (quota included)', async () => {
  for (const [name, members] of Object.entries(COMPLETED)) {
    for (const [twin, pre] of TWINS) {
      for (const [mode, tail, exitCode] of TAILS) {
        const r = await classify(tr(LINES[0], pre, readLine(members), tail), { exitCode });
        assert.equal(r.kind, 'fatal', `${name} / ${twin} / ${mode}: ${r.kind} (${r.reason})`);
        assert.match(r.reason, /duplicate member name\(s\) "input"/, `${name}: the duplicate is named`);
        if (members.includes('/etc/passwd')) assert.match(r.reason, /\/etc\/passwd/, `${name}: the outside path is named`);
      }
    }
  }
});
test('R7-A1: a duplicate member in a containing envelope (message.content, the event message) cannot discard a Read', async () => {
  const outside = '{"type":"tool_use","id":"t0","name":"Read","input":{"file_path":"/etc/passwd"}}', safe = `{"type":"tool_use","id":"t1","name":"Read","input":{"file_path":"${SAFE}"}}`;
  const lines = [
    `{"type":"assistant","message":{"model":"${MODEL}","content":[${outside}],"content":[${safe}]}}`,
    `{"type":"assistant","message":{"model":"${MODEL}","content":[${outside}]},"message":{"model":"${MODEL}","content":[${safe}]}}`,
    `{"type":"assistant","message":{"model":"${MODEL}","co\\u006etent":[${outside}],"content":[${safe}]}}`,
    `{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":[{"type":"image"}]}]},"type":"user"}`,
  ];
  for (const line of lines) {
    for (const [mode, tail, exitCode] of TAILS) {
      const r = await classify(tr(LINES[0], line, tail), { exitCode });
      assert.equal(r.kind, 'fatal', `${line.slice(0, 90)} / ${mode}: ${r.kind} (${r.reason})`); assert.match(r.reason, /duplicate member name/);
    }
  }
});
test('R7-A1: a duplicate-name record with no tool block and no outside path holds the session: never ok, ahead of quota', async () => {
  const dupNotice = ev({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } }).replace('"status":"allowed"', '"status":"allowed","st\\u0061tus":"allowed"');
  const dupImageOnly = `{"type":"system","subtype":"note","p":"${SAFE}","p":"${IMG}"}`;
  for (const line of [dupNotice, dupImageOnly]) {
    const ok = await classify(tr(LINES[0], line, LINES.slice(1)));
    assert.equal(ok.kind, 'content-failure', `success + ${line}: ${ok.kind} (${ok.reason})`); assert.match(ok.reason, /duplicate member names.*held \(otherwise ok\)/);
    const q = await classify(tr(LINES.slice(0, 3), line, quota), { exitCode: 1 });
    assert.equal(q.kind, 'content-failure', `quota + ${line}: ${q.kind} (${q.reason})`); assert.match(q.reason, /otherwise usage-limit/);
    // A fatal finding still outranks the hold.
    const f = await classify(tr(LINES[0], line, readLine('"input":{"file_path":"/etc/passwd"}'), LINES.slice(2)));
    assert.equal(f.kind, 'fatal', `outside Read + ${line}: ${f.kind}`);
  }
  // A duplicate-name record naming any other path, or a duplicated init (its cwd is a path), is fatal.
  for (const line of ['{"type":"system","subtype":"note","path":"/etc/passwd","path":"x"}', LINES[0].replace('"apiKeySource":"none"', '"apiKeySource":"none","apiKeySource":"none"')]) {
    const r = await classify(tr(LINES[0], line, LINES.slice(1)));
    assert.equal(r.kind, 'fatal', `${line.slice(0, 80)}: ${r.kind} (${r.reason})`);
  }
});

// ---------- R7-A2: a populated content_block_start input is kept as evidence ----------
const STARTS = { 'outside start': { file_path: '/etc/passwd' }, 'extra-field start': { file_path: SAFE, offset: 1 } };
// [label, stopped, completed twin]
const SHAPES = [['delta only', false, false], ['delta + stop', true, false], ['delta + completed twin', false, true], ['delta + stop + completed twin', true, true]];
const startTranscript = (input, stopped, twin, tail) => tr(LINES[0], start(input), delta(JSON.stringify({ file_path: SAFE })), stopped ? [stop()] : [], twin ? [LINES[1]] : [], tail);
test('R7-A2: a populated start naming an outside path is fatal whatever safe deltas or completed twin follow, ahead of quota', async () => {
  for (const [shape, stopped, twin] of SHAPES) {
    for (const [mode, tail, exitCode] of TAILS) {
      const r = await classify(startTranscript(STARTS['outside start'], stopped, twin, tail), { exitCode });
      assert.equal(r.kind, 'fatal', `outside start / ${shape} / ${mode}: ${r.kind} (${r.reason})`); assert.match(r.reason, /\/etc\/passwd/);
    }
  }
});
test('R7-A2: a populated non-canonical start (an extra field) is never a verified image read: success holds; quota/timeout keep their kind; empty-start controls stay ok', async () => {
  for (const [shape, stopped, twin] of SHAPES) {
    const r = await classify(startTranscript(STARTS['extra-field start'], stopped, twin, LINES.slice(2)));
    assert.equal(r.kind, 'content-failure', `extra-field start / ${shape}: ${r.kind} (${r.reason})`); assert.match(r.reason, /non-canonical Read argument evidence/);
    assert.equal((await classify(startTranscript(STARTS['extra-field start'], stopped, twin, [LINES[2], quota]), { exitCode: 1 })).kind, 'usage-limit', `${shape} / quota`);
    assert.equal((await classify(startTranscript(STARTS['extra-field start'], stopped, twin, [LINES[2]]), { exitCode: 'timeout' })).kind, 'interrupted', `${shape} / timeout`);
  }
  // Only the exact empty `{}` start is a placeholder: a start with NO input is not, even when canonical deltas follow.
  const r = await classify(tr(LINES[0], start(undefined), delta(JSON.stringify({ file_path: SAFE })), stop(), LINES.slice(1)));
  assert.equal(r.kind, 'content-failure', `start without input: ${r.kind} (${r.reason})`);
  // Controls: the ordinary empty `{}` start stays a placeholder, and a canonical copy everywhere stays ok. A populated
  // start that is itself exactly the canonical object passes the allowlist like any other canonical copy.
  const D = delta(JSON.stringify({ file_path: SAFE }));
  for (const [name, lines] of [
    ['{} + delta + stop + twin', [start({}), D, stop(), LINES[1]]], ['{} + delta + twin', [start({}), D, LINES[1]]],
    ['{} + twin', [start({}), LINES[1]]], ['{} + split deltas + stop + twin', [start({}), delta('{"file_path":'), delta(`"${SAFE}"}`), stop(), LINES[1]]],
    ['{} (whitespace) + delta + stop + twin', [start({}).replace('"input":{}', '"input":{ \t}'), D, stop(), LINES[1]]],
    ['canonical populated start + delta + stop + twin', [start({ file_path: SAFE }), D, stop(), LINES[1]]],
  ]) {
    const r = await classify(tr(LINES[0], lines, LINES.slice(2)));
    assert.equal(r.kind, 'ok', `${name}: ${r.kind} (${r.reason})`);
    assert.equal((await classify(tr(LINES[0], lines, LINES[2], quota), { exitCode: 1 })).kind, 'usage-limit', `${name} / quota`);
  }
});

// ---------- W-to-V phase regressions: Codex's five reproductions ----------
const PHASE = {
  'completed-duplicate-input-outside-first': ['fatal', (lines, safe) => { lines[1] = readLine(COMPLETED['outside-first'], safe); }],
  'completed-duplicate-input-offset-first': ['fatal', (lines, safe) => { lines[1] = readLine(COMPLETED['harmless extra field first'], safe); }],
  'completed-escaped-duplicate-input-outside-first': ['fatal', (lines, safe) => { lines[1] = readLine(COMPLETED['escaped-key outside-first'], safe); }],
  'stream-start-outside-then-safe-delta': ['fatal', (lines, safe) => { lines.splice(1, 0, start({ file_path: '/etc/passwd' }), delta(JSON.stringify({ file_path: safe })), stop()); }],
  'stream-start-offset-then-safe-delta': ['content-failure', (lines, safe) => { lines.splice(1, 0, start({ file_path: safe, offset: 1 }), delta(JSON.stringify({ file_path: safe })), stop()); }],
};
for (const [name, [want, mutate]] of Object.entries(PHASE)) {
  test(`R7 probe (phase loop, ${name}): W is ${want}; V is never dispatched and nothing is accepted`, async () => {
    const w = await phaseWorld();
    try {
      let calls = 0;
      const item = w.mkItem('A', 'kA');
      const run = await w.run({ items: [item], execute: async (_bin, _argv, opts) => {
        const n = calls++, lines = w.okStdout(opts.cwd, n === 0 ? w.F.writerResult() : w.F.verification()).split('\n');
        if (n === 0) mutate(lines, `${opts.cwd}/${IMG}`);
        return { stdout: lines.join('\n') };
      } });
      const state = w.stateOf(run.runId, 'kA');
      assert.equal(calls, 1, `V was dispatched after the W (${calls} calls)`);
      assert.notEqual(state.status, 'accepted-for-review');
      assert.equal(state.ledger[0].dispatch ?? state.ledger[0].outcome, want, JSON.stringify(state.ledger[0]));
      if (want === 'fatal') assert.ok(run.result.latched || run.result.stoppedAt, JSON.stringify(run.result));
      const verified = await w.P.verifyRun({ phaseDir: w.phaseDir, runId: run.runId, items: [item], gold: w.F.gold, renderFor: () => w.F.render });
      // A fatal W is uncleared evidence, so replay refuses it; a held W replays as the hold it is (never an acceptance).
      if (want === 'fatal') assert.equal(verified.ok, false, 'replay verification must refuse the uncleared fatal');
      else assert.notEqual(w.stateOf(run.runId, 'kA').status, 'accepted-for-review');
    } finally { w.cleanup(); }
  });
}

let pass = 0; const failed = [];
for (const [name, fn] of tests) {
  try { await fn(); pass++; console.log(`ok   ${name}`); }
  catch (e) { failed.push(name); console.error(`FAIL ${name}\n     ${String(e.message).split('\n')[0].slice(0, 300)}`); }
}
console.log(`teaching-v2-review7.test: ${pass}/${tests.length} checks passed`);
if (failed.length) process.exit(1);
