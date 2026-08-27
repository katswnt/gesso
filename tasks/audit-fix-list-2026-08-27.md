# Gesso — 2026-08-27 audit fix list and research plan

_Durable project record of the two consolidated audits supplied on 2026-08-27. The second audit (v2) supersedes v1 wherever their figures or interpretations disagree. This is an intake and sequencing document: verify every open item against current `HEAD` before changing code or claims._

## Current-HEAD reconciliation

- **Guarded writes are shipped, not dormant.** The v2 loose-end and governance table saying `db/guarded-writes.sql` has zero callers describes the pre-Stage-B snapshot. Stage B shipped at `5763503`; verified-cap paths in saves, score, profile, claim, and sync call the guarded RPCs. Observe-mode missing-cap compatibility remains deliberately unguarded until enforcement.
- **SEC-4 legacy count is 4, not 7.** The earlier count included three transient verifier fixtures. Steady state on 2026-08-27 was four profile-only device histories across two live accounts. One post-deploy active device had self-registered; that is one observed return, not a meaningful adoption rate.
- **G-19 is fixed locally.** Commit `cbfcfe8` replaces the token-spend claim with concrete QA outcomes and removes the unsupported rarity claim. It has not yet ridden a substantive push.
- The security rollout remains in `CAP_MODE=observe`. Nothing in this audit authorizes an enforcement flip, a legacy-row mutation, or a production change.

## Corrections from v2 (authoritative)

These corrections must travel with any analysis or writeup derived from v1.

1. **Tie-corrected fame/recognition correlations:** all `n=407`, Spearman rho `0.271`; canon `n=108`, `0.059`; non-canon `n=299`, `0.169`. The claim that fame predicts recognition resistance monotonically is unsupported.
2. **Transform-note confound is small:** the note's introduction at rung 1 accounts for three of 389 works (`0.8%`). Pixel severity, not the note, dominates drop rate. A note-only arm is optional.
3. **Censoring and self-report circularity were prior findings:** the August reliability audit and finding ledger already recorded the rung-4 `210/78` conflation, 95.6% imbalance, and self-report circularity.
4. **Ease-tiering is currently moot:** `ease.json` has no consumer.

## Research result discovered during the audits

Treat this as a strong **exploratory** result, not a publishable or causal claim yet.

On the 197 clean reads where recognition actually broke, fame and blinded guessability are negatively correlated:

| measure | n | rho | 95% CI |
|---|---:|---:|---:|
| G as shipped | 197 | -0.183 | [-0.32, -0.04] |
| G excluding broken `where` | 197 | -0.254 | [-0.38, -0.12] |
| style | 197 | -0.197 | [-0.33, -0.06] |
| medium | 197 | -0.176 | [-0.31, -0.04] |
| when | 197 | -0.122 | [-0.26, 0.02] |
| `where` (known broken) | 197 | +0.016 | [-0.12, +0.16] |

The sign was reported stable across era bands, both oil-medium subsets, and non-canon works; canon was flat (`+0.022`). Working interpretation: fame measures documentation density and prior exposure, not visual legibility. Limitations that must remain attached: 84% European; Asia `n=9`, Africa `n=5`, Oceania `n=1`; 52% censoring; post-hoc discovery; and a CI that still permits a small effect. An independent-measure check requires a new probe because `layPct` exists for only seven works.

## Priority order

### Immediate product/security fixes

