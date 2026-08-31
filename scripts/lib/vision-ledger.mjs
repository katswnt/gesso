// Vision-audit LEDGER contract — the single, dependency-free source of truth for the pass schema version, the
// component-level completion classifier, the ledger transition, and the eligibility oracle. Kept free of heavy/
// runtime deps (no sharp, no dns/https) ON PURPOSE so the core data gate (check-pool.mjs) and the selector
// (vision-next.mjs) can share the SAME tested helpers without loading the image broker. scripts/lib/vision-run.mjs
// re-exports everything here for the merge/provenance side.

import { validateApprovedPatch } from './vision-schema.mjs';   // dependency-free strict schema (same validator the merge uses)

export const SCHEMA_VERSION = 'vision-audit/1';
// A DISTINCT, IMMUTABLE version for pre-G-03 bare ids. It is never equal to any current SCHEMA_VERSION, so historical
// evidence NEVER satisfies current-pass eligibility (zero works are retroactively considered complete). Promoting a
// legacy batch would require a deliberate, provenance-bound re-audit — never a runtime auto-stamp.
export const LEGACY_PASS = 'legacy/pre-g03';

// A comprehensive pass wants at least this many feature-anchored notes (the prompt asks for 5–7). A pass with
// fewer never counts 'complete' (a single/blank note can't mark a work audited). Tunable in ONE place.
export const MIN_NOTES = 5;

// ---------- image trust (fail-closed; behaviorally testable) ----------
// An IMAGE DEFECT is an EXPLICIT statement that the model saw the WRONG or an UNUSABLE image: image.ok:false, a
// non-'none' image.issue (wrong-art / low-res / other — even alongside ok:true, a contradiction), poor quality, or
// bad framing. Any of these means nothing derived from the image can be trusted.
export function imageDefect(w) {
  return !!w && typeof w === 'object' &&
    ((w.image && (w.image.ok === false || (w.image.issue != null && w.image.issue !== 'none')))
      || w.imageQuality === 'poor' || (w.framing != null && w.framing !== 'ok'));
}
// POSITIVE, EXPLICIT trust: every prerequisite must be affirmed good in the APPROVED subset — image.ok:true AND a
// clean image.issue ('none' or absent) AND imageQuality:'good' AND framing:'ok'. MISSING fields are NOT trusted
// (fail-closed). This is the single predicate that must hold before ANY image-derived value (playability, medium
// legibility, notes, style, medium) may mutate data OR become a terminal status — so a {playable:false}-only
// approval (image fields dropped at review) can never terminally exclude, and a contradictory {ok:true,issue:'wrong-art'}
// can never be trusted.
export function imageTrusted(w) {
  return !!w && typeof w === 'object' &&
    !!w.image && w.image.ok === true && (w.image.issue == null || w.image.issue === 'none')
    && w.imageQuality === 'good' && w.framing === 'ok';
}

// A comprehensive pass is COMPLETE only when EVERY narrow-pass component is explicitly approved: a trusted image
// (image.ok:true + imageQuality:'good' + framing:'ok'), an explicit mediumLegible verdict, an explicit playable:true,
// and a notes/pins verdict (non-empty notes with a pin OR an explicit noPins:true). Precedence: an explicit image
// defect → 'needs-image' (untrusted image, back for a better one); an image NOT explicitly trusted → 'incomplete'
// (no terminal, no mutation — a thin partial can neither complete NOR terminally exclude); THEN playable:false →
// terminal 'unplayable'; THEN a full comprehensive pass → 'complete'.
// notes are COMPLETE only when: enough of them (>= MIN_NOTES), each has a non-blank head AND body (so a
// ledger-'complete' always matches what the merge actually writes — which requires non-empty head+body), a
// pins verdict is present (>=1 pinned note OR noPins:true), and noPins:true does NOT contradict pinned notes.
export function notesComplete(w) {
  if (!w || !Array.isArray(w.notes) || w.notes.length < MIN_NOTES) return false;
  if (!w.notes.every(n => n && typeof n.head === 'string' && n.head.trim() && typeof n.body === 'string' && n.body.trim())) return false;
  const anyPinned = w.notes.some(n => typeof n.x === 'number');
  if (w.noPins === true && anyPinned) return false;             // contradiction
  return anyPinned || w.noPins === true;
}
export function visionPassStatus(w) {
  if (!w || typeof w !== 'object') return 'incomplete';
  if (imageDefect(w)) return 'needs-image';       // explicit defect → back for a better image
  if (!imageTrusted(w)) return 'incomplete';      // image prerequisites NOT affirmed → nothing terminal, nothing mutates
  if (w.playable === false) return 'unplayable';  // terminal ONLY on an explicitly trusted image
  const complete = w.playable === true && typeof w.mediumLegible === 'boolean' && notesComplete(w);
  return complete ? 'complete' : 'incomplete';
}

