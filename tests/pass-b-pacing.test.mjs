// Usage pacing (VSD-055): readings from real transcript shape, the pace rule, stale/missing/reset handling (never
// zero), the probe budget, the call cap, and the shared runner stopping BEFORE any reservation. Offline.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rateLimitFrom, recordObservation, latestObservation, pacingDecision, makePacer } from '../scripts/lib/pass-b-pacing.mjs';
import { runAudit, countReservations } from '../scripts/pass-b-shadow-audit.mjs';

let n = 0; const check = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error(`FAIL ${name}`); throw e; } };
const now = new Date('2026-09-28T10:00:00Z'); // reset Thu 2026-10-01 11:00Z -> 3d1h left, ~56% of the week elapsed
const reset = Date.parse('2026-10-01T11:00:00Z');
const ev = (seven, five = 0.2, fiveReset = reset - 86400e3) => JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', resetsAt: reset / 1000, rateLimitType: 'seven_day', utilization: seven,
  unifiedWindows: { five_hour: { utilization: five, resetsAt: fiveReset / 1000 }, seven_day: { utilization: seven, resetsAt: reset / 1000 } } } });
const obs = (seven, { at = now, five = 0.2 } = {}) => ({ observedAt: at.toISOString(), ...rateLimitFrom(ev(seven, five, now.getTime() + 3600e3)) });

