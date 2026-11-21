// Teaching-v2 Phase A runner (VSD-093). DEFAULT = DRY RUN: prints every exact W prompt (and the V template) with
// its sha256 and byte size, the per-work candidate binding, plus the expected calls/tokens; makes NO model call and
// writes nothing to production.
//   node scripts/teaching-v2-run.mjs                         # dry run, first ten (serial order from plan.json)
//   node scripts/teaching-v2-run.mjs --phase rest            # dry run, the other 40
//   node scripts/teaching-v2-run.mjs --phase regressions     # dry run, known regression cases (reported separately)
//   node scripts/teaching-v2-run.mjs --previews              # current (index.html itself) + proposed faithful previews
//   node scripts/teaching-v2-run.mjs --fixture-previews      # previews from a labeled synthetic lesson
// LIVE (not authorized yet: needs Codex code review + owner OK): --live with TEACHING_V2_LIVE=1, not CI, holding the
// SHARED evidence lease under a non-automation holder with a teaching-v2-phase-a-* allowance (see docs/PIPELINE.md).
// --phase rest additionally needs every first-ten work terminal and --after-first-ten. Serial only; resumable.
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync, renameSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sha256, stableJson } from './lib/vision-legacy.mjs';
import { execToFile } from './lib/pass-b-exec-to-file.mjs';
import { CONTRACT_VERSION, MODEL, FROZEN_GOLD_SHA256, WIRE_SCHEMA_HASHES, loadGoldBundle, MAX_INVOCATIONS, PLANNED_PATHS } from './lib/teaching-v2-contract.mjs';
import { WRITER_CORE_SHA256, VERIFIER_CORE_SHA256, PROMPT_VERSION, buildVerifierPrompt, promptDigest } from './lib/teaching-v2-prompts.mjs';
import { buildConfinedCommand, runConfined, classifyTranscript, STAGE_EFFORT, CLASSIFIER_VERSION } from './lib/teaching-v2-stage.mjs';
import { CONTROLLER_VERSION, runWork, workContext, writerPromptFor, preflight, telemetry, isTerminal, PauseRun, LatchStop, BindingChanged, candidateBinding, bindingSha } from './lib/teaching-v2-controller.mjs';
import { projectLesson, renderPreviewPage } from './lib/teaching-v2-projection.mjs';
import { loadCurrentRenderer } from './lib/teaching-v2-current-render.mjs';
import { CAPTURE_POLICY_VERSION, SECTION_VERSION, EXTRACTION_VERSION } from './lib/teaching-v2-capture.mjs';
import { loadCalibrationWork, loadRegressionWork, workKey, PLAN_FILE } from './lib/teaching-v2-inputs.mjs';
import { openPhaseAOperations, readLatch, LatchedError } from './lib/teaching-v2-ops.mjs';
import { LeaseBusyError, PersistError } from './lib/pass-b-remote-evidence.mjs';
import { denominators } from './lib/teaching-v2-report.mjs';

const args = process.argv.slice(2);
const has = f => args.includes(f);
const val = (f, d = null) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const EVIDENCE = val('--evidence-root', 'data/incoming/vision-calibration');
const OUT = val('--out', 'data/incoming/teaching-v2');
const PHASE = val('--phase', 'first10');
const LIVE = has('--live');
const plan = JSON.parse(readFileSync(PLAN_FILE, 'utf8'));
const PHASE_DIR = join(OUT, 'phase-a');
const PACKETS = join(PHASE_DIR, 'packets');
const writeJson = (p, v) => { mkdirSync(join(p, '..'), { recursive: true, mode: 0o700 }); const t = `${p}.tmp-${process.pid}`; writeFileSync(t, `${JSON.stringify(v, null, 1)}\n`, { mode: 0o600, flush: true }); renameSync(t, p); };
const readJson = p => existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;

