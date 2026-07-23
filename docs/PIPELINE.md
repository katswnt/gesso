# Data pipeline runbook

Operator's reference for the vision-audit / curation pipeline — how works get selected,
what runs on them, where the rules live, and how to drive it. (The README is the public
overview; this is the internal how-to.)

---

## The 6 stages

```
1. SELECT   scripts/vision-next.mjs      → picks works by priority, writes vw-in-*.json chunks + manifest
2. AUDIT    Sonnet agents (one/chunk)    → each VIEWS the images, writes vw-out-*.json     ← the image pass
3. MERGE    scripts/curate-merge.mjs     → applies SAFE fields, queues RISKY, replaces pins
4. MARK     scripts/vision-mark.mjs      → records done ids in data/vision-audit.json (the ledger)
5. GATE     scripts/check-pool.mjs       → fail-closed; must print ✅ PASS (run as its OWN step)
6. COMMIT   pool.js, teach-works.js, hotspots.js, vision-audit.json (+ daily-order.js if works dropped)
```

Every stage is resumable: the ledger (`data/vision-audit.json`) is the done-list, so re-runs
advance instead of repeating.

---

## How works are prioritized (`vision-next.mjs`)

In order — the guiding principle is **verify what players see, soonest-first**:

1. **`data/incoming/vision/priority.json`** — manually-queued ids jump the line (e.g. a work
   whose image was just fixed and needs a re-audit).
2. **Easy tier, rotation order** (`easy` mode) — the most-seen works (icons beginners hit
   ~monthly) are verified to completion first.
3. **Soonest-scheduled** — then fill by upcoming daily *date*, across tiers, so next week's
   works get done next.
4. **Skip anything already in the ledger.**

A work that's neither in the easy tier nor on an upcoming daily simply waits — correct, since
no one is seeing it yet.

---

## What runs on each work (`scripts/vision-audit-prompt.md`)

One image view, seven judgments (this file is the source of truth — copy it into each agent):

| Field | What it decides |
|---|---|
| `image.ok` | Is this even the right artwork? (wrong-art detection) |
| `playable` | Any visual signal to reason from? `false` → excluded from scheduling |
| `imageQuality` | good/poor → poor queues a better image |
| `framing` | ok/cropped/detail/lost → non-ok queues a better image |
| `mediumLegible` | can the medium be judged? `false` → drops the medium category |
| `notes` + **feature-anchored pins** | 5–7 look-closer notes; each pin measured ONTO its feature, **replacing** legacy blind pins |
| `fields` | style/styleKind/medium corrections when the image makes it clear |

**Feature-anchored pins (aka "markers v2") are part of THIS pass — not a separate one.** The
burn-down therefore does three jobs at once: verify the image, re-ground legacy notes that were
written without ever seeing the image, and place pins precisely.

---

## Where the rules live

| File | Controls |
|---|---|
| `scripts/vision-next.mjs` | **which works, in what order** (prioritization) |
| `scripts/vision-audit-prompt.md` | **what's judged on each work** (the combined audit spec) |
| `scripts/curate-merge.mjs` | **safe-vs-risky merge** (auto-apply vs. queue for review) |
| `data/vision-audit.json` | **the ledger** — done-list that drives "skip already audited" |
| `scripts/check-pool.mjs` | **the gate** — fail-closed quality guard |
| `data/incoming/vision/priority.json` | **manual line-jumpers** (specific ids first) |

**Safe vs. risky** (`curate-merge.mjs`): style / styleKind / medium / notes / pins auto-apply;
image / title / place / region / lat-lng / date are QUEUED to `review-queue.json` (never
auto-applied — a wrong "correction" to the spine is worse than the original).

---

## Running a batch

```bash
# 1. SELECT — count, chunkSize, mode  (25/chunk → 4 parallel agents)
node scripts/vision-next.mjs 100 25 easy      # easy/most-seen first
#   modes: "easy" (most-seen) | "schedule" (soonest-scheduled)

# 2. AUDIT — spawn one Sonnet agent per vw-in-N.json chunk, each following
#    scripts/vision-audit-prompt.md, writing vw-out-N.json  (done by the assistant)

# 3. MERGE
node scripts/curate-merge.mjs data/incoming/vision/vw-out-*.json

# 4. MARK
node scripts/vision-mark.mjs data/incoming/vision/vw-out-*.json

# 5. GATE — as its OWN step; read the PASS/FAIL line, never chain a commit after a piped gate
node tests/dom-harness.mjs
node scripts/check-pool.mjs
#   if a work was flagged play:false, drop it from future dailies FIRST:
#   node scripts/drop-from-dailies.mjs --unplayable   (or <id ...>)

# 6. COMMIT only on ✅ PASS
git add data/pool.js data/teach-works.js data/hotspots.js data/vision-audit.json data/daily-order.js
git commit && git push
```

### Directing the assistant (plain language)
- **"Run another 100"** → default easy/most-seen burn-down.
- **"Run 100 on works no one's ever image-checked"** → target the blind-legacy set (works with
  notes/pins but NOT in the ledger).
- **"Re-audit these: `<ids>`"** → dropped into `priority.json`, then run.
- **"Re-pin the already-audited works"** → the v1→v2 upgrade: remove those ids from the ledger
  (`data/vision-audit.json`) so the feature-anchored pass redoes them, then run.

---

## Two engines

- **Sonnet, on-demand** (what we use) — the assistant spawns Task agents per batch. Higher
  quality; run interactively.
- **Codex, autonomous loop** — a scheduled background loop (`scripts/curate-codex.mjs`) that
  reads the SAME `vision-audit-prompt.md` and runs `vision-next.mjs … codex`. Lower-touch, for
  overnight burn-down. Never commits unless the gate passes.

---

## Measured, not assumed

- **Wrong-art detection:** `docs/auditor-eval.md` — 100% precision/recall on planted mismatches
  (`scripts/eval-auditor.mjs` → blind agents → `scripts/eval-score.mjs`).
- **Pin placement:** spot-checked at ~83% on-target / 15% within a few % / 2% off on the audited
  set (v1, pre-feature-anchoring). New pins should land tighter.
