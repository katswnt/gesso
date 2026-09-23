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
   It preserves a previous coordinate only when a separate historical-image receipt proves
   that the image SHA is unchanged, compares it
   with B1, routes duplicates to merges and broad/distributed observations to unpinned
   notes, and sends only uncertain point placement to a bounded localization-only canary.
   Under VSD-030 the canary validates every candidate rather than choosing a favorite free
   point. The resolver preserves a valid current point as a no-churn tie-breaker, otherwise
   another valid prior point; uncertainty holds, and a first-pass new suggestion is possible
   only after every candidate is invalid. Under VSD-031 that new point remains held until a
   separate fresh-context checker—shown no earlier coordinate or reasoning—provides compatible
   high-confidence spatial evidence. Under VSD-032 matching unique points must land within 5
   points; distant representative examples and a confirmation-classified distributed/global
   target become unpinned notes, while a distant unique point holds. The first model receives only the
   image, short target title, and candidate points; the confirmer receives only the image and
   short target title. Neither receives B1 explanatory prose, research/player copy, or owner
   answers. Missing historical-image provenance fails closed: the current B0 image SHA is
   never substituted for the legacy SHA. An old point may remain visible to the owner as an
   unverified reference, but selecting it creates an owner-authored point on the current
   image. Spatial resolution never implies factual/content approval.

The controller strictly validates and hash-binds stage completions, verifies image Read and web-tool
events from raw `stream-json` transcripts, resumes verified checkpoints, supports five independent
lanes, and renders a quarantined before/after review packet. The fixed calibration completed B1–B3 for
50 works; the accepted B4-v2 continuation produced 44 strict-valid/leak-clean records and quarantined
6 first-attempt misses. No output has been approved or merged into game data.

The full-cohort packet is interactive but still non-authoritative (VSD-028/029/033). Each P/S hotspot label is
defined beside the image and may show a previous coordinate as a historical reference; only a separate
matching historical-image receipt makes that point an automatic same-image candidate. The reviewer can
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
- The VSD-029 offline spatial report was implemented against the owner export without changing it:
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
  interpolated p90 21.84). VSD-031 re-resolves its 4 new suggestions as confirmation-required,
  so the same output initially yielded 23 validated existing pins, 12 notes, and 9 holds. The separate
  confirmation canary `b5k-9e3a46a675ae` completed 4/4 strict-valid with no retries and
  confirmed 0 new pins. VSD-032's offline resolver `b5r-3a5ea5ed593f` re-verifies both runs and
  distinguishes a bad coordinate from a useful nonlocal observation: the La Gloire compound
  base/top and Drowned Land's divergent representative trunks become notes. Final historical
  canary routes were 23 pins, 14 notes, and 7 holds across 6 works; only those 7 appeared in
  the owner packet. A 2026-09-15 forensic audit found that all five callers had supplied the
  current B0 image SHA as the legacy SHA, making the nominal same-image test tautological.
  VSD-033 / `passBSpatialCalibration/7` now accepts only a separate historical-image receipt
  and rejects older primary runs as stale. The prior owner-vs-legacy statistics and B5
  resolutions are therefore preserved diagnostic history, not valid current-policy
  measurements. No replacement canary has run. Packet v3 labels work decisions as spatial
  only and records any selected point as owner-selected on the current image. No corpus-scale
  auto-policy threshold is approved.
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

### Content-correctness reconciliation + entity canary (VSD-034/035, offline)

Two content failures found by the forensic audit are sealed as immutable, ancestry-bound
`content-blocked` findings in the tracked `data/vision-content-blocked.json` (bound to
`{workId, rawDeltaSha256, rawResponseSha256}` so the source completion and every rehydrated
descendant match — the delta hash is byte-stable across rehydration). The guarded Pass B
approval path (`scripts/lib/pass-b-approval.mjs`) loads these findings from a **mandatory,
cwd-independent, fail-closed** path. Exact blocked content is never clearable. A genuinely
fresh completion of the same work can proceed only when its bound reconciliation decision
artifact resolves every named blocked claim; a new record hash alone does nothing.

