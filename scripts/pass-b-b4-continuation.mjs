// B4-v2 CONTINUATION across the fixed 50-work calibration cohort (VSD-026). Re-runs ONLY B4 using the
// already-verified B1/B2/B3 completions from the frozen run and the accepted B4 prompt + corrected contract
// and leak gate. Never calls B0-B3. Five resumable lanes; ONE B4 attempt per work; a failed work is
// quarantined and the batch continues; no automatic retries; no owner edits; nothing merged. Preserves
// transcript/model/auth/usage evidence. Reuses an existing B4-v2 output ONLY if it independently passes the
// final strict validation + corrected leak gate + evidence checks; otherwise it is re-called or left quarantined.
// Default = PLAN (no model). Real spawns need --run AND PASS_B_CALIB_LIVE=1.
//   node scripts/pass-b-b4-continuation.mjs            (plan)
//   PASS_B_CALIB_LIVE=1 node scripts/pass-b-b4-continuation.mjs --run [--lanes 5]
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sha256, stableJson } from './lib/vision-legacy.mjs';
import { completionKey } from './lib/vision-content-capture.mjs';
import {
  compactB4DeltaInput, legacyContentInput, buildStageCommand, parseStreamTranscript, transcriptFinal,
  primaryModelFromEnvelope, CALIBRATION_MODEL, VALIDATION_CONTRACT_VERSION, RUN_ROOT,
} from './lib/pass-b-calibration.mjs';
import { buildB4Prompt, promptHashes } from './lib/pass-b-prompts.mjs';
import { assembleAndValidateB4 } from './lib/pass-b-b4-delta.mjs';
import { validateStageBody } from './lib/vision-content-schema.mjs';
import { projectToProduction } from './lib/pass-b-approval.mjs';
import { scanTeachEntry } from './lib/public-output-leak.mjs';

const execFileP = promisify(execFile);
const SRC = 'data/incoming/vision-calibration/cal50-0a47b6f7f332';
const RUN = process.argv.includes('--run');
const LANES = (() => { const i = process.argv.indexOf('--lanes'); return i > 0 ? Math.max(1, Number(process.argv[i + 1])) : 5; })();
const safe = (id) => id.replace(/[^a-z0-9]+/gi, '_');

// ---- load the 50 works' verified B1/B2/B3 from the frozen source run (read-only) ----
const srcManifest = JSON.parse(readFileSync(join(SRC, 'run-manifest.json'), 'utf8'));
const IDS = (srcManifest.selection || []).map((w) => w.id);
function loadWork(id) {
  const wdir = join(SRC, 'works', sha256(id).slice(0, 24));
  const cdir = join(wdir, 'completions');
  const rd = (stage) => readFileSync(join(cdir, `${stage.toLowerCase()}-${completionKey(stage, id)}.json`), 'utf8');
  const b1 = rd('B1'), b2 = rd('B2'), b3 = rd('B3');
  const b0 = JSON.parse(readFileSync(join(wdir, 'b0-prep.json'), 'utf8'));
  return { id, b1: JSON.parse(b1).body, b2: JSON.parse(b2).body, b3: JSON.parse(b3).body, legacy: b0.legacy, image: b0.image, shas: { B1: sha256(b1), B2: sha256(b2), B3: sha256(b3) } };
}
const works = IDS.map(loadWork);
const b4PromptHash = promptHashes().B4;
const binding = { srcRun: 'cal50-0a47b6f7f332', works: IDS, b1b2b3Shas: Object.fromEntries(works.map((w) => [w.id, w.shas])), b4PromptHash, validationContractVersion: VALIDATION_CONTRACT_VERSION };
const runId = 'b4c-' + sha256(stableJson(binding)).slice(0, 12);
const outDir = join(RUN_ROOT, runId);

