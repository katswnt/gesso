// Corrected Study-B-only recognition mini-pilot — PURE CONTRACT (unit-testable; no I/O, no network).
//
// NEW independent protocol; NOT a retry/continuation of gesso-recognition-pilot-2026-08-31-v1. Reuses
// ONLY logically-identical frozen inputs (36-work sample, canonical full-view image hashes, cue/sham
// strings, applicable-facet masks, truth, grader, style taxonomy) by binding them; never regenerates.
//
// Instrument (per owner spec): PROMPT-LEVEL JSON (no output_config, no tools). The frozen pilot's
// dominant failure was the model echoing the rendered schema's ROOT title/type; fixed here by removing
// root $schema/$id/title/type from the model-facing schema render and stating the only top-level keys
// explicitly. Strict local validation (validateFacets); NO key tolerance; NO repair of malformed/
// truncated responses. Cap raised to 1800.
import { canonicalJson, sha256, validateFacets } from './recognition-pilot.mjs';

// Exact copies of the frozen helpers so the Study-B ambiguity rule is byte-faithful to the frozen one.
const shortText = (v, max = 600) => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v);

// Frozen facet-ambiguity rule (recognition-pilot.mjs facetAmbiguous): a substantive, confidence>=60,
// deterministically-unmatched place/medium/style/artist answer must go to blinded adjudication (null),
// NOT be auto-scored zero. `rows` are the deterministic grade results per facet.
export function facetAmbiguous(facet, parsed, rows) {
  if (facet === 'date' || rows[facet]?.ok === false || rows[facet]?.notApplicable || rows[facet]?.credit !== 0) return false;
  const guess = facet === 'place' ? parsed.place?.topGuess : parsed[facet]?.guess;
  const conf = parsed[facet]?.confidence;
  return shortText(guess || '', 300) && !/^(unknown|unsure|none|n\/a)$/i.test(String(guess).trim()) && Number.isInteger(conf) && conf >= 60;
}

// Study-B strict validation = frozen validateFacets PLUS the research-schema numeric bounds the frozen
// hand-validator does not check (bestYear −100000..3000). Enforces removed wire-schema constraints locally.
// Finalization gate: a run finalizes when validity gates pass, no required ruling is unresolved, and no
// ruling error stands. A clean run with ZERO ambiguous facets (nothing to adjudicate) finalizes; a run
// with any unresolved required ruling stays pending.
export function studyBFinalizable({ gatesPass, unresolved, rulingErrors }) {
  return !!gatesPass && unresolved === 0 && (rulingErrors?.length || 0) === 0;
}

export function validateStudyBFacets(parsed) {
  const base = validateFacets(parsed);
  const errors = [...base.errors];
  const y = parsed?.date?.bestYear;
  if (!(Number.isInteger(y) && y >= -100000 && y <= 3000)) errors.push('date.bestYear out of research bounds [-100000,3000]');
  return { ok: errors.length === 0, errors };
}

export const STUDYB_PROTOCOL_ID = 'gesso-recognition-studyb-2026-09-01-v1';
export const STUDYB_CALL_SEED = 'gesso-recognition-studyb-calls-2026-09-01-v1';
export const STUDYB_ARMS = Object.freeze(['no-cue', 'sham', 'correct-cue']);
export const STUDYB_FACETS = Object.freeze(['date', 'place', 'medium', 'style', 'artist']);
export const STUDYB_REPEAT_FRACTION = 0.10;

export const STUDYB_REQUEST_POLICY = Object.freeze({
  version: 'recognition-studyb-request/2-prompt-level',
  method: 'prompt-level-json',
  model: 'claude-sonnet-4-6',
  anthropicVersion: '2023-06-01',
  betaHeader: null,
  temperature: 0,
  facetsMaxTokens: 1800,
  requestTimeoutMs: 180000,
  conservativeInputOverheadTokens: 256,
  toolsOmitted: true,
  outputConfigUsed: false,
  pricing: Object.freeze({ inputPerMillionUsd: 3, outputPerMillionUsd: 15, verifiedAt: '2026-08-31', source: 'https://platform.claude.com/docs/en/models/sonnet-4-6/overview' }),
});

