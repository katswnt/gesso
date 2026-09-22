// VSD-040: bounded B4-v3 structured-grounding smoke over already-banked B1-B3 evidence.
// Default is an offline plan. Live execution requires BOTH --run and PASS_B_B4_CANARY_LIVE=1.
// The harness never calls B0-B3, never retries a validation failure, never creates decisions/approval,
// and has no production sink. Ten selected works, zero validation retries, ten attempts TOTAL across resumes.
// A preserved usage-limit rejection may retry on resume, but still consumes the same total cap.
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { sha256, stableJson } from './lib/vision-legacy.mjs';
import { completionKey } from './lib/vision-content-capture.mjs';
import {
  B4_VALIDATION_CONTRACT_VERSION, CALIBRATION_MODEL, RUN_ROOT, VALIDATION_CONTRACT_VERSION,
  buildStageCommand, compactB4DeltaInput, legacyContentInput, parseStreamTranscript,
  primaryModelFromEnvelope, transcriptFinal, verifyStageEvidence,
} from './lib/pass-b-calibration.mjs';
import { buildB4Prompt, promptHashes } from './lib/pass-b-prompts.mjs';
import { assembleAndValidateB4, B4_DELTA_VERSION } from './lib/pass-b-b4-delta.mjs';
import { projectToProduction } from './lib/pass-b-approval.mjs';
import { scanTeachEntry } from './lib/public-output-leak.mjs';
import { auditReconciliation, buildClaimBundle, validateClaimBundle } from './lib/pass-b-reconciliation.mjs';
import { findingsForWork, loadCanonicalFindings } from './lib/pass-b-blocked-findings.mjs';

const execFileP = promisify(execFile);
export const CANARY_VERSION = 'passBStructuredB4Canary/1';
export const SOURCE_RUN = 'cal50-0a47b6f7f332';
export const MAX_ATTEMPTS = 10;
export const CANARY_WORKS = Object.freeze([
  { workId: 'wikidata:Q16467705', reason: 'canonical La Gloire identity/iconography failure' },
  { workId: 'wikidata:Q1211814', reason: 'canonical St. John human/animal binding failure' },
  { workId: 'harvard303416', reason: 'assert-vs-hedge inscription regression' },
  { workId: 'http://www.wikidata.org/entity/Q405814', reason: 'contested discrete iconography' },
  { workId: 'wikidata:Q1616056', reason: 'contested ground/format description' },
  { workId: 'http://www.wikidata.org/entity/Q1190706', reason: 'legitimate multi-figure overlap' },
  { workId: 'met450509', reason: 'dense overlapping multi-figure composition' },
  { workId: 'harvard216218', reason: 'single-figure control with inscription and border' },
  { workId: 'wd:Q616159', reason: 'changed-image/provenance regression' },
  { workId: 'wikidata:Q56825917', reason: 'paired-figure composition and duplicate-idea regression' },
]);

const rawSha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const safeWork = workId => sha256(workId).slice(0, 24);
const runIdFromBinding = binding => `b4s-${sha256(stableJson(binding)).slice(0, 12)}`;
export const structuredB4RunId = binding => runIdFromBinding(binding);
const sourceDir = () => join(RUN_ROOT, SOURCE_RUN);
const completionPath = (workDir, stage, workId) => join(workDir, 'completions', `${stage.toLowerCase()}-${completionKey(stage, workId)}.json`);

function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }
function commandPolicy(command, promptHash) {
  const argv = [...command.argv];
  if (argv[0] === '-p') argv[1] = `<prompt:${promptHash}>`;
  return {
    bin: command.bin, argv, removeKeys: command.env.removeKeys,
    toolsEnforced: command.toolsEnforced, imageAttached: command.imageAttached,
    wireSchemaSha256: command.wireSchemaSha256,
  };
}

