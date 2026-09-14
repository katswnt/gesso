# Pass B (`contentVisionEnrichment`) — contract and historical crosswalk

> **Status:** repaired migration contract. Phase 1 is implemented offline: the 202-record
> rich-history projection round-trips without using its raw rollback copy, and the
> 6,557-work coverage inventory is executable. The rich B1/B2/B3/synthesis schemas,
> controller, calibration policy, and authoritative merge remain unimplemented.
> **Canonical authority:** [`docs/vision-system.md`](../docs/vision-system.md) (committed at
> `f3b6cf8`) and its decision log govern. This artifact operationalizes VSD-001…014 and
> [`tasks/vision-consolidation-plan.md`](vision-consolidation-plan.md); where it appears to
> diverge from the canonical record, the canonical record wins and the divergence is an
> owner question, not a silent override.
> **Prepared:** 2026-08-31.

## 0. Method, inputs inspected, and the no-discard rule

This is the reviewed migration basis for Pass B before the rich runner is built. The
historical crosswalk is executable in `scripts/lib/vision-legacy.mjs`; the later-stage
schema in §2 remains a candidate until its validators and stage fixtures exist. This obeys
the plan's **no-discard migration rule** (plan §"No-discard"): before any historical writer or
schema is changed, every persisted field must (1) map losslessly into the consolidated
record, (2) survive in a named queryable research subrecord, or (3) be explicitly retired
by the owner with the reason recorded.

Artifacts inspected (offline; structures/counts read directly):

- `data/pool.js` — 6,557 works; key union: `aicImg, artist, attribution, born, canon, cats,
  contested, date, died, dim, fame, govReview, harvardOrig, harvest, hidden, id, img, lat,
  lng, medium, museum, origImg, place, play, playableReason, prevImg, printed,
  provenanceNote, region, sensitive, src, style, styleKind, title, titleFlag, wikidataid,
  y, yr`.
- `data/teach-works.js` (`ARTEFACTUM_CUES.work`) — 6,091 raw records; per-work `{why,
  cues, guide:[{q,a}], notes:[{head,body,x,y}]}`; nonblank `why` on 6,020,
  nonempty `cues` on 5,812, guide[] on 6,010, notes[] on 6,003. Alias/orphan
  diagnostics are reported separately from current-pool-matched coverage.
- `data/hotspots.js` (`ARTEFACTUM_HOTSPOTS`) — 5,795 works; per-work `[{n,x,y}]` (percent coords).
- `data/vision.js` (`ARTEFACTUM_VISION`) — 202 works; per-work rich schema (see §1.A).
- `data/vision-audit.json` — currently `{version, note, legacyPass:"legacy/pre-g03",
  ids:[6026]}`. It has no current `entries` or `appliedRuns` yet; consumers correctly
  treat absent maps as empty.
- `data/vision-evidence.json` — `{}` (G-03 durable evidence store, seeded).
- `data/guessability/scores.json` — `{model, tier, note, works:[{title, recognized,
  stopRung, cats:[], g:{when,where,medium,style,artist ∈0–1}, G}]}` (Pass A, tracked).
- `data/guessability/ease.json` — `{tier, params, note, works}` (Pass A ease metric).
- `scripts/vision-audit-prompt.md` + `scripts/lib/vision-schema.mjs` — current Pass B (narrow) schema.
- `scripts/vision-guess.mjs`, `grade-guessability.mjs`, `ease-metric.mjs`,
  `study-aggregate.mjs`, `vision-predict-human.mjs`, `vision-verify.mjs` — Pass A + QA utilities.
- Retired tombstones (16): `merge-notes, save-hotspots, merge-hotspots, gen-verify,
  guides-regen, merge-enrich, merge-v2notes, vision-mark, vision-v2-prep, vision-v2-merge,
  hotspot-codex, staged-hotspots, next-hotspots, hotspot-manifest, apply-review-verdicts,
  drain-queue`.
- Pre-tombstone prompt/controller history, including `guides-regen.mjs` at `f247aa0`
  and `scripts/regen-notes.workflow.js`; historical behavior is part of the crosswalk,
  not merely the surviving field names.
- `docs/vision-system.md`, `docs/PIPELINE.md`, `tasks/vision-consolidation-plan.md`, `CLAUDE.md`.
- Executable Phase-1 contract: `scripts/lib/vision-legacy.mjs`,
  `scripts/lib/vision-inventory.mjs`, `scripts/vision-inventory.mjs`, and their tests.

