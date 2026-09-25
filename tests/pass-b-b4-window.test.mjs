// Offline regressions for the rolling-window structured B4 runner. All model calls are injected mocks.
import assert from 'node:assert';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { syntheticFixture, CALIBRATION_MODEL } from '../scripts/lib/pass-b-calibration.mjs';
import { sha256 } from '../scripts/lib/vision-legacy.mjs';
import { runWindow, runWork, workHistory, windowBinding, windowRunId, preservedFatal } from '../scripts/pass-b-b4-window.mjs';

let n = 0; const ok = (v, m) => { assert(v, m); n++; };
const H = v => sha256(String(v));
const NIGHT = () => new Date('2026-09-25T08:00:00Z');   // 01:00 Pacific: starts allowed
const DAY = () => new Date('2026-09-25T18:00:00Z');     // 11:00 Pacific: protected hours
const roots = []; const out = () => { const r = mkdtempSync(join(tmpdir(), 'b4w-test-')); roots.push(r); return join(r, 'run'); };
const binding = windowBinding(), runId = windowRunId(binding);

function transcript(output, { apiKeySource = 'none', tools = ['StructuredOutput'] } = {}) {
  const ev = [{ type: 'system', subtype: 'init', apiKeySource, model: CALIBRATION_MODEL, tools: ['StructuredOutput'], claude_code_version: 'test' }];
  if (tools.length) ev.push({ type: 'assistant', message: { content: tools.map((name, i) => ({ type: 'tool_use', id: `t${i}`, name, input: output })) } });
  ev.push({ type: 'result', subtype: 'success', is_error: false, structured_output: output, result: '', modelUsage: { [CALIBRATION_MODEL]: { output_tokens: 10 } }, usage: { output_tokens: 10 }, num_turns: 1 });
  return `${ev.map(r => JSON.stringify(r)).join('\n')}\n`;
}
const usage = () => `${[{ type: 'system', subtype: 'init', apiKeySource: 'none', model: CALIBRATION_MODEL, tools: ['StructuredOutput'] }, { type: 'result', subtype: 'error', is_error: true, api_error_status: 429, result: 'usage limit reached' }].map(r => JSON.stringify(r)).join('\n')}\n`;
function plan(workId) {
  const fx = syntheticFixture();
  return { workId, sourceRunId: 'corpus-test', b0: { work: { id: workId }, image: { imgSha256: 'a'.repeat(64), ext: 'jpg' } },
    b1: fx.bodies.B1, b2: fx.bodies.B2, b3: fx.bodies.B3, legacy: { teaching: {} }, promptHash: H(`p:${workId}`), sealedFindingIds: [],
    sourceBinding: { b0Sha256: H(`b0:${workId}`), B1: { completionSha256: H(`b1:${workId}`) }, B2: { completionSha256: H(`b2:${workId}`) }, B3: { completionSha256: H(`b3:${workId}`) } },
    delta: fx.bodies.B4Delta, command: { env: { removeKeys: [] } } };
}
const dir = (o, p) => join(o, 'works', sha256(p.workId).slice(0, 24));
const good = async p => ({ transcript: transcript(p.delta), exitCode: 0 });

// accepted, then terminal on resume without a call
{ const o = out(), plans = [plan('w1'), plan('w2')]; let calls = 0;
  let r = await runWindow({ plans, outDir: o, runId, binding, now: NIGHT, lanes: 1, callFn: async p => { calls++; return good(p); } });
  ok(r.accepted === 2 && calls === 2 && r.stop === 'window-exhausted', 'valid deltas are accepted (integrity only)');
  r = await runWindow({ plans, outDir: o, runId, binding, now: NIGHT, lanes: 1, callFn: async () => { calls++; throw new Error('no'); } });
  ok(calls === 2 && r['skipped-terminal'] === 2, 'resume never re-calls a terminal work'); }

// reservation exists before the call; a call that throws is a terminal unknown-outcome
{ const o = out(), p = plan('w1'); let seen = null;
  const r = await runWork({ outDir: o, runId, plan: p, now: NIGHT, callFn: async () => { seen = existsSync(join(dir(o, p), 'attempt-1.reserved.json')); throw new Error('crash after spend'); } });
  ok(seen === true && r.kind === 'unknown-outcome', 'reservation is durable before spending; crash is unknown-outcome');
  const h = workHistory(o, p, runId);
  ok(h.attempts.length === 1 && h.attempts[0].kind === 'unknown-outcome', 'unknown-outcome is reconstructed from the reservation and never retried'); }

