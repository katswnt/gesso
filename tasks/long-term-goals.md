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
