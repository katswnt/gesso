// Frozen 10-work end-to-end staging pilot (release rehearsal). Fresh B1-B4 under the CURRENT FROZEN contracts
// (stock stagePrompts()); reuses the verified cal50 sanitized derivatives (current images, never refetched);
// confined-dir transport, API keys stripped, apiKeySource:none FATAL, model pinned; bound manifest + receipts +
// transcripts; resumable checkpoints. HARD CAP 45 subscription calls. No prompt/schema/policy/code changes, no
// production writes, no approvals, no owner authority, no active-pointer changes. A model/validation error is
// recorded and held, not repaired. Reconciliation + review projection + scorecard are a SEPARATE offline step.
//   node scripts/pass-b-staging-pilot.mjs            # DRY: offline provenance/transport validation only
//   PASS_B_PILOT_LIVE=1 node scripts/pass-b-staging-pilot.mjs --run
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { sha256 } from './lib/vision-legacy.mjs';
import { captureStageCompletion, verifyCapturedStage } from './lib/vision-content-capture.mjs';
import { stagePrompts } from './lib/pass-b-prompts.mjs';
import {
  RUN_ROOT, CALIBRATION_MODEL, IMAGE_TRANSPORT_VERSION, VALIDATION_CONTRACT_VERSION, contractHash,
  runWorkStages, buildStageCommand, neutralImageFile, parseStreamTranscript, transcriptFinal,
  verifyB1ImageRead, verifyB2WebEvents, primaryModelFromEnvelope,
} from './lib/pass-b-calibration.mjs';

const execFileP = promisify(execFile);
const CAL = RUN_ROOT;
const UPSTREAM = join(CAL, 'cal50-0a47b6f7f332');
const MAX_CALLS = 45;
// Cohort (ids normalized to their exact pool id form; the two "missing" QIDs were id-form mismatches).
const COHORT = [
  { id: 'wikidata:Q16467705', label: 'La Gloire' },
  { id: 'wikidata:Q1211814', label: 'St. John Chrysostom' },
  { id: 'harvard303416', label: 'Hydria' },
  { id: 'http://www.wikidata.org/entity/Q405814', label: 'Ship of Fools (Q405814)' },
  { id: 'wikidata:Q1616056', label: 'Hestia Tapestry' },
  { id: 'http://www.wikidata.org/entity/Q1190706', label: 'Castor and Pollux (Q1190706)' },
  { id: 'met247010', label: 'Roman wall painting' },
  { id: 'aic124043', label: 'Versailles, Vase' },
  { id: 'wikidata:Q48881623', label: 'Zong-shaped vase' },
  { id: 'wikidata:Q537640', label: 'Angelus Novus' },
];
const PILOT_VERSION = 'passBStagingPilot/1';
const prompts = stagePrompts();
const promptHashes = Object.fromEntries(Object.entries(prompts).map(([k, v]) => [k, sha256(v)]));
const RUN_ID = 'pilot-' + contractHash({ ids: COHORT.map(c => c.id), promptHashes, model: CALIBRATION_MODEL, transport: IMAGE_TRANSPORT_VERSION, validation: VALIDATION_CONTRACT_VERSION });
const RUN_DIR = join(CAL, RUN_ID);
const rawFileSha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const wdirOf = (id) => sha256(id).slice(0, 24);

function reuseB0(id) {
  const wdir = join(UPSTREAM, 'works', wdirOf(id));
  const b0 = JSON.parse(readFileSync(join(wdir, 'b0-prep.json'), 'utf8'));
  const { imgSha256, ext } = b0.image;
  const file = neutralImageFile(imgSha256, ext);
  let imgsDir = null;
  for (const d of readdirSync(CAL).filter(x => /^imgs-/.test(x))) if (existsSync(join(CAL, d, file))) { imgsDir = join(CAL, d); break; }
  if (!imgsDir) throw new Error(`FAIL-CLOSED: verified derivative missing for ${id} (${file})`);
  if (rawFileSha(join(imgsDir, file)) !== imgSha256) throw new Error(`FAIL-CLOSED: derivative rehash mismatch for ${id}`);
  return { imgSha256, ext, imgsDir, trustedCatalog: b0.trustedCatalog, legacy: b0.legacy, image: b0.image };
}

