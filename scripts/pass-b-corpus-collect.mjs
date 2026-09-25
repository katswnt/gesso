// Pass B B0–B3 collector (VSD-041/042/045): quarantined evidence only, never approval/publication.
// Default: read-only evidence/queue plan. --repair-history: exclusive offline raw/ledger repair.
// --run requires PASS_B_CORPUS_LIVE=1 and explicit owner spend authorization.
// Banked /2 stage evidence stays byte-identical; /4 execution epochs separately pin the CLI/runtime,
// subscription provenance, pre-call receipts, and Pacific start/deadline rules.
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, copyFileSync, mkdtempSync, rmSync, renameSync, unlinkSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import broker, { BROKER_POLICY_VERSION } from './lib/img-broker.mjs';
import { sha256, stableJson } from './lib/vision-legacy.mjs';
import { captureStageCompletion, verifyCapturedStage, completionKey } from './lib/vision-content-capture.mjs';
import { validateStageBody, validateStageCompletion } from './lib/vision-content-schema.mjs';
import { stagePrompts } from './lib/pass-b-prompts.mjs';
import {
  RUN_ROOT, CALIBRATION_MODEL, IMAGE_TRANSPORT_VERSION, VALIDATION_CONTRACT_VERSION,
  trustedCatalog, snapshotLegacy, runWorkStages, neutralImageFile, parseStreamTranscript, transcriptFinal,
  verifyB1ImageRead, verifyB2WebEvents, primaryModelFromEnvelope,
  legacyContentInput, b2InputFor, b2Plan, b3Plan, producerEvidence, verifyStageEvidence, findTranscriptBySha,
} from './lib/pass-b-calibration.mjs';

export const COLLECTOR_VERSION = 'passBCorpusCollector/4';
// Banked B1–B3 inputs/acceptance are unchanged. Execution policy is bound separately before new calls.
export const EVIDENCE_CONTRACT_VERSION = 'passBCorpusCollector/2';
const LANES = 4;
const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const execFileP = promisify(execFile);
const prompts = stagePrompts();
const PROMPT_HASHES_B0B3 = { B1: sha256(prompts.B1), B2: sha256(prompts.B2), B3: sha256(prompts.B3) }; // B4 EXCLUDED
// Hash the FULL contract directly (calibrationContract/contractHash intentionally ignores non-calibration
// fields like model/broker, so we must not route through it here — item 1 requires binding all of them).
export function computeRunId(contract) { return 'corpus-b3-' + sha256(stableJson(contract)).slice(0, 12); }
// Evidence run identity binds the original collection contract, model, broker, transport, validation, and
// B1–B3 prompts. Runtime/scheduling hardening is separately bound by execution-policy.json; B4 is excluded.
export function runIdFor({ promptHashes, model = CALIBRATION_MODEL, collector = EVIDENCE_CONTRACT_VERSION }) {
  return computeRunId({ scope: 'corpus-through-b3', collector, prompts: { B1: promptHashes.B1, B2: promptHashes.B2, B3: promptHashes.B3 }, model, broker: BROKER_POLICY_VERSION, transport: IMAGE_TRANSPORT_VERSION, validation: VALIDATION_CONTRACT_VERSION });
}
// Queue is derived from verified terminal states: priority order minus done minus held (no fragile cursor).
export function computeQueue(order, { eligibleSet, doneSet, heldSet }) { return order.filter(id => eligibleSet.has(id) && !doneSet.has(id) && !heldSet.has(id)); }
export function derivativeMatches(path, sha) { try { return existsSync(path) && createHash('sha256').update(readFileSync(path)).digest('hex') === sha; } catch { return false; } }
// A usage-limit interruption is NOT a terminal failure — the work is left for resume, never held.
export function isUsageInterrupted(status) { return Object.values(status || {}).some(s => typeof s === 'string' && /usage limit/i.test(s)); }
// A missing reason never proves a hold was transient; preserved attempts take precedence.
export function isLeaseInterrupted(status) { return Object.values(status || {}).some(s => typeof s === 'string' && /stage [A-Z0-9]+ leased by another collector/i.test(s)); }
export function isRecoverableHeldReason(reason) { return !!reason && /stage [A-Z0-9]+ leased by another collector/i.test(String(reason)); }
export function heldToRequeue(heldIds, heldReasons = {}) { return (heldIds || []).filter(id => isRecoverableHeldReason(heldReasons[id])); }
const RUN_ID = runIdFor({ promptHashes: { ...PROMPT_HASHES_B0B3, B4: sha256(prompts.B4) } });
const RUN_DIR = join(RUN_ROOT, RUN_ID);
export const CORPUS_RUN_ID = RUN_ID, CORPUS_RUN_DIR = RUN_DIR; // read-only source for the window B4 runner
const IMGS_DIR = join(RUN_DIR, 'imgs');
const IMAGE_INDEX = join(IMGS_DIR, 'image-index.json');
const LEDGER = join(RUN_DIR, 'ledger.json');
const RUN_LEASE = join(RUN_DIR, 'collector.lease');
const PRIOR_RUN = 'corpus-b3-d0d9f638d9c1'; // pre-fork run to migrate verified works from (kept unchanged)

const rawFileSha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const loadGlobal = (file, name) => { const w = {}; new Function('window', readFileSync(file, 'utf8'))(w); return w[name]; };
const wdirOf = (id) => join(RUN_DIR, 'works', sha256(id).slice(0, 24));
const atomicWrite = (path, text) => { const tmp = `${path}.tmp-${process.pid}`; writeFileSync(tmp, text, { mode: 0o600 }); renameSync(tmp, path); };

class UsageLimitError extends Error {}
class FatalError extends Error {}
class RetryableError extends Error {}
class StageLeaseBusyError extends Error {}
class TerminalAttemptError extends Error {}
export class OperationalPauseError extends Error {}
export class RuntimePauseError extends OperationalPauseError {}
const USAGE_MARKER = /usage limit|spend limit|rate.?limit|quota/i;

const processIsAlive = (pid) => {
  try { process.kill(pid, 0); return true; }
  catch (e) { return e?.code !== 'ESRCH'; } // EPERM/unknown fail closed: assume the process is alive.
};
const parseStageLease = (text) => {
  const m = String(text || '').trim().match(/^(\d+)\s+(\S+)$/);
  if (!m || !Number.isSafeInteger(Number(m[1])) || Number(m[1]) <= 0 || !Number.isFinite(Date.parse(m[2]))) return null;
  return { pid: Number(m[1]), createdAt: m[2] };
};
// Acquire a stage lease without requiring manual deletion after an interrupted collector. Only a well-formed
// lease owned by a demonstrably dead PID is removed. Live, same-process, malformed, unreadable, or racing
// leases remain fail-closed. The run-level lease still prevents two healthy collectors from starting together.
export function acquireStageLease(lease, { pid = process.pid, now = new Date().toISOString(), isAlive = processIsAlive } = {}) {
  const payload = `${pid} ${now}`;
  try { writeFileSync(lease, payload, { flag: 'wx' }); return { recoveredStale: false }; }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    let priorText;
    try { priorText = readFileSync(lease, 'utf8'); } catch { throw new StageLeaseBusyError('stage lease exists but cannot be verified'); }
    const prior = parseStageLease(priorText);
    if (!prior) throw new StageLeaseBusyError('stage lease exists with malformed ownership');
    if (prior.pid === pid || isAlive(prior.pid)) throw new StageLeaseBusyError(`stage lease is active (pid ${prior.pid})`);
    // Re-read before unlinking so a replacement lease cannot be mistaken for the dead owner's bytes.
    let currentText;
    try { currentText = readFileSync(lease, 'utf8'); } catch { throw new StageLeaseBusyError('stage lease changed during stale recovery'); }
    if (currentText !== priorText) throw new StageLeaseBusyError('stage lease changed during stale recovery');
    try { unlinkSync(lease); } catch { throw new StageLeaseBusyError('stale stage lease could not be removed'); }
    try { writeFileSync(lease, payload, { flag: 'wx' }); return { recoveredStale: true, priorPid: prior.pid }; }
    catch (writeErr) { throw new StageLeaseBusyError(`stage lease was claimed during stale recovery (${writeErr.code || 'error'})`); }
  }
}