The experimental entity-emission contract (`contentVisionEntityGraph/1`, quarantined — no
production sink, not in `passBValidation`) plus its evaluator and the `possibleAlias` /
`unboundEntityClaim` controller (`passBEntityController/2`) are the substrate for measuring
whether models can emit region-bound typed entities and whether the controller's routing
holds. Seeded, sealed canary fixtures live in `data/vision-entity-canary-fixtures.json`;
their GOLD scenes contain only real entities (zero gold aliases — aliases are model errors,
detected synthetically), the holdout is authoritative-source-seeded/precision-only pending
owner pixel-labeling, and real-image labels are non-exhaustive.

```bash
node scripts/pass-b-content-blocked-findings.mjs        # regenerate the sealed findings (refuses to change a seal)
node scripts/pass-b-content-blocked-findings.mjs --check # gate: verify the sealed findings artifact
node scripts/pass-b-entity-canary-fixtures.mjs --check   # gate: verify the sealed canary fixtures
```

The bounded schema-emission smoke ran as `b6c-aafea89438d0`: 6/6 subscription calls,
`apiKeySource:none`, exact confined-directory image receipts, and 6/6 schema-valid emissions.
Its report remains `kind:"schema-emission-smoke"` and `measurementReadiness:"blocked"`.
Seeded-label region/entity/type scores are diagnostic only; real-scene alias precision/recall
and correctness remain unmeasured pending frozen owner-labeled pixel ground truth.

VSD-035 adds the actual deterministic reconciliation layer:

- `passBClaimBundle/1` preserves and binds B1/B3 observations, B2 claims, B4 correction
  proposals, B4 conflicts/uncertainty, optional source spans/entity graph, and stable hashes of
  every projected `why`/cue/note/hotspot/guide component.
- `passBClaimDecisions/2` separates ordered owner/source/controller decisions from model
  proposals. Lower authority cannot supersede a higher-authority decision. The controller cannot
  accept semantic truth; source authority needs a stored span record and cannot directly approve
  player copy. Retrieval-byte/excerpt entailment verification is not yet implemented.
- Grounding authority is separate too: a synthesis-model `claimRef` is `model-proposal`, not an
  effective link. The schema reserves claim-based eligibility for a future owner/controller grounding
  artifact, but VSD-036 forbids post-hoc grounding edits in the source-derived bundle; that mechanism
  is not built. Today an exact owner component decision is the only release path.
- `passBReconciliationReport/1` computes claim/component readiness. Missing, stale, or tampered
  bundle/decisions/report artifacts fail closed. Model-self-resolved conflicts remain blocked;
  free-text uncertainty cannot silently coexist with eligible unreviewed copy.
- Reconciliation history is versioned: each content-addressed, write-once-by-tool set lives under
  `reconciliation/.../sets/<reportSha>/`; `active.json` selects one set, and every activation is
  also preserved and verified under `activations/`. Changing the active set invalidates any older
  approval. This is tamper-evident inside the trusted local-filesystem boundary, not a signature
  scheme for a hostile local writer.
- The loader supports standard completion runs and the real repaired ancestry
  `b4r-8f1f74ddc30f → b4c-f45fac18da2e → cal50-0a47b6f7f332`, verifying the derivative record,
  evidence-manifest membership of source/upstream manifests and B0–B3/source-B4 bytes, the
  manifest-bound source-B4 delta and transcript hash, recorded current-image SHA, and exact
  projected production content. This layer does not freshly hash the current image bytes.
