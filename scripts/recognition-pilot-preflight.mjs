// Exact offline cost/readiness preflight. It never fetches or calls a model.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { estimateCost, canonicalJson, sha256, REQUEST_POLICY, buildModelPrompt } from './lib/recognition-pilot.mjs';

const dir = process.argv[2] || 'docs/research/recognition-pilot';
const manifest = JSON.parse(readFileSync(join(dir, 'pilot-manifest.draft.json'), 'utf8'));
const calls = JSON.parse(readFileSync(join(dir, 'call-manifest.draft.json'), 'utf8'));
const read = f => readFileSync(join(dir, 'prompts', f), 'utf8');
const promptAssets = { identify: read('identify.md'), facets: read('facets.md'), 'facets-cued': read('facets-cued.md'), 'identity-first': read('identity-first.md') };
const schemaAssets = { identification: JSON.parse(readFileSync(join(dir, 'schemas/identification.schema.json'), 'utf8')), facets: JSON.parse(readFileSync(join(dir, 'schemas/facets.schema.json'), 'utf8')) };
const byWork = new Map(manifest.works.map(w => [w.id, w]));
const promptRegistry = Object.fromEntries(calls.calls.map(call => [call.callId, buildModelPrompt(call, byWork.get(call.workId), promptAssets, schemaAssets)]));
const images = {};
for (const w of manifest.works || []) {
  for (const [view, rec] of Object.entries(w.transform?.views || {})) if (rec?.width && rec?.height) images[`${w.id}:canonical:${view}`] = rec;
  const alt = w.alternate?.view;
  if (alt?.width && alt?.height) images[`${w.id}:alternate:full`] = alt;
}
let report;
try { report = estimateCost(calls, promptRegistry, images, REQUEST_POLICY); }
catch (e) {
  console.log(`BLOCKED (expected before image freeze): ${e.message}`);
  process.exitCode = 2;
  process.exit();
}
report.version = 'recognition-cost/1';
report.requestPolicy = REQUEST_POLICY;
report.callManifestSha256 = sha256(canonicalJson(calls));
report.promptHashes = Object.fromEntries(Object.entries(promptRegistry).map(([k, v]) => [k, sha256(v)]));
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
