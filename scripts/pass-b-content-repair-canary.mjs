// VSD-035/036 content-repair canary (2 works). Fresh run identity; REUSES the existing verified sanitized
// derivatives + their B0 image receipts (no refetch); passes NULL legacy into synthesis/hydration (legacy is
// quarantined provenance only); uses a versioned CORRECTIVE B4 prompt and NEUTRAL B2/B3 questions. Real
// subscription Claude Code calls, apiKeySource:none FATAL, confined-dir transport, fail-closed receipts.
//   node scripts/pass-b-content-repair-canary.mjs            # DRY: offline provenance/transport validation, no calls
//   PASS_B_CR_LIVE=1 node scripts/pass-b-content-repair-canary.mjs --run   # fire the bounded calls
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { sha256, stableJson } from './lib/vision-legacy.mjs';
import { captureStageCompletion, verifyCapturedStage } from './lib/vision-content-capture.mjs';
import { stagePrompts } from './lib/pass-b-prompts.mjs';
import {
  RUN_ROOT, CALIBRATION_MODEL, IMAGE_TRANSPORT_VERSION, VALIDATION_CONTRACT_VERSION, contractHash,
  trustedCatalog, runWorkStages, buildStageCommand, neutralImageFile,
  parseStreamTranscript, transcriptFinal, verifyB1ImageRead, verifyB2WebEvents, primaryModelFromEnvelope,
} from './lib/pass-b-calibration.mjs';

const execFileP = promisify(execFile);
const CAL = RUN_ROOT;
const UPSTREAM = join(CAL, 'cal50-0a47b6f7f332'); // source of the verified B0 receipts + derivatives to REUSE
const WORKS = ['wikidata:Q16467705', 'wikidata:Q1211814'];
const CANARY_VERSION = 'passBContentRepairCanary/1';
const rawFileSha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

// ---- prompts: B1 blind (unchanged); B2 + neutral research/requests; B3 + neutral answer rules; B4 corrective ----
const base = stagePrompts();
const B2_NEUTRAL = [
  base.B2,
  'CONTENT-REPAIR NEUTRALITY (VSD-036): resolve the holding institution / authoritative record ONLY from the supplied trusted catalog (title/artist/place) — never assume it. For a named identity (who a figure IS), rely on an authoritative holding-museum/scholarly source and RETAIN the exact supporting passage you fetched (you will be asked for it separately). Keep source-established NAMED IDENTITY separate from what pixels can show (visible human/animal form, region). Emit targetedVerificationRequests as LOGICALLY NEUTRAL existence questions that do NOT presuppose the object exists, e.g. "Is a coffin visible? If so, which figure is associated with it?", "Are wings visible? If so, where?", "Is a skull visible? If so, where?", "Which distinct figures/entities are visible in each region, and is each human/animal/object/uncertain?", "Are any supposedly separate entities likely duplicate descriptions of one physical region?". Do not phrase a request to confirm a prior interpretation.',
  'HARD CONFORMANCE (rejected if violated): every guideAnswers[].evidenceRef MUST be either null or an exact evidenceId taken verbatim from the visibleSignals list in CATALOG+SIGNALS — NEVER invent an id and never use a delight/hotspot-style id (no "del1"). Every catalog.sensitivity item MUST be ≤ 100 characters (write terse flags, not sentences; split a long concern into several short items). Keep each guide answer ≤ 1200 characters.',
].join('\n');
const B3_NEUTRAL = [
  base.B3,
  'CONTENT-REPAIR NEUTRALITY (VSD-036): answer each located request from the pixels only, NON-CONFIRMATORY. For each region report the distinct figures/entities actually visible; human / animal / object / uncertain; adult / child where visually supportable; clothed / nude / draped; and whether a coffin, wings, or a skull is ACTUALLY visible (and where) — answer "not visible" when it is not, do not assume the object exists. Never infer animal identity from posture alone. Pixels may establish visible human form and region binding but NOT a historical name. Flag when two "separate" entities are likely one physical region described twice.',
].join('\n');
// Corrective B4 = the FULL base B4 (keeps its register, concision discipline, field-shape rules, and the
// terminal Schema/caps block) + a small versioned corrective addendum. (v1 sliced the base to its Schema tail
// and dropped the "2-4 sentences" discipline, producing over-cap why/notes/guide text — fixed here.)
const B4_CORRECTIVE = [
  base.B4,
  'CONTENT-REPAIR CORRECTION (B4-corrective/VSD-036) — applies on top of everything above:',
  '- There is NO legacy content this run; treat every legacy why/cue/note/guide/hotspot as ABSENT. Never keep or restate a legacy claim — only add/replace from CURRENT B1/B3 visible evidence or a B2 source.',
  '- Treat B1 as fallible visual observation, NOT identity authority; where neutral B3 or an authoritative B2 source contradicts B1, REMOVE/REFUTE the B1 reading — do not harden it.',
  '- Model conflict resolutions are PROPOSALS only; if a claim is unresolved or disputed, OMIT it from player copy and record it in conflicts/uncertainty instead of affirming it.',
  '- Keep source-established NAMED IDENTITY separate from pixel-established region/visible form: a name requires a B2 source; pixels establish only visible form and region.',
  '- Do not assert a feature (wings, skull, a nude figure, a specific figure identity) unless neutral B3 reports it actually visible or B2 authoritatively supports it; otherwise omit and record the uncertainty.',
  '- OBEY EVERY LENGTH CAP EXACTLY (they are hard-rejected): why.text ≤ 500 chars; each note head ≤ 80 and body ≤ 600; each guide answer ≤ 700 and question ≤ 300. Be concise — 2-4 sentences per field. Prefer omitting a claim to exceeding a cap.',
].join('\n');
const PROMPTS = { B1: base.B1, B2: B2_NEUTRAL, B3: B3_NEUTRAL, B4: B4_CORRECTIVE };
const promptHashesLocal = () => Object.fromEntries(Object.entries(PROMPTS).map(([k, v]) => [k, sha256(v)]));