- **Corpus B0–B3 collector** (`scripts/pass-b-corpus-collect.mjs`, `passBCorpusCollector/4`,
  VSD-041/042/045): subscription-only collection stays quarantined. Default invocation is now a
  genuinely read-only plan: no ledger write, migration, lease, run-directory creation, fetch, or call.
  It reopens B0/image plus each completion/raw/transcript and recomputes verified totals and terminal
  holds. A missing hold reason never requeues a genuine validation failure. Preserved fatal history,
  a durable `fatal.json`, or a fatal ledger stop prevents further calls; a caught stage exception cannot
  erase that stop. Operational exceptions pause without creating a fatal finding. Incomplete fresh
  attempt reservations stop resume as unknown outcomes for review. No blind named requeue remains.
  `--repair-history` is offline maintenance: acquire the exclusive run lease, copy only missing raw
  bytes from identical verified prior completion evidence, and update the local operational ledger.
  The 2026-09-22 repair restored 75 raw files in 25 migrated works and re-held ten genuine failures;
  416 completions verify (153 B1 / 134 B2 / 129 B3), 129 done, 23 held, 500 preserved attempts.
  The evidence run remains `corpus-b3-6401bc543ead` under its unchanged `/2` B1–B3 input/acceptance
  contract; historical producer labels are retained. Before new calls, append-only numbered files in
  `execution-policies/` bind `/4`, exact installed CLI version, model, prompt hashes, validation and
  scheduling rules. Each epoch binds its predecessor; each reservation binds its own epoch and policy
  hashes. An old `/3` `execution-policy.json`, if present, remains unchanged as epoch zero. The child
  environment enforces `DISABLE_AUTOUPDATER=1`, including local version inspection. Runtime drift
  pauses before capture; only an explicit offline `--rebind-runtime <review.json>` appends a reviewed
  successor. It never accepts a drifted body retrospectively or authorizes calls. Fresh captured
  producer evidence uses the exact bound CLI version. Each fresh attempt is exclusively reserved
  before invocation and preserves transcript + metadata.
  Current scope is Pacific today through the following 29 dates, earliest date first, with diversity
  rotation only within a date; no fall-through to Easy or the rest of the corpus. Every stage and retry
  rechecks the 00:00–08:30 start window; clients have a 30-minute maximum and a 09:00 cutoff.
  Missing/incomplete evidence and hang timeouts never trigger automatic conformance repair. A recorded
  SIGKILL at/after 09:00 is a nonterminal deadline pause; proven provenance failures still take precedence.
  Usage limits stop, and transport gets at most one retry with the same time gate. A single rejected B2
  body followed by a usage rejection retains its one pending validation retry; the controller checks
  preserved rejected-body counts before each B2 invocation, preventing a third conformance attempt. The four-lane collector and stage leases retain exclusive ownership; dead-PID leases
  may be recovered, while live/malformed ownership fails closed. New-input or corrupt evidence is
  preserved for review rather than automatically overwritten. No B4, approval, rescheduling or sink.
- **Structured B4 fork** (VSD-039, offline implementation): B1–B3 checkpoints stay under the shared
  `passBValidation/4` contract. A later B4-only call is independently bound to
  `passBValidationB4/1-structured-grounding`, the B4 prompt hash, and the exact B1/B2/B3 completion
  hashes. Its wire schema is `contentVisionB4Delta/3`: ordinary editorial delta fields plus
  `grounding.components`, one grounding row for every conflict, and structured open claims. The model
  may name only supplied B2 claim ids and B1/B3 observation ids; it cannot emit authority, effective
  state, approval, or eligibility. **Wording correction (2026-09-22):** the wire does retain
  `conflicts[].resolution` and `conflicts[].status` as model proposals; they never establish
  effective/controller resolution. Hydration validates all refs and translates temporary
  targets (`why`, `cue:i`, `note:i`, `hotspot:i`, `guide:i`) into stable final component ids in a
  `passBStructuredGrounding/1` sidecar. If a target disappears during hydration (notably a suppressed
  hotspot), its conflict/open claim becomes work-scope. Reconciliation then uses
  `passBReconciliationPolicy/2-structured-b4`; explicit model bindings remain
  `groundingAuthority:"model-proposal"` and therefore review-required. Archived `/2` deltas continue
  to rehydrate under policy `/1`, and the standing 44-set baseline is unchanged. No live `/3` call,
  corpus B4 continuation, release-policy integration, approval, or production write has run yet.