// ---- item 2: canonical scheduling priority + rotation ----
const normQ = (id) => { const m = String(id).match(/Q\d+/i); return m ? m[0].toUpperCase() : String(id); };
export function buildPriorityQueue(pool, daily, { today, windowOnly = true }) {
  const poolIds = new Set(pool.map(p => p.id));
  const byQ = new Map(); for (const p of pool) byQ.set(normQ(p.id), p.id);
  const resolve = (id) => poolIds.has(id) ? id : (byQ.get(normQ(id)) || null);
  const meta = new Map(pool.map(p => [p.id, p]));
  const dates = Object.keys(daily.byDate || {}).sort();
  const dayIds = (from, to) => { const out = []; for (const d of dates) if (d >= from && d < to) for (const tier of ['easy', 'medium', 'hard', 'impossible']) for (const raw of (daily.byDate[d][tier] || [])) { const r = resolve(raw); if (r) out.push(r); } return out; };
  const plus = (n) => { const dt = new Date(`${today}T00:00:00Z`); dt.setUTCDate(dt.getUTCDate() + n); return dt.toISOString().slice(0, 10); };
  const tierIds = (t) => (daily[t] || []).map(resolve).filter(Boolean);
  const fameQuintile = (ids) => { const withFame = ids.map(id => ({ id, fame: meta.get(id)?.fame ?? 0 })).sort((a, b) => b.fame - a.fame); const cut = Math.ceil(withFame.length / 5); return new Set(withFame.slice(0, cut).map(x => x.id)); };
  const medium = tierIds('medium'), hard = tierIds('hard'), impossible = tierIds('impossible');
  const topFame = new Set([medium, hard, impossible].flatMap(ids => [...fameQuintile(ids)]));
  // rotation within a band: round-robin across region|src|medium buckets so coverage isn't host/region-concentrated.
  const rotate = (ids) => {
    const seen = new Set(); const buckets = new Map(); const order = [];
    for (const id of ids) { if (seen.has(id) || !meta.has(id)) continue; seen.add(id); const p = meta.get(id); const host = (() => { try { return new URL(p.img).hostname; } catch { return p.src || '?'; } })(); const k = `${p.region || p.place || '?'}|${host}|${p.medium || '?'}`; if (!buckets.has(k)) { buckets.set(k, []); order.push(k); } buckets.get(k).push(id); }
    const out = []; let live = true; while (live) { live = false; for (const k of order) { const b = buckets.get(k); if (b.length) { out.push(b.shift()); live = true; } } } return out;
  };
  // Date first; rotation is only a tie-breaker within one daily date. Never pull a later day forward.
  const scheduled = dates.filter(d => d >= today && d < plus(30)).flatMap(d => rotate(dayIds(d, plusDay(d, 1))));
  if (windowOnly) return [...new Set(scheduled)];
  const bands = [
    scheduled,                                               // bands 1–2, strictly date-first
    tierIds('easy'),                                          // 3: Easy tier (missing/stale filtered later by done)
    [...medium, ...hard, ...impossible].filter(id => topFame.has(id)), // 4: highest-fame quintile of M/H/I
    medium, hard, impossible,                                 // 5,6,7: remaining Medium / Hard / Impossible
    pool.map(p => p.id),                                      // 8: any remaining corpus work (fallback) — fame order
  ];
  const placed = new Set(); const queue = [];
  bands.forEach((band, i) => { const rb = i === 0 ? band : i === 6 ? band.filter(id => !placed.has(id)).sort((a, b) => (meta.get(b)?.fame ?? 0) - (meta.get(a)?.fame ?? 0)) : rotate(band); for (const id of rb) if (!placed.has(id)) { placed.add(id); queue.push(id); } });
  return queue;
}

// ---- item 5: pure failure classifier ----
export function classifySpawn({ usageLimit, apiKeySource, model, expectedModel, exitCode, final, isError, subtype, structuredOutputPresent, imageReceipt, webEvents }) {
  if (usageLimit) return { kind: 'usage-limit' };
  if (apiKeySource !== 'none') return { kind: 'fatal', reason: `apiKeySource must be none, got ${apiKeySource}` };
  if (imageReceipt && Array.isArray(imageReceipt.bad) && imageReceipt.bad.length) return { kind: 'fatal', reason: `confinement violation: ${imageReceipt.bad.join(',')}` };
  if (exitCode !== 0 || !final) return { kind: 'retryable', reason: `process failed (exit ${exitCode})` };
  if (isError === true || (subtype && subtype !== 'success')) return { kind: 'retryable', reason: `stage errored (subtype=${subtype})` };
  if (!model) return { kind: 'fatal', reason: 'no resolved model — cannot confirm identity' };
  if (model !== expectedModel) return { kind: 'fatal', reason: `model drift: ${model} != ${expectedModel}` };
  if (!structuredOutputPresent) return { kind: 'retryable', reason: 'no structured_output' };
  if (imageReceipt && !imageReceipt.ok) return { kind: 'retryable', reason: `image receipt: ${imageReceipt.reason}` };
  if (webEvents && !webEvents.ok) return { kind: 'retryable', reason: webEvents.reason };
  return { kind: 'ok' };
}

// ---- item 4: monotonic exclusive attempt filename ----
export function attemptFilename(stage, seq, stdout) { return `${stage.toLowerCase()}-${String(seq).padStart(6, '0')}-${sha256(String(stdout)).slice(0, 8)}.transcript.jsonl`; }

// ---- reconstruct the exact effective prompt (for promptHash verification on reuse/migration) ----
export function effectivePromptFor(stage, { id, catalog, legacy, imageFile, b1body, b2body, b3body }) {
  const legacyInput = legacyContentInput(legacy);
  if (stage === 'B1') return `${prompts.B1}\n\nThe working directory contains exactly one image file: ./${imageFile}\nCall the Read tool on ./${imageFile} to view the artwork, then inventory ONLY what you actually see. If Read fails or returns no image, set imageFitness.ok=false and do not invent content.`;
  if (stage === 'B2') return `${prompts.B2}\n\nCATALOG+SIGNALS:\n${JSON.stringify(b2InputFor(id, catalog, b1body))}\n\nEXISTING CONTENT:\n${JSON.stringify(legacyInput)}`;
  if (stage === 'B3') return `${prompts.B3}\n\nThe working directory contains exactly one image file: ./${imageFile}\nCall the Read tool on ./${imageFile}, then answer ONLY these targeted requests.\n\nLOCATE:\n${JSON.stringify(b3Plan(b2body).requests)}`;
  return null;
}

