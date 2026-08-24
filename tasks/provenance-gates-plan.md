# Spec: prevent the WD-harvest data-quality class (place/date/attribution)

_Status: SPEC (not started). Written 2026-08-20._

## Problem
place=birthplace, date=wrong, artist=mounter-not-maker all share one root: they enter at **harvest**, from
Wikidata facts that are individually true but wrong for the game's framing, and are only caught by **network
audits run by hand and adjudicated manually**. Detect-when-I-remember, not prevent.

**Principle:** move each check from "network audit I run occasionally" to "network-free gate on every commit,"
by snapshotting the facts it needs into the committed data. The audits can't gate today only because they hit
Wikidata at check time. Bake the facts in and the invariant becomes a cheap local check.

Build order: **#1 (gate what's here) → #3 (cheap second reviewer) → #2 (prevent at source).** #2 is the real
prevention; #1/#3 catch what slips through. Do #1 first: smallest, gates immediately, retroactive.

---

## #1 — Bake artist lifespan, check dates against it (network-free) — SHIPPED (WARN) 2026-08-24
Done via `scripts/build-lifespans.mjs` (targeted birth/death fetch off the wd-cache work→creator map, no full
refetch) → baked `born`/`died` onto 2,918 named-artist works. `check-pool` now WARNs `date-outside-lifespan`
(y < born+8 or y > died+5), network-free, on every commit → `data/incoming/date-lifespan-backlog.json` (32
works). `data/date-lifespan-exempt.json` holds verified-legit cases (the ewer). Immediately surfaced real errors
(Parmigianino *Madonna with the Long Neck* 1600→~1535, Fra Angelico *Coronation* 1500→~1432, della Robbia,
Ernest Lawson 1950). **HARD slice deferred**: the dry-run showed the "egregious" set (15) mixes real errors with
legit copies-of-older-masters, albums-dated-to-compilation, and a few bad WD lifespans (Jaume Serra) — so a hard
block is unsafe until the backlog is triaged + lifespans cleaned. Follow-ups: (a) triage the 32 backlog (fix real
errors, exempt legit); (b) improve build-lifespans to verify the creator QID matches the artist name (drop the
Jaume-Serra-type bad lifespans); (c) then promote the curated egregious slice to HARD. build-lifespans is
network-derived → run manually/periodically (like fame-score), NOT in the network-free `normalize`.

