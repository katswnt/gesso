// Offline job regressions: real stage planning/derivation with injected calls, isolated evidence only.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { OPTS, stageBinding, stageRunId, planS1, planS2 } from '../scripts/pass-b-claim-first.mjs';
import { runAudit, auditHistory } from '../scripts/pass-b-shadow-audit.mjs';
import { advanceWork, workStatus, nightlyFatal, copyArtifact, copyExists, preserveCopy, collectRemaining } from '../scripts/pass-b-nightly.mjs';
import { RUN_ROOT } from '../scripts/lib/pass-b-calibration.mjs';
import { sha256 } from '../scripts/lib/vision-legacy.mjs';
import { makePacer } from '../scripts/lib/pass-b-pacing.mjs';
import * as CF from '../scripts/lib/pass-b-claim-first.mjs';

let n = 0;
const now = () => new Date('2026-09-30T10:00:00Z');
const check = async (name, fn) => {
  const cwd = process.cwd(), root = mkdtempSync(join(tmpdir(), 'nightly-test-'));
  try { process.chdir(root); OPTS.nightly = true; OPTS.identities = true; await fn(root); n++; }
  catch (e) { console.error(`FAIL ${name}`); throw e; }
  finally { process.chdir(cwd); rmSync(root, { recursive: true, force: true }); }
};
const base = id => {
  const dir = join('base', id); mkdirSync(join(dir, 'completions'), { recursive: true });
  return { id, dir, catalog: {}, b1: {}, b2: { factChecks: [] }, b0: { image: { imgSha256: '0'.repeat(64), ext: 'png' } }, binding: { source: id } };
};
const run = key => { const binding = stageBinding(key, []), runId = stageRunId(binding); return { binding, runId, outDir: join(RUN_ROOT, runId), now }; };
const output = key => key === 'S2' ? { verifications: [] } : key === 'SI' ? { v: CF.IDENT_VERSION, ids: [] }
  : key === 'S3' ? { v: CF.WRITE_VERSION, why: [], notes: [], hotspots: [] } : { v: key === 'S4' ? CF.CHECK_VERSION : CF.S1.version, j: [] };
const transcript = (p, o, source = 'none') => [
  { type: 'system', subtype: 'init', apiKeySource: source, model: OPTS.model, tools: p.stageSpec.allowedTools },
  ...(p.imageFile ? [
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', id: 'r', input: { file_path: `./${p.imageFile}` } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'r', content: [{ type: 'image' }] }] } },
  ] : []),
  { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'StructuredOutput', id: 's', input: o }] } },
  { type: 'result', subtype: 'success', is_error: false, structured_output: o, modelUsage: { [OPTS.model]: { output_tokens: 1 } } },
].map(e => JSON.stringify(e)).join('\n');
const call = (key, p) => runAudit({ ...run(key), plans: [p], callFn: async () => ({ transcript: transcript(p, output(key)), exitCode: 0 }) });