// Fresh run identity bound to the corrective prompts (distinct from every stock/prior run).
const RUN_ID = 'cr2-' + contractHash({ selIds: WORKS, prompts: promptHashesLocal() });
const RUN_DIR = join(CAL, RUN_ID);

// Locate + rehash the EXISTING verified derivative for a work; fail closed if absent/mismatched. Returns the
// reused B0 receipt + the imgs dir holding the derivative (no refetch).
function reuseB0(workId) {
  const wdir = join(UPSTREAM, 'works', sha256(workId).slice(0, 24));
  const b0 = JSON.parse(readFileSync(join(wdir, 'b0-prep.json'), 'utf8'));
  const { imgSha256, ext } = b0.image;
  const file = neutralImageFile(imgSha256, ext);
  let imgsDir = null;
  for (const d of readdirSync(CAL).filter(x => /^imgs-/.test(x))) if (existsSync(join(CAL, d, file))) { imgsDir = join(CAL, d); break; }
  if (!imgsDir) throw new Error(`FAIL-CLOSED: verified derivative not found for ${workId} (${file})`);
  const actual = rawFileSha(join(imgsDir, file));
  if (actual !== imgSha256) throw new Error(`FAIL-CLOSED: derivative rehash mismatch for ${workId}: ${actual} != ${imgSha256}`);
  return { imgSha256, ext, imgsDir, b0, trustedCatalog: b0.trustedCatalog, legacy: b0.legacy };
}