// Read-only inspection is shared by planning, repair, and resume. Never call the mutating stale loader here.
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const files = path => existsSync(path) ? readdirSync(path) : [];
export function pacificClock(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map(p => [p.type, p.value]));
  const seconds = Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, seconds, mayStart: seconds < 8.5 * 3600,
    remainingMs: Math.max(0, (9 * 3600 - seconds) * 1000 - now.getMilliseconds()) };
}
const plusDay = (day, n) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
class SchedulePauseError extends Error {}
class BudgetStopError extends Error {}
// Lanes (VSD-047): 'local' = the Mac's subscription run for the rolling 30-day window, gated to 00:00–08:30
// Pacific (VSD-045). 'cloud' = a Claude Code cloud session spending its separate cloud credits on works BEYOND
// the window; the hours rule protects the subscription and does not apply there, a dollar cap does instead.
export const LANE = process.env.PASS_B_CORPUS_LANE === 'cloud' ? 'cloud' : 'local';
export const CLOUD_BUDGET_USD = Number(process.env.PASS_B_CLOUD_BUDGET_USD || 240);
let SPENT_USD = 0; // cloud lane: client-reported list-price cost of every attempt in this run dir (baseline + session)
export function laneWindow(lane = LANE, now = new Date()) {
  if (lane === 'cloud') {
    if (SPENT_USD >= CLOUD_BUDGET_USD) throw new BudgetStopError(`budget-cap: $${SPENT_USD.toFixed(2)} of $${CLOUD_BUDGET_USD} spent`);
    return { timeout: 30 * 60 * 1000, killSignal: 'SIGKILL' };
  }
  return callWindow(now);
}
export function transcriptCostUsd(text) { const f = transcriptFinal(parseStreamTranscript(text)); const c = Number(f?.total_cost_usd); return Number.isFinite(c) && c > 0 ? c : 0; }
export function runSpendUsd(runDir) {
  let total = 0;
  for (const w of files(join(runDir, 'works'))) for (const f of files(join(runDir, 'works', w, 'attempts'))) if (f.endsWith('.transcript.jsonl')) total += transcriptCostUsd(readFileSync(join(runDir, 'works', w, 'attempts', f), 'utf8'));
  return total;
}
export function setSpentUsd(v) { SPENT_USD = v; }
export function callWindow(now = new Date()) {
  const clock = pacificClock(now);
  if (!clock.mayStart) throw new SchedulePauseError('protected-hours: starts allowed only 00:00–08:30 America/Los_Angeles');
  return { timeout: Math.min(30 * 60 * 1000, clock.remainingMs), killSignal: 'SIGKILL' };
}
export function readLedger(runDir = RUN_DIR) {
  const path = join(runDir, 'ledger.json');
  if (!existsSync(path)) return { version: 'passBCorpusLedger/2', runId: RUN_ID, heldIds: [], heldReasons: {}, attemptSeq: 0, transportRetries: 0, validationRetries: 0 };
  const ledger = readJson(path); // Unreadable history is a failure, never an empty ledger.
  if (ledger.runId !== RUN_ID || !Array.isArray(ledger.heldIds)) throw new Error('ledger binding/shape mismatch');
  return ledger;
}
export function preservedFatal(runDir, ledger = readLedger(runDir)) {
  const path = join(runDir, 'fatal.json');
  if (existsSync(path)) {
    const f = readJson(path);
    if (f.runId !== RUN_ID || typeof f.reason !== 'string') throw new Error('fatal record binding mismatch');
    return f.reason;
  }
  return typeof ledger.stopReason === 'string' && ledger.stopReason.startsWith('fatal:') ? ledger.stopReason.slice(6) : null;
}
export function persistFatal(runDir, reason) {
  const path = join(runDir, 'fatal.json');
  if (!existsSync(path)) writeFileSync(path, `${JSON.stringify({ runId: RUN_ID, reason, recordedAt: new Date().toISOString() })}\n`, { flag: 'wx', mode: 0o600, flush: true });
}
export function inspectWork({ runDir, id, catalog, legacy, priorDir = join(RUN_ROOT, PRIOR_RUN) }) {
  const workDir = join(runDir, 'works', sha256(id).slice(0, 24));
  const bodies = {}, repairs = [], terminalReasons = [], completionTranscripts = new Set();
  const b0Path = join(workDir, 'b0-prep.json');
  if (!existsSync(b0Path)) {
    if (files(join(workDir, 'completions')).length || files(join(workDir, 'attempts')).length) throw new Error(`${id}: evidence without B0`);
    return { id, bodies, repairs, done: false, attempts: 0, maxSeq: 0, terminalReasons };
  }
  const b0 = readJson(b0Path);
  if (b0.work?.id !== id || stableJson(b0.trustedCatalog) !== stableJson(catalog) || stableJson(b0.legacy) !== stableJson(legacy)) throw new Error(`${id}: B0 input drift; preserve and review before any rerun`);
  const imageFile = neutralImageFile(b0.image?.imgSha256, b0.image?.ext);
  if (!derivativeMatches(join(runDir, 'imgs', imageFile), b0.image.imgSha256)) throw new Error(`${id}: image hash mismatch`);
  const attemptsDir = join(workDir, 'attempts');
  const contexts = stage => stage === 'B2' ? { evidenceIds: b2InputFor(id, catalog, bodies.B1).visibleSignals.map(s => s.evidenceId) }
    : stage === 'B3' ? { requestIds: b3Plan(bodies.B2).requestIds } : {};
  for (const stage of ['B1', 'B2', 'B3']) {
    const name = `${stage.toLowerCase()}-${completionKey(stage, id)}.json`;
    const found = files(join(workDir, 'completions')).filter(f => f.startsWith(`${stage.toLowerCase()}-`));
    if (!found.length) continue;
    if (found.length !== 1 || found[0] !== name) throw new Error(`${id}: ambiguous ${stage} completion`);
    const path = join(workDir, 'completions', name), c = readJson(path);
    if (c.stage !== stage) throw new Error(`${id}: completion stage mismatch`);
    const promptHash = sha256(effectivePromptFor(stage, { id, catalog, legacy, imageFile, b1body: bodies.B1, b2body: bodies.B2 }));
    const v = validateStageCompletion(c, { ...contexts(stage), trusted: { workId: id, imgSha256: b0.image.imgSha256, promptHash, brokerPolicyVersion: BROKER_POLICY_VERSION, imageTransportVersion: IMAGE_TRANSPORT_VERSION }, producer: producerEvidence(stage, { runtimeVersion: c.producer?.runtimeVersion }) });
    if (!v.ok) throw new Error(`${id}: invalid ${stage} completion: ${v.errors.join(',')}`);
    const rawTarget = join(workDir, 'raw', `${c.rawResponseSha256}.json`);
    let rawPath = rawTarget;
    if (!existsSync(rawPath)) {
      const oldW = join(priorDir, 'works', sha256(id).slice(0, 24));
      const oldC = join(oldW, 'completions', name);
      rawPath = join(oldW, 'raw', `${c.rawResponseSha256}.json`);
      if (!existsSync(oldC) || rawFileSha(oldC) !== rawFileSha(path) || !existsSync(rawPath)) throw new Error(`${id}: missing raw without identical migration source`);
      repairs.push({ source: rawPath, target: rawTarget, sha256: c.rawResponseSha256 });
    }
    const raw = readFileSync(rawPath, 'utf8');
    if (sha256(raw) !== c.rawResponseSha256 || stableJson(JSON.parse(raw)) !== stableJson(c.body)) throw new Error(`${id}: raw/body mismatch`);
    const ev = verifyStageEvidence({ stage, workRunDir: workDir, completion: c, imageBasename: imageFile });
    if (!ev.ok) throw new Error(`${id}: ${stage} evidence: ${ev.errors.join(',')}`);
    const tr = parseStreamTranscript(findTranscriptBySha(workDir, stage, c.transcriptSha256).bytes);
    if (stableJson(transcriptFinal(tr)?.structured_output) !== stableJson(c.body)) throw new Error(`${id}: transcript/body mismatch`);
    completionTranscripts.add(c.transcriptSha256);
    bodies[stage] = c.body;
  }
  let attempts = 0, maxSeq = 0, fatal = null, pause = null, b2ValidationFailures = 0, b2LastInterrupted = false;
  const epochs = executionEpochs(runDir), activeEpoch = epochs.at(-1), reserved = new Map(), incompleteTranscripts = new Set();
  // Resolve every receipt against its own immutable epoch, never against today's runtime policy.
  for (const name of files(attemptsDir).filter(n => n.endsWith('.reserved.json'))) {
    const r = readJson(join(attemptsDir, name));
    if (r.runId !== RUN_ID || r.workId !== id || !['B1','B2','B3'].includes(r.stage) ||
        !Number.isSafeInteger(r.seq) || r.seq < 1 || name !== `${r.stage.toLowerCase()}-${String(r.seq).padStart(6, '0')}.reserved.json`) throw new Error(`${id}: reservation binding mismatch`);
    maxSeq = Math.max(maxSeq, r.seq);
    const epoch = epochs.find(e => e.number === (r.executionEpoch ?? 0));
    if (!epoch || sha256(stableJson(epoch.policy)) !== r.executionPolicySha256 ||
        (r.executionEpoch != null && epoch.sha256 !== r.executionEpochSha256)) throw new Error(`${id}: execution policy binding mismatch`);
    const stem = name.slice(0, -'.reserved.json'.length), metaPath = join(attemptsDir, `${stem}.meta.json`);
    if (!existsSync(metaPath)) {
      const preserved = files(attemptsDir).filter(n => n.startsWith(`${stem}-`) && n.endsWith('.transcript.jsonl'));
      if (!preserved.length) attempts++;
      for (const transcript of preserved) incompleteTranscripts.add(transcript);
      pause ||= `${id}/${r.stage}: unknown-outcome (incomplete reserved attempt)`; continue;
    }
    const m = readJson(metaPath);
    if (m.seq !== r.seq || m.workId !== id || m.stage !== r.stage || !m.transcriptFile?.startsWith(`${stem}-`) ||
        !/^b[123]-[\w-]+\.transcript\.jsonl$/.test(m.transcriptFile) ||
        !derivativeMatches(join(attemptsDir, m.transcriptFile), m.transcriptSha256)) throw new Error(`${id}: reserved attempt metadata/evidence mismatch`);
    reserved.set(m.transcriptFile, { meta: m, epoch });
  }
  const cliVersions = new Set();
  for (const name of files(attemptsDir).filter(n => n.endsWith('.transcript.jsonl')).sort()) {
    attempts++;
    const stage = name.slice(0, 2).toUpperCase();
    const seq = /^b[123]-(\d{6})-/.exec(name); if (seq) maxSeq = Math.max(maxSeq, Number(seq[1]));
    const text = readFileSync(join(attemptsDir, name), 'utf8');
    const tr = parseStreamTranscript(text), final = transcriptFinal(tr);
    const binding = reserved.get(name), meta = binding?.meta;
    if (tr.init?.claudeCodeVersion) cliVersions.add(tr.init.claudeCodeVersion);
    const usage = isUsageTranscript(text, final);
    if (stage === 'B2') b2LastInterrupted = usage;
    const model = usage ? tr.init?.model : primaryModelFromEnvelope(final);
    const inits = initEvents(text);
    // A failed process with no initialization is an operational interruption, not evidence of API use.
    const operational = meta?.kind === 'operational-pause' && meta.exitCode !== 0;
    const deadline = meta?.kind === 'deadline-pause' && meta.exitCode === 'deadline';
    if ((!inits.length && !operational && !deadline && !incompleteTranscripts.has(name)) || inits.some(e => e.apiKeySource !== 'none') ||
        (binding ? inits.some(e => e.model !== CALIBRATION_MODEL) : (model && model !== CALIBRATION_MODEL))) fatal ||= `${id}/${stage}: preserved provenance failure`;
    if (!usage && final && model && model !== CALIBRATION_MODEL) fatal ||= `${id}/${stage}: preserved model drift`;
    const receipt = ['B1', 'B3'].includes(stage) ? verifyB1ImageRead(tr, { callDir: null, imageBasename: imageFile }) : null;
    if (receipt?.bad?.length) fatal ||= `${id}/${stage}: preserved confinement violation`;
    if (meta?.kind === 'fatal') fatal ||= `${id}/${stage}: ${meta.reason}`;
    if (operational) { pause ||= `${id}/${stage}: operational-pause (review incomplete outcome)`; continue; }
    if (binding && inits.some(e => e.claude_code_version !== binding.epoch.policy.runtimeVersion)) {
      if (binding.epoch.number === activeEpoch.number) pause ||= `${id}/${stage}: runtime drift; reviewed rebind required`;
      // A reviewed successor allows a fresh call, never capture/promotion of the drifted output.
      if (completionTranscripts.has(sha256(text))) throw new Error(`${id}/${stage}: completion captured from runtime-drift attempt`);
      if (stage === 'B2') b2LastInterrupted = true;
      continue;
    }
    if (deadline) { if (stage === 'B2') b2LastInterrupted = true; continue; }
    if (meta?.kind === 'held') terminalReasons.push(`${stage}:${meta.reason}`);
    if (bodies[stage] || usage) continue;
    if (!final || final.is_error || final.structured_output == null) { terminalReasons.push(`${stage}:unknown-or-failed-attempt`); continue; }
    const v = validateStageBody(stage, final.structured_output, contexts(stage));
    if (stage === 'B2' && !v.ok) b2ValidationFailures++;
    terminalReasons.push(v.ok ? `${stage}:uncaptured-result` : `${stage}:invalid body: ${v.errors.join(',')}`);
  }
  // One rejected B2 body has one conformance retry left. A usage rejection did not execute it.
  // Preserve that narrow pending retry, without resurrecting unrelated/unknown historical holds.
  const pendingB2Retry = b2ValidationFailures === 1 && b2LastInterrupted && !bodies.B2 &&
    terminalReasons.every(r => r.startsWith('B2:invalid body:'));
  if (pendingB2Retry) terminalReasons.length = 0;
  const done = !!bodies.B1 && (!b2Plan(bodies.B1, legacy).run || (!!bodies.B2 && (!b3Plan(bodies.B2).run || !!bodies.B3)));
  return { id, bodies, repairs, done, attempts, maxSeq, fatal, pause, pendingB2Retry, b2ValidationFailures,
    terminalReasons: done ? [] : [...new Set(terminalReasons)], cliVersions: [...cliVersions] };
}
export function inspectCorpus({ runDir = RUN_DIR, pool, legacyOf, ledger = readLedger(runDir), priorDir }) {
  const rows = [], repairs = [], heldReasons = { ...ledger.heldReasons };
  const heldSet = new Set(ledger.heldIds), doneSet = new Set();
  let fatal = preservedFatal(runDir, ledger), pause = null, attempts = 0, maxSeq = ledger.attemptSeq || 0;
  const totals = { b1Complete: 0, b2Complete: 0, b3Complete: 0 };
  const knownDirs = new Set(pool.map(p => sha256(p.id).slice(0, 24)));
  if (files(join(runDir, 'works')).some(d => !knownDirs.has(d))) throw new Error('unrecognized work history; fail closed before scheduling');
  for (const p of pool) {
    const workDir = join(runDir, 'works', sha256(p.id).slice(0, 24));
    if (!existsSync(workDir)) continue;
    const row = inspectWork({ runDir, id: p.id, catalog: trustedCatalog(p), legacy: legacyOf(p.id), priorDir });
    rows.push(row); repairs.push(...row.repairs); fatal ||= row.fatal; pause ||= row.pause;
    attempts += row.attempts; maxSeq = Math.max(maxSeq, row.maxSeq);
    for (const stage of ['B1', 'B2', 'B3']) if (row.bodies[stage]) totals[`${stage.toLowerCase()}Complete`]++;
    if (row.done) doneSet.add(p.id);
    else if (row.terminalReasons.length) { heldSet.add(p.id); heldReasons[p.id] = `evidence:${row.terminalReasons.join('; ')}`; }
    else if (row.pendingB2Retry && /^evidence:B2:invalid body:/.test(heldReasons[p.id] || '')) { heldSet.delete(p.id); delete heldReasons[p.id]; }
    else if (heldToRequeue([p.id], heldReasons).length) { heldSet.delete(p.id); delete heldReasons[p.id]; }
  }
  return { rows, repairs, heldSet, heldReasons, doneSet, fatal, pause, attempts, maxSeq: Math.max(maxSeq, attempts), totals };
}
export function applyHistoryRepair({ runDir = RUN_DIR, inspection, ledger = readLedger(runDir), eligibleCount, now = () => new Date() }) {
  for (const r of inspection.repairs) {
    if (!derivativeMatches(r.source, r.sha256)) throw new Error('migration source changed');
    if (existsSync(r.target)) { if (!derivativeMatches(r.target, r.sha256)) throw new Error('migration target differs; preserved'); continue; }
    mkdirSync(dirname(r.target), { recursive: true, mode: 0o700 });
    writeFileSync(r.target, readFileSync(r.source), { flag: 'wx', mode: 0o600, flush: true });
  }
  if (inspection.fatal) persistFatal(runDir, inspection.fatal);
  const repaired = { ...ledger, collectorVersion: COLLECTOR_VERSION, heldIds: [...inspection.heldSet], heldReasons: inspection.heldReasons,
    doneIds: [...inspection.doneSet], attemptSeq: inspection.maxSeq,
    totals: { ...ledger.totals, queued: eligibleCount, done: inspection.doneSet.size, held: inspection.heldSet.size,
      remaining: Math.max(0, eligibleCount - new Set([...inspection.doneSet, ...inspection.heldSet]).size), ...inspection.totals, attempts: inspection.attempts },
    stopReason: inspection.fatal ? `fatal:${inspection.fatal}` : inspection.pause ? `paused:${inspection.pause}` : (ledger.stopReason ?? null),
  };
  if (stableJson(ledger) !== stableJson(repaired)) {
    repaired.updatedAt = now().toISOString();
    atomicWrite(join(runDir, 'ledger.json'), `${JSON.stringify(repaired, null, 1)}\n`);
  }
  return repaired;
}
function isUsageTranscript(text, final) {
  return String(text).split('\n').some(l => { try { const e = JSON.parse(l); return e.type === 'rate_limit_event' && e.rate_limit_info?.status === 'rejected'; } catch { return false; } })
    || final?.api_error_status === 429 || (final?.is_error === true && USAGE_MARKER.test(String(final?.result || '')));
}
function initEvents(text) {
  return String(text).split('\n').flatMap(l => { try { const e = JSON.parse(l); return e.type === 'system' && e.subtype === 'init' ? [e] : []; } catch { return []; } });
}
let CLAUDE_BIN = null; // exact versioned binary resolved at session start (a mid-run update cannot swap it)
let STOP = false, FATAL = null, STOP_REASON = null, ATTEMPT_SEQ = 0, TRANSPORT_RETRIES = 0, RUNTIME_VERSION = null;
const markFatal = reason => { FATAL ||= reason; persistFatal(RUN_DIR, FATAL); };
// Only a classified boundary failure may create fatal.json. Filesystem, lease and runtime problems
// cannot become permanent provenance findings merely because they surfaced outside runWorkStages.
export function stopForException(error, { fatal, pause }) {
  if (error instanceof FatalError) fatal(error.message);
  else if (error instanceof UsageLimitError) pause('usage-limit');
  else if (error instanceof SchedulePauseError) pause('protected-hours');
  else if (error instanceof BudgetStopError) pause('budget-cap');
  else if (!(error instanceof StageLeaseBusyError || error instanceof RetryableError || error instanceof TerminalAttemptError)) pause(`operational:${error.message}`);
}

