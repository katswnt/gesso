// Corrected Study-B analyzer. Validity/errors by arm, complete triplets, and — only if the gates pass —
// graded causal effects (frozen graders). Suppresses the causal conclusion otherwise. No network, no
// mutation of any frozen artifact.
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gradeDate, gradePlace, gradeMedium, gradeStyle, gradeArtist, styleDedupFromSnapshot } from './lib/recognition-pilot.mjs';
import { deterministicJsonParse } from './lib/recognition-pilot-runtime.mjs';
import { analyzeValidity, computeStudyBEffects, STUDYB_FACETS } from './lib/recognition-studyb.mjs';

const OUT = 'docs/research/recognition-studyb';
const FROZEN = 'docs/research/recognition-pilot';
const draft = JSON.parse(readFileSync(join(OUT, 'studyb-manifest.draft.json'), 'utf8'));
const callManifest = JSON.parse(readFileSync(join(OUT, 'studyb-call-manifest.draft.json'), 'utf8'));
const styleDedup = styleDedupFromSnapshot(JSON.parse(readFileSync(join(FROZEN, 'style-taxonomy.frozen.json'), 'utf8')));
const worksById = new Map(draft.works.map(w => [w.id, w]));
const callById = new Map(callManifest.calls.map(c => [c.callId, c]));
const runDir = join('data/incoming/recognition-studyb', draft.protocolId, 'attempts');
if (!existsSync(runDir)) { console.error('No Study-B collection found.'); process.exit(2); }

const results = [];
for (const cid of readdirSync(runDir)) {
  const p = join(runDir, cid, 'attempt-1.result.json'); if (!existsSync(p)) continue;
  results.push(JSON.parse(readFileSync(p, 'utf8')));
}
const validityInput = results.map(r => ({ callId: r.callId, condition: r.condition, outcome: r.outcome, validationErrors: r.validationErrors, stopReason: r.stopReason }));
const validity = analyzeValidity(callManifest, validityInput);

function parsedOf(r) {
  if (r.outcome !== 'valid' || !r.rawResponse) return null;
  try { const env = JSON.parse(r.rawResponse); const text = (env.content || []).map(c => c.type === 'text' ? c.text : '').join(''); const p = deterministicJsonParse(text); return p.ok ? p.value : null; } catch { return null; }
}
function gradeCell(w, parsed) {
  const applicable = w.primaryApplicable;
  const credits = {};
  for (const f of STUDYB_FACETS) {
    if (!applicable.includes(f)) continue;
    let g;
    if (f === 'date') g = gradeDate(parsed.date?.bestYear, w.truth.date);
    else if (f === 'place') g = gradePlace(parsed.place?.topGuess, w.truth.place);
    else if (f === 'medium') g = gradeMedium(parsed.medium?.guess, w.truth.medium);
    else if (f === 'style') g = gradeStyle(parsed.style?.guess, w.truth.style, styleDedup);
    else if (f === 'artist') g = gradeArtist(parsed.artist?.guess, w.truth.artist);
    if (g && typeof g.credit === 'number') credits[f] = g.credit;
  }
  return credits;
}

let effects = null;
if (validity.gatesPass) {
  const gradedCells = [];
  for (const r of results) {
    if (r.outcome !== 'valid') continue;
    const c = callById.get(r.callId), w = worksById.get(r.workId), parsed = parsedOf(r);
    if (!c || !w || !parsed) continue;
    gradedCells.push({ workId: r.workId, condition: r.condition, replicate: c.replicate, credits: gradeCell(w, parsed) });
  }
  const applicableByWork = Object.fromEntries(draft.works.map(w => [w.id, w.primaryApplicable]));
  effects = computeStudyBEffects(gradedCells, applicableByWork);
}

const report = {
  version: 'recognition-studyb-report/1', protocolId: draft.protocolId,
  completion: { planned: callManifest.calls.length, resultsPresent: results.length },
  validity, effects,
  causalReportable: validity.gatesPass,
  suppressionReason: validity.gatesPass ? null : `gates failed: worstArmValidRate=${validity.worstArmRate.toFixed(3)} (need ≥0.90), completeTriplets=${validity.completeTriplets}/36 (need ≥30)`,
};
writeFileSync(join(OUT, 'studyb-report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify(report, null, 2));
if (!validity.gatesPass) console.error(`\nCAUSAL CONCLUSION SUPPRESSED — ${report.suppressionReason}`);
