// Remote evidence (cloud): push-before-spend persistence, lease (first push wins, never stolen, never merged),
// push failure surfaces as PersistError, and the shared runner refuses to call when the reservation push fails.
// Uses throwaway local bare repos as "GitHub". Offline.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { persist, acquireLease, acquireLeaseWaiting, releaseLease, readLease, assertExecutionLease, PersistError, LeaseBusyError, STALE_LEASE_MIN } from '../scripts/lib/pass-b-remote-evidence.mjs';
import { runAudit, countReservations } from '../scripts/pass-b-shadow-audit.mjs';

process.env.PASS_B_PUSH_BACKOFF_MS ??= '0,0,0'; // simulated outages retry without waiting
let n = 0; const check = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error(`FAIL ${name}`); throw e; } };
const sh = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
function world() {
  const root = mkdtempSync(join(tmpdir(), 'ev-')), bare = join(root, 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'claude/pass-b-state', bare]);
  const clone = name => { const d = join(root, name); execFileSync('git', ['clone', '-q', bare, d], { stdio: 'ignore' }); sh(d, 'config', 'user.email', 't@t'); sh(d, 'config', 'user.name', 't');
    try { sh(d, 'checkout', '-q', '-b', 'claude/pass-b-state'); } catch { /* exists */ } return d; };
  const a = clone('a'); writeFileSync(join(a, 'README.md'), 'x'); sh(a, 'add', '.'); sh(a, 'commit', '-q', '-m', 'init'); sh(a, 'push', '-q', '-u', 'origin', 'claude/pass-b-state');
  return { root, bare, a, clone };
}
await check('persist commits and pushes only the given paths; nothing staged is a no-op', () => {
  const w = world(); mkdirSync(join(w.a, 'incoming'), { recursive: true });
  writeFileSync(join(w.a, 'incoming', 'r.json'), '{}'); writeFileSync(join(w.a, 'incoming', 'other.json'), '{}');
  assert.equal(persist(w.a, [join(w.a, 'incoming', 'r.json')], 'reserve'), true);
  const b = w.clone('b'); sh(b, 'checkout', '-q', 'claude/pass-b-state');
  assert.ok(existsSync(join(b, 'incoming', 'r.json'))); assert.ok(!existsSync(join(b, 'incoming', 'other.json')));
  assert.equal(persist(w.a, [join(w.a, 'incoming', 'r.json')], 'again'), false);
  assert.equal(persist(null, [join(w.a, 'incoming', 'other.json')], 'laptop'), false); // unset env = no-op
  rmSync(w.root, { recursive: true });
});
await check('a failed push surfaces as PersistError (never silently continues)', () => {
  const w = world(); rmSync(w.bare, { recursive: true });
  writeFileSync(join(w.a, 'x.json'), '{}');
  assert.throws(() => persist(w.a, [join(w.a, 'x.json')], 'reserve', { retries: 0 }), PersistError);
  rmSync(w.root, { recursive: true });
});
// 2026-11-16: GitHub rejected two pushes in a row with a server error and the run stopped for 4 days.
const flakyOrigin = (w, failures) => { const hook = join(w.bare, 'hooks', 'pre-receive'), count = join(w.root, 'rejections');
  writeFileSync(count, '0');
  writeFileSync(hook, `#!/bin/sh\nn=$(cat "${count}"); if [ "$n" -lt ${failures} ]; then echo $((n+1)) > "${count}"; echo "Internal Server Error" >&2; exit 1; fi\n`, { mode: 0o755 });
  return () => Number(readFileSync(count, 'utf8')); };