// Injectable executor for offline regression tests. No test needs the real Claude binary.
export async function executeCorpusAttempt({ runDir, workRunDir, id, imgSha256, ext, stage, command, imageFile,
  seq, runtimeVersion, execute = execFileP, now = () => new Date(), lane = LANE }) {
  const priorFatal = preservedFatal(runDir);
  if (priorFatal) throw new FatalError(`preserved fatal: ${priorFatal}`);
  laneWindow(lane, now());
  const epoch = bindExecutionPolicy(runDir, runtimeVersion);
  const attemptsDir = join(workRunDir, 'attempts'); mkdirSync(attemptsDir, { recursive: true, mode: 0o700 });
  const lease = join(workRunDir, `${stage}.lease`);
  acquireStageLease(lease);
  let call;
  try {
    call = mkdtempSync(join(tmpdir(), 'corpus-'));
    if (imageFile) copyFileSync(join(runDir, 'imgs', `${imgSha256}.${ext}`), join(call, imageFile));
    const env = { ...process.env, DISABLE_AUTOUPDATER: '1' }; for (const k of command.env.removeKeys) delete env[k];
    const options = laneWindow(lane, now()); // immediately before reservation + invocation, including every retry
    const stem = `${stage.toLowerCase()}-${String(seq).padStart(6, '0')}`;
    writeFileSync(join(attemptsDir, `${stem}.reserved.json`), `${JSON.stringify({ runId: RUN_ID, workId: id, stage, seq,
      promptHash: sha256(command.argv[1]), executionPolicySha256: sha256(stableJson(epoch.policy)),
      executionEpoch: epoch.number, executionEpochSha256: epoch.sha256 })}\n`, { flag: 'wx', mode: 0o600, flush: true });
    let stdout = '', exitCode = 0;
    try { ({ stdout } = await execute(CLAUDE_BIN || command.bin, command.argv, { cwd: call, env, maxBuffer: 64 * 1024 * 1024, ...options })); }
    catch (e) {
      exitCode = e.killed && e.signal === 'SIGKILL' ? (pacificClock(now()).seconds >= 9 * 3600 ? 'deadline' : 'timeout') : (e.code ?? 1);
      stdout = e.stdout || '';
    }
    const transcriptFile = attemptFilename(stage, seq, stdout);
    writeFileSync(join(attemptsDir, transcriptFile), stdout, { flag: 'wx', mode: 0o600, flush: true });
    SPENT_USD += transcriptCostUsd(stdout);
    const tr = parseStreamTranscript(stdout), final = transcriptFinal(tr);
    const inits = initEvents(stdout);
    const imageReceipt = ['B1', 'B3'].includes(stage) ? verifyB1ImageRead(tr, { callDir: call, imageBasename: imageFile }) : null;
    const webEvents = stage === 'B2' ? verifyB2WebEvents(tr) : null;
    let cls = classifySpawn({ usageLimit: isUsageTranscript(stdout, final), apiKeySource: tr.init?.apiKeySource,
      model: primaryModelFromEnvelope(final), expectedModel: CALIBRATION_MODEL, exitCode, final, isError: final?.is_error,
      subtype: final?.subtype, structuredOutputPresent: final?.structured_output != null, imageReceipt, webEvents });
    if (!inits.length && exitCode === 'deadline') cls = { kind: 'deadline-pause', reason: '09:00 deadline termination' };
    else if (!inits.length && exitCode !== 0) cls = { kind: 'operational-pause', reason: 'process failed before provenance could be verified; review incomplete outcome' };
    else if (!inits.length || inits.some(e => e.apiKeySource !== 'none')) cls = { kind: 'fatal', reason: 'every init must report apiKeySource:none' };
    else if (inits.some(e => e.model !== CALIBRATION_MODEL)) cls = { kind: 'fatal', reason: 'model drift in init' };
    else if (imageReceipt?.bad?.length) cls = { kind: 'fatal', reason: 'confinement violation' };
    else if (cls.kind !== 'fatal' && inits.some(e => e.claude_code_version !== runtimeVersion)) cls = { kind: 'runtime-pause', reason: 'CLI runtime version drift/missing; reviewed rebind required' };
    else if (exitCode === 'deadline' && cls.kind !== 'fatal') cls = { kind: 'deadline-pause', reason: '09:00 deadline termination' };
    else if (exitCode === 'timeout' && cls.kind !== 'fatal') cls = { kind: 'held', reason: 'process-timeout; never retry automatically' };
    writeFileSync(join(attemptsDir, `${stem}.meta.json`), `${JSON.stringify({ workId: id, stage, seq, exitCode, ...cls, transcriptFile, transcriptSha256: sha256(stdout) })}\n`, { flag: 'wx', mode: 0o600, flush: true });
    if (cls.kind === 'fatal') { persistFatal(runDir, `${id}/${stage}: ${cls.reason}`); throw new FatalError(cls.reason); }
    if (cls.kind === 'runtime-pause') throw new RuntimePauseError(cls.reason);
    if (cls.kind === 'operational-pause') throw new OperationalPauseError(cls.reason);
    if (cls.kind === 'deadline-pause') throw new SchedulePauseError(cls.reason);
    if (cls.kind === 'usage-limit') throw new UsageLimitError('subscription usage limit');
    if (cls.kind === 'retryable') throw new RetryableError(cls.reason);
    if (cls.kind === 'held') throw new TerminalAttemptError(cls.reason);
    return { raw: JSON.stringify(final.structured_output), transcriptSha256: sha256(stdout) };
  } finally { if (call) rmSync(call, { recursive: true, force: true }); unlinkSync(lease); }
}
function makeSpawnStage(workRunDir, imgSha256, ext, id) {
  const once = async (stage, { command, imageFile }) => {
    if (FATAL) throw new FatalError(FATAL);
    if (STOP) throw new SchedulePauseError('run paused');
    try {
      laneWindow();
      if (stage === 'B2') {
        const b0 = readJson(join(workRunDir, 'b0-prep.json'));
        enforceValidationBudget(inspectWork({ runDir: RUN_DIR, id, catalog: b0.trustedCatalog, legacy: b0.legacy }));
      }
      return await executeCorpusAttempt({ runDir: RUN_DIR, workRunDir, id, imgSha256, ext, stage, command, imageFile,
        seq: ++ATTEMPT_SEQ, runtimeVersion: RUNTIME_VERSION });
    } catch (e) {
      stopForException(e, { fatal: reason => markFatal(`${id}/${stage}: ${reason}`), pause: reason => { STOP = true; STOP_REASON ||= reason; } });
      if (e instanceof StageLeaseBusyError) throw new StageLeaseBusyError(`stage ${stage} leased by another collector: ${e.message}`);
      throw e;
    }
  };
  return (stage, options) => retryTransportOnce(() => once(stage, options), () => { TRANSPORT_RETRIES++; });
}
export function enforceValidationBudget(inspection) {
  if (inspection.b2ValidationFailures >= 2) throw new TerminalAttemptError('B2 validation retry already consumed; terminal hold');
}
export async function retryTransportOnce(invoke, onRetry = () => {}) {
  try { return await invoke(); }
  catch (e) {
    if (!(e instanceof RetryableError)) throw e;
    onRetry();
    return invoke(); // same pre-call fatal/stop/time checks apply to the one transport retry
  }
}

