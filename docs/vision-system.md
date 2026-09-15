# Vision system: canonical decisions and operating contract

**Authority:** owner-approved product and operating intent
**Last owner confirmation:** 2026-09-15
**Implementation status:** partially implemented; see [PIPELINE.md](PIPELINE.md) for what runs today
**Planning detail:** [vision-consolidation-plan.md](../tasks/vision-consolidation-plan.md)

This is the canonical decision record for Gesso's vision work. It answers **what the
system is supposed to do**. `docs/PIPELINE.md` answers **what is implemented and how an
operator runs it today**. When the two differ, this document controls the intended
destination, but a plan is not evidence that a capability has shipped.

Do not silently rewrite a settled decision. Amend the relevant section, append a dated
entry to the decision log, and update the implementation table in the same change.

## Goals and non-goals

The system optimizes, in this order, for:

1. High-quality, work-specific visual teaching and trustworthy research measurements.
2. Low marginal cost: subscription-backed Claude work for descriptive enrichment;
   paid API calls only where blindness or a hard tool boundary requires them.
3. Unattended, checkpointed operation that resumes after usage limits reset.
4. Preservation of the G-03 security boundary around untrusted image URLs and bytes.

The two passes are independent. They have separate schemas, ledgers, completion rules,
budgets, and downstream uses. Their conclusions do not combine automatically today.

For clarity, new code and documentation should use these descriptive names:

- **Pass A — `visionDifficultyProbe`:** model recognizability and blinded visual
  guessability research.
- **Pass B — `contentVisionEnrichment`:** image QA, playability, teaching content,
  hotspots, and the rich internal content index.

Historical filenames may keep their existing names during migration. “Pass A” and
“Pass B” are shorthand, not permission to collapse their outputs.

## Pass A — recognizability and blinded guessability

Research-design history is preserved separately: the
[`2026-08-27 v1 pre-registration`](research/recognition-inference-preregistration-v1-2026-08-27.md)
is frozen, and the
[`v2 working design`](research/recognition-inference-preregistration-v2-working.md) records
prospective revisions before the protocol freeze. Neither document authorizes data collection by itself.

### The measurements are distinct

- **Model recognizability:** whether the model recognizes the exact work from its
  learned weights. This is not typical-player recognition.
- **Fame proxy:** Wikipedia/pageview and related documentation-density signals. This
  approximates exposure but is not model recognition or player recognition.
- **Predicted player recognition:** if retained, this must be an explicitly named,
  separately calibrated estimate. It must not be called recognizability without a
  qualifier.
- **Blinded guessability:** how much the pixels support inference of the scored facets
  (artist, place, date, medium, movement) after exact-work recognition has broken.

A famous work can be highly recognizable but visually hard to infer once blinded. The
metrics are orthogonal and must remain separately stored.

### Historical operational probe (VSD-003)

The existing low-cost operational probe remains multi-rung and adaptive:

`full → flip → flip+rotate → crop60 → crop45 → future stronger rungs`

Each rung is a separate, tool-less, internet-disconnected, metadata-free model call.
Colour should be preserved unless a deliberately versioned experiment establishes a
better tradeoff: colour can carry real artist/movement/place evidence. Stop when correct
recognition breaks, then measure guessability at that clean rung.

Required output concepts include:

- `modelRecognizedFull`
- `modelRecognitionBreakRung`
- `modelSurvivedLadder`
- the fame proxy
- optional, explicitly named predicted-player recognition
- per-facet blinded guessability and aggregate `G`

If recognition survives the final rung, the work is right-censored. Do not treat that
terminal record as a clean guessability read or conflate it with a work that broke at
the same rung. Preserve an explicit `survived` value and leave blinded `G` null/censored
until a stronger rung obtains a clean read.

This adaptive path is historical/operational evidence and may remain useful for cheap
corpus triage. It is not the frozen v2 experimental method.

### Frozen research exception (VSD-016; naming updated by VSD-018)

The owner-approved v2 research program uses two prospective protocol freezes and a separate,
append-only ledger:

1. a 36-work pilot protocol frozen in a dedicated git commit before pilot collection;
2. a later main-study protocol freeze using only prespecified pilot nuisance estimates.

Its frozen method uses a complete repeated-measures panel rather than adaptive stopping:
one ordered nested crop family plus separate mirror, rotation, and grayscale diagnostic
branches; separate fresh-context exact-identification and facet calls; a randomized
same-image supplied-identity experiment as the sole causal primary; and a small full-view
alternate-source robustness arm. It preserves non-monotonic recognition vectors and
right-censors meaningful terminal survivors. The frozen v2 protocol controls literal cue
disclosure, response stability, retries, grading, cost, model identity, and publication.

The 36-work pilot protocol was frozen at `5ea28c8`, collected, and externally sealed at
`9bcd580`; the corrected, separate Study-B mini-pilot closed at `6a555af`. Results and
caveats live in `docs/research/recognition-pilot-results-note.md`. The work remains
research-only and did not alter production data, daily schedules, or tiers. Any later main
study requires its own prospective protocol freeze; the completed pilot does not authorize it.

Pass A deliberately uses the paid API because its blindness must be auditable: no web,
no filename/title metadata, no tools, and no agent wrapper. Raw results and every rung
must checkpoint atomically so a killed or rate-limited run resumes at the next missing
rung rather than repeating paid calls.

Pass A results are research inputs. They **must not be wired automatically into tier
assignment yet**. Store and inspect the new distributions first; choose and document a
later formula (including any cross-averaging with fame or predicted human difficulty)
as a separate decision.

## Pass B — descriptive content enrichment

### What it must produce

Pass B is not merely image QA. Its versioned superset schema must preserve and improve
all useful questions from the historical passes:

- image identity/quality/framing, playability, and medium legibility;
- abundant “look closer” observations and feature-anchored hotspot candidates;
- pose, gesture, body orientation, gaze, figures, and relationships;
- palette, tone, lighting, format, and composition;
- subject, scene, iconographic/narrative motifs, and object function;
- material, surface, technique, condition, damage, inscriptions, signatures, and
  photographic artifacts;
- charming, memorable, or easily overlooked details;
- controlled tags and useful free tags for internal search and future themed sets;
- work-specific study-guide questions and answers;
- visible evidence, uncertainty, source/provenance, and conflict state.

Pose, palette, subjects, lighting, and tags may be published to the internal index even
though players do not currently see them. They are the curation database for sets such
as odalisques, portraits in half-light, or the Odyssey in art; they are not dead fields.

### Information boundaries and stage order