- **Structured B4 canary** (VSD-040, plan/test only): `scripts/pass-b-b4-structured-canary.mjs`
  freezes ten risk-weighted works from `cal50-0a47b6f7f332` and reopens the exact preserved B0 plus B1–B3
  completion/raw/transcript evidence. The deterministic run identity binds those bytes, current B4 `/3`
  prompt/schema/validation versions, model and command policy, and the canonical blocked-finding ids.
  The execution contract is now `passBStructuredB4Canary/3`: `/2` repaired crash/resume accounting;
  `/3` hardens fresh B4 provenance/tool-event checks and bounds process duration. The live path is
  separately gated and capped at **ten durable pre-call reservations** across resumes:
  `attempt-N.reserved.json` is created with `wx`, flushed, and its
  directory entries synced before invoking the tool-less B4 call. Global count and contiguity come from
  reservations. The cap assumes preserved evidence on the trusted local filesystem: deleting
  reservation history can erase spent slots. A reservation without complete transcript/result/meta
  evidence is a consumed, terminal `unknown-outcome`, never called again. `accepted`, `held`, `fatal`, and `unknown-outcome`
  are terminal even when `checkpoint.json` is missing; checkpoints are convenience output only.
  Missing/truncated metadata may expose `transcriptDerivedKind:"fatal"` when the remaining transcript
  reveals fatal provenance, but status stays terminal `unknown-outcome` and the diagnostic grants no authority.
  Only a verified `usage-limit` result may retry after reset, consuming a new reservation while its
  previous slot still counts. Successful prose mentioning “rate limit” is not a usage-limit result.
  Every initialization event must report `apiKeySource:none`, and at least one init is required.
  An earlier bad/missing source cannot be masked by a later clean init. Model drift and every
  `*tool_use` execution block (including server tools and streamed blocks) are fatal; prose and
  structured-output payloads are not interpreted as execution events. The command policy binds a
  360-second `execFile` timeout with `SIGKILL`. Timeout stdout and outcome are preserved; timeout
  evidence is terminal held (or fatal if provenance fails), never a usage-limit retry. These changes
  do not alter the shared parser or historically banked B1–B3 evidence contract. Any preserved fatal
  anywhere stops execution before another call; unknown outcomes also stop execution. All preserved
  work states are reported, including a fatal on a later work. Invalid delta/hydration/leak/reconciliation
  output is held with no conformance retry. The runner verifies the canonical sealed-finding artifact
  and binds the La Gloire/St. John finding IDs; `sealedHold` reports their presence, not an effective
  resolution. The report is explicitly a schema/scoping smoke with semantic accuracy and release
  eligibility unmeasured. It has no decision, approval, resolution, merge, or production writer. No live
  VSD-040 call has run.
- `passBApproval/3` requires and re-verifies reconciliation when staging and applying. Final
  `ownerApproved:true` remains a separate authorized publication act. The writer updates only
  the explicitly approved surfaces and preserves every unapproved production field byte-for-value;
  empty/duplicate/unknown field sets fail closed. It also (VSD-037) enforces a one-way
  notes→hotspots approval coupling (changing notes requires re-approving hotspots; hotspots-only is
  allowed) and structurally validates the final production projection (why/cues/guide/notes/hotspots
  shapes, 0–100 coordinates, unique hotspot ranks each referencing an existing note) since strict B4
  validation re-applies only the `why` owner edit.

```bash
# Whole-cohort audit; no writes/model/network/production. Current b4r result:
# 50 works = 0 eligible, 8 review-required, 36 blocked, 6 quarantined, 0 errors.
/opt/homebrew/bin/node scripts/pass-b-reconcile-run.mjs \
  data/incoming/vision-calibration/b4r-8f1f74ddc30f

# Standing integrity gate: require and reopen all 44 playable active sets.
/opt/homebrew/bin/node scripts/pass-b-reconcile-run.mjs \
  data/incoming/vision-calibration/b4r-8f1f74ddc30f --check

# Write content-addressed baseline bundle/empty-decisions/report artifacts for the cohort.
/opt/homebrew/bin/node scripts/pass-b-reconcile-run.mjs \
  data/incoming/vision-calibration/b4r-8f1f74ddc30f --write

# One work: inspect, create a pending owner-decision template, then write a report bound to
# the reviewed decisions. Generating the template approves nothing.
/opt/homebrew/bin/node scripts/pass-b-reconcile.mjs \
  data/incoming/vision-calibration/b4r-8f1f74ddc30f harvard303416 --template
/opt/homebrew/bin/node scripts/pass-b-reconcile.mjs \
  data/incoming/vision-calibration/b4r-8f1f74ddc30f harvard303416 \
  --write --decisions /path/to/reviewed-decisions.json

# Owner edits must be included while building reconciliation so the component hashes bind
# exactly what approval would ship.
/opt/homebrew/bin/node scripts/pass-b-reconcile.mjs <run> <work> \
  --owner-edits /path/to/owner-edits.json --write --decisions /path/to/reviewed-decisions.json
```

