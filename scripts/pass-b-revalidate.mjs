// Offline, READ-ONLY revalidation of an existing Pass B calibration run against the repaired evidence
// checks (VSD-023). No model, no network, no mutation of completion/raw/transcript/attempt files. Writes a
// single quarantined acceptance report. Usage: node scripts/pass-b-revalidate.mjs [<run-dir>]

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { sha256, stableJson } from './lib/vision-legacy.mjs';
import { validateStageBody, EVIDENCE_AXES, PLAYER_WHY_MAX, PLAYER_NOTE_BODY_MAX } from './lib/vision-content-schema.mjs';
import { completionKey } from './lib/vision-content-capture.mjs';
import { b2InputFor, b3Plan, verifyStageEvidence, VALIDATION_CONTRACT_VERSION, CALIBRATION_MODEL } from './lib/pass-b-calibration.mjs';

const RUN = process.argv[2] || 'data/incoming/vision-calibration/cal50-0a47b6f7f332';
const manifest = JSON.parse(readFileSync(join(RUN, 'run-manifest.json'), 'utf8'));
const works = manifest.selection || [];
const STAGES = ['B1', 'B2', 'B3', 'B4'];
const keyFor = (stage, id) => completionKey(stage, id);
const completionPathFor = (dir, stage, id) => join(dir, 'completions', `${stage.toLowerCase()}-${keyFor(stage, id)}.json`);

const report = {
  runId: manifest.runId, validationContractVersion: VALIDATION_CONTRACT_VERSION, generatedAtNote: 'offline-revalidation',
  works: works.length, completionsChecked: 0,
  counts: { rawMatch: 0, bodyMatch: 0, transcriptMatch: 0, modelOk: 0, apiKeySourceNone: 0, toolEvidenceOk: 0, b4HydrationEqual: 0, structuralOk: 0 },
  toolEvidenceApplicable: 0, b4Applicable: 0,
  failures: [], whysOver500: [], notesOver600: [],
};

