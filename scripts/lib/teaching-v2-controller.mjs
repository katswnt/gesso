// Teaching-v2 Phase A per-work controller (VSD-093; design draft 2 §3.3 sequence, §3.4 budget). Deterministic
// control flow with INJECTED effects, so the whole W -> project -> V -> (V2) path, the attempt budget and the
// pass/hold rules are testable without any model call. The controller owns ids, hashes and statuses; a model
// verdict never approves anything: the best outcome is "accepted-for-review" (owner/Codex review next).
//
// Injected effects (review findings 2-4):
//   gate(kind)            capacity/lease/latch check BEFORE a reservation; throws PauseRun to refuse (no entry).
//   attempts.reserve(e)   durable reservation record (+ remote push) before dispatch; a throw means NOT dispatched.
//   attempts.recover(e)   reclassified result rebuilt from the exclusive, flushed transcript of attempt e, or null.
//   invoke(kind, ...)     the dispatch itself; returns a classified call.
//   render(projection)    the CURRENT index.html renderer run on this projection (teaching-v2-current-render.mjs).
//   finalize(payload)     writes the immutable final payload and returns it re-read and re-parsed from disk.
import { sha256, stableJson } from './vision-legacy.mjs';
import { validatePacketIntegrity, validateWriterResult, verificationOutcome, authorizeCall, packetHash, TRANSIENT_OUTCOMES, WRITER_RESULT_WIRE, VERIFICATION_WIRE, VERIFICATION_NO_REPLACEMENT_WIRE, WIRE_SCHEMA_HASHES, CONTRACT_VERSION, MODEL } from './teaching-v2-contract.mjs';
import { buildWriterPrompt, buildVerifierPrompt, PROMPT_VERSION, WRITER_CORE_SHA256, VERIFIER_CORE_SHA256 } from './teaching-v2-prompts.mjs';
import { projectLesson, validateProjection, renderManifest, PROJECTION_VERSION } from './teaching-v2-projection.mjs';
import { b1EvidenceIds, catalogConflicts, importB3Candidates } from './teaching-v2-inputs.mjs';
import { STAGE_EFFORT, CLASSIFIER_VERSION } from './teaching-v2-stage.mjs';

export const CONTROLLER_VERSION = 'teachingV2Controller/3';
export const BINDING_VERSION = 'teachingV2CandidateBinding/2';
export class PauseRun extends Error { constructor(reason) { super(reason); this.name = 'PauseRun'; } }
// A latching stop: the runner persists a phase-wide latch and refuses every later reservation/restart until review.
export class LatchStop extends PauseRun { constructor(reason, kind) { super(reason); this.name = 'LatchStop'; this.latch = kind; } }
// The bound inputs of a candidate changed: reuse is refused; a changed candidate needs an explicit new version.
export class BindingChanged extends PauseRun { constructor(reason) { super(reason); this.name = 'BindingChanged'; } }
const TERMINAL = new Set(['accepted-for-review', 'hold']);
export const isTerminal = state => TERMINAL.has(state?.status);

// Everything W/V see besides the draft, derived once per work (identical bytes for W, V and V2).
export function workContext({ work, packet, gold }) {
  return {
    gold, catalog: work.catalog, b1: work.b1, packet,
    conflicts: catalogConflicts(work.b2),
    b3Candidates: importB3Candidates(work.b2, work.b3),
    imageFile: `${work.image.sha256}.${work.image.ext}`,
  };
}
export function writerPromptFor(ctx) {
  return buildWriterPrompt({ gold: ctx.gold, catalog: ctx.catalog, b1: ctx.b1, packet: ctx.packet, priorDossier: null, conflicts: ctx.conflicts, b3Candidates: ctx.b3Candidates.kept, imageFile: ctx.imageFile });
}
export function verifierPromptFor(ctx, { allowReplacement, dossier, draft, current }) {
  const proj = projectLesson(draft.lesson);
  return buildVerifierPrompt({ allowReplacement, gold: ctx.gold, catalog: ctx.catalog, b1: ctx.b1, packet: ctx.packet, conflicts: ctx.conflicts, b3Candidates: ctx.b3Candidates.kept, dossier, draft, projection: renderManifest(proj, { current }), imageFile: ctx.imageFile });
}

