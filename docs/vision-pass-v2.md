# Vision pass v2 — the unified, image-grounded audit

The old Codex curate pass is deleted. This replaces it. Core principle learned the hard way (Bodhidharma's
fabricated note): **the model must actually see the pixels.** So every job below runs from a RAW no-tools
completion with the real downloaded image attached — no agent, no sandbox, no metadata-only fabrication.
One look at each work's real image produces everything below in a single structured response.

## What the pass does (per work, one image call)

1. **Image correctness** — is this the right artwork for the record? Flag wrong/mismatched images (the
   Bodhidharma "modern photo under a ceramic record" and Box "5-object group photo" class). Report what it
   actually shows so a mismatch is obvious.
2. **Metadata correctness** — flag fields that contradict the image: wrong date, place, medium, style/culture.
   (This pass already caught, by eye: Jean Renoir Sewing "Watercolor/Botanical illustration" → Oil/Impressionism;
   Teotihuacan sculpture "Aztec/Basalt" → Teotihuacan/Ceramic; La Belle Jardinière dated 1650 → 1507.)
3. **Playability judgment** — mark works that can't be a fair puzzle as `play:false`: group photos (Box),
   architecture, featureless fragments, human/ancestral remains, blank supports.
4. **Image-grounded teaching notes** — `why` / `cues` / `guide`, describing what is actually visible (not the
   catalog blurb). This is the whole reason for image-grounding.
5. **Feature-anchored pins** — look-closer hotspots placed on real visual features in the image (the "v2" pins).
6. **Per-field guessability** — how inferable each of the 5 fields is from the image alone (the predict-human /
   difficulty read), so difficulty/tiering can key off guessability, not fame.
7. **Canonical movement suggestion** — propose the canonical style label to collapse the fragmented Renaissance
   family (Renaissance vs Italian Renaissance vs Early/High, etc.) toward the curated vocabulary.
8. **Frame handling** — detect a picture frame if present and return the artwork's bounding box, so the frame
   (a where/medium/era confound) can be cropped out.

## Cross-work (separate step, not per-image)

9. **Duplicate detection** — same work present twice (La Belle Jardinière ×2). Flag for merge/removal.

## Outputs

- Merges notes → `teach-works.js`, pins → `hotspots.js`.
- Writes a **flags backlog** (`data/incoming/vision-v2-flags.json`): metadata corrections, playability calls,
  wrong-image mismatches, movement suggestions, frame boxes — each reviewed/applied before it touches the pool
  (never auto-mutate metadata from a model without a gate/eyeball, per the fabrication + false-positive lessons).
- Everything verified by `scripts/check-pool.mjs` + `tests/dom-harness.mjs` before commit.

## Notes

- Model: Sonnet (notes + judgment need the quality); guessability can A/B Haiku.
- The consistency check (job 1) is the higher-precision successor to `scripts/vision-verify.mjs`; the guessability
  read (job 6) folds in `scripts/vision-guess.mjs` / `vision-predict-human.mjs`.
- Corrections are SUGGESTIONS in the backlog, not auto-applied — vision has false positives (Niagara, the vase).
