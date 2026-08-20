// Guards the reveal-note sharding. TWO invariants:
//  1) DRIFT: the client `noteShard` (extracted from index.html) must bucket EVERY pool id identically to the
//     node `shardIdx` (scripts/lib/note-shard.mjs). If they ever diverge, the client fetches the wrong shard
//     and notes silently vanish. (Same extract-from-index.html pattern as medium.test.)
//  2) ROUND-TRIP: bucketing the full teach-works map by shardIdx must place every id in exactly one shard and
//     reconstruct the whole map — i.e. build-teach-shards loses nothing.
// Run: node tests/note-shard.test.mjs
import { readFileSync } from "node:fs";
import { shardIdx, NOTE_SHARDS } from "../scripts/lib/note-shard.mjs";

let pass = 0; const fail = m => { console.error("❌ note-shard:", m); process.exit(1); };

// --- extract the client copy from index.html ---
const html = readFileSync("index.html", "utf8");
const nsM = html.match(/const NOTE_SHARDS\s*=\s*(\d+);/);
const fnM = html.match(/function noteShard\(id\)\{[\s\S]*?%NOTE_SHARDS;\s*\}/);
if (!nsM) fail("could not find `const NOTE_SHARDS = N;` in index.html");
if (!fnM) fail("could not find `function noteShard(id){…}` in index.html");
const clientN = parseInt(nsM[1], 10);
if (clientN !== NOTE_SHARDS) fail(`NOTE_SHARDS mismatch: index.html ${clientN} vs note-shard.mjs ${NOTE_SHARDS}`);
const clientShard = new Function(`const NOTE_SHARDS=${clientN}; ${fnM[0]}; return noteShard;`)();
pass++;

// --- load ids: pool + teach-works ---
const win = {}; new Function("window", readFileSync("data/pool.js", "utf8"))(win);
const poolIds = (win.ARTEFACTUM_POOL || []).map(p => p.id);
const tw = {}; new Function("window", readFileSync("data/teach-works.js", "utf8"))(tw);
const noteMap = (tw.ARTEFACTUM_CUES && tw.ARTEFACTUM_CUES.work) || {};
const allIds = [...new Set([...poolIds, ...Object.keys(noteMap)])];
if (allIds.length < 1000) fail(`only ${allIds.length} ids loaded — pool/teach-works did not parse`);

// 1) DRIFT
let mismatches = 0;
for (const id of allIds) if (clientShard(id) !== shardIdx(id)) { if (mismatches < 5) console.error(`   drift: ${id} → client ${clientShard(id)} vs node ${shardIdx(id)}`); mismatches++; }
if (mismatches) fail(`${mismatches}/${allIds.length} ids bucket differently between index.html and note-shard.mjs`);
pass++;

// 2) ROUND-TRIP over the full note map
const buckets = Array.from({ length: NOTE_SHARDS }, () => ({}));
for (const id of Object.keys(noteMap)) buckets[shardIdx(id)][id] = noteMap[id];
const rebuilt = Object.assign({}, ...buckets);
const nMap = Object.keys(noteMap).length, nRebuilt = Object.keys(rebuilt).length;
if (nMap !== nRebuilt) fail(`round-trip lost entries: ${nMap} → ${nRebuilt}`);
for (const id of Object.keys(noteMap)) if (rebuilt[id] !== noteMap[id]) fail(`round-trip corrupted ${id}`);
pass++;

console.log(`✅ note-shard: ${pass} checks — client↔node hash agree on ${allIds.length} ids, ${nMap} notes round-trip across ${NOTE_SHARDS} shards`);
process.exit(0);
