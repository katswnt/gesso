// VSD-072 (2026-11-05 incident): "API Error: 529 Overloaded" after the CLI's own retries ends the call with a
// placeholder assistant message (model "<synthetic>", zero tokens). That is the provider refusing service, not a
// provenance failure: a clean stop, never a fatal. Anything short of the exact placeholder shape still fails closed.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deriveStageAttempt, runAudit } from '../scripts/pass-b-shadow-audit.mjs';

let n = 0; const check = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error(`FAIL ${name}`); throw e; } };
const MODEL = 'claude-sonnet-5-5';
const plan = { workId: 'w1', inputSha256: 'i', promptHash: 'p', binding: {}, input: {}, stageSpec: { model: MODEL, allowedTools: ['StructuredOutput'], image: false } };
const placeholder = ({ status = 529, initModel = MODEL, model = '<synthetic>', output = 0 } = {}) => [
  { type: 'system', subtype: 'init', model: initModel, apiKeySource: 'none', tools: ['StructuredOutput'] },
  ...Array.from({ length: 7 }, () => ({ type: 'system', subtype: 'api_retry' })),
  { type: 'assistant', message: { model, content: [{ type: 'text', text: `API Error: ${status} Overloaded. This is a server-side issue, usually temporary.` }] }, error: 'server_error' },
  { type: 'result', subtype: 'success', is_error: true, result: `API Error: ${status} Overloaded.`, api_error_status: status, terminal_reason: 'api_error',
    usage: { input_tokens: 0, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, modelUsage: {}, num_turns: 1 },
].map(e => JSON.stringify(e)).join('\n');

await check('529 placeholder is api-error, not fatal', () => {
  const d = deriveStageAttempt(plan, placeholder(), 1);
  assert.equal(d.kind, 'api-error'); assert.deepEqual(d.errors, ['api-error:529']); assert.equal(d.audit, null);
});
await check('429 placeholder is a usage limit', () => assert.equal(deriveStageAttempt(plan, placeholder({ status: 429 }), 1).kind, 'usage-limit'));
await check('a placeholder for the WRONG requested model is still fatal', () => assert.equal(deriveStageAttempt(plan, placeholder({ initModel: 'claude-haiku-5-5' }), 1).kind, 'fatal'));
await check('a "placeholder" that generated tokens is still fatal', () => assert.equal(deriveStageAttempt(plan, placeholder({ output: 5 }), 1).kind, 'fatal'));
await check('a real answer from another model is still fatal', () => assert.equal(deriveStageAttempt(plan, placeholder({ model: 'claude-haiku-5-5' }), 1).kind, 'fatal'));
await check('runAudit: an overloaded API stops the run cleanly with no fatal marker', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'api-error-'));
  try {
    const r = await runAudit({ plans: [plan], outDir: dir, runId: 'cf-test', binding: { version: 'test' }, callFn: async () => ({ transcript: placeholder(), exitCode: 1 }) });
    assert.equal(r.stop, 'api-error'); assert.equal(r['api-error'], 1); assert.equal(r.fatal, 0);
    assert.equal(existsSync(join(dir, 'fatal.json')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
console.log(`pass-b-api-error.test: ${n} checks passed`);
