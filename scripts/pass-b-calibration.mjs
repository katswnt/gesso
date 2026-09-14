// Deterministic, resumable Pass B calibration controller for the fixed 50-work cohort.
// DEFAULT = dry-run (no model calls). Real execution needs --live AND PASS_B_CALIB_LIVE=1 AND not CI AND
// (overnight OR --foreground). B0 image preparation through the hardened broker is allowed in dry-run.
// NEVER calls the paid API, never merges, never writes authoritative game data.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, copyFileSync, mkdtempSync, rmSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import broker, { BROKER_POLICY_VERSION } from './lib/img-broker.mjs';
import { sha256, stableJson } from './lib/vision-legacy.mjs';
import { captureStageCompletion, verifyCapturedStage } from './lib/vision-content-capture.mjs';
import { validateStageBody } from './lib/vision-content-schema.mjs';
import { renderReviewPacket, rowNeedsAttention } from './lib/pass-b-review-packet.mjs';
import { promptHashes } from './lib/pass-b-prompts.mjs';
import {
  RUN_ROOT, CONTROLLER_VERSION, CALIBRATION_MODEL, IMAGE_TRANSPORT_VERSION, VALIDATION_CONTRACT_VERSION, contractHash,
  validateSelection, trustedCatalog, snapshotLegacy,
  planCalls, buildRunManifest, producerEvidence, protectedHoursBlock, buildStageCommand,
  b2InputFor, syntheticFixture, runWorkStages, primaryModelFromEnvelope,
  parseStreamTranscript, transcriptFinal, verifyB1ImageRead, verifyB2WebEvents, verifyStageEvidence, loadOrArchiveCompletion,
} from './lib/pass-b-calibration.mjs';
import { stagePrompts } from './lib/pass-b-prompts.mjs';
const execFileP = promisify(execFile);

const args = process.argv.slice(2);
const has = f => args.includes(f);
const val = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const LIVE = has('--live'), FIXTURE = has('--fixture'), FOREGROUND = has('--foreground'), WRITE_PACKET = has('--write-packet') || true;
const MAX_WORKS = val('--max-works') ? Number(val('--max-works')) : null;
const ONLY = val('--only-work');
const LANES = val('--lanes') ? Math.max(1, Number(val('--lanes'))) : 1; // concurrent deterministic lanes for the batch
const SKIP_B4 = has('--through-b3') || has('--skip-b4'); // bank B1-B3 tonight; B4 runs later from the same checkpoints
const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

function loadGlobal(file, name) { const w = {}; new Function('window', readFileSync(file, 'utf8'))(w); return w[name]; }
// Immutable checkpoint: create exclusively; if it already exists it MUST be byte-identical (resume),
// else fail closed. Only EEXIST is tolerated — any other write error propagates.
function writeImmutable(path, text) {
  try { writeFileSync(path, text, { flag: 'wx', mode: 0o600 }); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    if (readFileSync(path, 'utf8') !== text) throw new Error(`checkpoint drift (not byte-identical): ${path}`);
  }
}
// Finalized derived artifact (manifest/packet): regenerated fresh every run so it reflects current state.
function writeFresh(path, text) { writeFileSync(path, text, { mode: 0o600 }); }

