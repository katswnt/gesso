#!/bin/bash
# Run curated-weave note generation over one group's shards via Codex gpt-5.4 (resumable: skips done shards).
dir="$1"
for f in "$dir"/shard-*.json; do
  out="${f%.json}.out.json"
  [ -f "$out" ] && continue
  codex exec -m gpt-5.4 -s workspace-write --skip-git-repo-check \
    "Read data/incoming/notemerge/CURATE.md for the spec. INPUT: $f . OUTPUT: $out . Follow CURATE.md exactly — one flowing unbounded notes sequence per work, weave + dedupe + trim long Q&A, pins from hotspots. Valid JSON only." \
    >> "$dir/run.log" 2>&1
done
echo "GROUP DONE: $dir ($(ls "$dir"/shard-*.out.json 2>/dev/null | wc -l | tr -d ' ') outputs)"
