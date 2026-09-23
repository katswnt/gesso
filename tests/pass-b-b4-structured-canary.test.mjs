// VSD-040 offline regressions. Model calls are mocked; the timeout test spawns only a local Node fixture.
import assert from 'node:assert';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { syntheticFixture, CALIBRATION_MODEL, RUN_ROOT } from '../scripts/lib/pass-b-calibration.mjs';
import { sha256 } from '../scripts/lib/vision-legacy.mjs';
import {
  CALL_TIMEOUT_MS, CANARY_VERSION, CANARY_WORKS, MAX_ATTEMPTS, callB4, deriveB4Attempt, loadCanaryPlan, runCanary, structuredB4RunId,
} from '../scripts/pass-b-b4-structured-canary.mjs';

let n = 0;
const ok = (value, message) => { assert(value, message); n++; };
const cleanups = [];
const tempOut = () => { const p = mkdtempSync(join(tmpdir(), 'b4s-test-')); cleanups.push(p); return join(p, 'run'); };
const H = value => sha256(String(value));
const workOut = (outDir, plan) => join(outDir, 'works', sha256(plan.workId).slice(0, 24));
let unexpectedCalls = 0;
const noCall = async () => { unexpectedCalls++; throw new Error('resume must make zero calls'); };
const fileHashes = root => Object.fromEntries(readdirSync(root, { recursive: true })
  .filter(name => /\.(json|jsonl)$/.test(name)).sort().map(name => [name, sha256(readFileSync(join(root, name), 'utf8'))]));

