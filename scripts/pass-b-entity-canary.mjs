// VSD-034 item 4: entity canary.
//   default            -> 4a OFFLINE validation (no model): integrity/self-consistency PASS/FAIL +
//                         measurement-readiness state + the BOUND, checkpointed 4b plan.
//   --run + PASS_B_ENTITY_LIVE=1 -> 4b bounded model canary (schema-emission SMOKE). NOT run here.
// The raw transcript is the SINGLE source of truth: one derivation path (deriveAttempt) runs on both the
// forward call and resume, so resume reopens preserved evidence and RE-VERIFIES + RECOMPUTES rather than
// trusting stored scores. callFn is injectable so all of this is regression-tested offline with no model.
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
export const ENTITY_PROMPT_VERSION = 'contentVisionEntityPrompt/2'; // /2: relation guidance tightened (intentional)
export const ENTITY_TRANSPORT_VERSION = 'entityReadConfinedDir/1';
export const CANARY_CONTRACT_VERSION = 'passBEntityCanary/3'; // /3: execution evidence binds the confined-dir transport receipt
const fileRawSha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex'); // raw bytes (broker naming)
const safeId = (id) => id.replace(/[^a-z0-9]+/gi, '_');
const runIdFromBinding = (binding) => `b6c-${sha256(stableJson(binding)).slice(0, 12)}`;

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
    if (existsSync(p)) return { imgSha256: b0.image.imgSha256, ext: b0.image.ext, file, path: p, receiptOk: fileRawSha(p) === b0.image.imgSha256 };
  }
  return { imgSha256: b0.image.imgSha256, ext: b0.image.ext, file, path: null, receiptOk: false };
}

// The COMPLETE command policy (item 2): binary, argv, removed env keys, tool policy, image filename, schema hash.
function commandPolicy(command) {
  return { bin: command.bin, argv: command.argv, removeKeys: command.env.removeKeys, toolsEnforced: command.toolsEnforced, imageFile: command.imageFile, wireSchemaSha256: command.wireSchemaSha256 };
}

export function planWork(f) {
  const img = resolveImage(f.workId);
  const promptText = buildEntityPrompt(img.file);
  const command = img.file && /^[0-9a-f]{64}\.[a-z0-9]{1,5}$/.test(img.file)
    ? buildStageCommand({ stage: 'B5', promptText, imageFile: img.file, wireSchema: ENTITY_GRAPH_WIRE_SCHEMA }) : null;
  const policy = command ? commandPolicy(command) : null;
  return { workId: f.workId, set: f.set, exhaustive: f.exhaustive, img, promptText, promptHash: sha256(promptText), command, commandPolicy: policy, commandPolicySha256: policy ? sha256(stableJson(policy)) : null };
}

export function computeRunId(fixturesArtifact, plans) {
  const binding = {
    version: CANARY_CONTRACT_VERSION, fixturesSha256: fixturesArtifact.fixturesSha256,
    entityGraphVersion: ENTITY_GRAPH_VERSION, controllerPolicyVersion: CONTROLLER_POLICY_VERSION,
    promptVersion: ENTITY_PROMPT_VERSION, transportVersion: ENTITY_TRANSPORT_VERSION, model: CALIBRATION_MODEL,
    wireSchemaSha256: sha256(stableJson(ENTITY_GRAPH_WIRE_SCHEMA)),
    works: plans.map((p) => ({ workId: p.workId, imgSha256: p.img.imgSha256, promptHash: p.promptHash, commandPolicySha256: p.commandPolicySha256 })),
  };
  return { runId: runIdFromBinding(binding), binding };
}

