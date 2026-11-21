// Teaching-v2 confined image stages W / V / V2 (+ the B3D coordinate diagnostic) via subscription `claude -p`
// (VSD-093; design draft 2 §3.1/§3.4). Builds the command and classifies a finished transcript; the actual
// spawn is injected (execToFile) and only ever runs from the runner under an explicit live authorization.
// These stage names deliberately do NOT go through buildStageCommand, whose B4/B5 branch forces --effort low
// (pass-b-calibration.mjs:355); every other confinement flag is the same, and a test asserts the flag set.
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sha256, stableJson } from './vision-legacy.mjs';
import { parseStreamTranscript, transcriptFinal, verifyB1ImageRead, neutralImageFile, RUN_ROOT } from './pass-b-calibration.mjs';
import { rateLimitFrom } from './pass-b-pacing.mjs';
import { noToolCallProvenance } from '../pass-b-b4-structured-canary.mjs';
import { MODEL } from './teaching-v2-contract.mjs';

export const STAGE_EFFORT = Object.freeze({ W: 'high', V: 'high', V2: 'high', B3D: 'medium' });
export const IMAGE_TRANSPORT = 'readtool-confined-dir/1';
export const CLASSIFIER_VERSION = 'teachingV2Classifier/5';
// The shared confinement flags, identical to buildStageCommand's (asserted by tests/teaching-v2.test.mjs).
export const CONFINED_FLAGS = Object.freeze(['--prompt-suggestions', 'false', '--safe-mode', '--restricted', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
  '--no-chrome', '--disable-slash-commands', '--permission-mode', 'dontAsk', '--no-session-persistence', '--output-format', 'stream-json', '--verbose']);