function transcript(output, { apiKeySource = 'none', model = CALIBRATION_MODEL, tools = ['StructuredOutput'], initTools = ['StructuredOutput'], result = '' } = {}) {
  const events = [{ type: 'system', subtype: 'init', apiKeySource, model, tools: initTools, claude_code_version: 'test' }];
  if (tools.length) events.push({ type: 'assistant', message: { content: tools.map((name, i) => ({ type: 'tool_use', id: `t${i}`, name, input: name === 'StructuredOutput' ? output : {} })) } });
  events.push({
    type: 'result', subtype: 'success', is_error: false, structured_output: output, result,
    modelUsage: { [model]: { output_tokens: 10 } }, usage: { output_tokens: 10 }, num_turns: 1,
  });
  return `${events.map(row => JSON.stringify(row)).join('\n')}\n`;
}
function usageTranscript(apiKeySource = 'none') {
  return `${[
    { type: 'system', subtype: 'init', apiKeySource, model: CALIBRATION_MODEL, tools: ['StructuredOutput'], claude_code_version: 'test' },
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
  const binding = { version: CANARY_VERSION, works: plans.map(p => ({ workId: p.workId, promptHash: p.promptHash })) };
  return { source: 'test', plans, binding, runId: structuredB4RunId(binding) };
}

// Real, read-only source-plan construction proves all selected historical B1-B3 bytes/evidence reopen.
const real = loadCanaryPlan();
ok(real.plans.length === 10 && CANARY_WORKS.length === 10, 'frozen ten-work plan loads');
ok(real.runId === structuredB4RunId(real.binding), 'run id is deterministic from the complete binding');
ok(real.binding.version === CANARY_VERSION && CANARY_VERSION === 'passBStructuredB4Canary/4', 'execution evidence contract is versioned independently');
ok(real.plans.every(p => p.commandPolicy.timeoutMs === CALL_TIMEOUT_MS && p.commandPolicy.killSignal === 'SIGKILL'), 'plan binds the process timeout and kill signal');
ok(real.plans.every(p => p.sourceBinding.B1.transcriptSha256 && p.sourceBinding.B2.transcriptSha256 && p.sourceBinding.B3.transcriptSha256), 'every source completion binds a transcript');
ok(real.plans.filter(p => p.sealedFindingIds.length).map(p => p.workId).sort().join('|') === ['wikidata:Q1211814', 'wikidata:Q16467705'].sort().join('|'), 'both canonical failures remain sealed holds');

// Real execution fixtures are read in place and byte-bound, just like the existing banked B1-B3 inputs.
// No historical result/report is regenerated: /4's offline interpretation cannot reopen the spent /3 run.
const spentDir = join(RUN_ROOT, 'b4s-016f64c8e0ca');
const spentBefore = fileHashes(spentDir);
const stJohnPlan = real.plans.find(p => p.workId === 'wikidata:Q1211814');
const stJohnText = readFileSync(join(workOut(spentDir, stJohnPlan), 'attempt-2.transcript.jsonl'), 'utf8');
ok(sha256(stJohnText) === 'd2a3591a11ec1c354f153e76ef57ee5b9ae87066e68ee1a6fd960cee32a0bf1d', 'St. John fixture is the exact preserved owner-run /3 attempt 2');
const stJohn = deriveB4Attempt(stJohnPlan, stJohnText, 0);
ok(stJohn.kind === 'accepted' && stJohn.evidence.claudeCodeVersion === '2.1.280' && stJohn.evidence.apiKeySource === 'none', `real CLI output adapter is accepted for smoke integrity: ${stJohn.errors.join(';')}`);
ok(stJohn.evidence.toolUses.join('|') === 'StructuredOutput' && stJohn.evidence.toolUseTypes.join('|') === 'tool_use', 'real successful transcript contains exactly one permitted adapter emission');
ok(stJohn.body.structuredGrounding.components.length === 17 && stJohn.body.structuredGrounding.unresolvedComponentTargets.length === 0 && stJohn.leaks.length === 0, 'real St. John delta retains strict hydration, grounding and leak checks');
ok(stJohn.reconciliation.componentReadiness.length === 21 && stJohn.reconciliation.componentReadiness.every(r => r.contentReadiness === 'review-required'), 'real schema-valid St. John still has 21 review-required components and zero eligible');
ok(stJohn.delta.guide.some(g => /crouching animal/i.test(g.q)) && /may be a lion/i.test(JSON.stringify(stJohn.delta.grounding.openClaims)) && stJohn.delta.conflicts.length === 0, 'known animal presupposition/softened aliasing persists despite schema acceptance: an A4 challenge, not factual approval');
const addedRead = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'injected-extra-read', name: 'Read', input: { file_path: '/not-permitted' } }] } };
ok(deriveB4Attempt(stJohnPlan, `${stJohnText}${JSON.stringify(addedRead)}\n`).kind === 'fatal', 'real St. John transcript with an injected extra ordinary tool is fatal');
const duplicatePath = join(RUN_ROOT, 'b4c-f45fac18da2e', 'works', 'cleveland120847.transcript.jsonl');
const realDuplicate = readFileSync(duplicatePath, 'utf8');
ok(sha256(realDuplicate) === '2db6c014011fbb91d50ce5e2a25bce3f8f3316fb55769b1b1f7f7ef83e159024', 'second execution fixture is an unmodified historical transcript with two adapter emissions');
ok(deriveB4Attempt(stJohnPlan, realDuplicate).kind === 'fatal', 'real wire-schema retry with two StructuredOutput emissions is fatal under the requested exactly-once policy');
const gloirePlan = real.plans.find(p => p.workId === 'wikidata:Q16467705');
const timedOutText = readFileSync(join(workOut(spentDir, gloirePlan), 'attempt-1.transcript.jsonl'), 'utf8');
ok(sha256(timedOutText) === 'cf76fb53f9cf6d56528199afd7ec53c4089bb37b3d88d5603d1c9aae5745e6e6' && deriveB4Attempt(gloirePlan, timedOutText, 'timeout').kind === 'held', 'real interrupted La Gloire attempt stays held: no retroactive timeout extension or retry');
const oldManifest = JSON.parse(readFileSync(join(spentDir, 'run-manifest.json'), 'utf8'));
const oldReport = JSON.parse(readFileSync(join(spentDir, 'report.json'), 'utf8'));
ok(oldReport.attempts === 2 && oldReport.stopped === 'fatal-provenance' && oldReport.counts.fatal === 1 && oldReport.counts.held === 1, 'spent /3 report remains terminal with both reservations consumed');
ok(real.runId !== oldManifest.runId && real.binding.maxAttempts === 10, '/4 has a distinct identity and a fresh ten-slot budget, not eight remaining /3 slots');
await assert.rejects(runCanary({ planSet: { ...real, ...oldManifest }, outDir: spentDir, callFn: noCall }), /execution contract differs/); n++;
assert.deepStrictEqual(fileHashes(spentDir), spentBefore); n++;

// Timeout sizing is checked against real stage timings, not only a mocked execFile option.
const historicDir = join(RUN_ROOT, 'b4c-f45fac18da2e', 'works');
const historicDurations = readdirSync(historicDir).filter(name => name.endsWith('.transcript.jsonl')).map(name => {
  const events = readFileSync(join(historicDir, name), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  return events.findLast(e => e.type === 'result')?.duration_ms;
}).filter(Number.isFinite).sort((a, b) => a - b);
ok(historicDurations.length === 49 && historicDurations.at(-1) === 302585 && historicDurations[24] === 184391, 'timeout baseline is the preserved 49-call B4 duration distribution');
ok(CALL_TIMEOUT_MS === 900000 && CALL_TIMEOUT_MS > 2 * historicDurations.at(-1) && CALL_TIMEOUT_MS === 2.5 * 360000, 'fifteen-minute bound adds measured headroom above historical durations and the new censored call');

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
ok(usedTool.kind === 'fatal' && usedTool.errors.some(e => e.includes('used tools')), 'ordinary B4 tool use is fatal');
ok(deriveB4Attempt(fp, transcript(null), 0).kind === 'held', 'missing structured output is held, not accepted');
ok(deriveB4Attempt(fp, usageTranscript('user'), 1).kind === 'fatal', 'wrong authentication cannot hide behind a usage-limit response');
ok(deriveB4Attempt(fp, transcript(fp.delta, { result: 'The successful explanation mentions a rate limit and quota.' }), 0).kind === 'accepted', 'successful prose mentioning rate limit is not a usage-limit rejection');
ok(deriveB4Attempt(fp, transcript(fp.delta, { tools: [] }), 0).kind === 'held', 'successful acceptance requires one actual StructuredOutput emission');
ok(deriveB4Attempt(fp, transcript(fp.delta, { tools: ['StructuredOutput', 'StructuredOutput'] }), 0).kind === 'fatal', 'a second output-adapter emission is fatal');
for (const initTools of [undefined, null, [], ['Read'], ['StructuredOutput', 'Read'], ['StructuredOutput', 'StructuredOutput'], 'StructuredOutput']) {
  const rows = stJohnText.trim().split('\n').map(line => JSON.parse(line));
  rows.find(row => row.type === 'system' && row.subtype === 'init').tools = initTools;
  const result = deriveB4Attempt(stJohnPlan, `${rows.map(row => JSON.stringify(row)).join('\n')}\n`);
  ok(result.kind === 'fatal' && result.errors.some(e => /init tools/.test(e)), `real transcript with missing/extra/malformed init tools is fatal: ${JSON.stringify(initTools)}`);
}
for (const placement of ['before', 'after']) {
  const extraInit = JSON.stringify({ type: 'system', subtype: 'init', apiKeySource: 'none', model: CALIBRATION_MODEL, tools: ['StructuredOutput', 'Read'] });
  const text = placement === 'before' ? `${extraInit}\n${stJohnText}` : `${stJohnText}${extraInit}\n`;
  ok(deriveB4Attempt(stJohnPlan, text).kind === 'fatal', `every init's tool list is checked, including an extra tool ${placement} a clean init`);
}

