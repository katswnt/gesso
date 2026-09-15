#!/usr/bin/env node
// Offline Pass-B spatial resolver and exceptions-only owner packet (VSD-032).
//
// Reads preserved B5 candidate-validation and optional blind-confirmation evidence, independently
// re-verifies their transcripts/bindings, applies the current deterministic spatial policy, and writes
// a quarantined resolution report plus a self-contained HTML packet containing ONLY held exceptions.
// It never calls a model, changes B1-B5 evidence, records approval, or writes production data.
//
// Plan only:
//   node scripts/pass-b-spatial-resolution-packet.mjs \
//     --primary data/incoming/vision-calibration/b5c-f2020a1d8cca \
//     --confirmation data/incoming/vision-calibration/b5k-9e3a46a675ae
// Write a new derived run:
//   node scripts/pass-b-spatial-resolution-packet.mjs --write --primary <b5c-run> --confirmation <b5k-run>
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import sharp from 'sharp';
import { hotspotReviewRows } from './lib/pass-b-editorial-review.mjs';
import {
  CALIBRATION_MODEL, neutralImageFile, parseStreamTranscript, primaryModelFromEnvelope,
  transcriptFinal, verifyB1ImageRead,
} from './lib/pass-b-calibration.mjs';
import {
  CONFIRMATION_INPUT_VERSION, CONFIRMATION_RESULT_VERSION, LOCALIZATION_INPUT_VERSION,
  LOCALIZATION_RESULT_VERSION, NEW_POINT_CONFIRMATION_DISTANCE, SPATIAL_CALIBRATION_VERSION,
  buildConfirmationInput, buildLocalizationInput, legacyImageSha256FromB0, resolveConfirmedLocalization, spatialRowsForWork,
  validateConfirmationResult, validateLocalizationResult,
} from './lib/pass-b-spatial-policy.mjs';
import { sha256, stableJson } from './lib/vision-legacy.mjs';

const VERSION = 'passBSpatialResolution/2';
const REVIEW_VERSION = 'passBSpatialExceptionReview/3';
const args = process.argv.slice(2);
const valueAfter = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const primaryRun = resolve(valueAfter('--primary') || 'data/incoming/vision-calibration/b5c-f2020a1d8cca');
const confirmationArg = valueAfter('--confirmation');
const confirmationRun = confirmationArg ? resolve(confirmationArg) : null;
const write = args.includes('--write');
const safeId = id => id.replace(/[^a-z0-9]+/gi, '_');
const fileSha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));
const point = value => value && Number.isFinite(value.x) && Number.isFinite(value.y)
  ? { x: value.x, y: value.y } : null;

const primaryManifestPath = join(primaryRun, 'run-manifest.json');
if (!existsSync(primaryManifestPath)) throw new Error(`missing primary manifest: ${primaryManifestPath}`);
const primaryManifest = readJson(primaryManifestPath);
if (!String(primaryManifest.version || '').startsWith('passBSpatialLocalizationCanary/')) throw new Error('not a spatial-localization primary run');
if (primaryManifest.spatialPolicyVersion !== SPATIAL_CALIBRATION_VERSION) throw new Error(`stale primary spatial policy: ${primaryManifest.spatialPolicyVersion}; expected ${SPATIAL_CALIBRATION_VERSION}`);
if (primaryManifest.localizationSchema !== LOCALIZATION_RESULT_VERSION) throw new Error(`unsupported primary schema: ${primaryManifest.localizationSchema}`);
if (primaryManifest.model !== CALIBRATION_MODEL) throw new Error(`primary model drift: ${primaryManifest.model}`);

const sourceRun = resolve(primaryManifest.sourceRun);
const sourceManifestPath = join(sourceRun, 'run-manifest.json');
const sourceManifest = readJson(sourceManifestPath);
if (sourceManifest.runId !== primaryManifest.sourceRunId) throw new Error('primary/source runId mismatch');
if ((sourceManifest.evidenceManifestSha256 ?? null) !== (primaryManifest.sourceEvidenceManifestSha256 ?? null)) throw new Error('primary/source evidence manifest mismatch');
const calibrationRoot = dirname(sourceRun);
const upstreamRun = resolve(sourceManifest.upstreamRun || 'data/incoming/vision-calibration/cal50-0a47b6f7f332');
const imageDirName = readdirSync(calibrationRoot).find(name => /^imgs-/.test(name));
if (!imageDirName) throw new Error(`no imgs-* directory under ${calibrationRoot}`);
const imageDir = join(calibrationRoot, imageDirName);
const b0Path = id => join(upstreamRun, 'works', sha256(id).slice(0, 24), 'b0-prep.json');
const sourceRecords = new Map(readdirSync(join(sourceRun, 'works')).filter(file => file.endsWith('.b4.json')).map(file => {
  const path = join(sourceRun, 'works', file); const value = readJson(path); return [value.id, { path, value }];
}));

