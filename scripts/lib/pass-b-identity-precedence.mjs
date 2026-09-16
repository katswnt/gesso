// VSD-037: identity precedence + omission — a conservative owner-REVIEW aid (pure, deterministic).
//
// SCOPE: this is a review-projection prototype, NOT the release mechanism and NOT wired into guarded approval
// or reconciliation. The durable release path is reconciliation + explicit owner edits/decisions keyed on
// stable component/claim ids. Lexical matching cannot honestly enforce a general identity policy; it is safe
// only as a conservative omission aid that never affirms.
//
// Rule it applies: for the identity-bearing axes below, a model/vision-only fragment on a DISPUTED axis (a
// sealed audit claim, or an unresolved conflict touching that axis) is preserved only as disputed diagnostic
// evidence and MUST NOT appear affirmatively in player copy (why/cues/notes/guide). B4 does not adjudicate.
// When any identity axis is disputed, bindings are HELD for owner review (never auto-published, never
// individually adjudicated, never silently dropped) — "preserve the knowledge, hold the pin." The module never
// authors copy, never resolves a conflict, never marks anything eligible, and never accepts a caller-supplied
// "authoritative support" override (a regex is not a source of authority).

export const IDENTITY_PRECEDENCE_VERSION = 'passBIdentityPrecedence/1';

// The four identity-bearing axes under VSD-037.
export const IDENTITY_AXES = ['medium', 'human-vs-animal', 'named-identity-or-role', 'iconography'];

// Conservative lexical detectors: does a fragment TOUCH an identity axis? Deterministic and case-insensitive.
// These are used only to gate AFFIRMATIVE copy for axes already known to be in dispute — never to assert.
const AXIS_TERMS = {
  medium: [/\bplaster\b/i, /\bwood(en)?\b/i, /\bcarved wood\b/i, /\bbronze\b/i, /\bmarble\b/i, /\bterracotta\b/i, /\bmixed[- ]media\b/i, /\bcoffin planks?\b/i, /\bgrain\b/i],
  'human-vs-animal': [/\blion(-like)?\b/i, /\bquadruped\b/i, /\banimal\b/i, /\bbeast\b/i, /\bcreature\b/i, /\bcrawling (man|human|figure)\b/i, /\bon all fours\b/i],
  'named-identity-or-role': [/\bglory\b/i, /\bvilliers\b/i, /\bchrysostom\b/i, /\bmagdalene\b/i, /\breversed?\b/i, /\binvert(ed|s)?\b/i, /\bthe (upper|lower) figure is\b/i],
  iconography: [/\bskull\b/i, /\bmemento[- ]?mori\b/i, /\bvanitas\b/i, /\btransi\b/i, /\bcadaver\b/i, /\bwing(ed|s)?\b/i, /\bcoffin\b/i, /\bsarcophagus\b/i, /\bbier\b/i, /\bnimbus\b/i, /\bhalo\b/i, /\battribute\b/i],
};

// Map a sealed blocked-claim string to the identity axis it concerns (best-effort, conservative superset).
export function axisOfBlockedClaim(claim) {
  const c = String(claim || '').toLowerCase();
  const axes = new Set();
  if (/medium|plaster|wood|bronze|marble/.test(c)) axes.add('medium');
  if (/lion|quadruped|animal|human penitent|crawling man|crawling human|entity-aliasing/.test(c)) axes.add('human-vs-animal');
  if (/role-inversion|reversed|identity|villiers|glory|figure makes|binding is/.test(c)) axes.add('named-identity-or-role');
  if (/skull|memento|vanitas|wing|coffin|halo|attribute|iconograph/.test(c)) axes.add('iconography');
  return [...axes];
}

// Which identity axes are DISPUTED for this work: from unresolved conflicts touching an axis, plus every axis
// named by a sealed blocked claim. Returns { axes:Set, reasons:[{axis, source, detail}] }.
export function disputedIdentityAxes({ conflicts = [], blockedClaims = [] }) {
  const axes = new Set(); const reasons = [];
  for (const claim of blockedClaims) for (const a of axisOfBlockedClaim(claim)) { axes.add(a); reasons.push({ axis: a, source: 'sealed-blocked-claim', detail: claim }); }
  for (const cf of conflicts) {
    const resolved = cf.status === 'resolved' && cf.resolution; // model self-resolution is not authoritative; treated as unresolved elsewhere
    const text = `${cf.field || ''} ${cf.left || ''} ${cf.right || ''}`;
    for (const a of IDENTITY_AXES) if ((AXIS_TERMS[a] || []).some((re) => re.test(text))) { axes.add(a); reasons.push({ axis: a, source: resolved ? 'model-resolved-conflict(treated-unresolved)' : 'unresolved-conflict', detail: cf.field || cf.left }); }
  }
  return { axes, reasons };
}

