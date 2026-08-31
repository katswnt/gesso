# Recognition and inference study — v2 working design

**Status:** pre-registration revision workspace; not registered; no data collection authorized

**Frozen predecessor:**
[`recognition-inference-preregistration-v1-2026-08-27.md`](recognition-inference-preregistration-v1-2026-08-27.md)
(source attachment SHA-256 `9d7cd815c7f63ae1a97f3061831e3214adee97905a1410e0d85d8633407d0428`;
the repository copy differs only by its final newline).

**Related system contract:** [`../vision-system.md`](../vision-system.md), Pass A
`visionDifficultyProbe`. This research has its own manifest, ledger, budget, and analysis. It
does not make Pass B complete and does not automatically change game tiers.

This file exists so the v1 text remains historical evidence while v2 is revised prospectively.
Nothing becomes registered until every decision marked `OPEN` is resolved, the analysis and
grading code pass synthetic tests, the manifest is committed, and the document is explicitly
marked `REGISTERED BEFORE COLLECTION`.

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

### Study A — spontaneous identification under controlled degradation

Every sampled work receives every frozen rung. Store, for every cell:

- exact-work identification;
- partial attribution (artist, series, tradition) separately;
- specific wrong-work confabulation;
- facet predictions and facet-specific confidence;
- self-reported recognition;
- request/model/image/prompt provenance.

Primary descriptive estimand candidate:

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

### Study B — randomized same-image identity-information experiment

This is the candidate causal primary study. Independent calls receive identical image bytes and
differ only in randomized information condition. Candidate arms:

1. blind image;
2. correct title cue (identity information);
3. neutral/sham cue of equal form and length;
4. optional plausible wrong-title cue, only if its interpretation and safety are justified.

The causal estimand is the change in facet accuracy produced by correct identity information while
pixels are held fixed. It measures the value of supplied identity information; it is not identical
to spontaneous internal recognition and must be named honestly. Artist may need exclusion from the
primary outcome if the cue discloses artist identity directly or mechanically enables it.

Study B can run on a prespecified subset/rung set rather than every work×rung cell. It replaces the
weak note-only arm if the budget requires a choice.

### Study C — alternate source-view robustness

For confirmed alternate photographs/scans of the same object, compare canonical and alternate
views. Call outcomes:

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

1. **OPEN A1 — Primary study.** Should Study B's randomized identity-information effect become the
   causal primary, with Study A's transition-adjusted result secondary? **Recommendation: yes.**
2. **OPEN A2 — Cue content.** Correct title only; title+artist; museum-style catalog label; or another
   identity cue? What does each condition legitimately let us score?
3. **OPEN A3 — Sham.** Should the neutral arm use an opaque catalog code, an equally long generic
   sentence, or both?
4. **OPEN A4 — Wrong cue.** Is susceptibility to a plausible wrong title valuable enough to justify
   a fourth arm, or is it scope creep?
5. **OPEN A5 — Wording.** Keep the cinematic broad title while making the registered causal claim
   narrower, or retitle around identity information?
6. **OPEN A6 — Artist outcome.** Exclude artist from Study B's primary whenever identity is supplied,
   or use title-only cues and retain artist as a secondary retrieval outcome?

### B. Identification and prompt behavior

7. **PROPOSED B1 — Recognition state.** Exact-work identification only. Artist/series/tradition is
   partial attribution, not exact recognition.
8. **OPEN B2 — Exact-work key.** How strict should accepted aliases, translated titles, catalog
   qualifiers, versions, copies, and generic titles be? Recommendation: commit a per-work key before
   calls; generic titles require artist/maker/culture plus distinguishing version details.
9. **OPEN B3 — Description.** Can an unambiguous visual description ever earn exact identification,
   or only when it contains a prespecified unique identifying fact? Recommendation: not by default.
10. **OPEN B4 — Prompt order.** Add identity-first, facets-first, and facets-only fresh-context arms
    on a stratified subset? **Recommendation: yes; replace or outrank the note-only arm.**
11. **OPEN B5 — Same-response contamination.** Should exact identification and facets be elicited in
    one response, or separate independent calls? Separate calls cost more but stop the written title
    from directly cueing the facet answer inside one context.
12. **OPEN B6 — Reliability.** Repeat every cell for 10% of works, only transition-adjacent/ambiguous
    cells, or another prespecified subset? Recommendation: at least a random 10% plus boundary cells.

### C. Transform design

13. **OPEN C1 — Structure.** Ordered nested ladder, independent transform grid, or both? An ordered
    ladder supports resistance; a factor grid identifies which manipulation does the work.
14. **PROPOSED C2 — Grayscale.** Analyze as a separate branch, not a deeper rung after crop20.
15. **OPEN C3 — Crops.** Same nested center/anchor for all severities, deterministic quadrants,
    multiple crops, or feature-aware crops? Nested crops aid interpretation; multiple crops reduce
    luck but multiply cost.
16. **OPEN C4 — Diagnostic-feature retention.** Use precommitted Pass B-style evidence boxes to
    calculate how much known evidence each crop retained?
17. **OPEN C5 — Image normalization.** Fix longest side, format, quality, colour profile, rotation
    implementation, interpolation, and crop rounding before hashing transformed images.
18. **OPEN C6 — Non-monotonicity.** Primary resistance summary: recognition-curve area, proportion of
    rungs exact, first sustained failure, or a model of every transition? Recommendation: curve/transition
    model primary; first failure descriptive only.