- [ ] **G-02 — stop serving repository internals in production.** `vercel.json` uses `outputDirectory: "."`, making tracked files under `/docs`, `/tasks`, `/db`, `/tests`, `/server`, and `/scripts` fetchable. This was verified as reconnaissance-only: no secrets or untracked participant data were exposed, RLS denied anonymous table reads/writes, and `devices` is explicitly revoked. Short-term option: explicit 404 routes for private source/document trees without adding a Vercel function. Long-term option: build a real public output directory. Do not blindly add `.vercelignore`; build scripts require repository files during deployment.
- [ ] **G-03 — harden the corpus-image/agent boundary.** `scripts/vision-audit-prompt.md` interpolates untrusted image URLs into a shell instruction; `vision-v2-prep.mjs` follows arbitrary redirects, buffers responses, and lacks scheme/final-host/IP/MIME/size checks. Build one hardened in-process fetch broker with HTTPS/scheme policy, redirect-hop and final-host revalidation, private/loopback/link-local rejection, MIME and byte/dimension caps, bounded decompression/decoding, and provenance-bound structured output. Add hostile fixtures for shell metacharacters, redirect-to-private-IP, oversized/wrong-MIME/malformed images, EXIF prompt injection, and pixel prompt injection. Write up the capability-boundary mistake honestly.
- [ ] **G-01/G-11/G-12 — deliberate date-scoring pass.** Do not patch these independently without the owner's scoring decision described below.

### Research/data repairs

- [ ] **G-05 — repair geographic guessability grading, regenerate scores, then recompute the exploratory inversion.** Parse model disjunctions such as “Netherlands or Belgium” rather than splitting only on `[,/;]`. Replace bounding-box-midpoint centroids that put France and Russia outside their intended regions. Add direct tests and wire the grader into an appropriate reproducibility gate. Audit claim: 103/407 (`25.3%`) where scores were false zeros; 49.2% of clean-read works carried a false zero.
- [ ] **V1-G-08 / v2 S-5 — recover human-study map pins.** The client writes `guess.ll={lat,lng}` while `study-aggregate.mjs` reads array indices, producing `"NaN,NaN"` for 713 logged where-guesses. Correct the reader, rerun against the intact Supabase source rows, preserve a before/after regression fixture, and explore directional misconceptions (including whether museum custody pulls guesses toward the holding institution). No production-row mutation is needed for the repair.
- [ ] **G-04 — rebuild the visual auditor benchmark.** The reported 100% recall is reproducible with no vision: a string-only filename/title strategy flags 25/25 decoys; current decoys use only two distinct images because of `.find()`, and filenames disclose the swapped work. Preserve the three-arm measurement (filename intact, opaque path, no image), then build distinct and graded near-miss decoys, independently sourced controls, fame/tier stratification, ambiguous-label handling, per-cell bootstrap intervals, and an explicit error-cost threshold.

### Scheduler, gameplay, and test integrity

- [ ] **G-09 — scheduler repair/relaxation correctness.** `repairCoverage` receives the 30-day work avoidance set but not artist, cluster, or style constraints. Audit reproduction: 90 repair swaps, with 11 of 18 artist-gap violations created by repair; shipped signature showed 21 violations. Extract testable scheduler units and cover assembly, repair, relaxation ordering, deterministic selection, and advertised constraints before changing output. Clarify README guarantees versus preferences.
- [ ] **G-10 — hostile artist-name matching fixtures and generic-token rejection.** “painter” matched 35 artist-category works; “master” matched 11. Review distinctive-token filtering, Levenshtein budgets, alias substring behavior, dynastic near-names, and add a broad negative corpus including Monet/Manet, Lippi/Filippino, Mostaert/Gossaert, and Mengs/Raphael.
- [ ] **G-13 — make the local test suite actually local.** `audit-local.mjs` invokes a network-backed Wikidata load and can hang in an isolated checkout. Make it cache-only, separate the network suite, or enforce a strict timeout and accurate naming.
- [ ] **G-14 — convert silent skips/warnings into fail-closed fixture floors.** `dom-harness` silently skips missing functions and suppresses timer exceptions; gameplay smoke warns when intended fixtures disappear; a date test mirrors source with regex rather than executing production logic. Apply the `note-shard` minimum-fixture pattern to every important harness.
- [ ] **G-15 — deduplicate correctness predicates and PRNGs.** Consolidate `workComplete` copies in freeze, pool checking, daily auditing, and runtime code through a shared/generated contract. Reconcile seeded PRNG implementations.
- [ ] **G-16 — stop regex-evaluating production HTML.** Replace `index.html` substring/regex extraction and `new Function` with importable shared logic or generated data. At minimum, make movement-family extraction fail loudly rather than falling back to an empty map.
- [ ] **Next audit target: `styleChoices`.** Distractor generation decides whether a round is fair, has no direct tests, and consumes a fragmented style vocabulary. Reproduce before assigning severity.
- [ ] **Next audit target: daily/archive replay.** G-01 and G-12 share a pattern of runtime mutation overriding curated pool fields; inspect replay paths for a third instance.

