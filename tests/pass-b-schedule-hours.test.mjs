// Hours are a schedule setting (owner 2026-10-17, VSD-066: "every two hours around the clock"). PASS_B_HOURS=all-day.
process.env.PASS_B_TIMEZONE = 'Europe/Paris'; process.env.PASS_B_HOURS = 'all-day';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const C = await import('../scripts/pass-b-corpus-collect.mjs');
const { sha256, stableJson } = await import('../scripts/lib/vision-legacy.mjs');
let n = 0; const check = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`FAIL ${name}`); throw e; } };

check('all-day: 14:00 Paris may start; a call keeps the 30-minute cap; the date is still the Paris date', () => {
  const day = C.pacificClock(new Date('2026-10-17T12:00:00Z'));
  assert.equal(day.mayStart, true); assert.equal(day.date, '2026-10-17');
  assert.equal(C.callWindow(new Date('2026-10-17T12:00:00Z'), undefined).timeout, 30 * 60 * 1000);
  assert.equal(C.executionPolicy('2.1.300').startWindow, 'all day (owner 2026-10-17)');
});
check('all-day rebind: a night epoch pauses; review /1 cannot change hours; review /2 binding toHours appends one epoch', () => {
  const runDir = mkdtempSync(join(tmpdir(), 'hours-')); mkdirSync(join(runDir, 'execution-policies'));
  try {
    const allDay = C.executionPolicy('2.1.300'), night = { ...allDay, startWindow: '00:00–08:30', finishBy: '09:00' };
    writeFileSync(join(runDir, 'execution-policies', '000001.json'), JSON.stringify({ version: 'passBCorpusExecutionEpoch/1', runId: C.CORPUS_RUN_ID, number: 1, previousSha256: null, policy: night, review: null }));
    assert.throws(() => C.bindExecutionPolicy(runDir, '2.1.300'), /--rebind-schedule/);
    const prev = C.executionEpochs(runDir).at(-1);
    const review = { version: C.SCHEDULE_REVIEW_VERSION, runId: C.CORPUS_RUN_ID, fromEpochSha256: prev.sha256, toTimeZone: 'Europe/Paris', toHours: 'all-day',
      toPolicySha256: sha256(stableJson(allDay)), reviewedBy: 'fixture', reason: 'fixture', reviewedAt: '2026-10-17T12:00:00Z' };
    assert.throws(() => C.rebindSchedule(runDir, { ...review, version: 'passBCorpusScheduleReview/1' }), /cannot change the hours/);
    assert.throws(() => C.rebindSchedule(runDir, { ...review, toHours: 'night' }));
    const e2 = C.rebindSchedule(runDir, review);
    assert.equal(e2.policy.startWindow, allDay.startWindow); assert.equal(C.bindExecutionPolicy(runDir, '2.1.300').sha256, e2.sha256);
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});
console.log(`pass-b-schedule-hours.test: ${n} checks passed`);