// N5: an earlier bad/missing auth event cannot be hidden by a later clean startup.
for (const apiKeySource of ['ANTHROPIC_API_KEY', null, undefined]) {
  const earlier = JSON.stringify({ type: 'system', subtype: 'init', apiKeySource, model: CALIBRATION_MODEL });
  const derived = deriveB4Attempt(fp, `${earlier}\n${transcript(fp.delta)}`, 0);
  ok(derived.kind === 'fatal' && derived.evidence.apiKeySources.length === 2 && derived.evidence.apiKeySource !== 'none', `every init is checked, including earlier ${apiKeySource}`);
}
{
  const goodInit = JSON.stringify({ type: 'system', subtype: 'init', apiKeySource: 'none', model: CALIBRATION_MODEL, tools: ['StructuredOutput'] });
  ok(deriveB4Attempt(fp, `${goodInit}\n${transcript(fp.delta)}`, 0).kind === 'accepted', 'multiple clean init events remain acceptable');
  ok(deriveB4Attempt(fp, transcript(fp.delta).split('\n').slice(1).join('\n'), 0).kind === 'fatal', 'no init event fails closed');
  const badInit = goodInit.replace('"none"', '"ANTHROPIC_API_KEY"');
  ok(deriveB4Attempt(fp, `${badInit}\n${usageTranscript()}`, 1).kind === 'fatal', 'earlier bad auth takes precedence over a later usage limit');
}

