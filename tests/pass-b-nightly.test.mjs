// Offline job regressions: real stage planning/derivation with injected calls, isolated evidence only.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { OPTS, stageBinding, stageRunId, planS1, planS2 } from '../scripts/pass-b-claim-first.mjs';
import * as CF_RUNNER from '../scripts/pass-b-claim-first.mjs';
import { runAudit, auditHistory } from '../scripts/pass-b-shadow-audit.mjs';
import { advanceWork, workStatus, nightlyFatal, copyArtifact, copyExists, preserveCopy, collectRemaining, finishedCopyNames, copyName, runPool, sharedSnapshots } from '../scripts/pass-b-nightly.mjs';
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
const run = key => { if (key === 'S2R') return { ...CF_RUNNER.s2RetryRun([]), now }; const binding = stageBinding(key, []), runId = stageRunId(binding); return { binding, runId, outDir: join(RUN_ROOT, runId), now }; };
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
{ // write /6 copy gets its own file; /5 keeps its original path and shape
  const a5 = copyArtifact('w1', '2026-10-01', { why: 'x' }, '/o', 'passBClaimFirstWrite/5'), a6 = copyArtifact('w1', '2026-10-01', { why: 'x' }, '/o', 'passBClaimFirstWrite/6');
  assert.ok(a5.path.endsWith(`${sha256('w1').slice(0, 24)}.json`) && a5.body.version === 'passBClaimFirstCopy/1' && !('write' in a5.body));
  assert.ok(a6.path.endsWith(`${sha256('w1').slice(0, 24)}.w6.a${CF.ASSEMBLE_VERSION}.json`) && a6.body.version === 'passBClaimFirstCopy/2' && a6.body.write === 'passBClaimFirstWrite/6' && a6.body.assemble === CF.ASSEMBLE_VERSION);
  console.log('ok write /6 copy artifacts are versioned and never collide with /5 copy');
}
{ // VSD-057: S2's pre-cap run is an equivalent history source (same binding except the B3 wire-schema hash)
  const runs = CF_RUNNER.equivalentRuns('S2', []);
  assert.equal(runs.length, 3); assert.equal(runs[1].runId, 'cf-1d898d84282f');
  const { wireSchemaSha256: _a, ...x } = runs[0].binding, { wireSchemaSha256: _b, ...y } = runs[1].binding; assert.deepEqual(x, y);
  const { retry, ...z } = runs[2].binding; assert.equal(retry, CF_RUNNER.S2_RETRY); assert.deepEqual(z, runs[0].binding, 'VSD-075 retry run: same binding plus the retry tag');
  assert.equal(CF_RUNNER.equivalentRuns('S3', []).length, 1, 'no other stage gains an alias');
  console.log('ok S2 pre-cap run resolves to cf-1d898d84282f and differs only in the wire-schema hash');
}
await check('VSD-070: four works advanced concurrently through the real stages each finish with one attempt per stage, shared pacer', async () => {
  const pacer = makePacer({ logPath: null, maxCalls: 100, opts: { probeCalls: 100 } }); let calls = 0;
  const slowCall = (key, p) => runAudit({ ...run(key), plans: [p], pacer,
    callFn: async () => { calls++; await new Promise(r => setTimeout(r, 3)); return { transcript: transcript(p, output(key)), exitCode: 0 }; } });
  const ids = ['c1', 'c2', 'c3', 'c4'], results = {};
  await runPool(ids, 3, async id => { results[id] = await advanceWork({ base: base(id), call: slowCall, saveCopy: () => {} }); }, () => false);
  assert.ok(ids.every(id => results[id].finished), JSON.stringify(results));
  assert.equal(calls, 20); assert.equal(pacer.calls, 20); // 5 stages x 4 works, every call through the one pacer
  for (const id of ids) assert.equal((await advanceWork({ base: base(id), call: () => { throw new Error('must not call'); }, saveCopy: () => {} })).finished, true);
});
// VSD-075: S2 output lost in transit (exit 0, init, no result event) gets exactly one more S2 call in the retry run.
const lost = (p, o) => transcript(p, o).split('\n').slice(0, 3).join('\n').slice(0, -20); // cut inside the image line
const s2Then = (first, retry) => { const keys = []; return { keys, call: (key, p) => { keys.push(key); return runAudit({ ...run(key), plans: [p],
  callFn: async () => ({ transcript: key === 'S2' ? first(p, output('S2')) : key === 'S2R' ? retry(p, output('S2')) : transcript(p, output(key)), exitCode: 0 }) }); } }; };