const makeCapture = (workRunDir) => async ({ stage, rawResponse, trusted, producer, context }) => {
  const cap = captureStageCompletion({ runDir: workRunDir, stage, rawResponse, trusted, producer, createdAt: new Date().toISOString(), context });
  const v = verifyCapturedStage({ completionPath: cap.completionPath, runDir: workRunDir, trusted, producer, context });
  if (!v.ok) throw new Error(v.errors.join(','));
  return cap;
};
// ---- item 7: rehash-before-reuse image prep + b0-prep re-verification ----
async function prepImage(id, imgUrl, catalog, legacy, imageIndex) {
  const b0Path = join(wdirOf(id), 'b0-prep.json');
  const verifyB0 = (prep) => existsSync(join(IMGS_DIR, `${prep.imgSha256}.${prep.ext}`)) && rawFileSha(join(IMGS_DIR, `${prep.imgSha256}.${prep.ext}`)) === prep.imgSha256;
  if (existsSync(b0Path)) { // reopen + verify, never trust by existence
    try { const b0 = JSON.parse(readFileSync(b0Path, 'utf8'));
      if (b0.image?.ok && verifyB0(b0.image) && stableJson(b0.trustedCatalog) === stableJson(catalog) && stableJson(b0.legacy) === stableJson(legacy)) return b0.image;
    } catch { /* re-fetch below */ }
  }
  if (imageIndex[id]?.ok && verifyB0(imageIndex[id])) return imageIndex[id];
  for (const d of readdirSync(RUN_ROOT).filter(x => /^imgs-|^corpus-b3-/.test(x))) { // reuse a prior verified derivative
    const idxP = join(RUN_ROOT, d, d.startsWith('imgs-') ? 'image-index.json' : 'imgs/image-index.json'); if (!existsSync(idxP)) continue;
    let idx; try { idx = JSON.parse(readFileSync(idxP, 'utf8')); } catch { continue; }
    const e = idx[id]; if (!e?.ok) continue;
    const src = join(RUN_ROOT, d, d.startsWith('imgs-') ? '' : 'imgs', `${e.imgSha256}.${e.ext}`);
    if (existsSync(src) && rawFileSha(src) === e.imgSha256) { const dst = join(IMGS_DIR, `${e.imgSha256}.${e.ext}`); if (!existsSync(dst)) copyFileSync(src, dst); imageIndex[id] = { id, ok: true, imgSha256: e.imgSha256, ext: e.ext, reusedFrom: d }; atomicWrite(IMAGE_INDEX, `${JSON.stringify(imageIndex, null, 1)}\n`); return imageIndex[id]; }
  }
  await new Promise(r => setTimeout(r, 500));
  const f = await broker.fetchImageToModelFile(imgUrl, IMGS_DIR, { userAgent: BROWSER, referer: true });
  const prep = f.ok ? { id, ok: true, imgSha256: f.sha256, ext: f.ext, width: f.width, height: f.height, mime: f.mime, bytes: f.bytes } : { id, ok: false, reason: `${f.reason || 'fetch-failed'}${f.host ? ' @' + f.host : ''}` };
  if (prep.ok) { imageIndex[id] = prep; atomicWrite(IMAGE_INDEX, `${JSON.stringify(imageIndex, null, 1)}\n`); }
  return prep;
}

