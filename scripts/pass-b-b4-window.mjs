// Structured B4 (/3) for the rolling 30-day daily window (VSD-042/043), over banked corpus B1–B3 evidence.
//
// Reads ONLY verified B0–B3 evidence from the corpus collector run (never calls B0–B3), and writes quarantined
// B4 attempts under its own run dir. It never creates decisions, approvals, resolutions or production writes.
//   node scripts/pass-b-b4-window.mjs                                   # read-only plan
//   PASS_B_B4_WINDOW_LIVE=1 node scripts/pass-b-b4-window.mjs --run [--max N]
//
// Execution rules (same evidence discipline as the VSD-040 canary, sized for the window):
// - Each attempt is reserved durably (wx + flush) BEFORE the call. A reservation without complete
//   transcript/result/meta evidence is a consumed, terminal unknown-outcome for that work; never re-called.
// - One B4 attempt per work, zero validation retries. Only a verified usage-limit result may retry later.
// - Provenance/tool/model failures are fatal: fatal.json is persisted and every later run refuses to call.
// - Calls start only 00:00–08:30 America/Los_Angeles and are killed by 09:00 (VSD-045).
// - The exact versioned claude binary is pinned for the whole session; each transcript records its version.
// - A session makes at most --max calls (default 200).
import { closeSync, existsSync, fsyncSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { sha256, stableJson } from './lib/vision-legacy.mjs';
import { completionKey } from './lib/vision-content-capture.mjs';
import {
  RUN_ROOT, CALIBRATION_MODEL, VALIDATION_CONTRACT_VERSION, B4_VALIDATION_CONTRACT_VERSION,
  trustedCatalog, snapshotLegacy, buildStageCommand, compactB4DeltaInput, legacyContentInput,
} from './lib/pass-b-calibration.mjs';
import { buildB4Prompt, promptHashes } from './lib/pass-b-prompts.mjs';
import { B4_DELTA_VERSION } from './lib/pass-b-b4-delta.mjs';
import { findingsForWork, loadCanonicalFindings } from './lib/pass-b-blocked-findings.mjs';
import { deriveB4Attempt, CALL_TIMEOUT_MS } from './pass-b-b4-structured-canary.mjs';
import { CORPUS_RUN_ID, CORPUS_RUN_DIR, buildPriorityQueue, inspectWork, pacificClock, callWindow } from './pass-b-corpus-collect.mjs';

export const WINDOW_RUNNER_VERSION = 'passBB4Window/1';
const RESERVATION_VERSION = 'passBB4WindowReservation/1';
const execFileP = promisify(execFile);
const safeWork = workId => sha256(workId).slice(0, 24);
const rawSha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const loadGlobal = (file, name) => { const w = {}; new Function('window', readFileSync(file, 'utf8'))(w); return w[name]; };

// Run identity: the B4 contract + prompt + model + source run. Deliberately NOT the work list — the window moves
// every day — so each work's own inputs are bound in its reservations instead.
export function windowBinding() {
  const command = buildStageCommand({ stage: 'B4', promptText: '<per-work>' });
  return {
    version: WINDOW_RUNNER_VERSION, sourceRunId: CORPUS_RUN_ID, model: CALIBRATION_MODEL,
    sharedValidationContract: VALIDATION_CONTRACT_VERSION, b4ValidationContract: B4_VALIDATION_CONTRACT_VERSION,
    b4DeltaVersion: B4_DELTA_VERSION, b4PromptHash: promptHashes().B4, wireSchemaSha256: command.wireSchemaSha256,
    toolsEnforced: command.toolsEnforced, removeKeys: command.env.removeKeys, callTimeoutMs: CALL_TIMEOUT_MS,
  };
}
export const windowRunId = binding => `b4w-${sha256(stableJson(binding)).slice(0, 12)}`;

// Build one work's B4 plan from the collector's VERIFIED evidence (inspectWork re-validates B0–B3 bytes).
export function planWork({ id, pool, legacyOf, findings, sourceDir = CORPUS_RUN_DIR }) {
  const p = pool.find(x => x.id === id);
  const legacy = legacyOf(id);
  const inspected = inspectWork({ runDir: sourceDir, id, catalog: trustedCatalog(p), legacy });
  if (!inspected.done) return null;
  const workDir = join(sourceDir, 'works', safeWork(id));
  const b0Text = readFileSync(join(workDir, 'b0-prep.json'), 'utf8'), b0 = JSON.parse(b0Text);
  const binding = { b0Sha256: sha256(b0Text) };
  for (const stage of ['B1', 'B2', 'B3']) {
    const path = join(workDir, 'completions', `${stage.toLowerCase()}-${completionKey(stage, id)}.json`);
    if (!existsSync(path)) { binding[stage] = null; continue; }
    const text = readFileSync(path, 'utf8'), c = JSON.parse(text);
    binding[stage] = { completionSha256: sha256(text), bodySha256: c.bodySha256, rawResponseSha256: c.rawResponseSha256, transcriptSha256: c.transcriptSha256 };
  }
  const bodies = inspected.bodies;
  const compactInput = compactB4DeltaInput({ b1: bodies.B1, b2: bodies.B2 || null, b3: bodies.B3 || null, legacyInput: legacyContentInput(legacy) });
  const promptText = `${buildB4Prompt()}\n\nINPUTS:\n${JSON.stringify(compactInput)}`;
  return {
    workId: id, sourceRunId: CORPUS_RUN_ID, b0, b1: bodies.B1, b2: bodies.B2 || null, b3: bodies.B3 || null, legacy,
    sourceBinding: { ...binding, B1: binding.B1, B2: binding.B2 || { completionSha256: null }, B3: binding.B3 || { completionSha256: null } },
    promptHash: sha256(promptText), command: buildStageCommand({ stage: 'B4', promptText }),
    sealedFindingIds: findingsForWork(findings, id).map(row => row.findingId),
  };
}

// Verified per-work history. Returns { attempts:[{attempt, kind, errors}], next } or throws on tampering.
export function workHistory(outDir, plan, runId) {
  const dir = join(outDir, 'works', safeWork(plan.workId));
  if (!existsSync(dir)) return { attempts: [], dir };
  const names = readdirSync(dir);
  const reserved = names.map(n => /^attempt-(\d+)\.reserved\.json$/.exec(n)).filter(Boolean).map(m => Number(m[1])).sort((a, b) => a - b);
  const evidence = names.map(n => /^attempt-(\d+)\.(?:transcript\.jsonl|result\.json|meta\.json)$/.exec(n)).filter(Boolean).map(m => Number(m[1]));
  if (evidence.some(n => !reserved.includes(n))) throw new Error(`${plan.workId}: attempt evidence without a reservation`);
  if (reserved.some((n, i) => n !== i + 1)) throw new Error(`${plan.workId}: attempt numbering is not contiguous`);
  const attempts = [];
  for (const n of reserved) {
    const r = readJson(join(dir, `attempt-${n}.reserved.json`));
    if (r.version !== RESERVATION_VERSION || r.runId !== runId || r.workId !== plan.workId || r.attempt !== n) throw new Error(`${plan.workId}: attempt ${n} reservation binding mismatch`);
    if (r.promptHash !== plan.promptHash || stableJson(r.sourceBinding) !== stableJson(plan.sourceBinding)) throw new Error(`${plan.workId}: source evidence or prompt changed since attempt ${n}; preserved, review before rerun`);
    const t = join(dir, `attempt-${n}.transcript.jsonl`), res = join(dir, `attempt-${n}.result.json`), m = join(dir, `attempt-${n}.meta.json`);
    let meta = null;
    try { meta = existsSync(t) && existsSync(res) && existsSync(m) ? readJson(m) : null; } catch { meta = null; }
    if (!meta) { attempts.push({ attempt: n, kind: 'unknown-outcome', errors: ['reserved-attempt-has-incomplete-evidence'] }); continue; }
    const transcript = readFileSync(t, 'utf8');
    if (meta.transcriptSha256 !== sha256(transcript) || meta.resultSha256 !== rawSha(res)) throw new Error(`${plan.workId}: attempt ${n} evidence changed`);
    const derived = deriveB4Attempt(plan, transcript, meta.exitCode);
    if (meta.status !== derived.kind || stableJson(derived) !== stableJson(readJson(res))) throw new Error(`${plan.workId}: attempt ${n} re-derivation mismatch`);
    attempts.push({ attempt: n, kind: derived.kind, errors: derived.errors, derived });
  }
  if (attempts.slice(0, -1).some(a => a.kind !== 'usage-limit')) throw new Error(`${plan.workId}: attempt after a terminal outcome`);
  return { attempts, dir };
}
export const isTerminal = history => { const last = history.attempts.at(-1); return !!last && last.kind !== 'usage-limit'; };

function durableWrite(path, text) {
  writeFileSync(path, text, { flag: 'wx', mode: 0o600, flush: true });
}
function syncDirs(paths) { for (const p of paths) { const fd = openSync(p, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } } }

export function preservedFatal(outDir) { const p = join(outDir, 'fatal.json'); return existsSync(p) ? readJson(p).reason : null; }
function persistFatal(outDir, runId, reason) { const p = join(outDir, 'fatal.json'); if (!existsSync(p)) durableWrite(p, `${JSON.stringify({ runId, reason, recordedAt: new Date().toISOString() })}\n`); }

export async function callB4Pinned(plan, { bin, execute = execFileP, now = () => new Date() } = {}) {
  const window = callWindow(now()); // throws outside 00:00–08:30 Pacific
  const callDir = mkdtempSync(join(tmpdir(), 'pass-b-b4w-'));
  try {
    const env = { ...process.env, DISABLE_AUTOUPDATER: '1' };
    for (const key of plan.command.env.removeKeys) delete env[key];
    const timeout = Math.min(CALL_TIMEOUT_MS, window.timeout);
    try {
      const { stdout } = await execute(bin || plan.command.bin, plan.command.argv, { cwd: callDir, env, maxBuffer: 64 * 1024 * 1024, timeout, killSignal: 'SIGKILL' });
      return { transcript: stdout, exitCode: 0 };
    } catch (error) {
      const timedOut = error.killed === true && error.signal === 'SIGKILL' && error.code == null;
      return { transcript: error.stdout || '', exitCode: timedOut ? 'timeout' : (error.code ?? 1) };
    }
  } finally { rmSync(callDir, { recursive: true, force: true }); }
}

// One work, at most one fresh attempt. Returns the outcome kind, or 'skipped-terminal'.
export async function runWork({ outDir, runId, plan, callFn, now = () => new Date() }) {
  const history = workHistory(outDir, plan, runId);
  if (isTerminal(history)) return { kind: 'skipped-terminal', history };
  callWindow(now()); // refuse before reserving anything outside the start window
  const attempt = history.attempts.length + 1, dir = history.dir;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  durableWrite(join(dir, `attempt-${attempt}.reserved.json`), `${JSON.stringify({ version: RESERVATION_VERSION, runId, workId: plan.workId, attempt, promptHash: plan.promptHash, sourceBinding: plan.sourceBinding }, null, 1)}\n`);
  syncDirs([dir, join(outDir, 'works'), outDir]);
  let raw;
  try { raw = await callFn(plan); } catch { return { kind: 'unknown-outcome' }; } // may have spent; the reservation is terminal
  durableWrite(join(dir, `attempt-${attempt}.transcript.jsonl`), raw.transcript || '');
  const derived = deriveB4Attempt(plan, raw.transcript || '', raw.exitCode ?? 1);
  const resultPath = join(dir, `attempt-${attempt}.result.json`);
  durableWrite(resultPath, `${JSON.stringify(derived, null, 2)}\n`);
  durableWrite(join(dir, `attempt-${attempt}.meta.json`), `${JSON.stringify({ workId: plan.workId, attempt, status: derived.kind, exitCode: raw.exitCode ?? 1, promptHash: plan.promptHash, transcriptSha256: sha256(raw.transcript || ''), resultSha256: rawSha(resultPath) }, null, 2)}\n`);
  if (derived.kind === 'fatal') persistFatal(outDir, runId, `${plan.workId}: ${derived.errors.join('; ')}`);
  return { kind: derived.kind, derived };
}

export async function runWindow({ plans, outDir, runId, binding, callFn, maxCalls = 200, lanes = 4, now = () => new Date() }) {
  if (!existsSync(join(outDir, 'run-manifest.json'))) {
    mkdirSync(join(outDir, 'works'), { recursive: true, mode: 0o700 });
    durableWrite(join(outDir, 'run-manifest.json'), `${JSON.stringify({ runId, binding }, null, 2)}\n`);
  } else {
    const m = readJson(join(outDir, 'run-manifest.json'));
    if (m.runId !== runId || stableJson(m.binding) !== stableJson(binding)) throw new Error('run manifest differs from the current B4 contract');
  }
  const tally = { calls: 0, accepted: 0, held: 0, fatal: 0, 'usage-limit': 0, 'unknown-outcome': 0, 'skipped-terminal': 0, errors: 0 };
  let stop = preservedFatal(outDir) ? 'preserved-fatal' : null, cursor = 0;
  const lane = async () => {
    while (!stop) {
      const plan = plans[cursor++]; if (!plan) return;
      if (tally.calls >= maxCalls) { stop = 'session-cap'; return; }
      try {
        const h = workHistory(outDir, plan, runId);
        if (isTerminal(h)) { tally['skipped-terminal']++; continue; }
        tally.calls++;
        const r = await runWork({ outDir, runId, plan, callFn, now });
        tally[r.kind] = (tally[r.kind] || 0) + 1;
        if (r.kind === 'fatal') stop = 'fatal-provenance';
        else if (r.kind === 'usage-limit') stop = 'usage-limit';
      } catch (e) {
        if (/start window|protected-hours/i.test(e.message)) { stop = 'protected-hours'; return; }
        tally.errors++; console.error(`WORK ERROR ${plan.workId}: ${e.message}`); // evidence mismatch: preserved, skipped
      }
    }
  };
  if (!stop) await Promise.all(Array.from({ length: lanes }, lane));
  const report = { version: 'passBB4WindowReport/1', runId, at: new Date().toISOString(), stop: stop || 'window-exhausted', ...tally,
    note: 'Quarantined B4 evidence only. accepted = provenance/shape/hydration/leak/reconciliation integrity, not factual approval; no decisions, approvals or publication.' };
  writeFileSync(join(outDir, 'last-session.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return report;
}

async function main() {
  const args = process.argv.slice(2), live = args.includes('--run');
  const maxI = args.indexOf('--max'), maxCalls = maxI >= 0 ? Math.max(0, Number(args[maxI + 1]) || 0) : 200;
  if (live && process.env.PASS_B_B4_WINDOW_LIVE !== '1') throw new Error('refusing --run: set PASS_B_B4_WINDOW_LIVE=1');
  const pool = loadGlobal('data/pool.js', 'ARTEFACTUM_POOL');
  const daily = loadGlobal('data/daily-order.js', 'ARTEFACTUM_DAILY') || { byDate: {} };
  const teach = (loadGlobal('data/teach-works.js', 'ARTEFACTUM_CUES') || {}).work || {};
  const hotspots = loadGlobal('data/hotspots.js', 'ARTEFACTUM_HOTSPOTS') || {};
  const vision = loadGlobal('data/vision.js', 'ARTEFACTUM_VISION') || {};
  const auditIds = new Set(JSON.parse(readFileSync('data/vision-audit.json', 'utf8')).ids || []);
  const legacyOf = id => snapshotLegacy(id, { teach, hotspots, vision, auditIds });
  const findings = loadCanonicalFindings();
  const clock = pacificClock();
  const order = buildPriorityQueue(pool, daily, { today: clock.date }); // date-first 30-day window
  const binding = windowBinding(), runId = windowRunId(binding), outDir = join(RUN_ROOT, runId);
  const plans = [], skipped = [];
  for (const id of order) {
    try { const plan = planWork({ id, pool, legacyOf, findings }); if (plan) plans.push(plan); }
    catch (e) { skipped.push(`${id}: ${e.message}`); }
  }
  let terminal = 0;
  if (existsSync(outDir)) for (const p of plans) { try { if (isTerminal(workHistory(outDir, p, runId))) terminal++; } catch { /* reported on run */ } }
  console.log(`runId: ${runId} | ${WINDOW_RUNNER_VERSION} | source ${CORPUS_RUN_ID} (read-only B0–B3)`);
  console.log(`Pacific date ${clock.date} | may start now: ${clock.mayStart} | window works ${order.length} | B1–B3 done & ready ${plans.length} | already B4-terminal ${terminal} | to call ${plans.length - terminal} | source-evidence skips ${skipped.length}`);
  if (preservedFatal(outDir)) console.log(`PRESERVED FATAL: ${preservedFatal(outDir)} — no calls until reviewed`);
  if (!live) { console.log('READ-ONLY PLAN: no calls or writes.'); return; }
  if (preservedFatal(outDir)) throw new Error('preserved fatal; refusing to call');
  callWindow();
  const bin = realpathSync(String((await execFileP('/usr/bin/which', ['claude'])).stdout).trim()); // pin this session's binary
  const report = await runWindow({ plans, outDir, runId, binding, maxCalls, callFn: plan => callB4Pinned(plan, { bin }) });
  console.log(`B4 window session: stop=${report.stop} calls=${report.calls} accepted=${report.accepted} held=${report.held} fatal=${report.fatal} usage-limit=${report['usage-limit']} unknown=${report['unknown-outcome']} errors=${report.errors}`);
  if (report.stop === 'fatal-provenance') process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main().catch(e => { console.error(`FAIL-CLOSED: ${e.message}`); process.exit(1); });
