# Vision system: canonical decisions and operating contract

**Authority:** owner-approved product and operating intent
**Last owner confirmation:** 2026-09-22
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

### Launch scope and subscription budget (VSD-041–044, owner confirmed 2026-09-22)

Pass B uses the owner's Claude Max 5x subscription only, with almost all available weekly
capacity allocated to enrichment and no deadline. No incremental API spend is authorized.
The historical measured-usage estimate (about $6.9k interactive / $2.7k batch-optimized for
the remaining corpus) motivated this choice; those estimates are not current price quotes
or a throughput guarantee. Pass A's separately approved research budgets are unchanged.

Maintain a rolling 30-day daily buffer, roughly 600 unique works with about 20 entering per
day. Process scheduled works by their earliest date; Easy and the wider corpus wait until
separately authorized. The initial collection horizon is today's Pacific date through the
following 29 dates; it never rewrites daily scheduling or player history.

Gesso is already live. Public announcement is gated on the next 30 days having completed
the full B0–B4 pipeline and publication through an approved auto-policy, with no legacy
teaching content left visible on upcoming dailies. Legacy coverage does not satisfy the gate.
This supersedes VSD-014 for the public-announcement gate; it does not itself change the
live site's schedule, approve any content, or authorize collection calls.

The owner will not manually audit every work. Auto-audit and auto-publication are the
intended path, with VSD-011's one-time 50-work calibration and 2/100 sampling available as
the review proposal. The specific policy, risk thresholds, holdout size, higher launch sampling,
subset teaching bar, and enrichment-based rescheduling remain proposed. The draft in
`tasks/pass-b-auto-publish-policy-draft.md` is not approval. VSD-034's frozen labeled holdout,
critical regression challenges, existing owner-review classes, and current release gates remain.

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

**Structured B4 fork (VSD-039).** New B4 calls use `contentVisionB4Delta/3` and
`passBValidationB4/1-structured-grounding`, independently of the already-banked B1–B3 contract.
The delta proposes exact claim/observation refs for `why`, each replacement cue, and each
note/hotspot/guide delta item; it also gives every conflict and open claim an explicit component
scope. Hydration alone translates those temporary targets into stable final component ids. Invalid
or dangling refs reject the delta; a target lost during hydration (for example, a suppressed
unlocalizable hotspot) widens the affected conflict/open claim to work scope. The hydrated
`passBStructuredGrounding/1` sidecar contains proposals only. The wire retains
`conflicts[].resolution` and `conflicts[].status` as **model proposals**; they never establish
effective/controller resolution. There are no authority, effective-state, approval, or eligibility
fields. This corrects the earlier VSD-039 wording that claimed the wire had no resolution field.
Reconciliation policy `passBReconciliationPolicy/2-structured-b4` consumes the translated scope but continues to hold
model-proposed grounding for review. Archived `/2` deltas remain deterministically rehydratable and
retain reconciliation policy `/1`; the 44 baseline sets are not regenerated.

**Bounded structured-B4 canary (VSD-040).** Before any corpus B4 continuation, a ten-work smoke
reuses the exact preserved B1–B3 completion/raw/transcript bytes from the fixed calibration and makes
B4 delta `/3` attempts with no research/image/web capability under a hard cap of ten durable pre-call reservations. Its pre-call manifest
binds those source bytes, effective B4 prompts, command policy, model, schema/validation versions,
and canonical blocked-finding ids. Before invoking a call, the runner exclusively creates (`wx`) and flushes
`attempt-N.reserved.json` and its directory entries. Reservations count toward the global cap and
contiguous attempt numbering across resumes. This cap assumes preserved evidence in the trusted local
filesystem; deleting reservation history can erase spent slots and is outside the guarantee.
A reservation without complete transcript/result/meta evidence is a consumed, terminal
`unknown-outcome` and is never called again. Preserved reservation
and verified attempt evidence, not `checkpoint.json`, determine state: `accepted`, `held`, `fatal`,
and `unknown-outcome` are terminal. Only a preserved `usage-limit` rejection may retry after reset;
each retry needs a new slot, and the old reservation still counts. Under execution contract
`passBStructuredB4Canary/5`, at least one initialization event is required and **every** init must
report `apiKeySource:none` and exactly `tools:["StructuredOutput"]`; a later clean init cannot mask
an earlier wrong/missing source or extra tool. Successful acceptance requires exactly one
`tool_use` named `StructuredOutput`, the CLI's built-in `--json-schema` output adapter. Every other
`*tool_use`, every server tool (even one named StructuredOutput), extra init tool or model drift
is fatal. Duplicate adapter emissions are instead a terminal conformance `held`, even if the final
body validates or a usage-limit follows; they consume their reservation and never retry, but allow
other works to proceed. This corrects `/4`'s false classification of adapter repetition as a provenance
violation. Missing emission cannot be accepted; interruption/usage-limit
semantics remain unchanged. This explicitly corrects `/3`'s false assumption that the adapter event
was an ordinary tool capability. No research, filesystem, image or web tool is authorized.
The command policy binds a **15-minute** process timeout with `SIGKILL`: 49 preserved B4 results had
median 184.391 s and maximum 302.585 s; the new La Gloire call was censored at 360 s. The 900 s limit
provides roughly three times the historical maximum and 2.5 times that lower bound, not a completion
guarantee. Captured timeout evidence is
terminal `held` (or `fatal` when provenance fails), never a usage-limit retry. Incomplete preserved
evidence remains terminal `unknown-outcome`; when its preserved transcript reveals a fatal provenance failure, `transcriptDerivedKind: "fatal"` exposes that diagnostic without upgrading the outcome or allowing a retry. These checks are local to fresh B4 canary attempts;
the banked B1–B3 contract is unchanged. Any preserved fatal anywhere in the run stops
all calls before scheduling; unknown outcomes also stop the run. Reports expose all preserved work
states even when execution stops before a later work. Shape/hydration/leak/reconciliation failures
are held without retries. The runner verifies the canonical sealed-finding artifact and binds its
La Gloire/St. John finding IDs; it has no resolution/approval path. `sealedHold` reports those IDs'
presence, not an effective/controller resolution. `accepted` means only execution,
schema, hydration, scoping, and fail-closed reconciliation integrity: factual accuracy and release
eligibility remain unmeasured. The runner defaults to a read-only plan and requires a separate live
environment gate; no call is authorized by the implementation itself.

The owner-run `/3` smoke `b4s-016f64c8e0ca` spent two reservations and stopped: La Gloire was held
at the six-minute timeout; St. John was falsely classified fatal on its single StructuredOutput
emission, despite clean model/subscription provenance. That run and its terminal report remain
unchanged. Offline replay of that St. John transcript passes schema/scoping
integrity with 17 bound components and 21 review-required / zero eligible components, but its guide
still presupposes a crouching animal and an open claim says it may be a lion. That preserved semantic
failure is an A4 presupposition/aliasing challenge, not evidence of factual success.