Counts are **current working-tree reality** (diagnostic only, per plan §"Verified snapshot");
the coverage generator (§5), not this file, is the source of truth.

---

## 1. Historical crosswalk

Legend — **Stage**: A = `visionDifficultyProbe`; B1 = image-only inventory/QA; B2 = no-image
research; B3 = targeted visual verification; B4 = reconciled record; L = legacy-only evidence.
**Loss?**: none | reassigned | never-collected | owner-decision.

### 1.A `data/vision.js` rich pass (202 works) — the intended Pass B superset ancestor

| Historical field | Shape | Current consumer | Cov. | Stage | Target field | Migration rule | Loss? |
|---|---|---|---:|---|---|---|---|
| `seen` | string | none (unwired) | 202 | B1 | `b1.seen` | copy verbatim → legacyEvidence; regenerate under new prompt | none |
| `evidence.{when,where,medium,style,artist,format}` | arrays of `{feature,bbox:[x,y,w,h] 0–1,why}` when present | none | when 181; where 163; medium 191; style 186; artist 132; format 2 | B1 | `b1.evidence.<axis>[]` (+ `confidence`) | preserve each item as stable-ID `legacyEvidence`; add new confidence only on regeneration | none |
| `pins` | `[{x,y (0–1), label}]` | none (superseded by hotspots.js) | 202 | B1→B4 | `hotspots[]` candidates | ×100 to percent; `label`→`conciseText`; rank/role added | none |
| `palette` | 109 arrays; 93 objects `{hex,tone}` | none | 202 | B1 | `b1.visual.palette{colors[],character,legacyShape}` | shape-normalize; preserve exact legacy value | none |
| `pose` | string | none | 202 | B1 | `b1.visual.pose` | copy → legacyEvidence | none |
| `figures` | 102 objects `{count,who}`; 87 strings; 13 numbers | none | 202 | B1 | `b1.visual.figures{count,description,legacyShape}` | shape-normalize; preserve exact legacy value | none |
| `format` | string | none | 202 | B1 | `b1.visual.format` | copy → legacyEvidence | none |
| `delights` | list | none | 202 | B1 | `b1.visual.delights[{note,bbox?,confidence}]` | copy → legacyEvidence | none |
| `condition` | string | none | 202 | B1 | `b1.visual.condition` | copy → legacyEvidence | none |
| `signature` | object `{present,location,reads}` | none | 202 | B1 | `b1.visual.signature` | copy → legacyEvidence | none |
| `artifacts` | photographic artifacts | none | 202 | B1 | `b1.visual.photoArtifacts` | copy → legacyEvidence | none |
| `image_quality` | string | none | 202 | B1 | `b1.imageFitness.quality` (enum) | map to `good/poor`; keep raw note | none |
| `movement_suggestion` | string | none | 202 | B2 | `b2.catalog.movementSuggestion` (+`styleKind`) | catalog claim → **owner-review** | none |
| `guessability` | per-axis-ish | none | 202 | **A** | Pass A ledger (`guessability.*`) | **reassigned to Pass A**; keep as legacyEvidence; NOT a Pass B field | reassigned |
| `recognized` | bool | none | 202 | **A** | Pass A ledger (`modelRecognizedFull`) | **reassigned to Pass A**; legacyEvidence | reassigned |
| `notes` | object `{why,cues,guide}` on 12; absent on 190 | none | 12 | B1/B2 legacy | `b1.teaching.legacyBundle` | preserve as one historical teaching bundle; never coerce to `noteCandidates[]` | none |

`data/vision.js` remains intact. `tests/vision-legacy.test.mjs` currently proves all 202
records reconstruct from the explicit normalized projections (with the opaque `raw`
rollback copy removed), rejects unknown fields/evidence axes, and verifies the raw hash.

### 1.B `data/teach-works.js` — the player-facing teaching layer (live)

| Field | Shape | Consumer | Cov. | Stage | Target | Migration | Loss? |
|---|---|---|---:|---|---|---|---|
| `why` | string | reveal ("why it matters") | 6,020 raw | B4 | `b4.why` | preserve; audit component-by-component (VSD-007) | none |
| `cues` | list | reveal cues | 5,812 raw | B4 | `b4.cues` | preserve; audit | none |
| `guide` | `[{q,a}]` | "Ask the guide" Q&A | 6,010 | B2→B4 | `b4.guide[{q,a,kind,evidenceRef?,sourceRefs?}]` | preserve accurate Qs; replace boilerplate (plan §Editorial) | none |
| `notes` | `[{head,body,x,y}]` | reveal "look closer" + pins | 6,003 | B1→B4 | `b4.notes[{head,body,pin?}]` | preserve; re-ground to image; `x,y` percent | none |

