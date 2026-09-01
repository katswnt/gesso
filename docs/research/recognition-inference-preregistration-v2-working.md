# Recognition and inference study — v2 working design

**Status:** pre-registration revision workspace; not registered; no data collection authorized

**Decision status:** owner worksheet resolved 2026-08-31; pilot specifications, prompts, schemas,
graders, manifests, synthetic tests, and cost preflight are not yet built or registered

**Frozen predecessor:**
[`recognition-inference-preregistration-v1-2026-08-27.md`](recognition-inference-preregistration-v1-2026-08-27.md)
(source attachment SHA-256 `9d7cd815c7f63ae1a97f3061831e3214adee97905a1410e0d85d8633407d0428`;
the repository copy differs only by its final newline).

**Related system contract:** [`../vision-system.md`](../vision-system.md), Pass A
`visionDifficultyProbe`. This research has its own manifest, ledger, budget, and analysis. It
does not make Pass B complete and does not automatically change game tiers.

This file exists so the v1 text remains historical evidence while v2 is revised prospectively.
Nothing becomes registered until the approved decisions are incorporated into final prose, the
analysis and grading code pass synthetic tests, the manifest is committed, and the document is
explicitly marked `REGISTERED BEFORE COLLECTION`.

## 1. What v2 preserves from v1

- prospective manifest, fixed seed, pool commit, image hashes, prompt/schema/model versions;
- full-pool rather than Easy-only sampling;
- complete repeated-measures collection rather than adaptive stopping for the study dataset;
- direct identification, self-report retained only as a calibration measure;
- blinded grading written and tested before outcome collection;
- alternate source views, multilingual fame, confabulation, and calibration questions;
- a dated deviations log and publication of nulls, exclusions, raw responses, and code;
- one-model scope before any cross-model claim.

## 2. Corrections already accepted in principle

These are design corrections, not outcome-driven deviations; no v2 data exist.

1. **Exact work only is exact recognition.** Correct artist/series/tradition without the exact
   work is partial attribution, not recognition. Confidently naming a different work remains
   confabulation.
2. **The transform grid is not a factorial design.** Call it a complete repeated-measures rung
   grid unless transform factors are independently crossed.
3. **The simple recognized-versus-non-recognized contrast is not causal.** A stronger transform
   changes both recognition and available visual evidence. The degradation panel can estimate a
   recognition-associated transition effect after controlling for the same rung transition; it
   cannot alone prove retrieval caused the difference.
4. **Full-grid collection does not eliminate right-censoring.** It eliminates adaptive missing
   cells. Works identified at the last meaningful rung remain right-censored.
5. **Recognition may be non-monotonic.** Preserve the full vector; do not reduce every sequence to
   first failure.
6. **Grayscale is a separate branch unless it preserves the ladder's nested severity.** A 30%
   grayscale crop cannot follow a 20% colour crop as an automatically “deeper” rung.
7. **Source-view dependence is not proof of training-image memorization.** Alternate-image results
   need quality/viewpoint/crop/occlusion covariates and cautious language.

## 3. Proposed three-study structure

### Study A — uncued exact-work identification under controlled transformations

Every sampled work receives every frozen ordered-crop view and separate diagnostic branch. Store,
for every cell:

- exact-work identification;
- partial attribution (artist, series, tradition) separately;
- specific wrong-work confabulation;
- facet predictions and facet-specific confidence;
- self-reported recognition;
- request/model/image/prompt provenance.

Primary registered-secondary estimand:

> At an adjacent rung transition, is the facet-accuracy change larger for works that lose exact
> identification than for works already unidentified across that same transition?

For each transition `r → r+1`:

- switchers: exact at `r`, not exact at `r+1`;
- unidentified controls: not exact at either rung;
- optionally stable-recognized controls: exact at both.

Compare work-level score changes with rung transition and facet explicit in the model; cluster or
bootstrap by work. Call the result recognition-associated, not definitive proof of internal
retrieval.

Study A also supports recognition curves, non-monotonic transitions, confabulation location,
fame/region analyses, and response stability.

### Study B — randomized same-image supplied-identity experiment

This is the sole causal primary study. Independent calls receive identical image bytes and differ
only in randomized information condition. Primary arms:

1. no cue;
2. opaque/noninformative sham cue;
3. correct minimal disambiguating identity cue.

