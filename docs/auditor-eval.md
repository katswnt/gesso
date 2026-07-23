# Vision auditor — wrong-art detection eval

Measures how reliably the image-grounded vision audit catches an image that does **not** depict the work it's attached to. Ground truth is unambiguous by construction (see methodology).

## Results (n=50)

| Metric | Value |
|---|---|
| **Precision** (of flagged, how many were truly wrong) | **100.0%** |
| **Recall** (of truly-wrong, how many were caught) | **100.0%** |
| **F1** | **100.0%** |
| Accuracy | 100.0% |

## Confusion matrix

|  | truth: wrong-art | truth: correct |
|---|---|---|
| **auditor: flagged wrong** | 25 (caught) | 0 (false alarm) |
| **auditor: passed ok** | 0 (missed) | 25 (correct pass) |

## Methodology

- **Controls (label `correct`, n=25):** famous, previously-audited works shown with **their own** pool image → a correct auditor passes them (`image.ok=true`).
- **Decoys (label `wrong`, n=25):** real works shown with a **different work's image** (from a different region, so the mismatch is unmistakable) → a correct auditor flags them (`image.ok=false`).
- The audit agents saw a **blind, interleaved** set with no labels and no expected wrong/right ratio. Selection is deterministic (`scripts/eval-auditor.mjs`), so the eval is reproducible.
- **Honest limitation:** control labels assume the pool image for a famous, already-audited work is correct (not independently re-verified here); the decoy half is fully rigorous ground truth. Recall (catching planted wrong-art) is therefore the load-bearing number.
- **What a perfect score does and doesn't prove:** the decoys are *gross* cross-region mismatches (a Botticelli shown as dogs-playing-poker) — which is the dominant real-world failure mode (the actual wrong-art cases the pipeline caught were exactly this kind: an image resolving to a completely different artwork). This eval shows the auditor catches those reliably with no false alarms. It does **not** yet probe *near-miss* mismatches (a different work by the same artist, same era/subject); a harder decoy set is the natural next iteration.

_Regenerate: `node scripts/eval-auditor.mjs && (run the 2 blind audit agents) && node scripts/eval-score.mjs`._