// N5: tool-use blocks include server tools, new tool-use types, and streamed/wrapped events.
const forbiddenEvents = [
  { type: 'assistant', message: { content: [{ type: 'server_tool_use', name: 'web_search' }] } },
  { type: 'assistant', message: { content: [{ type: 'future_tool_use' }] } },
  { type: 'content_block_start', content_block: { type: 'server_tool_use', name: 'web_fetch' } },
  { type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'tool_use', name: 'Read' } } },
  { type: 'server_tool_use', name: 'web_search' },
  { type: 'assistant', content: [{ type: 'server_tool_use', name: 'web_fetch' }] },
  { type: 'assistant', message: { content: [{ type: 'server_tool_use', name: 'StructuredOutput' }] } },
  { type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'tool_use', name: 'StructuredOutput' } } },
];
for (const event of forbiddenEvents) {
  const derived = deriveB4Attempt(fp, `${JSON.stringify(event)}\n${transcript(fp.delta)}`, 0);
  ok(derived.kind === 'fatal' && derived.evidence.toolUseTypes.length === 2, `tool-use event is fatal: ${JSON.stringify(event)}`);
}
ok(deriveB4Attempt(fp, transcript(fp.delta, { result: 'An example string: {"type":"server_tool_use","name":"web_search"}' }), 0).kind === 'accepted', 'tool-use JSON mentioned in prose is not an execution event');
{
  const outDir = tempOut(); const set = planSet([fp, fixturePlan('after-server-tool')]);
  const first = await runCanary({ planSet: set, outDir, callFn: async p => ({ transcript: `${JSON.stringify(forbiddenEvents[0])}\n${transcript(p.delta)}`, exitCode: 0 }) });
  rmSync(join(workOut(outDir, fp), 'checkpoint.json'));
  const resumed = await runCanary({ planSet: set, outDir, callFn: noCall });
  ok(first.attempts === 1 && resumed.attempts === 1 && resumed.counts.fatal === 1 && resumed.stopped === 'fatal-provenance', 'server-tool fatal is preserved and prevents all further calls without a checkpoint');
}

