// Teaching-v2 Phase A live loop and on-disk evidence (VSD-093; Codex code review round 2, R2-3..R2-7). Extracted
// from scripts/teaching-v2-run.mjs so that every durable transition is testable with an injected executor.
//   phaseStop        the phase-wide stop DERIVED from every preserved reservation, outcome and transcript of every
//                    run (fatal.json is only a cache of it), checked at start and before every reservation (R2-3)
//   makeAttempts     reservation receipts (prompt, schema, argv, runtime) and transcript recovery that checks the
//                    effective request receipt before reclassifying (R2-4/R2-5)
//   makeFinalize     idempotent immutable final payload: an existing file is verified byte for byte (R2-6)
//   freezeRuntime    the CLI runtime receipt, frozen once per run (R2-4)
//   verifyRun        read-only replay of a run's terminal works from evidence (previews, the rest prerequisite)
//   runPhase         the serial live loop; a 'rest' phase binds to its verified first-ten parent run (R2-7)
// No model call happens here unless the injected `execute` makes one (only scripts/teaching-v2-run.mjs --live).
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, renameSync, linkSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { sha256, stableJson } from './vision-legacy.mjs';
import { buildConfinedCommand, runConfined, classifyTranscript } from './teaching-v2-stage.mjs';
import { runWork, isTerminal, dispatchOf, PauseRun, LatchStop, BindingChanged, EvidenceMismatch } from './teaching-v2-controller.mjs';
import { WRITER_RESULT_WIRE, VERIFICATION_WIRE, VERIFICATION_NO_REPLACEMENT_WIRE, MODEL } from './teaching-v2-contract.mjs';
import { writeLatch, LatchedError } from './teaching-v2-ops.mjs';
import { LeaseBusyError, PersistError } from './pass-b-remote-evidence.mjs';

export const PHASE_RUNNER_VERSION = 'teachingV2Phase/1';
export const writeJson = (p, v) => { mkdirSync(join(p, '..'), { recursive: true, mode: 0o700 }); const t = `${p}.tmp-${process.pid}`; writeFileSync(t, `${JSON.stringify(v, null, 1)}\n`, { mode: 0o600, flush: true }); renameSync(t, p); };
export const readJson = p => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);
export const WIRE_FOR = Object.freeze({ W: WRITER_RESULT_WIRE, V: VERIFICATION_WIRE, V2: VERIFICATION_NO_REPLACEMENT_WIRE });
export const stemOf = e => `${String(e.seq).padStart(2, '0')}-${e.kind}`;
export const runDirOf = (phaseDir, runId) => join(phaseDir, 'runs', runId);
export const workDirOf = (runDir, key) => join(runDir, 'works', key);
export class RefusedError extends Error { constructor(m) { super(m); this.name = 'RefusedError'; } }
export class FinalPayloadConflict extends EvidenceMismatch { constructor(m) { super(m); this.name = 'FinalPayloadConflict'; } }

// ---- run identity (dry run and live compute the same id) ----
// parent (R2-7): the remaining-40 run binds the deterministic id of its first-ten parent run.
export function runIdentity({ base, items, bindingSha, parent = null }) {
  return { ...base, works: Object.fromEntries(items.map(x => [x.id, bindingSha(x.binding)])), ...(parent ? { parentRun: parent } : {}) };
}
export const runIdOf = identity => 'tv2a-' + sha256(stableJson(identity)).slice(0, 12);

// ---- owner clearances: the ONLY way past a preserved fatal/unknown attempt ----
// phase-a/latch-clearances.json = [{ runId, workKey, seq, transcriptSha256|null, reviewedBy, at, note }], written by
// the owner after reviewing the attempt evidence. Deleting fatal.json alone clears nothing: the stop is re-derived.
export const clearancesPath = phaseDir => join(phaseDir, 'latch-clearances.json');
export function readClearances(phaseDir) { const c = readJson(clearancesPath(phaseDir)); return Array.isArray(c) ? c : []; }
export const clearedFor = (clearances, runId, workKey) => e => clearances.some(c => c.runId === runId && c.workKey === workKey && c.seq === e.seq && (!c.transcriptSha256 || c.transcriptSha256 === e.transcriptSha256));