function idsFor(phase) {
  if (has('--only')) return [val('--only')];
  if (phase === 'first10') return plan.firstTen;
  if (phase === 'rest') return plan.rest;
  if (phase === 'regressions') return plan.regressions.filter(r => !plan.order.includes(r.id)).map(r => r.id);
  throw new Error(`unknown --phase ${phase} (first10 | rest | regressions)`);
}
function loadWork(id) {
  if (plan.order.includes(id)) return loadCalibrationWork(id, { evidenceRoot: EVIDENCE });
  const r = plan.regressions.find(x => x.id === id); if (!r) throw new Error(`${id} not in plan`);
  return loadRegressionWork(join(OUT, 'regressions', r.label), r);
}
function loadPacket(id) {
  const p = readJson(join(PACKETS, `${workKey(id)}.json`)), t = readJson(join(PACKETS, `${workKey(id)}.texts.json`));
  if (!p || !t) throw new Error(`${id}: no packet; run scripts/teaching-v2-packets.mjs --build first`);
  if (t.packetSha256 !== p.packetSha256) throw new Error(`${id}: packet texts do not bind this packet`);
  return { packet: p, texts: t.texts };
}
const imageTokens = img => (img?.width && img?.height) ? Math.min(1600, Math.round(img.width * img.height / 750)) : 1600;
// The current renderer is index.html itself (review finding 15), bound into every candidate.
const RENDERER = loadCurrentRenderer();
const rendererFor = id => { const f = RENDERER.poolItem(id); return { ...RENDERER.identity, poolItemSha256: f ? sha256(stableJson(f.it)) : null, inPlayablePool: f?.inPlayablePool ?? false }; };
const renderFor = work => proj => RENDERER.render({ workId: work.id, entry: proj.entry, hotspotEntry: proj.hotspotEntry, visionRecord: work.legacy?.rich ?? null, imageSize: work.image });
const renderLegacy = work => RENDERER.render({ workId: work.id, entry: work.legacy?.teaching ?? null, hotspotEntry: work.legacy?.hotspots ?? null, visionRecord: work.legacy?.rich ?? null, imageSize: work.image });

// Run identity: versions AND every work's frozen candidate binding (catalog, image, receipts, packet, prompt, renderer).
function loadAll(ids, gold) {
  return ids.map(id => { const work = loadWork(id); const { packet, texts } = loadPacket(id); return { id, work, packet, texts, binding: candidateBinding({ work, packet, texts, gold, renderer: rendererFor(id) }) }; });
}
function runIdentity(items) {
  return { contract: CONTRACT_VERSION, controller: CONTROLLER_VERSION, classifier: CLASSIFIER_VERSION, model: MODEL, efforts: STAGE_EFFORT, prompts: { version: PROMPT_VERSION, writer: WRITER_CORE_SHA256, verifier: VERIFIER_CORE_SHA256 }, gold: FROZEN_GOLD_SHA256, wire: WIRE_SCHEMA_HASHES(), capture: [CAPTURE_POLICY_VERSION, EXTRACTION_VERSION, SECTION_VERSION], plan: sha256(stableJson(plan)), renderer: RENDERER.identity, works: Object.fromEntries(items.map(x => [x.id, bindingSha(x.binding)])) };
}
const runIdOf = identity => 'tv2a-' + sha256(stableJson(identity)).slice(0, 12);

