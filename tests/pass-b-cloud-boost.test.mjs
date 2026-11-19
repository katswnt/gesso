// VSD-080: the launcher's boost applies only before PASS_B_BOOST_UNTIL; after it (or with a bad/missing time)
// the routine's plain values stand. Runs the launcher's BOOST block on its own.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../scripts/pass-b-cloud-nightly.sh', import.meta.url), 'utf8');
const block = src.slice(src.indexOf('# BOOST-BEGIN'), src.indexOf('# BOOST-END'));
assert.ok(block.includes('PASS_B_BOOST_UNTIL'), 'launcher has a BOOST block');
const run = env => execFileSync('bash', ['-c', `PASS_B_MAX_CALLS=500\n${block}\necho "$PASS_B_MAX_CALLS \${PASS_B_NIGHTLY_WORKERS:-3}"`],
  { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' }).trim();
const hour = 3600 * 1000;
let n = 0;
const check = (name, fn) => { fn(); n++; console.log(`ok - ${name}`); };

check('before the time: 6 workers, 1000 calls', () => assert.equal(run({ PASS_B_BOOST_UNTIL: new Date(Date.now() + hour).toISOString() }), '1000 6'));
check('custom boost values', () => assert.equal(run({ PASS_B_BOOST_UNTIL: new Date(Date.now() + hour).toISOString(), PASS_B_BOOST_WORKERS: '5', PASS_B_BOOST_MAX_CALLS: '800' }), '800 5'));
check('after the time: plain values', () => assert.equal(run({ PASS_B_BOOST_UNTIL: new Date(Date.now() - hour).toISOString() }), '500 3'));
check('unset or unparseable: plain values', () => { assert.equal(run({}), '500 3'); assert.equal(run({ PASS_B_BOOST_UNTIL: 'thursday' }), '500 3'); });
console.log(`${n} checks passed`);