await check('reads both windows (last event wins) in milliseconds', () => {
  const r = rateLimitFrom(`${ev(0.4)}\n{"type":"assistant"}\n${ev(0.5, 0.3)}\n`);
  assert.equal(r.sevenDay.utilization, 0.5); assert.equal(r.fiveHour.utilization, 0.3); assert.equal(r.sevenDay.resetsAt, reset);
  assert.equal(rateLimitFrom('{"type":"result"}'), null);
});
await check('on pace goes; ahead of pace stops; ceiling and five-hour windows stop', () => {
  assert.equal(pacingDecision({ obs: obs(0.40), now }).go, true);
  assert.equal(pacingDecision({ obs: obs(0.60), now }).go, false);              // ahead of ~56% elapsed (+3 margin)
  const late = new Date(reset - 3600e3);                                          // last hour of the week: elapsed ~99%
  assert.match(pacingDecision({ obs: obs(0.86, { at: late }), now: late }).reason, /ceiling/);
  assert.match(pacingDecision({ obs: obs(0.30, { five: 0.95 }), now }).reason, /five-hour/);
});
await check('missing, stale, or pre-reset readings never mean zero: two probe calls, then stop', () => {
  for (const o of [null, obs(0.1, { at: new Date(now - 4 * 3600e3) }), { ...obs(0.1), sevenDay: { utilization: 0.1, resetsAt: now.getTime() - 1 } }]) {
    const a = pacingDecision({ obs: o, now, probeUsed: 0 }), b = pacingDecision({ obs: o, now, probeUsed: 2 });
    assert.equal(a.mode, 'probe'); assert.equal(a.go, true); assert.equal(b.go, false); assert.match(b.reason, /never assume zero/);
  }
});
await check('the pacer: fresh readings reset the probe budget; the session cap is a backstop', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pace-')), log = join(dir, 'u.jsonl');
  const p = makePacer({ logPath: log, maxCalls: 3, now: () => now });
  assert.equal(p.check().mode, 'probe'); assert.equal(p.check().mode, 'probe'); assert.equal(p.check().go, false); // no reading: 2 probes then stop
  recordObservation(log, ev(0.3), { observedAt: now });
  const q = makePacer({ logPath: log, maxCalls: 2, now: () => now });
  assert.equal(q.check().mode, 'normal'); assert.equal(q.check().go, true); assert.match(q.check().reason, /cap/);
  assert.equal(latestObservation(log).sevenDay.utilization, 0.3);
  rmSync(dir, { recursive: true });
});
await check('a fresh reading restores the probe budget if it later goes stale in a long session', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pace-')), log = join(dir, 'u.jsonl'); let t = now.getTime();
  const p = makePacer({ logPath: log, maxCalls: 50, now: () => new Date(t) });
  p.check(); p.check(); assert.equal(p.check().go, false);                 // no reading: probes exhausted
  recordObservation(log, ev(0.3), { observedAt: new Date(t) }); assert.equal(p.check().mode, 'normal');
  t += 4 * 3600e3;                                                           // reading goes stale
  assert.equal(p.check().mode, 'probe');
  rmSync(dir, { recursive: true });
});
await check('the shared runner stops on pacing BEFORE writing any reservation, and records observations', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pace-run-')), log = join(dir, 'u.jsonl');
  recordObservation(log, ev(0.97), { observedAt: new Date('2026-09-29T08:00:00Z') });
  const plan = { workId: 'w', input: { x: 1 }, inputSha256: 'i', promptHash: 'p', binding: {}, controllerHolds: {} };
  let calls = 0;
  const r = await runAudit({ plans: [plan], outDir: join(dir, 'run'), runId: 'sa-p', binding: {}, now: () => new Date('2026-09-29T08:30:00Z'),
    pacer: makePacer({ logPath: log, maxCalls: 10, now: () => new Date('2026-09-29T08:30:00Z') }), usageLog: log, callFn: async () => { calls++; } });
  assert.match(r.stop, /^pacing: weekly 97%/); assert.equal(calls, 0); assert.equal(countReservations(join(dir, 'run')), 0);
  rmSync(dir, { recursive: true });
});
await check('stale blocking readings remain blocking until their own reset', () => {
  const late = new Date(reset - 3600e3);
  assert.equal(pacingDecision({ obs: obs(.97, { at: new Date(late - 4 * 3600e3) }), now: late }).go, false);
  const old = { ...obs(.1, { at: new Date(now - 4 * 3600e3) }), fiveHour: { utilization: .95, resetsAt: now.getTime() + 3600e3 } };
  assert.equal(pacingDecision({ obs: old, now }).go, false);
  assert.equal(pacingDecision({ obs: { ...old, fiveHour: { ...old.fiveHour, resetsAt: now.getTime() - 1 } }, now }).mode, 'probe');
});
await check('missing, expired, invalid or independently stale five-hour evidence never permits normal execution', () => {
  for (const fiveHour of [null, { utilization: .1, resetsAt: now.getTime() - 1 }, { utilization: NaN, resetsAt: reset },
    { utilization: .1, resetsAt: reset, observedAt: new Date(now - 4 * 3600e3).toISOString() }]) {
    const r = { ...obs(.1), fiveHour };
    assert.equal(pacingDecision({ obs: r, now }).mode, 'probe');
    assert.equal(pacingDecision({ obs: r, now, probeUsed: 2 }).go, false);
  }
});
await check('partial observations retain the other window and cannot erase a known ceiling', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pace-partial-')), log = join(dir, 'usage');
  try {
    recordObservation(log, ev(.97), { observedAt: now });
    recordObservation(log, JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { unifiedWindows: { five_hour: { utilization: .1, resetsAt: reset / 1000 } } } }), { observedAt: new Date(now.getTime() + 1000) });
    assert.equal(latestObservation(log).sevenDay.utilization, .97);
    assert.equal(makePacer({ logPath: log, maxCalls: 30, now: () => new Date(now.getTime() + 2000) }).check().go, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
await check('future-dated readings cannot replace known usage or grant normal capacity', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pace-future-')), log = join(dir, 'usage');
  try {
    recordObservation(log, ev(.1), { observedAt: new Date(now.getTime() + 1000) });
    assert.equal(latestObservation(log, now), null);
    recordObservation(log, ev(.97), { observedAt: now });
    assert.equal(makePacer({ logPath: log, maxCalls: 30, now: () => now }).check().go, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
await check('partial readings do not repeatedly restore the two-probe allowance', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pace-partial-')), log = join(dir, 'usage'); let time = now.getTime();
  try {
    const p = makePacer({ logPath: log, maxCalls: 30, now: () => new Date(time) });
    for (let i = 0; i < 5; i++) {
      recordObservation(log, JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { unifiedWindows: { five_hour: { utilization: .1, resetsAt: reset / 1000 } } } }), { observedAt: new Date(++time) });
      assert.equal(p.check().go, i < 2);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
await check('one durable cap across parent, collector and three routine firings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pace-budget-')), log = join(dir, 'usage'), statePath = join(dir, 'budget.json');
  try {
    recordObservation(log, ev(.1), { observedAt: now });
    let calls = 0;
    for (let session = 0; session < 3; session++) {
      const p = makePacer({ logPath: log, maxCalls: 30, statePath, now: () => now });
      for (let i = 0; i < 20; i++) if (p.check().go) calls++;
    }
    assert.equal(calls, 30);
    assert.equal(makePacer({ logPath: log, maxCalls: 30, statePath }).remaining, 0);
    assert.throws(() => makePacer({ logPath: log, maxCalls: 31, statePath }).check(), /budget binding/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
await check('missing telemetry permits two probes total across restarts, then a complete reading restores pacing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pace-budget-')), log = join(dir, 'usage'), statePath = join(dir, 'budget.json');
  try {
    let calls = 0;
    for (let session = 0; session < 3; session++) {
      const p = makePacer({ logPath: log, maxCalls: 30, statePath, now: () => now });
      for (let i = 0; i < 3; i++) if (p.check().go) calls++;
    }
    assert.equal(calls, 2);
    recordObservation(log, ev(.1), { observedAt: now });
    assert.equal(makePacer({ logPath: log, maxCalls: 30, statePath, now: () => now }).check().mode, 'normal');
    writeFileSync(statePath, '{');
    assert.throws(() => makePacer({ logPath: log, maxCalls: 30, statePath }).check());
    assert.throws(() => makePacer({ logPath: log, maxCalls: NaN }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
console.log(`pass-b-pacing.test: ${n} checks passed`);