// Run-wide, cross-process call accounting: every transcript attempt EVER written under this run (including
// errors and calls from earlier process executions) counts against the immutable MAX_CALLS cap, so a resume
// can never re-open the budget. Counted from the durable attempt transcripts, not a per-process variable.
export function countExistingAttempts(runDir) {
  const worksDir = join(runDir, 'works');
  if (!existsSync(worksDir)) return 0;
  let n = 0;
  for (const w of readdirSync(worksDir)) {
    const a = join(worksDir, w, 'attempts');
    if (existsSync(a)) n += readdirSync(a).filter(f => f.endsWith('.transcript.jsonl')).length;
  }
  return n;
}
let CALLS = 0;
function makeSpawnStage(workRunDir, imgsDir, imgSha256, ext) {
  const attemptsDir = join(workRunDir, 'attempts'); mkdirSync(attemptsDir, { recursive: true, mode: 0o700 });
  return async (stage, { command, imageFile }) => {
    if (CALLS >= MAX_CALLS) throw new Error(`call-budget-exhausted (${MAX_CALLS}) — held`);
    CALLS += 1;
    const call = mkdtempSync(join(tmpdir(), 'pilot-'));
    try {
      if (imageFile) copyFileSync(join(imgsDir, `${imgSha256}.${ext}`), join(call, imageFile));
      const env = { ...process.env }; for (const k of command.env.removeKeys) delete env[k];
      let stdout = '', exitCode = 0;
      try { ({ stdout } = await execFileP(command.bin, command.argv, { cwd: call, env, maxBuffer: 64 * 1024 * 1024 })); }
      catch (e) { exitCode = e.code ?? 1; stdout = e.stdout || ''; }
      const transcript = parseStreamTranscript(stdout);
      const final = transcriptFinal(transcript);
      writeFileSync(join(attemptsDir, `${stage.toLowerCase()}-${sha256(stdout).slice(0, 12)}.transcript.jsonl`), stdout, { mode: 0o600 });
      const apiKeySource = transcript.init?.apiKeySource ?? null;
      const model = primaryModelFromEnvelope(final);
      if (exitCode !== 0 || !final) throw new Error(`process failed (exit ${exitCode})`);
      if (final.is_error === true || (final.subtype && final.subtype !== 'success')) throw new Error(`stage errored (subtype=${final.subtype})`);
      if (apiKeySource !== 'none') throw new Error(`FAIL-CLOSED apiKeySource must be none, got ${apiKeySource}`);
      if (model !== CALIBRATION_MODEL) throw new Error(`model drift: ${model}`);
      if (final.structured_output == null) throw new Error('no structured_output');
      if (stage === 'B1' || stage === 'B3') { const r = verifyB1ImageRead(transcript, { callDir: call, imageBasename: imageFile }); if (!r.ok) throw new Error(`image receipt: ${r.reason}`); }
      if (stage === 'B2') { const w = verifyB2WebEvents(transcript); if (!w.ok) throw new Error(w.reason); }
      return { raw: JSON.stringify(final.structured_output), transcriptSha256: sha256(stdout) };
    } finally { rmSync(call, { recursive: true, force: true }); }
  };
}
const makeCapture = (workRunDir) => async ({ stage, rawResponse, trusted, producer, context }) => {
  const cap = captureStageCompletion({ runDir: workRunDir, stage, rawResponse, trusted, producer, createdAt: new Date().toISOString(), context });
  const v = verifyCapturedStage({ completionPath: cap.completionPath, runDir: workRunDir, trusted, producer, context });
  if (!v.ok) throw new Error(v.errors.join(','));
  return cap;
};
// Resume checkpoint: return a completed stage's body iff its captured completion matches the current prompt.
const makeLoadCompletion = (workRunDir) => (stage, { promptHash }) => {
  const dir = join(workRunDir, 'completions');
  if (!existsSync(dir)) return null;
  const f = readdirSync(dir).find(x => x.startsWith(`${stage.toLowerCase()}-`));
  if (!f) return null;
  try { const c = JSON.parse(readFileSync(join(dir, f), 'utf8')); return c.promptHash === promptHash ? c.body : null; }
  catch { return null; }
};