function dryRun(items, gold, RUN_ID) {
  const RUN_DIR = join(PHASE_DIR, 'runs', RUN_ID);
  const rows = [];
  for (const { id, work, packet, texts, binding } of items) {
    const pf = preflight({ work, packet, texts });
    const dir = join(RUN_DIR, 'dry-run', work.key);
    const flags = plan.flags[id] || {};
    if (!pf.ok) { console.log(`${id}\n  HOLD before W (no calls): ${pf.reasons.join('; ')}`); rows.push({ id, hold: pf.reasons, calls: 0, flags }); continue; }
    const ctx = workContext({ work, packet, gold });
    const w = writerPromptFor(ctx);
    const vTemplate = buildVerifierPrompt({ allowReplacement: true, gold, catalog: ctx.catalog, b1: ctx.b1, packet, conflicts: ctx.conflicts, b3Candidates: ctx.b3Candidates.kept, dossier: '<dossier: the validated W dossier, filled at run time>', draft: '<COMPLETE_DRAFT_AND_SUPPORT_MAP: the validated W draft, filled at run time>', projection: '<EXACT_PROJECTION_AND_RENDER_MANIFEST: computed from that draft at run time by running index.html>', imageFile: ctx.imageFile });
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, 'W.prompt.txt'), w); writeFileSync(join(dir, 'V.template.txt'), vTemplate); writeJson(join(dir, 'binding.json'), binding);
    const dw = promptDigest(w), dv = promptDigest(vTemplate);
    const img = imageTokens(work.image);
    const prov = Object.entries(work.provenance?.producers || {}).map(([k, v]) => `${k}=${v}`).join(' ');
    console.log(`${id}${flags.goldOverlap ? '  [gold overlap: reported separately; outside the non-gold denominator]' : ''}\n  W  sha256=${dw.sha256}  bytes=${dw.bytes}  effort=${STAGE_EFFORT.W}  image=${ctx.imageFile}\n  V  template sha256=${dv.sha256}  bytes=${dv.bytes} (+ draft/projection at run time)\n  binding ${bindingSha(binding).slice(0, 12)}  packet ${packet.packetSha256.slice(0, 12)} sources ${packet.sources.filter(s => s.status === 'captured').length}/${packet.sources.length}  imported ${prov} (verified)  b3 candidates kept ${ctx.b3Candidates.kept.length} rejected ${ctx.b3Candidates.rejected.length}`);
    rows.push({ id, W: dw, Vtemplate: dv, bindingSha256: bindingSha(binding), estInputTokensW: Math.round(dw.bytes / 4) + img, estInputTokensV: Math.round(dv.bytes / 4) + img + 4000, imageTokens: img, flags });
  }
  const runnable = rows.filter(r => r.W);
  const est = runnable.reduce((n, r) => n + r.estInputTokensW + r.estInputTokensV, 0);
  const summary = {
    runId: RUN_ID, phase: PHASE, works: rows.length, runnable: runnable.length, heldBeforeW: rows.length - runnable.length,
    runnableNonGold: runnable.filter(r => !r.flags?.goldOverlap).length, runnableGoldOverlap: runnable.filter(r => r.flags?.goldOverlap).length,
    plannedCalls: runnable.length * PLANNED_PATHS.cachedB1AndPacket.length, maxCalls: runnable.length * (PLANNED_PATHS.cachedB1AndPacket.length + 1), perWorkCap: MAX_INVOCATIONS,
    singlePassInputTokensEstimate: est, note: 'Single-pass estimate = prompt bytes/4 + image tokens (+~4k for the V draft/projection). Each Read-tool call takes at least two turns, so billed input incl. cache reads is roughly 2x this. Planning figure (design §3.4, measured Arm Y W+V): ~173k total tokens and 12-22k output tokens per work.',
    planningTokens: { totalPerWork: 173000, outputPerWorkLow: 12000, outputPerWorkHigh: 22000, total: runnable.length * 173000, outputLow: runnable.length * 12000, outputHigh: runnable.length * 22000 },
    rows,
  };
  writeJson(join(RUN_DIR, 'dry-run', `summary-${PHASE}.json`), summary);
  console.log(`\nDRY RUN ${RUN_ID} (${PHASE}): ${summary.runnable}/${summary.works} runnable (${summary.runnableNonGold} non-gold, ${summary.runnableGoldOverlap} gold overlap), ${summary.heldBeforeW} held before W; planned calls ${summary.plannedCalls} (max ${summary.maxCalls} with one V2 or transient retry each).`);
  console.log(`tokens: single-pass input estimate ${est.toLocaleString()}; planning figure ${summary.planningTokens.total.toLocaleString()} total, ${summary.planningTokens.outputLow.toLocaleString()}-${summary.planningTokens.outputHigh.toLocaleString()} output.`);
  console.log(`prompts written to ${join(RUN_DIR, 'dry-run')}. NO model calls were made.`);
}