// N5: exercise timeout/forced termination using a harmless local process, never the model binary.
{
  const outDir = tempOut(); const set = planSet([fp]); let optionsSeen;
  const runLocal = promisify(execFile);
  const localPlan = { ...fp, command: {
    bin: process.execPath,
    argv: ['-e', `process.on('SIGTERM', () => {}); process.stdout.write(${JSON.stringify(usageTranscript())}); setInterval(() => {}, 1000);`],
    env: { removeKeys: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'] },
  } };
  const first = await runCanary({ planSet: set, outDir, callFn: async () => callB4(localPlan, { execute: async (bin, argv, options) => {
    optionsSeen = options;
    // Shorten only the test child's wait, keeping a hard kill even when mutation-testing the options.
    return runLocal(bin, argv, { ...options, timeout: 500, killSignal: 'SIGKILL' });
  } }) });
  ok(optionsSeen.timeout === CALL_TIMEOUT_MS && CALL_TIMEOUT_MS === 900000 && optionsSeen.killSignal === 'SIGKILL', 'production execution passes a fifteen-minute hard timeout');
  ok(!existsSync(optionsSeen.cwd), 'timeout cleans up the confined call directory');
  const dir = workOut(outDir, fp);
  const stored = JSON.parse(readFileSync(join(dir, 'attempt-1.result.json'), 'utf8'));
  ok(readFileSync(join(dir, 'attempt-1.transcript.jsonl'), 'utf8') === usageTranscript() && stored.evidence.exitCode === 'timeout', 'timeout preserves stdout and records the process outcome');
  ok(first.attempts === 1 && first.counts.held === 1 && first.rows[0].errors.includes('process-timeout'), 'timeout consumes a reservation and cannot masquerade as retryable usage-limit');
  rmSync(join(dir, 'checkpoint.json'));
  const resumed = await runCanary({ planSet: set, outDir, callFn: noCall });
  ok(resumed.attempts === 1 && resumed.counts.held === 1, 'timeout remains terminal on checkpoint-free resume');
}

// Checkpointed resume re-derives the transcript/result and never re-executes a completed work.
{
  const outDir = tempOut(); const set = planSet([fp]); let calls = 0;
  const first = await runCanary({ planSet: set, outDir, callFn: async p => { calls++; return { transcript: transcript(p.delta), exitCode: 0 }; } });
  ok(first.counts.accepted === 1 && calls === 1, 'mocked valid run checkpoints one accepted result');
  ok(first.rows[0].scoping.boundComponents > 0 && first.rows[0].scoping.eligibleComponents === 0, 'report exposes scoping coverage without implying eligibility');
  const resumed = await runCanary({ planSet: set, outDir, callFn: async () => { throw new Error('must not re-execute'); } });
  ok(resumed.counts.accepted === 1 && calls === 1, 'verified resume reuses preserved evidence without a call');
  const manifest = JSON.parse(readFileSync(join(outDir, 'run-manifest.json'), 'utf8'));
  ok(manifest.runId === structuredB4RunId(manifest.binding), 'pre-call manifest is self-bound');
  rmSync(join(workOut(outDir, fp), 'checkpoint.json'));
  const withoutCheckpoint = await runCanary({ planSet: set, outDir, callFn: noCall });
  ok(withoutCheckpoint.counts.accepted === 1 && withoutCheckpoint.attempts === 1, 'accepted is terminal without checkpoint.json');
}

// A call may spend and throw. Its exclusive pre-call reservation remains the terminal source of truth.
{
  const outDir = tempOut(); const set = planSet([fp]); let calls = 0;
  let reservation, reservationText;
  const first = await runCanary({ planSet: set, outDir, callFn: async () => {
    calls++;
    const path = join(workOut(outDir, fp), 'attempt-1.reserved.json');
    reservationText = readFileSync(path, 'utf8');
    reservation = JSON.parse(reservationText);
    throw new Error('simulated crash after spending');
  } });
  ok(reservation?.runId === set.runId && reservation.workId === fp.workId && reservation.attempt === 1 && reservation.promptHash === fp.promptHash, 'bound reservation already exists when callFn starts spending');
  ok(calls === 1 && first.attempts === 1 && first.stopped === 'unknown-outcome', 'throw after spending consumes exactly one reservation');
  ok(first.counts['unknown-outcome'] === 1 && first.rows[0].status === 'unknown-outcome', 'incomplete evidence is reported as terminal unknown-outcome');
  const resumed = await runCanary({ planSet: set, outDir, callFn: noCall });
  ok(resumed.attempts === 1 && resumed.counts['unknown-outcome'] === 1 && resumed.stopped === 'unknown-outcome', 'unknown-outcome resume makes zero calls and preserves its budget slot');
  ok(readFileSync(join(workOut(outDir, fp), 'attempt-1.reserved.json'), 'utf8') === reservationText, 'resume preserves the exact pre-call reservation bytes');
}

// Each incomplete-evidence boundary is terminal even if a convenience checkpoint survives.
for (const suffix of ['transcript.jsonl', 'result.json', 'meta.json']) {
  const outDir = tempOut(); const set = planSet([fp]);
  await runCanary({ planSet: set, outDir, callFn: async p => ({ transcript: transcript(p.delta), exitCode: 0 }) });
  rmSync(join(workOut(outDir, fp), `attempt-1.${suffix}`));
  const resumed = await runCanary({ planSet: set, outDir, callFn: noCall });
  ok(resumed.attempts === 1 && resumed.counts['unknown-outcome'] === 1 && resumed.stopped === 'unknown-outcome', `missing ${suffix} consumes its reservation and cannot retry`);
}

{
  const outDir = tempOut(); const set = planSet([fp]);
  await runCanary({ planSet: set, outDir, callFn: async p => ({ transcript: transcript(p.delta), exitCode: 0 }) });
  writeFileSync(join(workOut(outDir, fp), 'attempt-1.meta.json'), '{"workId":');
  const resumed = await runCanary({ planSet: set, outDir, callFn: noCall });
  ok(resumed.attempts === 1 && resumed.counts['unknown-outcome'] === 1 && resumed.stopped === 'unknown-outcome', 'interrupted meta write is a consumed terminal unknown-outcome');
  ok(!resumed.rows[0].transcriptDerivedKind, 'incomplete successful evidence is never promoted by a diagnostic');
}

for (const missing of [false, true]) {
  const outDir = tempOut(); const set = planSet([fp]);
  await runCanary({ planSet: set, outDir, callFn: async p => ({ transcript: transcript(p.delta, { apiKeySource: 'user' }), exitCode: 0 }) });
  const meta = join(workOut(outDir, fp), 'attempt-1.meta.json');
  if (missing) rmSync(meta); else writeFileSync(meta, '{');
  rmSync(join(workOut(outDir, fp), 'checkpoint.json'));
  const resumed = await runCanary({ planSet: set, outDir, callFn: noCall });
  ok(resumed.attempts === 1 && resumed.counts['unknown-outcome'] === 1 && resumed.counts.fatal === 0 && resumed.stopped === 'unknown-outcome', `${missing ? 'missing' : 'truncated'} fatal meta stays terminal unknown-outcome`);
  ok(resumed.rows[0].transcriptDerivedKind === 'fatal', 'unverified transcript fatal remains visible as a diagnostic only');
}

// Usage-limit attempts remain fully verified evidence, consume budget, and may resume the same work once.
{
  const outDir = tempOut(); const set = planSet([fp]); let calls = 0;
  const limited = await runCanary({ planSet: set, outDir, callFn: async () => { calls++; return { transcript: usageTranscript(), exitCode: 1 }; } });
  ok(limited.stopped === 'usage-limit' && limited.attempts === 1, 'usage-limit stops cleanly and consumes one preserved attempt');
  const resumed = await runCanary({ planSet: set, outDir, callFn: async p => { calls++; return { transcript: transcript(p.delta), exitCode: 0 }; } });
  ok(resumed.counts.accepted === 1 && resumed.attempts === 2 && calls === 2, 'resume verifies the usage-limit attempt and retries within the total cap');
  ok(readdirSync(workOut(outDir, fp)).filter(name => name.endsWith('.reserved.json')).length === 2, 'retry has its own reservation; the usage-limit reservation is preserved');
}

// Fatal provenance remains terminal across resume; it cannot be skipped to spend on later works.
{
  const plans = [fixturePlan('fatal-first'), fixturePlan('must-not-run')];
  const set = planSet(plans); const outDir = tempOut(); let calls = 0;
  await runCanary({ planSet: set, outDir, callFn: async p => { calls++; return { transcript: transcript(p.delta, { apiKeySource: 'user' }), exitCode: 0 }; } });
  ok(calls === 1, 'fatal provenance stops the first execution immediately');
  const withCheckpoint = await runCanary({ planSet: set, outDir, callFn: noCall });
  ok(withCheckpoint.stopped === 'fatal-provenance' && withCheckpoint.counts.fatal === 1, 'prior fatal stops resume with its checkpoint');
  rmSync(join(workOut(outDir, plans[0]), 'checkpoint.json'));
  const resumed = await runCanary({ planSet: set, outDir, callFn: noCall });
  ok(resumed.attempts === 1 && resumed.stopped === 'fatal-provenance' && resumed.counts.fatal === 1 && resumed.rows[0].status === 'fatal', 'fatal remains visible and terminal without checkpoint.json');
}

// Held validation is terminal independently of the convenience checkpoint.
{
  const outDir = tempOut(); const set = planSet([fp]);
  await runCanary({ planSet: set, outDir, callFn: async () => ({ transcript: transcript(null), exitCode: 0 }) });
  rmSync(join(workOut(outDir, fp), 'checkpoint.json'));
  const resumed = await runCanary({ planSet: set, outDir, callFn: noCall });
  ok(resumed.attempts === 1 && resumed.counts.held === 1 && resumed.rows[0].errors.includes('no-structured-output'), 'held validation evidence stays terminal without checkpoint.json');
}

// A fatal on a later work must stay visible even though no scheduling loop may run.
{
  const plans = [fixturePlan('accepted-first'), fixturePlan('fatal-later'), fixturePlan('never-called')];
  const set = planSet(plans); const outDir = tempOut(); let calls = 0;
  const first = await runCanary({ planSet: set, outDir, callFn: async p => {
    calls++;
    return { transcript: transcript(p.delta, { apiKeySource: p === plans[1] ? 'user' : 'none' }), exitCode: 0 };
  } });
  ok(calls === 2 && first.counts.fatal === 1, 'later fatal stops before the third work');
  for (const plan of plans.slice(0, 2)) rmSync(join(workOut(outDir, plan), 'checkpoint.json'));
  const resumed = await runCanary({ planSet: set, outDir, callFn: noCall });
  ok(resumed.attempts === 2 && resumed.stopped === 'fatal-provenance' && resumed.counts.accepted === 1 && resumed.counts.fatal === 1 && resumed.rows[1].status === 'fatal', 'all preserved rows including the later fatal appear on zero-call resume');

  // Seed a coherent retryable earlier attempt: the global fatal guard must precede its retry too.
  const dir = workOut(outDir, plans[0]);
  const text = usageTranscript();
  const derived = deriveB4Attempt(plans[0], text, 1);
  const resultText = `${JSON.stringify(derived, null, 2)}\n`;
  const metaPath = join(dir, 'attempt-1.meta.json');
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  writeFileSync(join(dir, 'attempt-1.transcript.jsonl'), text);
  writeFileSync(join(dir, 'attempt-1.result.json'), resultText);
  writeFileSync(metaPath, JSON.stringify({ ...meta, status: derived.kind, exitCode: 1, transcriptSha256: sha256(text), resultSha256: sha256(resultText) }));
  const blockedRetry = await runCanary({ planSet: set, outDir, callFn: noCall });
  ok(blockedRetry.counts['usage-limit'] === 1 && blockedRetry.counts.fatal === 1 && blockedRetry.stopped === 'fatal-provenance' && blockedRetry.attempts === 2, 'fatal anywhere prevents even an earlier usage-limit retry and stays visible');
}

// The hard budget counts attempts across every work and stops at ten without a hidden retry.
{
  const plans = Array.from({ length: MAX_ATTEMPTS + 1 }, (_, i) => fixturePlan(`cap-${i}`));
  const set = planSet(plans); const outDir = tempOut(); let calls = 0;
  const report = await runCanary({ planSet: set, outDir, callFn: async () => { calls++; return { transcript: transcript(null), exitCode: 0 }; } });
  ok(calls === MAX_ATTEMPTS && report.attempts === MAX_ATTEMPTS && report.stopped === 'attempt-cap', 'total attempt cap holds across the run');
  for (const plan of plans.slice(0, MAX_ATTEMPTS)) rmSync(join(workOut(outDir, plan), 'checkpoint.json'));
  const resumed = await runCanary({ planSet: set, outDir, callFn: noCall });
  ok(resumed.attempts === MAX_ATTEMPTS && resumed.counts.held === MAX_ATTEMPTS && resumed.stopped === 'attempt-cap', 'ten reservations still exhaust the cap after every checkpoint is deleted');
}

// Repeated usage-limit resumes consume all ten slots, including a final unknown outcome.
for (const finalUnknown of [false, true]) {
  const outDir = tempOut(); const set = planSet([fp]); let calls = 0;
  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    const report = await runCanary({ planSet: set, outDir, callFn: async () => {
      calls++;
      if (finalUnknown && i === MAX_ATTEMPTS) throw new Error('spent the last slot');
      return { transcript: usageTranscript(), exitCode: 1 };
    } });
    assert.strictEqual(report.attempts, i);
  }
  ok(calls === MAX_ATTEMPTS && readdirSync(workOut(outDir, fp)).filter(name => name.endsWith('.reserved.json')).length === MAX_ATTEMPTS, 'ten resumes consume ten exclusive reservation slots');
  const resumed = await runCanary({ planSet: set, outDir, callFn: noCall });
  ok(resumed.attempts === MAX_ATTEMPTS && resumed.stopped === (finalUnknown ? 'unknown-outcome' : 'attempt-cap'), `reservation cap survives resume with final ${finalUnknown ? 'unknown-outcome' : 'usage-limit'}`);
  if (!finalUnknown) {
    const reservation = JSON.parse(readFileSync(join(workOut(outDir, fp), 'attempt-1.reserved.json'), 'utf8'));
    writeFileSync(join(workOut(outDir, fp), 'attempt-11.reserved.json'), JSON.stringify({ ...reservation, attempt: 11 }));
    await assert.rejects(runCanary({ planSet: set, outDir, callFn: noCall }), /attempt history exceeds the reservation cap/); n++;
  }
}