// ---- R2-3: the phase-wide stop, derived from ALL preserved evidence of every run ----
// allowPendingIn: the one '<runId>/<workKey>' whose interrupted reservation the controller is about to reconcile.
export function phaseStop({ phaseDir, allowPendingIn = null }) {
  const stops = [], root = join(phaseDir, 'runs'), clearances = readClearances(phaseDir);
  if (!existsSync(root)) return { stops };
  for (const runId of readdirSync(root).sort()) {
    const works = join(root, runId, 'works'); if (!existsSync(works)) continue;
    const started = [];
    for (const key of readdirSync(works).sort()) {
      const wdir = join(works, key), adir = join(wdir, 'attempts'), state = readJson(join(wdir, 'state.json'));
      const ledger = state?.ledger || [], cleared = clearedFor(clearances, runId, key), where = `${runId}/${key}`;
      const add = (kind, seq, reason) => stops.push({ kind, runId, workKey: key, workId: state?.workId ?? null, seq, reason });
      if (ledger.length && !isTerminal(state)) started.push(where);
      for (const e of ledger) {
        if (dispatchOf(e) === 'fatal' && !cleared(e)) add('fatal', e.seq, `preserved fatal ${e.kind} attempt: ${e.detail ?? ''}`.trim());
        else if (e.outcome === 'unknown' && !cleared(e)) add('unknown-outcome', e.seq, `preserved unknown-outcome ${e.kind} attempt`);
        else if (e.outcome === 'reserved' && where !== allowPendingIn) add('unknown-outcome', e.seq, `${e.kind} reservation with no recorded outcome`);
      }
      if (!existsSync(adir)) continue;
      for (const f of readdirSync(adir).filter(n => n.endsWith('.reserved.json')).sort()) {
        const res = readJson(join(adir, f)), seq = res?.seq, stem = f.replace(/\.reserved\.json$/, '');
        const inLedger = ledger.find(e => e.seq === seq), notDispatched = (state?.notDispatched || []).some(e => e.seq === seq);
        if (!inLedger && !notDispatched) { add('unknown-outcome', seq ?? null, `reservation receipt ${f} has no ledger entry`); continue; }
        const tp = join(adir, `${stem}.transcript.jsonl`), meta = readJson(join(adir, `${stem}.meta.json`));
        const pseudo = inLedger || { seq, transcriptSha256: null };
        if (meta?.kind === 'fatal' && !cleared(pseudo)) add('fatal', seq, `transcript outcome ${stem} recorded fatal: ${meta.reason ?? ''}`.trim());
        else if (existsSync(tp) && res?.imageFile && res?.runtimeVersion) {
          const cls = classifyTranscript(readFileSync(tp, 'utf8'), { exitCode: meta?.exitCode ?? 0, callDir: meta?.callDir ?? null, imageFile: res.imageFile, runtimeVersion: res.runtimeVersion });
          if (cls.kind === 'fatal' && !cleared(pseudo)) add('fatal', seq, `transcript ${stem} re-classifies fatal: ${cls.reason}`);
        }
      }
    }
    if (started.length > 1) stops.push({ kind: 'unknown-outcome', runId, workKey: null, workId: null, seq: null, reason: `more than one started, unfinished work in a serial run: ${started.join(', ')}` });
  }
  return { stops };
}
const stopError = s => new LatchStop(`phase-wide stop derived from preserved evidence: ${s.runId}/${s.workKey ?? '-'}${s.seq != null ? ` attempt ${s.seq}` : ''}: ${s.reason}`, s.kind);

