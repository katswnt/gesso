# Gesso — Long-term goals

## Additional data sources (keyless / durable — CC0 datasets, not fragile API pages)
Add adapters for these in future enrichment waves (Brooklyn & Rijksmuseum APIs were deprecated/removed):
- [ ] **National Gallery of Art, Washington** — full open-data on GitHub, CC0 (Euro/American canon; great for Easy tier depth).
- [ ] **Minneapolis Institute of Art (MIA)** — open-data CSV on GitHub, CC0 (decent global spread).
- [ ] **Walters Art Museum** — strong Islamic, Ethiopian, Asian, medieval holdings.
- [ ] **Getty** & **Yale (LUX)** — large Linked-Open-Data / IIIF datasets.

Each needs: a normalizer into our schema, dedup vs existing pool (Wikidata id / title+artist), fame scoring via Wikidata sitelinks, then batch enrichment (teach-notes + hotspots) before merge.

## Other long-term ideas
- [ ] Two-pool architecture: curated Daily pool vs. a vast "Explore/Infinite" pool (template-generated teaching) to chase scale (anthropeum has ~500k via bulk ingest + zero curation).
- [ ] Per-region quotas within difficulty tiers so every tier feels globally representative.
- [ ] Non-English sitelink weighting to further de-bias the fame signal.
- [ ] Themed dailies ("Women artists", "The year 1600 around the world").
