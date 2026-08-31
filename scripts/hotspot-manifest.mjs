// RETIRED (G-03, fail-closed tombstone). Built manifests + pre-downloaded (unbrokered) corpus images for parallel
// TOOL-CAPABLE Claude agents to place hotspots. Superseded by the tool-less image-grounded vision pass
// (scripts/vision-audit-run.mjs) over broker-sanitized derivatives, reviewed before any merge.
console.error('❌ hotspot-manifest.mjs is RETIRED (G-03). Use the hardened broker (scripts/lib/img-broker.mjs) + the tool-less vision runner (scripts/vision-audit-run.mjs); never pre-download corpus images for tool-capable agents.');
process.exit(1);
