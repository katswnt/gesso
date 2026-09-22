// VSD-040 offline regressions for the bounded structured-B4 canary. All model calls are injected mocks.
import assert from 'node:assert';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { syntheticFixture, CALIBRATION_MODEL, RUN_ROOT } from '../scripts/lib/pass-b-calibration.mjs';
import { sha256 } from '../scripts/lib/vision-legacy.mjs';
import {
  CANARY_WORKS, MAX_ATTEMPTS, deriveB4Attempt, loadCanaryPlan, runCanary, structuredB4RunId,
} from '../scripts/pass-b-b4-structured-canary.mjs';

let n = 0;
const ok = (value, message) => { assert(value, message); n++; };
const cleanups = [];
const tempOut = () => { const p = mkdtempSync(join(tmpdir(), 'b4s-test-')); cleanups.push(p); return join(p, 'run'); };
const H = value => sha256(String(value));

function transcript(output, { apiKeySource = 'none', model = CALIBRATION_MODEL, tools = [] } = {}) {
  const events = [{ type: 'system', subtype: 'init', apiKeySource, model, claude_code_version: 'test' }];
  if (tools.length) events.push({ type: 'assistant', message: { content: tools.map((name, i) => ({ type: 'tool_use', id: `t${i}`, name, input: {} })) } });
  events.push({
    type: 'result', subtype: 'success', is_error: false, structured_output: output,
    modelUsage: { [model]: { output_tokens: 10 } }, usage: { output_tokens: 10 }, num_turns: 1,
  });
  return `${events.map(row => JSON.stringify(row)).join('\n')}\n`;
}
function usageTranscript(apiKeySource = 'none') {
  return `${[
    { type: 'system', subtype: 'init', apiKeySource, model: CALIBRATION_MODEL, claude_code_version: 'test' },
    { type: 'result', subtype: 'error', is_error: true, api_error_status: 429, result: 'usage limit reached' },
  ].map(row => JSON.stringify(row)).join('\n')}\n`;
}

function fixturePlan(workId = 'fixture-b4s') {
  const fx = syntheticFixture();
  return {
    workId, reason: 'test', b0: { work: { id: workId }, image: { imgSha256: 'a'.repeat(64), ext: 'jpg' } },
    b1: fx.bodies.B1, b2: fx.bodies.B2, b3: fx.bodies.B3, legacy: { teaching: {} },
    promptHash: H(`prompt:${workId}`), sealedFindingIds: [],
    sourceBinding: {
      b0Sha256: H(`b0:${workId}`),
      B1: { completionSha256: H(`b1:${workId}`) },
      B2: { completionSha256: H(`b2:${workId}`) },
      B3: { completionSha256: H(`b3:${workId}`) },
    },
    delta: fx.bodies.B4Delta,
  };
}

function planSet(plans) {
  const binding = { version: 'test-b4s/1', works: plans.map(p => ({ workId: p.workId, promptHash: p.promptHash })) };
  return { source: 'test', plans, binding, runId: structuredB4RunId(binding) };
}

// Real, read-only source-plan construction proves all selected historical B1-B3 bytes/evidence reopen.
const real = loadCanaryPlan();
ok(real.plans.length === 10 && CANARY_WORKS.length === 10, 'frozen ten-work plan loads');
ok(real.runId === structuredB4RunId(real.binding), 'run id is deterministic from the complete binding');
ok(real.plans.every(p => p.sourceBinding.B1.transcriptSha256 && p.sourceBinding.B2.transcriptSha256 && p.sourceBinding.B3.transcriptSha256), 'every source completion binds a transcript');
ok(real.plans.filter(p => p.sealedFindingIds.length).map(p => p.workId).sort().join('|') === ['wikidata:Q1211814', 'wikidata:Q16467705'].sort().join('|'), 'both canonical failures remain sealed holds');

// A valid structured delta may pass integrity, but model-only reconciliation must still yield zero eligibility.
const fp = fixturePlan();
const accepted = deriveB4Attempt(fp, transcript(fp.delta), 0);
ok(accepted.kind === 'accepted', `valid structured delta accepted for smoke integrity: ${accepted.errors.join(';')}`);
ok(accepted.reconciliation.componentReadiness.every(row => row.contentReadiness !== 'eligible'), 'model proposal alone creates zero eligible components');

const wrongKey = deriveB4Attempt(fp, transcript(fp.delta, { apiKeySource: 'user' }), 0);
ok(wrongKey.kind === 'fatal' && wrongKey.errors.some(e => e.startsWith('apiKeySource:')), 'wrong apiKeySource is fatal');
const wrongModel = deriveB4Attempt(fp, transcript(fp.delta, { model: 'different-model' }), 0);
ok(wrongModel.kind === 'fatal' && wrongModel.errors.some(e => e.startsWith('model:')), 'model drift is fatal');
const usedTool = deriveB4Attempt(fp, transcript(fp.delta, { tools: ['Read'] }), 0);
ok(usedTool.kind === 'fatal' && usedTool.errors.some(e => e.includes('used tools')), 'any B4 tool use is fatal');
ok(deriveB4Attempt(fp, transcript(null), 0).kind === 'held', 'missing structured output is held, not accepted');
ok(deriveB4Attempt(fp, usageTranscript('user'), 1).kind === 'fatal', 'wrong authentication cannot hide behind a usage-limit response');

