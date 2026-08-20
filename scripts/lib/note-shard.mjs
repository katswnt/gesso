// Single source of truth for reveal-note shard routing. The IDENTICAL hash + modulus must exist in the
// index.html client loader (function `noteShard`); tests/note-shard.test.mjs extracts the client copy and
// asserts it buckets every pool id the same as this one. FNV-1a 32-bit over the id string, mod NOTE_SHARDS.
// Stable by construction: an existing id never changes shard, so adding a work only touches its one shard.
export const NOTE_SHARDS = 64;
export function shardIdx(id){
  let h = 0x811c9dc5; const s = String(id);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0) % NOTE_SHARDS;
}