// A B4 body passes the FINAL contract iff strict-valid AND its projected player copy is leak-clean.
function finalPass(body) {
  const val = validateStageBody('B4', body);
  if (!val.ok) return { ok: false, why: `strict:${(val.errors || []).slice(0, 2).join(',')}` };
  const leaks = scanTeachEntry(projectToProduction(body).teach);
  if (leaks.length) return { ok: false, why: `leak:${leaks.map((l) => l.field + ':' + l.label).slice(0, 3).join(',')}` };
  return { ok: true };
}
// Find an existing B4-v2 output for a work that INDEPENDENTLY passes the final contract + basic evidence.
function reusable(id) {
  for (const d of readdirSync(RUN_ROOT).filter((n) => /^b4v2-/.test(n))) {
    const cp = join(RUN_ROOT, d, 'works', `${safe(id)}.compare.json`);
    if (!existsSync(cp)) continue;
    let r; try { r = JSON.parse(readFileSync(cp, 'utf8')); } catch { continue; }
    if (!r.ok || !r.newBody || r.rawDelta == null) continue;
    if (r.evidence?.resolvedModel !== CALIBRATION_MODEL || r.evidence?.apiKeySource !== 'none') continue;
    // re-hydrate the preserved delta from scratch and re-check the FINAL contract (do not trust the stored body)
    const w = works.find((x) => x.id === id);
    const asm = assembleAndValidateB4({ delta: r.rawDelta, b1: w.b1, b2: w.b2, b3: w.b3, legacy: w.legacy });
    if (!asm.ok) continue;
    if (!finalPass(asm.body).ok) continue;
    return { from: d, delta: r.rawDelta, body: asm.body, evidence: r.evidence };
  }
  return null;
}

function statusOf(id) {
  const done = join(outDir, 'works', `${safe(id)}.b4.json`);
  if (existsSync(done)) { try { const r = JSON.parse(readFileSync(done, 'utf8')); if (r.ok) return 'complete'; } catch { /* re-run */ } }
  return null;
}

async function spawnB4(promptText) {
  const command = buildStageCommand({ stage: 'B4', promptText });
  const call = mkdtempSync(join(tmpdir(), 'b4c-'));
  const t0 = Date.now();
  try {
    const env = { ...process.env }; for (const k of command.env.removeKeys) delete env[k];
    let stdout = '', exitCode = 0;
    try { ({ stdout } = await execFileP(command.bin, command.argv, { cwd: call, env, maxBuffer: 64 * 1024 * 1024 })); }
    catch (e) { exitCode = e.code ?? 1; stdout = e.stdout || ''; }
    const transcript = parseStreamTranscript(stdout); const final = transcriptFinal(transcript);
    const evidence = { durationMs: Date.now() - t0, transcriptSha256: sha256(stdout), resolvedModel: primaryModelFromEnvelope(final), apiKeySource: transcript.init?.apiKeySource ?? null, usage: final?.usage ?? null, exitCode };
    const delta = final?.structured_output ?? null;
    const err = (exitCode !== 0 || !final) ? `process-failed:exit${exitCode}` : (evidence.resolvedModel !== CALIBRATION_MODEL ? `model-drift:${evidence.resolvedModel}` : (delta == null ? 'no-structured-output' : (evidence.apiKeySource !== 'none' ? `apiKeySource:${evidence.apiKeySource}` : null)));
    return { delta, stdout, evidence, err };
  } finally { rmSync(call, { recursive: true, force: true }); }
}

