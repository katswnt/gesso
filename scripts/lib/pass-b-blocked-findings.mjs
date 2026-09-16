// VSD-034 item 1: immutable, ancestry-bound content-blocked findings.
//
// A finding records a work whose Pass B content is factually wrong (La Gloire figure inversion +
// invented wings/skull/wrong-medium; St. John human-penitent-as-"lion" entity aliasing). It is bound to
// the STABLE cross-derivative fingerprint {workId, rawDeltaSha256}: the editorial delta is byte-identical
// across b4c -> b4r rehydration (verified), while the hydrated body/record hash is not. Binding to the
// record hash would be defeated by a rehydration that changes the hash while preserving the false content
// (the "laundering" failure); binding to the delta is not.
//
// Enforcement (evaluateApproval): a candidate whose (workId, rawDeltaSha256) matches a finding is a
// descendant of the exact blocked content and is HARD-blocked. A DIFFERENT delta for a blocked WORK (a
// fresh run) is not a descendant, but a blocked work still requires a resolution artifact that explicitly
// resolves every blocked claim and attests a fresh run under the corrected contract (VSD-034). This is
// pure/deterministic; it makes no model call and reads no image.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sha256, stableJson } from './vision-legacy.mjs';

export const CONTENT_BLOCKED_VERSION = 'passBContentBlocked/1';
export function canonicalBlockedWorkId(workId) {
  const value = String(workId || '');
  const match = value.match(/^(?:wikidata:|https?:\/\/(?:www\.)?wikidata\.org\/entity\/)(Q\d+)$/i);
  return match ? `wikidata:${match[1].toUpperCase()}` : value;
}

// The canonical enforcement artifact resolved from the MODULE location (repo root), independent of cwd, so
// enforcement cannot be bypassed by running from a different directory or passing a bogus path.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CANONICAL_FINDINGS_PATH = join(REPO_ROOT, 'data', 'vision-content-blocked.json');

// Load + integrity-verify the canonical findings. MANDATORY and fail-closed: a missing or tampered artifact
// THROWS (never returns an empty block set). This is the only loader the approval path uses in production.
export function loadCanonicalFindings() {
  if (!existsSync(CANONICAL_FINDINGS_PATH)) throw new Error(`content-blocked findings artifact missing (fail-closed): ${CANONICAL_FINDINGS_PATH}`);
  const v = verifyFindingsArtifact(JSON.parse(readFileSync(CANONICAL_FINDINGS_PATH, 'utf8')));
  if (!v.ok) throw new Error(`content-blocked findings artifact invalid (fail-closed): ${v.error}`);
  return v.findings;
}

// The stable content fingerprint of a B4 record (b4c-style or b4r-style; both carry rawDelta verbatim).
export function contentFingerprint(record) {
  if (!record || typeof record !== 'object') throw new Error('record required');
  if (record.rawDelta == null) throw new Error('record has no rawDelta (cannot fingerprint content)');
  return { workId: record.id, rawDeltaSha256: sha256(stableJson(record.rawDelta)) };
}

// Build one finding. Content is bound by TWO stable hash-bases so both the source cal50 completion and its
// b4r-style derivatives are caught: `rawDeltaSha256` = sha256(stableJson(rawDelta)) matches hydrated records
// that carry the parsed delta (b4r); `rawResponseSha256` = the completion's raw B4 response hash matches the
// upstream cal50 completion (which stores no parsed delta). imgSha256/provenance are recorded for context.
export function buildFinding({ workId, rawDeltaSha256, rawResponseSha256 = null, imgSha256, blockedClaims, reason, provenance }) {
  if (!workId || !/^[0-9a-f]{64}$/.test(rawDeltaSha256 || '')) throw new Error('finding needs workId + rawDeltaSha256');
  if (rawResponseSha256 !== null && !/^[0-9a-f]{64}$/.test(rawResponseSha256)) throw new Error('bad rawResponseSha256');
  if (!Array.isArray(blockedClaims) || !blockedClaims.length) throw new Error('finding needs >=1 blockedClaim');
  const core = { workId, rawDeltaSha256, rawResponseSha256, imgSha256: imgSha256 ?? null, blockedClaims: blockedClaims.slice(), reason: String(reason || '') };
  return { findingId: `cb-${sha256(stableJson(core)).slice(0, 12)}`, ...core, provenance: provenance ?? null };
}

