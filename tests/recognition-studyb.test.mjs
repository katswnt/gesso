// Offline regressions for the corrected Study-B mini-pilot (prompt-level JSON). No network/model call.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalJson, sha256, validateFacets } from '../scripts/lib/recognition-pilot.mjs';
import {
  STUDYB_REQUEST_POLICY, STUDYB_ARMS, renderPromptSchema, buildStudyBPrompt, buildStudyBCallManifest,
  buildStudyBRequestBody, analyzeValidity, computeStudyBEffects, maxSerializedValidFacetResponse,
} from '../scripts/lib/recognition-studyb.mjs';

const FROZEN = 'docs/research/recognition-pilot';
const OUT = 'docs/research/recognition-studyb';
let pass = 0; const t = (n, fn) => { try { fn(); pass++; console.log('ok -', n); } catch (e) { console.error('FAIL -', n, '\n   ', e.message); process.exitCode = 1; } };

const researchSchema = JSON.parse(readFileSync(join(FROZEN, 'schemas/facets.schema.json'), 'utf8'));
const draft = JSON.parse(readFileSync(join(OUT, 'studyb-manifest.draft.json'), 'utf8'));
const callManifest = JSON.parse(readFileSync(join(OUT, 'studyb-call-manifest.draft.json'), 'utf8'));
const renderedSchema = JSON.parse(readFileSync(join(OUT, 'prompt-schema.facets.draft.json'), 'utf8'));
const promptAssets = { facets: readFileSync(join(FROZEN, 'prompts/facets.md'), 'utf8'), facetsCued: readFileSync(join(FROZEN, 'prompts/facets-cued.md'), 'utf8') };
const worksById = new Map(draft.works.map(w => [w.id, w]));
const runnerSrc = readFileSync('scripts/recognition-studyb-run.mjs', 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

// --- schema render (prompt-level) ---
t('rendered schema strips ONLY root $schema/$id/title/type; keeps nested', () => {
  for (const k of ['$schema', '$id', 'title', 'type']) assert(!(k in renderedSchema), `root ${k} present`);
  assert('properties' in renderedSchema && 'required' in renderedSchema && renderedSchema.additionalProperties === false, 'structure lost');
  assert('$defs' in renderedSchema, 'nested $defs dropped');
  const s = JSON.stringify(renderedSchema);
  assert(/maxLength/.test(s) && /minimum/.test(s), 'nested constraints must be retained in the render');
});
t('renderPromptSchema does not mutate its input', () => {
  const before = canonicalJson(researchSchema); renderPromptSchema(researchSchema); assert.equal(canonicalJson(researchSchema), before);
});
t('promptSchemaSha256 bound and matches artifact', () => {
  assert.equal(draft.reuseBindings.promptSchemaSha256, sha256(canonicalJson(renderedSchema)));
  assert.notEqual(draft.reuseBindings.promptSchemaSha256, draft.reuseBindings.researchSchemaSha256);
});
t('research schema retains all original constraints (unmutated on disk)', () => {
  const keys = new Set(); (function w(o) { if (Array.isArray(o)) o.forEach(w); else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { keys.add(k); w(v); } })(researchSchema);
  for (const k of ['maxLength', 'minimum', 'maximum', 'maxItems']) assert(keys.has(k), `lost ${k}`);
});

// --- prompt (leak fix) ---
t('prompt states top-level keys and forbids title/type; contains no root schema metadata', () => {
  const w = draft.works[0];
  for (const arm of STUDYB_ARMS) {
    const p = buildStudyBPrompt(w, arm, promptAssets, renderedSchema);
    assert(/only top-level keys are exactly: date, place, medium, style, artist/i.test(p), 'missing top-level-key instruction');
    assert(/never "title", "type"/.test(p), 'missing title/type prohibition');
    assert(/one short, pixel-grounded sentence/i.test(p), 'missing visualBasis instruction');
    assert(p.includes(JSON.stringify(renderedSchema)), 'clean rendered schema not embedded');
    // the ONLY occurrences of $schema/$id are inside the instruction that forbids echoing them
    assert(!('$schema' in renderedSchema) && !('$id' in renderedSchema), 'rendered schema still has root metadata');
  }
});
t('correct/sham/no-cue differ only by intended cue', () => {
  const w = worksById.get(callManifest.calls.find(c => c.condition === 'sham').workId);
  const noCue = buildStudyBPrompt(w, 'no-cue', promptAssets, renderedSchema);
  const correct = buildStudyBPrompt(w, 'correct-cue', promptAssets, renderedSchema);
  const sham = buildStudyBPrompt(w, 'sham', promptAssets, renderedSchema);
  assert(correct.includes(w.cue.correct) && sham.includes(w.cue.sham));
  assert.equal(correct.replace(w.cue.correct, '{{CUE}}'), sham.replace(w.cue.sham, '{{CUE}}'), 'cued arms differ beyond the cue');
  assert(!correct.includes(w.cue.sham) && !sham.includes(w.cue.correct), 'cross-cue leakage');
  assert.notEqual(noCue, correct);
});

// --- request body (prompt-level: no tools, no output_config) ---
const body = buildStudyBRequestBody({ model: STUDYB_REQUEST_POLICY.model, maxTokens: STUDYB_REQUEST_POLICY.facetsMaxTokens, temperature: 0, promptText: 'x', imageBase64: 'AAAA' });
t('request body has no tools and no output_config (prompt-level)', () => {
  assert(!('tools' in body) && !('tool_choice' in body) && !('output_config' in body));
});
t('request uses Sonnet 4.6, temp 0, cap 1800', () => { assert.equal(body.model, 'claude-sonnet-4-6'); assert.equal(body.temperature, 0); assert.equal(body.max_tokens, 1800); });
t('runner sends no beta header and no tools/output_config', () => {
  assert(!/anthropic-beta/.test(runnerSrc) && !/output_config/.test(runnerSrc));
  assert(!/\btools\b\s*:/.test(runnerSrc) && !/tool_choice/.test(runnerSrc));
  assert(STUDYB_REQUEST_POLICY.outputConfigUsed === false && STUDYB_REQUEST_POLICY.toolsOmitted === true);
});
t('runner enforces model verification and $10 hard stop', () => {
  assert(/model-drift/.test(runnerSrc) && /envelope\.model === STUDYB_REQUEST_POLICY\.model/.test(runnerSrc), 'no model verification');
  assert(/HARD STOP/.test(runnerSrc) && /BUDGET_USD = 10/.test(runnerSrc), 'no budget hard stop');
  assert(/SMOKE GATE/.test(runnerSrc) && /completed >= 6/.test(runnerSrc), 'no smoke gate');
  assert(/intent\.json/.test(runnerSrc) && /existsSync\(resultPath/.test(runnerSrc), 'no intent-before-send / resume');
});

// --- parse contract: fence-tolerant (original method) but truncation-strict ---
import { deterministicJsonParse } from '../scripts/lib/recognition-pilot-runtime.mjs';
t('parser strips ```json fences (non-lossy) but rejects truncated/prose', () => {
  assert.deepEqual(deterministicJsonParse('```json\n{"a":1}\n```').value, { a: 1 });
  assert.equal(deterministicJsonParse('{"a":1}').value.a, 1);
  assert(!deterministicJsonParse('```json\n{"a":').ok, 'truncated must reject');
  assert(!deterministicJsonParse('no json here').ok, 'prose must reject');
  assert(runnerSrc.includes('deterministicJsonParse'), 'runner must use the fence-tolerant parser');
});

// --- strict validation, no tolerance ---
const good = () => ({ date: { bestYear: 1500, confidence: 80, visualBasis: 'x' }, place: { topGuess: 'Italy', alternatives: [], confidence: 70, visualBasis: 'x' }, medium: { guess: 'oil', confidence: 60, visualBasis: 'x' }, style: { guess: 'Renaissance', confidence: 60, visualBasis: 'x' }, artist: { guess: 'anon', confidence: 40, visualBasis: 'x' } });
t('strict validator accepts good response', () => assert(validateFacets(good()).ok));
t('strict validator rejects title/type/extra keys, out-of-range, overlong, oversized array', () => {
  assert(!validateFacets({ ...good(), title: 'x' }).ok);
  assert(!validateFacets({ ...good(), type: 'object' }).ok);
  const a = good(); a.date.confidence = 101; assert(!validateFacets(a).ok);
  const b = good(); b.style.visualBasis = 'x'.repeat(601); assert(!validateFacets(b).ok);
  const c = good(); c.place.alternatives = ['a', 'b', 'c', 'd']; assert(!validateFacets(c).ok);
});

// --- call manifest ---
t('exactly 119 planned calls: 108 base (36×3) + 11 repeats', () => {
  assert.equal(callManifest.calls.length, 119);
  assert.equal(callManifest.counts.base, 108);
  assert.equal(callManifest.counts.repeats, 11);
  const base = callManifest.calls.filter(c => c.replicate === 0);
  const byWork = {}; for (const c of base) (byWork[c.workId] = byWork[c.workId] || new Set()).add(c.condition);
  assert.equal(Object.keys(byWork).length, 36);
  for (const s of Object.values(byWork)) for (const a of STUDYB_ARMS) assert(s.has(a));
});
t('order is seeded and interleaved (condition not fixed to position)', () => {
  const a = buildStudyBCallManifest(draft.works, {}), b = buildStudyBCallManifest(draft.works, {});
  assert.equal(a.sha256, b.sha256, 'not reproducible');
  const seq = [...callManifest.calls].sort((x, y) => x.order - y.order).map(c => c.condition);
  let maxRun = 1, run = 1; for (let i = 1; i < seq.length; i++) { run = seq[i] === seq[i - 1] ? run + 1 : 1; maxRun = Math.max(maxRun, run); }
  assert(maxRun < 8, `condition clustered (max run ${maxRun})`); // interleaved, not blocked by condition
});
t('every call uniquely bound to work/image/prompt; ids unique 24-hex', () => {
  const ids = callManifest.calls.map(c => c.callId); assert.equal(new Set(ids).size, ids.length);
  for (const c of callManifest.calls) { assert(/^[0-9a-f]{24}$/.test(c.callId)); assert(worksById.get(c.workId).image.fullViewSha256); }
});

// --- gates ---
const synth = (opt = {}) => callManifest.calls.map((c, i) => { let o = 'valid'; if (opt.failArm && c.condition === opt.failArm && i % 2 === 0) o = 'schema-invalid'; return { callId: c.callId, condition: c.condition, outcome: o, validationErrors: o === 'valid' ? [] : ['x'], stopReason: 'end_turn' }; });
t('healthy synthetic run passes gates', () => { const d = analyzeValidity(callManifest, synth()); assert(d.gatesPass && d.completeTriplets === 36); });
t('arm-dependent invalidity suppresses primary result', () => { const d = analyzeValidity(callManifest, synth({ failArm: 'sham' })); assert(!d.gatesPass && d.causalHeadlineSuppressed && d.status === 'studyb-instrument-invalid/incomplete'); });

// --- effect math ---
t('computeStudyBEffects computes contrasts, per-facet, leave-artist-out, variance, reliability', () => {
  const facets = ['date', 'place', 'medium', 'style', 'artist'];
  const applicable = { W1: facets, W2: facets };
  const mk = (w, cond, rep, val) => ({ workId: w, condition: cond, replicate: rep, credits: Object.fromEntries(facets.map(f => [f, val])) });
  const cells = [
    mk('W1', 'no-cue', 0, 0.4), mk('W1', 'sham', 0, 0.4), mk('W1', 'correct-cue', 0, 0.9),
    mk('W2', 'no-cue', 0, 0.5), mk('W2', 'sham', 0, 0.5), mk('W2', 'correct-cue', 0, 0.7),
    mk('W1', 'correct-cue', 1, 0.9), // repeat pair for reliability (matches base 0.9)
  ];
  const e = computeStudyBEffects(cells, applicable);
  assert.equal(e.contributingWorks, 2);
  assert(Math.abs(e.correctMinusSham_workWeighted - 0.35) < 1e-9, `cs=${e.correctMinusSham_workWeighted}`);
  assert(Math.abs(e.shamMinusNoCue_workWeighted - 0) < 1e-9);
  assert.equal(e.perFacetEffect.artist.contributingWorks, 2);
  assert(Math.abs(e.leaveArtistOut_correctMinusSham - 0.35) < 1e-9);
  assert(e.pairedVariance_correctMinusSham > 0);
  assert.equal(e.repeatReliability.exactCreditAgreement, 1);
});

// --- token headroom + no frozen mutation ---
t('token headroom: max valid response fits under 1800 cap', () => {
  const h = maxSerializedValidFacetResponse(researchSchema);
  assert(h.valid && h.conservativeTokenEstimate < STUDYB_REQUEST_POLICY.facetsMaxTokens, `est ${h.conservativeTokenEstimate} vs cap ${STUDYB_REQUEST_POLICY.facetsMaxTokens}`);
});
t('original frozen collection artifacts remain byte-unchanged', () => {
  const m = JSON.parse(readFileSync(join(FROZEN, 'pilot-manifest.frozen.json'), 'utf8'));
  for (const [p, expected] of Object.entries(m.freeze.artifactHashes)) assert.equal(sha256(readFileSync(p)), expected, `changed: ${p}`);
});

// ===================== CLOSURE-ROUND REGRESSIONS =====================
import { existsSync, readdirSync } from 'node:fs';
import { applicableEligibleFacets, gradeStyle, styleDedupFromSnapshot } from '../scripts/lib/recognition-pilot.mjs';
import { facetAmbiguous, validateStudyBFacets, studyBFinalizable } from '../scripts/lib/recognition-studyb.mjs';
import { deterministicJsonParse as djp } from '../scripts/lib/recognition-pilot-runtime.mjs';

const fm = JSON.parse(readFileSync(join(FROZEN, 'pilot-manifest.frozen.json'), 'utf8'));
const frozenById = new Map(fm.works.map(w => [w.id, w]));

// F1 — mask correctness, no 17-drift recurrence
t('CLOSURE F1: all 36 applicable masks equal the frozen applicableEligibleFacets', () => {
  let drift = 0;
  for (const w of draft.works) {
    const correct = applicableEligibleFacets(frozenById.get(w.id));
    assert.deepEqual(w.applicableMask, correct, `mask wrong for ${w.id}`);
    if (JSON.stringify(w.applicableMask) !== JSON.stringify(w.cue.eligibleFacets)) drift++;
  }
  assert(drift > 0, 'expected some works where applicable != raw eligible (proves the fix is active)');
});

// F6 — bestYear research bound enforced locally
t('CLOSURE F6: validateStudyBFacets enforces bestYear bounds [-100000,3000]', () => {
  const base = () => ({ date: { bestYear: 1500, confidence: 80, visualBasis: 'x' }, place: { topGuess: 'Italy', alternatives: [], confidence: 70, visualBasis: 'x' }, medium: { guess: 'oil', confidence: 60, visualBasis: 'x' }, style: { guess: 'R', confidence: 60, visualBasis: 'x' }, artist: { guess: 'a', confidence: 40, visualBasis: 'x' } });
  assert(validateStudyBFacets(base()).ok);
  const hi = base(); hi.date.bestYear = 999999; assert(!validateStudyBFacets(hi).ok);
  const lo = base(); lo.date.bestYear = -100001; assert(!validateStudyBFacets(lo).ok);
});

// frozen ambiguity rule behaves as specified
t('CLOSURE: facetAmbiguous flags confident unmatched, not matched or low-confidence', () => {
  const rows0 = { style: { ok: true, credit: 0 } }, rows1 = { style: { ok: true, credit: 1 } };
  assert(facetAmbiguous('style', { style: { guess: 'Some School', confidence: 85 } }, rows0) === true);
  assert(facetAmbiguous('style', { style: { guess: 'Some School', confidence: 85 } }, rows1) === false, 'matched must not adjudicate');
  assert(facetAmbiguous('style', { style: { guess: 'Some School', confidence: 40 } }, rows0) === false, 'low-conf must not adjudicate');
  assert(facetAmbiguous('style', { style: { guess: 'unknown', confidence: 90 } }, rows0) === false, 'unknown guess must not adjudicate');
  assert(facetAmbiguous('date', { date: { bestYear: 1 } }, rows0) === false, 'date is never facet-adjudicated');
});

// finalization gate: zero-adjudication clean run finalizes; unresolved stays pending
t('CLOSURE: a healthy run with ZERO required adjudications can finalize', () => {
  assert.equal(studyBFinalizable({ gatesPass: true, unresolved: 0, rulingErrors: [] }), true, 'zero-ambiguity clean run must finalize');
  assert.equal(studyBFinalizable({ gatesPass: true, unresolved: 5, rulingErrors: [] }), false, 'unresolved rulings must stay pending');
  assert.equal(studyBFinalizable({ gatesPass: false, unresolved: 0, rulingErrors: [] }), false, 'failed validity gates cannot finalize');
  assert.equal(studyBFinalizable({ gatesPass: true, unresolved: 0, rulingErrors: ['x'] }), false, 'ruling errors block finalization');
});

// F3 — evidence anchor integrity + tamper detection (logic-level)
if (existsSync(join(OUT, 'collection-evidence.json'))) {
  const ev = JSON.parse(readFileSync(join(OUT, 'collection-evidence.json'), 'utf8'));
  t('CLOSURE F3: evidence anchor self-hash verifies and detects mutation', () => {
    assert.equal(ev.sha256, sha256(canonicalJson({ ...ev, sha256: undefined })));
    assert.equal(ev.totals.calls, 119);
    const tampered = JSON.parse(JSON.stringify(ev)); tampered.calls[0].responseSha256 = 'deadbeef';
    assert.notEqual(ev.sha256, sha256(canonicalJson({ ...tampered, sha256: undefined })), 'mutation must change the hash');
  });
}

// all 119 collected responses satisfy the bestYear bound (so F6 changes no collected outcome)
if (existsSync(join('data/incoming/recognition-studyb', draft.protocolId, 'attempts'))) {
  t('CLOSURE: every valid collected response satisfies the research bestYear bound', () => {
    const A = join('data/incoming/recognition-studyb', draft.protocolId, 'attempts');
    let checked = 0;
    for (const cid of readdirSync(A)) {
      const p = join(A, cid, 'attempt-1.result.json'); if (!existsSync(p)) continue;
      const r = JSON.parse(readFileSync(p, 'utf8')); if (r.outcome !== 'valid') continue;
      const env = JSON.parse(r.rawResponse); const txt = (env.content || []).map(c => c.type === 'text' ? c.text : '').join('');
      const pj = djp(txt); if (!pj.ok) continue;
      assert(validateStudyBFacets(pj.value).ok, `collected response ${cid} violates a research constraint`);
      checked++;
    }
    assert(checked > 100, `expected ~117 valid, checked ${checked}`);
  });
}

// F2/F4 — blinded packet + refuse-final
if (existsSync(join(OUT, 'blinded-review-packet.json'))) {
  t('CLOSURE F2: blinded packet leaks no condition/work/call identity; controller binds SHA', () => {
    const pkt = JSON.parse(readFileSync(join(OUT, 'blinded-review-packet.json'), 'utf8'));
    for (const cell of pkt.cells) {
      const keys = Object.keys(cell);
      assert(!keys.some(k => /condition|arm|workId|callId|view|fame|region|image/.test(k)), 'packet leaks identity');
      assert('adjudicationId' in cell && 'response' in cell && 'groundTruth' in cell && 'responseSha256' in cell);
    }
    const ctrl = JSON.parse(readFileSync(join(OUT, 'adjudication-controller.private.json'), 'utf8'));
    assert(ctrl.cells.every(c => c.callId && c.facet && /^[0-9a-f]{64}$/.test(c.responseSha256)));
  });
  t('CLOSURE F2: analyzer gates final on adjudication (pending without rulings, final only when all resolved)', () => {
    const rep = JSON.parse(readFileSync(join(OUT, 'studyb-report.json'), 'utf8'));
    assert(rep.adjudication.required >= 80, 'expected ~82 required adjudications');
    if (existsSync(join(OUT, 'adjudications.json'))) {
      // rulings present -> final ONLY if every required cell resolved with no ruling errors
      assert.equal(rep.causalReportable, rep.adjudication.unresolved === 0 && rep.adjudication.rulingErrors.length === 0);
      if (rep.causalReportable) { assert.equal(rep.status, 'studyb-final'); assert(rep.effects && typeof rep.effects.correctMinusSham_workWeighted === 'number'); }
    } else {
      // no rulings -> must refuse to finalize
      assert.equal(rep.causalReportable, false);
      assert.equal(rep.effects, null);
      assert.equal(rep.status, 'studyb-pending-adjudication');
      assert.equal(rep.adjudication.unresolved, rep.adjudication.required);
    }
  });
}

console.log(`\n${pass} checks passed`);
