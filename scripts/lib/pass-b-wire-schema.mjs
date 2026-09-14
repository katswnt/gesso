// Provider-compatible WIRE schemas for Claude Code --json-schema (B1-B4). These control STRUCTURE only:
// exact keys, types, enums, arrays, nesting, additionalProperties:false at every object level. No root
// title/metadata. Unsupported semantic/range constraints (min/max, lengths, point-xor-region, cross-refs)
// are NOT here — the strict JS validators in vision-content-schema.mjs remain the final authority.
// Enums are imported from the validator module so the two contracts cannot drift.
import { ROLES, EVIDENCE_AXES, QUESTION_TOPICS, IMAGE_STATES, CONTENT_COMPONENTS, DISPOSITIONS } from './vision-content-schema.mjs';

const str = { type: 'string' }, bool = { type: 'boolean' }, num = { type: 'number' }, int = { type: 'integer' };
const enumOf = (...v) => ({ type: 'string', enum: v });
const na = { type: 'object', additionalProperties: false, required: ['notApplicable', 'reason'], properties: { notApplicable: { type: 'boolean', enum: [true] }, reason: str } };
const strOrNa = { anyOf: [str, na] };
const nullable = s => ({ anyOf: [s, { type: 'null' }] });
const arr = items => ({ type: 'array', items });
const obj = props => ({ type: 'object', additionalProperties: false, required: Object.keys(props), properties: props });
const any = {}; // from/to correction values are unconstrained by structure

const bbox = nullable(arr(num));
const pin = nullable(obj({ x: num, y: num }));
const region = nullable(obj({ x: num, y: num, w: num, h: num }));

const evidenceItem = obj({ evidenceId: str, feature: str, why: str, bbox, confidence: num });
const evidence = { type: 'object', additionalProperties: false, required: [...EVIDENCE_AXES], properties: Object.fromEntries(EVIDENCE_AXES.map(a => [a, arr(evidenceItem)])) };

const VISUAL_TEXT = ['pose', 'gesture', 'gaze', 'bodyOrientation', 'relationships', 'tone', 'format', 'composition', 'viewpoint', 'subject', 'objectFunction', 'material', 'surface', 'technique', 'condition', 'damage', 'signature', 'inscriptions', 'photoArtifacts'];
const visual = obj({
  ...Object.fromEntries(VISUAL_TEXT.map(k => [k, strOrNa])),
  figures: arr(obj({ who: str, role: str })),
  palette: obj({ colors: arr(str), character: strOrNa }),
  lighting: { anyOf: [enumOf('half-light', 'tenebrism', 'backlight', 'diffuse', 'spotlight', 'flat', 'other'), na] },
  iconography: arr(str),
  delights: arr(obj({ delightId: str, note: str, bbox, confidence: num })),
});

const imageFitness = obj({ ok: bool, issue: enumOf('none', 'wrong-art', 'low-res', 'other'), quality: enumOf('good', 'poor'), framing: enumOf('ok', 'cropped', 'detail', 'lost'), mediumLegible: bool, imageState: enumOf(...IMAGE_STATES), reason: str, suggestedUrl: nullable(str) });
const tags = obj({ controlled: arr(str), free: arr(str) });

const B1 = obj({
  imageFitness, playable: bool, playableReason: str, noPinsVerdict: bool, seen: str, evidence, visual, tags,
  noteCandidates: arr(obj({ noteId: str, head: str, body: str, pin, role: enumOf(...ROLES), confidence: num, evidenceRef: nullable(str) })),
  researchQuestions: arr(obj({ questionId: str, topic: enumOf(...QUESTION_TOPICS), evidenceId: nullable(str) })),
  uncertainty: str,
});

const sourceRef = obj({ sourceId: str, url: str, title: str, retrievedAt: str });
const catalog = obj({
  mediumFull: strOrNa, anonReason: { anyOf: [enumOf('collective', 'unrecorded', 'de-attributed', 'lost', 'unknown'), na] },
  living: { anyOf: [bool, na] }, movementSuggestion: strOrNa,
  styleKind: { anyOf: [enumOf('culture', 'movement', 'period', 'school', 'tradition', 'genre'), na] },
  provenanceNote: strOrNa, displacementCue: strOrNa, sensitivity: arr(str),
});
const guideAnswer = obj({ questionId: str, q: str, a: str, kind: enumOf('image', 'context'), evidenceRef: nullable(str), sourceRefs: arr(str) });
const B2 = obj({
  catalog,
  factChecks: arr(obj({ claimId: str, claim: str, verdict: enumOf('supported', 'refuted', 'qualified', 'partlySupported', 'unresolved'), confidence: num, sources: arr(sourceRef) })),
  guideAnswers: arr(guideAnswer),
  targetedVerificationRequests: arr(obj({ requestId: str, claimId: str, whatToLocate: str })),
  uncertainty: str,
});

const B3 = obj({ verifications: arr(obj({ requestId: str, found: bool, bbox, note: str, confidence: num })), uncertainty: str });

