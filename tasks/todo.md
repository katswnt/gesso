# Gesso — consolidated backlog

_Rebuilt 2026-08-13 by auditing every planning doc against the live code. Most of the old plans described a much earlier state — the app (leaderboard, training, glossary, collections, vision-pass reveal notes ~99%, movement classification, Briana editorial design, all-language fame, analytics + monetization + onboarding) is shipped and live at gesso.katswint.com on `main`. What's below is what genuinely remains, verified against the code._

## 🔴 Bugs / data quality (do first)
- [ ] **`artistOrigin` mismatch = 217 and rising** (was 164). A *scored* category (where) has growing place-vs-artist-origin mismatches. `node scripts/audit-data.mjs` → `artistOrigin 217`. Fix the works AND add a fail-closed gate after promotions so it can't regress again.
- [ ] **place = artist's birthplace ×3** (`scripts/audit-place.mjs` → HIGH). 3 works score the artist's birthplace, not where the work was made.
- [ ] **6 flagged Renaissance misfits** — the Ottoman Tughra mislabeled "Renaissance" (→ Ottoman/Islamic), 2 Spanish court works, a Hungarian Madonna (from the Renaissance split).
- [ ] **`style-from-note-backlog` — 6 works still `style:""`** (met450486, cleveland159278, Q20201288, Q20880994, Q20881254, Q20881236).
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
