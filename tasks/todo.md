# Artefactum — Expansion Plan

## Guiding decisions
- **Teaching = movement/medium cues library** (hand-written once, committed). Composed at runtime. Zero LLM tokens at build or runtime.
- **Static pre-built dataset** (`data/pool.js`) instead of live per-session Wikidata. Faster, deterministic (daily mode), diverse by design.
- **Daily = 10 paintings** (genre standard; ~6–8 min). Keep a 5-piece "Quick" mode. `ROUNDS` configurable.
- **Relaxed categories**: a painting only quizzes the attributes it actually has; max score scales per piece.

## Phase 1 — Data pipeline & mega-expansion (de-Euro-centric)
- [ ] `scripts/build-pool.mjs`: multiple targeted Wikidata queries — not just "most famous" (that skews European).
  - By region/culture: Japan (ukiyo-e), China, Korea, India/Mughal, Persia/Islamic, Ottoman, Mexico/Latin America, USA, Africa, Indigenous/Oceania.
  - By under-represented movements & women/non-Western artists.
- [ ] Relax requirements: require image + creator/culture + date + (country coords OR culture centroid). Movement/medium/genre optional.
- [ ] Normalize to schema: `{id,title,artist,year,lat,lng,place,region,movement,medium,genre,culture,fame,img}`.
- [ ] Dedup, output `data/pool.js` (`window.ARTEFACTUM_POOL = [...]`) — script tag, works on file:// and prod.
- [ ] Verify: total count, region distribution (target <55% Europe), century spread.

## Phase 1b — Met Open Access enrichment (follow-on)
- [ ] Pull non-Western depts (Asian, Islamic, Africa/Oceania/Americas) via Met search+objects API.
- [ ] country/culture → centroid lookup table (Met lacks lat/lng).
- [ ] Merge into pool; tag source.

## Phase 2 — Teaching layer
- [ ] `data/cues.js`: ~35 movements → {tells, era, where} + medium notes. Hand-written, grounded.
- [ ] Runtime `teachingFor(item)` composes the lesson.

## Phase 3 — App refactor
- [ ] Load `pool.js` + `cues.js` via script tags; drop live Wikidata (keep tiny embedded fallback).
- [ ] Relaxed categories: render only available inputs; scale max score; emoji grid adapts.
- [ ] Reveal shows teaching ("How the eye sees it") + per-cue visual tells.

## Phase 4 — Daily seeded mode
- [ ] Seeded PRNG (mulberry32) from `date + difficulty` → deterministic 10/day, same for everyone.
- [ ] "Already played today" lock via localStorage; share text includes date + difficulty + 💡.
- [ ] Quick (5) vs Daily (10) toggle.

## Phase 5 — Retention & meta (later)
- [ ] Mastery stats in localStorage ("strong: Baroque / weak: Edo Japan").
- [ ] Themed dailies ("Women Artists", "The year 1600 around the world").
- [ ] Greatest-hits Easy deck flag for newcomers.

## Review
(to be filled in as phases land)