// Transcript and result tampering are rejected even without checkpoint.json.
for (const suffix of ['transcript.jsonl', 'result.json']) {
  const outDir = tempOut(); const set = planSet([fp]);
  await runCanary({ planSet: set, outDir, callFn: async p => ({ transcript: transcript(p.delta), exitCode: 0 }) });
  rmSync(join(workOut(outDir, fp), 'checkpoint.json'));
  const path = join(workOut(outDir, fp), `attempt-1.${suffix}`);
  writeFileSync(path, `${readFileSync(path, 'utf8')} `);
  await assert.rejects(runCanary({ planSet: set, outDir, callFn: noCall }), /attempt 1 evidence changed/); n++;
}

// Reservations, including unknown outcomes, participate in global contiguity and cannot be removed.
{
  const outDir = tempOut(); const set = planSet([fp]);
  await runCanary({ planSet: set, outDir, callFn: async () => ({ transcript: usageTranscript(), exitCode: 1 }) });
  await runCanary({ planSet: set, outDir, callFn: async () => { throw new Error('spent'); } });
  rmSync(join(workOut(outDir, fp), 'attempt-2.reserved.json'));
  const path = join(workOut(outDir, fp), 'attempt-3.reserved.json');
  const first = JSON.parse(readFileSync(join(workOut(outDir, fp), 'attempt-1.reserved.json'), 'utf8'));
  writeFileSync(path, JSON.stringify({ ...first, attempt: 3 }));
  await assert.rejects(runCanary({ planSet: set, outDir, callFn: noCall }), /not globally contiguous/); n++;
  rmSync(path);
  rmSync(join(workOut(outDir, fp), 'attempt-1.reserved.json'));
  await assert.rejects(runCanary({ planSet: set, outDir, callFn: noCall }), /evidence exists without a reservation/); n++;
}

