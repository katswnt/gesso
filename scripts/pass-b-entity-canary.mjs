// VSD-034 item 4: entity canary.
//   default            -> 4a OFFLINE validation (no model, no image bytes read): integrity/self-consistency
//                         PASS/FAIL + measurement-readiness state + the BOUND 4b plan (image receipts verified).
//   --run + PASS_B_ENTITY_LIVE=1 -> 4b bounded model canary. IMPLEMENTED but intentionally NOT RUN here.
// No production writes; no claim graph / reconciler / curated index. Bindings are computed so a later review
// can authorize the spend against an exact, reproducible run identity.
import { readFileSync, existsSync, readdirSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
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
const ENTITY_PROMPT_VERSION = 'contentVisionEntityPrompt/1';
const ENTITY_TRANSPORT_VERSION = 'entityReadConfinedDir/1';
// RAW-BYTES sha256 (the broker named derivatives this way; vision-legacy.sha256 JSON-stringifies non-strings).
const fileSha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

// Image-only emission prompt: region-bound TYPED entities + relations; NO identity names, catalog, or research.
function buildEntityPrompt(imageFile) {
  return [
    'You are a blind visual entity-inventory analyst. You have ONLY the Read tool and a working directory with exactly ONE image file; open it with Read first and work only from the pixels.',
    `Image file: ${imageFile}. You have no title, artist, catalog, or web access. Never name or identify a specific person, deity, or work — describe only visible KINDS of things.`,
    'Emit region-bound entity observations. A region has geometry {x,y,w,h} as PERCENT of the image (0..100). Each entity has one or more regionRefs and an entityType from: human, animal, plant, object, architecture, inscription, decorative-motif, ground, vehicle, unknown. Use "unknown" when a form is genuinely unreadable rather than guessing a kind.',
    'Declare relations only when visually clear: partOf (a part of another entity), sameAs (the same physical thing you listed twice), distinctFrom (overlapping but genuinely separate). Do not declare a relation to force a reading.',
    `Output ONE bare JSON object per contentVisionEntityGraph/1 (${ENTITY_GRAPH_VERSION}): {version, regions:[{regionId, geometry, scope, confidence}], entities:[{entityId, regionRefs, entityType, partOf, sameAs, distinctFrom, confidence}], uncertainty}. scope is point|area|whole. If Read fails, set uncertainty and emit empty regions/entities.`,
  ].join('\n');
}

// Resolve a work's sanitized derivative from the upstream B0 + a calibration imgs-* dir, and verify the receipt.
function resolveImage(workId) {
  const b0 = JSON.parse(readFileSync(join(UPSTREAM, 'works', sha256(workId).slice(0, 24), 'b0-prep.json'), 'utf8'));
  const file = neutralImageFile(b0.image.imgSha256, b0.image.ext);
  for (const d of readdirSync(CAL_ROOT).filter((x) => /^imgs-/.test(x))) {
    const p = join(CAL_ROOT, d, file);
    if (existsSync(p)) return { imgSha256: b0.image.imgSha256, ext: b0.image.ext, file, path: p, receiptOk: fileSha(p) === b0.image.imgSha256 };
  }
  return { imgSha256: b0.image.imgSha256, ext: b0.image.ext, file, path: null, receiptOk: false };
}

// Build the bound plan for one fixture (verifies the image receipt + constructs the exact command).
function planWork(f) {
  const img = resolveImage(f.workId);
  const promptText = buildEntityPrompt(img.file);
  const command = img.file && /^[0-9a-f]{64}\.[a-z0-9]{1,5}$/.test(img.file)
    ? buildStageCommand({ stage: 'B5', promptText, imageFile: img.file, wireSchema: ENTITY_GRAPH_WIRE_SCHEMA }) : null;
  return { workId: f.workId, set: f.set, exhaustive: f.exhaustive, img, promptText, promptHash: sha256(promptText), command };
}

function computeRunId(fixturesArtifact, plans) {
  const binding = {
    version: 'passBEntityCanary/1', fixturesSha256: fixturesArtifact.fixturesSha256,
    entityGraphVersion: ENTITY_GRAPH_VERSION, controllerPolicyVersion: CONTROLLER_POLICY_VERSION,
    promptVersion: ENTITY_PROMPT_VERSION, transportVersion: ENTITY_TRANSPORT_VERSION, model: CALIBRATION_MODEL,
    wireSchemaSha256: sha256(stableJson(ENTITY_GRAPH_WIRE_SCHEMA)),
    works: plans.map((p) => ({ workId: p.workId, imgSha256: p.img.imgSha256, promptHash: p.promptHash })),
  };
  return { runId: `b6c-${sha256(stableJson(binding)).slice(0, 12)}`, binding };
}

// ---- 4b execution (IMPLEMENTED; runs ONLY under --run + PASS_B_ENTITY_LIVE=1; not invoked in this pass) ----
async function callEntity(plan, imageDir) {
  if (!plan.command || !plan.img.receiptOk) return { workId: plan.workId, ok: false, errors: ['image receipt invalid'], evidence: {} };
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
      workId: plan.workId, ok: errors.length === 0, errors, graph,
      evidence: { durationMs: Date.now() - started, transcriptSha256: sha256(stdout), resolvedModel, apiKeySource: transcript.init?.apiKeySource ?? null, imageReceipt: receipt, imgSha256: plan.img.imgSha256, promptHash: plan.promptHash, exitCode },
      transcript: stdout,
    };
  } finally { rmSync(callDir, { recursive: true, force: true }); }
}