// ---- Model-facing schema render: strip ONLY root metadata; keep nested defs/types/constraints. ----
const ROOT_METADATA = ['$schema', '$id', 'title', 'type'];
export function renderPromptSchema(researchSchema) {
  const clone = JSON.parse(JSON.stringify(researchSchema));
  for (const k of ROOT_METADATA) delete clone[k];
  return clone;
}

// ---- Prompt: reuse frozen prompt text; substitute cue; append the FIXED schema block. ----
export function buildStudyBPrompt(work, arm, promptAssets, renderedSchema) {
  if (!STUDYB_ARMS.includes(arm)) throw new Error(`unknown arm: ${arm}`);
  for (const k of ROOT_METADATA) if (k in renderedSchema) throw new Error(`rendered schema still has root ${k}`);
  let prompt = String(arm === 'no-cue' ? (promptAssets?.facets || '') : (promptAssets?.facetsCued || ''));
  if (!prompt) throw new Error('missing prompt asset');
  if (arm === 'correct-cue') prompt = prompt.replace('{{CUE}}', String(work?.cue?.correct || ''));
  else if (arm === 'sham') prompt = prompt.replace('{{CUE}}', String(work?.cue?.sham || ''));
  if (prompt.includes('{{CUE}}')) throw new Error(`unresolved cue: ${work?.id}/${arm}`);
  const block = `\n\nOUTPUT — JSON only, no Markdown. Return a single JSON object whose ONLY top-level keys are exactly: date, place, medium, style, artist. Do NOT include any other top-level key — never "title", "type", "$schema", or any schema-metadata key. Each visualBasis must be ONE short, pixel-grounded sentence.\n\nFIELD DEFINITIONS (JSON Schema for those five fields; describe your answer, do not echo this schema):\n${JSON.stringify(renderedSchema)}`;
  const text = prompt + block;
  if (/https?:\/\//i.test(prompt)) throw new Error('base prompt contains a URL');
  return text;
}

// ---- Exact request body (pure). PROMPT-LEVEL: no output_config, no tools. ----
export function buildStudyBRequestBody({ model, maxTokens, temperature, promptText, imageBase64 }) {
  return {
    model,
    max_tokens: maxTokens,
    temperature,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
        { type: 'text', text: promptText },
      ],
    }],
    // no `tools`, no `output_config`: JSON is requested at the prompt level and validated strictly after.
  };
}

// ---- Deterministic call ids + seeded, interleaved call manifest ----
function det24(...parts) { return sha256(parts.join(' ')).slice(0, 24); }

export function buildStudyBCallManifest(works, { protocolId = STUDYB_PROTOCOL_ID, seed = STUDYB_CALL_SEED, repeatFraction = STUDYB_REPEAT_FRACTION } = {}) {
  const ids = works.map(w => w.id);
  if (new Set(ids).size !== ids.length) throw new Error('duplicate work ids');
  const sorted = [...works].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const base = [];
  for (const w of sorted) for (const arm of STUDYB_ARMS) {
    base.push({ callId: det24(protocolId, w.id, arm, '0'), workId: w.id, source: 'canonical', view: 'full', task: 'facets', condition: arm, replicate: 0, repeatKind: null });
  }
  const N = Math.round(base.length * repeatFraction);
  const repeats = base.map(c => ({ c, r: sha256(`${seed} repeat ${c.callId}`) })).sort((a, b) => (a.r < b.r ? -1 : 1)).slice(0, N)
    .map(({ c }) => ({ callId: det24(protocolId, c.workId, c.condition, '1'), workId: c.workId, source: 'canonical', view: 'full', task: 'facets', condition: c.condition, replicate: 1, repeatKind: 'studyb-reliability' }));
  // Seeded interleave so condition is not fixed to temporal position.
  const shuffled = [...base, ...repeats].map(c => ({ c, r: sha256(`${seed} order ${c.callId}`) })).sort((a, b) => (a.r < b.r ? -1 : 1)).map(({ c }, i) => ({ ...c, order: i }));
  const counts = { works: works.length, base: base.length, repeats: repeats.length, total: shuffled.length, byArm: Object.fromEntries(STUDYB_ARMS.map(a => [a, shuffled.filter(c => c.condition === a && c.replicate === 0).length])) };
  const manifest = { version: 'recognition-studyb-call-manifest/2', protocolId, seed, repeatFraction, counts, calls: shuffled };
  manifest.sha256 = sha256(canonicalJson({ ...manifest, sha256: undefined }));
  return manifest;
}

