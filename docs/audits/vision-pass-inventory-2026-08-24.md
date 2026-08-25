# Vision-pass inventory and overlap audit

**Date:** 2026-08-24  
**Audited HEAD:** `053a4fd`  
**Counting method:** IDs were canonicalized by Wikidata QID so `wd:Q…`, `wikidata:Q…`, and full Wikidata URLs count as the same work. “Current” means the ID still resolves to one of the 6,557 current pool works.

## Executive summary

There are two production/content vision passes represented by distinct completion sets, four specialized vision research/verification runs, and one legacy hotspot layer. In practical terms that is **six active or analytically meaningful workflows, plus one historical artifact layer**.

The naming is confusing because “Vision v2” is used for two different ideas:

1. A 202-work rich structured enrichment experiment stored in `data/vision.js`.
2. The feature-anchored notes/pins behavior folded into the corpus-scale canonical vision audit.

The canonical production ledger currently covers **5,972 of 6,557 works (91.1%)**, not the whole current corpus. It did historically reach 100% when the pool contained roughly 5,954 works; later corpus growth made the “covered the corpus” documentation stale.

## Inventory

| Workflow | Purpose | Completed | Persistence | Principal overlap |
|---|---|---:|---|---|
| Canonical combined vision audit | Production image QA + notes/pins | **5,972 / 6,557 current works** | Tracked ledger | Main superset |
| Rich Vision v2 enrichment | Deep per-image structured visual record | **202 works** | Tracked | All 202 canonical-audited |
| Legacy hotspot generation | Locate existing cues on image features | **5,736 current works** | Tracked output, mixed provenance | 5,728 canonical-audited |
| Adaptive guessability probe | Recognition resistance + five inference categories | **410 works** | Tracked durable probe | All 410 canonical-audited; 56 rich-v2 |
| Image-consistency verifier | Pixels versus catalog metadata | **515 valid verdicts / 650 attempts** | Ignored local output | All 515 canonical-audited; 92 rich-v2 |
| Predict-the-human pilot | Model-predicted non-expert scores | **29 valid / 30 attempts** | Ignored local output | All 29 canonical-audited; 28 rich-v2 |
| Wrong-art auditor eval | Benchmark the verifier on controls/decoys | **50 / 50 cases** | Inputs/outputs ignored; report tracked | All 50 canonical-audited and in guessability probe |

There is additionally an untracked in-progress guessability candidate file containing **23 completed works**. Those 23 are distinct from the committed 410-work probe; all 23 are already in the canonical audit ledger.

## 1. Canonical combined vision audit

### Source of truth

- Selection: [`scripts/vision-next.mjs`](../../scripts/vision-next.mjs)
- Judgment schema: [`scripts/vision-audit-prompt.md`](../../scripts/vision-audit-prompt.md)
- Merge: [`scripts/curate-merge.mjs`](../../scripts/curate-merge.mjs)
- Completion ledger: [`data/vision-audit.json`](../../data/vision-audit.json)

The ledger explicitly describes itself as the source of truth for a genuine image-grounded notes/pins pass, distinct from a work merely being touched by a text/manifest pipeline.

### What it checks

One image view produces seven classes of judgment:

1. `image.ok`: does the image depict the cataloged work?
2. `playable`: is there any usable visual signal for a player?
3. `imageQuality`: blurry, dark, low-resolution, glare, or otherwise poor?
4. `framing`: whole work, crop, detail, or object lost in a gallery shot?
5. `mediumLegible`: can the medium fairly be inferred from this image?
6. `notes` plus feature-anchored pins: visible teaching observations with pins directly on the described feature.
7. Optional `fields`: confident medium/style/style-kind correction proposals.

Unsafe corrections such as image URL, title, place, coordinates, and date go to human review rather than being auto-applied.

### Completion

- Ledger IDs: **6,012 lifetime IDs**.
- IDs resolving to current pool: **5,972**.
- Stale/orphan ledger IDs: **40**.
- Current pool coverage: **91.1%**.
- Current works not in the ledger: **585**.

The near-term scheduling gate is less alarming than the corpus-wide gap: at audit time only eight works scheduled in the next 14 days were missing vision coverage.

## 2. Rich Vision v2 enrichment

### Source

- Prep: [`scripts/vision-v2-prep.mjs`](../../scripts/vision-v2-prep.mjs)
- Merge: [`scripts/vision-v2-merge.mjs`](../../scripts/vision-v2-merge.mjs)
- Output: [`data/vision.js`](../../data/vision.js)

