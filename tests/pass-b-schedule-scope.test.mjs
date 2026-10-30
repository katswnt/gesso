// Scope is a schedule setting (owner 2026-10-30, VSD-068: "once the dailies are covered we're supposed to be moving on
// to the rest of the works"). PASS_B_SCOPE=corpus = the 30-day window first, then the remaining priority bands.
process.env.PASS_B_TIMEZONE = 'Europe/Paris'; process.env.PASS_B_HOURS = 'all-day'; process.env.PASS_B_SCOPE = 'corpus';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const C = await import('../scripts/pass-b-corpus-collect.mjs');
const { sha256, stableJson } = await import('../scripts/lib/vision-legacy.mjs');
let n = 0; const check = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`FAIL ${name}`); throw e; } };

const W = (id, fame, medium = 'painting') => ({ id, fame, img: `https://example.org/${id}.jpg`, region: 'Europe', medium });
const pool = [W('win1', 1), W('win2', 1), W('easy1', 9), W('med1', 2), W('med2', 50), W('hard1', 3), W('imp1', 4), W('stray', 99)];
const daily = { byDate: { '2026-10-31': { medium: ['win2'] }, '2026-10-30': { easy: ['win1'] }, '2027-03-01': { hard: ['hard1'] } },
  easy: ['easy1', 'win1'], medium: ['med1', 'med2'], hard: ['hard1'], impossible: ['imp1'] };

check('corpus scope: window works first (date order), then Easy, top-fame M/H/I, Medium, Hard, Impossible, rest', () => {
  const q = C.scopeOrder(pool, daily, '2026-10-30');
  assert.deepEqual(q.slice(0, 2), ['win1', 'win2']);
  assert.equal(q[2], 'easy1');
  assert.deepEqual(new Set(q.slice(3, 6)), new Set(['med2', 'hard1', 'imp1'])); // fame quintile of each tier (ceil(n/5) = 1)
  assert.deepEqual(q.slice(6), ['med1', 'stray']);
  assert.deepEqual(C.scopeOrder(pool, daily, '2026-10-30', 'window'), ['win1', 'win2']);
  assert.equal(C.executionPolicy('2.1.300').scope, 'rolling-30-days-then-priority-bands-through-b3');
});
check('corpus rebind: a window epoch pauses; reviews /1 and /2 cannot change the scope; /3 binding toScope appends one epoch', () => {
  const runDir = mkdtempSync(join(tmpdir(), 'scope-')); mkdirSync(join(runDir, 'execution-policies'));
  try {
    const corpus = C.executionPolicy('2.1.300'), window = { ...corpus, scope: 'rolling-30-days-through-b3' };
    writeFileSync(join(runDir, 'execution-policies', '000001.json'), JSON.stringify({ version: 'passBCorpusExecutionEpoch/1', runId: C.CORPUS_RUN_ID, number: 1, previousSha256: null, policy: window, review: null }));
    assert.throws(() => C.bindExecutionPolicy(runDir, '2.1.300'), /--rebind-schedule/);
    const prev = C.executionEpochs(runDir).at(-1);
    const review = { version: C.SCHEDULE_REVIEW_VERSION, runId: C.CORPUS_RUN_ID, fromEpochSha256: prev.sha256, toTimeZone: 'Europe/Paris', toHours: 'all-day', toScope: 'corpus',
      toPolicySha256: sha256(stableJson(corpus)), reviewedBy: 'fixture', reason: 'fixture', reviewedAt: '2026-10-30T12:00:00Z' };
    assert.throws(() => C.rebindSchedule(runDir, { ...review, version: 'passBCorpusScheduleReview/2' }), /cannot change the scope/);
    assert.throws(() => C.rebindSchedule(runDir, { ...review, toScope: 'window' }), /review binding required/);
    assert.throws(() => C.rebindSchedule(runDir, { ...review, toPolicySha256: 'x' }), /target policy/);
    const e2 = C.rebindSchedule(runDir, review);
    assert.equal(e2.policy.scope, corpus.scope); assert.equal(C.bindExecutionPolicy(runDir, '2.1.300').sha256, e2.sha256);
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});
console.log(`pass-b-schedule-scope.test: ${n} checks passed`);
