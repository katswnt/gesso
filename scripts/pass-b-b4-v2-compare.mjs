// B4-ONLY comparison (VSD-024): re-run ONLY B4 for 3 works using their EXISTING, verified B1/B2/B3 completions
// from the frozen calibration run, under the corrected B4 editorial prompt. Never reruns B0-B3, never touches
// the original run. Fresh comparison identity bound to the exact B1/B2/B3 completion SHAs + the new B4 prompt
// hash + the validation-contract version. Default = PLAN (no model). Real B4 spawns require --run AND
// PASS_B_CALIB_LIVE=1. Usage: node scripts/pass-b-b4-v2-compare.mjs [--run]
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
import { projectToProduction } from './lib/pass-b-approval.mjs';
import { scanTeachEntry } from './lib/public-output-leak.mjs';

const execFileP = promisify(execFile);
const SRC = 'data/incoming/vision-calibration/cal50-0a47b6f7f332';
const WORKS = ['cleveland170810', 'cleveland120847', 'harvard303416'];
const RUN = process.argv.includes('--run');

function loadWork(id) {
  const wdir = join(SRC, 'works', sha256(id).slice(0, 24));
  const cdir = join(wdir, 'completions');
  const body = (stage) => { const f = join(cdir, `${stage.toLowerCase()}-${completionKey(stage, id)}.json`); return { path: f, raw: readFileSync(f, 'utf8') }; };
  const b1 = body('B1'), b2 = body('B2'), b3 = body('B3'), b4old = body('B4');
  const b0 = JSON.parse(readFileSync(join(wdir, 'b0-prep.json'), 'utf8'));
  return {
    id, wdir,
    b1: JSON.parse(b1.raw).body, b2: JSON.parse(b2.raw).body, b3: JSON.parse(b3.raw).body,
    b4oldBody: JSON.parse(b4old.raw).body, legacy: b0.legacy, image: b0.image,
    shas: { B1: sha256(b1.raw), B2: sha256(b2.raw), B3: sha256(b3.raw) },
  };
}

const works = WORKS.map(loadWork);
const b4PromptHash = promptHashes().B4;
const binding = { srcRun: 'cal50-0a47b6f7f332', works: WORKS, b1b2b3Shas: Object.fromEntries(works.map((w) => [w.id, w.shas])), b4PromptHash, validationContractVersion: VALIDATION_CONTRACT_VERSION };
const runId = 'b4v2-' + sha256(stableJson(binding)).slice(0, 12);
const outDir = join(RUN_ROOT, runId);

function printPlan() {
  console.log('B4-ONLY comparison plan (VSD-024) — corrected B4 prompt, existing B1/B2/B3 reused, B0-B3 NOT rerun');
  console.log(`  source run (read-only): ${SRC}`);
  console.log(`  fresh comparison run:   ${outDir}  (separate; original run untouched)`);
  console.log(`  new B4 prompt hash: ${b4PromptHash}`);
  console.log(`  validation-contract: ${VALIDATION_CONTRACT_VERSION}`);
  console.log('  works + bound B1/B2/B3 completion SHAs:');
  for (const w of works) console.log(`    ${w.id.padEnd(16)} B1=${w.shas.B1.slice(0, 10)} B2=${w.shas.B2.slice(0, 10)} B3=${w.shas.B3.slice(0, 10)}`);
  console.log(`  expected model calls: ${works.length} × B4 (no image, no tools, --effort low). 0 × B0/B1/B2/B3.`);
  console.log('  command to execute (owner-gated):');
  console.log('    PASS_B_CALIB_LIVE=1 node scripts/pass-b-b4-v2-compare.mjs --run');
}

async function spawnB4(promptText) {
  const command = buildStageCommand({ stage: 'B4', promptText });
  const call = mkdtempSync(join(tmpdir(), 'b4v2-'));
  const t0 = Date.now();
  try {
    const env = { ...process.env }; for (const k of command.env.removeKeys) delete env[k]; // secrets never persisted
    let stdout = '', exitCode = 0;
    try { ({ stdout } = await execFileP(command.bin, command.argv, { cwd: call, env, maxBuffer: 64 * 1024 * 1024 })); }
    catch (e) { exitCode = e.code ?? 1; stdout = e.stdout || ''; }
    const transcript = parseStreamTranscript(stdout); const final = transcriptFinal(transcript);
    const evidence = { durationMs: Date.now() - t0, transcriptSha256: sha256(stdout), resolvedModel: primaryModelFromEnvelope(final), apiKeySource: transcript.init?.apiKeySource ?? null, usage: final?.usage ?? null, modelUsage: final?.modelUsage ?? null, numTurns: final?.num_turns ?? null, exitCode };
    const delta = final?.structured_output ?? null;
    const err = (exitCode !== 0 || !final) ? `B4 process failed (exit ${exitCode})` : (evidence.resolvedModel !== CALIBRATION_MODEL ? `model drift: ${evidence.resolvedModel}` : (delta == null ? 'no structured_output' : null));
    return { delta, stdout, evidence, err };
  } finally { rmSync(call, { recursive: true, force: true }); }
}