### 1.C `data/hotspots.js` — displayed pins (live)

| Field | Shape | Consumer | Cov. | Stage | Target | Migration | Loss? |
|---|---|---|---:|---|---|---|---|
| `[{n,x,y}]` | ordinal + percent coords | reveal pin overlay | 5,795 | B1→B4 | `hotspots[{id,x,y,rank,role,...}]` | `n`→`rank` seed; keep coords; enrich per §2 | none |

### 1.D `data/pool.js` fields written/affected by Pass B (authoritative game data)

| Field | Shape | Consumer | Cov. | Stage | Target | Migration | Loss? |
|---|---|---|---:|---|---|---|---|
| `play` (===false) | bool | freeze-daily/scheduler exclusion | 196 | B4 | `imageState:"unplayable"` → `play:false` | keep; drive from `imageState` (VSD-010) | none |
| `playableReason` | string | reveal/debug | — | B4 | `b4.playableReason` | keep | none |
| `cats` | string[] scoring cats | scoring | 6,556 | B4 | drives `mediumLegible→cats` | keep; only medium-removal automated | none |
| `style`,`styleKind`,`medium` | strings (styleKind 6,554 currently) | scoring/distractors | — | B2→B4 | `corrections.consequential` | **owner-review** (scored fields) | none |
| `sensitive` | tag | `contextHTML()` reveal | 46 | B2 | `b2.catalog.sensitivity` | keep; internal signal (VSD-012); not auto-unplayable | none |
| `provenanceNote` | string | `contextHTML()` reveal | 71 | B2 | `b2.catalog.provenanceNote` | keep | none |
| `printed` | year | reveal `dateLine()` | 7 | catalog | (out of Pass B scope) | untouched | none |
| `contested`,`govReview`,`titleFlag`,`canon`,`hidden` | flags | various | — | catalog/manual | untouched by Pass B | leave to existing owners | none |
| `img`,`origImg`,`prevImg`,`aicImg`,`harvardOrig` | urls | image display/rehost | — | B4 (swap proposals only) | `corrections.consequential` (image swap) | **owner-review**; broker re-fetch on change | none |
| `born`,`died` | years | date-lifespan gate | 4,022/4,016 | catalog | untouched | leave | none |

### 1.E Current narrow Pass B schema (`vision-schema.mjs` / `vision-audit-prompt.md`)

| Field | Shape | Stage | Target | Migration | Loss? |
|---|---|---|---|---|---|
| `image{ok,issue(enum none/wrong-art/low-res/other),reason,suggestedUrl}` | object | B1 | `b1.imageFitness{ok,issue,reason,suggestedUrl}` | superset (add quality/framing states) | none |
| `playable`,`playableReason` | bool,string | B1 | `b1.playable`,`b1.playableReason` | keep | none |
| `imageQuality(good/poor)`,`qualityReason` | enum,string | B1 | `b1.imageFitness.quality`,`.qualityReason` | keep | none |
| `framing(ok/cropped/detail/lost)` | enum | B1 | `b1.imageFitness.framing` | keep | none |
| `mediumLegible` | bool | B1 | `b1.imageFitness.mediumLegible` | keep | none |
| `fields{style,styleKind,medium}` | object | B2/B4 | `corrections.consequential` | owner-review | none |
| `notes[{head,body,x?,y?}]` | array | B1 | `b1.noteCandidates[]` | keep; enrich | none |
| `noPins` | bool | B1 | `b1.noPinsVerdict` | keep (reviewed-noPins) | none |

### 1.F Pass A + QA utilities (assigned to Pass A / research; NOT folded into Pass B)