await check('two works enter each stable stage, and a complete resume makes zero calls', async () => {
  for (const id of ['a', 'b']) {
    const b = base(id); let calls = 0;
    const result = await advanceWork({ base: b, call: async (key, p) => { calls++; const r = await call(key, p); assert.equal(r.accepted, 1, JSON.stringify(r)); return r; }, saveCopy: () => {} });
    assert.equal(result.finished, true); assert.equal(calls, 5); // SJ is inapplicable with no identities
    assert.equal((await advanceWork({ base: b, call: () => { throw new Error('must not call'); }, saveCopy: () => {} })).finished, true);
  }
});
await check('incremental inputs remain frozen, including prompt and source binding', async () => {
  const p = planS1(base('a')); await call('S1', p);
  for (const changed of [{ ...p, input: { changed: true } }, { ...p, promptHash: 'changed' }, { ...p, binding: { changed: true } }])
    await assert.rejects(runAudit({ ...run('S1'), plans: [changed], callFn: () => { throw new Error('must not call'); } }), /frozen input/);
});
await check('fixed-trial manifests still reject a new work', async () => {
  const p = planS1(base('a')), q = planS1(base('b'));
  const args = { ...run('S1'), binding: { version: 'fixed-trial', maxReservations: 4 }, callFn: async () => { throw new Error('interruption'); } };
  await runAudit({ ...args, plans: [p] });
  await assert.rejects(runAudit({ ...args, plans: [q] }), /frozen input changed/);
});
await check('preserved S2 fatal, including with its marker deleted, prevents an absent S1 from spending', async () => {
  const b = base('a'), p = planS2(b), r = run('S2');
  const result = await runAudit({ ...r, plans: [p], callFn: async () => ({ transcript: transcript(p, output('S2'), 'api-key'), exitCode: 0 }) });
  assert.equal(result.fatal, 1);
  assert.equal(workStatus(b).next, 'terminal');
  const opts = { runDir: 'absent-corpus' };
  assert.match(nightlyFatal(opts), /preserved-fatal/);
  rmSync(join(r.outDir, 'fatal.json'));
  assert.match(nightlyFatal(opts), /preserved-fatal/);
  let calls = 0;
  const stopped = await advanceWork({ base: b, safetyCheck: () => nightlyFatal(opts), call: async () => { calls++; }, saveCopy: () => {} });
  assert.match(stopped.stop, /preserved-fatal/); assert.equal(calls, 0);
});
await check('a fatal on a later work blocks an earlier work in a different stage', async () => {
  const p = planS2(base('later'));
  await runAudit({ ...run('S2'), plans: [p], callFn: async () => ({ transcript: transcript(p, output('S2'), 'api-key'), exitCode: 0 }) });
  let calls = 0;
  const r = await runAudit({ ...run('S1'), plans: [planS1(base('earlier'))], beforeReserve: () => nightlyFatal({ runDir: 'absent' }), callFn: async () => { calls++; } });
  assert.match(r.stop, /preserved-fatal/); assert.equal(calls, 0);
});
await check('a fatal outside the window in the verified corpus blocks claim-first', () => {
  assert.match(nightlyFatal({ runDir: 'absent', inspection: { fatal: 'outside-window/B3' } }), /outside-window/);
});
await check('unknown and held S1 are terminal even when S2 is missing', async () => {
  for (const [id, fn, kind] of [['unknown', async () => { throw new Error('spent then crashed'); }, 'unknown-outcome'],
    ['held', async p => ({ transcript: transcript(p, { v: 'wrong-version', j: [] }), exitCode: 0 }), 'held']]) {
    const b = base(id), p = planS1(b);
    await runAudit({ ...run('S1'), plans: [p], callFn: fn });
    assert.equal(auditHistory(run('S1').outDir, p, run('S1').runId).kind, kind);
    const r = await advanceWork({ base: b, call: () => { throw new Error('must not call S2'); }, saveCopy: () => {} });
    assert.equal(r.terminal, true);
  }
});
await check('persistence failures stop the work before sibling or subsequent stages', async () => {
  let calls = 0;
  const r = await advanceWork({ base: {}, statusOf: () => ({ next: 'S1S2', s1: {}, s2: {} }), saveCopy: () => {},
    call: async () => { calls++; return { stop: 'persist-failed: fixture' }; } });
  assert.equal(calls, 1); assert.match(r.stop, /^persist-failed/);
});
await check('crash after accepted S4: reconstruct and validate copy without another call', async root => {
  const b = base('a'); await advanceWork({ base: b, call, saveCopy: () => {} }); // killed before copy write
  const artifact = copyArtifact(b.id, '2026-10-01', workStatus(b).copy, root);
  assert.equal(copyExists(artifact), false);
  await advanceWork({ base: b, call: () => { throw new Error('must not call'); }, saveCopy: () => preserveCopy(artifact) });
  assert.equal(copyExists(artifact), true);
  const bytes = readFileSync(artifact.path, 'utf8'); preserveCopy(artifact); assert.equal(readFileSync(artifact.path, 'utf8'), bytes);
  writeFileSync(artifact.path, '{}'); assert.throws(() => copyExists(artifact), /differs from verified stages/);
});
await check('crossing the start cutoff during reservation persistence spends no call', async () => {
  const p = planS1(base('cutoff')); let reads = 0, calls = 0;
  const result = await runAudit({ ...run('S1'), plans: [p],
    now: () => new Date(++reads <= 2 ? '2026-09-30T15:29:59Z' : '2026-09-30T15:30:01Z'),
    callFn: async () => { calls++; } });
  assert.equal(calls, 0); assert.equal(result.stop, 'protected-hours');
  assert.equal(auditHistory(run('S1').outDir, p, run('S1').runId).kind, 'unknown-outcome');
});
await check('collector receives only remaining local allowance and errors propagate', async root => {
  const p = makePacer({ logPath: join(root, 'missing'), maxCalls: 30, now }); p.check(); p.check();
  let max;
  await collectRemaining({ pacer: p, execute: async (bin, args, opts) => { max = opts.env.PASS_B_MAX_CALLS; return { stdout: 'ok' }; } });
  assert.equal(max, '28');
  await assert.rejects(collectRemaining({ pacer: p, execute: async () => { throw new Error('collector fatal'); } }), /collector fatal/);
  let calls = 0;
  await collectRemaining({ pacer: { remaining: 0 }, execute: async () => { calls++; } }); assert.equal(calls, 0);
});
console.log(`pass-b-nightly.test: ${n} checks passed`);
