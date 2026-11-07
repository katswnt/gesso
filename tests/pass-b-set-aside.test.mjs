// VSD-073 (owner 2026-11-07, after one false fatal held the whole pipeline ~40 h): a fatal that can only concern one
// work sets that work aside (terminal, never retried, no copy) and the nightly keeps going. Subscription source and
// CLI configuration still stop everything, and so does the third set-aside in one firing. A missing or forged
// set-aside record is the old pipeline-wide fatal.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { runAudit, auditRunFatal, auditHistory, setAsideWorks } from '../scripts/pass-b-shadow-audit.mjs';
import { setAsideBudget, pipelineWide } from '../scripts/lib/pass-b-set-aside.mjs';

let n = 0; const check = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error(`FAIL ${name}`); throw e; } };
const MODEL = 'claude-sonnet-5-5';
const plan = id => ({ workId: id, inputSha256: 'i', promptHash: 'p', binding: {}, input: {}, stageSpec: { model: MODEL, allowedTools: ['StructuredOutput'], image: false } });
// A real answer from another model (work-level), or a call billed to an API key (pipeline-wide).
const transcript = ({ model = 'claude-haiku-5-5', apiKeySource = 'none' } = {}) => [
  { type: 'system', subtype: 'init', model: MODEL, apiKeySource, tools: ['StructuredOutput'] },
  { type: 'assistant', message: { model, content: [{ type: 'text', text: 'an answer' }] } },
  { type: 'result', subtype: 'success', is_error: false, result: 'an answer', usage: { input_tokens: 10, output_tokens: 5 }, modelUsage: {}, num_turns: 1 },
].map(e => JSON.stringify(e)).join('\n');
const night = () => new Date('2026-11-05T09:00:00Z'); // 01:00 Pacific: inside the start window whatever the real clock says
const audit = (dir, plans, opts = {}) => runAudit({ plans, outDir: dir, runId: 'cf-test', binding: { version: 'test' }, now: night, callFn: async () => ({ transcript: transcript(opts), exitCode: 0 }), ...opts });
const withDir = async fn => { const dir = mkdtempSync(join(tmpdir(), 'set-aside-')); try { await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); } };
const rec = (dir, id) => join(dir, 'works', createHash('sha256').update(id).digest('hex').slice(0, 24), 'attempt-1.set-aside.json');

await check('reasons: only work-level fatals may be set aside', () => {
  for (const r of ['model:claude-haiku-5-5', 'B4 used tools:tool_use:Bash', 'model drift: a != b']) assert.equal(pipelineWide(r), false, r);
  for (const r of ['apiKeySource:ANTHROPIC_API_KEY', 'init tools must be exactly [StructuredOutput]', 'every init must report apiKeySource:none', 'model drift in init', 'confinement violation: /etc/passwd']) assert.equal(pipelineWide(r), true, r);
});
await check('two work-level fatals are set aside and the run keeps going', () => withDir(async dir => {
  const r = await audit(dir, [plan('w1'), plan('w2')], { setAside: setAsideBudget() });
  assert.equal(r.stop, 'done'); assert.equal(r.fatal, 2); assert.equal(r['set-aside'], 2);
  assert.equal(existsSync(join(dir, 'fatal.json')), false);
  assert.equal(auditRunFatal(dir), null, 'the global preflight lets the next firing run');
  assert.deepEqual(setAsideWorks(dir).map(w => w.workId).sort(), ['w1', 'w2']);
  assert.equal(auditHistory(dir, plan('w1'), 'cf-test').kind, 'fatal', 'the work itself stays terminal');
  let calls = 0;
  const again = await runAudit({ plans: [plan('w1'), plan('w2')], outDir: dir, runId: 'cf-test', binding: { version: 'test' }, now: night, setAside: setAsideBudget(), callFn: async () => { calls++; } });
  assert.equal(calls, 0, 'a set-aside work is never called again'); assert.equal(again.skipped, 2);
}));
await check('the third in one firing stops the pipeline (circuit breaker)', () => withDir(async dir => {
  const r = await audit(dir, [plan('w1'), plan('w2'), plan('w3'), plan('w4')], { setAside: setAsideBudget() });
  assert.equal(r.stop, 'fatal-provenance'); assert.equal(r['set-aside'], 2); assert.equal(r.calls, 3, 'w4 is never called');
  assert.match(auditRunFatal(dir), /model:claude-haiku-5-5/); assert.equal(existsSync(rec(dir, 'w3')), false); assert.equal(existsSync(rec(dir, 'w1')), true);
}));
await check('subscription source is never set aside', () => withDir(async dir => {
  const r = await audit(dir, [plan('w1'), plan('w2')], { setAside: setAsideBudget(), apiKeySource: 'ANTHROPIC_API_KEY' });
  assert.equal(r.stop, 'fatal-provenance'); assert.equal(r['set-aside'], 0); assert.equal(r.calls, 1);
  assert.match(auditRunFatal(dir), /apiKeySource/);
}));
await check('without a budget (experiments, standalone claim-first) every fatal still stops', () => withDir(async dir => {
  const r = await audit(dir, [plan('w1'), plan('w2')]);
  assert.equal(r.stop, 'fatal-provenance'); assert.equal(r.calls, 1); assert.ok(auditRunFatal(dir));
}));
await check('a missing or forged set-aside record is the old pipeline-wide fatal', () => withDir(async dir => {
  await audit(dir, [plan('w1')], { setAside: setAsideBudget() });
  const good = readFileSync(rec(dir, 'w1'), 'utf8');
  writeFileSync(rec(dir, 'w1'), JSON.stringify({ ...JSON.parse(good), boundSha256: '0'.repeat(64) }));
  assert.match(auditRunFatal(dir), /model:claude-haiku/, 'bound to other bytes');
  writeFileSync(rec(dir, 'w1'), JSON.stringify({ ...JSON.parse(good), reason: 'apiKeySource:ANTHROPIC_API_KEY' }));
  assert.match(auditRunFatal(dir), /model:claude-haiku/, 'a pipeline-wide reason');
  unlinkSync(rec(dir, 'w1'));
  assert.match(auditRunFatal(dir), /model:claude-haiku/, 'crash before the record was written');
  writeFileSync(rec(dir, 'w1'), good); assert.equal(auditRunFatal(dir), null);
}));
console.log(`pass-b-set-aside.test: ${n} checks passed`);