| Artifact | Fields | Output | Cov. | Stage | Target |
|---|---|---:|---|---|---|
| `vision-guess.mjs` | `recognized`, per-rung `{when,where,medium,style,artist:{guess,layPct,cues}}`, `stopRung/stopLabel/recognizedTrace` | `data/incoming/vision-guessability-*.json` (gitignored) | 410 | A | Pass A ledger (`modelRecognizedFull`, `modelRecognitionBreakRung`, `modelSurvivedLadder`, per-facet `G`, per-facet `layPct`) |
| `grade-guessability.mjs` | `g{axis∈0–1}`, `G`, `cats`, `recognized`, `stopRung` | `data/guessability/scores.json` (tracked) | ~410 | A | Pass A ledger (graded) |
| `ease-metric.mjs` | ease params | `data/guessability/ease.json` | — | A | Pass A ledger |
| `vision-predict-human.mjs` | per-axis `predict∈0–100` (recognition-allowed) | `data/incoming/vision-predict-human-*.json` | 29 | A (separately named) | `predictedPlayerRecognition`/`predictedHumanDifficulty` (explicitly named per VSD-002) |
| `study-aggregate.mjs` | real human per-axis difficulty | `data/incoming/study-human-difficulty.json` | — | A | human-calibration input |
| `vision-verify.mjs` | `{consistent,confidence,seen,why,prevImg}` | `data/incoming/image-mismatch.json` | 515 | B1-adjacent QA | `b1.imageFitness.ok` cross-check utility (metadata-informed wrong-image detector) |

> Note: `vision-verify` uses image + catalog facts together (metadata-informed), so it is a
> QA cross-check for image identity, not a blind Pass A probe. It maps to Pass B image
> fitness as an *auxiliary detector*, kept separate from the blind probe.

### 1.G Planned-but-never-collected (0 coverage — must not be forgotten, plan §"must no longer be forgotten")

| Field | Intended meaning | Cov. | Stage | Target | Loss? |
|---|---|---:|---|---|---|
| `visDiff` | image-only visual-inference difficulty | 0 | A or B1 | **owner-decision** (Pass A axis vs B1 descriptor) | never-collected |
| `mediumFull` | full support/material desc (keep scoring bucket) | 0 | B2 | `b2.catalog.mediumFull` (from WD P186) | never-collected |
| `anonReason` | collective/unrecorded/de-attributed/lost/unknown | 0 | B2 | `b2.catalog.anonReason` (enum) | never-collected |
| `living` | living-tradition candidate | 0 | B2 | `b2.catalog.living` (from WD P570) | never-collected |
| provenance/displacement cue | restitution/displacement candidate | (subset of provenanceNote) | B2 | `b2.catalog.displacementCue` | owner-decision |

### 1.H Retired writers (16 tombstones)

Their surviving fields are evidence, but field-name survival alone is not a lossless
behavioral migration. Git history records additional obligations: the guide pipeline asked
for work-specific coverage across material, subject/function, significance, technique,
story/context, comparisons, and controversies, with the repaired guide prompt requiring 8–12
questions; older controllers also wrote authoritative files directly. Preserve the content
quality requirements, not those unsafe write paths. The rich controller cannot claim
behavioral parity until prompt fixtures exercise these obligations.

---

## 2. Candidate versioned Pass B schema (`contentVisionEnrichment/1`)

This section is the reviewed target shape, not a shipped/frozen schema. Validators and
stage fixtures must make it executable before collection.

Envelope (every stage record): `{ schemaVersion:"contentVisionEnrichment/1", passKind:"B",
stage:"B1"|"B2"|"B3"|"B4", workId, imgSha256, promptHash, brokerPolicyVersion, producer,
createdAt }`. `producer` per G-03 v9 honesty: `{kind:"claude-code-subagent"|"tool-less-api",
model, runtimeVersion, toolPolicyHash, networkPolicyHash}` (never a fabricated API modelId).

Common value wrappers:
- **stable IDs**: evidence, claims, and targeted requests use deterministic IDs scoped to
  work + stage + item (`evidenceId`, `claimId`, `requestId`); references must resolve within
  the hash-bound run or validation fails.
- **evidenceItem**: `{evidenceId:string, feature:string(≤200), why:string(≤400), bbox:[x,y,w,h]∈[0,1] | null,
  confidence:number∈[0,1]}`.
- **notApplicable**: any required field may be `{notApplicable:true, reason:string}` instead
  of a value; omission is **incomplete**, never `notApplicable`.
- **uncertainty**: every stage record carries `uncertainty:string` (may be "").
- **sourceRef**: `{sourceId:string, url:string, title:string, retrievedAt:string}` — internal only initially (VSD-012).

