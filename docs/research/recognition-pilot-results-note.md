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
- **Supplying the true identity helps inference a little, mostly for dating and attribution** — a
  small, real anchoring effect, not a large one.
- **The model is honest and reliable.** It self-reports non-recognition rather than bluffing, and
  repeat agreement is high (0.92 identification, 0.96 graded-facet).

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

**Robustness.** Recognition degrades monotonically as the image is cropped: full 8/28 → crop70 7/32 →
crop45 3/27 → crop25 2/34. Mirror, grayscale, and rotation were kept as separate branches, not folded
into a single degradation axis.

**Reliability.** Identification exact agreement 0.92 across 25 repeat pairs (above the frozen
threshold). The recognition signal is stable, not lucky draws.

## Study C — same-object recognition is fragile

Six objects were each shown from a genuinely different second photograph. Mean alternate-minus-canonical
exact recognition was −0.17, driven almost entirely by one work (the British Museum ram, recognized in
the canonical photo, lost in the alternate). Only the Mask of Agamemnon was recognized in both. A
different photo of the same object often breaks recognition.

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
20 minutes, **$1.52**. **Zero title/type echoes.**

**Validity by arm** (vs the frozen pilot's 90 / 79 / 23%):

| Arm | Valid / 36 | Rate |
|-----|-----------|------|
| no-cue | 34 | 94.4% |
| sham | 35 | 97.2% |
| correct-cue | 36 | 100% |

Near-uniform, **no differential dropout**. **33 of 36 complete triplets** (frozen pilot had 7). Both
interpretability gates pass (≥90% per arm, ≥30 triplets), so the causal result is reportable.

### Causal result (graded facet credit, work-weighted, 33 works)

| Contrast | Effect |
|----------|--------|
| correct-cue − sham | **+0.043** |
| correct-cue − no-cue | +0.064 |
| sham − no-cue | +0.021 |
| leave-artist-out (correct − sham) | +0.036 |
| paired variance (correct − sham) | 0.020 |

Per-facet correct-minus-sham: **date +0.090**, **artist +0.111** (18 works), style +0.032,
place +0.030, **medium −0.008**.

**Reading.** Supplying the correct identity gives a small, positive lift to inference, concentrated
exactly where identity should help — dating and attribution — while medium (read straight from pixels)
is unmoved and a false label is nearly inert (sham − no-cue ≈ 0). The effect survives dropping the
artist facet, so it is not artist-only. It is the same direction as the frozen pilot's discarded
estimate but smaller, and now trustworthy because there is no differential missingness inflating it.

**Reliability.** 51 repeat facet-pairs: exact graded-credit agreement 0.96, mean absolute credit
difference 0.026.

## Honesty caveats

- The corrected run is a **separate experiment**, not a repair of the frozen data. The frozen pilot
  remains sealed and unchanged; its Study A / C / reliability results stand.
- The corrected instrument is a **different generation regime** than the frozen pilot (fixed prompt,
  higher cap), so the Study B numbers are not drop-in comparable to the frozen pilot's other arms.
- A parser regression was introduced and caught during the corrected run (the cued arms wrap valid JSON
  in a code fence; the first attempt used a stricter parser). It was fixed at 13 calls / $0.17 by
  restoring the original fence-tolerant, truncation-strict parser, and the run re-done clean.
- 3 of 119 corrected calls returned non-JSON the parser could not salvage (2 no-cue, 1 sham). This is
  not the old bug, is non-differential, and is within the 90%-per-arm gate.

## What a full study would need

This is a pilot for calibration and instrument shakedown, not a powered confirmatory study. A real
Study B would pre-register the effect size from independent data (not from this excluded pilot),
power the sample accordingly, and treat the +0.043 here as a nuisance estimate only. Study A would
benefit from more works per fame×region cell before any bias claim is made.

## Cost and reproducibility

- Frozen pilot: 671 calls, $7.75, ~2 hours.
- Corrected Study B: 119 calls, $1.52, 20 minutes ($1.69 including the caught-and-fixed first attempt).
- Corrected instrument: `scripts/lib/recognition-studyb.mjs`, `scripts/recognition-studyb-{prepare,run}.mjs`,
  `scripts/analyze-recognition-studyb.mjs`, tests in `tests/recognition-studyb.test.mjs`. Draft
  artifacts and the machine-readable report under `docs/research/recognition-studyb/`.
