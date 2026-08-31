# Pre-registration: does recognition substitute for inference in vision-language models?

**Kat Swint · drafted 27 August 2026 · not yet run**

This document is written **before** data collection. Predictions, exclusions, and the analysis plan
are fixed here. Deviations get recorded in a deviations log with the date and reason, not silently
folded into the writeup.

That constraint is the point of the exercise. The prior guessability work applied methodological
discipline reactively — auditing results after the fact. This applies it prospectively.

---

## 0. What this replaces, and why it isn't a patch

The existing probe (`data/guessability/probe-sonnet.json`, n=410) has four problems that are
structural rather than fixable:

1. **Adaptive stopping censors 54% of observations.** The ladder halts at the first
   non-recognition, so for works that survive all rungs you never observe where recognition would
   break. That censoring is baked into the artifact.
2. **The outcome is unvalidated self-report.** `recognized` is a boolean the model reports about
   itself, never checked against whether it can name the right work.
3. **The sample is the Easy tier** — probe fame median 1,084 against a pool median of 26, so
   roughly the top 6% by fame. Findings phrased about "artworks" are really about famous artworks.
4. **One read per work forecloses a within-subject design.** All comparisons are between works,
   which means every work-level covariate is a potential confound.

Each of these is a sampling or design decision, not a bug. Re-running is cheaper than patching.

**The economics changed.** The three-arm F-04 experiment cost $0.44 for 150 calls (~$0.003 each).
The adaptive ladder was a cost optimization for a constraint that no longer binds. A full factorial
grid at the sample sizes below runs about $17.

---

## 1. Primary question

**When a vision-language model recognizes a specific artwork, how much of its apparent inference is
retrieval?**

Operationalized as a within-work contrast: for the same work, compare inferential accuracy at a
rung where the model can identify it against a rung where it cannot. The work is its own control,
so composition, subject, medium, condition, photograph quality, and every other work-level
covariate are held constant by construction.

**Primary outcome:** the within-work accuracy drop from recognized to non-recognized rungs, across
five independently graded facets (date, place, medium, movement, artist).

This is the measurement the existing study cannot make, and it is a stronger design than any
between-work correlation.

## 2. Secondary questions

**S1.** Does fame predict recognition resistance — the depth at which identification fails?
*(The original question, with an uncensored outcome and a validated measure.)*

**S2.** Among works whose recognition has broken, does fame predict blinded inferential accuracy?
*(Testing the ρ = −0.183 inversion from the prior analysis on a clean sample.)*

**S3.** Does the fame effect separate from a Western-canon effect at matched fame?
*(Only answerable in the low-fame band. See §4.)*

**S4.** Is identification image-template memorization or work-level knowledge?
*(Tested with alternate photographs of the same object. See §5.)*

**S5.** Is the model better calibrated when blinded, having to justify from pixels?
*(Confidence-accuracy correspondence, recognized versus not.)*

---

## 3. Design

**Full factorial. Every sampled work at every rung. No adaptive stopping.**

This eliminates censoring entirely and produces the within-work contrast that §1 requires.

### The ladder

Extended past the current top rung, because 54% of the previous sample survived rung 4 and
survivors contribute nothing to a within-work comparison. The ladder must reach a floor where
nearly everything breaks.

| rung | transform |
|---|---|
| 0 | full image, unmodified |
| 1 | horizontal flip |
| 2 | flip + 90° rotate |
| 3 | flip + rotate + crop to 60% |
| 4 | flip + rotate + crop to 45% |
| 5 | flip + rotate + crop to 30% |
| 6 | flip + rotate + crop to 20% |
| 7 | grayscale + flip + rotate + crop to 30% |

**Stopping rule for ladder design, fixed in advance:** if fewer than 85% of works have broken by
rung 7, add rungs and re-run the full grid. Do not analyze a partially-censored dataset. If more
than 85% break by rung 5, drop rungs 6–7 from the analysis as uninformative but keep the collected
data.

### The transform note

