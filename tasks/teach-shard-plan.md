# Spec: shard `teach-works.js` (Option 2, bucketed shards)

_Status: SPEC (not started). Owner: Kat. Written 2026-08-20._

## Problem (recap, with real numbers)
`data/teach-works.js` is the reveal-screen study content (`why` / `cues` / `guide`), one entry per work,
keyed by work id, merged into `window.ARTEFACTUM_CUES.work`. It is **22.2 MB raw** (6,091 entries, avg 3.8 KB),
loaded whole via one `<script defer>`. Brotli over the wire is ~4.9 MB, so download isn't the headline cost. The
real taxes are:
1. **Main-thread parse** of 22 MB of JSON-in-JS on every load (phone jank after paint).
2. **Refetch-everything on redeploy**: the URL is stable, so any note edit (the vision pipeline does this
   constantly) busts the ETag and returning visitors re-pull the entire ~5 MB.
3. **Unbounded growth**: 40 MB at ~11k works.

Reads are **random-access by id** (`CUES.work[it.id]` in `studyFor`), used by daily, training, AND infinite, so
"just prefetch today's 5" does not cover it. Any design must serve arbitrary ids.

## Design
Split notes into **N = 64 shards, bucketed by a stable hash of the work id**. A reveal (or round start) loads
only the shard(s) containing the works in play and merges them into `CUES.work`. `studyFor`'s existing fallback
covers the window before a shard lands, so nothing ever breaks; it only upgrades from generic cues to the rich
note once merged.

- **Shard routing**: `shardIdx(id) = fnv1a32(id) % 64`. Same function in the build (`scripts/lib/note-shard.mjs`)
  and the client (inline loader). ~95 works/shard, ~350 KB raw / ~75 KB brotli each.
- **Filenames**: plain `data/notes/notes-<idx>.json` (0–63). **No manifest.** Invalidation rides Vercel's
  default ETag → a `304` for unchanged shards (cheap, no body), a `200` only for the shard whose notes changed.
  A daily session touches ~5–15 distinct shards, i.e. ~5–15 cheap conditional GETs instead of one 5 MB blob.
  - _Optional future upgrade_: content-hashed filenames (`notes-<idx>-<hash8>.json`) + a tiny manifest for
    `immutable` caching (zero revalidation round-trips on repeat visits). Only worth it if repeat-visit latency
    ever shows up in metrics. Deliberately NOT in v1 to avoid the manifest + its drift surface.
- **teach-works.js stays** the committed source of truth (10+ pipeline scripts write/read it). Shards are a
  DERIVED artifact. index.html stops referencing the monolith.

## Client loader (new, ~25 lines, inline in index.html or `data/notes-loader.js`)
```js
window.ARTEFACTUM_CUES = window.ARTEFACTUM_CUES || {};
window.ARTEFACTUM_CUES.work = window.ARTEFACTUM_CUES.work || {};
const NOTE_SHARDS = 64;
function noteShard(id){ let h=0x811c9dc5; const s=String(id); for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,0x01000193); } return (h>>>0)%NOTE_SHARDS; }
const _noteLoaded=new Set(), _noteInflight=new Map();
function ensureNotes(ids){
  const need=new Set();
  for(const id of ids){ const s=noteShard(id); if(!_noteLoaded.has(s)) need.add(s); }
  return Promise.all([...need].map(s=>{
    if(_noteInflight.has(s)) return _noteInflight.get(s);
    const p=fetch(`data/notes/notes-${s}.json`).then(r=>r.ok?r.json():{})
      .then(d=>{ Object.assign(window.ARTEFACTUM_CUES.work,d); _noteLoaded.add(s); _noteInflight.delete(s); })
      .catch(()=>{ _noteInflight.delete(s); }); // best-effort; studyFor already falls back
    _noteInflight.set(s,p); return p;
  }));
}
window.ensureNotes = ensureNotes;
```
`studyFor` is UNCHANGED. It keeps reading `CUES.work[it.id]` synchronously and falling back when absent.

## Call sites (prefetch behind user think-time)
- **Round setup** (wherever the current work `it` is chosen/rendered, e.g. `renderRound`): fire-and-forget
  `ensureNotes([it.id])`. By the time the player finishes guessing, the shard is merged, so reveal is instant.
- **Daily start**: if all 5 ids are known up front, `ensureNotes(dailyIds)` once (covers the whole run).
- **Collections / training set open**: `ensureNotes(idsInView)` when a set is assembled.
- No loading spinner needed anywhere: the fallback note renders immediately, the rich note swaps in when
  present. (If a reveal is already open when a shard lands and we want a live upgrade, re-call the reveal
  render; optional polish, not required for v1.)

