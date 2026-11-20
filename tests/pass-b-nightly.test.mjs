// Offline job regressions: real stage planning/derivation with injected calls, isolated evidence only.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { OPTS, stageBinding, stageRunId, planS1, planS2 } from '../scripts/pass-b-claim-first.mjs';
import * as CF_RUNNER from '../scripts/pass-b-claim-first.mjs';
import { runAudit, auditHistory } from '../scripts/pass-b-shadow-audit.mjs';
import { advanceWork, workStatus, nightlyFatal, copyArtifact, copyExists, preserveCopy, collectRemaining, finishedCopyNames, copyName, copyState, reassembledCopy, KEPT_WRITES, topFameIds, TOP_REWRITE, runPool, sharedSnapshots, CLEAN_STOP, pushStop, collectorPushFailure, runDeadline, RUN_DEADLINE_MIN } from '../scripts/pass-b-nightly.mjs';
import { PersistError } from '../scripts/lib/pass-b-remote-evidence.mjs';
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
  assert.equal(runs.length, 4); assert.equal(runs[1].runId, 'cf-1d898d84282f');
  const { wireSchemaSha256: _a, ...x } = runs[0].binding, { wireSchemaSha256: _b, ...y } = runs[1].binding; assert.deepEqual(x, y);
  const { retry, ...z } = runs[2].binding; assert.equal(retry, CF_RUNNER.S2_RETRY); assert.deepEqual(z, runs[0].binding, 'VSD-075 retry run: same binding plus the retry tag');
  for (const k of ['S1', 'S2', 'SI', 'SJ', 'S3', 'S4']) { // VSD-085: each stage's only alias is its outage-retry run
    const rs = CF_RUNNER.equivalentRuns(k, []), r = k === 'SI' ? rs[1] : rs.at(-1), { retry: tag, ...rest } = r.binding;
    assert.equal(rs.length, k === 'S2' || k === 'SI' ? 4 : 2); assert.equal(tag, CF_RUNNER.OUTAGE_RETRY); assert.deepEqual(rest, rs[0].binding);
  }
  // VSD-088: SI's earlier run (the prompt before the "added later" rule) and its retry run stay history sources
  const si = CF_RUNNER.equivalentRuns('SI', []), { promptSha256: p0, ...cur } = si[0].binding, { promptSha256: p2, ...old } = si[2].binding;
  assert.deepEqual(old, cur); assert.equal(p2, sha256(CF.IDENT_PROMPT_V2)); assert.notEqual(p0, p2);
  assert.equal(si[3].binding.retry, CF_RUNNER.OUTAGE_RETRY); assert.ok(si[2].planOf && si[3].retry);
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
// VSD-085: a stage the provider refused (429 usage limit / API error, VSD-072) gets exactly one more call in a later run.
const refused = status => p => [
  { type: 'system', subtype: 'init', model: OPTS.model, apiKeySource: 'none', tools: p.stageSpec.allowedTools },
  { type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text: `API Error: ${status} Overloaded.` }] }, error: 'server_error' },
  { type: 'result', subtype: 'success', is_error: true, result: `API Error: ${status} Overloaded.`, api_error_status: status, terminal_reason: 'api_error',
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, modelUsage: {}, num_turns: 1 },
].map(e => JSON.stringify(e)).join('\n');
const runFor = key => key.startsWith('retry:') ? { ...CF_RUNNER.outageRetryRun(key.slice(6), []), now } : run(key);
const scripted = script => { const keys = []; return { keys, call: (key, p) => { keys.push(key); const t = script[key];
  return runAudit({ ...runFor(key), plans: [p], callFn: async () => t ? { transcript: t(p), exitCode: 1 } : { transcript: transcript(p, output(key.replace('retry:', ''))), exitCode: 0 } }); } }; };
