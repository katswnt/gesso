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
1. **Rolling public domain (free, zero risk — do this).** US = publication year + 96. 1930 works are PD *now* (since Jan 1 2026): Mondrian *Composition in Red, Blue and Yellow*, Klee, van Doesburg, Orozco, Grant Wood *American Gothic*. Dalí *Persistence of Memory* (1931) → PD Jan 2027. Build an **annual Jan-1 harvest**: Wikidata SPARQL `inception = year−96 AND hasImage`, verify first-publication. Keyed to publication year (work-by-work), NOT artist death — so Picasso/Matisse free piece-by-piece over time.
2. **Mine open-access museum APIs for existing early-modern PD (free).** AIC (server-side PD filter + IIIF), Cleveland, SMK (~39k PD), LoC WPA posters (CC0), Smithsonian. Already-free famous moderns: Klimt, Schiele, Modigliani, Klee, Kandinsky, Mondrian, Munch, Léger. (MoMA/Rijksmuseum = no open modern images.) Stay US-safe: creator death ≤1955 AND inception <1931 (avoids the URAA trap).
3. **Blue-chip in-copyright (Warhol, Pollock, Kahlo, late Picasso): low-res fair-use thumbnails OR link-out/IIIF.** Thumbnail fair-use is reasonably strong (Kelly v. Arriba, Perfect 10 v. Google) but Warhol v. Goldsmith (2023) means lean on *different purpose + non-competition*: recognition quiz only, ≤~400px, non-downloadable, one per work, per-work rationale (Wikipedia non-free playbook). Risk = occasional DMCA takedown, not lawsuit (Vercel safe harbor). Avoid raw-JPEG hotlinking (Goldman v. Breitbart). **Get a short IP-attorney review before shipping copyrighted thumbnails.**
4. **Formal licensing (ARS/DACS/Bridgeman) = last resort** — quote-only, ~$300–1000+/blue-chip image, often declines games. VG Bild-Kunst cheapest (~€10/work). Artstor/JSTOR: terms BAN website embedding — do not use.
