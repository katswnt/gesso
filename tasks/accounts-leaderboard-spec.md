# Accounts + Leaderboards — detailed phased scope

Builds the "Accounts + leaderboards (spec)" long-term goal into concrete, sequenced work. Design comp + support.js already in `tasks/16_leaderboard/` ("The Register"). Grounded in the actual codebase:

**Substrate that already exists (why this is cheaper than it looks):**
- **Deterministic dailies** — `dailyItems(key,dateStr)` (index.html ~937) frozen via `data/daily-order.js`; everyone on a given date+tier plays the identical 5 works → cross-user comparison is fair with zero extra work.
- **Serverless + Upstash Redis pattern** — `api/report.js` already does `KV_REST_API_URL/TOKEN` (falls back to `UPSTASH_REDIS_REST_*`), a `redis(path)` REST helper, per-IP rate limiting (INCR+EXPIRE), origin allowlist, honeypot. Copy this file as the template for every new endpoint.
- **`vercel.json`** rewrites already exclude `/api/` from the SPA catch-all.
- **All progress is localStorage today** — `loadStreak`/`recordDailyScore` (~962), `loadMastery`/`bumpMastery` (~690, `{byStyle,byRegion}`), `loadGlossary` (~710), `gesso.settings`. Login = sync these up, not build tracking.
- **Score shape** — a finished daily run produces `results[]` (per-round `{it, cells:{when,where,medium,style,artist}, coreNet, bonus, hints}`) + `resultSummary()` totals; `runDate`/`tier` identify the puzzle. This is exactly what server re-scoring needs.

**Identity is phased deliberately** (per the handoff): initials-only → pick-a-name+dab (no login) → real account. The game stays 100% playable logged-out at every phase; identity/login only *adds* the board + sync.

---

## Phase 1 — Anonymous daily leaderboard (~weekend) — HIGHEST value/effort

Ship a working daily board with **no login**: a random device id + the "pick name & colour" modal (handoff identity option 2). This alone delivers the whole competitive moment.

### 1a. Client identity (no auth)
- On first board view (or first score submit), generate `deviceId = crypto.randomUUID()`, persist `localStorage["gesso.device"]`.
- Pick-name/colour modal (handoff): `{name(≤16), color}` → `localStorage["gesso.identity"]`. Initials = first letters of name words, fallback "YOU". Live dab preview, 8 colour swatches each in a different dab shape.

### 1b. `POST /api/score` (copy report.js scaffold)
- Body: `{ deviceId, name, color, date, tier, rounds:[{cat→{pts,...}}], total, perfects, masterpieces }`.
- Validate: date is today (reject backfill of other dates in v1), tier ∈ TIERS, total within `[0, ROUNDS*MAX_CAT + bonus]`.
- **Score integrity v1 = sanity bounds only** (full re-score is Phase 4). Reject impossible totals; keep raw per-round guesses in the payload so Phase 4 can re-score retroactively.
- Redis writes (per date+tier):
  - `ZADD lb:<date>:<tier> <total> <deviceId>` — the board primitive
  - `HSET player:<deviceId> name color` — display data
  - `SET score:<deviceId>:<date>:<tier> <json>` (TTL ~40 days) — the submitted run, for re-score + "your result"
  - Best-score guard: only ZADD if higher than existing (ZSCORE check) so replays don't inflate.
- Reuse report.js's per-IP rate limit + honeypot.

### 1c. `GET /api/leaderboard?date&tier`
- `ZREVRANGE lb:<date>:<tier> 0 49 WITHSCORES` → top 50; `HMGET player:*` for names/colours.
- Caller's own rank: `ZREVRANK` + `ZSCORE` for their deviceId → "#N of M, top X%".
- Return the handoff data shape: `{rank,name,color,score,tier,perfects,masterpieces,badge,isYou}` (badge null in P1).

### 1d. UI — "The Register" route (port the handoff comp)
- New route `/register` (or `/leaderboard`) in `routeFrom`/`pathFor` (~970). Entry: a line on the final/recap screen ("You ranked #N today →") + a menu link.
- Port `tasks/16_leaderboard/`: podium top-3 (dab avatars), quiet rows, sticky self-row with edit→modal, live countdown (reuse the existing `countdownTimer`), Today/All-time/By-tier tabs (All-time = Phase 3; grey it in P1 or wire 3a early).
- Submit on daily completion (in the results flow, gated `!infinite && !runArchive`, like `recordDailyScore`).