const s3Plan = b => { const s2 = planS2(b), sj = CF_RUNNER.planSJ(b, [], CF_RUNNER.planSI(b, [], s2)); return CF_RUNNER.planS3(b, [], planS1(b), s2, sj).plan; };
const never = { call: () => { throw new Error('must not call'); }, saveCopy: () => {} };
await check('VSD-085: an S3 refused with a 429 is retried once in a later run, and an accepted retry carries the work to copy', async () => {
  const b = base('limit'), c = scripted({ S3: refused(429) });
  assert.equal((await advanceWork({ base: b, call: c.call, saveCopy: () => {} })).stop, 'usage-limit'); // clean stop, slot used
  assert.deepEqual(workStatus(b).stages.map(([k]) => k), ['retry:S3'], 'not terminal: its one retry is due');
  const r = await advanceWork({ base: b, call: c.call, saveCopy: () => {} });
  assert.equal(r.finished, true, JSON.stringify(r)); assert.deepEqual(c.keys, ['S1', 'S2', 'SI', 'S3', 'retry:S3', 'S4']);
  assert.equal(CF_RUNNER.stageHistory('S3', [], s3Plan(b)).kind, 'accepted');
  assert.equal(auditHistory(run('S3').outDir, s3Plan(b), run('S3').runId).kind, 'usage-limit', 'the original outcome is never edited');
  assert.equal((await advanceWork({ base: b, ...never })).finished, true);
});
await check('VSD-085: a retry the provider refuses again is final (never a third call)', async () => {
  const b = base('limit2'), c = scripted({ S4: refused(529), 'retry:S4': refused(429) });
  assert.equal((await advanceWork({ base: b, call: c.call, saveCopy: () => {} })).stop, 'api-error');
  assert.equal((await advanceWork({ base: b, call: c.call, saveCopy: () => {} })).stop, 'usage-limit');
  assert.deepEqual(c.keys, ['S1', 'S2', 'SI', 'S3', 'S4', 'retry:S4']);
  assert.equal(workStatus(b).next, 'terminal'); assert.equal((await advanceWork({ base: b, ...never })).terminal, true);
});
await check('VSD-085: a refused S1 is retried before its never-run S2; held and unknown outcomes are never retried', async () => {
  const b = base('s1'), c = scripted({ S1: refused(529) });
  assert.equal((await advanceWork({ base: b, call: c.call, saveCopy: () => {} })).stop, 'api-error'); assert.deepEqual(c.keys, ['S1'], 'S2 spends nothing after the stop');
  assert.equal((await advanceWork({ base: b, call: c.call, saveCopy: () => {} })).finished, true); assert.deepEqual(c.keys, ['S1', 'retry:S1', 'S2', 'SI', 'S3', 'S4']);
  const h = base('held'), ch = scripted({ S3: p => transcript(p, { v: 'wrong' }) });
  assert.equal((await advanceWork({ base: h, call: ch.call, saveCopy: () => {} })).terminal, true); assert.equal(workStatus(h).next, 'terminal');
  const u = base('unknown'), cu = { keys: [], call: (key, p) => { cu.keys.push(key); return runAudit({ ...runFor(key), plans: [p], callFn: async () => { if (key === 'S4') throw new Error('lost'); return { transcript: transcript(p, output(key)), exitCode: 0 }; } }); } };
  assert.equal((await advanceWork({ base: u, call: cu.call, saveCopy: () => {} })).terminal, true); assert.deepEqual(cu.keys, ['S1', 'S2', 'SI', 'S3', 'S4']);
});
// ---------- fix v1 (VSD-086–088): new inputs only for works not yet frozen; SI's earlier run stays history ----------
const fixBase = id => Object.assign(base(id), {
  b2: { factChecks: [], guideAnswers: [{ questionId: 'ga1', a: 'The eye at the top was added later by another painter.', sourceRefs: [] }] },
  b1: { noteCandidates: [{ noteId: 'n1', body: 'Three figures kneel at the left.', pin: { x: 20, y: 50 }, confidence: 0.9 }] } });
