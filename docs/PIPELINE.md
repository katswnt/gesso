# Data pipeline runbook

> **Scope:** this file documents what is implemented and runnable today. The canonical
> owner-approved product and operating decisions live in
> [`docs/vision-system.md`](vision-system.md). Read that record before changing this
> pipeline; do not infer that a planned capability already ships.

Operator's reference for the vision-audit / curation pipeline — how works get selected,
what runs on them, where the rules live, and how to drive it. (The README is the public
overview; this is the internal how-to.)

---

## The 6 stages

SECURITY (G-03): corpus images are untrusted, so the pass is **tool-less** end to end. Images are fetched by a
hardened broker (SSRF-vetted, decoded, EXIF-stripped, size-capped) into a run dir; the model call has **no tools,
no shell, no filesystem, no network** and sees only the sanitized image + text metadata (never a URL); its JSON is
**quarantined** and reaches the game only after a **human field-level review**, hash-bound to the exact run/image/
prompt/model. Never hand a corpus image to a tool-capable agent that can act — that path is retired.

```
1. BUILD    scripts/vision-next.mjs                → selects works, broker-downloads sanitized derivatives + manifest
                                                      into data/incoming/vision/runs/<runId>/  (no model, no URLs to model)
2. AUDIT    VISION_RUN_LIVE=1 scripts/vision-audit-run.mjs <runDir>   → TOOL-LESS multimodal completion per work;
                                                      writes QUARANTINED completions/  (cost-gated, never in CI)
3. REVIEW   scripts/vision-review.mjs <runDir> [--approve <decisions.json>]  → human field-level approval → approved.json
                                                      (bound to run+image+completion+prompt+model; only approved fields)
4. MERGE    scripts/curate-merge.mjs --run <runDir> → verifies every binding, rejects before write, applies ONLY
                                                      approved values, AND records that run's approved ids in the ledger
5. GATE     scripts/check-pool.mjs                  → fail-closed; must print ✅ PASS (run as its OWN step)
6. COMMIT   pool.js, teach-works.js, hotspots.js, vision-audit.json, vision-evidence.json, no-pins-reviewed.json
                                                      (+ daily-order.js if works dropped)
```
A manual tool-capable vision agent may be used for EXPLORATION only and may never feed steps 3–4.

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
| `scripts/lib/img-broker.mjs` | **hardened image fetch** (SSRF/decode/EXIF/size) — all corpus images go through it |
| `scripts/vision-next.mjs` | **which works + broker-download** into a run dir (prioritization + provenance) |
| `scripts/vision-audit-run.mjs` | **the tool-less model call** (no tools; image + text only) |
| `scripts/vision-audit-prompt.md` | **what's judged on each work** (the tool-less completion instructions) |
| `scripts/vision-review.mjs` | **human field-level approval** → `approved.json` (bound to the run) |
| `scripts/curate-merge.mjs` | **the ONLY authoritative sink** — verifies approval + applies + updates the ledger |
| `scripts/lib/vision-run.mjs` | **the contract** — run layout, strict schema, approval verifier |
| `scripts/check-img-broker.mjs` | **the G-03 gate** — enforces the whole boundary offline |
| `data/vision-audit.json` | **the ledger** — done-list; written ONLY by an approved curate-merge run |
| `scripts/check-pool.mjs` | **the data gate** — fail-closed quality guard |
| `data/incoming/vision/priority.json` | **manual line-jumpers** (specific ids first) |

**Only approved fields apply** (`curate-merge.mjs --run`): the human's `approved.json` says, per id, exactly which
fields/notes/pins to apply. Everything is hash-bound; anything unreviewed/unbound is rejected before any write. The
old "safe auto-apply vs. risky queue" split is gone — nothing auto-applies without human approval.

---

## Running a batch

```bash
# 1. BUILD — select works + broker-download sanitized derivatives into a run dir (prints the runId + path)
node scripts/vision-next.mjs 100 easy         # modes: "easy" (most-seen) | "schedule" (soonest-scheduled)
RUN=data/incoming/vision/runs/<runId>

# 2. AUDIT — TOOL-LESS model completions (cost-gated; approve the spend). Writes quarantined completions/.
VISION_RUN_LIVE=1 node scripts/vision-audit-run.mjs "$RUN"

# 3. REVIEW — inspect, then author decisions.json (per id, the fields to apply) and approve:
node scripts/vision-review.mjs "$RUN"                          # writes review-draft.json to inspect
node scripts/vision-review.mjs "$RUN" --approve decisions.json  # writes + self-verifies approved.json

# 4. MERGE — verifies every binding, applies ONLY approved values, records approved ids in the ledger
node scripts/curate-merge.mjs --run "$RUN"

# 5. GATE — as its OWN step; read the PASS/FAIL line, never chain a commit after a piped gate
node tests/dom-harness.mjs
node scripts/check-pool.mjs
#   if a work was flagged play:false, drop it from future dailies FIRST:
#   node scripts/drop-from-dailies.mjs --unplayable   (or <id ...>)

# 6. COMMIT only on ✅ PASS
git add data/pool.js data/teach-works.js data/hotspots.js data/vision-audit.json data/vision-evidence.json data/no-pins-reviewed.json data/daily-order.js
#   data/vision-evidence.json is the DURABLE audit trail (a terminal ledger entry is only "audited" if its evidence
#   is committed here); data/no-pins-reviewed.json is the tracked no-pins exemption set. Stage BOTH or a clean
#   checkout loses the provenance and re-audits everything.
git commit && git push
```

### Directing the assistant (plain language)
- **"Run another 100"** → default easy/most-seen burn-down.
- **"Run 100 on works no one's ever image-checked"** → target the blind-legacy set (works with
  notes/pins but NOT in the ledger).
- **Image-blocked works re-audit automatically** — a work the merge marked `needs-image` (wrong / poor /
  cropped / detail / lost) is persisted as blocked in the **tracked** ledger (`data/vision-audit.json`
  `entries[]`) and `vision-next` picks it FIRST once its image is fixed. No manual requeue.
- **"Re-audit these: `<ids>`"** → an explicit operator override: drop them in
  `data/incoming/vision/priority.json` (ephemeral/local; can force a re-audit even of an already-audited work).
- **"Re-pin the already-audited works"** → a pass upgrade: bump `SCHEMA_VERSION` (entries stamped with an older
  pass become re-auditable), or remove those ids from `entries`/`ids`, then run.

---

## One engine (G-03)

There is now exactly **one** authoritative path: the **tool-less multimodal completion** in
`scripts/vision-audit-run.mjs` — no `tools`, no agent wrapper, no shell/fs/net; the model sees only the
broker-sanitized derivative + text metadata (never a URL). The old tool-capable engines are **retired**: the
Sonnet Task-agent-per-batch flow and the `curate-codex.mjs` autonomous loop both handed corpus images to a
tool-capable agent and fed an authoritative merge — the exact P0 G-03 closed. A tool-capable agent (Codex or a
subagent) may **explore** an image but may **never** feed `curate-merge`. Output reaches the corpus only through
human field-level review (`scripts/vision-review.mjs`) + the hash-bound merge (`curate-merge.mjs --run`).

---

## Measured, not assumed

- **Wrong-art detection:** `docs/auditor-eval.md` — 100% precision/recall on planted mismatches
  (`scripts/eval-auditor.mjs` → blind agents → `scripts/eval-score.mjs`).
- **Pin placement:** spot-checked at ~83% on-target / 15% within a few % / 2% off on the audited
  set (v1, pre-feature-anchoring). New pins should land tighter.
