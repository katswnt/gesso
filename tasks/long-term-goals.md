# Gesso — Long-term goals

## Additional data sources (spec)
**Why:** broaden coverage (more global, more depth per tier) and reduce reliance on any single museum API. Prefer **keyless, durable CC0 datasets** (GitHub data dumps) over fragile live API pages — Brooklyn & Rijksmuseum APIs were deprecated/removed, which is the cautionary tale.

**Candidate sources (priority order):**
- [ ] **National Gallery of Art, Washington** — full open-data on GitHub, CC0 (Euro/American canon; great Easy/Medium depth).
- [ ] **Minneapolis Institute of Art (MIA)** — open-data CSV on GitHub, CC0 (decent global spread).
- [ ] **Walters Art Museum** — strong Islamic, Ethiopian, Asian, medieval holdings (helps de-Eurocentrism).
- [ ] **Getty** & **Yale (LUX)** — large Linked-Open-Data / IIIF datasets (deep, but heavier to parse).

**The adapter pattern (reuse the existing pipeline — `scripts/consolidate.mjs` + the audit/enrich scripts):**
1. **Fetch** the dump to `data/incoming/<source>.json` (gitignored). Pin a snapshot; don't hot-call at runtime.
2. **License gate** — keep ONLY public-domain / CC0 images (per-record rights field). This is non-negotiable (same reason there's little post-1929 art).
3. **Normalize** into our schema { id, title, artist, y, place, lat/lng, medium, style, styleKind, img, region, src }. Give each source a stable `src` tag + id prefix (e.g. `nga<id>`).
4. **Geocode** origin (origin-first via CENTROIDS/GAZ tables, not holding-museum).
5. **Dedup vs the live pool** — Wikidata Q-id first, then title+artist, then shared-image URL (the `dedup-pool.mjs` logic).
6. **Realness check** — run `audit-p31.mjs` (drops cities/taxa/buildings/concepts) + image validation (`check-images.mjs`, Commons-API-style existence).
7. **Fame** — Wikipedia pageviews (`grab-pageviews.mjs`) > Wikidata sitelinks fallback; canon flag if it's a known icon.
8. **Enrich** — teach-notes + hotspots (Claude vision pass) for the high-fame additions; long tail can stay note-light.
9. **Merge → regenerate fame → re-freeze daily**, then spot-check the new works in-app before shipping.

**Effort:** ~1 day per source for steps 1–6 (mostly a normalizer + field mapping), then enrichment is the token cost. Net-new "famous" works are the highest value (they deepen Easy/Medium); obscure long-tail mostly pads Impossible.

## Training mode (spec)
**Why:** turns endless Learning mode into *deliberate* practice — drill exactly what you're bad at, or study a slice you care about. Builds directly on the per-category / per-movement / per-region strength stats already shown in the Learning-session summary, and is the payoff for the persistent skill profile. Great differentiator + retention driver for engaged players.

**Effort:** ~2–4 days for an MVP, *given* the prerequisites below are met. The work selection is just filtering the pool; the UI + a stats store are the bulk.

### Prerequisites (mostly already true)
- **Queryable per-work metadata** — century (from `y`), medium family, region, movement/culture. The recent backfill makes this real for the live pool.
- **A skill profile** — per-category + per-movement + per-region accuracy. Session-level exists now; *persistent* needs the `mastery` localStorage extended (and ideally synced to the account — see Accounts spec).

### Modes
- [ ] **Auto weak-spot drill** — "Practice your weak spots." Pick the player's lowest-scoring axis (category, movement, or region) from their profile and bias the served set toward works that stress it (e.g. lots of Baroque if Baroque is weakest; or movement-heavy works if Movement is the weak category).
- [ ] **Custom filters** — constrain the practice set by **century**, **medium**, **region/country**, **movement/culture**, or any combination ("18th-century French oil paintings"). Filter UI = chips/dropdowns over the metadata facets.
- [ ] **Single-category drills** — isolate ONE guess type for focused reps (date-only, map-only, movement-only). Hides the other inputs; scores just that axis.

### Mechanics
- No streak/stats impact (like Learning mode); unlimited, free hints optional.
- Reuse `tierItems`-style filtering but over the *whole* pool with the active facet filters applied; shuffle; serve.
- End-of-session summary shows movement/before-after on the drilled axis ("Baroque: 54% → 71% this session").
- Empty-filter guard: if a filter combo yields too few works, tell the player + loosen.

### Persistent skill profile (shared with Accounts)
- Extend `mastery` (currently `{byStyle, byRegion}`) to also track `byCategory` and `byCentury`, with counts + rolling accuracy.
- Surface trends over time ("your Movement accuracy is up 12% this week") — needs dated samples, so this is best once accounts exist (server-side history); localStorage gives a single-device version in the meantime.

### Phasing
1. **Custom-filter practice** (no profile needed) — ship the facet filters over the pool. Immediately useful.
2. **Single-category drills.**
3. **Auto weak-spot targeting** (needs the persistent profile).
4. **Cross-session trends** (needs accounts).

## Accounts + leaderboards (spec)
**Why:** unlocks the thing the game is missing — *measurable retention* and a competitive/social loop. Turns "cool build" into a product with real metrics (DAU, D1/D7 retention, share rate, repeat-play lift). Dailies are already **deterministic** (everyone plays the identical puzzle), so cross-user comparison is fair with zero extra work. Stack is familiar (Upstash Redis already used on letterboxd-wrappd; `/api/` pattern + `vercel.json` routing already in place).

**Effort:** ~weekend → 1 week for MVP. Leaderboards are easy (Redis sorted sets); auth is medium (use a managed provider); score integrity is the only real wrinkle.

### Auth
- Use a **managed provider** — do NOT roll our own. Options: Sign in with Vercel, Clerk, or Supabase/Auth.js. Magic-link email or Google OAuth for lowest friction (casual game).
- Keep play **anonymous-first**: the game stays fully playable logged-out (localStorage as today); logging in just *syncs + unlocks* leaderboards.

### Data model (Upstash Redis to start)
- `user:<id>` → profile { handle, email, createdAt }
- `scores:<userId>` → hash of `YYYY-MM-DD:<tier>` → { total, perCategory, perfect, masterpiece }
- `lb:<YYYY-MM-DD>:<tier>` → **sorted set** (`ZADD score → userId`) — the leaderboard primitive
- `streak:<userId>` → { current, longest, lastPlayed } (server copy of the localStorage streak)
- (later) `mastery:<userId>` → byStyle/byRegion accuracy for the persistent skill profile (feeds Training mode)
- If relational is preferred later (richer history/analytics), Neon Postgres via Vercel Marketplace.

### API endpoints (Vercel serverless)
- `POST /api/score` — submit a finished daily { date, tier, rounds[], total } → validate → ZADD + store
- `GET /api/leaderboard?date&tier` — `ZREVRANGE` top-N + the caller's own rank/percentile
- `GET /api/me` — history, streak, mastery for the signed-in user
- `POST /api/sync` — on login, merge the device's localStorage history up

### Leaderboard UX
- "You ranked **#N** of M today" on the final screen + a leaderboard view (global / friends).
- Per-tier boards (Easy/Medium/Hard/Impossible) since they're separate puzzles.
- Friends: shareable invite link → a private board (Redis set of userIds) is a cheap, high-value v1.

### Score integrity (the one hard part) — cheapest → most work
1. **Accept it** (casual / friends-only board) — fine for v1.
2. **Light server validation** — submit each round's guesses (pin, year, picks); re-score server-side from the frozen daily answer key (we have the data) and reject impossible scores. Recommended.
3. **Server-authoritative scoring** — only if it gets competitive; overkill for now.

### Phasing
1. Redis + `POST /api/score` + `GET /api/leaderboard`, anonymous device-id (no login) → ship a working daily leaderboard fast.
2. Add managed auth + `/api/sync` so progress follows you across devices.
3. Friends boards + "#N today" surfacing.
4. Persistent mastery profile → feeds **Training mode** (above).

## Other long-term ideas
- [ ] Spin-off editions once Gesso is polished: a **fashion** edition and an **architecture/buildings** edition (different pools, same engine).
- [ ] Two-pool architecture: curated Daily pool vs. a vast "Explore/Infinite" pool (template-generated teaching) to chase scale (anthropeum has ~500k via bulk ingest + zero curation).
- [ ] Per-region quotas within difficulty tiers so every tier feels globally representative.
- [ ] Non-English sitelink weighting to further de-bias the fame signal.
- [ ] Themed dailies ("Women artists", "The year 1600 around the world").

## Contemporary / modern art (the copyright gap) — plan
Full findings: tasks/contemporary-art-research.md. TL;DR prioritized:

> **✅ Options 1 & 2 DONE (2026-06).** Added 36 US-PD modern icons (Klimt, Schiele, Modigliani,
> Munch, Kandinsky, Mondrian, Klee, Matisse, Malevich, Boccioni, Marc, Rousseau, Kirchner,
> Coolidge…) under the US-safe rule (inception <1931 AND creator d.≤1955). 16 canon (Easy);
> 100% notes + hotspots + origin coords. Reusable pipeline: `scripts/fetch-modern.mjs` →
> `reresolve-modern` → `clean-modern` → `promote-modern` → `inject-modern-fame`.
> **Annual TODO (every Jan 1):** bump the seed to the new year−96 cohort (2027 → 1931 works:
> Dalí *Persistence of Memory*, etc.) and re-run the pipeline. Options 3 (in-copyright thumbnails)
> & 4 (licensing) remain future work, needing an IP-attorney review first.

1. **Rolling public domain (free, zero risk — do this).** US = publication year + 96. 1930 works are PD *now* (since Jan 1 2026): Mondrian *Composition in Red, Blue and Yellow*, Klee, van Doesburg, Orozco, Grant Wood *American Gothic*. Dalí *Persistence of Memory* (1931) → PD Jan 2027. Build an **annual Jan-1 harvest**: Wikidata SPARQL `inception = year−96 AND hasImage`, verify first-publication. Keyed to publication year (work-by-work), NOT artist death — so Picasso/Matisse free piece-by-piece over time.
2. **Mine open-access museum APIs for existing early-modern PD (free).** AIC (server-side PD filter + IIIF), Cleveland, SMK (~39k PD), LoC WPA posters (CC0), Smithsonian. Already-free famous moderns: Klimt, Schiele, Modigliani, Klee, Kandinsky, Mondrian, Munch, Léger. (MoMA/Rijksmuseum = no open modern images.) Stay US-safe: creator death ≤1955 AND inception <1931 (avoids the URAA trap).
3. **Blue-chip in-copyright (Warhol, Pollock, Kahlo, late Picasso): low-res fair-use thumbnails OR link-out/IIIF.** Thumbnail fair-use is reasonably strong (Kelly v. Arriba, Perfect 10 v. Google) but Warhol v. Goldsmith (2023) means lean on *different purpose + non-competition*: recognition quiz only, ≤~400px, non-downloadable, one per work, per-work rationale (Wikipedia non-free playbook). Risk = occasional DMCA takedown, not lawsuit (Vercel safe harbor). Avoid raw-JPEG hotlinking (Goldman v. Breitbart). **Get a short IP-attorney review before shipping copyrighted thumbnails.**
4. **Formal licensing (ARS/DACS/Bridgeman) = last resort** — quote-only, ~$300–1000+/blue-chip image, often declines games. VG Bild-Kunst cheapest (~€10/work). Artstor/JSTOR: terms BAN website embedding — do not use.

## Scoring refinements (spec) — ✅ IMPLEMENTED 2026-06
Shipped in `score()` (index.html): **A** `movementSim()` (family + era-overlap + region taxonomy, curated `RELATED_MOV` kept as a full-credit override) and **B** graded artist credit (same school 0.45 / same era ±30y 0.25 / same region 0.15). **B used pool-derived `artistMeta`** (each artist's active-year range + regions, built in `buildIndexes`) instead of a Wikidata P569/P570/P27 harvest — simpler, no new data file. **C** is subsumed by A (the taxonomy now gives Edo/Ukiyo-e, Ming/Qing, etc. partial credit they previously scored 0 for). Original spec below for reference.


**Why:** the scoring intent is "reward partial knowledge" — knowing the era, the school, or a same-movement artist should earn credit, not a flat miss. Today **When** and **Where** already do this gracefully (continuous curves). **Movement** and **Artist** do NOT — they're binary with flat partial credit, which is the gap Kat half-remembered as "gradients." This spec makes them true gradients and widens coverage.

### Current state (as built — for reference)
- Per category = **2,500 pts**. Core = When/Where/Medium/Movement (10k base); **Artist is a +2,500 bonus** on top. Hints −500 each (max 3), off core.
- **When:** `|guess−actual|` ÷ tier factor (Easy/Med 1.3, Hard 1.35, Imp 1.4) → step bands 2500/2250/1900/1300/700/250/0 at ≤12/20/40/80/160/320 yrs. *Good — leave as-is.*
- **Where:** inside the work's country (point-in-polygon) = full; else `2500·exp(−(dist−countryRadius)/distK)`, distK Easy 4500 → Imp 1000. *Good — leave as-is.*
- **Medium:** exact 2500; same `MED_FAMILY` (paint/sculpt/craft) 1250; else 0. *OK; could refine families later.*
- **Movement:** exact 2500; in `RELATED_MOV[answer]` (a hand-curated, **binary** neighbor list) → flat `relMov` (Easy .70/Med .50/Hard .35/Imp .25); else 0. **Gaps:** the map covers ~20 movements; anything not listed scores 0 partial (e.g. Romanticism's only neighbors are Neoclassicism & Realism → Academic-art guess = 0).
- **Artist (bonus):** fuzzy exact 2500; else if guessed artist shares ANY movement with the work (`artistStyle` map built from the pool) → flat 1000 (40%); else 0. **No era/region awareness.**

### A. Movement → true similarity gradient
Replace the binary list + flat fraction with a **taxonomy-derived 0–1 similarity**, so every movement pair gets a sensible partial score and we stop hand-maintaining edges.
- **Data:** extend the existing `MOVEMENTS` meta (already has `dates`,`region`) with `{start, end, region, family}` where `family` groups siblings (e.g. `renaissance`, `baroque`, `post-impressionist`, `modernist`, `avant-garde`, `edo`…). One-time authored table (~80 movements).
- **Similarity** `sim(a,b) ∈ [0,1]` = weighted blend:
  - same `family` → 0.6 base
  - temporal overlap of [start,end] (Jaccard of the year ranges) → up to 0.25
  - same `region` → 0.15
  - clamp to 1; `sim=1` only for exact match.
- **Score** = `2500 · simCap(tier) · sim(guess, actual)`, where `simCap` is the tier ceiling (reuse current relMov: .70/.50/.35/.25) so partial credit still tightens with difficulty.
- **Result:** Romanticism↔Academic art (same era+region, different family) ≈ 0.4·cap; Romanticism↔Edo (no overlap) ≈ 0 — matching the intuition. Keep `RELATED_MOV` as an optional hand-tuned override layer for special cases.

### B. Artist → graded credit (era + region + school)
Replace the flat 40% with a descending blend of what the guess got right.
- **Data:** build `artistMeta[name] = {movements:Set, born, died, region}` — `movements` already derivable from the pool; add `born`/`died` (Wikidata P569/P570) and `region` (P27 nationality → region) via a one-time harvest step over `ARTIST_POOL` (cache to `data/artist-meta.js`).
- **Score** (bonus, vs the work's actual artist) = `2500 ·` max of:
  - exact (fuzzy) → 1.0
  - shares a movement/school → 0.45
  - active in the same era (floruit within ±~30 yrs of the work) → 0.25
  - same region/nationality → 0.15
  - (take the **max**, or a capped sum, of whichever apply — tune so "same school" ≥ "same era" ≥ "same region")
- **Result:** guessing a contemporaneous compatriot in the same school earns real partial credit; a random wrong artist still 0.

### C. Widen Movement coverage (quick win, do regardless)
Even before the taxonomy, audit which pool movements have **no** `RELATED_MOV` entry and add neighbors — many cultures/schools (Edo, Ukiyo-e, Mughal, Qing, Byzantine…) currently get 0 partial credit for near-misses.

### Effort & phasing
1. **C — expand the neighbor map** (½ day, pure data, immediate fairness win).
2. **A — movement taxonomy + sim()** (~1 day: author the family/era/region table, swap the scoring branch). Backward-compatible; `RELATED_MOV` becomes an override.
3. **B — artist meta harvest + graded credit** (~1–2 days: the P569/P570/P27 harvest is the bulk; scoring change is small).
Keep When/Where untouched. All changes are isolated to `score()` + small data tables; deterministic, so dailies stay fair.
