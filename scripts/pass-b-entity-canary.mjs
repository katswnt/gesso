// VSD-034 item 4: entity canary.
//   default            -> 4a OFFLINE validation (no model, no image bytes read): integrity/self-consistency
//                         PASS/FAIL + measurement-readiness state + the BOUND, checkpointed 4b plan.
//   --run + PASS_B_ENTITY_LIVE=1 -> 4b bounded model canary (schema-emission SMOKE; not a VSD-034 accuracy
//                         conclusion). IMPLEMENTED, checkpointed/resumable, provenance-fatal. NOT run here.
// No production writes; no claim graph / reconciler / curated index. runCanary takes an injectable callFn so
// the provenance-abort / manifest / resume / scoring logic is fully regression-tested OFFLINE with no model.
import { readFileSync, existsSync, readdirSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { sha256, stableJson } from './lib/vision-legacy.mjs';
import { loadCanonicalFindings } from './lib/pass-b-blocked-findings.mjs';
import { validateEntityGraph, ENTITY_GRAPH_VERSION, ENTITY_GRAPH_WIRE_SCHEMA } from './lib/pass-b-entity-contract.mjs';
import { runController, aliasPairKeys, CONTROLLER_POLICY_VERSION } from './lib/pass-b-entity-controller.mjs';
import { scoreEmission, aggregateEmission } from './lib/pass-b-entity-eval.mjs';
import { verifyFixturesArtifact } from './pass-b-entity-canary-fixtures.mjs';
import { buildApproval } from './lib/pass-b-approval.mjs';
import { CALIBRATION_MODEL, buildStageCommand, neutralImageFile, parseStreamTranscript, transcriptFinal, verifyB1ImageRead, primaryModelFromEnvelope } from './lib/pass-b-calibration.mjs';

const execFileP = promisify(execFile);
const FIX = 'data/vision-entity-canary-fixtures.json';
const UPSTREAM = 'data/incoming/vision-calibration/cal50-0a47b6f7f332';
const CAL_ROOT = 'data/incoming/vision-calibration';
export const ENTITY_PROMPT_VERSION = 'contentVisionEntityPrompt/1';
export const ENTITY_TRANSPORT_VERSION = 'entityReadConfinedDir/1';
// RAW-BYTES sha256 (the broker named derivatives this way; vision-legacy.sha256 JSON-stringifies non-strings).
const fileSha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const safeId = (id) => id.replace(/[^a-z0-9]+/gi, '_');

function buildEntityPrompt(imageFile) {
  return [
    'You are a blind visual entity-inventory analyst. You have ONLY the Read tool and a working directory with exactly ONE image file; open it with Read first and work only from the pixels.',
    `Image file: ${imageFile}. You have no title, artist, catalog, or web access. Never name or identify a specific person, deity, or work — describe only visible KINDS of things.`,
    'Emit region-bound entity observations. A region has geometry {x,y,w,h} as PERCENT of the image (0..100). Each entity has one or more regionRefs and an entityType from: human, animal, plant, object, architecture, inscription, decorative-motif, ground, vehicle, unknown. Use "unknown" when a form is genuinely unreadable rather than guessing a kind.',
    'Declare relations only when visually clear: partOf, sameAs, distinctFrom. Do not declare a relation to force a reading.',
    `Output ONE bare JSON object per contentVisionEntityGraph/1 (${ENTITY_GRAPH_VERSION}): {version, regions:[{regionId, geometry, scope, confidence}], entities:[{entityId, regionRefs, entityType, partOf, sameAs, distinctFrom, confidence}], uncertainty}. scope is point|area|whole. If Read fails, set uncertainty and emit empty regions/entities.`,
  ].join('\n');
}

export function loadFixtures() {
  const artifact = JSON.parse(readFileSync(FIX, 'utf8'));
  const v = verifyFixturesArtifact(artifact);
  if (!v.ok) throw new Error(`fixtures: ${v.error}`);
  return { artifact, fixtures: v.fixtures };
}

function resolveImage(workId) {
  const b0 = JSON.parse(readFileSync(join(UPSTREAM, 'works', sha256(workId).slice(0, 24), 'b0-prep.json'), 'utf8'));
  const file = neutralImageFile(b0.image.imgSha256, b0.image.ext);
  for (const d of readdirSync(CAL_ROOT).filter((x) => /^imgs-/.test(x))) {
    const p = join(CAL_ROOT, d, file);
    if (existsSync(p)) return { imgSha256: b0.image.imgSha256, ext: b0.image.ext, file, path: p, receiptOk: fileSha(p) === b0.image.imgSha256 };
  }
  return { imgSha256: b0.image.imgSha256, ext: b0.image.ext, file, path: null, receiptOk: false };
}

export function planWork(f) {
  const img = resolveImage(f.workId);
  const promptText = buildEntityPrompt(img.file);
  const command = img.file && /^[0-9a-f]{64}\.[a-z0-9]{1,5}$/.test(img.file)
    ? buildStageCommand({ stage: 'B5', promptText, imageFile: img.file, wireSchema: ENTITY_GRAPH_WIRE_SCHEMA }) : null;
  return { workId: f.workId, set: f.set, exhaustive: f.exhaustive, img, promptText, promptHash: sha256(promptText), command, commandArgvSha256: command ? sha256(stableJson(command.argv)) : null };
}

export function computeRunId(fixturesArtifact, plans) {
  const binding = {
    version: 'passBEntityCanary/1', fixturesSha256: fixturesArtifact.fixturesSha256,
    entityGraphVersion: ENTITY_GRAPH_VERSION, controllerPolicyVersion: CONTROLLER_POLICY_VERSION,
    promptVersion: ENTITY_PROMPT_VERSION, transportVersion: ENTITY_TRANSPORT_VERSION, model: CALIBRATION_MODEL,
    wireSchemaSha256: sha256(stableJson(ENTITY_GRAPH_WIRE_SCHEMA)),
    works: plans.map((p) => ({ workId: p.workId, imgSha256: p.img.imgSha256, promptHash: p.promptHash, commandArgvSha256: p.commandArgvSha256 })),
  };
  return { runId: `b6c-${sha256(stableJson(binding)).slice(0, 12)}`, binding };
}

// Real per-call executor (model). Captures full provenance evidence. Injectable via callFn for tests.
export async function callEntity(plan) {
  if (!plan.command || !plan.img.receiptOk) return { workId: plan.workId, ok: false, errors: ['image receipt invalid'], graph: null, evidence: { apiKeySource: null }, transcript: '' };
  const callDir = mkdtempSync(join(tmpdir(), 'pass-b-entity-'));
  const started = Date.now();
  try {
    copyFileSync(plan.img.path, join(callDir, plan.img.file));
    const env = { ...process.env }; for (const k of plan.command.env.removeKeys) delete env[k];
    let stdout = ''; let exitCode = 0;
    try { ({ stdout } = await execFileP(plan.command.bin, plan.command.argv, { cwd: callDir, env, maxBuffer: 32 * 1024 * 1024 })); }
    catch (e) { exitCode = e.code ?? 1; stdout = e.stdout || ''; }
    const transcript = parseStreamTranscript(stdout);
    const final = transcriptFinal(transcript);
    const graph = final?.structured_output ?? null;
    const receipt = verifyB1ImageRead(transcript, { callDir, imageBasename: plan.img.file });
    const validation = graph ? validateEntityGraph(graph) : { ok: false, errors: ['no structured output'] };
    const resolvedModel = primaryModelFromEnvelope(final);
    const errors = [];
    if (exitCode !== 0 || !final || final.is_error) errors.push(`process failed (exit ${exitCode})`);
    if (!receipt.ok) errors.push(`image receipt: ${receipt.reason}`);
    if (resolvedModel !== CALIBRATION_MODEL) errors.push(`model drift: ${resolvedModel}`);
    if (!validation.ok) errors.push(...validation.errors);
    return {
      workId: plan.workId, ok: errors.length === 0, errors, graph, transcript: stdout,
      evidence: {
        durationMs: Date.now() - started, transcriptSha256: sha256(stdout), resolvedModel,
        apiKeySource: transcript.init?.apiKeySource ?? null, claudeCodeVersion: transcript.init?.claudeCodeVersion ?? null,
        usage: final?.usage ?? null, modelUsage: final?.modelUsage ?? null, numTurns: final?.num_turns ?? null,
        imageReceipt: receipt, imgSha256: plan.img.imgSha256, promptHash: plan.promptHash, exitCode,
      },
    };
  } finally { rmSync(callDir, { recursive: true, force: true }); }
}

// Orchestrator: immutable manifest before the first call, checkpointed/resumable, provenance-FATAL abort.
// callFn is injectable (default = real model call); tests inject a mock so this is exercised with no model.
export async function runCanary({ fixtures, plans, runId, binding, outDir, callFn, resume = false }) {
  const call = callFn || callEntity;
  const manifestPath = join(outDir, 'run-manifest.json');
  if (resume) {
    if (!existsSync(manifestPath)) throw new Error('resume: no run-manifest.json');
    const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (m.runId !== runId || m.binding?.fixturesSha256 !== binding.fixturesSha256) throw new Error('resume: manifest/binding mismatch');
  } else {
    if (existsSync(outDir)) throw new Error(`refusing to overwrite ${outDir}`);
    mkdirSync(join(outDir, 'works'), { recursive: true, mode: 0o700 });
    // Item 3: immutable run-manifest written BEFORE any call.
    writeFileSync(manifestPath, `${JSON.stringify({ runId, binding, generated: 'VSD-034 entity canary' }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  }
  const scores = []; const unboundPerWork = []; let aborted = null;
  for (const p of plans) {
    const wdir = join(outDir, 'works', safeId(p.workId));
    if (!existsSync(wdir)) mkdirSync(wdir, { recursive: true, mode: 0o700 });
    const inputPath = join(wdir, 'input.json'); // Item 3: per-work bound input persisted once.
    if (!existsSync(inputPath)) writeFileSync(inputPath, `${JSON.stringify({ workId: p.workId, imgSha256: p.img.imgSha256, promptHash: p.promptHash, wireSchemaSha256: p.command?.wireSchemaSha256 ?? null, commandArgvSha256: p.commandArgvSha256 }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    const f = fixtures.find((x) => x.workId === p.workId);
    const acceptedPath = join(wdir, 'accepted.json');
    // Item 4: reuse a valid checkpoint after verifying its binding; never repeat/overwrite.
    if (existsSync(acceptedPath)) {
      const acc = JSON.parse(readFileSync(acceptedPath, 'utf8'));
      if (acc.imgSha256 !== p.img.imgSha256 || acc.promptHash !== p.promptHash || acc.apiKeySource !== 'none') throw new Error(`resume: checkpoint binding mismatch for ${p.workId}`);
      scores.push(acc.score); unboundPerWork.push(acc.unbound); continue;
    }
    // Fresh attempt (attempts are append-only evidence; k = next index).
    const k = readdirSync(wdir).filter((x) => /^attempt-\d+\.result\.json$/.test(x)).length + 1;
    const r = await call(p);
    if (r.transcript) writeFileSync(join(wdir, `attempt-${k}.transcript.jsonl`), r.transcript, { flag: 'wx', mode: 0o600 });
    const g = (r.ok && r.graph) ? r.graph : { version: ENTITY_GRAPH_VERSION, regions: [], entities: [], uncertainty: '' };
    const controller = runController(g, f.claims); // Item 2: claims passed through.
    const score = (r.ok && r.graph) ? scoreEmission(r.graph, f.label, { exhaustive: f.exhaustive }) : scoreEmission({}, f.label, { exhaustive: f.exhaustive });
    const unbound = { workId: p.workId, claims: f.claims.length, unbound: controller.unbound.length };
    const attempt = { workId: p.workId, ok: r.ok, errors: r.errors, evidence: r.evidence, controller: { possibleAliasPairs: aliasPairKeys(controller.possibleAlias), unbound: controller.unbound.map((u) => u.claimId) } };
    writeFileSync(join(wdir, `attempt-${k}.result.json`), `${JSON.stringify(attempt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    writeFileSync(join(wdir, `attempt-${k}.score.json`), `${JSON.stringify(score, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    // Item 1: FATAL apiKeySource invariant — preserve this result, then abort all remaining calls.
    const aks = r.evidence?.apiKeySource;
    if (aks !== 'none') { aborted = { workId: p.workId, apiKeySource: aks ?? null, attempt: k, reason: 'apiKeySource must be "none" — aborting so API credits cannot be consumed silently' }; break; }
    scores.push(score); unboundPerWork.push(unbound);
    if (r.ok) writeFileSync(acceptedPath, `${JSON.stringify({ workId: p.workId, imgSha256: p.img.imgSha256, promptHash: p.promptHash, apiKeySource: 'none', attempt: k, score, unbound, controller: attempt.controller }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  }
  const totalClaims = unboundPerWork.reduce((s, u) => s + u.claims, 0);
  const totalUnbound = unboundPerWork.reduce((s, u) => s + u.unbound, 0);
  const report = {
    runId, generated: 'VSD-034 entity canary',
    kind: 'schema-emission-smoke', // Item 5: NOT a VSD-034 accuracy conclusion.
    measurementReadiness: 'blocked', // Item 5: stays blocked until a frozen owner-labeled holdout exists.
    aborted: aborted || false,
    emission: aggregateEmission(scores),
    unbound: { note: 'hand-authored/provisional — real B2->entity wiring is unbuilt (primitive only)', totalClaims, totalUnbound, rate: totalClaims ? totalUnbound / totalClaims : null, perWork: unboundPerWork },
    aliasNote: 'Real-scene alias precision NOT reported (emitted->gold entity mapping + pair adjudication unbuilt); detection validated by synthetic fixtures only; recall undefined (zero gold positives).',
  };
  writeFileSync(join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'w', mode: 0o600 });
  return { report, aborted };
}

// ---- main ----
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const problems = [];
  const check = (c, m) => { if (!c) problems.push(m); };
  let findings = [];
  try { findings = loadCanonicalFindings(); check(findings.length >= 2, 'canonical findings >=2'); } catch (e) { problems.push(`findings: ${e.message}`); }
  const loaded = existsSync(FIX) ? loadFixtures() : null;
  check(!!loaded, 'fixtures load + verify');
  const fixtures = loaded ? loaded.fixtures : [];
  for (const f of fixtures) {
    check(validateEntityGraph(f.label).ok, `label valid: ${f.workId}`);
    const got = runController(f.label, f.claims);
    check(JSON.stringify(aliasPairKeys(got.possibleAlias)) === JSON.stringify([...f.expected.aliasPairs].sort()), `alias self-consistent: ${f.workId}`);
    check(JSON.stringify(got.unbound.map((u) => u.claimId).sort()) === JSON.stringify([...f.expected.unbound].sort()), `unbound self-consistent: ${f.workId}`);
    const s = scoreEmission(f.label, f.label, { exhaustive: f.exhaustive });
    check(s.schemaValid && s.entityRecall === 1 && s.typeAccuracy === 1, `evaluator round-trip: ${f.workId}`);
  }
  check(fixtures.every((f) => f.expected.aliasPairs.length === 0), 'zero GOLD alias positives');
  for (const wid of ['wikidata:Q16467705', 'wikidata:Q1211814']) {
    let blocked = false;
    try { buildApproval({ runDir: UPSTREAM, workId: wid, teachPath: 'data/teach-works.js', hotspotsPath: 'data/hotspots.js' }); } catch (e) { blocked = /content-blocked/.test(e.message); }
    check(blocked, `enforcement blocks ${wid}`);
  }
  const plans = fixtures.map(planWork);
  for (const p of plans) check(p.img.receiptOk, `image receipt verified: ${p.workId}`);

  if (problems.length) { console.error(`4a integrity/self-consistency: FAIL (${problems.length})\n  ` + problems.join('\n  ')); process.exit(1); }
  const { runId, binding } = computeRunId(loaded.artifact, plans);

  if (process.argv.includes('--run')) {
    if (process.env.PASS_B_ENTITY_LIVE !== '1') { console.error('refusing 4b: set PASS_B_ENTITY_LIVE=1 to run the bounded model canary (it spends subscription usage)'); process.exit(2); }
    const outDir = join(CAL_ROOT, runId);
    const { report, aborted } = await runCanary({ fixtures, plans, runId, binding, outDir, resume: process.argv.includes('--resume') });
    console.log(aborted ? `4b ABORTED at ${aborted.workId} (apiKeySource=${aborted.apiKeySource}); ${outDir}/report.json` : `4b DONE (schema-emission-smoke); ${outDir}/report.json`);
    process.exit(0);
  }

  console.log('4a integrity/self-consistency: PASS');
  console.log('    both seals verify; all fixtures valid + controller self-consistent + evaluator round-trips; enforcement fires; image receipts verified.');
  console.log('measurement-readiness: BLOCKED — VSD-034 measurement requires frozen OWNER-LABELED pixel ground truth.');
  console.log('');
  console.log('4b BOUNDED MODEL CANARY — BOUND, CHECKPOINTED PLAN (NOT RUN; requires --run + PASS_B_ENTITY_LIVE=1 + owner spend authorization):');
  console.log(`    runId: ${runId}   output: ${join(CAL_ROOT, runId)}/   (immutable run-manifest.json written before the first call)`);
  console.log(`    model: ${CALIBRATION_MODEL}   prompt: ${ENTITY_PROMPT_VERSION}   wireSchema: ${ENTITY_GRAPH_VERSION} (sha ${binding.wireSchemaSha256.slice(0, 12)})`);
  console.log(`    transport: ${ENTITY_TRANSPORT_VERSION} — Read-tool confined temp dir, --tools Read, API keys stripped; apiKeySource:none is FATAL per-call (abort-on-fail).`);
  console.log('    resumable: reuses verified accepted checkpoints, preserves failed attempts, never repeats/overwrites a valid call.');
  console.log(`    calls: ${plans.length} (one per fixture work), each bound to its verified image receipt:`);
  for (const p of plans) console.log(`      - ${p.workId} [${p.set}] img=${p.img.imgSha256.slice(0, 12)} receipt=${p.img.receiptOk ? 'OK' : 'MISSING'} promptHash=${p.promptHash.slice(0, 12)} argvSha=${p.commandArgvSha256.slice(0, 12)}`);
  console.log('    report: kind=schema-emission-smoke, measurementReadiness=blocked, unbound rate (hand-authored/provisional), NO real-scene alias precision.');
  console.log('    STOP: do not run without explicit owner spend authorization.');
}