// ---------- audited-ledger transition + eligibility (SHARED by curate-merge, vision-next, check-pool) ----------
// The ledger holds: entries{id:{status,pass,at}} (authoritative, pass-versioned) + a bare ids[] list of LEGACY
// evidence (works touched by the pre-G-03 pipeline). led.legacyPass carries the immutable LEGACY_PASS sentinel:
// bare ids are legacy evidence, NOT current-pass completions — there is NO runtime auto-stamp that promotes them.
// A version bump changes nothing for them (they were never current); they become verified only through a real
// secure-pass re-audit that writes a current-pass entry.

// Decide the exact ledger mutation for ONE work from its fresh status + its PRIOR entry. complete/unplayable → set a
// terminal current-pass entry (and drop any legacy bare listing, since it now has an entry). needs-image → set a
// blocker entry. incomplete (re-examined, no terminal re-established): PRESERVE a current-pass needs-image blocker
// (only a TRUSTED pass resolves it — keeps its Priority-1 re-audit); DEMOTE a current-pass terminal (so a
// {playable:true}-only flip can't leave a stale complete/unplayable); otherwise leave as-is (already re-auditable).
// Returns { setEntry?, removeEntry?, removeFromIds?, invalidated? }.
export function ledgerTransition(prevEntry, status, pass, now) {
  if (status === 'complete' || status === 'unplayable') return { setEntry: { status, pass, at: now }, removeFromIds: true };
  if (status === 'needs-image') return { setEntry: { status: 'needs-image', pass, at: now }, removeFromIds: true };
  // incomplete
  if (prevEntry && prevEntry.pass === pass && prevEntry.status === 'needs-image') return { invalidated: false }; // preserve blocker
  if (prevEntry && prevEntry.pass === pass) return { removeEntry: true, invalidated: true };                     // demote stale terminal
  return { invalidated: false };                                                                                  // stale-pass / never-audited: no-op
}

