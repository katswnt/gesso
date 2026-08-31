// RETIRED (G-03, fail-closed tombstone). This entry point downloaded untrusted corpus images and handed them to
// a TOOL-CAPABLE Codex agent (pixel/EXIF-prompt-injection → agent-action boundary). Superseded by the single
// image-grounded vision pass, run as a TOOL-LESS multimodal completion (scripts/vision-audit-run.mjs) over
// broker-sanitized derivatives, with output quarantined behind a human field-level review before any merge.
console.error('❌ staged-hotspots.mjs is RETIRED (G-03). Use the tool-less vision runner (scripts/vision-audit-run.mjs) + review queue (scripts/vision-review.mjs); never hand a corpus image to a tool-capable agent that can feed a merge.');
process.exit(1);