### What it checks

This records a substantially richer schema:

- A free visual description (`seen`).
- Evidence for when, where, medium, style, and artist, with bounding boxes and reasons.
- Pins and “delight” regions.
- Palette, format, figure count/identity, pose and gesture.
- Signature, condition, and image artifacts.
- Image quality and image/catalog consistency.
- Model recognition and category-level guessability.
- Movement suggestion and metadata/playability flags.

### Completion and overlap

- **202 current works**.
- All 202 are also in the canonical audit ledger.
- 195 have current hotspot records.
- 56 are in the committed guessability probe.

This pass therefore adds depth but no unique production coverage.

Only its pins are consumed by the current application. Seven of the 202 records lack a hotspot equivalent; the other rich fields are currently shipped but not read by runtime code.

## 3. Legacy hotspot generation

### Sources

- [`scripts/next-hotspots.mjs`](../../scripts/next-hotspots.mjs)
- [`scripts/hotspot-manifest.mjs`](../../scripts/hotspot-manifest.mjs)
- [`scripts/hotspot-codex.mjs`](../../scripts/hotspot-codex.mjs)
- [`scripts/staged-hotspots.mjs`](../../scripts/staged-hotspots.mjs)
- Output: [`data/hotspots.js`](../../data/hotspots.js)

### What it checks

The core hotspot pass is narrow: it views the image and assigns coordinates to existing teaching cues that identify a single locatable feature. It skips broad material/technique cues with no sensible point.

The staged variant also asked for a basic `imageOk` mismatch verdict, but it did not perform the full canonical playability/quality/framing/medium-legibility audit.

### Completion and overlap

- Historical hotspot records: **5,795**.
- Records belonging to current pool: **5,736**.
- Stale/orphan hotspot keys: **59**.
- Total stored pins: **28,679**.
- Current hotspot works also canonical-audited: **5,728**.
- Current hotspot works not represented in the canonical ledger: **8**.
- Canonical-audited works without hotspots: **244**.

Those 244 are not automatically failures: abstract, damaged, unpinable, failed-image, or explicitly no-pin works can legitimately lack hotspots.

`data/teach-works.js` must not be used as a vision completion ledger. It has 5,968 current work records, but those records mix text-generated and image-grounded material. Of those, 5,960 overlap the canonical ledger and eight are legacy-only.

## 4. Adaptive guessability and recognition probe

### Sources

- Runner: [`scripts/vision-guess.mjs`](../../scripts/vision-guess.mjs)
- Durable probe: [`data/guessability/probe-sonnet.json`](../../data/guessability/probe-sonnet.json)
- Grading: [`scripts/grade-guessability.mjs`](../../scripts/grade-guessability.mjs)
- Ease model: [`scripts/ease-metric.mjs`](../../scripts/ease-metric.mjs)

### What it checks

The model receives only image pixels and estimates:

- Date/period.
- Place/region.
- Medium.
- Style or culture.
- Artist.
- Whether it recognizes the specific work.
- Expected non-expert inferability.

The adaptive ladder escalates from full image through mirror, rotation, and progressively tighter crops, stopping when recognition breaks or the ladder is exhausted.

### Completion and overlap

- Durable committed probe: **410 works**.
- All 410 are current pool works and canonical-audited.
- 400 have hotspots.
- 56 have rich-v2 records.

The untracked candidate partial adds 23 completed, non-overlapping probe candidates, but it is an in-progress local artifact rather than part of the durable 410-work result.

This is a research pass, not production QA. It should not make a work eligible for scheduling or mark its image/catalog relationship as verified.

## 5. Predict-the-human pilot

### Source

[`scripts/vision-predict-human.mjs`](../../scripts/vision-predict-human.mjs)

### What it checks

The model sees the full image, is allowed to recognize it, and predicts how a typical art-curious non-expert would score on when, where, medium, style, and artist. It is designed to complement the blinded guessability signal and human study results.

### Completion and overlap

- Attempted: **30 works**.
- Valid predictions: **29**.
- All 29 are canonical-audited and have hotspots.
- 28 have rich-v2 records.
- 12 overlap the current committed 410-work guessability probe.

The output lives in ignored `data/incoming`, so this count is local and not reproducible from a fresh clone.

## 6. Image-consistency verifier

### Source

[`scripts/vision-verify.mjs`](../../scripts/vision-verify.mjs)

### What it checks