// ---- R2-4: the CLI runtime receipt, frozen once per run ----
export function freezeRuntime(runDir, runtime, persist = () => {}) {
  if (!/^\d+\.\d+\.\d+$/.test(runtime?.version || '') || !runtime?.bin) throw new RefusedError('could not pin the CLI runtime version');
  const p = join(runDir, 'runtime.json'), want = { version: runtime.version, bin: runtime.bin };
  const prior = readJson(p);
  if (prior) {
    if (stableJson({ version: prior.version, bin: prior.bin }) !== stableJson(want)) throw new RefusedError(`CLI runtime changed (${prior.version} ${prior.bin} frozen for this run, now ${want.version} ${want.bin}); a reviewed rebind needs a new run version`);
    return { version: prior.version, bin: prior.bin };
  }
  mkdirSync(runDir, { recursive: true, mode: 0o700 });
  writeFileSync(p, `${JSON.stringify({ ...want, frozenAt: new Date().toISOString() }, null, 1)}\n`, { flag: 'wx', mode: 0o600, flush: true });
  persist([p], `teaching-v2 runtime ${want.version}`);
  return want;
}
export const readRuntime = runDir => { const r = readJson(join(runDir, 'runtime.json')); return r ? { version: r.version, bin: r.bin } : null; };

// ---- R2-4/R2-5: request receipts and recovery from the flushed transcript ----
const receiptOf = ({ runId, workId, entry, promptText, wireSchema, imageFile, runtime, holder = null, budgetId = null }) => {
  const cmd = buildConfinedCommand({ stage: entry.kind, promptText, imageFile, wireSchema });
  return { runId, workId, ...entry, imageFile, model: MODEL, effort: cmd.effort, wireSchemaSha256: cmd.wireSchemaSha256, argvSha256: sha256(stableJson(cmd.argv)), runtimeVersion: runtime.version, runtimeBin: runtime.bin, holder, budgetId };
};
const RECEIPT_FIELDS = ['seq', 'kind', 'reason', 'promptSha256', 'promptBytes', 'wireSchemaSha256', 'bindingSha256'];
export function makeAttempts({ adir, runId, workId, imageFile, runtime, persist = null, statePath = null, holder = null, budgetId = null }) {
  return {
    reserve(entry, promptText, wireSchema) {
      mkdirSync(adir, { recursive: true, mode: 0o700 });
      const s = stemOf(entry), receipt = receiptOf({ runId, workId, entry, promptText, wireSchema, imageFile, runtime, holder, budgetId });
      writeFileSync(join(adir, `${s}.prompt.txt`), promptText, { flag: 'wx', mode: 0o600, flush: true });
      writeFileSync(join(adir, `${s}.reserved.json`), `${JSON.stringify(receipt)}\n`, { flag: 'wx', mode: 0o600, flush: true });
      persist?.([statePath, join(adir, `${s}.reserved.json`), join(adir, `${s}.prompt.txt`)], `teaching-v2 reserve ${workId}/${s}`); // BEFORE the call
    },
    // Rebuild the classified result of ANY dispatched attempt (reserved or recorded) from its own files, with no
    // call. The receipt must match the ledger entry, the prompt bytes, the recomputed argv and the frozen runtime.
    recover(entry) {
      const s = stemOf(entry), res = readJson(join(adir, `${s}.reserved.json`)), pp = join(adir, `${s}.prompt.txt`), tp = join(adir, `${s}.transcript.jsonl`);
      if (!res || !existsSync(pp)) return null;
      const prompt = readFileSync(pp, 'utf8'), wire = WIRE_FOR[entry.kind];
      const bad = RECEIPT_FIELDS.filter(k => k in entry && stableJson(res[k] ?? null) !== stableJson(entry[k] ?? null));
      if (sha256(prompt) !== res.promptSha256) bad.push('prompt bytes');
      if (res.runtimeVersion !== runtime.version || res.runtimeBin !== runtime.bin) bad.push('runtime');
      if (!wire || stableJson(receiptOf({ runId, workId, entry: { ...entry, outcome: 'reserved' }, promptText: prompt, wireSchema: wire, imageFile, runtime, holder: res.holder, budgetId: res.budgetId }).argvSha256) !== stableJson(res.argvSha256)) bad.push('effective command');
      if (res.imageFile !== imageFile || res.runId !== runId || res.workId !== workId) bad.push('work/run');
      if (bad.length) throw new EvidenceMismatch(`${workId}/${s}: request receipt differs from the ledger or its own bytes (${bad.join(', ')}); preserved for review`);
      if (!existsSync(tp)) return null;
      const stdout = readFileSync(tp, 'utf8'), meta = readJson(join(adir, `${s}.meta.json`));
      if (entry.transcriptSha256 && sha256(stdout) !== entry.transcriptSha256) return { kind: 'fatal', reason: 'transcript bytes changed since the attempt was recorded' };
      if (meta && meta.promptSha256 && meta.promptSha256 !== res.promptSha256) return { kind: 'fatal', reason: 'outcome metadata names a different prompt than its reservation' };
      const cls = classifyTranscript(stdout, { exitCode: meta?.exitCode ?? 0, callDir: meta?.callDir ?? null, imageFile, runtimeVersion: res.runtimeVersion });
      return { ...cls, transcriptSha256: sha256(stdout), wallMs: meta?.wallMs ?? null };
    },
  };
}
export function makeInvoke({ adir, work, imageFile, runtime, execute, persist = null, record = () => null, log = () => {} }) {
  return async (stage, { promptText, wireSchema, seq }) => {
    const command = buildConfinedCommand({ stage, promptText, imageFile, wireSchema });
    const r = await runConfined(command, { imagePath: work.image.path, execute, runtimeVersion: runtime.version, bin: runtime.bin });
    const s = stemOf({ seq, kind: stage });
    writeFileSync(join(adir, `${s}.transcript.jsonl`), r.stdout, { flag: 'wx', mode: 0o600, flush: true });
    writeFileSync(join(adir, `${s}.meta.json`), `${JSON.stringify({ stage, seq, kind: r.kind, reason: r.reason, exitCode: r.exitCode, callDir: r.callDir, wallMs: r.wallMs, transcriptSha256: r.transcriptSha256, promptSha256: command.promptSha256, promptBytes: command.promptBytes, wireSchemaSha256: command.wireSchemaSha256, usage: r.usage, toolUses: r.toolUses, classifier: r.classifier })}\n`, { flag: 'wx', mode: 0o600, flush: true });
    record(r.stdout, `teaching-v2:${work.id}/${stage}`);
    try { persist?.([join(adir, `${s}.transcript.jsonl`), join(adir, `${s}.meta.json`)], `teaching-v2 outcome ${work.id}/${s}: ${r.kind}`); }
    catch (e) { if (r.kind !== 'fatal') throw new PauseRun(`outcome not pushed (reconciled from the local transcript on resume): ${e.message}`); }
    log(`  ${work.id} ${stage}: ${r.kind}${r.reason ? ` (${r.reason})` : ''} ${r.wallMs}ms in=${r.usage?.inputTokens} out=${r.usage?.outputTokens} cacheRead=${r.usage?.cacheReadInputTokens}`);
    return r;
  };
}