// Real per-call executor: runs the command, returns the raw transcript + exitCode + the controller-owned
// TRANSPORT receipt (the exact confined callDir + expected absolute image path). The receipt is captured
// before the temp dir is deleted so image-Read confinement can be verified from the recorded directory
// (never a null callDir, which would accept the right filename read from OUTSIDE the confined dir).
export async function callEntity(plan) {
  if (!plan.command || !plan.img.receiptOk) return { transcript: '', exitCode: 97, transport: null };
  const callDir = mkdtempSync(join(tmpdir(), 'pass-b-entity-'));
  const transport = { callDir, imageFile: plan.img.file, imageAbsPath: join(callDir, plan.img.file) };
  try {
    copyFileSync(plan.img.path, transport.imageAbsPath);
    const env = { ...process.env }; for (const k of plan.command.env.removeKeys) delete env[k];
    try { const { stdout } = await execFileP(plan.command.bin, plan.command.argv, { cwd: callDir, env, maxBuffer: 32 * 1024 * 1024 }); return { transcript: stdout, exitCode: 0, transport }; }
    catch (e) { return { transcript: e.stdout || '', exitCode: e.code ?? 1, transport }; }
  } finally { rmSync(callDir, { recursive: true, force: true }); }
}

// SINGLE derivation path (forward AND resume): parse the raw transcript and re-verify everything from it,
// using the recorded confined callDir so the image Read must target the EXACT confined path (basename alone
// is not sufficient). A missing callDir fails closed.
export function deriveAttempt(plan, transcript, exitCode, callDir) {
  const t = parseStreamTranscript(transcript);
  const final = transcriptFinal(t);
  const graph = final?.structured_output ?? null;
  const receipt = callDir ? verifyB1ImageRead(t, { callDir, imageBasename: plan.img.file }) : { ok: false, reason: 'no transport callDir' };
  const validation = graph ? validateEntityGraph(graph) : { ok: false, errors: ['no structured output'] };
  const resolvedModel = primaryModelFromEnvelope(final);
  const errors = [];
  if ((exitCode ?? 0) !== 0 || !final || final.is_error) errors.push(`process failed (exit ${exitCode})`);
  if (!receipt.ok) errors.push(`image receipt: ${receipt.reason}`);
  if (resolvedModel !== CALIBRATION_MODEL) errors.push(`model drift: ${resolvedModel}`);
  if (!validation.ok) errors.push(...validation.errors);
  return {
    ok: errors.length === 0, errors, graph,
    evidence: { transcriptSha256: sha256(transcript), resolvedModel, apiKeySource: t.init?.apiKeySource ?? null, claudeCodeVersion: t.init?.claudeCodeVersion ?? null, usage: final?.usage ?? null, modelUsage: final?.modelUsage ?? null, numTurns: final?.num_turns ?? null, imageReceipt: receipt, imgSha256: plan.img.imgSha256, promptHash: plan.promptHash, exitCode: exitCode ?? 0 },
  };
}

// Score + controller from a derived attempt (pure, shared by forward and resume so results are identical).
function scoreAttempt(att, f) {
  const g = (att.ok && att.graph) ? att.graph : { version: ENTITY_GRAPH_VERSION, regions: [], entities: [], uncertainty: '' };
  const controller = runController(g, f.claims);
  const score = (att.ok && att.graph) ? scoreEmission(att.graph, f.label, { exhaustive: f.exhaustive }) : scoreEmission({}, f.label, { exhaustive: f.exhaustive });
  return { score, controller, unbound: { workId: f.workId, claims: f.claims.length, unbound: controller.unbound.length } };
}

