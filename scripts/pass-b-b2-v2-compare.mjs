// Pass B — B2 v1-vs-v2 comparison harness (VSD-022, Phase 2).
// Owner-authorized live run (2026-09-03). Re-runs ONLY B2, from each work's EXISTING B1 checkpoint
// in a prior calibration run, using the SAME trustedCatalog + legacy snapshot (from immutable
// b0-prep.json) so the only variable is the B2 prompt/schema/validator (v1 -> v2).
//
// It does NOT run B1/B3/B4, does NOT fetch images (B2 is no-image), does NOT touch the controller,
// and writes ONLY to a quarantined comparison dir. No production sink, no merge.
//
// Spawn/verify fidelity mirrors scripts/pass-b-calibration.mjs exactly: neutral per-call cwd, API keys
// stripped, stream-json transcript, model-identity gate, structured_output gate, WebSearch+WebFetch
// evidence gate from the raw transcript, then strict validateStageBody('B2').

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import {
  b2InputFor, buildStageCommand, legacyContentInput, parseStreamTranscript, transcriptFinal,
  verifyB2WebEvents, primaryModelFromEnvelope, CALIBRATION_MODEL, CONTROLLER_VERSION,
} from './lib/pass-b-calibration.mjs';
import { validateStageBody, isCorroboratingSource } from './lib/vision-content-schema.mjs';
import { buildB2Prompt, promptHashes } from './lib/pass-b-prompts.mjs';

const execFileP = promisify(execFile);
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

const SRC_RUN = 'data/incoming/vision-calibration/cal50-3445a229789f';
const OUT_ROOT = 'data/incoming/vision-calibration/b2-v2-compare';
const WORKS = ['cleveland167459', 'harvard216218', 'wikidata:Q4950181', 'met247010', 'wikidata:Q114769532'];
const LANES = 2;

// --- locate a work's checkpoint dir + its B1/B2 completion bodies + immutable b0-prep --------------
function loadWork(workId) {
  const worksRoot = join(SRC_RUN, 'works');
  for (const wd of readdirSync(worksRoot)) {
    const cdir = join(worksRoot, wd, 'completions');
    if (!existsSync(cdir)) continue;
    const files = readdirSync(cdir);
    const b1f = files.find((f) => /^b1-/.test(f));
    if (!b1f) continue;
    const b1 = JSON.parse(readFileSync(join(cdir, b1f), 'utf8'));
    if (b1.workId !== workId) continue;
    const b2f = files.find((f) => /^b2-/.test(f));
    const b2 = b2f ? JSON.parse(readFileSync(join(cdir, b2f), 'utf8')) : null;
    const prep = JSON.parse(readFileSync(join(worksRoot, wd, 'b0-prep.json'), 'utf8'));
    // v1 telemetry, faithfully: trace the ACCEPTED completion's transcript SHA to its attempt, then re-parse
    // that exact transcript with the SAME (corrected) verifier so v1 and v2 fetch counts are comparable.
    let v1Web = null;
    const acceptedSha = b2 ? b2.transcriptSha256 : null;
    const adir = join(worksRoot, wd, 'attempts');
    if (acceptedSha && existsSync(adir)) {
      for (const af of readdirSync(adir).filter((f) => /^b2-.*\.attempt\.json$/.test(f))) {
        const a = JSON.parse(readFileSync(join(adir, af), 'utf8'));
        if (a.transcriptSha256 !== acceptedSha) continue;
        const tf = join(adir, a.transcriptFile);
        if (existsSync(tf)) { const w = verifyB2WebEvents(parseStreamTranscript(readFileSync(tf, 'utf8'))); v1Web = { searches: w.searches, fetches: w.fetches, fetchAttempts: w.fetchAttempts, fetchFailed: w.fetchFailed, durationMs: a.durationMs, matchedBy: 'accepted-transcript-sha' }; }
        break;
      }
    }
    // Auditable input binding: v1 and v2 are built from THESE exact inputs, so this digest is identical for both.
    const inputDigest = sha256(JSON.stringify([b1.body, prep.trustedCatalog, prep.legacy]));
    return { wd, dir: join(worksRoot, wd), b1Body: b1.body, b2v1Body: b2 ? b2.body : null, catalog: prep.trustedCatalog, legacy: prep.legacy, image: prep.image, v1Web, inputDigest, acceptedV1Sha: acceptedSha };
  }
  throw new Error(`no checkpoint found for ${workId} in ${SRC_RUN}`);
}