await check('VSD-075: an S2 that lost its output gets one retry; an accepted retry carries the work to copy', async () => {
  const b = base('lost'), c = s2Then(lost, transcript);
  const r = await advanceWork({ base: b, call: c.call, saveCopy: () => {} });
  assert.equal(r.finished, true, JSON.stringify(r)); assert.deepEqual(c.keys, ['S1', 'S2', 'S2R', 'SI', 'S3', 'S4']);
  assert.equal(auditHistory(run('S2').outDir, planS2(b), run('S2').runId).kind, 'held', 'the original outcome is never edited');
  assert.equal((await advanceWork({ base: b, call: () => { throw new Error('must not call'); }, saveCopy: () => {} })).finished, true);
});
await check('VSD-075: a retry that also fails is final (never a third S2 call)', async () => {
  const b = base('lost2'), c = s2Then(lost, lost);
  assert.equal((await advanceWork({ base: b, call: c.call, saveCopy: () => {} })).terminal, true); assert.deepEqual(c.keys, ['S1', 'S2', 'S2R']);
  assert.equal(workStatus(b).next, 'terminal');
  assert.equal((await advanceWork({ base: b, call: () => { throw new Error('must not call'); }, saveCopy: () => {} })).terminal, true);
});
await check('VSD-075: an S2 held for its content (the call finished) is never retried', async () => {
  const noAnswer = (p, o) => transcript(p, o).replace(/,"structured_output":\{[^}]*\}/, '').replace(/\n[^\n]*"name":"StructuredOutput"[^\n]*/, '');
  const b = base('held'), c = s2Then(noAnswer, transcript);
  assert.equal((await advanceWork({ base: b, call: c.call, saveCopy: () => {} })).terminal, true); assert.deepEqual(c.keys, ['S1', 'S2']);
  assert.equal(auditHistory(run('S2').outDir, planS2(b), run('S2').runId).kind, 'held');
});
await check('VSD-071: a page that downloads only after S1 was reserved stays out of that work (no frozen-input stop)', async () => {
  const b = { ...base('late'), b2: { factChecks: [{ claimId: 'c1', claim: 'The painting shows a red cup resting on a wooden table', sources: [{ sourceId: 's1', url: 'https://example.org/late-page' }] }] } };
  let calls = 0;
  const first = await advanceWork({ base: b, saveCopy: () => {}, call: async (key, p) => calls++ < 2 ? call(key, p) : { stop: 'pacing: session call cap reached' } });
  assert.match(first.stop, /pacing/); // S1 and S2 done, then the run's cap stopped this work mid-way
  const snap = join(RUN_ROOT, 'claim-first-v1', 'snapshots'), key = sha256('https://example.org/late-page').slice(0, 24);
  const raw = Buffer.from('<html><body><p>The painting shows a red cup resting on a wooden table, painted in 1650.</p></body></html>');
  mkdirSync(snap, { recursive: true }); writeFileSync(join(snap, `${key}.raw`), raw);
  writeFileSync(join(snap, `${key}.meta.json`), JSON.stringify({ url: 'https://example.org/late-page', rawSha256: sha256(raw), contentType: 'text/html', ok: true }));
  assert.notEqual(workStatus(b).next, 'terminal'); // before VSD-071: throws "frozen input changed since reservation"
  const rest = await advanceWork({ base: b, call, saveCopy: () => {} });
  assert.equal(rest.finished, true);
});
// VSD-070 (2026-11-01): finished copy is found by name in any date folder, so runs skip it without re-verifying or re-pushing.
await check('finished copy is recognised by file name in any date folder', async root => {
  const out = join(root, 'out'), a = copyArtifact('w1', '2026-11-03', { why: 'x' }, out);
  mkdirSync(dirname(a.path), { recursive: true }); writeFileSync(a.path, '{}');
  assert.equal(copyName('w1'), basename(a.path)); // the date folder plays no part in the name
  const names = finishedCopyNames(out);
  assert.ok(names.has(copyName('w1'))); assert.ok(!names.has(copyName('w2')));
  assert.equal(finishedCopyNames(join(root, 'none')).size, 0);
});
await check('worker pool: at most N works at once, priority order kept, no new work after a stop', async () => {
  let live = 0, peak = 0; const started = [];
  await runPool([1, 2, 3, 4, 5, 6, 7], 3, async id => { started.push(id); live++; peak = Math.max(peak, live); await new Promise(r => setTimeout(r, 5)); live--; }, () => false);
  assert.equal(peak, 3); assert.deepEqual(started, [1, 2, 3, 4, 5, 6, 7]);
  let stop = false; const seen = [];
  await runPool([1, 2, 3, 4, 5, 6, 7], 2, async id => { seen.push(id); await new Promise(r => setTimeout(r, 5)); if (id === 2) stop = true; }, () => stop);
  assert.deepEqual(seen, [1, 2, 3]); // 1 and 2 start together; 3 starts when 1 finishes before 2 stops; nothing after the stop
});
await check('concurrent works citing the same source fetch it once', async () => {
  let fetches = 0; const snap = sharedSnapshots(async url => { fetches++; await new Promise(r => setTimeout(r, 5)); return { url, ok: true }; });
  const [x, y] = await Promise.all([snap('https://a.example/p', 'd'), snap('https://a.example/p', 'd')]);
  assert.equal(fetches, 1); assert.equal(x, y);
});
console.log(`pass-b-nightly.test: ${n} checks passed`);
