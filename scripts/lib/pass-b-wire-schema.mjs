// Provider-compatible WIRE schemas for Claude Code --json-schema (B1-B4): exact keys, types, enums, arrays,
// nesting, additionalProperties:false at every object level. No root title/metadata.
// B1-B3 also carry the validator's length/count/range caps (VSD-057): the CLI checks StructuredOutput against
// the schema and makes the model resubmit within the SAME call (probe 2026-10-01: two rejected emissions, the
// third conformed), so an over-cap field no longer burns a whole attempt. Cross-references, uniqueness and
// semantic rules stay out; the strict JS validators in vision-content-schema.mjs remain the final authority.
// Enums are imported from the validator module so the two contracts cannot drift.
import { ROLES, EVIDENCE_AXES, QUESTION_TOPICS, IMAGE_STATES, CONTENT_COMPONENTS, DISPOSITIONS } from './vision-content-schema.mjs';

const str = { type: 'string' }, bool = { type: 'boolean' }, num = { type: 'number' }, int = { type: 'integer' };
const enumOf = (...v) => ({ type: 'string', enum: v });
const nullable = s => ({ anyOf: [s, { type: 'null' }] });
const arr = items => ({ type: 'array', items });
const obj = props => ({ type: 'object', additionalProperties: false, required: Object.keys(props), properties: props });
const any = {}; // from/to correction values are unconstrained by structure
// Capped forms (B1-B3 only), mirroring vision-content-schema.mjs exactly.
const txt = (max, { empty = false } = {}) => ({ type: 'string', maxLength: max, ...(empty ? {} : { minLength: 1 }) });
const list = (items, max, min = 0) => ({ type: 'array', items, maxItems: max, ...(min ? { minItems: min } : {}) });
const idStr = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$' };
const unit = { type: 'number', minimum: 0, maximum: 1 };
const na = { type: 'object', additionalProperties: false, required: ['notApplicable', 'reason'], properties: { notApplicable: { type: 'boolean', enum: [true] }, reason: txt(300) } };
const strOrNa = { anyOf: [str, na] };
const txtOrNa = (max = 500) => ({ anyOf: [txt(max), na] });

const bbox = nullable({ type: 'array', items: unit, minItems: 4, maxItems: 4 });
const pin = nullable(obj({ x: num, y: num }));
const region = nullable(obj({ x: num, y: num, w: num, h: num }));
const pin100 = nullable(obj({ x: { type: 'number', minimum: 0, maximum: 100 }, y: { type: 'number', minimum: 0, maximum: 100 } }));

const evidenceItem = obj({ evidenceId: idStr, feature: txt(200), why: txt(400), bbox, confidence: unit });
const evidence = { type: 'object', additionalProperties: false, required: [...EVIDENCE_AXES], properties: Object.fromEntries(EVIDENCE_AXES.map(a => [a, list(evidenceItem, 12)])) };

const VISUAL_TEXT = ['pose', 'gesture', 'gaze', 'bodyOrientation', 'relationships', 'tone', 'format', 'composition', 'viewpoint', 'subject', 'objectFunction', 'material', 'surface', 'technique', 'condition', 'damage', 'signature', 'inscriptions', 'photoArtifacts'];
const visual = obj({
  ...Object.fromEntries(VISUAL_TEXT.map(k => [k, txtOrNa(k === 'subject' || k === 'composition' ? 1000 : 500)])),
  figures: list(obj({ who: txt(300), role: txt(200) }), 30),
  palette: obj({ colors: list(txt(80), 20), character: txtOrNa(300) }),
  lighting: { anyOf: [enumOf('half-light', 'tenebrism', 'backlight', 'diffuse', 'spotlight', 'flat', 'other'), na] },
  iconography: list(txt(200), 30),
  delights: list(obj({ delightId: idStr, note: txt(500), bbox, confidence: unit }), 30),
});

const imageFitness = obj({ ok: bool, issue: enumOf('none', 'wrong-art', 'low-res', 'other'), quality: enumOf('good', 'poor'), framing: enumOf('ok', 'cropped', 'detail', 'lost'), mediumLegible: bool, imageState: enumOf(...IMAGE_STATES), reason: txt(500, { empty: true }), suggestedUrl: nullable({ type: 'string', maxLength: 1000, pattern: '^https://' }) });
const tags = obj({ controlled: list(txt(100), 30), free: list(txt(100), 30) });