let confirmationManifest = null;
let confirmationManifestPath = null;
if (confirmationRun) {
  confirmationManifestPath = join(confirmationRun, 'run-manifest.json');
  confirmationManifest = readJson(confirmationManifestPath);
  if (!String(confirmationManifest.version || '').startsWith('passBSpatialConfirmationCanary/')) throw new Error('not a blind-confirmation run');
  if (confirmationManifest.primaryRunId !== primaryManifest.runId) throw new Error('confirmation/primary runId mismatch');
  if (confirmationManifest.primaryManifestSha256 !== fileSha(primaryManifestPath)) throw new Error('confirmation/primary manifest hash mismatch');
  if (confirmationManifest.sourceRunId !== sourceManifest.runId) throw new Error('confirmation/source runId mismatch');
  if ((confirmationManifest.sourceEvidenceManifestSha256 ?? null) !== (sourceManifest.evidenceManifestSha256 ?? null)) throw new Error('confirmation/source evidence mismatch');
  if (confirmationManifest.confirmationInputVersion !== CONFIRMATION_INPUT_VERSION || confirmationManifest.confirmationResultVersion !== CONFIRMATION_RESULT_VERSION) throw new Error('unsupported confirmation schema');
  if (confirmationManifest.model !== CALIBRATION_MODEL) throw new Error(`confirmation model drift: ${confirmationManifest.model}`);
}

function verifyTranscript({ id, input, response, transcriptPath, kind }) {
  const raw = readFileSync(transcriptPath, 'utf8');
  const transcript = parseStreamTranscript(raw);
  const final = transcriptFinal(transcript);
  const errors = [];
  if (!response.ok || response.errors?.length) errors.push('completion was not accepted');
  if (response.evidence?.transcriptSha256 !== sha256(raw)) errors.push('transcript hash mismatch');
  if (primaryModelFromEnvelope(final) !== CALIBRATION_MODEL) errors.push('transcript model mismatch');
  if (transcript.init?.apiKeySource !== 'none') errors.push(`apiKeySource was ${transcript.init?.apiKeySource}`);
  const imageFile = neutralImageFile(input.imageSha256, input.imageExt);
  const receipt = verifyB1ImageRead(transcript, { callDir: null, imageBasename: imageFile });
  if (!receipt.ok) errors.push(`image receipt: ${receipt.reason}`);
  if (stableJson(final?.structured_output ?? null) !== stableJson(response.result ?? null)) errors.push('structured output mismatch');
  const validation = kind === 'primary' ? validateLocalizationResult(input, response.result) : validateConfirmationResult(input, response.result);
  if (!validation.ok) errors.push(...validation.errors.map(error => `strict result: ${error}`));
  if (errors.length) throw new Error(`${id}: ${kind}: ${errors.join('; ')}`);
  return { transcriptSha256: sha256(raw), resultFileSha256: null, receipt };
}

function loadPrimary(id) {
  const prefix = join(primaryRun, 'works', safeId(id));
  const inputPath = `${prefix}.input.json`; const resultPath = `${prefix}.result.json`; const transcriptPath = `${prefix}.transcript.jsonl`;
  for (const path of [inputPath, resultPath, transcriptPath]) if (!existsSync(path)) throw new Error(`${id}: missing primary artifact ${path}`);
  const input = readJson(inputPath); const response = readJson(resultPath);
  if (input.version !== LOCALIZATION_INPUT_VERSION || input.workId !== id) throw new Error(`${id}: primary input identity/version mismatch`);
  const binding = primaryManifest.bindings?.[id];
  if (!binding) throw new Error(`${id}: missing primary binding`);
  if (binding.imageSha256 !== input.imageSha256) throw new Error(`${id}: primary image binding mismatch`);
  if (binding.localizationInputSha256 !== sha256(stableJson(input))) throw new Error(`${id}: primary input hash mismatch`);
  const source = sourceRecords.get(id);
  if (!source?.value?.ok) throw new Error(`${id}: source B4 record is not completed`);
  if (binding.sourceRecordSha256 !== fileSha(source.path)) throw new Error(`${id}: source record hash mismatch`);
  const b0 = readJson(b0Path(id));
  if (b0.image?.imgSha256 !== input.imageSha256 || b0.image?.ext !== input.imageExt) throw new Error(`${id}: B0 image mismatch`);
  const sourceImage = join(imageDir, neutralImageFile(input.imageSha256, input.imageExt));
  if (!existsSync(sourceImage) || fileSha(sourceImage) !== input.imageSha256) throw new Error(`${id}: source image bytes do not match the bound SHA`);
  const rows = spatialRowsForWork({
    workId: id, imageSha256: b0.image.imgSha256, legacyImageSha256: legacyImageSha256FromB0(b0),
    delta: source.value.rawDelta, body: source.value.body, hydration: source.value.hydration, legacy: b0.legacy,
  });
  const rebuilt = buildLocalizationInput({ workId: id, imageSha256: b0.image.imgSha256, imageExt: b0.image.ext, rows, mode: input.mode });
  if (stableJson(rebuilt) !== stableJson(input)) throw new Error(`${id}: primary input no longer reconstructs from source evidence`);
  const verified = verifyTranscript({ id, input, response, transcriptPath, kind: 'primary' });
  return { id, input, result: response.result, response, resultPath, transcriptPath, verified, source, b0, rows };
}