export const REMOVE_ENV = Object.freeze(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']);
// The exact capability policy of every teaching-v2 image stage: these two tools, no MCP server, dontAsk.
export const STAGE_TOOLS = Object.freeze(['Read', 'StructuredOutput']);
// The SAME observation ledger the corpus collector paces from (pass-b-corpus-collect.mjs USAGE_LOG; a test asserts it).
export const SHARED_USAGE_LOG = join(RUN_ROOT, '..', 'vision-ops', 'usage-observations.jsonl');
const CALL_DIR_RE = /\/tv2-call-[^/]+$/;

export function buildConfinedCommand({ stage, promptText, imageFile, wireSchema, model = MODEL }) {
  if (!STAGE_EFFORT[stage]) throw new Error(`unknown teaching-v2 stage ${stage}`);
  if (!/^[0-9a-f]{64}\.[a-z0-9]{1,5}$/.test(imageFile || '')) throw new Error(`${stage} requires a bare <sha>.<ext> confined image`);
  if (!wireSchema || wireSchema.type !== 'object' || wireSchema.additionalProperties !== false) throw new Error(`${stage} needs a strict wire schema`);
  if (model !== MODEL) throw new Error(`teaching-v2 requests ${MODEL} only (got ${model})`);
  const argv = ['-p', promptText, '--model', model, '--tools', 'Read', '--allowedTools', 'Read', '--effort', STAGE_EFFORT[stage], '--json-schema', JSON.stringify(wireSchema), ...CONFINED_FLAGS];
  return { bin: 'claude', argv, env: { removeKeys: [...REMOVE_ENV], set: { DISABLE_AUTOUPDATER: '1' } }, stage, imageFile, effort: STAGE_EFFORT[stage],
    promptSha256: sha256(promptText), promptBytes: Buffer.byteLength(promptText, 'utf8'), wireSchemaSha256: sha256(stableJson(wireSchema)) };
}

// Every nonempty line is either a JSON event object (string `type`) or a MALFORMED record (review R3-A2): a
// truncated or unparseable line, or JSON that is not an event. Discarded bytes are tracked, never ignored.
export function parseRecords(stdout) {
  const evs = [], malformed = [];
  String(stdout).split('\n').forEach((l, i) => {
    if (!l.trim()) return;
    let e; try { e = JSON.parse(l); } catch { malformed.push({ line: i + 1, bytes: Buffer.byteLength(l, 'utf8'), why: 'unparseable' }); return; }
    if (e && typeof e === 'object' && !Array.isArray(e) && typeof e.type === 'string') evs.push(e);
    else malformed.push({ line: i + 1, bytes: Buffer.byteLength(l, 'utf8'), why: 'not an event object' });
  });
  return { evs, malformed };
}
const events = stdout => parseRecords(stdout).evs;
// Every *tool_use block anywhere in an envelope (tool_use, server_tool_use, mcp_tool_use, streamed content_block).
function toolEvents(evs) {
  const out = [];
  const visit = v => {
    if (Array.isArray(v)) { v.forEach(visit); return; }
    if (!v || typeof v !== 'object') return;
    if (typeof v.type === 'string' && /tool_use$/.test(v.type)) out.push({ type: v.type, name: v.name ?? null });
    if (typeof v.type === 'string' && /_tool_result$/.test(v.type)) out.push({ type: v.type, name: null }); // web_search_tool_result etc.
    for (const k of ['event', 'message', 'content', 'content_block']) visit(v[k]);
  };
  evs.forEach(visit);
  return out;
}
// Review R3-A2: ONE normalized list of tool invocations WITH their inputs, from every supported envelope:
//   - complete blocks anywhere under message / content (assistant messages, nested messages);
//   - streamed blocks (stream_event content_block_start). Their input is the start block's input or, when
//     input_json_delta fragments follow for that block index, the parse of the concatenated fragments.
// Review R4-A1: a streamed block ends in one of three states.
//   - resolved   : the fragments parse to an object, or the block was closed (content_block_stop) with its start input;
//   - unresolved : the block was CLOSED but its fragments do not parse to an object (a completed invocation whose
//                  input cannot be verified: never a pass);
//   - unfinished : the stream ended before the block closed and before its input was established (the `{}` start
//                  placeholder with no delta, or a partial prefix such as `{`). Kept with its raw `partial` text. It
//                  is NOT a completed invocation; confinedReads decides what, if anything, it proves.
// A complete block with the same id and name RECONCILES a streamed block: an identical resolved input, or an unfinished
// placeholder/prefix consistent with the complete input, is the same invocation and is kept once. Anything else is
// conflicting evidence: both are kept and the streamed copy is marked `conflict` (fatal for a Read).
export function normalizedToolUses(evs) {
  const uses = [];
  const add = (b, streamed) => { const u = { type: b.type, id: b.id ?? null, name: b.name ?? null, input: b.input ?? null, streamed, unresolved: false, unfinished: false, partial: null, conflict: false }; uses.push(u); return u; };
  const visit = v => {
    if (Array.isArray(v)) { v.forEach(visit); return; }
    if (!v || typeof v !== 'object') return;
    if (typeof v.type === 'string' && /tool_use$/.test(v.type)) add(v, false);
    for (const k of ['message', 'content', 'content_block']) visit(v[k]);
  };
  let open = new Map();
  const close = (idx, stopped) => {
    const b = open.get(idx); if (!b) return; open.delete(idx);
    const u = b.use, raw = b.partial.join('');
    if (b.partial.length) { let v; try { v = JSON.parse(raw); } catch { v = undefined; } u.input = v; }
    const isObj = u.input && typeof u.input === 'object' && !Array.isArray(u.input);
    if (isObj && (b.partial.length || stopped || !isEmptyInput(u.input))) return; // resolved
    u.input = null; u.partial = raw;
    if (stopped) u.unresolved = true; else u.unfinished = true;
  };
  const closeAll = () => { [...open.keys()].forEach(i => close(i, false)); open = new Map(); };
  for (const e of evs) {
    if (e.type !== 'stream_event') { visit(e); continue; }
    const se = e.event && typeof e.event === 'object' ? e.event : {};
    if (se.type === 'message_start' || se.type === 'message_stop') closeAll();
    visit(se.message);
    const cb = se.content_block, idx = se.index ?? null;
    if (cb && typeof cb.type === 'string' && /tool_use$/.test(cb.type)) { close(idx, false); open.set(idx, { use: add(cb, true), partial: [] }); visit(cb.content); }
    else visit(cb);
    if (se.type === 'content_block_delta' && se.delta?.type === 'input_json_delta') open.get(idx)?.partial.push(String(se.delta.partial_json ?? ''));
    if (se.type === 'content_block_stop') close(idx, true);
  }
  closeAll();
  const complete = uses.filter(u => !u.streamed), seen = new Set();
  return uses.filter(u => {
    if (u.streamed && u.id != null) {
      const twins = complete.filter(c => c.id === u.id && c.name === u.name);
      if (twins.length) {
        if (twins.some(c => sameInvocation(u, c))) return false; // the complete block IS this invocation
        u.conflict = true; return true; // conflicting evidence: keep both
      }
    }
    if (u.id == null) return true;
    const k = `${u.id}\u0000${u.input == null ? `partial:${u.partial}` : stableJson(u.input)}`;
    if (seen.has(k)) return false; seen.add(k); return true;
  });
}
const isEmptyInput = v => v == null || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);
// A streamed block and a complete block are the same invocation when the streamed input equals the complete one, or
// when the streamed block is UNFINISHED and everything it had established agrees with the complete input.
function sameInvocation(s, c) {
  if (s.unresolved) return false; // a closed block whose input does not parse matches nothing
  if (!s.unfinished) return stableJson(s.input) === stableJson(c.input);
  if (/^\s*\{?\s*$/.test(s.partial)) return true; // the `{}` placeholder (no delta) or the bare `{` prefix
  const p = partialFilePath(s.partial), fp = typeof c.input?.file_path === 'string' ? c.input.file_path : null;
  if (!p || fp == null) return false; // a prefix naming something other than a file path: do not guess
  return p.complete ? fp === p.path : fp.startsWith(p.path);
}
// The file_path an unfinished streamed Read had begun to name: { path, complete } or null when none was started
// (the same reading as the stopgap's pass-b-calibration.mjs fix, b629ced).
function partialFilePath(raw) {
  const m = /"file_path"\s*:\s*"((?:[^"\\]|\\.)*)(\\?)("?)/.exec(String(raw || ''));
  if (!m) return null;
  let path = m[1]; try { path = JSON.parse(`"${m[1]}"`); } catch { /* keep the raw prefix */ }
  return { path, complete: m[3] === '"' };
}
const resolveIn = (dir, p) => (p.startsWith('/') || !dir ? p : `${String(dir).replace(/\/+$/, '')}/${p.replace(/^\.\//, '')}`);
// Every tool_result id anywhere in the stream: the invocations that EXECUTED.
function executedIds(evs) {
  const ids = new Set();
  const visit = v => {
    if (Array.isArray(v)) { v.forEach(visit); return; }
    if (!v || typeof v !== 'object') return;
    if (typeof v.type === 'string' && /tool_result$/.test(v.type) && v.tool_use_id != null) ids.add(v.tool_use_id);
    for (const k of ['event', 'message', 'content', 'content_block']) visit(v[k]);
  };
  evs.forEach(visit);
  return ids;
}
// The image-receipt / confinement validator over that ONE normalized list: every Read from any envelope must name
// exactly the confined image; an unresolved Read input is never a pass. Review R4-A1, for an UNFINISHED streamed Read:
//   - it executed (a tool_result names its id): its input is unverifiable -> bad (fatal);
//   - the path it had begun to name already leaves the confined image path, or traverses -> bad (fatal);
//   - its complete path was streamed -> judged exactly like a complete Read;
//   - otherwise nothing outside was established: it is listed in `unfinished` and NEVER counts as a successful
//     inspection, so the call keeps its quota / interruption / exit classification.
// A streamed Read that conflicts with the complete block of the same id is bad (fatal); both stay on record.
function confinedReads(stdout, evs, { callDir, imageFile }) {
  const uses = normalizedToolUses(evs).filter(u => u.type === 'tool_use'), ran = executedIds(evs);
  const wantAbs = callDir ? norm(resolveIn(callDir, imageFile)) : null;
  const judged = [], unverified = [], unfinished = [];
  for (const u of uses) {
    if (u.name !== 'Read' || (!u.unresolved && !u.unfinished && !u.conflict)) { judged.push(u); continue; }
    if (u.conflict) { unverified.push(`<streamed Read ${u.id} conflicts with its completed block>`); if (u.input != null) judged.push(u); continue; }
    if (u.unresolved) { unverified.push(`<unresolved streamed Read input ${u.id ?? 'without id'}>`); continue; }
    if (u.id != null && ran.has(u.id)) { unverified.push(`<executed streamed Read ${u.id} with unverifiable input>`); continue; }
    const p = partialFilePath(u.partial);
    if (p?.complete) { judged.push({ ...u, input: { file_path: p.path } }); continue; }
    if (p && (p.path.includes('..') || !wantAbs || !wantAbs.startsWith(norm(resolveIn(callDir, p.path))))) { unverified.push(`${p.path}…`); continue; }
    unfinished.push(u.id ?? 'without id');
  }
  const read = verifyB1ImageRead({ ...parseStreamTranscript(stdout), toolUses: judged }, { callDir, imageBasename: imageFile });
  if (!unverified.length) return { ...read, unfinished };
  const bad = [...read.bad, ...unverified];
  return { ...read, unfinished, ok: false, bad, reason: read.bad.length ? `read target escaped confinement: ${bad.join(', ')}` : `read target unresolved: ${unverified.length} streamed Read input(s) could not be verified: ${unverified.join(', ')}` };
}
const usageLimitedEv = (evs, final) => evs.some(e => e.type === 'rate_limit_event' && e.rate_limit_info?.status === 'rejected')
  || final?.api_error_status === 429 || (final?.is_error === true && /usage limit|spend limit|rate.?limit|quota/i.test(String(final?.result || '')));