The prior ladder appended "this image has been mirrored, rotated, cropped" from rung 1 onward,
confounding the pixel transform with telling the model it is being manipulated. Prior measurement
bounds this at ≤0.8 percentage points, so it is small — but it is now cheap to eliminate.

**No note at any rung.** Additionally, a **note-only arm** at rung 0: unmodified image, note
present. If recognition drops there, the note is doing work and it gets reported.

### Identification, not self-report

The model is asked to name the work, not to introspect about recognition. Graded against ground
truth into four levels:

| level | criterion |
|---|---|
| 2 | names the work (title match, or unambiguous description) |
| 1 | names the artist but not the work |
| 0 | neither |
| −1 | names a *different specific* work confidently (confabulation) |

Level 2 or 1 counts as recognized for the primary contrast. **Level −1 is tracked separately and is
interesting in its own right** — confident misidentification under degradation is a distinct failure
mode from graceful non-recognition, and nothing in the prior work distinguishes them.

Self-reported `recognized` is *also* collected, so calibration of self-report against identification
becomes a measurable secondary result rather than an assumption.

### Blinded grading

The grading script receives the response and ground truth, never the rung. Grading logic is written
and tested against synthetic responses **before** any real data is collected.

---

## 4. Sampling

**n = 800 works** from the full 6,557-work pool. Not the Easy tier. Two arms:

- **Fame-stratified arm, 500 works** — for the primary hypothesis, S1, S2, S4, S5
- **Region-matched arm, 150 pairs = 300 works** — for S3

Works may serve both arms where a matched-pair member also falls in a fame stratum; overlap is
recorded and the effective n per analysis is reported.

### Fame strata (500 works)

Five bands, 100 works each, boundaries fixed from pool percentiles:

| band | fame range | pool n | draw |
|---|---|---|---|
| F1 | 0 | ~1,900 | 100 |
| F2 | 1–100 | ~2,300 | 100 |
| F3 | 101–612 | ~1,000 | 100 |
| F4 | 613–1,000 | ~1,100 | 100 |
| F5 | 1,001+ | ~300 | 100 |

Equal-n rather than proportional, because the question is about the fame gradient and proportional
sampling would put 60% of the sample in the undocumented tail.

### Region: a matched-pairs arm, not a band comparison

**A first draft of this design compared regions within the lowest fame bands, because that is where
both regions have volume. That was wrong, for four reasons worth recording.**

*Floor effects.* NC-2 predicts recognition collapses for undocumented works, and the low bands **are**
the undocumented works. A null there means "nothing down here is recognized," not "region doesn't
matter," and the design could not tell those apart.

*The interesting question lives at high fame.* "Do models know Western canon better" is interesting
*because of canon*, and canon is high-fame by definition. Comparing obscure European against obscure
non-European works asks about training-data density in the tail — related, and less interesting.

*Range restriction.* Holding fame constant is trivially satisfied where fame barely varies. The
result would say nothing about whether region matters *as fame rises*, which is the actual shape of
the hypothesis.

*Fame does not mean the same thing across regions.* Fame derives from English-Wikipedia pageviews
plus a hand-set canon flag. A woodblock print famous in Japan and a genuinely obscure Dutch panel can
both score near zero without being matched on exposure to the training distribution — and the
mismatch runs in exactly the direction that would manufacture a region effect.

**Measured alternative.** A greedy caliper match on fame, non-European works to European works:

| caliper | matched pairs | pairs at fame ≥100 | ≥300 | ≥613 |
|---|---|---|---|---|
| ±0 | 1,586 | 190 | 184 | 108 |
| **±5** | **1,653** | **242** | **233** | **135** |
| ±10 | 1,661 | 247 | 238 | 138 |

**S3 uses fame-matched pairs at a ±5 caliper**, which controls fame exactly rather than by band,
spans the full fame range, escapes the floor zone, and gains the power of a paired design.

**Draw 150 pairs**, allocated to over-sample the informative range: 100 pairs at fame ≥300 (233
available), 50 pairs below. Both members of a pair enter the sample. Matching is done on the
committed manifest before any collection, and the matched fame values are reported.