// Checkpointed resume re-derives the transcript/result and never re-executes a completed work.
{
  const outDir = tempOut(); const set = planSet([fp]); let calls = 0;
  const first = await runCanary({ planSet: set, outDir, callFn: async p => { calls++; return { transcript: transcript(p.delta), exitCode: 0 }; } });
  ok(first.counts.accepted === 1 && calls === 1, 'mocked valid run checkpoints one accepted result');
  ok(first.rows[0].scoping.boundComponents > 0 && first.rows[0].scoping.eligibleComponents === 0, 'report exposes scoping coverage without implying eligibility');
  const resumed = await runCanary({ planSet: set, outDir, callFn: async () => { throw new Error('must not re-execute'); } });
  ok(resumed.counts.accepted === 1 && calls === 1, 'verified resume reuses checkpoint without a call');
  const manifest = JSON.parse(readFileSync(join(outDir, 'run-manifest.json'), 'utf8'));
  ok(manifest.runId === structuredB4RunId(manifest.binding), 'pre-call manifest is self-bound');
}

// Usage-limit attempts remain fully verified evidence, consume budget, and may resume the same work once.
{
  const outDir = tempOut(); const set = planSet([fp]); let calls = 0;
  const limited = await runCanary({ planSet: set, outDir, callFn: async () => { calls++; return { transcript: usageTranscript(), exitCode: 1 }; } });
  ok(limited.stopped === 'usage-limit' && limited.attempts === 1, 'usage-limit stops cleanly and consumes one preserved attempt');
  const resumed = await runCanary({ planSet: set, outDir, callFn: async p => { calls++; return { transcript: transcript(p.delta), exitCode: 0 }; } });
  ok(resumed.counts.accepted === 1 && resumed.attempts === 2 && calls === 2, 'resume verifies the usage-limit attempt and retries within the total cap');
}

// Fatal provenance remains terminal across resume; it cannot be skipped to spend on later works.
{
  const plans = [fixturePlan('fatal-first'), fixturePlan('must-not-run')];
  const set = planSet(plans); const outDir = tempOut(); let calls = 0;
  await runCanary({ planSet: set, outDir, callFn: async p => { calls++; return { transcript: transcript(p.delta, { apiKeySource: 'user' }), exitCode: 0 }; } });
  ok(calls === 1, 'fatal provenance stops the first execution immediately');
  const resumed = await runCanary({ planSet: set, outDir, callFn: async () => { calls++; throw new Error('must not run after prior fatal'); } });
  ok(calls === 1 && resumed.stopped === 'fatal-provenance', 'prior fatal checkpoint also stops resume');
}

// The hard budget counts attempts across every work and stops at ten without a hidden retry.
{
  const plans = Array.from({ length: MAX_ATTEMPTS + 1 }, (_, i) => fixturePlan(`cap-${i}`));
  const set = planSet(plans); const outDir = tempOut(); let calls = 0;
  const report = await runCanary({ planSet: set, outDir, callFn: async () => { calls++; return { transcript: transcript(null), exitCode: 0 }; } });
  ok(calls === MAX_ATTEMPTS && report.attempts === MAX_ATTEMPTS && report.stopped === 'attempt-cap', 'total attempt cap holds across the run');
}

// Tampered preserved result is rejected on resume.
{
  const outDir = tempOut(); const set = planSet([fp]);
  await runCanary({ planSet: set, outDir, callFn: async p => ({ transcript: transcript(p.delta), exitCode: 0 }) });
  const workDir = join(outDir, 'works', sha256(fp.workId).slice(0, 24));
  const resultPath = join(workDir, 'attempt-1.result.json');
  const result = JSON.parse(readFileSync(resultPath, 'utf8')); result.kind = 'held';
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  await assert.rejects(runCanary({ planSet: set, outDir, callFn: async () => { throw new Error('no'); } }), /attempt 1 evidence changed|checkpoint evidence changed|re-derivation mismatch/); n++;
}

// CLI defaults to plan-only and the live flag alone cannot bypass the owner-gated environment variable.
{
  const env = { ...process.env }; delete env.PASS_B_B4_CANARY_LIVE;
  const before = existsSync(join(RUN_ROOT, real.runId));
  const guarded = spawnSync('/opt/homebrew/bin/node', ['scripts/pass-b-b4-structured-canary.mjs', '--run'], { cwd: process.cwd(), env, encoding: 'utf8' });
  ok(guarded.status === 2 && /refusing live/.test(guarded.stderr), 'live execution refuses without the explicit environment gate');
  ok(existsSync(join(RUN_ROOT, real.runId)) === before, 'refused live command creates no run directory');
}

for (const path of cleanups) rmSync(path, { recursive: true, force: true });
console.log(`ok - pass-b structured B4 canary (offline): ${n} checks passed`);