19. **OPEN C7 — Survivors.** Accept meaningful right-censoring and use a censored model, or pilot a
    longer ladder before freezing the main design? Recommendation: freeze after pilot and model
    remaining censoring; never keep degrading merely to force failure.

### D. Facet outcomes and grading

20. **OPEN D1 — Primary outcome.** Aggregate `G`, one named facet, or a multivariate/facet-interaction
    model? If five facet tests are co-primary, specify correction.
21. **OPEN D2 — Research scoring.** Use game scores or research-specific rubrics? Recommendation:
    research-specific; the date slider and map-centroid behavior are product rules under repair.
22. **OPEN D3 — Date.** Absolute year error, log-time distance, period bins, catalog uncertainty
    intervals, or a combined rubric?
23. **OPEN D4 — Place.** Require one top-choice canonical country/region plus confidence and optional
    ranked alternatives? Recommendation: yes; primary score uses top choice, avoiding “or” parsing and
    fake country centroids.
24. **OPEN D5 — Medium.** Exact material, broad scoring bucket, support+material, or hierarchical
    partial credit?
25. **OPEN D6 — Movement/style.** How are multiple valid labels, culture/period versus movement, and
    works with no movement handled?
26. **OPEN D7 — Artist.** Anonymous, workshop, circle, attributed-to, culture-made, and collective
    works need prespecified `notApplicable`/partial-credit rules.
27. **OPEN D8 — Confidence.** One probability per facet and exact identification? Prefer Brier/log
    score plus registered calibration bins over ECE alone.
28. **OPEN D9 — Grader.** Fully deterministic aliases/taxonomies, blind human adjudication for
    ambiguous responses, or a separately validated model grader? No grader may see rung, fame,
    region, condition, prediction, or analysis arm.

### E. Sampling, matching, and power

29. **OPEN E1 — Unique sample.** Is 800 the number of unique works or arm slots? Overlap must alter
    both cost and effective sample counts explicitly.
30. **OPEN E2 — Fame.** Treat pageviews, sitelinks, and the hand-set `+2000 canon` flag as separate
    variables rather than one “English fame” score? Recommendation: yes; report composite only for
    continuity with the old study.
31. **OPEN E3 — Multilingual fame.** Define languages, time window, redirects, missing pages, article
    age, aggregation (`sum`, `log-sum`, per-language normalization), and both matched manifests.
32. **OPEN E4 — Region construct.** Creation place, culture, artist origin, or catalog region?
    Recommendation: creation/culture with explicit rules, never artist birthplace as a substitute.
33. **OPEN E5 — Matching covariates.** In addition to fame, match/adjust broad era, object type,
    medium, image fitness, source host, and perhaps artist cluster?
34. **OPEN E6 — Dependence.** Deduplicate copies/versions and cluster by artist/series/source where
    repeated works remain.
35. **OPEN E7 — Power.** Is sample size fixed by budget, simulation, minimum switchers, or all three?
    Use prior data only for design, not confirmatory outcome selection.
36. **OPEN E8 — Pilot.** Draw a separate pilot excluded from the main manifest, or predeclare how
    pilot works are replaced. Pilot may freeze transforms/operations, not tune hypotheses after
    looking at outcomes.

### F. Controls and operational protocol

37. **OPEN F1 — Alternate images.** Rung 0 only or full transform grid? V1's analysis says rung 0 but
    its budget buys eight rungs.
38. **OPEN F2 — Alternate sourcing.** Who verifies same-object identity and view comparability before
    outcomes, and what minimum quality makes a pair eligible?
39. **PROPOSED F3 — Documentation floor.** Rename to low-documentation stress test; zero Wikipedia
    does not prove absence from training.
40. **OPEN F4 — Note-only arm.** Retain at full n, reduce to a powered subset, or replace with prompt-
    order/reliability controls? Recommendation: replace or reduce sharply.
41. **OPEN F5 — Model.** Freeze exact model snapshot/API version/parameters/max tokens. Avoid a moving
    alias where possible.
42. **OPEN F6 — Temporal drift.** Randomize and block collection order across rung/fame/region and
    complete in a bounded window; record timestamps and request IDs.
43. **OPEN F7 — Retry.** Are retries replacements, replicate responses, or exclusions? Store every
    attempt and predefine which result is analyzed.
44. **OPEN F8 — Cost.** Re-estimate from the richer pilot responses and sanitized 1,568px derivatives;
    v1's $0.003/call and 10MB source exclusion are obsolete assumptions.
45. **OPEN F9 — Publication.** Publish transformed images, only hashes/scripts, or images where
    rights permit? Always publish request/response records subject to a safety review.
46. **OPEN F10 — Preregistration venue.** Repository commit alone, OSF-style registration, or both?

## 7. Study decision log

| ID | Date | Decision | Status | Rationale/evidence |
|---|---|---|---|---|
| RSD-001 | 2026-08-31 | Preserve the August 27 document unchanged as v1; revise in a separate v2 file before registration. | Approved | Owner instruction |
| RSD-002 | 2026-08-31 | Exact-work identification, not artist-only attribution, defines exact recognition. | Proposed pending owner confirmation | Independent reviews agree; avoids circular artist outcome |
| RSD-003 | 2026-08-31 | The degradation panel estimates recognition-associated change, not a clean causal retrieval effect. | Proposed pending owner confirmation | Transformation also removes visual evidence |
| RSD-004 | 2026-08-31 | Add a randomized same-image identity-information experiment as the candidate causal primary. | Proposed pending owner confirmation | Holds image bytes constant |

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