const B1 = obj({
  imageFitness, playable: bool, playableReason: txt(500, { empty: true }), noPinsVerdict: bool, seen: txt(2000), evidence, visual, tags,
  noteCandidates: list(obj({ noteId: idStr, head: txt(80), body: txt(600), pin: pin100, role: enumOf(...ROLES), confidence: unit, evidenceRef: nullable(str) }), 40),
  researchQuestions: list(obj({ questionId: idStr, topic: enumOf(...QUESTION_TOPICS), evidenceId: nullable(str) }), 30),
  uncertainty: txt(2000, { empty: true }),
});

const sourceRef = obj({ sourceId: idStr, url: { type: 'string', maxLength: 1500, pattern: '^https://' }, title: txt(300), retrievedAt: str });
const catalog = obj({
  mediumFull: txtOrNa(800), anonReason: { anyOf: [enumOf('collective', 'unrecorded', 'de-attributed', 'lost', 'unknown'), na] },
  living: { anyOf: [bool, na] }, movementSuggestion: txtOrNa(300),
  styleKind: { anyOf: [enumOf('culture', 'movement', 'period', 'school', 'tradition', 'genre'), na] },
  provenanceNote: txtOrNa(1000), displacementCue: txtOrNa(500), sensitivity: list(txt(100), 20),
});
const guideAnswer = obj({ questionId: idStr, q: txt(300), a: txt(1200), kind: enumOf('image', 'context'), evidenceRef: nullable(str), sourceRefs: list(idStr, 10, 1) });
const B2 = obj({
  catalog,
  factChecks: list(obj({ claimId: idStr, claim: txt(600), verdict: enumOf('supported', 'refuted', 'qualified', 'partlySupported', 'unresolved'), confidence: unit, sources: list(sourceRef, 10) }), 50),
  guideAnswers: list(guideAnswer, 20, 5),
  targetedVerificationRequests: list(obj({ requestId: idStr, claimId: str, whatToLocate: txt(500) }), 20),
  uncertainty: txt(1000, { empty: true }),
});

const B3 = obj({ verifications: list(obj({ requestId: str, found: bool, bbox, note: txt(2000), confidence: unit }), 20), uncertainty: txt(1000, { empty: true }) });

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

// VSD-022 compact editorial-delta B4. VSD-039 forks only this stage: /3 keeps the editorial delta and adds
// model-PROPOSED structured claim/observation bindings. The controller validates and translates those
// proposals into stable hydrated component ids; the model never sets authority, resolution, or eligibility.
const ITEM_ACTION = enumOf('keep', 'revise', 'replace', 'add', 'remove');
const B4_EDITORIAL_FIELDS = {
  imageState: enumOf(...IMAGE_STATES), playable: bool, playableReason: str, removeMedium: bool,
  why: obj({ action: enumOf('keep', 'revise', 'replace'), text: nullable(str) }),
  cues: obj({ action: enumOf('keep', 'replace'), items: arr(str) }),
  notes: arr(obj({ action: ITEM_ACTION, ref: nullable(str), head: nullable(str), body: nullable(str), role: nullable(enumOf(...ROLES)), evidenceRef: nullable(str), sourceRefs: arr(str) })),
  hotspots: arr(obj({ action: ITEM_ACTION, ref: nullable(str), pinRef: nullable(str), rank: nullable(int), conciseText: nullable(str), deepText: nullable(str), role: nullable(enumOf(...ROLES)), evidenceRef: nullable(str), sourceDependent: bool })),
  guide: arr(obj({ action: ITEM_ACTION, ref: nullable(str), q: nullable(str), a: nullable(str), kind: nullable(enumOf('image', 'context')), evidenceRef: nullable(str), sourceRefs: arr(str) })),
  corrections: arr(obj({ field: str, from: any, to: any, evidenceRef: str, sourceRefs: arr(str), confidence: num })),
  conflicts: arr(obj({ field: str, left: str, right: str, resolution: str, status: enumOf('resolved', 'humanReview') })),
};
export const B4_DELTA_V2 = obj({
  ...B4_EDITORIAL_FIELDS,
  uncertainty: str,
});
const componentTarget = str;
const structuredGroundingDelta = obj({
  components: arr(obj({ target: componentTarget, claimRefs: arr(str), observationRefs: arr(str) })),
  conflicts: arr(obj({ conflictIndex: int, componentTargets: arr(componentTarget), claimRefs: arr(str) })),
  openClaims: arr(obj({ openClaimId: str, proposition: str, componentTargets: arr(componentTarget), claimRefs: arr(str) })),
});
export const B4_DELTA = obj({
  version: enumOf('contentVisionB4Delta/3'),
  ...B4_EDITORIAL_FIELDS,
  grounding: structuredGroundingDelta,
});

