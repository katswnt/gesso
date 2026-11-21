// Teaching-v2 Phase A live operating controls (review finding 2). Phase A uses the SAME shared controls as the
// corpus collector (pass-b-corpus-collect.mjs executeCorpusAttempt), not private copies:
//   - the shared evidence lease (pass-b-remote-evidence.mjs assertExecutionLease, state branch, lease holder), so a
//     Phase A run and the cloud routine exclude each other in both directions;
//   - the shared call-budget allowance file (executionBudgetPath) and the shared usage-observation ledger and pacer
//     (pass-b-pacing.mjs makePacer over vision-ops/usage-observations.jsonl);
//   - reservations pushed to the evidence repo BEFORE a call spends anything, outcomes pushed right after.
// Plus a phase-wide fatal / unknown-outcome LATCH, checked before every reservation and at every restart: after a
// confinement failure or an unknown outcome nothing runs, on any work, until the owner reviews and clears it.
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { assertExecutionLease, executionBudgetPath, persist, LeaseBusyError } from './pass-b-remote-evidence.mjs';
import { makePacer, recordObservation } from './pass-b-pacing.mjs';
import { SHARED_USAGE_LOG } from './teaching-v2-stage.mjs';
import { PauseRun } from './teaching-v2-controller.mjs';

export const OPS_VERSION = 'teachingV2Ops/1';
export const PHASE_A_BUDGET_RE = /^teaching-v2-phase-a-[a-z0-9][a-z0-9-]{0,59}$/;
// A routine may recover an automation lease it thinks crashed (STALE_LEASE_MIN). Phase A therefore never holds the
// lease under an automation name, so the routine can never take it over while Phase A runs.
export const AUTOMATION_HOLDER = /^(routine|schedule)-/;
export const latchPath = phaseDir => join(phaseDir, 'fatal.json');
export function readLatch(phaseDir) { const p = latchPath(phaseDir); return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null; }
export class LatchedError extends Error {}

// Write the latch once (the first cause is kept) and push it; a push failure still leaves the local latch.
export function writeLatch(phaseDir, { kind, reason, workId = null, runId = null, at = new Date() }, { root = null } = {}) {
  mkdirSync(phaseDir, { recursive: true, mode: 0o700 });
  const p = latchPath(phaseDir);
  if (!existsSync(p)) writeFileSync(p, `${JSON.stringify({ version: OPS_VERSION, kind, reason: String(reason).slice(0, 500), workId, runId, at: at.toISOString(), clear: 'owner review only: inspect the attempt evidence, commit a clearance of that exact attempt evidence to tasks/teaching-v2-phase-a/latch-clearances.json in the code repo (node scripts/teaching-v2-run.mjs --stops prints the digests), then delete this file deliberately (never automatic). Deleting this file alone clears nothing: the stop is re-derived from the preserved attempts' }, null, 1)}\n`, { flag: 'wx', mode: 0o600, flush: true });
  try { persist(root, [p], `teaching-v2 LATCH: ${kind}`); } catch { /* the local latch still stops every later local start */ }
  return readLatch(phaseDir);
}
function assertNotLatched(phaseDir) {
  const l = readLatch(phaseDir);
  if (l) throw new LatchedError(`phase-wide ${l.kind} latch from ${l.at}${l.workId ? ` (${l.workId})` : ''}: ${l.reason}. Nothing runs, on any work, until the owner reviews and clears ${latchPath(phaseDir)}`);
}
const inside = (root, p) => { mkdirSync(p, { recursive: true, mode: 0o700 }); const r = realpathSync(p); return r === root || r.startsWith(`${root}${sep}`); };

// Opens the live controls or throws before anything is reserved. maxCallsForPhase = runnable works x 3.
export function openPhaseAOperations({ env = process.env, phaseDir, runDir, runId, maxCallsForPhase, usageLog = SHARED_USAGE_LOG }) {
  assertNotLatched(phaseDir);
  const root = assertExecutionLease({ required: true, env }); // lease held by THIS holder on the state branch + budget id/cap
  if (AUTOMATION_HOLDER.test(env.PASS_B_LEASE_HOLDER || '')) throw new LeaseBusyError('Phase A must hold the shared lease under a non-automation holder name (not routine-/schedule-)');
  if (!PHASE_A_BUDGET_RE.test(env.PASS_B_CALL_BUDGET_ID || '')) throw new LeaseBusyError('Phase A needs its own shared allowance id: PASS_B_CALL_BUDGET_ID=teaching-v2-phase-a-<name>');
  const cap = Number(env.PASS_B_MAX_CALLS);
  if (!Number.isSafeInteger(cap) || cap < 1 || cap > maxCallsForPhase) throw new LeaseBusyError(`PASS_B_MAX_CALLS must be 1-${maxCallsForPhase} for this phase (got ${env.PASS_B_MAX_CALLS})`);
  // Reservations and outcomes are pushed, so the evidence must live inside the evidence checkout (the cloud
  // wrapper's layout: data/incoming -> $PASS_B_REMOTE_EVIDENCE/incoming).
  for (const p of [phaseDir, runDir, dirname(usageLog)]) if (!inside(root, p)) throw new LeaseBusyError(`${p} is not inside the evidence checkout ${root}; run from the shared layout (data/incoming -> evidence incoming/)`);
  // The Phase A allowance is bound once to this run and cannot change afterwards.
  const allowance = { version: OPS_VERSION, runId, budgetId: env.PASS_B_CALL_BUDGET_ID, maxCalls: cap, budgetPath: executionBudgetPath(env) };
  const ap = join(runDir, 'allowance.json');
  if (existsSync(ap)) { const prior = JSON.parse(readFileSync(ap, 'utf8')); if (prior.runId !== runId || prior.budgetId !== allowance.budgetId || prior.maxCalls !== cap) throw new LeaseBusyError(`allowance binding changed (bound ${prior.budgetId}/${prior.maxCalls}); a new allowance needs a new run version`); }
  else { writeFileSync(ap, `${JSON.stringify(allowance, null, 1)}\n`, { flag: 'wx', mode: 0o600, flush: true }); persist(root, [ap], `teaching-v2 allowance ${allowance.budgetId} (${cap})`); }
  const pacer = makePacer({ logPath: usageLog, maxCalls: cap, statePath: allowance.budgetPath });
  return {
    root, pacer, allowance, usageLog,
    // Before EVERY reservation: latch, lease (still ours), then the shared pacer (which records an allowance slot).
    gate() {
      assertNotLatched(phaseDir);
      assertExecutionLease({ env });
      const d = pacer.check();
      if (!d.go) throw new PauseRun(`pacing: ${d.reason}`);
      return d;
    },
    persist: (paths, message) => persist(root, [...paths, pacer.statePath, usageLog], message), // PersistError propagates
    record: (stdout, source) => { try { return recordObservation(usageLog, stdout, { source }); } catch { return null; } },
    latch: info => writeLatch(phaseDir, { ...info, runId }, { root }),
  };
}