function loadStage(workDir, workId, stage, img, priorBodies) {
  const path = completionPath(workDir, stage, workId);
  if (!existsSync(path)) throw new Error(`${workId}: missing ${stage} completion`);
  const text = readFileSync(path, 'utf8');
  const completion = JSON.parse(text);
  if (completion.workId !== workId || completion.stage !== stage || completion.imgSha256 !== img.imgSha256) throw new Error(`${workId}: ${stage} completion binding mismatch`);
  if (!/^[0-9a-f]{64}$/.test(completion.promptHash || '')) throw new Error(`${workId}: ${stage} missing effective prompt hash`);
  const rawPath = join(workDir, 'raw', `${completion.rawResponseSha256}.json`);
  if (!existsSync(rawPath) || rawSha(rawPath) !== completion.rawResponseSha256) throw new Error(`${workId}: ${stage} raw response mismatch`);
  const rawBody = JSON.parse(readFileSync(rawPath, 'utf8'));
  if (stableJson(rawBody) !== stableJson(completion.body)) throw new Error(`${workId}: ${stage} raw/body mismatch`);
  if (completion.bodySha256 !== sha256(stableJson(completion.body))) throw new Error(`${workId}: ${stage} body hash mismatch`);
  const ev = verifyStageEvidence({
    stage, workRunDir: workDir, completion, imageBasename: `${img.imgSha256}.${img.ext}`,
    b1: priorBodies.B1 || null, b2: priorBodies.B2 || null, b3: priorBodies.B3 || null,
  });
  if (!ev.ok) throw new Error(`${workId}: ${stage} evidence invalid: ${ev.errors.join('|')}`);
  const sourceTranscript = readFileSync(join(workDir, 'attempts', ev.transcriptFile), 'utf8');
  const sourceFinal = transcriptFinal(parseStreamTranscript(sourceTranscript));
  if (stableJson(sourceFinal?.structured_output) !== stableJson(completion.body)) throw new Error(`${workId}: ${stage} transcript/body mismatch`);
  return {
    body: completion.body,
    binding: {
      completionSha256: sha256(text), bodySha256: sha256(stableJson(completion.body)),
      rawResponseSha256: completion.rawResponseSha256, transcriptSha256: completion.transcriptSha256,
      promptHash: completion.promptHash,
    },
  };
}

export function loadCanaryPlan({ source = sourceDir(), selection = CANARY_WORKS } = {}) {
  const manifestPath = join(source, 'run-manifest.json');
  if (!existsSync(manifestPath)) throw new Error(`missing source manifest: ${manifestPath}`);
  const manifestText = readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestText);
  const sourceIds = new Set((manifest.selection || []).map(row => row.id));
  const findings = loadCanonicalFindings();
  const plans = [];
  for (const selected of selection) {
    const workId = selected.workId;
    if (!sourceIds.has(workId)) throw new Error(`${workId}: not in source manifest`);
    const workDir = join(source, 'works', safeWork(workId));
    const b0Path = join(workDir, 'b0-prep.json');
    const b0Text = readFileSync(b0Path, 'utf8');
    const b0 = JSON.parse(b0Text);
    if (b0.work?.id !== workId || !/^[0-9a-f]{64}$/.test(b0.image?.imgSha256 || '')) throw new Error(`${workId}: bad B0 binding`);
    const bodies = {};
    const bindings = {};
    for (const stage of ['B1', 'B2', 'B3']) {
      // These are historically accepted completions. Re-open their exact transcript/raw/body bytes and bind
      // them into this canary; do not retroactively apply today's stricter B1-B3 content validator.
      const loaded = loadStage(workDir, workId, stage, b0.image, bodies);
      bodies[stage] = loaded.body; bindings[stage] = loaded.binding;
    }
    const compactInput = compactB4DeltaInput({ b1: bodies.B1, b2: bodies.B2, b3: bodies.B3, legacyInput: legacyContentInput(b0.legacy) });
    const promptText = `${buildB4Prompt()}\n\nINPUTS:\n${JSON.stringify(compactInput)}`;
    const promptHash = sha256(promptText);
    const command = buildStageCommand({ stage: 'B4', promptText });
    const policy = commandPolicy(command, promptHash);
    plans.push({
      workId, reason: selected.reason, workDir, b0, b1: bodies.B1, b2: bodies.B2, b3: bodies.B3,
      legacy: b0.legacy, compactInput, promptText, promptHash, command, commandPolicy: policy,
      sealedFindingIds: findingsForWork(findings, workId).map(row => row.findingId),
      sourceBinding: { b0Sha256: sha256(b0Text), ...bindings },
    });
  }
  const binding = {
    version: CANARY_VERSION, sourceRunId: manifest.runId || SOURCE_RUN,
    sourceManifestSha256: sha256(manifestText), model: CALIBRATION_MODEL,
    sourceBasePromptHashes: manifest.promptHashes,
    sharedValidationContract: VALIDATION_CONTRACT_VERSION,
    b4ValidationContract: B4_VALIDATION_CONTRACT_VERSION,
    b4DeltaVersion: B4_DELTA_VERSION, b4PromptHash: promptHashes().B4,
    maxAttempts: MAX_ATTEMPTS,
    works: plans.map(p => ({
      workId: p.workId, reason: p.reason, imageSha256: p.b0.image.imgSha256,
      sourceBinding: p.sourceBinding, promptHash: p.promptHash,
      compactInputSha256: sha256(stableJson(p.compactInput)),
      commandPolicySha256: sha256(stableJson(p.commandPolicy)),
      sealedFindingIds: p.sealedFindingIds,
    })),
  };
  return { source, plans, binding, runId: runIdFromBinding(binding) };
}

