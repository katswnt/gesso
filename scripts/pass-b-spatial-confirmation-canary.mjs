#!/usr/bin/env node
// Subscription-backed independent confirmation for new Pass-B hotspot coordinates (VSD-031).
//
// Default is PLAN ONLY. It consumes a preserved, strict-valid candidate-validation canary and selects
// only first-pass decisions that rejected every existing candidate and suggested a fresh point. Each
// second checker runs in a fresh process and sees the image plus short target label, but never the first
// point, candidate points, first-pass reasoning, owner review, or owner coordinates. Deterministic code
// compares the two points only after the call.
//
//   node scripts/pass-b-spatial-confirmation-canary.mjs \
//     --primary data/incoming/vision-calibration/b5c-f2020a1d8cca
//   PASS_B_SPATIAL_LIVE=1 node scripts/pass-b-spatial-confirmation-canary.mjs --run \
//     --primary data/incoming/vision-calibration/b5c-f2020a1d8cca \
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
  CONFIRMATION_INPUT_VERSION, CONFIRMATION_RESULT_VERSION, CONFIRMATION_WIRE_SCHEMA,
  LOCALIZATION_RESULT_VERSION, NEW_POINT_CONFIRMATION_DISTANCE, SPATIAL_CALIBRATION_VERSION,
  buildConfirmationInput, buildConfirmationPrompt, pointDistance, resolveConfirmedLocalization,
  spatialRowsForWork, summarizePointDistances, validateConfirmationResult, validateLocalizationResult,
} from './lib/pass-b-spatial-policy.mjs';

const execFileP = promisify(execFile);
const args = process.argv.slice(2);
const valueAfter = flag => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : null; };
const run = args.includes('--run');
const reviewPath = valueAfter('--review');
const primaryRun = resolve(valueAfter('--primary') || 'data/incoming/vision-calibration/b5c-f2020a1d8cca');
const primaryManifestPath = join(primaryRun, 'run-manifest.json');
if (!existsSync(primaryManifestPath)) throw new Error(`missing primary manifest: ${primaryManifestPath}`);
const primaryManifest = JSON.parse(readFileSync(primaryManifestPath, 'utf8'));
const acceptedPrimaryPolicies = new Set(['passBSpatialCalibration/4', SPATIAL_CALIBRATION_VERSION]);
if (!acceptedPrimaryPolicies.has(primaryManifest.spatialPolicyVersion)) throw new Error(`unsupported primary spatial policy: ${primaryManifest.spatialPolicyVersion}`);
if (primaryManifest.localizationSchema !== LOCALIZATION_RESULT_VERSION) throw new Error(`unsupported primary localization schema: ${primaryManifest.localizationSchema}`);
if (primaryManifest.model !== CALIBRATION_MODEL) throw new Error(`primary model mismatch: ${primaryManifest.model}`);

const sourceRun = resolve(primaryManifest.sourceRun);
const sourceManifest = JSON.parse(readFileSync(join(sourceRun, 'run-manifest.json'), 'utf8'));
if (sourceManifest.runId !== primaryManifest.sourceRunId) throw new Error('primary/source runId mismatch');
if ((sourceManifest.evidenceManifestSha256 ?? null) !== (primaryManifest.sourceEvidenceManifestSha256 ?? null)) throw new Error('primary/source evidence manifest mismatch');
const upstreamRun = resolve(sourceManifest.upstreamRun || 'data/incoming/vision-calibration/cal50-0a47b6f7f332');
const calibrationRoot = dirname(sourceRun);
const imageDirName = readdirSync(calibrationRoot).find(name => /^imgs-/.test(name));
if (!imageDirName) throw new Error(`no imgs-* directory under ${calibrationRoot}`);
const imageDir = join(calibrationRoot, imageDirName);
const safeId = id => id.replace(/[^a-z0-9]+/gi, '_');
const fileSha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const b0Path = id => join(upstreamRun, 'works', sha256(id).slice(0, 24), 'b0-prep.json');

const sourceRecords = new Map(readdirSync(join(sourceRun, 'works'))
  .filter(file => file.endsWith('.b4.json'))
  .map(file => {
    const path = join(sourceRun, 'works', file);
    const value = JSON.parse(readFileSync(path, 'utf8'));
    return [value.id, { path, value }];
  }));

