// Teaching-v2 Phase A contract (VSD-093; design draft 2 §3.3, owner-approved 2026-11-20).
// Pure, deterministic helpers only: limits, the frozen gold bundle, provider wire schemas, strict referential
// validators for Dossier / LessonDraft / WriterResult / Verification / Localization, exact-quote validation,
// pass/hold rules and the per-work attempt budget. NO model calls, NO network, NO production writes.
// Phase A is development evidence only: nothing here can approve or publish a lesson.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { sha256, stableJson } from './vision-legacy.mjs';
import { validateAgainstWire } from './pass-b-wire-schema.mjs';

// vision-legacy sha256() hashes stableJson(non-string): raw bytes MUST use this instead.
export const sha256Bytes = b => createHash('sha256').update(b).digest('hex');
export const NAMESPACE = 'teaching-v2/2';
export const CONTRACT_VERSION = 'teachingV2PhaseA/1';
export const MODEL = 'claude-sonnet-5-5';
export const SLOTS = Object.freeze(['identity', 'subjectAction', 'functionContext', 'makingMechanism', 'transfer', 'significance']);
export const TAGS = Object.freeze(['when', 'where', 'medium', 'style', 'artist', 'format', 'delight']);
export const SOURCE_KINDS = Object.freeze(['holdingInstitution', 'scholarly', 'artistFoundation', 'primaryDocument', 'reference', 'aggregator', 'commercial', 'other']);
export const ISSUE_CATEGORIES = Object.freeze(['identity', 'history', 'sourceEntailment', 'visualObservation', 'pinIdentity', 'pinPlacement', 'coverage', 'answerRelevance', 'teachingLink', 'repetition', 'voice', 'projection', 'provenance']);
export const SEVERITIES = Object.freeze(['critical', 'major', 'minor']);
export const ANCHOR_SCOPES = Object.freeze(['unique', 'representative', 'distributed', 'global']);
export const SUPPORT_KINDS = Object.freeze(['visible', 'sourced', 'general', 'reading']);

// §3.2 / §3.3 caps. Player shape caps are cutters only in the sense that a violation HOLDS; nothing is trimmed.
export const LIMITS = Object.freeze({
  sources: 4, packetChars: 40000, passages: 12, passagesChars: 18000, passageChars: 2000,
  facts: 24, observations: 24, issues: 24, visualBindings: 8, catalogChecks: 12, gaps: 12, conflicts: 12,
  support: 60, holdReasons: 8, refs: 12, localizationRequests: 2, id: 80, url: 2000, str: 1000,
  why: 500, notesMin: 2, notesMax: 5, head: 80, body: 600, questionsMin: 4, questionsMax: 7, q: 180, a: 700, delightMax: 1,
});