### B1 — image-only visible inventory + image QA (`stage:"B1"`)
```
imageFitness: {
  ok: boolean,                       // is this the cataloged work?
  issue: "none"|"wrong-art"|"low-res"|"other",   // ok===(issue==="none")  [G-03 rule]
  quality: "good"|"poor",
  framing: "ok"|"cropped"|"detail"|"lost",
  mediumLegible: boolean,
  imageState: "usable"|"repair"|"blocked"|"unplayable",   // VSD-010 four states
  reason: string
}
playable: boolean,  playableReason: string,
noPinsVerdict: boolean,
seen: string(≤1000),
evidence: { when:[evidenceItem], where:[evidenceItem], medium:[evidenceItem],
            style:[evidenceItem], artist:[evidenceItem], format:[evidenceItem] },
visual: {
  pose:string, gesture:string, gaze:string, bodyOrientation:string,
  figures:[{who:string, role:string}], relationships:string,
  palette:{ colors:[string], character:string }, tone:string,
  lighting:"half-light"|"tenebrism"|"backlight"|"diffuse"|"spotlight"|"flat"|"other",
  format:string, composition:string, viewpoint:string,
  subject:string, iconography:[string], objectFunction:string,
  material:string, surface:string, technique:string,
  condition:string, damage:string, signature:string, inscriptions:string,
  photoArtifacts:string,
  delights:[{note:string, bbox:[x,y,w,h]|null, confidence:number}]
},
tags: { controlled:[string], free:[string] },     // internal search / themed sets
noteCandidates: [ { head:string(≤80,non-blank), body:string(≤600,non-blank),
                    pin:{x:0-100,y:0-100}|null, role:"diagnostic"|"technique"|"narrative"|"delight",
                    confidence:number, evidenceRef:string|null } ],   // ≥5 target, all worthwhile
visDiff: number∈[0,1]|notApplicable,              // owner-decision: A vs B1 (see §9)
researchQuestions: [ {questionId:string, topic:"medium"|"maker"|"date"|"place"|
                      "style"|"function"|"provenance"|"sensitivity"|"other",
                      evidenceId:string|null} ],   // codes/references only cross into web-enabled B2
uncertainty: string
```
Bounds: `evidence.*` ≤ 12 each; `noteCandidates` ≤ 40; `tags.*` ≤ 30; pins `0–100` both axes,
`x⇔y` both-or-neither (G-03 `notesOk`). No control chars / no HTML in player-facing text.

### B2 — no-image research (`stage:"B2"`, never receives the image)
```
catalog: {
  mediumFull:string|notApplicable, anonReason:("collective"|"unrecorded"|"de-attributed"|
    "lost"|"unknown")|notApplicable, living:boolean|notApplicable,
  movementSuggestion:string|notApplicable, styleKind:("culture"|"movement"|"period"|
    "school"|"tradition"|"genre")|notApplicable, provenanceNote:string|notApplicable,
  displacementCue:string|notApplicable, sensitivity:[string]
},
factChecks: [ { claimId:string, claim:string, verdict:"supported"|"refuted"|"unresolved",
                confidence:number, sources:[sourceRef] } ],
guideAnswers: [ { q:string, a:string, kind:"image"|"context",
                  evidenceRef:string|null, sourceRefs:[sourceRef] } ],  // ≥5, ≥3 work-specific
targetedVerificationRequests: [ { requestId:string, claimId:string, whatToLocate:string } ],
uncertainty: string
```

### B3 — targeted visual verification (`stage:"B3"`, image-only, conditional)
```
verifications: [ { requestId:string, found:boolean, bbox:[x,y,w,h]|null,
                   note:string, confidence:number } ]
```
Runs **only** when B2 surfaces an important locatable detail not established at B1 (VSD-005).

### B4 — reconciled rich record (`stage:"B4"`, synthesized then controller-assembled)
```
imageState, playable, catsAdjustments:{removeMedium:boolean},
notes:            [ published note {head,body,pin?} ],          // publishable
hotspots:         [ hotspot ],                                   // ALL candidates, ranked
guide:            [ {q,a,kind,evidenceRef?,sourceRefs?} ],       // ≥5 (≥3 work-specific)
richDescriptors:  { ...B1.visual + B2.catalog },                 // internal-only queryable index
corrections: {
  consequential: [ {field, from, to, evidenceRef, sourceRefs, confidence} ],  // → owner review
  human:         [ {field, to, author:"owner", note, at} ]                    // human-authored, labeled
},
provenance: { b1Hash, b2Hash, b3Hash, imgSha256, promptHashes, schemaVersion,
              brokerPolicyVersion, producers:[...] },
evidence: {...merged evidence}, conflicts:[ {field, b1, b2, resolution} ], uncertainty:string
```