The causal estimand is the change in facet accuracy produced by correct identity information while
pixels are held fixed. It measures the value of supplied identity information; it is not identical
to uncued exact identification and must be named honestly. A precommitted work×facet mask excludes
only facets directly disclosed by the actual cue; all individual outputs remain stored, and artist
remains eligible whenever the cue does not state it.

Study B can run on a prespecified subset/rung set rather than every work×rung cell. It replaces the
weak note-only arm if the budget requires a choice.

### Study C — alternate source-view robustness

For owner-confirmed alternate photographs/scans of the same physical object, compare canonical and
alternate full views. Call outcomes:

- source-view-dependent exact identification; or
- source-view-robust exact identification.

Record view comparability before outcomes: resolution, crop/coverage, angle, lighting, colour,
frame/gallery context, glare, occlusion, labels, condition visibility, and image-fitness state.
Do not infer memorization versus work-level knowledge from identification alone.

## 4. Pass B infrastructure that may strengthen Pass A

Only validated infrastructure crosses the boundary; conclusions and ledgers do not.

- Use the G-03 broker, sanitized content-addressed derivative, image SHA, broker-policy version,
  path confinement, and reject/repair reasons.
- Use a **pre-outcome** image-fitness screen so wrong-art/unusable images are repaired or excluded
  before the study manifest. Keep `usable`, `repair`, `blocked`, and valid-but-unplayable distinct.
- Use Pass B-style format, condition, viewpoint, photographic-artifact, medium, region, and object-
  type descriptors as prespecified sampling/matching covariates where validated.
- Use visible-evidence boxes/pins to estimate which diagnostic features survive each deterministic
  crop. This can measure transform-induced information loss directly and improve the Study A
  transition adjustment.
- Use the same machinery to describe canonical/alternate view differences in Study C.
- Never send Pass B title, artist, date, place, research, filename, guide, or source text to a blind
  Pass A call. All model-facing filenames remain neutral SHA-only names.
- Pass B records used as covariates must be frozen and committed before Pass A responses. They may
  not be edited after seeing study outcomes without a logged deviation.

The current `tasks/pass-b-contract-and-crosswalk.md` is a planning artifact, not a verified schema.
Do not make this study depend on its unreviewed claims. Its useful ideas must survive a separate
audit and implementation.

## 5. Pass B artifact audit findings relevant to this revision

These findings prevent accidental reliance on a false “lossless” inventory:

1. The historical audit did not inspect pre-tombstone git history, even though retired prompts
   contain requirements not recoverable from field names alone (for example, the guide prompt
   required 8–12 work-specific questions and named comparison/controversy/function dimensions).
2. Several `vision.js` shapes were summarized incorrectly: palette is sometimes `{hex,tone}` and
   sometimes an array; figures vary between object/string/number; signature is an object; and the
   12 `notes` records are `{why,cues,guide}`, not a list of B1 note candidates. A field-name-only
   gate would not prove lossless migration.
3. B1/B2 child processes cannot write their own completion files under the stated tool policies;
   the controller must capture stdout and write quarantined artifacts.
4. Raw free text derived from an untrusted image is tainted. A web-capable B2 process must not
   receive arbitrary B1 prose as instructions. Use allowlisted structured claims, least-privilege
   web tools, no secrets/writes, strict output validation, and explicit taint handling.
5. A deterministic B4 controller cannot perform unresolved semantic synthesis. Either earlier
   model stages must emit final candidate prose and explicit conflict resolutions, a separate
   tool-less synthesis stage is needed, or conflicts route to human review.
6. `evidenceRef` and `claimRef` require stable declared IDs; the draft evidence items currently
   have no IDs to resolve.
7. The draft's `imageEligibility` rules collapse `repair` into `blocked`, contradicting the
   canonical four-state policy, and its proposed horizon hard gate contradicts VSD-014.
8. Confidence thresholds alone cannot authorize publication; auto-policy requires empirically
   calibrated component-level precision and drift sampling.

## 6. Decision worksheet

Each answer should become a dated row in §7 before v2 prose is finalized.

### A. Claim and causal interpretation

1. **DECIDED A1 — Primary study.** Study B's randomized supplied-identity effect is the sole causal
   primary. Study A remains a prominent preregistered secondary because it is more directly relevant
   to Gesso, but its transition-adjusted recognition-associated result is not labeled causal.