await check('fix v1 (VSD-087/088): a work frozen before the S1/S2 change keeps its plans; a new work gets guide pairs and cleaned requests', async () => {
  const old = fixBase('old'), p1 = planS1(old, { guidePairs: false }), p2 = planS2(old, { legacyRequests: true });
  assert.notEqual(p1.inputSha256, planS1(old, { guidePairs: true }).inputSha256); assert.notEqual(p2.promptHash, planS2(old, { legacyRequests: false }).promptHash);
  await call('S1', p1); await call('S2', p2); // frozen and answered under the earlier inputs
  assert.equal(planS1(old).inputSha256, p1.inputSha256); assert.equal(planS2(old).promptHash, p2.promptHash);
  assert.equal(workStatus(old).next, 'SI', 'their history is found: no second S1 or S2');
  const fresh = fixBase('fresh');
  assert.deepEqual(planS1(fresh).input.pairs.map(x => x.id), ['ga1.1']);
  assert.equal(planS2(fresh).promptHash, planS2(fresh, { legacyRequests: false }).promptHash);
  assert.throws(() => auditHistory(run('S1').outDir, planS1(old, { guidePairs: true }), run('S1').runId), /frozen input changed/, 'a genuine change still fails closed');
});
await check('fix v1 (VSD-088): a work identified under the earlier SI prompt keeps that result; its retry run counts, so never a third call', async () => {
  const legacy = CF_RUNNER.equivalentRuns('SI', []).slice(2).map(r => ({ ...r, now }));
  const answer = (r, plan, t) => runAudit({ ...r, plans: [plan], callFn: async () => t ? { transcript: t(plan), exitCode: 1 } : { transcript: transcript(plan, output('SI')), exitCode: 0 } });
  const b = base('si-old'); await call('S1', planS1(b)); await call('S2', planS2(b));
  const si = CF_RUNNER.planSI(b, [], planS2(b));
  assert.equal(workStatus(b).next, 'SI'); assert.notEqual(si.promptHash, si.legacy.promptHash);
  await answer(legacy[0], si.legacy);
  assert.equal(workStatus(b).next, 'S3', 'identified in the earlier run: no new SI call');
  const r = base('si-refused'); await call('S1', planS1(r)); await call('S2', planS2(r));
  const sr = CF_RUNNER.planSI(r, [], planS2(r));
  await answer(legacy[0], sr.legacy, refused(529));
  assert.deepEqual(workStatus(r).stages.map(([k]) => k), ['retry:SI'], 'refused in the earlier run: its one retry is due');
  await answer(legacy[1], sr.legacy, refused(429)); // that retry already happened in the earlier run's retry run
  assert.equal(workStatus(r).next, 'terminal', 'never a third call');
});
await check('fix v1: re-assembly of a kept /7 copy uses the work\'s verified S2 boxes; strict /7 copy of /13 or /14 is re-assembled, not stale', async root => {
  const b = Object.assign(base('re'), { b1: { noteCandidates: [{ noteId: 'n1', body: 'A missing nose.', pin: { x: 10, y: 25 }, confidence: 0.9 }] } });
  const s2 = planS2(b);
  await runAudit({ ...run('S2'), plans: [s2], callFn: async () => ({ transcript: transcript(s2, { verifications: [{ requestId: 'pin-n1', found: true, confidence: 0.9, bbox: [0.06, 0.21, 0.04, 0.04], note: 'The nose is missing.' }] }), exitCode: 0 }) });
  const old = join(root, 'copy', '2026-11-01', basename(copyArtifact('re', null, {}, root, KEPT_WRITES[1]).path).replace(/\.a\d+\.json$/, '.a7.json'));
  const body7 = { version: 'passBClaimFirstCopy/2', write: KEPT_WRITES[1], assemble: 7, workId: 're', date: '2026-11-01', model: OPTS.model, why: 'A why.', notes: [],
    guide: [1, 2, 3].map(i => ({ q: `Q${i}?`, a: 'A.' })), trimmed: [], flags: [], usable: { minimal: true, strict: true },
    hotspots: [{ anchor: 'pin-n1', axis: 'delight', x: 0.1, y: 0.25, head: 'Nose', body: 'B. C.' }, { anchor: 'pin-n1', axis: 'delight', x: 0.1, y: 0.25, head: 'Nose again', body: 'B. C.' }] };
  mkdirSync(dirname(old), { recursive: true }); writeFileSync(old, JSON.stringify(body7));
  const written = finishedCopyNames(root), state = copyState('re', written);
  assert.deepEqual(state, { reassemble: old });
  const r = reassembledCopy(state, b);
  assert.equal(r.path, old.replace('.a7.json', `.a${CF.ASSEMBLE_VERSION}.json`)); assert.equal(r.body.reassembledFrom, 7);
  assert.deepEqual(r.body.hotspots.map(h => [h.head, +h.x.toFixed(2), +h.y.toFixed(2)]), [['Nose', 0.08, 0.23]], 'B3 centre; the second pin on the same spot is dropped');
  assert.equal(r.body.usable.strict, false, 'one pin left: rewritten under the current writer');
  assert.equal(reassembledCopy(state, null), null, 'unverified work: stays stale');
  writeFileSync(r.path, JSON.stringify(r.body));
  assert.equal(copyState('re', finishedCopyNames(root)), null, 'the /8 copy now decides');
  const name = (id, w) => basename(copyArtifact(id, null, {}, '/o', w).path);
  const w2 = new Map([[name('t', KEPT_WRITES[0]), '/p/13'], [name('t14', KEPT_WRITES[1]), '/p/14']]), read = () => ({ usable: { strict: true } });
  assert.deepEqual(['t', 't14'].map(id => copyState(id, w2, read, new Set(['t', 't14']))), [null, 'done'], 'top-200: /13 copy never counts, /14 copy does');
});
await check('2026-11-16: a push GitHub keeps rejecting ends the run cleanly (lease released); a fatal never does', () => {
  assert.ok(CLEAN_STOP.test(pushStop(new PersistError('push failed: remote: Internal Server Error'))));
  assert.ok(CLEAN_STOP.test('persist-failed: push failed: x')); assert.ok(!CLEAN_STOP.test('preserved-fatal: cf-1: model drift in init'));
  assert.throws(() => pushStop(new Error('frozen input changed')), /frozen input/, 'anything else still propagates');
  const child = stderr => Object.assign(new Error('Command failed'), { stderr });
  assert.match(collectorPushFailure(child('FAIL-CLOSED: push failed: remote: Internal Server Error')), /^persist-failed \(collector\)/);
  assert.match(collectorPushFailure(child('FAIL-CLOSED: persist-failed: push failed: x')), /^persist-failed/);
  assert.equal(collectorPushFailure(child('FAIL-CLOSED: fatal: w/B3: confinement violation (final push also failed: push failed: x)')), null);
  assert.equal(collectorPushFailure(child('FAIL-CLOSED: preserved-pause: w/B3')), null);
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
// VSD-082: a writer bump keeps strict-usable /13 copy at the current assembly; it rewrites non-strict copy and never
// rewrites copy that only awaits re-assembly.
await check('writer bump: strict /13 copy is kept, held /13 copy is rewritten, older-assembly copy is stale', async () => {
  const name = (id, w) => basename(copyArtifact(id, null, {}, '/o', w).path), w13 = KEPT_WRITES[0];
  const written = new Map([[name('cur', CF.WRITE_VERSION), '/p/cur'], [name('good', w13), '/p/good'], [name('held', w13), '/p/held'],
    [name('old', w13).replace(/\.a\d+\.json$/, '.a6.json'), '/p/old']]);
  const read = p => ({ '/p/good': { usable: { strict: true } }, '/p/held': { usable: { strict: false } } })[p];
  assert.notEqual(CF.WRITE_VERSION, w13, 'the kept writer is an older one');
  assert.deepEqual(['cur', 'good', 'held', 'old', 'new'].map(id => copyState(id, written, read)), ['done', 'done', null, 'stale', null]);
});
// VSD-083: the most recognizable works are rewritten under the current writer even with strict kept copy.
await check('top-200 rewrite: strict or stale kept copy of a top work is rewritten; current-writer copy stays done', async () => {
  const name = (id, w) => basename(copyArtifact(id, null, {}, '/o', w).path), w13 = KEPT_WRITES[0];
  const written = new Map([[name('good', w13), '/p/good'], [name('old', w13).replace(/\.a\d+\.json$/, '.a6.json'), '/p/old'],
    [name('done14', CF.WRITE_VERSION), '/p/d'], [name('other', w13), '/p/other']]);
  const read = p => ({ usable: { strict: true } }), rewrite = new Set(['good', 'old', 'done14']);
  assert.deepEqual(['good', 'old', 'done14', 'other'].map(id => copyState(id, written, read, rewrite)), [null, null, 'done', 'done']);
  assert.deepEqual(['good', 'old', 'other'].map(id => copyState(id, written, read)), ['done', 'stale', 'done'], 'no rewrite set: VSD-082 unchanged');
});
await check('top-200 ranking: fame file first, pool fame second; unplayable and human remains excluded', async () => {
  const pool = [{ id: 'a', fame: 5 }, { id: 'b', fame: 1 }, { id: 'c', fame: 9, play: false }, { id: 'd', fame: 8, sensitive: 'remains' }, { id: 'e' }];
  assert.deepEqual(topFameIds(pool, { b: 7 }, 3), ['b', 'a', 'e']);
  assert.equal(TOP_REWRITE, 200);
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
await check('VSD-090: past the run deadline no new call starts, the in-flight call finishes and is recorded, and the stop is clean', async () => {
  assert.equal(RUN_DEADLINE_MIN, 270); assert.throws(() => runDeadline(0), /positive/);
  let t = 0; const pastDeadline = runDeadline(60, 0, () => t);
  assert.equal(pastDeadline(), null);
  // Same composition as main(): the deadline joins the reserve-time safety check and the per-stage check.
  let calls = 0, stop = null; const results = {};
  const deadlineCall = (key, p) => runAudit({ ...run(key), plans: [p], beforeReserve: () => pastDeadline(),
    callFn: async () => { calls++; t = 61 * 60000; await new Promise(r => setTimeout(r, 10)); return { transcript: transcript(p, output(key)), exitCode: 0 }; } });
  await runPool(['a', 'b'], 2, async id => {
    const r = await advanceWork({ base: base(id), call: deadlineCall, safetyCheck: () => pastDeadline() || (stop && !CLEAN_STOP.test(stop) ? stop : null), saveCopy: () => {} });
    results[id] = r; if (r.stop !== 'done') stop ||= r.stop;
  }, () => Boolean(stop));
  assert.equal(calls, 1, 'only the call already under way when the clock passed the deadline');
  const s1 = planS1(base('a')), h = auditHistory(run('S1').outDir, s1, run('S1').runId);
  assert.equal(h?.kind, 'accepted', 'the in-flight call was recorded');
  assert.match(stop, /^deadline: 60 min/); assert.ok(CLEAN_STOP.test(stop), 'a clean stop: status written, lease released');
  assert.equal(auditHistory(run('S1').outDir, planS1(base('b')), run('S1').runId), null, 'work b reserved nothing');
});
console.log(`pass-b-nightly.test: ${n} checks passed`);