// Does a copy fragment touch a disputed axis? If so it is omitted from affirmative player copy. This is a
// deterministic LEXICAL detector, not an evidence check: it cannot tell a correct "coffin" (Villiers is in the
// coffin) from an incorrect one, so it only ever OMITS on a disputed axis and never affirms. There is no
// caller-supplied "authoritative support" override — a regex is not a source of authority. Correct copy on a
// disputed axis re-enters only as an explicit owner edit/decision keyed on stable ids, never through this filter.
export function classifyFragment(text, disputed) {
  const hits = [];
  for (const a of disputed) if ((AXIS_TERMS[a] || []).some((re) => re.test(String(text || '')))) hits.push(a);
  return { omit: hits.length > 0, axes: hits };
}

// Apply the precedence/omission rule to a projected record. Returns the filtered affirmative copy, the removed
// fragments (as disputed diagnostic evidence), and — when any identity axis is disputed — every projected pin
// as HELD-for-review (never auto-published, never individually adjudicated, never silently dropped). Only whole
// fragments are included/excluded; text is never edited. Note pins travel inside their note entry, so removing
// a note removes its own coordinate and surviving notes keep theirs — no rank re-indexing and no dangling pins.
export function applyPrecedence({ projected, conflicts = [], blockedClaims = [] }) {
  const { axes: disputed, reasons } = disputedIdentityAxes({ conflicts, blockedClaims });
  const removed = []; const kept = { why: null, cues: [], notes: [], guide: [] };
  const teach = projected.teach || {};

  const whyC = classifyFragment(teach.why || '', disputed);
  if (teach.why && whyC.omit) removed.push({ surface: 'why', text: teach.why, axes: whyC.axes }); else kept.why = teach.why ?? null;

  for (const cue of teach.cues || []) { const c = classifyFragment(cue, disputed); if (c.omit) removed.push({ surface: 'cue', text: cue, axes: c.axes }); else kept.cues.push(cue); }
  for (const n of teach.notes || []) { const c = classifyFragment(`${n.head || ''} ${n.body || ''}`, disputed); if (c.omit) removed.push({ surface: 'note', text: n.head || n.body, axes: c.axes }); else kept.notes.push(n); }
  for (const g of teach.guide || []) { const c = classifyFragment(`${g.q || ''} ${g.a || ''}`, disputed); if (c.omit) removed.push({ surface: 'guide', text: g.q || g.a, axes: c.axes }); else kept.guide.push(g); }

  // Bindings: this review aid does not adjudicate individual pins. When an identity axis is disputed, EVERY
  // projected hotspot is HELD for owner review (none auto-published); nothing is dropped and no per-pin
  // correctness is claimed. With no disputed axis, hotspots pass through as affirmative.
  const anyDisputed = disputed.size > 0;
  const heldPins = anyDisputed ? (projected.hotspots || []).slice() : [];
  const affirmativeHotspots = anyDisputed ? [] : (projected.hotspots || []).slice();

  return {
    version: IDENTITY_PRECEDENCE_VERSION,
    disputedAxes: [...disputed], disputeReasons: reasons,
    affirmative: { teach: kept, hotspots: affirmativeHotspots },
    disputedDiagnostic: removed,
    heldPins,
    heldForReviewNote: anyDisputed ? 'all bindings held for owner review; not individually adjudicated' : null,
  };
}

// Fail-closed gate: assert no disputed-identity fragment survived into affirmative copy. Throws on violation.
export function assertNoDisputedAffirmative(result) {
  const t = result.affirmative.teach;
  const disputed = new Set(result.disputedAxes);
  const check = (text, where) => { const c = classifyFragment(text, disputed); if (c.omit) throw new Error(`VSD-037 violation: disputed ${c.axes.join('/')} claim in affirmative ${where}: ${String(text).slice(0, 80)}`); };
  if (t.why) check(t.why, 'why');
  (t.cues || []).forEach((c, i) => check(c, `cue[${i}]`));
  (t.notes || []).forEach((n, i) => check(`${n.head || ''} ${n.body || ''}`, `note[${i}]`));
  (t.guide || []).forEach((g, i) => check(`${g.q || ''} ${g.a || ''}`, `guide[${i}]`));
  return true;
}