// --- faithful B2 spawn (mirrors the controller) --------------------------------------------------
async function spawnB2(workId, promptText) {
  const command = buildStageCommand({ stage: 'B2', promptText }); // uses the updated WIRE_SCHEMAS.B2 (v2 verdict enum)
  const call = mkdtempSync(join(tmpdir(), 'b2v2-'));
  const t0 = Date.now();
  try {
    const env = { ...process.env };
    for (const k of command.env.removeKeys) delete env[k];
    let stdout = '', stderr = '', exitCode = 0;
    try { ({ stdout, stderr } = await execFileP(command.bin, command.argv, { cwd: call, env, timeout: undefined, maxBuffer: 64 * 1024 * 1024 })); }
    catch (e) { exitCode = e.code ?? 1; stdout = e.stdout || ''; stderr = e.stderr || e.message; }
    const transcript = parseStreamTranscript(stdout);
    const final = transcriptFinal(transcript);
    const web = verifyB2WebEvents(transcript);
    const primaryModel = primaryModelFromEnvelope(final);
    const rec = {
      workId, exitCode, durationMs: Date.now() - t0, transcriptSha256: sha256(stdout),
      toolUseNames: transcript.toolUses.map((u) => u.name), b2WebEvents: web,
      resolvedModel: primaryModel, usage: final?.usage ?? null, numTurns: final?.num_turns ?? null,
      stderrBounded: String(stderr || '').slice(0, 400),
    };
    if (exitCode !== 0 || !final) throw Object.assign(new Error(`process failed (exit ${exitCode}) — no terminal result`), { rec });
    if (final.is_error === true || (final.subtype && final.subtype !== 'success')) throw Object.assign(new Error(`stage errored (subtype=${final.subtype})`), { rec });
    if (!primaryModel) throw Object.assign(new Error('no resolved model in transcript'), { rec });
    if (primaryModel !== CALIBRATION_MODEL) throw Object.assign(new Error(`model drift: ${primaryModel} != ${CALIBRATION_MODEL}`), { rec });
    if (final.structured_output == null) throw Object.assign(new Error('no structured_output (--json-schema not honored)'), { rec });
    if (!web.ok) throw Object.assign(new Error(web.reason), { rec });
    return { body: final.structured_output, rec, rawTranscript: stdout };
  } finally { rmSync(call, { recursive: true, force: true }); }
}

// --- metrics -------------------------------------------------------------------------------------
function bodyMetrics(body) {
  if (!body) return null;
  const fcs = body.factChecks || [];
  const verd = {};
  for (const f of fcs) verd[f.verdict] = (verd[f.verdict] || 0) + 1;
  const srcUrls = new Set();
  for (const f of fcs) for (const s of (f.sources || [])) if (s && s.url) srcUrls.add(String(s.url));
  const corroborating = [...srcUrls].filter((u) => isCorroboratingSource(u)).length;
  const hiRefNoCorrob = fcs.filter((f) => f.verdict === 'refuted' && (f.confidence || 0) >= 0.8 && !(f.sources || []).some((s) => isCorroboratingSource(s.url))).length;
  return { factChecks: fcs.length, verdicts: verd, distinctSources: srcUrls.size, corroboratingSources: corroborating,
    guideAnswers: (body.guideAnswers || []).length, b3Requests: (body.targetedVerificationRequests || []).length, hiConfRefutedWithoutCorroboratingSource: hiRefNoCorrob };
}

