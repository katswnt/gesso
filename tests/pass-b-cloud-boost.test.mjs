// VSD-080: the launcher's boost applies only before PASS_B_BOOST_UNTIL; after it (or with a bad/missing time)
// the routine's plain values stand. Runs the launcher's BOOST block on its own.
// VSD-084: the boost also raises the weekly pacing ceiling to 0.98, and the pacer never accepts more than that.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { weeklyCeiling, pacingDecision } from '../scripts/lib/pass-b-pacing.mjs';

const src = readFileSync(new URL('../scripts/pass-b-cloud-nightly.sh', import.meta.url), 'utf8');
const block = src.slice(src.indexOf('# BOOST-BEGIN'), src.indexOf('# BOOST-END'));
assert.ok(block.includes('PASS_B_BOOST_UNTIL'), 'launcher has a BOOST block');
const run = env => execFileSync('bash', ['-c', `PASS_B_MAX_CALLS=500\n${block}\necho "$PASS_B_MAX_CALLS \${PASS_B_NIGHTLY_WORKERS:-3} \${PASS_B_WEEKLY_CEILING:-0.95}"`],
  { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' }).trim();
const hour = 3600 * 1000;
let n = 0;
const check = (name, fn) => { fn(); n++; console.log(`ok - ${name}`); };

check('before the time: 6 workers, 1000 calls', () => assert.equal(run({ PASS_B_BOOST_UNTIL: new Date(Date.now() + hour).toISOString() }), '1000 6 0.98'));
check('custom boost values', () => assert.equal(run({ PASS_B_BOOST_UNTIL: new Date(Date.now() + hour).toISOString(), PASS_B_BOOST_WORKERS: '5', PASS_B_BOOST_MAX_CALLS: '800' }), '800 5 0.98'));
check('after the time: plain values', () => assert.equal(run({ PASS_B_BOOST_UNTIL: new Date(Date.now() - hour).toISOString() }), '500 3 0.95'));
check('unset or unparseable: plain values', () => { assert.equal(run({}), '500 3 0.95'); assert.equal(run({ PASS_B_BOOST_UNTIL: 'thursday' }), '500 3 0.95'); });
check('custom boost ceiling', () => assert.equal(run({ PASS_B_BOOST_UNTIL: new Date(Date.now() + hour).toISOString(), PASS_B_BOOST_CEILING: '0.97' }), '1000 6 0.97'));
check('pacer ceiling: default 0.95, boost value honoured, above 0.98 or malformed refused', () => {
  assert.equal(weeklyCeiling(undefined), 0.95); assert.equal(weeklyCeiling(''), 0.95); assert.equal(weeklyCeiling('0.98'), 0.98);
  for (const bad of ['0.99', '1', 'max', '-0.5', '0']) assert.throws(() => weeklyCeiling(bad), /at most 0.98/);
});
check('at the end of the week, 0.98 lets 96% go and stops 98%', () => {
  const now = new Date('2026-11-26T10:00:00Z'), resetsAt = Date.parse('2026-11-26T11:00:00Z'), at = now.toISOString();
  const obs = u => ({ sevenDay: { utilization: u, resetsAt, observedAt: at }, fiveHour: { utilization: 0.1, resetsAt: resetsAt + hour, observedAt: at } });
  assert.equal(pacingDecision({ obs: obs(0.96), now, opts: { ceiling: 0.98 } }).go, true);
  assert.equal(pacingDecision({ obs: obs(0.96), now }).go, false, 'the plain 0.95 ceiling stops 96%');
  assert.match(pacingDecision({ obs: obs(0.98), now, opts: { ceiling: 0.98 } }).reason, /98% ceiling/);
});
console.log(`${n} checks passed`);