// ---- R2-6: the immutable final payload, finalized idempotently ----
// New file: written to a temp file and hard-linked into place (atomic; never a torn final file), then persisted.
// Existing file: its bytes must equal this payload's exact serialization; then persistence is retried and the
// acceptance finishes. Differing bytes are refused. A replay or verify-only reader never writes or pushes.
export const finalPayloadBytes = payload => `${JSON.stringify(payload, null, 1)}\n`;
export function makeFinalize({ wdir, persist = null, verifyOnly = false }) {
  return (payload, { replay = false } = {}) => {
    const p = join(wdir, 'final-payload.json'), bytes = finalPayloadBytes(payload);
    if (existsSync(p)) {
      const cur = readFileSync(p, 'utf8');
      if (cur !== bytes) throw new FinalPayloadConflict(`${payload.workId}: final-payload.json exists with different bytes (sha256 ${sha256(cur).slice(0, 12)} on disk, ${sha256(bytes).slice(0, 12)} reconstructed); preserved for review`);
      if (!replay && !verifyOnly) persist?.([p], `teaching-v2 final ${payload.workId}`);
      return JSON.parse(cur);
    }
    if (replay || verifyOnly) throw new EvidenceMismatch(`${payload.workId}: accepted state has no final-payload.json to re-open`);
    mkdirSync(wdir, { recursive: true, mode: 0o700 });
    const t = `${p}.tmp-${process.pid}`;
    writeFileSync(t, bytes, { flag: 'w', mode: 0o600, flush: true });
    try { linkSync(t, p); } finally { unlinkSync(t); }
    persist?.([p], `teaching-v2 final ${payload.workId}`);
    return JSON.parse(readFileSync(p, 'utf8'));
  };
}