async function processWork(w) {
  const outPath = join(outDir, 'works', `${safe(w.id)}.b4.json`);
  const sp = await spawnB4(`${buildB4Prompt()}\n\nINPUTS:\n${JSON.stringify(compactB4DeltaInput({ b1: w.b1, b2: w.b2, b3: w.b3, legacyInput: legacyContentInput(w.legacy) }))}`);
  if (sp.stdout) writeFileSync(join(outDir, 'works', `${safe(w.id)}.transcript.jsonl`), sp.stdout);
  let ok = false, why = sp.err, body = null;
  if (!sp.err && sp.delta != null) {
    const asm = assembleAndValidateB4({ delta: sp.delta, b1: w.b1, b2: w.b2, b3: w.b3, legacy: w.legacy });
    if (!asm.ok) why = `assemble:${(asm.errors || []).slice(0, 2).join(',')}`;
    else { const fp = finalPass(asm.body); ok = fp.ok; why = fp.ok ? null : fp.why; body = fp.ok ? asm.body : null; }
  }
  writeFileSync(outPath, `${JSON.stringify({ id: w.id, ok, reused: false, why: why || null, evidence: sp.evidence, rawDelta: sp.delta || null, body }, null, 1)}\n`);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${w.id} ${Math.round(sp.evidence.durationMs / 1000)}s${ok ? '' : ' — ' + why}`);
  return ok;
}

async function run() {
  if (process.env.PASS_B_CALIB_LIVE !== '1') { console.error('REFUSED: --run needs PASS_B_CALIB_LIVE=1'); process.exit(2); }
  mkdirSync(join(outDir, 'works'), { recursive: true, mode: 0o700 });
  writeFileSync(join(outDir, 'run-manifest.json'), `${JSON.stringify({ version: 'passBB4Continuation/1', runId, lanes: LANES, ...binding }, null, 1)}\n`);
  // 1. reuse pass (no model calls)
  const toCall = [];
  for (const w of works) {
    if (statusOf(w.id) === 'complete') continue;
    const ru = reusable(w.id);
    if (ru) { writeFileSync(join(outDir, 'works', `${safe(w.id)}.b4.json`), `${JSON.stringify({ id: w.id, ok: true, reused: true, from: ru.from, evidence: ru.evidence, rawDelta: ru.delta, body: ru.body }, null, 1)}\n`); console.log(`  REUSE ${w.id} (from ${ru.from})`); continue; }
    toCall.push(w);
  }
  // 2. call pass: 5 lanes, 1 attempt each, quarantine failures, continue
  let cursor = 0; const results = [];
  const lane = async () => { while (cursor < toCall.length) { const w = toCall[cursor++]; results.push(await processWork(w)); } };
  await Promise.all(Array.from({ length: Math.min(LANES, toCall.length || 1) }, lane));
  const done = readdirSync(join(outDir, 'works')).filter((f) => f.endsWith('.b4.json')).map((f) => JSON.parse(readFileSync(join(outDir, 'works', f), 'utf8')));
  const okN = done.filter((r) => r.ok).length;
  writeFileSync(join(outDir, 'summary.json'), `${JSON.stringify({ runId, total: works.length, complete: okN, failed: done.length - okN, reused: done.filter((r) => r.reused).length, works: done.map((r) => ({ id: r.id, ok: r.ok, reused: r.reused, why: r.why })) }, null, 1)}\n`);
  console.log(`\nDONE. ${okN}/${works.length} complete, ${done.length - okN} quarantined. out: ${outDir}`);
}

function plan() {
  let reuse = 0, already = 0; const call = [];
  for (const w of works) { if (existsSync(join(outDir, 'works')) && statusOf(w.id) === 'complete') { already++; continue; } if (reusable(w.id)) reuse++; else call.push(w.id); }
  const perCallSec = 240; // observed 176-349s per B4 call
  const waves = Math.ceil(call.length / LANES);
  console.log('B4-v2 CONTINUATION plan (VSD-026) — accepted B4 prompt + corrected contract/leak gate; B0-B3 NOT called');
  console.log(`  source (read-only): ${SRC}  (50 verified B1/B2/B3)`);
  console.log(`  final run identity: ${runId}  ->  ${outDir}`);
  console.log(`  B4 prompt hash: ${b4PromptHash.slice(0, 16)}…  | validation-contract: ${VALIDATION_CONTRACT_VERSION}`);
  console.log(`  works: ${works.length} | already complete: ${already} | reusable existing B4-v2: ${reuse} | B4 calls still required: ${call.length}`);
  console.log(`  lanes: ${LANES} | est. duration: ~${Math.round(waves * perCallSec / 60)} min (${waves} waves × ~${perCallSec}s; subscription-window permitting, capacity fast-fails quarantine + resume)`);
  console.log('  command (owner-gated):');
  console.log(`    PASS_B_CALIB_LIVE=1 /opt/homebrew/bin/node scripts/pass-b-b4-continuation.mjs --run --lanes ${LANES}`);
}

if (RUN) run(); else plan();
