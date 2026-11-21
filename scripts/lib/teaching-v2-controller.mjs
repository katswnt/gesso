// Teaching-v2 Phase A per-work controller (VSD-093; design draft 2 §3.3 sequence, §3.4 budget). Deterministic
// control flow with an INJECTED invoke(), so the whole W -> project -> V -> (V2) path, the attempt budget and
// the pass/hold rules are testable without any model call. The controller owns ids, hashes and statuses; a
// model verdict never approves anything: the best outcome is "accepted-for-review" (owner/Codex review next).
import { sha256, stableJson } from './vision-legacy.mjs';
import { validatePacketIntegrity, validateWriterResult, verificationOutcome, authorizeCall, WRITER_RESULT_WIRE, VERIFICATION_WIRE, VERIFICATION_NO_REPLACEMENT_WIRE } from './teaching-v2-contract.mjs';
import { buildWriterPrompt, buildVerifierPrompt } from './teaching-v2-prompts.mjs';
import { projectLesson, validateProjection, renderManifest } from './teaching-v2-projection.mjs';
import { b1EvidenceIds, catalogConflicts, importB3Candidates } from './teaching-v2-inputs.mjs';

export const CONTROLLER_VERSION = 'teachingV2Controller/1';
export class PauseRun extends Error { constructor(reason) { super(reason); this.name = 'PauseRun'; } }
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
export function verifierPromptFor(ctx, { allowReplacement, dossier, draft, visPins = [] }) {
  const proj = projectLesson(draft.lesson);
  return buildVerifierPrompt({ allowReplacement, gold: ctx.gold, catalog: ctx.catalog, b1: ctx.b1, packet: ctx.packet, conflicts: ctx.conflicts, b3Candidates: ctx.b3Candidates.kept, dossier, draft, projection: renderManifest(proj, { visPins }), imageFile: ctx.imageFile });
}

// Deterministic preflight: anything detectable before W stops before spending.
export function preflight({ work, packet, texts }) {
  const reasons = [];
  if (!work.b1) reasons.push('no reusable B1 inventory');
  if (!work.image?.sha256) reasons.push('no sanitized image');
  if (work.b1 && work.b1.imageFitness?.imageState === 'blocked') reasons.push('B1 marked the image blocked');
  const integ = validatePacketIntegrity(packet, texts);
  if (!integ.ok) reasons.push(`packet integrity: ${integ.errors[0]}`);
  if (!(packet?.sources || []).some(s => s.status === 'captured' && s.sections.length)) reasons.push('no literal source text captured (missing literal evidence stops before W)');
  return { ok: reasons.length === 0, reasons };
}