export async function runCanary({ fixtures, plans, runId, binding, outDir, callFn, resume = false }) {
  const call = callFn || callEntity;
  const manifestPath = join(outDir, 'run-manifest.json');
  if (resume) {
    if (!existsSync(manifestPath)) throw new Error('resume: no run-manifest.json');
    const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
    // Item 3: recompute the run ID from the STORED binding (catches a tampered manifest.binding.*), require
    // exact equality with the expected binding, and match the expected run ID.
    if (runIdFromBinding(m.binding) !== m.runId) throw new Error('resume: manifest runId does not match its binding (tampered)');
    if (m.runId !== runId) throw new Error('resume: manifest/binding mismatch');
    if (stableJson(m.binding) !== stableJson(binding)) throw new Error('resume: binding not exactly equal to expected');
  } else {
    if (existsSync(outDir)) throw new Error(`refusing to overwrite ${outDir}`);
    mkdirSync(join(outDir, 'works'), { recursive: true, mode: 0o700 });
    writeFileSync(manifestPath, `${JSON.stringify({ runId, binding, generated: 'VSD-034 entity canary' }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  }
  const scores = []; const unboundPerWork = []; let aborted = null;
  for (const p of plans) {
    const wdir = join(outDir, 'works', safeId(p.workId));
    if (!existsSync(wdir)) mkdirSync(wdir, { recursive: true, mode: 0o700 });
    const inputPath = join(wdir, 'input.json');
    if (!existsSync(inputPath)) writeFileSync(inputPath, `${JSON.stringify({ workId: p.workId, imgSha256: p.img.imgSha256, promptHash: p.promptHash, commandPolicySha256: p.commandPolicySha256, commandPolicy: p.commandPolicy }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    const f = fixtures.find((x) => x.workId === p.workId);
    const acceptedPath = join(wdir, 'accepted.json');

    if (existsSync(acceptedPath)) {
      // Item 4: DO NOT trust accepted.json's scores. Verify its hash bindings, reopen the preserved transcript,
      // re-derive + re-verify from it, RECOMPUTE score/controller, and require agreement. Fail closed otherwise.
      const acc = JSON.parse(readFileSync(acceptedPath, 'utf8'));
      if (acc.imgSha256 !== p.img.imgSha256 || acc.promptHash !== p.promptHash || acc.commandPolicySha256 !== p.commandPolicySha256) throw new Error(`resume: checkpoint binding mismatch for ${p.workId}`);
      const trPath = join(wdir, `attempt-${acc.attempt}.transport.json`), tPath = join(wdir, `attempt-${acc.attempt}.transcript.jsonl`), rPath = join(wdir, `attempt-${acc.attempt}.result.json`), sPath = join(wdir, `attempt-${acc.attempt}.score.json`);
      // Verify the transport receipt hash + binding FIRST, then use its recorded callDir for exact-dir Read verification.
      const trText = readFileSync(trPath, 'utf8');
      if (sha256(trText) !== acc.transportSha256) throw new Error(`resume: transport receipt tampered for ${p.workId}`);
      const transport = JSON.parse(trText);
      if (!transport || transport.imageFile !== p.img.file || !transport.callDir) throw new Error(`resume: transport binding mismatch for ${p.workId}`);
      const tText = readFileSync(tPath, 'utf8');
      if (sha256(tText) !== acc.transcriptSha256) throw new Error(`resume: transcript tampered for ${p.workId}`);
      if (sha256(readFileSync(rPath, 'utf8')) !== acc.resultSha256) throw new Error(`resume: result evidence tampered for ${p.workId}`);
      if (sha256(readFileSync(sPath, 'utf8')) !== acc.scoreSha256) throw new Error(`resume: score tampered for ${p.workId}`);
      const att = deriveAttempt(p, tText, 0, transport.callDir);
      if (!att.ok) throw new Error(`resume: re-verification failed for ${p.workId}: ${att.errors.join('|')}`);
      if (att.evidence.apiKeySource !== 'none') throw new Error(`resume: apiKeySource not none for ${p.workId}`);
      const re = scoreAttempt(att, f);
      if (stableJson(re.score) !== stableJson(JSON.parse(readFileSync(sPath, 'utf8')))) throw new Error(`resume: recomputed score disagrees with stored for ${p.workId}`);
      scores.push(re.score); unboundPerWork.push(re.unbound); continue;
    }

    // Fresh attempt (append-only evidence).
    const k = readdirSync(wdir).filter((x) => /^attempt-\d+\.result\.json$/.test(x)).length + 1;
    const raw = await call(p); // {transcript, exitCode, transport}
    const att = deriveAttempt(p, raw.transcript, raw.exitCode, raw.transport?.callDir ?? null);
    const { score, controller, unbound } = scoreAttempt(att, f);
    // Preserve FULL alias-referral detail (types, IoU, declaredRelation, priority) and full unbound objects
    // (disposition/route/reason) as diagnostic evidence — not reduced to pair/claim IDs.
    const result = { workId: p.workId, ok: att.ok, errors: att.errors, evidence: att.evidence, controller: { possibleAlias: controller.possibleAlias, aliasPairKeys: aliasPairKeys(controller.possibleAlias), unbound: controller.unbound } };
    const tStr = raw.transcript || '', rStr = `${JSON.stringify(result, null, 2)}\n`, sStr = `${JSON.stringify(score, null, 2)}\n`, trStr = `${JSON.stringify(raw.transport ?? null, null, 2)}\n`;
    writeFileSync(join(wdir, `attempt-${k}.transcript.jsonl`), tStr, { flag: 'wx', mode: 0o600 });
    writeFileSync(join(wdir, `attempt-${k}.transport.json`), trStr, { flag: 'wx', mode: 0o600 }); // controller-owned transport evidence
    writeFileSync(join(wdir, `attempt-${k}.result.json`), rStr, { flag: 'wx', mode: 0o600 });
    writeFileSync(join(wdir, `attempt-${k}.score.json`), sStr, { flag: 'wx', mode: 0o600 });
    // Item 1: FATAL apiKeySource — preserve this attempt, then abort all remaining calls.
    if (att.evidence.apiKeySource !== 'none') { aborted = { workId: p.workId, apiKeySource: att.evidence.apiKeySource ?? null, attempt: k, reason: 'apiKeySource must be "none" — aborting so API credits cannot be consumed silently' }; break; }
    scores.push(score); unboundPerWork.push(unbound);
    if (att.ok) writeFileSync(acceptedPath, `${JSON.stringify({ workId: p.workId, imgSha256: p.img.imgSha256, promptHash: p.promptHash, commandPolicySha256: p.commandPolicySha256, apiKeySource: 'none', attempt: k, transportSha256: sha256(trStr), transcriptSha256: sha256(tStr), resultSha256: sha256(rStr), scoreSha256: sha256(sStr) }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  }
  const totalClaims = unboundPerWork.reduce((s, u) => s + u.claims, 0);
  const totalUnbound = unboundPerWork.reduce((s, u) => s + u.unbound, 0);
  const report = {
    runId, generated: 'VSD-034 entity canary', kind: 'schema-emission-smoke', measurementReadiness: 'blocked', aborted: aborted || false,
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
  console.log(`4b BOUNDED MODEL CANARY — BOUND, CHECKPOINTED PLAN (NOT RUN; requires --run + PASS_B_ENTITY_LIVE=1 + owner spend authorization):`);
  console.log(`    contract: ${CANARY_CONTRACT_VERSION}   runId: ${runId}   output: ${join(CAL_ROOT, runId)}/   (immutable run-manifest.json written before the first call)`);
  console.log(`    model: ${CALIBRATION_MODEL}   prompt: ${ENTITY_PROMPT_VERSION}   wireSchema: ${ENTITY_GRAPH_VERSION} (sha ${binding.wireSchemaSha256.slice(0, 12)})`);
  console.log(`    transport: ${ENTITY_TRANSPORT_VERSION} — Read-tool confined temp dir, --tools Read, API keys stripped; apiKeySource:none is FATAL per-call (abort-on-fail).`);
  console.log('    resumable: transcript + controller-owned transport receipt are the source of truth — image Read is verified against the EXACT confined dir');
  console.log('               (not the basename alone); resume reopens preserved evidence, re-verifies + recomputes, fails closed on any disagreement.');
  console.log(`    calls: ${plans.length} (one per fixture work), each bound to its verified image receipt + complete command policy:`);
  for (const p of plans) console.log(`      - ${p.workId} [${p.set}] img=${p.img.imgSha256.slice(0, 12)} receipt=${p.img.receiptOk ? 'OK' : 'MISSING'} promptHash=${p.promptHash.slice(0, 12)} cmdPolicy=${p.commandPolicySha256.slice(0, 12)}`);
  console.log('    report: kind=schema-emission-smoke, measurementReadiness=blocked, unbound rate (hand-authored/provisional), NO real-scene alias precision.');
  console.log('    STOP: do not run without explicit owner spend authorization.');
}