await check('a push rejected by the server is retried with backoff and lands', () => {
  const w = world(), rejected = flakyOrigin(w, 3); writeFileSync(join(w.a, 'x.json'), '{}');
  assert.equal(persist(w.a, [join(w.a, 'x.json')], 'reserve'), true); assert.equal(rejected(), 3);
  const b = w.clone('b'); sh(b, 'checkout', '-q', 'claude/pass-b-state'); assert.ok(existsSync(join(b, 'x.json')));
  rmSync(w.root, { recursive: true });
});
await check('a server that keeps rejecting gives up after the backoff with PersistError', () => {
  const w = world(), rejected = flakyOrigin(w, 99); writeFileSync(join(w.a, 'x.json'), '{}');
  assert.throws(() => persist(w.a, [join(w.a, 'x.json')], 'reserve'), e => e instanceof PersistError && /push failed: .*Internal Server Error/s.test(e.message));
  assert.equal(rejected(), 4, 'first try + 3 retries');
  rmSync(w.root, { recursive: true });
});
await check('lease: first push wins, the second claimant exits, a held lease is never stolen, only its holder (or a forced owner release) frees it', () => {
  const w = world(), b = w.clone('b'); sh(b, 'checkout', '-q', 'claude/pass-b-state');
  acquireLease(w.a, 'run-A');
  assert.throws(() => acquireLease(b, 'run-B'), LeaseBusyError);          // B pulls, sees A's lease
  assert.equal(readLease(b).holder, 'run-A');
  assert.throws(() => releaseLease(b, 'run-B'), LeaseBusyError);
  releaseLease(w.a, 'run-A'); assert.equal(acquireLease(b, 'run-B').holder, 'run-B');
  releaseLease(b, 'run-B', { force: true });
  rmSync(w.root, { recursive: true });
});
await check('lease race: a stale clone that did not see the winner cannot claim (non-fast-forward) and does not merge', () => {
  const w = world(), b = w.clone('b'); sh(b, 'checkout', '-q', 'claude/pass-b-state');
  sh(b, 'config', 'pull.ff', 'only');
  acquireLease(w.a, 'run-A');
  // simulate B racing: it cannot fast-forward-pull past A? It can, and then sees the lease -> busy. Either way no merge.
  assert.throws(() => acquireLease(b, 'run-B'), LeaseBusyError);
  assert.equal(sh(b, 'log', '--merges', '--oneline').trim(), '');
  rmSync(w.root, { recursive: true });
});
await check('true race: both read "no lease", A pushes first, B is rejected (non-fast-forward), resets, and never merges', () => {
  const w = world(), b = w.clone('b'); sh(b, 'checkout', '-q', 'claude/pass-b-state');
  // B prepares its claim on the old state (as if it pulled before A pushed)
  mkdirSync(join(b, 'state'), { recursive: true }); writeFileSync(join(b, 'state', 'lease.json'), JSON.stringify({ holder: 'run-B' }));
  acquireLease(w.a, 'run-A');
  assert.throws(() => persist(b, [join(b, 'state', 'lease.json')], 'lease: acquire by run-B', { retries: 0 }), PersistError);
  sh(b, 'fetch', '-q', 'origin', 'claude/pass-b-state'); sh(b, 'reset', '-q', '--hard', 'FETCH_HEAD');
  assert.equal(readLease(b).holder, 'run-A'); assert.equal(sh(b, 'log', '--merges', '--oneline').trim(), '');
  rmSync(w.root, { recursive: true });
});
await check('the state branch is used even when the remote default branch differs', () => {
  const w = world(); sh(w.a, 'checkout', '-q', '-b', 'main'); writeFileSync(join(w.a, 'm.txt'), 'm'); sh(w.a, 'add', '.'); sh(w.a, 'commit', '-q', '-m', 'main'); sh(w.a, 'push', '-q', 'origin', 'main');
  execFileSync('git', ['--git-dir', w.bare, 'symbolic-ref', 'HEAD', 'refs/heads/main']);  // remote default = main
  sh(w.a, 'checkout', '-q', 'claude/pass-b-state'); writeFileSync(join(w.a, 's.json'), '{}');
  persist(w.a, [join(w.a, 's.json')], 'state write');
  assert.ok(execFileSync('git', ['--git-dir', w.bare, 'ls-tree', '--name-only', 'claude/pass-b-state'], { encoding: 'utf8' }).includes('s.json'));
  assert.ok(!execFileSync('git', ['--git-dir', w.bare, 'ls-tree', '--name-only', 'main'], { encoding: 'utf8' }).includes('s.json'));
  rmSync(w.root, { recursive: true });
});
await check('shared runner: if the reservation cannot be pushed, no call is made', async () => {
  const w = world(); acquireLease(w.a, 'test'); rmSync(w.bare, { recursive: true });
  const prev = process.env.PASS_B_REMOTE_EVIDENCE, oldHolder = process.env.PASS_B_LEASE_HOLDER; process.env.PASS_B_REMOTE_EVIDENCE = w.a; process.env.PASS_B_LEASE_HOLDER = 'test';
  try {
    let calls = 0; const plan = { workId: 'w', input: { x: 1 }, inputSha256: 'i', promptHash: 'p', binding: {}, controllerHolds: {} };
    const r = await runAudit({ plans: [plan], outDir: join(w.a, 'incoming', 'run'), runId: 'sa-r', binding: {}, now: () => new Date('2026-09-29T08:00:00Z'), callFn: async () => { calls++; } });
    assert.match(r.stop, /^persist-failed/); assert.equal(calls, 0);
  } finally { if (prev === undefined) delete process.env.PASS_B_REMOTE_EVIDENCE; else process.env.PASS_B_REMOTE_EVIDENCE = prev; if (oldHolder === undefined) delete process.env.PASS_B_LEASE_HOLDER; else process.env.PASS_B_LEASE_HOLDER = oldHolder; rmSync(w.root, { recursive: true }); }
});
await check('live entry requires the shared lease and an explicit budget; another holder is refused', () => {
  const w = world();
  try {
    assert.throws(() => assertExecutionLease({ required: true, env: {} }), /requires the shared evidence lease/);
    acquireLease(w.a, 'cloud');
    const env = { PASS_B_REMOTE_EVIDENCE: w.a, PASS_B_LEASE_HOLDER: 'laptop' };
    assert.throws(() => assertExecutionLease({ required: true, env }), /another run/);
    env.PASS_B_LEASE_HOLDER = 'cloud'; assert.throws(() => assertExecutionLease({ required: true, env }), /call-budget/);
    Object.assign(env, { PASS_B_CALL_BUDGET_ID: 'pilot-30', PASS_B_MAX_CALLS: '30' });
    assert.equal(assertExecutionLease({ required: true, env }), realpathSync(w.a));
  } finally { rmSync(w.root, { recursive: true, force: true }); }
});
await check('two acquirers sharing one checkout cannot both win a check-then-write race', async () => {
  const w = world(), ready = join(w.root, 'ready'), done = join(w.root, 'done');
  let child;
  try {
    const moduleUrl = pathToFileURL(resolve('scripts/lib/pass-b-remote-evidence.mjs')).href;
    child = spawn(process.execPath, ['--input-type=module', '-e', `
      import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
      const original = fs.writeFileSync;
      fs.writeFileSync = function(path, ...args) {
        if (String(path).endsWith('/state/lease.json')) {
          original(${JSON.stringify(ready)}, 'ready'); let n = 0;
          while (!fs.existsSync(${JSON.stringify(done)})) { if (n++ > 1000) throw new Error('barrier timeout'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10); }
        }
        return original(path, ...args);
      };
      syncBuiltinESMExports(); const {acquireLease} = await import(${JSON.stringify(moduleUrl)});
      try { acquireLease(${JSON.stringify(w.a)}, 'B'); console.log('unexpected winner'); process.exitCode = 1; }
      catch (e) { if (!/claimed concurrently/.test(e.message)) throw e; }
    `], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = ''; child.stderr.on('data', x => stderr += x);
    const exit = new Promise(r => child.on('close', r));
    for (let n = 0; !existsSync(ready); n++) { if (n > 1000) throw new Error('barrier timeout'); await new Promise(r => setTimeout(r, 10)); }
    acquireLease(w.a, 'A'); writeFileSync(done, 'done');
    assert.equal(await exit, 0, stderr); assert.equal(readLease(w.a).holder, 'A');
  } finally { child?.kill(); rmSync(w.root, { recursive: true, force: true }); }
});
await check('a committed but failed push is retried even when no files changed', () => {
  const w = world();
  try {
    sh(w.a, 'remote', 'set-url', 'origin', join(w.root, 'missing.git'));
    const p = join(w.a, 'pending.json'); writeFileSync(p, '{}');
    assert.throws(() => persist(w.a, [p], 'fixture', { retries: 0 }), PersistError);
    sh(w.a, 'remote', 'set-url', 'origin', w.bare);
    assert.equal(persist(w.a, [p], 'retry', { retries: 0 }), true);
    assert.ok(existsSync(join(w.clone('recovered'), 'pending.json')));
  } finally { rmSync(w.root, { recursive: true, force: true }); }
});

import { makePacer, recordObservation } from '../scripts/lib/pass-b-pacing.mjs';
await check('the shared allowance and reservation are BOTH remote before a call; replacement VM keeps the cap', async () => {
  const w = world(), old = { ...process.env };
  try {
    acquireLease(w.a, 'test'); Object.assign(process.env, { PASS_B_REMOTE_EVIDENCE: w.a, PASS_B_LEASE_HOLDER: 'test' });
    const log = join(w.a, 'usage.jsonl'), statePath = join(w.a, 'state', 'budget.json');
    const now = () => new Date('2026-09-30T10:00:00Z');
    recordObservation(log, JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { unifiedWindows: {
      seven_day: { utilization: .1, resetsAt: Date.parse('2026-10-01T11:00:00Z') / 1000 },
      five_hour: { utilization: .1, resetsAt: Date.parse('2026-09-30T14:00:00Z') / 1000 },
    } } }), { observedAt: now() });
    const p = { workId: 'w', input: {}, inputSha256: 'i', promptHash: 'p', binding: {} };
    let remote;
    await runAudit({ plans: [p], outDir: join(w.a, 'incoming', 'run'), runId: 'sa-cap', binding: {}, now,
      pacer: makePacer({ logPath: log, maxCalls: 1, statePath, now }), callFn: async () => {
        remote = w.clone('replacement');
        assert.equal(countReservations(join(remote, 'incoming', 'run')), 1);
        assert.equal(JSON.parse(readFileSync(join(remote, 'state', 'budget.json'))).allowances.length, 1);
        throw new Error('simulated VM loss');
      } });
    assert.equal(makePacer({ logPath: join(remote, 'missing'), maxCalls: 1, statePath: join(remote, 'state', 'budget.json'), now }).check().go, false);
  } finally { for (const k of ['PASS_B_REMOTE_EVIDENCE', 'PASS_B_LEASE_HOLDER']) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; } rmSync(w.root, { recursive: true, force: true }); }
});
import { executeCorpusAttempt, inspectWork, CORPUS_RUN_ID, COLLECTION_MODEL, makeCapture, effectivePromptFor } from '../scripts/pass-b-corpus-collect.mjs';
import { sha256 } from '../scripts/lib/vision-legacy.mjs';
import { syntheticFixture, producerEvidence, IMAGE_TRANSPORT_VERSION } from '../scripts/lib/pass-b-calibration.mjs';
import { BROKER_POLICY_VERSION } from '../scripts/lib/img-broker.mjs';
import { workEvidenceFiles } from '../scripts/pass-b-cloud-bundle.mjs';
await check('collector pushes new B0/image/epoch before spending and each captured stage before the next call', async () => {
  const w = world(), cwd = process.cwd(), old = { ...process.env };
  try {
    acquireLease(w.a, 'test'); Object.assign(process.env, { PASS_B_REMOTE_EVIDENCE: w.a, PASS_B_LEASE_HOLDER: 'test' });
    process.chdir(w.a);
    const id = 'new-work', imgSha256 = sha256('test image'), ext = 'png', imageFile = `${imgSha256}.${ext}`;
    const runDir = join(w.a, 'incoming', CORPUS_RUN_ID), workRunDir = join(runDir, 'works', sha256(id).slice(0, 24));
    const catalog = {}, legacy = {};
    mkdirSync(workRunDir, { recursive: true }); mkdirSync(join(runDir, 'imgs'), { recursive: true });
    writeFileSync(join(runDir, 'imgs', imageFile), 'test image');
    writeFileSync(join(workRunDir, 'b0-prep.json'), JSON.stringify({ work: { id }, trustedCatalog: catalog, legacy, image: { ok: true, imgSha256, ext } }));
    const body = syntheticFixture().bodies.B1;
    const prompt = effectivePromptFor('B1', { id, catalog, legacy, imageFile });
    const result = await executeCorpusAttempt({ runDir, workRunDir, id, imgSha256, ext, imageFile, stage: 'B1', seq: 1, runtimeVersion: '2.1.282', now: () => new Date('2026-09-30T10:00:00Z'),
      command: { bin: 'never-used', argv: ['-p', prompt, '--model', COLLECTION_MODEL], env: { removeKeys: [] } },
      execute: async (bin, argv, opts) => {
        const survivor = w.clone('during-call'), saved = join(survivor, 'incoming', CORPUS_RUN_ID);
        const pending = inspectWork({ runDir: saved, id, catalog, legacy });
        assert.equal(pending.attempts, 1); assert.match(pending.pause, /unknown-outcome/);
        assert.ok(existsSync(join(saved, 'imgs', imageFile)));
        assert.ok(!existsSync(join(saved, 'works', sha256(id).slice(0, 24), 'B1.lease')), 'local PID lease never travels');
        return { stdout: [
          { type: 'system', subtype: 'init', apiKeySource: 'none', model: COLLECTION_MODEL, claude_code_version: '2.1.282' },
          { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', id: 'r', input: { file_path: `${opts.cwd}/${imageFile}` } }] } },
          { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'r', content: [{ type: 'image' }] }] } },
          { type: 'result', subtype: 'success', is_error: false, structured_output: body, modelUsage: { [COLLECTION_MODEL]: { output_tokens: 1 } } },
        ].map(e => JSON.stringify(e)).join('\n') };
      } });
    const beforeCapture = w.clone('before-capture');
    assert.deepEqual(inspectWork({ runDir: join(beforeCapture, 'incoming', CORPUS_RUN_ID), id, catalog, legacy }).terminalReasons, ['B1:uncaptured-result']);
    await makeCapture(workRunDir)({ stage: 'B1', rawResponse: result.raw,
      trusted: { workId: id, imgSha256, promptHash: sha256(prompt), brokerPolicyVersion: BROKER_POLICY_VERSION, imageTransportVersion: IMAGE_TRANSPORT_VERSION, transcriptSha256: result.transcriptSha256 },
      producer: producerEvidence('B1', { model: COLLECTION_MODEL, runtimeVersion: '2.1.282' }), context: {} });
    const replacement = w.clone('after-stage'), saved = join(replacement, 'incoming', CORPUS_RUN_ID);
    const verified = inspectWork({ runDir: saved, id, catalog, legacy });
    assert.deepEqual(verified.bodies.B1, body); assert.equal(verified.pause, null);
    assert.deepEqual(verified.terminalReasons, []); assert.equal(verified.attempts, 1);
    assert.throws(() => workEvidenceFiles(saved, id), /legacy bundles support historical 4.6 only/);
  } finally {
    process.chdir(cwd);
    for (const k of ['PASS_B_REMOTE_EVIDENCE', 'PASS_B_LEASE_HOLDER']) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; }
    rmSync(w.root, { recursive: true, force: true });
  }
});
await check('collector refuses a failed reservation push or a cutoff crossed after persistence', async () => {
  for (const failure of ['push', 'cutoff']) {
    const w = world(), cwd = process.cwd(), old = { ...process.env };
    try {
      acquireLease(w.a, 'test'); Object.assign(process.env, { PASS_B_REMOTE_EVIDENCE: w.a, PASS_B_LEASE_HOLDER: 'test' });
      process.chdir(w.a);
      const runDir = join(w.a, 'incoming', CORPUS_RUN_ID), workRunDir = join(runDir, 'works', sha256('w').slice(0, 24));
      mkdirSync(workRunDir, { recursive: true });
      writeFileSync(join(workRunDir, 'b0-prep.json'), '{}');
      if (failure === 'push') rmSync(w.bare, { recursive: true });
      let calls = 0, ticks = 0;
      await assert.rejects(executeCorpusAttempt({ runDir, workRunDir, id: 'w', imgSha256: '0'.repeat(64), ext: 'png', stage: 'B2', seq: 1, runtimeVersion: '2.1.282',
        command: { bin: 'never-used', argv: ['-p', 'fixture', '--model', COLLECTION_MODEL], env: { removeKeys: [] } },
        now: () => new Date(++ticks <= 2 ? '2026-09-30T15:29:59Z' : '2026-09-30T15:30:01Z'),
        execute: async () => { calls++; } }), failure === 'push' ? /persist-failed before call/ : /protected-hours/);
      assert.equal(calls, 0);
      assert.ok(existsSync(join(workRunDir, 'attempts', 'b2-000001.reserved.json')));
    } finally {
      process.chdir(cwd);
      for (const k of ['PASS_B_REMOTE_EVIDENCE', 'PASS_B_LEASE_HOLDER']) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; }
      rmSync(w.root, { recursive: true, force: true });
    }
  }
});
await check('self-healing (VSD-066, VSD-090): a crashed automation lease is recovered after 30 quiet min (was 90); a live run, a fail-closed stop and a laptop lease are not', () => {
  const w = world(), b = w.clone('b'); sh(b, 'checkout', '-q', 'claude/pass-b-state');
  const at = min => new Date(Date.now() + min * 60000);
  assert.equal(STALE_LEASE_MIN, 30);
  acquireLease(w.a, 'routine-A');
  assert.throws(() => acquireLease(b, 'routine-B', { now: at(29) }), LeaseBusyError);   // still within a call's reach
  assert.throws(() => acquireLease(b, 'laptop-B', { now: at(200) }), LeaseBusyError);   // only automation recovers automation
  assert.equal(acquireLease(b, 'routine-B', { now: at(31) }).holder, 'routine-B');     // crashed: recovered
  const rec = readFileSync(join(b, 'state', 'lease-recoveries.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.equal(rec.length, 1); assert.equal(rec[0].from.holder, 'routine-A'); assert.ok(rec[0].quietMin >= 30 && rec[0].quietMin < 90);
  assert.match(sh(b, 'log', '-1', '--format=%s'), /^lease: recover crashed routine-A/);
  writeFileSync(join(b, 'state', 'status.json'), JSON.stringify({ holder: 'routine-B', exit: 1, summary: 'FAIL-CLOSED: x' }));
  persist(b, [join(b, 'state', 'status.json')], 'status: fail');                       // deliberate stop keeps its lease
  assert.throws(() => acquireLease(w.a, 'routine-C', { now: at(500) }), LeaseBusyError);
  releaseLease(b, 'routine-B'); acquireLease(b, 'laptop-L');                           // laptop lease: never automatic
  assert.throws(() => acquireLease(w.a, 'routine-C', { now: at(500) }), LeaseBusyError);
  rmSync(w.root, { recursive: true });
});
await check('VSD-079: a restarted container recovers its OWN dead run at once; another holder, a laptop lease and a fail-closed stop are untouched', () => {
  // 2026-11-18 20:10 UTC: the container was restarted (exit 137) mid-run; the same session came back 30 s later but the
  // lease waited for 90 quiet minutes and the next firing. The launcher now names its own earlier holder (/tmp survives).
  const w = world(), b = w.clone('b'); sh(b, 'checkout', '-q', 'claude/pass-b-state');
  const at = min => new Date(Date.now() + min * 60000);
  acquireLease(w.a, 'routine-A');
  assert.throws(() => acquireLease(b, 'routine-B', { now: at(1), ownDead: 'routine-X' }), LeaseBusyError); // not its run
  assert.throws(() => acquireLease(b, 'laptop-B', { now: at(1), ownDead: 'routine-A' }), LeaseBusyError);  // automation only
  assert.equal(acquireLease(b, 'routine-B', { now: at(1), ownDead: 'routine-A' }).holder, 'routine-B');     // own: at once
  const rec = readFileSync(join(b, 'state', 'lease-recoveries.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.equal(rec.at(-1).own, true); assert.equal(rec.at(-1).from.holder, 'routine-A');
  assert.match(sh(b, 'log', '-1', '--format=%s'), /^lease: recover crashed routine-A \(own run, container restarted\) by routine-B/);
  writeFileSync(join(b, 'state', 'status.json'), JSON.stringify({ holder: 'routine-B', exit: 1, summary: 'FAIL-CLOSED: x' }));
  persist(b, [join(b, 'state', 'status.json')], 'status: fail');                       // deliberate stop keeps its lease
  assert.throws(() => acquireLease(w.a, 'routine-C', { now: at(2), ownDead: 'routine-B' }), LeaseBusyError);
  rmSync(w.root, { recursive: true });
});
// VSD-090: a firing that finds the lease busy waits in-session (simulated clock; sleep advances it) instead of exiting.
const waitClock = () => { let t = Date.now(), sleeps = 0; return { now: () => new Date(t), sleep: async ms => { sleeps++; t += ms; }, sleeps: () => sleeps, at: () => t }; };
await check('VSD-090: a busy lease is re-checked every 5 min and recovered once its run has been quiet 30 min', async () => {
  // 2026-11-19: a run killed 8 h 43 min after it started held the lease until the next firing could recover it 3 h 13 min later.
  const w = world(), b = w.clone('b'); sh(b, 'checkout', '-q', 'claude/pass-b-state');
  acquireLease(w.a, 'routine-A');
  const c = waitClock(), logs = [];
  const got = await acquireLeaseWaiting(b, 'routine-B', { now: c.now, sleep: c.sleep, pollMin: 5, maxWaitMin: 120, log: m => logs.push(m) });
  assert.equal(got.holder, 'routine-B'); assert.equal(c.sleeps(), 6); assert.equal(logs.length, 6); // busy at 0, 5, ... 25; free at 30
  const rec = readFileSync(join(b, 'state', 'lease-recoveries.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.equal(rec.length, 1); assert.equal(rec[0].from.holder, 'routine-A'); assert.ok(rec[0].quietMin >= 30);
  rmSync(w.root, { recursive: true });
});
await check('VSD-090: a holder that keeps pushing is never recovered; the waiting firing gives up after the 2 h bound', async () => {
  const w = world(), b = w.clone('b'); sh(b, 'checkout', '-q', 'claude/pass-b-state');
  acquireLease(w.a, 'routine-A');
  const c = waitClock(); let pushes = 0;
  const sleep = async ms => { await c.sleep(ms); // the live run pushes an outcome during each wait, stamped with the simulated time
    const prev = process.env.GIT_COMMITTER_DATE; process.env.GIT_COMMITTER_DATE = new Date(c.at()).toISOString();
    try { writeFileSync(join(w.a, `outcome-${++pushes}`), 'x'); persist(w.a, [join(w.a, `outcome-${pushes}`)], 'outcome'); }
    finally { if (prev === undefined) delete process.env.GIT_COMMITTER_DATE; else process.env.GIT_COMMITTER_DATE = prev; } };
  await assert.rejects(acquireLeaseWaiting(b, 'routine-B', { now: c.now, sleep, pollMin: 5, maxWaitMin: 120, log: () => {} }), e => e instanceof LeaseBusyError && /still alive after 120 min/.test(e.message));
  assert.equal(c.sleeps(), 24); // re-checked at 0, 5, ... 120 min
  sh(b, 'pull', '-q', '--ff-only', 'origin', 'claude/pass-b-state');
  assert.equal(readLease(b).holder, 'routine-A'); assert.equal(existsSync(join(b, 'state', 'lease-recoveries.jsonl')), false);
  rmSync(w.root, { recursive: true });
});
await check('VSD-090: the launcher acquires with --wait and keeps the own-dead fast path and the exit≠0 guard', () => {
  const src = readFileSync(new URL('../scripts/pass-b-cloud-nightly.sh', import.meta.url), 'utf8');
  assert.match(src, /cloud-lease\.mjs acquire "\$HOLDER" \$\{OWN_DEAD:\+--own-dead "\$OWN_DEAD"\} --wait; LEASE=\$\?/);
  assert.match(src, /if \[ "\$RUN" -ne 0 \]; then echo "RUN FAILED; lease retained for review"/);
});
await check('VSD-090: a laptop lease or a fail-closed stop is not waited for: the firing exits at once, nothing recovered', async () => {
  const w = world(), b = w.clone('b'); sh(b, 'checkout', '-q', 'claude/pass-b-state');
  acquireLease(w.a, 'laptop-L');
  let c = waitClock();
  await assert.rejects(acquireLeaseWaiting(b, 'routine-B', { now: c.now, sleep: c.sleep, log: () => {} }), /laptop\/owner leases wait for review/);
  assert.equal(c.sleeps(), 0);
  releaseLease(w.a, 'laptop-L'); acquireLease(w.a, 'routine-A');
  writeFileSync(join(w.a, 'state', 'status.json'), JSON.stringify({ holder: 'routine-A', exit: 1, summary: 'FAIL-CLOSED: x' }));
  persist(w.a, [join(w.a, 'state', 'status.json')], 'status: fail');
  c = waitClock();
  const later = () => new Date(c.at() + 600 * 60000); // long quiet: still never recovered
  await assert.rejects(acquireLeaseWaiting(b, 'routine-B', { now: later, sleep: c.sleep, log: () => {} }), /stopped fail-closed/);
  assert.equal(c.sleeps(), 0); assert.equal(readLease(b).holder, 'routine-A');
  rmSync(w.root, { recursive: true });
});
await check('status is written from environment variables, surviving braces, quotes and ampersands (2026-10-01 laptop-pilot bug)', () => {
  const w = world(), summary = 'claim-first: finished 3 work(s) {a,b}, "q" & stop=pacing: cap';
  execFileSync('node', ['scripts/pass-b-cloud-lease.mjs', 'write-status-env'], { env: { ...process.env, PASS_B_REMOTE_EVIDENCE: w.a, PASS_B_STATUS_SUMMARY: summary, PASS_B_STATUS_EXIT: '0', PASS_B_STATUS_HOLDER: 'h', PASS_B_STATUS_PIN: 'p' }, stdio: 'pipe' });
  const st = JSON.parse(execFileSync('git', ['--git-dir', w.bare, 'show', 'claude/pass-b-state:state/status.json'], { encoding: 'utf8' }));
  assert.equal(st.summary, summary); assert.equal(st.exit, 0);
  rmSync(w.root, { recursive: true });
});
console.log(`pass-b-remote-evidence.test: ${n} checks passed`);
