// RETIRED (G-03, fail-closed tombstone). This applied agent/model-derived review verdicts (verify-out-*.json) —
// changing image/title/date/place/style in the pool — WITHOUT the human field-level approval + hash binding.
// Authoritative application now goes only through: broker run → tool-less runner → human review
// (scripts/vision-review.mjs → approved.json) → scripts/curate-merge.mjs --run, which is approval- and hash-bound.
console.error('❌ apply-review-verdicts.mjs is RETIRED (G-03). Model/agent output may only reach the pool via scripts/curate-merge.mjs --run <runDir> (human-approved + hash-bound).');
process.exit(1);
