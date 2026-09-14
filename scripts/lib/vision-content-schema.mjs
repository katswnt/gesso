// Strict, dependency-light contracts for the future rich Pass B stages. Model
// processes emit BODY JSON only. The deterministic controller supplies the trusted
// provenance envelope; a model can never self-assert hashes, identity, or policy.
import { sha256, stableJson } from './vision-legacy.mjs';

export const CONTENT_VISION_SCHEMA = 'contentVisionEnrichment/1';
export const CONTENT_VISION_COMPLETION = 'contentVisionCompletion/1';
export const STAGES = Object.freeze(['B1', 'B2', 'B3', 'B4']);
export const ROLES = Object.freeze(['diagnostic', 'technique', 'narrative', 'delight']);
export const EVIDENCE_AXES = Object.freeze(['when', 'where', 'medium', 'style', 'artist', 'format']);
export const IMAGE_STATES = Object.freeze(['usable', 'repair', 'blocked', 'unplayable']);
export const QUESTION_TOPICS = Object.freeze(['medium', 'maker', 'date', 'place', 'style', 'function', 'provenance', 'sensitivity', 'other']);
// Controlled component surfaces the B4 synthesis must decide on. The model supplies {component,
// disposition, reason}; the authoritative PRIOR VALUE is attached later by the controller from the B0
// snapshot (a model never establishes its own prior). REQUIRED_COMPONENTS must all be decided.
export const CONTENT_COMPONENTS = Object.freeze(['why', 'cues', 'notes', 'hotspots', 'guide', 'richDescriptors', 'imageState', 'playability', 'scoredFacts', 'catalogFacts']);
export const REQUIRED_COMPONENTS = Object.freeze(['why', 'cues', 'notes', 'hotspots', 'guide', 'imageState', 'playability']);
export const DISPOSITIONS = Object.freeze(['keep', 'revise', 'replace', 'add', 'remove']);
// Player-facing B4 copy caps — the SINGLE source of truth shared by the delta validator, the full-record
// validator, and the assembler (brevity is an editorial feature; accepted content is never silently sliced).
export const PLAYER_WHY_MAX = 500;
export const PLAYER_NOTE_HEAD_MAX = 80;
export const PLAYER_NOTE_BODY_MAX = 600;
// B4 guide contract (VSD-025): objectively enforceable brevity + selection for a PLAYABLE record.
export const GUIDE_MIN = 5;
export const GUIDE_MAX = 7;
export const GUIDE_ANSWER_MAX = 700;

const CTRL = /[\u0000-\u001f\u007f]/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const text = (value, max, { html = false, empty = false } = {}) => typeof value === 'string'
  && (empty || value.trim().length > 0) && value.length <= max && !CTRL.test(value)
  && (html || !/[<>]/.test(value));
const keys = (value, required, optional = []) => plain(value)
  && required.every(key => Object.prototype.hasOwnProperty.call(value, key))
  && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const confidence = value => finite(value) && value >= 0 && value <= 1;
const id = value => typeof value === 'string' && ID.test(value);
const list = (value, check, max, min = 0) => Array.isArray(value) && value.length >= min
  && value.length <= max && value.every(check);
const unique = values => new Set(values).size === values.length;
const bbox = value => value === null || (Array.isArray(value) && value.length === 4
  && value.every(n => finite(n) && n >= 0 && n <= 1));
const region = value => value === null || (keys(value, ['x', 'y', 'w', 'h'])
  && [value.x, value.y, value.w, value.h].every(n => finite(n) && n >= 0 && n <= 100)
  && value.x + value.w <= 100 && value.y + value.h <= 100);
const na = value => keys(value, ['notApplicable', 'reason']) && value.notApplicable === true && text(value.reason, 300);
const textOrNa = (value, max = 500) => text(value, max) || na(value);
const errors = () => {
  const rows = [];
  return { rows, need(condition, message) { if (!condition) rows.push(message); } };
};

function evidenceItem(item) {
  return keys(item, ['evidenceId', 'feature', 'why', 'bbox', 'confidence'])
    && id(item.evidenceId) && text(item.feature, 200) && text(item.why, 400)
    && bbox(item.bbox) && confidence(item.confidence);
}