const norm = p => String(p || '').replace(/^\/private(?=\/)/, '');

// Init-independent activity policy (review R2-1): any tool event outside the stage policy, or any server-tool usage
// counter, anywhere in the stream. Checked first, with or without an init event.
function activityViolation(evs) {
  const bad = toolEvents(evs).filter(t => t.type !== 'tool_use' || !STAGE_TOOLS.includes(t.name));
  if (bad.length) return `forbidden tool activity: ${[...new Set(bad.map(t => `${t.type}:${t.name || 'unnamed'}`))].join(',')}`;
  for (const r of evs.filter(e => e.type === 'result')) {
    const stu = r.usage?.server_tool_use || {};
    if (Object.values(stu).some(n => Number(n) > 0)) return `server tool use recorded in usage: ${JSON.stringify(stu)}`;
    if (Object.values(r.modelUsage || {}).some(u => Number(u?.webSearchRequests) > 0 || Number(u?.webFetchRequests) > 0)) return 'server tool requests recorded in modelUsage';
  }
  return null;
}
export const validExitCode = c => c === 'timeout' || Number.isInteger(c);
const malformedReason = m => `${m.length} malformed or non-event transcript record(s) (first at line ${m[0].line}: ${m[0].why}); activity and confinement unverifiable`;
// Affirmative evidence that no session ran: the stream holds only rate-limit notices and error results that
// explicitly report zero turns, no generated output and no structured output (an empty stream qualifies).
// Any other event (assistant, user, stream_event, tool activity, a result without num_turns === 0) is activity.
export function noSessionActivity(evs) {
  if (toolEvents(evs).length) return false;
  return evs.every(e => e.type === 'rate_limit_event'
    || (e.type === 'result' && e.is_error === true && e.num_turns === 0 && !(Number(e.usage?.output_tokens) > 0) && e.structured_output == null));
}

