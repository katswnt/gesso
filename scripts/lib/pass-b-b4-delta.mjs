// VSD-022 compact editorial-delta B4 + deterministic hydration.
//
// B4 stops being a second database generator. The model emits ONLY an editorial delta: per-item
// keep/revise/replace/add/remove actions, replacement player-facing text where needed, short reasons for
// CHANGED material, and references to existing validated B1 evidence/delight ids and B2 source ids. It must
// NOT reproduce any registry (evidence, delights, sources, catalog, coordinates, provenance).
//
// The deterministic controller then HYDRATES the complete rich record from the exact validated B1/B2/B3
// rows + legacy content, assigns controller-owned ids, carries B1/B3 coordinates verbatim, and finally runs
// the UNCHANGED strict full-record validator (validateStageBody('B4', ...)). The strict validator is never
// weakened to accommodate the delta.
import { sha256, stableJson } from './vision-legacy.mjs';
import { EVIDENCE_AXES, ROLES, IMAGE_STATES, validateStageBody, PLAYER_WHY_MAX, PLAYER_NOTE_HEAD_MAX, PLAYER_NOTE_BODY_MAX, GUIDE_ANSWER_MAX } from './vision-content-schema.mjs';

export const B4_DELTA_VERSION = 'contentVisionB4Delta/1';
const ITEM_ACTIONS = ['keep', 'revise', 'replace', 'add', 'remove'];
const COMPONENT_ACTIONS = ['keep', 'revise', 'replace'];

// ---- Build the shared B1 grounding namespace (evidence ids ∪ delight ids) + a lookup for coordinates. ----
export function b1Grounding(b1) {
  const evidence = new Map();   // evidenceId -> { axis, feature, why, bbox, confidence }
  for (const axis of EVIDENCE_AXES) for (const it of (b1?.evidence?.[axis] || [])) {
    if (it && typeof it.evidenceId === 'string') evidence.set(it.evidenceId, { axis, feature: it.feature, why: it.why, bbox: it.bbox ?? null, confidence: it.confidence });
  }
  const delights = new Map(); // delightId -> { note, bbox, confidence }
  for (const d of (b1?.visual?.delights || [])) if (d && typeof d.delightId === 'string') delights.set(d.delightId, { note: d.note, bbox: d.bbox ?? null, confidence: d.confidence });
  const candidates = new Map(); // noteCandidate.noteId -> { head, body, role, pin, evidenceRef }
  for (const n of (b1?.noteCandidates || [])) if (n && typeof n.noteId === 'string') candidates.set(n.noteId, { head: n.head, body: n.body, role: n.role, pin: n.pin ?? null, evidenceRef: n.evidenceRef ?? null });
  const ids = new Set([...evidence.keys(), ...delights.keys()]);
  return { evidence, delights, candidates, ids, has: id => ids.has(id) };
}
// A grounding id -> a point pin {x,y} in 0-100, derived from the owning B1/candidate bbox center (bbox is
// [x,y,w,h] 0-1 fractions). Controller-owned; the model never supplies coordinates.
function pinFor(g, ref, candidatePin) {
  if (candidatePin && Number.isFinite(candidatePin.x) && Number.isFinite(candidatePin.y)) return { x: candidatePin.x, y: candidatePin.y };
  const bbox = g.evidence.get(ref)?.bbox ?? g.delights.get(ref)?.bbox ?? null;
  if (Array.isArray(bbox) && bbox.length === 4 && bbox.every(n => Number.isFinite(n))) {
    return { x: Math.max(0, Math.min(100, (bbox[0] + bbox[2] / 2) * 100)), y: Math.max(0, Math.min(100, (bbox[1] + bbox[3] / 2) * 100)) };
  }
  return null;
}

