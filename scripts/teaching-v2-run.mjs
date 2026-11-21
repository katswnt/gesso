// Teaching-v2 Phase A runner (VSD-093). DEFAULT = DRY RUN: prints every exact W prompt (and the V template) with
// its sha256 and byte size, plus the expected calls/tokens; makes NO model call and writes nothing to production.
//   node scripts/teaching-v2-run.mjs                         # dry run, first ten (serial order from plan.json)
//   node scripts/teaching-v2-run.mjs --phase rest            # dry run, the other 40
//   node scripts/teaching-v2-run.mjs --phase regressions     # dry run, known regression cases (reported separately)
//   node scripts/teaching-v2-run.mjs --previews              # render current/faithful previews from a run's states
//   node scripts/teaching-v2-run.mjs --fixture-previews      # render previews from a labeled synthetic lesson
// LIVE (not authorized yet: needs Codex code review + owner OK): --live with TEACHING_V2_LIVE=1, not CI.
// --phase rest additionally needs every first-ten work terminal and --after-first-ten. Serial only; resumable.
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256, stableJson } from './lib/vision-legacy.mjs';
import { execToFile } from './lib/pass-b-exec-to-file.mjs';
import { makePacer, recordObservation, latestObservation } from './lib/pass-b-pacing.mjs';
import { CONTRACT_VERSION, MODEL, FROZEN_GOLD_SHA256, WIRE_SCHEMA_HASHES, loadGoldBundle, MAX_INVOCATIONS, PLANNED_PATHS } from './lib/teaching-v2-contract.mjs';
import { WRITER_CORE_SHA256, VERIFIER_CORE_SHA256, PROMPT_VERSION, buildVerifierPrompt, promptDigest } from './lib/teaching-v2-prompts.mjs';
import { buildConfinedCommand, runConfined, STAGE_EFFORT } from './lib/teaching-v2-stage.mjs';
import { CONTROLLER_VERSION, runWork, workContext, writerPromptFor, preflight, telemetry, isTerminal, PauseRun } from './lib/teaching-v2-controller.mjs';
import { projectLesson, renderPreviewPage } from './lib/teaching-v2-projection.mjs';
import { CAPTURE_POLICY_VERSION, SECTION_VERSION, EXTRACTION_VERSION } from './lib/teaching-v2-capture.mjs';
import { loadCalibrationWork, loadRegressionWork, workKey, PLAN_FILE } from './lib/teaching-v2-inputs.mjs';

const args = process.argv.slice(2);
const has = f => args.includes(f);
const val = (f, d = null) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const EVIDENCE = val('--evidence-root', 'data/incoming/vision-calibration');
const OUT = val('--out', 'data/incoming/teaching-v2');
const PHASE = val('--phase', 'first10');
const LIVE = has('--live');
const MAX_CALLS = Number(val('--max-calls', String(10 * (PLANNED_PATHS.cachedB1AndPacket.length + 1))));
const plan = JSON.parse(readFileSync(PLAN_FILE, 'utf8'));
const PACKETS = join(OUT, 'phase-a', 'packets');
const IDENTITY = { contract: CONTRACT_VERSION, controller: CONTROLLER_VERSION, model: MODEL, efforts: STAGE_EFFORT, prompts: { version: PROMPT_VERSION, writer: WRITER_CORE_SHA256, verifier: VERIFIER_CORE_SHA256 }, gold: FROZEN_GOLD_SHA256, wire: WIRE_SCHEMA_HASHES(), capture: [CAPTURE_POLICY_VERSION, EXTRACTION_VERSION, SECTION_VERSION], plan: sha256(stableJson(plan)) };
const RUN_ID = 'tv2a-' + sha256(stableJson(IDENTITY)).slice(0, 12);
const RUN_DIR = join(OUT, 'phase-a', 'runs', RUN_ID);
const writeJson = (p, v) => { mkdirSync(join(p, '..'), { recursive: true, mode: 0o700 }); writeFileSync(p, `${JSON.stringify(v, null, 1)}\n`, { mode: 0o600 }); };
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
let VISION = null;
function visPinsFor(id) {
  if (VISION === null) { const w = {}; new Function('window', readFileSync('data/vision.js', 'utf8'))(w); VISION = w.ARTEFACTUM_VISION || {}; }
  const q = (String(id).match(/Q\d+/) || [])[0];
  const v = VISION[id] || (q && (VISION[`wikidata:${q}`] || VISION[`http://www.wikidata.org/entity/${q}`])) || null;
  return v?.pins || [];
}
const imageTokens = img => (img?.width && img?.height) ? Math.min(1600, Math.round(img.width * img.height / 750)) : 1600;

