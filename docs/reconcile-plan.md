# Reconcile plan — Briana's redesign onto `main`

**Golden rule:** re-apply Briana's *visuals* onto `main`'s *script*. `origin/briana-redesign` = source of truth for **look** (CSS + per-page markup + assets). `main` = source of truth for **behavior**. **Never merge/rebase the branch forward** — its script is ~364 commits stale and would silently re-drop prod logic (see the 16-item regression audit below).

Work happens on the **`staging`** branch (already carries the era-aware date-scoring commit). Staging preview URL:
- https://artefactum-git-staging-kat-swints-projects.vercel.app (auto-updates on push)
- https://gesso-staging-kat.vercel.app (alias)

## Preserve-list — main logic that MUST survive intact (from the behavioral audit)
1. `workComplete()` play/safety gate (human-remains, `play:false` vision-rejected, doubly-incomplete works excluded)
2. `activeCatsFor()` (given/pinned facets not re-quizzed; FOCUS scoping)
3. Non-linear timeline (`posToYear`/`yearToPos`, position-based slider) + **era-aware date scoring** (position-space)
4. Full `score()` — `dateRange` ranges, where-scoring (`inCont`/in-range decay), notes
5. `placeCountry()` rich resolver + `continentOf()` Pacific fix-boxes
6. `dailyItems()` per-date `byDate` lock + artist dedup
7. `MINY` dynamic floor + per-work `when` opt-out
8. `simplifyMedium()` primary-material bucketing + `mediumChoices()` `dropMixed`
9. Full training subsystem: `TRAIN_SPAN`/`trainSpanFrom`, `trainGivenCats`, `trainPlaceFit`, `trainMediaFams`, `trainMovements`, geo-elim-in-training
10. Artist autocomplete ranking + autofill suppression
11. Analytics funnel events (`daily_start`, `daily_complete` at final guess, `infinite_start`→`endless`, `streak_milestone`, `mastery_up`, shares)
12. Auth/leaderboard/collections/insights features that exist only on main

## Phase 0 — Design foundation
- [ ] Fonts: Faculty Glyphic + Manrope `<link>` in `<head>`; drop Archivo/IBM Plex Mono
- [ ] `styles.css`: adopt branch's stylesheet (OKLCH tokens, type scale, spacing/radius, editorial selectors); re-add main-only selectors the branch lacks (auth/leaderboard/collections/insights UI)
- [ ] Assets: use the **compressed** set (111 MB → 11 MB) already on `mock-layout-tweaks`, not the branch originals
- [ ] SVG icon set

## Phase 1 — Page by page (each: swap markup → apply CSS → keep main's wiring → dom-harness + visual check)
- [ ] **Home** (`renderStart`) — hero, tier tiles, Endless/Training, how-to image modal
- [ ] **Round** (`renderRound`) — vertical-sidebar accession, numbered fields, image plate, hintbox, submit CTA · *fold in:* artist↔map order, remove static target-circle, add map search, blue-primary decision, non-linear timeline stays
- [ ] **Reveal** (`renderReveal`) — score rows, lookmarks · *fold in:* rebalanced study-notes / follow-ups columns
- [ ] **Final score**
- [ ] **Leaderboard** (laurel)
- [ ] **Training**
- [ ] **Collections**
- [ ] **Glossary + movement detail**
- [ ] **Account / settings / modals / nav bar**

## Verification
- `node tests/dom-harness.mjs` after every surface
- `node scripts/check-pool.mjs` as its own step (read PASS/FAIL; never chain commit after a piped gate)
- full `npm test` before any prod promotion
- visual check on the staging preview per phase; Kat approves the look before prod
- promote to prod = fast-forward `main` only after full verification
