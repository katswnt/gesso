// Teaching-v2 Phase A owner clearances of a preserved fatal / unknown-outcome attempt (VSD-093; Codex review R3-A3).
//
// Authority: a clearance takes effect ONLY as a record in the tracked, reviewed file CLEARANCES_FILE of the CODE
// repository, committed at the HEAD the runner has checked out. The runner reads it with `git show HEAD:<file>` and
// refuses to start while that path has any uncommitted, untracked or ignored change. The runner never writes this
// file, and nothing it writes under the evidence tree (phase-a/, including the old phase-a/latch-clearances.json)
// is ever read as a clearance.
//
// What this guarantees, honestly: the runner and the owner run under the same local UID, so this is a POLICY
// boundary enforced by git review (a clearance is a reviewed commit to the code repo, visible in history and in the
// PR diff), not an OS permission boundary. A process running as that UID could still commit to the repo; what it
// cannot do is make an uncommitted or evidence-tree file count, or reuse a clearance after the evidence changes.
//
// Binding: each record names one attempt (runId, workKey, seq, attempt kind), the stop it clears (fatal |
// unknown-outcome), and the exact sha256 of the attempt's reservation receipt, outcome metadata, completion receipt
// and transcript, recomputed FRESH from disk at every check. A file that does not exist is the literal "absent",
// never a wildcard. Any changed, added or removed byte makes the clearance stale: the stop stands again.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CLEARANCE_VERSION = 'teachingV2LatchClearance/1';
export const CLEARANCES_FILE = 'tasks/teaching-v2-phase-a/latch-clearances.json';
export const EVIDENCE_FILES = Object.freeze({ reservationSha256: 'reserved.json', outcomeSha256: 'meta.json', completionSha256: 'done.json', transcriptSha256: 'transcript.jsonl' });
const KEYS = ['version', 'runId', 'workKey', 'seq', 'attemptKind', 'stopKind', 'reviewer', 'reviewedAt', 'reason', 'evidence'];
const HEX = /^[0-9a-f]{64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;
export class ClearanceError extends Error { constructor(m) { super(m); this.name = 'ClearanceError'; } }

export const fileSha = p => (existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex') : 'absent');
// The four evidence digests of one attempt, fresh from disk ("absent" for a missing file).
export function attemptDigests(adir, stem) {
  return Object.fromEntries(Object.entries(EVIDENCE_FILES).map(([k, ext]) => [k, fileSha(join(adir, `${stem}.${ext}`))]));
}

// Strict schema: every field required, no extra field, explicit "absent". Throws ClearanceError listing every error.
export function validateClearances(list, { source = CLEARANCES_FILE } = {}) {
  const errors = [];
  if (!Array.isArray(list)) throw new ClearanceError(`${source}: must be a JSON array of clearance records`);
  const seen = new Set();
  list.forEach((c, i) => {
    const at = `${source}[${i}]`, err = m => errors.push(`${at}: ${m}`);
    if (!c || typeof c !== 'object' || Array.isArray(c)) { err('not an object'); return; }
    const extra = Object.keys(c).filter(k => !KEYS.includes(k)), missing = KEYS.filter(k => !(k in c));
    if (extra.length) err(`unknown field(s) ${extra.join(', ')}`);
    if (missing.length) err(`missing field(s) ${missing.join(', ')}`);
    if (c.version !== CLEARANCE_VERSION) err(`version must be ${CLEARANCE_VERSION}`);
    if (!/^tv2a-[0-9a-f]{12}$/.test(c.runId ?? '')) err('runId must be a tv2a-<12 hex> run id');
    if (typeof c.workKey !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(c.workKey)) err('workKey must be the work directory key');
    if (!Number.isSafeInteger(c.seq) || c.seq < 1) err('seq must be a positive integer');
    if (!['W', 'V', 'V2'].includes(c.attemptKind)) err('attemptKind must be W, V or V2');
    if (!['fatal', 'unknown-outcome'].includes(c.stopKind)) err('stopKind must be fatal or unknown-outcome');
    if (typeof c.reviewer !== 'string' || c.reviewer.trim().length < 2) err('reviewer must name the owner who reviewed the evidence');
    if (typeof c.reviewedAt !== 'string' || !ISO.test(c.reviewedAt) || Number.isNaN(Date.parse(c.reviewedAt))) err('reviewedAt must be an ISO 8601 timestamp with time and zone');
    if (typeof c.reason !== 'string' || c.reason.trim().length < 20) err('reason must state what was reviewed and why it is cleared (20+ characters)');
    const ev = c.evidence;
    if (!ev || typeof ev !== 'object' || Array.isArray(ev)) err('evidence must be an object');
    else {
      const ek = Object.keys(EVIDENCE_FILES), bad = Object.keys(ev).filter(k => !ek.includes(k)), gone = ek.filter(k => !(k in ev));
      if (bad.length) err(`unknown evidence field(s) ${bad.join(', ')}`);
      if (gone.length) err(`missing evidence field(s) ${gone.join(', ')} (use "absent" for a missing file)`);
      for (const k of ek) if (k in ev && !(ev[k] === 'absent' || HEX.test(ev[k] ?? ''))) err(`evidence.${k} must be a lowercase sha256 or "absent"`);
      if (ev.reservationSha256 === 'absent') err('evidence.reservationSha256 cannot be absent: a clearance names a preserved reservation');
    }
    const id = `${c.runId}/${c.workKey}/${c.seq}/${c.stopKind}`;
    if (seen.has(id)) err(`duplicate clearance for ${id}`); seen.add(id);
  });
  if (errors.length) throw new ClearanceError(`invalid owner clearance file (nothing is cleared until it validates):\n  ${errors.join('\n  ')}`);
  return Object.freeze(list.map(c => Object.freeze({ ...c, evidence: Object.freeze({ ...c.evidence }) })));
}

// The clearance of exactly this attempt and stop, valid only while every evidence digest still equals the bytes
// on disk. Returns { cleared, record, stale } (stale: a record for this attempt exists, but its evidence changed).
export function clearanceOf(clearances, { runId, workKey, seq, attemptKind, stopKind, digests }) {
  const mine = (clearances || []).filter(c => c.runId === runId && c.workKey === workKey && c.seq === seq && c.stopKind === stopKind);
  const record = mine.find(c => c.attemptKind === attemptKind && Object.keys(EVIDENCE_FILES).every(k => c.evidence[k] === digests[k])) || null;
  return { cleared: !!record, record, stale: !record && mine.length > 0 };
}

// Loads the clearances committed at HEAD of the code repo. Refuses (ClearanceError) when the file has any
// uncommitted change, is untracked or ignored, or fails the schema. No file at HEAD = no clearances.
export function loadCommittedClearances({ repoDir = '.', relPath = CLEARANCES_FILE, git = (args) => execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) } = {}) {
  const status = git(['status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching', '--', relPath]).trim();
  if (status) throw new ClearanceError(`${relPath} has uncommitted changes (${status.split('\n')[0]}); a clearance takes effect only once it is committed (reviewed) at the checked-out HEAD`);
  const commit = git(['rev-parse', 'HEAD']).trim();
  const tracked = git(['ls-tree', '--name-only', 'HEAD', '--', relPath]).trim();
  if (!tracked) return { clearances: Object.freeze([]), commit, relPath, present: false };
  const text = git(['show', `HEAD:${relPath}`]);
  let parsed; try { parsed = JSON.parse(text); } catch (e) { throw new ClearanceError(`${relPath} at ${commit.slice(0, 12)} is not valid JSON: ${e.message}`); }
  return { clearances: validateClearances(parsed, { source: `${relPath}@${commit.slice(0, 12)}` }), commit, relPath, present: true };
}