function usageLimited(transcript, final) {
  const events = String(transcript).split('\n').map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  return events.some(event => event.type === 'rate_limit_event' && event.rate_limit_info?.status === 'rejected')
    || final?.api_error_status === 429 || /usage limit|spend limit|rate.?limit|quota/i.test(String(final?.result || ''));
}

export function deriveB4Attempt(plan, transcript, exitCode = 0) {
  const parsed = parseStreamTranscript(transcript);
  const final = transcriptFinal(parsed);
  const resolvedModel = primaryModelFromEnvelope(final) || parsed.init?.model || null;
  const apiKeySource = parsed.init?.apiKeySource ?? null;
  const errors = [];
  let kind = 'held';
  if (apiKeySource !== 'none') { kind = 'fatal'; errors.push(`apiKeySource:${apiKeySource || 'missing'}`); }
  else if (resolvedModel !== CALIBRATION_MODEL) { kind = 'fatal'; errors.push(`model:${resolvedModel || 'missing'}`); }
  else if (parsed.toolUses.length) { kind = 'fatal'; errors.push(`B4 used tools:${parsed.toolUses.map(row => row.name).join(',')}`); }
  else if (usageLimited(transcript, final)) kind = 'usage-limit';
  else if (exitCode !== 0 || !final || final.is_error) errors.push(`process-failed:exit${exitCode}`);

  const delta = final?.structured_output ?? null;
  let body = null, bundle = null, reconciliation = null, leaks = [];
  if (kind !== 'usage-limit' && kind !== 'fatal') {
    if (delta?.version !== B4_DELTA_VERSION) errors.push(`delta-version:${delta?.version || 'missing'}`);
    if (delta) {
      const assembled = assembleAndValidateB4({ delta, b1: plan.b1, b2: plan.b2, b3: plan.b3, legacy: plan.legacy });
      if (!assembled.ok) errors.push(`assemble:${(assembled.errors || []).slice(0, 4).join('|')}`);
      else {
        body = assembled.body;
        leaks = scanTeachEntry(projectToProduction(body).teach).map(row => `${row.field}:${row.label}`);
        if (leaks.length) errors.push(`player-copy-leak:${leaks.join('|')}`);
        const sources = {
          workId: plan.workId, b0: plan.b0, b1: plan.b1, b2: plan.b2, b3: plan.b3, b4: body,
          sourceBindings: {
            imageSha256: plan.b0.image.imgSha256, sourceRunId: SOURCE_RUN,
            b0Sha256: plan.sourceBinding.b0Sha256,
            b1CompletionSha256: plan.sourceBinding.B1.completionSha256,
            b2CompletionSha256: plan.sourceBinding.B2.completionSha256,
            b3CompletionSha256: plan.sourceBinding.B3.completionSha256,
            b4BodySha256: sha256(stableJson(body)), legacySnapshotSha256: sha256(stableJson(plan.legacy ?? null)),
          },
        };
        bundle = buildClaimBundle({ sources, projectedRecord: projectToProduction(body) });
        const validBundle = validateClaimBundle(bundle);
        if (!validBundle.ok) errors.push(`claim-bundle:${validBundle.errors.slice(0, 4).join('|')}`);
        else {
          reconciliation = auditReconciliation(bundle).report;
          if (reconciliation.componentReadiness.some(row => row.contentReadiness === 'eligible')) errors.push('model-only B4 unexpectedly created eligible content');
        }
      }
    } else errors.push('no-structured-output');
    kind = errors.length ? 'held' : 'accepted';
  }
  return {
    kind, errors, delta, body, bundle, reconciliation, leaks,
    evidence: {
      exitCode, transcriptSha256: sha256(transcript), resolvedModel, apiKeySource,
      claudeCodeVersion: parsed.init?.claudeCodeVersion ?? null, usage: final?.usage ?? null,
      modelUsage: final?.modelUsage ?? null, numTurns: final?.num_turns ?? null,
      toolUses: parsed.toolUses.map(row => row.name),
    },
  };
}