2. **DECIDED A2 — Cue content.** Use a precommitted minimal disambiguating identity label per work:
   distinctive title alone where sufficient; title plus maker/culture and a collection/version
   qualifier only where required to identify a generic, anonymous, copied, or multiply titled work.
   Store `cueType`, the exact cue, and a work×facet `disclosedFacets`/`eligibleFacets` mask. All facet
   outputs remain stored, but directly disclosed facets do not enter that work's primary aggregate.
3. **DECIDED A3 — Controls.** Use three primary information conditions: no cue, an opaque/
   noninformative sham cue, and the correct identity cue. The exact sham wording and the exact
   content of the correct cue remain coupled to DECIDED A2 and must be frozen in the pilot manifest.
4. **DECIDED A4 — Wrong cue.** Omit the plausible wrong-title arm from the pilot and first
   confirmatory study. Treat suggestibility/confabulation under false identity information as a
   separately designed follow-up rather than spending or complicating the primary experiment.
5. **DECIDED A5 — Wording.** Use a precise registered title centered on identity information and
   visual inference. “Does recognition substitute for inference?” may remain the motivating question
   or an essay title, but not the wording of the narrower randomized causal claim.
6. **DECIDED A6 — Artist outcome.** Artist remains eligible whenever the actual cue does not directly
   disclose the artist. As with every facet, a pre-outcome work×facet leakage mask excludes cells
   directly answered by that work's cue. Store artist separately even when it is excluded from an
   aggregate.

### B. Identification and prompt behavior

7. **DECIDED B1 — Recognition state.** Exact-work identification only. Artist/series/tradition is
   partial attribution, not exact recognition.
8. **DECIDED B2 — Exact-work key.** Commit a per-work recognition key before calls, including accepted
   canonical/translated aliases and required qualifiers for generic titles, copies, and versions.
   Generic records require enough maker/culture/collection/version detail to distinguish the exact
   work; ambiguous responses route to blinded adjudication under the frozen key.
9. **DECIDED B3 — Description.** A description earns exact identification only when it contains a
   prespecified uniquely identifying fact from that work's recognition key. Accurate but generic
   visual description remains inference, not exact recognition.
10. **DECIDED B4 — Prompt-induced retrieval.** Add a smaller randomized subset comparing facets-only
    with identity-first prompting. Name it as the total effect of that prompt protocol, not latent
    spontaneous recognition. It replaces or outranks the old note-only arm.
11. **DECIDED B5 — Same-response contamination.** In Studies A and C, elicit exact identification
    and facets in separate independent fresh-context calls. A same-context identity-first condition
    exists only where that contextual contamination is the randomized treatment being measured.
12. **DECIDED B6 — Reliability.** Repeat a seeded random 10% of cells. Preserve the first valid
    response as primary; additional boundary-cell repeats, if any, are exploratory rather than
    replacements.

### C. Transform design

13. **DECIDED C1 — Structure.** Use one ordered nested crop family for recognition resistance and
    treat mirror, rotation, and grayscale as separate diagnostic branches. Do not describe the
    combined panel as a single monotonic ladder or a factorial design.
14. **DECIDED C2 — Grayscale.** Analyze as a separate branch, not a deeper rung after crop20.
15. **DECIDED C3 — Crops.** Assign one seeded, outcome-independent anchor per work, balanced across
    center and off-center positions; nest every severity for that work around the same anchor. Do
    not use Pass B features to place the primary crop.
16. **DECIDED C4 — Diagnostic-feature retention pilot.** Do not wait for the full Pass B rebuild.
    Before any Pass A outcomes in the excluded pilot, create and freeze a research-only inventory of
    roughly 3–8 visible diagnostic regions per work, covering applicable recognition, artist/style,
    date/place, and medium evidence. Use boxes only to measure crop retention, never to place crops.
    The pilot decides whether reliability and analytical value justify scaling boxes to the main
    study; the main-study dependency remains conditional until that evidence is reviewed.
17. **DECIDED C5 — Image normalization.** Generate every study view from the same broker-sanitized
    canonical raster under a frozen maximum dimension (currently 1,568px), colour profile, format,
    encoder quality, orientation, interpolation, crop rounding, and transform implementation. Record
    implementation/library versions and hash every generated view before calls.
18. **DECIDED C6 — Non-monotonicity.** Use the complete ordered-crop recognition curve (and the
    transition model for recognition-associated facet change) rather than first failure as the main
    resistance evidence. Preserve every recognition vector. First failure/first sustained failure
    remain intuitive descriptive summaries only.