// ---- Interpretability diagnostics + approved gates (validity/triplets) ----
export const STUDYB_GATES = Object.freeze({ minArmValidRate: 0.90, minCompleteTriplets: 30, totalWorks: 36 });

// results: [{callId, condition, outcome, validationErrors, stopReason}]. outcome ∈
// 'valid'|'schema-invalid'|'refusal'|'max-tokens'|'malformed-envelope'|'local-constraint'|'transport-exhausted'
export function analyzeValidity(callManifest, results) {
  const byId = new Map(results.map(r => [r.callId, r]));
  const armStats = Object.fromEntries(STUDYB_ARMS.map(a => [a, { planned: 0, valid: 0, invalid: 0, errorsByCat: {}, stopReasons: {} }]));
  let refusals = 0, localConstraintFailures = 0;
  for (const c of callManifest.calls) {
    if (c.replicate !== 0) continue;
    const s = armStats[c.condition]; if (!s) continue;
    s.planned++;
    const r = byId.get(c.callId), outcome = r?.outcome;
    if (outcome === 'valid') s.valid++; else s.invalid++;
    if (outcome === 'refusal') refusals++;
    if (outcome === 'local-constraint') localConstraintFailures++;
    for (const e of (r?.validationErrors || [])) s.errorsByCat[e] = (s.errorsByCat[e] || 0) + 1;
    const stop = r?.stopReason || outcome || '(no-result)';
    s.stopReasons[stop] = (s.stopReasons[stop] || 0) + 1;
  }
  const primaryValid = {};
  for (const c of callManifest.calls) {
    if (c.replicate !== 0) continue;
    (primaryValid[c.workId] = primaryValid[c.workId] || {})[c.condition] = byId.get(c.callId)?.outcome === 'valid';
  }
  const dropped = []; let completeTriplets = 0;
  for (const [w, arm] of Object.entries(primaryValid)) {
    if (STUDYB_ARMS.every(a => arm[a])) completeTriplets++;
    else dropped.push({ workId: w, missingArms: STUDYB_ARMS.filter(a => !arm[a]) });
  }
  const armValidRates = Object.fromEntries(STUDYB_ARMS.map(a => [a, armStats[a].planned ? armStats[a].valid / armStats[a].planned : 0]));
  const worstArmRate = Math.min(...STUDYB_ARMS.map(a => armValidRates[a]));
  const gatesPass = worstArmRate >= STUDYB_GATES.minArmValidRate && completeTriplets >= STUDYB_GATES.minCompleteTriplets;
  return { armStats, armValidRates, worstArmRate, completeTriplets, totalWorks: STUDYB_GATES.totalWorks, droppedWorks: dropped, refusals, localConstraintFailures, gates: STUDYB_GATES, gatesPass, causalHeadlineSuppressed: !gatesPass, status: gatesPass ? 'studyb-interpretable' : 'studyb-instrument-invalid/incomplete' };
}

// ---- Graded causal effects (pure). gradedCells: [{workId, condition, replicate, credits:{facet:number}}] ----
// applicableByWork: {workId:[facets]} (ONE identical mask across arms). Only complete valid triplets contribute.
const mean = a => (a.length ? a.reduce((n, x) => n + x, 0) / a.length : null);
const variance = a => { if (a.length < 2) return null; const m = mean(a); return a.reduce((n, x) => n + (x - m) ** 2, 0) / (a.length - 1); };