function dryRun(ids, gold) {
  const rows = [];
  for (const id of ids) {
    const work = loadWork(id); const { packet, texts } = loadPacket(id);
    const pf = preflight({ work, packet, texts });
    const dir = join(RUN_DIR, 'dry-run', work.key);
    if (!pf.ok) { console.log(`${id}\n  HOLD before W (no calls): ${pf.reasons.join('; ')}`); rows.push({ id, hold: pf.reasons, calls: 0 }); continue; }
    const ctx = workContext({ work, packet, gold });
    const w = writerPromptFor(ctx);
    const vTemplate = buildVerifierPrompt({ allowReplacement: true, gold, catalog: ctx.catalog, b1: ctx.b1, packet, conflicts: ctx.conflicts, b3Candidates: ctx.b3Candidates.kept, dossier: '<dossier: the validated W dossier, filled at run time>', draft: '<COMPLETE_DRAFT_AND_SUPPORT_MAP: the validated W draft, filled at run time>', projection: '<EXACT_PROJECTION_AND_RENDER_MANIFEST: computed from that draft at run time>', imageFile: ctx.imageFile });
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, 'W.prompt.txt'), w); writeFileSync(join(dir, 'V.template.txt'), vTemplate);
    const dw = promptDigest(w), dv = promptDigest(vTemplate);
    const img = imageTokens(work.image);
    const flags = plan.flags[id] || {};
    console.log(`${id}${flags.goldOverlap ? '  [gold overlap: excluded from gate metrics]' : ''}\n  W  sha256=${dw.sha256}  bytes=${dw.bytes}  effort=${STAGE_EFFORT.W}  image=${ctx.imageFile}\n  V  template sha256=${dv.sha256}  bytes=${dv.bytes} (+ draft/projection at run time)\n  packet ${packet.packetSha256.slice(0, 12)} sources ${packet.sources.filter(s => s.status === 'captured').length}/${packet.sources.length}  b3 candidates kept ${ctx.b3Candidates.kept.length} rejected ${ctx.b3Candidates.rejected.length}`);
    rows.push({ id, W: dw, Vtemplate: dv, estInputTokensW: Math.round(dw.bytes / 4) + img, estInputTokensV: Math.round(dv.bytes / 4) + img + 4000, imageTokens: img, flags });
  }
  const runnable = rows.filter(r => r.W);
  const est = runnable.reduce((n, r) => n + r.estInputTokensW + r.estInputTokensV, 0);
  const summary = {
    runId: RUN_ID, phase: PHASE, works: rows.length, runnable: runnable.length, heldBeforeW: rows.length - runnable.length,
    plannedCalls: runnable.length * PLANNED_PATHS.cachedB1AndPacket.length, maxCalls: runnable.length * (PLANNED_PATHS.cachedB1AndPacket.length + 1), perWorkCap: MAX_INVOCATIONS,
    singlePassInputTokensEstimate: est, note: 'Single-pass estimate = prompt bytes/4 + image tokens (+~4k for the V draft/projection). Each Read-tool call takes at least two turns, so billed input incl. cache reads is roughly 2x this. Planning figure (design §3.4, measured Arm Y W+V): ~173k total tokens and 12-22k output tokens per work.',
    planningTokens: { totalPerWork: 173000, outputPerWorkLow: 12000, outputPerWorkHigh: 22000, total: runnable.length * 173000, outputLow: runnable.length * 12000, outputHigh: runnable.length * 22000 },
    rows,
  };
  writeJson(join(RUN_DIR, 'dry-run', `summary-${PHASE}.json`), summary);
  console.log(`\nDRY RUN ${RUN_ID} (${PHASE}): ${summary.runnable}/${summary.works} runnable, ${summary.heldBeforeW} held before W; planned calls ${summary.plannedCalls} (max ${summary.maxCalls} with one V2 or transport retry each).`);
  console.log(`tokens: single-pass input estimate ${est.toLocaleString()}; planning figure ${summary.planningTokens.total.toLocaleString()} total, ${summary.planningTokens.outputLow.toLocaleString()}-${summary.planningTokens.outputHigh.toLocaleString()} output.`);
  console.log(`prompts written to ${join(RUN_DIR, 'dry-run')}. NO model calls were made.`);
}

