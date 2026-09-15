# Data pipeline runbook

> **Scope:** this file documents what is implemented and runnable today. The canonical
> owner-approved product and operating decisions live in
> [`docs/vision-system.md`](vision-system.md). Read that record before changing this
> pipeline; do not infer that a planned capability already ships.

Operator's reference for the vision-audit / curation pipeline — how works get selected,
what runs on them, where the rules live, and how to drive it. (The README is the public
overview; this is the internal how-to.)

---

## Authoritative narrow G-03 path (six stages)

This section documents the older narrow notes/pins + image-QA path whose reviewed merge is
the only authoritative writer today. It is distinct from the richer Pass B calibration
controller documented below; calibration output is quarantined and cannot use this sink.

SECURITY (G-03): in this narrow path, corpus images are untrusted, so the model call is **tool-less**. Images are fetched by a
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

## One authoritative merge path (G-03)

There is exactly **one authoritative path** into current game data: the **tool-less multimodal completion** in
`scripts/vision-audit-run.mjs` — no `tools`, no agent wrapper, no shell/fs/net; the model sees only the
broker-sanitized derivative + text metadata (never a URL). The old tool-capable engines are **retired**: the
Sonnet Task-agent-per-batch flow and the `curate-codex.mjs` autonomous loop both handed corpus images to a
tool-capable agent and fed an authoritative merge — the exact P0 G-03 closed. A tool-capable agent (Codex or a
subagent) may **explore** an image but may **never** feed `curate-merge`. The richer Pass B calibration uses a
proportionate confined Read-tool image process, but its output has no route to this merge. Narrow-path output reaches the corpus only through
human field-level review (`scripts/vision-review.mjs`) + the hash-bound merge (`curate-merge.mjs --run`).

---

## Measured, not assumed

- **Wrong-art detection:** `docs/auditor-eval.md` — 100% precision/recall on planted mismatches
  (`scripts/eval-auditor.mjs` → blind agents → `scripts/eval-score.mjs`).
- **Pin placement:** spot-checked at ~83% on-target / 15% within a few % / 2% off on the audited
  set (v1, pre-feature-anchoring). New pins should land tighter.

---

## Rich Pass B calibration (VSD-001/005/006/007/011/019/021)

The rich calibration controller is implemented in current feature-branch calibration code
and has been exercised live. It is **not shipped production infrastructure** and
has no authoritative writer. Its current sequence is:

1. B0 broker-fetches, decodes, strips, hashes, and snapshots legacy content.
2. B1 sees only the confined SHA-named image through the Read tool and inventories visible evidence.
3. Conditional B2 sees no image, receives bounded signals/catalog/legacy content, and uses only WebSearch/WebFetch.
4. Conditional B3 sees only the confined image plus B2's targeted visual questions.
5. B4 receives validated B1–B3 projections plus legacy content and emits a compact editorial **delta** without image or tools. The controller hydrates the authoritative B1/B2 registries and runs strict `validateB4`. Editorial ancestry (`ref`) is separate from hotspot location (`pinRef`): a publishable pin comes from a matching B1 candidate or a localized bbox, never a missing/near-whole-image fallback. Same-evidence and <3-point overlaps are retained as review findings but not published (VSD-022/027).
6. The offline VSD-029 spatial pass separates observation retention from its presentation.
   It preserves a previous coordinate only when the image SHA is unchanged, compares it
   with B1, routes duplicates to merges and broad/distributed observations to unpinned
   notes, and sends only uncertain point placement to a bounded localization-only canary.
   Under VSD-030 the canary validates every candidate rather than choosing a favorite free
   point. The resolver preserves a valid current point as a no-churn tie-breaker, otherwise
   another valid prior point; uncertainty holds, and a new suggestion is usable only after
   every candidate is invalid. The model receives only the image, short target title, and
   candidate points—never B1 explanatory prose, research/player copy, or owner answers.

The controller strictly validates and hash-binds stage completions, verifies image Read and web-tool
events from raw `stream-json` transcripts, resumes verified checkpoints, supports five independent
lanes, and renders a quarantined before/after review packet. The fixed calibration completed B1–B3 for
50 works; the accepted B4-v2 continuation produced 44 strict-valid/leak-clean records and quarantined
6 first-attempt misses. No output has been approved or merged into game data.