// ---- Frozen gold bundle: worked examples 1, 2 and 5, verbatim (design §3.1: teaching-copy-examples.md:18–82,152–176). ----
export const GOLD_BUNDLE_SPEC = Object.freeze({ file: 'docs/teaching-copy-examples.md', ranges: [[18, 82], [152, 176]], examples: [1, 2, 5] });
// Frozen hash of the bundle bytes (examples file at 77994e6). A change to the examples file that alters these
// lines must fail closed (new contract version + owner decision), never silently change the W/V/V2 prompts.
export const FROZEN_GOLD_SHA256 = '849cfffcbf97309a5a43a0b416beafa3e6dd950221d23c1b0d7976b69b15eb55';
export function extractGoldBundle(fileText) {
  const lines = String(fileText).split('\n');
  const parts = GOLD_BUNDLE_SPEC.ranges.map(([a, b]) => lines.slice(a - 1, b).join('\n'));
  if (!/^## 1\. Hydria/.test(parts[0]) || !/^## 5\. The Red Studio/.test(parts[1])) throw new Error('gold bundle line ranges no longer start at examples 1 and 5');
  const text = parts.join('\n\n---\n\n');
  return { text, sha256: sha256(text), spec: GOLD_BUNDLE_SPEC };
}
export function loadGoldBundle(root = '.') {
  const g = extractGoldBundle(readFileSync(`${root}/${GOLD_BUNDLE_SPEC.file}`, 'utf8'));
  if (g.sha256 !== FROZEN_GOLD_SHA256) throw new Error(`gold bundle drift: ${g.sha256.slice(0, 12)} != frozen ${FROZEN_GOLD_SHA256.slice(0, 12)} (new contract version + owner decision required)`);
  return g;
}

// ---- small shared validators ----
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const HTMLISH = /<\s*[a-z!/][^>]*>|&[a-z]+;|&#\d+;/i;
export function plainText(s, max, { allowEmpty = false } = {}) {
  if (typeof s !== 'string') return 'not a string';
  if (!allowEmpty && !s.trim()) return 'empty';
  if (s.length > max) return `longer than ${max}`;
  if (CONTROL.test(s)) return 'control character';
  if (HTMLISH.test(s)) return 'HTML or entity';
  return null;
}
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
export const REF_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}#[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const isUnit = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
export function bboxError(b) {
  if (b === null) return null;
  if (!Array.isArray(b) || b.length !== 4 || !b.every(isUnit)) return 'bbox must be [x,y,w,h] in 0-1';
  const [x, y, w, h] = b;
  if (!(w > 0 && h > 0)) return 'bbox needs positive width and height';
  if (x + w > 1 + 1e-9 || y + h > 1 + 1e-9) return 'bbox leaves the image';
  return null;
}
export const pointInBox = (x, y, b) => x >= b[0] - 1e-9 && x <= b[0] + b[2] + 1e-9 && y >= b[1] - 1e-9 && y <= b[1] + b[3] + 1e-9;
function uniqueIds(list, key, where, errors) {
  const seen = new Set();
  for (const item of list || []) {
    const id = item?.[key];
    if (typeof id !== 'string' || !ID_RE.test(id)) { errors.push(`${where}: bad id ${JSON.stringify(id)}`); continue; }
    if (seen.has(id)) errors.push(`${where}: duplicate id ${id}`);
    seen.add(id);
  }
  return seen;
}
function capCount(list, max, where, errors) { if (Array.isArray(list) && list.length > max) errors.push(`${where}: ${list.length} > cap ${max}`); }
function slotsExactlyOnce(list, where, errors) {
  if (!Array.isArray(list)) { errors.push(`${where}: missing`); return; }
  const got = list.map(r => r?.slot);
  for (const s of SLOTS) { const n = got.filter(x => x === s).length; if (n !== 1) errors.push(`${where}: slot ${s} appears ${n} times`); }
  for (const s of got) if (!SLOTS.includes(s)) errors.push(`${where}: unknown slot ${s}`);
}
// RFC 6901 JSON Pointer into the lesson ('' = whole lesson). Returns {ok, value}.
export function resolvePointer(doc, pointer) {
  if (typeof pointer !== 'string' || (pointer !== '' && !pointer.startsWith('/'))) return { ok: false };
  if (pointer === '') return { ok: true, value: doc };
  let cur = doc;
  for (const raw of pointer.slice(1).split('/')) {
    const k = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (cur === null || typeof cur !== 'object' || !(k in cur)) return { ok: false };
    if (Array.isArray(cur) && !/^(0|[1-9]\d*)$/.test(k)) return { ok: false };
    cur = cur[k];
  }
  return { ok: true, value: cur };
}

