// RETIRED (G-03, fail-closed tombstone). This entry point handed untrusted corpus images to a TOOL-CAPABLE
// Codex agent and then AUTO-COMMITTED + PUSHED its output — the exact pixel/EXIF-prompt-injection → agent-action
// boundary G-03 closes. The look-closer/hotspot pass is now part of the single image-grounded vision pass, which
// runs as a TOOL-LESS multimodal completion (scripts/vision-audit-run.mjs) over broker-sanitized derivatives,
// with output quarantined behind a human field-level review (scripts/vision-review.mjs) before any merge.
// This script no longer runs. Do not re-enable an image→tool-capable-agent path; use the tool-less runner.
console.error('❌ hotspot-codex.mjs is RETIRED (G-03). Use the tool-less vision runner (scripts/vision-audit-run.mjs) + review queue (scripts/vision-review.mjs). A tool-capable image agent may be used for exploration only and must never feed an authoritative merge or auto-commit.');
process.exit(1);