### Claims, documentation, and portfolio surface

- [ ] **G-06 — state honestly that the ease pipeline currently has no product consumer.** Only `ease-metric.mjs` references/writes `ease.json`; tiering uses other inputs. Decide later whether to wire a corrected metric into the product or keep it explicitly research-only. Do not present it as validated: rho(ease,R)=0.926, rho(ease,G)=0.533, only 21/399 human R values, and range 0.625–0.925.
- [ ] **G-17 — refresh corpus counts.** README says roughly 5,900; audited pool contained 6,557. Recompute at edit time rather than copying the audit number blindly. The local showcase still contains other approximate corpus numbers that should be refreshed before external use.
- [ ] **G-18 — remove the cultural-review-gate overclaim.** Current behavior is human-remains exclusion plus contextual copy for sensitive/funerary/sacred works, not enforced human review. Build an actual gate or describe the shipped boundary precisely.
- [x] **G-19 — remove unsupported rarity and token-spend claims.** Fixed locally in `cbfcfe8`: outcome evidence replaces “915k tokens,” and “very few PMs” is removed. Awaiting a substantive push.
- [ ] **G-20 — revisit merge risk classifications.** `curate-merge.mjs` auto-applies known style mappings and bucket-valid media while queuing other model proposals. Reassess whether medium/playability judgments are truly low-risk; preserve and be able to defend the enforcement-boundary rationale.
- [ ] **Portfolio legibility pass.** Add discoverable links to the provenance-gates plan and auditor-eval caveat, create a one-page evidence map by role, and improve GitHub surface (bio/site/profile README/pinned repos) when authorized. Never link the 100/100 auditor result without its filename/string-match limitation.

## Date-scoring decision packet

These are coupled symptoms of one unreviewed scoring model:

- **G-01:** runtime `MINY` changes from `-2500` to pool minimum `-11000`, so one deep-prehistory outlier rescales the entire pre-1400 axis. Audit fixture: Winged Victory at `-175`, guessed `425`, can receive 2500/2500; about 1,428 of 6,546 date-scored works are pre-1400.
- **G-11:** `timeMult` is easy `1.3`, medium `1.3`, hard `1.35`, impossible `1.4`; because score divides by it, harder tiers are more forgiving on date.
- **G-12:** runtime category rebuilding starts with `['when']` and re-enables the date category for ten works whose stored `cats` deliberately opted out. Deep-prehistory works can then be asked an impossible date question.
- Previously observed copy mismatch: a 1905 work guessed as 1892 earned full credit while reveal copy reported “within 13 years.” Slider-position distance drives points; raw calendar distance drives copy.

Owner decision required before implementation: what is the learning goal across precisely dated modern works, older works, BCE dates, catalogue ranges, and broadly datable cultural objects? Compare a hard historical floor with a clamped/segmented model; decide whether tier should affect date precision at all; preserve explicit opt-outs; and design truthful reveal copy independently. Only then add golden `yearToPos`/`posToYear`, boundary, tier-order, opt-out, and pool-minimum drift regressions.

## Vision/guessability instrument limitations