The separately owner-authorized `/4` smoke `b4s-18bc5fb62997` also remains terminal and unchanged:
three reservations, two schema/scoping acceptances (La Gloire and St. John), and one false provenance
fatal (Hydria). Hydria emitted StructuredOutput twice after the CLI rejected the first malformed JSON;
its final body validates offline. Under `/5` that transcript is held, not accepted or fatal. Both spent
runs retain their original reports; no slots are refunded or reopened. `/5` has a distinct plan identity,
`b4s-2dcb6f0830f1`, and refuses earlier contracts. No further smoke is authorized by this correction.
Smoke #2's preserved report has zero eligible / 18 review-required / 25 blocked components. The owner
reported a recurring semantic failure in La Gloire (affirmative wings unsupported by B1 and a striding
writer despite the cited sleeping figure); St. John's lack of an animal presupposition on this run does
not establish reliable correction. Model schema acceptance remains separate from factual approval.
Real transcript fixtures cover both Hydria and the older duplicate-adapter case, as terminal holds.

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
- “Image bytes are unchanged” must be established by a separately captured historical-image
  receipt, never by copying the current B0 image SHA into the legacy side of the comparison.
  When that receipt is absent, the old point is ineligible for automatic spatial reasoning.
  A review UI may still display it as an explicitly unverified historical reference; if the
  owner selects it while viewing the current image, the resulting coordinate is a new
  owner-authored current-image judgment, not retroactive proof about the legacy image.
- A localization checker validates every same-image candidate independently. It does not
  replace an honest candidate with its preferred point: the controller keeps the current
  point when valid (a no-churn tie-breaker), otherwise another valid prior point. An
  uncertain candidate blocks a fresh point. A first checker may propose a new coordinate only
  after every candidate is invalid, but that proposal remains held until a fresh-context blind
  checker—shown no earlier coordinates or reasoning—independently returns a compatible spatial
  reading at confidence ≥0.75. Matching unique-point answers must land within 5 percentage
  points or hold. Two distant representative examples demonstrate that no single example is
  canonical and route to an unpinned note. A second checker that identifies a proposed point
  target as distributed/global likewise routes it to a note; this is also an explicit compound-
  target signal. Other scope disagreements require human review. This selection is deterministic
  and never rewrites the observation.
- Spatial auto-resolution has three explicit trust classes: a validated existing candidate
  may remain a pin; a confidently distributed/global observation may become an unpinned note;
  and a new point may become a pin only after the independent agreement above. `notFound`,
  ambiguous, low-confidence, incompatible-scope, and unique-point-disagreeing results remain held.
  A hash-bound offline resolver exposes only those holds in the owner packet; safe pin/note routes
  remain recorded in the machine-readable report but do not consume review attention.
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
count before expanding. VSD-043 now requires a completed and approved 30-day window before
public announcement; that launch gate is not yet implemented. Rescheduling for insufficient
enrichment, beyond VSD-010 image disposition, remains an unapproved policy proposal.

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

### Content-correctness and reconciliation (VSD-034/035)

Pass B has strong per-stage integrity (hash- and transcript-bound completions, strict
schemas, the G-03 boundary) but no cross-stage content-correctness layer: `strict-valid`
guarantees shape and reference integrity, not that a record's player copy, internal index,
and grounding agree with each other or with the evidence. Content-correctness is a
cross-stage concern owned by the deterministic controller, never by the synthesis model.
The model may assert and propose; only a controller rule, an authoritative-source
adjudication, or an owner artifact establishes an effective claim decision, and those
transitions are ordered/superseding within one decision artifact and reopenable on new
contradictory evidence. Cross-set history is preserved operationally but is not a signed ledger.

Publication is evaluated at component granularity, so one blocked claim holds only its own
component. The searchable rich index is built from accepted claims and provenance-bearing
catalog claims, never from raw B1 hypotheses. Reconciliation is a content-addressed,
tamper-evident report bound to the preserved B0–B4 + legacy/derived ancestry and the exact
projected production components, not a mutation of any completion. The local evidence and
reconciliation tree is a trusted-filesystem boundary: hashes detect drift/substitution but do
not authenticate a hostile writer. B2 verdicts, B3 confirmations, B4 corrections, conflict
resolutions, and uncertainty are proposals/evidence only; none establishes effective truth.
The schema reserves accepted-claim eligibility for a future separately authorized grounding
artifact, but that mechanism is not built and post-hoc grounding edits to the source bundle fail.
Today, an exact owner component decision bound to every applicable conflict is the only release path. An
authoritative source may adjudicate a claim with a stored source-span record but may not
directly approve finished player copy; retrieval-byte/excerpt entailment enforcement remains
unbuilt. The existing B4 adapter
is deliberately conservative: coarse/unmapped grounding, free-text uncertainty, and
unresolved/model-resolved conflicts stay held. A known-bad completion is permanently blocked;
a genuinely fresh completion of that work additionally needs a bound resolution of every
canonical blocked finding.

VSD-035 implements this fail-closed layer and makes it mandatory in the one-work guarded
approval path. It does not authorize auto-policy, a curated index, or automated semantic
acceptance. The entity smoke proved schema emission, not correctness; the frozen owner-labeled
holdout and VSD-011 human sampling remain required before any auto-policy. See VSD-034/035.

**Identity precedence and omission (VSD-037).** For the identity-bearing axes — medium; human
versus animal; named figure identity or role; and discrete identity-bearing iconography such as
wings, skull, coffin, or attribute — a model/vision-only claim that conflicts with an
authoritative exact-span claim (or a sealed audit finding) may be preserved only as disputed
diagnostic evidence and must never appear affirmatively in player copy; B4 does not adjudicate
the conflict. When authoritative evidence establishes the subject but vision cannot reliably bind
it to a region, the source-grounded explanation is kept as an unpinned note/guide item, the
region binding is marked unresolved, no pin is invented, and the model's competing entity
classification is never substituted — preserve the knowledge, hold the pin, not the reverse. The
durable enforcement of this rule belongs to reconciliation + explicit owner edits/decisions keyed
on stable component/claim ids; lexical matching cannot honestly enforce a general identity policy.
**Implementation status: review projection only.** `scripts/lib/pass-b-identity-precedence.mjs`
is a conservative, deterministic owner-REVIEW omission aid (it only ever omits on a disputed axis,
never affirms, holds all bindings for review, and accepts no caller-supplied authority override);
it is composed by the owner-review generator and is **not** wired into guarded approval
(`buildApproval`/`applyApproval` do not call it) or into reconciliation. The two fresh content-repair
runs' active reconciliation reports remain bound to the full (unfiltered) projection and block both
works on their own; they were **not** regenerated to match the lexical filter. The corrected
owner-review candidates are authored offline, unapproved, and unbound to reconciliation, and
La Gloire's definitive Musée Carnavalet primary span was retrieved and bound in the run's
owner-review evidence (it supports the named figures, woman/nude/draped, sleep, and coffin, and
refutes the figure-role inversion; it establishes only that a skull/wings are *not mentioned*, not
that their absence is entailed — that absence stays grounded in the sealed audit and eventual owner
adjudication; plaster rests on Wikidata + the sealed audit). Guarded-approval/reconciliation
integration on stable ids is unbuilt.

**Coupling and empty surfaces (guarded approval).** Because notes carry pins and hotspots are pins
over the same notes, `passBApproval/3` enforces a **one-way** coupling: approving/changing notes
requires re-approving hotspots (`surfaceCouplingViolation`), rejected at both `buildApproval` and
`applyApproval`; approving hotspots alone is allowed (coordinate-only review while notes stay
unchanged). It also runs a **final production-projection validator** over the exact projected
why/cues/guide/notes/hotspots bytes (types, 0–100 coordinates nullable on notes but required on
hotspots, unique integer hotspot ranks, and every rank referencing an existing projected note),
because strict B4 validation re-applies only the `why` owner edit. Clearing a collection surface to empty is not automatic: an
empty collection is the stable `<surface>-set:empty` component, which is review-required by default
and becomes publishable only via an explicit owner component-accept on that component id — no
separate empty-surface concept and no auto-eligibility. The corrected La Gloire/St. John candidates
enter as owner edits with hotspots cleared to `[]`; they are presented as **unresolved owner
proposals** and create no effective decision, resolution, or activation until the owner explicitly
approves that exact artifact.

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

