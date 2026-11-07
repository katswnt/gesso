// VSD-073 (owner 2026-11-07): a fatal that can only concern ONE work sets that work aside instead of stopping the
// pipeline. The work is terminal (never retried, never written as copy) and listed for review; the run continues.
// Still a pipeline-wide stop: anything about the subscription source or the CLI's own configuration (it would hit
// every call) or a confinement breach, and the third set-aside in one firing (a systemic problem then costs at most three calls).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

export const SET_ASIDE_VERSION = 'passBSetAside/1';
export const SET_ASIDE_LIMIT = 2; // per firing; the next work-level fatal stops the pipeline
// Confinement (a read outside the call sandbox) is a security signal, never one work's problem.
const PIPELINE_WIDE = /apiKeySource|init tools|every init|model drift in init|no resolved model|confinement/i;
export const pipelineWide = reason => PIPELINE_WIDE.test(String(reason ?? ''));

// One budget per firing, shared by every worker and stage. Returns true when this fatal may be set aside.
export function setAsideBudget(limit = SET_ASIDE_LIMIT) {
  let used = 0;
  const take = reason => { if (pipelineWide(reason) || used >= limit) return false; used++; return true; };
  take.used = () => used;
  return take;
}

const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
export const setAsideRecord = ({ workId, reason, boundFile, holder = process.env.PASS_B_LEASE_HOLDER || null, now = new Date() }) =>
  ({ version: SET_ASIDE_VERSION, workId, reason, boundSha256: sha(boundFile), holder, recordedAt: now.toISOString() });

// A record counts only if it binds the exact evidence file it names and its reason is work-level.
export function validSetAside(recordPath, { workId, boundFile }) {
  if (!existsSync(recordPath) || !existsSync(boundFile)) return null;
  let r; try { r = JSON.parse(readFileSync(recordPath, 'utf8')); } catch { return null; }
  if (r.version !== SET_ASIDE_VERSION || r.workId !== workId || pipelineWide(r.reason) || r.boundSha256 !== sha(boundFile)) return null;
  return r;
}
