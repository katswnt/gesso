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

## Design principles (locked)

- **Image tokens are the cost; extra fields are ~free.** Capture GENEROUSLY — one look feeds many future features;
  a second pass later is the expensive mistake.
- **Capture rich, filter at use.** Record the fullest description/evidence we can; hide answer-leaks with a text
  filter at DISPLAY time (so alt-text shown during play doesn't say "Mona Lisa," but the full record exists for the
  reveal, search, and themed runs). We never re-run the pass to add a field we were shy about capturing.
- **Crops are coordinates, not passes.** The model returns `{x,y,w,h}`; we crop locally from the image we already
  have. No second call, no hi-res re-fetch. Multiple image passes are the only thing that blows the budget — avoided.

## The centerpiece: per-field EVIDENCE (powers the dream features)

15. **`evidence`** — for each field (when/where/medium/style/artist), a list of `{feature, bbox, why}` — the
    specific VISIBLE thing that pins the answer and WHERE it is. e.g. when → "starched cartwheel ruff (upper-left) =
    Spanish court ~1590-1620". This one capture powers: the **anachronism explainer** ("you got the date wrong —
    here's what pins it"), **smart distractors** ("you think Caravaggio, but here's how to tell it's X"), the
    **reveal** page, and **richer hints**. (The "oil paint didn't exist yet" catch is a small separate RULES layer —
    invention timelines applied at guess-time; the pass supplies evidence for the right answer, the rules flag the
    anachronism in the guess.)

## More future-feature captures (all from the one look)

16. **Figures & subjects** — `figureCount` + who/what is depicted (king, saint, woman, child, named historical
    figure, animal, still-life objects) → themed runs ("kings in art", "women in art", "animals in art") + search.
17. **Pose / gesture / composition** — descriptors + crop boxes of expressive moments → "gestures in art", pose
    search, "Art But Make It Sports"-style detail runs (the interesting unit is often a CROP, not the whole work).
18. **Delightful details** — `delights[]`: notable/funny features (the little fellas in Garden of Earthly Delights)
    each with a crop box → zoom-to, "weird details" mode, detail themed runs.
19. **Signature / inscription** — `{present, location, reads?}` — an artist cue (calibrates artist-difficulty, powers
    a "there's a signature" hint); part of the work, not an answer-leak to hide.
20. **Dominant palette + colour tags** — 3-5 hex + warm/cool + colour-family → "favourite blue works", colour themes,
    and a where/when signal.
21. **Format / shape** — tondo, oval, arched-top, diptych/triptych/scroll, panel-vs-canvas, orientation → display +
    a guessability cue.
22. **Objective description (alt-text)** — one-line "what the image shows"; serves accessibility + search index +
    the wrong-image consistency check, all from one field. (Answer-hidden at play-time by the display filter.)
23. **Condition + capture artifacts** — fragment/damaged/heavily-restored/faded, AND photo tells: reflections,
    glare, skew, "gallery snapshot vs proper repro" → honesty + difficulty (a faded work is harder to date).
24. **Image quality verdict** — resolution/crispness "good enough to play/display?" flag.
25. **Pin hygiene** — mark redundant/uninformative existing pins for pruning (well-defined now that pins are
    evidence-anchored).

## Expert-panel additions (product / AI-cost / art-historian / studio-prof / curator / conservator)

Unifying thesis: laypeople read the SUBJECT; experts read the SURFACE. The pass exists to hand players the
"you didn't know you could tell that from looking" tells. High-yield captures the panel surfaced:

28. **Pigment date-floor** — earliest-possible date implied by visible pigments (Prussian blue ≥~1710, cobalt
    ≥~1802, mauve/synthetics ≥~1856, cadmiums/titanium ≥1800s). A color can prove "can't predate X".
29. **Craquelure reading** — grid vs garland vs alligator/drying cracks; panel(straight-with-grain) vs
    canvas(scalloped) → age + support + medium. (Cracks that stop/skip a passage = overpaint.)
30. **Support / ground** — canvas weave vs wood panel vs copper vs paper tooth (what it's painted ON).
31. **Light-rig + perspective system** — tenebrist raking light ≥1600 Baroque; converging one-point ≥1420 Italy;
    stacked/reverse/flat = medieval/Byzantine/non-Western/modernist. Datable systems, not "good/bad drawing".
32. **Iconographic attributes / heraldry / textiles / donor portraits** — saints' objects (wheel=Catherine),
    coats of arms (name the patron/marriage/year), luxury textiles (pomegranate brocade, Anatolian carpets),
    small kneeling contemporary-dress figures = donors (date the work).
33. **Depicted technology as terminus-post-quem** — clocks, firearms, ships, gaslight, trains, tobacco pipes.
34. **Gold ground / halo geometry / gilding** — flat punched gold + incised halos = pre-1425 devotional.
35. **Morellian marks** — ears, hands, nostrils, drapery cadence: the artist's unconscious fingerprint
    (feeds the artist-field evidence + attribution).
36. **Print technique** — plate mark (intaglio), registration offset (multi-block), burin-taper vs etched line
    vs tonal lithograph → medium sub-classification.
37. **Gaze network + gesture** — where figures look (routes the eye / focal point), rhetorical hands.
38. **CONDITION CAPS CONFIDENCE (methodological)** — heavy yellowed varnish, glare/reflection (gallery snapshot),
    overpaint, or a bad reproduction should LOWER the date/attribution confidence AND the guessability weight.
    Distinguish real varnish/discolouration (pools in texture, has a cleaning window) from a lighting colour-cast
    (even across the frame + wall) from JPEG/scan/glass artifacts.

## AI-cost findings (locked)

- Full ~6,000-work pass ≈ **$175 on Sonnet** with **Batches API (−50%) + prompt caching**; ~$67 on Haiku.
  ~$0.03/work. The ~160-work pilot batch ≈ ~$2.50. Output JSON is ~78% of the bill; the image is ~4%.
- **Splitting into 2-3 calls is ~12-24% MORE expensive** (image re-uploads each call) — bundle everything.
- Quality: **structured outputs (JSON schema)** guarantees valid JSON; order evidence→inference; adaptive
  thinking before JSON; generous max_tokens; **fail-closed gate rejects out-of-range/hallucinated bboxes**.
  Optional Haiku-screen→Sonnet-deep tiering ≈ $155; start single-Sonnet-batched, pilot 100, tier only if needed.
- Watch: Haiku prompt-cache minimum is 4,096 tokens (pad the instruction or it silently won't cache).

## Cross-work (separate step, not per-image)

39. **Duplicate WORK detection** — same work present twice (La Belle Jardinière ×2). Flag for merge/removal.
40. **Duplicate IMAGE detection** — the same photo mapped to two DIFFERENT works (a harvest error). Flag.

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