// The frozen per-candidate binding (review finding 4): catalog, image/transform, B0/B1/B2/B3 receipts, the full
// packet and its texts (hash RECOMPUTED), examples, effective W prompt, schemas, model/efforts, classifier and the
// renderer. Any change refuses reuse of earlier outputs.
// runtime (review R2-4): the frozen CLI runtime receipt of the run ({ version, bin }). It is null in the dry run's
// run identity and bound into every live candidate, so W and V of one candidate can never span a runtime change.
// The binding is normalized through JSON, so it hashes identically before and after a reload from disk.
export function candidateBinding({ work, packet, texts, gold, renderer = null, runtime = null }) {
  const ctx = workContext({ work, packet, gold });
  return JSON.parse(JSON.stringify({
    version: BINDING_VERSION, workId: work.id, origin: work.origin ?? null, runtime,
    catalogSha256: sha256(stableJson(work.catalog ?? null)), legacySha256: sha256(stableJson(work.legacy ?? null)),
    image: { sha256: work.image?.sha256 ?? null, ext: work.image?.ext ?? null, width: work.image?.width ?? null, height: work.image?.height ?? null, transform: work.image?.transform ?? null },
    receipts: work.receipts ?? null,
    packetSha256: packetHash(packet), textsSha256: sha256(stableJson(texts ?? null)),
    gold: gold.sha256, writerPromptSha256: sha256(writerPromptFor(ctx)),
    wire: WIRE_SCHEMA_HASHES(), model: MODEL, efforts: STAGE_EFFORT, classifier: CLASSIFIER_VERSION,
    versions: { contract: CONTRACT_VERSION, controller: CONTROLLER_VERSION, prompts: PROMPT_VERSION, writerCore: WRITER_CORE_SHA256, verifierCore: VERIFIER_CORE_SHA256, projection: PROJECTION_VERSION },
    renderer,
  }));
}
export const bindingSha = b => sha256(stableJson(b));
const diffKeys = (a, b) => [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])].filter(k => stableJson(a?.[k] ?? null) !== stableJson(b?.[k] ?? null));

// Deterministic preflight: anything detectable before W stops before spending.
export function preflight({ work, packet, texts }) {
  const reasons = [];
  if (work.provenance && !work.provenance.ok) reasons.push(`imported stage provenance not verifiable: ${work.provenance.reason}`);
  if (!work.b1) reasons.push('no reusable B1 inventory');
  if (!work.image?.sha256) reasons.push('no sanitized image');
  const fit = work.b1?.imageFitness;
  if (work.b1 && (fit?.imageState === 'blocked' || fit?.imageState === 'unplayable')) reasons.push(`B1 marked the image ${fit.imageState}`);
  if (work.b1 && fit?.ok === false) reasons.push('B1 image fitness not ok');
  if (work.b1 && work.b1.playable === false) reasons.push('B1 marked the work not playable');
  const integ = validatePacketIntegrity(packet, texts);
  if (!integ.ok) reasons.push(`packet integrity: ${integ.errors[0]}`);
  if (!(packet?.sources || []).some(s => s.status === 'captured' && s.sections.length)) reasons.push('no literal source text captured (missing literal evidence stops before W)');
  return { ok: reasons.length === 0, reasons };
}

// The classified dispatch result of a ledger entry. `outcome` is later overwritten by the derived verdict
// (candidate/invalid/hold/pass/revise), so the dispatch class is kept separately; any derived value means 'ok'.
const DISPATCH_KINDS = new Set(['reserved', 'unknown', 'fatal', 'usage-limit', 'transport-failure', 'content-failure', 'interrupted']);
export const dispatchOf = e => e.dispatch ?? (DISPATCH_KINDS.has(e.outcome) ? e.outcome : 'ok');
const shaOrNull = v => (v == null ? null : sha256(stableJson(v)));
const wireSha = w => sha256(stableJson(w));
const clone = v => JSON.parse(JSON.stringify(v));
// The state fields derived from attempt evidence; a terminal replay must reproduce every one of them exactly.
const DERIVED = ['status', 'holdReasons', 'stage', 'final', 'artifacts', 'inputs', 'ledger'];
export class EvidenceMismatch extends BindingChanged { constructor(reason) { super(reason); this.name = 'EvidenceMismatch'; } }

