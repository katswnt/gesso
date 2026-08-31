# Vision system: canonical decisions and operating contract

**Authority:** owner-approved product and operating intent
**Last owner confirmation:** 2026-08-31
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
prospective revisions before registration. Neither document authorizes data collection by itself.

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

### Required method

The transformation ladder remains multi-rung and adaptive:

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

### Security model

The preferred low-cost execution is subscription-backed Claude Code, but only if a
prototype proves that a headless image call can run with **zero tools**. The image
process must have no web, bash, filesystem-write, agent-spawn, or MCP capability and no
authoritative write access. Its network egress is limited to the Claude service endpoints
required by the installed client. A separate no-image research process gets web access.
The deterministic controller alone assembles provenance-bound records.

The G-03 broker, decode/re-encode, path confinement, schema checks, evidence store,
single-use runs, base-state drift check, and structural writer inventory remain mandatory.
No subagent writes into authoritative data directories. If subscription-backed zero-tool
image attachment cannot be proven, use the paid tool-less API for that image stage rather
than weakening the boundary.

Claude Code surfaces the local `@<path>` reference as model text even with zero tools.
Therefore the production wrapper must attach from a neutral per-call working directory
using a relative, content-addressed filename such as `@<sha256>.png`. Never put a title,
catalog identifier, repository path, home-directory path, or other answer-bearing text in
the attachment path.

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
- One pinned observation is the source for both concise and deep presentations. Do not
  generate two contradictory accounts of the same detail.
- Source links remain internal initially.

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

## Implementation status as of 2026-08-31

| Capability | State |
|---|---|
| G-03 hardened broker, tool-less paid runner, hash/evidence-bound guarded merge | Implemented on feature branch `g-03-image-agent-boundary` at `2186a00`; preview-built, not production |
| Current Pass B schema | Implemented only for the narrower notes/pins + image-QA flow; rich schema is not yet rebuilt |
| Current approval | Human select-only; auto-policy and labeled human corrections are not implemented |
| Pass B subscription-backed zero-tool image process | Capability prototype PASSED WITH CONSTRAINT 2026-08-31 — headless `--tools ""` local-image attach + pixel read confirmed, but the attachment path is model-visible; production harness must use a neutral relative SHA filename and is not yet built |
| Pass B separate no-image research and conditional second look | Planned, not implemented |
| Pass B component coverage/staleness ledger | Planned; current ledger is narrower |
| Pass A adaptive ladder | Historical code/data exist |
| Pass A survivor/censoring semantics and per-rung checkpoints | Needs correction |
| Pass A automatic tier use | Intentionally disabled/not implemented |
| Unattended `launchd` supervisor and budget controller | Planned, not implemented |

## Open decisions and required evidence

These are not permission to guess. Resolve them with a prototype, data, or an owner
decision, then append the result below.

1. Can the installed subscription-backed Claude Code client attach a local image in
   headless mode while `--tools ""` is enforced, without leaking filename/path metadata?
   → **Resolved 2026-08-31 — attachment PASS, path-opacity FAIL with an accepted
   mitigation.** Headless `claude -p` with `--tools ""` attached the
   local image via `@<path>` and correctly read a pixel-only canary code, with
   subscription/OAuth auth and valid structured output. Caveat: the `@<path>` string is
   surfaced to the model as **text context**, so the filename must be content-addressed —
   the SHA-named canary leaked no answer, but a title/catalog filename would. See
   *Prototype evidence* below.
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
| VSD-003 | 2026-08-31 | Preserve Pass A's adaptive multi-rung blind API method; terminal survivors are censored, and outputs do not yet drive tiers. | Approved |
| VSD-004 | 2026-08-31 | Prefer subscription-backed Pass B only if a zero-tool headless image prototype proves the security boundary; otherwise use the tool-less API for image viewing. | Approved; attachment capability PASSED WITH CONSTRAINT 2026-08-31 (see Prototype evidence) |
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
| VSD-015 | 2026-08-31 | Subscription image attachments use a neutral relative SHA-only path because Claude Code exposes the `@<path>` string as model text; usage budgets count internal turns, not only process launches. | Approved from prototype evidence |

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