**Pilot variance gate, fixed in advance:** if pilot identification at rung 0 falls outside 20–80% in
either arm of the matched set, the comparison is underpowered by floor or ceiling and S3 is reported
as inconclusive rather than as a null. This is pre-specified so the pilot can rule the analysis out,
not just tune it.

### The fame measure itself, and why it is a second arm

English-Wikipedia pageviews are a region-biased proxy for exposure. This is not a caveat to note in
the discussion — it is testable, and testing it is more interesting than S3.

**Prerequisite:** compute a second fame measure from pageviews summed across multiple language
Wikipedias (at minimum en, ja, zh, es, fr, de, ar, hi, ru, pt), via the Wikimedia REST pageviews
API. Record both measures in the manifest.

**S3 is then reported against both.** If a region effect appears under English-only fame and vanishes
under multilingual fame, **that is the finding** — and it is a better one than either version of S3,
because it is about the measurement instrument rather than the model. If the effect survives both,
that is stronger evidence for a genuine canon effect than any single-measure result.

Matching is performed on English-only fame, because that is the measure the prior work used and the
one whose bias is under test.

### Continents

Within non-European draws, sample proportionally across Asia / North America / Africa / South
America / Oceania rather than treating "non-European" as one category. Per-continent n will be small
in some cells; no per-continent claim without a bootstrap CI excluding zero.

### The confound may not be separable in principle

Fame and region are entangled in this corpus because both descend from the same process — what got
digitized, written about, and reproduced. If they are entangled in the training data for the same
reason, statistically separating them is attempting to decompose something that is not decomposed in
the world.

Recorded here rather than discovered later: **"Western canon membership" may be the honest construct
rather than a confound to be removed.** The multilingual-fame arm is the test of which framing is
right, and if both measures give the same answer, the paper says so.

### Selection procedure and provenance

Seeded PRNG, seed recorded in the manifest. **The manifest — every id, its stratum, its draw
order, the seed, and the pool commit hash — is committed before the first API call.** The prior
study's selection provenance is unrecoverable; this one is reproducible by construction.

---

## 5. Negative controls

Two, doing different jobs.

**NC-1 · Alternate photographs (n = 60).** For 60 works in F4–F5, source a second photograph or
scan of the same object from a different institution, angle, or lighting. If identification holds on
the canonical image and fails on the alternate, that is image-template memorization. If it holds on
both, it is work-level knowledge.

This distinguishes two mechanisms the prior study cannot separate and it is the most interesting
single arm in the design.

**Feasibility gate:** if fewer than 40 of 60 alternates can be sourced, drop NC-1 and say so. Do not
substitute crops of the same photograph — that tests something else.

**NC-2 · Documentation floor (n = 60).** Works with zero Wikipedia pageviews, no Wikipedia article,
and recent digitization. Recognition should collapse. If it does not, the identification measure is
picking up something other than prior exposure and the whole design needs rethinking.

The 8 `aic-blob` works from the prior probe (mean stop rung 0.13) are candidates and should be
checked first — they may already constitute a natural control.

---

## 6. Predictions, registered

Written before collection. Reporting where these were wrong is a deliverable, not an embarrassment.

**P1 (primary).** Within-work accuracy will drop when identification breaks, and the drop will be
largest for `date` and `artist` and smallest for `medium`. *Reasoning: medium is genuinely visible
in the image; a precise date is not.* **Confidence: high on direction, moderate on ordering.**

**P2.** The drop will be larger for high-fame works than low-fame works. *Reasoning: more retrieval
available to lose.* **Confidence: moderate.**

**P3 (S1).** Fame will predict identification depth, positively and weakly — ρ between 0.15 and
0.35 on the uncensored measure. *Reasoning: the tie-corrected prior estimate was 0.271 overall,
0.169 non-canon, on a censored range-restricted sample.* **Confidence: moderate.**

**P4 (S2).** The negative fame-to-blinded-accuracy relationship will replicate, weakly, in the
range −0.10 to −0.30. *Reasoning: prior estimate −0.183 shipped, −0.254 excluding the broken `where`
facet, stable across era strata.* **Confidence: moderate. This is the prediction most likely to
fail, because the prior estimate came from a sample where "clean" meant "the ladder happened to
break it," which is itself selection.*