export function computeStudyBEffects(gradedCells, applicableByWork) {
  const key = (w, cond, rep) => `${w}|${cond}|${rep}`;
  const by = new Map(gradedCells.map(c => [key(c.workId, c.condition, c.replicate), c]));
  const workMean = (w, cond, facets) => {
    const cell = by.get(key(w, cond, 0)); if (!cell) return null;
    const vals = facets.map(f => cell.credits[f]).filter(v => typeof v === 'number');
    return vals.length ? mean(vals) : null;
  };
  const contributing = Object.keys(applicableByWork).filter(w => STUDYB_ARMS.every(a => by.has(key(w, a, 0))));
  const perWorkDiff = (a, b, facetFilter = f => true) => contributing.map(w => {
    const facets = applicableByWork[w].filter(facetFilter);
    const ma = workMean(w, a, facets), mb = workMean(w, b, facets);
    return (ma == null || mb == null) ? null : ma - mb;
  }).filter(v => v != null);
  const cs = perWorkDiff('correct-cue', 'sham');
  const cn = perWorkDiff('correct-cue', 'no-cue');
  const sn = perWorkDiff('sham', 'no-cue');
  const leaveArtistOut = perWorkDiff('correct-cue', 'sham', f => f !== 'artist');
  const perFacet = {};
  for (const f of STUDYB_FACETS) {
    const works = contributing.filter(w => applicableByWork[w].includes(f));
    const diffs = works.map(w => {
      const c = by.get(key(w, 'correct-cue', 0)).credits[f], s = by.get(key(w, 'sham', 0)).credits[f];
      return (typeof c === 'number' && typeof s === 'number') ? c - s : null;
    }).filter(v => v != null);
    perFacet[f] = { contributingWorks: diffs.length, meanCorrectMinusSham: mean(diffs) };
  }
  // Repeat reliability on graded credit: base(rep0) vs repeat(rep1) same work+condition.
  const relDiffs = [], relExact = [];
  for (const c of gradedCells.filter(x => x.replicate === 1)) {
    const base = by.get(key(c.workId, c.condition, 0)); if (!base) continue;
    for (const f of (applicableByWork[c.workId] || STUDYB_FACETS)) {
      const a = base.credits[f], b = c.credits[f];
      if (typeof a === 'number' && typeof b === 'number') { relDiffs.push(Math.abs(a - b)); relExact.push(a === b ? 1 : 0); }
    }
  }
  return {
    contributingWorks: contributing.length,
    correctMinusSham_workWeighted: mean(cs),
    correctMinusNoCue_workWeighted: mean(cn),
    shamMinusNoCue_workWeighted: mean(sn),
    pairedVariance_correctMinusSham: variance(cs),
    leaveArtistOut_correctMinusSham: mean(leaveArtistOut),
    perFacetEffect: perFacet,
    repeatReliability: { pairsFacetLevel: relDiffs.length, meanAbsCreditDiff: mean(relDiffs), exactCreditAgreement: mean(relExact) },
  };
}

// ---- Offline token-headroom fixture (research-schema maximal valid response) ----
export function maxSerializedValidFacetResponse(researchSchema) {
  const defs = researchSchema.$defs || {};
  const maxBasis = defs.basis?.maxLength ?? 600, maxGuess = defs.guess?.properties?.guess?.maxLength ?? 300;
  const maxTop = researchSchema.properties?.place?.properties?.topGuess?.maxLength ?? 300;
  const altN = researchSchema.properties?.place?.properties?.alternatives?.maxItems ?? 3;
  const altMax = researchSchema.properties?.place?.properties?.alternatives?.items?.maxLength ?? 300;
  const S = n => 'x'.repeat(n);
  const ordered = {
    date: { bestYear: -100000, confidence: 100, visualBasis: S(maxBasis) },
    place: { topGuess: S(maxTop), alternatives: Array.from({ length: altN }, () => S(altMax)), confidence: 100, visualBasis: S(maxBasis) },
    medium: { guess: S(maxGuess), confidence: 100, visualBasis: S(maxBasis) },
    style: { guess: S(maxGuess), confidence: 100, visualBasis: S(maxBasis) },
    artist: { guess: S(maxGuess), confidence: 100, visualBasis: S(maxBasis) },
  };
  const serialized = JSON.stringify(ordered);
  const CHARS_PER_TOKEN = 3.5; // conservative estimate, NOT an exact token count
  const v = validateFacets(ordered);
  return { serialized, chars: serialized.length, conservativeTokenEstimate: Math.ceil(serialized.length / CHARS_PER_TOKEN), valid: v.ok, validationErrors: v.errors };
}