### Original design
The lifespan bound caught 4 of 5 date errors this session AND catches the mounter/restorer attribution bug (an
object dated far outside its attributed artist's life). Turn the network triage into baked data + a local check.

**Data + build:**
- Extend the wd-cache creator schema to also fetch **P569 (birth year)** (currently only P570 death). Bump
  `SCHEMA` to 4 in `scripts/lib/wd-cache.mjs` so `creators[]` carries `{q,l,born,died,birthCountry}`.
- New `scripts/build-lifespans.mjs`: for each pool work with a named artist (reuse check-pool's `isNamedArtist`)
  and a resolvable creator QID, write **`born`/`died`** (the primary creator's years) onto the pool work.
  Idempotent; skip workshop/anonymous/"after"/"attributed" artists and works whose creators disagree wildly.
- Denormalized onto the work (2 small ints) so the gate is a one-liner and needs no work→artist indirection.
  Refreshed in the promote pipeline; a `lifespan-stale` guard (like `authorities-stale`) can keep it current.

**Check (check-pool, network-free) — with the false-positive lesson baked in:**
- The ewer proved a naive `y < born` HARD gate is WRONG: a Fatimid crystal (y=1000) legitimately attributed to
  its 19th-c *mounter* Morel must NOT be blocked. So:
  - **WARN `date-outside-lifespan`** (default): `y < born+8` OR `y > died+5`, writes a backlog. Runs every commit,
    tiny actionable list after triage.
  - **HARD `date-impossible`** only for the unambiguous slice: medium is a *painting/drawing* (no posthumous
    casts/print editions), `y > died+10` OR `y < born` by >30y, AND not in a `date-lifespan-exempt.json` set.
  - `date-lifespan-exempt.json` (like `easy-exclude.json`): reviewed legit cases (older-object-mounted,
    posthumous cast) so they never re-flag. The ewer goes here.
- Bonus: `born`/`died` are then available to optionally show artist dates at reveal (not required).

**Effort:** medium (cache schema bump + build script + gate + exempt list). **Value:** highest — retroactively
catches the whole impossible-date/wrong-maker class on the next `npm test`, zero network.

---

## #3 — Field-vs-note consistency gate (the note is a free second reviewer)
The reveal note is vision/human-verified and independent of WD; it's what caught the ewer ("Fatimid crystal…
later mounted by Morel"). `check-pool` already does ONE of these (`century-off`: note-century vs `y`). Generalize.

- **date:** keep existing `century-off` (note "Nth century" vs `trueCent(y)`, ±1, WARN).
- **artist `note-artist-conflict` (WARN):** flag when the note clearly says *anonymous/unknown/unidentified
  maker* but `p.artist` is a named person, or vice versa. Conservative: match only explicit phrases
  (`/\b(anonymous|unknown|unidentified)\b.*\b(artist|maker|master|sculptor|painter)\b/i`) against a named
  `p.artist`. (Catches the mounter/mis-attribution class from the note side.)
- **place `note-place-conflict` (WARN):** run `countryOf()` over the note text; if the note names a country that
  differs from `countryOf(p.place)` (and the note isn't just describing where it's *held*), flag. Reuse the
  shared `countryOf` from `scripts/lib/places.mjs`.
- All WARN + backlog, tuned conservative like `century-off` (high-signal only — noisy heuristics erode the gate).
  Reads `teach` (already loaded in check-pool for century-off), so near-zero added cost.

**Effort:** small-medium (extends an existing loop). **Value:** high — a free, every-commit second opinion from
the trusted source; the noisiest of the three, so keep it conservative.

---

## #2 — Shared harvest resolver (prevent at source)
Each harvest script picks WD fields its own way — that's how P495-as-place leaked into `pull-wd-collection` but
not `fetch-harvest`. Consolidate the field rules into ONE helper so bad data can't enter.

- New `scripts/lib/wd-fields.mjs` → `resolveWorkFields(entity, {cache})` returning `{place, region, y, flags}`:
  - **place:** P1071→P17, else P276→P17, else P495 ONLY if anonymous (no named P170). Never P19. Never P495 for
    a named artist (the nationality trap). Mirrors the `fetch-harvest`/`pull-wd-collection` fix, centralized.
  - **date:** P571 inception, but if the creator lifespan is known and inception is impossible → set `y=null` +
    `flags:['date-impossible']` (blank-not-wrong; leave for review rather than import a bad date).
  - **role flags:** inspect P170 qualifiers / statements for *mount / setting / restorer / "after"* roles →
    `flags:['artist-not-maker']` so promote surfaces it (the ewer/older-object case) instead of silently
    dating the object to the later hand.
- **Adoption (incremental, low-risk):** refactor `fetch-harvest.mjs`, `pull-wd-collection.mjs`, `harvest-famous.mjs`
  to call it, ONE at a time, diffing each script's candidate output before/after (field-scope diff, memory
  `gesso-pool-diff-scope`). It touches working harvest code, so verify per script; the resolver is pure + unit-
  testable (feed a fixture entity, assert fields).

**Effort:** largest (refactor of live harvest paths). **Value:** the actual prevention — the other two become the
safety net for what still slips through.

---

## Residual (irreducible)
Genuine scholarly disputes (Capitoline Wolf's date, Syria-vs-Egypt attributions) still need a human. #1–3 shrink
the hand-adjudicated pile to just those; everything mechanical is caught before it ships.

## Open decisions
1. #1 gate strength: WARN-only first (safe, still every-commit), or ship the HARD slice immediately with the
   exempt list?
2. #1 storage: `born`/`died` on each work (denormalized, simplest — recommended) vs a keyed sidecar.
3. Order confirmation: #1 → #3 → #2, or bring #2 forward to stop the bleeding at ingest sooner?