function loadConfirmation(work) {
  if (!confirmationManifest || !(confirmationManifest.works || []).includes(work.id)) return null;
  const prefix = join(confirmationRun, 'works', safeId(work.id));
  const inputPath = `${prefix}.input.json`; const resultPath = `${prefix}.result.json`; const transcriptPath = `${prefix}.transcript.jsonl`;
  for (const path of [inputPath, resultPath, transcriptPath]) if (!existsSync(path)) throw new Error(`${work.id}: missing confirmation artifact ${path}`);
  const input = readJson(inputPath); const response = readJson(resultPath); const binding = confirmationManifest.bindings?.[work.id];
  if (!binding) throw new Error(`${work.id}: missing confirmation binding`);
  if (binding.imageSha256 !== work.input.imageSha256) throw new Error(`${work.id}: confirmation image binding mismatch`);
  if (binding.primaryInputSha256 !== sha256(stableJson(work.input))) throw new Error(`${work.id}: confirmation primary-input mismatch`);
  if (binding.primaryResultFileSha256 !== fileSha(work.resultPath)) throw new Error(`${work.id}: bound primary result file mismatch`);
  if (binding.primaryTranscriptSha256 !== fileSha(work.transcriptPath)) throw new Error(`${work.id}: bound primary transcript mismatch`);
  if (binding.confirmationInputSha256 !== sha256(stableJson(input))) throw new Error(`${work.id}: confirmation input hash mismatch`);
  const rebuilt = buildConfirmationInput({ localizationInput: work.input, localizationResult: work.result });
  if (stableJson(rebuilt) !== stableJson(input)) throw new Error(`${work.id}: confirmation input is not the blind derivation of primary evidence`);
  const verified = verifyTranscript({ id: work.id, input, response, transcriptPath, kind: 'confirmation' });
  return { input, result: response.result, response, inputPath, resultPath, transcriptPath, verified };
}

const primaryWorks = (primaryManifest.works || []).map(loadPrimary);
if (!primaryWorks.length) throw new Error('primary run contains no works');
const reviewRowsByWork = new Map(primaryWorks.map(work => [work.id, new Map(hotspotReviewRows({
  delta: work.source.value.rawDelta, body: work.source.value.body, hydration: work.source.value.hydration,
}).map(row => [row.deltaIndex, row]))]));

const workResults = primaryWorks.map(work => {
  const confirmation = loadConfirmation(work);
  const primaryDecisions = new Map(work.result.decisions.map(decision => [decision.requestId, decision]));
  const confirmationDecisions = new Map((confirmation?.result.decisions || []).map(decision => [decision.requestId, decision]));
  const rowsByDelta = new Map(work.rows.map(row => [row.deltaIndex, row]));
  const reviewRows = reviewRowsByWork.get(work.id);
  const targets = work.input.targets.map(target => {
    const row = rowsByDelta.get(target.deltaIndex); const copy = reviewRows.get(target.deltaIndex);
    if (!row || !copy) throw new Error(`${work.id}: missing source row for delta ${target.deltaIndex}`);
    const primaryDecision = primaryDecisions.get(target.requestId);
    if (!primaryDecision) throw new Error(`${work.id}: missing primary decision ${target.requestId}`);
    const confirmationDecision = confirmationDecisions.get(target.requestId) || null;
    const resolution = resolveConfirmedLocalization(row, primaryDecision, confirmationDecision);
    const compoundSpatialSignal = ['point', 'representative'].includes(primaryDecision.scope)
      && ['distributed', 'global'].includes(confirmationDecision?.scope);
    return {
      requestId: target.requestId, deltaIndex: target.deltaIndex,
      title: copy.title, description: copy.description, role: copy.role, evidenceAxis: copy.evidenceAxis,
      sourceState: copy.state, sourceAction: copy.action, evidenceRef: copy.evidenceRef,
      candidates: row.candidates.map(candidate => ({ ...candidate, point: point(candidate.point) })),
      currentPoint: point(row.currentPoint), legacyPoint: point(row.legacyCandidate?.point),
      legacyPointEligible: row.legacyCoordinateEligible,
      primary: {
        scope: primaryDecision.scope, confidence: primaryDecision.confidence, point: point(primaryDecision.suggestedPoint),
        note: primaryDecision.note, candidateAssessments: primaryDecision.candidateAssessments,
      },
      confirmation: confirmationDecision ? {
        scope: confirmationDecision.scope, confidence: confirmationDecision.confidence,
        point: point(confirmationDecision.point), note: confirmationDecision.note,
      } : null,
      resolution: {
        presentation: resolution.presentation, point: point(resolution.point), proposedPoint: point(resolution.proposedPoint),
        confirmationPoint: point(resolution.confirmationPoint), confirmationDistance: resolution.confirmationDistance ?? null,
        status: resolution.status, trustTier: resolution.trustTier, reason: resolution.reason,
      },
      compoundSpatialSignal,
    };
  });
  const spatialStatus = targets.some(target => target.resolution.presentation === 'hold')
    ? 'spatial-review-required' : 'spatial-resolved';
  return {
    workId: work.id, title: work.b0.trustedCatalog?.title || work.id, artist: work.b0.trustedCatalog?.artist || '',
    imageSha256: work.input.imageSha256, imageExt: work.input.imageExt, targets,
    status: { spatial: spatialStatus, content: 'not-assessed', combinedResolved: false },
    evidence: {
      sourceRecordSha256: fileSha(work.source.path), primaryInputSha256: sha256(stableJson(work.input)),
      primaryResultFileSha256: fileSha(work.resultPath), primaryTranscriptSha256: work.verified.transcriptSha256,
      confirmationInputSha256: confirmation ? sha256(stableJson(confirmation.input)) : null,
      confirmationResultFileSha256: confirmation ? fileSha(confirmation.resultPath) : null,
      confirmationTranscriptSha256: confirmation?.verified.transcriptSha256 ?? null,
    },
  };
});

