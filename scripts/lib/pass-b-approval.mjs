// Pass-B-specific guarded approval/apply tool (VSD-023/035). Applies ONE owner-approved, reconciled work's B4
// output to production (data/teach-works.js + data/hotspots.js), with explicit field-level approval + documented
// owner edits, full binding + schema + evidence re-verification, concurrent-change detection, atomic write,
// and dry-run by default. It NEVER infers approval, NEVER mutates quarantined evidence, and rejects the whole
// operation before writing on any failure. Not a batch merge; not a generalized platform.
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { sha256, stableJson } from './vision-legacy.mjs';
import { validateStageBody } from './vision-content-schema.mjs';
import { verifyStageEvidence, VALIDATION_CONTRACT_VERSION } from './pass-b-calibration.mjs';
import { scanTeachEntry } from './public-output-leak.mjs';
import { loadCanonicalFindings, evaluateApproval } from './pass-b-blocked-findings.mjs';
import {
  loadReconciliationSources, loadAndVerifyReconciliation, ineligibleApprovedComponents,
  eligibleComponentIds, RECONCILIATION_POLICY_VERSION,
} from './pass-b-reconciliation.mjs';

export const APPROVAL_VERSION = 'passBApproval/3';
export const APPROVABLE_FIELDS = Object.freeze(['why', 'cues', 'guide', 'notes', 'hotspots']);
// VSD-037: notes carry pins and hotspots are pins over the same notes. Coupling is ONE-WAY — changing notes
// without also approving hotspots can leave pins pointing at changed/removed notes, so it is rejected;
// approving hotspots alone is allowed (coordinate-only review while notes stay unchanged).
export function surfaceCouplingViolation(approvedFields) {
  const s = new Set(approvedFields || []);
  return s.has('notes') && !s.has('hotspots') ? 'notes-approval-requires-hotspots' : null;
}
// Structurally validate the FINAL production projection (teach + hotspots) — the actual bytes that would be
// written — since strict B4 validation only re-applies the `why` owner edit and never structurally checks
// edited cues/guide/notes/hotspots. Coordinates are nullable on notes (unpinned) but required on hotspots,
// and every hotspot rank `n` must reference an existing projected note.
export function validateProductionProjection(projected) {
  const errors = []; const need = (v, m) => { if (!v) errors.push(m); };
  const coord = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;
  const t = projected?.teach || {};
  need(typeof t.why === 'string', 'why must be a string');
  need(Array.isArray(t.cues) && t.cues.every((c) => typeof c === 'string'), 'cues must be an array of strings');
  need(Array.isArray(t.guide) && t.guide.every((g) => g && typeof g.q === 'string' && typeof g.a === 'string'), 'guide must be an array of {q,a} strings');
  const notes = t.notes;
  need(Array.isArray(notes) && notes.every((n) => n && typeof n.head === 'string' && typeof n.body === 'string' && (n.x === null || coord(n.x)) && (n.y === null || coord(n.y))), 'notes must be {head,body,x,y} with null or 0-100 coordinates');
  const noteCount = Array.isArray(notes) ? notes.length : 0;
  const hotspots = projected?.hotspots;
  if (!Array.isArray(hotspots)) { need(false, 'hotspots must be an array'); return { ok: errors.length === 0, errors }; }
  const seen = new Set();
  for (const h of hotspots) {
    need(h && Number.isInteger(h.n) && coord(h.x) && coord(h.y), 'hotspot must be {n:integer, x,y in 0-100}');
    if (!h || !Number.isInteger(h.n)) continue;
    need(!seen.has(h.n), `duplicate hotspot n:${h.n}`); seen.add(h.n);
    need(h.n >= 1 && h.n <= noteCount, `hotspot n:${h.n} does not reference an existing projected note (1..${noteCount})`);
  }
  return { ok: errors.length === 0, errors };
}
const TEACH_ANCHOR = 'window.ARTEFACTUM_CUES.work=';
const HOTSPOTS_ANCHOR = 'window.ARTEFACTUM_HOTSPOTS = ';

export const fileSha = (p) => sha256(readFileSync(p, 'utf8'));

