# Gesso — queue (current)

_Most of the original build plan, all museum pulls, the fame system, design touches, archive, Collections page, and the early-modern pull are DONE. This is what's actually open._

## ✅ DONE — "How to play" onboarding (design handoff 7)
Ported from `design_handoff 7`: `openHowTo()` 5-step overlay (reuses settings veil/panel + mobile sheet, dab dots, ←/→/Esc), auto-shows on first visit (`gesso.onboarded`), reopen from header `?` dab + start-screen "New here?" + Settings → Replay the tutorial. Inline cues: slider "drag to change" tag + one-time nudge, map label "TAP TO PIN · PINCH / +− TO ZOOM" + tap-ripple, lock-in partial-credit info chip. Also handoff 8 dab-family variety on pips/loader/dots.

## A. Enrichment pipeline — in flight (Codex on reset), HOLD re-freeze until done
**Richer teaching schema now governs all of this — see `tasks/teaching-notes-guidelines.md`.** Each work ships `why` + `cues[4]` + `hotspots` + NEW `guide[]` ("Ask the guide" accordion: 5 required Q&A slots incl. story/context, plus as many extra accurate ones as the work supports).
- [ ] **Update `gen-teach-shard` prompt** to the richer schema (adds `guide[]`; keeps `why`+`cues`). Bake in the §accuracy guardrails (never invent a named figure; obscure works lean on visible-description + medium/technique).
- [~] **Guide backfill — 2,240 / 3,260 done.** Claude workflow generated drafts for the top ~2,220 fame-ranked works (`a310539`) before hitting the monthly spend limit. **~1,020 works still need `guide`** (run `node scripts/gen-teach.mjs` when Codex resets OR re-run the workflow when budget allows — both resume from what's done).
- [ ] **Verify pass for the 2,220 unverified drafts** — the workflow's verify stage never ran (spend limit). Drafts are schema-valid + followed the accuracy guardrails, but a fact-check sweep (esp. no-invented-figure-names) should run via Codex or a budgeted Claude pass before we consider notes final.
- [ ] Hotspots for the new works — resume `scripts/hotspot-codex.mjs` (stopped ~1,236/2,735 on token limit; resumable).
- [ ] **Dimensions enrichment**: add a size field to every work (Wikidata P2048/P2049; Met/AIC/Cleveland/Harvard/V&A `dimensions` by `src`) → `data/dimensions.js` overlay; reveal-only line "Oil on canvas · 73 × 92 cm".
- [ ] THEN: final fame re-score over the full 3,260 pool → regenerate `fame.js` → **re-freeze daily** (`freeze-daily.mjs`).

## A2. Reveal UI ports (design handoffs — depend on enrichment above)
- [ ] **"Look closer" annotated reveal** (design handoff 9): loupe overlay + numbered markers driven by per-work `cues[4]` + `hotspots {n,x,y}`. NOTE the data-model reconciliation (handoff assumed movement-level 3 cues + `{x,y,zoom}`; reality is per-work 4 cues + `{n,x,y}` — derive zoom from x/y). Button on the revealed painting; hide if no hotspots.
- [ ] **"Ask the guide" accordion** (brief: `tasks/guide-accordion-design-brief.md`): renders `guide[]` as a collapse-by-default, one-open-at-a-time accordion below Look closer. **Awaiting Claude Design `.dc.html`.**

## B. Bug backlog
- [x] #5 Geo-reward radius keyed off `radiusFor` · #13 deterministic per-day distractor shuffle · #15 culture vs movement label — all shipped (`c483110`).
- [ ] Hint-not-counted: needs a concrete repro (a hint clearly used but points not subtracted) — may just be the intended no-op-50/50-is-free behavior.

## ✅ Checked — Collections page uses live data
`renderCollections()` is fully data-driven from `window.ARTEFACTUM_COLLECTIONS` (no hardcoded stats in the render; prose is qualitative). `data/collections.js` is a generated snapshot (`scripts/make-collections.mjs`) and is currently IN SYNC with the pool (regenerate → zero diff). Only staleness risk: must re-run `make-collections.mjs` after any pool change. Optional future: compute from `window.ARTEFACTUM_POOL` at runtime to remove the build step entirely.

## Movement reclassification (de-Eurocentrism) — in progress
- [x] Japan ukiyo-e (163), China (342), Persia/India/Andes (169) → real schools/dynasties/cultures.
- [x] Blank-medium guardrail added to both generators (don't guess a material when medium unknown — the Bernini→marble bug).
- [ ] **Remaining generic buckets (~1,000–1,200 of 1,800 worth doing):** Egypt (dynasties/Amarna/Coptic, 265), Greek pottery (black-/red-figure/geometric, 77), Japan-ink (Kanō/Rinpa/Nanga, ~120), Africa (Kuba/Kongo/Yoruba/Benin/Baule/Dan, ~50), US painting (Hudson River/Ashcan, subset of 254), French/Dutch/German painting (subset). Same Claude/Codex taxonomy-pilot approach.

## Note-accuracy verification (drafts are unverified)
- [ ] **Verify pass over blank-field works first** (923 no medium, 633 no style) — highest hallucination risk. Vision pass: compare each note's claims to the image. The text linter only triages (overcounts on depicted materials/synonyms).
- [ ] Medium/dimensions enrichment fills the 923 blanks (removes the need to guess).
- [ ] Small data cleanup: medium-field errors surfaced by the linter (e.g. Bronze-Age helmet + lacquer writing box mislabeled "Oil paint").

## Report endpoint — needs env wiring
- [x] `/api/report` + client POST shipped. [ ] Add Upstash Redis (Vercel Marketplace) so `KV_REST_API_URL`/`KV_REST_API_TOKEN` are set; reports land in `gesso:reports`.

## C. Data quality
- [ ] Legacy place-vs-origin geocode mismatches (works tagged to holding museum, not origin) — consolidate now prefers origin; spot-fix any remaining in the merged pool.
- [ ] General teach-note quality spot-check (restyled + modern already regenerated; sample the rest).

## D. Optional future pulls (capped + famous-first via Wikidata collections)
- [ ] Deeper Smithsonian NMAfA pull — the real lever for more sub-Saharan African art (Wikidata is thin there).
- [ ] See `long-term-goals.md`: Minneapolis Institute of Art, Walters, Getty/Yale.

## Done / dropped
- Dropped: user "gallery" feature (no accounts; screenshots suffice) and "more from this artist" reveal strip.
- Done: 368→3,260 pool across 10 open collections; Wikidata-sitelink fame + tiers; pinned daily + clean-path routing; archive tier-dots + day pagination; design touches (incl. gold PERFECT); Collections page; early-modern PD wave; African pulls (country + culture); designer README + CSS extraction.