**Deliverable:** play today's daily → see your rank vs everyone, with a chosen name+dab. No login.

---

## Phase 2 — Accounts + cross-device sync (~2–3 days)

Let identity follow you across devices and persist history server-side.

### 2a. Managed auth (do NOT roll our own)
- Options: **Sign in with Vercel**, Clerk, or Supabase/Auth.js. Pick magic-link email or Google OAuth (lowest friction for a casual game).
- Login is **optional + additive**: logged-out keeps working on `deviceId`; logging in claims/merges that device's data.

### 2b. Data model (extend Phase 1 Redis)
- `user:<userId>` → `{handle, email, color, createdAt}`
- On login, **rebind**: migrate `player:<deviceId>` + `score:<deviceId>:*` + leaderboard memberships to `userId` (ZADD new member, ZREM old), so the board shows the account, not the device.
- `streak:<userId>` → server copy of the localStorage streak (authoritative once logged in).
- `hist:<userId>` → per-date/tier results (a hash) for the profile/"your history" view.

### 2c. `POST /api/sync` + `GET /api/me`
- `/api/sync`: on login, merge the device's localStorage (`mastery`, streak, glossary, past scores) up; conflict rule = take max (best streak, best per-date score).
- `/api/me`: history, streak, mastery for the signed-in user (feeds the profile screen + later Training trends).

**Deliverable:** log in → your name, streak, and scores follow you to any device.

---

## Phase 3 — Friends boards + "#N today" surfacing + All-time (~2–3 days)

The retention/social loop.

### 3a. All-time + by-tier boards
- `lb:alltime:<tier>` cumulative sorted set (ZINCRBY on each submit). By-tier just selects the sorted set; the handoff tabs already model this.

### 3b. Friends (needs Phase 2 accounts)
- `friends:<userId>` → Redis set of followed userIds. Invite via shareable link (`/register?invite=<userId>` → mutual add, or one-way follow).
- Friends board = fetch `lb:<date>:<tier>`, filter to `friends:<userId> ∪ self`. Cheap, high-value v1.

### 3c. Specialist badges (handoff)
- movement (green) / region (blue) / Attributor (gold ✦, 10+ artists nailed) at a 90% threshold, computed from `hist`/`mastery`. Pair colour with a text label (a11y).

### 3d. Surfacing
- "You ranked **#N** of M today" + "top X%" on the final screen (data already in the `/api/leaderboard` self-rank). This is the share/retention hook.

**Deliverable:** private friend boards, all-time ranking, badges, and the "#N today" share moment.

---

## Phase 4 — Score integrity hardening (do when it gets competitive)

P1 ships with sanity-bounds only. When stakes rise:
- **Server-authoritative re-score**: the client already submits each round's raw guesses (pin lat/lng, year, medium/style/artist picks). Re-run the scoring math server-side from the **frozen daily answer key** (we have `data/pool.js` + `data/daily-order.js` — bundle a minimal answer map into the API or read from a KV snapshot) and reject/replace client-reported totals.
- This is isolated and retroactive (the raw guesses are stored from P1), so it can land any time without a client change. Full server-authoritative scoring (never trust the client at all) is overkill unless cash/prizes appear.

---

## Cost / risk summary

| Phase | Effort | Risk | Unlocks |
|---|---|---|---|
| 1 — anon daily board | ~weekend | low (infra exists) | the whole competitive moment, no login |
| 2 — accounts + sync | ~2–3 days | medium (auth provider) | cross-device, persistent profile |
| 3 — friends + all-time + badges | ~2–3 days | low | social loop, retention hook |
| 4 — integrity | ~1–2 days | low (isolated) | trust when competitive |

**Recommended path:** ship Phase 1 standalone (it's the payoff and needs no auth), measure engagement, then decide whether 2–3 are worth it. Phase 4 only when leaderboards start mattering.

**New endpoints (all from the report.js template):** `POST /api/score`, `GET /api/leaderboard`, `POST /api/sync`, `GET /api/me`.
**New Redis keys:** `lb:<date>:<tier>`, `lb:alltime:<tier>`, `player:<id>`, `score:<id>:<date>:<tier>`, `user:<id>`, `streak:<id>`, `hist:<id>`, `friends:<id>`.
**New client storage:** `gesso.device`, `gesso.identity` (P1); auth token (P2).
**Env (already used by report.js):** `KV_REST_API_URL`, `KV_REST_API_TOKEN`.