// A terminal entry counts as securely audited ONLY when it carries its DURABLE PROVENANCE (the run it came from + the
// reviewed image + completion hashes). A clean checkout can then trace every "audited" work back to its evidence
// (data/vision-evidence.json). A bare {status,pass} with no evidence is NOT trusted (fail-closed) — e.g. a hand-edited
// or pre-evidence ledger entry can't masquerade as securely audited.
export function hasEvidence(e) {
  return !!e && typeof e.run === 'string' && /^[0-9a-f]{32}$/.test(e.run)
    && typeof e.imgSha === 'string' && /^[0-9a-f]{64}$/.test(e.imgSha)
    && typeof e.completionSha === 'string' && /^[0-9a-f]{64}$/.test(e.completionSha);
}
// CROSS-FILE evidence verification (fail-closed): a terminal entry is only trusted when the referenced run actually
// exists in the evidence store (data/vision-evidence.json) with a current-schema header and EXACTLY ONE matching work
// item whose imgSha + completionSha equal the ledger entry's. Missing / malformed / duplicate / mismatched / orphaned
// evidence → false. This is what makes "audited" mean "traceable to committed proof", not "has well-formed hashes".
const hex64 = s => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);
const nonEmptyStr = s => typeof s === 'string' && s.length > 0;
export function evidenceVerified(id, e, evidence) {
  if (!hasEvidence(e)) return false;
  const ev = evidence && typeof evidence === 'object' && !Array.isArray(evidence) ? evidence[e.run] : null;
  if (!ev || typeof ev !== 'object') return false;
  // FULL durable-evidence header: current schema + a 64-hex prompt SHA + a broker-policy + a model id
  const h = ev.header;
  if (!h || h.schemaVersion !== SCHEMA_VERSION || !hex64(h.promptHash) || !nonEmptyStr(h.brokerPolicyVersion) || !nonEmptyStr(h.modelId)) return false;
  const items = Array.isArray(ev.items) ? ev.items.filter(it => it && it.id === id) : [];
  if (items.length !== 1) return false;                                  // missing OR duplicate → fail closed
  const it = items[0];
  // valid record shape: the hashes must match the ledger AND be well-formed, plus a well-formed baseSha + approved object
  if (!hex64(it.imgSha) || !hex64(it.completionSha) || !hex64(it.baseSha)) return false;
  if (!it.approved || typeof it.approved !== 'object' || Array.isArray(it.approved)) return false;
  if (it.imgSha !== e.imgSha || it.completionSha !== e.completionSha) return false;
  // The approved values must (a) pass the SAME strict schema the verified merge enforces — so a damaged/hand-edited
  // evidence store with schema-invalid approval (e.g. image missing required fields, a pin with x but no y) can't earn
  // credit even though visionPassStatus is intentionally looser — AND (b) ACTUALLY PRODUCE the recorded status: only a
  // comprehensive approval yields 'complete', only a trusted-image playable:false yields 'unplayable'.
  if (!validateApprovedPatch({ id, ...it.approved }).ok) return false;
  return visionPassStatus(it.approved) === e.status;
}
// A shared oracle: is `id` terminally AUDITED at the CURRENT pass (→ skip in selection AND count as covered)?
// ONLY a current-pass complete/unplayable entry whose durable provenance is CROSS-VERIFIED against the evidence store
// qualifies. A stale-pass entry, a needs-image blocker, an evidence-less/forged/orphaned entry, and EVERY bare legacy
// id are NOT audited (fail-closed). `evidence` = the parsed data/vision-evidence.json (callers load + pass it).
export function auditedOracle(led, evidence) {
  led = led || {}; evidence = evidence || {};
  const entries = led.entries || {};
  return function audited(id) {
    const e = entries[id];
    return !!e && e.pass === SCHEMA_VERSION && (e.status === 'complete' || e.status === 'unplayable') && evidenceVerified(id, e, evidence);
  };
}

// Bare legacy evidence (pre-G-03 ids with no current entry) — NOT audited, but vision-next can DEPRIORITIZE these
// vs. never-touched works when burning down the secure-pass backlog.
export function legacyEvidenceIds(led) {
  const entries = (led && led.entries) || {};
  return (led && led.ids || []).filter(id => !entries[id]);
}

// needs-image blockers at the CURRENT pass (vision-next re-audits these first once the image is fixed)
export function blockedIds(led) {
  const entries = (led && led.entries) || {};
  return Object.keys(entries).filter(id => entries[id].pass === SCHEMA_VERSION && entries[id].status === 'needs-image');
}

// ---------- broker-failure classification (shared, testable) ----------
// TRANSIENT = may recover on its own → retried every run, NEVER permanently backed off. Everything else is a STABLE
// failure that counts toward backoff. HTTP: 408/425/429 + the whole 5xx range are transient; 4xx (and any other) stable.
const TRANSIENT_REASONS = new Set(['dns-failed', 'timeout', 'network-error']);
export function isTransientFail(reason, status) {
  if (TRANSIENT_REASONS.has(reason)) return true;
  if (reason === 'http-status') { const s = Number(status); return s === 408 || s === 425 || s === 429 || (s >= 500 && s <= 599); }
  return false;
}
