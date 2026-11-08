// VSD-074 (owner 2026-11-08, second occurrence after VSD-049): an image stage that first Reads a one-character-mistyped
// image name inside its own call folder (CLI: "File does not exist"), then the exact image, holds only that work.
// A read outside the folder, or any deviation from that exact shape, is still a pipeline-wide confinement fatal.
// (The collector's equivalents live in tests/pass-b-corpus-collect.test.mjs.)
import assert from 'node:assert/strict';
import { deriveStageAttempt } from '../scripts/pass-b-shadow-audit.mjs';

let n = 0; const check = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`FAIL ${name}`); throw e; } };
const MODEL = 'claude-sonnet-5-5', C = '/tmp/pass-b-audit-x1', IMG = `${'a'.repeat(64)}.jpg`;
const plan = { workId: 'w1', imageFile: IMG, stageSpec: { model: MODEL, allowedTools: ['Read', 'StructuredOutput'], image: true, control: () => [] } };
const transcript = ({ first = `${C}/${'a'.repeat(63)}b.jpg`, extraRead = false } = {}) => [
  { type: 'system', subtype: 'init', apiKeySource: 'none', model: MODEL, tools: ['Read', 'StructuredOutput'], cwd: C },
  { type: 'assistant', message: { model: MODEL, content: [{ type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: first } }] } },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'r1', is_error: true, content: `File does not exist. Note: your current working directory is ${C}.` }] } },
  { type: 'assistant', message: { model: MODEL, content: [{ type: 'tool_use', id: 'r2', name: 'Read', input: { file_path: `${C}/${IMG}` } }] } },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'r2', content: [{ type: 'image', source: { type: 'base64', data: 'x' } }] }] } },
  ...(extraRead ? [{ type: 'assistant', message: { model: MODEL, content: [{ type: 'tool_use', id: 'r3', name: 'Read', input: { file_path: `${C}/${IMG}` } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'r3', content: [{ type: 'image', source: { type: 'base64', data: 'x' } }] }] } }] : []),
  { type: 'assistant', message: { model: MODEL, content: [{ type: 'tool_use', id: 'so', name: 'StructuredOutput', input: { ok: true } }] } },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'so', content: 'Structured output provided successfully' }] } },
  { type: 'result', subtype: 'success', is_error: false, structured_output: { ok: true }, usage: { input_tokens: 1, output_tokens: 1 }, modelUsage: { [MODEL]: { output_tokens: 1 } } },
].map(e => JSON.stringify(e)).join('\n');

check('an exact in-folder misread is held, not fatal', () => {
  const d = deriveStageAttempt(plan, transcript());
  assert.equal(d.kind, 'held'); assert.ok(d.errors.some(e => e.startsWith('misread (VSD-074)')), d.errors.join('; '));
});
check('a read outside the call folder is still a confinement fatal', () => {
  const d = deriveStageAttempt(plan, transcript({ first: '/etc/passwd' }));
  assert.equal(d.kind, 'fatal'); assert.ok(d.errors.some(e => e.startsWith('confinement violation')));
});
check('any deviation from the exact shape (an extra read) is still fatal', () => assert.equal(deriveStageAttempt(plan, transcript({ extraRead: true })).kind, 'fatal'));
check('the wrong requested model is still fatal', () => assert.equal(deriveStageAttempt({ ...plan, stageSpec: { ...plan.stageSpec, model: 'claude-haiku-5-5' } }, transcript()).kind, 'fatal'));
console.log(`pass-b-misread.test: ${n} checks passed`);
