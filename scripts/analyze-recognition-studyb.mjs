// Corrected Study-B analyzer (frozen-faithful). Verifies the after-collection evidence anchor, grades
// with the FROZEN applicable mask, routes confident-unmatched facet answers to blinded adjudication
// exactly as the frozen protocol requires (not auto-zero), and REFUSES to emit a final causal result
// until every required ruling is returned, valid, and SHA-bound. No network; no mutation of raw responses.
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  gradeDate, gradePlace, gradeMedium, gradeStyle, gradeArtist, styleDedupFromSnapshot,
  buildAdjudicationArtifacts, adjudicationCellId, validateAdjudicationArtifact, canonicalJson, sha256,
} from './lib/recognition-pilot.mjs';
import { deterministicJsonParse } from './lib/recognition-pilot-runtime.mjs';
import { analyzeValidity, computeStudyBEffects, facetAmbiguous, studyBFinalizable, STUDYB_FACETS } from './lib/recognition-studyb.mjs';

const OUT = 'docs/research/recognition-studyb';
const FROZEN = 'docs/research/recognition-pilot';
const draft = JSON.parse(readFileSync(join(OUT, 'studyb-manifest.draft.json'), 'utf8'));
const callManifest = JSON.parse(readFileSync(join(OUT, 'studyb-call-manifest.draft.json'), 'utf8'));
const frozenManifest = JSON.parse(readFileSync(join(FROZEN, 'pilot-manifest.frozen.json'), 'utf8'));
const frozenWorks = new Map(frozenManifest.works.map(w => [w.id, w]));
const styleDedup = styleDedupFromSnapshot(JSON.parse(readFileSync(join(FROZEN, 'style-taxonomy.frozen.json'), 'utf8')));
const draftWorkById = new Map(draft.works.map(w => [w.id, w]));
const callById = new Map(callManifest.calls.map(c => [c.callId, c]));
const runDir = join('data/incoming/recognition-studyb', draft.protocolId, 'attempts');

// ---- Verify the after-collection evidence anchor BEFORE consuming the collection ----
const evPath = join(OUT, 'collection-evidence.json');
if (!existsSync(evPath)) { console.error('REFUSED: run scripts/recognition-studyb-evidence.mjs first (no collection anchor).'); process.exit(2); }
const evidence = JSON.parse(readFileSync(evPath, 'utf8'));
if (evidence.sha256 !== sha256(canonicalJson({ ...evidence, sha256: undefined }))) { console.error('REFUSED: collection-evidence hash mismatch.'); process.exit(2); }
if (evidence.callManifestSha256 !== callManifest.sha256 || evidence.promptSchemaSha256 !== draft.reuseBindings.promptSchemaSha256 || evidence.researchSchemaSha256 !== draft.reuseBindings.researchSchemaSha256) { console.error('REFUSED: evidence bindings do not match current artifacts.'); process.exit(2); }
const evByCall = new Map(evidence.calls.map(c => [c.callId, c]));

// ---- Load verified results (raw-byte SHA re-checked against the anchor) ----
const results = [];
for (const cid of readdirSync(runDir)) {
  const p = join(runDir, cid, 'attempt-1.result.json'); if (!existsSync(p)) continue;
  const r = JSON.parse(readFileSync(p, 'utf8'));
  const ev = evByCall.get(r.callId);
  if (!ev) { console.error(`REFUSED: result ${r.callId} not in evidence anchor.`); process.exit(2); }
  if (r.rawResponse != null && sha256(r.rawResponse) !== ev.responseSha256) { console.error(`REFUSED: raw bytes for ${r.callId} differ from anchor.`); process.exit(2); }
  results.push(r);
}
const validity = analyzeValidity(callManifest, results.map(r => ({ callId: r.callId, condition: r.condition, outcome: r.outcome, validationErrors: r.validationErrors, stopReason: r.stopReason })));

function parsedOf(r) {
  if (r.outcome !== 'valid' || !r.rawResponse) return null;
  try { const env = JSON.parse(r.rawResponse); const text = (env.content || []).map(c => c.type === 'text' ? c.text : '').join(''); const p = deterministicJsonParse(text); return p.ok ? p.value : null; } catch { return null; }
}
const gradeRows = (w, p) => ({ date: gradeDate(p.date?.bestYear, w.truth.date), place: gradePlace(p.place?.topGuess, w.truth.place), medium: gradeMedium(p.medium?.guess, w.truth.medium), style: gradeStyle(p.style?.guess, w.truth.style, styleDedup), artist: gradeArtist(p.artist?.guess, w.truth.artist) });

// ---- Identify required facet adjudications (frozen rule) over ALL valid cells (primary + repeats) ----
const requiredCells = [];
const responseByCall = new Map();
const cellNeedsAdj = new Set();
for (const r of results) {
  if (r.outcome !== 'valid') continue;
  const c = callById.get(r.callId), w = frozenWorks.get(r.workId), parsed = parsedOf(r);
  if (!c || !w || !parsed) continue;
  responseByCall.set(r.callId, { parsed, responseSha256: r.responseSha256 });
  if (c.replicate !== 0) continue; // adjudication queue is the PRIMARY cells only (repeats drop from reliability if ambiguous)
  const mask = draftWorkById.get(r.workId).applicableMask;
  const rows = gradeRows(w, parsed);
  for (const f of ['place', 'medium', 'style', 'artist']) {
    if (!mask.includes(f)) continue;
    if (facetAmbiguous(f, parsed, rows)) {
      const cellId = adjudicationCellId('facet', r.callId, f);
      requiredCells.push({ cellId, kind: 'facet', callId: r.callId, facet: f, workId: r.workId, task: 'facets', source: 'canonical', view: 'full' });
      cellNeedsAdj.add(cellId);
    }
  }
}
const responseFor = callId => responseByCall.get(callId) || null;
const arts = buildAdjudicationArtifacts(requiredCells, { works: frozenWorks, responseFor, freezeId: draft.protocolId });