async function live(items, gold, RUN_ID, identity) {
  if (process.env.TEACHING_V2_LIVE !== '1' || process.env.CI) { console.error('REFUSED: --live needs TEACHING_V2_LIVE=1 (after Codex code review and an owner OK) and not CI.'); process.exit(2); }
  const RUN_DIR = join(PHASE_DIR, 'runs', RUN_ID);
  if (PHASE === 'rest') {
    const notDone = plan.firstTen.filter(id => !isTerminal(readJson(join(RUN_DIR, 'works', workKey(id), 'state.json'))));
    if (notDone.length || !has('--after-first-ten')) { console.error(`REFUSED: the first ten must all be terminal (${notDone.length} not) and the owner must pass --after-first-ten after reviewing them.`); process.exit(2); }
  }
  const runnable = items.filter(x => preflight(x).ok).length;
  let ops;
  try { ops = openPhaseAOperations({ phaseDir: PHASE_DIR, runDir: RUN_DIR, runId: RUN_ID, maxCallsForPhase: runnable * (PLANNED_PATHS.cachedB1AndPacket.length + 1) }); }
  catch (e) { if (e instanceof LeaseBusyError || e instanceof LatchedError) { console.error(`REFUSED: ${e.message}`); process.exit(3); } throw e; }
  const idPath = join(RUN_DIR, 'run-identity.json');
  if (!existsSync(idPath)) { writeJson(idPath, { runId: RUN_ID, ...identity }); ops.persist([idPath], `teaching-v2 run ${RUN_ID}`); }
  // Exact versioned CLI binary resolved once (local metadata, never a model query), as the collector does.
  const execFileP = promisify(execFile);
  const bin = realpathSync(String((await execFileP('sh', ['-c', 'command -v claude'])).stdout).trim());
  const runtimeVersion = String((await execFileP(bin, ['--version'], { timeout: 10000, env: { ...process.env, DISABLE_AUTOUPDATER: '1' } })).stdout).match(/\b\d+\.\d+\.\d+\b/)?.[0];
  if (!runtimeVersion) { console.error('REFUSED: could not pin the CLI runtime version'); process.exit(3); }
  for (const { id, work, packet, texts, binding } of items) {
    const wdir = join(RUN_DIR, 'works', work.key), adir = join(wdir, 'attempts'), statePath = join(wdir, 'state.json');
    const state = readJson(statePath) || { workId: id, runId: RUN_ID, status: 'pending', startedAt: new Date().toISOString(), priorRuns: priorRunHistory(work.key, RUN_ID) };
    const stem = e => `${String(e.seq).padStart(2, '0')}-${e.kind}`;
    const save = s => writeJson(statePath, s);
    const attempts = {
      reserve(entry, promptText) {
        mkdirSync(adir, { recursive: true, mode: 0o700 });
        writeFileSync(join(adir, `${stem(entry)}.prompt.txt`), promptText, { flag: 'wx', mode: 0o600, flush: true });
        writeFileSync(join(adir, `${stem(entry)}.reserved.json`), `${JSON.stringify({ runId: RUN_ID, workId: id, ...entry, runtimeVersion, holder: process.env.PASS_B_LEASE_HOLDER, budgetId: ops.allowance.budgetId })}\n`, { flag: 'wx', mode: 0o600, flush: true });
        ops.persist([statePath, join(adir, `${stem(entry)}.reserved.json`), join(adir, `${stem(entry)}.prompt.txt`)], `teaching-v2 reserve ${id}/${stem(entry)}`); // BEFORE the call
      },
      recover(entry) {
        const tp = join(adir, `${stem(entry)}.transcript.jsonl`); if (!existsSync(tp)) return null;
        const stdout = readFileSync(tp, 'utf8'), meta = readJson(join(adir, `${stem(entry)}.meta.json`)), res = readJson(join(adir, `${stem(entry)}.reserved.json`));
        if (entry.transcriptSha256 && sha256(stdout) !== entry.transcriptSha256) return { kind: 'fatal', reason: 'transcript bytes changed since the attempt was recorded' };
        const cls = classifyTranscript(stdout, { exitCode: meta?.exitCode ?? 0, callDir: meta?.callDir ?? null, imageFile: `${work.image.sha256}.${work.image.ext}`, runtimeVersion: res?.runtimeVersion });
        return { ...cls, transcriptSha256: sha256(stdout) };
      },
    };
    const invoke = async (stage, { promptText, wireSchema, seq }) => {
      const command = buildConfinedCommand({ stage, promptText, imageFile: `${work.image.sha256}.${work.image.ext}`, wireSchema });
      const r = await runConfined(command, { imagePath: work.image.path, execute: execToFile, runtimeVersion, bin });
      const s = stem({ seq, kind: stage });
      writeFileSync(join(adir, `${s}.transcript.jsonl`), r.stdout, { flag: 'wx', mode: 0o600, flush: true });
      writeFileSync(join(adir, `${s}.meta.json`), `${JSON.stringify({ stage, seq, kind: r.kind, reason: r.reason, exitCode: r.exitCode, callDir: r.callDir, wallMs: r.wallMs, transcriptSha256: r.transcriptSha256, promptSha256: command.promptSha256, promptBytes: command.promptBytes, wireSchemaSha256: command.wireSchemaSha256, usage: r.usage, toolUses: r.toolUses, classifier: r.classifier })}\n`, { flag: 'wx', mode: 0o600, flush: true });
      ops.record(r.stdout, `teaching-v2:${id}/${stage}`);
      try { ops.persist([join(adir, `${s}.transcript.jsonl`), join(adir, `${s}.meta.json`)], `teaching-v2 outcome ${id}/${s}: ${r.kind}`); }
      catch (e) { if (r.kind !== 'fatal') throw new PauseRun(`outcome not pushed (reconciled from the local transcript on resume): ${e.message}`); }
      console.log(`  ${id} ${stage}: ${r.kind}${r.reason ? ` (${r.reason})` : ''} ${r.wallMs}ms in=${r.usage?.inputTokens} out=${r.usage?.outputTokens} cacheRead=${r.usage?.cacheReadInputTokens}`);
      return r;
    };
    const finalize = payload => {
      const p = join(wdir, 'final-payload.json');
      writeFileSync(p, `${JSON.stringify(payload, null, 1)}\n`, { flag: 'wx', mode: 0o600, flush: true });
      ops.persist([p], `teaching-v2 final ${id}`);
      return JSON.parse(readFileSync(p, 'utf8'));
    };
    try { await runWork({ work, packet, texts, gold, state, invoke, gate: () => ops.gate(), attempts, save, render: renderFor(work), finalize, binding }); }
    catch (e) {
      if (e instanceof LatchStop) { ops.latch({ kind: e.latch, reason: e.message, workId: id }); console.error(`LATCHED at ${id}: ${e.message}. Nothing more runs until the owner reviews it.`); break; }
      if (e instanceof PauseRun || e instanceof LatchedError || e instanceof LeaseBusyError || e instanceof PersistError) { console.error(`PAUSED at ${id}: ${e.message}`); break; }
      throw e;
    } finally { try { ops.persist([statePath], `teaching-v2 state ${id}`); } catch { /* the next reservation push carries it */ } }
    console.log(`${id}: ${state.status}${state.holdReasons ? ` — ${state.holdReasons[0]}` : ''}`);
  }
  summarize(items.map(x => x.id), RUN_ID);
}
// Calls this work already cost under earlier run versions (a changed candidate never hides its retries).
function priorRunHistory(key, runId) {
  const root = join(PHASE_DIR, 'runs'); if (!existsSync(root)) return [];
  return readdirSync(root).filter(r => r !== runId).flatMap(r => { const s = readJson(join(root, r, 'works', key, 'state.json')); return s ? [{ runId: r, calls: (s.ledger || []).length, status: s.status }] : []; });
}