Under VSD-042, current collection stops at bands 1–2. Order those works by earliest
Pacific daily date; rotate region, image source host, and medium only within the same date.
The remaining bands are retained for later scope, not automatic fall-through. Highest-fame
quintiles are calculated within each of Medium, Hard, and Impossible, not pooled.

## Unattended operation

Use a deterministic Node supervisor launched by macOS `launchd` every 10–15 minutes.
Do not use an LLM loop to supervise another LLM. The laptop is expected to be powered on
and logged in.

### Subscription-protected schedule

Timezone: `America/Los_Angeles`.

- **00:00 inclusive–08:30 exclusive:** the only automated call-start window (VSD-045).
- **08:30:** stop starting every stage and retry, including later stages of an in-flight work.
- **By 09:00:** in-flight client processes must finish or be terminated.
- **09:00–24:00:** zero automated Pass B calls. This supersedes VSD-013's 22:00 start;
  supervised collector invocation does not bypass the gate.

The collector implements these checks before each invocation and caps client execution at
30 minutes and the remaining 09:00 deadline. A recorded deadline termination is a scheduling
pause; an earlier hang timeout is a terminal hold. Other experimental entry points are not a
replacement for this scheduling gate; their operators must obey the same operating intent.

Fresh collector calls disable the child CLI auto-updater and bind an exact runtime in an
append-only execution-policy epoch. Each reservation is checked against its own epoch;
a later reviewed runtime upgrade never relabels banked attempts. Runtime drift pauses
collection. A separate, explicit offline runtime review binds the current epoch and exact
target policy before a successor can be appended; it authorizes no calls or content.
Provenance, confinement, model and subscription-source failures remain durable fatal stops.
Operational exceptions stop execution without manufacturing a permanent fatal finding;
unknown reserved outcomes still stop resume for review. See the runbook's reviewed recovery
procedure. None of this changes the B1–B3 content contract or creates release authority.

VSD-041 supersedes the earlier 50→70→75% capacity-allocation target: the owner now
allocates almost all weekly Max 5x capacity to Pass B. This is an allocation preference,
not a known numerical allowance or permission to bypass usage-limit stops. Do not buy or silently use extra API credits for Pass B. The child process must
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

## Implementation status as of 2026-09-22