// Capability policy for every init event and every tool event. Returns the first violation or null.
// Fatal precedence: this runs BEFORE any usage/transport/content classification.
export function capabilityViolation(stdout, { callDir = null, imageFile, model = MODEL, runtimeVersion }) {
  const { evs, malformed } = parseRecords(stdout), inits = evs.filter(e => e.type === 'system' && e.subtype === 'init');
  const allowed = stableJson([...STAGE_TOOLS].sort());
  for (const i of inits) {
    if (i.apiKeySource !== 'none') return `apiKeySource must be none (subscription only), got ${i.apiKeySource ?? 'missing'}`;
    if (i.model !== model) return `init model ${i.model ?? 'missing'} != ${model}`;
    if (!runtimeVersion) return 'no pinned CLI runtime version to check';
    if (i.claude_code_version !== runtimeVersion) return `CLI runtime ${i.claude_code_version ?? 'missing'} != pinned ${runtimeVersion}`;
    if (!Array.isArray(i.tools) || stableJson([...i.tools].sort()) !== allowed) return `init advertises tools [${(i.tools || []).join(', ')}], policy is exactly [${STAGE_TOOLS.join(', ')}]`;
    if (i.mcp_servers != null && (!Array.isArray(i.mcp_servers) || i.mcp_servers.length)) return 'init advertises MCP servers';
    if (i.permissionMode != null && i.permissionMode !== 'dontAsk') return `init permission mode ${i.permissionMode}`;
    if (callDir && norm(i.cwd) !== norm(callDir)) return 'init cwd is not the confined call directory';
    if (!callDir && !CALL_DIR_RE.test(norm(i.cwd))) return 'init cwd is not a teaching-v2 call directory';
  }
  const act = activityViolation(evs);
  if (act) return act;
  if (malformed.length) return malformedReason(malformed);
  const dir = callDir || norm(inits[0]?.cwd) || null;
  const read = confinedReads(stdout, evs, { callDir: dir, imageFile });
  if (read.bad.length) return `confinement: ${read.reason}`;
  return null;
}