function summarize(ids, RUN_ID) {
  const RUN_DIR = join(PHASE_DIR, 'runs', RUN_ID);
  const rows = ids.map(id => { const s = readJson(join(RUN_DIR, 'works', workKey(id), 'state.json')); return { id, flags: plan.flags[id] || null, ...(s ? telemetry(s) : { status: 'not-started' }), priorRunCalls: (s?.priorRuns || []).reduce((n, p) => n + p.calls, 0), holdReasons: s?.holdReasons ?? null }; });
  const acc = rows.filter(r => r.status === 'accepted-for-review');
  const tot = k => rows.reduce((n, r) => n + (r[k] || 0), 0);
  writeJson(join(RUN_DIR, `summary-${PHASE}.json`), { runId: RUN_ID, phase: PHASE, works: rows.length, acceptedForReview: acc.length, held: rows.filter(r => r.status === 'hold').length,
    calls: tot('calls'), inputTokens: tot('inputTokens'), outputTokens: tot('outputTokens'), cacheReadInputTokens: tot('cacheReadInputTokens'), wallMs: tot('wallMs'),
    perAcceptedOutputTokens: acc.length ? Math.round(tot('outputTokens') / acc.length) : null, denominators: denominators(rows, plan.flags), rows });
  console.log(`summary -> ${join(RUN_DIR, `summary-${PHASE}.json`)}`);
}