// held is terminal with zero validation retries; duplicate StructuredOutput is held, not fatal
{ const o = out(), plans = [plan('bad'), plan('dup'), plan('next')]; let calls = 0;
  const r = await runWindow({ plans, outDir: o, runId, binding, now: NIGHT, lanes: 1, callFn: async p => { calls++;
    if (p.workId === 'bad') return { transcript: transcript(null), exitCode: 0 };
    if (p.workId === 'dup') return { transcript: transcript(p.delta, { tools: ['StructuredOutput', 'StructuredOutput'] }), exitCode: 0 };
    return good(p); } });
  ok(r.held === 2 && r.accepted === 1 && r.fatal === 0 && calls === 3, 'invalid and duplicate-emission outputs are held; the run continues');
  ok(!preservedFatal(o), 'holds never create a fatal'); }

// usage-limit stops the session; a later session retries that work with a new reservation
{ const o = out(), p = plan('w1'); let calls = 0;
  let r = await runWindow({ plans: [p], outDir: o, runId, binding, now: NIGHT, lanes: 1, callFn: async () => { calls++; return { transcript: usage(), exitCode: 1 }; } });
  ok(r.stop === 'usage-limit' && r['usage-limit'] === 1, 'usage-limit stops the session');
  r = await runWindow({ plans: [p], outDir: o, runId, binding, now: NIGHT, lanes: 1, callFn: async q => { calls++; return good(q); } });
  ok(r.accepted === 1 && calls === 2 && readdirSync(dir(o, p)).filter(f => f.endsWith('.reserved.json')).length === 2, 'usage-limit work retries once under a new reservation'); }

// provenance failure is fatal, persisted, and blocks every later call
{ const o = out(), plans = [plan('w1'), plan('w2')]; let calls = 0;
  let r = await runWindow({ plans, outDir: o, runId, binding, now: NIGHT, lanes: 1, callFn: async p => { calls++; return { transcript: transcript(p.delta, { apiKeySource: 'user' }), exitCode: 0 }; } });
  ok(r.stop === 'fatal-provenance' && calls === 1 && preservedFatal(o), 'wrong apiKeySource is fatal and persisted');
  r = await runWindow({ plans, outDir: o, runId, binding, now: NIGHT, lanes: 1, callFn: async () => { calls++; throw new Error('no'); } });
  ok(r.stop === 'preserved-fatal' && calls === 1, 'a preserved fatal blocks every later session'); }

// protected hours: nothing reserved, nothing called
{ const o = out(), p = plan('w1'); let calls = 0;
  const r = await runWindow({ plans: [p], outDir: o, runId, binding, now: DAY, lanes: 1, callFn: async () => { calls++; return good(p); } });
  ok(r.stop === 'protected-hours' && calls === 0 && !existsSync(dir(o, p)), 'outside 00:00–08:30 Pacific nothing is reserved or called'); }

// session cap
{ const o = out(), plans = ['a', 'b', 'c', 'd'].map(plan); let calls = 0;
  const r = await runWindow({ plans, outDir: o, runId, binding, now: NIGHT, lanes: 1, maxCalls: 2, callFn: async p => { calls++; return good(p); } });
  ok(calls === 2 && r.stop === 'session-cap', 'a session never exceeds --max calls'); }

// changed source evidence and tampered transcripts are refused (preserved, reported, never re-called)
{ const o = out(), p = plan('w1');
  await runWork({ outDir: o, runId, plan: p, now: NIGHT, callFn: good });
  assert.throws(() => workHistory(o, { ...p, promptHash: H('changed') }, runId), /source evidence or prompt changed/); n++;
  const t = join(dir(o, p), 'attempt-1.transcript.jsonl'); writeFileSync(t, `${readFileSync(t, 'utf8')} `);
  assert.throws(() => workHistory(o, p, runId), /evidence changed/); n++; }

for (const r of roots) rmSync(r, { recursive: true, force: true });
console.log(`pass-b-b4-window.test: ${n} checks passed`);