19. **DECIDED C7 — Survivors.** Let the excluded pilot choose the final meaningful crop floor, then
    freeze it. Works still exactly identified at that floor remain explicitly right-censored; do not
    keep destroying useful visual evidence merely to force a failure.

### D. Facet outcomes and grading

20. **DECIDED D1 — Primary outcome structure.** The primary aggregate uses every facet not directly
    disclosed by that work's cue. Preserve and publish every individual facet score in all cases;
    individual-facet analyses remain prespecified secondary outcomes with multiplicity control.
21. **DECIDED D2 — Research scoring and raw evidence.** Preserve the model's exact raw response and
    structured values for every facet. Score a copy with frozen research-specific rubrics; never
    replace, silently normalize, or discard the original guess. Do not reuse the game's forgiving
    date slider, geographic centroid, or difficulty mechanics as research ground truth.
22. **DECIDED D3 — Date.** Require one best-year guess plus confidence; preserve both exactly. Score
    continuous distance from the nearest valid point in the frozen catalog uncertainty interval on
    a prespecified logarithmic scale, and report broad-period correctness separately. Freeze the
    interval, bins, formula, and synthetic boundary fixtures before calls.
23. **DECIDED D4 — Place.** Require one top creation-place/culture-region answer plus confidence.
    Preserve optional ranked alternatives, but do not let them rescue the primary score. Grade the
    top answer against a frozen accepted-place hierarchy; do not use `or` parsing or bounding-box
    centroids.
24. **DECIDED D5 — Medium.** Grade against a frozen hierarchy that distinguishes exact
    material/technique/support, correct medium family, broad defensible object category, and wrong.
    Preserve the exact raw answer alongside every derived credit level.
25. **DECIDED D6 — Movement/style/tradition.** Reuse and freeze the site's existing taxonomy at the
    manifest commit: authoritative pool `style`/`styleKind`, `MOVEMENTS`, canonical aliases, family
    relations, and curated related labels across movement, culture, period, school, tradition, and
    genre. Do not invent a parallel vocabulary. Preserve raw guesses; map aliases deterministically
    to frozen canonical labels. Freeze a research credit rule separately from the live game's
    forgiving near-match score, and use `notApplicable` where the site records no applicable style.
26. **DECIDED D7 — Artist attribution.** Precommit rules for named artist/collective, workshop,
    circle, follower, attributed-to, culture-made, and anonymous/unrecorded works. Award full credit
    for an accepted named maker or collective, frozen partial credit for truth-consistent
    workshop/circle/attributed relationships, and `notApplicable` where individual authorship does
    not genuinely apply. Preserve the exact raw guess.
27. **DECIDED D8 — Confidence.** Require and preserve a separate 0–100 probability for exact
    identification and every facet. Score calibration under a frozen rule (including Brier score and
    registered bins); never replace the raw confidence value.
28. **DECIDED D9 — Ambiguous grading.** Apply deterministic frozen aliases/taxonomies first, then
    route genuinely ambiguous prose to a reviewer blinded to rung, cue condition, fame, region,
    prediction, and analysis arm. A model grader cannot enter the confirmatory path without separate
    validation against frozen human judgments.

### E. Sampling, matching, and power

29. **DECIDED E1 — Unique sample.** `n` always means unique works, never calls or arm slots. The
    pilot has 36 unique works. Main-study `n` remains unset until pilot-based power analysis; every
    manifest reports arm overlap, call counts, and effective analysis samples separately.
30. **DECIDED E2 — Fame components.** Preserve English pageviews, sitelinks, and the hand-set `+2000
    canon` flag as separate variables. Retain the historical composite only as an unchanged legacy
    comparison; the pilot does not overwrite it or use a new fame value for tiering.
31. **DECIDED E3 — Multilingual fame.** For pilot works, collect isolated pageviews for `en`, `ja`,
    `zh`, `es`, `fr`, `de`, `ar`, `hi`, `ru`, and `pt` over the 12 complete calendar months before
    manifest freeze. Consolidate redirects to canonical articles and store every raw language count,
    raw total, missing-page flags, article age, and a language-balanced normalized measure. Do not
    overwrite existing fame or use the new measure for tiering. Compute full-pool values only before
    a later main-study sample requires them.
32. **DECIDED E4 — Region construct.** Use creation place where known; otherwise use cataloged
    culture-region with an explicit fallback marker. Preserve culture separately and never substitute
    artist birthplace for the work's origin.