const B4 = obj({
  imageState: enumOf(...IMAGE_STATES), playable: bool, playableReason: str,
  catsAdjustments: obj({ removeMedium: bool }),
  dispositions: arr(obj({ component: enumOf(...CONTENT_COMPONENTS), disposition: enumOf(...DISPOSITIONS), reason: str })),
  proposedWhy: strOrNa, proposedCues: arr(str),
  notes: arr(obj({ noteId: str, head: str, body: str, pin, role: enumOf(...ROLES), evidenceRef: str, sourceRefs: arr(str) })),
  hotspots: arr(obj({ hotspotId: str, observationId: str, x: nullable(num), y: nullable(num), region, rank: int, role: enumOf(...ROLES), conciseText: str, deepText: str, evidenceRef: str, confidence: num, sourceDependent: bool })),
  guide: arr(guideAnswer),
  richDescriptors: obj({ visual, catalog, tags }),
  evidence,
  sources: arr(sourceRef),
  corrections: obj({ consequential: arr(obj({ field: str, from: any, to: any, evidenceRef: str, sourceRefs: arr(str), confidence: num })) }),
  conflicts: arr(obj({ field: str, left: str, right: str, resolution: str, status: enumOf('resolved', 'humanReview') })),
  uncertainty: str,
});

// VSD-022 compact editorial-delta B4: the model emits ONLY per-item keep/revise/replace/add/remove actions,
// replacement text, references to existing B1/B2 ids, and corrections/conflicts/uncertainty. It never
// reproduces a registry (evidence/delights/sources/catalog/coordinates). The controller deterministically
// hydrates the full record and runs the UNCHANGED strict validateB4 on the assembled result.
const ITEM_ACTION = enumOf('keep', 'revise', 'replace', 'add', 'remove');
export const B4_DELTA = obj({
  imageState: enumOf(...IMAGE_STATES), playable: bool, playableReason: str, removeMedium: bool,
  why: obj({ action: enumOf('keep', 'revise', 'replace'), text: nullable(str) }),
  cues: obj({ action: enumOf('keep', 'replace'), items: arr(str) }),
  notes: arr(obj({ action: ITEM_ACTION, ref: nullable(str), head: nullable(str), body: nullable(str), role: nullable(enumOf(...ROLES)), evidenceRef: nullable(str), sourceRefs: arr(str) })),
  hotspots: arr(obj({ action: ITEM_ACTION, ref: nullable(str), rank: nullable(int), conciseText: nullable(str), deepText: nullable(str), role: nullable(enumOf(...ROLES)), evidenceRef: nullable(str), sourceDependent: bool })),
  guide: arr(obj({ action: ITEM_ACTION, ref: nullable(str), q: nullable(str), a: nullable(str), kind: nullable(enumOf('image', 'context')), evidenceRef: nullable(str), sourceRefs: arr(str) })),
  corrections: arr(obj({ field: str, from: any, to: any, evidenceRef: str, sourceRefs: arr(str), confidence: num })),
  conflicts: arr(obj({ field: str, left: str, right: str, resolution: str, status: enumOf('resolved', 'humanReview') })),
  uncertainty: str,
});

// B4's provider schema is now the delta (the model's actual output). The full-record shape lives only in the
// strict JS validator, run by the controller on the assembled result.
export const WIRE_SCHEMAS = Object.freeze({ B1, B2, B3, B4: B4_DELTA });
export const WIRE_B4_FULL = B4; // retained for reference/tests; not sent to the model anymore

// Minimal structural JSON-Schema-subset validator (type, enum, required, additionalProperties:false,
// properties, items, anyOf) for OFFLINE parity tests. Not a full JSON Schema engine.
function walk(sch, val, p, out) {
  if (sch.anyOf) { if (!sch.anyOf.some(s => { const e = []; walk(s, val, p, e); return e.length === 0; })) out.push(`${p}: no anyOf branch`); return; }
  if (!sch.type) return; // {} = any
  if (sch.type === 'string') { if (typeof val !== 'string') out.push(`${p}: not string`); else if (sch.enum && !sch.enum.includes(val)) out.push(`${p}: not in enum`); return; }
  if (sch.type === 'boolean') { if (typeof val !== 'boolean') out.push(`${p}: not boolean`); else if (sch.enum && !sch.enum.includes(val)) out.push(`${p}: enum`); return; }
  if (sch.type === 'number') { if (typeof val !== 'number' || !Number.isFinite(val)) out.push(`${p}: not number`); return; }
  if (sch.type === 'integer') { if (!Number.isInteger(val)) out.push(`${p}: not integer`); return; }
  if (sch.type === 'null') { if (val !== null) out.push(`${p}: not null`); return; }
  if (sch.type === 'array') { if (!Array.isArray(val)) { out.push(`${p}: not array`); return; } val.forEach((v, i) => walk(sch.items, v, `${p}[${i}]`, out)); return; }
  if (sch.type === 'object') {
    if (!val || typeof val !== 'object' || Array.isArray(val)) { out.push(`${p}: not object`); return; }
    for (const req of sch.required || []) if (!(req in val)) out.push(`${p}.${req}: missing`);
    for (const k of Object.keys(val)) {
      if (!(k in (sch.properties || {}))) { if (sch.additionalProperties === false) out.push(`${p}.${k}: additional`); }
      else walk(sch.properties[k], val[k], `${p}.${k}`, out);
    }
  }
}
export function validateAgainstWire(schema, value) { const out = []; walk(schema, value, '$', out); return out; }