export function executionPolicy(runtimeVersion) {
  if (!/^\d+\.\d+\.\d+$/.test(runtimeVersion || '')) throw new Error('explicit Claude Code version required');
  return { version: COLLECTOR_VERSION, evidenceRunId: RUN_ID, runtimeVersion, model: CALIBRATION_MODEL,
    promptHashes: PROMPT_HASHES_B0B3, validation: VALIDATION_CONTRACT_VERSION,
    ...(LANE === 'cloud'
      ? { scope: 'cloud-credit-beyond-window-through-b3', startWindow: 'none (cloud credits, VSD-047)', finishBy: 'none', lane: 'cloud' }
      : { scope: 'rolling-30-days-through-b3', timeZone: 'America/Los_Angeles', startWindow: '00:00–08:30', finishBy: '09:00' }),
    maxCallMs: 30 * 60 * 1000,
    childEnv: { DISABLE_AUTOUPDATER: '1' } };
}
// Append-only local policy history, not signatures. The highest contiguous verified epoch is active.
// Old /3 execution-policy.json, if present, remains untouched as epoch zero.
export function executionEpochs(runDir) {
  const epochs = [], legacyPath = join(runDir, 'execution-policy.json');
  const add = epoch => {
    if (epoch.runId !== RUN_ID || epoch.policy?.evidenceRunId !== RUN_ID ||
        epoch.previousSha256 !== (epochs.at(-1)?.sha256 || null)) throw new Error('execution epoch binding/chain mismatch');
    epochs.push({ ...epoch, sha256: sha256(stableJson(epoch)) });
  };
  if (existsSync(legacyPath)) add({ version: 'passBCorpusExecutionEpoch/1', runId: RUN_ID, number: 0,
    previousSha256: null, policy: readJson(legacyPath), review: null });
  const dir = join(runDir, 'execution-policies'), names = files(dir).sort();
  for (let i = 0; i < names.length; i++) {
    const number = i + 1;
    if (names[i] !== `${String(number).padStart(6, '0')}.json`) throw new Error('execution epoch sequence mismatch');
    const epoch = readJson(join(dir, names[i]));
    if (epoch.version !== 'passBCorpusExecutionEpoch/1' || epoch.number !== number) throw new Error('execution epoch shape mismatch');
    add(epoch);
  }
  return epochs;
}
function appendEpoch(runDir, policy, previous, review = null) {
  const epoch = { version: 'passBCorpusExecutionEpoch/1', runId: RUN_ID, number: (previous?.number || 0) + 1,
    previousSha256: previous?.sha256 || null, policy, review };
  const dir = join(runDir, 'execution-policies'); mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, `${String(epoch.number).padStart(6, '0')}.json`), `${JSON.stringify(epoch, null, 1)}\n`, { flag: 'wx', mode: 0o600, flush: true });
  return { ...epoch, sha256: sha256(stableJson(epoch)) };
}
// Owner standing rule (VSD-046, 2026-09-25): a PATCH-level Claude Code update (same major.minor, higher patch)
// with no other policy change is accepted automatically and recorded as its own epoch. Anything else — minor or
// major upgrade, downgrade, or any non-runtime policy change — still pauses for a reviewed --rebind-runtime.
export function isPatchUpgrade(from, to) {
  const a = /^(\d+)\.(\d+)\.(\d+)$/.exec(from || ''), b = /^(\d+)\.(\d+)\.(\d+)$/.exec(to || '');
  return !!a && !!b && a[1] === b[1] && a[2] === b[2] && Number(b[3]) > Number(a[3]);
}
const runtimeFixed = p => { const { version, runtimeVersion, childEnv, ...rest } = p; return rest; };
export function bindExecutionPolicy(runDir, runtimeVersion) {
  const policy = executionPolicy(runtimeVersion), current = executionEpochs(runDir).at(-1);
  if (!current) return appendEpoch(runDir, policy);
  if (stableJson(current.policy) === stableJson(policy)) return current;
  const onlyRuntime = stableJson(runtimeFixed(current.policy)) === stableJson(runtimeFixed(policy))
    && stableJson({ ...current.policy, runtimeVersion }) === stableJson(policy);
  if (onlyRuntime && isPatchUpgrade(current.policy.runtimeVersion, runtimeVersion) && !preservedFatal(runDir)) {
    return appendEpoch(runDir, policy, current, {
      version: 'passBCorpusRuntimeReview/1', runId: RUN_ID, fromEpochSha256: current.sha256,
      toRuntimeVersion: runtimeVersion, toPolicySha256: sha256(stableJson(policy)), automatic: true,
      reviewedBy: 'automatic: owner standing rule VSD-046 (2026-09-25) accepts patch-level Claude Code updates',
      reason: `patch update ${current.policy.runtimeVersion} -> ${runtimeVersion}; no other policy change`,
      reviewedAt: new Date().toISOString(),
    });
  }
  throw new RuntimePauseError('execution policy / CLI version drift; paused pending reviewed --rebind-runtime');
}
export function rebindRuntime(runDir, review) {
  if (preservedFatal(runDir)) throw new Error('runtime rebind cannot clear a preserved fatal');
  const previous = executionEpochs(runDir).at(-1);
  if (!previous || review?.version !== 'passBCorpusRuntimeReview/1' || review.runId !== RUN_ID ||
      review.fromEpochSha256 !== previous.sha256 || !review.reviewedBy?.trim() || !review.reason?.trim() ||
      !Number.isFinite(Date.parse(review.reviewedAt))) throw new Error('explicit runtime review binding required');
  const policy = executionPolicy(review.toRuntimeVersion);
  if (review.toPolicySha256 !== sha256(stableJson(policy))) throw new Error('runtime review target policy binding mismatch');
  // A runtime rebind cannot change the banked content contract or the permitted collection scope.
  if (stableJson(runtimeFixed(previous.policy)) !== stableJson(runtimeFixed(policy))) throw new Error('runtime rebind cannot change the execution/content policy');
  if (stableJson(previous.policy) === stableJson(policy)) throw new Error('runtime rebind has no change');
  return appendEpoch(runDir, policy, previous, review);
}
async function main() {
  const args = process.argv.slice(2);
  const rebind = args[0] === '--rebind-runtime' && args.length === 2 && !args[1].startsWith('--') ? args[1] : null;
  if (!rebind && (args.length > 1 || args.some(a => !['--run', '--repair-history'].includes(a)))) throw new Error('use default read-only plan, --repair-history (offline), --rebind-runtime <review.json> (offline), OR --run (gated)');
  const live = args.includes('--run'), repair = args.includes('--repair-history');
  if (live && process.env.PASS_B_CORPUS_LIVE !== '1') throw new Error('refusing --run: set PASS_B_CORPUS_LIVE=1');
  if (process.env.PASS_B_CORPUS_REQUEUE) throw new Error('blind requeue disabled: preserved terminal failures require reviewed new inputs/contract');
  const pool = loadGlobal('data/pool.js', 'ARTEFACTUM_POOL');
  const poolById = new Map(pool.map(p => [p.id, p]));
  const daily = loadGlobal('data/daily-order.js', 'ARTEFACTUM_DAILY') || { byDate: {} };
  const teach = (loadGlobal('data/teach-works.js', 'ARTEFACTUM_CUES') || {}).work || {};
  const hotspots = loadGlobal('data/hotspots.js', 'ARTEFACTUM_HOTSPOTS') || {};
  const vision = loadGlobal('data/vision.js', 'ARTEFACTUM_VISION') || {};
  const auditIds = new Set(JSON.parse(readFileSync('data/vision-audit.json', 'utf8')).ids || []);
  const legacyOf = id => snapshotLegacy(id, { teach, hotspots, vision, auditIds });
  const allEligible = pool.filter(p => typeof p.img === 'string' && p.img.trim());
  const ledger = readLedger();
  const inspection = inspectCorpus({ pool, legacyOf, ledger });
  const clock = pacificClock();
  const windowOrder = buildPriorityQueue(pool, daily, { today: clock.date });
  let order = windowOrder;
  if (LANE === 'cloud') {
    const skipPath = process.env.PASS_B_CLOUD_SKIP;
    if (!skipPath || !existsSync(skipPath)) throw new Error('cloud lane needs PASS_B_CLOUD_SKIP=<skip.json> (local done/held/window ids) so it never duplicates local work');
    const skip = new Set([...windowOrder, ...(readJson(skipPath).ids || [])]);
    order = buildPriorityQueue(pool, daily, { today: clock.date, windowOnly: false }).filter(id => !skip.has(id));
  }
  const eligibleSet = new Set(allEligible.map(p => p.id));
  const queue = computeQueue(order, { eligibleSet, doneSet: inspection.doneSet, heldSet: inspection.heldSet });
  console.log(`runId: ${RUN_ID} | collector: ${COLLECTOR_VERSION} | banked evidence contract: ${EVIDENCE_CONTRACT_VERSION} | lane: ${LANE}${LANE === 'cloud' ? ` (cap $${CLOUD_BUDGET_USD}, spent $${runSpendUsd(RUN_DIR).toFixed(2)})` : ''}`);
  console.log(`Pacific date: ${clock.date} | window: [${clock.date}, ${plusDay(clock.date, 30)}) | may start now: ${clock.mayStart}`);
  console.log(`corpus verified B1/B2/B3: ${inspection.totals.b1Complete}/${inspection.totals.b2Complete}/${inspection.totals.b3Complete} | done ${inspection.doneSet.size} | held ${inspection.heldSet.size} | attempts ${inspection.attempts}`);
  console.log(`${LANE === 'cloud' ? 'cloud-lane candidates (beyond window, minus skip list)' : 'window works'}: ${order.length} | queued: ${queue.length} | pending raw-file repairs: ${inspection.repairs.length} | fatal: ${inspection.fatal || 'none'} | pause: ${inspection.pause || 'none'}`);
  const active = executionEpochs(RUN_DIR).at(-1);
  console.log(`runtime epoch: ${active ? `${active.number} / CLI ${active.policy.runtimeVersion} / ${active.sha256}` : 'none (first authorized run binds installed CLI)'}`);
  console.log(`first queued: ${queue.slice(0, 10).join(', ')}`);
  if (!live && !repair && !rebind) { console.log(LANE === 'cloud' ? 'READ-ONLY PLAN (cloud lane): no writes, calls, or fetches. Works beyond the 30-day window only; stops at the dollar cap.' : 'READ-ONLY PLAN: no writes, migrations, calls, or fetches. Starts only 00:00–08:30 Pacific; no work outside the 30-day window.'); return; }
  if (live && inspection.fatal) throw new Error(`preserved fatal: ${inspection.fatal}`);
  if (live && inspection.pause) throw new OperationalPauseError(inspection.pause);
  if (live) laneWindow();
  mkdirSync(join(RUN_DIR, 'works'), { recursive: true, mode: 0o700 }); mkdirSync(IMGS_DIR, { recursive: true, mode: 0o700 });
  acquireStageLease(RUN_LEASE); // acquire before any ledger/migration write, including offline maintenance
  try {
    // Reinspect under the lease, then copy only verified missing bytes. Existing evidence is never overwritten.
    const fresh = inspectCorpus({ pool, legacyOf });
    if (rebind) {
      if (fresh.fatal) throw new Error('runtime rebind cannot clear preserved fatal history');
      if (fresh.pause && !fresh.pause.includes('runtime drift; reviewed rebind required')) throw new Error('runtime rebind cannot clear an unknown/operational outcome');
      const epoch = rebindRuntime(RUN_DIR, readJson(rebind));
      console.log(`OFFLINE RUNTIME REBIND: epoch ${epoch.number}, CLI ${epoch.policy.runtimeVersion}, ${epoch.sha256}. No calls; prior attempts unchanged.`);
      return;
    }
    let led = applyHistoryRepair({ inspection: fresh, eligibleCount: allEligible.length });
    if (repair) {
      const verified = inspectCorpus({ pool, legacyOf, ledger: led });
      if (verified.repairs.length) throw new Error('raw evidence repair incomplete');
      console.log(`OFFLINE REPAIR: copied ${fresh.repairs.length} missing raw files; terminal holds ${verified.heldSet.size}; verified ${verified.totals.b1Complete + verified.totals.b2Complete + verified.totals.b3Complete} completions. No calls/fetches.`);
      return;
    }
    if (fresh.fatal) throw new Error(`preserved fatal: ${fresh.fatal}`);
    if (fresh.pause) throw new OperationalPauseError(fresh.pause);
    const onPath = String((await execFileP('sh', ['-c', 'command -v claude'])).stdout).trim();
    CLAUDE_BIN = realpathSync(onPath); // e.g. ~/.local/share/claude/versions/2.1.282
    const versionResult = await execFileP(CLAUDE_BIN, ['--version'], { timeout: 10000, maxBuffer: 10000, env: { ...process.env, DISABLE_AUTOUPDATER: '1' } }); // local metadata, never a model query
    RUNTIME_VERSION = String(versionResult.stdout).match(/\b\d+\.\d+\.\d+\b/)?.[0];
    bindExecutionPolicy(RUN_DIR, RUNTIME_VERSION);
    if (LANE === 'cloud') { SPENT_USD = runSpendUsd(RUN_DIR); console.log(`cloud lane: $${SPENT_USD.toFixed(2)} already spent of $${CLOUD_BUDGET_USD} cap`); }
    STOP = false; STOP_REASON = null; FATAL = null;
    ATTEMPT_SEQ = fresh.maxSeq; TRANSPORT_RETRIES = led.transportRetries || 0;
    const imageIndex = existsSync(IMAGE_INDEX) ? readJson(IMAGE_INDEX) : {};
    const doneSet = fresh.doneSet, heldSet = fresh.heldSet;
    led.heldReasons = fresh.heldReasons;
    const workQueue = computeQueue(order, { eligibleSet, doneSet, heldSet });
    const persist = () => {
      led.heldIds = [...heldSet]; led.doneIds = [...doneSet]; led.attemptSeq = ATTEMPT_SEQ;
      led.transportRetries = TRANSPORT_RETRIES; led.updatedAt = new Date().toISOString();
      led.stopReason = FATAL ? `fatal:${FATAL}` : STOP_REASON;
      atomicWrite(LEDGER, `${JSON.stringify(led, null, 1)}\n`);
    };
    const hold = (id, reason) => { heldSet.add(id); led.heldReasons[id] = reason; persist(); };
    let cursor = 0;
    const lane = async () => {
      while (!STOP && !FATAL) {
        try { laneWindow(); } catch (e) { STOP = true; STOP_REASON = e instanceof BudgetStopError ? 'budget-cap' : 'protected-hours'; break; }
        const id = workQueue[cursor++]; if (!id) break;
        const p = poolById.get(id), workRunDir = wdirOf(id), catalog = trustedCatalog(p), legacy = legacyOf(id);
        try {
          mkdirSync(workRunDir, { recursive: true, mode: 0o700 });
          const prep = await prepImage(id, p.img, catalog, legacy, imageIndex);
          if (!prep.ok) { hold(id, `B0:${prep.reason}`); continue; }
          if (!existsSync(join(workRunDir, 'b0-prep.json'))) writeFileSync(join(workRunDir, 'b0-prep.json'), `${JSON.stringify({ version: 'passBCalibrationB0/1', work: { id }, trustedCatalog: catalog, legacy, image: prep }, null, 1)}\n`, { flag: 'wx', mode: 0o600, flush: true });
          const verified = inspectWork({ runDir: RUN_DIR, id, catalog, legacy });
          const { status, retries } = await runWorkStages({ workId: id, catalog, legacy, imgSha256: prep.imgSha256, ext: prep.ext, prompts,
            runtimeVersion: RUNTIME_VERSION, spawnStage: makeSpawnStage(workRunDir, prep.imgSha256, prep.ext, id),
            capture: makeCapture(workRunDir), loadCompletion: stage => verified.bodies[stage] || null, skipB4: true });
          if (retries?.B2?.attempts) led.validationRetries = (led.validationRetries || 0) + retries.B2.attempts;
          // runWorkStages captures exceptions as status text; the durable fatal flag remains authoritative.
          if (FATAL) break;
          if (STOP || isUsageInterrupted(status) || isLeaseInterrupted(status)) continue;
          const result = inspectWork({ runDir: RUN_DIR, id, catalog, legacy });
          if (result.fatal) { markFatal(result.fatal); break; }
          if (result.done) doneSet.add(id);
          else hold(id, `stage-fail:${JSON.stringify(status)}`);
          persist();
        } catch (e) {
          stopForException(e, { fatal: reason => markFatal(`${id}: ${reason}`), pause: reason => { STOP = true; STOP_REASON ||= reason; } });
          persist();
        }
      }
    };
    await Promise.all(Array.from({ length: LANES }, lane));
    persist();
    const after = inspectCorpus({ pool, legacyOf, ledger: led });
    applyHistoryRepair({ inspection: after, ledger: led, eligibleCount: allEligible.length });
    if (FATAL) throw new Error(`fatal: ${FATAL}`);
    console.log(`Stopped: ${STOP_REASON || 'window queue exhausted'}; done ${after.doneSet.size}, held ${after.heldSet.size}.`);
  } finally { unlinkSync(RUN_LEASE); }
}

// item 8: robust main guard — relative or absolute invocation both run.
const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) main().catch(e => { console.error(`FAIL-CLOSED: ${e.message}`); process.exit(1); });
