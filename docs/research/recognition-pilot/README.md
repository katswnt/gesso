# Recognition/inference pilot artifacts

**Current state: DRAFT — NOT FROZEN — NO COLLECTION AUTHORIZED.**

This directory turns the approved v2 decisions into reviewable pilot artifacts without collecting
model outcomes. It is intentionally separate from the historical adaptive probe and from Pass B's
authoritative curation pipeline.

## What exists

- `pilot-protocol-draft.md` — exact pilot protocol and freeze checklist.
- `pilot-manifest.draft.json` — deterministic 36-work draft; every work is explicitly marked for
  curator review.
- `call-manifest.draft.json` — exact, reproducible 671-call schedule.
- `style-taxonomy.snapshot.json` — current site labels and relations; near-duplicate review remains
  blocking.
- `pilot-curation-worksheet.md` — owner-facing review of all 36 works and blocking inputs.
- `legacy-comparison.snapshot.json` — exact old notes/hotspots/rich-vision records plus relevant
  pool/playability/fame fields for the 36 works, frozen for comparison after blind collection and
  prohibited from model payloads.
- `prompts/` and `schemas/` — frozen-shape tool-less request contracts.
- `golden-transform.json` — a known source raster and seven expected transformed hashes.
- `image-fitness-and-source-view-protocol.md` — pre-outcome image and alternate-view decisions.
- `evidence-box-protocol.md` — optional, nonblocking 12-work/two-annotator method.
- `power-simulation-spec.md` — what the excluded pilot may and may not supply to main-study power.
- `deviations.md` — append-only after the protocol freeze.

The offline implementation lives in:

- `scripts/lib/recognition-pilot.mjs`
- `scripts/lib/recognition-pilot-images.mjs`
- `scripts/lib/recognition-pilot-runtime.mjs`
- `scripts/recognition-pilot-prepare.mjs`
- `scripts/recognition-pilot-build-images.mjs` (explicitly fetch-gated)
- `scripts/recognition-pilot-multilingual-fame.mjs` (explicitly fetch-gated)
- `scripts/recognition-pilot-preflight.mjs`
- `scripts/recognition-pilot-seal-curation.mjs` (explicit offline normalization after review edits)
- `scripts/recognition-pilot-freeze.mjs`
- `scripts/recognition-pilot-run.mjs` (freeze/live-gated)
- `scripts/analyze-recognition-pilot.mjs`
- `tests/recognition-pilot.test.mjs`
- `scripts/check-recognition-pilot.mjs`

## Safe commands now

```sh
node scripts/recognition-pilot-prepare.mjs
node tests/recognition-pilot.test.mjs
node scripts/check-recognition-pilot.mjs
```

The paid runner cannot run this draft. It requires files named `pilot-manifest.frozen.json` and
`call-manifest.frozen.json`, the exact status `PILOT_PROTOCOL_FROZEN_BEFORE_COLLECTION`, a repository
commit with the exact freeze-id subject, byte-identical tracked inputs, `--live`, and a
separate live environment switch. None exists. The commit hash is derived and written to run
evidence before the first call; it is not self-embedded in the manifest (which would be impossible).

Image and multilingual-metadata preparation also require separate explicit switches. They have not
been run. Those steps collect pre-outcome inputs, not model responses, but they still happen only
after the owner reviews the 36-work draft.

Once any curator checkbox becomes true, `recognition-pilot-prepare.mjs` refuses to overwrite the
draft. After intentional edits, run `node scripts/recognition-pilot-seal-curation.mjs --seal` to
recompute masks, shams, the call manifest, and hashes without fetching or granting the freeze.

## What blocks the protocol freeze

1. Owner reviews the selected works and replaces any unsuitable identity key/cue.
2. Every image is checked `usable` or repaired before inclusion; all seven canonical view hashes are
   recorded.
3. Six alternate views are verified as the same physical objects and owner-approved.
4. Recognition aliases/qualifiers and literal cue masks are reviewed.
5. Place/medium/style/artist truth hierarchies and style near-duplicate mapping are reviewed.
6. Source rights and publication status are recorded.
7. Ten-language fame fields are collected as isolated research metadata.
8. The exact image-aware cost report passes the `$15` ceiling.
9. `node scripts/recognition-pilot-freeze.mjs --finalize` creates frozen copies only after every earlier condition
   passes; those artifacts and their code are then frozen together in one dedicated protocol-freeze
   commit. The paid runner derives and verifies that commit before collection.

No pilot output writes to `pool.js`, fame, tiers, dailies, playability, notes, hotspots, or any Pass B
ledger.

At finalization, the initial deviations log is copied to
`deviations-baseline.frozen.md` and frozen in the protocol-freeze commit. The live
`deviations.md` remains append-only and is intentionally not part of the runner's byte-identity
check, so recording a disclosed deviation cannot make a resumable run impossible.