These commands never mutate B0–B4 evidence and never publish. `--write` creates a content-addressed
set with exclusive-create writes and atomically advances the separately hash-bound active pointer;
the tool refuses to overwrite a different prior set or activation. Auto-policy and the curated
index remain unauthorized.


### Current launch scope and collector operation (VSD-041–045)

Owner intent: Max 5x subscription only, almost all available weekly capacity, no deadline;
a rolling 30-day buffer is the current scope. Public announcement requires completed B0–B4
and approved auto-policy publication with no legacy teaching filler. The auto-policy,
visible-content inventory, subset validation, writer/rollback and nightly supervisor remain
unimplemented; `tasks/pass-b-auto-publish-policy-draft.md` v2 is proposed, not approval.
The 50-work calibration/2-per-100 review proposal does not establish a rare-error guarantee.

```bash
# Read-only plan/status: safe offline; verifies preserved evidence and the Pacific window.
node scripts/pass-b-corpus-collect.mjs

# Explicit offline maintenance only: repairs missing raw copies and evidence-derived ledger holds.
# Does not run collection, contact a model, fetch images, approve content or change the daily schedule.
node scripts/pass-b-corpus-collect.mjs --repair-history

# Offline tests use isolated scratch fixtures; never invoke the old ledger-writing dry mode.
node tests/pass-b-corpus-collect.test.mjs
```

Collection remains stopped. A later explicitly authorized `--run` additionally requires
`PASS_B_CORPUS_LIVE=1`; it refuses starts outside 00:00–08:30 Pacific and never bypasses the
09:00 client deadline. No model probe should be used to discover remaining capacity. Earlier
handoff commands do not authorize resume or supersede these gates. The current repaired plan
for 2026-09-22 contains 600 window works and 526 queued; that is B0–B3 queue state, not
publication readiness or a calendar-time estimate.

### Reviewed runtime rebind and fatal recovery

A CLI update is an operational pause, not a reason to erase history. Keep collection stopped,
inspect the old/new CLI behavior and security flags, run the offline collector regressions, and
review the exact target returned by `executionPolicy("<new-semver>")`. The read-only plan exposes
the active epoch SHA. An explicitly reviewed JSON artifact must contain:

```json
{
  "version": "passBCorpusRuntimeReview/1",
  "runId": "corpus-b3-6401bc543ead",
  "fromEpochSha256": "<active epoch SHA from plan>",
  "toRuntimeVersion": "<reviewed exact semver>",
  "toPolicySha256": "<sha256(stableJson(executionPolicy(toRuntimeVersion)))>",
  "reviewedBy": "<actual reviewer>",
  "reviewedAt": "<actual ISO timestamp>",
  "reason": "<review evidence and compatibility conclusion>"
}
```

After that review, `node scripts/pass-b-corpus-collect.mjs --rebind-runtime /path/to/review.json`
acquires the run lease and exclusively appends one epoch, preserving the review inside it. It makes
no CLI/model/network call and does not rewrite the ledger or old attempts. A stale/replayed review
fails. Re-run the read-only plan; only a separately authorized live invocation may collect again.
Model, prompt, validation, scope and scheduling changes cannot be smuggled through a runtime rebind.
These hashes are a trusted-local-filesystem integrity boundary, not signed reviewer identity.

For a **fatal** or unknown outcome, keep the collector stopped. Preserve `fatal.json`, all epoch,
reservation, transcript, raw and completion bytes. Independently review the exact evidence, root
cause, affected attempts and proposed remediation; distinguish a genuine boundary failure from an
older operational error incorrectly marked fatal. Record that review and get explicit authorization
for the concrete recovery. There is intentionally no in-place `--clear-fatal`: runtime rebind refuses
fatal history and cannot erase unknown outcomes. A true boundary-failed run stays quarantined;
recovery requires a separately reviewed fresh execution scope and migration of only unaffected,
reverified evidence. That exceptional migration/clearance is **not implemented by this command**;
it must be prepared and tested before any resumed calls. Deleting `fatal.json` or editing the ledger
is never clearance, because preserved fatal attempt evidence still stops execution.

### Remaining publication and operational follow-ups

- **F2 blocks A8 publication:** B0 legacy comparison still reads live teaching/hotspot files. One
  changed work aborts the entire plan. Before any publisher is connected, preserve a frozen legacy
  baseline, classify drift per work as stale, and exclude or explicitly rerun only the affected work
  without overwriting evidence. The current collector does not claim publication-safe staleness.