| Capability | State |
|---|---|
| G-03 hardened broker, tool-less paid runner, hash/evidence-bound guarded merge | Implemented on feature branch `g-03-image-agent-boundary` at `2186a00`; preview-built, not production |
| Current Pass B schema | Strict B1–B4 calibration schemas, structure-only wire schemas, cross-reference validation, and hash-bound stage capture are implemented and exercised in feature-branch calibration code; they are not connected to production. The full-record B4 output contract was replaced by compact-delta wire + deterministic hydration (VSD-022). `passBValidation/4` remains the banked B1–B3/shared evidence contract; new B4 calls fork independently to `contentVisionB4Delta/3` + `passBValidationB4/1-structured-grounding` (VSD-039). Archived B4 `/2` remains supported |
| Pass B offline coverage inventory + rich legacy adapter | Implemented 2026-09-02: deterministic 6,557-row `contentVisionCoverage/1` generator; all 202 `vision.js` records verified as a **lossless round-trip via retained record- and item-level raw copies** (`palette`/`figures` are decomposed; other fields are whole-value projections) — a full shape-aware migration that drops the raw copies is **not** yet built; rich authoritative component ledger is still unbuilt |
| Current approval | The quarantined full-cohort packet captures non-authoritative work decisions, per-work notes, and explicit per-observation pin/note/discard/abstain choices (including click-to-place coordinates) in browser-local state and exports a run/evidence-bound JSON handoff (VSD-028/029). VSD-032 adds an exceptions-only spatial packet with full player copy, current/previous/first/second coordinates, click-to-place, note/split/discard choices, local autosave, and JSON export. A separate one-work, hash-bound guarded Pass B approval/apply path supports explicit field-level owner approval and labeled owner edits; no calibration record is yet approved. Auto-policy and component-ledger publication remain unimplemented |
| Pass B subscription-backed image process | Transport CORRECTED 2026-09-02 (VSD-019): the zero-tool `@<sha>.png`/base64 attach was proven NOT to deliver image bytes in the lean controller's headless invocation (3 fresh B1 runs hallucinated 3 different works from one correct derivative). Replaced by a **Read-tool confined-directory** transport (`--tools Read`, one SHA image in a fresh temp dir), verified via a real Read `tool_result` image block; execution is proven from the raw `stream-json` transcript |
| Pass B calibration controller (B0–B4) | Implemented and live-exercised: Read-tool image transport; transcript-verified B1/B3 image reads and B2 WebSearch+WebFetch; strict stage capture; resumable checkpoints; five lanes; and quarantined before/after review. The fixed 50-work B0–B4 calibration completed in `cal50-0a47b6f7f332`; the accepted B4-v2 continuation produced 44 strict-valid/leak-clean records and quarantined 6 first-attempt misses in `b4c-f45fac18da2e`. Under VSD-027 those 44 were rehydrated offline into `b4r-8f1f74ddc30f`: 1,207 source files remained byte-identical, all 44 strict-valid, hotspot overlap pairs fell 45→0, and lineage reporting was corrected. Nothing is connected to production; human review and guarded field-level approval remain required |
| Pass B separate no-image research and conditional second look | B2 no-image research and conditional B3 targeted image verification are implemented and live-exercised. The VSD-022 teaching-target/source-budget revision (B2-v2) is **implemented and passing offline** 2026-09-03: SAT-caliber non-specialist reader; conditional research; budget (1–2 searches, 2–4 fetches, ≤4 sources); source-priority ladder; atomic claims; `qualified`/`partlySupported` verdicts; high-confidence refutations require a corroborating non-Wikipedia/non-UGC source (host-parsed; a positive museum/scholarly allowlist is a pending owner decision); attribution distinguished from prototype/lineage (Clouet). B3 requests capped at 2 with the dropped count surfaced (status.b3Dropped). The B2 web-research gate now counts only genuinely-retrieved pages (a 4xx/redirect envelope is not a retrieval). A live 5-work v1-vs-v2 comparison ran 2026-09-03 (5/5 strict-valid; research collapsed; over-refutations corrected) and passed Codex adversarial review with corrections applied; results quarantined, nothing merged. Strict-valid = shape + reference integrity, not factual entailment — human review remains the factual gate |
| Pass B synthesis | **Compact editorial-delta B4 + deterministic hydration is implemented, tested, and run across the 50-work calibration.** VSD-027 separates editorial `ref` from spatial `pinRef`; VSD-029–032 add spatial candidate validation, independent confirmation, and scope-aware note routing. VSD-033 fixes a provenance-input defect in all five spatial callers: legacy coordinates now enter automatic reasoning only through an explicit historical-image receipt, and unknown provenance fails closed. Spatial packet status is explicitly orthogonal to content approval. The earlier `b5c-f2020a1d8cca` / `b5r-3a5ea5ed593f` measurements remain preserved diagnostic history but are stale under `passBSpatialCalibration/7` because their legacy-image equality was not genuinely established. No replacement canary has run, no corpus-scale auto-policy is approved, and no Pass B output is connected to a production sink |
| Pass B structured B4 fork | **Implemented (VSD-039); two owner-run VSD-040 smokes spent five delta `/3` reservations, with four completed outputs available for offline evaluation.** The model emits structured claim/observation bindings and component scopes only; deterministic hydration validates and translates them into stable final ids in `passBStructuredGrounding/1`. Dangling refs reject; suppressed/untranslatable targets widen the concern to work scope. Reconciliation policy `/2-structured-b4` consumes the exact scope while retaining model grounding as a non-authoritative proposal. Archived `/2` deltas and all 44 policy-`/1` baseline sets remain valid and were not regenerated. No release authority, approval, or production path was added |
| Pass B structured B4 canary | **Execution `/5` implements the narrow duplicate-adapter correction offline; 127 canary checks pass.** Both owner-run smokes remain terminal and byte-preserved: `b4s-016f64c8e0ca` spent two reservations; `b4s-18bc5fb62997` spent three (two accepted, Hydria falsely fatal). New plan `b4s-2dcb6f0830f1` has no directory or calls. Every init still requires subscription provenance and exactly `[StructuredOutput]`; one adapter emission is required for acceptance, duplicates are terminal held, and other/server tools or extra init capabilities remain fatal. Real Hydria final output hydrates validly but stays held, consumes its slot, never retries, and does not stop other works. Timeout remains 900 s. Smoke #2 reports zero eligible / 18 review-required / 25 blocked; semantic failures persist. Reservation accounting, checkpoint-independent terminality, usage-limit-only retries and global fatal/unknown stops remain enforced. The frozen B1–B3 inputs and delta `/3` contract are unchanged. No resolution/approval path or further live authorization |
| Pass B content-correctness / reconciliation | **Fail-closed reconciliation implemented offline and enforced in guarded approval (VSD-035/036); no record approved or published.** The preserved entity smoke `b6c-aafea89438d0` completed 6/6 provenance-clean subscription calls and 6/6 schema-valid emissions, but remains `measurementReadiness:"blocked"`: seeded-label accuracy is diagnostic only and real-scene alias precision/recall is not established. `passBClaimBundle/1` + `passBClaimDecisions/2` + `passBReconciliationReport/1` bind manifest-listed B0–B3/source-B4 bytes, deterministic B4 rehydration, the recorded image SHA (not a fresh image-byte receipt), B1/B3 observations, B2 claims, B4 corrections/conflicts/uncertainty, exact projected components and source-derived grounding. Model verdicts/self-resolutions/grounding never approve; missing/stale/tampered artifacts fail closed; owner component acceptance names every applicable conflict; source authority currently requires a stored span record but retrieval-byte/excerpt verification remains unbuilt. The tree is content-addressed and tamper-evident within a documented trusted-filesystem boundary, not cryptographically authenticated against a hostile local writer. `passBApproval/3` re-verifies reconciliation at stage/apply, preserves unapproved production fields, enforces a one-way notes→hotspots approval coupling, and structurally validates the final production projection (VSD-037). The 44 baseline sets are materialized under `b4r-8f1f74ddc30f/reconciliation`; current result is 50 works = 0 eligible, 8 review-required, 36 blocked, 6 quarantined, 0 errors. **VSD-037 (2026-09-16): the two-work content-repair canary `cr2-af3d6ed79c1c` ran both sealed works fresh under the corrected contract; both re-introduced their canonical errors (content-repair failures) and both were caught by every layer (blocked-findings + `contentReadiness:blocked`). A deterministic `pass-b-identity-precedence.mjs` omission aid keeps disputed vision-only identity/medium/iconography claims out of affirmative copy and holds bindings for review — but as a REVIEW PROJECTION ONLY; it is not wired into guarded approval or reconciliation, and the active reconciliation reports were NOT regenerated to match it (they stay bound to the full projection and block both works). Corrected owner-review candidates are authored offline, unapproved, and unbound to reconciliation; both content-failure B4 bodies are preserved and asserted by a test in `npm test`/`test:ci`.** The VSD-039 fork supplies stable structured model proposals but does not itself establish release authority or implement auto-acceptance. Auto-policy, curated index, cryptographic principal identity, and automated semantic acceptance remain unbuilt/unauthorized |
| Pass B component coverage/staleness ledger | Offline baseline inventory implemented; authoritative component writes, approvals, and staleness transitions remain planned; current live ledger is narrower |
| Pass A adaptive ladder | Historical code/data exist; retained as the VSD-003 low-cost operational probe, not the frozen v2 method |
| Pass A recognition-inference pilot | Completed 2026-09-01: protocol freeze `5ea28c8`, sealed collection `9bcd580`, corrected Study-B closure `6a555af`; results are research-only and do not drive tiers |
| Pass A survivor/censoring semantics and per-call checkpoints | Implemented and exercised in the completed pilot; raw responses remain append-only/hash-bound and non-monotonic vectors/censoring are preserved |
| Pass A automatic tier use | Intentionally disabled/not implemented |
| Pass B corpus resume and 30-day scheduler (VSD-041/042/045) | Implemented offline as `passBCorpusCollector/4`, with 73 regressions: read-only plan; completion/raw/transcript/image re-verification; evidence-derived terminal holds; durable fatal stop; repair of missing raw evidence; Pacific date-first 30-day queue; every stage/retry guarded by 00:00–08:30 starts and a client timeout before 09:00. Banked evidence identity stays `corpus-b3-6401bc543ead` under the unchanged B1–B3 `/2` collection contract; fresh execution gets immutable `/4` policy epochs with per-reservation CLI bindings, child auto-updater disabled, and an explicit reviewed runtime-rebind path. CLI drift/operational errors pause; provenance/confinement/model/subscription-source failures remain fatal. Deadline kills pause; B2 usage rejection preserves only the unspent validation retry. Historical runtime labels and evidence bytes are not rewritten. Offline repair restored 75 raw files for 25 migrated works and re-held ten genuine failures; 416 completions verify, 129 done / 23 held / 500 attempts. No collection resumed. Publication-safe frozen legacy input/per-work staleness (F2) remains unbuilt |
| Public-announcement content gate (VSD-043/044) | Owner intent recorded; enforcement, approved auto-policy, calibrated semantic acceptance, publication/rollback, and rolling nightly job remain unbuilt. The v2 policy is proposed, with remaining review findings recorded separately; no publication or rescheduling authorized |
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
2. What observable usage/reset signal can safely use the VSD-041 allocation within the
   actual Max 5x limits and the VSD-045 start window? No absolute weekly capacity is assumed.
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
| VSD-013 | 2026-08-31 | Protect subscription capacity 09:00–22:00 Pacific; run unattended overnight, starting at a 50% conservative budget. | Historical decision: start window Superseded by VSD-045; capacity allocation Superseded by VSD-041. Supervisor unimplemented |
| VSD-014 | 2026-08-31 | Do not add a universal hard daily-completion gate until audited coverage is sufficient. | Superseded by VSD-043 for the public-announcement gate; history/live schedules unchanged |
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
| VSD-031 | 2026-09-15 | **One blind localizer may preserve an existing candidate or classify note scope, but may not auto-resolve a coordinate it invented.** Spatial resolution has three calibrated trust classes: (1) a high-confidence validated existing candidate may remain a pin, with current winning only as the no-churn tie-breaker; (2) a high-confidence distributed/global observation may become an unpinned note; (3) a newly proposed point requires a separate fresh-context blind image call. The confirming call receives the image and short target label only—no first/candidate/owner coordinates and no first-pass reasoning—and must return the same `point`/`representative` scope at confidence ≥0.75 with a point within 5 percentage points. The first coordinate is preserved when confirmed; low confidence, `ambiguous`, `notFound`, scope disagreement, or distance >5 holds for review. Confirmation results are hash-bound to the verified first run and remain calibration-only. | Owner approved and implemented. Re-resolving VSD-030 yields 23 existing pins, 12 notes, and 9 holds; its 4 first-pass new points were independently checked in `b5k-9e3a46a675ae` (4/4 strict-valid, no retries, `apiKeySource:none`). Zero became pins automatically: Virgin neck holes = confidence 0.72 plus point/representative mismatch despite 5-point separation; Leda coiffure = same scope but 11.66-point separation; La Gloire compound base/top = distributed scope disagreement; Drowned Land representative trunks = 25-point separation. This initial rule held all four; VSD-032 later routes the latter two to notes without weakening the new-pin rule. No approval, merge, or production write |
| VSD-032 | 2026-09-15 | **Use independent disagreement to distinguish “no trustworthy pin” from “bad observation,” and make the owner review only irreducible exceptions.** A high-confidence confirmation that classifies a first-pass point/representative target as distributed/global is positive evidence for an unpinned note, not a reason to discard the observation; record it as a compound/spatial-scope signal. When two high-confidence `representative` checks choose distant but honest examples, route to a note because the feature is set-valued and no example is canonical. When two `point` checks differ by more than 5 points, continue to hold. An offline resolver must re-verify source-record, input, transcript, structured-output, exact-image receipt, model, and `apiKeySource:none` bindings for both passes, then write an immutable derived report. Its self-contained owner packet contains only holds and exposes full player copy, every available current/previous/first/second coordinate, manual click placement, note/split/discard/abstain decisions, notes, local autosave, and JSON export. It is not an approval artifact and has no production sink. | Owner approved and implemented. Current-policy resolution of `b5c-f2020a1d8cca` + `b5k-9e3a46a675ae` is `b5r-3a5ea5ed593f`: 44 targets → 23 pins, 14 notes, 7 holds across 6 works. The La Gloire base/top compound and the divergent Drowned Land representative trunks now safely retain as notes; Virgin neck holes, Leda coiffure, and five ambiguous/not-found/low-confidence claims remain exceptions. No model calls, evidence edits, approval, merge, or production writes |
| VSD-033 | 2026-09-15 | **Fail closed on legacy-image provenance and keep spatial resolution orthogonal to content approval.** A legacy coordinate is eligible for automatic comparison only when B0 carries a separate `passBLegacyImageReceipt/1` whose SHA was captured at legacy generation or verified from an immutable artifact. The current B0 image SHA may never be reused as the historical input. Unknown provenance is ineligible. Review may display an unverified historical point, but an owner who selects it while viewing the current image creates an owner-authored current-image coordinate. Spatial packet statuses and summaries must say spatially resolved/routed and must never imply factual, editorial, or combined approval. Existing B5 runs whose inputs used fabricated equality remain immutable diagnostic evidence but are stale under the corrected policy. | Owner approved after forensic audit; implemented offline as `passBSpatialCalibration/7` in all five call sites, packet-v3 semantics, and focused regression coverage. No replacement model run, approval, merge, or production write |
| VSD-034 | 2026-09-15 | **Content-correctness is a cross-stage concern owned by the controller, not the synthesis model; specify it now, build only what measurement justifies.** The La Gloire/St. John audit showed `strict-valid` means shape/reference integrity, not that player copy, internal index, and grounding agree with each other or the evidence; the failure classes are assert-vs-hedge, stale internal index, missing/conflated content-readiness status, intra-record entity aliasing (one region, two incompatible identities, no declared conflict), positive omission, resolution authority (the synthesis model resolving its own conflicts), coarse-reference and source-presence laundering, correction-target ambiguity, and component-identity instability (provenance-input fabrication is already closed by VSD-033). (1) Publication is component-level: `componentPublishable(c) = structuralValid AND spatialReadyWhenApplicable(c) AND contentReadiness(c)==eligible AND approvalStatus(c) ∈ {owner-approved, policy-approved} AND provenanceValid`; a work-level status may summarize its worst component but must not block unaffected ones; `contentReadiness ∈ {eligible, review-required, blocked}` is computed at claim/component granularity, `approvalStatus ∈ {unapproved, owner-approved, policy-approved}` is an authorized-principal act, never computed. (2) The model emits `claimAssertion{claimId, proposition, proposedVerdict, basisRefs}` only; effective state lives in `claimDecision{claimId, effectiveState, authority, artifactRef}` set solely by controller rule, authoritative-source adjudication, or owner artifact; transitions are append-only and cannot be silently cleared, and new contradictory evidence may reopen a resolved claim. (3) B1/B3 own region-bound observations; B2 never binds to pixels and inherits an `entityRef` only when the controller carried it from a B1-anchored research question, else its consequential identity claim is an `unboundEntityClaim`; an unbound claim routes to B3 only when visually locatable — B3 can bind a visible figure to a region but cannot establish a named identity by sight, so identity not establishable from pixels stays source-/owner-adjudicated. (4) `possibleAlias` = substantial region overlap + incompatible `entityType` + no declared `partOf`/`sameAs`/`distinctFrom` → neutral targeted B3 reread, never auto-merge; region records and the overlap/incompatible-type rules are versioned and calibrated. (5) Reconciliation is an immutable bound report `auditReconciliation({b0,b1,b2,b3,b4,legacy}) → {sourceBindings, violations, componentReadiness, contentReadiness}`, never a mutated record; B4 `ok` still means structural validity; a narrow function may apply only explicit scalar index patches with a real target path/operation, never generic string-patching of prose/tags/bindings/iconography. (6) B1 rich data becomes `rawVisualInventory` (preserved for evidence/rollback, never the authoritative index); a separate `curatedIndex` is built only from accepted claims and provenance-bearing catalog claims accepted under the applicable source/adjudication policy — current state: all 44 rich records retain B1 visual fields verbatim and 38/44 also carry corrections not propagated into them (not every correction necessarily targets the rich index); this is quarantined, since `projectToProduction()` emits only teaching copy and coordinates and no production consumer publishes richDescriptors as an authoritative index (calibration and review code read `richDescriptors.visual.delights`), and the authoritative rich ledger is unbuilt. (7) Schema designed, not built: `claimAssertion`/`claimDecision`, `entityObservation{entityId, regionRefs[], entityType, partOf?, sameAs?, distinctFrom?}`, versioned region records (id/geometry/scope/confidence), source-span ids, stable component ids on why/each cue/notes/hotspots/guide with `claimRefs[]`/`observationRefs[]`, and conflicts pointing to claim ids and affected component ids; implementation forks run identity. (8) La Gloire (`wikidata:Q16467705`) and St. John Chrysostom (`wikidata:Q1211814`) become immutable `content-blocked` findings bound to work id + image SHA + source run + record SHA + B4 body/raw-delta hashes + derived-run ancestry (descendants of a blocked source stay blocked, so a rehydration that changes the hash does not clear them); both are mandatory regression fixtures; eligibility requires a fresh run under the corrected contract plus explicit resolution of the blocked claims, not a new hash. (9) Auto-policy and the full graph are gated on an adversarial canary using those two as regression fixtures (not recall estimates), a frozen owner-labeled holdout not revealed to the model, legitimate-overlap controls, and controller-logic synthetic fixtures, reporting as separate metrics schema-conformance (emission) rate, entity-type/region-binding accuracy, alias precision and recall (on the holdout), `unboundEntityClaim` rate, structurally-valid-but-semantically-wrong rate limited to labeled dimensions, referral volume (work/component), and owner minutes per exception; VSD-011 random sampling continues after any automatic eligibility. | Owner approved 2026-09-15. Items 1–3 implemented offline. The bounded `b6c-aafea89438d0` smoke completed 6/6 provenance-clean subscription calls and 6/6 schema-valid emissions; it remains `measurementReadiness:"blocked"` because the holdout is not frozen owner-labeled ground truth and real-scene alias precision/recall is unmeasured. Reconciliation subsequently implemented by VSD-035 and hardened by VSD-036; curated index and auto-policy remain unbuilt; no production sink |
| VSD-035 | 2026-09-15 | **Build the fail-closed reconciliation layer now; do not wait for auto-policy accuracy measurement.** The owner explicitly authorized implementation after the 4b smoke showed that schema-valid entity emission alone still permits the recurring semantic failures. Implement immutable, recomputable `claimBundle → effective decisions → reconciliation report` artifacts bound to the exact projected components and the full standard or repaired-run ancestry. Preserve B1/B3 observations, B2 atomic claims, B4 corrections, conflicts, and uncertainty; model verdicts/resolution text are proposals only. Existing coarse B4 grounding adapts conservatively (`review-required`/`blocked`), never auto-eligible. Only accepted atomic claims with owner/controller-established grounding or an exact owner component decision can make a component content-eligible; source authority requires an exact source span and cannot directly approve finished copy. Known bad completions remain permanently blocked; a fresh corrected run needs an explicit resolution for every canonical finding. Make reconciliation mandatory and fail-closed in both stages of `passBApproval/2`; verify repaired `b4r→b4c→cal50` ancestry and deterministic hydration instead of accidentally approving the obsolete/tampered upstream body; make partial approvals update only the named production surfaces and preserve everything unapproved. Add one-work and cohort offline commands and CI regressions. This decision does **not** authorize auto-policy, a curated index, model-created effective decisions, or production publication. | Implemented locally, offline; focused tests pass and 44 content-addressed baseline sets were materialized for `b4r-8f1f74ddc30f` (0 eligible, 8 review-required, 36 blocked, 6 quarantined, 0 errors). No approvals, production writes, or new model calls |
| VSD-036 | 2026-09-15 | **Harden VSD-035 after independent adversarial audit and state its trust boundary literally.** Rebind source-derived component grounding and B4 conflicts byte-for-value; verify derived B0–B3/source-run/upstream/source-B4 files directly against the repair evidence manifest; require an owner component acceptance to name every applicable component/work-scope conflict; prohibit lower-authority supersession; canonicalize Wikidata blocked-work IDs; require the active pointer to match its preserved activation record; and add a whole-cohort `--check` gate. Reconciliation artifacts are content-addressed/tamper-evident within a trusted local-filesystem boundary, not cryptographically authenticated principal acts. The recorded current-image SHA is bound but image bytes are not freshly re-receipted here. A stored source span is structural evidence only until retrieval-byte and entailment verification is built. | Implemented locally after audit; focused regressions and the 44-set standing check pass. No approval, production write, model call, cryptographic identity layer, or automated semantic acceptance |
| VSD-037 | 2026-09-16 | **When strong source identity conflicts with unreliable visual binding, preserve the knowledge and drop the pin — never the reverse; a disputed vision-only claim may not enter affirmative player copy, and B4 does not adjudicate the conflict.** The two-work content-repair canary (`cr2-af3d6ed79c1c`, both works fresh under the corrected contract) established that corrective *reasoning* is nondeterministic and cannot be relied on: La Gloire re-introduced its sealed transi/skull/memento-mori/vanitas and wood-medium claims and figure-role inversion; St. John encoded the same human→animal entity-class error as before, merely hedged as "large quadruped"/"lion-like" (hedging the species does not repair the class). Both are therefore content-repair **failures** and safety-layer **successes** (blocked-findings → `content-blocked-work-needs-resolution`; reconciliation → `contentReadiness:blocked` on both). The precedence/omission rule (narrow, deterministic, controller-owned): for the identity-bearing axes **{medium; human-vs-animal; named figure identity or role; discrete identity-bearing iconography such as wings/skull/coffin/attribute}**, when a model/vision-only claim conflicts with an authoritative exact-span claim (or a sealed audit finding), the vision-only claim is retained only as **disputed diagnostic evidence** and MUST NOT appear affirmatively in why/cues/notes/guide; B4 never resolves the conflict. When authoritative evidence establishes the subject but vision cannot reliably bind it to a region, retain the source-grounded explanation as an **unpinned** note/guide item, mark the region binding **unresolved**, invent no pin, and never substitute the model's competing entity classification. This does **not** authorize auto-policy, a curated index, a general claim graph, cryptography, or any production sink; owner decisions and blocked-finding resolutions stay empty. | Implemented offline as a **review projection only**: deterministic `pass-b-identity-precedence.mjs` omission aid (omits on a disputed axis, never affirms, holds all bindings for review, no caller authority override) composed by the owner-review generator behind a fail-closed gate. It is **not** wired into guarded approval or reconciliation. Proposed player copy was regenerated under the review projection; both fresh runs' active reconciliation reports remain bound to the full unfiltered projection and block both works (not regenerated to match the filter). Corrected owner-review candidates are authored offline, unapproved, and unbound to reconciliation. La Gloire's definitive Musée Carnavalet primary span was subsequently retrieved and bound (it supports the named figures / woman-nude-draped / sleep / coffin and refutes the role inversion; it records a skull/wings only as *not mentioned*, not entailed-absent; plaster is grounded via Wikidata P186 + the sealed audit). Both content-repair-failure B4 bodies are preserved and asserted by `tests/pass-b-identity-precedence.test.mjs` (in `npm test`/`test:ci`); the conformance-failure run is referenced, not test-asserted. A later bounded correction added a **one-way notes→hotspots approval coupling** (changing notes requires re-approving hotspots; approving hotspots alone is allowed) and a **final production-projection validator** (structurally checks the exact why/cues/guide/notes/hotspots bytes, incl. 0–100 coordinates and every hotspot rank referencing an existing note), bumping the acceptance contract to `passBApproval/3`. Guarded-approval/reconciliation integration on stable ids is unbuilt. No approval, production write, model call, or scope expansion |
| VSD-038 (PROPOSED — offline prototype pending Codex review) | 2026-09-16 | **Minimum STRUCTURED release-policy contract for genuinely safe component eligibility — never by weakening `workBlocked` or promoting inferred grounding.** The corrected pilot showed 0 auto-eligibility is structurally forced by three blockers: (i) every work carries an unresolved work-scope conflict that blocks all components, (ii) a work-scope open claim (B4 uncertainty) that prevents eligibility, and (iii) component grounding that never reaches explicit/controller. The contract: (1) conflicts and open claims are component-scoped ONLY through **validated structured `componentRefs[]`/`claimRefs[]`** (proposed by B4, validated by the controller); missing/empty/invalid/ambiguous refs remain `workScope:true` and keep blocking/reviewing the whole work — never guess scope from field names, lexical overlap, or model confidence; structured B4 open claims are included in this rule. (2) A component's grounding may become **explicit/controller** only when it has a stable id + explicit structured claim refs, every referenced claim has an effective **accepted** decision, every applicable conflict/open claim is resolved or proven non-applicable through structured refs, **no disputed identity/role/medium/iconography claim applies**, and the grounding artifact + rule version are recorded. (3) Today's `controller-inference`/source-ID `inferred` mappings are never promoted; unstructured components stay `review-required`. (4) Automatic authoritative-source acceptance requires **either** a deterministic trusted-catalog-field mapping **or** a source span reverified against preserved bytes **plus** an approved entailment/adjudication artifact — a model-produced excerpt is not authority. (5) B4 may propose references but never sets grounding authority, effective claim state, conflict resolution, or eligibility. (6) Fail-closed preserved: unresolved work-scope conflict blocks all; unresolved work-scope open claim prevents eligibility; bad/dangling refs invalidate the bundle; La Gloire/St. John stay sealed-blocked; why/cues without explicit structured grounding stay review-required. | **PROPOSED / offline prototype remains uncommitted.** Implemented as an ADDITIVE, versioned layer `scripts/lib/pass-b-release-grounding.mjs` (`passBReleaseGrounding/1`, `passBReleasePolicy/2`) that consumes the reconciliation bundle + a validated structured-refs artifact; the module itself does **not** mutate the B4 assembler, reconciliation source records, or `passBApproval/3`, so committed output and the 44-set baseline remain unchanged. 11 offline regressions in `tests/pass-b-release-grounding.test.mjs` cover missing conflict/open-claim refs, dangling component refs, model-declared authority, inferred-mapping non-promotion, unverified excerpts, identity-axis claims, a conflict scoping one component while an unrelated explicitly-grounded component stays eligible, and canonical-blocked works. Offline replay `pass-b-release-grounding-replay.mjs` against the preserved pilot with real byte-bound reverified spans → **0 release-eligible (honest)**: the pre-fork B4 emitted no structured grounding and no approved entailment artifact exists; zero canonical escapes. VSD-039 now implements the separate structured B4 emission/translation prerequisite, but no live `/3` run, release-policy integration, automated acceptance, owner decision, or production write has occurred. Awaiting adversarial review before this proposed release layer is committed or wired |
| VSD-039 | 2026-09-22 | **Fork B4, not B1–B3, to emit the structured refs VSD-038 requires.** New synthesis uses `contentVisionB4Delta/3` with exact model-proposed bindings from delta targets to B2 claim ids and B1/B3 observation ids, plus structured scopes for every conflict and open claim. The deterministic hydrator validates every ref and translates temporary targets to stable final component ids in `passBStructuredGrounding/1`; suppressed/untranslatable targets widen the affected concern to work scope. **Wording correction (2026-09-22):** the model wire has no authority, effective-state, approval, or eligibility field; `conflicts[].resolution` and `conflicts[].status` remain model proposals and never establish effective/controller resolution. Reconciliation consumes the translated sidecar under `passBReconciliationPolicy/2-structured-b4` but continues to classify its grounding as `model-proposal`, never controller authority. Preserve deterministic support for archived `/2` deltas and policy-`/1` baseline sets; bind the fork to a separate `passBValidationB4/1-structured-grounding` so the corpus's banked B1–B3 evidence remains reusable. This authorizes the offline implementation and tests only, not live B4 calls, release-policy integration, owner decisions, approval, or production publication. | Implemented and tested offline; archived `/2` hydration and the 44-set `/1` reconciliation baseline remain valid. No model call, baseline regeneration, owner decision, approval, or production write |
| VSD-040 | 2026-09-22 | **Validate the structured B4 fork with a bounded, plan-first ten-work smoke before any corpus B4 continuation.** Freeze a risk-weighted set containing La Gloire, St. John, prior contradiction/iconography failures, multi-figure/overlap cases, the Niépce changed-image case, and controls. Reuse and byte-bind the historically accepted B1–B3 completion/raw/transcript evidence; do not rerun B0–B3. Permit tool-less B4 `/3` calls under a hard limit of ten attempts total across every resume, with no conformance retry; a preserved usage-limit rejection may retry after reset but consumes the same cap. Write the execution manifest before the first call; preserve and re-derive every attempt from reservation + transcript/result/meta evidence (checkpoint files are convenience output); fail fatally on wrong/missing `apiKeySource:none`, model drift, or tool use. Hold schema/hydration/leak/reconciliation failures. Assert that model-only grounding creates zero eligible components. **Capability wording correction (2026-09-22):** the runner verifies the canonical sealed-finding artifact/IDs and has no resolution/approval path; this is the precise extent of its prior “remain sealed” claim. Durable reservation and terminal-state hardening is recorded in the dated follow-up below. Report only schema/scoping integrity—never factual accuracy, safe-release yield, approval, or production readiness. | Owner authorized offline preparation. The initial `/1` runner had 23 offline attack/regression checks; audit found its crash-safe cap and checkpoint-independent terminality incomplete. The `/2` repair below closes those implementation gaps with 53 offline checks; all ten preserved inputs reopen and bind. No live B4 call, release-policy integration, owner decision, approval, or production write. Live spend remains pending independent audit and explicit owner authorization |
| VSD-040 implementation hardening; VSD-039 wording erratum | 2026-09-22 | **Implement the already-approved bounded canary contract; no new owner decision or scope.** R1: exclusively create (`wx`) and flush `attempt-N.reserved.json` plus directory entries before calling; count reservations for the ten-slot cap and global contiguity. Missing/incomplete transcript/result/meta evidence is a consumed terminal `unknown-outcome`, never retried. R2: reconstruct accepted/held/fatal/unknown-outcome terminality from reservations + verified attempt evidence even without checkpoints; usage-limit is the only retryable result and still consumes its slot. Scan all preserved history before scheduling so any fatal (or unknown outcome) stops calls; report all preserved work states, including later fatal rows. Bump the execution contract `/1`→`/2`. Correct the false VSD-039 “no resolution field” statement explicitly: conflict resolution/status fields are model proposals, never effective/controller resolution. Narrow VSD-040 “sealed” wording to canonical sealed-finding artifact/ID verification and absence of a resolution/approval path. | Implemented and verified offline: 53 canary checks cover interrupted calls/evidence, missing checkpoints, later fatal states, reservation caps across resumes, usage-limit retries, successful rate-limit prose, tamper detection, and plan/live gates. No live calls, baseline regeneration, owner decisions, approvals, or production writes; independent audit acceptance and explicit owner authorization remain prerequisites for live spend |
| VSD-040 N5 execution hardening | 2026-09-22 | **Close the remaining canary execution-evidence gaps before live spend.** Require at least one init and `apiKeySource:none` on every init; a later clean startup never erases earlier wrong/missing provenance. Reject every `*tool_use` block in execution envelopes, including server tools and streamed content blocks, without treating model prose/structured-output values as events. Bind a six-minute `execFile` timeout and `SIGKILL` to the command policy; preserve stdout and mark timeout evidence terminal held (fatal when provenance fails), never retryable usage-limit. Keep incomplete evidence unknown-outcome and retain reservation-based accounting. Bump execution contract `/2`→`/3`; do not change banked B1–B3 acceptance, prompts, model, or wire schema. Clarify that deleting local reservation history is outside the trusted-filesystem cap guarantee. | Implemented and verified offline: 74 canary checks, including mixed/missing init provenance, server/streamed tool blocks, actual forced termination of a harmless local Node fixture, checkpoint-free timeout/fatal resume, and an 11-reservation history rejection. R1/R2 regressions remain green. No live model calls, collector resume, evidence migration, owner decisions, approvals, baseline regeneration, or production writes; live spend still requires explicit owner authorization |