**P5 (S3).** On fame-matched pairs under **English-only** fame, European works will show a
recognition advantage of 10–25 percentage points. *Reasoning: English fame under-counts non-Western
exposure, so matching on it leaves European works genuinely better represented in training.*
**Confidence: moderate.**

**P5b (S3, the interesting half).** Under **multilingual** fame the advantage will shrink by at
least half. *Reasoning: if the effect is largely a measurement artifact, a less biased exposure
proxy should absorb most of it.* **Confidence: low.** If the advantage survives both measures, that
is real evidence of a canon effect over and above documentation density — and that is the more
interesting outcome, so this prediction is one I would be glad to lose.

**P6 (S4).** Identification will be substantially weaker on alternate photographs — at least a 30
percentage point drop at rung 0. *Reasoning: consistent captioning of canonical reproductions is the
plausible memorization mechanism.* **Confidence: moderate-high.**

**P7 (S5).** Confidence-accuracy correspondence will be *better* when blinded. *Reasoning: forced to
justify from pixels, the model has access to the actual evidence for its uncertainty.*
**Confidence: low. Genuinely uncertain, which is why it is worth measuring.**

**P8.** Confident misidentification (level −1) will peak in the middle of the ladder, not at the
extremes. *Reasoning: enough signal to guess, not enough to be right.* **Confidence: moderate.**

---

## 7. Analysis plan

Fixed in advance. Anything not listed here is exploratory and gets labeled as such.

**Primary.** Paired comparison within work, recognized rungs versus non-recognized rungs, per facet.
Wilcoxon signed-rank on the paired differences; effect size as the median paired difference with a
bootstrap CI. Works that never break, or break at rung 0, are excluded from the primary and their
count is reported.

**S1.** Tie-corrected Spearman of fame against identification depth. Reported overall, within
region, and within era. Bootstrap CIs throughout.

**S2.** Tie-corrected Spearman of fame against facet accuracy, restricted to non-recognized reads.
Reported with and without the `where` facet, since the `where` grader is being fixed as a
prerequisite (below) and the prior analysis showed the result strengthens when it is removed.

**S3.** Matched pairs only. Paired difference in identification depth, European minus non-European
member, at each rung. Wilcoxon signed-rank; bootstrap CI on the median paired difference. **Reported
twice — once matched on English-only fame, once on multilingual fame** — and the difference between
those two results is itself reported. Subgroup by fame tertile within the matched set, labeled
exploratory.

**S4.** Paired: canonical versus alternate photograph, same work, rung 0. McNemar on identification
success.

**S5.** Correspondence between stated confidence and facet accuracy, split by recognition state.
Reported as calibration curves plus a bootstrap CI on the difference in expected calibration error.

**Multiple comparisons.** One primary hypothesis, five secondaries. Holm-Bonferroni across the five
secondaries. The primary is not corrected. Any post-hoc stratification is exploratory, labeled, and
not reported with p-values.

**Exclusions, defined now:** API errors after three retries; images exceeding the 10 MB limit
*(downscale first and only exclude if it still fails — the prior three-arm run lost two controls
this way and both were unusually large canonical works, which is a non-random exclusion)*; works
where ground truth is itself disputed in the source metadata. All exclusion counts reported.

---

## 8. Prerequisites

Do these before collecting anything.

1. **Compute the multilingual fame measure.** Pageviews summed across at least en, ja, zh, es, fr,
   de, ar, hi, ru, pt via the Wikimedia REST pageviews API, over a fixed window recorded in the
   manifest. Both measures stored per work. This is a prerequisite, not an analysis step, because
   the matched set is built before collection.