## Build step (new: `scripts/build-teach-shards.mjs`)
1. Read `data/teach-works.js` → workMap (`readGlobal` / Function-eval, same as the harness).
2. Bucket each id by `shardIdx` from `scripts/lib/note-shard.mjs` (the shared source of the hash).
3. Write `data/notes/notes-<idx>.json` for 0..63 (each an id→note object). Deterministic key order for stable
   diffs/ETags: sort keys before stringify.
4. **Clean stale**: remove any `data/notes/*.json` not written this run.
5. Idempotent: same teach-works.js → byte-identical shards → no-op.
Log: works sharded, shard size min/median/max, any empty shard.

## Where shards live / when they build
**Recommended: generate at Vercel build, gitignore `data/notes/`.** Avoids repo bloat (no second 22 MB) and git
churn. teach-works.js is committed, so Vercel has the source; add build command `node scripts/build-teach-shards.mjs`.
- Local static-open needs them once → `npm run notes:build` (document in README); optionally a `predev`.
- Determinism means unchanged shards get identical bytes across builds, so ETags stay stable across deploys and
  the 304 story holds even though shards aren't committed.
- _Alternative if we ever want them committed_: commit `data/notes/` + a `check-pool` "shards-stale" guard
  (hash of teach-works.js vs a recorded version) so a note edit can't ship without a rebuild. More gate safety,
  more git churn. Not recommended for v1.

## Freshness: how future notes reach shards (rule #7 — can't be forgotten)
All 10+ note-writing scripts funnel through ONE helper: `writeTeachWorks()` in `scripts/lib/static-module.mjs`.
That is the choke point, so the freshness guarantee lives there, not in a step anyone must remember.
1. **Choke-point regen (the guarantee)**: `writeTeachWorks()` gets one added line — after writing
   `teach-works.js` it calls `buildShards(workMap)` (exported from `build-teach-shards.mjs`). Every future note
   addition re-shards automatically; no pipeline script needs to know shards exist; stale local/git state can't
   be created. `buildShards` is pure FS + the id-hash (no network), so it is safe in every context those scripts
   run, including the codex sandbox.
2. **Unconditional Vercel build (backstop)**: the deploy build runs `build-teach-shards.mjs` every push from the
   committed `teach-works.js`, so the served shards are always rebuilt from source even if something was
   hand-edited.
3. **Fail-closed gate (only if we commit shards)**: a `check-pool` `shards-stale` guard stamps shards with a
   hash of `teach-works.js` and fails if they disagree. Unnecessary under generate-at-build (layer 2 covers it).

**Stable-hash property**: `shardIdx(id)` never changes for an existing work, so adding work X only grows shard
`hash(X)%64` (~4 KB) and leaves the other 63 byte-identical → next deploy is one `200` + 63 `304`s. Harvesting a
batch invalidates only the shards those works land in, never the whole corpus.

## Tests / gates (no-build harness discipline)
- **`tests/note-shard.test.mjs` (drift guard)**: extract the client `noteShard` from index.html AND import the
  node `shardIdx` from `note-shard.mjs`; run both over every pool id; assert identical bucket for all. (Same
  pattern as `medium.test` extracting `simplifyMedium` from index.html — see memory `gesso-full-npm-test`.)
- **Build round-trip assert** (in the build script or a test): every workMap id lands in exactly one shard and
  reloading all shards reconstructs the full map byte-for-byte.
- **Extend `tests/dom-harness.mjs`**: stub `fetch` to serve a fixture shard, call `ensureNotes([id])`, assert the
  note merged into `CUES.work` and that `studyFor` returns the rich note; and assert `studyFor` still returns a
  sane fallback for an id whose shard was NOT loaded.
- Add `notes:build` to the pre-push/`npm test` flow if we go committed-shards; if generate-at-build, the drift
  test + dom-harness cover correctness.

## Rollout / rollback
- Ship behind one index.html change (swap the `<script src="data/teach-works.js" defer>` line for the loader +
  the `ensureNotes` call sites).
- **Rollback is trivial**: teach-works.js stays committed, so revert the index.html edit to re-point at the
  monolith. No data migration.
- Suggested order: land build script + note-shard.mjs + tests (green, no client change) → wire loader + call
  sites + drop the monolith `<script>` → verify dom-harness + a manual reveal in daily/training/infinite →
  set the Vercel build command → deploy.

## Effort / risk
~Half a day. Low risk: the pre-existing `studyFor` fallback means worst case is generic cues, never a broken
reveal. Main-thread parse tax and redeploy-refetch tax both go away; growth stops mattering.

## Open decisions for Kat
1. **N = 64** ok, or prefer fewer/bigger (32) vs more/smaller (128)? (Tunable; only affects waste-per-note vs
   round-trips-per-session.)
2. **Generate-at-build + gitignore** (recommended) vs **commit shards + freshness gate**?
3. **v1 plain names + ETag** (recommended) vs go straight to **content-hashed + immutable** now?