// ---------- FIXTURE: exercise B0→B4 capture chain + packet with NO model call ----------
async function runFixture() {
  const fx = syntheticFixture();
  const runId = 'cal50-fixture';
  const runDir = join(RUN_ROOT, runId);
  rmSync(runDir, { recursive: true, force: true }); // fixture is a re-runnable demo (single-use capture would otherwise EEXIST)
  mkdirSync(runDir, { recursive: true, mode: 0o700 });
  const imgSha = sha256('synthetic-image-bytes');
  const trusted = { workId: fx.workId, imgSha256: imgSha, promptHash: sha256('fixture-prompt'), brokerPolicyVersion: 'img-broker/1', imageTransportVersion: IMAGE_TRANSPORT_VERSION };
  const stageStatus = {};
  // Lean calibration exercises capture for B1 + B2 only (B3/B4 schemas survive but are not in this path).
  for (const stage of ['B1', 'B2']) {
    const producer = producerEvidence(stage, { model: CALIBRATION_MODEL, runtimeVersion: 'fixture' });
    const raw = JSON.stringify(fx.bodies[stage]);
    const context = fx.contexts[stage] || {};
    const st = { ...trusted, promptHash: sha256(`fixture-${stage}`), transcriptSha256: sha256(`fixture-transcript-${stage}`) };
    const cap = captureStageCompletion({ runDir, stage, rawResponse: raw, trusted: st, producer, createdAt: '2026-09-02T12:00:00Z', context });
    const verified = verifyCapturedStage({ completionPath: cap.completionPath, runDir, trusted: st, producer, context });
    stageStatus[stage] = verified.ok ? 'complete' : `INVALID:${verified.errors.join(',')}`;
  }
  const row = {
    id: fx.workId, legacyTitle: 'Synthetic fixture work', cohort: 'strongLegacy', fameBand: 'f3', regionGroup: 'europe', guideStatus: 'legacyCandidate',
    image: { ok: true, imgSha256: imgSha, ext: 'png', width: 800, height: 1000 },
    legacy: { counts: { guide: 3, notes: 2, hotspots: 4, cues: 4, rich: 1 }, teaching: { notes: [{ head: 'Old note', body: 'A blind legacy note.' }], guide: [{ q: 'Old Q?', a: 'Old A.' }] } },
    b1: fx.bodies.B1, b2: fx.bodies.B2, stageStatus,
  };
  const packet = renderReviewPacket([row], { runId, mode: 'fixture', generatedAt: '2026-09-02T12:00:00Z' });
  writeFileSync(join(runDir, 'review-packet.fixture.html'), packet.html);
  writeFileSync(join(runDir, 'review-packet.fixture.json'), `${JSON.stringify(packet.json, null, 1)}\n`);
  console.log(`FIXTURE B0→B4 capture: ${JSON.stringify(stageStatus)}`);
  console.log(`fixture packet: ${join(runDir, 'review-packet.fixture.html')}`);
  return stageStatus;
}