function verifyAttemptHistory(outDir, plans) {
  const numbers = new Set();
  for (const plan of plans) {
    const workOut = join(outDir, 'works', safeWork(plan.workId));
    if (!existsSync(workOut)) continue;
    const transcriptNames = readdirSync(workOut).filter(name => /^attempt-\d+\.transcript\.jsonl$/.test(name));
    for (const transcriptName of transcriptNames) {
      const attempt = Number(/^attempt-(\d+)\./.exec(transcriptName)[1]);
      if (numbers.has(attempt)) throw new Error(`duplicate global attempt number: ${attempt}`);
      numbers.add(attempt);
      const transcriptPath = join(workOut, transcriptName);
      const resultPath = join(workOut, `attempt-${attempt}.result.json`);
      const metaPath = join(workOut, `attempt-${attempt}.meta.json`);
      if (!existsSync(resultPath) || !existsSync(metaPath)) throw new Error(`${plan.workId}: incomplete preserved attempt ${attempt}`);
      const transcript = readFileSync(transcriptPath, 'utf8');
      const meta = readJson(metaPath);
      if (meta.workId !== plan.workId || meta.attempt !== attempt || meta.promptHash !== plan.promptHash) throw new Error(`${plan.workId}: attempt ${attempt} binding mismatch`);
      if (meta.transcriptSha256 !== sha256(transcript) || meta.resultSha256 !== rawSha(resultPath)) throw new Error(`${plan.workId}: attempt ${attempt} evidence changed`);
      const derived = deriveB4Attempt(plan, transcript, meta.exitCode);
      if (meta.status !== derived.kind || stableJson(derived) !== stableJson(readJson(resultPath))) throw new Error(`${plan.workId}: attempt ${attempt} re-derivation mismatch`);
    }
  }
  const ordered = [...numbers].sort((a, b) => a - b);
  if (ordered.some((value, i) => value !== i + 1)) throw new Error('attempt history is not globally contiguous');
  return ordered.length;
}

export async function callB4(plan) {
  const callDir = mkdtempSync(join(tmpdir(), 'pass-b-b4s-'));
  try {
    const env = { ...process.env };
    for (const key of plan.command.env.removeKeys) delete env[key];
    try {
      const { stdout } = await execFileP(plan.command.bin, plan.command.argv, { cwd: callDir, env, maxBuffer: 64 * 1024 * 1024 });
      return { transcript: stdout, exitCode: 0 };
    } catch (error) { return { transcript: error.stdout || '', exitCode: error.code ?? 1 }; }
  } finally { rmSync(callDir, { recursive: true, force: true }); }
}

function verifyManifest(path, expectedRunId, expectedBinding) {
  const manifest = readJson(path);
  if (manifest.runId !== runIdFromBinding(manifest.binding)) throw new Error('manifest runId/binding mismatch');
  if (manifest.runId !== expectedRunId || stableJson(manifest.binding) !== stableJson(expectedBinding)) throw new Error('manifest differs from current plan');
  return manifest;
}

