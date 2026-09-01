// Pure contract for the frozen recognition/inference pilot.
//
// This module has no network, model, filesystem, or authoritative-data writes. It freezes the
// literal cue mask, response validators, research grading rules, deterministic call schedule, and
// conservative cost calculation. The live runner (built separately) must consume these functions;
// it may not reinterpret the study design at runtime.
import { createHash } from 'node:crypto';

export const PILOT_VERSION = 'recognition-pilot/1';
export const PILOT_FREEZE_ID = 'gesso-recognition-pilot-2026-08-31-v1';
export const PILOT_WORKS = 36;
export const PILOT_CALLS = 671;
export const PILOT_BUDGET_USD = 15;
export const PILOT_MODEL = 'claude-sonnet-4-6';
export const ANTHROPIC_VERSION = '2023-06-01';
export const FACETS = Object.freeze(['date', 'place', 'medium', 'style', 'artist']);
export const REGIONS = Object.freeze(['europe', 'non-europe']);
// The one consistent exact-recognition unit vocabulary. targetUnit records what "the work" IS; the
// exactRule records how a response earns exact-work credit for it. Study C alone tests same-physical-
// object identity; Study A recognizes the cataloged unit named here.
export const TARGET_UNITS = Object.freeze(['cataloged-work', 'design', 'edition', 'impression', 'unique-object', 'site-assemblage']);
export const EXACT_RULES = Object.freeze(['title', 'title+qualifier', 'uniqueFact']);
// Conceptual work id: collapse ONLY the complete Wikidata spelling variants (wikidata:Q1 / wd:Q1 /
// the canonical entity URL) to one normalized form so the same physical work cannot be counted twice.
// Any other id (a museum id that merely contains "Q1") is returned unchanged.
export function normalizedWorkId(id) {
  const s = String(id);
  const m = s.match(/^(?:wikidata:|wd:|https?:\/\/www\.wikidata\.org\/entity\/)(Q\d+)$/i);
  return m ? m[1].toLowerCase() : s;
}
export const FAME_BANDS = Object.freeze([
  { id: 'f1', min: 0, max: 0 },
  { id: 'f2', min: Number.MIN_VALUE, max: 100 },
  { id: 'f3', min: 100, max: 612, minExclusive: true },
  { id: 'f4', min: 612, max: 1000, minExclusive: true },
  { id: 'f5', min: 1000, max: Infinity, minExclusive: true },
]);
export const VIEW_SPECS = Object.freeze([
  { id: 'full', kind: 'full' },
  { id: 'crop70', kind: 'crop', fraction: 0.70 },
  { id: 'crop45', kind: 'crop', fraction: 0.45 },
  { id: 'crop25', kind: 'crop', fraction: 0.25 },
  { id: 'mirror', kind: 'mirror' },
  { id: 'rotate90', kind: 'rotate', degrees: 90 },
  { id: 'grayscale', kind: 'grayscale' },
]);
export const ANCHORS = Object.freeze(['center', 'northwest', 'northeast', 'southwest', 'southeast']);

export const SCORING_POLICY = Object.freeze({
  version: 'recognition-research-score/1',
  dateMaxErrorYears: 1000,
  placeParentCredit: 0.5,
  mediumFamilyCredit: 0.75,
  mediumBroadCredit: 0.4,
  styleFamilyCredit: 0.65,
  styleRelatedCredit: 0.35,
  artistWorkshopCredit: 0.6,
  artistCircleCredit: 0.6,
  artistAttributedCredit: 0.6,
  artistFollowerCredit: 0.4,
  confidenceBins: Object.freeze([0, 20, 40, 60, 80, 100]),
});

export const REQUEST_POLICY = Object.freeze({
  version: 'recognition-request/1',
  model: PILOT_MODEL,
  anthropicVersion: ANTHROPIC_VERSION,
  temperature: 0,
  tokenCaps: Object.freeze({ identify: 260, facets: 650, identityFirst: 850 }),
  requestTimeoutMs: 180_000,
  maxCollectionHours: 24,
  conservativeInputOverheadTokens: 256,
  // Price snapshot is part of the preflight evidence, not a claim about future pricing.
  pricing: Object.freeze({
    inputPerMillionUsd: 3, outputPerMillionUsd: 15, batchMultiplier: 1,
    verifiedAt: '2026-08-31', source: 'https://platform.claude.com/docs/en/models/sonnet-4-6/overview',
  }),
  retryReserveAttempts: 20,
  maxTransportAttemptsPerCall: 3,
});

export function canonicalJson(value) {
  const sort = v => Array.isArray(v)
    ? v.map(sort)
    : (v && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sort(v[k])]))
      : v);
  return JSON.stringify(sort(value));
}

