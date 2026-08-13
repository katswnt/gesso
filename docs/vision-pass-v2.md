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
   architecture, featureless fragments, human/ancestral remains, blank supports, AND **low-information objects**
   (a plain knob, an undiagnostic shard) — encoded as the **guessability floor**: if job 6 finds all five fields
   near-unguessable, that IS the unplayable signal.
4. **Image-grounded teaching notes, with a QUALITY GATE** — before writing, read the existing note and classify:
   GOOD (leave it alone), TEMPLATE (the five bland one-liners → rewrite), FABRICATED (describes things not in the
   image, e.g. Bodhidharma's "monk on a reed" → rewrite), or MISSING (write). Never overwrite a good custom note.
   New notes = `why` / `cues` / `guide` from what is actually visible.
5. **Validate existing notes against the pixels** — the fabrication check run across the WHOLE notes corpus, not
   just new works; any note inconsistent with its image is flagged + rewritten. Retro-cleans known fabrication.
6. **Feature-anchored pins** — look-closer hotspots placed on real visual features (the "v2" pins).
7. **Per-field guessability + `recognized` flag** — how inferable each of the 5 fields is from the image alone
   (predict-human / difficulty read), AND whether the model recognizes the specific work (fame/recognizability
   proxy). Feeds difficulty/tiering off guessability, not fame.
8. **Canonical movement suggestion** — propose the canonical style label to collapse the fragmented Renaissance
   family (Renaissance vs Italian Renaissance vs Early/High, etc.) toward the curated vocabulary.
9. **Image-quality / not-the-artwork flags** — the image is a line-drawing/diagram of the work, a modern
   reproduction/print, a detail-only crop, the reverse/back, or a B&W scan of a colour piece → flag for a better image.
10. **Answer-leaks in the image** — a museum wall-label, caption card, accession sticker, or watermark visible in
    the photo hands the player the answer → flag for re-crop/re-resolve. (Artist signatures are fine.)
11. **Subject / motif tags** — what the work DEPICTS (bathers, odalisque, crucifixion, vanitas, equestrian). Enables
    themed runs ("odalisques across artists") and is another guessability signal.
12. **Frame / mount crop** — detect a picture frame OR a modern museum mount/pedestal/stand/holder and return the
    artwork's bounding box, so the confound can be cropped out.

## Cross-work (separate step, not per-image)

13. **Duplicate WORK detection** — same work present twice (La Belle Jardinière ×2). Flag for merge/removal.
14. **Duplicate IMAGE detection** — the same photo mapped to two DIFFERENT works (a harvest error). Flag.

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