function checkpointFor(outDir, plan) {
  const workOut = join(outDir, 'works', safeWork(plan.workId));
  const checkpoint = join(workOut, 'checkpoint.json');
  if (!existsSync(checkpoint)) return null;
  const cp = readJson(checkpoint);
  const transcriptPath = join(workOut, `attempt-${cp.attempt}.transcript.jsonl`);
  const resultPath = join(workOut, `attempt-${cp.attempt}.result.json`);
  const transcript = readFileSync(transcriptPath, 'utf8');
  if (sha256(transcript) !== cp.transcriptSha256 || rawSha(resultPath) !== cp.resultSha256) throw new Error(`${plan.workId}: checkpoint evidence changed`);
  const derived = deriveB4Attempt(plan, transcript, cp.exitCode);
  const stored = readJson(resultPath);
  if (stableJson(derived) !== stableJson(stored)) throw new Error(`${plan.workId}: checkpoint re-derivation mismatch`);
  if (cp.workId !== plan.workId || cp.status !== derived.kind || cp.promptHash !== plan.promptHash) throw new Error(`${plan.workId}: checkpoint binding mismatch`);
  return { checkpoint: cp, derived };
}

function scopingSummary(derived) {
  const grounding = derived?.body?.structuredGrounding;
  const readiness = derived?.reconciliation?.componentReadiness || [];
  if (!grounding) return null;
  return {
    boundComponents: grounding.components.length,
    unresolvedComponentTargets: grounding.unresolvedComponentTargets.length,
    conflicts: grounding.conflicts.length,
    workScopeConflicts: grounding.conflicts.filter(row => row.workScope).length,
    openClaims: grounding.openClaims.length,
    workScopeOpenClaims: grounding.openClaims.filter(row => row.workScope).length,
    eligibleComponents: readiness.filter(row => row.contentReadiness === 'eligible').length,
    reviewRequiredComponents: readiness.filter(row => row.contentReadiness === 'review-required').length,
    blockedComponents: readiness.filter(row => row.contentReadiness === 'blocked').length,
  };
}