**hotspot** (VSD-009 — all worthwhile candidates, ranked):
```
{ id:string, x:0-100, y:0-100 | region:{x,y,w,h}∈[0,100], rank:integer,
  role:"diagnostic"|"technique"|"narrative"|"delight",
  conciseText:string, deepText:string,       // BOTH from ONE observation; never contradictory
  evidenceRef:string, confidence:number, sourceDependent:boolean }
```
Display rule (~3–5 shown, more for detail-rich works) is a UI decision — **open Q7**, not schema.

**Review-class artifacts** (see §4): `autoPolicyApproval:{reviewMode:"auto-policy",
policyVersion, thresholds, evidenceHashes}`; `humanApproval:{reviewMode:"human",
author:"owner", corrections:[...], at, completionSha}`. Both are hash-bound and consumed only
by `curate-merge --run`.

---

## 3. Stage ownership and security principals (VSD-005, §Security model)

| Stage | Principal | Sees image? | Web/tools | Writes | Security note |
|---|---|---|---|---|---|
| 0 Select+sanitize | controller (deterministic) | n/a | broker only | run dir (non-auth) | G-03 broker; content-addressed derivative |
| B1 inventory/QA | image process | yes (sanitized derivative + bounded non-answer metadata) | **none** (no web/bash/fs-write/agent/MCP) | stdout only | controller captures, validates, and exclusively writes a quarantined completion; fresh context/work |
| B2 research | no-image research process | **no** | domain-allowlisted web only | stdout only | receives trusted catalog metadata plus allowlisted enums/numbers/coordinates/stable IDs; raw image-derived prose is tainted data and cannot drive queries/actions |
| B3 verify | image process | yes | none | stdout only | controller captures/validates; conditional; same lockdown as B1 |
| B4 synthesis | separate tool-less synthesis process | no | none | stdout only | reconciles semantic conflicts or routes unresolved ones to a human; it cannot write files or authoritative data |
| B4 assemble/policy | controller (deterministic) | no | none | quarantined record/review artifacts | validates IDs/hashes, assembles resolved output, and routes; never invents semantic resolutions |
| 5 merge | `curate-merge --run` | no | none | authoritative data + ledger + evidence | only sink; reject-before-write; hash/version-bound |

---

## 4. Completion + staleness (component-level ledger; Pass B only, separate from Pass A)

States: `complete | missing | blocked | stale | notApplicable`. Components are independently
tracked (plan §Completion): `imageEligibility, richVisualRecord, teachingNotes,
guideQuestions, hotspots, researchFacts`.

| Component | Depends on | Rerun trigger | Preserve-as-legacy | Blocked when |
|---|---|---|---|---|
| imageEligibility | imgSha256, prompt, schema, model | image change; prompt/schema/model bump | prior verdict → legacyEvidence | `blocked` only for wrong/unusable/identity failure; `repair` remains a distinct usable-but-needs-improvement disposition |
| richVisualRecord | imgSha256, prompt, schema, model | image change; version bump | vision.js rich → legacyEvidence | imageEligibility blocked |
| teachingNotes | imgSha256, prompt, schema, model | image change; version bump | teach notes → legacyEvidence | imageEligibility blocked |
| hotspots | imgSha256, prompt, schema, model | image change; version bump | hotspots.js/vision.js pins → legacyEvidence | imageEligibility blocked (reviewed `noPins` = complete, absence ≠ complete) |
| guideQuestions | catalog/source state + imgSha256 (image-grounded Qs) | image change (image Qs); catalog change (context Qs); version bump | teach guide → legacyEvidence | <5 or <3 work-specific → missing/templateThin (not complete) |
| researchFacts (B2) | catalog/source state, prompt, schema, model | source/catalog change; version bump | provenanceNote/sensitive → legacyEvidence | n/a |

Rules (plan §Completion; VSD-007):
- **Bare-ID completion is abolished.** A work is `complete` only when every required component
  is approved or explicitly `notApplicable`, bound to current imgSha256 + prompt/schema/model/
  policy versions + human/auto approval + completion hash.
- **Partial-approval isolation:** an approved patch updates only its named component(s); it can
  **never** mark unrelated components complete (enforced in `curate-merge`, extending the G-03
  `visionPassStatus` component gate).
