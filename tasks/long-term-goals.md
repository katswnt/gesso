# Gesso — Long-term goals

## Additional data sources (keyless / durable — CC0 datasets, not fragile API pages)
Add adapters for these in future enrichment waves (Brooklyn & Rijksmuseum APIs were deprecated/removed):
- [ ] **National Gallery of Art, Washington** — full open-data on GitHub, CC0 (Euro/American canon; great for Easy tier depth).
- [ ] **Minneapolis Institute of Art (MIA)** — open-data CSV on GitHub, CC0 (decent global spread).
- [ ] **Walters Art Museum** — strong Islamic, Ethiopian, Asian, medieval holdings.
- [ ] **Getty** & **Yale (LUX)** — large Linked-Open-Data / IIIF datasets.

Each needs: a normalizer into our schema, dedup vs existing pool (Wikidata id / title+artist), fame scoring via Wikidata sitelinks, then batch enrichment (teach-notes + hotspots) before merge.

## Training mode (targeted practice on weak spots)
A dedicated mode (evolution of Learning mode) where the player drills exactly what they want to improve. Builds on the per-category strength/weakness stats already shown in the Learning-session summary.
- [ ] **Auto-target weak spots:** "Practice your weak spots" — serve works that stress the categories the player scores lowest on (e.g. heavy on Movement if that's their weakest), using their session/aggregate stats.
- [ ] **Custom filters:** let the player constrain the practice set — e.g. a single **century**, single **medium**, single **region/country**, single **movement/culture**, or any combination ("18th-century French oil paintings").
- [ ] **Persistent skill profile:** track per-category accuracy over time (extend the `mastery` localStorage) and surface trends ("your Movement accuracy is up 12% this week").
- [ ] **Drill formats:** optionally isolate ONE category at a time (date-only drills, map-only drills) for focused reps.
- [ ] Needs: rich, queryable metadata on every work (century/medium/region/movement) — the recent backfill makes this feasible — plus a filter UI and a stats store.

## Other long-term ideas
- [ ] Spin-off editions once Gesso is polished: a **fashion** edition and an **architecture/buildings** edition (different pools, same engine).
- [ ] Two-pool architecture: curated Daily pool vs. a vast "Explore/Infinite" pool (template-generated teaching) to chase scale (anthropeum has ~500k via bulk ingest + zero curation).
- [ ] Per-region quotas within difficulty tiers so every tier feels globally representative.
- [ ] Non-English sitelink weighting to further de-bias the fame signal.
- [ ] Themed dailies ("Women artists", "The year 1600 around the world").
