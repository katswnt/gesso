#!/usr/bin/env node
// Deterministic, network-free Pass B coverage inventory. Historical artifacts are
// evidence flags only: they never earn current contentVisionEnrichment completion.
import { renameSync, writeFileSync } from 'node:fs';
import { buildVisionInventoryFromFiles } from './lib/vision-inventory-files.mjs';

const argv = process.argv.slice(2);
const write = argv.includes('--write');
const asOfFlag = argv.indexOf('--as-of');
const asOf = asOfFlag >= 0 ? argv[asOfFlag + 1] : new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
if (asOfFlag >= 0 && !asOf) throw new Error('--as-of requires YYYY-MM-DD');
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--write') continue;
  if (argv[i] === '--as-of') { i++; continue; }
  throw new Error(`unknown argument: ${argv[i]}`);
}

const { coverage, legacyAudit } = buildVisionInventoryFromFiles({ asOf });

const s = coverage.summary;
console.log(`VISION INVENTORY ${coverage.version} — as of ${coverage.asOf}`);
console.log(`pool ${s.poolWorks} | provably complete ${s.provablyComplete} | current narrow secure ${s.secureCurrentNarrowPass}`);
console.log(`legacy: audit ${s.legacy.canonicalAudit}, rich ${s.legacy.rich}, teaching ${s.legacy.teaching}, notes ${s.legacy.notes}, guides ${s.legacy.guide}, hotspots ${s.legacy.hotspots}`);
console.log(`guides: ${Object.entries(s.guides).map(([key, value]) => `${key}=${value}`).join(' | ')}`);
console.log(`next-30-day report-only blockers: ${s.horizonBlockers}`);
console.log(`legacy vision round-trip: ${legacyAudit.recordCount}/${legacyAudit.recordCount} records; unknown fields ${legacyAudit.unknownFields.length}; failures ${legacyAudit.roundTripFailures.length}`);
const collisionCount = Object.values(coverage.diagnostics.artifacts).reduce((sum, item) => sum + item.collisions.length, 0);
const orphanCount = Object.values(coverage.diagnostics.artifacts).reduce((sum, item) => sum + item.orphans.length, 0);
console.log(`legacy alias collisions ${collisionCount} | orphan evidence rows ${orphanCount}`);

if (write) {
  const out = 'data/vision-coverage.json';
  const temp = `${out}.tmp-${process.pid}`;
  writeFileSync(temp, JSON.stringify(coverage, null, 1) + '\n', { flag: 'wx' });
  renameSync(temp, out);
  console.log(`wrote ${out} (${coverage.rows.length} rows; horizon remains report-only per VSD-014)`);
} else {
  console.log('read-only; pass --write to refresh data/vision-coverage.json');
}
