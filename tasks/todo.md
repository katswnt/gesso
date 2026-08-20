# Gesso — consolidated backlog

_Rebuilt 2026-08-13 by auditing every planning doc against the live code. Most of the old plans described a much earlier state — the app (leaderboard, training, glossary, collections, vision-pass reveal notes ~99%, movement classification, Briana editorial design, all-language fame, analytics + monetization + onboarding) is shipped and live at gesso.katswint.com on `main`. What's below is what genuinely remains, verified against the code._

## 🔴 Bugs / data quality (do first)
- [x] **`artistOrigin` mismatch — RESOLVED** (`audit-data.mjs` → `artistOrigin 2`, was 217). Down to noise; no gate added (it self-corrected via later place fixes).
- [x] **place = artist's birthplace — DONE.** Was `audit-place.mjs` HIGH 4 / MED 46, mostly the audit crying wolf. Root cause: it compared the suggested country against the full place *string*, so every "City, Country" place (e.g. "Venice, Italy" vs "Italy") read as a mismatch. Fixes: (1) added shared `countryOf()` to `places.mjs` and made the audit compare **country-to-country** + a `TERRITORY_PARENT` map (French Polynesia≠France etc.) → MED 46→2; (2) added `Yuan/Song/Han dynasty` to the audit's NORM so dynasties don't read as non-China; (3) 4 **genuine** corrections applied to pool.js (verified against WD P1071 + creation-city coords backfilled): Ducreux *Mocking Pose* France→**UK** (painted London 1793, émigré), Duret *maréchal* France→**Netherlands** (Haarlem), Strasbourg-Cathedral master Germany→**France** (modern Strasbourg), Titian *Alfonso d'Avalos* Spain→**Italy** (painted Venice); (4) WHITELIST for verified WD-data-errors (Statue of Liberty made-in-France, Titian *Madonna of the Rabbit*, and *Alfonso* — WD P1071 links Q773853 = **Venice, Florida**, not Venice, Italy). Residual MED 2 are genuine scholarly attribution debates (Baptistère de St-Louis Syria/Egypt; a Ghana/Ivory-Coast ethnographic span), correctly surfaced as review — not bugs. Gate + full `npm test` green.
- [ ] **1 Renaissance misfit** (was 6) — only *Diósgyőr Madonna* (Hungary) tagged "Early Renaissance" remains; the Ottoman Tughra + Spanish court works are resolved. Debatable (Hungarian Renaissance is real), low priority.
- [x] **`style-from-note-backlog` — DONE** (commit eb73048): 5 works assigned Greater Nicoya / Federal / Academic realism from their notes + a place-as-museum fix on the Nicoya bowl. Backlog 0.
- [ ] **~451 `style:""` works are NOT a bug** — coins, stamps, monuments legitimately don't score style (their `cats` correctly omit it). Noted so it isn't re-flagged.
- [ ] **`teach-works.js` ≈ 23 MB**, shipped to every client, no sharding. Perf debt.

## 🟠 Coverage (the thin regions)
- [ ] **Oceania** ~28 (target 80–120), **Middle East** ~7, **Early Medieval Europe 500–1000** ~7 (target +60), **South America**. Harvest via the museum-API pipeline (`coverage-gaps.md` has guidance).
- [ ] **Contemporary / rolling-PD**: automate the annual Jan-1 harvest (`scripts/fetch-modern.mjs` exists, no cron). 1931 cohort (Dalí *Persistence of Memory*) eligible 2027. Missing PD-now artists: **Raja Ravi Varma, Osman Hamdi Bey**.
- [ ] **~35 pin-backlog works** have no look-closer pins (non-Met/non-Wikidata sources).

