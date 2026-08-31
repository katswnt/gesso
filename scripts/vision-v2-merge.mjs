// RETIRED (G-03, fail-closed tombstone). The legacy vision-pass-v2 merge auto-folded tool-capable-subagent output
// into data/vision.js (a dead file the app never reads). DISABLED because that flow is insecure (auto-apply of
// tool-capable-agent output). The secure path (human review → curate-merge --run) covers notes/pins + image-QA,
// but the RICH v2 analysis schema is NOT yet reproduced there — rebuilding it securely is a DEFERRED follow-up
// (tasks/todo.md). Do not re-enable this insecure version.
console.error('❌ vision-v2-merge.mjs is RETIRED (G-03). Authoritative application goes through review (scripts/vision-review.mjs) → curate-merge.mjs --run <runDir>, which is approval- and hash-bound.');
process.exit(1);