The full-cohort packet is interactive but still non-authoritative (VSD-028/029). Each P/S hotspot label is
defined beside the image and includes the same-image previous coordinate when available. The reviewer can
record a work decision, write notes, keep or move a pin, retain the observation only as an unpinned note,
discard the underlying idea explicitly, abstain, or click the image to place it.
Browser-local state auto-saves and can be downloaded/copied as a JSON handoff bound to the run and evidence-manifest hash. Ordinary works start collapsed; placement/legacy
blockers and quarantines start open. In an open work the image stays sticky at left while the review and
before/after copy scroll at right. That export is review input, not `approved.json`, and has no path to
production until it is deliberately converted into a separately verified approval. That conversion must
deduplicate keep-as-note choices against the record's existing notes; the packet itself changes no content.
Unanswered controls export as abstentions. Version-1 `drop` choices may be interpreted as unpinning only,
because that UI did not distinguish a bad location from a bad observation.

The offline `contentVisionCoverage/1` baseline remains the corpus inventory: one row for each
current pool work, legacy content kept as evidence (never current completion), Pass A flags
reported separately, and scheduling priorities computed without imposing a universal daily
hard gate.

```bash
# Read-only snapshot for today (America/Los_Angeles) or a reproducible date:
node scripts/vision-inventory.mjs
node scripts/vision-inventory.mjs --as-of 2026-09-02

# Refresh the tracked matrix deliberately after reviewing stdout:
node scripts/vision-inventory.mjs --as-of 2026-09-02 --write

# Offline contract gates:
node tests/vision-legacy.test.mjs      # every one of the 202 rich records reconstructs
node tests/vision-inventory.test.mjs   # completion separation, queues, collisions, states
node scripts/check-vision-inventory.mjs # tracked matrix must exactly regenerate
```

The generator reads only tracked pool/teaching/hotspot/vision/ledger/evidence/daily and
Pass-A artifacts. It performs no fetch and no model call. `data/vision.js` remains intact;
`scripts/lib/vision-legacy.mjs` retains exact raw copies (record- and item-level) and proves
every record round-trips losslessly through its normalized envelope. This is a lossless
round-trip, not a full shape-aware migration: `palette`/`figures` are rebuilt from decomposed
parts, while `evidence`/`pins`/`delights` and the remaining fields still lean on the retained
raw copies. Historical alias collisions and orphan rows are emitted under diagnostics and are
never silently resolved.

B4's proposed player-facing study guide is written to the authoritative editorial reference
[`docs/vision-study-guide-style.md`](vision-study-guide-style.md) (VSD-020): it shapes question
selection and answer voice only; every fact still comes from that work's own validated legacy
content and its B1–B3 evidence/research. Changing that standard is a B4-prompt-only change (the
B4 prompt hash changes; B0–B3 stay reusable, but a B4-prompt change currently forks the run id, so
reuse requires migrating B0–B3 checkpoints into the new run dir).

Current limitations:

- `data/vision-coverage.json` is a measurement/queue artifact, not an authoritative rich-content ledger.
- The compact editorial-delta B4 + deterministic hydration ran across the fixed 50-work calibration.
  The immutable-source VSD-027 offline rehydration produced `b4r-8f1f74ddc30f`: 44/44 strict-valid,
  hotspot overlap pairs 45→0, 15 duplicate/unlocalized proposals retained for attention, and literal
  legacy-lineage reporting. The prior full-record B4 is retired.
- The VSD-029 offline spatial report has been implemented against the owner export without changing it:
  210 observations route to 73 deterministic pins, 122 localization exceptions, 11 notes, and 4 merges.
  Across all 143 kept/moved observations with comparable same-image legacy coordinates, the owner's selected
  point was closer to the current point 116 times, closer to legacy 23 times, and tied 4 times. The legacy
  wins all occurred among the 79 moved observations (23 legacy, 52 current, 4 ties), confirming that legacy
  is useful evidence but not a universal winner. The initial favorite-point canary
  `b5c-bb6247e13e73` completed 10/10 but showed that raw point distance mis-scores repeated
  features and that free localization can move already-valid candidates. VSD-030 replaced that
  contract with independent candidate assessment and scope-aware scoring. The accepted blind
  canary `b5c-f2020a1d8cca` completed 10/10 strict-valid with no retries (44 targets, 77 candidate
  assessments): 23 existing candidates selected, 4 new suggestions, 12 note routes, 5 holds.
  Its 17 comparable unique-point labels were 9/17 within 5 and 12/17 within 10 (median 2.89,
  interpolated p90 21.84). This is diagnostic; no auto-policy threshold is yet approved.