function loadPrimaryWork(id) {
  const prefix = join(primaryRun, 'works', safeId(id));
  const inputPath = `${prefix}.input.json`;
  const resultPath = `${prefix}.result.json`;
  const transcriptPath = `${prefix}.transcript.jsonl`;
  for (const path of [inputPath, resultPath, transcriptPath]) if (!existsSync(path)) throw new Error(`${id}: missing primary artifact ${path}`);
  const input = JSON.parse(readFileSync(inputPath, 'utf8'));
  const response = JSON.parse(readFileSync(resultPath, 'utf8'));
  const transcriptRaw = readFileSync(transcriptPath, 'utf8');
  const transcript = parseStreamTranscript(transcriptRaw);
  const final = transcriptFinal(transcript);
  const binding = primaryManifest.bindings?.[id];
  const errors = [];
  if (!binding) errors.push('missing primary binding');
  if (binding?.imageSha256 !== input.imageSha256) errors.push('primary image binding mismatch');
  if (binding?.localizationInputSha256 !== sha256(stableJson(input))) errors.push('primary input hash mismatch');
  if (!response.ok) errors.push('primary completion was not accepted');
  if (response.evidence?.transcriptSha256 !== sha256(transcriptRaw)) errors.push('primary transcript hash mismatch');
  if (primaryModelFromEnvelope(final) !== CALIBRATION_MODEL) errors.push('primary transcript model mismatch');
  if (transcript.init?.apiKeySource !== 'none') errors.push(`primary apiKeySource was ${transcript.init?.apiKeySource}`);
  const imageFile = neutralImageFile(input.imageSha256, input.imageExt);
  const receipt = verifyB1ImageRead(transcript, { callDir: null, imageBasename: imageFile });
  if (!receipt.ok) errors.push(`primary image receipt: ${receipt.reason}`);
  if (stableJson(final?.structured_output ?? null) !== stableJson(response.result ?? null)) errors.push('primary structured output mismatch');
  const validation = validateLocalizationResult(input, response.result);
  if (!validation.ok) errors.push(...validation.errors.map(error => `primary result: ${error}`));
  if (errors.length) throw new Error(`${id}: ${errors.join('; ')}`);

  const source = sourceRecords.get(id);
  if (!source?.value?.ok) throw new Error(`${id}: missing completed source B4 record`);
  if (binding.sourceRecordSha256 !== fileSha(source.path)) throw new Error(`${id}: source record hash mismatch`);
  const b0 = JSON.parse(readFileSync(b0Path(id), 'utf8'));
  if (b0.image.imgSha256 !== input.imageSha256 || b0.image.ext !== input.imageExt) throw new Error(`${id}: B0 image mismatch`);
  const rows = spatialRowsForWork({
    workId: id, imageSha256: b0.image.imgSha256, legacyImageSha256: b0.image.imgSha256,
    delta: source.value.rawDelta, body: source.value.body, hydration: source.value.hydration, legacy: b0.legacy,
  });
  const confirmationInput = buildConfirmationInput({ localizationInput: input, localizationResult: response.result });
  return {
    id, input, primaryResult: response.result, primaryResultPath: resultPath,
    primaryTranscriptPath: transcriptPath, b0, rows, confirmationInput,
  };
}

const selected = (primaryManifest.works || []).map(loadPrimaryWork).filter(work => work.confirmationInput.targets.length);
const bindings = Object.fromEntries(selected.map(work => [work.id, {
  imageSha256: work.input.imageSha256,
  primaryInputSha256: sha256(stableJson(work.input)),
  primaryResultFileSha256: fileSha(work.primaryResultPath),
  primaryTranscriptSha256: fileSha(work.primaryTranscriptPath),
  confirmationInputSha256: sha256(stableJson(work.confirmationInput)),
}]));
const binding = {
  version: 'passBSpatialConfirmationCanary/2',
  primaryRun, primaryRunId: primaryManifest.runId, primaryManifestSha256: fileSha(primaryManifestPath),
  primarySpatialPolicyVersion: primaryManifest.spatialPolicyVersion,
  sourceRun, sourceRunId: sourceManifest.runId,
  sourceEvidenceManifestSha256: sourceManifest.evidenceManifestSha256 ?? null,
  spatialPolicyVersion: SPATIAL_CALIBRATION_VERSION,
  confirmationInputVersion: CONFIRMATION_INPUT_VERSION,
  confirmationResultVersion: CONFIRMATION_RESULT_VERSION,
  agreementDistance: NEW_POINT_CONFIRMATION_DISTANCE,
  model: CALIBRATION_MODEL,
  works: selected.map(work => work.id), bindings,
};
const runId = `b5k-${sha256(stableJson(binding)).slice(0, 12)}`;
const outDir = join(calibrationRoot, runId);