One controller may coordinate the work, but image viewing and web research remain
separate security principals:

0. **Select and sanitize.** Choose work, broker-fetch it, fully decode and metadata-strip
   it, write a SHA-addressed derivative, and perform deterministic technical checks.
1. **Image-first inventory and QA.** A fresh-context image process sees only the sanitized
   derivative and bounded non-answer metadata. It inventories visible evidence, image
   problems, possible teaching details, and questions needing research.
2. **No-image research.** A separate process may use the title/catalog record, existing
   content, and the structured visual inventory, but never the image. It performs web
   fact-checking, produces internal source links, and identifies claims/details that
   should be checked against the image.
3. **Conditional visual verification.** Only when research surfaces an important,
   locatable detail not established at stage 1, make a targeted second image-only call.
4. **Synthesis.** Reconcile visible evidence, research, old content, and conflicts into
   the complete rich record. Existing content is evidence, not a preserve-by-default
   constraint: keep, revise, replace, add, or remove unsupported material component by
   component.
5. **Policy/review and guarded merge.** Apply only through a hash- and version-bound
   approval artifact and the guarded authoritative sink.

Image-first is deliberate. Research-first invites the image process to confirm catalog
claims instead of noticing what is actually visible. Research can still motivate the
targeted second look in stage 3. Broker derivatives use content-addressed filenames, so
titles do not leak through filenames.

**Current calibration scope (VSD-019, superseded in part by VSD-021):** the initial lean
controller deliberately stopped after B1/conditional B2. Live canaries then justified restoring
the intended VSD-005 sequence for the fixed 50-work calibration: B0 sanitize, B1 image-first
inventory, conditional B2 no-image research, conditional B3 targeted image verification, and B4
no-tool synthesis. The current feature-branch controller implements that sequence with strict
stage validation, transcript-bound evidence, resumable checkpoints, five independent lanes, and
a quarantined comparison packet. A complete Julius Caesar canary exercised B0–B4 successfully;
the fixed calibration completed B1–B3 for all 50 works and the accepted B4-v2 pass completed 44,
quarantining 6 first-attempt misses. Nothing from this controller can merge
or publish to the game.

B4 no longer asks the model to reproduce a complete rich record. Under VSD-022 the model emits a
compact editorial **delta** (per-item keep/revise/replace/add/remove actions, replacement text,
references to existing B1/B2 ids, and corrections/conflicts/uncertainty); the controller
deterministically hydrates the authoritative B1 evidence and delight registries and the B2 source
and catalog registries, assigns its own ids and ranks, then runs strict `validateB4`. Under
VSD-027, editorial ancestry (`ref`) and hotspot location (`pinRef`) are separate: location comes
from a matching pinned B1 candidate or, only when genuinely localized, an evidence bbox.
Whole-frame/missing anchors and duplicate/overlapping pins stay in the review report but do not
become fake player hotspots. This was proven end-to-end on the three works that carried
old-B4 baselines: roughly 2x faster and ~44% fewer tokens, all well under the six-minute gate,
with teaching richness preserved (see the old-vs-new comparison card). Legacy content is treated
as unverified editorial material, never as factual evidence, throughout.

B2 has separately been narrowed (VSD-022, Phase 2, offline) toward targeted, teaching-relevant,
atomic fact-checking for a strong non-specialist reader, with a small default research budget
(1–2 searches, 2–4 fetches, up to ~4 useful sources, at most 2 targeted B3 requests) and an
explicit source-priority ladder (holding museum record first; Wikipedia may orient but cannot be
the sole authority for a consequential correction). The verdict scheme now includes
`qualified`/`partlySupported` so true-but-imprecise claims are qualified rather than over-refuted,
`refuted` is reserved for a demonstrably false central proposition, high-confidence refutations
require at least one corroborating source outside Wikipedia and known UGC/blog hosts
(host-parsed, so encoded-dot evasions are rejected and a museum URL is not; this guarantees
non-Wikipedia/non-UGC corroboration, NOT yet a positive museum/scholarly allowlist — that
tightening is a pending owner decision), and attribution is distinguished from
prototype/influence/workshop/lineage (the Clouet lesson). The B2-v2 prompt, schema, validator,
and regressions are implemented; a live fixed five-work v1-vs-v2 comparison completed and its
preserved transcripts were independently rechecked.

### Security model

The preferred low-cost execution is subscription-backed Claude Code. The image process runs
under a **proportionate, minimal-capability boundary** (VSD-019): the hardened broker
sanitizes and re-encodes the external image; the controller places that single SHA-named
derivative alone in a fresh per-call temporary directory; Claude is invoked with **only the
Read tool** (`--tools Read --allowedTools Read`), `--restricted`, `--safe-mode`, an empty MCP
configuration, no Chrome, no session persistence, and with `ANTHROPIC_API_KEY` /
`ANTHROPIC_AUTH_TOKEN` stripped. It has no Bash, write/edit, web, MCP, browser, repository,
additional-directory, or authoritative-write capability. The image process's network egress
is limited to the Claude service endpoints the client requires. A separate no-image research
process gets web (WebSearch/WebFetch) and never sees the image. The deterministic controller
alone stores the returned output; it stays quarantined and cannot merge automatically.

This proportionate boundary is owner-approved for Pass B because Pass B is a manually
initiated backend process whose outputs are human-reviewed before any authoritative merge:
visible prompt injection through an image remains possible, but it cannot act (no tools that
touch the network, filesystem, or repo beyond reading the one confined image) and cannot
reach the game without human approval.

The G-03 broker, decode/re-encode, path confinement, schema checks, evidence store,
single-use runs, base-state drift check, and structural writer inventory remain mandatory.
No subagent writes into authoritative data directories.

**Transport history (VSD-004 → VSD-019):** the earlier plan attached the image with a
zero-tool `@<sha256>.png` mention in the prompt. A 2026-08-31 canary suggested this worked,
but the 2026-09-02 lean calibration controller proved it does **not** deliver image bytes in
its headless `-p --output-format` invocation: across three fresh B1 runs bound to the same
correct marble-relief derivative, the model received no image and hallucinated three
different works (a tavern painting, a dark oil portrait, a Liberty coin). The `@<path>`/
base64 transport is therefore abandoned for the calibration; the Read-tool confined-directory
transport above replaced it and was verified (the Read `tool_result` returns an image content
block, and the model then reported the true object). Execution is proven from the raw
`stream-json` transcript, not from prose: a B1 completion is accepted only when the transcript
shows a successful Read of the exact SHA image inside the confined dir, and a B2 completion
only when it shows genuine WebSearch **and** WebFetch tool-use events (never the
`usage.server_tool_use` aggregate counters, which stay 0 for these client tools). Filenames
stay content-addressed so no title/catalog/repo/home path ever reaches the model.

