// Derive the reveal-note shards from data/teach-works.js (the committed source of truth). Writes
// data/notes/notes-<idx>.json for 0..NOTE_SHARDS-1, each an id→note map, with SORTED keys so unchanged
// content produces byte-identical files (stable ETags → a note edit invalidates only its one shard). Cleans
// stale shard files. Called two ways:
//   • as a CLI at deploy/build time and `npm run notes:build`:  node scripts/build-teach-shards.mjs
//   • folded into writeTeachWorks() (scripts/lib/static-module.mjs) so every note write re-shards automatically
// Pure filesystem + the shared id-hash (no network) → safe in every context the note-writing scripts run.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { shardIdx, NOTE_SHARDS } from "./lib/note-shard.mjs";

const DIR = "data/notes";

export function buildShards(workMap){
  mkdirSync(DIR, { recursive: true });
  const buckets = Array.from({ length: NOTE_SHARDS }, () => ({}));
  for (const id of Object.keys(workMap)) buckets[shardIdx(id)][id] = workMap[id];
  const written = new Set();
  for (let i = 0; i < NOTE_SHARDS; i++) {
    const sorted = {}; for (const k of Object.keys(buckets[i]).sort()) sorted[k] = buckets[i][k];
    const fn = `notes-${i}.json`;
    writeFileSync(`${DIR}/${fn}`, JSON.stringify(sorted));
    written.add(fn);
  }
  for (const f of readdirSync(DIR)) if (/^notes-\d+\.json$/.test(f) && !written.has(f)) rmSync(`${DIR}/${f}`);
  return { shards: NOTE_SHARDS, works: Object.keys(workMap).length };
}

// CLI: read teach-works.js and (re)build all shards, then print size stats.
if (import.meta.url === `file://${process.argv[1]}`) {
  const w = {}; new Function("window", readFileSync("data/teach-works.js", "utf8"))(w);
  const map = (w.ARTEFACTUM_CUES && w.ARTEFACTUM_CUES.work) || {};
  const r = buildShards(map);
  const sizes = readdirSync(DIR).filter(f => /^notes-\d+\.json$/.test(f)).map(f => statSync(`${DIR}/${f}`).size).sort((a, b) => a - b);
  const kb = n => (n / 1024).toFixed(0) + "KB";
  const empty = sizes.filter(s => s <= 2).length; // "{}" is 2 bytes
  console.log(`sharded ${r.works} works → ${r.shards} files in ${DIR}/  |  min ${kb(sizes[0])} · median ${kb(sizes[sizes.length >> 1])} · max ${kb(sizes[sizes.length - 1])}${empty ? ` · ${empty} empty` : ""}`);
}