async function execute4b(fixtures, plans, runId) {
  if (process.env.PASS_B_ENTITY_LIVE !== '1') throw new Error('--run requires PASS_B_ENTITY_LIVE=1');
  const outDir = join(CAL_ROOT, runId);
  if (existsSync(outDir)) throw new Error(`refusing to overwrite ${outDir}`);
  mkdirSync(join(outDir, 'works'), { recursive: true, mode: 0o700 });
  const scores = [];
  for (const p of plans) {
    const r = await callEntity(p);
    const f = fixtures.find((x) => x.workId === p.workId);
    const safe = p.workId.replace(/[^a-z0-9]+/gi, '_');
    let score = null, controller = null;
    if (r.ok && r.graph) { score = scoreEmission(r.graph, f.label, { exhaustive: f.exhaustive }); controller = runController(r.graph); }
    else score = scoreEmission({}, f.label, { exhaustive: f.exhaustive }); // invalid -> zero
    scores.push(score);
    writeFileSync(join(outDir, 'works', `${safe}.json`), `${JSON.stringify({ ...r, score, predictedAliasPairs: controller ? aliasPairKeys(controller.possibleAlias) : [] }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  }
  const report = {
    runId, generated: 'VSD-034 entity canary 4b',
    emission: aggregateEmission(scores),
    measurementReadiness: 'PROVISIONAL — holdout is authoritative-source-seeded (not owner-labeled); real-image labels non-exhaustive; geometry schematic.',
    aliasNote: 'Real-scene alias PRECISION is NOT reported: emitted entities are not yet mapped to gold physical entities and emitted pairs are not adjudicated. Alias detection is validated only by synthetic controller fixtures. Alias RECALL is undefined (zero gold positives).',
  };
  writeFileSync(join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(`4b DONE ${scores.filter((s) => s.schemaValid).length}/${scores.length} schema-valid; ${outDir}/report.json`);
}

// ---- main ----
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const problems = [];
  const check = (c, m) => { if (!c) problems.push(m); };
  let findings = [];
  try { findings = loadCanonicalFindings(); check(findings.length >= 2, 'canonical findings >=2'); } catch (e) { problems.push(`findings: ${e.message}`); }
  const fixArtifact = existsSync(FIX) ? JSON.parse(readFileSync(FIX, 'utf8')) : null;
  const fixV = fixArtifact ? verifyFixturesArtifact(fixArtifact) : { ok: false, error: 'absent' };
  check(fixV.ok, `fixtures integrity: ${fixV.error || 'ok'}`);
  const fixtures = fixV.ok ? fixV.fixtures : [];
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
  const { runId, binding } = computeRunId(fixArtifact, plans);

  if (process.argv.includes('--run')) {
    if (process.env.PASS_B_ENTITY_LIVE !== '1') { console.error('refusing 4b: set PASS_B_ENTITY_LIVE=1 to run the bounded model canary (it spends subscription usage)'); process.exit(2); }
    await execute4b(fixtures, plans, runId); process.exit(0);
  }

  console.log('4a integrity/self-consistency: PASS');
  console.log('    both seals verify; all fixtures valid + controller self-consistent + evaluator round-trips; enforcement fires; image receipts verified.');
  console.log('measurement-readiness: BLOCKED — VSD-034 measurement requires frozen OWNER-LABELED pixel ground truth.');
  console.log('    current fixtures: canonical regressions audit-confirmed; controls/holdout authoritative-source-seeded (provisional), non-exhaustive, schematic geometry.');
  console.log('');
  console.log(`4b BOUNDED MODEL CANARY — BOUND PLAN (NOT RUN; requires --run + PASS_B_ENTITY_LIVE=1 + owner spend authorization):`);
  console.log(`    runId: ${runId}   output: ${join(CAL_ROOT, runId)}/`);
  console.log(`    model: ${CALIBRATION_MODEL}   prompt: ${ENTITY_PROMPT_VERSION}   wireSchema: ${ENTITY_GRAPH_VERSION} (sha ${binding.wireSchemaSha256.slice(0, 12)})`);
  console.log(`    transport: ${ENTITY_TRANSPORT_VERSION} — Read-tool confined temp dir, --tools Read, ANTHROPIC_API_KEY/AUTH_TOKEN stripped (apiKeySource:none expected)`);
  console.log(`    calls: ${plans.length} (one per fixture work), each bound to its verified image receipt:`);
  for (const p of plans) console.log(`      - ${p.workId} [${p.set}] img=${p.img.imgSha256.slice(0, 12)} receipt=${p.img.receiptOk ? 'OK' : 'MISSING'} promptHash=${p.promptHash.slice(0, 12)}`);
  console.log('    scoring: schema-conformance rate; unconditional + valid-only entity/type accuracy (macro+micro); unbound rate.');
  console.log('    alias: detection validated by SYNTHETIC fixtures ONLY. Real-scene alias PRECISION is NOT reported until emitted entities are');
  console.log('           mapped to gold physical entities and emitted pairs adjudicated. Alias RECALL undefined (zero gold positives).');
  console.log('    STOP: do not run without explicit owner spend authorization.');
}
