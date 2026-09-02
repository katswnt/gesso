#!/usr/bin/env node
// Fail closed when the tracked Pass B coverage matrix no longer regenerates from
// its declared tracked sources. Network-free and model-free.
import { readFileSync } from 'node:fs';
import { buildVisionInventoryFromFiles } from './lib/vision-inventory-files.mjs';
import { stableJson } from './lib/vision-legacy.mjs';
import { validateCoverage } from './lib/vision-inventory.mjs';

const path = 'data/vision-coverage.json';
const stored = JSON.parse(readFileSync(path, 'utf8'));
const { coverage, legacyAudit } = buildVisionInventoryFromFiles({ asOf: stored.asOf });
const validation = validateCoverage(stored, coverage.rows.length);
if (!validation.ok) throw new Error(`invalid ${path}:\n${validation.errors.join('\n')}`);
if (stableJson(stored) !== stableJson(coverage)) {
  throw new Error(`${path} is stale; run: node scripts/vision-inventory.mjs --as-of ${stored.asOf} --write`);
}
console.log(`✅ VISION INVENTORY PASS — ${coverage.rows.length} works; legacy rich round-trip ${legacyAudit.recordCount}/${legacyAudit.recordCount}; horizon report-only`);
