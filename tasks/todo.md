# Gesso — queue (current)

_Most of the original build plan, all museum pulls, the fame system, design touches, archive, Collections page, and the early-modern pull are DONE. This is what's actually open._

## ✅ DONE — "How to play" onboarding (design handoff 7)
Ported from `design_handoff 7`: `openHowTo()` 5-step overlay (reuses settings veil/panel + mobile sheet, dab dots, ←/→/Esc), auto-shows on first visit (`gesso.onboarded`), reopen from header `?` dab + start-screen "New here?" + Settings → Replay the tutorial. Inline cues: slider "drag to change" tag + one-time nudge, map label "TAP TO PIN · PINCH / +− TO ZOOM" + tap-ripple, lock-in partial-credit info chip. Also handoff 8 dab-family variety on pips/loader/dots.

## A. Enrichment pipeline — in flight (Codex on reset), HOLD re-freeze until done
**Richer teaching schema now governs all of this — see `tasks/teaching-notes-guidelines.md`.** Each work ships `why` + `cues[4]` + `hotspots` + NEW `guide[]` ("Ask the guide" accordion: 5 required Q&A slots incl. story/context, plus as many extra accurate ones as the work supports).
- [ ] **Update `gen-teach-shard` prompt** to the richer schema (adds `guide[]`; keeps `why`+`cues`). Bake in the §accuracy guardrails (never invent a named figure; obscure works lean on visible-description + medium/technique).
- [ ] Teach-notes (full schema) for the ~700 newest works (modern + Wikidata-museum + African) — Codex `gen-teach-shard`.
- [ ] **Back-fill `guide[]` for all 2,738 existing works** (Kat: backfill for sure). Order: famous tiers first, then long tail.
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

## C. Data quality
- [ ] Legacy place-vs-origin geocode mismatches (works tagged to holding museum, not origin) — consolidate now prefers origin; spot-fix any remaining in the merged pool.
- [ ] General teach-note quality spot-check (restyled + modern already regenerated; sample the rest).

## D. Optional future pulls (capped + famous-first via Wikidata collections)
- [ ] Deeper Smithsonian NMAfA pull — the real lever for more sub-Saharan African art (Wikidata is thin there).
- [ ] See `long-term-goals.md`: Minneapolis Institute of Art, Walters, Getty/Yale.

## Done / dropped
- Dropped: user "gallery" feature (no accounts; screenshots suffice) and "more from this artist" reveal strip.
- Done: 368→3,260 pool across 10 open collections; Wikidata-sitelink fame + tiers; pinned daily + clean-path routing; archive tier-dots + day pagination; design touches (incl. gold PERFECT); Collections page; early-modern PD wave; African pulls (country + culture); designer README + CSS extraction.