const liveBinding = (binding, runtime) => ({ ...binding, runtime: { version: runtime.version, bin: runtime.bin } });
const imageFileOf = work => `${work.image.sha256}.${work.image.ext}`;
const refuseCall = () => { throw new EvidenceMismatch('read-only verification would dispatch a call'); };

// ---- read-only replay of one work / one run from its evidence (previews and the rest prerequisite) ----
export async function verifyWork({ runDir, runId, phaseDir, item, gold, runtime, render }) {
  const { work, packet, texts, binding } = item;
  const wdir = workDirOf(runDir, work.key), state = readJson(join(wdir, 'state.json'));
  if (!state) return { id: item.id, status: 'not-run', ok: false };
  if (!isTerminal(state)) return { id: item.id, status: state.status ?? 'pending', ok: false, reason: 'not terminal' };
  if (!runtime) return { id: item.id, status: state.status, ok: false, reason: 'run has no frozen runtime receipt' };
  const attempts = makeAttempts({ adir: join(wdir, 'attempts'), runId, workId: item.id, imageFile: imageFileOf(work), runtime });
  try {
    await runWork({ work, packet, texts, gold, state, invoke: refuseCall, gate: refuseCall, attempts, render, finalize: makeFinalize({ wdir, verifyOnly: true }), binding: liveBinding(binding, runtime), isCleared: clearedFor(readClearances(phaseDir), runId, work.key) });
  } catch (e) { return { id: item.id, status: state.status, ok: false, reason: `${e.name}: ${e.message}` }; }
  const payload = state.status === 'accepted-for-review' ? readJson(join(wdir, 'final-payload.json')) : null;
  return { id: item.id, status: state.status, ok: true, state, payload };
}
export async function verifyRun({ phaseDir, runId, items, gold, renderFor }) {
  const runDir = runDirOf(phaseDir, runId), runtime = readRuntime(runDir);
  const rows = [];
  for (const item of items) rows.push(await verifyWork({ runDir, runId, phaseDir, item, gold, runtime, render: renderFor(item.work) }));
  return { ok: rows.every(r => r.ok), rows };
}

// R2-7: the remaining-40 continuation is bound to its verified first-ten parent run (the id is part of the rest
// run's identity). Every parent work must be terminal and reproduce from its evidence, and the parent's frozen
// run identity must equal the recomputed one.
export async function verifyParentRun({ phaseDir, parent, gold, renderFor }) {
  const idFile = readJson(join(runDirOf(phaseDir, parent.runId), 'run-identity.json'));
  if (!idFile || stableJson({ runId: parent.runId, ...parent.identity }) !== stableJson(idFile)) throw new RefusedError(`first-ten parent run ${parent.runId} has no matching run identity on disk; the continuation binds only to that verified run`);
  const v = await verifyRun({ phaseDir, runId: parent.runId, items: parent.items, gold, renderFor });
  const bad = v.rows.filter(r => !r.ok);
  if (bad.length) throw new RefusedError(`the first ten in ${parent.runId} must all be terminal and verified (${bad.length} not: ${bad.slice(0, 3).map(r => `${r.id} ${r.reason ?? r.status}`).join('; ')})`);
  return v;
}

// Calls this work already cost under earlier run versions (a changed candidate never hides its retries).
export function priorRunHistory(phaseDir, key, runId) {
  const root = join(phaseDir, 'runs'); if (!existsSync(root)) return [];
  return readdirSync(root).filter(r => r !== runId).flatMap(r => { const s = readJson(join(root, r, 'works', key, 'state.json')); return s ? [{ runId: r, calls: (s.ledger || []).length, status: s.status }] : []; });
}