// Wrap findings in a self-hashed, immutable artifact. The seal covers the COMPLETE findings array (every
// field: findingId, both content hashes, imgSha256, blockedClaims, reason, provenance) so ANY mutation is
// detected — not just a subset.
export function sealFindings(findings, note = '') {
  return { version: CONTENT_BLOCKED_VERSION, generatedNote: note, findings, findingsSha256: sha256(stableJson(findings)) };
}

// Verify the artifact has not been tampered with (immutability check on load). Recomputes over the full findings.
export function verifyFindingsArtifact(artifact) {
  if (!artifact || artifact.version !== CONTENT_BLOCKED_VERSION) return { ok: false, error: 'bad-version' };
  if (sha256(stableJson(artifact.findings || [])) !== artifact.findingsSha256) return { ok: false, error: 'findings-sha-mismatch' };
  return { ok: true, findings: artifact.findings };
}

// Exact-content descendant match: same work AND the same content by EITHER hash-base (delta or raw response).
export function matchFinding(findings, { workId, rawDeltaSha256 = null, rawResponseSha256 = null }) {
  const canonical = canonicalBlockedWorkId(workId);
  return (findings || []).find((f) => canonicalBlockedWorkId(f.workId) === canonical
    && ((rawDeltaSha256 && f.rawDeltaSha256 === rawDeltaSha256) || (rawResponseSha256 && f.rawResponseSha256 && f.rawResponseSha256 === rawResponseSha256))) || null;
}
// Any finding for this work (used to require a resolution even for a fresh, different-delta run).
export function findingsForWork(findings, workId) {
  const canonical = canonicalBlockedWorkId(workId);
  return (findings || []).filter((f) => canonicalBlockedWorkId(f.workId) === canonical);
}

// VSD-035 clearing contract. The guarded approval path accepts resolutions only from the immutable,
// claim-bundle-bound decisions artifact; caller/approval-object fields are ignored. A decision artifact still
// requires the separate final ownerApproved act before publication. This pure function enforces the content
// side of that boundary.
// A resolution clears a finding only if it targets that finding, attests a fresh run, resolves EVERY blocked
// claim, and the candidate content is NOT the blocked content. Never self-inferred; a new record hash never clears.
export function resolutionClears(finding, resolution, candidate) {
  if (!resolution || resolution.findingId !== finding.findingId) return false;
  if (resolution.authority !== 'owner' && resolution.authority !== 'authoritative-source') return false;
  if (resolution.freshRun !== true) return false;
  const sameContent = (candidate.rawDeltaSha256 && candidate.rawDeltaSha256 === finding.rawDeltaSha256)
    || (candidate.rawResponseSha256 && finding.rawResponseSha256 && candidate.rawResponseSha256 === finding.rawResponseSha256);
  if (sameContent) return false; // the exact blocked content is never "resolved"; a fresh run must be new content
  const resolved = new Set((resolution.resolvedClaims || []).map((c) => c.claim));
  return finding.blockedClaims.every((c) => resolved.has(c));
}

// The enforcement decision for an approval candidate. `candidate` = {workId, rawDeltaSha256?, rawResponseSha256?}.
// Returns { allowed, reason, findingId }. Fail-closed: a blocked WORK is refused unless a valid resolution
// clears every finding for that work, and the exact blocked content is refused even with a resolution.
export function evaluateApproval({ findings, candidate, resolution = null }) {
  const exact = matchFinding(findings, candidate);
  if (exact) return { allowed: false, reason: 'content-blocked-descendant', findingId: exact.findingId };
  const forWork = findingsForWork(findings, candidate.workId);
  if (forWork.length) {
    const resolutions = Array.isArray(resolution) ? resolution : resolution ? [resolution] : [];
    if (forWork.every((f) => resolutions.some((r) => resolutionClears(f, r, candidate)))) return { allowed: true, reason: 'resolved-fresh-run', findingId: forWork[0].findingId };
    return { allowed: false, reason: 'content-blocked-work-needs-resolution', findingId: forWork[0].findingId };
  }
  return { allowed: true, reason: 'not-blocked', findingId: null };
}
