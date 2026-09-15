// Subscription-backed, spatial-only Pass-B canary (VSD-029).
//
// Default is PLAN ONLY. The model sees one SHA-named image plus neutral visual target phrases and prior/B1
// candidate points. It never receives player explanations, research sources, catalog identity, owner notes,
// or owner coordinates, and it cannot rewrite content. When --review is supplied, that file is opened only
// after every model call finishes and is used solely for offline scoring.
//
//   node scripts/pass-b-spatial-localization-canary.mjs
//   PASS_B_SPATIAL_LIVE=1 node scripts/pass-b-spatial-localization-canary.mjs --run \
//     --review /path/to/pass-b-editorial-review-....json
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sha256, stableJson } from './lib/vision-legacy.mjs';
import {
  CALIBRATION_MODEL, buildStageCommand, neutralImageFile, parseStreamTranscript, primaryModelFromEnvelope,
  transcriptFinal, verifyB1ImageRead,
} from './lib/pass-b-calibration.mjs';
import {
  LOCALIZATION_RESULT_VERSION, LOCALIZATION_WIRE_SCHEMA, SPATIAL_CALIBRATION_VERSION,
  buildLocalizationInput, buildLocalizationPrompt, pointDistance, resolveLocalization,
  spatialRowsForWork, summarizePointDistances, validateLocalizationResult,
} from './lib/pass-b-spatial-policy.mjs';

const execFileP = promisify(execFile);
const args = process.argv.slice(2);
const valueAfter = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const positional = args[0] && !args[0].startsWith('--') ? args[0] : null;
const sourceRun = resolve(positional || 'data/incoming/vision-calibration/b4r-8f1f74ddc30f');
const run = args.includes('--run');
const all = args.includes('--all');
const mode = valueAfter('--mode') || 'audit';
const reviewPath = valueAfter('--review');
const selectedWork = valueAfter('--work');
if (!['audit', 'exceptions'].includes(mode)) throw new Error('--mode must be audit or exceptions');

const DEFAULT_CANARY = [
  'aic124043', 'cleveland167459', 'harvard230527', 'harvard303416',
  'http://www.wikidata.org/entity/Q3829346', 'wikidata:Q110776566', 'wikidata:Q1616056',
  'wikidata:Q16467705', 'wikidata:Q56825917', 'wikidata:Q59296885',
];

const sourceManifest = JSON.parse(readFileSync(join(sourceRun, 'run-manifest.json'), 'utf8'));
const upstreamRun = resolve(sourceManifest.upstreamRun || 'data/incoming/vision-calibration/cal50-0a47b6f7f332');
const calibrationRoot = dirname(sourceRun);
const imageDirName = readdirSync(calibrationRoot).find(name => /^imgs-/.test(name));
if (!imageDirName) throw new Error(`no imgs-* directory under ${calibrationRoot}`);
const imageDir = join(calibrationRoot, imageDirName);
const safeId = id => id.replace(/[^a-z0-9]+/gi, '_');
const b0Path = id => join(upstreamRun, 'works', sha256(id).slice(0, 24), 'b0-prep.json');
const fileSha = path => createHash('sha256').update(readFileSync(path)).digest('hex');

function loadWork(file) {
  const recordPath = join(sourceRun, 'works', file);
  const record = JSON.parse(readFileSync(recordPath, 'utf8'));
  if (!record.ok) return null;
  const b0 = JSON.parse(readFileSync(b0Path(record.id), 'utf8'));
  const rows = spatialRowsForWork({ workId: record.id, imageSha256: b0.image.imgSha256, legacyImageSha256: b0.image.imgSha256, delta: record.rawDelta, body: record.body, hydration: record.hydration, legacy: b0.legacy });
  const input = buildLocalizationInput({ workId: record.id, imageSha256: b0.image.imgSha256, imageExt: b0.image.ext, rows, mode });
  return { id: record.id, recordPath, b0, rows, input };
}

const everyWork = readdirSync(join(sourceRun, 'works')).filter(file => file.endsWith('.b4.json')).sort().map(loadWork).filter(Boolean);
const selectedIds = selectedWork ? [selectedWork] : all ? everyWork.map(work => work.id) : DEFAULT_CANARY;
const selected = everyWork.filter(work => selectedIds.includes(work.id) && work.input.targets.length);
const missing = selectedIds.filter(id => !everyWork.some(work => work.id === id));
if (missing.length) throw new Error(`selected work not found/completed: ${missing.join(', ')}`);

const bindings = Object.fromEntries(selected.map(work => [work.id, {
  imageSha256: work.b0.image.imgSha256,
  sourceRecordSha256: fileSha(work.recordPath),
  localizationInputSha256: sha256(stableJson(work.input)),
}]));
const binding = {
  version: 'passBSpatialLocalizationCanary/4', sourceRun, sourceRunId: sourceManifest.runId,
  sourceEvidenceManifestSha256: sourceManifest.evidenceManifestSha256 ?? null,
  spatialPolicyVersion: SPATIAL_CALIBRATION_VERSION, localizationSchema: LOCALIZATION_RESULT_VERSION,
  model: CALIBRATION_MODEL, mode, works: selected.map(work => work.id), bindings,
};
const runId = `b5c-${sha256(stableJson(binding)).slice(0, 12)}`;
const outDir = join(calibrationRoot, runId);