// ---- index.html teaser rule, mirrored exactly (index.html `firstSentence`, reveal info panel). ----
export function teaserOf(why) { const w = String(why || '').trim(); if (!w) return ''; const d = w.indexOf('. '); return d > -1 ? w.slice(0, d + 1) : w; }
export function whyIsOneCompleteSentence(why) {
  const w = String(why || '').trim();
  if (!/[.!?]["”’)]?$/.test(w)) return 'why must end as a complete sentence';
  if (/[.!?]["”’)]?\s+\S/.test(w)) return 'why must be ONE sentence (the retained teaser shows only up to the first ". ")';
  if (teaserOf(w) !== w) return 'why teaser extraction differs from the approved why';
  return null;
}

// ---- Provider wire schemas (structure + caps; referential rules stay in the JS validators below). ----
const str = (max, min = 1) => ({ type: 'string', maxLength: max, minLength: min });
const idS = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$' };
const refS = { type: 'string', pattern: REF_RE.source };
const enumOf = (...v) => ({ type: 'string', enum: v });
const arr = (items, max, min = 0) => ({ type: 'array', items, maxItems: max, ...(min ? { minItems: min } : {}) });
const obj = props => ({ type: 'object', additionalProperties: false, required: Object.keys(props), properties: props });
const nullable = s => ({ anyOf: [s, { type: 'null' }] });
const unit = { type: 'number', minimum: 0, maximum: 1 };
const bboxS = nullable({ type: 'array', items: unit, minItems: 4, maxItems: 4 });
const refs = arr(refS, LIMITS.refs);
const L = LIMITS;

const LESSON = obj({
  why: str(L.why),
  hotspots: arr(obj({ id: idS, tag: enumOf(...TAGS), head: str(L.head), body: str(L.body), x: nullable(unit), y: nullable(unit) }), L.notesMax, L.notesMin),
  questions: arr(obj({ id: idS, q: str(L.q), a: str(L.a) }), L.questionsMax, L.questionsMin),
});
export const LESSON_DRAFT_WIRE = obj({
  status: enumOf('candidate', 'hold'),
  holdReasons: arr(str(L.str), L.holdReasons),
  lesson: nullable(LESSON),
  anchors: arr(obj({ hotspotId: idS, scope: enumOf(...ANCHOR_SCOPES), targetDescription: str(L.str), observationId: idS, bbox: bboxS }), L.notesMax),
  observations: arr(obj({ id: idS, description: str(L.str), region: bboxS }), L.observations),
  support: arr(obj({ surface: str(200, 0), assertion: str(L.str), kind: enumOf(...SUPPORT_KINDS), observationIds: arr(idS, L.refs), factIds: arr(idS, L.refs), sourceRefs: refs, qualification: str(L.str, 0) }), L.support),
  coverage: arr(obj({ slot: enumOf(...SLOTS), surfaces: arr(str(200, 0), L.refs), explanation: str(L.str, 0) }), SLOTS.length, SLOTS.length),
});
export const DOSSIER_WIRE = obj({
  status: enumOf('ready', 'needsResearch', 'hold'),
  identity: obj({ status: enumOf('matched', 'ambiguous', 'conflict'), explanation: str(L.str), sourceRefs: refs }),
  catalogChecks: arr(obj({ field: str(80), proposedValue: str(L.str, 0), status: enumOf('supported', 'conflict', 'unknown'), sourceRefs: refs }), L.catalogChecks),
  essentials: arr(obj({ slot: enumOf(...SLOTS), applicability: enumOf('required', 'optional', 'notApplicable'), status: enumOf('supported', 'unknown', 'conflicted', 'notApplicable'), answer: str(L.str, 0), sourceRefs: refs, limitation: str(L.str, 0) }), SLOTS.length, SLOTS.length),
  facts: arr(obj({ id: idS, proposition: str(L.str), scope: enumOf('thisWork', 'objectType', 'tradition'), sourceRefs: refs, qualifications: str(L.str, 0) }), L.facts),
  passages: arr(obj({ id: idS, sourceId: idS, sectionId: idS, quote: str(L.passageChars) }), L.passages),
  visualBindings: arr(obj({ id: idS, factId: idS, appearanceToCheck: str(L.str), evidenceIds: arr(idS, L.refs), alternatives: str(L.str, 0) }), L.visualBindings),
  gaps: arr(obj({ slot: enumOf(...SLOTS), missingEvidence: str(L.str), searchesTried: arr(str(300), L.refs) }), L.gaps),
  conflicts: arr(obj({ field: str(80), alternatives: arr(str(L.str), L.refs), sourceRefs: refs, consequence: str(L.str, 0) }), L.conflicts),
});
const VISUAL_LOCATE = obj({ kind: enumOf('visualLocate'), id: idS, hotspotId: idS, literalTarget: str(300), positionHint: str(200, 0) });
export const WRITER_RESULT_WIRE = obj({ dossier: DOSSIER_WIRE, draft: LESSON_DRAFT_WIRE, localizationRequests: arr(VISUAL_LOCATE, L.localizationRequests) });
const VERIFICATION_BASE = {
  decision: enumOf('pass', 'revise', 'hold'),
  coverage: arr(obj({ slot: enumOf(...SLOTS), result: enumOf('adequate', 'missing', 'misleading', 'notApplicable'), explanation: str(L.str, 0) }), SLOTS.length, SLOTS.length),
  issues: arr(obj({ surface: str(200, 0), severity: enumOf(...SEVERITIES), category: enumOf(...ISSUE_CATEGORIES), explanation: str(L.str), sourceRefs: refs, observation: str(L.str, 0) }), L.issues),
  pins: arr(obj({ hotspotId: idS, targetMatches: enumOf('yes', 'no', 'uncertain'), pointOnTarget: enumOf('yes', 'no', 'uncertain'), explanation: str(L.str, 0) }), L.notesMax),
};
export const VERIFICATION_WIRE = obj({ ...VERIFICATION_BASE, replacement: nullable(LESSON_DRAFT_WIRE) });
// V2 (fresh recheck of a replacement) and the coordinate-diagnostic V: pass or hold only, never a replacement.
export const VERIFICATION_NO_REPLACEMENT_WIRE = obj({ ...VERIFICATION_BASE, decision: enumOf('pass', 'hold'), replacement: { type: 'null' } });
export const LOCALIZATION_WIRE = obj({
  verifications: arr(obj({ requestId: idS, found: { type: 'boolean' }, bbox: bboxS, point: nullable(obj({ x: unit, y: unit })), observedDescription: str(L.str, 0), alternatives: arr(str(300), L.refs), confidence: unit }), 8),
  uncertainty: arr(str(L.str), L.refs),
});
export const WIRE_SCHEMA_HASHES = () => Object.fromEntries(Object.entries({ WRITER_RESULT_WIRE, VERIFICATION_WIRE, VERIFICATION_NO_REPLACEMENT_WIRE, LOCALIZATION_WIRE }).map(([k, v]) => [k, sha256(stableJson(v))]));

// ---- Source packet integrity (controller-owned). Every section must be an exact substring of its normalized text. ----
export function validatePacketIntegrity(packet, normalizedTextBySourceId = null) {
  const errors = [];
  const sources = packet?.sources || [];
  capCount(sources, LIMITS.sources, 'packet.sources', errors);
  uniqueIds(sources, 'id', 'packet.sources', errors);
  let chars = 0;
  for (const s of sources) {
    const secIds = uniqueIds(s.sections || [], 'id', `packet.${s.id}.sections`, errors);
    if (s.status !== 'captured' && (s.sections || []).length) errors.push(`packet.${s.id}: unavailable source carries sections`);
    if (!SOURCE_KINDS.includes(s.kind)) errors.push(`packet.${s.id}: unknown kind ${s.kind}`);
    const text = normalizedTextBySourceId?.[s.id];
    if (normalizedTextBySourceId && s.status === 'captured' && text == null) errors.push(`packet.${s.id}: normalized text missing`);
    if (text != null && sha256(text) !== s.textHash) errors.push(`packet.${s.id}: textHash mismatch`);
    for (const sec of s.sections || []) {
      chars += sec.text.length;
      if (!(Number.isInteger(sec.start) && Number.isInteger(sec.end) && sec.end - sec.start === sec.text.length)) errors.push(`packet.${sec.id}: bad offsets`);
      if (text != null && text.slice(sec.start, sec.end) !== sec.text) errors.push(`packet.${sec.id}: section is not the exact substring at its offsets`);
    }
    void secIds;
  }
  if (chars > LIMITS.packetChars) errors.push(`packet text ${chars} > ${LIMITS.packetChars}`);
  return { ok: errors.length === 0, errors, chars };
}
function packetIndex(packet) {
  const sources = new Map(), sections = new Map();
  for (const s of packet?.sources || []) { sources.set(s.id, s); for (const sec of s.sections || []) sections.set(`${s.id}#${sec.id}`, sec); }
  return { sources, sections };
}

// ---- Exact-quote validation: W/P passages against the captured normalized sections; controller supplies offsets. ----
export function validateQuotes(passages, packet) {
  const errors = []; const located = [];
  const { sources } = packetIndex(packet);
  capCount(passages, LIMITS.passages, 'dossier.passages', errors);
  uniqueIds(passages, 'id', 'dossier.passages', errors);
  let total = 0;
  for (const p of passages || []) {
    const q = p?.quote;
    if (typeof q !== 'string' || !q.length) { errors.push(`passage ${p?.id}: empty quote`); continue; }
    total += q.length;
    if (q.length > LIMITS.passageChars) errors.push(`passage ${p.id}: ${q.length} > ${LIMITS.passageChars} chars`);
    const src = sources.get(p.sourceId);
    if (!src) { errors.push(`passage ${p.id}: unknown source ${p.sourceId}`); continue; }
    if (src.status !== 'captured') { errors.push(`passage ${p.id}: source ${p.sourceId} is unavailable (no invented quotes)`); continue; }
    const sec = (src.sections || []).find(x => x.id === p.sectionId);
    if (!sec) { errors.push(`passage ${p.id}: unknown section ${p.sourceId}#${p.sectionId}`); continue; }
    const at = sec.text.indexOf(q);
    if (at < 0) { errors.push(`passage ${p.id}: quote is not an exact substring of ${p.sourceId}#${p.sectionId}`); continue; }
    located.push({ id: p.id, sourceId: p.sourceId, sectionId: p.sectionId, start: sec.start + at, end: sec.start + at + q.length });
  }
  if (total > LIMITS.passagesChars) errors.push(`passages total ${total} > ${LIMITS.passagesChars}`);
  return { ok: errors.length === 0, errors, located };
}

// A source ref "S1#P3" resolves to a validated passage, or "S1#S1.s004" to a packet section.
function refResolver(packet, passages) {
  const { sources, sections } = packetIndex(packet);
  const passageIds = new Map((passages || []).map(p => [p.id, p]));
  return ref => {
    if (typeof ref !== 'string' || !REF_RE.test(ref)) return false;
    const [sid, tail] = ref.split('#');
    if (!sources.has(sid)) return false;
    if (passageIds.has(tail)) return passageIds.get(tail).sourceId === sid;
    return sections.has(`${sid}#${tail}`);
  };
}

// ---- Dossier ----
export function validateDossier(d, { packet, b1EvidenceIds = new Set(), observationIds = new Set() } = {}) {
  const errors = validateAgainstWire(DOSSIER_WIRE, d).map(e => `dossier wire ${e}`);
  if (errors.length) return { ok: false, errors };
  slotsExactlyOnce(d.essentials, 'dossier.essentials', errors);
  const facts = uniqueIds(d.facts, 'id', 'dossier.facts', errors);
  uniqueIds(d.visualBindings, 'id', 'dossier.visualBindings', errors);
  const q = validateQuotes(d.passages, packet); errors.push(...q.errors);
  const ok = refResolver(packet, d.passages);
  const checkRefs = (list, where) => { for (const r of list || []) if (!ok(r)) errors.push(`${where}: unresolved source ref ${r}`); };
  checkRefs(d.identity.sourceRefs, 'dossier.identity');
  d.catalogChecks.forEach((c, i) => { checkRefs(c.sourceRefs, `dossier.catalogChecks[${i}]`); if (c.status === 'supported' && !c.sourceRefs.length) errors.push(`dossier.catalogChecks[${i}]: supported without a source`); });
  d.essentials.forEach(e => {
    checkRefs(e.sourceRefs, `dossier.essentials.${e.slot}`);
    // transfer may be an image-grounded explanation; every other supported essential needs literal support.
    if (e.status === 'supported' && e.slot !== 'transfer' && !e.sourceRefs.length) errors.push(`dossier.essentials.${e.slot}: supported without a source ref`);
    if (e.applicability === 'notApplicable' && e.status !== 'notApplicable') errors.push(`dossier.essentials.${e.slot}: notApplicable applicability with status ${e.status}`);
  });
  d.facts.forEach(f => { checkRefs(f.sourceRefs, `dossier.facts.${f.id}`); if (!f.sourceRefs.length) errors.push(`dossier.facts.${f.id}: a fact needs a source ref`); });
  d.visualBindings.forEach(v => {
    if (!facts.has(v.factId)) errors.push(`dossier.visualBindings.${v.id}: unknown fact ${v.factId}`);
    for (const e of v.evidenceIds) if (!b1EvidenceIds.has(e) && !observationIds.has(e)) errors.push(`dossier.visualBindings.${v.id}: unknown evidence/observation ${e}`);
  });
  d.conflicts.forEach((c, i) => checkRefs(c.sourceRefs, `dossier.conflicts[${i}]`));
  if (d.identity.status !== 'matched' && d.status === 'ready') errors.push('dossier: ready with unmatched identity');
  return { ok: errors.length === 0, errors, located: q.located };
}

// ---- LessonDraft ----
export function validateLessonDraft(draft, { packet, dossier = null } = {}) {
  const errors = validateAgainstWire(LESSON_DRAFT_WIRE, draft).map(e => `draft wire ${e}`);
  if (errors.length) return { ok: false, errors };
  if (draft.status === 'hold') {
    if (!draft.holdReasons.length) errors.push('draft: hold needs a reason');
    if (draft.lesson !== null) errors.push('draft: hold must not carry a lesson (legacy stays live)');
    return { ok: errors.length === 0, errors, hold: true };
  }
  if (draft.holdReasons.length) errors.push('draft: candidate carries hold reasons');
  const lesson = draft.lesson;
  if (!lesson) { errors.push('draft: candidate without a lesson'); return { ok: false, errors }; }
  // player text
  const pt = (s, max, where) => { const e = plainText(s, max); if (e) errors.push(`${where}: ${e}`); };
  pt(lesson.why, LIMITS.why, 'why');
  const one = whyIsOneCompleteSentence(lesson.why); if (one) errors.push(one);
  const hs = lesson.hotspots, qs = lesson.questions;
  if (hs.length < LIMITS.notesMin || hs.length > LIMITS.notesMax) errors.push(`notes: ${hs.length} not in ${LIMITS.notesMin}-${LIMITS.notesMax}`);
  if (qs.length < LIMITS.questionsMin || qs.length > LIMITS.questionsMax) errors.push(`questions: ${qs.length} not in ${LIMITS.questionsMin}-${LIMITS.questionsMax}`);
  const hsIds = uniqueIds(hs, 'id', 'hotspots', errors);
  const qIds = uniqueIds(qs, 'id', 'questions', errors);
  for (const id of hsIds) if (qIds.has(id)) errors.push(`id ${id} used by a note and a question`);
  if (hs.filter(h => h.tag === 'delight').length > LIMITS.delightMax) errors.push('more than one pure delight note');
  hs.forEach((h, i) => {
    pt(h.head, LIMITS.head, `hotspots[${i}].head`); pt(h.body, LIMITS.body, `hotspots[${i}].body`);
    if ((h.x === null) !== (h.y === null)) errors.push(`hotspots[${i}]: x/y must both be null or both numbers`);
    if (h.x !== null && !(isUnit(h.x) && isUnit(h.y))) errors.push(`hotspots[${i}]: coordinates must be finite 0-1`);
  });
  qs.forEach((q, i) => { pt(q.q, LIMITS.q, `questions[${i}].q`); pt(q.a, LIMITS.a, `questions[${i}].a`); });
  // observations / anchors
  const obsIds = uniqueIds(draft.observations, 'id', 'observations', errors);
  draft.observations.forEach(o => { const b = bboxError(o.region); if (b) errors.push(`observation ${o.id}: ${b}`); });
  const anchorsBy = new Map();
  for (const a of draft.anchors) {
    if (!hsIds.has(a.hotspotId)) { errors.push(`anchor: unknown hotspot ${a.hotspotId}`); continue; }
    if (anchorsBy.has(a.hotspotId)) errors.push(`anchor: hotspot ${a.hotspotId} has more than one anchor`);
    anchorsBy.set(a.hotspotId, a);
    if (!obsIds.has(a.observationId)) errors.push(`anchor ${a.hotspotId}: unknown observation ${a.observationId}`);
    const b = bboxError(a.bbox); if (b) errors.push(`anchor ${a.hotspotId}: ${b}`);
  }
  hs.forEach(h => {
    const a = anchorsBy.get(h.id);
    if (!a) { errors.push(`hotspot ${h.id}: exactly one anchor required`); return; }
    if ((a.scope === 'distributed' || a.scope === 'global') && h.x !== null) errors.push(`hotspot ${h.id}: ${a.scope} anchor must have no dot`);
    if (h.x !== null && a.bbox && !pointInBox(h.x, h.y, a.bbox)) errors.push(`hotspot ${h.id}: dot lies outside its own anchor box`);
  });
  // support map + coverage
  const ok = refResolver(packet, dossier?.passages || []);
  const factIds = new Set((dossier?.facts || []).map(f => f.id));
  const surfaceOk = p => p === '' || resolvePointer(lesson, p).ok;
  draft.support.forEach((s, i) => {
    if (!surfaceOk(s.surface)) errors.push(`support[${i}]: surface ${s.surface} is not a pointer into the lesson`);
    for (const o of s.observationIds) if (!obsIds.has(o)) errors.push(`support[${i}]: unknown observation ${o}`);
    for (const f of s.factIds) if (!factIds.has(f)) errors.push(`support[${i}]: unknown fact ${f}`);
    for (const r of s.sourceRefs) if (!ok(r)) errors.push(`support[${i}]: unresolved source ref ${r}`);
    if (s.kind === 'visible' && !s.observationIds.length) errors.push(`support[${i}]: visible support names no observation`);
    if (s.kind === 'sourced' && !s.sourceRefs.length && !s.factIds.length) errors.push(`support[${i}]: sourced support cites nothing`);
  });
  slotsExactlyOnce(draft.coverage, 'coverage', errors);
  draft.coverage.forEach(c => { for (const p of c.surfaces) if (!surfaceOk(p)) errors.push(`coverage.${c.slot}: bad surface ${p}`); });
  // Structural proxy for "two distinct observation->explanation links + one transferable clue" (semantics stay with V).
  const linked = new Set(draft.support.filter(s => s.observationIds.length && /^\/(hotspots|questions)\//.test(s.surface)).flatMap(s => s.observationIds));
  if (linked.size < 2) errors.push('fewer than two distinct observation-linked teaching surfaces');
  const transfer = draft.coverage.find(c => c.slot === 'transfer');
  if (transfer && !transfer.surfaces.length) errors.push('no surface carries the transferable clue');
  return { ok: errors.length === 0, errors, hold: false };
}

// ---- WriterResult ----
export function validateWriterResult(wr, { packet, b1EvidenceIds = new Set() } = {}) {
  const errors = validateAgainstWire(WRITER_RESULT_WIRE, wr).map(e => `writer wire ${e}`);
  if (errors.length) return { ok: false, errors };
  const obsIds = new Set((wr.draft.observations || []).map(o => o.id));
  const d = validateDossier(wr.dossier, { packet, b1EvidenceIds, observationIds: obsIds }); errors.push(...d.errors);
  const l = validateLessonDraft(wr.draft, { packet, dossier: wr.dossier }); errors.push(...l.errors);
  if (wr.draft.status === 'candidate' && wr.dossier.status !== 'ready') errors.push(`candidate lesson with dossier status ${wr.dossier.status}`);
  const hsIds = new Set((wr.draft.lesson?.hotspots || []).map(h => h.id));
  uniqueIds(wr.localizationRequests, 'id', 'localizationRequests', errors);
  for (const r of wr.localizationRequests) {
    if (!hsIds.has(r.hotspotId)) errors.push(`localizationRequest ${r.id}: unknown hotspot ${r.hotspotId}`);
    const h = (wr.draft.lesson?.hotspots || []).find(x => x.id === r.hotspotId);
    if (h && h.x !== null) errors.push(`localizationRequest ${r.id}: hotspot already has a dot (B3 fills only pending coordinates)`);
  }
  return { ok: errors.length === 0, errors, located: d.located || [], hold: wr.draft.status === 'hold' };
}

// ---- Verification + pass/hold rule (design §3.4: pass = no critical/major AND yes/yes for every dot). ----
export function validateVerification(v, { draft, allowReplacement, packet, dossier }) {
  const schema = allowReplacement ? VERIFICATION_WIRE : VERIFICATION_NO_REPLACEMENT_WIRE;
  const errors = validateAgainstWire(schema, v).map(e => `verification wire ${e}`);
  if (errors.length) return { ok: false, errors };
  slotsExactlyOnce(v.coverage, 'verification.coverage', errors);
  const lesson = draft?.lesson;
  const hsIds = new Set((lesson?.hotspots || []).map(h => h.id));
  v.issues.forEach((i, k) => { if (i.surface !== '' && !resolvePointer(lesson, i.surface).ok) errors.push(`issues[${k}]: surface ${i.surface} not in the lesson`); });
  const pinSeen = new Set();
  for (const p of v.pins) { if (!hsIds.has(p.hotspotId)) errors.push(`pins: unknown hotspot ${p.hotspotId}`); if (pinSeen.has(p.hotspotId)) errors.push(`pins: duplicate ${p.hotspotId}`); pinSeen.add(p.hotspotId); }
  for (const h of lesson?.hotspots || []) if (h.x !== null && !pinSeen.has(h.id)) errors.push(`pins: dotted hotspot ${h.id} not judged`);
  if (v.decision === 'revise') {
    if (!allowReplacement) errors.push('revise is not allowed here (ALLOW_REPLACEMENT=false)');
    else if (!v.replacement) errors.push('revise without a full replacement draft');
    else { const r = validateLessonDraft(v.replacement, { packet, dossier }); if (!r.ok) errors.push(...r.errors.map(e => `replacement: ${e}`)); if (v.replacement.status !== 'candidate') errors.push('replacement must be a candidate'); }
  } else if (v.replacement !== null) errors.push(`${v.decision} must not carry a replacement`);
  return { ok: errors.length === 0, errors };
}
export function verificationOutcome(v, { draft, allowReplacement, packet, dossier }) {
  const val = validateVerification(v, { draft, allowReplacement, packet, dossier });
  if (!val.ok) return { decision: 'hold', reasons: ['verification-invalid', ...val.errors.slice(0, 6)] };
  const serious = v.issues.filter(i => i.severity === 'critical' || i.severity === 'major');
  const dotted = (draft.lesson?.hotspots || []).filter(h => h.x !== null).map(h => h.id);
  const pinOk = id => { const p = v.pins.find(x => x.hotspotId === id); return !!p && p.targetMatches === 'yes' && p.pointOnTarget === 'yes'; };
  const badPins = dotted.filter(id => !pinOk(id));
  const minors = v.issues.filter(i => i.severity === 'minor').length;
  if (v.decision === 'hold') return { decision: 'hold', reasons: ['verifier-hold', ...serious.map(i => `${i.severity}:${i.category}`)], minors };
  if (v.decision === 'revise') return { decision: 'revise', reasons: serious.map(i => `${i.severity}:${i.category}`).concat(badPins.map(id => `pin:${id}`)), replacement: v.replacement, minors };
  // decision === 'pass': the controller recomputes the rule and never trusts a self-declared pass.
  if (serious.length || badPins.length) return { decision: 'hold', reasons: ['verifier-pass-inconsistent', ...serious.map(i => `${i.severity}:${i.category}`), ...badPins.map(id => `pin:${id}`)], minors };
  return { decision: 'pass', reasons: [], minors };
}

// ---- Attempt budget (design §3.4). Planned path + at most ONE extra (V2 or one transport retry), never above five. ----
export const MAX_INVOCATIONS = 5;
export const PLANNED_PATHS = Object.freeze({ cachedB1AndPacket: ['W', 'V'] }); // Phase A: valid cached B1 + literal packet
export function authorizeCall(ledger, request, { planned = PLANNED_PATHS.cachedB1AndPacket } = {}) {
  const calls = ledger.filter(e => e.spent !== false);
  if (calls.length >= MAX_INVOCATIONS) return { ok: false, reason: `budget: ${MAX_INVOCATIONS} invocations already spent` };
  if (planned.length >= MAX_INVOCATIONS && request.reason !== 'planned') return { ok: false, reason: 'budget: a five-call path has no extra' };
  const extras = calls.filter(e => e.reason === 'v2' || e.reason === 'transportRetry');
  if (request.reason === 'planned') {
    const done = calls.filter(e => e.reason === 'planned').map(e => e.kind);
    const next = planned[done.length];
    if (next !== request.kind) return { ok: false, reason: `budget: next planned call is ${next ?? 'none'}, not ${request.kind}` };
    return { ok: true };
  }
  if (extras.length >= 1) return { ok: false, reason: 'budget: the one extra invocation is already used' };
  if (calls.length + 1 > Math.min(MAX_INVOCATIONS, planned.length + 1)) return { ok: false, reason: 'budget: extra would exceed the planned path + 1' };
  if (request.reason === 'v2') {
    const lastV = [...calls].reverse().find(e => e.kind === 'V');
    if (!lastV || lastV.outcome !== 'revise') return { ok: false, reason: 'budget: V2 only after a V revise' };
    if (request.kind !== 'V2') return { ok: false, reason: 'budget: v2 extra must be a V2 call' };
    return { ok: true };
  }
  if (request.reason === 'transportRetry') {
    const last = calls.at(-1);
    if (!last || last.outcome !== 'transport-failure' || last.kind !== request.kind) return { ok: false, reason: 'budget: a transport retry repeats only the call that just failed in transport' };
    return { ok: true };
  }
  return { ok: false, reason: `budget: unknown reason ${request.reason}` };
}
// After an attempt: planned-call transport failures are re-issued as the extra; bad valid content never is.
export function nextStep(ledger, { planned = PLANNED_PATHS.cachedB1AndPacket } = {}) {
  const last = ledger.at(-1);
  if (!last) return { call: planned[0], reason: 'planned' };
  if (last.outcome === 'transport-failure') {
    const a = authorizeCall(ledger, { kind: last.kind, reason: 'transportRetry' }, { planned });
    return a.ok ? { call: last.kind, reason: 'transportRetry', retryOf: last.reason } : { terminal: 'hold', why: `transport failure; ${a.reason}` };
  }
  return null; // content outcomes are routed by the controller (W ok -> V; V revise -> V2; else terminal)
}
