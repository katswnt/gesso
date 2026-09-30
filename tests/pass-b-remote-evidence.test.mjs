// Remote evidence (cloud): push-before-spend persistence, lease (first push wins, never stolen, never merged),
// push failure surfaces as PersistError, and the shared runner refuses to call when the reservation push fails.
// Uses throwaway local bare repos as "GitHub". Offline.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { persist, acquireLease, releaseLease, readLease, PersistError, LeaseBusyError } from '../scripts/lib/pass-b-remote-evidence.mjs';
import { runAudit, countReservations } from '../scripts/pass-b-shadow-audit.mjs';

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
  const w = world(); rmSync(w.bare, { recursive: true });
  const prev = process.env.PASS_B_REMOTE_EVIDENCE; process.env.PASS_B_REMOTE_EVIDENCE = w.a;
  try {
    let calls = 0; const plan = { workId: 'w', input: { x: 1 }, inputSha256: 'i', promptHash: 'p', binding: {}, controllerHolds: {} };
    const r = await runAudit({ plans: [plan], outDir: join(w.a, 'incoming', 'run'), runId: 'sa-r', binding: {}, now: () => new Date('2026-09-29T08:00:00Z'), callFn: async () => { calls++; } });
    assert.match(r.stop, /^persist-failed/); assert.equal(calls, 0);
  } finally { if (prev === undefined) delete process.env.PASS_B_REMOTE_EVIDENCE; else process.env.PASS_B_REMOTE_EVIDENCE = prev; rmSync(w.root, { recursive: true }); }
});
console.log(`pass-b-remote-evidence.test: ${n} checks passed`);