### Teaching content and hotspots

- Aim for at least five strong, non-blank, work-specific study questions. The old prompts
  (“Why this material?”, “How do we know the artist?”, “How do we date it?”) are inspiring
  dimensions, not required literal stems. Omit an irrelevant dimension and replace it
  with a stronger one; never manufacture generic filler.
- Mix beginner and deeper questions. Teach transfer: what visual evidence identifies an
  artist, movement, period, place, material, or object type, and what a museum visitor
  might otherwise miss.
- Obscure works may use image-grounded teaching plus well-supported knowledge about the
  type, medium, movement, artist, or period when work-specific scholarship is sparse.
- Generate and store **all worthwhile hotspot candidates**, not only the initial display
  count. Rank each by priority and role (diagnostic, technique, narrative, delight). A
  normal work may display about 3–5; a detail-rich Bosch may warrant many more.
- A publishable hotspot needs a meaningful spatial anchor. Never convert a missing or
  near-whole-image bbox into a center pin or whole-frame region. Retain unlocalized and
  duplicate proposals with an explicit review reason; publish only distinct locations.
- Treat editorial usefulness, presentation mode, and coordinates as separate decisions.
  Suppressing a pin never deletes a useful observation: duplicates merge, while broad,
  distributed, or whole-work observations become unpinned notes. A point may represent a
  genuinely local detail or one honest representative example of a repeated feature.
- When the image bytes are unchanged, the previous published coordinate remains a
  first-class candidate alongside the new B1 anchor. Neither source wins merely because it
  exists. Ambiguous, not-found, or low-confidence placements are withheld for review.
- A localization checker validates every same-image candidate independently. It does not
  replace an honest candidate with its preferred point: the controller keeps the current
  point when valid (a no-churn tie-breaker), otherwise another valid prior point, and may use
  a fresh suggestion only after every candidate is invalid. An uncertain candidate blocks a
  fresh point. This selection is deterministic and never rewrites the observation.
- Coordinate accuracy is scored only for genuinely unique point targets. Repeated-feature
  representative points are set-valued and retain distance only as a diagnostic; distributed
  and global observations are evaluated as note routes. A visual-target phrase necessarily
  names the feature being sought, so this stage can flag absent or ambiguous claims but is not
  an independent factual/identity audit.
- One pinned observation is the source for both concise and deep presentations. Do not
  generate two contradictory accounts of the same detail.
- Source links remain internal initially.
- The player-facing study guide follows the authoritative editorial reference
  [`docs/vision-study-guide-style.md`](vision-study-guide-style.md) (VSD-020): question
  selection and answer style only — facts always come from the work's own validated
  legacy + B1–B3 evidence/research, and the golden example is a voice illustration, not a
  fact or structure template.

### Playability and image disposition

Playability is visual-teaching potential, not fame and not conventional beauty. A Rothko,
a monochrome painting, a patterned textile, a damaged ancient fragment, or a cuneiform
tablet can be playable when there are meaningful visual anchors and useful inferences.
A generic ceramic or jade knob with no meaningful pin or differentiating lesson may not
be. Borderline but defensible works may remain in Impossible while calibration evolves.

Use four image states:

- `usable`: proceed;
- `repair`: better crop/resolution/colour is desirable, but the current image can support
  responsible content;
- `blocked`: wrong art, unusably poor, or too compromised for responsible teaching;
- `unplayable`: the image is valid but the work lacks meaningful visual guessing or
  teaching anchors.

Calibrate these states on a stratified set of 50 before using them broadly. A blocked
work is withheld from **unseen future dailies** and queued for image repair, but stays
available in Collections. Do not rewrite today, past history, or already-seen dailies.
For now, limit targeted replacement/rescheduling to the next 30 days and measure the
count before expanding. There is no universal hard “daily must be vision-complete” gate
yet because coverage is insufficient.

When an image changes, rerun every image-grounded component. Preserve independently
sourced catalog facts only when identity confidence remains high.

Sensitivity tags such as death, sacred function, and colonial displacement are internal,
searchable context signals. They do not automatically require owner approval and do not
automatically make a work unplayable. Preserve the current special exclusion for human
remains; funerary and sacred objects may remain playable with context.

### Approval and publication policy

The owner cannot manually approve all ~6,500 works. After calibration, a deterministic,
versioned auto-policy may publish high-confidence notes, hotspots, and internal rich
descriptors. The model never approves itself: the controller produces a hash-bound
approval manifest with `reviewMode: "auto-policy"`, policy version, thresholds, and
evidence.

Always route these to owner review:

- `playable:false` and exclusion decisions;
- wrong-art/image swaps and unresolved image identity;
- changes to scored categories or artist/place/date/medium/style/culture claims;
- medium-category removal;
- unresolved conflicts or low-confidence factual claims.

Human review is a correction path, not select-only. Corrections must be labeled as
human-authored and provenance-bound rather than silently attributed to the model.
An unanswered control is an abstention, not a rejection. Spatial review must offer separate
actions for keeping/moving a pin, retaining the observation as an unpinned note, and
discarding the underlying idea; historical `drop` choices that did not make that distinction
may remove a pin but may not be learned as negative content judgments.

For every major prompt, schema, model, or policy revision, manually review a stratified
50-work calibration set. Once calibrated, review every flagged exception plus a random
sample of 2 per 100 auto-published works. Increase sampling whenever drift appears.

Existing content is not protected merely because it exists. Audit it for richness,
specificity, correctness, and duplication. Preserve prior versions as legacy evidence
and rollback material, but publish the best supported component. Good Easy-tier material
does not need a separate paid critic pass; the normal synthesis stage should leave it
alone only when it is already the strongest result.

## Coverage, ledgers, and staleness

Pass A and Pass B require separate ledgers. Pass B tracks each component, not just an ID:

`complete | missing | blocked | stale | notApplicable`

Component evidence is bound to current image SHA, prompt version, schema version, policy
version, model, and source state as applicable. A work is never “complete” because it was
once processed. Existing historical artifacts remain visible as `legacyEvidence` until
replaced, but they do not count as secure current-pass completion.

Staleness must be detected when an image, prompt, schema, model policy, source/catalog
fact, or relevant authoritative field changes. Rerun only affected components where the
dependency graph supports that safely; otherwise fail toward a broader rerun.