// CLI defaults to plan-only and the live flag alone cannot bypass the owner-gated environment variable.
{
  const env = { ...process.env }; delete env.PASS_B_B4_CANARY_LIVE;
  const before = existsSync(join(RUN_ROOT, real.runId));
  const planned = spawnSync(process.execPath, ['scripts/pass-b-b4-structured-canary.mjs'], { cwd: process.cwd(), env, encoding: 'utf8' });
  ok(planned.status === 0 && planned.stdout.includes(real.runId) && planned.stdout.includes(CANARY_VERSION), 'default CLI prints the deterministic plan and bumped contract version');
  ok(/durable pre-call reservations/.test(planned.stdout) && /unknown-outcome/.test(planned.stdout) && /only retryable/.test(planned.stdout), 'plan describes the literal reservation cap and terminal semantics');
  ok(/exactly one tool_use:StructuredOutput/.test(planned.stdout) && /tools exactly \[StructuredOutput\]/.test(planned.stdout) && /timeout=900s/.test(planned.stdout), 'plan states the adapter exception, exact init tool list and measured timeout');
  ok(existsSync(join(RUN_ROOT, real.runId)) === before, 'default plan creates no run directory');
  const guarded = spawnSync('/opt/homebrew/bin/node', ['scripts/pass-b-b4-structured-canary.mjs', '--run'], { cwd: process.cwd(), env, encoding: 'utf8' });
  ok(guarded.status === 2 && /refusing live/.test(guarded.stderr), 'live execution refuses without the explicit environment gate');
  ok(existsSync(join(RUN_ROOT, real.runId)) === before, 'refused live command creates no run directory');
}

ok(unexpectedCalls === 0, 'all terminal, fatal, capped, and tampered resumes invoked callFn zero times');
assert.deepStrictEqual(fileHashes(spentDir), spentBefore); n++;
for (const path of cleanups) rmSync(path, { recursive: true, force: true });
console.log(`ok - pass-b structured B4 canary (offline): ${n} checks passed`);
