// Freeze the owner sample and bind the owner's downloaded labels to its exact text (offline, no model calls).
// The label page's export carries ids only, so this import checks every row against the frozen sample and records
// per-component text hashes plus a whole-sample hash. A later change to the sample can never silently reuse labels.
//   node scripts/pass-b-audit-label-import.mjs <downloaded-labels.json>
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256, stableJson } from './lib/vision-legacy.mjs';

const OUT = 'data/incoming/vision-calibration/audit-eval-v1';
const LABELS = new Set(['supported', 'unsupported', 'unsure']);
const key = r => `${r.workId}|${r.componentId}`;

export function freezeSample(sample) {
  const rows = sample.map(s => ({ workId: s.workId, componentId: s.componentId, surface: s.surface, textSha256: sha256(s.text) }));
  return { version: 'passBAuditSampleFreeze/1', sampleSha256: sha256(stableJson(rows)), rows };
}

export function bindLabels(freeze, raw) {
  if (raw?.version !== 'passBAuditOwnerLabels/1' || !Array.isArray(raw.rows)) throw new Error('not a passBAuditOwnerLabels/1 export');
  if (raw.sampleSha256 && raw.sampleSha256 !== freeze.sampleSha256) throw new Error('export was made from a different sample');
  const byKey = new Map(raw.rows.map(r => [key(r), r]));
  if (byKey.size !== raw.rows.length) throw new Error('duplicate rows in export');
  const extra = raw.rows.filter(r => !freeze.rows.some(f => key(f) === key(r)));
  if (extra.length) throw new Error(`export has rows not in the frozen sample: ${extra.map(key).join(', ')}`);
  const rows = freeze.rows.map(f => {
    const r = byKey.get(key(f)) || {};
    if (r.label != null && !LABELS.has(r.label)) throw new Error(`bad label ${r.label} for ${key(f)}`);
    return { ...f, label: r.label ?? null, note: r.note || null };
  });
  return { version: 'passBAuditOwnerLabelsBound/1', sampleSha256: freeze.sampleSha256, labeledAt: raw.labeledAt, rawSha256: sha256(stableJson(raw)), rows };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const src = process.argv[2]; if (!src) { console.error('usage: pass-b-audit-label-import.mjs <labels.json>'); process.exit(2); }
  const sample = JSON.parse(readFileSync(join(OUT, 'owner-sample.json'), 'utf8'));
  const freeze = freezeSample(sample), freezeFile = join(OUT, 'sample-freeze.json');
  if (existsSync(freezeFile)) {
    const prior = JSON.parse(readFileSync(freezeFile, 'utf8'));
    if (prior.sampleSha256 !== freeze.sampleSha256) throw new Error(`owner-sample.json changed since it was frozen (${prior.sampleSha256} -> ${freeze.sampleSha256}); labels cannot be reused`);
  } else writeFileSync(freezeFile, `${JSON.stringify(freeze, null, 1)}\n`);
  const bound = bindLabels(freeze, JSON.parse(readFileSync(src, 'utf8')));
  writeFileSync(join(OUT, 'owner-labels.bound.json'), `${JSON.stringify(bound, null, 1)}\n`);
  const count = l => bound.rows.filter(r => r.label === l).length;
  console.log(`sample ${freeze.sampleSha256.slice(0, 12)}: supported ${count('supported')}, unsupported ${count('unsupported')}, unsure ${count('unsure')}, unlabeled ${count(null)}; notes ${bound.rows.filter(r => r.note).length}`);
}