| VSD-040 N2 diagnostic hardening | 2026-09-22 | Preserve terminal `unknown-outcome` when metadata is missing/truncated. If transcript + result files remain and the transcript reveals a fatal provenance failure, report `transcriptDerivedKind:"fatal"` as diagnostic only; never infer successful execution or change retryability. Execution contract stays `/3`: acceptance and reservation semantics are unchanged. | Implemented offline; 79 canary checks including missing/truncated fatal metadata and incomplete-success non-promotion. No live call or publication |

| VSD-041 | 2026-09-22 | **Pass B budget/path: Max 5x subscription only, almost all available weekly capacity, no deadline.** The owner rejected corpus API spending after the measured-usage estimate of roughly $6.9k interactive / $2.7k batch-optimized. Supersedes the old 50→70→75% allocation target, not usage-limit stops, key stripping, explicit spend authorization, or Pass A's separate budget. No extra API credit fallback. | Owner decision recorded; allocation is not a measured throughput guarantee. Collector remains stopped |
| VSD-042 | 2026-09-22 | **Prioritize a rolling 30-day fully enriched daily buffer (~600 works, ~20 entrants/day); Easy and the rest later.** Use America/Los_Angeles date, earliest scheduled date first, diversity rotation only within a date, and stop the collector at the horizon instead of falling through to Easy/corpus. This changes collection scope, not the actual daily schedule. | B0–B3 date-first window implemented offline; B4 window continuation, publication and nightly supervisor remain unbuilt |
| VSD-043 | 2026-09-22 | **Public announcement requires the next 30 days of dailies to have the full B0–B4 pipeline completed and be published through an approved auto-policy, with no visible legacy teaching filler.** Gesso is already live; this gates announcement. Supersedes VSD-014 for this launch requirement. Existing legacy why/notes/pins do not count as completed enrichment or approval. | Owner decision recorded; launch gate enforcement and auto-policy publication are not implemented. No live site or schedule change |
| VSD-044 | 2026-09-22 | **The owner will not hand-audit every window work; develop an auto-audit + auto-publish policy.** VSD-011's one-time 50-work policy-decision calibration and 2/100 sampling are acceptable to present; this does not establish rare-error accuracy or approve the proposed v2 policy. Retain VSD-034 holdout/regression requirements and current owner-review classes. Risk thresholds, holdout/sample expansion, teaching subset bar, rescheduling extension and semantic delegation need the specific policy decision. | Goal recorded. Policy v2 remains PROPOSED; exact owner component approval is still the implemented release path. No new effective decisions or approvals |
| VSD-045 | 2026-09-22 | **Automated Pass B starts only 00:00 inclusive–08:30 exclusive America/Los_Angeles; in-flight clients finish by 09:00; zero automated calls 09:00–24:00.** Supersedes VSD-013's 22:00 start. Check every stage and retry, not merely work/session start; a supervised collector does not bypass this rule. | Collector gate + DST/date/cutoff/retry regressions implemented offline. Other experimental entry points require operator enforcement; no unattended supervisor or model call started |
| VSD-042/045 collector implementation hardening | 2026-09-22 | **Repair resume evidence before authorized collection.** Reconstruct failures independently of fragile hold reasons; unknown hold reasons never authorize retries. Preserve fatal stops independently of status text/ledger across restart. Copy only missing raw bytes from identical verified migration sources. Default inspection and tests are write-free against real evidence; explicit `--repair-history` holds the run lease before any maintenance writes. Keep the banked B1–B3 evidence contract unchanged; bind new `/3` execution and exact CLI version separately, with drift refused. Pre-call receipts expose interrupted fresh attempts; terminal content failures are not blindly requeued. | 50 offline collector checks pass; 75 raw files restored, ten failures re-held, 416 completions reverified. Previous 500 transcripts/completions/images preserved; only the local operational ledger changed. No model/network call, baseline regeneration, approval or production write |