// ---- Delta validation: structure + references. Only shape/reference integrity; the strict semantic gate is
// the full-record validator run on the ASSEMBLED result. ----
const isStr = (v, max = 2000) => typeof v === 'string' && v.length > 0 && v.length <= max;
const strOrNull = (v, max = 2000) => v === null || isStr(v, max);
const strOrEmpty = (v, max = 2000) => typeof v === 'string' && v.length <= max; // empty allowed (e.g. humanReview resolution)
export function validateB4Delta(delta, { b1, b2 }) {
  const e = [];
  const need = (c, m) => { if (!c) e.push(m); };
  const g = b1Grounding(b1);
  const sourceIds = new Set();
  for (const f of (b2?.factChecks || [])) for (const s of (f.sources || [])) if (s?.sourceId) sourceIds.add(s.sourceId);
  need(delta && typeof delta === 'object', 'delta must be an object');
  if (!delta || typeof delta !== 'object') return { ok: false, errors: e };
  need(IMAGE_STATES.includes(delta.imageState), 'delta.imageState');
  need(typeof delta.playable === 'boolean', 'delta.playable');
  need(typeof delta.removeMedium === 'boolean', 'delta.removeMedium');
  need(delta.why && COMPONENT_ACTIONS.includes(delta.why.action) && (delta.why.action === 'keep' || isStr(delta.why.text, PLAYER_WHY_MAX)), 'delta.why');
  need(delta.cues && ['keep', 'replace'].includes(delta.cues.action) && (delta.cues.action === 'keep' || (Array.isArray(delta.cues.items) && delta.cues.items.every(x => isStr(x, 200)))), 'delta.cues');
  // ref is editorial PROVENANCE (which legacy item or B1 candidate this derives from) — any string or null.
  // Grounding integrity is enforced separately via evidenceRef ∈ B1 namespace and sourceRefs ⊆ B2 sources.
  const refGood = ref => ref === null || typeof ref === 'string';
  // notes
  need(Array.isArray(delta.notes), 'delta.notes array');
  for (const n of (delta.notes || [])) {
    need(n && ITEM_ACTIONS.includes(n.action), 'note.action');
    if (!n || !ITEM_ACTIONS.includes(n.action)) continue;
    need(refGood(n.ref), `note.ref unknown: ${n.ref}`);
    if (n.action !== 'remove' && n.action !== 'keep') { need(isStr(n.head, PLAYER_NOTE_HEAD_MAX) && isStr(n.body, PLAYER_NOTE_BODY_MAX), 'note text (revise/replace/add needs head+body)'); }
    if (n.action !== 'remove') { need(n.role === null || ROLES.includes(n.role), 'note.role'); need(g.has(n.evidenceRef), `note.evidenceRef not in B1 grounding: ${n.evidenceRef}`); need(Array.isArray(n.sourceRefs) && n.sourceRefs.every(s => sourceIds.has(s)), 'note.sourceRefs must be declared B2 source ids'); }
  }
  // hotspots
  need(Array.isArray(delta.hotspots), 'delta.hotspots array');
  for (const h of (delta.hotspots || [])) {
    need(h && ITEM_ACTIONS.includes(h.action), 'hotspot.action');
    if (!h || !ITEM_ACTIONS.includes(h.action)) continue;
    need(refGood(h.ref), `hotspot.ref unknown: ${h.ref}`);
    // rank + concise/deep text are controller-owned (assigned by order / filled from the grounding evidence's feature/why).
    if (h.action !== 'remove') { need(h.role === null || ROLES.includes(h.role), 'hotspot.role'); need(g.has(h.evidenceRef), `hotspot.evidenceRef not in B1 grounding: ${h.evidenceRef}`); need(typeof h.sourceDependent === 'boolean', 'hotspot.sourceDependent'); }
  }
  // guide
  need(Array.isArray(delta.guide), 'delta.guide array');
  for (const q of (delta.guide || [])) {
    need(q && ITEM_ACTIONS.includes(q.action), 'guide.action');
    if (!q || !ITEM_ACTIONS.includes(q.action)) continue;
    if (q.action !== 'remove' && q.action !== 'keep') { need(isStr(q.q, 300) && isStr(q.a, GUIDE_ANSWER_MAX), 'guide q/a'); need(['image', 'context'].includes(q.kind), 'guide.kind'); } // keep inherits legacy q/a/kind; answer cap shared with the hydrated validator
    if (q.action !== 'remove') { need(q.evidenceRef == null || g.has(q.evidenceRef), `guide.evidenceRef: ${q.evidenceRef}`); need(q.sourceRefs == null || (Array.isArray(q.sourceRefs) && q.sourceRefs.every(s => sourceIds.has(s))), 'guide.sourceRefs must be declared B2 source ids'); }
  }
  // corrections reference evidence ids (evidence-only) + declared sources
  for (const c of (delta.corrections || [])) {
    need(c && isStr(c.field, 100) && c.from !== undefined && c.to !== undefined, 'correction field/from/to');
    need(g.evidence.has(c.evidenceRef), `correction.evidenceRef must be a B1 evidence id: ${c.evidenceRef}`);
    need(Array.isArray(c.sourceRefs) && c.sourceRefs.every(s => sourceIds.has(s)), 'correction.sourceRefs');
    need(typeof c.confidence === 'number' && c.confidence >= 0 && c.confidence <= 1, 'correction.confidence');
  }
  for (const cf of (delta.conflicts || [])) {
    need(cf && isStr(cf.field, 100) && isStr(cf.left, 800) && isStr(cf.right, 800) && ['resolved', 'humanReview'].includes(cf.status) && strOrEmpty(cf.resolution ?? '', 800), 'conflict shape');
    need(cf.status !== 'humanReview' || (cf.resolution ?? '') === '', 'humanReview conflict must have empty resolution');
  }
  need(strOrEmpty(delta.uncertainty ?? '', 1000), 'delta.uncertainty');
  need(strOrEmpty(delta.playableReason ?? '', 500), 'delta.playableReason');
  return { ok: e.length === 0, errors: e };
}