export async function runCanary({ planSet, outDir = join(RUN_ROOT, planSet.runId), callFn = callB4 } = {}) {
  if (!planSet) throw new Error('planSet required');
  const manifestPath = join(outDir, 'run-manifest.json');
  if (!existsSync(outDir)) {
    mkdirSync(join(outDir, 'works'), { recursive: true, mode: 0o700 });
    writeFileSync(manifestPath, `${JSON.stringify({ runId: planSet.runId, binding: planSet.binding }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  } else verifyManifest(manifestPath, planSet.runId, planSet.binding);

  let attempts = verifyAttemptHistory(outDir, planSet.plans);
  const rows = [];
  let stopped = null;
  for (const plan of planSet.plans) {
    const prior = checkpointFor(outDir, plan);
    if (prior) {
      rows.push({ workId: plan.workId, status: prior.derived.kind, errors: prior.derived.errors, sealedFindingIds: plan.sealedFindingIds, scoping: scopingSummary(prior.derived) });
      if (prior.derived.kind === 'fatal') { stopped = 'fatal-provenance'; break; }
      continue;
    }
    if (attempts >= MAX_ATTEMPTS) { stopped = 'attempt-cap'; break; }
    const workOut = join(outDir, 'works', safeWork(plan.workId));
    mkdirSync(workOut, { recursive: true, mode: 0o700 });
    const attempt = attempts + 1;
    const raw = await callFn(plan);
    attempts++;
    const transcriptPath = join(workOut, `attempt-${attempt}.transcript.jsonl`);
    writeFileSync(transcriptPath, raw.transcript || '', { flag: 'wx', mode: 0o600 });
    const derived = deriveB4Attempt(plan, raw.transcript || '', raw.exitCode ?? 1);
    const resultText = `${JSON.stringify(derived, null, 2)}\n`;
    const resultPath = join(workOut, `attempt-${attempt}.result.json`);
    writeFileSync(resultPath, resultText, { flag: 'wx', mode: 0o600 });
    writeFileSync(join(workOut, `attempt-${attempt}.meta.json`), `${JSON.stringify({
      workId: plan.workId, attempt, status: derived.kind, exitCode: raw.exitCode ?? 1,
      promptHash: plan.promptHash, transcriptSha256: sha256(raw.transcript || ''), resultSha256: rawSha(resultPath),
    }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    rows.push({ workId: plan.workId, status: derived.kind, errors: derived.errors, sealedFindingIds: plan.sealedFindingIds, scoping: scopingSummary(derived) });
    if (derived.kind === 'usage-limit') { stopped = 'usage-limit'; break; }
    writeFileSync(join(workOut, 'checkpoint.json'), `${JSON.stringify({
      workId: plan.workId, attempt, status: derived.kind, exitCode: raw.exitCode ?? 1,
      promptHash: plan.promptHash, transcriptSha256: sha256(raw.transcript || ''), resultSha256: rawSha(resultPath),
    }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    if (derived.kind === 'fatal') { stopped = 'fatal-provenance'; break; }
  }
  const report = {
    version: 'passBStructuredB4CanaryReport/1', runId: planSet.runId,
    kind: 'structured-b4-schema-and-scoping-smoke', semanticAccuracy: 'unmeasured', releaseEligibility: 'not-tested',
    attempts, maxAttempts: MAX_ATTEMPTS, stopped, rows,
    counts: Object.fromEntries(['accepted', 'held', 'fatal', 'usage-limit'].map(status => [status, rows.filter(row => row.status === status).length])),
    scopingTotals: rows.reduce((totals, row) => {
      for (const [key, value] of Object.entries(row.scoping || {})) totals[key] = (totals[key] || 0) + value;
      return totals;
    }, {}),
    note: 'Accepted means provenance/shape/hydration/leak/reconciliation integrity only. It is not factual approval. Canonical works remain sealed and no component becomes eligible from model proposals.',
  };
  writeFileSync(join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return report;
}

function printPlan(planSet) {
  console.log('VSD-040 STRUCTURED B4 CANARY — OFFLINE PLAN (no model calls)');
  console.log(`runId: ${planSet.runId}`);
  console.log(`source: ${planSet.source} (read-only B0-B3 evidence)`);
  console.log(`model: ${CALIBRATION_MODEL} | delta: ${B4_DELTA_VERSION} | B4 contract: ${B4_VALIDATION_CONTRACT_VERSION}`);
  console.log(`hard budget: ${MAX_ATTEMPTS} total attempts across resumes; ${planSet.plans.length} works; zero validation retries`);
  console.log('a preserved usage-limit rejection may retry on resume, but it consumes the same total cap.');
  for (const plan of planSet.plans) console.log(`  - ${plan.workId} | ${plan.reason} | B1=${plan.sourceBinding.B1.completionSha256.slice(0, 10)} B2=${plan.sourceBinding.B2.completionSha256.slice(0, 10)} B3=${plan.sourceBinding.B3.completionSha256.slice(0, 10)}${plan.sealedFindingIds.length ? ' | SEALED-HOLD' : ''}`);
  console.log('output manifest is written before the first call; transcripts are the resume source of truth; B4 has no tools/image/web.');
  console.log('report is a schema/scoping smoke only: no factual-accuracy, release-eligibility, approval, or production claim.');
  console.log('LIVE COMMAND (do not run without owner spend authorization):');
  console.log('  PASS_B_B4_CANARY_LIVE=1 /opt/homebrew/bin/node scripts/pass-b-b4-structured-canary.mjs --run');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const planSet = loadCanaryPlan();
  if (!process.argv.includes('--run')) printPlan(planSet);
  else {
    if (process.env.PASS_B_B4_CANARY_LIVE !== '1') { console.error('refusing live B4 canary: set PASS_B_B4_CANARY_LIVE=1 after explicit owner spend authorization'); process.exit(2); }
    const report = await runCanary({ planSet });
    console.log(`B4 canary ${report.stopped || 'complete'}: accepted=${report.counts.accepted} held=${report.counts.held} fatal=${report.counts.fatal} attempts=${report.attempts}/${report.maxAttempts}`);
  }
}
