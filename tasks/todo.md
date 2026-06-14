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

## Bug-hunt backlog (lower priority — added 2026-06-13)
- [ ] #5 Geo-reward radius: free style 50/50 fires at 2000 km but WHERE scoring radius is ~450 km. Key the reward off `radiusFor(it.place)` so the reward matches the scored "right country" zone.
- [ ] #13 Unseeded distractor shuffle: medium/style pills use `Math.random`, so same-day players get different distractor difficulty. Seed off `runDate|idx` for fairness/determinism.
- [ ] #15 Glossary labels cultures as "Movement" → many cards read "c. unknown · <region>". Label cultures correctly and/or fill culture metadata.

## Pool expansion (in progress — 2026-06-13)
- [x] Make build-pool.mjs OUT-configurable; raise caps (WD LIMIT 900, PER_DEPT 64).
- [x] Build to temp, diff vs current: 74 new-only works (mostly non-Western), append-merge to preserve existing teach/hotspots.
- [ ] Generate teach-notes (Codex) for the 74 new works.
- [ ] Generate hotspots for new works (hotspot loop).
- [ ] Re-pull Met Islamic Art (returned 0 ids — transient API failure this run).

## Pool expansion — multi-museum enrichment waves (planned 2026-06-13)
Goal: grow to thousands of works that match our criteria (good image, datable, geocodable, has movement/culture), batch-enriched (geocode → teach-notes via Codex → hotspots) BEFORE merging. Balanced across difficulty tiers and regions each wave.

### Adapter layer (one normalizer per source → our schema {id,title,artist,y,lat,lng,place,region,style,styleKind,medium,fame,img,src})
- [ ] Art Institute of Chicago — open JSON API, IIIF images, CC0. (cleanest first win)
- [ ] Cleveland Museum of Art — open API, CC0; strong Asian/Islamic/African.
- [ ] Harvard Art Museums — API (free key); deep Asian & Islamic, rich culture/period fields.
- [ ] Smithsonian (NMAfA African + National Museum of Asian Art) — open API, CC0; direct diversity boost.
- [ ] Victoria & Albert (London) — open API; global decorative arts, South/East Asia.
- [ ] Rijksmuseum — API (free key); huge, European-heavy.
- [ ] Brooklyn Museum — open API; African, Egyptian, Indigenous-American.
- [ ] Europeana — aggregator API (~50M, uneven metadata) — later.
- [ ] British Museum — no REST API; pull via Wikidata/SPARQL + IIIF.
- [ ] MoMA — no API but full CC0 collection CSV on GitHub (modern/contemporary; thin images).

### Pipeline rules
- [ ] Only CC0 / open-access-flagged images (no hotlinking unlicensed).
- [ ] Filter: must have image + inception year + geocodable place + (movement OR culture).
- [ ] Dedup across sources by normalized title+artist AND by Wikidata id where resolvable.
- [ ] Assign fame/difficulty via Wikidata sitelinks (see fame brainstorm below) — NOT Met isHighlight, so non-Western works aren't auto-dumped into "Impossible".
- [ ] Batch-enrich each wave fully (teach + hotspots) before merge; never ship half-baked.

### Fame / "how well known" ranking — brainstorm (to decide)
- [ ] Wikidata **sitelinks count** (# language Wikipedias) — best single proxy; already used for WD works. Cross-reference EVERY work (any source) to its Wikidata item to inherit sitelinks.
- [ ] Wikipedia **pageviews** (REST API) — popularity over time; tiebreaker for works with similar sitelinks.
- [ ] Presence on Wikipedia "mega lists" / curated sets: "List of most famous paintings", per-movement list articles, museum "highlights"/"masterpieces" categories, Google Arts & Culture features.
- [ ] Commons category size / "featured"/"quality image" flags.
- [ ] Museum "highlight"/"on view"/"masterpiece" flags (Met isHighlight, AIC is_on_view, etc.) as a secondary signal.
- [ ] Composite fame score = weighted blend (sitelinks heavy, pageviews medium, list/highlight bonuses) → quartile into easy/medium/hard/impossible.
