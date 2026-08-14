# Next Vision Pass — enrichment to fold in (do it while images are already being viewed)

These ride the **existing** per-image vision pass, so they cost ~nothing beyond the run you were already going to do. They come out of the ethos audit ([`ethos.md`](ethos.md)). The point of parking them here: don't spend tokens on a dedicated pass now — bank the work for the next time you run the pipeline, and get all of it in one look.

**Discipline for the whole pass (ethos E1 fix):** every *culture / style / sensitivity* field on a non-Western or contested work goes to the **human queue**, not auto-apply. The agent proposes; a human signs off. Only genuinely low-harm fields auto-apply.

## Per-work fields to capture while viewing each image

- [ ] **`visDiff` (1–5) — visual-inference difficulty** *(ethos C1)*. How readable are the diagnostic cues *from the image alone*? A legible, cue-rich work = easy even if Wikipedia-thin. This becomes a **second difficulty signal** blended with documentation-density, so a non-canon work can land in "Easy" without needing anglophone fame. The single highest-value item here.
- [ ] **`mediumFull` — composite medium string** *(ethos A4)*. Capture "oil on panel," "tempera on poplar," "lost-wax bronze" when visible/known. Score stays the simplified class ("oil"); we just stop *discarding* the support.
- [ ] **`anonReason` — why no artist** *(ethos B4)*, when determinable from image/metadata: `collective` (anonymous by tradition, e.g. guild/workshop), `unrecorded` (the record failed the maker), `de-attributed`, `lost`. Turns a blank "Anonymous" into a teachable fact.
- [ ] **`living: true` — living tradition flag** *(ethos A2)*. Mark cultures with continuous practice (Yoruba casting, many Indigenous traditions) so the reveal reads "living tradition," not a frozen "period."
- [ ] **`sensitive` candidate triage** *(ethos A6)*. Flag possible `restricted`/`ceremonial` objects (initiation masks, ancestor figures, sacred regalia) for **human review** — never auto-pull, never auto-keep. Human decides if it leaves the scored rotation like remains do.
- [ ] **Provenance / displacement cue** *(ethos A1 + C5)*. If the image or metadata shows a find-site or "collected by / taken in" fact, note it for the non-scored "how it got here" field.

## Notes
- `visDiff` + documentation-density together = the C1 fix. Ship the rename ("global recognizability" → "documentation density") separately/now (Tier 1); the blend needs this pass.
- Anything the agent is unsure about → flag, don't fabricate (per [[gesso-vision-not-in-cloud]] — run locally, agents flag rather than invent).
- After the pass: re-run cleaners + `check-pool` as its own step before any commit (per [[gesso-gate-before-commit]]).