- **Legacy visibility:** `data/vision.js`, `teach-works.js`, `hotspots.js`, and the 6,026
  bare `vision-audit.json` ids remain visible as `legacyEvidence` (G-03 `legacy/pre-g03`
  sentinel already ensures they never earn current-pass completion).
- **Staleness:** any changed image bytes, relevant catalog answer, prompt, schema, model, or
  policy → `stale`; rerun only the affected components where the dependency graph is safe,
  else fail toward a broader rerun.
- **Separate ledgers:** Pass A (`data/guessability/*`) and Pass B (`data/vision-audit.json` +
  `data/vision-evidence.json`) never cross-satisfy (VSD-001).

---

## 5. Review / publication classes (VSD-008 → deterministic routing)

**Not select-only** (per task + VSD; the owner may *correct* values, labeled + bound).

| Class | Criteria (deterministic) | Route |
|---|---|---|
| `autoPolicyEligible` | calibrated component, confidence ≥ policy threshold, no consequential field, no conflict | auto-policy publish; `reviewMode:"auto-policy"` manifest; sampled 2/100 review (VSD-011) |
| `alwaysOwnerReview` | `playable:false`/exclusion; wrong-art/image swap/unresolved identity; scored-category or artist/place/date/medium/style/culture change; medium-category removal; unresolved conflict or low-confidence factual claim | owner review queue |
| `internalOnly` | rich descriptors (pose/palette/subject/tags), source links | publish to internal index; not player-facing; not owner-gated |
| `blockedPendingRepair` | imageState `blocked` | withhold from unseen future dailies (≤30d initially, VSD-010); keep in Collections; queue image repair |
| `humanCorrectable` | any published field the owner edits | apply as `corrections.human` with explicit human provenance (author, at, note), hash-bound; never attributed to the model |

---

## 6. Coverage generator (`scripts/vision-inventory.mjs`) — spec

Deterministic, **network-free**, offline, reproducible from a clean clone (plan §Required
inventory). No model, no downloads.

- **Input:** current `pool.js` (canonicalize equivalent Wikidata id forms), `vision-audit.json`,
  `vision-evidence.json`, `teach-works.js`, `hotspots.js`, `vision.js`, `data/guessability/*`
  (Pass A, reported separately).
- **Output:** (a) machine matrix `data/vision-coverage.json` — exactly one row per current
  pool work; (b) readable summary to stdout. No hardcoded counts anywhere.
- **Per-row:** `id, title, schedulePriority, img, imgSha256?, schemaV, promptV, brokerPolicyV,
  components:{imageEligibility,richVisualRecord,teachingNotes,guideQuestions,hotspots,
  researchFacts}∈{complete,missing,blocked,stale,notApplicable}, guideStatus∈{missing,
  templateThin,legacyCandidate,specificReviewed}, hotspotStatus∈{missing,reviewedNoPins,present},
  legacy:{canonical,rich,hotspot,notes}, research:{verifier,guessability,predictHuman},
  approval:{mode,author?,completionSha?}, blockedReasons:[], staleReasons:[]`.
- **Derived queues:** `dailyOrHorizonBlockers` (next 7d then 8–30d), `missingMandatory`,
  `blocked`, `stale`, `legacyOnly`, `researchCoverage`; tier queues: Easy → top-fame quintile
  of Medium/Hard/Impossible → remaining Medium → Hard → Impossible (VSD, plan §scheduling),
  rotating region/source/medium within a band.
- **Fail-closed:** error on duplicate ids, unknown status values, or rows ≠ pool count; list
  stale/orphan evidence separately; never let an ignored `data/incoming` file be the only
  evidence behind a count.

---

## 7. Migration sequence (plan §Migration, refined)

1. **Implemented 2026-09-02:** build + falsifiability-test `vision-inventory.mjs`
   against current artifacts, plus an explicit-projection round trip for all 202 rich
   legacy records (offline).
2. Freeze `contentVisionEnrichment/1` schema (§2) + the B1/B2 prompt pair; version-stamp.
3. Import **every** `vision.js`/`teach-works.js`/`hotspots.js` field as `legacyEvidence`;
   generate the initial 6,557-row matrix. Prove the no-discard check (§8) passes.
4. Extend the G-03 runner/review/merge for the B1→B2→B3→B4 record + component approval;
   subagent ingestion is provenance-bound (G-03 v-series), controller-assembled.