| VSD-042/045 collector F1 hardening | 2026-09-22 | **Separate runtime maintenance from permanent boundary failures.** Execution `/3`→`/4`: disable the child CLI auto-updater, bind reservations to append-only policy epochs, and pause on CLI drift until an explicit review names the active epoch and target runtime-policy hash. Old epochs, reservations and completions remain unchanged; a drifted body is never accepted retroactively. Operational exceptions stop without `fatal.json`; proven provenance/confinement/model/subscription-source failures retain the durable stop. Distinguish 09:00 deadline termination from a hang timeout. Preserve an interrupted B2 validation retry without allowing more than two rejected bodies across resumes. Maintenance changes refresh `updatedAt`, and no-op repair remains write-free. | 73 collector regressions pass offline. Existing evidence still verifies as 129 done / 23 held / 500 attempts; no real runtime rebind, call or ledger rewrite performed in this follow-up. F2 frozen-legacy/per-work-staleness is explicitly required before publication, not claimed implemented. No approval, production write, baseline regeneration or owner-policy expansion |

| VSD-040 live-smoke correction: output adapter and duration | 2026-09-22 | **Correct the harness from real execution evidence; supersede the N5 blanket tool ban and six-minute limit for fresh attempts only.** The owner-run `b4s-016f64c8e0ca` stopped after two reservations: La Gloire timed out; St. John returned clean subscription/model provenance but `/3` wrongly treated the CLI's StructuredOutput adapter as forbidden tool use. All 49 historical b4c transcripts contain that adapter (48 once, one twice after a schema rejection). Execution `/4` requires every init's tools to equal `[StructuredOutput]`, permits exactly one `tool_use:StructuredOutput`, rejects every other/duplicate/server emission and extra init capability, and uses a 900 s hard timeout with measured headroom (historical median/max 184.391/302.585 s; new timeout censored at 360 s). Preserve the old run and statuses; never refund/reopen its two spent slots or relabel its results. Fork a fresh ten-slot identity; unchanged delta `/3`, source bytes and all reservation/terminality safeguards. | 110 offline canary checks pass, including byte-bound real St. John acceptance under `/4`, real duplicate-adapter rejection, injected ordinary/server/init tools, and old-contract resume refusal. New plan `b4s-18bc5fb62997`; no directory/calls created. St. John's zero eligibility and recurring animal presupposition/open claim are preserved as an A4 semantic challenge. No factual acceptance, policy approval, baseline regeneration or production write. New owner authorization is required before the `/4` smoke |

