// Teaching-v2 confined image stages W / V / V2 (+ the B3D coordinate diagnostic) via subscription `claude -p`
// (VSD-093; design draft 2 §3.1/§3.4). Builds the command and classifies a finished transcript; the actual
// spawn is injected (execToFile) and only ever runs from the runner under an explicit live authorization.
// These stage names deliberately do NOT go through buildStageCommand, whose B4/B5 branch forces --effort low
// (pass-b-calibration.mjs:355); every other confinement flag is the same, and a test asserts the flag set.
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sha256, stableJson } from './vision-legacy.mjs';
import { parseStreamTranscript, transcriptFinal, verifyB1ImageRead, answeringModel, neutralImageFile } from './pass-b-calibration.mjs';
import { rateLimitFrom } from './pass-b-pacing.mjs';
import { MODEL } from './teaching-v2-contract.mjs';

export const STAGE_EFFORT = Object.freeze({ W: 'high', V: 'high', V2: 'high', B3D: 'medium' });
export const IMAGE_TRANSPORT = 'readtool-confined-dir/1';
// The shared confinement flags, identical to buildStageCommand's (asserted by tests/teaching-v2.test.mjs).
export const CONFINED_FLAGS = Object.freeze(['--prompt-suggestions', 'false', '--safe-mode', '--restricted', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
  '--no-chrome', '--disable-slash-commands', '--permission-mode', 'dontAsk', '--no-session-persistence', '--output-format', 'stream-json', '--verbose']);
export const REMOVE_ENV = Object.freeze(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']);

export function buildConfinedCommand({ stage, promptText, imageFile, wireSchema, model = MODEL }) {
  if (!STAGE_EFFORT[stage]) throw new Error(`unknown teaching-v2 stage ${stage}`);
  if (!/^[0-9a-f]{64}\.[a-z0-9]{1,5}$/.test(imageFile || '')) throw new Error(`${stage} requires a bare <sha>.<ext> confined image`);
  if (!wireSchema || wireSchema.type !== 'object' || wireSchema.additionalProperties !== false) throw new Error(`${stage} needs a strict wire schema`);
  if (model !== MODEL) throw new Error(`teaching-v2 requests ${MODEL} only (got ${model})`);
  const argv = ['-p', promptText, '--model', model, '--tools', 'Read', '--allowedTools', 'Read', '--effort', STAGE_EFFORT[stage], '--json-schema', JSON.stringify(wireSchema), ...CONFINED_FLAGS];
  return { bin: 'claude', argv, env: { removeKeys: [...REMOVE_ENV], set: { DISABLE_AUTOUPDATER: '1' } }, stage, imageFile, effort: STAGE_EFFORT[stage],
    promptSha256: sha256(promptText), promptBytes: Buffer.byteLength(promptText, 'utf8'), wireSchemaSha256: sha256(stableJson(wireSchema)) };
}

// Classify one finished call from its raw stream-json bytes. kinds: ok | transport-failure | usage-limit | fatal.
// fatal = confinement/provenance (pauses the whole run); transport = process/API failure (one retry max, inside budget).
export function classifyTranscript(stdout, { exitCode, callDir, imageFile, model = MODEL }) {
  const tr = parseStreamTranscript(stdout), final = transcriptFinal(tr);
  const inits = String(stdout).split('\n').flatMap(l => { try { const e = JSON.parse(l); return e.type === 'system' && e.subtype === 'init' ? [e] : []; } catch { return []; } });
  const usage = usageOf(final, stdout);
  const out = (kind, reason) => ({ kind, reason, usage, toolUses: tr.toolUses.map(u => u.name), structured: kind === 'ok' ? final.structured_output : null });
  if (/usage limit|rate[_ ]limit.*(reached|exceeded)/i.test(String(final?.result || '')) && final?.is_error) return out('usage-limit', 'subscription usage limit');
  if (!inits.length) return out(exitCode ? 'transport-failure' : 'fatal', exitCode ? `process exit ${exitCode} before init` : 'no init event');
  if (inits.some(e => e.apiKeySource !== 'none')) return out('fatal', 'apiKeySource must be none (subscription only)');
  if (inits.some(e => e.model !== model)) return out('fatal', `init model ${inits.map(e => e.model).join(',')} != ${model}`);
  const read = verifyB1ImageRead(tr, { callDir, imageBasename: imageFile });
  if (read.bad.length) return out('fatal', `confinement: ${read.reason}`);
  const extra = tr.toolUses.filter(u => u.name !== 'Read' && u.name !== 'StructuredOutput');
  if (extra.length) return out('fatal', `forbidden tool use: ${[...new Set(extra.map(u => u.name))].join(',')}`);
  if (!final) return out('transport-failure', `no result event (exit ${exitCode})`);
  if (final.is_error || (final.subtype && final.subtype !== 'success')) return out('transport-failure', `result error (${final.subtype || 'is_error'})`);
  const answered = answeringModel(stdout, final);
  if (answered !== model) return out('fatal', `answering model ${answered} != ${model}`);
  if (!read.ok) return out('fatal', `image not inspected: ${read.reason}`); // an image stage must prove it saw the pixels
  if (final.structured_output == null) return out('transport-failure', 'no structured_output');
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
export async function runConfined(command, { imagePath, execute, timeoutMs = 30 * 60 * 1000 }) {
  const call = mkdtempSync(join(tmpdir(), 'tv2-call-'));
  const t0 = Date.now();
  try {
    copyFileSync(imagePath, join(call, command.imageFile));
    const env = { ...process.env, ...command.env.set }; for (const k of command.env.removeKeys) delete env[k];
    let stdout = '', exitCode = 0;
    try { ({ stdout } = await execute(command.bin, command.argv, { cwd: call, env, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 })); }
    catch (e) { exitCode = e.killed ? 'timeout' : (e.code ?? 1); stdout = e.stdout || ''; }
    const cls = classifyTranscript(stdout, { exitCode, callDir: call, imageFile: command.imageFile });
    return { ...cls, stdout, exitCode, wallMs: Date.now() - t0, transcriptSha256: sha256(stdout) };
  } finally { rmSync(call, { recursive: true, force: true }); }
}
export { neutralImageFile };