function printPlan() {
  console.log('Pass-B spatial-only localization canary (VSD-029) — PLAN ONLY');
  console.log(`source: ${sourceRun}`);
  console.log(`output: ${outDir}`);
  console.log(`mode: ${mode}; calls: ${selected.length}; targets: ${selected.reduce((n, work) => n + work.input.targets.length, 0)}`);
  for (const work of selected) console.log(`  ${work.id}: ${work.input.targets.length} target(s)`);
  console.log('Model input excludes catalog identity, research/player explanations, owner notes, and owner coordinates.');
  console.log('Run: PASS_B_SPATIAL_LIVE=1 node scripts/pass-b-spatial-localization-canary.mjs --run --review <export.json>');
  console.log('Use --all for all completed works, --mode exceptions for candidate disagreements/bbox centers only, or --work <id> for one work.');
}

async function callLocalizer(work) {
  const imageFile = neutralImageFile(work.b0.image.imgSha256, work.b0.image.ext);
  const sourceImage = join(imageDir, imageFile);
  if (!existsSync(sourceImage)) throw new Error(`${work.id}: missing image ${sourceImage}`);
  const callDir = mkdtempSync(join(tmpdir(), 'pass-b-spatial-'));
  const started = Date.now();
  try {
    copyFileSync(sourceImage, join(callDir, imageFile));
    const promptText = buildLocalizationPrompt(work.input, imageFile);
    const command = buildStageCommand({ stage: 'B5', promptText, imageFile, wireSchema: LOCALIZATION_WIRE_SCHEMA });
    const env = { ...process.env }; for (const key of command.env.removeKeys) delete env[key];
    let stdout = ''; let exitCode = 0;
    try { ({ stdout } = await execFileP(command.bin, command.argv, { cwd: callDir, env, maxBuffer: 32 * 1024 * 1024 })); }
    catch (error) { exitCode = error.code ?? 1; stdout = error.stdout || ''; }
    const transcript = parseStreamTranscript(stdout);
    const final = transcriptFinal(transcript);
    const result = final?.structured_output ?? null;
    const receipt = verifyB1ImageRead(transcript, { callDir, imageBasename: imageFile });
    const validation = result ? validateLocalizationResult(work.input, result) : { ok: false, errors: ['missing structured output'] };
    const resolvedModel = primaryModelFromEnvelope(final);
    const errors = [];
    if (exitCode !== 0 || !final || final.is_error) errors.push(`process failed (exit ${exitCode})`);
    if (!receipt.ok) errors.push(`image receipt: ${receipt.reason}`);
    if (resolvedModel !== CALIBRATION_MODEL) errors.push(`model drift: ${resolvedModel}`);
    if (!validation.ok) errors.push(...validation.errors);
    return {
      ok: errors.length === 0, errors, result, transcript: stdout,
      evidence: {
        durationMs: Date.now() - started, transcriptSha256: sha256(stdout), resolvedModel,
        apiKeySource: transcript.init?.apiKeySource ?? null, claudeCodeVersion: transcript.init?.claudeCodeVersion ?? null,
        usage: final?.usage ?? null, modelUsage: final?.modelUsage ?? null, numTurns: final?.num_turns ?? null,
        imageReceipt: receipt, exitCode,
      },
    };
  } finally { rmSync(callDir, { recursive: true, force: true }); }
}

