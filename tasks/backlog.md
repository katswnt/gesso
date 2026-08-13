# Backlog — things to get back to

## 1. Briana design-gap audit (.md) — combo vs Briana's real design
Produce a doc listing every part of combo that DOESN'T match Briana's redesign — down to the tiny stuff
("this uses font X, Briana changed it to Y"). Especially: **every spot combo uses the accent blue where
Briana doesn't**, and where her colors differ generally. Source of truth for Briana's design: the
`briana-redesign` / `briana-pure` branches + the handoff files under `tasks/` (e.g. 21_home). Compare combo's
`styles.css` + `index.html` against those. Best done as a focused cross-branch read (a subagent).

## 2. Freeze the harvest (snapshot/lock) — prevention, not after-the-fact audits
Problem: Wikidata is a living graph; re-running a harvest won't reproduce the pool byte-for-byte. Drift is
currently only *caught* by audits, not *prevented*.
Fix: snapshot + lock. Concretely —
- On each harvest, write a committed **raw snapshot** of every fetched entity (id → the exact claims used:
  P18/label/date/place/sitelinks) to `data/incoming/harvest-snapshots/<date>.jsonl`, so a re-run diffs against
  a frozen record instead of re-querying live.
- A **lock file** (`data/harvest-lock.json`) pinning each pooled work to its source-entity + the field values
  taken from it. A re-harvest compares live-vs-lock and only surfaces *diffs* for review; it never silently
  overwrites (this is exactly the class that let da591f6 swap a wrong image + drifted metadata in).
- Wire a check into `check-pool` / `npm test`: pooled works whose fields diverge from the lock without an
  approved diff = flag. That turns drift into a gated, reviewable event.

## 3. README update
Vision-audit coverage is no longer 38%. And it doesn't cover the cool product decisions — especially **how the
dailies are created** (threshold tiers, the quintile percentile-mix graduated-difficulty rule, within-day
shuffle, anti-repeat ledger, coverage floors). Add a "How the daily is built" section + refresh the numbers.

## 4. New works from EXISTING collections — STATUS
- `wishlist-curated.json` (212) — fully drained.
- `canon-missing.json` — ~39 famous works still missing (Lady with an Ermine, Sunflowers, Guernica, Les
  Demoiselles d'Avignon). **Highest-value undrained list — a promote pass here is the next move.**
- `staged-missing.json` — ~173 still missing (long tail, lower priority).
- **Salvator Mundi** — outstanding, pending the Commons image-license check. See tasks/import-status.md.

## 5. New works from NEW collections — STATUS
Not started. The glaring coverage gaps (playable works by region): **Oceania 27, South America 75**, Africa 404,
vs Europe 3346 / Asia 1254 / N.America 725. The planned fix (Workstream D) is museum-API culture harvests:
Te Papa / Bishop Museum (Māori, Hawaiian) for Oceania; Andean (Tiwanaku/Chavín/Moche) for South America;
Quai Branly / Brooklyn for broader coverage. `scripts/harvest-museums.mjs` + `fetch-collection.mjs` exist; the
harvest → audit-copyright → promote → vision-notes flow is proven — it just hasn't been pointed at these regions.
