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
export const CLASSIFIER_VERSION = 'teachingV2Classifier/3';
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

const events = stdout => String(stdout).split('\n').flatMap(l => { try { const e = JSON.parse(l); return e && typeof e === 'object' ? [e] : []; } catch { return []; } });
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
  const evs = events(stdout), inits = evs.filter(e => e.type === 'system' && e.subtype === 'init');
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
  const dir = callDir || norm(inits[0]?.cwd) || null;
  const read = verifyB1ImageRead(parseStreamTranscript(stdout), { callDir: dir, imageBasename: imageFile });
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
export function classifyTranscript(stdout, { exitCode, callDir = null, imageFile, model = MODEL, runtimeVersion }) {
  const evs = events(stdout), tr = parseStreamTranscript(stdout), final = transcriptFinal(tr);
  const inits = evs.filter(e => e.type === 'system' && e.subtype === 'init');
  const usage = usageOf(final, stdout);
  const out = (kind, reason) => ({ kind, reason, usage, classifier: CLASSIFIER_VERSION, toolUses: tr.toolUses.map(u => u.name), structured: kind === 'ok' ? final.structured_output : null, initCwd: inits[0]?.cwd ?? null });
  // Review R2-1: ALL activity is inspected before ANY outcome branch. Forbidden activity is fatal whether or not
  // there is an init, whatever the exit code or quota message.
  const forbidden = activityViolation(evs);
  if (forbidden) return out('fatal', forbidden);
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
  const prov = noToolCallProvenance(stdout, exitCode === 'timeout' ? 'timeout' : (exitCode ?? 0), { allowedTools: [...STAGE_TOOLS], expectedModel: model });
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
  const read = verifyB1ImageRead(tr, { callDir: callDir || norm(inits[0].cwd), imageBasename: imageFile });
  if (!read.ok) return out('fatal', `image not inspected: ${read.reason}`); // an image stage must prove it saw the pixels
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
    catch (e) { exitCode = e.killed ? 'timeout' : (e.code ?? 1); stdout = e.stdout || ''; }
    const cls = classifyTranscript(stdout, { exitCode, callDir: call, imageFile: command.imageFile, runtimeVersion });
    return { ...cls, stdout, exitCode, callDir: call, wallMs: Date.now() - t0, transcriptSha256: sha256(stdout) };
  } finally { rmSync(call, { recursive: true, force: true }); }
}
export { neutralImageFile };