## 🟡 Scoring & features (tier2-plan Batch B — parked, not shipped)
- [x] **B3 tiered place credit** — DONE (2026-08-17, `5a8c83d`). `whereCredit()` (pure/tested): historical region = full, right modern country *alone* (when a deeper region exists) = 0.8 with a "right country · this is <RegionName>" nudge, no-region works = full (unchanged). ≤200km bullseye guard protects against simplified polygons. Public methodology copy updated for honesty.
- [x] **B1 `placeNA`** + **B2 object-datability tolerance** — DONE (2026-08-17, `ebc9016`). B1: continent-only / coordless records drop the where axis (with a reveal line), ~7 works; blank-place-with-coords still distance-scored. B2: single-year period/culture objects widen the full-credit window to the period's `movEra` span (Ming correct across 1368–1644), capped at 400 yrs; ~1030 works, named-artist/movement pieces untouched.
- [x] **A3 super-regions** — DONE (2026-08-17, `10baa9f`). Added 8 non-European (Imperial China, Greater Persia, the Nile Valley, Ancient Greek world, Ottoman core, Indian subcontinent, Mesopotamia, Andean world) via `scripts/build-superregions.mjs` (idempotent, country-union geometry, leaves the European 8 + culture polygons byte-identical). 609 works gained their historical region; 0 regressions; 0 modern false-matches. **Soviet piece DONE too** (`ba02465`): shrank the Russian/Soviet polygon from the whole ex-USSR to modern Russia (Kat's call), so a Kyiv/Tashkent pin no longer scores full for a Moscow-placed work; any in-Russia pin (Moscow→Vladivostok) still full. Kat kept the B3 0.8 heartland nudge as-is (a pin in the far part of the modern country, outside the smaller culture polygon, stays 0.8).
- [x] **1c artist-alias matching** — DONE (2026-08-17, `ebc9016`). Existing mononym/surname/typo/deaccent logic already covered ~80%; added curated bidirectional equivalence groups for the cross-language exonyms/bynames that share no token with the catalogue name (Titian↔Tiziano Vecellio, El Greco↔Theotokópoulos, Tintoretto↔Jacopo Robusti…). Guards hold (Monet≠Manet). README scoring section updated with the full geography decision + rationale (B3/A3/Soviet/B1/B2/1c).

## 🟢 Content / vision enrichment
- [ ] **~1,442 thin guides** remain (24%) — guides pipeline runs in ~100-work batches; keep grinding.
- [ ] **Next-vision-pass fields** — image pass done, but 5/6 banked enrichment fields never folded in: `visDiff` (2nd difficulty signal), `mediumFull`, `anonReason`, `living`, provenance/"how it got here". Only `sensitive` (63 works) landed.
- [ ] **Blank-reveal non-punitive nudge** — label swap shipped, but the "· skipped, no penalty — here's the tell" behavior on a blank guess is still absent.

## 🔵 Instrumentation & docs (mostly done — small tails)
- [x] **Wire remaining events** — DONE (2026-08-17, `060a37f`). `collections_view` (already), `pin_click`, `zoom` (user-zoom only via a programmatic-fit suppressor), `puzzle_link_copy`, `account_create` now fire — 18 distinct events wired. Only `activation_sentiment` remains (needs a post-first-daily "how did that feel?" UI prompt — a product decision, not just a `track()` call). `support_convert` is off-site on Ko-fi → not client-measurable without a Ko-fi webhook.
- [x] **`docs/metrics.md`** — DONE (`060a37f`). It already correctly said the backend is live (the "no backend" note here was itself stale); refreshed the event dictionary + count to 18 and clarified what's genuinely left.
- [ ] Confirm the Supabase auth **email templates** (`tasks/email-templates.md`) are actually pasted into the Supabase console.

## ⚪ Deferred / future (real work, intentionally not queued)
- [ ] **Accounts/leaderboard Phase 3** — friends boards, all-time boards, specialist badges (Phase 1/2 shipped). Phase 4 server-authoritative re-scoring (raw guesses already stored).
- [ ] **Wikidata give-back** — `scripts/wikidata-giveback.mjs` written but never run (needs your Wikidata login → QuickStatements batch).
- [ ] **Portfolio artifacts** (`docs/icp.md`, `metrics.md`, `monetization.md`, `case-study-honesty-pass.md`, `showcase.md`) are finished — refresh their coverage numbers before external use (they cite Oceania 20 / ~5,950 works).
- [ ] Small cleanups: extract MOVEMENTS → generated `data/movements.js`; dedup `DEMONYM`/`TRAIN_DEMONYM`; collapse the `computeCollections` triplication; `.card-surface`/`.blob-id` utility classes; auth-ux 🟡 #4 (device-name canonical promote) + #7 (name-reservation feedback); Tutankhamun entity swap.
- [ ] Aspirational: spin-off editions (fashion/architecture), themed dailies, two-pool Explore/Infinite. No code; pure future.

---
_Cleaned up in this pass: deleted afk-plan, teach-me-plan, regions-feature, 3 design briefs, briana-reconcile-report, daily-week-preview (shipped/obsolete) + 3 resolved backlog JSONs + 2 dead job dirs. Kept as living references: `long-term-goals.md`, `coverage-gaps.md`, `contemporary-art-research.md`, `code-review.md`, `hardcoded-data-audit.md`, `tier2-plan.md`, `next-vision-pass.md`, the pipeline runbooks, and the portfolio docs._