// Classify one finished call from its raw stream-json bytes. kinds:
//   ok                 - provenance, confinement, exact image receipt and structured output all verified
//   fatal              - confinement/provenance/capability breach: latches the whole run
//   usage-limit        - the subscription refused service: counted, pauses the run, retry only as the one extra
//   transport-failure  - PROVEN transient: process failed before any session, or the provider refused (5xx/529
//                        placeholder, nothing generated). The only kind the one transient retry may repeat.
//   content-failure    - the call ran and produced no acceptable output (schema retries exhausted, refusal,
//                        max turns, missing structured output, a non-transient API error). Holds; never retried.
//   interrupted        - timeout or mid-call death: outcome not proven transient. Holds; never retried.
// exitCode is REQUIRED (review R3-A1): an integer or 'timeout' from the attempt's own exit receipt. A missing
// receipt is never read as 0; a caller without one has an unknown outcome and must not classify.
export function classifyTranscript(stdout, { exitCode, callDir = null, imageFile, model = MODEL, runtimeVersion }) {
  if (!validExitCode(exitCode)) throw new TypeError(`classifyTranscript needs the recorded exit status (got ${JSON.stringify(exitCode ?? null)}); a missing exit receipt is an unknown outcome`);
  const { evs, malformed } = parseRecords(stdout), tr = parseStreamTranscript(stdout), final = transcriptFinal(tr);
  const inits = evs.filter(e => e.type === 'system' && e.subtype === 'init');
  const usage = usageOf(final, stdout);
  const out = (kind, reason) => ({ kind, reason, usage, classifier: CLASSIFIER_VERSION, toolUses: normalizedToolUses(evs).map(u => u.name), structured: kind === 'ok' ? final.structured_output : null, initCwd: inits[0]?.cwd ?? null, malformedRecords: malformed.length });
  // Review R2-1: ALL activity is inspected before ANY outcome branch. Forbidden activity is fatal whether or not
  // there is an init, whatever the exit code or quota message.
  const forbidden = activityViolation(evs);
  if (forbidden) return out('fatal', forbidden);
  // Review R3-A2: bytes that are not a parseable event (a truncated line, non-event JSON) may carry activity nothing
  // above could inspect. They never support "no session ran", nor confinement: fatal, for review.
  if (malformed.length) return out('fatal', malformedReason(malformed));
  if (!inits.length) {
    // A missing init does not prove that nothing ran. Only AFFIRMATIVE evidence of no session activity (see
    // noSessionActivity) may become a pre-session usage limit or transport failure; anything else is fatal.
    if (!noSessionActivity(evs)) return out('fatal', 'session activity without an init event (provenance and confinement unverifiable)');
    if (usageLimitedEv(evs, final)) return out('usage-limit', 'subscription usage limit before any session');
    if (exitCode === 'timeout') return out('interrupted', 'timeout before init');
    if (exitCode && exitCode !== 0) return out('transport-failure', `process exit ${exitCode} before init (no session activity)`);
    return out('fatal', 'no init event (provenance unverifiable)');
  }
  const violation = capabilityViolation(stdout, { callDir, imageFile, model, runtimeVersion });
  if (violation) return out('fatal', violation);
  const prov = noToolCallProvenance(stdout, exitCode, { allowedTools: [...STAGE_TOOLS], expectedModel: model });
  if (prov.kind === 'fatal') return out('fatal', prov.errors.join('; ') || 'provenance');
  if (prov.kind === 'usage-limit' || usageLimitedEv(evs, final)) return out('usage-limit', 'subscription usage limit');
  if (prov.kind === 'api-error') {
    const status = String(prov.errors[0] || '').split(':')[1];
    return Number(status) >= 500 || status === 'unknown' ? out('transport-failure', `provider error ${status}; nothing generated`) : out('content-failure', `provider error ${status}`);
  }
  if (exitCode === 'timeout') return out('interrupted', 'process timeout (never retried automatically)');
  if (!final) return out('interrupted', `no result event (exit ${exitCode}); outcome not proven transient`);
  if (final.is_error || (final.subtype && final.subtype !== 'success')) return out('content-failure', `result ${final.subtype || 'error'}${final.stop_reason ? `/${final.stop_reason}` : ''}`);
  if (prov.errors.includes('multiple-StructuredOutput-emissions')) return out('content-failure', 'multiple StructuredOutput emissions');
  const read = confinedReads(stdout, evs, { callDir: callDir || norm(inits[0].cwd), imageFile });
  if (!read.ok) return out('fatal', `image not inspected: ${read.reason}`); // an image stage must prove it saw the pixels
  // Review R4-A1: a session reporting success while a Read invocation never finished streaming is not a clean success.
  // It proves no outside read (so not a confinement fatal), but it is held, never accepted and never retried.
  if (read.unfinished.length) return out('content-failure', `unfinished streamed Read invocation(s) ${read.unfinished.join(', ')} in a completed session`);
  if (final.structured_output == null) return out('content-failure', 'no structured_output');
  if (exitCode && exitCode !== 0) return out('content-failure', `process exit ${exitCode} after a result`);
  return out('ok', null);
}
export function usageOf(final, stdout) {
  const u = final?.usage || {};
  return {
    inputTokens: u.input_tokens ?? null, outputTokens: u.output_tokens ?? null, cacheReadInputTokens: u.cache_read_input_tokens ?? null, cacheCreationInputTokens: u.cache_creation_input_tokens ?? null,
    modelUsage: final?.modelUsage ?? null, numTurns: final?.num_turns ?? null, durationMs: final?.duration_ms ?? null, apiEquivalentUsd: final?.total_cost_usd ?? null,
    allowanceAfter: rateLimitFrom(stdout),
  };
}

// One confined invocation. The call directory holds ONLY the sanitized SHA image; stdout goes to a file (VSD-075).
export async function runConfined(command, { imagePath, execute, runtimeVersion, bin = command.bin, timeoutMs = 30 * 60 * 1000 }) {
  const call = mkdtempSync(join(tmpdir(), 'tv2-call-'));
  const t0 = Date.now();
  try {
    copyFileSync(imagePath, join(call, command.imageFile));
    const env = { ...process.env, ...command.env.set }; for (const k of command.env.removeKeys) delete env[k];
    let stdout = '', exitCode = 0;
    try { ({ stdout } = await execute(bin, command.argv, { cwd: call, env, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 })); }
    catch (e) { exitCode = e.killed ? 'timeout' : (Number.isInteger(e.code) ? e.code : 1); stdout = e.stdout || ''; } // a spawn/signal error code is a nonzero exit
    const cls = classifyTranscript(stdout, { exitCode, callDir: call, imageFile: command.imageFile, runtimeVersion });
    return { ...cls, stdout, exitCode, callDir: call, wallMs: Date.now() - t0, transcriptSha256: sha256(stdout) };
  } finally { rmSync(call, { recursive: true, force: true }); }
}
export { neutralImageFile };