// One work. state is mutated and handed to save() after every step (resume-safe). invoke(stage, {promptText,
// wireSchema, reason}) returns a classified call {kind, reason, structured, usage, wallMs, transcriptSha256,...}.
export async function runWork({ work, packet, texts, gold, state, invoke, save = () => {}, visPins = [], now = () => new Date() }) {
  if (isTerminal(state)) return state;
  state.ledger ||= []; state.artifacts ||= {};
  // A reservation with no recorded outcome (crash mid-call) is conservatively a spent transport failure.
  for (const e of state.ledger) if (e.outcome === 'reserved') Object.assign(e, { outcome: 'transport-failure', detail: 'reservation without outcome (interrupted); counted as spent' });
  const finish = (status, extra = {}) => { Object.assign(state, { status, finishedAt: now().toISOString(), ...extra }); save(state); return state; };
  const pf = preflight({ work, packet, texts });
  if (!pf.ok) return finish('hold', { holdReasons: pf.reasons, stage: 'preflight' });
  const ctx = workContext({ work, packet, gold });
  state.inputs = { b1Sha256: sha256(stableJson(work.b1)), packetSha256: packet.packetSha256, imageSha256: work.image.sha256, goldSha256: gold.sha256, b3Rejected: ctx.b3Candidates.rejected };

  // A call with its budget, transport retry and pause semantics. Returns the ok call or null (terminal hold set).
  const call = async (kind, reason, promptText, wireSchema) => {
    const last = state.ledger.at(-1);
    let req = last && last.kind === kind && last.outcome === 'transport-failure' ? { kind, reason: 'transportRetry' } : { kind, reason };
    for (;;) {
      const a = authorizeCall(state.ledger, req);
      if (!a.ok) { finish('hold', { holdReasons: [a.reason], stage: kind }); return null; }
      const entry = { kind, reason: req.reason, at: now().toISOString(), promptSha256: sha256(promptText), promptBytes: Buffer.byteLength(promptText, 'utf8'), outcome: 'reserved' };
      state.ledger.push(entry); save(state); // reservation persisted BEFORE the call
      const r = await invoke(kind, { promptText, wireSchema, reason: req.reason });
      Object.assign(entry, { outcome: r.kind === 'ok' ? 'ok' : r.kind, detail: r.reason ?? null, usage: r.usage ?? null, wallMs: r.wallMs ?? null, transcriptSha256: r.transcriptSha256 ?? null });
      if (r.kind === 'usage-limit') { entry.spent = false; save(state); throw new PauseRun('subscription usage limit'); }
      if (r.kind === 'fatal') { save(state); finish('hold', { holdReasons: [`confinement/provenance: ${r.reason}`], stage: kind }); throw new PauseRun(`fatal ${work.id}/${kind}: ${r.reason}`); }
      if (r.kind === 'transport-failure') { save(state); req = { kind, reason: 'transportRetry' }; continue; }
      save(state); return r;
    }
  };

  // ---- W ----
  let wr = state.artifacts.writer?.result ?? null;
  if (!wr) {
    const r = await call('W', 'planned', writerPromptFor(ctx), WRITER_RESULT_WIRE);
    if (!r) return state;
    const v = validateWriterResult(r.structured, { packet, b1EvidenceIds: b1EvidenceIds(work.b1) });
    state.artifacts.writer = { result: r.structured, valid: v.ok, errors: v.errors.slice(0, 20), located: v.located };
    state.ledger.at(-1).outcome = v.ok ? (v.hold ? 'hold' : 'candidate') : 'invalid';
    if (!v.ok) return finish('hold', { holdReasons: ['writer output failed strict validation (no schema-fix retry)', ...v.errors.slice(0, 5)], stage: 'W' });
    if (v.hold) return finish('hold', { holdReasons: ['writer hold', ...r.structured.draft.holdReasons], stage: 'W' });
    wr = r.structured; save(state);
  }
  const dossier = wr.dossier;
  const project = (draft, tag) => {
    const proj = projectLesson(draft.lesson); const pv = validateProjection(proj, draft.lesson);
    state.artifacts[`projection${tag}`] = { projection: proj, valid: pv.ok, errors: pv.errors, manifest: renderManifest(proj, { visPins }), sha256: sha256(stableJson(proj)) };
    return pv;
  };
  const pv = project(wr.draft, 'W');
  if (!pv.ok) return finish('hold', { holdReasons: ['projection invalid', ...pv.errors.slice(0, 5)], stage: 'projection' });

  // ---- V ----
  let vo = state.artifacts.verify?.outcome ?? null;
  if (!vo) {
    const r = await call('V', 'planned', verifierPromptFor(ctx, { allowReplacement: true, dossier, draft: wr.draft, visPins }), VERIFICATION_WIRE);
    if (!r) return state;
    vo = verificationOutcome(r.structured, { draft: wr.draft, allowReplacement: true, packet, dossier });
    state.artifacts.verify = { result: r.structured, outcome: vo };
    state.ledger.at(-1).outcome = vo.decision; save(state);
  }
  if (vo.decision === 'pass') return finish('accepted-for-review', { final: { source: 'W', draft: wr.draft, projectionSha256: state.artifacts.projectionW.sha256, minors: vo.minors } });
  if (vo.decision === 'hold') return finish('hold', { holdReasons: vo.reasons, stage: 'V' });

  // ---- V2: fresh recheck of the complete replacement (no previous verdict, no list of fixes) ----
  const replacement = vo.replacement;
  const pv2 = project(replacement, 'R');
  if (!pv2.ok) return finish('hold', { holdReasons: ['replacement projection invalid', ...pv2.errors.slice(0, 5)], stage: 'projection' });
  let v2 = state.artifacts.verify2?.outcome ?? null;
  if (!v2) {
    const r = await call('V2', 'v2', verifierPromptFor(ctx, { allowReplacement: false, dossier, draft: replacement, visPins }), VERIFICATION_NO_REPLACEMENT_WIRE);
    if (!r) return state;
    v2 = verificationOutcome(r.structured, { draft: replacement, allowReplacement: false, packet, dossier });
    state.artifacts.verify2 = { result: r.structured, outcome: v2 };
    state.ledger.at(-1).outcome = v2.decision; save(state);
  }
  if (v2.decision === 'pass') return finish('accepted-for-review', { final: { source: 'V-replacement', draft: replacement, projectionSha256: state.artifacts.projectionR.sha256, minors: v2.minors } });
  return finish('hold', { holdReasons: v2.reasons.length ? v2.reasons : ['V2 hold'], stage: 'V2' });
}

// Per-work telemetry row (tokens without double-counting thinking; allowance after each call; wall time).
export function telemetry(state) {
  const calls = (state.ledger || []).filter(e => e.spent !== false && e.outcome !== 'reserved');
  const sum = k => calls.reduce((n, e) => n + (e.usage?.[k] ?? 0), 0);
  return { calls: calls.length, byKind: calls.map(e => `${e.kind}:${e.outcome}`), inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens'), cacheReadInputTokens: sum('cacheReadInputTokens'), cacheCreationInputTokens: sum('cacheCreationInputTokens'),
    wallMs: calls.reduce((n, e) => n + (e.wallMs ?? 0), 0), allowanceAfterLastCall: calls.at(-1)?.usage?.allowanceAfter ?? null, status: state.status ?? 'pending' };
}