33. **DECIDED E5 — Matching covariates.** In addition to isolated fame measures and region, balance
    or adjust broad era, object type, medium family, pre-outcome image fitness, and source host.
    Handle artist/series/source dependence under E6 rather than mistaking object-type imbalance for
    a regional effect.
34. **DECIDED E6 — Dependence.** Exclude duplicate corpus records and identical images from the
    primary sample. Retain canonical/alternate pairs only in Study C. Record artist, series/work
    family, source institution, and image-source clusters; cluster or otherwise account for retained
    dependence rather than treating related observations as independent.
35. **DECIDED E7 — Power and final sample.** Do not preserve v1's `n=800` by inertia. Set final `n`
    only after the excluded pilot supplies variance, reliability, usable-transition, failure-rate,
    and measured-cost inputs for a prespecified simulation.
36. **DECIDED E8 — Pilot.** Draw **36 unique works**, excluded from the main manifest and balanced
    across five fame bands; European/non-European creation or culture-region; broad object type;
    distinctive/generic titles; current playable/borderline states; existing content richness; and
    eligibility for several alternate-source pairs. Planned calls, subject to frozen schemas:
    - Study A: seven views per work (full, three nested crops, mirror, rotation, grayscale), with
      separate fresh-context identification and facet calls: `36 × 7 × 2 = 504`;
    - Study B: sham and correct-identity facet calls at full view: `72`; reuse Study A's full-view
      facet call as the no-cue condition rather than paying for a duplicate;
    - prompt-induced retrieval: a prespecified 12-work subset;
    - Study C: six eligible alternate-source works at full view, with separate identity/facet calls:
      `12` additional calls;
    - reliability: repeat a seeded random 10% of eligible cells, keeping first valid responses
      primary.
    Expected total is roughly 650 calls after exact schema accounting. A conservative preflight cost
    estimator must refuse to launch above the hard **$15** pilot ceiling. The pilot may freeze
    transforms, grading, operations, and main-study power inputs; it may not tune hypotheses after
    outcomes. Main-study sample and budget remain open.

### F. Controls and operational protocol

37. **DECIDED F1 — Alternate images.** Pilot six works with one verified alternate source view each,
    full view only. Target roughly 40 such works in the first main study, also full view only.
    Cropped/transformed alternate-view experiments are a separately justified follow-up.
38. **DECIDED F2 — Alternate sourcing.** A no-image research process may find candidates, but an
    alternate is eligible only when authoritative records establish that it is the same physical
    object—not another edition, copy, cast, or related work. Record accession/QID, institution,
    source/license, resolution, crop/coverage, angle, lighting/colour, frame/context, glare,
    occlusion, labels, and condition visibility. The owner gives final pre-outcome approval.
39. **DECIDED F3 — Low-documentation stress test.** Include roughly six pilot works with no article,
    near-zero pageviews, and/or recent or sparse documentation. Never describe this as proof of
    absence from training.
40. **DECIDED F4 — Note-only arm.** Remove it from the pilot and first confirmatory study. Spend those
    calls on prompt-order and response-reliability controls; any historical note diagnostic is a
    separately labeled follow-up.
41. **DECIDED F5 — Model and request identity.** Use `claude-sonnet-4-6` for continuity with the prior
    probe. Freeze requested model, Anthropic API version, exact prompts/schemas, call-type token caps,
    and all applicable parameters before calls; record returned model, request id, timestamp, token
    usage, and image/prompt/schema hashes. Refuse continuation if returned model identity changes.
42. **DECIDED F6 — Temporal drift.** Seed, block, and interleave collection order across works, arms,
    views, fame bands, and regions; complete the pilot in one bounded window and record timestamps
    and provider request ids. Never collect one condition wholesale days before another.
43. **DECIDED F7 — Retry.** Retry transport/rate-limit failures that produced no response up to three
    times; the first successful response is primary. Preserve every attempt. If a received response
    is schema-invalid, permit only deterministic content-preserving parsing, otherwise mark it
    missing—never rerun because an answer is surprising or wrong. Scheduled repeats are labeled
    replicates, not retries.
44. **DECIDED F8 — Pilot cost.** Compute a conservative upper bound from the exact call manifest and
    refuse launch above `$15`; record actual tokens and cost per call. The pilot measures richer
    schema and 1,568px-derivative costs. No main-study ceiling is approved yet.
