// Deterministic PLAYER-COPY language gate: scans every player-facing why/cue/note/guide field in
// data/teach-works.js for production-language leaks (stage names, "visual verification confirms",
// prompt/model/metadata/record/catalog-as-input, pipeline ops). Exit non-zero if any leak is found.
// Read-only. Usage: node scripts/check-teach-language.mjs [--data data/teach-works.js]
import { readFileSync } from 'node:fs';
import { scanTeachEntry } from './lib/public-output-leak.mjs';

const arg = process.argv.indexOf('--data');
const DATA = arg > 0 ? process.argv[arg + 1] : 'data/teach-works.js';
const w = {}; new Function('window', readFileSync(DATA, 'utf8'))(w);
const work = (w.ARTEFACTUM_CUES || {}).work || {};
let leakWorks = 0, leakFields = 0; const sample = [];
for (const [id, entry] of Object.entries(work)) {
  const hits = scanTeachEntry(entry);
  if (hits.length) { leakWorks++; leakFields += hits.length; if (sample.length < 15) sample.push({ id, hits: hits.map((h) => `${h.field}:${h.label}`) }); }
}
console.log(`check-teach-language: scanned ${Object.keys(work).length} works in ${DATA}`);
console.log(`  works with leaks: ${leakWorks} | leak fields: ${leakFields}`);
if (leakWorks) { for (const s of sample) console.log(`  ${s.id}: ${s.hits.join(', ')}`); console.error(`FAIL: ${leakWorks} work(s) contain player-copy production-language leaks`); process.exit(1); }
console.log('PASS: no player-copy production-language leaks');
