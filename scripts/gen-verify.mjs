// RETIRED (G-03, fail-closed tombstone). This ran Codex (a tool-capable agent) to "fact-check" teach notes and
// OVERWROTE data/teach-works.js in place with the model's corrections — a raw model-output sink with no human
// approval or provenance binding. Model-derived teaching content reaches teach-works.js only via the reviewed path
// (broker run → tool-less runner → human review → scripts/curate-merge.mjs --run). A secure fact-check/correction
// step would be a tool-less completion whose output is human-approved before merge — a DEFERRED follow-up.
console.error('❌ gen-verify.mjs is RETIRED (G-03). Model fact-checks/corrections reach teach-works.js only via scripts/curate-merge.mjs --run (human-approved + hash-bound).');
process.exit(1);
