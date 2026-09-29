// Owner labels bind to the exact frozen sample text; a changed or foreign sample is refused.
import assert from 'node:assert/strict';
import { freezeSample, bindLabels } from '../scripts/pass-b-audit-label-import.mjs';

const sample = [{ workId: 'w1', componentId: 'why', surface: 'why', text: 'A' }, { workId: 'w1', componentId: 'note:n1', surface: 'note', text: 'B' }];
const freeze = freezeSample(sample);
const raw = rows => ({ version: 'passBAuditOwnerLabels/1', labeledAt: 't', rows });
let n = 0; const ok = (name, fn) => { fn(); n++; };

ok('binds labels with text hashes', () => {
  const b = bindLabels(freeze, raw([{ workId: 'w1', componentId: 'why', label: 'supported', note: 'x' }]));
  assert.equal(b.sampleSha256, freeze.sampleSha256); assert.equal(b.rows[0].label, 'supported'); assert.equal(b.rows[1].label, null);
  assert.ok(/^[0-9a-f]{64}$/.test(b.rows[0].textSha256));
});
ok('text change changes the sample hash', () => assert.notEqual(freezeSample([{ ...sample[0], text: 'A2' }, sample[1]]).sampleSha256, freeze.sampleSha256));
ok('refuses rows outside the sample', () => assert.throws(() => bindLabels(freeze, raw([{ workId: 'w2', componentId: 'why', label: 'supported' }])), /not in the frozen sample/));
ok('refuses an export from another sample', () => assert.throws(() => bindLabels(freeze, { ...raw([]), sampleSha256: 'f'.repeat(64) }), /different sample/));
ok('refuses unknown labels and duplicates', () => {
  assert.throws(() => bindLabels(freeze, raw([{ workId: 'w1', componentId: 'why', label: 'maybe' }])), /bad label/);
  assert.throws(() => bindLabels(freeze, raw([{ workId: 'w1', componentId: 'why' }, { workId: 'w1', componentId: 'why' }])), /duplicate/);
});
console.log(`pass-b-audit-label-import: ${n} checks passed`);
