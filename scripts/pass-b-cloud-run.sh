#!/bin/bash
# Cloud-credit B1–B3 runner (VSD-047). Run from the gesso checkout inside a Claude Code cloud session, with the
# private evidence repo cloned at ../evidence. Works in $CHUNK_USD chunks and exports + pushes after every chunk,
# so a reclaimed VM loses at most one chunk of unexported work. Stops at the global cap, on a FATAL, or when the
# collector stops for any reason other than reaching its chunk cap.
set -u
EVIDENCE=${EVIDENCE:-../evidence}
CHUNK_USD=${CHUNK_USD:-20}
export PASS_B_CORPUS_LANE=cloud PASS_B_CLOUD_SKIP="$EVIDENCE/state/skip.json"
remaining=$(node scripts/pass-b-cloud-bundle.mjs budget --repo "$EVIDENCE" 2>/dev/null | sed -n 's/^export PASS_B_CLOUD_BUDGET_USD=//p')
echo "=== start: global remaining \$$remaining (chunks of \$$CHUNK_USD)"
target=0
while :; do
  target=$(awk -v t="$target" -v c="$CHUNK_USD" -v r="$remaining" 'BEGIN{n=t+c; if(n>r)n=r; printf "%.2f", n}')
  echo "=== $(date -u +%FT%TZ) chunk: this-container spend cap \$$target"
  PASS_B_CLOUD_BUDGET_USD=$target PASS_B_CORPUS_LIVE=1 node scripts/pass-b-corpus-collect.mjs --run 2>&1 | tee -a cloud-run.log | grep -E "Stopped:|FATAL|FAIL-CLOSED"
  node scripts/pass-b-cloud-bundle.mjs export --repo "$EVIDENCE" --push 2>&1 | tee -a cloud-run.log
  if grep -q -E "FATAL|FAIL-CLOSED" <(tail -40 cloud-run.log); then echo "=== stopping: fatal/fail-closed (see cloud-run.log)"; exit 1; fi
  if ! tail -40 cloud-run.log | grep -q "Stopped: budget-cap"; then echo "=== stopping: collector stopped for a reason other than its chunk cap"; exit 0; fi
  awk -v t="$target" -v r="$remaining" 'BEGIN{exit !(t>=r-0.01)}' && { echo "=== global budget reached"; exit 0; }
done