// ---------- DRY RUN / prep over the 50-work cohort ----------
async function main() {
  if (FIXTURE) { await runFixture(); return; }

  const pool = loadGlobal('data/pool.js', 'ARTEFACTUM_POOL');
  const poolById = new Map(pool.map(p => [p.id, p]));
  const teach = (loadGlobal('data/teach-works.js', 'ARTEFACTUM_CUES') || {}).work || {};
  const hotspots = loadGlobal('data/hotspots.js', 'ARTEFACTUM_HOTSPOTS') || {};
  const vision = loadGlobal('data/vision.js', 'ARTEFACTUM_VISION') || {};
  const auditIds = new Set(JSON.parse(readFileSync('data/vision-audit.json', 'utf8')).ids || []);

  const sel = JSON.parse(readFileSync('tasks/pass-b-calibration-50-selection.json', 'utf8'));
  const check = validateSelection(sel, new Set(poolById.keys()));
  if (!check.ok) { console.error('SELECTION INVALID:\n  ' + check.errors.join('\n  ')); process.exit(2); }
  let works = check.works;
  if (ONLY) works = works.filter(w => w.id === ONLY);
  if (MAX_WORKS) works = works.slice(0, MAX_WORKS);

  // Image cache is keyed by SELECTION only (images are contract-independent); the run is keyed by the
  // COMPLETE controller contract (selection + controller + prompts + schema) so a prompt/schema/controller
  // change gets a fresh run and never reuses stale completions or a stale manifest.
  const selHash = sha256(stableJson(check.works.map(w => w.id))).slice(0, 10);
  // runId binds the FULL acceptance contract incl. VALIDATION_CONTRACT_VERSION (validation rules, wire
  // schema, B4 hydration, execution-evidence policy) — see calibrationContract(). VSD-023.
  const runId = 'cal50-' + contractHash({ selIds: check.works.map(w => w.id), prompts: promptHashes() });
  const runDir = join(RUN_ROOT, runId);
  const imgsDir = join(RUN_ROOT, `imgs-${selHash}`);   // shared across contract changes
  const imageIndexPath = join(imgsDir, 'image-index.json');
  mkdirSync(join(runDir, 'works'), { recursive: true, mode: 0o700 });
  mkdirSync(imgsDir, { recursive: true, mode: 0o700 });
  const imageIndex = existsSync(imageIndexPath) ? JSON.parse(readFileSync(imageIndexPath, 'utf8')) : {};

  // Live guard (this round never trips: default is dry-run).
  if (LIVE) {
    if (process.env.PASS_B_CALIB_LIVE !== '1' || process.env.CI) { console.error('REFUSED: --live needs PASS_B_CALIB_LIVE=1 and not CI.'); process.exit(2); }
    const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Los_Angeles' }).format(new Date()));
    if (protectedHoursBlock(hour, FOREGROUND)) { console.error(`REFUSED: protected subscription hours (09:00–22:00 Pacific). Pass --foreground to run a supervised daytime calibration.`); process.exit(2); }
  }

  // B0: broker-fetch + sanitize each image (allowed in dry-run), snapshot legacy, write per-work prep.
  const rows = [], imagePrep = [];
  for (const w of works) {
    const p = poolById.get(w.id);
    const workDir = join(runDir, 'works', sha256(w.id).slice(0, 24));
    mkdirSync(workDir, { recursive: true, mode: 0o700 });
    const legacy = snapshotLegacy(w.id, { teach, hotspots, vision, auditIds });
    let prep;
    // Resume: reuse a prior SUCCESSFUL image from the shared cache; a prior failure (or none) is retried.
    if (imageIndex[w.id]?.ok && existsSync(join(imgsDir, `${imageIndex[w.id].imgSha256}.${imageIndex[w.id].ext}`))) prep = imageIndex[w.id];
    if (!prep) {
      await new Promise(r => setTimeout(r, 600)); // conservative pacing: be gentle on the upstream thumbnail service
      const fetched = await broker.fetchImageToModelFile(p.img, imgsDir, { userAgent: BROWSER, referer: true });
      prep = fetched.ok
        ? { id: w.id, ok: true, imgSha256: fetched.sha256, ext: fetched.ext, width: fetched.width, height: fetched.height, mime: fetched.mime, bytes: fetched.bytes }
        : { id: w.id, ok: false, reason: `${fetched.reason || 'fetch-failed'}${fetched.host ? ' @' + fetched.host : ''}`, requestedUrl: p.img };
      if (prep.ok) { imageIndex[w.id] = prep; writeFresh(imageIndexPath, `${JSON.stringify(imageIndex, null, 1)}\n`); } // cache only successes; failures retry
    }
    imagePrep.push(prep);
    // Per-work B0 snapshot is immutable within a contract run (deterministic); resume verifies identity.
    if (prep.ok) writeImmutable(join(workDir, 'b0-prep.json'), `${JSON.stringify({ version: 'passBCalibrationB0/1', work: w, trustedCatalog: trustedCatalog(p), legacy, image: prep }, null, 1)}\n`);
    rows.push({
      id: w.id, legacyTitle: p.title, cohort: w.cohort, fameBand: w.fameBand, regionGroup: w.regionGroup, guideStatus: w.guideStatus,
      image: prep, legacy, b1: null, b2: null, b3: null, b4: null,
      stageStatus: { B1: 'planned', B2: 'not-requested', B3: 'not-requested', B4: 'not-requested' },
    });
    console.log(`B0 ${prep.ok ? 'ok ' : 'FAIL'} ${w.id} ${prep.ok ? prep.imgSha256.slice(0, 10) + '… ' + prep.width + 'x' + prep.height : prep.reason}`);
  }

  // ---- LIVE per-work B1 → conditional B2 execution (Read-tool image transport; stream-json evidence). ----
  const retryStat = { b2RetriedWorks: [], b2RetryAttempts: 0 }; // one validation-retry per B2 (owner-authorized)
  let spawnedAny = false; // idempotence: a fully-complete no-op resume spawns nothing and must not rewrite manifest/packet
  if (LIVE) {
    const prompts = stagePrompts();
    const EXPECTED_MODEL = CALIBRATION_MODEL; // pinned claude-sonnet-4-6
    const processWork = async (row) => {
      if (!row.image?.ok) { row.stageStatus = { B1: 'skipped:no-image', B2: 'skipped', B3: 'skipped', B4: 'skipped' }; console.log(`stages ${row.id}: skipped:no-image`); return; }
      const workRunDir = join(runDir, 'works', sha256(row.id).slice(0, 24));
      const attemptsDir = join(workRunDir, 'attempts'); mkdirSync(attemptsDir, { recursive: true, mode: 0o700 });
      // Real subscription spawn: exclusive lease, neutral per-call cwd holding ONLY the SHA image, Read/web
      // tools only, API keys stripped. stream-json stdout is the raw transcript (SHA-bound); tool-use EVIDENCE
      // (Read of the exact image for B1; WebSearch+WebFetch for B2) is verified from it.
      const spawnStage = async (stage, { command, imageFile }) => {
        const lease = join(workRunDir, `${stage}.lease`);
        try { writeFileSync(lease, `${process.pid} ${new Date().toISOString()}`, { flag: 'wx' }); }
        catch (e) { if (e.code === 'EEXIST') throw new Error(`stage ${stage} leased by another controller`); throw e; }
        const call = mkdtempSync(join(tmpdir(), 'passb-call-'));
        const startedAt = new Date().toISOString(); const t0 = Date.now();
        const attempt = { stage, workId: row.id, requestedModel: command.argv[command.argv.indexOf('--model') + 1], startedAt };
        try {
          if (imageFile) copyFileSync(join(imgsDir, `${row.image.imgSha256}.${row.image.ext}`), join(call, imageFile));
          const env = { ...process.env }; for (const k of command.env.removeKeys) delete env[k];
          let stdout = '', stderr = '', exitCode = 0;
          // Supervised calibration: NO wall-clock timeout (a vision/research call legitimately runs minutes
          // and must never be SIGTERM'd mid-stream). Actual duration is recorded below.
          const execTimeout = undefined;
          spawnedAny = true; // a real model process is about to run -> this resume is not a no-op
          try { ({ stdout, stderr } = await execFileP(command.bin, command.argv, { cwd: call, env, timeout: execTimeout, maxBuffer: 64 * 1024 * 1024 })); }
          catch (e) { exitCode = e.code ?? 1; stdout = e.stdout || ''; stderr = e.stderr || e.message; }
          const transcript = parseStreamTranscript(stdout);
          const final = transcriptFinal(transcript);
          const tag = `${stage.toLowerCase()}-${sha256(startedAt).slice(0, 12)}`;
          // Preserve the EXACT raw stream-json transcript bytes (gitignored), bound by SHA.
          const transcriptFile = `${tag}.transcript.jsonl`;
          writeFresh(join(attemptsDir, transcriptFile), stdout);
          const transcriptSha256 = sha256(stdout);
          const mu = final?.modelUsage || {};
          const primaryModel = primaryModelFromEnvelope(final);
          const b1Read = (stage === 'B1' || stage === 'B3') ? verifyB1ImageRead(transcript, { callDir: call, imageBasename: imageFile }) : null;
          const b2Web = stage === 'B2' ? verifyB2WebEvents(transcript) : null;
          Object.assign(attempt, { finishedAt: new Date().toISOString(), durationMs: Date.now() - t0, exitCode,
            resolvedModel: primaryModel, modelUsage: mu, numTurns: final?.num_turns ?? null, usage: final?.usage ?? null,
            transcriptLines: transcript.lines, toolUseNames: transcript.toolUses.map(u => u.name), b1ImageRead: b1Read, b2WebEvents: b2Web,
            cliVersion: transcript.init?.claudeCodeVersion ?? final?.version ?? process.env.CLAUDE_CODE_VERSION ?? null, apiKeySource: transcript.init?.apiKeySource ?? null, isError: final?.is_error ?? (exitCode !== 0),
            stopReason: final?.stop_reason ?? null, subtype: final?.subtype ?? null, stderrBounded: String(stderr || '').slice(0, 500),
            transcriptFile, transcriptSha256, timeoutPolicy: 'none-supervised' });
          writeFresh(join(attemptsDir, `${tag}.attempt.json`), `${JSON.stringify(attempt, null, 1)}\n`);
          if (exitCode !== 0 || !final) throw new Error(`process failed (exit ${exitCode}) — no terminal result event`);
          if (final.is_error === true || (final.subtype && final.subtype !== 'success')) throw new Error(`stage errored (subtype=${final.subtype})`);
          // The resolved primary model MUST be present AND equal the pinned id — missing/other fails, never passes.
          if (!primaryModel) throw new Error('transcript has no resolved model — cannot confirm model identity');
          if (primaryModel !== EXPECTED_MODEL) throw new Error(`model drift: primary resolved ${primaryModel}, expected ${EXPECTED_MODEL}`);
          if (final.structured_output === undefined || final.structured_output === null) throw new Error('transcript has no structured_output — --json-schema was not honored');
          // Execution-evidence gates (from the raw transcript, never from prose). No completion is created if
          // B1 did not Read the exact image, or B2 did not genuinely WebSearch AND WebFetch.
          if (b1Read && !b1Read.ok) throw new Error(`B1 image-read not verified: ${b1Read.reason}`);
          if (b2Web && !b2Web.ok) throw new Error(b2Web.reason);
          return { raw: JSON.stringify(final.structured_output), transcriptSha256 };
        } finally { rmSync(call, { recursive: true, force: true }); rmSync(lease, { force: true }); }
      };
      const capture = async ({ stage, rawResponse, trusted, producer, context }) => {
        const cap = captureStageCompletion({ runDir: workRunDir, stage, rawResponse, trusted, producer, createdAt: new Date().toISOString(), context });
        const v = verifyCapturedStage({ completionPath: cap.completionPath, runDir: workRunDir, trusted, producer, context });
        if (!v.ok) throw new Error(v.errors.join(','));
        return cap;
      };
      // Resume: re-verify the stored completion against expected bindings and re-derive the body from
      // verified raw bytes (never trust JSON.parse(...).body).
      const loadCompletion = (stage, { promptHash, context, bodies = {}, legacy = null }) =>
        loadOrArchiveCompletion({ stage, workRunDir, id: row.id, imgSha256: row.image.imgSha256, ext: row.image.ext,
          promptHash, context, bodies, legacy, brokerPolicyVersion: BROKER_POLICY_VERSION,
          imageTransportVersion: IMAGE_TRANSPORT_VERSION, runtimeVersion: process.env.CLAUDE_CODE_VERSION || "unknown" });
      try {
        const { status, bodies, retries, hydration } = await runWorkStages({ workId: row.id, catalog: trustedCatalog(poolById.get(row.id)), legacy: row.legacy, imgSha256: row.image.imgSha256, ext: row.image.ext, prompts, runtimeVersion: process.env.CLAUDE_CODE_VERSION || 'unknown', spawnStage, capture, loadCompletion, skipB4: SKIP_B4 });
        row.stageStatus = status; row.b1 = bodies.B1 || null; row.b2 = bodies.B2 || null; row.b3 = bodies.B3 || null; row.b4 = bodies.B4 || null;
        row.needsAttention = rowNeedsAttention(row); // stage failure OR B4 humanReview conflict OR consequential correction
        // SHA-bound provenance of the deterministic B4 delta->full-record hydration (raw delta stays in the transcript).
        if (hydration && hydration.B4) writeFresh(join(workRunDir, 'b4-assembly.json'), `${JSON.stringify({ workId: row.id, ...hydration.B4 }, null, 1)}\n`);
        // Persist the validation-retry record (attempts + errors) durably; raw transcripts are already saved per attempt.
        if (retries && Object.keys(retries).length) {
          writeFresh(join(workRunDir, 'validation-retries.json'), `${JSON.stringify(retries, null, 1)}\n`);
          if (retries.B2) { retryStat.b2RetriedWorks.push(row.id); retryStat.b2RetryAttempts += retries.B2.attempts; row.b2Retried = true; }
        }
        console.log(`stages ${row.id}: ${JSON.stringify(status)}${retries?.B2 ? ` (B2 validation-retry ×${retries.B2.attempts})` : ''}`);
      } catch (e) { row.stageStatus = { B1: `error:${String(e.message).slice(0, 80)}`, B2: 'skipped', B3: 'skipped', B4: 'skipped' }; row.needsAttention = true; console.log(`WORK ERROR ${row.id}: ${e.message}`); }
    };
    // Deterministic N-lane worker pool: each work is independent; one failure never stops the others.
    let cursor = 0;
    const lane = async () => { while (cursor < rows.length) { const row = rows[cursor++]; await processWork(row); } };
    await Promise.all(Array.from({ length: Math.min(LANES, rows.length || 1) }, lane));
  }

  // Idempotence: a fully-complete LIVE no-op resume (nothing spawned) must NOT rewrite the manifest or packet
  // — their only per-run delta is a volatile generatedAt, which would churn mtimes with no real change. Always
  // (re)write in dry-run and on the first run (files missing) and whenever a stage actually ran.
  const manifestPath = join(runDir, 'run-manifest.json');
  const packetHtmlPath = join(runDir, 'review-packet.html');
  const shouldWriteOutputs = spawnedAny || !LIVE || !existsSync(manifestPath) || !existsSync(packetHtmlPath);
  const promptH = promptHashes();
  const manifest = buildRunManifest({ runId, works, promptHashes: promptH, imagePrep });
  if (shouldWriteOutputs) writeFresh(manifestPath, `${JSON.stringify(manifest, null, 1)}\n`);

  const plan = planCalls(works);
  const failed = imagePrep.filter(p => !p.ok);
  const packet = renderReviewPacket(rows, { runId, mode: LIVE ? 'live' : 'dry-run', generatedAt: new Date().toISOString(), imageBase: `../imgs-${selHash}` });
  if (WRITE_PACKET && shouldWriteOutputs) { writeFileSync(packetHtmlPath, packet.html); writeFileSync(join(runDir, 'review-packet.json'), `${JSON.stringify(packet.json, null, 1)}\n`); }
  else if (!shouldWriteOutputs) console.log('no-op resume: manifest + review packet unchanged (not rewritten)');

  console.log('\n=== CALL PLAN (B0/B1 + conditional B2 + conditional targeted B3 + compact B4) ===');
  console.log(`works ${plan.works} | B1 ${plan.B1} | B2 ≤ ${plan.B2Max} | B3 ≤ ${plan.B3Max} (targeted) | B4 ≤ ${plan.B4Max} | max processes ${plan.maxProcesses}`);
  console.log(`images prepared ${imagePrep.filter(p => p.ok).length}/${imagePrep.length}${failed.length ? ' | SKIPPED (B0 failed): ' + failed.map(f => f.id).join(', ') : ''}`);
  console.log(`run dir: ${runDir}`);
  console.log(`review packet: ${join(runDir, 'review-packet.html')}`);
  if (LIVE) console.log(`B2 validation-retries: ${retryStat.b2RetriedWorks.length} work(s), ${retryStat.b2RetryAttempts} extra attempt(s)${retryStat.b2RetriedWorks.length ? ' — ' + retryStat.b2RetriedWorks.join(', ') : ''}`);
  console.log(LIVE ? `LIVE — ${SKIP_B4 ? 'B1 → conditional B2 → conditional B3 (B4 SKIPPED: --through-b3)' : 'B1 → conditional B2 → conditional B3 → compact B4'} per work (${LANES} lane${LANES > 1 ? 's' : ''}).` : 'DRY RUN — no model calls made.');

  // Desktop notification on a LIVE batch (>1 work): completion, or OWNER ATTENTION if any work failed a stage.
  if (LIVE && rows.length > 1) {
    const stageFailed = r => ['B1', 'B2', 'B3', 'B4'].some(s => r.stageStatus?.[s] && /^(failed|error)/.test(String(r.stageStatus[s])));
    const failures = rows.filter(stageFailed);
    const b0Failed = failed.length;
    const title = failures.length || b0Failed ? 'Gesso Pass B — OWNER ATTENTION' : 'Gesso Pass B — calibration complete';
    const body = `${rows.length} works · B0-skipped ${b0Failed} · stage-failed ${failures.length} · B2-retries ${retryStat.b2RetriedWorks.length}${failures.length ? ' · fails: ' + failures.slice(0, 6).map(r => r.id).join(', ') : ''}`;
    try {
      await execFileP('osascript', ['-e', `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`], { timeout: 8000 });
    } catch { /* notification is best-effort; never fail the run on it */ }
    console.log(`\nNOTIFIED: ${title} — ${body}`);
    if (b0Failed) console.log(`B0 failures (reported as skipped, NOT silently replaced): ${failed.map(f => `${f.id} (${f.reason})`).join('; ')}`);
  }
}

main().catch(e => { console.error('ERROR', e.message); process.exit(1); });