function evidenceMap(value, e) {
  e.need(keys(value, EVIDENCE_AXES), 'evidence keys');
  if (!plain(value)) return [];
  const ids = [];
  for (const axis of EVIDENCE_AXES) {
    e.need(list(value[axis], evidenceItem, 12), `evidence.${axis}`);
    // Guard the iteration: a malformed (non-array) axis must be recorded as schema-invalid, never crash.
    for (const item of Array.isArray(value[axis]) ? value[axis] : []) ids.push(item.evidenceId);
  }
  e.need(unique(ids), 'duplicate evidenceId');
  return ids;
}

function imageFitness(value, e) {
  const required = ['ok', 'issue', 'quality', 'framing', 'mediumLegible', 'imageState', 'reason', 'suggestedUrl'];
  e.need(keys(value, required), 'imageFitness keys');
  if (!plain(value)) return;
  e.need(typeof value.ok === 'boolean', 'imageFitness.ok');
  e.need(['none', 'wrong-art', 'low-res', 'other'].includes(value.issue), 'imageFitness.issue');
  e.need(value.ok === (value.issue === 'none'), 'imageFitness ok/issue contradiction');
  e.need(['good', 'poor'].includes(value.quality), 'imageFitness.quality');
  e.need(['ok', 'cropped', 'detail', 'lost'].includes(value.framing), 'imageFitness.framing');
  e.need(typeof value.mediumLegible === 'boolean', 'imageFitness.mediumLegible');
  e.need(IMAGE_STATES.includes(value.imageState), 'imageFitness.imageState');
  e.need(text(value.reason, 500, { empty: true }), 'imageFitness.reason');
  e.need(value.suggestedUrl === null || (text(value.suggestedUrl, 1000, { html: true }) && /^https:\/\//.test(value.suggestedUrl)), 'imageFitness.suggestedUrl');
  if (!value.ok) e.need(value.imageState === 'blocked', 'wrong/unidentified image must be blocked');
  if (value.imageState === 'usable') e.need(value.ok && value.quality === 'good' && value.framing === 'ok', 'usable image prerequisites');
}

const visualTextKeys = [
  'pose', 'gesture', 'gaze', 'bodyOrientation', 'relationships', 'tone', 'format',
  'composition', 'viewpoint', 'subject', 'objectFunction', 'material', 'surface',
  'technique', 'condition', 'damage', 'signature', 'inscriptions', 'photoArtifacts',
];
function visual(value, e) {
  const required = [...visualTextKeys, 'figures', 'palette', 'lighting', 'iconography', 'delights'];
  e.need(keys(value, required), 'visual keys');
  if (!plain(value)) return;
  for (const key of visualTextKeys) e.need(textOrNa(value[key], key === 'subject' || key === 'composition' ? 1000 : 500), `visual.${key}`);
  e.need(list(value.figures, item => keys(item, ['who', 'role']) && text(item.who, 300) && text(item.role, 200), 30), 'visual.figures');
  e.need(keys(value.palette, ['colors', 'character'])
    && list(value.palette?.colors, item => text(item, 80), 20)
    && textOrNa(value.palette?.character, 300), 'visual.palette');
  e.need(['half-light', 'tenebrism', 'backlight', 'diffuse', 'spotlight', 'flat', 'other'].includes(value.lighting) || na(value.lighting), 'visual.lighting');
  e.need(list(value.iconography, item => text(item, 200), 30), 'visual.iconography');
  e.need(list(value.delights, item => keys(item, ['delightId', 'note', 'bbox', 'confidence'])
    && id(item.delightId) && text(item.note, 500) && bbox(item.bbox) && confidence(item.confidence), 30), 'visual.delights');
  e.need(unique((value.delights || []).map(item => item.delightId)), 'duplicate delightId');
}

// evidenceRef references the VISUAL-GROUNDING namespace: an evidence-map id OR a visual.delights id.
function candidateNote(item, grounding) {
  return keys(item, ['noteId', 'head', 'body', 'pin', 'role', 'confidence', 'evidenceRef'])
    && id(item.noteId) && text(item.head, 80) && text(item.body, 600)
    && (item.pin === null || (keys(item.pin, ['x', 'y'])
      && [item.pin.x, item.pin.y].every(n => finite(n) && n >= 0 && n <= 100)))
    && ROLES.includes(item.role) && confidence(item.confidence)
    && (item.evidenceRef === null || grounding.has(item.evidenceRef));
}
// Visual-grounding namespace = evidence ids ∪ delight ids; ids must be UNIQUE across the union so a
// reference is unambiguous. Returns the union set (or records a collision).
function groundingSet(evidenceIds, delights, e) {
  const delightIds = Array.isArray(delights) ? delights.map(d => d?.delightId).filter(x => typeof x === 'string') : [];
  const grounding = new Set([...evidenceIds, ...delightIds]);
  e.need(grounding.size === evidenceIds.size + delightIds.length, 'grounding id collision: evidence and delight ids must be unique across the union');
  return grounding;
}

function validateB1(body) {
  const e = errors();
  const required = ['imageFitness', 'playable', 'playableReason', 'noPinsVerdict', 'seen', 'evidence', 'visual', 'tags', 'noteCandidates', 'researchQuestions', 'uncertainty'];
  e.need(keys(body, required), 'B1 keys');
  if (!plain(body)) return e.rows;
  imageFitness(body.imageFitness, e);
  e.need(typeof body.playable === 'boolean', 'playable');
  e.need(text(body.playableReason, 500, { empty: true }), 'playableReason');
  e.need(typeof body.noPinsVerdict === 'boolean', 'noPinsVerdict');
  e.need(text(body.seen, 2000), 'seen'); // top-level visual inventory paragraph; rich by design (VSD-006)
  const evidenceIds = new Set(evidenceMap(body.evidence, e));
  visual(body.visual, e);
  const grounding = groundingSet(evidenceIds, body.visual?.delights, e);
  e.need(keys(body.tags, ['controlled', 'free'])
    && list(body.tags?.controlled, item => text(item, 100), 30)
    && list(body.tags?.free, item => text(item, 100), 30), 'tags');
  e.need(list(body.noteCandidates, item => candidateNote(item, grounding), 40), 'noteCandidates');
  e.need(unique((body.noteCandidates || []).map(item => item.noteId)), 'duplicate noteId');
  if (body.noPinsVerdict) e.need(!(body.noteCandidates || []).some(item => item.pin), 'noPinsVerdict contradicts pinned note');
  e.need(list(body.researchQuestions, item => keys(item, ['questionId', 'topic', 'evidenceId'])
    && id(item.questionId) && QUESTION_TOPICS.includes(item.topic)
    && (item.evidenceId === null || grounding.has(item.evidenceId)), 30), 'researchQuestions'); // evidence OR delight id (same union as notes/hotspots)
  e.need(unique((body.researchQuestions || []).map(item => item.questionId)), 'duplicate questionId');
  e.need(text(body.uncertainty, 2000, { empty: true }), 'uncertainty'); // B1 uncertainty: internal free-text (was 1000; blind B1 legitimately enumerates many candidates)
  if (body.imageFitness?.imageState === 'unplayable') e.need(body.playable === false, 'unplayable imageState requires playable:false');
  if (body.playable === false && body.imageFitness?.ok) e.need(body.imageFitness.imageState === 'unplayable', 'playable:false requires unplayable imageState');
  return e.rows;
}

function sourceRef(item) {
  return keys(item, ['sourceId', 'url', 'title', 'retrievedAt']) && id(item.sourceId)
    && text(item.url, 1500, { html: true }) && /^https:\/\//.test(item.url)
    && text(item.title, 300) && Number.isFinite(Date.parse(item.retrievedAt));
}

const catalogKeys = ['mediumFull', 'anonReason', 'living', 'movementSuggestion', 'styleKind', 'provenanceNote', 'displacementCue', 'sensitivity'];
function catalog(value, e) {
  e.need(keys(value, catalogKeys), 'catalog keys');
  if (!plain(value)) return;
  e.need(textOrNa(value.mediumFull, 800), 'catalog.mediumFull'); // bounded free-text medium note (was 500; real medium descriptions run longer)
  e.need(['collective', 'unrecorded', 'de-attributed', 'lost', 'unknown'].includes(value.anonReason) || na(value.anonReason), 'catalog.anonReason');
  e.need(typeof value.living === 'boolean' || na(value.living), 'catalog.living');
  e.need(textOrNa(value.movementSuggestion, 300), 'catalog.movementSuggestion');
  e.need(['culture', 'movement', 'period', 'school', 'tradition', 'genre'].includes(value.styleKind) || na(value.styleKind), 'catalog.styleKind');
  e.need(textOrNa(value.provenanceNote, 1000), 'catalog.provenanceNote');
  e.need(textOrNa(value.displacementCue, 500), 'catalog.displacementCue');
  e.need(list(value.sensitivity, item => text(item, 100), 20), 'catalog.sensitivity');
}

// ---- Source-authority classification for consequential refutations ----
// A confident refutation of existing editorial content cannot rest on Wikipedia OR a user-generated /
// blog platform. Classify by the parsed HOST, never a substring of the raw URL, so an encoded-dot evasion
// (e.g. en.wikipedia%2Eorg) is correctly rejected and a legitimate museum URL that merely contains
// "wikipedia.org" in its PATH is not. A malformed URL cannot corroborate.
// GUARANTEE (current): "not Wikipedia and not a known UGC/blog host" — i.e. non-UGC corroboration. It does
// NOT yet require a positive museum/scholarly allowlist; an arbitrary unknown host still passes. Tightening
// to a positive authoritative-host allowlist is a pending owner decision (it would false-reject unlisted
// museum domains and push those refutations to human review).
const NON_AUTHORITATIVE_HOSTS = [
  'wikipedia.org', 'wikimedia.org', 'wikidata.org', 'wikisource.org', 'wiktionary.org',
  'blogspot.com', 'wordpress.com', 'medium.com', 'substack.com', 'tumblr.com', 'blogger.com',
  'pinterest.com', 'reddit.com', 'quora.com', 'scribd.com', 'facebook.com', 'twitter.com',
  'x.com', 'youtube.com', 'academia.edu',
];
export function sourceHost(url) {
  let h; try { h = new URL(String(url)).hostname; } catch { return null; }
  try { h = decodeURIComponent(h); } catch { /* keep raw if not decodable */ }
  h = h.toLowerCase().replace(/\.+$/, '').replace(/^www\./, ''); // strip ALL terminal dots (FQDN root / %2e evasion), then www
  return h || null;
}
export function isCorroboratingSource(url) {
  const h = sourceHost(url);
  if (!h) return false; // malformed URL cannot corroborate
  return !NON_AUTHORITATIVE_HOSTS.some(d => h === d || h.endsWith('.' + d));
}

function validateB2(body, context = {}) {
  const e = errors();
  e.need(keys(body, ['catalog', 'factChecks', 'guideAnswers', 'targetedVerificationRequests', 'uncertainty']), 'B2 keys');
  if (!plain(body)) return e.rows;
  catalog(body.catalog, e);
  const sourceById = new Map(), claimIds = [];
  e.need(list(body.factChecks, item => {
    if (!keys(item, ['claimId', 'claim', 'verdict', 'confidence', 'sources']) || !id(item.claimId)
      || !text(item.claim, 600) || !['supported', 'refuted', 'qualified', 'partlySupported', 'unresolved'].includes(item.verdict)
      || !confidence(item.confidence)) return false;
    // A verdict that asserts anything (supported/refuted/qualified/partlySupported) MUST rest on at least one
    // valid source; only unresolved may cite none.
    const minSources = item.verdict === 'unresolved' ? 0 : 1;
    if (!list(item.sources, sourceRef, 10, minSources)) return false;
    // A high-confidence REFUTATION of existing content cannot rest on Wikipedia (or a UGC/blog host) alone —
    // it needs at least one corroborating source outside that set (host-parsed; see isCorroboratingSource).
    if (item.verdict === 'refuted' && item.confidence >= 0.8 && !(item.sources || []).some(s => isCorroboratingSource(s.url))) return false;
    claimIds.push(item.claimId);
    for (const source of item.sources) {
      if (sourceById.has(source.sourceId) && stableJson(sourceById.get(source.sourceId)) !== stableJson(source)) {
        e.need(false, `conflicting sourceId ${source.sourceId}`);
      } else sourceById.set(source.sourceId, source);
    }
    return true;
  }, 50), 'factChecks');
  e.need(unique(claimIds), 'duplicate claimId');
  const sourceSet = new Set(sourceById.keys());
  const evidenceSet = new Set(context.evidenceIds || []);
  e.need(list(body.guideAnswers, item => keys(item, ['questionId', 'q', 'a', 'kind', 'evidenceRef', 'sourceRefs'])
    && id(item.questionId) && text(item.q, 300) && text(item.a, 1200)
    && ['image', 'context'].includes(item.kind)
    && (item.evidenceRef === null || evidenceSet.has(item.evidenceRef))
    && list(item.sourceRefs, sourceId => id(sourceId) && sourceSet.has(sourceId), 10, 1), 20, 5), 'guideAnswers');
  e.need(unique((body.guideAnswers || []).map(item => item.questionId)), 'duplicate guide questionId');
  const claimSet = new Set(claimIds);
  e.need(list(body.targetedVerificationRequests, item => keys(item, ['requestId', 'claimId', 'whatToLocate'])
    && id(item.requestId) && claimSet.has(item.claimId) && text(item.whatToLocate, 500), 20), 'targetedVerificationRequests');
  e.need(unique((body.targetedVerificationRequests || []).map(item => item.requestId)), 'duplicate requestId');
  e.need(text(body.uncertainty, 1000, { empty: true }), 'uncertainty');
  return e.rows;
}

function validateB3(body, context = {}) {
  const e = errors();
  e.need(keys(body, ['verifications', 'uncertainty']), 'B3 keys');
  if (!plain(body)) return e.rows;
  const requestSet = new Set(context.requestIds || []);
  e.need(list(body.verifications, item => keys(item, ['requestId', 'found', 'bbox', 'note', 'confidence'])
    && requestSet.has(item.requestId) && typeof item.found === 'boolean' && bbox(item.bbox)
    && text(item.note, 2000) && confidence(item.confidence)
    && (item.found || item.bbox === null), 20), 'verifications'); // note cap 2000 (was 1000); internal evidence prose, prompt still asks for concise
  e.need(unique((body.verifications || []).map(item => item.requestId)), 'duplicate B3 requestId');
  e.need(text(body.uncertainty, 1000, { empty: true }), 'uncertainty');
  return e.rows;
}

function publishedNote(item, grounding, sourceIds) {
  return keys(item, ['noteId', 'head', 'body', 'pin', 'role', 'evidenceRef', 'sourceRefs'])
    && id(item.noteId) && text(item.head, PLAYER_NOTE_HEAD_MAX) && text(item.body, PLAYER_NOTE_BODY_MAX)
    && (item.pin === null || (keys(item.pin, ['x', 'y']) && [item.pin.x, item.pin.y].every(n => finite(n) && n >= 0 && n <= 100)))
    && ROLES.includes(item.role) && grounding.has(item.evidenceRef)
    && list(item.sourceRefs, sourceId => sourceIds.has(sourceId), 10);
}

function hotspot(item, grounding) {
  if (!keys(item, ['hotspotId', 'observationId', 'x', 'y', 'region', 'rank', 'role', 'conciseText', 'deepText', 'evidenceRef', 'confidence', 'sourceDependent'])) return false;
  const point = finite(item.x) && finite(item.y) && item.x >= 0 && item.x <= 100 && item.y >= 0 && item.y <= 100 && item.region === null;
  const area = item.x === null && item.y === null && region(item.region) && item.region !== null;
  return id(item.hotspotId) && id(item.observationId) && (point || area)
    && Number.isInteger(item.rank) && item.rank >= 1 && ROLES.includes(item.role)
    && text(item.conciseText, 200) && text(item.deepText, 800)
    && grounding.has(item.evidenceRef) && confidence(item.confidence)
    && typeof item.sourceDependent === 'boolean';
}

function validateB4(body) {
  const e = errors();
  const required = ['imageState', 'playable', 'playableReason', 'catsAdjustments', 'dispositions', 'proposedWhy', 'proposedCues', 'notes', 'hotspots', 'guide', 'richDescriptors', 'evidence', 'sources', 'corrections', 'conflicts', 'uncertainty'];
  e.need(keys(body, required), 'B4 keys');
  if (!plain(body)) return e.rows;
  e.need(IMAGE_STATES.includes(body.imageState), 'B4 imageState');
  // Component-level synthesis decisions. The model gives {component (controlled), disposition, reason};
  // the controller attaches the authoritative prior value from the B0 snapshot. Components must be unique
  // controlled names and cover every REQUIRED_COMPONENTS surface.
  e.need(list(body.dispositions, item => keys(item, ['component', 'disposition', 'reason'])
    && CONTENT_COMPONENTS.includes(item.component) && DISPOSITIONS.includes(item.disposition) && text(item.reason, 600), CONTENT_COMPONENTS.length + 20, REQUIRED_COMPONENTS.length), 'dispositions');
  const decided = new Set((body.dispositions || []).map(d => d.component));
  e.need(decided.size === (body.dispositions || []).length, 'duplicate disposition component');
  e.need(REQUIRED_COMPONENTS.every(c => decided.has(c)), 'dispositions must cover every required component');
  // Proposed player-facing teaching one-liner + cues (feature -> signal), so this is the COMPLETE audit.
  e.need(textOrNa(body.proposedWhy, PLAYER_WHY_MAX), 'B4 proposedWhy');
  e.need(list(body.proposedCues, item => text(item, 200), 8), 'B4 proposedCues');
  e.need(typeof body.playable === 'boolean', 'B4 playable');
  e.need(text(body.playableReason, 500, { empty: true }), 'B4 playableReason');
  e.need(keys(body.catsAdjustments, ['removeMedium']) && typeof body.catsAdjustments?.removeMedium === 'boolean', 'catsAdjustments');
  const evidenceIds = new Set(evidenceMap(body.evidence, e));
  const grounding = groundingSet(evidenceIds, body.richDescriptors?.visual?.delights, e);
  e.need(list(body.sources, sourceRef, 80), 'sources');
  const sourceIds = new Set((body.sources || []).map(item => item.sourceId));
  e.need(sourceIds.size === (body.sources || []).length, 'duplicate B4 sourceId');
  e.need(list(body.notes, item => publishedNote(item, grounding, sourceIds), 40, body.playable ? 5 : 0), 'B4 notes');
  e.need(unique((body.notes || []).map(item => item.noteId)), 'duplicate B4 noteId');
  e.need(list(body.hotspots, item => hotspot(item, grounding), 40), 'B4 hotspots');
  e.need(unique((body.hotspots || []).map(item => item.hotspotId)), 'duplicate hotspotId');
  e.need(unique((body.hotspots || []).map(item => item.rank)), 'duplicate hotspot rank');
  // B4 guide CONTRACT (VSD-025): shape + answer<=GUIDE_ANSWER_MAX; a kind:"image" item MUST carry a real
  // grounding evidenceRef (kind:"context" may be null-or-grounded). Count/majority checked below for playable.
  e.need(list(body.guide, item => keys(item, ['questionId', 'q', 'a', 'kind', 'evidenceRef', 'sourceRefs'])
    && id(item.questionId) && text(item.q, 300) && text(item.a, GUIDE_ANSWER_MAX)
    && ['image', 'context'].includes(item.kind)
    && (item.kind === 'image' ? (item.evidenceRef !== null && grounding.has(item.evidenceRef)) : (item.evidenceRef === null || grounding.has(item.evidenceRef)))
    && list(item.sourceRefs, sourceId => sourceIds.has(sourceId), 10), 20, 0), 'B4 guide');
  e.need(unique((body.guide || []).map(item => item.questionId)), 'duplicate B4 guide questionId');
  if (body.playable) {
    const g = body.guide || [];
    e.need(g.length >= GUIDE_MIN && g.length <= GUIDE_MAX, `B4 guide must have ${GUIDE_MIN}-${GUIDE_MAX} items when playable`);
    const img = g.filter(x => x.kind === 'image').length;
    e.need(img > g.length - img, 'B4 guide must have a strict image-grounded majority when playable');
  }
  e.need(keys(body.richDescriptors, ['visual', 'catalog', 'tags']), 'richDescriptors keys');
  if (plain(body.richDescriptors)) {
    visual(body.richDescriptors.visual, e);
    catalog(body.richDescriptors.catalog, e);
    e.need(keys(body.richDescriptors.tags, ['controlled', 'free'])
      && list(body.richDescriptors.tags?.controlled, item => text(item, 100), 30)
      && list(body.richDescriptors.tags?.free, item => text(item, 100), 30), 'richDescriptors.tags');
  }
  e.need(keys(body.corrections, ['consequential'])
    && list(body.corrections?.consequential, item => keys(item, ['field', 'from', 'to', 'evidenceRef', 'sourceRefs', 'confidence'])
      && text(item.field, 100) && item.from !== undefined && item.to !== undefined
      && evidenceIds.has(item.evidenceRef)
      && list(item.sourceRefs, sourceId => sourceIds.has(sourceId), 10)
      && confidence(item.confidence), 30), 'corrections');
  e.need(list(body.conflicts, item => keys(item, ['field', 'left', 'right', 'resolution', 'status'])
    && text(item.field, 100) && text(item.left, 800) && text(item.right, 800)
    && text(item.resolution, 800, { empty: true }) && ['resolved', 'humanReview'].includes(item.status)
    && (item.status !== 'humanReview' || item.resolution === ''), 30), 'conflicts');
  e.need(text(body.uncertainty, 1000, { empty: true }), 'B4 uncertainty');
  if (body.imageState === 'unplayable') e.need(body.playable === false, 'B4 unplayable contradiction');
  return e.rows;
}

export function validateStageBody(stage, body, context = {}) {
  const rows = stage === 'B1' ? validateB1(body)
    : stage === 'B2' ? validateB2(body, context)
      : stage === 'B3' ? validateB3(body, context)
        : stage === 'B4' ? validateB4(body) : [`unknown stage ${stage}`];
  return rows.length ? { ok: false, errors: rows } : { ok: true, value: body };
}

// B2 gets no raw B1 prose. Only bounded codes, coordinates, confidence, and stable
// references cross into the web-enabled principal; searches are built from trusted
// catalog metadata, never from image-derived strings.
export function buildB2Input({ workId, trustedCatalog, b1 }) {
  const checked = validateStageBody('B1', b1);
  if (!checked.ok) throw new Error(`invalid B1 body: ${checked.errors.join(', ')}`);
  if (!keys(trustedCatalog, ['title', 'artist', 'date', 'place', 'medium', 'style', 'catalogId'])) throw new Error('invalid trusted catalog input');
  const visibleSignals = [];
  for (const axis of EVIDENCE_AXES) for (const item of b1.evidence[axis]) {
    visibleSignals.push({ evidenceId: item.evidenceId, axis, bbox: item.bbox, confidence: item.confidence });
  }
  return {
    version: 'contentVisionB2Input/1', workId,
    catalog: structuredClone(trustedCatalog),
    researchQuestions: structuredClone(b1.researchQuestions),
    visibleSignals,
  };
}

export function parseStageBody(raw, stage, context = {}) {
  if (typeof raw !== 'string' || !raw.trim().startsWith('{') || !raw.trim().endsWith('}')) {
    return { ok: false, errors: ['response is not one bare JSON object'] };
  }
  let body;
  try { body = JSON.parse(raw); } catch { return { ok: false, errors: ['invalid JSON'] }; }
  return validateStageBody(stage, body, context);
}

export function buildStageCompletion({ stage, rawResponse, trusted, producer, createdAt, context = {} }) {
  const trustedKeys = ['workId', 'imgSha256', 'promptHash', 'brokerPolicyVersion', 'imageTransportVersion', 'transcriptSha256'];
  if (!STAGES.includes(stage) || !keys(trusted, trustedKeys) || !text(trusted.workId, 200, { html: true })
    || !HEX64.test(trusted.imgSha256) || !HEX64.test(trusted.promptHash)
    || !text(trusted.brokerPolicyVersion, 100) || !text(trusted.imageTransportVersion, 100)
    || !HEX64.test(trusted.transcriptSha256)) throw new Error('invalid trusted completion binding');
  if (!keys(producer, ['kind', 'model', 'runtimeVersion', 'toolPolicyHash', 'networkPolicyHash'])
    || !['claude-code-subscription', 'tool-less-api', 'deterministic-controller'].includes(producer.kind)
    || !text(producer.model, 100) || !text(producer.runtimeVersion, 100)
    || !HEX64.test(producer.toolPolicyHash) || !HEX64.test(producer.networkPolicyHash)) throw new Error('invalid producer evidence');
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error('invalid completion timestamp');
  const parsed = parseStageBody(rawResponse, stage, context);
  if (!parsed.ok) throw new Error(`invalid ${stage} body: ${parsed.errors.join(', ')}`);
  const body = parsed.value;
  return {
    version: CONTENT_VISION_COMPLETION,
    schemaVersion: CONTENT_VISION_SCHEMA,
    passKind: 'B', stage,
    workId: trusted.workId,
    imgSha256: trusted.imgSha256,
    promptHash: trusted.promptHash,
    brokerPolicyVersion: trusted.brokerPolicyVersion,
    imageTransportVersion: trusted.imageTransportVersion,
    transcriptSha256: trusted.transcriptSha256,
    producer: structuredClone(producer),
    createdAt,
    rawResponseSha256: sha256(rawResponse),
    bodySha256: sha256(stableJson(body)),
    body,
  };
}

export function validateStageCompletion(value, context = {}) {
  const e = errors();
  const required = ['version', 'schemaVersion', 'passKind', 'stage', 'workId', 'imgSha256', 'promptHash', 'brokerPolicyVersion', 'imageTransportVersion', 'transcriptSha256', 'producer', 'createdAt', 'rawResponseSha256', 'bodySha256', 'body'];
  e.need(keys(value, required), 'completion keys');
  if (!plain(value)) return { ok: false, errors: e.rows };
  e.need(value.version === CONTENT_VISION_COMPLETION, 'completion version');
  e.need(value.schemaVersion === CONTENT_VISION_SCHEMA && value.passKind === 'B', 'completion schema/pass');
  e.need(STAGES.includes(value.stage), 'completion stage');
  e.need(text(value.workId, 200, { html: true }), 'completion workId');
  for (const key of ['imgSha256', 'promptHash', 'rawResponseSha256', 'bodySha256', 'transcriptSha256']) e.need(HEX64.test(value[key]), `completion ${key}`);
  e.need(text(value.brokerPolicyVersion, 100), 'completion brokerPolicyVersion');
  e.need(text(value.imageTransportVersion, 100), 'completion imageTransportVersion');
  e.need(keys(value.producer, ['kind', 'model', 'runtimeVersion', 'toolPolicyHash', 'networkPolicyHash'])
    && ['claude-code-subscription', 'tool-less-api', 'deterministic-controller'].includes(value.producer?.kind)
    && text(value.producer?.model, 100) && text(value.producer?.runtimeVersion, 100)
    && HEX64.test(value.producer?.toolPolicyHash) && HEX64.test(value.producer?.networkPolicyHash), 'completion producer');
  e.need(value.bodySha256 === sha256(stableJson(value.body)), 'completion body hash');
  e.need(Number.isFinite(Date.parse(value.createdAt)), 'completion timestamp');
  // Cross-check only the trusted keys the controller actually supplies. Live capture supplies transcriptSha256;
  // resume verification cannot re-derive it (there is no fresh transcript), so it is recorded+hex-validated
  // but only cross-checked when present in context.trusted.
  if (context.trusted) for (const key of ['workId', 'imgSha256', 'promptHash', 'brokerPolicyVersion', 'imageTransportVersion', 'transcriptSha256']) {
    if (context.trusted[key] !== undefined) e.need(value[key] === context.trusted[key], `completion ${key} does not match trusted manifest`);
  }
  if (context.producer) e.need(stableJson(value.producer) === stableJson(context.producer), 'completion producer does not match controller evidence');
  const body = validateStageBody(value.stage, value.body, context);
  e.need(body.ok, `completion body: ${(body.errors || []).join(', ')}`);
  return e.rows.length ? { ok: false, errors: e.rows } : { ok: true, value };
}
