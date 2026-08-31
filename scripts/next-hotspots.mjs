// RETIRED (G-03, fail-closed tombstone). Feeder for the retired tool-capable hotspot loop: it downloaded corpus
// images (unbrokered) to hand to a Codex agent. The hotspot pass is now part of the tool-less image-grounded
// vision pass (scripts/vision-audit-run.mjs) over broker-sanitized derivatives, reviewed before any merge.
console.error('❌ next-hotspots.mjs is RETIRED (G-03). Image acquisition now goes through the hardened broker (scripts/lib/img-broker.mjs) into a run dir; the vision pass is tool-less (scripts/vision-audit-run.mjs).');
process.exit(1);