// ---- Load rulings if present; require valid + SHA-bound before any final result ----
const rulingsPath = join(OUT, 'adjudications.json');
const resolved = new Map();
let rulingErrors = [];
if (existsSync(rulingsPath)) {
  const a = JSON.parse(readFileSync(rulingsPath, 'utf8'));
  const v = validateAdjudicationArtifact(a);
  if (!v.ok) rulingErrors.push(...v.errors);
  if (a.freezeId !== draft.protocolId) rulingErrors.push('rulings freezeId mismatch');
  if (a.packetSha256 !== arts.packetSha256) rulingErrors.push('rulings packetSha256 does not match current blinded packet');
  if (a.collectionEvidenceSha256 !== evidence.sha256) rulingErrors.push('rulings collectionEvidenceSha256 does not match anchor');
  for (const res of (a.resolutions || [])) {
    if (!cellNeedsAdj.has(res.cellId)) { rulingErrors.push(`ruling on non-queued cell ${res.cellId}`); continue; }
    const controller = arts.controller.cells.find(x => x.adjudicationId === res.cellId);
    if (!controller || controller.responseSha256 !== res.responseSha256) { rulingErrors.push(`ruling SHA not bound for ${res.cellId}`); continue; }
    resolved.set(res.cellId, res.resolvedCredit);
  }
}

// ---- Grade cells to credits (resolved rulings applied; unresolved stay null) ----
const gradedCells = [];
for (const r of results) {
  if (r.outcome !== 'valid') continue;
  const c = callById.get(r.callId), w = frozenWorks.get(r.workId), parsed = parsedOf(r);
  if (!c || !w || !parsed) continue;
  const mask = draftWorkById.get(r.workId).applicableMask;
  const rows = gradeRows(w, parsed);
  const credits = {};
  for (const f of mask) {
    if (f !== 'date' && facetAmbiguous(f, parsed, rows)) {
      const cellId = adjudicationCellId('facet', r.callId, f);
      if (resolved.has(cellId)) credits[f] = resolved.get(cellId); // ruled
      // else: unresolved -> omitted (null), excluded from means
    } else if (typeof rows[f]?.credit === 'number') credits[f] = rows[f].credit;
  }
  gradedCells.push({ workId: r.workId, condition: r.condition, replicate: c.replicate, credits });
}

const unresolvedCount = requiredCells.filter(c => !resolved.has(c.cellId)).length;
const armDist = { 'no-cue': 0, sham: 0, 'correct-cue': 0 };
const facetDist = {};
for (const c of requiredCells) { armDist[callById.get(c.callId).condition]++; facetDist[c.facet] = (facetDist[c.facet] || 0) + 1; }

const applicableByWork = Object.fromEntries(draft.works.map(w => [w.id, w.applicableMask]));
const finalizable = studyBFinalizable({ gatesPass: validity.gatesPass, unresolved: unresolvedCount, rulingErrors });
const effects = finalizable ? computeStudyBEffects(gradedCells, applicableByWork) : null;

// ---- Write the blinded packet + private controller + empty rulings template (only while pending) ----
if (!finalizable && requiredCells.length) {
  writeFileSync(join(OUT, 'blinded-review-packet.json'), JSON.stringify(arts.packet, null, 2) + '\n', { mode: 0o600 });
  writeFileSync(join(OUT, 'adjudication-controller.private.json'), JSON.stringify(arts.controller, null, 2) + '\n', { mode: 0o600 });
  const template = { version: 'recognition-adjudication/3', freezeId: draft.protocolId, packetSha256: arts.packetSha256, collectionEvidenceSha256: evidence.sha256, resolutions: arts.packet.cells.map(cell => ({ cellId: cell.adjudicationId, responseSha256: cell.responseSha256, kind: 'facet', resolvedCredit: null, reviewer: 'Kat Swint', note: '' })) };
  writeFileSync(join(OUT, 'adjudications.template.json'), JSON.stringify(template, null, 2) + '\n', { mode: 0o600 });
}

const report = {
  version: 'recognition-studyb-report/2',
  protocolId: draft.protocolId,
  collectionEvidenceSha256: evidence.sha256,
  completion: { planned: callManifest.calls.length, resultsPresent: results.length, verifiedCostUsd: evidence.totals.billedUsd },
  validity,
  adjudication: { required: requiredCells.length, resolved: resolved.size, unresolved: unresolvedCount, armDistribution: armDist, facetDistribution: facetDist, packetSha256: arts.packetSha256, rulingErrors },
  effects,
  causalReportable: finalizable,
  status: finalizable ? 'studyb-final' : (validity.gatesPass ? 'studyb-pending-adjudication' : 'studyb-instrument-invalid/incomplete'),
  suppressionReason: finalizable ? null : (!validity.gatesPass ? `validity gates failed (worst arm ${validity.worstArmRate.toFixed(3)}, triplets ${validity.completeTriplets}/36)` : `${unresolvedCount} of ${requiredCells.length} required facet adjudications unresolved${rulingErrors.length ? '; ruling errors: ' + rulingErrors.join('; ') : ''}`),
};
writeFileSync(join(OUT, 'studyb-report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify(report, null, 2));
if (!finalizable) console.error(`\nCAUSAL RESULT NOT FINAL — ${report.status}: ${report.suppressionReason}`);