- B2-v2 (targeted teaching research, source budget, qualified verdicts, ≤2 B3 requests with the dropped
  count surfaced, and a corroborating-source rule for high-confidence refutations — non-Wikipedia/non-UGC,
  host-parsed; a positive museum/scholarly allowlist is a pending owner decision) is implemented and passing
  offline. The B2 web gate counts only genuinely-retrieved pages (a 4xx/redirect envelope is not a
  retrieval). A live 5-work v1-vs-v2 comparison ran 2026-09-03 (5/5 strict-valid; research volume collapsed;
  over-refutations corrected) and passed Codex adversarial review with corrections applied. Strict-valid
  means shape + reference integrity, not factual entailment — human review is the factual gate (VSD-022).
- A one-work, hash-bound guarded Pass B approval/apply tool exists, but no calibration record is owner-
  approved. The rich component ledger, auto-policy, and production staleness transition remain unbuilt.
- The deterministic `launchd` subscription supervisor remains unbuilt; `--foreground` is supervised
  manual operation only.

### Calibration commands

Use Node 24 (`/opt/homebrew/bin/node`); the machine's default Node may be too old.

```bash
# Offline synthetic capture/render only; no model call.
/opt/homebrew/bin/node scripts/pass-b-calibration.mjs --fixture

# Dry preparation/packet refresh. B0 may fetch missing images through the hardened broker;
# it makes no model call and never writes authoritative data.
/opt/homebrew/bin/node scripts/pass-b-calibration.mjs

# Supervised subscription collection through B3, five independent lanes; B4 intentionally skipped.
# Resume reuses every verified checkpoint.
PASS_B_CALIB_LIVE=1 /opt/homebrew/bin/node scripts/pass-b-calibration.mjs \
  --live --foreground --lanes 5 --through-b3

# One-work full-chain calibration/canary. B4 uses compact delta + deterministic hydration (VSD-022/027).
PASS_B_CALIB_LIVE=1 /opt/homebrew/bin/node scripts/pass-b-calibration.mjs \
  --live --foreground --only-work <work-id>

# Offline-only VSD-027 rehydration of the preserved B4-v2 cohort, then render its corrected packet.
# Creates a new quarantined run; verifies every source evidence byte stayed unchanged.
/opt/homebrew/bin/node scripts/pass-b-b4-offline-repair.mjs
/opt/homebrew/bin/node scripts/pass-b-b4-review-packet.mjs \
  data/incoming/vision-calibration/b4r-8f1f74ddc30f

# Plan the bounded VSD-030 candidate-validation canary (no model call).
/opt/homebrew/bin/node scripts/pass-b-spatial-localization-canary.mjs \
  --review /path/to/pass-b-editorial-review-b4r-8f1f74ddc30f.json

# Explicit subscription-backed run. The review file is opened only after every blind image call.
PASS_B_SPATIAL_LIVE=1 /opt/homebrew/bin/node scripts/pass-b-spatial-localization-canary.mjs \
  --run --review /path/to/pass-b-editorial-review-b4r-8f1f74ddc30f.json
```

Artifacts remain under `data/incoming/vision-calibration/` (gitignored). A prompt/schema/transport
change creates a new run identity. Reusing prior stage work requires explicit migration followed by
normal checkpoint verification; never copy an unverified completion or overwrite an old run.

Relevant files:

| File | Controls |
|---|---|
| `scripts/pass-b-calibration.mjs` | B0 preparation, subscription process execution, lanes, checkpoint resume, packet write |
| `scripts/lib/pass-b-calibration.mjs` | call plan, boundaries, command construction, compact inputs, B1→B4 control flow |
| `scripts/lib/pass-b-prompts.mjs` | version-bound B1–B4 prompts |
| `scripts/lib/pass-b-wire-schema.mjs` | provider-facing structure-only schemas |
| `scripts/lib/pass-b-b4-delta.mjs` | compact-delta validation, deterministic hydration, hotspot quality, lineage |
| `scripts/lib/vision-content-schema.mjs` | strict local B1–B4 semantic and cross-reference validation |
| `scripts/lib/vision-content-capture.mjs` | hash-bound stage capture and resume verification |
| `scripts/lib/pass-b-review-packet.mjs` | quarantined comparison packet; applies nothing |
| `scripts/pass-b-b4-offline-repair.mjs` | immutable-source offline rehydration + evidence manifest/report |
| `scripts/lib/pass-b-editorial-review.mjs` | pure hotspot-review descriptions and stable P/S review rows |
| `scripts/pass-b-b4-review-packet.mjs` | interactive full-cohort packet: literal lineage, explained pins, work notes/decisions, click-to-place, JSON export |
| `scripts/lib/pass-b-spatial-policy.mjs` | pure VSD-029 candidate comparison, note/merge routing, abstention semantics, localizer contract, and scoring |
| `scripts/pass-b-spatial-calibration.mjs` | offline owner-review measurement and immutable spatial-input/report writer; no model calls |
| `scripts/pass-b-spatial-localization-canary.mjs` | plan-by-default B5 image-only spatial canary; reads owner answers only after all calls complete for blind scoring |
| `tests/pass-b-calibration.test.mjs` | controller, boundary, resume, packet, and failure regressions |

---

## Recognition-inference pilot (Pass A, VSD-016/018) — completed 2026-09-01

Separate, append-only research pipeline; **git-freeze-only, not a registration** (VSD-018). It never
writes game data (pool/teach/hotspots/vision/daily/tiers). The pilot froze at `5ea28c8`, its
collection was sealed at `9bcd580`, and corrected Study B closed at `6a555af`. Results are in
`docs/research/recognition-pilot-results-note.md`. The commands below document reproduction;
they do not authorize another paid run or a main study.

Safe offline commands (no fetch/model/collection):

```bash
node scripts/recognition-pilot-prepare.mjs          # deterministic 36-work DRAFT (refuses to overwrite curation)
node scripts/recognition-pilot-seal-curation.mjs --seal   # after curator edits: recompute masks/shams/calls/hashes + regenerate the worksheet
node scripts/check-recognition-pilot.mjs            # offline structural gate (must PASS; lists protocol-freeze blockers)
node tests/recognition-pilot.test.mjs              # pure-contract unit tests (grading, validators, analysis, adjudication)
```

Freeze / run (still fail-closed here):

```bash
node scripts/recognition-pilot-freeze.mjs --finalize   # builds *.frozen.json only after image/multilingual evidence + all curator checks + no unresolved blocking issues
node scripts/recognition-pilot-run.mjs                 # DRY unless --live and RECOGNITION_PILOT_LIVE=1; derives+verifies the freeze commit before any paid call; enforces the 24h window before every attempt; model drift is fatal
node scripts/recognition-pilot-seal-collection.mjs     # after the run: verifies every call from raw bytes (refuses on tamper/window/drift/non-terminal/unmeasurable-usage), writes collection-evidence.<sha>.json — then COMMIT it alone with subject "PILOT COLLECTION SEALED: <id>" (a dedicated commit that descends from the freeze)
node scripts/analyze-recognition-pilot.mjs             # FINAL diagnostics; refuses until the run is complete, collection evidence is sealed+committed (descended from the freeze), no model drift, cost fully measured, and adjudications resolved (else --interim writes diagnostics-interim.<sha>.json)
```

Where the rules live: `scripts/lib/recognition-pilot.mjs` (grading, exact-recognition unit, cue mask,
validators, style dedup, pure `analyzePilot`), `scripts/lib/recognition-pilot-runtime.mjs`
(checkpoint/freeze-verify), `docs/research/recognition-pilot/` (manifest/calls/taxonomy/protocol/
prompts/schemas/deviations). The frozen collection and corrected Study-B mini-pilot are closed;
do not append new responses to either.