function printPlan() {
  console.log('Pass-B blind new-point confirmation canary (VSD-031) — PLAN ONLY');
  console.log(`primary: ${primaryRun}`);
  console.log(`source: ${sourceRun}`);
  console.log(`output: ${outDir}`);
  console.log(`agreement: matching scope and <= ${NEW_POINT_CONFIRMATION_DISTANCE} points`);
  console.log(`calls: ${selected.length}; targets: ${selected.reduce((sum, work) => sum + work.confirmationInput.targets.length, 0)}`);
  for (const work of selected) console.log(`  ${work.id}: ${work.confirmationInput.targets.length} target(s)`);
  console.log('Second-pass input excludes every first-pass/candidate point, first-pass reasoning, owner note, and owner coordinate.');
  console.log('Run: PASS_B_SPATIAL_LIVE=1 node scripts/pass-b-spatial-confirmation-canary.mjs --run --primary <b5c-run> --review <export.json>');
}

async function callConfirmer(work) {
  const imageFile = neutralImageFile(work.input.imageSha256, work.input.imageExt);
  const sourceImage = join(imageDir, imageFile);
  if (!existsSync(sourceImage)) throw new Error(`${work.id}: missing image ${sourceImage}`);
  const callDir = mkdtempSync(join(tmpdir(), 'pass-b-spatial-confirm-'));
  const started = Date.now();
  try {
    copyFileSync(sourceImage, join(callDir, imageFile));
    const promptText = buildConfirmationPrompt(work.confirmationInput, imageFile);
    const command = buildStageCommand({ stage: 'B5', promptText, imageFile, wireSchema: CONFIRMATION_WIRE_SCHEMA });
    const env = { ...process.env }; for (const key of command.env.removeKeys) delete env[key];
    let stdout = ''; let exitCode = 0;
    try { ({ stdout } = await execFileP(command.bin, command.argv, { cwd: callDir, env, maxBuffer: 32 * 1024 * 1024 })); }
    catch (error) { exitCode = error.code ?? 1; stdout = error.stdout || ''; }
    const transcript = parseStreamTranscript(stdout);
    const final = transcriptFinal(transcript);
    const result = final?.structured_output ?? null;
    const receipt = verifyB1ImageRead(transcript, { callDir, imageBasename: imageFile });
    const validation = result ? validateConfirmationResult(work.confirmationInput, result) : { ok: false, errors: ['missing structured output'] };
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

function resolutions(results) {
  const rows = [];
  for (const work of selected) {
    const primaryDecisions = new Map(work.primaryResult.decisions.map(decision => [decision.requestId, decision]));
    const response = results.get(work.id);
    const confirmationDecisions = new Map((response?.ok ? response.result.decisions : []).map(decision => [decision.requestId, decision]));
    for (const target of work.confirmationInput.targets) {
      const row = work.rows.find(value => value.deltaIndex === target.deltaIndex);
      const primaryDecision = primaryDecisions.get(target.requestId);
      const confirmationDecision = confirmationDecisions.get(target.requestId) || null;
      const resolution = resolveConfirmedLocalization(row, primaryDecision, confirmationDecision);
      rows.push({
        workId: work.id, deltaIndex: target.deltaIndex, requestId: target.requestId,
        primaryScope: primaryDecision.scope, primaryPoint: primaryDecision.suggestedPoint,
        confirmationScope: confirmationDecision?.scope ?? null, confirmationPoint: confirmationDecision?.point ?? null,
        confirmationConfidence: confirmationDecision?.confidence ?? null,
        resolution: {
          presentation: resolution.presentation, point: resolution.point ?? null,
          status: resolution.status, trustTier: resolution.trustTier, reason: resolution.reason,
          confirmationDistance: resolution.confirmationDistance ?? null,
        },
      });
    }
  }
  const countBy = getter => Object.fromEntries([...rows.reduce((map, row) => {
    const key = getter(row) ?? 'none'; map.set(key, (map.get(key) || 0) + 1); return map;
  }, new Map()).entries()].sort(([left], [right]) => left.localeCompare(right)));
  return {
    targets: rows.length,
    presentations: countBy(row => row.resolution.presentation),
    trustTiers: countBy(row => row.resolution.trustTier),
    reasons: countBy(row => row.resolution.reason),
    rows,
  };
}

function scoreAgainstOwner(outcome, review) {
  const reviewByWork = new Map((review?.works || []).map(work => [work.workId, work]));
  const scored = outcome.rows.map(value => {
    const work = selected.find(item => item.id === value.workId);
    const row = work.rows.find(item => item.deltaIndex === value.deltaIndex);
    const reviewed = reviewByWork.get(value.workId);
    const owner = (reviewed?.hotspots || []).find(item => item.deltaIndex === value.deltaIndex)?.review;
    const ownerPoint = owner?.decision === 'move' ? { x: owner.x, y: owner.y }
      : owner?.decision === 'keep' ? row.currentPoint : null;
    return {
      ...value, ownerDecision: owner?.decision || 'abstain', ownerPoint,
      primaryDistance: pointDistance(ownerPoint, value.primaryPoint),
      confirmedDistance: value.resolution.presentation === 'pin' ? pointDistance(ownerPoint, value.resolution.point) : null,
      confirmationDistanceToOwner: pointDistance(ownerPoint, value.confirmationPoint),
    };
  });
  return {
    version: 'passBSpatialConfirmationScore/1', reviewVersion: review?.version ?? null,
    reviewSha256: sha256(stableJson(review)), targets: scored.length,
    ownerPointLabels: scored.filter(row => row.ownerPoint).length,
    primaryDistance: summarizePointDistances(scored.map(row => row.primaryDistance)),
    autoConfirmedDistance: summarizePointDistances(scored.map(row => row.confirmedDistance)),
    confirmationDistanceToOwner: summarizePointDistances(scored.map(row => row.confirmationDistanceToOwner)),
    rows: scored,
  };
}

async function execute() {
  if (process.env.PASS_B_SPATIAL_LIVE !== '1') throw new Error('--run requires PASS_B_SPATIAL_LIVE=1');
  if (existsSync(outDir)) throw new Error(`refusing to overwrite existing confirmation canary: ${outDir}`);
  mkdirSync(join(outDir, 'works'), { recursive: true, mode: 0o700 });
  writeFileSync(join(outDir, 'run-manifest.json'), `${JSON.stringify({ ...binding, runId }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  const results = new Map();
  for (const work of selected) {
    const response = await callConfirmer(work);
    const prefix = join(outDir, 'works', safeId(work.id));
    writeFileSync(`${prefix}.input.json`, `${JSON.stringify(work.confirmationInput, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    if (response.transcript) writeFileSync(`${prefix}.transcript.jsonl`, response.transcript, { flag: 'wx', mode: 0o600 });
    writeFileSync(`${prefix}.result.json`, `${JSON.stringify({ ok: response.ok, errors: response.errors, evidence: response.evidence, result: response.result }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    results.set(work.id, response);
    console.log(`${response.ok ? 'ok' : 'FAIL'} ${work.id}: ${work.confirmationInput.targets.length} target(s), ${Math.round(response.evidence.durationMs / 1000)}s`);
  }
  const outcome = resolutions(results);
  writeFileSync(join(outDir, 'resolution-summary.json'), `${JSON.stringify(outcome, null, 2)}\n`, { flag: 'wx', mode: 0o600 });

  // Deliberately delayed: owner answers are opened only after every independent image call finishes.
  let score = null;
  if (reviewPath) {
    const review = JSON.parse(readFileSync(resolve(reviewPath), 'utf8'));
    if (review.runId !== sourceManifest.runId) throw new Error(`review runId ${review.runId} does not match ${sourceManifest.runId}`);
    if (sourceManifest.evidenceManifestSha256 && review.evidenceManifestSha256 !== sourceManifest.evidenceManifestSha256) throw new Error('review evidence manifest mismatch');
    score = scoreAgainstOwner(outcome, review);
    writeFileSync(join(outDir, 'owner-blind-score.json'), `${JSON.stringify(score, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  }
  const ok = [...results.values()].filter(result => result.ok).length;
  writeFileSync(join(outDir, 'summary.json'), `${JSON.stringify({ runId, ok, failed: results.size - ok, outcome, score }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(`DONE ${ok}/${results.size}; ${outDir}`);
  console.log(`blind-confirmed ${outcome.trustTiers['blind-confirmed-new-point'] || 0}; held ${outcome.presentations.hold || 0}`);
}

if (run) await execute(); else printPlan();
