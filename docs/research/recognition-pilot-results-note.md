# Recognition-Inference Pilot — Results Note

_Gesso research. Status: pilot complete. Date: 2026-09-01._

## What this is

A blind-vision pilot testing what a tool-less, web-less Claude Sonnet 4.6 can and cannot do when
shown only sanitized pixels of an artwork. The founding question: **is fame the same thing as
guessability?** And underneath it: can the model _recognize_ the specific work, versus merely _infer_
its era, origin, and medium from visual evidence.

Two collections underlie this note:

1. **The frozen pilot** (`gesso-recognition-pilot-2026-08-31-v1`) — the full design, 671 calls,
   git-freeze-sealed before collection. Source of the Study A / C / reliability results.
2. **The corrected Study-B mini-pilot** (`gesso-recognition-studyb-2026-09-01-v1`) — a separate,
   smaller re-run, 119 calls, built after an instrument bug made the frozen pilot's Study B
   uninterpretable. Source of the causal (supplied-identity) result.

The frozen pilot's data was **never altered**. The corrected run is a new experiment, not a patch.

## Headline findings

- **Fame is not guessability.** Recognition rises with fame band but scatters hard within it. Of 36
  works, only 11 were recognized in any view; two equally-famous works can split from near-certain
  recognition to none.
- **Recognition and inference are separable and both measurable.** The model frequently gets the
  tradition right while missing the specific work (right school, wrong hand), which is the middle band
  the design was built to capture.
- **Supplying the true identity gives a small anchoring effect** on facet inference (correct−sham
  +0.070 graded credit after independent adjudication), concentrated in style, attribution, and dating.
  The ~95% interval marginally excludes zero ([+0.011, +0.129]), so the effect is *weakly*
  distinguishable from zero — but it is small, adjudicator-dependent, and **Codex-adjudicated rather
  than human-adjudicated** (see Study B).
- **Repeat agreement is high** (0.92 identification; 0.951 graded-facet in the adjudicated analysis).
  The model also tended to
  self-report non-recognition rather than bluff, though "honest" is a stronger claim than this pilot's
  evidence establishes.

## Study A — recognition (frozen pilot)

11 of 36 works recognized in at least one image view; 8 of 28 on the clean full image.

| Fame band | Recognized / works |
|-----------|--------------------|
| f1 (least famous) | 0 / 7 |
| f2 | 1 / 7 |
| f3 | 2 / 6 |
| f4 | 3 / 8 |
| f5 (most famous) | 5 / 8 |

A real dose-response with real scatter: f5 still misses three of eight, and mid-fame works are
recognized. Concrete cases: Rossetti's _Proserpina_ was named with confidence 97; the celebrated
Ō-Kanehira sword (a famous named blade) was described accurately as a signed tachi but never
recognized as the specific work. Recognition of a distinctive image is not the same as renown.

**Robustness.** Recognition declines as the image is cropped: full 8/28 → crop70 7/32 → crop45 3/27 →
crop25 2/34. This is monotonic **in the aggregate rates, not for every individual work** (one work's
sequence is non-monotonic). Mirror, grayscale, and rotation were kept as separate branches, not folded
into a single degradation axis.

**Reliability.** Identification exact agreement 0.92 across 25 repeat pairs (above the frozen
threshold). The recognition signal is stable, not lucky draws.

## Study C — same-object recognition is fragile

Six objects were each shown from a genuinely different second photograph. Mean alternate-minus-canonical
exact recognition was −0.17, but this rests on **one of six works** showing source-view dependence (the
British Museum ram, recognized in the canonical photo, lost in the alternate); the Mask of Agamemnon was
recognized in both and the other four in neither. The pilot shows one clear case of a different photo
breaking recognition, not that it "often" does — n is far too small for a rate claim.

## Prompt-order — negligible

Asking the model to name the work first versus describe facets first changed facet accuracy by −0.021.
No meaningful order effect.

## Study B — supplied identity (the causal question)

### Why the frozen pilot's Study B was thrown out

The frozen instrument rendered the response JSON Schema into the prompt including its **root `title`
and `type`**, and the model echoed those as data (`{"title":"Recognition pilot facet inference",
"type":"object", ...}`), which failed strict validation. The failure was **cue-dependent**: 10.2%
invalid with no cue, 20.5% with a correct cue, and **76.9% with a sham cue**. That left only **7 of 36**
complete matched triplets, and the dropout was not random with respect to the arms being compared. The
frozen Study B is therefore reported as **uninterpretable as frozen** (its exploratory correct-minus-
sham was +0.075, not to be trusted).

### The corrected mini-pilot

A separate run fixed the instrument and re-collected Study B only:

- Removed root `$schema`/`$id`/`title`/`type` from the model-facing schema render; stated explicitly
  that the only top-level keys are `date, place, medium, style, artist`.
- Raised the output cap to 1800 tokens to prevent truncation.
- Kept the prompt-level JSON method, strict validation (no key tolerance, no repair), and one identical
  applicable-facet mask across all three arms.

**Run:** 119 calls (36 no-cue + 36 sham + 36 correct-cue + 11 seeded repeats), all Sonnet 4.6, temp 0,
20 minutes, verified cost **$1.518306** (anchored post-hoc; see caveats). **Zero title/type echoes,
zero transport retries, three `end_turn` non-JSON failures.**

