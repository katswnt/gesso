// Schedule time zone is a setting (owner 2026-10-16, Paris). Runs with PASS_B_TIMEZONE=Europe/Paris.
process.env.PASS_B_TIMEZONE = 'Europe/Paris';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const C = await import('../scripts/pass-b-corpus-collect.mjs');
const { sha256, stableJson } = await import('../scripts/lib/vision-legacy.mjs');
let n = 0; const check = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`FAIL ${name}`); throw e; } };

check('Paris clock: 00:30 Paris may start, 14:00 Paris may not; date is the Paris date', () => {
  assert.equal(C.SCHEDULE_TZ, 'Europe/Paris');
  const night = C.pacificClock(new Date('2026-10-16T22:30:00Z')); // 00:30 CEST on Oct 17
  assert.equal(night.date, '2026-10-17'); assert.equal(night.mayStart, true);
  assert.equal(C.pacificClock(new Date('2026-10-16T12:00:00Z')).mayStart, false); // 14:00 CEST
  assert.equal(C.pacificClock(new Date('2026-11-02T23:30:00Z')).mayStart, true); // 00:30 CET, after DST ends
  assert.throws(() => C.callWindow(new Date('2026-10-16T12:00:00Z'), undefined), /00:00–08:30 Europe\/Paris/);
});
check('schedule rebind: a Pacific epoch is paused until a reviewed epoch changes only the time zone', () => {
  const runDir = mkdtempSync(join(tmpdir(), 'sched-')); mkdirSync(join(runDir, 'execution-policies'));
  try {
    const paris = C.executionPolicy('2.1.300'), pacific = { ...paris, timeZone: 'America/Los_Angeles' };
    writeFileSync(join(runDir, 'execution-policies', '000001.json'), JSON.stringify({ version: 'passBCorpusExecutionEpoch/1', runId: C.CORPUS_RUN_ID, number: 1, previousSha256: null, policy: pacific, review: null }));
    assert.throws(() => C.bindExecutionPolicy(runDir, '2.1.300'), /--rebind-schedule/);
    const prev = C.executionEpochs(runDir).at(-1);
    const review = { version: C.SCHEDULE_REVIEW_VERSION, runId: C.CORPUS_RUN_ID, fromEpochSha256: prev.sha256, toTimeZone: 'Europe/Paris',
      toPolicySha256: sha256(stableJson(paris)), reviewedBy: 'fixture', reason: 'fixture', reviewedAt: '2026-10-16T12:00:00Z' };
    for (const [k, v] of [['reviewedBy', ''], ['toTimeZone', 'Asia/Tokyo'], ['toPolicySha256', 'x']]) assert.throws(() => C.rebindSchedule(runDir, { ...review, [k]: v }));
    const e2 = C.rebindSchedule(runDir, review);
    assert.equal(e2.policy.timeZone, 'Europe/Paris'); assert.equal(C.bindExecutionPolicy(runDir, '2.1.300').sha256, e2.sha256);
    assert.throws(() => C.rebindSchedule(runDir, { ...review, fromEpochSha256: e2.sha256 }), /no change/);
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});
console.log(`pass-b-schedule-tz.test: ${n} checks passed`);