- [ ] **G-07 (prior, confirmed):** add explicit `survived` state so rung 4 no longer conflates 210 survivors with 78 failures. Verify self-reported recognition by asking for identification. Extend the transform ladder carefully and retain every rung, acknowledging that stronger transforms also destroy guessability signal.
- [ ] **G-08:** the 410-work probe is exactly the Easy tier, with fame median 1,084 versus full-pool median 26; there is no obscure-work arm. Do not generalize its 95.6% recognition rate to “artworks.” Canon fame includes a hand-set +2000 component.
- [ ] **Reproducibility:** commit or reconstruct the exact 410-work manifest. The committed artifact contains `confidence`, while the current prompt asks for `layPct`; record script/model/prompt/data versions in a run manifest.
- [ ] **Clean-read expansion:** after G-05, extend the ladder to reduce the 52% censoring and add non-European coverage before presenting the inverse correlation as general.
- [ ] **Optional model-internals probe:** first test 20 works across fame with a small open VLM. If viable, capture representations across transforms, retrieval ranks, layer similarity, and held-out probes for identity/period/region/medium. Include alternate photographs/scans to separate canonical-image memorization from work-level representation.
- [ ] **Optional calibration study:** store every rung and ask whether a blinded, reasoning model is better calibrated than a recognizing/retrieving one. The Mona Lisa tight-crop failure is the motivating qualitative fixture.

## Near-miss benchmark specification

Highest-value evaluation spinoff once immediate product/security fixes are contained:

1. Distinct decoy per trial; never `.find()` the same top eligible record repeatedly.
2. Opaque/hash URL path so title cannot be recovered from the filename.
3. Graded cells: cross-region; same region/different era; same movement/different artist; same artist/different work; same artist/within ten years/same medium; same artist/same series.
4. Independent control provenance rather than “previously audited.”
5. Stratify by fame and product tier.
6. Hand-review hardest cells or label legitimate alternate views/details/workshop replicas `ambiguous` and exclude them from binary scoring while reporting their rate.
7. Report precision/recall and bootstrap intervals per cell; state the false-positive/false-negative cost ratio used to choose a threshold.

Audit feasibility snapshot: 4,823 usable works; 464 artists with at least two works; 242 with at least four; 33,758 same-artist pairs within ten years; 106 style groups with at least five. Recompute before use.

## Strong existing evidence to preserve

- Incident-derived `check-pool` detectors, including documented dropped checks and hard/warn enforcement decisions.
- `tasks/provenance-gates-plan.md` and its decision to ship an uncertain detector as WARN with triage/exemptions rather than laundering false positives into a hard gate.
- The capability argument in `vision-guess.mjs`: a completion without tools is a different boundary from an agent with a shell.
- `db/devices.sql`, the four semantic migration gates, and `db-verify-guarded.mjs` concurrency/authority tests.
- `tests/api-device-ownership.test.mjs` as proof-of-fix coverage.
- Audit documents that preserve open conditions and argue severity down when evidence warrants it.
- `docs/ethos.md`, especially “Disclosure is not discharge.”
- Verifiable collaboration evidence with Briana: attribution, commit history, design branches, and `docs/combo-design-language.md`.

## Governance/process follow-ups

- [ ] Install or correctly configure the intended pre-commit hook (`core.hooksPath` reportedly still points at `.git/hooks`).
- [ ] Run relevant CI for feature branches rather than only after landing on `main`.
- [ ] Add tests/gates at data-producing and scheduling inputs, not only at downstream arbiters.
- [ ] Preserve incident provenance in every new detector, but schedule periodic threat-model and correctness reviews so governance is not exclusively incident-triggered.

## Status protocol

For each item: reproduce against current `HEAD`; write a failing regression or falsifiable gate; record whether it is a product bug, research-validity issue, disclosure, claim correction, or exploratory spinoff; fix in a narrowly scoped branch; audit before deployment or data regeneration; and update this plan with the commit, verification evidence, and any remaining limitation. Do not silently convert exploratory statistics into product or portfolio claims.