45. **DECIDED F9 — Publication.** Publish regardless of outcome: frozen preregistration and deviations,
    manifests/seeds, safety-reviewed raw responses, prompts/schemas, grading/analysis code,
    exclusions/failures, hashes, and deterministic transforms. Publish transformed images only where
    source-photograph rights permit; otherwise publish source/license metadata, derivative hashes,
    and reproduction scripts.
46. **DECIDED F10 — Preregistration venue.** Use both a frozen repository commit and an immutable
    OSF-style registration.

**DECIDED operationally:** the main collection may use the asynchronous Message Batches API if the
excluded pilot verifies equivalent request/response semantics, provenance, failure handling, and
atomic checkpointing. No main-study dollar ceiling is approved yet.

**DECIDED data boundary:** the pilot is append-only research. It writes isolated manifests, raw
responses, scores, and comparisons; it does not rewrite existing notes, historical vision records,
playability, fame, daily assignments, or tiers. Those legacy signals may be compared after blind
collection, but they never enter a blind model payload. No pilot result is an authoritative game
sink or an automatic tier input.

## 7. Study decision log

| ID | Date | Decision | Status | Rationale/evidence |
|---|---|---|---|---|
| RSD-001 | 2026-08-31 | Preserve the August 27 document unchanged as v1; revise in a separate v2 file before registration. | Approved | Owner instruction |
| RSD-002 | 2026-08-31 | Exact-work identification, not artist-only attribution, defines exact recognition. | Approved | Owner confirmation; avoids circular artist outcome |
| RSD-003 | 2026-08-31 | The degradation panel estimates recognition-associated change, not a clean causal retrieval effect. | Approved | Owner confirmation; transformation also removes visual evidence |
| RSD-004 | 2026-08-31 | Study B's randomized supplied-identity effect is the sole causal primary; Study A remains a prominent registered secondary. | Approved | Owner confirmation; B holds image bytes constant while A is more directly product-relevant |
| RSD-005 | 2026-08-31 | Study B uses no-cue, opaque/noninformative-sham, and correct-identity conditions; cue contents remain to be frozen. | Approved | Owner confirmation |
| RSD-006 | 2026-08-31 | Add a smaller facets-only versus identity-first experiment; otherwise separate identity and facet calls into fresh contexts. | Approved | Prevent written identities from contaminating ordinary facet reads while measuring prompt-induced retrieval explicitly |
| RSD-007 | 2026-08-31 | Primary aggregation includes only cue-undisclosed facets, but every facet remains stored and reported; artist remains eligible when not disclosed. | Approved | Owner confirmation; avoids discarding facet-level evidence |
| RSD-008 | 2026-08-31 | Use nested, seeded-anchor crops for resistance and separate mirror/rotation/grayscale diagnostic branches. | Approved | Owner preferred outcome-independent balanced anchors |
| RSD-009 | 2026-08-31 | Repeat a seeded random 10% of cells and retain the first valid response as primary. | Approved | Measures instability without outcome-driven replacement |
| RSD-010 | 2026-08-31 | Include a small first-wave alternate-source arm of roughly 40 eligible pairs. | Approved in scope; exact view protocol open | Owner confirmation |
| RSD-011 | 2026-08-31 | Use a separate 30–40-work pilot with a $15 hard ceiling; defer final sample size and main budget until pilot evidence. | Approved | Owner confirmation |
| RSD-012 | 2026-08-31 | Permit asynchronous Message Batches after pilot equivalence/checkpoint verification; register through both a frozen repository commit and an immutable external registration. | Approved | Owner confirmation |
| RSD-013 | 2026-08-31 | Give each work a minimal disambiguating identity label and precommit its directly disclosed versus eligible facet mask. | Approved | Preserves generic/anonymous/non-Western objects without counting answers stated by the cue |
| RSD-014 | 2026-08-31 | Pilot frozen research-only diagnostic evidence boxes without waiting for the full Pass B rebuild; scale them only if the pilot establishes reliability and value. | Approved for pilot; main-study use conditional | Owner chose the hybrid dependency approach |
| RSD-015 | 2026-08-31 | Omit wrong-title cues from the first confirmatory study and use precise identity-information wording for its registered title/claim. | Approved | Keeps suggestibility as a separate follow-up and prevents the title from overstating the causal estimand |
| RSD-016 | 2026-08-31 | Grade exact recognition against precommitted per-work keys; descriptive answers count only when they contain a prespecified uniquely identifying fact. | Approved | Separates exact identification from accurate visual inference and handles generic titles/copies prospectively |
| RSD-017 | 2026-08-31 | Normalize and hash every transformed view; use the full ordered-crop recognition curve, preserve non-monotonic vectors, and right-censor meaningful final-rung survivors. | Approved | Prevents technical variation and forced image destruction from masquerading as recognition evidence |
| RSD-018 | 2026-08-31 | Preserve every exact raw facet guess, then score a copy under frozen research-specific date/place/medium rubrics rather than game mechanics. | Approved | Owner confirmation; maintains auditable responses while making the research grader prospective and reproducible |
| RSD-019 | 2026-08-31 | Freeze and reuse Gesso's existing movement/style/tradition taxonomy rather than creating a parallel vocabulary; separately freeze research credit rules. | Approved | Owner confirmation; the site already models movement/culture/period/school/tradition/genre distinctions |
| RSD-020 | 2026-08-31 | Precommit artist-attribution partial/not-applicable rules, collect per-facet confidence, and adjudicate ambiguous prose blind to experimental condition. | Approved | Owner confirmation |
| RSD-021 | 2026-08-31 | Keep fame components and new multilingual measures isolated; preserve the historical fame composite unchanged and make no tier/data migration from the pilot. | Approved | Owner wants additive research followed by comparison with prior notes, vision, playability, fame, and tiers |
| RSD-022 | 2026-08-31 | Define region from creation place with an explicit culture-region fallback, and balance era/object type/medium/image fitness/source host in regional comparisons. | Approved | Avoids artist-birthplace and corpus-composition confounds |
| RSD-023 | 2026-08-31 | Pilot outputs are append-only research artifacts; existing authoritative content and scheduling remain unchanged, and legacy signals stay out of blind prompts. | Approved | Owner confirmation; Pass A remains research-only |
| RSD-024 | 2026-08-31 | Pilot 36 unique balanced works across a roughly 650-call A/B/C/reliability plan; reuse the Study A no-cue cell and fail closed above a conservative $15 preflight estimate. | Approved | Owner confirmation; narrows the pilot before any collection |
| RSD-025 | 2026-08-31 | Freeze ten-language, 12-complete-month multilingual fame fields for pilot works while keeping every component isolated and existing fame unchanged. | Approved | Owner approved the complete remaining design package |
| RSD-026 | 2026-08-31 | Deduplicate primary records/images and explicitly account for artist/series/institution/source dependence. | Approved | Prevents duplicated or related observations from masquerading as independent evidence |
| RSD-027 | 2026-08-31 | Study C uses owner-verified same-object alternate views at full view only: six pilot works and roughly 40 first-main-study works. | Approved | Keeps source-view robustness interpretable and affordable |
| RSD-028 | 2026-08-31 | Include a six-work low-documentation pilot stratum and retire the note-only arm in favor of prompt-order/reliability controls. | Approved | Zero documentation is a stress condition, not proof of training absence |
| RSD-029 | 2026-08-31 | Freeze Sonnet 4.6 request identity, interleave collection in one bounded window, and fail closed on model drift. | Approved | Preserves temporal and model comparability |
| RSD-030 | 2026-08-31 | Retry only no-response transport failures; preserve all attempts, do not outcome-retry, and distinguish scheduled replicates. | Approved | Prevents silent response replacement and selection bias |
| RSD-031 | 2026-08-31 | Publish preregistration, raw evidence, code, failures, and reproducibility artifacts regardless of outcome; publish transformed images only where rights permit. | Approved | Owner approved repository plus immutable external registration and rights-aware publication |

## 8. Required artifacts before registration

- completed v2 preregistration with no unresolved primary-design questions;
- deviations log seeded before pilot;
- exact-work recognition key and ambiguous-title policy;
- deterministic transformation code + golden image hashes;
- synthetic grading fixtures and grader tests;
- research-specific facet scoring specification;
- pre-outcome image-fitness and source-view protocol;
- fame-language/time-window computation and both matching manifests;
- sampling/power simulation and unique-work accounting;
- exact model/request configuration and randomized collection order;
- manifest containing work ids, arm memberships, pair ids, covariates, pool commit, image SHA,
  transformed-image SHAs, prompt/schema hashes, and seed;
- explicit budget and approval gate;
- statement that Pass A outputs remain research-only until a separate tier decision.