5. Re-run in priority order (§6) once VSD-004 subscription path + budget/supervisor exist.
6. Replace `vision-audit.json` with the component ledger only after the new ledger + daily gate
   are verified; keep historical evidence for auditability.
7. Elgin Marbles (`wikidata:Q606662`) is the required regression fixture (plan §Incident):
   must resolve to `blocked` (framing/quality) until a focused replacement image + re-approval.

---

## 8. Tests + fail-closed gates

- **`vision-schema.mjs` extension:** strict validators for B1/B2/B3/B4 records (enums, bounds,
  non-blank notes, bbox∈[0,1], pin `x⇔y`, `ok⇔issue==='none'`), reusing G-03 patterns.
- **No-discard gate:** a test that every `data/vision.js` field name maps to a §2 target or a
  named legacy subrecord; fails if a rich field has no destination (enforces plan §No-discard).
- **Ledger-separation gate:** Pass A files never satisfy Pass B completion and vice-versa.
- **Partial-approval-cannot-complete test:** approving one component leaves others `missing`.
- **Staleness test:** changing imgSha/prompt/schema/model/policy flips affected components `stale`.
- **passKind discrimination:** merge accepts only `passKind:"B"` schemas into Pass B ledger.
- **Coverage-generator falsifiability:** injected duplicate/unknown-status/row-count-mismatch → hard fail.
- **Human-correction provenance test:** a corrected value is stored as `corrections.human`
  with author/at, never attributed to the model.
- **Hotspot one-observation test:** `conciseText`/`deepText` derive from one evidence item (no contradictory pair).
- **Guide floor gate:** `<5` questions or `<3` work-specific → `templateThin`/`missing`, not complete.
- **Horizon report (VSD-014):** print the exact next-7/next-30 incomplete IDs, but do not
  make them a universal `check-pool` hard gate until a later owner decision changes VSD-014.

---

## 9. Unresolved owner questions (only where repo evidence cannot decide)

1. **`visDiff`** — Pass A axis (blinded difficulty) or a B1 descriptor? It has zero
   historical coverage and need not block the first 50-work calibration.
2. **Predicted-player recognition** (`vision-predict-human`) — retain as a named model
   output, and how will it be calibrated? It remains separate from Pass B completion.
3. **Storage/index format** for internal rich descriptors (canonical open question 6):
   embed in the component ledger, use a `data/vision-content.json` sidecar, or build a
   queryable index? This must be decided before the B4 sink ships, not before B1/B2 fixtures.
4. **Hotspot display rule** (canonical open question 7): exact UI rule for choosing shown
   pins from the ranked set. Storing all ranked candidates is already decided by VSD-009.
5. **`displacementCue`** vs existing `provenanceNote` — separate structured field or one
   tagged provenance field?

Already resolved by owner/canonical policy: legacy `recognized`/`guessability` are retained
as separate Pass A legacy evidence; scored-field corrections always require owner review;
the research grader reuses the site's movement/style/tradition vocabulary; note/guide floors
are enforced without dropping individual content; and `printed`, `contested`, `govReview`,
`canon`, and `hidden` remain outside Pass B.

## 10. Conflicts between repository reality and `docs/vision-system.md`

Two status corrections are required and are being made with the Phase-1 implementation:

- the component inventory and 202-record round-trip are now implemented offline, while the
  authoritative rich component ledger remains unbuilt;
- the Pass A pilot is no longer an unfrozen draft. It was frozen, collected, sealed, and
  closed on 2026-09-01; its results remain research-only and do not affect tiers.

Counts in the plan's 2026-08-28 snapshot are historical diagnostics. The executable
inventory derives current raw and current-pool-matched counts and reports alias collisions
and orphan evidence rather than silently choosing among them.

## Approved next step — the 50-work run (owner-approved 2026-09-02)

Not yet implemented (recorded here as the approved requirement; do NOT build parallelism ahead of authorization):

- **Five deterministic concurrent lanes, ten works per lane** (50 works). Lane assignment is deterministic.
- **A fresh restricted Claude process for every work AND every stage.** Never reuse one model
  conversation across works or stages (`--no-session-persistence` is already enforced per call).
- **Checkpoint/resume each stage** (the existing per-stage completion + verify-on-resume already supports this).
- **Emit the existing Gesso desktop notification** when the complete run finishes or stops for owner attention.
- Before the 50: substitute the two stubborn B0 image works (`wikidata:Q537640`, `wikidata:Q279559`)
  with same-cell replacements, per owner approval.
