// RETIRED (G-03, fail-closed tombstone). This marked ARBITRARY bare ids as VISION-AUDITED in vision-audit.json,
// decoupled from any verified run — so an id could be recorded as image-audited without ever going through the
// approved flow. The audited-ledger update is now folded into the guarded merge: scripts/curate-merge.mjs --run
// records exactly the human-approved ids from that run (grow-only). There is no separate arbitrary-id marker.
console.error('❌ vision-mark.mjs is RETIRED (G-03). The audited ledger is updated only by scripts/curate-merge.mjs --run <runDir>, from that run\'s human-approved ids.');
process.exit(1);