async function main() {
  const live = process.argv.includes('--run');
  if (live && process.env.PASS_B_PILOT_LIVE !== '1') { console.error('refusing --run: set PASS_B_PILOT_LIVE=1'); process.exit(2); }
  const prepared = [];
  for (const w of COHORT) {
    const r = reuseB0(w.id);
    const cmd = buildStageCommand({ stage: 'B1', promptText: 'probe', imageFile: neutralImageFile(r.imgSha256, r.ext) });
    if (cmd.toolsEnforced !== 'Read' || !cmd.env.removeKeys.includes('ANTHROPIC_API_KEY')) throw new Error('transport policy check failed');
    prepared.push({ ...w, ...r });
    console.log(`B0 reuse ok ${w.id.padEnd(40)} img=${r.imgSha256.slice(0, 12)} receipt-verified`);
  }
  console.log(`\nrunId: ${RUN_ID}  works: ${COHORT.length}  MAX calls: ${MAX_CALLS}`);
  console.log(`frozen prompt hashes: ${Object.entries(promptHashes).map(([k, v]) => `${k}=${v.slice(0, 8)}`).join(' ')}`);
  console.log('transport: confined dir, --tools Read / web-only, API keys stripped, apiKeySource:none FATAL, model=' + CALIBRATION_MODEL);
  console.log('OFFLINE VALIDATION: PASS (10/10 derivatives located + rehashed; transport policy verified).');
  if (!live) { console.log('\nDRY RUN — no calls. Re-run with PASS_B_PILOT_LIVE=1 --run to fire.'); return; }

  mkdirSync(join(RUN_DIR, 'works'), { recursive: true, mode: 0o700 });
  CALLS = countExistingAttempts(RUN_DIR); // resume-safe: prior attempts (any process) already count against the cap
  if (CALLS >= MAX_CALLS) { console.error(`FAIL-CLOSED: run already used ${CALLS}/${MAX_CALLS} attempts across executions — no further calls permitted`); process.exit(3); }
  console.log(`resume-safe budget: ${CALLS}/${MAX_CALLS} attempts already recorded for this run`);
  if (!existsSync(join(RUN_DIR, 'run-manifest.json'))) writeFileSync(join(RUN_DIR, 'run-manifest.json'), `${JSON.stringify({ version: 'passBRunManifest/1', runId: RUN_ID, kind: 'staging-pilot', frozen: true, model: CALIBRATION_MODEL, transport: IMAGE_TRANSPORT_VERSION, validation: VALIDATION_CONTRACT_VERSION, promptHashes, works: COHORT.map(c => c.id) }, null, 1)}\n`, { mode: 0o600 });
  // Works are independent — run them with bounded CROSS-WORK concurrency (stages within a work stay sequential).
  // This is orchestration only: identical frozen prompts/schemas/validation and the SAME shared 45-call budget
  // (the CALLS check+increment is synchronous, so concurrency can never exceed MAX_CALLS). Results are identical
  // to the sequential run; only wall-clock changes.
  const CONCURRENCY = Math.max(1, Math.min(6, Number(process.env.PILOT_CONCURRENCY || 4)));
  const runOne = async (p) => {
    const workRunDir = join(RUN_DIR, 'works', wdirOf(p.id));
    mkdirSync(workRunDir, { recursive: true, mode: 0o700 });
    if (!existsSync(join(workRunDir, 'b0-prep.json'))) writeFileSync(join(workRunDir, 'b0-prep.json'), `${JSON.stringify({ version: 'passBCalibrationB0/1', work: { id: p.id }, trustedCatalog: p.trustedCatalog, legacy: p.legacy, image: p.image, reusedFrom: 'cal50-0a47b6f7f332' }, null, 1)}\n`, { mode: 0o600 });
    let status, bodies;
    try {
      ({ status, bodies } = await runWorkStages({
        workId: p.id, catalog: p.trustedCatalog, legacy: p.legacy, imgSha256: p.imgSha256, ext: p.ext,
        prompts, runtimeVersion: process.env.CLAUDE_CODE_VERSION || 'unknown',
        spawnStage: makeSpawnStage(workRunDir, p.imgsDir, p.imgSha256, p.ext), capture: makeCapture(workRunDir),
        loadCompletion: makeLoadCompletion(workRunDir), skipB4: false,
      }));
    } catch (e) { status = { fatal: e.message.slice(0, 120) }; bodies = {}; } // recorded + held, never repaired
    console.log(`\n=== ${p.label} (${p.id}) === calls-so-far=${CALLS}\n  ${JSON.stringify(status)}`);
    return { id: p.id, label: p.label, status, stages: Object.keys(bodies) };
  };
  const results = new Array(prepared.length);
  let next = 0;
  const worker = async () => { while (next < prepared.length) { const i = next++; results[i] = await runOne(prepared[i]); } };
  console.log(`\nRunning ${prepared.length} works with cross-work concurrency ${CONCURRENCY} (stages sequential per work).`);
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  writeFileSync(join(RUN_DIR, 'pilot.json'), `${JSON.stringify({ version: PILOT_VERSION, runId: RUN_ID, callsUsed: CALLS, maxCalls: MAX_CALLS, works: results, idFormNote: 'Q405814 and Q1190706 were requested as wikidata:Qn but the pool stores them as http://www.wikidata.org/entity/Qn; normalized, no substitution.' }, null, 1)}\n`, { mode: 0o600 });
  console.log(`\nPILOT STAGES DONE. runId ${RUN_ID}. calls used: ${CALLS}/${MAX_CALLS}. Next: offline reconciliation + review projection + scorecard.`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { console.error(`FAIL-CLOSED: ${e.message}`); process.exit(1); });