export const sha256 = value => createHash('sha256')
  .update(Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8'))
  .digest('hex');

export function rngFor(seed) {
  let h = 2166136261;
  for (const c of String(seed)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  let a = h >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle(items, seed) {
  const out = [...items], random = rngFor(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Literal disclosure uses a frozen, language-agnostic normalization. It intentionally does not
// infer semantic entailment: "Guernica" does not literally disclose Picasso, Spain, or 1937.
export function normalizeLiteral(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US')
    .replace(/[’‘`]/g, "'")
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function containsLiteralPhrase(text, phrase) {
  const haystack = ` ${normalizeLiteral(text)} `;
  const needle = normalizeLiteral(phrase);
  return !!needle && haystack.includes(` ${needle} `);
}

export function disclosureMask(cue, acceptedAliasesByFacet) {
  const disclosedFacets = [], eligibleFacets = [];
  for (const facet of FACETS) {
    const aliases = Array.isArray(acceptedAliasesByFacet?.[facet]) ? acceptedAliasesByFacet[facet] : [];
    (aliases.some(a => containsLiteralPhrase(cue, a)) ? disclosedFacets : eligibleFacets).push(facet);
  }
  return { disclosedFacets, eligibleFacets };
}

// Same punctuation, whitespace, token count, and alphanumeric-token lengths as the correct cue;
// only the content becomes an opaque deterministic code. This is a format/length-matched sham.
export function opaqueSham(cue, id) {
  const alphabet = 'BCDFGHJKLMNPQRSTVWXYZ23456789';
  const bytes = Buffer.from(sha256(`${id}\0${cue}`), 'hex');
  let n = 0;
  return String(cue).replace(/[\p{L}\p{N}]/gu, () => alphabet[bytes[n++ % bytes.length] % alphabet.length]);
}

const plainObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
const keysExactly = (v, keys) => plainObject(v)
  && Object.keys(v).length === keys.length
  && keys.every(k => Object.hasOwn(v, k));
const shortText = (v, max = 600) => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v);
const nullableText = (v, max) => v === null || shortText(v, max);
const confidence = v => Number.isInteger(v) && v >= 0 && v <= 100;

export function validateIdentification(v) {
  const errors = [];
  if (!keysExactly(v, ['workTitleGuess', 'specificWorkClaim', 'distinguishingQualifierGuess', 'artistGuess', 'seriesOrTraditionGuess', 'selfRecognized', 'confidence', 'visualBasis'])) errors.push('identification keys');
  if (!nullableText(v?.workTitleGuess, 300)) errors.push('workTitleGuess');
  if (typeof v?.specificWorkClaim !== 'boolean') errors.push('specificWorkClaim');
  // A natural home for a disambiguating qualifier (institution/accession/version) so the model is not
  // forced to cram catalog text into workTitleGuess to earn exact credit on a generic-titled work.
  if (!nullableText(v?.distinguishingQualifierGuess, 300)) errors.push('distinguishingQualifierGuess');
  if (!nullableText(v?.artistGuess, 300)) errors.push('artistGuess');
  if (!nullableText(v?.seriesOrTraditionGuess, 300)) errors.push('seriesOrTraditionGuess');
  if (typeof v?.selfRecognized !== 'boolean') errors.push('selfRecognized');
  if (!confidence(v?.confidence)) errors.push('confidence');
  if (!shortText(v?.visualBasis, 600)) errors.push('visualBasis');
  return { ok: errors.length === 0, errors };
}

function validateFacet(v, name) {
  const errors = [];
  if (!plainObject(v)) return [`${name}`];
  if (!confidence(v.confidence)) errors.push(`${name}.confidence`);
  if (!shortText(v.visualBasis, 600)) errors.push(`${name}.visualBasis`);
  return errors;
}

export function validateFacets(v) {
  const errors = [];
  if (!keysExactly(v, FACETS)) return { ok: false, errors: ['facet keys'] };
  if (!keysExactly(v.date, ['bestYear', 'confidence', 'visualBasis']) || !Number.isInteger(v.date?.bestYear)) errors.push('date.bestYear/keys');
  errors.push(...validateFacet(v.date, 'date'));
  if (!keysExactly(v.place, ['topGuess', 'alternatives', 'confidence', 'visualBasis']) || !shortText(v.place?.topGuess, 300)) errors.push('place.topGuess/keys');
  if (!Array.isArray(v.place?.alternatives) || v.place.alternatives.length > 3 || v.place.alternatives.some(x => !shortText(x, 300))) errors.push('place.alternatives');
  errors.push(...validateFacet(v.place, 'place'));
  for (const name of ['medium', 'style', 'artist']) {
    if (!keysExactly(v[name], ['guess', 'confidence', 'visualBasis']) || !shortText(v[name]?.guess, 300)) errors.push(`${name}.guess/keys`);
    errors.push(...validateFacet(v[name], name));
  }
  return { ok: errors.length === 0, errors: [...new Set(errors)] };
}

export function validateIdentityFirst(v) {
  const errors = [];
  if (!keysExactly(v, ['identification', 'facets'])) errors.push('identity-first keys');
  const a = validateIdentification(v?.identification); if (!a.ok) errors.push(...a.errors.map(x => `identification.${x}`));
  const b = validateFacets(v?.facets); if (!b.ok) errors.push(...b.errors.map(x => `facets.${x}`));
  return { ok: errors.length === 0, errors };
}

function stripSchemaMetadata(value) {
  if (Array.isArray(value)) return value.map(stripSchemaMetadata);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([k]) => k !== '$schema' && k !== '$id')
    .map(([k, v]) => [k, stripSchemaMetadata(v)]));
}

// Constructs the EXACT text sent to the model. Schema metadata URLs and external $refs are never
// sent; the identity-first schema is bundled in-place. Correct/sham cue substitution is call-local,
// so cost estimation hashes/counts the actual cue rather than a short placeholder.
export function buildModelPrompt(call, work, promptAssets, schemaAssets) {
  const promptName = call.task === 'identify' ? 'identify'
    : (call.task === 'identity-first' ? 'identity-first' : (call.condition === 'no-cue' ? 'facets' : 'facets-cued'));
  let prompt = String(promptAssets?.[promptName] || '');
  if (!prompt) throw new Error(`missing prompt asset: ${promptName}`);
  if (call.condition === 'correct-cue') prompt = prompt.replace('{{CUE}}', String(work?.cue?.correct || ''));
  else if (call.condition === 'sham') prompt = prompt.replace('{{CUE}}', String(work?.cue?.sham || ''));
  if (prompt.includes('{{CUE}}')) throw new Error(`unresolved cue: ${call.callId}`);
  const identification = stripSchemaMetadata(schemaAssets?.identification);
  const facets = stripSchemaMetadata(schemaAssets?.facets);
  let schema;
  if (call.task === 'identify') schema = identification;
  else if (call.task === 'facets') schema = facets;
  else schema = { type: 'object', additionalProperties: false, required: ['identification', 'facets'], properties: { identification, facets } };
  if (!schema) throw new Error(`missing schema asset: ${call.task}`);
  const text = `${prompt}\n\nOUTPUT SCHEMA:\n${JSON.stringify(schema)}`;
  if (/https?:\/\//i.test(text)) throw new Error('model prompt contains a URL');
  return text;
}

const aliases = values => (Array.isArray(values) ? values : []).map(normalizeLiteral).filter(Boolean);
const anyAlias = (guess, values) => aliases(values).some(a => containsLiteralPhrase(guess, a));

// One frozen exact-recognition unit (see EXACT_RULES / TARGET_UNITS):
//  - 'title'          : a distinctive title/name identifies the cataloged work/design/edition alone.
//  - 'title+qualifier': a generic or duplicated title needs the frozen distinguishing qualifier group(s)
//                       (institution/accession/version) to pin the exact work — a generic noun alone
//                       can never earn exact credit.
//  - 'uniqueFact'     : only a prespecified uniquely-identifying fact earns exact credit.
// Study C (physical-object identity) is handled separately from Study A's cataloged-unit recognition;
// exactRules here never require a physical-impression accession unless the work's key explicitly does.
export function gradeIdentification(response, key) {
  const v = validateIdentification(response);
  if (!v.ok) return { ok: false, errors: v.errors };
  const combined = [response.workTitleGuess, response.distinguishingQualifierGuess, response.artistGuess, response.seriesOrTraditionGuess].filter(Boolean).join(' | ');
  const titleHit = anyAlias(response.workTitleGuess || '', key?.acceptedTitles);
  const qualifierGroups = Array.isArray(key?.requiredQualifierGroups) ? key.requiredQualifierGroups : [];
  const qualifiersHit = qualifierGroups.length > 0 && qualifierGroups.every(group => anyAlias(combined, group));
  const uniqueFactHit = anyAlias(combined, key?.uniqueFacts);
  // Honor the DECLARED exact rule strictly. A unique fact grants exact on its own only for a
  // 'uniqueFact' key, or for a title-based key that explicitly opts in via allowUniqueFactAlternative.
  // Undeclared legacy keys keep the older "title OR unique fact" behavior. A confident WRONG-work
  // title that nonetheless carries the correct unique fact is contradictory: it is never silently
  // graded exact but routed to blinded adjudication.
  const strict = EXACT_RULES.includes(key?.exactRequires);
  const policy = strict ? key.exactRequires : (qualifierGroups.length ? 'title+qualifier' : 'title');
  const allowUniqueFactAlternative = key?.allowUniqueFactAlternative === true;
  const exactViaTitle = policy === 'title' ? titleHit : (policy === 'title+qualifier' ? (titleHit && qualifiersHit) : false);
  const titleGuessMatchesUnique = anyAlias(response.workTitleGuess || '', key?.uniqueFacts);
  const contradiction = uniqueFactHit && !exactViaTitle && !titleGuessMatchesUnique
    && response.specificWorkClaim === true && shortText(response.workTitleGuess || '', 300) && !titleHit;
  let exact, needsAdjudication = false;
  if (policy === 'uniqueFact') exact = uniqueFactHit && !contradiction;
  else if (!strict || allowUniqueFactAlternative) exact = exactViaTitle || (uniqueFactHit && !contradiction);
  else exact = exactViaTitle; // declared title/title+qualifier, no opt-in: unique fact alone never grants exact
  if (contradiction && !exactViaTitle) needsAdjudication = true;
  const artistHit = anyAlias(response.artistGuess || combined, key?.acceptedArtists);
  // A CORRECT accepted title that merely lacks its distinguishing qualifier is a partial
  // identification, never a confabulation: the response named the right work-title, so it cannot be a
  // "different specific work." Only a specific claim that matches NO accepted title is wrong-specific.
  const titleWithoutQualifier = !exact && !needsAdjudication && titleHit;
  const hasSpecificWrong = !exact && !needsAdjudication && !titleHit && response.specificWorkClaim === true
    && shortText(response.workTitleGuess || '', 300)
    && !/^(unknown|unsure|none|n\/a)$/i.test(response.workTitleGuess.trim());
  return {
    ok: true,
    exact,
    needsAdjudication,
    titleWithoutQualifier,
    partialAttribution: !exact && !needsAdjudication && !titleHit && artistHit,
    wrongSpecificWork: hasSpecificWrong,
    confidentConfabulation: hasSpecificWrong && response.confidence >= 60,
    level: exact ? 2 : (needsAdjudication ? null : ((titleWithoutQualifier || artistHit) ? 1 : (hasSpecificWrong && response.confidence >= 60 ? -1 : 0))),
  };
}

export function datePeriod(year) {
  const bins = [
    [-Infinity, -3000, 'before-3000-bce'], [-2999, -1000, '3000-1000-bce'],
    [-999, 499, '1000-bce-499-ce'], [500, 999, '500-999'], [1000, 1399, '1000-1399'],
    [1400, 1599, '1400-1599'], [1600, 1749, '1600-1749'], [1750, 1849, '1750-1849'],
    [1850, 1899, '1850-1899'], [1900, 1945, '1900-1945'], [1946, 1979, '1946-1979'],
    [1980, Infinity, '1980-present'],
  ];
  return bins.find(([lo, hi]) => year >= lo && year <= hi)?.[2] || null;
}

export function gradeDate(bestYear, truth) {
  if (!Number.isInteger(bestYear) || !plainObject(truth) || !Number.isInteger(truth.lo) || !Number.isInteger(truth.hi) || truth.lo > truth.hi) return { ok: false };
  const distance = bestYear < truth.lo ? truth.lo - bestYear : (bestYear > truth.hi ? bestYear - truth.hi : 0);
  const cap = SCORING_POLICY.dateMaxErrorYears;
  const credit = distance >= cap ? 0 : 1 - Math.log1p(distance) / Math.log1p(cap);
  const truthPeriods = new Set([datePeriod(truth.lo), datePeriod(truth.hi)]);
  return { ok: true, distance, credit: +Math.max(0, credit).toFixed(6), periodCorrect: distance === 0 || truthPeriods.has(datePeriod(bestYear)) };
}

function hierarchyCredit(guess, truth, levels) {
  if (!shortText(guess, 300) || !plainObject(truth)) return { ok: false };
  for (const [key, credit] of levels) if (anyAlias(guess, truth[key])) return { ok: true, level: key, credit };
  return { ok: true, level: 'wrong', credit: 0 };
}

export const gradePlace = (guess, truth) => hierarchyCredit(guess, truth, [['exact', 1], ['parent', SCORING_POLICY.placeParentCredit]]);
export const gradeMedium = (guess, truth) => hierarchyCredit(guess, truth, [['exact', 1], ['family', SCORING_POLICY.mediumFamilyCredit], ['broad', SCORING_POLICY.mediumBroadCredit]]);

// Style grading is the ONE grader that consumes the frozen dedup/alias map: both the
// accepted truth labels and the free-text guess are canonicalized through it before matching, so
// declared-equivalent labels ("Rapa Nui" ≡ "Rapa Nui people") earn identical credit while distinct
// concepts ("Qin dynasty" vs "Qing dynasty") and more-specific children stay separate. Raw guesses
// and raw site labels are never mutated; canonicalization happens only inside the comparison.
// Canonicalize recognized label PHRASES anywhere in the (normalized) text, longest key first, so
// free-text variants like "Rapa Nui art" or "art of Rapa Nui" map as well as the bare label — while
// declared child styles (a longer, non-key phrase) are never collapsed into their parent.
export function canonicalizeStyleLabel(label, dedupNorm) {
  const n = normalizeLiteral(label);
  if (!dedupNorm || !Object.keys(dedupNorm).length) return n;
  // Map both variants AND their canonical values to the canonical, so an already-canonical phrase is
  // preserved (idempotent) rather than re-expanded. Greedy longest-phrase match, left to right, so a
  // declared child ("joseon dynasty literati painting") keeps its extra tokens and is never collapsed.
  const map = new Map();
  for (const [k, v] of Object.entries(dedupNorm)) { if (k) map.set(k, v); if (v) map.set(v, v); }
  const maxLen = Math.max(0, ...[...map.keys()].map(k => k.split(' ').length));
  const tokens = n ? n.split(' ') : [];
  const out = [];
  for (let i = 0; i < tokens.length;) {
    let matched = false;
    for (let len = Math.min(maxLen, tokens.length - i); len >= 1 && !matched; len--) {
      const phrase = tokens.slice(i, i + len).join(' ');
      if (map.has(phrase)) { out.push(map.get(phrase)); i += len; matched = true; }
    }
    if (!matched) { out.push(tokens[i]); i += 1; }
  }
  return out.join(' ');
}
// Build a normalized-key dedup map from a frozen/curated style snapshot's curatorDedupMap.
export function styleDedupFromSnapshot(styles) {
  const out = {};
  for (const [variant, canonical] of Object.entries(styles?.curatorDedupMap || {})) {
    const k = normalizeLiteral(variant), v = normalizeLiteral(canonical);
    if (k && v) out[k] = v;
  }
  return out;
}
// A level matches only on normalized WHOLE-LABEL equality after alias canonicalization — never
// substring containment. This keeps "Rapa Nui" ≡ "Rapa Nui people" (same canonical) while refusing
// false exacts like "Neo-Baroque"→Baroque, "Not Baroque"→Baroque, or a more-specific child label
// earning a parent's exact credit. Family/related earn their predefined partial levels via their own
// alias lists, not by containment.
function styleLevelHit(guess, aliases, dedupNorm) {
  const g = canonicalizeStyleLabel(guess, dedupNorm);
  return !!g && (Array.isArray(aliases) ? aliases : []).some(a => canonicalizeStyleLabel(a, dedupNorm) === g);
}
export function gradeStyle(guess, truth, dedupNorm = {}) {
  if (truth?.notApplicable) return { ok: true, notApplicable: true, credit: null };
  if (!shortText(guess, 300) || !plainObject(truth)) return { ok: false };
  for (const [key, credit] of [['exact', 1], ['family', SCORING_POLICY.styleFamilyCredit], ['related', SCORING_POLICY.styleRelatedCredit]])
    if (styleLevelHit(guess, truth[key], dedupNorm)) return { ok: true, level: key, credit };
  return { ok: true, level: 'wrong', credit: 0 };
}

export function gradeArtist(guess, truth) {
  if (truth?.notApplicable) return { ok: true, notApplicable: true, credit: null };
  if (!shortText(guess, 300) || !plainObject(truth)) return { ok: false };
  // Attribution qualifiers must outrank a maker-name substring. Otherwise “workshop of Rembrandt”
  // would receive exact-maker credit merely because it contains “Rembrandt.”
  for (const [key, credit] of [
    ['workshop', SCORING_POLICY.artistWorkshopCredit], ['circle', SCORING_POLICY.artistCircleCredit],
    ['attributed', SCORING_POLICY.artistAttributedCredit], ['follower', SCORING_POLICY.artistFollowerCredit],
  ]) if (anyAlias(guess, truth[key])) return { ok: true, level: key, credit };
  if (anyAlias(guess, truth.exact)) return { ok: true, level: 'exact', credit: 1 };
  return { ok: true, level: 'wrong', credit: 0 };
}

export function brier(confidencePct, credit) {
  if (!confidence(confidencePct) || typeof credit !== 'number') return null;
  const event = credit === 1 ? 1 : 0;
  return +((confidencePct / 100 - event) ** 2).toFixed(6);
}

export function fameBand(value) {
  const x = Number(value);
  return FAME_BANDS.find(b => Number.isFinite(x) && x <= b.max && (b.minExclusive ? x > b.min : x >= b.min))?.id || null;
}

function baseCall({ workId, source = 'canonical', view = 'full', task, condition = 'no-cue', replicate = 0, repeatKind = null }) {
  const key = { workId, source, view, task, condition, replicate, repeatKind };
  return { callId: sha256(canonicalJson(key)).slice(0, 24), ...key };
}

export function buildCallManifest(works, seed = 'recognition-pilot-calls-v1') {
  if (!Array.isArray(works) || works.length !== PILOT_WORKS) throw new Error(`need exactly ${PILOT_WORKS} works`);
  const ids = works.map(w => w.id);
  if (new Set(ids).size !== ids.length) throw new Error('duplicate work ids');
  if (new Set(ids.map(normalizedWorkId)).size !== ids.length) throw new Error('duplicate normalized work ids');
  const alternates = works.filter(w => w.studyC === true);
  const orderSubset = works.filter(w => w.promptOrder === true);
  if (alternates.length !== 6) throw new Error('need exactly 6 Study C works');
  if (orderSubset.length !== 12) throw new Error('need exactly 12 prompt-order works');

  const base = [];
  for (const w of works) {
    for (const view of VIEW_SPECS) {
      base.push(baseCall({ workId: w.id, view: view.id, task: 'identify' }));
      base.push(baseCall({ workId: w.id, view: view.id, task: 'facets' }));
    }
    base.push(baseCall({ workId: w.id, task: 'facets', condition: 'sham' }));
    base.push(baseCall({ workId: w.id, task: 'facets', condition: 'correct-cue' }));
    if (w.promptOrder) base.push(baseCall({ workId: w.id, task: 'identity-first', condition: 'identity-first' }));
    if (w.studyC) {
      base.push(baseCall({ workId: w.id, source: 'alternate', task: 'identify' }));
      base.push(baseCall({ workId: w.id, source: 'alternate', task: 'facets' }));
    }
  }
  if (base.length !== 600) throw new Error(`base call invariant: ${base.length}`);

  const mandatory = alternates.flatMap(w => [
    baseCall({ workId: w.id, task: 'identify', replicate: 1, repeatKind: 'study-c-stability' }),
    baseCall({ workId: w.id, source: 'alternate', task: 'identify', replicate: 1, repeatKind: 'study-c-stability' }),
  ]);
  const mandatoryKeys = new Set(mandatory.map(c => canonicalJson({ workId: c.workId, source: c.source, view: c.view, task: c.task, condition: c.condition })));
  const repeatPool = base.filter(c => !mandatoryKeys.has(canonicalJson({ workId: c.workId, source: c.source, view: c.view, task: c.task, condition: c.condition })));
  if (repeatPool.length !== 588) throw new Error(`repeat-pool invariant: ${repeatPool.length}`);
  const general = seededShuffle(repeatPool, `${seed}:repeat`).slice(0, 59).map(c => baseCall({ ...c, replicate: 1, repeatKind: 'general-reliability' }));
  const calls = seededShuffle([...base, ...mandatory, ...general], `${seed}:order`).map((c, i) => ({ ...c, order: i + 1 }));
  if (calls.length !== PILOT_CALLS || new Set(calls.map(c => c.callId)).size !== calls.length) throw new Error('call manifest invariant');
  return { version: PILOT_VERSION, seed, counts: { base: 600, studyCRepeats: 12, generalRepeats: 59, total: calls.length }, calls };
}

export function estimateImageTokens(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width > 1568 || height > 1568) throw new Error('invalid image dimensions');
  const tokens = Math.ceil(width / 28) * Math.ceil(height / 28);
  if (tokens > 1568) throw new Error('image exceeds frozen native visual-token limit');
  return tokens;
}

export function estimateCost(callManifest, promptRegistry, imageRegistry, policy = REQUEST_POLICY) {
  const price = policy.pricing;
  const rows = [];
  for (const call of callManifest.calls || []) {
    const prompt = promptRegistry?.[call.callId] ?? promptRegistry?.[`${call.task}:${call.condition}`] ?? promptRegistry?.[call.task];
    const image = imageRegistry?.[`${call.workId}:${call.source}:${call.view}`];
    if (!prompt || !image) throw new Error(`missing cost input for ${call.callId}`);
    // One token per UTF-8 byte is intentionally much more conservative than typical text. It stays
    // safe for opaque shams and non-Latin cues; fixed request overhead covers provider framing that
    // is not represented in the literal prompt string.
    const textTokens = Buffer.byteLength(prompt, 'utf8') + policy.conservativeInputOverheadTokens;
    const imageTokens = estimateImageTokens(image.width, image.height);
    const outputCap = call.task === 'identify' ? policy.tokenCaps.identify : (call.task === 'identity-first' ? policy.tokenCaps.identityFirst : policy.tokenCaps.facets);
    const usd = ((textTokens + imageTokens) * price.inputPerMillionUsd + outputCap * price.outputPerMillionUsd) / 1_000_000 * price.batchMultiplier;
    rows.push({ callId: call.callId, textTokens, imageTokens, outputCap, conservativeUsd: usd });
  }
  const plannedUsd = rows.reduce((n, r) => n + r.conservativeUsd, 0);
  const worstCallUsd = Math.max(...rows.map(r => r.conservativeUsd));
  const retryReserveUsd = worstCallUsd * policy.retryReserveAttempts;
  const authorizedUpperBoundUsd = plannedUsd + retryReserveUsd;
  return {
    ok: authorizedUpperBoundUsd <= PILOT_BUDGET_USD,
    plannedUsd: +plannedUsd.toFixed(6), retryReserveUsd: +retryReserveUsd.toFixed(6),
    authorizedUpperBoundUsd: +authorizedUpperBoundUsd.toFixed(6), budgetUsd: PILOT_BUDGET_USD,
    rows,
  };
}

export function remainingBudgetAllows(costReport, spentUsd, nextCallId) {
  const row = costReport?.rows?.find(r => r.callId === nextCallId);
  if (!row || !Number.isFinite(spentUsd) || spentUsd < 0) return false;
  return spentUsd + row.conservativeUsd <= costReport.budgetUsd;
}

// ONE shared, fail-closed derivation of the exact request evidence every frozen call must carry, consumed
// identically by the live runner, the collection sealer, and the final analyzer so their definitions
// cannot drift. It also returns the very promptRegistry/images/cost the runner sends, so the prompt whose
// SHA the evidence expects is byte-identical to the prompt actually transmitted (same for image + cost).
// `registrationCommit` MUST be the independently verified git-freeze commit (verifyGitFreeze), never a
// value read from the mutable run freeze-evidence file — the run file may not redefine what is authoritative.
// Aggregate the isolated multilingual-fame harvest into per-language pilot percentiles + a language-
// balanced score. A work with NO mapped Wikidata QID has UNKNOWN linkage (not measured zero exposure):
// its component cells are recorded as unlinked/missing and it is EXCLUDED from the percentile reference
// distributions and left unscored (rawTotal + languageBalancedPilot = null). A QID-linked work with a
// genuinely absent sitelink for a language keeps a measured zero for that language. Deterministic; no fs.
export function aggregateMultilingualFame(rows, langs) {
  for (const row of rows) {
    if (row.missingQid) {
      row.languages = row.languages || {};
      for (const lang of langs) row.languages[lang] = { title: null, canonicalTitle: null, views: null, missing: true, unlinked: true, articleCreatedAt: null };
      row.rawTotal = null;
      row.languageBalancedPilot = null;
    }
  }
  const linked = rows.filter(r => !r.missingQid);
  for (const lang of langs) {
    const sorted = linked.map(r => Math.log1p(r.languages[lang]?.views || 0)).sort((a, b) => a - b);
    for (const row of linked) {
      const x = Math.log1p(row.languages[lang]?.views || 0);
      row.languages[lang].pilotPercentile = sorted.length <= 1 ? 0.5 : sorted.findLastIndex(v => v <= x) / (sorted.length - 1);
    }
  }
  for (const row of linked) row.languageBalancedPilot = langs.reduce((n, lang) => n + row.languages[lang].pilotPercentile, 0) / langs.length;
  return rows;
}

export function deriveExpectedEvidence({ manifest, calls, promptAssets, schemaAssets, registrationCommit, policy = REQUEST_POLICY }) {
  if (!/^[0-9a-f]{40}$/.test(registrationCommit || '')) throw new Error('deriveExpectedEvidence: registrationCommit must be a verified 40-hex git commit');
  // Cross-artifact binding (fail closed, BEFORE any prompt/cost): the supplied call manifest must match
  // the frozen manifest's declared call-manifest contract. The hash covers the calls object; the manifest
  // -side seed/expectedCalls copies are checked separately because the calls-hash does not cover them.
  const bind = manifest?.callManifest;
  if (!bind || typeof bind !== 'object') throw new Error('deriveExpectedEvidence: frozen manifest has no callManifest binding');
  if (!calls || typeof calls !== 'object' || !Array.isArray(calls.calls)) throw new Error('deriveExpectedEvidence: calls must be an object with a calls array');
  if (sha256(canonicalJson(calls)) !== bind.sha256) throw new Error('deriveExpectedEvidence: call manifest hash does not match the frozen manifest binding');
  if (bind.seed !== calls.seed) throw new Error('deriveExpectedEvidence: call manifest seed does not match the frozen manifest binding');
  if (canonicalJson(bind.expectedCalls) !== canonicalJson(calls.counts)) throw new Error('deriveExpectedEvidence: call manifest counts do not match the frozen manifest binding');
  if (calls.counts?.total !== calls.calls.length) throw new Error('deriveExpectedEvidence: call manifest counts.total does not equal the number of calls');
  const seenIds = new Set();
  for (const c of calls.calls) { if (seenIds.has(c.callId)) throw new Error(`deriveExpectedEvidence: duplicate callId ${c.callId}`); seenIds.add(c.callId); }
  const works = new Map(manifest.works.map(w => [w.id, w]));
  const images = {};
  for (const w of manifest.works) {
    for (const [view, rec] of Object.entries(w.transform.views)) images[`${w.id}:canonical:${view}`] = rec;
    if (w.studyC) images[`${w.id}:alternate:full`] = w.alternate.view;   // Study C alternate full view
  }
  const promptRegistry = {};
  for (const call of calls.calls) {
    const w = works.get(call.workId);
    if (!w) throw new Error(`deriveExpectedEvidence: no frozen work for call ${call.callId}`);
    promptRegistry[call.callId] = buildModelPrompt(call, w, promptAssets, schemaAssets);
  }
  const cost = estimateCost(calls, promptRegistry, images, policy);
  const costByCall = new Map(cost.rows.map(r => [r.callId, r]));
  const expected = new Map();
  for (const call of calls.calls) {
    if (expected.has(call.callId)) throw new Error(`deriveExpectedEvidence: duplicate callId ${call.callId}`);
    const image = images[`${call.workId}:${call.source}:${call.view}`];
    if (!image?.sha256) throw new Error(`deriveExpectedEvidence: no frozen image for call ${call.callId} (${call.workId}:${call.source}:${call.view})`);
    const row = costByCall.get(call.callId);
    if (!row) throw new Error(`deriveExpectedEvidence: no cost row for call ${call.callId}`);
    expected.set(call.callId, {
      freezeId: manifest.freeze.id,
      registrationCommit,
      imageSha256: image.sha256,
      promptSha256: sha256(promptRegistry[call.callId]),
      requestPolicyVersion: policy.version,
      requestedModel: policy.model,
      conservativeUsd: row.conservativeUsd,
    });
  }
  if (expected.size !== calls.calls.length) throw new Error('deriveExpectedEvidence: expected-row count must equal the frozen call count');
  return { expected, cost, promptRegistry, images };
}

// ===========================================================================
// Shared curation contract + structural validators (single source of truth for
// the gate, sealer, and finalizer). A truthy string, a missing key, or an extra
// key can never "bless" a malformed manifest through curator booleans.
// ===========================================================================

export const REQUIRED_CURATOR_CHECKS = Object.freeze(['imageFitness', 'regionOrigin', 'recognitionKey', 'cueAndMask', 'truthHierarchy', 'rights', 'alternateIdentity']);
export const CURATION_ISSUE_SEVERITIES = Object.freeze(['info', 'minor', 'major', 'critical']);
export const CURATION_ISSUE_STATUSES = Object.freeze(['open', 'resolved', 'accepted', 'deferred-image', 'owner-decision']);
const CLEARED_ISSUE_STATUSES = Object.freeze(['resolved', 'accepted']);
export const REGION_SOURCES_DRAFT = Object.freeze(['creation-place', 'culture-region-fallback', 'pool-region-provisional-unverified']);
export const REGION_SOURCES_REGISTRABLE = Object.freeze(['creation-place', 'culture-region-fallback']);

// Bare generic object-type / subject nouns that cannot, alone, identify one exact work. A curator may
// still use a distinctive single-word proper name (e.g. "Sehando", "Guernica") for exactRequires:'title';
// this set only catches a generic noun being marked title-exact (the "Hercules"/"Knucklebone" bug).
const GENERIC_LABELS = new Set(['mask','vessel','head','jar','bowl','figure','figurine','plate','dish','cup','vase','bottle','fragment','fragments','statuette','statue','relief','panel','tile','box','ring','pendant','bead','beads','coin','seal','stele','stela','sculpture','painting','drawing','portrait','untitled','amulet','plaque','jug','ewer','flask','censer','comb','buckle','brooch','necklace','earring','bracelet','textile','tapestry','teapot','candlestick','altarpiece','casket','knucklebone','astragalus','astragalos','rasp','wreath','wandle','hercules','alabastron','moai','fragment','infantryman','self-portrait','self portrait','landscape','still life','madonna','crucifixion','the crucifixion']);
export function isGenericLabel(label) {
  const n = normalizeLiteral(label);
  return !n || GENERIC_LABELS.has(n);
}

// The Study B primary denominator: cue-eligible facets that are also applicable — excluding truth
// facets marked notApplicable and facets whose per-work primaryApplicable flag is false (e.g. an
// attribution whose maximum truth credit is < 1 and so cannot generate a full-credit event).
export function applicableEligibleFacets(work) {
  const eligible = Array.isArray(work?.cue?.eligibleFacets) ? work.cue.eligibleFacets : [];
  const pa = work?.primaryApplicable && typeof work.primaryApplicable === 'object' && !Array.isArray(work.primaryApplicable) ? work.primaryApplicable : {};
  return eligible.filter(f => FACETS.includes(f) && work?.truth?.[f]?.notApplicable !== true && pa[f] !== false);
}

export function validateCuratorChecks(checks) {
  const errors = [];
  if (!checks || typeof checks !== 'object' || Array.isArray(checks)) return { ok: false, errors: ['curatorChecks must be a plain object'] };
  for (const k of REQUIRED_CURATOR_CHECKS) if (!Object.hasOwn(checks, k)) errors.push(`missing curator check: ${k}`);
  for (const k of Object.keys(checks)) if (!REQUIRED_CURATOR_CHECKS.includes(k)) errors.push(`unexpected curator check: ${k}`);
  for (const k of REQUIRED_CURATOR_CHECKS) if (Object.hasOwn(checks, k) && checks[k] !== true && checks[k] !== false) errors.push(`curator check not strictly boolean: ${k}`);
  return { ok: errors.length === 0, errors };
}
export function curatorChecksAllTrue(checks) {
  return validateCuratorChecks(checks).ok && REQUIRED_CURATOR_CHECKS.every(k => checks[k] === true);
}

export function validateCurationIssues(issues) {
  const errors = [];
  if (!Array.isArray(issues)) return { ok: false, errors: ['curationIssues must be an array'] };
  issues.forEach((it, i) => {
    if (!plainObject(it)) { errors.push(`curationIssues[${i}] not an object`); return; }
    if (!shortText(it.code, 80)) errors.push(`curationIssues[${i}].code`);
    if (!CURATION_ISSUE_SEVERITIES.includes(it.severity)) errors.push(`curationIssues[${i}].severity`);
    if (typeof it.blocking !== 'boolean') errors.push(`curationIssues[${i}].blocking`);
    if (!CURATION_ISSUE_STATUSES.includes(it.status)) errors.push(`curationIssues[${i}].status`);
    if (!shortText(it.note, 600)) errors.push(`curationIssues[${i}].note`);
    if (!Array.isArray(it.evidenceRefs) || it.evidenceRefs.some(r => !shortText(r, 400))) errors.push(`curationIssues[${i}].evidenceRefs`);
    for (const key of Object.keys(it)) if (!['code', 'severity', 'blocking', 'status', 'note', 'evidenceRefs'].includes(key)) errors.push(`curationIssues[${i}] unexpected key ${key}`);
  });
  return { ok: errors.length === 0, errors };
}
// An issue blocks finalization unless it is resolved or accepted. Any 'owner-decision' status blocks
// regardless of its blocking flag: an unmade owner decision must never freeze silently.
export function unresolvedBlockingIssues(work) {
  return (Array.isArray(work?.curationIssues) ? work.curationIssues : []).filter(it => it && !CLEARED_ISSUE_STATUSES.includes(it.status) && (it.blocking === true || it.status === 'owner-decision'));
}

// A blinded adjudication resolution artifact. Each entry binds to a specific call AND the exact
// response it reviewed (responseSha256), so an edited/re-collected response invalidates the ruling.
export const ADJUDICATION_VERSION = 'recognition-adjudication/3';
export const ADJUDICATION_FACET_CREDITS = Object.freeze([0, 0.35, 0.4, 0.5, 0.6, 0.65, 0.75, 1]);
// Opaque, stable adjudication cell id. Leaks nothing about condition; a separately sealed controller
// maps it back to the call/response.
export function adjudicationCellId(kind, callId, facet) {
  return sha256(canonicalJson({ kind, callId, facet: facet ?? null })).slice(0, 32);
}
export function validateAdjudicationArtifact(a) {
  const errors = [];
  if (!plainObject(a)) return { ok: false, errors: ['adjudication artifact not an object'] };
  if (Object.keys(a).sort().join(',') !== 'collectionEvidenceSha256,freezeId,packetSha256,resolutions,version') errors.push('top-level keys must be exactly version, freezeId, packetSha256, collectionEvidenceSha256, resolutions');
  if (a.version !== ADJUDICATION_VERSION) errors.push('version');
  if (!shortText(a.freezeId, 200)) errors.push('freezeId required');
  // Bind the whole ruling set to the exact review packet AND the exact collection state it was made
  // against, so a ruling cannot survive an edited packet or a changed collection.
  if (!/^[0-9a-f]{64}$/.test(a.packetSha256 || '')) errors.push('packetSha256');
  if (!/^[0-9a-f]{64}$/.test(a.collectionEvidenceSha256 || '')) errors.push('collectionEvidenceSha256');
  const seen = new Set();
  if (!Array.isArray(a.resolutions)) errors.push('resolutions must be an array');
  else a.resolutions.forEach((r, i) => {
    if (!plainObject(r)) { errors.push(`resolutions[${i}] not an object`); return; }
    for (const k of Object.keys(r)) if (!['cellId', 'responseSha256', 'kind', 'resolvedExact', 'resolvedCredit', 'reviewer', 'note'].includes(k)) errors.push(`resolutions[${i}] unexpected key ${k}`);
    if (!/^[0-9a-f]{32}$/.test(r.cellId || '')) errors.push(`resolutions[${i}].cellId`);
    else { if (seen.has(r.cellId)) errors.push(`resolutions[${i}].cellId duplicate`); seen.add(r.cellId); }
    if (!/^[0-9a-f]{64}$/.test(r.responseSha256 || '')) errors.push(`resolutions[${i}].responseSha256`);
    if (r.kind === 'identification') {
      if (typeof r.resolvedExact !== 'boolean') errors.push(`resolutions[${i}].resolvedExact`);
      if ('resolvedCredit' in r) errors.push(`resolutions[${i}] identification must not carry resolvedCredit`);
    } else if (r.kind === 'facet') {
      if (!ADJUDICATION_FACET_CREDITS.includes(r.resolvedCredit)) errors.push(`resolutions[${i}].resolvedCredit`);
      if ('resolvedExact' in r) errors.push(`resolutions[${i}] facet must not carry resolvedExact`);
    } else errors.push(`resolutions[${i}].kind`);
    if (!shortText(r.reviewer, 200)) errors.push(`resolutions[${i}].reviewer`);
    if (r.note != null && !shortText(r.note, 600)) errors.push(`resolutions[${i}].note`);
  });
  return { ok: errors.length === 0, errors };
}

// Build the blinded reviewer packet + the private controller from the queued cells. The packet is keyed
// by the opaque adjudication id and carries ONLY the response SHA, the exact relevant response, and the
// minimum frozen ground truth needed to grade it — never work/call/view/source/image/cue/fame/region/arm
// (those live only in the private controller). `responseFor(callId) -> {parsed, responseSha256}|null`.
export function buildAdjudicationArtifacts(requiredCells, { works, responseFor, freezeId }) {
  const workOf = id => (works.get ? works.get(id) : works.find(x => x.id === id));
  const packetCells = [], controllerCells = [];
  for (const cell of requiredCells) {
    const w = workOf(cell.workId);
    const rr = responseFor(cell.callId) || {};
    const resp = rr.parsed || {};
    const responseSha256 = rr.responseSha256 || null;
    const id = cell.task === 'identity-first' ? (resp.identification || {}) : resp;
    let groundTruth, response;
    if (cell.kind === 'identification') {
      const k = w.recognitionKey;
      groundTruth = { exactRequires: k.exactRequires, acceptedTitles: k.acceptedTitles, acceptedArtists: k.acceptedArtists, requiredQualifierGroups: k.requiredQualifierGroups, uniqueFacts: k.uniqueFacts, allowUniqueFactAlternative: k.allowUniqueFactAlternative === true };
      response = { workTitleGuess: id.workTitleGuess ?? null, distinguishingQualifierGuess: id.distinguishingQualifierGuess ?? null, artistGuess: id.artistGuess ?? null, seriesOrTraditionGuess: id.seriesOrTraditionGuess ?? null, specificWorkClaim: id.specificWorkClaim ?? null };
    } else {
      const fr = cell.task === 'identity-first' ? (resp.facets || {}) : resp;
      groundTruth = { facet: cell.facet, truth: w.truth[cell.facet] };
      response = { guess: cell.facet === 'place' ? (fr.place?.topGuess ?? null) : (fr[cell.facet]?.guess ?? null), confidence: cell.facet === 'place' ? (fr.place?.confidence ?? null) : (fr[cell.facet]?.confidence ?? null) };
    }
    packetCells.push({ adjudicationId: cell.cellId, kind: cell.kind, responseSha256, response, groundTruth });
    controllerCells.push({ adjudicationId: cell.cellId, callId: cell.callId, workId: cell.workId, facet: cell.facet ?? null, task: cell.task, source: cell.source, view: cell.view, responseSha256 });
  }
  const packet = { version: 'recognition-blinded-review/2', freezeId, cells: packetCells.sort((a, b) => a.adjudicationId.localeCompare(b.adjudicationId)) };
  const controller = { version: 'recognition-adjudication-controller/1', freezeId, cells: controllerCells.sort((a, b) => a.adjudicationId.localeCompare(b.adjudicationId)) };
  return { packet, controller, packetSha256: sha256(canonicalJson(packet)), controllerSha256: sha256(canonicalJson(controller)) };
}

const strOk = (x, max = 400) => typeof x === 'string' && x.length > 0 && x.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(x);
const strArr = (a, max = 400) => Array.isArray(a) && a.every(x => strOk(x, max));

// Full structural validation of one manifest work. Complements (does not replace) the curator
// booleans: booleans record human judgement, this proves the data they judge is well-formed.
export function validateWorkShape(work) {
  const e = [];
  const id = work?.id;
  if (!strOk(id, 400)) return { ok: false, errors: ['work.id missing/invalid'] };
  const tag = m => e.push(`${id}: ${m}`);
  const s = work.strata;
  if (!plainObject(s)) tag('strata missing');
  else {
    if (!FAME_BANDS.some(b => b.id === s.fameBand)) tag('strata.fameBand invalid');
    if (!REGIONS.includes(s.regionGroup)) tag('strata.regionGroup invalid');
    if (!REGION_SOURCES_DRAFT.includes(s.regionSource)) tag('strata.regionSource invalid');
    if (typeof s.lowDocumentationStress !== 'boolean') tag('strata.lowDocumentationStress invalid');
    if (typeof s.fameHistoricalComposite !== 'number') tag('strata.fameHistoricalComposite invalid');
  }
  const cat = work.catalog;
  if (!plainObject(cat) || !strOk(cat.title, 600)) tag('catalog.title missing/invalid');
  else for (const key of ['wikidataId', 'artist', 'place', 'style', 'styleKind', 'medium']) if (!(cat[key] == null || strOk(cat[key], 400))) tag(`catalog.${key} must be null or a string`);
  const covOk = (cov, label) => {
    if (!plainObject(cov)) { tag(`${label} missing`); return; }
    for (const key of ['era', 'objectType', 'mediumFamily', 'titleType', 'playState', 'sourceHost']) if (!strOk(cov[key], 200)) tag(`${label}.${key} invalid`);
    if (typeof cov.contentRichness !== 'number') tag(`${label}.contentRichness invalid`);
    for (const key of ['artistCluster', 'institutionCluster']) if (!(cov[key] === null || strOk(cov[key], 400))) tag(`${label}.${key} invalid`);
  };
  covOk(work.selectionCovariates, 'selectionCovariates');
  covOk(work.analysisCovariates, 'analysisCovariates');
  if (Object.hasOwn(work, 'covariates')) tag('legacy "covariates" must be split into selectionCovariates/analysisCovariates');
  if (!plainObject(work.source) || !strOk(work.source.requestedUrl, 2000)) tag('source.requestedUrl invalid');
  else {
    if (!(work.source.rights == null || strOk(work.source.rights, 1000))) tag('source.rights must be null or a string');
    if (!(work.source.license == null || strOk(work.source.license, 400))) tag('source.license must be null or a string');
  }
  const im = work.imageFitness;
  if (!plainObject(im) || !(im.state === null || ['usable', 'repair', 'blocked', 'unplayable'].includes(im.state)) || !(im.reason == null || strOk(im.reason, 600)) || !(im.replacementUrl == null || strOk(im.replacementUrl, 2000))) tag('imageFitness malformed');
  const tr = work.transform;
  if (!plainObject(tr) || !ANCHORS.includes(tr.anchor) || !plainObject(tr.views)) tag('transform malformed');
  const k = work.recognitionKey;
  if (!plainObject(k)) tag('recognitionKey missing');
  else {
    if (!strArr(k.acceptedTitles) || k.acceptedTitles.length < 1) tag('recognitionKey.acceptedTitles empty/invalid');
    if (!strArr(k.acceptedArtists)) tag('recognitionKey.acceptedArtists invalid');
    if (!Array.isArray(k.requiredQualifierGroups) || !k.requiredQualifierGroups.every(g => strArr(g) && g.length >= 1)) tag('recognitionKey.requiredQualifierGroups invalid');
    if (!strArr(k.uniqueFacts)) tag('recognitionKey.uniqueFacts invalid');
    if (!TARGET_UNITS.includes(k.targetUnit)) tag('recognitionKey.targetUnit invalid');
    if (!EXACT_RULES.includes(k.exactRequires)) tag('recognitionKey.exactRequires invalid');
    if (k.exactRequires === 'title') {
      if ((k.requiredQualifierGroups || []).length) tag('exactRequires=title must carry no qualifier groups');
      if ((k.acceptedTitles || []).every(isGenericLabel)) tag('exactRequires=title cannot rest on a generic noun alone');
    }
    if (k.exactRequires === 'title+qualifier' && !(k.requiredQualifierGroups || []).length) tag('exactRequires=title+qualifier needs a qualifier group');
    if (k.exactRequires === 'uniqueFact' && !(k.uniqueFacts || []).length) tag('exactRequires=uniqueFact needs a unique fact');
    if (Object.hasOwn(k, 'allowUniqueFactAlternative') && typeof k.allowUniqueFactAlternative !== 'boolean') tag('recognitionKey.allowUniqueFactAlternative must be boolean');
  }
  const c = work.cue;
  if (!plainObject(c)) tag('cue missing');
  else {
    if (!strOk(c.correct, 600)) tag('cue.correct invalid');
    if (!strOk(c.sham, 600)) tag('cue.sham invalid');
    if (!strOk(c.cueType, 60)) tag('cue.cueType invalid');
    const ab = c.acceptedAliasesByFacet;
    if (!plainObject(ab) || FACETS.some(f => !Array.isArray(ab[f]) || !strArr(ab[f])) || Object.keys(ab).some(f => !FACETS.includes(f))) tag('cue.acceptedAliasesByFacet must have exactly the five facet arrays');
    const disc = c.disclosedFacets, elig = c.eligibleFacets;
    if (!Array.isArray(disc) || !Array.isArray(elig) || [...disc, ...elig].sort().join(',') !== [...FACETS].sort().join(',') || disc.some(f => elig.includes(f))) tag('cue.disclosedFacets/eligibleFacets must partition the five facets');
  }
  const t = work.truth;
  if (!plainObject(t)) tag('truth missing');
  else {
    if (!plainObject(t.date) || !Number.isInteger(t.date.lo) || !Number.isInteger(t.date.hi) || t.date.lo > t.date.hi) tag('truth.date invalid');
    const hier = (name, keys, exactRequired) => {
      const v = t[name];
      if (v?.notApplicable === true) { if (Object.keys(v).length !== 1) tag(`truth.${name} notApplicable must be sole key`); return; }
      if (!plainObject(v) || keys.some(kk => !strArr(v[kk])) || Object.keys(v).some(kk => !keys.includes(kk))) { tag(`truth.${name} invalid`); return; }
      if (exactRequired && !(v.exact || []).length) tag(`truth.${name}.exact empty`);
    };
    hier('place', ['exact', 'parent'], true);
    hier('medium', ['exact', 'family', 'broad'], true);
    hier('style', ['exact', 'family', 'related'], true);
    hier('artist', ['exact', 'workshop', 'circle', 'attributed', 'follower'], false);
  }
  if (Object.hasOwn(work, 'primaryApplicable')) {
    const pa = work.primaryApplicable;
    if (!plainObject(pa) || Object.keys(pa).some(f => !FACETS.includes(f)) || Object.values(pa).some(v => typeof v !== 'boolean')) tag('primaryApplicable invalid');
  }
  if (plainObject(t) && !applicableEligibleFacets(work).length) tag('no applicable eligible Study B primary facet');
  if (typeof work.studyC !== 'boolean') tag('studyC not boolean');
  if (work.studyC) { if (!plainObject(work.alternate) || !strOk(work.alternate.candidateUrl, 2000)) tag('studyC alternate.candidateUrl invalid'); }
  else if (work.alternate !== null) tag('non-studyC alternate must be null');
  for (const f of ['promptOrder', 'evidenceBoxes']) if (typeof work[f] !== 'boolean') tag(`${f} not boolean`);
  const ci = validateCurationIssues(work.curationIssues); if (!ci.ok) ci.errors.forEach(m => tag(m));
  const cc = validateCuratorChecks(work.curatorChecks); if (!cc.ok) cc.errors.forEach(m => tag(m));
  return { ok: e.length === 0, errors: e };
}

// Behaviorally derived (never hardcoded) disclosure list, sorted for stable reporting.
export function disclosedFacetList(manifest) {
  const out = [];
  for (const w of manifest?.works || []) for (const f of (w.cue?.disclosedFacets || [])) out.push({ id: w.id, facet: f });
  return out.sort((a, b) => `${a.id}\0${a.facet}`.localeCompare(`${b.id}\0${b.facet}`));
}

// Deterministic worksheet regenerated from the sealed manifest so a stale review artifact cannot drift.
export function buildWorksheet(manifest) {
  const works = manifest?.works || [];
  const rows = works.map((w, i) => {
    const checks = REQUIRED_CURATOR_CHECKS.map(key => `${key}:${w.curatorChecks?.[key] === true ? '✓' : '✗'}`).join(' ');
    const disclosed = (w.cue?.disclosedFacets || []).join(', ') || 'none';
    const issues = (w.curationIssues || []).map(it => `${it.code}[${it.severity}${it.blocking ? ',blocking' : ''},${it.status}]`).join('; ') || 'none';
    const studyC = w.studyC ? `yes(approved:${w.alternate?.sameObjectOwnerApproved === true})` : 'no';
    const cell = `${w.strata?.fameBand}/${w.strata?.regionGroup}`;
    const cue = String(w.cue?.correct || '').replace(/\|/g, '\\|');
    const title = String(w.catalog?.title || w.id).replace(/\|/g, '\\|');
    return `| ${i + 1} | ${title}<br><code>${w.id}</code> | ${cell} | ${cue}<br>disclosed: ${disclosed} | ${issues} | ${checks} | ${studyC} |`;
  });
  return [
    '# Pilot curation worksheet (generated)',
    '',
    '**DRAFT — regenerated deterministically from the sealed manifest by `recognition-pilot-seal-curation.mjs`.**',
    'Do not edit by hand; edit `pilot-manifest.draft.json` and re-seal. Legacy counts never enter a blind payload.',
    '',
    '| # | Work | Cell | Cue / disclosed facets | Unresolved/structured issues | Curator checks | Study C |',
    '|---:|---|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n') + '\n';
}

// ===========================================================================
// Frozen pure analysis. Consumes the manifest, the frozen call schedule, a
// resultForCallId(callId)->parsed|null resolver, and the frozen style dedup
// map. It emits nuisance quantities only; the treatment-effect mean/direction is
// reported for transparency but is explicitly forbidden as a power input.
// ===========================================================================

const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const sampleVariance = xs => (xs.length > 1 ? xs.reduce((a, b) => a + (b - mean(xs)) ** 2, 0) / (xs.length - 1) : null);
const rate = (num, den) => (den ? num / den : null);

export function analyzePilot({ manifest, calls, resultForCallId, styleDedup = {}, resolveAdjudication = () => null }) {
  const works = new Map(manifest.works.map(w => [w.id, w]));
  const callIndex = new Map();
  for (const c of calls.calls) callIndex.set(canonicalJson({ workId: c.workId, source: c.source, view: c.view, task: c.task, condition: c.condition, replicate: c.replicate }), c);
  const findCall = o => callIndex.get(canonicalJson({ workId: o.workId, source: o.source ?? 'canonical', view: o.view ?? 'full', task: o.task, condition: o.condition ?? 'no-cue', replicate: o.replicate ?? 0 })) || null;
  const resultOf = o => { const c = findCall(o); return c ? resultForCallId(c.callId) : null; };

  // Adjudication cells (identification contradictions AND genuinely ambiguous facet prose) are
  // UNRESOLVED, never a forced value. A cell is resolved only by a bound resolver (the wrapper checks
  // response-hash binding); otherwise it enters the blinded queue under an opaque cell id and stays
  // null in every recognition/facet/repeat computation until a bound ruling resolves it.
  const adjRequired = new Map(); // cellId -> { cellId, kind, callId, facet }
  const adjResolved = new Set();
  const queueOrResolve = (cell, kind) => {
    const r = resolveAdjudication(cell);
    if (typeof r === (kind === 'identification' ? 'boolean' : 'number')) { adjResolved.add(cell.cellId); return r; }
    adjRequired.set(cell.cellId, cell);
    return null;
  };
  const identExact = (call, response, key) => {
    if (!call || !response) return null;
    const g = gradeIdentification(response, key);
    if (!g.needsAdjudication) return g.exact;
    // The queued cell carries enough controller context (work/call/task/source/view) to locate the frozen
    // work while the reviewer packet stays blind to it; the opaque cellId is what the reviewer ever sees.
    return queueOrResolve({ cellId: adjudicationCellId('identification', call.callId, null), kind: 'identification', callId: call.callId, facet: null, workId: call.workId, task: call.task, source: call.source, view: call.view }, 'identification');
  };

  const facetAmbiguous = (facet, result, rows) => {
    if (facet === 'date' || rows[facet]?.ok === false || rows[facet]?.notApplicable || rows[facet]?.credit !== 0) return false;
    const guess = facet === 'place' ? result.place?.topGuess : result[facet]?.guess;
    const conf = result[facet]?.confidence;
    return shortText(guess || '', 300) && !/^(unknown|unsure|none|n\/a)$/i.test(String(guess).trim()) && Number.isInteger(conf) && conf >= 60;
  };
  const gradeFacetsFor = (w, result, call = null, adjudicable = false) => {
    if (!result) return null;
    const rows = {
      date: gradeDate(result.date?.bestYear, w.truth.date),
      place: gradePlace(result.place?.topGuess, w.truth.place),
      medium: gradeMedium(result.medium?.guess, w.truth.medium),
      style: gradeStyle(result.style?.guess, w.truth.style, styleDedup),
      artist: gradeArtist(result.artist?.guess, w.truth.artist),
    };
    if (adjudicable && call?.callId) for (const facet of ['place', 'medium', 'style', 'artist']) {
      if (!facetAmbiguous(facet, result, rows)) continue;
      const resolved = queueOrResolve({ cellId: adjudicationCellId('facet', call.callId, facet), kind: 'facet', callId: call.callId, facet, workId: call.workId, task: call.task, source: call.source, view: call.view }, 'facet');
      if (typeof resolved === 'number') { rows[facet].credit = resolved; rows[facet].adjudicated = true; }
      else { rows[facet].credit = null; rows[facet].unresolved = true; }
    }
    for (const f of FACETS) if (typeof rows[f]?.credit === 'number') rows[f].brier = brier(result[f]?.confidence, rows[f].credit);
    return rows;
  };
  // Facet adjudication is scoped to the primary canonical/full facet cells (Study B arms), not crop/
  // branch views, to bound reviewer load; other views grade deterministically.
  const facetsAt = (id, source, view, condition = 'no-cue') => {
    const c = findCall({ workId: id, source, view, task: 'facets', condition });
    return gradeFacetsFor(works.get(id), c ? resultForCallId(c.callId) : null, c, source === 'canonical' && view === 'full');
  };
  const exactAt = (id, source, view) => { const c = findCall({ workId: id, source, view, task: 'identify' }); return identExact(c, c && resultForCallId(c.callId), works.get(id).recognitionKey); };

  // ---- Study B: causal primary uses the identical applicable mask across all three arms. ----
  const studyB = manifest.works.map(w => {
    const applicable = applicableEligibleFacets(w);
    const arm = { 'no-cue': facetsAt(w.id, 'canonical', 'full', 'no-cue'), sham: facetsAt(w.id, 'canonical', 'full', 'sham'), 'correct-cue': facetsAt(w.id, 'canonical', 'full', 'correct-cue') };
    const score = (cond, drop = []) => {
      const facets = applicable.filter(f => !drop.includes(f));
      if (!arm[cond] || !facets.length) return null;
      const vals = facets.map(f => arm[cond][f]?.credit).filter(Number.isFinite);
      return vals.length === facets.length ? mean(vals) : null;
    };
    return {
      id: w.id, applicableFacets: applicable, eligibleFacets: w.cue.eligibleFacets,
      scores: Object.fromEntries(['no-cue', 'sham', 'correct-cue'].map(c => [c, score(c)])),
      noArtist: Object.fromEntries(['no-cue', 'sham', 'correct-cue'].map(c => [c, score(c, ['artist'])])),
    };
  });
  const pairedList = (a, b, key = 'scores') => studyB.map(w => (w[key][a] != null && w[key][b] != null ? w[key][a] - w[key][b] : null)).filter(Number.isFinite);
  const analyzedWorks = studyB.filter(w => w.scores['correct-cue'] != null && w.scores.sham != null).map(w => w.id);
  const bSummary = {
    analyzedWorkCount: analyzedWorks.length,
    analyzedWorkIds: analyzedWorks,
    droppedForNoApplicableFacet: manifest.works.filter(w => !applicableEligibleFacets(w).length).map(w => w.id),
    primaryCorrectMinusSham: mean(pairedList('correct-cue', 'sham')),
    pairedCorrectMinusShamVariance: sampleVariance(pairedList('correct-cue', 'sham')),
    secondaryCorrectMinusNoCue: mean(pairedList('correct-cue', 'no-cue')),
    diagnosticShamMinusNoCue: mean(pairedList('sham', 'no-cue')),
    sensitivityNoArtistCorrectMinusSham: mean(pairedList('correct-cue', 'sham', 'noArtist')),
    maskRates: Object.fromEntries(FACETS.map(f => [f, rate(manifest.works.filter(w => w.cue.disclosedFacets.includes(f)).length, manifest.works.length)])),
    applicableFacetCountByWork: Object.fromEntries(studyB.map(w => [w.id, w.applicableFacets.length])),
    facetContrasts: Object.fromEntries(FACETS.map(facet => {
      const contributing = studyB.filter(w => w.applicableFacets.includes(facet)).map(w => {
        const correct = facetsAt(w.id, 'canonical', 'full', 'correct-cue')?.[facet]?.credit;
        const sham = facetsAt(w.id, 'canonical', 'full', 'sham')?.[facet]?.credit;
        return Number.isFinite(correct) && Number.isFinite(sham) ? { id: w.id, difference: correct - sham } : null;
      }).filter(Boolean);
      return [facet, { n: contributing.length, contributingWorkIds: contributing.map(x => x.id), meanCorrectMinusSham: mean(contributing.map(x => x.difference)) }];
    })),
  };

  // ---- Study A: recognition vectors + ordered-crop transitions (recognition-associated, not causal). ----
  const orderedViews = ['full', 'crop70', 'crop45', 'crop25'];
  const branchViews = ['mirror', 'rotate90', 'grayscale'];
  const studyAWorks = manifest.works.map(w => {
    const recognition = Object.fromEntries([...orderedViews, ...branchViews].map(v => [v, exactAt(w.id, 'canonical', v) ?? null]));
    const observed = orderedViews.map(v => recognition[v]).filter(v => typeof v === 'boolean');
    return {
      id: w.id, recognition,
      orderedCurveArea: observed.length === orderedViews.length ? mean(observed.map(Number)) : null,
      nonMonotonic: orderedViews.some((v, i) => i > 0 && recognition[v] === true && recognition[orderedViews[i - 1]] === false),
      lastOrderedViewExact: recognition.crop25,
    };
  });
  const transitions = [];
  for (let i = 0; i < orderedViews.length - 1; i++) {
    const from = orderedViews[i], to = orderedViews[i + 1];
    for (const facet of FACETS) {
      const switchers = [], controls = [];
      for (const w of manifest.works) {
        const aE = exactAt(w.id, 'canonical', from), bE = exactAt(w.id, 'canonical', to);
        const a = facetsAt(w.id, 'canonical', from)?.[facet]?.credit, b = facetsAt(w.id, 'canonical', to)?.[facet]?.credit;
        if (typeof aE !== 'boolean' || typeof bE !== 'boolean' || !Number.isFinite(a) || !Number.isFinite(b)) continue;
        if (aE && !bE) switchers.push(b - a); else if (!aE && !bE) controls.push(b - a);
      }
      transitions.push({ from, to, facet, switchersN: switchers.length, controlsN: controls.length, switcherMeanChange: mean(switchers), controlMeanChange: mean(controls), recognitionAssociatedExcessChange: switchers.length && controls.length ? mean(switchers) - mean(controls) : null });
    }
  }
  const usableTransitionRate = rate(transitions.reduce((n, t) => n + t.switchersN, 0), transitions.reduce((n, t) => n + t.switchersN + t.controlsN, 0));
  const aSummary = {
    workVectors: studyAWorks,
    meanOrderedCurveArea: mean(studyAWorks.map(w => w.orderedCurveArea).filter(Number.isFinite)),
    nonMonotonicWorks: studyAWorks.filter(w => w.nonMonotonic).map(w => w.id),
    rightCensoredAtCrop25: studyAWorks.filter(w => w.lastOrderedViewExact === true).map(w => w.id),
    branchExactRates: Object.fromEntries(branchViews.map(v => [v, mean(studyAWorks.map(w => w.recognition[v]).filter(x => typeof x === 'boolean').map(Number))])),
    usableTransitionRate,
    transitionDiagnostics: transitions,
  };

  // ---- Prompt-order (total-effect protocol), applicable mask. ----
  const promptOrder = manifest.works.filter(w => w.promptOrder).map(w => {
    const c = findCall({ workId: w.id, task: 'identity-first', condition: 'identity-first' });
    const r = c ? resultForCallId(c.callId) : null;
    const idFacets = r ? gradeFacetsFor(w, r.facets, c, true) : null;
    const noCue = facetsAt(w.id, 'canonical', 'full');
    const applicable = applicableEligibleFacets(w).filter(f => Number.isFinite(idFacets?.[f]?.credit) && Number.isFinite(noCue?.[f]?.credit));
    return { id: w.id, identityFirstExact: r ? identExact(c, r.identification, w.recognitionKey) : null, applicableFacets: applicable, identityFirstMinusFacetsOnly: applicable.length ? mean(applicable.map(f => idFacets[f].credit - noCue[f].credit)) : null };
  });

  // ---- Study C: same-physical-object canonical vs alternate stability. ----
  const studyC = manifest.works.filter(w => w.studyC).map(w => {
    const canonical = exactAt(w.id, 'canonical', 'full'), alternate = exactAt(w.id, 'alternate', 'full');
    return { id: w.id, canonicalExact: canonical ?? null, alternateExact: alternate ?? null, sourceViewChange: typeof canonical === 'boolean' && typeof alternate === 'boolean' ? Number(alternate) - Number(canonical) : null };
  });

  // ---- Reliability: repeated identification, repeated FACET cells, repeated identity-first cells. ----
  const baseKey = c => canonicalJson({ workId: c.workId, source: c.source, view: c.view, task: c.task, condition: c.condition });
  const baseByKey = new Map(calls.calls.filter(c => c.replicate === 0).map(c => [baseKey(c), c]));
  const repeats = calls.calls.filter(c => c.replicate === 1);
  const idReps = repeats.filter(c => c.task === 'identify');
  const facetReps = repeats.filter(c => c.task === 'facets');
  const idFirstReps = repeats.filter(c => c.task === 'identity-first');
  const idPairs = idReps.map(rep => { const base = baseByKey.get(baseKey(rep)); if (!base) return null; const w = works.get(rep.workId); const exactA = identExact(base, resultForCallId(base.callId), w.recognitionKey), exactB = identExact(rep, resultForCallId(rep.callId), w.recognitionKey); return typeof exactA === 'boolean' && typeof exactB === 'boolean' ? { id: rep.workId, exactA, exactB } : null; }).filter(Boolean);
  const facetCreditDiffs = [];
  const facetPairsConsumed = [];
  for (const rep of facetReps) {
    const base = baseByKey.get(baseKey(rep)); if (!base) continue;
    const w = works.get(rep.workId), a = gradeFacetsFor(w, resultForCallId(base.callId)), b = gradeFacetsFor(w, resultForCallId(rep.callId));
    if (!a || !b) continue;
    facetPairsConsumed.push(rep.callId);
    for (const f of applicableEligibleFacets(w)) if (Number.isFinite(a[f]?.credit) && Number.isFinite(b[f]?.credit)) facetCreditDiffs.push(a[f].credit - b[f].credit);
  }
  const idFirstPairs = idFirstReps.map(rep => { const base = baseByKey.get(baseKey(rep)); if (!base) return null; const w = works.get(rep.workId); const ra = resultForCallId(base.callId), rb = resultForCallId(rep.callId); const exactA = identExact(base, ra && ra.identification, w.recognitionKey), exactB = identExact(rep, rb && rb.identification, w.recognitionKey); return typeof exactA === 'boolean' && typeof exactB === 'boolean' ? { id: rep.workId, exactA, exactB } : null; }).filter(Boolean);
  const reliability = {
    repeatedIdentificationCells: idReps.length,
    repeatedIdentificationPairs: idPairs.length,
    exactAgreement: idPairs.length ? rate(idPairs.filter(x => x.exactA === x.exactB).length, idPairs.length) : null,
    belowFrozenThreshold: idPairs.length ? idPairs.filter(x => x.exactA === x.exactB).length / idPairs.length < 0.85 : null,
    repeatedFacetCells: facetReps.length,
    repeatedFacetPairsConsumed: facetPairsConsumed.length,
    facetCreditReliabilityVariance: sampleVariance(facetCreditDiffs),
    facetCreditReliabilityMeanAbsDiff: mean(facetCreditDiffs.map(Math.abs)),
    repeatedIdentityFirstCells: idFirstReps.length,
    repeatedIdentityFirstPairs: idFirstPairs.length,
    identityFirstExactAgreement: idFirstPairs.length ? rate(idFirstPairs.filter(x => x.exactA === x.exactB).length, idFirstPairs.length) : null,
  };

  // ---- Missingness by call/work/task/arm/view/fame/region. ----
  const present = c => resultForCallId(c.callId) != null;
  const byGroup = keyFn => { const g = {}; for (const c of calls.calls) { const key = keyFn(c); (g[key] ||= { planned: 0, present: 0 }); g[key].planned++; if (present(c)) g[key].present++; } return Object.fromEntries(Object.entries(g).map(([key, v]) => [key, { ...v, missingRate: rate(v.planned - v.present, v.planned) }])); };
  const perWork = {}; for (const c of calls.calls) { (perWork[c.workId] ||= { planned: 0, present: 0 }); perWork[c.workId].planned++; if (present(c)) perWork[c.workId].present++; }
  const missingness = {
    perCall: { planned: calls.calls.length, present: calls.calls.filter(present).length, missingRate: rate(calls.calls.filter(c => !present(c)).length, calls.calls.length) },
    perWork: Object.fromEntries(Object.entries(perWork).map(([id, v]) => [id, { ...v, missingRate: rate(v.planned - v.present, v.planned) }])),
    byTask: byGroup(c => c.task), byArm: byGroup(c => c.condition), byView: byGroup(c => c.view),
    byFameBand: byGroup(c => works.get(c.workId)?.strata.fameBand), byRegion: byGroup(c => works.get(c.workId)?.strata.regionGroup),
  };

  // ---- Eligible/applicable attrition by fame, cue type, and facet. ----
  const attrition = {
    byWork: Object.fromEntries(manifest.works.map(w => [w.id, { eligible: w.cue.eligibleFacets.length, applicable: applicableEligibleFacets(w).length, disclosed: w.cue.disclosedFacets.length }])),
    byFameBand: Object.fromEntries([...new Set(manifest.works.map(w => w.strata.fameBand))].sort().map(band => { const ws = manifest.works.filter(w => w.strata.fameBand === band); return [band, { meanEligible: mean(ws.map(w => w.cue.eligibleFacets.length)), meanApplicable: mean(ws.map(w => applicableEligibleFacets(w).length)) }]; })),
    byCueType: Object.fromEntries([...new Set(manifest.works.map(w => w.cue.cueType))].sort().map(ct => { const ws = manifest.works.filter(w => w.cue.cueType === ct); return [ct, { meanApplicable: mean(ws.map(w => applicableEligibleFacets(w).length)) }]; })),
    byFacet: Object.fromEntries(FACETS.map(f => [f, { eligibleWorks: manifest.works.filter(w => w.cue.eligibleFacets.includes(f)).length, applicableWorks: manifest.works.filter(w => applicableEligibleFacets(w).includes(f)).length }])),
  };

  // ---- Blinded adjudication queue (identification + facet), reported separately from missingness. ----
  const requiredCells = [...adjRequired.values()].sort((a, b) => a.cellId.localeCompare(b.cellId));
  const adjudication = {
    requiredCount: requiredCells.length,
    identificationRequired: requiredCells.filter(c => c.kind === 'identification').length,
    facetRequired: requiredCells.filter(c => c.kind === 'facet').length,
    resolvedCount: adjResolved.size,
    pending: requiredCells.length > 0,
    requiredCells,
  };

  return {
    version: 'recognition-pilot-analysis/3',
    warning: 'EXCLUDED PILOT: observed treatment effects must not determine main-study n or hypotheses.',
    completion: { plannedCalls: calls.calls.length, validResults: calls.calls.filter(present).length },
    studyB: bSummary, studyA: aSummary,
    promptOrder: { n: promptOrder.length, meanIdentityFirstMinusFacetsOnly: mean(promptOrder.map(x => x.identityFirstMinusFacetsOnly).filter(Number.isFinite)), works: promptOrder },
    studyC: { n: studyC.length, meanAlternateMinusCanonicalExact: mean(studyC.map(x => x.sourceViewChange).filter(Number.isFinite)), works: studyC },
    reliability, missingness, attrition, adjudication,
    nuisanceAllowedForMainPlanning: ['paired within-work variance', 'reliability/variance', 'missingness', 'usable-transition rate', 'mask/applicable attrition', 'annotation reliability', 'measured cost'],
    forbiddenForMainPower: ['observed pilot treatment-effect magnitude', 'observed effect direction', 'pilot p-value', 'which facet appeared strongest'],
  };
}
