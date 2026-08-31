// RETIRED (G-03, fail-closed tombstone). The legacy vision-pass-v2 prep downloaded corpus images with an
// unhardened fetch (implicit redirects, no scheme/IP/MIME/decode checks) to hand to a tool-capable subagent.
// DISABLED because that path is insecure — NOT because a full replacement exists. The active broker-backed prep
// (scripts/vision-next.mjs) + tool-less runner cover the notes/pins + image-QA pass, but the RICH v2 analysis
// (pose/figures/palette/format/delights/condition/evidence/recognition/guessability/movement) is NOT yet
// reproduced on the secure+approved path — that is a DEFERRED follow-up (tasks/todo.md). Do not re-enable this
// insecure version. data/vision.js (this path's output) is a dead file the app never reads.
console.error('❌ vision-v2-prep.mjs is RETIRED (G-03). Use scripts/vision-next.mjs (broker-backed prep) + scripts/vision-audit-run.mjs (tool-less audit) + scripts/vision-review.mjs (approval) → curate-merge --run.');
process.exit(1);