The offline `contentVisionCoverage/1` inventory is the baseline measurement layer. It
derives exactly one row per current pool work from tracked artifacts, reports Pass A
coverage separately, labels historical material as legacy evidence, and never promotes
legacy IDs or good-looking old prose to current completion. Its 202-record rich-history
adapter must reconstruct every legacy value from explicit normalized projections; an
opaque raw rollback copy alone does not satisfy the no-discard check. Alias collisions and
orphaned historical rows are reported, not silently merged or discarded.

Pass B scheduling priority:

1. works scheduled in the next 7 days;
2. works scheduled 8–30 days out;
3. missing/stale Easy works;
4. highest-fame quintile within Medium, Hard, and Impossible;
5. remaining Medium;
6. remaining Hard;
7. remaining Impossible.

Within a priority band, rotate region, source, and medium so coverage does not become
even more Eurocentric or host-concentrated.

## Unattended operation

Use a deterministic Node supervisor launched by macOS `launchd` every 10–15 minutes.
Do not use an LLM loop to supervise another LLM. The laptop is expected to be powered on
and logged in.

### Subscription-protected schedule

Timezone: `America/Los_Angeles`.

- **09:00–22:00:** protected period; automated Pass B starts zero Claude calls.
- **22:00–08:30:** overnight start window.
- **08:30:** stop starting new work; an in-flight item may finish by 09:00.

Target no more than 75% of conservatively observed subscription capacity. Begin at 50%
for three windows, raise to 70%, then to 75% only after the checkpoint/error data is
stable. Do not buy or silently use extra API credits for Pass B. The child process must
remove `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` so it uses the intended subscription
login. The installed Claude client may require both `api.anthropic.com` and `claude.ai`;
do not assume an API-only hostname allowlist works until the prototype proves it.

Treat five-hour/weekly limits as structured pauses. Persist reset/retry state, apply
jittered backoff, and let `launchd` resume later. Never poll a model to learn whether a
model can run. A local status command must report queue counts, checkpoints, current
budget, recent errors, and next eligible start without making a model call.

Budget telemetry must count the client's reported internal turns and token/usage fields
when available, not merely `claude -p` process launches: the prototype used one process
but reported `num_turns:2`.

Pass A is disabled by default and has its own explicit dollar/call budget file. It may
run while Pass B is protected only when separately authorized; subscription and API
budgets must never substitute for one another.

Every work/stage/rung has an atomic checkpoint and lease. A killed process resumes at the
first missing unit; it does not repeat completed paid calls or double-merge results.
Store runtime state under `data/incoming/vision-ops/`, publish a compact tracked coverage
summary, and never log tokens, cookies, API keys, or raw authorization errors.

## Implementation status as of 2026-09-15

| Capability | State |
|---|---|
| G-03 hardened broker, tool-less paid runner, hash/evidence-bound guarded merge | Implemented on feature branch `g-03-image-agent-boundary` at `2186a00`; preview-built, not production |
| Current Pass B schema | Strict B1–B4 calibration schemas, structure-only wire schemas, cross-reference validation, and hash-bound stage capture are implemented and exercised in feature-branch calibration code; they are not frozen or connected to production. The full-record B4 output contract was replaced by compact-delta wire + deterministic hydration (VSD-022); `passBValidation/4` adds publishable-hotspot distinctness/localization and explicit spatial `pinRef` (VSD-027) |
| Pass B offline coverage inventory + rich legacy adapter | Implemented 2026-09-02: deterministic 6,557-row `contentVisionCoverage/1` generator; all 202 `vision.js` records verified as a **lossless round-trip via retained record- and item-level raw copies** (`palette`/`figures` are decomposed; other fields are whole-value projections) — a full shape-aware migration that drops the raw copies is **not** yet built; rich authoritative component ledger is still unbuilt |
| Current approval | The quarantined full-cohort packet captures non-authoritative work decisions, per-work notes, and explicit per-observation pin/note/discard/abstain choices (including click-to-place coordinates) in browser-local state and exports a run/evidence-bound JSON handoff (VSD-028/029). A separate one-work, hash-bound guarded Pass B approval/apply path supports explicit field-level owner approval and labeled owner edits; no calibration record is yet approved. Auto-policy and component-ledger publication remain unimplemented |
| Pass B subscription-backed image process | Transport CORRECTED 2026-09-02 (VSD-019): the zero-tool `@<sha>.png`/base64 attach was proven NOT to deliver image bytes in the lean controller's headless invocation (3 fresh B1 runs hallucinated 3 different works from one correct derivative). Replaced by a **Read-tool confined-directory** transport (`--tools Read`, one SHA image in a fresh temp dir), verified via a real Read `tool_result` image block; execution is proven from the raw `stream-json` transcript |
| Pass B calibration controller (B0–B4) | Implemented and live-exercised: Read-tool image transport; transcript-verified B1/B3 image reads and B2 WebSearch+WebFetch; strict stage capture; resumable checkpoints; five lanes; and quarantined before/after review. The fixed 50-work B0–B4 calibration completed in `cal50-0a47b6f7f332`; the accepted B4-v2 continuation produced 44 strict-valid/leak-clean records and quarantined 6 first-attempt misses in `b4c-f45fac18da2e`. Under VSD-027 those 44 were rehydrated offline into `b4r-8f1f74ddc30f`: 1,207 source files remained byte-identical, all 44 strict-valid, hotspot overlap pairs fell 45→0, and lineage reporting was corrected. Nothing is connected to production; human review and guarded field-level approval remain required |
| Pass B separate no-image research and conditional second look | B2 no-image research and conditional B3 targeted image verification are implemented and live-exercised. The VSD-022 teaching-target/source-budget revision (B2-v2) is **implemented and passing offline** 2026-09-03: SAT-caliber non-specialist reader; conditional research; budget (1–2 searches, 2–4 fetches, ≤4 sources); source-priority ladder; atomic claims; `qualified`/`partlySupported` verdicts; high-confidence refutations require a corroborating non-Wikipedia/non-UGC source (host-parsed; a positive museum/scholarly allowlist is a pending owner decision); attribution distinguished from prototype/lineage (Clouet). B3 requests capped at 2 with the dropped count surfaced (status.b3Dropped). The B2 web-research gate now counts only genuinely-retrieved pages (a 4xx/redirect envelope is not a retrieval). A live 5-work v1-vs-v2 comparison ran 2026-09-03 (5/5 strict-valid; research collapsed; over-refutations corrected) and passed Codex adversarial review with corrections applied; results quarantined, nothing merged. Strict-valid = shape + reference integrity, not factual entailment — human review remains the factual gate |
| Pass B synthesis | **Compact editorial-delta B4 + deterministic hydration is implemented, tested, and run across the 50-work calibration.** VSD-027 separates editorial `ref` from spatial `pinRef`. VSD-029/030 add an offline spatial policy and candidate-validation checker: every same-image legacy/current point is judged independently; a valid current point is preserved as the no-churn tie-breaker, an uncertain candidate blocks relocation, and a new point is usable only after every candidate is invalid. Global/distributed observations route to notes; not-found/ambiguous observations hold. The accepted blind ten-work canary `b5c-f2020a1d8cca` completed 10/10 strict-valid (44 targets) with only the image, short target title, and candidate points; it selected 23 existing candidates, suggested 4 new points, routed 12 notes, and held 5. Results remain calibration-only: no auto-policy threshold is approved and no Pass B output is connected to a production sink |
| Pass B component coverage/staleness ledger | Offline baseline inventory implemented; authoritative component writes, approvals, and staleness transitions remain planned; current live ledger is narrower |
| Pass A adaptive ladder | Historical code/data exist; retained as the VSD-003 low-cost operational probe, not the frozen v2 method |
| Pass A recognition-inference pilot | Completed 2026-09-01: protocol freeze `5ea28c8`, sealed collection `9bcd580`, corrected Study-B closure `6a555af`; results are research-only and do not drive tiers |
| Pass A survivor/censoring semantics and per-call checkpoints | Implemented and exercised in the completed pilot; raw responses remain append-only/hash-bound and non-monotonic vectors/censoring are preserved |
| Pass A automatic tier use | Intentionally disabled/not implemented |
| Unattended `launchd` supervisor and budget controller | Planned, not implemented |