This is a targeted, low-cost gross-mismatch detector. Given the pixels plus catalog title, artist, date, place/style, and medium, it asks whether the image is plausibly consistent with those facts. It is meant to catch a real but wrong artwork, not to grade player inference or produce teaching material.

### Completion and overlap

Initial local run:

- Targets: **650**.
- Valid consistency verdicts: **515**.
- Fetch/API/error records without verdict: **135**.
- Initially flagged mismatches: **44**.

All 44 initial flags were rerun with a stronger model:

- Rerun verdicts: **44 / 44**.
- Still flagged after rerun: **12**.

Because the rerun is a subset of the original 515 valid records, unique successful coverage remains **515 works**.

Overlap:

- All 515 are canonical-audited.
- 492 have hotspots.
- 92 have rich-v2 records.
- 90 are in the committed guessability probe.

## 7. Wrong-art auditor evaluation

### Sources

- Dataset builder: [`scripts/eval-auditor.mjs`](../../scripts/eval-auditor.mjs)
- Scorer: [`scripts/eval-score.mjs`](../../scripts/eval-score.mjs)
- Report: [`docs/auditor-eval.md`](../auditor-eval.md)

### What it checks

This is a benchmark of the auditor, not a content enrichment pass:

- 25 controls show an already-audited work with its own image.
- 25 decoys show a real work with a deliberately swapped cross-region image.

### Completion and overlap

- **50 / 50 cases completed**.
- All 50 are current pool works.
- All 50 are in the canonical ledger.
- All 50 are also in the committed guessability sample.
- 13 have rich-v2 records.

The existing 100% result measures gross mismatches only. The near-miss handoff correctly proposes graded same-region/style/artist/series decoys and fame stratification.

## Overlap by judgment type

| Judgment | Canonical audit | Rich v2 | Hotspot pass | Guessability | Image verifier | Auditor eval |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Correct artwork/image match | Yes | Yes | Sometimes/basic | No | Yes | Yes |
| Playability | Yes | Yes | No | Indirect only | No | No |
| Image quality/framing | Yes | Yes | No | No | Fetch only | Incidental |
| Medium legibility | Yes | Evidence | No | Measures inference | Consistency only | No |
| Notes and pins | Yes | Yes | Pins only | No | No | No |
| Style/medium correction | Optional proposal | Detailed suggestion | No | Measures inference | Consistency only | No |
| Recognition | No | Yes | No | Primary signal | No | Confound, not measured |
| Human difficulty prediction | No | Guessability estimate | No | Primary signal | No | No |

## Principal conclusions

1. **The canonical ledger is the only defensible production completion count.** Hotspot and teaching-note presence are not substitutes.
2. **The specialized passes overwhelmingly revisit canonical-audited works.** They add different evidence but almost no corpus coverage.
3. **Rich v2 and canonical “v2 markers” are different things.** The repository should stop using the same label for both.
4. **The README’s whole-corpus claim is historically true but currently false.** Current production coverage is 91.1%, with 585 pool works outside the ledger.
5. **Ignored research outputs are not portable evidence.** Counts for image verification and predict-the-human exist only in this local workspace unless promoted to tracked, provenance-bearing artifacts.
6. **The current runtime has two competing pin systems.** Rich-v2 pins take precedence for its 202 works; hotspots serve most of the rest. Migrating the seven missing rich-v2 pin sets would make `data/vision.js` removable from the runtime if its unused research fields are preserved elsewhere.

## Recommended nomenclature

Use stable names based on purpose rather than version numbers:

1. `contentVisionAudit` — the production 5,972-work ledger.
2. `richVisionEnrichment` — the 202-work structured experiment.
3. `hotspotPlacement` — the legacy coordinate-only layer.
4. `guessabilityProbe` — the 410-work adaptive recognition study.
5. `humanDifficultyPrediction` — the 29-work prediction pilot.
6. `imageMismatchScreen` — the 515-work catalog consistency screen.
7. `auditorEval` — the 50-case synthetic benchmark.

## Recommended maintenance artifact

Add a deterministic read-only report script that emits:

- Current pool size.
- Raw and in-pool counts for every vision artifact.
- Orphan/stale IDs.
- Pairwise overlap counts.
- Upcoming-daily coverage.
- Counts by region, source, fame band, and tier.
- Tracked versus ignored provenance.

That report should be the source for README/showcase coverage claims, eliminating hand-maintained totals and the current “which vision pass?” ambiguity.

