# Gesso — queue (current)

_Most of the original build plan, all museum pulls, the fame system, design touches, archive, Collections page, and the early-modern pull are DONE. This is what's actually open._

## A. Enrichment pipeline — in flight (Codex on reset), HOLD re-freeze until done
- [ ] Teach-notes for the ~700 newest works (modern + Wikidata-museum + African) — Codex `gen-teach-shard` over the staged candidate files.
- [ ] Hotspots for the same — resume `scripts/hotspot-codex.mjs` (stopped ~1,236/2,735 on token limit; resumable).
- [ ] THEN: final fame re-score over the full 3,260 pool → regenerate `fame.js` (`make-fame-js.mjs`) → **re-freeze daily** (`freeze-daily.mjs`) so modern + canon + new-museum works enter daily play, fully enriched.

## B. Bug backlog (from the bug hunt)
- [ ] #5 Geo-reward radius: free style 50/50 fires at 2000 km but WHERE scoring radius is ~450 km — key the reward off `radiusFor(it.place)`.
- [ ] #13 Distractor shuffle uses `Math.random` → same-day players get different difficulty; seed off `runDate|idx`.
- [ ] #15 Glossary labels cultures as "Movement" (cards read "c. unknown") — label cultures correctly / fill culture metadata.
- [ ] Hint-not-counted: needs a concrete repro (a hint clearly used but points not subtracted) — may just be the intended no-op-50/50-is-free behavior.

## C. Data quality
- [ ] Legacy place-vs-origin geocode mismatches (works tagged to holding museum, not origin) — consolidate now prefers origin; spot-fix any remaining in the merged pool.
- [ ] General teach-note quality spot-check (restyled + modern already regenerated; sample the rest).

## D. Optional future pulls (capped + famous-first via Wikidata collections)
- [ ] Deeper Smithsonian NMAfA pull — the real lever for more sub-Saharan African art (Wikidata is thin there).
- [ ] See `long-term-goals.md`: Minneapolis Institute of Art, Walters, Getty/Yale.

## Done / dropped
- Dropped: user "gallery" feature (no accounts; screenshots suffice) and "more from this artist" reveal strip.
- Done: 368→3,260 pool across 10 open collections; Wikidata-sitelink fame + tiers; pinned daily + clean-path routing; archive tier-dots + day pagination; design touches (incl. gold PERFECT); Collections page; early-modern PD wave; African pulls (country + culture); designer README + CSS extraction.
