// Smallest Pass-B-specific guarded approval/apply tool (VSD-023). Applies ONE owner-approved work's B4
// output to production (data/teach-works.js + data/hotspots.js), with explicit field-level approval + documented
// owner edits, full binding + schema + evidence re-verification, concurrent-change detection, atomic write,
// and dry-run by default. It NEVER infers approval, NEVER mutates quarantined evidence, and rejects the whole
// operation before writing on any failure. Not a batch merge; not a generalized platform.
import { readFileSync, existsSync, writeFileSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from './vision-legacy.mjs';
import { validateStageBody } from './vision-content-schema.mjs';
import { completionKey } from './vision-content-capture.mjs';
import { verifyStageEvidence, VALIDATION_CONTRACT_VERSION } from './pass-b-calibration.mjs';
import { scanTeachEntry } from './public-output-leak.mjs';

export const APPROVAL_VERSION = 'passBApproval/1';
export const APPROVABLE_FIELDS = Object.freeze(['why', 'cues', 'guide', 'notes', 'hotspots']);
const TEACH_ANCHOR = 'window.ARTEFACTUM_CUES.work=';
const HOTSPOTS_ANCHOR = 'window.ARTEFACTUM_HOTSPOTS = ';

export const fileSha = (p) => sha256(readFileSync(p, 'utf8'));

// Deterministic B4 -> production projection. Owner edits override the named fields in the OUTPUT only.
export function projectToProduction(b4, ownerEdits = {}) {
  const teach = {
    why: 'why' in ownerEdits ? ownerEdits.why : b4.proposedWhy,
    cues: 'cues' in ownerEdits ? ownerEdits.cues : (Array.isArray(b4.proposedCues) ? b4.proposedCues.slice() : []),
    guide: 'guide' in ownerEdits ? ownerEdits.guide : (b4.guide || []).map((g) => ({ q: g.q, a: g.a })),
    notes: 'notes' in ownerEdits ? ownerEdits.notes : (b4.notes || []).map((n) => ({ head: n.head, body: n.body, x: n.pin?.x ?? null, y: n.pin?.y ?? null })),
  };
  const hotspots = 'hotspots' in ownerEdits ? ownerEdits.hotspots : (b4.hotspots || []).map((h) => ({ n: h.rank, x: h.x, y: h.y }));
  return { teach, hotspots };
}

function b4CompletionPath(runDir, workId) { return join(runDir, 'works', sha256(workId).slice(0, 24), 'completions', `b4-${completionKey('B4', workId)}.json`); }
function stageBody(runDir, workId, stage) {
  const p = join(runDir, 'works', sha256(workId).slice(0, 24), 'completions', `${stage.toLowerCase()}-${completionKey(stage, workId)}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')).body : null;
}

// Build a PENDING approval bound to the run + completion + files. ownerApproved starts false — a human must
// flip it after inspecting the card. Approval is never inferred from schema readiness.
export function buildApproval({ runDir, workId, approvedFields = APPROVABLE_FIELDS.slice(), ownerEdits = {}, teachPath, hotspotsPath, createdAt = null }) {
  const cpath = b4CompletionPath(runDir, workId);
  const raw = readFileSync(cpath, 'utf8');
  const completion = JSON.parse(raw);
  const b0 = JSON.parse(readFileSync(join(runDir, 'works', sha256(workId).slice(0, 24), 'b0-prep.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(join(runDir, 'run-manifest.json'), 'utf8'));
  const approvedRecord = projectToProduction(completion.body, ownerEdits);
  return {
    version: APPROVAL_VERSION, ownerApproved: false, createdAt,
    runId: manifest.runId, workId,
    imgSha256: b0.image?.imgSha256 ?? completion.imgSha256,
    b4CompletionSha256: sha256(raw),
    validationContractVersion: VALIDATION_CONTRACT_VERSION,
    approvedFields, ownerEdits,
    fileGuards: { teach: fileSha(teachPath), hotspots: fileSha(hotspotsPath) },
    approvedRecord,
  };
}

// --- production-file upsert (preserve exact formatting: byte-identical except the one entry) ---
// Find the value span of "id": in a minified object literal, respecting strings/escapes and brace/bracket depth.
function entryValueSpan(text, id) {
  const keyTok = JSON.stringify(id) + ':';
  const at = text.indexOf(keyTok);
  if (at < 0) return null;
  let i = at + keyTok.length; const start = i;
  let depth = 0, inStr = false, esc = false; const openers = { '{': 1, '[': 1 }, closers = { '}': 1, ']': 1 };
  for (; i < text.length; i++) {
    const ch = text[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') { inStr = true; continue; }
    if (openers[ch]) depth++;
    else if (closers[ch]) { depth--; if (depth === 0) { return { keyStart: at, valueStart: start, valueEnd: i + 1 }; } }
    else if (depth === 0 && (ch === ',' || ch === '}')) return { keyStart: at, valueStart: start, valueEnd: i }; // scalar value
  }
  return null;
}
// Return the full new file text with `id` set to `value` (compact JSON), inserted new or replaced in place.
export function upsertEntryText(fileText, anchor, id, value) {
  const valueJson = JSON.stringify(value);
  const span = entryValueSpan(fileText, id);
  if (span) return fileText.slice(0, span.valueStart) + valueJson + fileText.slice(span.valueEnd); // replace value only
  const a = fileText.indexOf(anchor);
  if (a < 0) throw new Error(`anchor not found: ${anchor}`);
  const brace = fileText.indexOf('{', a);
  if (brace < 0) throw new Error('object open brace not found after anchor');
  const afterBrace = brace + 1;
  const emptyObj = /^\s*\}/.test(fileText.slice(afterBrace)); // no existing entries
  const insertion = `${JSON.stringify(id)}:${valueJson}${emptyObj ? '' : ','}`;
  return fileText.slice(0, afterBrace) + insertion + fileText.slice(afterBrace);
}

// The guarded apply. Returns { ok, errors, dryRun, wrote, diff }. Rejects the WHOLE op before any write on any
// binding/schema/evidence/concurrency failure. apply=false (default) never writes.
export function applyApproval({ approval, runDir, teachPath, hotspotsPath, apply = false }) {
  const errors = [];
  const rej = (e) => { errors.push(e); return { ok: false, errors, dryRun: !apply, wrote: false }; };
  if (!approval || approval.version !== APPROVAL_VERSION) return rej('bad-approval-version');
  // 1. NEVER infer approval — require an explicit human flag.
  if (approval.ownerApproved !== true) return rej('missing-owner-approval');
  // 2. approvedFields must be a subset of the allowlist; ownerEdits only for approved fields.
  for (const f of approval.approvedFields || []) if (!APPROVABLE_FIELDS.includes(f)) return rej(`unauthorized-field:${f}`);
  for (const f of Object.keys(approval.ownerEdits || {})) if (!(approval.approvedFields || []).includes(f)) return rej(`edit-not-approved:${f}`);
  // 3. Reopen the source completion + verify all bindings.
  const cpath = b4CompletionPath(runDir, approval.workId);
  if (!existsSync(cpath)) return rej('completion-missing');
  const rawC = readFileSync(cpath, 'utf8');
  if (sha256(rawC) !== approval.b4CompletionSha256) return rej('binding:completion-sha');
  const completion = JSON.parse(rawC);
  if (completion.workId !== approval.workId) return rej('binding:workId');
  if (completion.imgSha256 !== approval.imgSha256) return rej('binding:imgSha256');
  if (approval.validationContractVersion !== VALIDATION_CONTRACT_VERSION) return rej('binding:validationContractVersion');
  const manifest = JSON.parse(readFileSync(join(runDir, 'run-manifest.json'), 'utf8'));
  if (manifest.runId !== approval.runId) return rej('binding:runId');
  // 4. Reopen and re-verify the source execution evidence.
  const b0 = JSON.parse(readFileSync(join(runDir, 'works', sha256(approval.workId).slice(0, 24), 'b0-prep.json'), 'utf8'));
  const ev = verifyStageEvidence({ stage: 'B4', workRunDir: join(runDir, 'works', sha256(approval.workId).slice(0, 24)), completion, imageBasename: `${b0.image.imgSha256}.${b0.image.ext}`, b1: stageBody(runDir, approval.workId, 'B1'), b2: stageBody(runDir, approval.workId, 'B2'), b3: stageBody(runDir, approval.workId, 'B3'), legacy: b0.legacy });
  if (!ev.ok) return rej(`evidence:${ev.errors.join('|')}`);
  // 5. Re-project from the reopened completion; verbatim approved fields must match the approval exactly.
  const reProjected = projectToProduction(completion.body, approval.ownerEdits);
  const editedFields = new Set(Object.keys(approval.ownerEdits || {}));
  for (const f of approval.approvedFields || []) {
    if (editedFields.has(f)) continue; // documented owner edit
    const target = f === 'hotspots' ? reProjected.hotspots : reProjected.teach[f];
    const stored = f === 'hotspots' ? approval.approvedRecord.hotspots : approval.approvedRecord.teach[f];
    if (JSON.stringify(target) !== JSON.stringify(stored)) return rej(`tampered:${f}`);
  }
  // 6. Validate the final edited record against the CURRENT strict schema before any write.
  const candidate = JSON.parse(JSON.stringify(completion.body));
  if ('why' in (approval.ownerEdits || {})) candidate.proposedWhy = approval.ownerEdits.why;
  const val = validateStageBody('B4', candidate);
  if (!val.ok) return rej(`invalid-edited-output:${(val.errors || []).join(',')}`);
  // 6b. Player-copy language gate: refuse to ship why/cues/notes/guide that reference the generation pipeline.
  const leaks = scanTeachEntry(reProjected.teach);
  if (leaks.length) return rej(`player-copy-leak:${leaks.map((l) => `${l.field}:${l.label}`).join(',')}`);
  // 7. Concurrent-change detection on the production files.
  if (fileSha(teachPath) !== approval.fileGuards.teach) return rej('concurrent-change:teach');
  if (fileSha(hotspotsPath) !== approval.fileGuards.hotspots) return rej('concurrent-change:hotspots');
  // 8. Compute before/after + the full new file contents (build in memory; nothing written yet).
  const teachText = readFileSync(teachPath, 'utf8');
  const hotspotsText = readFileSync(hotspotsPath, 'utf8');
  const existingTeach = entryValueSpan(teachText, approval.workId);
  const existingHot = entryValueSpan(hotspotsText, approval.workId);
  const newTeachText = upsertEntryText(teachText, TEACH_ANCHOR, approval.workId, reProjected.teach);
  const newHotspotsText = upsertEntryText(hotspotsText, HOTSPOTS_ANCHOR, approval.workId, reProjected.hotspots);
  const diff = {
    workId: approval.workId,
    teach: { action: existingTeach ? 'replace' : 'add', after: reProjected.teach },
    hotspots: { action: existingHot ? 'replace' : 'add', after: reProjected.hotspots },
    testsThatWouldRun: ['node tests/dom-harness.mjs', 'node scripts/check-pool.mjs', 'node scripts/check-design.mjs', 'node scripts/check-public-output.mjs'],
  };
  if (!apply) return { ok: true, dryRun: true, wrote: false, diff };
  // 9. Atomic write (partial-write prevention): write each file to a temp then rename over the original.
  const wtmp = (p, text) => { const tmp = `${p}.tmp-approve`; writeFileSync(tmp, text, { mode: 0o644 }); renameSync(tmp, p); };
  wtmp(teachPath, newTeachText);
  wtmp(hotspotsPath, newHotspotsText);
  return { ok: true, dryRun: false, wrote: true, diff };
}