async function run() {
  if (process.env.PASS_B_CALIB_LIVE !== '1') { console.error('REFUSED: --run needs PASS_B_CALIB_LIVE=1'); process.exit(2); }
  mkdirSync(join(outDir, 'works'), { recursive: true, mode: 0o700 });
  writeFileSync(join(outDir, 'run-manifest.json'), `${JSON.stringify({ version: 'passBB4Compare/1', runId, ...binding, createdNote: 'B4-only comparison; B1/B2/B3 reused from source run' }, null, 1)}\n`);
  const results = [];
  for (const w of works) {
    const compact = compactB4DeltaInput({ b1: w.b1, b2: w.b2, b3: w.b3, legacyInput: legacyContentInput(w.legacy) });
    const promptText = `${buildB4Prompt()}\n\nINPUTS:\n${JSON.stringify(compact)}`;
    const safe = w.id.replace(/[^a-z0-9]+/gi, '_');
    const sp = await spawnB4(promptText);
    // Preserve bounded attempt evidence (the raw transcript; env keys were stripped so no secrets).
    if (sp.stdout) writeFileSync(join(outDir, 'works', `${safe}.b4.transcript.jsonl`), sp.stdout);
    let asm = { ok: false, errors: [] };
    if (!sp.err && sp.delta != null) asm = assembleAndValidateB4({ delta: sp.delta, b1: w.b1, b2: w.b2, b3: w.b3, legacy: w.legacy });
    const newTeach = asm.ok ? projectToProduction(asm.body).teach : null;
    const newLeaks = newTeach ? scanTeachEntry(newTeach).map((l) => `${l.field}:${l.label}`) : [];
    const oldLeaks = scanTeachEntry(projectToProduction(w.b4oldBody).teach).map((l) => `${l.field}:${l.label}`);
    const g = asm.ok ? (asm.body.guide || []) : [];
    const imageQ = g.filter((x) => x.kind === 'image').length;
    const rec = {
      id: w.id, ok: asm.ok, errors: sp.err ? [sp.err, ...(asm.errors || [])] : (asm.errors || []),
      evidence: sp.evidence, // durationMs, transcriptSha256, resolvedModel, apiKeySource, usage, modelUsage
      newLeaks, oldLeaks,
      guide: asm.ok ? { count: g.length, imageCount: imageQ, contextCount: g.length - imageQ, strictImageMajority: imageQ > g.length - imageQ, maxAnswerLen: Math.max(0, ...g.map((x) => (x.a || '').length)) } : null,
      maxNoteLen: asm.ok ? Math.max(0, ...(asm.body.notes || []).map((n) => (n.body || '').length)) : null,
      newWhyLen: asm.ok ? (asm.body.proposedWhy || '').length : null, oldWhyLen: (w.b4oldBody.proposedWhy || '').length,
      rawDelta: sp.delta || null, // attempted content preserved even on failure
      newBody: asm.body || null, oldBody: w.b4oldBody,
    };
    writeFileSync(join(outDir, 'works', `${safe}.compare.json`), `${JSON.stringify(rec, null, 1)}\n`);
    console.log(`  ${w.id}: ${asm.ok ? 'assembled' : 'FAILED ' + rec.errors.slice(0, 2).join(';')} | leaks old=${oldLeaks.length} new=${newLeaks.length} | guide ${rec.guide ? rec.guide.count + '(' + rec.guide.imageCount + 'img)' : '-'} | ${Math.round(sp.evidence.durationMs / 1000)}s`);
    results.push(rec);
  }
  writeFileSync(join(outDir, 'summary.json'), `${JSON.stringify({ runId, binding, works: results.map((r) => ({ id: r.id, ok: r.ok, oldLeaks: r.oldLeaks?.length, newLeaks: r.newLeaks?.length, guide: r.guide, evidence: r.evidence })) }, null, 1)}\n`);
  console.log(`\nDONE. out: ${outDir}`);
}

if (RUN) run(); else printPlan();
