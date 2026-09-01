// Explicit offline normalization after human/curator edits to the DRAFT.
// Recomputes deterministic cue masks, shams, the call schedule, and semantic hashes, and
// deterministically regenerates the curation worksheet from the sealed manifest so no review artifact
// can drift. It neither marks a curator checkbox nor creates frozen artifacts and cannot
// fetch/call a model. It fails closed if any work is structurally malformed.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PILOT_WORKS, disclosureMask, opaqueSham, buildCallManifest, canonicalJson, sha256,
  validateWorkShape, curatorChecksAllTrue, buildWorksheet, normalizedWorkId,
} from './lib/recognition-pilot.mjs';

if (!process.argv.includes('--seal')) { console.error('REFUSED: explicit --seal required'); process.exit(2); }
const DIR = 'docs/research/recognition-pilot';
const manifestPath = join(DIR, 'pilot-manifest.draft.json');
const callsPath = join(DIR, 'call-manifest.draft.json');
const stylesPath = join(DIR, 'style-taxonomy.snapshot.json');
const worksheetPath = join(DIR, 'pilot-curation-worksheet.md');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const priorCalls = JSON.parse(readFileSync(callsPath, 'utf8'));
const styles = JSON.parse(readFileSync(stylesPath, 'utf8'));
if (manifest.status !== 'DRAFT_NOT_FROZEN_NO_COLLECTION' || manifest.works?.length !== PILOT_WORKS) { console.error('REFUSED: expected the 36-work unfrozen draft'); process.exit(2); }

// Shared structural validator (same one the gate and finalizer use): curator booleans never bless
// malformed data, so seal refuses to normalize a broken manifest.
const shapeErrors = [];
for (const w of manifest.works) { const v = validateWorkShape(w); if (!v.ok) shapeErrors.push(...v.errors); }
if (shapeErrors.length) { console.error('REFUSED: manifest work shape invalid:'); for (const e of shapeErrors) console.error(`  - ${e}`); process.exit(2); }
if (new Set(manifest.works.map(w => normalizedWorkId(w.id))).size !== manifest.works.length) { console.error('REFUSED: duplicate normalized (conceptual) work ids'); process.exit(2); }

for (const w of manifest.works) {
  const mask = disclosureMask(w.cue?.correct, w.cue?.acceptedAliasesByFacet);
  w.cue.disclosedFacets = mask.disclosedFacets;
  w.cue.eligibleFacets = mask.eligibleFacets;
  w.cue.sham = opaqueSham(w.cue.correct, w.id);
}
const calls = buildCallManifest(manifest.works, priorCalls.seed);
manifest.callManifest.expectedCalls = calls.counts;
manifest.styleTaxonomy.sha256 = (() => {
  delete styles.sha256;
  styles.sha256 = sha256(canonicalJson(styles));
  return styles.sha256;
})();
delete manifest.sha256;
manifest.sha256 = sha256(canonicalJson(manifest));
writeFileSync(callsPath, JSON.stringify(calls, null, 2) + '\n');
writeFileSync(stylesPath, JSON.stringify(styles, null, 2) + '\n');
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(worksheetPath, buildWorksheet(manifest));
const incomplete = manifest.works.filter(w => !curatorChecksAllTrue(w.curatorChecks)).length;
console.log(`sealed unfrozen draft ${manifest.sha256}; regenerated worksheet; ${incomplete} works still have curator blockers; NO model/fetch call`);
