// Remote evidence (cloud plan, Codex corrections 2026-09-30). When PASS_B_REMOTE_EVIDENCE names a checkout of the
// private evidence repo, every durable pipeline write that matters is committed and PUSHED before the next step:
//   - a reservation is pushed BEFORE its call spends anything (a reclaimed VM can then never lose a spent call);
//   - each outcome (transcript/result/meta) is pushed right after the call;
//   - if a push fails, the caller stops before spending (PersistError).
// A lease on the evidence repo's state branch guarantees one writer (cloud run or laptop): the first successful push
// wins, losers exit; a lease is never stolen because it looks old and never auto-merged.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

export class PersistError extends Error {}
export class LeaseBusyError extends Error {}
export const LEASE_VERSION = 'passBEvidenceLease/1';
export const STATE_BRANCH = 'claude/pass-b-state';

export function remoteRoot(env = process.env) {
  const r = env.PASS_B_REMOTE_EVIDENCE;
  return r ? realpathSync(r) : null;
}
const git = (root, args, opts = {}) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
// Always the CHECKED-OUT branch (the state branch, e.g. claude/pass-b-state), never the remote's default HEAD.
const branch = root => git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();

// Native nightly/collector entry points require the same ownership as the cloud wrapper.
// Offline readers and separately scoped historical experiments need no lease.
export function assertExecutionLease({ required = false, env = process.env } = {}) {
  const root = remoteRoot(env);
  if (!root) {
    if (required) throw new LeaseBusyError('live nightly/collection requires the shared evidence lease; use pass-b-cloud-nightly.sh (also on the laptop)');
    return null;
  }
  const lease = readLease(root);
  if (!env.PASS_B_LEASE_HOLDER || lease?.version !== LEASE_VERSION || lease.holder !== env.PASS_B_LEASE_HOLDER)
    throw new LeaseBusyError('shared evidence lease missing or owned by another run');
  if (branch(root) !== STATE_BRANCH) throw new LeaseBusyError('execution requires the evidence state branch');
  if (required && (!env.PASS_B_CALL_BUDGET_ID || !Number.isSafeInteger(Number(env.PASS_B_MAX_CALLS)) || Number(env.PASS_B_MAX_CALLS) < 1))
    throw new LeaseBusyError('live nightly/collection requires an explicit shared call-budget id and cap');
  return root;
}

export function executionBudgetPath(env = process.env) {
  const root = remoteRoot(env);
  if (!root) return null;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(env.PASS_B_CALL_BUDGET_ID || '')) throw new Error('invalid shared call-budget id');
  return join(root, 'state', 'call-budgets', `${env.PASS_B_CALL_BUDGET_ID}.json`);
}

// Commit the given paths (files or directories inside the evidence checkout) and push. Throws PersistError.
export function persist(root, paths, message, { retries = 1, sleepMs = 3000 } = {}) {
  if (!root) return false;
  root = realpathSync(root);
  const rel = paths.filter(p => p && existsSync(p)).map(p => relative(root, realpathSync(p)));
  if (rel.some(r => r.startsWith('..'))) throw new PersistError(`path outside the evidence repo: ${rel.find(r => r.startsWith('..'))}`);
  if (!rel.length) return false;
  try {
    git(root, ['add', '--', ...rel]);
    const staged = git(root, ['diff', '--cached', '--name-only']).trim();
    if (staged) git(root, ['commit', '-q', '-m', message]);
    else if (!git(root, ['rev-list', '--count', `origin/${branch(root)}..HEAD`]).trim().match(/^[1-9]/)) return false;
  } catch (e) { throw new PersistError(`commit failed: ${String(e.stderr || e.message).slice(0, 200)}`); }
  for (let i = 0; ; i++) {
    try { git(root, ['push', '-q', 'origin', `HEAD:${branch(root)}`]); return true; }
    catch (e) {
      if (i >= retries) throw new PersistError(`push failed: ${String(e.stderr || e.message).slice(0, 200)}`);
      execFileSync('sleep', [String(sleepMs / 1000)]); // transient network: one retry, never a merge
    }
  }
}

// ---- lease: state/lease.json on the checked-out branch ----
const leasePath = root => join(root, 'state', 'lease.json');
export function readLease(root) { const p = leasePath(root); return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null; }
export function acquireLease(root, holder, { now = new Date() } = {}) {
  git(root, ['pull', '-q', '--ff-only', 'origin', branch(root)]); // never merge
  const cur = readLease(root);
  if (cur) throw new LeaseBusyError(`lease held by ${cur.holder} since ${cur.acquiredAt}; never stolen automatically (release it deliberately after checking that run)`);
  mkdirSync(dirname(leasePath(root)), { recursive: true });
  if (!holder?.trim()) throw new LeaseBusyError('lease holder is required');
  try { writeFileSync(leasePath(root), `${JSON.stringify({ version: LEASE_VERSION, holder, acquiredAt: now.toISOString() }, null, 1)}\n`, { flag: 'wx', mode: 0o600, flush: true }); }
  catch (e) { throw new LeaseBusyError(`local lease was claimed concurrently: ${e.message}`); }
  try { persist(root, [leasePath(root)], `lease: acquire by ${holder}`, { retries: 0 }); }
  catch (e) {
    // Lost the race (non-fast-forward) or network: undo locally and exit; never merge a competing claim.
    try { git(root, ['fetch', '-q', 'origin', branch(root)]); git(root, ['reset', '-q', '--hard', 'FETCH_HEAD']); } catch { /* best effort */ }
    throw new LeaseBusyError(`could not claim the lease: ${e.message}`);
  }
  const owned = readLease(root);
  if (owned?.holder !== holder) throw new LeaseBusyError('lease changed during acquisition');
  return owned;
}
export function releaseLease(root, holder, { force = false } = {}) {
  const cur = readLease(root);
  if (!cur) return false;
  if (cur.holder !== holder && !force) throw new LeaseBusyError(`lease belongs to ${cur.holder}, not ${holder}`);
  unlinkSync(leasePath(root));
  git(root, ['add', '-A', '--', 'state/lease.json']);
  git(root, ['commit', '-q', '-m', `lease: release by ${force ? `owner (force, was ${cur.holder})` : holder}`]);
  git(root, ['push', '-q', 'origin', `HEAD:${branch(root)}`]);
  return true;
}
export function writeStatus(root, status) {
  if (!root) return;
  const p = join(root, 'state', 'status.json');
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${JSON.stringify({ ...status, updatedAt: new Date().toISOString() }, null, 1)}\n`);
  persist(root, [p], `status: ${status.summary || 'update'}`);
}