**Validity by arm** (vs the frozen pilot's 90 / 79 / 23%):

| Arm | Valid / 36 | Rate |
|-----|-----------|------|
| no-cue | 34 | 94.4% |
| sham | 35 | 97.2% |
| correct-cue | 36 | 100% |

Near-uniform, **no severe differential dropout observed**. The three invalids split 2 no-cue / 1 sham /
0 correct-cue — no severe arm concentration, but three failures cannot prove missingness is
non-differential. **33 of 36 complete triplets** (frozen pilot had 7). Both interpretability gates pass
(≥90% per arm, ≥30 triplets).

### Causal estimate — final (Codex-adjudicated)

Under the frozen protocol, a confident (≥60) but deterministically-unmatched place/medium/style/artist
answer goes to blinded adjudication rather than being auto-scored zero. **82 such in-mask facet cells**
(correct-cue 29 / no-cue 27 / sham 26, mostly style) were resolved by an **independent model
adjudicator (Codex)** — blinded to condition, work, and arm. This is a deliberate, labeled deviation
from the protocol's *human* adjudication step. The analyzer verified all 82 rulings SHA-bound before
finalizing.

| Contrast (Codex-adjudicated) | Estimate |
|----------|--------|
| **correct-cue − sham** | **+0.070** |
| correct-cue − no-cue | +0.076 |
| sham − no-cue | +0.006 |
| leave-artist-out (correct − sham) | +0.066 |
| paired variance (correct − sham) | 0.030 |
| ~95% CI (correct − sham) | **[+0.011, +0.129]** |

Per-facet correct-minus-sham: **style +0.150**, **artist +0.125** (16 works), **date +0.090**,
place +0.030, medium 0.000.

**Reading.** The anchoring effect is small and positive, concentrated where identity should help
(style, attribution, dating), with medium unmoved (read straight from pixels) and a false label nearly
inert (sham − no-cue ≈ +0.006). Adjudication mattered: crediting near-misses moved correct−sham from the
deterministic +0.043 to +0.070, and the ~95% interval now *marginally* excludes zero — so the effect is
weakly distinguishable from zero. Three caveats keep this honest: it is **Codex-adjudicated, not
human-adjudicated**; the lower bound (+0.011) sits just above zero on n=33 with a normal approximation,
so it is **suggestive, not robust**; and it is **sensitive to the adjudicator's partial-credit
generosity** (Codex assigned full credit to 51 of 82 and zero to only 6 — a stricter adjudicator would
pull the estimate back toward zero).

**Reliability.** In the final adjudicated analysis, **41 directly-comparable scored repeat facet-pairs**
give exact graded-credit agreement **0.951** and mean absolute credit difference **0.033**. (10
otherwise-eligible repeat pairs are omitted because their repeat-side answers were ambiguous and not
adjudicated on the repeat leg.) As a pre-adjudication sensitivity check, the deterministic scorer over
all **51 pairs** gives agreement 0.961 and mean absolute difference 0.026 — consistent, and both high.

## Honesty caveats

- The corrected run is a **separate experiment**, not a repair of the frozen data. The frozen pilot
  remains sealed and unchanged; its Study A / C / reliability results stand.
- The corrected instrument is a **different generation regime** than the frozen pilot (fixed prompt,
  higher cap), so the Study B numbers are not drop-in comparable to the frozen pilot's other arms.
- A parser regression was introduced and caught during the corrected run (the cued arms wrap valid JSON
  in a code fence; the first attempt used a stricter parser). It was fixed by restoring the original
  fence-tolerant, truncation-strict parser, and the run re-done clean. **Only the clean 119-call
  collection is preserved and independently verifiable at $1.518306.** The discarded first attempt
  (~13 calls, disclosed at ~$0.17) is not preserved locally, so the ~$1.69 inclusive figure is a
  disclosure, not an independently verifiable number.
- 3 of 119 corrected calls returned non-JSON the parser could not salvage (2 no-cue, 1 sham), all
  `end_turn` (one trailing quote, one prose preamble, one trailing `</s>`). This is not the old bug and
  shows no severe arm concentration, but three failures cannot prove missingness is non-differential.
- The corrected run's raw responses are gitignored; they are anchored post-hoc by
  `docs/research/recognition-studyb/collection-evidence.json` (an after-collection preservation anchor
  that did not exist before or during collection), not by an at-collection seal.

## What a full study would need

This is a pilot for calibration and instrument shakedown, not a powered confirmatory study. A real
Study B would pre-register the effect size from independent data (not from this excluded pilot),
power the sample accordingly, and treat the estimate here (correct−sham +0.070, Codex-adjudicated,
interval marginally excluding zero) as a nuisance estimate only. Study A would benefit from more works
per fame×region cell before any bias claim is made.

## Closure (complete)

The **82 blinded facet adjudications** were resolved by an independent model adjudicator (Codex),
blinded to condition/work/arm, and verified SHA-bound before the analyzer emitted `status: studyb-final`.
Artifacts: `blinded-review-packet.json`, `adjudication-controller.private.json`, `adjudications.json`
(rulings, reviewer "Codex (independent model adjudicator)"), and `collection-evidence.json` (the
after-collection anchor). A future run wanting a *human*-adjudicated number can refill the rulings
template against the same packet SHA.

## Cost and reproducibility

- Frozen pilot: 671 calls, $7.75, ~2 hours.
- Corrected Study B: 119 calls, verified **$1.518306**, 20 minutes. A discarded first attempt (~$0.17)
  is disclosed but not preserved/verifiable.
- Corrected instrument: `scripts/lib/recognition-studyb.mjs`, `scripts/recognition-studyb-{prepare,run,evidence}.mjs`,
  `scripts/analyze-recognition-studyb.mjs`, tests in `tests/recognition-studyb.test.mjs`. Draft
  artifacts, the collection-evidence anchor, and the machine-readable report under
  `docs/research/recognition-studyb/`.