| VSD-040 smoke #2 correction: duplicate output adapter | 2026-09-23 | **Supersede only `/4`'s duplicate-adapter fatal classification.** In the owner-run `b4s-18bc5fb62997`, Hydria's first StructuredOutput emission was rejected by the CLI as malformed JSON; the second produced a valid delta. Execution `/5` treats duplicates as a consumed terminal conformance hold, never a retry or acceptance, while other works may proceed. Wrong/missing subscription provenance, model drift, extra init capabilities and every other/server tool remain fatal. Preserve both spent runs' original evidence/statuses and refuse old-contract resumes; no refunded slots or automatic replacement smoke. The owner reported an approximately 22:00 PT start on September 22 as a one-off exception for smoke #2; VSD-045's recurring overnight hours remain unchanged. | 127 offline canary checks pass, including byte-bound real Hydria, valid-body hold, next-work continuation, checkpoint-free zero-call resume, fatal precedence and preservation/refusal of both old runs. New plan `b4s-2dcb6f0830f1`, no directory or calls. The `/4` report remains three reservations / two accepted / one fatal, zero eligible / 18 review / 25 blocked. No factual approval, new live authorization, baseline regeneration or production write |
| VSD-046 | 2026-09-25 | **Auto-accept patch-level Claude Code updates for the corpus collector.** When the installed CLI differs from the bound epoch ONLY by a higher patch version within the same major.minor (e.g. 2.1.281 → 2.1.282) and nothing else in the execution policy changed, the collector appends a new epoch automatically at session start, recording the owner rule as its review (`automatic:true`). Minor/major upgrades, downgrades, any other policy change, or a preserved fatal still pause for a reviewed `--rebind-runtime`. The collector also pins the exact versioned binary (`realpath` of `claude`) for the whole session, so an update mid-run cannot change the child process. | Owner decision 2026-09-25 after the 2.1.282 update paused the nightly run. Implemented with collector regressions (74 pass). The 2.1.282 rebind itself was an owner-approved review (epoch 2). No model calls |

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