// VSD-057: the per-work B2 schema pins guideAnswers[].evidenceRef to the exact visible-signal ids B2 was given
// (the validator's evidenceSet), so an invented or B1-delight reference is bounced in-call like a length cap.
// Every other stage, and B2 without ids, uses the static schema.
export function wireSchemaFor(stage, context = {}) {
  if (stage !== 'B2' || !Array.isArray(context.evidenceIds)) return WIRE_SCHEMAS[stage];
  const ids = [...new Set(context.evidenceIds)].sort();
  const evidenceRef = ids.length ? nullable({ type: 'string', enum: ids }) : { type: 'null' };
  const guide = { ...guideAnswer, properties: { ...guideAnswer.properties, evidenceRef } };
  return { ...B2, properties: { ...B2.properties, guideAnswers: { ...B2.properties.guideAnswers, items: guide } } };
}
export const WIRE_SCHEMA_CONTRACT = 'passBWireSchema/2-capped';

// B4's provider schema is now the delta (the model's actual output). The full-record shape lives only in the
// strict JS validator, run by the controller on the assembled result.
export const WIRE_SCHEMAS = Object.freeze({ B1, B2, B3, B4: B4_DELTA });
export const WIRE_B4_FULL = B4; // retained for reference/tests; not sent to the model anymore

// Minimal JSON-Schema-subset validator (type, enum, required, additionalProperties:false, properties, items,
// anyOf, maxLength/minLength, pattern, minimum/maximum, maxItems/minItems) for OFFLINE parity tests. Not a full JSON Schema engine.
function walk(sch, val, p, out) {
  if (sch.anyOf) { if (!sch.anyOf.some(s => { const e = []; walk(s, val, p, e); return e.length === 0; })) out.push(`${p}: no anyOf branch`); return; }
  if (!sch.type) return; // {} = any
  if (sch.type === 'string') {
    if (typeof val !== 'string') out.push(`${p}: not string`);
    else if (sch.enum && !sch.enum.includes(val)) out.push(`${p}: not in enum`);
    else if (val.length > (sch.maxLength ?? Infinity) || val.length < (sch.minLength ?? 0)) out.push(`${p}: length`);
    else if (sch.pattern && !new RegExp(sch.pattern, 'u').test(val)) out.push(`${p}: pattern`);
    return;
  }
  if (sch.type === 'boolean') { if (typeof val !== 'boolean') out.push(`${p}: not boolean`); else if (sch.enum && !sch.enum.includes(val)) out.push(`${p}: enum`); return; }
  if (sch.type === 'number') { if (typeof val !== 'number' || !Number.isFinite(val)) out.push(`${p}: not number`); else if (val < (sch.minimum ?? -Infinity) || val > (sch.maximum ?? Infinity)) out.push(`${p}: range`); return; }
  if (sch.type === 'integer') { if (!Number.isInteger(val)) out.push(`${p}: not integer`); return; }
  if (sch.type === 'null') { if (val !== null) out.push(`${p}: not null`); return; }
  if (sch.type === 'array') { if (!Array.isArray(val)) { out.push(`${p}: not array`); return; } if (val.length > (sch.maxItems ?? Infinity) || val.length < (sch.minItems ?? 0)) out.push(`${p}: items`); val.forEach((v, i) => walk(sch.items, v, `${p}[${i}]`, out)); return; }
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