// Live per-stage spawn (replicates the verified calibration transport). apiKeySource:none is FATAL.
function makeSpawnStage(workRunDir, imgsDir, imgSha256, ext) {
  const attemptsDir = join(workRunDir, 'attempts'); mkdirSync(attemptsDir, { recursive: true, mode: 0o700 });
  return async (stage, { command, imageFile }) => {
    const call = mkdtempSync(join(tmpdir(), 'cr-call-'));
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
      if (apiKeySource !== 'none') throw new Error(`FAIL-CLOSED apiKeySource must be none, got ${apiKeySource}`); // subscription-only
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

async function main() {
  const live = process.argv.includes('--run');
  if (live && process.env.PASS_B_CR_LIVE !== '1') { console.error('refusing --run: set PASS_B_CR_LIVE=1 (spends subscription calls)'); process.exit(2); }
  // OFFLINE provenance/transport validation (always). Fail closed here BEFORE any call.
  const prepared = [];
  for (const workId of WORKS) {
    const r = reuseB0(workId); // throws fail-closed on missing/mismatched derivative
    const cmd = buildStageCommand({ stage: 'B1', promptText: 'probe', imageFile: neutralImageFile(r.imgSha256, r.ext) });
    if (cmd.toolsEnforced !== 'Read' || !cmd.env.removeKeys.includes('ANTHROPIC_API_KEY')) throw new Error('transport policy check failed');
    prepared.push({ workId, ...r });
    console.log(`B0 reuse ok ${workId} img=${r.imgSha256.slice(0, 12)} (${r.imgsDir.split('/').pop()}) receipt-verified`);
  }
  console.log(`\nrunId: ${RUN_ID}  (fresh; corrective prompts)  outDir: ${RUN_DIR}`);
  console.log(`prompt hashes: ${Object.entries(promptHashesLocal()).map(([k, v]) => `${k}=${v.slice(0, 8)}`).join(' ')}`);
  console.log(`plan: per work B1(image) -> conditional B2(web, neutral requests) -> conditional B3(image, neutral) -> B4(corrective); legacy passed NULL to synthesis; ~8-10 calls total`);
  console.log('transport: confined temp dir, --tools Read / web-only, API keys stripped, apiKeySource:none FATAL, image receipts fail-closed');
  console.log('OFFLINE VALIDATION: PASS (derivatives located + rehashed; transport policy verified).');
  if (!live) { console.log('\nDRY RUN — no calls made. Re-run with PASS_B_CR_LIVE=1 --run to fire.'); return; }

  if (existsSync(RUN_DIR)) throw new Error(`refusing to overwrite existing run ${RUN_DIR}`);
  mkdirSync(join(RUN_DIR, 'works'), { recursive: true, mode: 0o700 });
  const results = [];
  for (const p of prepared) {
    const workRunDir = join(RUN_DIR, 'works', sha256(p.workId).slice(0, 24));
    mkdirSync(workRunDir, { recursive: true, mode: 0o700 });
    // Fresh-run B0 prep: REUSED verified image receipt + trusted catalog; legacy retained ONLY as quarantined provenance.
    writeFileSync(join(workRunDir, 'b0-prep.json'), `${JSON.stringify({ version: 'passBCalibrationB0/1', work: { id: p.workId }, trustedCatalog: p.trustedCatalog, legacy: p.legacy, legacyQuarantined: true, image: p.b0.image, reusedFrom: 'cal50-0a47b6f7f332' }, null, 1)}\n`, { flag: 'wx', mode: 0o600 });
    const spawnStage = makeSpawnStage(workRunDir, p.imgsDir, p.imgSha256, p.ext);
    const capture = makeCapture(workRunDir);
    console.log(`\n=== ${p.workId} ===`);
    const { status, bodies } = await runWorkStages({
      workId: p.workId, catalog: p.trustedCatalog, legacy: null, // correction 2: NULL legacy into synthesis/hydration
      imgSha256: p.imgSha256, ext: p.ext, prompts: PROMPTS, runtimeVersion: process.env.CLAUDE_CODE_VERSION || 'unknown',
      spawnStage, capture, loadCompletion: () => null, skipB4: false,
    });
    console.log(`stages ${p.workId}: ${JSON.stringify(status)}`);
    results.push({ workId: p.workId, status, hasB4: !!bodies.B4 });
  }
  writeFileSync(join(RUN_DIR, 'canary.json'), `${JSON.stringify({ version: CANARY_VERSION, runId: RUN_ID, works: results, validationContractVersion: VALIDATION_CONTRACT_VERSION, note: 'Fresh corrective B1-B4. Reconciliation + source-span + owner artifact are separate offline steps.' }, null, 1)}\n`, { mode: 0o600 });
  console.log(`\nB1-B4 DONE. runId ${RUN_ID}. Next: offline reconciliation + source-span artifact + owner review artifact.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { console.error(`FAIL-CLOSED: ${e.message}`); process.exit(1); });