- The wrong-image hold for `Q87332407` still needs the VSD-010 image-repair workflow. It remains held;
  this repair neither swaps an image nor changes daily scheduling.
- Window hold replacements require the proposed policy's separately approved rescheduling mechanism.
  The collector does not fill the window with legacy or silently extend collection beyond 30 days.
- Previously reported dead-PID leases and old scratch directories are preserved. Normal resume can
  recover a verified dead-PID lease; unrelated scratch/image files were not deleted by this repair.

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

# VSD-040 structured-B4 ten-work plan only (default; no output directory and no model calls).
/opt/homebrew/bin/node scripts/pass-b-b4-structured-canary.mjs

# Owner-gated VSD-040 smoke (ten durable reservation slots; DO NOT run before independent audit + go).
PASS_B_B4_CANARY_LIVE=1 /opt/homebrew/bin/node scripts/pass-b-b4-structured-canary.mjs --run

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

# Plan VSD-031's isolated second opinions for first-pass new coordinates (no model call).
/opt/homebrew/bin/node scripts/pass-b-spatial-confirmation-canary.mjs \
  --primary data/incoming/vision-calibration/b5c-f2020a1d8cca

# Explicit subscription-backed confirmation run. First-pass points/reasoning and owner answers
# are withheld from every image call; owner review is opened only afterward for blind scoring.
PASS_B_SPATIAL_LIVE=1 /opt/homebrew/bin/node scripts/pass-b-spatial-confirmation-canary.mjs \
  --run --primary data/incoming/vision-calibration/b5c-f2020a1d8cca \
  --review /path/to/pass-b-editorial-review-b4r-8f1f74ddc30f.json

# Plan VSD-032's offline, hash-bound resolution (no model calls or writes).
/opt/homebrew/bin/node scripts/pass-b-spatial-resolution-packet.mjs \
  --primary data/incoming/vision-calibration/b5c-f2020a1d8cca \
  --confirmation data/incoming/vision-calibration/b5k-9e3a46a675ae

# Write a new quarantined machine report + self-contained packet containing only holds.
/opt/homebrew/bin/node scripts/pass-b-spatial-resolution-packet.mjs --write \
  --primary data/incoming/vision-calibration/b5c-f2020a1d8cca \
  --confirmation data/incoming/vision-calibration/b5k-9e3a46a675ae
```

Artifacts remain under `data/incoming/vision-calibration/` (gitignored). A prompt/schema/transport
change creates a new run identity. Reusing prior stage work requires explicit migration followed by
normal checkpoint verification; never copy an unverified completion or overwrite an old run.

Relevant files:

| File | Controls |
|---|---|
| `scripts/pass-b-calibration.mjs` | B0 preparation, subscription process execution, lanes, checkpoint resume, packet write |
| `scripts/pass-b-b4-structured-canary.mjs` | Plan-first structured-B4 `/3` smoke; ten durable pre-call reservation slots, evidence-derived terminal states; no approval/production sink |
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
| `scripts/lib/pass-b-spatial-policy.mjs` | pure VSD-029–032 candidate comparison, note/merge routing, abstention semantics, two-checker resolution, and scoring |
| `scripts/pass-b-spatial-calibration.mjs` | offline owner-review measurement and immutable spatial-input/report writer; no model calls |
| `scripts/pass-b-spatial-localization-canary.mjs` | plan-by-default B5 image-only spatial canary; reads owner answers only after all calls complete for blind scoring |
| `scripts/pass-b-spatial-confirmation-canary.mjs` | plan-by-default independent B5 confirmation for first-pass new points; re-verifies the primary run, withholds all earlier points/reasoning, and requires deterministic scope + ≤5-point agreement |
| `scripts/pass-b-spatial-resolution-packet.mjs` | offline VSD-032 resolver; re-verifies both spatial evidence chains, writes the machine resolution, and renders only held exceptions with owner controls |
| `tests/pass-b-calibration.test.mjs` | controller, boundary, resume, packet, and failure regressions |
| `tests/pass-b-b4-structured-canary.test.mjs` | Offline source-binding, reservation/crash/cap, checkpoint-independent terminality, later-fatal reporting, tamper/live-gate, and zero-model-eligibility regressions for VSD-040 |

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
