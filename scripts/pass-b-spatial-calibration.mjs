// Offline Pass-B spatial-policy calibration (VSD-029).
//
// Builds legacy/B1 spatial candidate rows and localization-only inputs from a preserved B4 run. With an
// owner review export, measures the policy against explicit keep/move choices while treating unanswered
// rows as abstentions and v1 "drop" choices as spatial-only signals. No model calls, approvals, evidence
// edits, or production writes.
//
//   node scripts/pass-b-spatial-calibration.mjs \
//     data/incoming/vision-calibration/b4r-8f1f74ddc30f \
//     --review /path/to/pass-b-editorial-review-....json
//
// Add --write to persist report + localization inputs below <run>/spatial-calibration/. Existing files are
// never overwritten.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { sha256 } from './lib/vision-legacy.mjs';
import {
  SPATIAL_CALIBRATION_VERSION, buildLocalizationInput, spatialRowsForWork, summarizeOwnerSpatialReview,
} from './lib/pass-b-spatial-policy.mjs';

const args = process.argv.slice(2);
const valueAfter = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const positional = args[0] && !args[0].startsWith('--') ? args[0] : null;
const runDir = resolve(positional || 'data/incoming/vision-calibration/b4r-8f1f74ddc30f');
const reviewPath = valueAfter('--review');
const write = args.includes('--write');
const mode = valueAfter('--mode') || 'audit';
if (!['audit', 'exceptions'].includes(mode)) throw new Error('--mode must be audit or exceptions');

const runManifest = JSON.parse(readFileSync(join(runDir, 'run-manifest.json'), 'utf8'));
const upstreamDir = resolve(runManifest.upstreamRun || 'data/incoming/vision-calibration/cal50-0a47b6f7f332');
const workDir = join(runDir, 'works');
const safeId = id => id.replace(/[^a-z0-9]+/gi, '_');
const b0Path = id => join(upstreamDir, 'works', sha256(id).slice(0, 24), 'b0-prep.json');

const works = [];
for (const file of readdirSync(workDir).filter(file => file.endsWith('.b4.json')).sort()) {
  const record = JSON.parse(readFileSync(join(workDir, file), 'utf8'));
  if (!record.ok) continue;
  const b0 = JSON.parse(readFileSync(b0Path(record.id), 'utf8'));
  const rows = spatialRowsForWork({
    workId: record.id, imageSha256: b0.image?.imgSha256 ?? null,
    legacyImageSha256: b0.image?.imgSha256 ?? null,
    delta: record.rawDelta, body: record.body, hydration: record.hydration, legacy: b0.legacy,
  });
  const localizationInput = buildLocalizationInput({
    workId: record.id, imageSha256: b0.image.imgSha256, imageExt: b0.image.ext, rows, mode,
  });
  works.push({ workId: record.id, title: b0.trustedCatalog?.title || record.id, image: b0.image, rows, localizationInput });
}

const routeCounts = {};
for (const work of works) for (const row of work.rows) {
  const key = row.automaticRoute.presentation;
  routeCounts[key] = (routeCounts[key] || 0) + 1;
}
const plan = {
  version: SPATIAL_CALIBRATION_VERSION,
  runId: runManifest.runId || runDir.split('/').pop(),
  sourceRun: runDir,
  evidenceManifestSha256: runManifest.evidenceManifestSha256 ?? null,
  mode,
  summary: {
    works: works.length,
    observations: works.reduce((n, work) => n + work.rows.length, 0),
    localizationCalls: works.filter(work => work.localizationInput.targets.length).length,
    localizationTargets: works.reduce((n, work) => n + work.localizationInput.targets.length, 0),
    automaticRoutes: routeCounts,
  },
  works: works.map(work => ({
    workId: work.workId, title: work.title, imageSha256: work.image.imgSha256,
    routes: Object.fromEntries([...new Set(work.rows.map(row => row.automaticRoute.presentation))].map(route => [route, work.rows.filter(row => row.automaticRoute.presentation === route).length])),
    localizationTargets: work.localizationInput.targets.length,
  })),
};

let report = null;
if (reviewPath) {
  const review = JSON.parse(readFileSync(resolve(reviewPath), 'utf8'));
  if (review.runId !== plan.runId) throw new Error(`review runId ${review.runId} does not match ${plan.runId}`);
  if (plan.evidenceManifestSha256 && review.evidenceManifestSha256 !== plan.evidenceManifestSha256) throw new Error('review evidence manifest does not match run');
  report = summarizeOwnerSpatialReview({ workRows: works, review });
}

if (write) {
  const outDir = join(runDir, 'spatial-calibration');
  const inputDir = join(outDir, 'localization-inputs');
  if (existsSync(outDir)) throw new Error(`refusing to overwrite existing output: ${outDir}`);
  mkdirSync(inputDir, { recursive: true, mode: 0o700 });
  writeFileSync(join(outDir, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  for (const work of works) if (work.localizationInput.targets.length) {
    writeFileSync(join(inputDir, `${safeId(work.workId)}.json`), `${JSON.stringify(work.localizationInput, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  }
  if (report) writeFileSync(join(outDir, 'owner-review-report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(`wrote ${outDir}`);
}

console.log(`PASS ${plan.version}: ${plan.summary.works} works, ${plan.summary.observations} observations`);
console.log(`routes ${JSON.stringify(plan.summary.automaticRoutes)}; localization ${plan.summary.localizationCalls} calls / ${plan.summary.localizationTargets} targets (${mode})`);
if (report) {
  console.log(`owner choices ${JSON.stringify(report.totals.choices)}; suppressed ${JSON.stringify(report.totals.suppressedChoices)}`);
  console.log(`point labels ${report.movement.comparableLegacyPointLabels} comparable; closer ${JSON.stringify(report.movement.pointLabelCloser)}`);
  console.log(`moves ${report.movement.moved}; comparable legacy ${report.movement.comparableLegacyMoves}; closer ${JSON.stringify(report.movement.closer)}; within-old-5 ${report.movement.returnedWithinLegacy.five}`);
  console.log(`abstentions are excluded; ${report.totals.ambiguousContentDrops} v1 drop choices are not treated as content negatives`);
}
