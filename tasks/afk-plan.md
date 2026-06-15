# AFK autonomous plan (Kat away — Claude-token enrichment authorized)

## Running / done
- ✅ Today's Easy daily = 4 icons + 1 recognizable (pageviews-driven ranking + curated canon).
- ✅ 50 PD canon icons added + enriched (notes) + live.
- ✅ UI: absent categories now show "not recorded / anonymous" placeholder (no more silent drops).
- ✅ Easy medium/style backfilled accurately (gaps 21/70 → 1/3).

## Autonomous loop (each wake, bounded + committed)
1. **Accurate medium/style backfill, tier by tier** (medium → hard → impossible): take the next ~80 works missing medium/style, fan out 6 subagents (NO hallucination — null → placeholder), apply only confident values, commit+push.
2. **Re-harvest PD lists** (arthistoryproject + framecrop) → pull via Wikidata → realness-filter → stage for review (canon-additions style). Output to data/incoming/harvest-addlist.json (the first run's temp output was lost).
3. **Realness audit (P31)**: flag pool works that are buildings/concepts/places (not artworks) like the "Five Pillars of Islam" case → data/incoming/non-artworks.json for review.
4. **Hotspots**: if Codex is back (probe), resume scripts/staged-hotspots.mjs; merge results to data/hotspots.js.
5. Reschedule ~1500s. Stop when pool medium/style largely complete or Kat returns.

## Notes
- Don't hallucinate data; missing → placeholder (per Kat).
- Don't promote new harvested works to live without enrichment (notes); stage them.
- Hotspots/vision need Codex (Claude can't see images).