function scoreAgainstOwner(results, review) {
  const reviewByWork = new Map((review?.works || []).map(work => [work.workId, work]));
  const scored = [];
  for (const work of selected) {
    const response = results.get(work.id);
    const result = response?.ok ? response.result : null;
    const decisions = new Map((result?.decisions || []).map(decision => [decision.requestId, decision]));
    const reviewed = reviewByWork.get(work.id);
    const reviewRows = new Map((reviewed?.hotspots || []).map(row => [row.deltaIndex, row.review]));
    for (const target of work.input.targets) {
      const owner = reviewRows.get(target.deltaIndex);
      const row = work.rows.find(item => item.deltaIndex === target.deltaIndex);
      const ownerPoint = owner?.decision === 'move' ? owner : owner?.decision === 'keep' ? row?.currentPoint : null;
      const decision = decisions.get(target.requestId);
      const resolution = decision ? resolveLocalization(row, decision) : null;
      const modelPoint = resolution?.presentation === 'pin' ? resolution.point : null;
      const currentDistance = pointDistance(ownerPoint, row?.currentPoint);
      const candidateDistances = (target.candidates || []).map(candidate => pointDistance(ownerPoint, candidate.point)).filter(Number.isFinite);
      scored.push({
        workId: work.id, deltaIndex: target.deltaIndex, requestId: target.requestId,
        ownerDecision: owner?.decision || 'abstain', ownerPoint: ownerPoint && { x: ownerPoint.x, y: ownerPoint.y },
        modelScope: decision?.scope ?? null, modelConfidence: decision?.confidence ?? null,
        modelSelectedCandidateId: resolution?.candidateId ?? null,
        modelSuggestedPoint: decision?.suggestedPoint ?? null,
        candidateAssessments: decision?.candidateAssessments ?? [],
        resolution: resolution ? { presentation: resolution.presentation, status: resolution.status, reason: resolution.reason } : null,
        modelPoint, distance: pointDistance(ownerPoint, modelPoint), currentDistance,
        bestExistingCandidateDistance: candidateDistances.length ? Math.min(...candidateDistances) : null,
      });
    }
  }
  const countBy = (values, getter) => Object.fromEntries([...values.reduce((map, value) => {
    const key = getter(value) ?? 'none'; map.set(key, (map.get(key) || 0) + 1); return map;
  }, new Map()).entries()].sort(([a], [b]) => a.localeCompare(b)));
  const unique = scored.filter(row => row.modelScope === 'point' && Number.isFinite(row.distance));
  const representative = scored.filter(row => row.modelScope === 'representative' && Number.isFinite(row.distance));
  const assessments = scored.flatMap(row => row.candidateAssessments || []);
  return {
    version: 'passBSpatialLocalizationScore/2', reviewVersion: review?.version ?? null,
    reviewSha256: sha256(stableJson(review)), targets: scored.length,
    ownerChoices: countBy(scored, row => row.ownerDecision),
    ownerPointLabels: scored.filter(row => row.ownerPoint).length,
    modelScopes: countBy(scored, row => row.modelScope),
    resolvedPresentations: countBy(scored, row => row.resolution?.presentation),
    candidateValidation: {
      assessments: assessments.length,
      verdicts: countBy(assessments, assessment => assessment.verdict),
      selectedExisting: scored.filter(row => row.modelSelectedCandidateId !== null).length,
      suggestedNewPoints: scored.filter(row => row.modelSuggestedPoint !== null).length,
      appliedNewPoints: scored.filter(row => row.resolution?.reason?.startsWith('new-point-')).length,
    },
    // Primary coordinate score: only genuinely unique point targets. Representative examples are
    // set-valued, so their owner distance is retained as a diagnostic rather than called accuracy.
    uniquePointDistance: summarizePointDistances(unique.map(row => row.distance)),
    uniquePointBaselines: {
      current: summarizePointDistances(unique.map(row => row.currentDistance)),
      bestExistingCandidate: summarizePointDistances(unique.map(row => row.bestExistingCandidateDistance)),
    },
    representativeDistanceDiagnostic: summarizePointDistances(representative.map(row => row.distance)),
    allResolvedPointDistanceDiagnostic: summarizePointDistances(scored.map(row => row.distance)),
    rows: scored,
  };
}

async function execute() {
  if (process.env.PASS_B_SPATIAL_LIVE !== '1') throw new Error('--run requires PASS_B_SPATIAL_LIVE=1');
  if (existsSync(outDir)) throw new Error(`refusing to overwrite existing canary: ${outDir}`);
  mkdirSync(join(outDir, 'works'), { recursive: true, mode: 0o700 });
  writeFileSync(join(outDir, 'run-manifest.json'), `${JSON.stringify({ ...binding, runId }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  const results = new Map();
  for (const work of selected) {
    const response = await callLocalizer(work);
    const prefix = join(outDir, 'works', safeId(work.id));
    writeFileSync(`${prefix}.input.json`, `${JSON.stringify(work.input, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    if (response.transcript) writeFileSync(`${prefix}.transcript.jsonl`, response.transcript, { flag: 'wx', mode: 0o600 });
    writeFileSync(`${prefix}.result.json`, `${JSON.stringify({ ok: response.ok, errors: response.errors, evidence: response.evidence, result: response.result }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    results.set(work.id, response);
    console.log(`${response.ok ? 'ok' : 'FAIL'} ${work.id}: ${work.input.targets.length} targets, ${Math.round(response.evidence.durationMs / 1000)}s`);
  }
  // Deliberately delayed: owner answers are opened only after all image calls finish.
  let score = null;
  if (reviewPath) {
    const review = JSON.parse(readFileSync(resolve(reviewPath), 'utf8'));
    if (review.runId !== sourceManifest.runId) throw new Error(`review runId ${review.runId} does not match ${sourceManifest.runId}`);
    if (sourceManifest.evidenceManifestSha256 && review.evidenceManifestSha256 !== sourceManifest.evidenceManifestSha256) throw new Error('review evidence manifest mismatch');
    score = scoreAgainstOwner(results, review);
    writeFileSync(join(outDir, 'owner-blind-score.json'), `${JSON.stringify(score, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  }
  const ok = [...results.values()].filter(result => result.ok).length;
  writeFileSync(join(outDir, 'summary.json'), `${JSON.stringify({ runId, ok, failed: results.size - ok, score }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(`DONE ${ok}/${results.size}; ${outDir}`);
  if (score) console.log(`owner-blind unique-point score: ${score.uniquePointDistance.comparable} comparable; within5 ${score.uniquePointDistance.within5}; median ${score.uniquePointDistance.median}`);
}

if (run) await execute(); else printPlan();