## Open decisions and required evidence

These are not permission to guess. Resolve them with a prototype, data, or an owner
decision, then append the result below.

1. Can the installed subscription-backed Claude Code client attach a local image in
   headless mode while `--tools ""` is enforced, without leaking filename/path metadata?
   → **Superseded 2026-09-02 (VSD-019).** The 2026-08-31 canary suggested a zero-tool
   `@<path>` attach worked, but the lean calibration controller proved it does NOT deliver
   image bytes in its headless `-p --output-format` invocation (3 fresh B1 runs hallucinated
   3 different works from one correct derivative). Resolution: attach via the **Read tool**
   with the image alone in a confined per-call directory (no other tools), and verify a real
   Read image `tool_result` from the `stream-json` transcript. The subscription/zero-web-for-
   the-image-stage intent stands; only the byte-transport mechanism changed. The historical
   *Prototype evidence* below is retained but is not evidence for the calibration transport.
2. What observable usage/reset signal can safely drive the 50→70→75% subscription budget?
3. What stronger Pass A rungs best break recognition while retaining useful visual signal?
4. Should predicted-player recognition remain a model output, and how will it be calibrated?
5. What later formula, if any, combines fame, predicted-human difficulty, and blinded
   guessability for tiering?
6. What storage/index format should expose the rich internal Pass B schema?
7. What exact UI rule chooses displayed hotspots from the larger ranked candidate set?

### Prototype evidence — 2026-08-31 (open question 1 / VSD-004)

Scope: this tested ONLY zero-tool local-image attachment through the subscription client.
It does **not** prove the whole Pass B architecture.

- **Claude Code version:** 2.1.251.
- **Sanitized command shape (one `claude -p` invocation, `shell:false`, arg array, cwd =
  fresh `/private/tmp` dir outside the repo):**
  `claude -p "<prompt referencing @<sha>.png>" --model sonnet --tools "" --safe-mode
  --restricted --strict-mcp-config --mcp-config {"mcpServers":{}} --no-chrome
  --disable-slash-commands --permission-mode dontAsk --no-session-persistence
  --output-format json --json-schema <9-field strict schema> --system-prompt <minimal
  vision-only>`. Child env copied from parent with `ANTHROPIC_API_KEY` and
  `ANTHROPIC_AUTH_TOKEN` deleted.
- **Authentication class:** subscription/OAuth (`authMethod: claude.ai`, `apiProvider:
  firstParty`, Max plan); no API key. No credentials recorded.