// Content-block candidate keyed by BOTH available hash-bases: rawResponseSha256 (cal50 completion) and, when
// the completion carries a parsed delta (b4r-style), rawDeltaSha256 — so both the source completion and its
// rehydrated descendants match. workId-level blocking (see evaluateApproval) is the standing guarantee.
function contentBlockCandidate(workId, completion) {
  const c = { workId, rawResponseSha256: completion.rawResponseSha256 ?? null };
  if (completion.rawDelta != null) c.rawDeltaSha256 = sha256(stableJson(completion.rawDelta));
  return c;
}

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
// NOTE (VSD-037): this module's approval path (buildApproval/applyApproval) does NOT enforce the identity
// precedence/omission rule. That rule is currently a SEPARATE, conservative owner-REVIEW projection aid in
// scripts/lib/pass-b-identity-precedence.mjs (composed by scripts/pass-b-content-repair-owner-review.mjs); it is
// NOT wired into guarded approval or reconciliation. The durable release path remains reconciliation +
// explicit owner edits/decisions keyed on stable component/claim ids — never lexical filtering.

// Build a PENDING approval bound to the run + completion + files. ownerApproved starts false — a human must
// flip it after inspecting the card. Approval is never inferred from schema readiness.
export function buildApproval({ runDir, workId, approvedFields = APPROVABLE_FIELDS.slice(), ownerEdits = {}, teachPath, hotspotsPath, createdAt = null }) {
  if (!Array.isArray(approvedFields) || !approvedFields.length || new Set(approvedFields).size !== approvedFields.length || approvedFields.some(f => !APPROVABLE_FIELDS.includes(f))) throw new Error('approvedFields must be a nonempty unique subset of the allowlist');
  { const cpl = surfaceCouplingViolation(approvedFields); if (cpl) throw new Error(cpl); }
  if (Object.keys(ownerEdits || {}).some(f => !approvedFields.includes(f))) throw new Error('ownerEdits may target approved fields only');
  const sources = loadReconciliationSources(runDir, workId);
  const raw = sources.b4Raw;
  const completion = sources.b4Completion;
  // VSD-034/035: exact blocked content can NEVER be staged. A genuinely fresh completion of the same work
  // may proceed only after the reconciliation decision artifact explicitly resolves every canonical finding;
  // that bound resolution is checked after the report is reopened below. Findings are always loaded from the
  // canonical sealed artifact internally — caller-supplied findings/resolutions cannot bypass this gate.
  const findings = loadCanonicalFindings();
  const blockCandidate = contentBlockCandidate(workId, completion);
  const initialBlock = evaluateApproval({ findings, candidate: blockCandidate, resolution: null });
  if (!initialBlock.allowed && initialBlock.reason === 'content-blocked-descendant') throw new Error(`content-blocked: refusing to build approval for ${workId} (${initialBlock.reason}${initialBlock.findingId ? `, ${initialBlock.findingId}` : ''})`);
  const b0 = sources.b0;
  const manifest = sources.manifest;
  const approvedRecord = projectToProduction(sources.b4, ownerEdits);
  { const pv = validateProductionProjection(approvedRecord); if (!pv.ok) throw new Error(`invalid-projection:${pv.errors.join('|')}`); }
  // VSD-035: structural validity + owner intent are not content readiness. Reopen the full B0-B4 bundle,
  // verify the immutable reconciliation artifacts, and refuse to stage any selected component that is not
  // eligible. Model-proposed verdicts and model-resolved conflicts never satisfy this gate.
  const rec = loadAndVerifyReconciliation({ sources, projectedRecord: approvedRecord });
  if (!rec.ok) throw new Error(`reconciliation-invalid: ${rec.errors.join('|')}`);
  const blockDecision = evaluateApproval({ findings, candidate: blockCandidate, resolution: rec.decisions.blockedFindingResolutions });
  if (!blockDecision.allowed) throw new Error(`content-blocked: refusing to build approval for ${workId} (${blockDecision.reason}${blockDecision.findingId ? `, ${blockDecision.findingId}` : ''})`);
  const held = ineligibleApprovedComponents(rec.report, approvedFields);
  if (held.length) throw new Error(`reconciliation-not-eligible: ${held.map(c => `${c.componentId}:${c.contentReadiness}`).join(',')}`);
  return {
    version: APPROVAL_VERSION, ownerApproved: false, createdAt,
    runId: manifest.runId, workId,
    imgSha256: b0.image?.imgSha256 ?? sources.sourceBindings.imageSha256,
    b4CompletionSha256: sha256(raw),
    validationContractVersion: VALIDATION_CONTRACT_VERSION,
    approvedFields, ownerEdits,
    fileGuards: { teach: fileSha(teachPath), hotspots: fileSha(hotspotsPath) },
    reconciliation: {
      policyVersion: RECONCILIATION_POLICY_VERSION,
      activationSha256: rec.activation.activationSha256,
      reportSha256: rec.report.reportSha256,
      claimBundleSha256: rec.report.claimBundleSha256,
      decisionsSha256: rec.report.decisionsSha256,
      eligibleComponentIds: eligibleComponentIds(rec.report, approvedFields),
    },
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
function existingEntryValue(fileText, id) {
  const span = entryValueSpan(fileText, id);
  return span ? JSON.parse(fileText.slice(span.valueStart, span.valueEnd)) : null;
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
  if (!Array.isArray(approval.approvedFields) || !approval.approvedFields.length || new Set(approval.approvedFields).size !== approval.approvedFields.length) return rej('invalid-approved-fields');
  for (const f of approval.approvedFields) if (!APPROVABLE_FIELDS.includes(f)) return rej(`unauthorized-field:${f}`);
  { const cpl = surfaceCouplingViolation(approval.approvedFields); if (cpl) return rej(cpl); }
  for (const f of Object.keys(approval.ownerEdits || {})) if (!(approval.approvedFields || []).includes(f)) return rej(`edit-not-approved:${f}`);
  // 3. Reopen the source completion + verify all bindings.
  let sources;
  try { sources = loadReconciliationSources(runDir, approval.workId); }
  catch (e) { return rej(`completion-missing-or-invalid:${e.message}`); }
  const rawC = sources.b4Raw;
  if (sha256(rawC) !== approval.b4CompletionSha256) return rej('binding:completion-sha');
  const completion = sources.b4Completion;
  if ((completion.workId ?? completion.id) !== approval.workId) return rej('binding:workId');
  // 3b. Reject exact blocked content before any evidence work. Fresh corrected content is checked against
  // the immutable reconciliation resolution later; a resolution embedded in the approval object is ignored.
  const findings = loadCanonicalFindings();
  const blockCandidate = contentBlockCandidate(approval.workId, completion);
  const initialBlock = evaluateApproval({ findings, candidate: blockCandidate, resolution: null });
  if (!initialBlock.allowed && initialBlock.reason === 'content-blocked-descendant') return rej(`content-blocked:${initialBlock.findingId || ''}:${initialBlock.reason}`);
  if (sources.sourceBindings.imageSha256 !== approval.imgSha256) return rej('binding:imgSha256');
  if (approval.validationContractVersion !== VALIDATION_CONTRACT_VERSION) return rej('binding:validationContractVersion');
  const manifest = sources.manifest;
  if (manifest.runId !== approval.runId) return rej('binding:runId');
  // 4. Reopen and re-verify the source execution evidence.
  const b0 = sources.b0;
  // Derived-offline B4 evidence is re-verified by loadReconciliationSources: evidence-manifest binding,
  // source-record hash, unchanged raw delta, upstream B0-B3 hashes, source transcript SHA, model account
  // provenance. Standard stage completions retain the original verifyStageEvidence path.
  const ev = sources.derived ? { ok: true, errors: [] } : verifyStageEvidence({ stage: 'B4', workRunDir: sources.evidenceWdir, completion, imageBasename: `${b0.image.imgSha256}.${b0.image.ext}`, b1: sources.b1, b2: sources.b2, b3: sources.b3, legacy: b0.legacy });
  if (!ev.ok) return rej(`evidence:${ev.errors.join('|')}`);
  // 5. Re-project from the reopened completion; verbatim approved fields must match the approval exactly.
  const reProjected = projectToProduction(sources.b4, approval.ownerEdits);
  { const pv = validateProductionProjection(reProjected); if (!pv.ok) return rej(`invalid-projection:${pv.errors.join('|')}`); }
  // 5a. Reopen/recompute reconciliation against the exact projected output. A stale report, changed source,
  // changed owner edit, tampered decision, or newly held component rejects the whole operation.
  const rec = loadAndVerifyReconciliation({ sources, projectedRecord: reProjected });
  if (!rec.ok) return rej(`reconciliation-invalid:${rec.errors.join('|')}`);
  const blockDecision = evaluateApproval({ findings, candidate: blockCandidate, resolution: rec.decisions.blockedFindingResolutions });
  if (!blockDecision.allowed) return rej(`content-blocked:${blockDecision.findingId || ''}:${blockDecision.reason}`);
  const recBinding = approval.reconciliation;
  if (!recBinding || recBinding.policyVersion !== RECONCILIATION_POLICY_VERSION
    || recBinding.activationSha256 !== rec.activation.activationSha256
    || recBinding.reportSha256 !== rec.report.reportSha256
    || recBinding.claimBundleSha256 !== rec.report.claimBundleSha256
    || recBinding.decisionsSha256 !== rec.report.decisionsSha256) return rej('binding:reconciliation');
  const held = ineligibleApprovedComponents(rec.report, approval.approvedFields);
  if (held.length) return rej(`reconciliation-not-eligible:${held.map(c => `${c.componentId}:${c.contentReadiness}`).join(',')}`);
  if (stableJson(recBinding.eligibleComponentIds || []) !== stableJson(eligibleComponentIds(rec.report, approval.approvedFields))) return rej('binding:reconciliation-components');
  const editedFields = new Set(Object.keys(approval.ownerEdits || {}));
  for (const f of approval.approvedFields || []) {
    if (editedFields.has(f)) continue; // documented owner edit
    const target = f === 'hotspots' ? reProjected.hotspots : reProjected.teach[f];
    const stored = f === 'hotspots' ? approval.approvedRecord.hotspots : approval.approvedRecord.teach[f];
    if (JSON.stringify(target) !== JSON.stringify(stored)) return rej(`tampered:${f}`);
  }
  // 6. Validate the final edited record against the CURRENT strict schema before any write.
  const candidate = JSON.parse(JSON.stringify(sources.b4));
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
  const existingTeach = existingEntryValue(teachText, approval.workId);
  const existingHot = existingEntryValue(hotspotsText, approval.workId);
  const selected = new Set(approval.approvedFields || []);
  const teachSelected = ['why', 'cues', 'guide', 'notes'].filter(f => selected.has(f));
  const teachAfter = { ...(existingTeach || {}) };
  for (const f of teachSelected) teachAfter[f] = reProjected.teach[f];
  const hotspotsAfter = selected.has('hotspots') ? reProjected.hotspots : existingHot;
  const newTeachText = teachSelected.length ? upsertEntryText(teachText, TEACH_ANCHOR, approval.workId, teachAfter) : teachText;
  const newHotspotsText = selected.has('hotspots') ? upsertEntryText(hotspotsText, HOTSPOTS_ANCHOR, approval.workId, hotspotsAfter) : hotspotsText;
  const diff = {
    workId: approval.workId,
    teach: { action: teachSelected.length ? (existingTeach ? 'replace-approved-fields' : 'add-approved-fields') : 'unchanged', approvedFields: teachSelected, after: teachAfter },
    hotspots: { action: selected.has('hotspots') ? (existingHot ? 'replace' : 'add') : 'unchanged', after: hotspotsAfter },
    testsThatWouldRun: ['node tests/dom-harness.mjs', 'node scripts/check-pool.mjs', 'node scripts/check-design.mjs', 'node scripts/check-public-output.mjs'],
  };
  if (!apply) return { ok: true, dryRun: true, wrote: false, diff };
  // 9. Atomic write (partial-write prevention): write each file to a temp then rename over the original.
  const wtmp = (p, text) => { const tmp = `${p}.tmp-approve`; writeFileSync(tmp, text, { mode: 0o644 }); renameSync(tmp, p); };
  if (newTeachText !== teachText) wtmp(teachPath, newTeachText);
  if (newHotspotsText !== hotspotsText) wtmp(hotspotsPath, newHotspotsText);
  return { ok: true, dryRun: false, wrote: true, diff };
}