// --- run one work --------------------------------------------------------------------------------
async function runWork(workId, outDir) {
  const w = loadWork(workId);
  const b2in = b2InputFor(workId, w.catalog, w.b1Body);
  const legacyInput = legacyContentInput(w.legacy);
  const evidenceIds = b2in.visibleSignals.map((s) => s.evidenceId);
  const promptText = `${buildB2Prompt()}\n\nCATALOG+SIGNALS:\n${JSON.stringify(b2in)}\n\nEXISTING CONTENT:\n${JSON.stringify(legacyInput)}`;
  const safe = workId.replace(/[^a-z0-9]+/gi, '_');
  // inputDigest binds b1Body+catalog+legacy: v1 and v2 share it BY CONSTRUCTION, so the B2 prompt/schema/
  // validator is the only deliberate variable. (Generation + live web are still stochastic — this is a
  // paired qualitative comparison, not a literal single-variable experiment.)
  const out = { workId, title: w.catalog.title, ranAt: new Date().toISOString(), inputDigest: w.inputDigest, acceptedV1TranscriptSha: w.acceptedV1Sha };
  try {
    const { body, rec, rawTranscript } = await spawnB2(workId, promptText);
    const val = validateStageBody('B2', body, { evidenceIds });
    writeFileSync(join(outDir, `${safe}.v2.transcript.jsonl`), rawTranscript);
    out.v2 = { ok: val.ok, validationErrors: val.errors || [], body, exec: rec, metrics: bodyMetrics(body) };
    out.v2Valid = val.ok;
    console.log(`  B2-v2 ${workId}: ${val.ok ? 'VALID' : 'INVALID(' + (val.errors || []).join('; ') + ')'} — ${rec.b2WebEvents.searches}s/${rec.b2WebEvents.fetches}f, ${Math.round(rec.durationMs / 1000)}s`);
  } catch (e) {
    out.v2 = { ok: false, error: e.message, exec: e.rec || null };
    out.v2Valid = false;
    console.log(`  B2-v2 ${workId}: FAILED — ${e.message}`);
  }
  out.v1 = { metrics: bodyMetrics(w.b2v1Body), web: w.v1Web, body: w.b2v1Body };
  writeFileSync(join(outDir, `${safe}.compare.json`), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}

async function main() {
  if (process.env.PASS_B_CALIB_LIVE !== '1') { console.error('REFUSED: set PASS_B_CALIB_LIVE=1 to run the live B2-v2 comparison.'); process.exit(2); }
  const runId = 'b2v2-' + sha256(stableIds()).slice(0, 10);
  const outDir = join(OUT_ROOT, runId);
  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  console.log(`B2 v1-vs-v2 comparison — ${WORKS.length} works, ${LANES} lanes`);
  console.log(`controller ${CONTROLLER_VERSION} | B2 prompt hash ${promptHashes().B2}`);
  console.log(`source checkpoints: ${SRC_RUN}`);
  console.log(`out: ${outDir}\n`);
  const results = [];
  let cursor = 0;
  const lane = async () => { while (cursor < WORKS.length) { const id = WORKS[cursor++]; console.log(`START ${id}`); results.push(await runWork(id, outDir)); } };
  await Promise.all(Array.from({ length: Math.min(LANES, WORKS.length) }, lane));
  writeFileSync(join(outDir, 'summary.json'), `${JSON.stringify({ runId, controller: CONTROLLER_VERSION, b2PromptHash: promptHashes().B2, ranAt: new Date().toISOString(), works: results.map(stripBodies) }, null, 1)}\n`);
  console.log(`\nDONE. ${results.filter((r) => r.v2Valid).length}/${results.length} B2-v2 valid. Compare files in ${outDir}`);
  console.log(`Next: node scripts/pass-b-b2-v2-card.mjs ${outDir}`);
}
function stripBodies(r) { const c = JSON.parse(JSON.stringify(r)); if (c.v1) delete c.v1.body; if (c.v2) delete c.v2.body; return c; }
function stableIds() { return WORKS.join(','); }

main().catch((e) => { console.error(e); process.exit(1); });
