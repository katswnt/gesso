// RETIRED (G-03, fail-closed tombstone). This replaced hotspots.js entries from an arbitrary hotspots JSON (the
// retired hotspot-codex flow) WITHOUT approval/provenance. Pins now reach hotspots.js only via human review →
// scripts/curate-merge.mjs --run (approval- + hash-bound).
console.error('❌ save-hotspots.mjs is RETIRED (G-03). Pins reach hotspots.js only via scripts/curate-merge.mjs --run <runDir> (human-approved).');
process.exit(1);