function previews(items, RUN_ID, { fixture = false } = {}) {
  const RUN_DIR = join(PHASE_DIR, 'runs', RUN_ID);
  const dir = join(RUN_DIR, fixture ? 'previews-fixture' : 'previews'); mkdirSync(join(dir, 'img'), { recursive: true, mode: 0o700 });
  const works = items.map(({ id, work }) => {
    const rel = `img/${work.image.sha256}.${work.image.ext}`; if (!existsSync(join(dir, rel))) copyFileSync(work.image.path, join(dir, rel));
    const s = fixture ? { status: 'FIXTURE (synthetic text, not a model output)', final: { draft: { lesson: fixtureLesson() } } } : readJson(join(RUN_DIR, 'works', work.key, 'state.json'));
    const lesson = s?.status === 'accepted-for-review' || fixture ? s.final.draft.lesson : null;
    const projection = lesson ? projectLesson(lesson) : null;
    // A candidate renders through index.html; a hold (or an unrun work) renders the FROZEN LEGACY that stays live.
    const current = projection ? renderFor(work)(projection) : renderLegacy(work);
    return { id, title: work.catalog?.title, artist: work.catalog?.artist, date: work.catalog?.date, imageRel: rel, status: s?.status || 'not run', projection, current, shown: projection ? 'candidate' : 'frozen legacy', entry: projection ? projection.entry : (work.legacy?.teaching ?? null) };
  });
  for (const kind of ['current', 'faithful']) writeFileSync(join(dir, `${kind}.html`), renderPreviewPage({ kind, works, generatedFrom: `run ${RUN_ID}` }));
  console.log(`previews -> ${join(dir, 'current.html')} and ${join(dir, 'faithful.html')}`);
}
// Labeled synthetic lesson to exercise the preview path (mixed dots, a no-dot note, a generic question).
function fixtureLesson() {
  return { why: 'FIXTURE: this synthetic lesson exercises the preview renderer and says nothing about the work.',
    hotspots: [{ id: 'h1', tag: 'medium', head: 'Fixture dot one', body: 'A dotted note.', x: 0.3, y: 0.4 }, { id: 'h2', tag: 'style', head: 'Fixture no-dot note', body: 'A distributed observation with no dot.', x: null, y: null }, { id: 'h3', tag: 'format', head: 'Fixture dot three', body: 'Dot number three, not renumbered to two.', x: 0.7, y: 0.6 }],
    questions: [{ id: 'q1', q: 'What is the story behind it?', a: 'A generic stem the current renderer may hide.' }, { id: 'q2', q: 'FIXTURE question two?', a: 'Answer two.' }, { id: 'q3', q: 'FIXTURE question three?', a: 'Answer three.' }, { id: 'q4', q: 'FIXTURE question four?', a: 'Answer four.' }] };
}

async function main() {
  const gold = loadGoldBundle('.');
  const ids = idsFor(PHASE);
  const items = loadAll(has('--fixture-previews') ? ids.slice(0, 2) : ids, gold);
  const identity = runIdentity(items), RUN_ID = runIdOf(identity);
  const latch = readLatch(PHASE_DIR);
  if (latch) console.log(`NOTE: phase-wide ${latch.kind} latch present (${latch.at}); live runs are refused until the owner clears it.`);
  if (has('--fixture-previews')) return previews(items, RUN_ID, { fixture: true });
  if (has('--previews')) return previews(items, RUN_ID);
  if (LIVE) return live(items, gold, RUN_ID, identity);
  return dryRun(items, gold, RUN_ID);
}
main().catch(e => { console.error(`FAIL-CLOSED: ${e.message}`); process.exit(1); });