// ---- the serial live loop ----
// ops: { allowance, gate(), persist(paths, msg), record(stdout, source), latch(info) } (teaching-v2-ops.mjs).
// runtime: { version, bin } resolved by the caller; frozen here. parent: { runId, identity, items } for 'rest'.
export async function runPhase({ phaseDir, runId, identity, items, gold, ops, runtime, execute, renderFor, parent = null, log = console.log, logError = console.error }) {
  const runDir = runDirOf(phaseDir, runId);
  if (parent) await verifyParentRun({ phaseDir, parent, gold, renderFor });
  const idPath = join(runDir, 'run-identity.json');
  const priorId = readJson(idPath);
  if (priorId && stableJson(priorId) !== stableJson({ runId, ...identity })) throw new RefusedError(`run-identity.json in ${runId} differs from the recomputed identity`);
  // R2-3: derive the stop from every preserved attempt BEFORE anything is dispatched. Only the first unfinished work
  // of this run (serial order) may hold an interrupted reservation for the controller to reconcile.
  const firstOpen = items.find(x => !isTerminal(readJson(join(workDirOf(runDir, x.work.key), 'state.json'))));
  const allowPendingIn = firstOpen ? `${runId}/${firstOpen.work.key}` : null;
  const start = phaseStop({ phaseDir, allowPendingIn });
  if (start.stops.length) { const s = start.stops[0]; ops.latch({ kind: s.kind, reason: stopError(s).message, workId: s.workId }); logError(`LATCHED before any dispatch: ${stopError(s).message}`); return { latched: s, stops: start.stops }; }
  if (!priorId) { writeJson(idPath, { runId, ...identity }); ops.persist([idPath], `teaching-v2 run ${runId}`); }
  const rt = freezeRuntime(runDir, runtime, ops.persist);
  const clearances = readClearances(phaseDir);
  for (const item of items) {
    const { id, work, packet, texts, binding } = item;
    const wdir = workDirOf(runDir, work.key), adir = join(wdir, 'attempts'), statePath = join(wdir, 'state.json');
    const state = readJson(statePath) || { workId: id, runId, status: 'pending', startedAt: new Date().toISOString(), priorRuns: priorRunHistory(phaseDir, work.key, runId) };
    const save = s => writeJson(statePath, s);
    const imageFile = imageFileOf(work);
    const attempts = makeAttempts({ adir, runId, workId: id, imageFile, runtime: rt, persist: ops.persist, statePath, holder: process.env.PASS_B_LEASE_HOLDER ?? null, budgetId: ops.allowance?.budgetId ?? null });
    const invoke = makeInvoke({ adir, work, imageFile, runtime: rt, execute, persist: ops.persist, record: ops.record, log });
    const gate = () => { const s = phaseStop({ phaseDir }); if (s.stops.length) throw stopError(s.stops[0]); return ops.gate(); };
    let stopped = false;
    try { await runWork({ work, packet, texts, gold, state, invoke, gate, attempts, save, render: renderFor(work), finalize: makeFinalize({ wdir, persist: ops.persist }), binding: liveBinding(binding, rt), isCleared: clearedFor(clearances, runId, work.key) }); }
    catch (e) {
      stopped = true;
      if (e instanceof LatchStop) { ops.latch({ kind: e.latch, reason: e.message, workId: id }); logError(`LATCHED at ${id}: ${e.message}. Nothing more runs until the owner reviews it.`); }
      else if (e instanceof PauseRun || e instanceof LatchedError || e instanceof LeaseBusyError || e instanceof PersistError) logError(`PAUSED at ${id}: ${e.message}`);
      else throw e;
    } finally { if (existsSync(statePath)) { try { ops.persist([statePath], `teaching-v2 state ${id}`); } catch { /* the next reservation push carries it */ } } }
    if (stopped) return { stoppedAt: id };
    log(`${id}: ${state.status}${state.holdReasons ? ` — ${state.holdReasons[0]}` : ''}`);
  }
  return { completed: true };
}
export { BindingChanged };