const allTargets = workResults.flatMap(work => work.targets.map(target => ({ ...target, workId: work.workId })));
const exceptions = allTargets.filter(target => target.resolution.presentation === 'hold');
const countBy = (values, getter) => Object.fromEntries([...values.reduce((map, value) => {
  const key = getter(value) ?? 'none'; map.set(key, (map.get(key) || 0) + 1); return map;
}, new Map()).entries()].sort(([a], [b]) => a.localeCompare(b)));
const summary = {
  works: workResults.length, targets: allTargets.length, exceptions: exceptions.length,
  presentations: countBy(allTargets, target => target.resolution.presentation),
  trustTiers: countBy(allTargets, target => target.resolution.trustTier),
  reasons: countBy(allTargets, target => target.resolution.reason),
  compoundNoteRoutes: allTargets.filter(target => target.compoundSpatialSignal && target.resolution.presentation === 'note').length,
};
const binding = {
  version: VERSION, primaryRunId: primaryManifest.runId, primaryManifestSha256: fileSha(primaryManifestPath),
  confirmationRunId: confirmationManifest?.runId ?? null,
  confirmationManifestSha256: confirmationManifestPath ? fileSha(confirmationManifestPath) : null,
  sourceRunId: sourceManifest.runId, sourceEvidenceManifestSha256: sourceManifest.evidenceManifestSha256 ?? null,
  resolverPolicyVersion: SPATIAL_CALIBRATION_VERSION, agreementDistance: NEW_POINT_CONFIRMATION_DISTANCE,
  packetVersion: REVIEW_VERSION,
  workEvidence: Object.fromEntries(workResults.map(work => [work.workId, work.evidence])),
};
const runId = `b5r-${sha256(stableJson(binding)).slice(0, 12)}`;
const outDir = join(calibrationRoot, runId);
const resolutionReport = { ...binding, runId, createdAt: new Date().toISOString(), summary, works: workResults };

async function imageData(work) {
  const name = neutralImageFile(work.imageSha256, work.imageExt); const path = join(imageDir, name);
  if (!existsSync(path) || fileSha(path) !== work.imageSha256) throw new Error(`${work.workId}: missing or mismatched source image`);
  const data = await sharp(readFileSync(path)).resize({ width: 1000, withoutEnlargement: true }).jpeg({ quality: 76 }).toBuffer();
  return `data:image/jpeg;base64,${data.toString('base64')}`;
}

const fmtPoint = value => value ? `${value.x.toFixed(1)}%, ${value.y.toFixed(1)}%` : 'none';
const reasonText = reason => ({
  'low-confidence-or-ambiguous-localization': 'The first checker was uncertain or called the target ambiguous.',
  'visual-target-not-found': 'The first checker could not find the claimed visible target.',
  'low-confidence-or-ambiguous-confirmation': 'The independent checker was uncertain or ambiguous.',
  'confirmation-target-not-found': 'The independent checker could not find the target.',
  'blind-confirmation-scope-disagreement': 'The two blind checks disagreed about whether one point can represent this.',
  'blind-confirmation-point-disagreement': 'Both checks found a unique point, but their locations were too far apart.',
  'uncertain-existing-candidate': 'At least one existing pin remained spatially uncertain.',
  'no-valid-candidate-or-new-point': 'No existing or newly suggested point was safe to publish.',
}[reason] || reason);