2. **Fix the `where` grader.** `placeCountry` (`index.html:418`) splits on `[,/;]` but not "or" —
   102 of 103 zero-scores contain "or," and in 62 cases one disjunct matches truth. Separately, the
   bounding-box-midpoint centroid puts France at 26.60°N, 22.48°W because French Guiana widens the
   box; all 94 exact "France" guesses score 0.315–0.598.
   **Decide explicitly and record the decision:** does a hedged answer ("Netherlands or Belgium")
   earn partial credit, full credit, or nothing? That is a policy choice, not a bug fix, and it
   belongs in this document rather than in the code silently.

3. **Write and test the grading script against synthetic responses.** Before any real data. If
   grading logic is written after seeing responses, it fits them.

4. **Commit the manifest.** Ids, strata, matched-pair assignments with both fame values, seed, and
   pool commit hash.

5. **Run 20 works × all rungs as a pilot** — 10 from the fame strata, 5 matched pairs. Verify the
   pipeline, image handling, and grading, and evaluate the §4 variance gate. Do not analyze the pilot
   for hypothesis-relevant results, and do not include it in the main sample.

---

## 9. Cost and scope

| item | calls | est. cost |
|---|---|---|
| Fame-stratified arm: 500 works × 8 rungs | 4,000 | ~$12 |
| Region-matched arm: 300 works × 8 rungs | 2,400 | ~$7 |
| Note-only arm: 800 × 1 | 800 | ~$2 |
| NC-1 alternates: 60 × 8 | 480 | ~$1.50 |
| NC-2 documentation floor: 60 × 8 | 480 | ~$1.50 |
| Pilot | 160 | ~$0.50 |
| **Total** | **~8,300** | **~$25** |

Based on the measured $0.003/call from the three-arm run. Budget $50 for retries and a partial
re-run.

**Not in scope, stated so it does not creep in:** multi-model comparison (a second model doubles
everything and the within-model question comes first); open-weights representation probing (a
different project, and it depends on this one's labels); human baseline collection.

---

## 10. What gets published regardless of outcome

Committed in advance, so a null result does not quietly become an unpublished result.

- The manifest, the raw responses, the grading script, and the analysis script.
- This document, plus the deviations log.
- Every registered prediction with its outcome, including the wrong ones.
- The exclusion counts and the reasons.
- The region composition of each fame stratum as observed, with the confound stated plainly.
- The matched-pair table with both fame measures, so the matching is auditable.

**A design-revision note goes in the paper.** The first draft of this pre-registration compared
regions within low fame bands. That design had a floor effect that would have made a null
uninterpretable, and it tested the question in the range where it is least interesting. The
matched-pairs design replaced it before collection. Recording that is part of the point.

**Null results that are still worth publishing:** if the within-work drop is negligible, that means
recognition is *not* substituting for inference and the entire blinding enterprise is unnecessary —
which would be a genuinely useful finding for anyone building evals on perturbation. If P5 fails and
region matters at matched fame, that is a finding about canon rather than documentation. If P6 fails
and alternate photographs are recognized as well as canonical ones, that is work-level knowledge
rather than template memorization, and it is the more interesting outcome.

---

## 11. Known limits, stated now

- **One model, one date.** Nothing here generalizes across model families and no claim will be made
  that it does.
- **Fame is a proxy, and a region-biased one.** Derived partly from English pageviews and partly
  from a hand-set `canon` flag worth a flat +2000 (`make-fame-js.mjs:30`), over half the magnitude
  for canonical works. Analyses report with and without the flag contribution, and S3 reports under
  both the English-only and multilingual measures.
- **Multilingual pageviews are a better proxy, not a good one.** They still measure documentation in
  languages with large Wikipedias, and say little about works significant in oral or non-textual
  traditions. The measure is less biased, not unbiased.
- **Ground truth is institutional.** Museum and Wikidata attributions, which have their own errors,
  particularly for non-Western material. Disputed cases are excluded and counted.
- **The corpus is public-domain only**, which is itself a selection effect on what exists to be
  measured — the same copyright-shaped canon problem already documented in `docs/ethos.md`.
- **Per-continent n will be small** in F3–F5. No per-continent claims without a CI excluding zero.
- **This measures identification and inference, not memorization in the generative sense.** A model
  can identify a work it cannot reproduce. The generative question needs a different study.