// ---- Deterministic assembler: delta + validated B1/B2/B3 + legacy -> complete rich record (then strictly
// validated by the caller). No model-invented ids; ids assigned deterministically; coordinates carried. ----
export function assembleB4({ delta, b1, b2, b3, legacy }) {
  const g = b1Grounding(b1);
  const legacyT = legacy?.teaching || {};
  const shortId = (prefix, key) => `${prefix}${sha256(key).slice(0, 10)}`;
  // Resolve editorial provenance refs to their source TEXT (for keep/revise that reuse legacy or candidate text).
  const legacyNotes = Array.isArray(legacyT.notes) ? legacyT.notes : [];
  const legacyGuide = Array.isArray(legacyT.guide) ? legacyT.guide : [];
  const legacyNote = ref => { const m = /legacy[-:]n(\d+)/i.exec(ref || ''); return m ? legacyNotes[Number(m[1]) - 1] : null; };
  const legacyGuideItem = ref => { const m = /legacy[-:]g(\d+)/i.exec(ref || ''); return m ? legacyGuide[Number(m[1]) - 1] : null; };

  // evidence registry (authoritative B1) + delights (authoritative B1)
  const evidence = {};
  for (const axis of EVIDENCE_AXES) evidence[axis] = (b1?.evidence?.[axis] || []).map(it => ({ evidenceId: it.evidenceId, feature: it.feature, why: it.why, bbox: it.bbox ?? null, confidence: it.confidence }));
  const delights = (b1?.visual?.delights || []).map(d => ({ delightId: d.delightId, note: d.note, bbox: d.bbox ?? null, confidence: d.confidence }));

  // sources registry (authoritative B2, de-duped by sourceId)
  const sourceById = new Map();
  for (const f of (b2?.factChecks || [])) for (const s of (f.sources || [])) if (s?.sourceId && !sourceById.has(s.sourceId)) sourceById.set(s.sourceId, { sourceId: s.sourceId, url: s.url, title: s.title, retrievedAt: s.retrievedAt });
  const sources = [...sourceById.values()];

  // richDescriptors: hydrate visual (B1, incl delights) + catalog (B2) + tags (B1)
  const visual = { ...(b1?.visual || {}), delights };
  const richDescriptors = { visual, catalog: b2?.catalog ?? nullCatalog(), tags: b1?.tags ?? { controlled: [], free: [] } };

  // notes: from delta note actions (keep/revise/add of B1-candidate-grounded notes). Ids are index-derived so
  // uniqueness never depends on the model's text.
  const notes = []; let ni = 0;
  for (const n of (delta.notes || [])) {
    if (n.action === 'remove') continue;
    const cand = n.ref && g.candidates.get(n.ref);
    const lg = legacyNote(n.ref);
    // Preserve accepted content EXACTLY — never accept-then-truncate. validateB4Delta already rejects a note
    // over the shared caps; a legacy/candidate fallback over-cap is rejected by the full validator, not sliced.
    const head = String(n.head ?? cand?.head ?? lg?.head ?? '');
    const body = String(n.body ?? cand?.body ?? lg?.body ?? '');
    const role = n.role ?? cand?.role ?? 'diagnostic';
    const evidenceRef = n.evidenceRef ?? cand?.evidenceRef;
    const pin = pinFor(g, evidenceRef, cand?.pin ?? (lg && Number.isFinite(lg.x) ? { x: lg.x, y: lg.y } : null));
    notes.push({ noteId: shortId('n_', `${ni++}|${n.ref}|${head}`), head, body, pin, role, evidenceRef, sourceRefs: n.sourceRefs || [] });
  }
  // hotspots: from delta hotspot actions; coordinates carried from B1 candidate / evidence bbox
  const hotspots = []; let hi = 0;
  for (const h of (delta.hotspots || [])) {
    if (h.action === 'remove') continue;
    const cand = h.ref && g.candidates.get(h.ref);
    const pin = pinFor(g, h.evidenceRef, cand?.pin);
    const obs = shortId('o_', `${hi}|${h.ref}`);
    const ev = g.evidence.get(h.evidenceRef); const dl = g.delights.get(h.evidenceRef);
    // Player text: the model's, else the referenced note candidate's, else the grounding evidence's own REAL
    // B1 observation (feature/why or delight note) — never fabricated.
    const concise = (h.conciseText ?? cand?.head ?? ev?.feature ?? dl?.note ?? 'Look here').slice(0, 200);
    const deep = (h.deepText ?? cand?.body ?? ev?.why ?? dl?.note ?? 'A grounded detail worth noticing.').slice(0, 800);
    // rank is controller-assigned by delta order (unique, valid) — the model's rank is advisory only.
    hotspots.push({ hotspotId: shortId('h_', `${hi}|${h.ref}|${h.evidenceRef}`), observationId: obs, x: pin ? pin.x : null, y: pin ? pin.y : null, region: pin ? null : { x: 0, y: 0, w: 100, h: 100 }, rank: ++hi, role: h.role ?? cand?.role ?? 'diagnostic', conciseText: concise, deepText: deep, evidenceRef: h.evidenceRef, confidence: ev?.confidence ?? dl?.confidence ?? 0.6, sourceDependent: !!h.sourceDependent });
  }
  // guide: keep copies legacy Q&A; revise/replace/add supply text
  const guide = [];
  let gi = 0;
  for (const q of (delta.guide || [])) {
    if (q.action === 'remove') continue;
    let qq = q.q, aa = q.a;
    const lgq = legacyGuideItem(q.ref);
    if (lgq) { qq = qq ?? lgq.q; aa = aa ?? lgq.a; }
    guide.push({ questionId: shortId('q_', `${gi++}|${qq}`), q: String(qq || '').slice(0, 300), a: String(aa || '').slice(0, 1200), kind: q.kind || 'context', evidenceRef: q.evidenceRef ?? null, sourceRefs: q.sourceRefs || [] });
  }
  // proposedWhy / proposedCues
  const proposedWhy = delta.why.action === 'keep' ? (typeof legacyT.why === 'string' ? legacyT.why : { notApplicable: true, reason: 'no legacy why' }) : delta.why.text;
  const proposedCues = delta.cues.action === 'keep' ? (Array.isArray(legacyT.cues) ? legacyT.cues.slice(0, 8) : []) : delta.cues.items.slice(0, 8);
  // dispositions derived from the delta (controller-owned), covering every required component
  const changed = arr => (arr || []).some(x => x.action && x.action !== 'keep');
  const dispositions = [
    { component: 'why', disposition: delta.why.action === 'keep' ? 'keep' : delta.why.action, reason: 'per editorial delta' },
    { component: 'cues', disposition: delta.cues.action === 'keep' ? 'keep' : 'replace', reason: 'per editorial delta' },
    { component: 'notes', disposition: changed(delta.notes) ? 'revise' : 'keep', reason: 'per editorial delta' },
    { component: 'hotspots', disposition: changed(delta.hotspots) ? 'revise' : 'keep', reason: 'per editorial delta' },
    { component: 'guide', disposition: changed(delta.guide) ? 'revise' : 'keep', reason: 'per editorial delta' },
    { component: 'imageState', disposition: 'keep', reason: 'controller-owned image state' },
    { component: 'playability', disposition: 'keep', reason: 'controller-owned playability' },
  ];
  const corrections = { consequential: (delta.corrections || []).map(c => ({ field: c.field, from: c.from, to: c.to, evidenceRef: c.evidenceRef, sourceRefs: c.sourceRefs || [], confidence: c.confidence })) };
  const conflicts = (delta.conflicts || []).map(c => ({ field: c.field, left: c.left, right: c.right, resolution: c.resolution ?? '', status: c.status }));

  const body = {
    imageState: delta.imageState, playable: delta.playable, playableReason: delta.playableReason || '',
    catsAdjustments: { removeMedium: !!delta.removeMedium },
    dispositions, proposedWhy, proposedCues, notes, hotspots, guide,
    richDescriptors, evidence, sources, corrections, conflicts, uncertainty: delta.uncertainty ?? '',
  };
  return body;
}

function nullCatalog() {
  return { mediumFull: { notApplicable: true, reason: 'no B2' }, anonReason: { notApplicable: true, reason: 'n/a' }, living: { notApplicable: true, reason: 'n/a' }, movementSuggestion: { notApplicable: true, reason: 'n/a' }, styleKind: { notApplicable: true, reason: 'n/a' }, provenanceNote: { notApplicable: true, reason: 'n/a' }, displacementCue: { notApplicable: true, reason: 'n/a' }, sensitivity: [] };
}

// Convenience: assemble then run the UNCHANGED strict full-record validator. Returns { ok, body, errors }.
export function assembleAndValidateB4({ delta, b1, b2, b3, legacy }) {
  const dv = validateB4Delta(delta, { b1, b2 });
  if (!dv.ok) return { ok: false, stage: 'delta', errors: dv.errors, body: null };
  const body = assembleB4({ delta, b1, b2, b3, legacy });
  const strict = validateStageBody('B4', body);
  return { ok: strict.ok, stage: strict.ok ? 'assembled' : 'strict', errors: strict.errors || [], body, deltaSha256: sha256(stableJson(delta)), bodySha256: sha256(stableJson(body)) };
}