// One work. state is mutated and handed to save() after every step (resume-safe).
// Review R2-4/R2-5: the attempt evidence (each dispatched attempt's transcript, re-classified by attempts.recover)
// is the ONLY authority. Every resume replays the deterministic flow from that evidence: the writer result, the
// verifier decisions, projections and the final draft are recomputed, never read from cached state, and any
// dispatched attempt whose derived artifact is missing is rebuilt without a new call. A terminal state is replayed
// read-only and must reproduce exactly (including the re-opened final payload), or the resume is refused.
// isCleared(entry): the owner's recorded review of a fatal/unknown attempt (otherwise it re-latches, review R2-3).
export async function runWork(args) {
  const { work, packet, texts, gold, state, invoke, gate = async () => {}, attempts = null, render = null, finalize = null, binding = null, isCleared = () => false } = args;
  const { save = () => {}, now = () => new Date() } = args;
  const replay = args.replay === true;
  if (typeof render !== 'function') throw new Error('runWork needs the current index.html renderer (render)');
  state.ledger ||= []; state.artifacts ||= {};
  // ---- binding: bound once, checked on every resume (including terminal states) ----
  const expected = binding ?? candidateBinding({ work, packet, texts, gold });
  if (!state.binding) {
    if (state.ledger.length || isTerminal(state)) throw new BindingChanged(`${work.id}: state has attempts but no candidate binding; preserve for review`);
    state.binding = expected; state.bindingSha256 = bindingSha(expected); save(state);
  } else if (bindingSha(state.binding) !== bindingSha(expected) || state.bindingSha256 !== bindingSha(state.binding)) {
    throw new BindingChanged(`${work.id}: bound inputs changed (${diffKeys(state.binding, expected).join(', ') || 'binding hash'}); a changed candidate needs an explicit new version`);
  }
  // ---- a preserved fatal / unknown outcome always stops the phase (review R2-3), terminal or not ----
  const stop = state.ledger.find(e => (dispatchOf(e) === 'fatal' || e.outcome === 'unknown') && !isCleared(e));
  if (stop) {
    const fatal = dispatchOf(stop) === 'fatal';
    if (fatal && !isTerminal(state) && !replay) { Object.assign(state, { status: 'hold', holdReasons: [`confinement/provenance: ${stop.detail ?? ''}`.trim()], stage: stop.kind, finishedAt: now().toISOString() }); save(state); }
    throw new LatchStop(`${fatal ? 'fatal' : 'unknown outcome'} ${work.id}/${stop.kind} attempt ${stop.seq}: ${stop.detail ?? ''}`.trim(), fatal ? 'fatal' : 'unknown-outcome');
  }
  // ---- terminal: replay read-only from the evidence; it must reproduce the stored conclusion exactly ----
  if (isTerminal(state) && !replay) {
    const copy = clone(state);
    for (const k of ['status', 'holdReasons', 'stage', 'final', 'finishedAt']) delete copy[k];
    copy.artifacts = {};
    await runWork({ ...args, state: copy, save: () => {}, now: () => new Date(state.finishedAt || 0), replay: true });
    const diff = DERIVED.filter(k => stableJson(copy[k] ?? null) !== stableJson(state[k] ?? null));
    if (diff.length) throw new EvidenceMismatch(`${work.id}: stored ${state.status} state does not reproduce from its attempt evidence (${diff.join(', ')}); preserved for review`);
    return state;
  }
  const finish = (status, extra = {}) => { Object.assign(state, { status, finishedAt: now().toISOString(), ...extra }); save(state); return state; };

  // ---- reconcile EVERY attempt against its evidence, whatever its cached outcome (R2-5) ----
  const evidence = new Map(); // seq -> verified structured output of an ok dispatch
  const storedResult = seq => Object.values(state.artifacts).find(a => a?.seq === seq && a.result !== undefined)?.result;
  for (const e of state.ledger) {
    const r = attempts?.recover ? await attempts.recover(e) : null;
    if (e.outcome === 'reserved') {
      if (!r) { e.outcome = 'unknown'; e.detail = 'reservation without a recoverable transcript; retained for review'; save(state); throw new LatchStop(`${work.id}/${e.kind} attempt ${e.seq}: unknown outcome`, 'unknown-outcome'); }
      Object.assign(e, { outcome: r.kind, dispatch: r.kind, detail: r.reason ?? null, reconstructed: true, usage: r.usage ?? null, transcriptSha256: r.transcriptSha256 ?? null, structuredSha256: shaOrNull(r.structured) });
      save(state);
    } else if (attempts?.recover) {
      if (!r) throw new EvidenceMismatch(`${work.id}/${e.kind} attempt ${e.seq}: a dispatched attempt has no recoverable transcript`);
      if (r.kind !== dispatchOf(e) || shaOrNull(r.structured) !== (e.structuredSha256 ?? null) || (e.transcriptSha256 && r.transcriptSha256 && e.transcriptSha256 !== r.transcriptSha256)) {
        throw new EvidenceMismatch(`${work.id}: stored result of attempt ${e.seq} does not reproduce from its transcript (${dispatchOf(e)} recorded, ${r.kind} recovered)`);
      }
    }
    if (dispatchOf(e) === 'fatal' && !isCleared(e)) {
      if (!replay) finish('hold', { holdReasons: [`confinement/provenance: ${e.detail ?? ''}`.trim()], stage: e.kind });
      throw new LatchStop(`fatal ${work.id}/${e.kind}: ${e.detail ?? ''}`.trim(), 'fatal');
    }
    if (dispatchOf(e) === 'ok') {
      const structured = r ? r.structured : storedResult(e.seq);
      if (structured == null || shaOrNull(structured) !== (e.structuredSha256 ?? shaOrNull(structured))) throw new EvidenceMismatch(`${work.id}/${e.kind} attempt ${e.seq}: no verifiable result to rebuild from`);
      evidence.set(e.seq, structured);
    }
  }

  const pf = preflight({ work, packet, texts });
  if (!pf.ok) return finish('hold', { holdReasons: pf.reasons, stage: 'preflight' });
  const ctx = workContext({ work, packet, gold });
  state.inputs = { bindingSha256: state.bindingSha256, b3Rejected: ctx.b3Candidates.rejected };

  // A call with its budget, transient retry and pause semantics. Returns the ok call or null (terminal hold set).
  // An already-dispatched ok attempt of this stage is reused from its evidence, after checking that the request
  // the controller would send now is byte-identical to the recorded receipt (prompt, schema, binding).
  const call = async (kind, reason, promptText, wireSchema) => {
    const done = state.ledger.find(e => e.kind === kind && evidence.has(e.seq));
    if (done) {
      if (done.promptSha256 !== sha256(promptText) || done.bindingSha256 !== state.bindingSha256 || (done.wireSchemaSha256 && done.wireSchemaSha256 !== wireSha(wireSchema))) {
        throw new EvidenceMismatch(`${work.id}/${kind} attempt ${done.seq}: the effective request differs from its recorded receipt`);
      }
      return { kind: 'ok', structured: evidence.get(done.seq), seq: done.seq };
    }
    // The last attempt overall was a non-transient failure of this stage: the same hold as when it happened.
    const last = state.ledger.at(-1);
    if (last && last.kind === kind) {
      const d = dispatchOf(last);
      if (d === 'fatal') { finish('hold', { holdReasons: [`confinement/provenance: ${last.detail ?? ''}`.trim()], stage: kind }); return null; }
      if (d === 'content-failure' || d === 'interrupted') { finish('hold', { holdReasons: [`${kind} ${d}: ${last.detail ?? ''}`.trim(), 'no retry: not a proven transient failure'], stage: kind }); return null; }
    }
    let req = last && last.kind === kind && TRANSIENT_OUTCOMES.includes(last.outcome) ? { kind, reason: 'transportRetry' } : { kind, reason };
    for (;;) {
      const a = authorizeCall(state.ledger, req);
      if (!a.ok) { finish('hold', { holdReasons: [a.reason], stage: kind }); return null; }
      if (replay) throw new EvidenceMismatch(`${work.id}: replaying the stored terminal state would dispatch a new ${kind} call`);
      await gate(kind); // pacing, lease, latch: a refusal leaves NO ledger entry (never dispatched)
      const seq = 1 + Math.max(0, ...state.ledger.map(x => x.seq || 0), ...(state.notDispatched || []).map(x => x.seq || 0)); // never reuse an attempt number
      const entry = { seq, kind, reason: req.reason, at: now().toISOString(), promptSha256: sha256(promptText), promptBytes: Buffer.byteLength(promptText, 'utf8'), wireSchemaSha256: wireSha(wireSchema), bindingSha256: state.bindingSha256, outcome: 'reserved' };
      state.ledger.push(entry); save(state);
      if (attempts?.reserve) {
        try { await attempts.reserve(entry, promptText, wireSchema); }
        catch (e) { state.ledger.pop(); (state.notDispatched ||= []).push({ ...entry, outcome: 'not-dispatched', detail: String(e.message).slice(0, 200) }); save(state); throw new PauseRun(`reservation not persisted; nothing dispatched: ${e.message}`); }
      }
      const r = await invoke(kind, { promptText, wireSchema, reason: req.reason, seq: entry.seq }); // a throw leaves the entry reserved -> reconciled on resume
      Object.assign(entry, { outcome: r.kind, dispatch: r.kind, detail: r.reason ?? null, usage: r.usage ?? null, wallMs: r.wallMs ?? null, transcriptSha256: r.transcriptSha256 ?? null, structuredSha256: shaOrNull(r.structured) });
      save(state);
      if (r.kind === 'fatal') { finish('hold', { holdReasons: [`confinement/provenance: ${r.reason}`], stage: kind }); throw new LatchStop(`fatal ${work.id}/${kind}: ${r.reason}`, 'fatal'); }
      if (r.kind === 'usage-limit') throw new PauseRun('subscription usage limit (attempt counted)');
      if (r.kind === 'transport-failure') { req = { kind, reason: 'transportRetry' }; continue; }
      if (r.kind !== 'ok') { finish('hold', { holdReasons: [`${kind} ${r.kind}: ${r.reason ?? ''}`.trim(), 'no retry: not a proven transient failure'], stage: kind }); return null; }
      evidence.set(entry.seq, r.structured);
      return { ...r, seq: entry.seq };
    }
  };
  const setOutcome = (seq, outcome) => { const e = state.ledger.find(x => x.seq === seq); if (e) e.outcome = outcome; };

  // ---- W (dispatched, or rebuilt from its evidence) ----
  const w = await call('W', 'planned', writerPromptFor(ctx), WRITER_RESULT_WIRE);
  if (!w) return state;
  const wv = validateWriterResult(w.structured, { packet, b1EvidenceIds: b1EvidenceIds(work.b1) });
  state.artifacts.writer = { seq: w.seq, result: w.structured, valid: wv.ok, errors: wv.errors.slice(0, 20), located: wv.located };
  setOutcome(w.seq, wv.ok ? (wv.hold ? 'hold' : 'candidate') : 'invalid');
  if (!wv.ok) return finish('hold', { holdReasons: ['writer output failed strict validation (no schema-fix retry)', ...wv.errors.slice(0, 5)], stage: 'W' });
  if (wv.hold) return finish('hold', { holdReasons: ['writer hold', ...w.structured.draft.holdReasons], stage: 'W' });
  const wr = w.structured; save(state);
  const dossier = wr.dossier;
  const project = (draft, tag) => {
    const proj = projectLesson(draft.lesson); const pv = validateProjection(proj, draft.lesson);
    const current = pv.ok ? render(proj) : null;
    const errors = [...pv.errors];
    // The ACTUAL index.html teaser must equal the approved one-sentence why (design §5); never repaired by trimming.
    if (current && current.whyShown !== String(draft.lesson.why).trim()) errors.push('current index.html teaser differs from the approved why');
    const ok = pv.ok && errors.length === 0;
    state.artifacts[`projection${tag}`] = { projection: proj, valid: ok, errors, manifest: current ? renderManifest(proj, { current }) : null, sha256: sha256(stableJson(proj)) };
    return { ok, errors, current };
  };
  const pv = project(wr.draft, 'W');
  if (!pv.ok) return finish('hold', { holdReasons: ['projection invalid', ...pv.errors.slice(0, 5)], stage: 'projection' });

  // ---- V: the decision is RECOMPUTED from the verified report every time ----
  const v = await call('V', 'planned', verifierPromptFor(ctx, { allowReplacement: true, dossier, draft: wr.draft, current: pv.current }), VERIFICATION_WIRE);
  if (!v) return state;
  const vo = verificationOutcome(v.structured, { draft: wr.draft, allowReplacement: true, packet, dossier });
  state.artifacts.verify = { seq: v.seq, result: v.structured, outcome: vo };
  setOutcome(v.seq, vo.decision); save(state);
  const accept = (source, draft, tag, minors) => {
    const proj = state.artifacts[`projection${tag}`];
    const payload = { version: 'teachingV2FinalPayload/1', workId: work.id, bindingSha256: state.bindingSha256, source, draftSha256: sha256(stableJson(draft)), projection: proj.projection, projectionSha256: proj.sha256 };
    if (finalize) {
      // Idempotent (R2-6): an existing final payload is re-opened and compared byte for byte; on a replay it is
      // only re-opened and compared (R2-4), never written.
      const reread = finalize(payload, { replay });
      if (stableJson(reread) !== stableJson(payload) || sha256(stableJson(reread.projection)) !== proj.sha256) return finish('hold', { holdReasons: ['final payload did not re-read identically from disk'], stage: 'finalize' });
      const rv = validateProjection(reread.projection, draft.lesson);
      if (!rv.ok) return finish('hold', { holdReasons: ['re-read final payload fails projection validation', ...rv.errors.slice(0, 4)], stage: 'finalize' });
    }
    return finish('accepted-for-review', { final: { source, draft, projectionSha256: proj.sha256, payloadSha256: sha256(stableJson(payload)), minors } });
  };
  if (vo.decision === 'pass') return accept('W', wr.draft, 'W', vo.minors);
  if (vo.decision === 'hold') return finish('hold', { holdReasons: vo.reasons, stage: 'V' });

  // ---- V2: fresh recheck of the complete replacement (no previous verdict, no list of fixes) ----
  const replacement = vo.replacement;
  const pv2 = project(replacement, 'R');
  if (!pv2.ok) return finish('hold', { holdReasons: ['replacement projection invalid', ...pv2.errors.slice(0, 5)], stage: 'projection' });
  const v2r = await call('V2', 'v2', verifierPromptFor(ctx, { allowReplacement: false, dossier, draft: replacement, current: pv2.current }), VERIFICATION_NO_REPLACEMENT_WIRE);
  if (!v2r) return state;
  const v2 = verificationOutcome(v2r.structured, { draft: replacement, allowReplacement: false, packet, dossier });
  state.artifacts.verify2 = { seq: v2r.seq, result: v2r.structured, outcome: v2 };
  setOutcome(v2r.seq, v2.decision); save(state);
  if (v2.decision === 'pass') return accept('V-replacement', replacement, 'R', v2.minors);
  return finish('hold', { holdReasons: v2.reasons.length ? v2.reasons : ['V2 hold'], stage: 'V2' });
}

// Per-work telemetry row from the SAME history the budget reads: every ledger entry is a dispatched attempt.
export function telemetry(state) {
  const calls = state.ledger || [];
  const sum = k => calls.reduce((n, e) => n + (e.usage?.[k] ?? 0), 0);
  return { calls: calls.length, notDispatched: (state.notDispatched || []).length, byKind: calls.map(e => `${e.kind}:${e.outcome}`), inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens'), cacheReadInputTokens: sum('cacheReadInputTokens'), cacheCreationInputTokens: sum('cacheCreationInputTokens'),
    wallMs: calls.reduce((n, e) => n + (e.wallMs ?? 0), 0), allowanceAfterLastCall: calls.at(-1)?.usage?.allowanceAfter ?? null, status: state.status ?? 'pending' };
}