async function live(ids, gold) {
  if (process.env.TEACHING_V2_LIVE !== '1' || process.env.CI) { console.error('REFUSED: --live needs TEACHING_V2_LIVE=1 (after Codex code review and an owner OK) and not CI.'); process.exit(2); }
  if (PHASE === 'rest') {
    const notDone = plan.firstTen.filter(id => !isTerminal(readJson(join(RUN_DIR, 'works', workKey(id), 'state.json'))));
    if (notDone.length || !has('--after-first-ten')) { console.error(`REFUSED: the first ten must all be terminal (${notDone.length} not) and the owner must pass --after-first-ten after reviewing them.`); process.exit(2); }
  }
  writeJson(join(RUN_DIR, 'run-identity.json'), { runId: RUN_ID, ...IDENTITY });
  const usageLog = join(OUT, 'phase-a', 'usage.jsonl');
  const pacer = makePacer({ logPath: usageLog, maxCalls: MAX_CALLS, statePath: join(RUN_DIR, `call-budget-${PHASE}.json`) });
  for (const id of ids) {
    const work = loadWork(id); const { packet, texts } = loadPacket(id);
    const wdir = join(RUN_DIR, 'works', work.key); const statePath = join(wdir, 'state.json');
    const state = readJson(statePath) || { workId: id, runId: RUN_ID, status: 'pending', startedAt: new Date().toISOString() };
    if (isTerminal(state)) { console.log(`skip ${id}: ${state.status}`); continue; }
    let seq = (state.ledger || []).length;
    const invoke = async (stage, { promptText, wireSchema }) => {
      const d = pacer.check(); if (!d.go) throw new PauseRun(`pacing: ${d.reason}`);
      const before = latestObservation(usageLog);
      const command = buildConfinedCommand({ stage, promptText, imageFile: `${work.image.sha256}.${work.image.ext}`, wireSchema });
      const r = await runConfined(command, { imagePath: work.image.path, execute: execToFile });
      seq++; const stem = `${String(seq).padStart(2, '0')}-${stage}`;
      mkdirSync(join(wdir, 'attempts'), { recursive: true, mode: 0o700 });
      writeFileSync(join(wdir, 'attempts', `${stem}.transcript.jsonl`), r.stdout, { flag: 'wx', mode: 0o600 });
      writeFileSync(join(wdir, 'attempts', `${stem}.prompt.txt`), promptText, { flag: 'wx', mode: 0o600 });
      try { recordObservation(usageLog, r.stdout, { source: `teaching-v2:${id}/${stage}` }); } catch { /* advisory */ }
      writeJson(join(wdir, 'attempts', `${stem}.meta.json`), { stage, kind: r.kind, reason: r.reason, exitCode: r.exitCode, wallMs: r.wallMs, transcriptSha256: r.transcriptSha256, promptSha256: command.promptSha256, promptBytes: command.promptBytes, wireSchemaSha256: command.wireSchemaSha256, usage: r.usage, allowanceBefore: before, toolUses: r.toolUses });
      console.log(`  ${id} ${stage}: ${r.kind}${r.reason ? ` (${r.reason})` : ''} ${r.wallMs}ms in=${r.usage?.inputTokens} out=${r.usage?.outputTokens} cacheRead=${r.usage?.cacheReadInputTokens}`);
      return r;
    };
    try { await runWork({ work, packet, texts, gold, state, invoke, save: s => writeJson(statePath, s), visPins: visPinsFor(id) }); }
    catch (e) { if (e instanceof PauseRun) { console.error(`PAUSED at ${id}: ${e.message}`); break; } throw e; }
    console.log(`${id}: ${state.status}${state.holdReasons ? ` — ${state.holdReasons[0]}` : ''}`);
  }
  summarize(ids);
}

function summarize(ids) {
  const rows = ids.map(id => { const s = readJson(join(RUN_DIR, 'works', workKey(id), 'state.json')); return { id, flags: plan.flags[id] || null, ...(s ? telemetry(s) : { status: 'not-started' }), holdReasons: s?.holdReasons ?? null }; });
  const acc = rows.filter(r => r.status === 'accepted-for-review');
  const tot = k => rows.reduce((n, r) => n + (r[k] || 0), 0);
  writeJson(join(RUN_DIR, `summary-${PHASE}.json`), { runId: RUN_ID, phase: PHASE, works: rows.length, acceptedForReview: acc.length, held: rows.filter(r => r.status === 'hold').length,
    calls: tot('calls'), inputTokens: tot('inputTokens'), outputTokens: tot('outputTokens'), cacheReadInputTokens: tot('cacheReadInputTokens'), wallMs: tot('wallMs'),
    perAcceptedOutputTokens: acc.length ? Math.round(tot('outputTokens') / acc.length) : null, rows });
  console.log(`summary -> ${join(RUN_DIR, `summary-${PHASE}.json`)}`);
}

function previews(ids, { fixture = false } = {}) {
  const dir = join(RUN_DIR, fixture ? 'previews-fixture' : 'previews'); mkdirSync(join(dir, 'img'), { recursive: true, mode: 0o700 });
  const works = ids.map(id => {
    const work = loadWork(id);
    const rel = `img/${work.image.sha256}.${work.image.ext}`; if (!existsSync(join(dir, rel))) copyFileSync(work.image.path, join(dir, rel));
    const s = fixture ? { status: 'FIXTURE (synthetic text, not a model output)', final: { draft: { lesson: fixtureLesson() } } } : readJson(join(RUN_DIR, 'works', work.key, 'state.json'));
    const lesson = s?.final?.draft?.lesson;
    return { id, title: work.catalog?.title, artist: work.catalog?.artist, date: work.catalog?.date, imageRel: rel, status: s?.status || 'not run', projection: lesson ? projectLesson(lesson) : null, visPins: visPinsFor(id) };
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
  if (has('--fixture-previews')) return previews(ids.slice(0, 2), { fixture: true });
  if (has('--previews')) return previews(ids);
  if (LIVE) return live(ids, gold);
  return dryRun(ids, gold);
}
main().catch(e => { console.error(`FAIL-CLOSED: ${e.message}`); process.exit(1); });