- **Canary SHA:** `d42b1dc5e8ba2cc5e1cdd1d6d58ea73d79154830d94c8536f8ec827632d1dd59`
  (512×512 PNG, sharp re-encode with no `.withMetadata()`; verified no EXIF/ICC/XMP/IPTC;
  the 4-char code existed only in pixels + the harness's expected-value variable).
- **Result:** attachment capability PASS WITH CONSTRAINT. Structured output validated;
  the model returned the exact hidden code and the correct left/right colours and shape.
  The path itself was not opaque to the model, so only a neutral relative SHA path is safe.
- **Image attachment worked:** yes — `imageReceived:true` and the pixel-only code was read
  correctly *with `--tools ""`*, so `@<path>` attaches an image at the harness level rather
  than requiring the Read tool.
- **Filename/path text visibility:** the model reported no answer text in the image, but its
  own note revealed the `@<path>` string reached it as **text context**. The path was
  content-addressed (SHA filename), so no answer leaked — but this confirms filenames MUST
  stay content-addressed; a title/catalog filename would leak.
- **Tool use:** empty tool list enforced; `is_error:false`, `subtype:success`, exit 0,
  empty stderr, no tool output. Honest caveats: (a) `num_turns:2` — the single invocation
  used two internal turns (the reason was not established); no retry or
  second invocation was issued; (b) the run's `permission_denials` field was not captured
  in the summary, so "zero tool attempts" is inferred from the clean success + no tool
  output, not directly logged. The client reported an estimated value of about $0.011;
  because the run used a Max subscription, this is not evidence of an incremental charge.

## Decision log

| ID | Date | Decision | Status |
|---|---|---|---|
| VSD-001 | 2026-08-31 | Maintain independent `visionDifficultyProbe` and `contentVisionEnrichment` passes and ledgers. | Approved |
| VSD-002 | 2026-08-31 | Pass A measures model recognition and blinded guessability separately; fame/player-recognition remain separately named. | Approved |
| VSD-003 | 2026-08-31 | Preserve Pass A's adaptive multi-rung blind API method; terminal survivors are censored, and outputs do not yet drive tiers. | Approved for historical/operational probe; scoped by VSD-016 for registered research |
| VSD-004 | 2026-08-31 | Prefer subscription-backed Pass B only if a zero-tool headless image prototype proves the security boundary; otherwise use the tool-less API for image viewing. | Approved; the subscription preference stands, but the zero-tool `@<path>` image TRANSPORT is superseded by VSD-019 (Read-tool + confined dir) after it failed to deliver image bytes in the lean controller |
| VSD-005 | 2026-08-31 | Pass B order is image-first, separate no-image research second, conditional targeted second look, then synthesis. | Approved |
| VSD-006 | 2026-08-31 | Rich historical fields, study guides, and plentiful ranked hotspots are first-class outputs, not discarded experiments. | Approved |
| VSD-007 | 2026-08-31 | Existing content is audited component-by-component, not preserved by default; prior versions remain legacy evidence. | Approved |
| VSD-008 | 2026-08-31 | Auto-publish calibrated high-confidence teaching/internal content; human-review consequential and uncertain changes. | Approved; policy unimplemented |
| VSD-009 | 2026-08-31 | Generate all worthwhile hotspots, rank them, and normally display 3–5 while allowing more for detail-rich works. | Approved |
| VSD-010 | 2026-08-31 | Block unusable images from unseen future scheduling, initially within 30 days; preserve Collections and history. | Approved; calibration pending |
| VSD-011 | 2026-08-31 | Calibrate major revisions on 50 stratified works, then review all flags plus 2/100 random auto-published works. | Approved |
| VSD-012 | 2026-08-31 | Keep source links internal initially; preserve current contextual sensitivity behavior and human-remains exclusion. | Approved |
| VSD-013 | 2026-08-31 | Protect subscription capacity 09:00–22:00 Pacific; run unattended overnight, starting at a 50% conservative budget. | Approved; supervisor unimplemented |
| VSD-014 | 2026-08-31 | Do not add a universal hard daily-completion gate until audited coverage is sufficient. | Approved |
| VSD-015 | 2026-08-31 | Subscription image attachments use a neutral relative SHA-only path because Claude Code exposes the `@<path>` string as model text; usage budgets count internal turns, not only process launches. | Attachment MECHANISM superseded by VSD-019 (the `@<path>` transport did not deliver image bytes in the lean controller; now Read-tool + confined dir). The content-addressed-filename and turn-counting requirements STAND |
| VSD-016 | 2026-08-31 | Registered Pass A research uses separate pilot/main freezes, a complete repeated-measures view panel, separate identification/facet calls, and a randomized supplied-identity causal primary; it remains append-only and cannot change tiers. | Approved; pilot completed 2026-09-01; main study not authorized |
| VSD-017 | 2026-08-31 | Use a dedicated frozen git commit as the pilot preregistration record; no OSF/external-registration dependency. Freeze a stable registration id and artifact hashes, then have the runner derive and verify the commit before the first response (the commit cannot self-embed its own hash). | Approved; supersedes only VSD-016's external-registration venue wording; naming superseded by VSD-018 |
| VSD-018 | 2026-08-31 | The active pilot contract is a **git-freeze-only protocol freeze, not a "registration."** It keeps VSD-017's identical git-integrity mechanism (dedicated commit whose subject names a stable id; the runner derives and verifies the commit before the first call) but renames the vocabulary throughout the runner, artifacts, statuses, evidence, gate assertions, and commit subject: DRAFT status `DRAFT_NOT_FROZEN_NO_COLLECTION`, frozen status `PILOT_PROTOCOL_FROZEN_BEFORE_COLLECTION`, artifacts `*.frozen.json` / `pilot-protocol.frozen.md`, evidence `protocol-freeze-evidence.json`, commit subject `PILOT PROTOCOL FROZEN BEFORE COLLECTION: <id>`. Historical v1 "preregistration" references remain historical. | Approved; pilot mechanism exercised and closed 2026-09-01 |
| VSD-019 | 2026-09-02 | **Pass B image transport = Read-tool in a confined directory; initial calibration scope = B0/B1 + conditional B2.** The zero-tool `@<path>`/base64 attach (VSD-004/VSD-015) does not deliver image bytes in the lean controller's headless invocation and is abandoned for Pass B: the image is placed alone in a fresh per-call temp dir and Claude opens it with ONLY the Read tool (`--tools Read`, `--restricted`, `--safe-mode`, empty MCP, no session persistence, API keys stripped); B2 gets ONLY WebSearch/WebFetch and never the image. This proportionate boundary is accepted because Pass B is manually initiated and human-reviewed before any merge. Execution is verified from the raw `stream-json` transcript (B1 must Read the exact SHA image inside the confined dir; B2 must show real WebSearch AND WebFetch tool-use events — not `usage.server_tool_use` counters), and attempts/completions bind work id + image SHA + prompt hash + model + image-transport version + transcript SHA (a transport change forces a fresh run identity). The initial lean calibration removed B3/B4 from the call plan while B1/B2 value was tested. Prior invalid B1/B3 runs (no image received) are diagnostic evidence only and are never resumed. | Approved; transport remains current. Initial no-B3/B4 calibration scope superseded by VSD-021 |
| VSD-020 | 2026-09-02 | **`docs/vision-study-guide-style.md` is the authoritative editorial reference for B4's proposed player-facing study guide.** It governs question SELECTION and answer STYLE only, never facts: every fact still derives exclusively from that work's validated legacy content and its own B1–B3 evidence/research (never reuse the Julius example's facts). B4 selects the strongest 5–7 genuinely illuminating questions that teach interesting content AND how to read the visible evidence to infer date/artist/medium/place/movement (transferable skill), preserves strong legacy questions, avoids self-evident/redundant-with-hotspot/routine-provenance/acquisition/incidental-biography questions and source-heavy player copy, keeps citations in internal `sourceRefs`, and treats examples as voice illustrations only, not templates. A B4-prompt change currently forks the whole run identity, so reusing existing B0–B3 checkpoints requires migrating them into the new run dir (the controller cannot yet invalidate B4 independently). | Approved; initial prompt implementation tested 2026-09-02; owner-selected legacy north stars added 2026-09-03 |
| VSD-021 | 2026-09-03 | **Restore the intended VSD-005 B0–B4 sequence for the fixed calibration after the lean B1/B2 canary demonstrated value.** B3 is conditional and sees only targeted questions plus the confined sanitized image; B4 is no-image/no-tool synthesis. All outputs remain quarantined, checkpointed, and review-only, with no production sink. Five independent lanes may collect work checkpoints concurrently. | Approved; controller implemented and live-exercised, including one complete B0–B4 canary; no production merge |
| VSD-022 | 2026-09-03 | **Make calibration synthesis and research proportionate before scale-up.** Replace model-generated full-record B4 with a compact editorial delta deterministically hydrated and strictly validated by the controller; treat legacy content as unverified editorial material rather than factual evidence. Narrow B2 toward teaching-relevant, atomic fact-checking for a strong non-specialist reader, normally using 1–2 searches, 2–4 fetches, up to 4 useful sources, and at most 2 targeted B3 requests; preserve qualified/partly-supported claims instead of over-refuting. Existing completed artifacts remain immutable comparison evidence. | Implemented and exercised: compact B4 ran across the calibration cohort; live five-work B2-v2 comparison completed and passed corrected offline review. Later hotspot/lineage behavior is amended by VSD-027 |
| VSD-023 | 2026-09-09 | **Bounded integrity repair after Codex review of the 50/50 run.** (1) Add `VALIDATION_CONTRACT_VERSION` to the run-identity contractHash (covers validation rules, wire schema, B4 hydration, execution-evidence policy) so future runs fork identity when acceptance rules change; `cal50-0a47b6f7f332` is the completed legacy run, accepted via an offline acceptance report bound to the new version (not relabelled, not rerun). (2) Resume now re-verifies execution evidence (raw+transcript SHA, model, apiKeySource, B1/B3 Read, B2 search+genuine fetch, B4 delta→body rehydration); a fabricated transcript SHA fails. (3) STALE (input changed, old artifact still verifies) → atomically archived to `stale/` and re-run; CORRUPT/unreadable/missing-promptHash → preserved and failed loudly (never `rmSync`). (4) Tool-evidence hardened: Read needs a nonempty id + matching non-error image result; WebSearch needs a matching non-error result; WebFetch success uses head+tail (not first-600) so a late 4xx/redirect/no-content marker can't evade. (5) Source-host denylist normalizes (decode/lowercase/strip terminal dots); still no positive museum allowlist (owner decision, VSD unchanged). (6) Player-copy caps RESTORED to `proposedWhy`=500 and note `body`=600 via one shared constant across delta validator, full validator, and assembler, with the accept-then-truncate slices removed (reject, never silently slice). (7) CLI version captured from the transcript init event; a fully-complete no-op resume no longer rewrites manifest/packet. | Implemented + tested offline (66 + 49 checks); acceptance report `acceptance-report.json` = 200/200 raw/body/transcript/model/apiKeySource, 150/150 tool-evidence, 48/50 B4 hydration-equal (+2 pending manual why-trim), 0 integrity failures; the 50 works were NOT rerun or altered. No merge/commit/push/production write. **Follow-on (authorized): a smallest Pass-B guarded approval/apply tool** (`scripts/lib/pass-b-approval.mjs` + `scripts/pass-b-apply-approval.mjs`, 9 regressions) — one work at a time, explicit field-level approval + documented owner edits, bound to runId/workId/imgSha/B4-completion-sha/validation-contract version, reopens+re-verifies evidence, strict-validates the edited record, detects concurrent file changes, atomic write, dry-run by default, never infers approval, never mutates evidence. A PENDING (ownerApproved:false) one-work approval + review card exist for the canary `cleveland170810`; its card flags that the B4 notes/guide still carry internal-production-language leaks ("B3 visual verification…", present in ~20/50 works) that must be edited or a leak-free canary chosen before approval. Nothing approved or merged |

| VSD-024 | 2026-09-09 | **B4 content-quality calibration before any merge (schema-valid ≠ editorially approved).** Owner declined cleveland170810 and forbade switching to another unreviewed canary just for being leak-free. (1) New deterministic **player-copy language gate** (`scripts/lib/public-output-leak.mjs` + `scripts/check-teach-language.mjs`, 6 regressions incl. the real cleveland170810 "B3 visual verification" leak and the historical Neck Amphora "the prompt" leak) with narrow, context-anchored patterns (title/record used as content stay legal); wired into the guarded merge (rejects `player-copy-leak`). Audit of current production found **63 pre-existing leaky works** — flagged, not fixed (no broad audit authorized); gate not yet wired into `test:ci`. (2) **B4 editorial-prompt correction**: hard PLAYER-COPY PURITY rule (never name B1–B4/verification/prompt/model/metadata/pipeline in prose; grounding only via structured refs), guide answers 2–4 sentences, 5–7 questions with the majority teaching how visible evidence infers date/place/maker-or-tradition/movement/medium, no routine biography/provenance/catalog-mechanics/terminology unless transformative, no appearance-only material ID without B2 technical evidence, and an included Julius-Caesar **voice example** (voice/depth only — the earlier fact-free-B4-prompt rule is relaxed for this labeled example; B1/B2/B3 stay fact-free). The 50 existing B4 outputs are unchanged calibration evidence. (3) Prepared a **B4-only 3-work comparison** (cleveland170810, cleveland120847, harvard303416) reusing the exact verified B1/B2/B3 completions — fresh identity `b4v2-8b596dfbcdf9` bound to those completion SHAs + the new B4 prompt hash + validation-contract version, separate dir, B0–B3 never rerun. | Implemented + tested offline (66/49/10/6 checks). Comparison is PLAN-only — no model calls yet; owner-gated run command reported. No merge/commit/push/production write |

| VSD-025 | 2026-09-09 | **B4 guide contract enforced in the validators (prompt-only rules were treated as optional).** Objectively-measurable parts are now hard-validated for a PLAYABLE record: guide has exactly 5–7 items; a STRICT majority are `kind:"image"`; every `kind:"image"` item carries a non-null `evidenceRef` resolving to the evidence/delight namespace; every guide answer ≤ 700 chars (note bodies ≤ 600, why ≤ 500 unchanged). Shared constants `GUIDE_MIN/GUIDE_MAX/GUIDE_ANSWER_MAX` used by the delta validator, the hydrated `validateB4`, and tests; no silent truncation (reject, never slice); no automated biography/"interestingness" classifier. B4 prompt states these enforceable limits plainly (no new section/exemplar). Leak gate widened for "in the catalog(ue)" (excluding "catalogue raisonné") and catalog/record data-source verbs incl. says/calls, preserving "the title suggests", "the model wears", "the historical record of…" (focused +/- regressions). Comparison harness now preserves bounded attempt evidence (raw transcript + attempted delta on failure) and reports duration, model usage, transcript SHA, resolved model, apiKeySource (no secrets). `VALIDATION_CONTRACT_VERSION` bumped 1→2 (rules changed → forks run identity). | Implemented + tested offline (74/50/10/8). Fresh B4-only comparison identity `b4v2-8fcec8cba7a9` bound to the same B1/B2/B3 SHAs + new B4 prompt hash + passBValidation/2. **Awaiting owner authorization for the 3 model calls** — no model run yet; original 50-work run untouched. Decisive test: if guides still read as encyclopedia entries despite passing these gates, stop tuning Sonnet and change B4 strategy |

| VSD-026 | 2026-09-09 | **Accept the Sonnet B4 approach; ship it to the full cohort.** Editorial verdict (owner + Codex): the enforced B4 guide contract (VSD-025) works — Hydria (harvard303416) hits target quality; Door Plaque/Calligraphy are materially improved but still need ordinary human review; a lone 577-char why is a quarantined per-work miss, not grounds for more rules. Do NOT add further editorial B4 prompt/schema rules or raise the 500 why cap. The player-copy leak gate catches museum-as-source phrasing while preserving ordinary museum/title language (`VALIDATION_CONTRACT_VERSION` 2→3). The B4-only continuation reuses verified B1/B2/B3, preserves failures, and never merges automatically. | Executed as `b4c-f45fac18da2e`: 44/50 strict-valid and leak-clean on one attempt per work; 6 quarantined; original B1–B3 and B4 evidence preserved |
| VSD-027 | 2026-09-14 | **Separate Pass B editorial lineage from spatial anchoring and make review metrics literal.** `ref` records which legacy/B1 item a delta derives from; hotspot `pinRef` independently selects a matching pinned B1 candidate. Hydration may fall back to the sole pinned candidate sharing an `evidenceRef`, then to the center of a bbox covering less than 65% of the image. Missing/near-full-frame anchors never become center pins or whole-image regions. Same-evidence and <3-point-overlap proposals retain the first-ranked hotspot and record every suppressed proposal/reason for review. Packet lineage joins only surviving actions and reports verbatim, revised/replaced-from-legacy, explicit or implicit removal, and new questions separately; component-mismatched legacy refs are not credited as preservation. “Zero legacy kept” is replaced by “zero legacy-derived.” | Owner approved; implemented offline with `passBValidation/4`, focused regressions, and immutable-source rehydration `b4r-8f1f74ddc30f`: 44/44 strict-valid, hotspots 210→195, coordinate changes 137, overlap pairs 45→0, 15 proposals retained for attention, 1,207/1,207 source files unchanged |
| VSD-028 | 2026-09-14 | **The Pass-B editorial packet must be an actual review instrument, not a read-only report.** Every proposed hotspot gets a stable P/S label matching the image, its player-facing description, grounding id/axis, and a plain-language placement/suppression explanation. The owner can choose a work disposition, write free-form notes, decide keep/move/drop per hotspot, retain a useful non-localizable suppressed proposal as an unpinned note, and select a replacement position by clicking the image. Input auto-saves locally and exports as JSON bound to the packet run and evidence manifest. A later approval transform must deduplicate keep-as-note choices against existing notes before creating an unpinned note; the review packet itself changes no content. Ordinary works start collapsed; current placement/legacy blockers and quarantines start open. Within an open work, the image remains sticky at left while review controls and before/after text scroll at right. These inputs remain quarantined review recommendations: they never mutate evidence, count as production approval, or reach the guarded merge without a later explicit approval artifact. | Owner approved; implemented in the self-contained full-cohort review packet with focused offline regressions |
| VSD-029 | 2026-09-15 | **Learn spatial presentation from the owner calibration without requiring work-by-work review at corpus scale.** Editorial usefulness, presentation mode, and coordinates are independent. A prior pin is a first-class candidate only when the image SHA is unchanged; B1 and legacy candidates are compared rather than trusted by ancestry. Local details and honest representative examples may be pinned; distributed/global observations become notes; duplicates merge; not-found, ambiguous, or low-confidence results are held. Spatial suppression never deletes content. Unanswered controls are abstentions, and old undifferentiated `drop` choices are not negative content labels. A post-B4 localization-only stage may receive the image, short visible-target labels, and legacy/B1 candidate points, but no catalog/research context, player explanations, owner notes, or owner coordinates; it may return only spatial scope, point, confidence, and reason. Score the frozen owner placements only after completion, then calibrate an auto-policy and review exceptions plus the VSD-011 sample. | Owner approved. Offline policy/report, packet v2 semantics, strict localizer schema, and a ten-work plan-only canary are implemented and tested; the canary has not run, no preserved evidence/body/approval/production data changed, and `passBValidation/4` remains current until any localizer is integrated |
| VSD-030 | 2026-09-15 | **Use blind localization to validate candidates, not to gratuitously replace them.** The first VSD-029 canary (`b5c-bb6247e13e73`, 10/10 strict-valid, 44 targets) improved large misses but its favorite-point contract moved some already-valid pins and raw point distance penalized alternative valid examples of repeated features. The corrected contract independently marks each candidate valid/invalid/uncertain; deterministic resolution keeps a valid current point as a no-churn tie-breaker, otherwise another valid prior point; an uncertain candidate holds; and a fresh suggestion is usable only when every candidate is invalid. Long B1 grounding/explanation prose is excluded: the blind call receives only the image, short target title, and candidate points. Invalid completions never enter scores. Unique-point distance is the primary coordinate metric using interpolated quantiles; representative distance is diagnostic, while global/distributed results are note-route outcomes. Because even a short target title can contain a claim, this remains spatial validation, not factual or identity adjudication. | Owner approved and implemented. The final canary `b5c-f2020a1d8cca` completed 10/10 strict-valid, no retries: 44 decisions/77 candidate assessments; scopes 19 point, 9 representative, 8 distributed, 4 global, 3 ambiguous, 1 not-found; deterministic routes 27 pin, 12 note, 5 hold; 23 existing candidates selected and 4 new points suggested. Against 17 comparable owner-labeled unique points: 9 within 5, 12 within 10, median 2.89, interpolated p90 21.84. This validates the contract and exception routing, not universal coordinate accuracy; no auto-policy threshold, approval, merge, or production write is authorized |

## Maintenance protocol

Every change that alters product intent, stage boundaries, schemas, completion semantics,
publication authority, security boundaries, scheduling, or budgets must:

1. cite one or more `VSD-*` decisions (or add a new one);
2. update the affected normative section;
3. append a decision-log row rather than erasing the old decision; use `Superseded by
   VSD-…` when a decision changes;
4. update the implementation-status table honestly;
5. update `docs/PIPELINE.md` in the same change once behavior actually ships; and
6. add or update a gate/test that detects drift where the rule is machine-checkable.

Plans and chat transcripts may elaborate this record, but they may not silently override
it. When an agent starts vision work, it must read this document before proposing or
changing the pipeline.