async function renderPacket() {
  const exceptionWorks = workResults.map(work => ({ ...work, targets: work.targets.filter(target => target.resolution.presentation === 'hold') })).filter(work => work.targets.length);
  const images = new Map(await Promise.all(exceptionWorks.map(async work => [work.workId, await imageData(work)])));
  const clientData = {
    version: REVIEW_VERSION, runId, primaryRunId: primaryManifest.runId,
    confirmationRunId: confirmationManifest?.runId ?? null,
    sourceRunId: sourceManifest.runId, evidenceManifestSha256: sourceManifest.evidenceManifestSha256 ?? null,
    exceptions: exceptionWorks.map(work => ({
      workId: work.workId, title: work.title,
      targets: work.targets.map(target => ({
        key: `${work.workId}:${target.deltaIndex}`, deltaIndex: target.deltaIndex, title: target.title,
        candidates: target.candidates, currentPoint: target.currentPoint, legacyPoint: target.legacyPoint,
        legacyPointEligible: target.legacyPointEligible,
        primaryPoint: target.primary.point, confirmationPoint: target.confirmation?.point ?? null,
      })),
    })),
  };
  const dataJson = JSON.stringify(clientData).replaceAll('<', '\\u003c');
  const workHtml = exceptionWorks.map((work, workIndex) => {
    const targetHtml = work.targets.map((target, targetIndex) => {
      const key = `${work.workId}:${target.deltaIndex}`;
      const choices = [
        target.currentPoint && ['use-current', `Use current · ${fmtPoint(target.currentPoint)}`],
        target.legacyPoint && ['use-legacy', `${target.legacyPointEligible ? 'Use verified previous' : 'Choose historical reference as my point'} · ${fmtPoint(target.legacyPoint)}`],
        target.primary.point && ['use-primary', `Use first check · ${fmtPoint(target.primary.point)}`],
        target.confirmation?.point && ['use-confirmation', `Use second check · ${fmtPoint(target.confirmation.point)}`],
        ['manual', 'Place manually'], ['note', 'Keep as unpinned note'], ['split', 'Split or rewrite'],
        ['discard', 'Discard this idea'], ['abstain', 'No opinion yet'],
      ].filter(Boolean).map(([value, label]) => `<button type="button" class="choice" data-choice="${value}" aria-pressed="false">${esc(label)}</button>`).join('');
      const assessments = target.primary.candidateAssessments.map(row => `<li><b>${esc(row.candidateId)}</b> · ${esc(row.verdict)} — ${esc(row.note)}</li>`).join('');
      return `<article class="exception${targetIndex === 0 ? ' active' : ''}" data-key="${esc(key)}" tabindex="-1">
        <div class="exception-head"><div><span class="eyebrow">Exception ${targetIndex + 1}</span><h3>${esc(target.title)}</h3></div><button type="button" class="show" data-show="${esc(key)}">Show on image</button></div>
        <p class="copy">${esc(target.description)}</p>
        ${target.compoundSpatialSignal ? '<p class="callout"><b>Possible compound target.</b> The independent read treated this as distributed; the automatic safe route is an unpinned note.</p>' : ''}
        <p class="why-held"><b>Why it stopped:</b> ${esc(reasonText(target.resolution.reason))}</p>
        <details><summary>Checker evidence and coordinates</summary>
          <div class="check-grid"><div><b>First check</b><br>${esc(target.primary.scope)} · ${(target.primary.confidence * 100).toFixed(0)}% · ${esc(fmtPoint(target.primary.point))}<p>${esc(target.primary.note)}</p></div>
          <div><b>Independent check</b><br>${target.confirmation ? `${esc(target.confirmation.scope)} · ${(target.confirmation.confidence * 100).toFixed(0)}% · ${esc(fmtPoint(target.confirmation.point))}<p>${esc(target.confirmation.note)}</p>` : 'Not requested or unavailable.'}</div></div>
          ${assessments ? `<ul>${assessments}</ul>` : ''}
        </details>
        <fieldset><legend>What should happen?</legend><div class="choices">${choices}</div></fieldset>
        <p class="placement-help" hidden>Click the artwork on the left to place this pin.</p>
        <label class="note-label">Note for this hotspot<textarea rows="3" data-target-note="${esc(key)}" placeholder="Optional: what is wrong, what to preserve, or what to research"></textarea></label>
        <p class="saved" role="status" aria-live="polite"></p>
      </article>`;
    }).join('');
    return `<section class="work" data-work="${esc(work.workId)}">
      <div class="visual"><div class="visual-head"><div><span class="eyebrow">${work.targets.length} exception${work.targets.length === 1 ? '' : 's'}</span><h2>${esc(work.title)}</h2><p>${esc(work.artist)}</p></div><p class="legend"><span class="dot current"></span>current <span class="dot legacy"></span>previous <span class="dot primary"></span>first <span class="dot confirmation"></span>second <span class="dot owner"></span>yours</p></div>
        <button type="button" class="image-button" data-image="${esc(work.workId)}" aria-label="Artwork. Choose Place manually, then activate this image to set the point."><img src="${images.get(work.workId)}" alt="${esc(work.title)}"><span class="overlay" aria-hidden="true"></span></button>
        <p class="image-status" role="status" aria-live="polite">Select an exception to compare its points.</p>
      </div>
      <div class="review"><div class="work-progress"><span>Work ${workIndex + 1} of ${exceptionWorks.length}</span><label>Work note<textarea rows="2" data-work-note="${esc(work.workId)}" placeholder="Optional note about the whole work"></textarea></label></div>${targetHtml}
        <fieldset class="work-decision"><legend>Spatial-review status only</legend><div class="choices"><button type="button" class="choice" data-work-choice="spatial-resolved" aria-pressed="false">Spatial exceptions resolved</button><button type="button" class="choice" data-work-choice="spatial-review-open" aria-pressed="false">Keep spatial review open</button><button type="button" class="choice" data-work-choice="abstain" aria-pressed="false">No spatial decision yet</button></div><p class="image-status">This does not approve the observation’s factual content or the work as a whole.</p></fieldset>
      </div></section>`;
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Spatial exceptions · ${esc(runId)}</title><style>
  :root{color-scheme:light;--ink:#1e2528;--muted:#667075;--paper:#f6f3ed;--panel:#fff;--line:#d8d2c8;--accent:#a44b27;--focus:#1769aa}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.5 system-ui,-apple-system,sans-serif}p{text-wrap:pretty}h1,h2,h3{text-wrap:balance}button,textarea{font:inherit}button:focus-visible,textarea:focus-visible,summary:focus-visible{outline:3px solid var(--focus);outline-offset:2px}.top{position:sticky;top:0;z-index:20;display:flex;gap:16px;align-items:center;justify-content:space-between;padding:12px 20px;background:var(--paper);border-bottom:1px solid var(--line)}.top h1{font:700 20px/1.2 Georgia,serif;margin:0}.top p{margin:2px 0 0;color:var(--muted);font-size:13px}.actions{display:flex;gap:8px;flex-wrap:wrap}.actions button,.show,.dialog-actions button{border:1px solid var(--ink);background:#fff;border-radius:6px;padding:8px 12px;cursor:pointer}.summary{max-width:980px;margin:24px auto;padding:0 20px}.summary h2,.visual h2{font-family:Georgia,serif}.metrics{display:flex;gap:8px;flex-wrap:wrap}.metric{padding:8px 12px;border:1px solid var(--line);background:#fff;border-radius:6px;font-variant-numeric:tabular-nums}.work{display:grid;grid-template-columns:minmax(320px,1fr) minmax(420px,1fr);gap:28px;max-width:1440px;margin:0 auto;padding:32px 24px;border-top:1px solid var(--line)}.visual{position:sticky;top:82px;align-self:start;max-height:calc(100dvh - 98px);overflow:auto}.visual-head{display:flex;gap:12px;align-items:end;justify-content:space-between}.visual h2{margin:3px 0 0;font-size:24px}.visual-head p{margin:0;color:var(--muted)}.legend{font-size:12px;text-align:right;white-space:nowrap}.dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-left:5px}.current{background:#e58b2b}.legacy{background:#666}.primary{background:#25815a}.confirmation{background:#1769aa}.owner{background:#b3261e}.image-button{position:relative;display:block;width:fit-content;max-width:100%;margin:12px auto 0;padding:0;border:1px solid #aaa;background:#222;line-height:0;cursor:crosshair}.image-button img{display:block;width:auto;height:auto;max-width:100%;max-height:calc(100dvh - 220px)}.overlay{position:absolute;inset:0;pointer-events:none}.pin{position:absolute;transform:translate(-50%,-50%);display:grid;place-items:center;width:28px;height:28px;border:3px solid #fff;border-radius:50%;color:#fff;font:bold 12px/1 system-ui;box-shadow:0 1px 4px #0008}.pin.current{background:#e58b2b}.pin.legacy{background:#666}.pin.primary{background:#25815a}.pin.confirmation{background:#1769aa}.pin.owner{background:#b3261e}.image-status{min-height:24px;margin:6px 0;color:var(--muted);font-size:13px}.review{min-width:0}.work-progress{display:grid;gap:8px;margin-bottom:18px;color:var(--muted);font-size:13px}.work-progress textarea{margin-top:4px}.exception{padding:18px;margin-bottom:16px;background:var(--panel);border:1px solid var(--line);border-left:4px solid transparent;border-radius:8px}.exception.active{border-left-color:var(--accent)}.exception-head{display:flex;gap:12px;align-items:start;justify-content:space-between}.exception h3{margin:2px 0 0;font:700 21px/1.25 Georgia,serif}.eyebrow{color:var(--accent);font-size:12px;font-weight:700;text-transform:uppercase}.copy{margin:14px 0}.why-held,.callout{padding:10px 12px;background:#f4eee6;border-left:3px solid var(--accent)}details{margin:12px 0}summary{cursor:pointer;font-weight:650}.check-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px}.check-grid>div{padding:10px;background:#f7f7f5;border:1px solid var(--line);font-variant-numeric:tabular-nums}.check-grid p{margin:6px 0 0;font-size:14px}fieldset{margin:14px 0;padding:0;border:0}legend{font-weight:700;margin-bottom:8px}.choices{display:flex;flex-wrap:wrap;gap:8px}.choice{padding:8px 10px;border:1px solid #9a958d;border-radius:6px;background:#fff;cursor:pointer;font-variant-numeric:tabular-nums}.choice[aria-pressed="true"]{border-color:var(--accent);background:#f4eee6;color:#702e15;font-weight:700}.placement-help{color:#702e15;font-weight:700}.note-label{display:grid;gap:5px;font-weight:650}textarea{width:100%;resize:vertical;border:1px solid #aaa;border-radius:5px;padding:8px;background:#fff;color:var(--ink)}.saved{min-height:20px;margin:5px 0 0;color:#25815a;font-size:13px}.work-decision{padding:16px;background:#ede8df;border-radius:8px}.empty{max-width:720px;margin:80px auto;padding:24px;background:#fff;border:1px solid var(--line);border-radius:8px}dialog{max-width:440px;border:1px solid var(--line);border-radius:8px;padding:20px;color:var(--ink)}dialog::backdrop{background:#0008}.dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}@media(max-width:850px){.top{position:static;align-items:start;flex-direction:column}.work{grid-template-columns:1fr;padding:20px 14px}.visual{position:static;max-height:none}.image-button img{max-height:70dvh}.check-grid{grid-template-columns:1fr}.legend{white-space:normal}.visual-head{align-items:start;flex-direction:column}}
  </style></head><body><header class="top"><div><h1>Spatial exceptions</h1><p>${esc(runId)} · offline, evidence-bound, no approvals or production writes</p></div><div class="actions"><button type="button" id="copy">Copy review JSON</button><button type="button" id="download">Download review JSON</button><button type="button" id="clear">Clear saved review</button></div></header>
  <main><section class="summary"><h2>${summary.exceptions} spatial decisions need your attention; ${summary.targets - summary.exceptions} were spatially routed automatically</h2><p>Only held spatial exceptions appear below. Distributed/global observations and divergent representative examples remain useful as unpinned notes; validated existing points stay pinned. Unique-point disagreements and uncertain or missing visible claims stop here. This packet does not assess or approve factual content.</p><div class="metrics"><span class="metric">${summary.presentations.pin || 0} pins</span><span class="metric">${summary.presentations.note || 0} notes</span><span class="metric">${summary.exceptions} holds</span><span class="metric">${summary.compoundNoteRoutes} compound → note</span></div></section>
  ${workHtml || '<section class="empty"><h2>No exceptions</h2><p>Every target had a safe deterministic resolution. The full machine-readable report still records each decision.</p></section>'}</main><dialog id="clear-dialog"><h2>Clear this review?</h2><p>This removes the decisions and notes saved by this packet in this browser. Your downloaded files are not affected.</p><div class="dialog-actions"><button type="button" id="cancel-clear">Cancel</button><button type="button" id="confirm-clear">Clear saved review</button></div></dialog>
  <script>const META=${dataJson};const KEY='pass-b-spatial-review:'+META.runId;let state={version:META.version,runId:META.runId,primaryRunId:META.primaryRunId,confirmationRunId:META.confirmationRunId,sourceRunId:META.sourceRunId,evidenceManifestSha256:META.evidenceManifestSha256,works:{}};try{state={...state,...JSON.parse(localStorage.getItem(KEY)||'{}')}}catch{};let placing=null;
  const ensureWork=id=>state.works[id]||(state.works[id]={decision:'abstain',note:'',targets:{}});const ensureTarget=(wid,key)=>ensureWork(wid).targets[key]||(ensureWork(wid).targets[key]={decision:'abstain',point:null,pointProvenance:null,selectedFrom:null,note:''});
  const targetMeta=key=>META.exceptions.flatMap(w=>w.targets.map(t=>({...t,workId:w.workId}))).find(t=>t.key===key);const save=()=>{state.savedAt=new Date().toISOString();localStorage.setItem(KEY,JSON.stringify(state));};
  function draw(workEl,key){const target=targetMeta(key);if(!target)return;if(placing&&placing.key!==key){placing.article.querySelector('.placement-help').hidden=true;placing=null}workEl.querySelectorAll('.exception').forEach(el=>el.classList.toggle('active',el.dataset.key===key));const overlay=workEl.querySelector('.overlay');overlay.innerHTML='';const values=[['current','C',target.currentPoint],['legacy','L',target.legacyPoint],['primary','A',target.primaryPoint],['confirmation','B',target.confirmationPoint],['owner','Y',ensureTarget(target.workId,key).point]];for(const [kind,label,p] of values){if(!p)continue;const pin=document.createElement('span');pin.className='pin '+kind;pin.textContent=label;pin.style.left=p.x+'%';pin.style.top=p.y+'%';overlay.append(pin)}workEl.querySelector('.image-status').textContent=target.title+' · C current, L previous, A first check, B second check, Y yours';}
  function choose(article,value,p=null){const key=article.dataset.key,wid=article.closest('.work').dataset.work,t=ensureTarget(wid,key);t.decision=value;t.point=p;t.pointProvenance=p?'owner-selected-on-current-image':null;t.selectedFrom=p?value:null;article.querySelectorAll('[data-choice]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.choice===value)));article.querySelector('.placement-help').hidden=value!=='manual'||!!p;article.querySelector('.saved').textContent=value==='manual'&&!p?'Click the artwork to finish.':'Saved locally.';placing=value==='manual'&&!p?{wid,key,article}:null;save();draw(article.closest('.work'),key);}
  document.querySelectorAll('.work').forEach(work=>{const wid=work.dataset.work,wm=ensureWork(wid);const first=work.querySelector('.exception');if(first)draw(work,first.dataset.key);const wn=work.querySelector('[data-work-note]');wn.value=wm.note||'';wn.addEventListener('input',()=>{wm.note=wn.value;save()});work.querySelectorAll('[data-work-choice]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.workChoice===wm.decision));b.addEventListener('click',()=>{wm.decision=b.dataset.workChoice;work.querySelectorAll('[data-work-choice]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));save()})});});
  document.querySelectorAll('.exception').forEach(article=>{const key=article.dataset.key,wid=article.closest('.work').dataset.work,t=ensureTarget(wid,key),note=article.querySelector('[data-target-note]');note.value=t.note||'';note.addEventListener('input',()=>{t.note=note.value;save()});article.querySelectorAll('[data-choice]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.choice===t.decision));b.addEventListener('click',()=>{const m=targetMeta(key),points={'use-current':m.currentPoint,'use-legacy':m.legacyPoint,'use-primary':m.primaryPoint,'use-confirmation':m.confirmationPoint};choose(article,b.dataset.choice,points[b.dataset.choice]||null)})});});
  document.querySelectorAll('[data-show]').forEach(b=>b.addEventListener('click',()=>draw(b.closest('.work'),b.dataset.show)));document.querySelectorAll('[data-image]').forEach(b=>b.addEventListener('click',ev=>{if(!placing||placing.wid!==b.dataset.image)return;const img=b.querySelector('img'),r=img.getBoundingClientRect();if(ev.clientX<r.left||ev.clientX>r.right||ev.clientY<r.top||ev.clientY>r.bottom)return;const p={x:+(((ev.clientX-r.left)/r.width)*100).toFixed(2),y:+(((ev.clientY-r.top)/r.height)*100).toFixed(2)};choose(placing.article,'manual',p)}));
  const exported=()=>JSON.stringify({...state,exportedAt:new Date().toISOString()},null,2);document.getElementById('copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(exported());document.getElementById('copy').textContent='Copied'}catch{document.getElementById('copy').textContent='Copy failed — use Download'}});document.getElementById('download').addEventListener('click',()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([exported()],{type:'application/json'}));a.download='pass-b-spatial-exception-review-'+META.runId+'.json';a.click();URL.revokeObjectURL(a.href)});const clearDialog=document.getElementById('clear-dialog');document.getElementById('clear').addEventListener('click',()=>clearDialog.showModal());document.getElementById('cancel-clear').addEventListener('click',()=>clearDialog.close());document.getElementById('confirm-clear').addEventListener('click',()=>{localStorage.removeItem(KEY);location.reload()});save();</script></body></html>`;
}

console.log('Pass-B spatial resolution packet — PLAN' + (write ? ' + WRITE' : ' ONLY'));
console.log(`primary: ${primaryRun}`);
console.log(`confirmation: ${confirmationRun || 'none'}`);
console.log(`output: ${outDir}`);
console.log(`resolved: ${summary.presentations.pin || 0} pin, ${summary.presentations.note || 0} note; exceptions: ${summary.exceptions}`);
console.log(`trust tiers: ${JSON.stringify(summary.trustTiers)}`);
if (write) {
  if (existsSync(outDir)) throw new Error(`refusing to overwrite existing derived run: ${outDir}`);
  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  writeFileSync(join(outDir, 'run-manifest.json'), `${JSON.stringify({ ...binding, runId }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  writeFileSync(join(outDir, 'resolution.json'), `${JSON.stringify(resolutionReport, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  writeFileSync(join(outDir, 'spatial-exceptions.html'), await renderPacket(), { flag: 'wx', mode: 0o600 });
  console.log(`wrote: ${join(outDir, 'resolution.json')}`);
  console.log(`wrote: ${join(outDir, 'spatial-exceptions.html')}`);
} else {
  console.log('Add --write to create the quarantined derived report and exceptions packet. No model calls are made.');
}
