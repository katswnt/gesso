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

export const CONTROLLER_VERSION = 'teachingV2Controller/2';
export const BINDING_VERSION = 'teachingV2CandidateBinding/1';
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
export function candidateBinding({ work, packet, texts, gold, renderer = null }) {
  const ctx = workContext({ work, packet, gold });
  return {
    version: BINDING_VERSION, workId: work.id, origin: work.origin,
    catalogSha256: sha256(stableJson(work.catalog ?? null)), legacySha256: sha256(stableJson(work.legacy ?? null)),
    image: { sha256: work.image?.sha256 ?? null, ext: work.image?.ext ?? null, width: work.image?.width ?? null, height: work.image?.height ?? null, transform: work.image?.transform ?? null },
    receipts: work.receipts ?? null,
    packetSha256: packetHash(packet), textsSha256: sha256(stableJson(texts ?? null)),
    gold: gold.sha256, writerPromptSha256: sha256(writerPromptFor(ctx)),
    wire: WIRE_SCHEMA_HASHES(), model: MODEL, efforts: STAGE_EFFORT, classifier: CLASSIFIER_VERSION,
    versions: { contract: CONTRACT_VERSION, controller: CONTROLLER_VERSION, prompts: PROMPT_VERSION, writerCore: WRITER_CORE_SHA256, verifierCore: VERIFIER_CORE_SHA256, projection: PROJECTION_VERSION },
    renderer,
  };
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

// One work. state is mutated and handed to save() after every step (resume-safe).
export async function runWork({ work, packet, texts, gold, state, invoke, gate = async () => {}, attempts = null, save = () => {}, render = null, finalize = null, binding = null, now = () => new Date() }) {
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
  const finish = (status, extra = {}) => { Object.assign(state, { status, finishedAt: now().toISOString(), ...extra }); save(state); return state; };

  // ---- reconcile interrupted reservations from their exclusive transcripts ----
  const pending = new Map();
  for (const e of state.ledger) {
    if (e.outcome !== 'reserved') continue;
    const r = attempts?.recover ? await attempts.recover(e) : null;
    if (!r) { e.outcome = 'unknown'; e.detail = 'reservation without a recoverable transcript; retained for review'; save(state); throw new LatchStop(`${work.id}/${e.kind} attempt ${e.seq}: unknown outcome`, 'unknown-outcome'); }
    Object.assign(e, { outcome: r.kind, detail: `reconstructed: ${r.reason ?? 'ok'}`, usage: r.usage ?? null, transcriptSha256: r.transcriptSha256 ?? null, structuredSha256: r.structured == null ? null : sha256(stableJson(r.structured)) });
    save(state);
    if (r.kind === 'fatal') { finish('hold', { holdReasons: [`confinement/provenance: ${r.reason}`], stage: e.kind }); throw new LatchStop(`fatal ${work.id}/${e.kind}: ${r.reason}`, 'fatal'); }
    if (r.kind === 'ok') pending.set(e.seq, r);
    else if (r.kind === 'content-failure' || r.kind === 'interrupted') return finish('hold', { holdReasons: [`${e.kind} ${r.kind}: ${r.reason ?? ''}`.trim(), 'no retry: not a proven transient failure'], stage: e.kind });
  }
  // A stored artifact must reproduce from its own transcript, and still validate, before it is reused.
  const reproduce = async (seq, stored) => {
    if (!attempts?.recover) return;
    const e = state.ledger.find(x => x.seq === seq);
    const r = e ? await attempts.recover(e) : null;
    if (!r || r.kind !== 'ok' || stableJson(r.structured) !== stableJson(stored)) throw new BindingChanged(`${work.id}: stored result of attempt ${seq} does not reproduce from its transcript`);
  };

  const pf = preflight({ work, packet, texts });
  if (isTerminal(state)) {
    for (const a of ['writer', 'verify', 'verify2']) if (state.artifacts[a]?.seq) await reproduce(state.artifacts[a].seq, state.artifacts[a].result);
    return state;
  }
  if (!pf.ok) return finish('hold', { holdReasons: pf.reasons, stage: 'preflight' });
  const ctx = workContext({ work, packet, gold });
  state.inputs = { bindingSha256: state.bindingSha256, b3Rejected: ctx.b3Candidates.rejected };

  // A call with its budget, transient retry and pause semantics. Returns the ok call or null (terminal hold set).
  const call = async (kind, reason, promptText, wireSchema) => {
    const reco = [...pending.entries()].find(([seq]) => state.ledger.find(x => x.seq === seq)?.kind === kind);
    if (reco) { pending.delete(reco[0]); return { ...reco[1], seq: reco[0] }; }
    const last = state.ledger.at(-1);
    let req = last && last.kind === kind && TRANSIENT_OUTCOMES.includes(last.outcome) ? { kind, reason: 'transportRetry' } : { kind, reason };
    for (;;) {
      const a = authorizeCall(state.ledger, req);
      if (!a.ok) { finish('hold', { holdReasons: [a.reason], stage: kind }); return null; }
      await gate(kind); // pacing, lease, latch: a refusal leaves NO ledger entry (never dispatched)
      const seq = 1 + Math.max(0, ...state.ledger.map(x => x.seq || 0), ...(state.notDispatched || []).map(x => x.seq || 0)); // never reuse an attempt number
      const entry = { seq, kind, reason: req.reason, at: now().toISOString(), promptSha256: sha256(promptText), promptBytes: Buffer.byteLength(promptText, 'utf8'), bindingSha256: state.bindingSha256, outcome: 'reserved' };
      state.ledger.push(entry); save(state);
      if (attempts?.reserve) {
        try { await attempts.reserve(entry, promptText); }
        catch (e) { state.ledger.pop(); (state.notDispatched ||= []).push({ ...entry, outcome: 'not-dispatched', detail: String(e.message).slice(0, 200) }); save(state); throw new PauseRun(`reservation not persisted; nothing dispatched: ${e.message}`); }
      }
      const r = await invoke(kind, { promptText, wireSchema, reason: req.reason, seq: entry.seq }); // a throw leaves the entry reserved -> reconciled on resume
      Object.assign(entry, { outcome: r.kind, detail: r.reason ?? null, usage: r.usage ?? null, wallMs: r.wallMs ?? null, transcriptSha256: r.transcriptSha256 ?? null, structuredSha256: r.structured == null ? null : sha256(stableJson(r.structured)) });
      save(state);
      if (r.kind === 'fatal') { finish('hold', { holdReasons: [`confinement/provenance: ${r.reason}`], stage: kind }); throw new LatchStop(`fatal ${work.id}/${kind}: ${r.reason}`, 'fatal'); }
      if (r.kind === 'usage-limit') throw new PauseRun('subscription usage limit (attempt counted)');
      if (r.kind === 'transport-failure') { req = { kind, reason: 'transportRetry' }; continue; }
      if (r.kind !== 'ok') { finish('hold', { holdReasons: [`${kind} ${r.kind}: ${r.reason ?? ''}`.trim(), 'no retry: not a proven transient failure'], stage: kind }); return null; }
      return { ...r, seq: entry.seq };
    }
  };
  const setOutcome = (seq, outcome) => { const e = state.ledger.find(x => x.seq === seq); if (e) e.outcome = outcome; };

  // ---- W ----
  let wr = state.artifacts.writer?.result ?? null;
  if (wr) { await reproduce(state.artifacts.writer.seq, wr); const v = validateWriterResult(wr, { packet, b1EvidenceIds: b1EvidenceIds(work.b1) }); if (!v.ok || v.hold) throw new BindingChanged(`${work.id}: stored writer result no longer validates`); }
  else {
    const r = await call('W', 'planned', writerPromptFor(ctx), WRITER_RESULT_WIRE);
    if (!r) return state;
    const v = validateWriterResult(r.structured, { packet, b1EvidenceIds: b1EvidenceIds(work.b1) });
    state.artifacts.writer = { seq: r.seq, result: r.structured, valid: v.ok, errors: v.errors.slice(0, 20), located: v.located };
    setOutcome(r.seq, v.ok ? (v.hold ? 'hold' : 'candidate') : 'invalid');
    if (!v.ok) return finish('hold', { holdReasons: ['writer output failed strict validation (no schema-fix retry)', ...v.errors.slice(0, 5)], stage: 'W' });
    if (v.hold) return finish('hold', { holdReasons: ['writer hold', ...r.structured.draft.holdReasons], stage: 'W' });
    wr = r.structured; save(state);
  }
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

  // ---- V ----
  let vo = state.artifacts.verify?.outcome ?? null;
  if (vo) await reproduce(state.artifacts.verify.seq, state.artifacts.verify.result);
  else {
    const r = await call('V', 'planned', verifierPromptFor(ctx, { allowReplacement: true, dossier, draft: wr.draft, current: pv.current }), VERIFICATION_WIRE);
    if (!r) return state;
    vo = verificationOutcome(r.structured, { draft: wr.draft, allowReplacement: true, packet, dossier });
    state.artifacts.verify = { seq: r.seq, result: r.structured, outcome: vo };
    setOutcome(r.seq, vo.decision); save(state);
  }
  const accept = (source, draft, tag, minors) => {
    const proj = state.artifacts[`projection${tag}`];
    const payload = { version: 'teachingV2FinalPayload/1', workId: work.id, bindingSha256: state.bindingSha256, source, draftSha256: sha256(stableJson(draft)), projection: proj.projection, projectionSha256: proj.sha256 };
    if (finalize) {
      const reread = finalize(payload);
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
  let v2 = state.artifacts.verify2?.outcome ?? null;
  if (v2) await reproduce(state.artifacts.verify2.seq, state.artifacts.verify2.result);
  else {
    const r = await call('V2', 'v2', verifierPromptFor(ctx, { allowReplacement: false, dossier, draft: replacement, current: pv2.current }), VERIFICATION_NO_REPLACEMENT_WIRE);
    if (!r) return state;
    v2 = verificationOutcome(r.structured, { draft: replacement, allowReplacement: false, packet, dossier });
    state.artifacts.verify2 = { seq: r.seq, result: r.structured, outcome: v2 };
    setOutcome(r.seq, v2.decision); save(state);
  }
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
