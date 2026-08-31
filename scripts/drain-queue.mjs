// RETIRED (G-03, fail-closed tombstone). This drained the vision review queue and applied agent-derived image
// verdicts — swapping pool.img to a model-suggested `suggestedUrl` via a raw (un-brokered) fetch, and clearing
// audit-time image flags — with no approval or provenance binding. Image swaps and image-issue resolution must now
// go through the hardened broker + the reviewed path (approved.json → scripts/curate-merge.mjs --run). A brokered,
// approval-bound image-swap step is a DEFERRED secure-successor task (see tasks/todo.md).
console.error('❌ drain-queue.mjs is RETIRED (G-03). Image swaps go through the broker + human-approved curate-merge --run, never a raw fetch of an agent-suggested URL.');
process.exit(1);