for (const w of works) {
  const id = w.id;
  const dir = join(RUN, 'works', sha256(id).slice(0, 24));
  const prepPath = join(dir, 'b0-prep.json');
  if (!existsSync(prepPath)) { report.failures.push({ id, stage: 'B0', error: 'b0-prep missing' }); continue; }
  const prep = JSON.parse(readFileSync(prepPath, 'utf8'));
  const catalog = prep.trustedCatalog, legacy = prep.legacy, image = prep.image;
  const imageBasename = image ? `${image.imgSha256}.${image.ext}` : null;
  const bodies = {};
  // First pass: load + integrity-check each present completion (need bodies for B2/B4 context/hydration).
  const present = {};
  for (const stage of STAGES) {
    const cp = completionPathFor(dir, stage, id);
    if (!existsSync(cp)) continue; // conditional stages may be absent; the 50/50 cohort has all four
    present[stage] = JSON.parse(readFileSync(cp, 'utf8'));
    bodies[stage] = present[stage].body;
  }
  for (const stage of STAGES) {
    const stored = present[stage];
    if (!stored) continue;
    report.completionsChecked++;
    const fail = (error) => report.failures.push({ id, stage, error });
    // raw exists + hashes to rawResponseSha256; body === reparsed raw
    const rawPath = join(dir, 'raw', `${stored.rawResponseSha256}.json`);
    if (existsSync(rawPath)) {
      const raw = readFileSync(rawPath, 'utf8');
      if (sha256(raw) === stored.rawResponseSha256) report.counts.rawMatch++; else fail('raw-sha-mismatch');
      try { if (stableJson(JSON.parse(raw)) === stableJson(stored.body)) report.counts.bodyMatch++; else fail('raw-body-mismatch'); } catch { fail('raw-json'); }
    } else fail('raw-missing');
    // structural validation (context per stage)
    let ctx = {};
    if (stage === 'B2') ctx = { evidenceIds: b2InputFor(id, catalog, bodies.B1 || {}).visibleSignals.map(s => s.evidenceId) };
    if (stage === 'B3') ctx = { requestIds: b3Plan(bodies.B2 || {}).requestIds };
    const val = validateStageBody(stage, stored.body, ctx);
    // B4 proposedWhy over the restored 500 cap is a PLAYER-COPY trim advisory, not an integrity failure.
    const onlyWhyOverCap = stage === 'B4' && !val.ok && (val.errors || []).every(e => e === 'B4 proposedWhy') && typeof stored.body.proposedWhy === 'string' && stored.body.proposedWhy.length > PLAYER_WHY_MAX;
    if (val.ok || onlyWhyOverCap) report.counts.structuralOk++; else fail(`structural:${(val.errors || []).join(',')}`);
    // execution evidence (transcript-by-sha, model, apiKeySource, tool activity, B4 hydration)
    const ev = verifyStageEvidence({ stage, workRunDir: dir, completion: stored, imageBasename, b1: bodies.B1, b2: bodies.B2, b3: bodies.B3, legacy });
    const errs = ev.ok ? [] : ev.errors;
    if (!errs.some(e => e.startsWith('transcript-sha-not-found'))) report.counts.transcriptMatch++; else fail('transcript-sha-not-found');
    if (!errs.some(e => e.startsWith('model:'))) report.counts.modelOk++; else fail(errs.find(e => e.startsWith('model:')));
    if (!errs.some(e => e.startsWith('apiKeySource:'))) report.counts.apiKeySourceNone++; else fail(errs.find(e => e.startsWith('apiKeySource:')));
    if (stage === 'B1' || stage === 'B2' || stage === 'B3') {
      report.toolEvidenceApplicable++;
      if (!errs.some(e => e.startsWith('read:') || e.startsWith('web:'))) report.counts.toolEvidenceOk++; else fail(errs.find(e => e.startsWith('read:') || e.startsWith('web:')));
    }
    if (stage === 'B4') {
      report.b4Applicable++;
      const why = stored.body.proposedWhy;
      const whyOver = typeof why === 'string' && why.length > PLAYER_WHY_MAX;
      if (whyOver) report.whysOver500.push({ id, length: why.length });
      for (const n of (stored.body.notes || [])) if (typeof n.body === 'string' && n.body.length > PLAYER_NOTE_BODY_MAX) report.notesOver600.push({ id, noteId: n.noteId, length: n.body.length });
      const b4err = errs.find(e => e.startsWith('b4-'));
      if (!b4err) report.counts.b4HydrationEqual++;
      // A reassembly that fails ONLY because the stored why now exceeds the restored 500 cap is a player-copy
      // TRIM advisory (delta was valid under its capture-time cap), NOT an integrity failure — the raw/body/
      // transcript/model checks above all passed for this completion.
      else if (b4err.startsWith('b4-reassembly-invalid:delta.why') && whyOver) report.counts.b4HydrationEqualExceptWhyTrim = (report.counts.b4HydrationEqualExceptWhyTrim || 0) + 1;
      else fail(b4err);
    }
  }
}

const outPath = join(RUN, 'acceptance-report.json');
writeFileSync(outPath, `${JSON.stringify(report, null, 1)}\n`);
console.log(`Revalidation: ${report.works} works, ${report.completionsChecked} completions`);
console.log(`  raw ${report.counts.rawMatch} | body ${report.counts.bodyMatch} | transcript ${report.counts.transcriptMatch} | model ${report.counts.modelOk} | apiKeySource:none ${report.counts.apiKeySourceNone}`);
console.log(`  tool-evidence ${report.counts.toolEvidenceOk}/${report.toolEvidenceApplicable} | B4 hydration-equal ${report.counts.b4HydrationEqual}/${report.b4Applicable}${report.counts.b4HydrationEqualExceptWhyTrim ? ` (+${report.counts.b4HydrationEqualExceptWhyTrim} pending why-trim)` : ''} | structural ${report.counts.structuralOk}`);
console.log(`  integrity failures ${report.failures.length} | whys>500 (manual trim) ${report.whysOver500.length} | notes>600 ${report.notesOver600.length}`);
if (report.failures.length) console.log('  FAILURES:', JSON.stringify(report.failures.slice(0, 20)));
if (report.whysOver500.length) console.log('  whys needing manual trim:', JSON.stringify(report.whysOver500));
console.log(`report: ${outPath}`);
