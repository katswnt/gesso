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
- [ ] **B3 tiered place credit** — right *modern country* currently = full credit; make it ~0.8 with a reveal line ("you said Nigeria; this is the Benin Kingdom"). The educational payoff of the whole geography model.
- [ ] **B1 `placeNA`** (works with no meaningful "where") + **B2 object-datability tolerance** (wider accepted date range for hard-to-date objects).
- [ ] **A3 super-regions** — only 8, all European. Add Ottoman core, Han/Imperial China; split the Soviet bloc into Ukrainian/Georgian/Armenian.
- [ ] **1c artist-alias matching** — "Leonardo" → "Leonardo da Vinci", surname-only, typo tolerance (deaccent already ships).

## 🟢 Content / vision enrichment
- [ ] **~1,442 thin guides** remain (24%) — guides pipeline runs in ~100-work batches; keep grinding.
- [ ] **Next-vision-pass fields** — image pass done, but 5/6 banked enrichment fields never folded in: `visDiff` (2nd difficulty signal), `mediumFull`, `anonReason`, `living`, provenance/"how it got here". Only `sensitive` (63 works) landed.
- [ ] **Blank-reveal non-punitive nudge** — label swap shipped, but the "· skipped, no penalty — here's the tell" behavior on a blank guess is still absent.

## 🔵 Instrumentation & docs (mostly done — small tails)
- [ ] **Wire ~7 remaining events**: `collections_view` (measures reach to the honesty page — most useful), `pin_click`, `zoom`, `puzzle_link_copy`, `account_create`, `activation_sentiment`, `support_convert`.
- [ ] **`docs/metrics.md` is factually stale** — still says "no analytics backend connected." It IS: self-hosted Supabase `/api/event` + Vercel pageviews, 12 events wired. Update it.
- [ ] Confirm the Supabase auth **email templates** (`tasks/email-templates.md`) are actually pasted into the Supabase console.

## ⚪ Deferred / future (real work, intentionally not queued)
- [ ] **Accounts/leaderboard Phase 3** — friends boards, all-time boards, specialist badges (Phase 1/2 shipped). Phase 4 server-authoritative re-scoring (raw guesses already stored).
- [ ] **Wikidata give-back** — `scripts/wikidata-giveback.mjs` written but never run (needs your Wikidata login → QuickStatements batch).
- [ ] **Portfolio artifacts** (`docs/icp.md`, `metrics.md`, `monetization.md`, `case-study-honesty-pass.md`, `showcase.md`) are finished — refresh their coverage numbers before external use (they cite Oceania 20 / ~5,950 works).
- [ ] Small cleanups: extract MOVEMENTS → generated `data/movements.js`; dedup `DEMONYM`/`TRAIN_DEMONYM`; collapse the `computeCollections` triplication; `.card-surface`/`.blob-id` utility classes; auth-ux 🟡 #4 (device-name canonical promote) + #7 (name-reservation feedback); Tutankhamun entity swap.
- [ ] Aspirational: spin-off editions (fashion/architecture), themed dailies, two-pool Explore/Infinite. No code; pure future.

---
_Cleaned up in this pass: deleted afk-plan, teach-me-plan, regions-feature, 3 design briefs, briana-reconcile-report, daily-week-preview (shipped/obsolete) + 3 resolved backlog JSONs + 2 dead job dirs. Kept as living references: `long-term-goals.md`, `coverage-gaps.md`, `contemporary-art-research.md`, `code-review.md`, `hardcoded-data-audit.md`, `tier2-plan.md`, `next-vision-pass.md`, the pipeline runbooks, and the portfolio docs._
