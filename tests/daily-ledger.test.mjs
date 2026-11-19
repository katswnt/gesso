// A refreeze must never lose a served day (2026-11-18). The ledger had stopped at Aug 31 while daily-order still held
// Aug 21 – Feb 20; freeze kept only today-3 onward and appended only that window, so Aug 31 – Nov 15 would vanish.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { foldServed } from '../scripts/lib/daily-ledger.mjs';

const iso = d => new Date(d * 86400000).toISOString().slice(0, 10);
const today = Math.floor(Date.parse('2026-11-18T12:00:00Z') / 86400000);
const day = n => ({ easy: [`e${n}`], medium: [`m${n}`], hard: [`h${n}`], impossible: [`i${n}`] });
const prior = {}; for (let d = today - 89; d <= today + 90; d++) prior[iso(d)] = day(d);
const stale = {}; for (let d = today - 89; d <= today - 80; d++) stale[iso(d)] = day(d);
stale[iso(today - 85)] = { easy: ['kept'], medium: [], hard: [], impossible: [] };
const window = {}; for (let d = today - 3; d <= today + 180; d++) window[iso(d)] = prior[iso(d)] || day(d);
let n = 0; const check = (name, fn) => { fn(); n++; console.log(`ok - ${name}`); };

check('old freeze (window only) loses served days', () => {
  const { ledger } = foldServed(stale, window, today);
  assert.ok(!ledger[iso(today - 40)], 'repro: a mid-gap day is lost without folding the prior calendar');
});
check('folding the prior calendar first keeps every served day', () => {
  let { ledger } = foldServed(stale, prior, today); ({ ledger } = foldServed(ledger, window, today));
  for (let d = today - 89; d <= today; d++) assert.ok(ledger[iso(d)], `${iso(d)} recorded`);
  assert.ok(!ledger[iso(today + 1)], 'future days are not recorded');
});
check('an existing ledger entry is never overwritten', () => {
  assert.deepEqual(foldServed(stale, prior, today).ledger[iso(today - 85)].easy, ['kept']);
  assert.equal(foldServed(stale, prior, today).added, 80);
});
check('freeze-daily folds the prior calendar before seeding and truncating', () => {
  const src = readFileSync(new URL('../scripts/freeze-daily.mjs', import.meta.url), 'utf8');
  const fold = src.indexOf('foldServed(ledger, prior, todayNum)');
  assert.ok(fold > 0 && fold < src.indexOf('PRE-SEED the anti-repeat'), 'prior folded before the anti-repeat pre-seed');
});
console.log(`${n} checks passed`);
