# Vision consolidation + complete coverage inventory

> **Canonical decisions:** [`docs/vision-system.md`](../docs/vision-system.md). This file
> preserves the 2026-08-28 planning snapshot and implementation detail; where it differs
> from the later owner-approved decision record, the canonical document wins. Update the
> decision record first when product intent changes.

**Captured:** 2026-08-28
**Status:** approved requirement; not yet implemented or run
**Safety boundary:** build on the G-03 broker/tool-less/human-approval work. No live image or model calls without separate approval.

## Owner requirement

1. Maintain a reproducible, per-work list showing exactly which current pool works are complete, missing, blocked, or stale for every vision judgment.
2. Replace the overlapping production vision passes with one canonical, versioned run that preserves every useful question previously asked. The **rich structured pass is the intended pass**, not a disposable experiment: pose/gesture, palette, lighting, figures, format, delights, condition, visible evidence, and related research fields must remain first-class outputs.
3. Never call a work “vision complete” merely because an ID was processed. Completion means every required judgment was human-approved or explicitly marked not applicable against the current image bytes and prompt/schema versions.
4. Produce the player-facing teaching layer in that same reviewed run: plentiful work-specific follow-up Q&A plus accurate feature-anchored hotspots. A work is not content-complete merely because basic image QA passed.

## Verified snapshot before consolidation

Current pool: **6,557 works**.

| Historical artifact | Current works represented | Current works absent |
|---|---:|---:|
| Canonical combined audit (`vision-audit.json`) | 5,972 | 585 |
| Rich structured `vision.js` pass | 202 | 6,355 |
| Five-or-more follow-up guide questions | 5,689 | 868 |
| Guide clears both the five-question floor and the existing template-thin detector | 4,248 | 2,309 missing or template-thin |
| Image-grounded note records | 5,880 | 677 |
| Hotspot records | 5,736 | 821 |
| Adaptive guessability probe | 410 | 6,147 |
| Image-consistency verifier (local artifact) | 515 | 6,042 |
| Predict-the-human pilot (local artifact) | 29 | 6,528 |

Only **4 works** occur in all six historical artifact sets. That does **not** make those four comprehensively approved: the historical canonical ledger records bare IDs, does not bind approval to the current image/prompt/schema, and cannot distinguish `pass`, `blocked`, or `stale`.

Therefore the honest vNext baseline is:

- **0 / 6,557 works are provably complete under the future consolidated schema.**
- Historical outputs remain useful migration evidence, but must be labelled `legacyEvidence`; they may not be promoted retroactively to a vNext pass.

The dated counts above are diagnostic only. A generator, not this hand-written snapshot, must become the source of truth.

The scheduling gap is already player-visible. Across the **2,131 distinct works scheduled from 2026-08-28 forward**, 235 lack five guide questions, another 406 have a nominal guide dominated by the old template stems, and 213 lack a hotspot record. That is **641 scheduled works with missing-or-thin guides**. A missing hotspot may be legitimate only when the reviewed result explicitly says `noPins`; absence alone cannot be treated as that verdict.

## One pipeline, with two information boundaries

Use one command, one sanitized derivative, one run manifest, one review queue, one approval artifact, and one coverage ledger. The run has two ordered tool-less stages because the old questions have incompatible information requirements:

1. **Blind visual stage:** image only. Ask identification/recognition, visible inference for when/where/medium/style/artist, per-axis visual difficulty or expected lay performance, and a free description of what is visible. Do not expose title, artist, date, source, URL, or catalog answers.
2. **Metadata-informed QA/enrichment stage:** the same sanitized image plus catalog metadata. Ask image/catalog consistency, playability, quality, framing, medium legibility, corrections, teaching observations, and feature-anchored pins.

Putting the blind questions into the metadata-informed prompt would leak the answers and invalidate them. They belong to the same consolidated orchestrator and coverage record, but not the same model message.

The adaptive transformation ladder remains an explicitly versioned **research mode**, not a prerequisite for production eligibility. It requires multiple transformed images and answers a different experimental question. The inventory must report its coverage separately without making all non-probe works look production-incomplete.

## Canonical superset of questions

Every required field must produce a value or an explicit `notApplicable` reason; omission is incomplete.

### Identity, eligibility, and image fitness

- Does the image depict the cataloged work? What is visibly shown, and why is it consistent or inconsistent?
- Is the work playable from visible evidence?
- Image quality: blur, darkness, glare, resolution, obstruction.
- Framing: whole work, crop, detail, or subject lost in a gallery/group shot.
- Is each scored facet visually legible, especially medium?
- Metadata correction candidates and replacement-image candidate, always human-reviewed.

### Teaching and visible evidence

- Free visual description (`seen`).
- Evidence for **when, where, medium, style/culture, and artist**, each with feature, reason, and optional bounding box.
- Five-to-seven image-grounded teaching notes.
- Feature-anchored pins; explicit `noPins` when appropriate.
- At least five accurate, work-specific **Follow-up questions / Ask the guide** answers, plus as many additional questions as the image and well-supported context genuinely warrant. These must include material/craft, subject or object function, significance, what to inspect closely, and backstory/context, adapting the wording when a slot does not apply.
- Palette/tone, format, figure count/identity, pose/gesture, delightful details.
- Signature/inscription, condition, and photographic/image artifacts.

### Editorial standard for study questions: dimensions, not a form

The older question set was an **inspiring baseline of learning dimensions**, never a literal template to repeat across thousands of works. Preserve what it was trying to teach:

- Why was this material chosen, and what did it let the maker do?
- What visible evidence supports the attribution to this artist or workshop?
- What visible evidence places it in this era?
- What visible evidence locates its region, culture, movement, or school?
- Who or what is depicted, how can a viewer recognize it, and what was the work for?
- Why is this work consequential, surprising, contested, technically unusual, or worth remembering?
- What detail would a thoughtful viewer probably miss without a guide pointing it out?

Those are coverage dimensions, **not approved question wording**. The agent must inspect the actual image, decide what is genuinely interesting about this particular work, and phrase questions that would make little sense if pasted onto another object. Examples of the desired transformation:

- Generic: “How do we know it is by this artist?”
  Specific: “Why do the smoky edges around her eyes point back to Leonardo?”
- Generic: “How do we know its era?”
  Specific: “What makes this stiff gold-ground space look medieval rather than Renaissance?”
- Generic: “Why was this material used?”
  Specific: “Why carve these flying folds in marble instead of modeling them in clay?”

The guide should begin from the richest visible hooks: an unexpected pose, odd gesture, half-light, surface, tool mark, gaze, costume, object function, symbolism, scale, compositional tension, damage, or tiny narrative event. It then connects those observations to transferable recognition: artist's hand, period, location/culture, movement, and medium. It should tell a player both **what to notice here** and **how that clue helps them recognize related work later**.

Requirements:

- retain the baseline learning dimensions when they honestly apply, but never satisfy coverage by copying their generic stems;
- generate as many strong questions as the work supports (often 8–12), without padding obscure works with inventions;
- make every answer evidence-led and warm, and bind image-grounded claims to a rich evidence item and, where locatable, a hotspot;
- include at least three genuinely work-specific questions before the guide can pass quality review;
- preserve accurate existing questions during regeneration; replace only boilerplate, duplication, unsupported claims, or weak answers;
- keep a human-reviewable distinction between visible inference and external/catalog context.

`docs/guides-pipeline.md` and `scripts/regen-notes.workflow.js` preserve the earlier correction from generic template wording to curiosity-driven, work-specific questions. The consolidated pipeline must absorb that standard rather than regress to the original scaffold.

### Structured visual descriptors for themed series and research

These are mandatory durable fields, not prose that disappears after note generation:

- pose/gesture and body orientation;
- subject/scene type and iconographic motif (including categories such as odalisque only when supported);
- lighting structure: half-light, tenebrism, backlighting, diffuse light, spotlighting, and related visible effects;
- palette colors plus palette character/tone;
- composition/format, crop, viewpoint, figure count, gaze, costume, setting, and recurring visual motifs;
- delightful or unusually diagnostic details with bounding boxes;
- visible condition, signature/inscription, and reproduction artifacts;
- per-axis visible evidence for when, where, medium, style/culture, and artist.

This structured layer enables defensible collections such as reclining figures/odalisks, portraits in half-light, particular poses, palette families, compositional types, or recurring motifs. Theme membership must retain the visible evidence behind it and remain human-reviewable; do not reduce these fields to opaque model tags.

### Previously planned enrichment that must no longer be forgotten

- `visDiff`: image-only visual-inference difficulty.
- `mediumFull`: full support/material description while retaining the simplified scoring bucket.
- `anonReason`: collective, unrecorded, de-attributed, lost, or unknown.
- `living`: living-tradition candidate.
- `sensitive`: restricted/ceremonial/sacred review candidate.
- Provenance/displacement cue candidate.
- Movement/style suggestion and `styleKind`, with human review for culture/style/sensitivity judgments.

### Research measures retained in the same system but not eligibility-gating

- Recognition/identification and visible guesses for the five score axes.
- Predicted non-expert performance per axis.
- Adaptive-transform trace, survival/break state, and every rung's response when that research mode is explicitly run.

## Required durable inventory

Build `scripts/vision-inventory.mjs` as an offline, deterministic report over every current pool ID. It must canonicalize equivalent Wikidata ID forms and emit both a readable summary and a machine-readable per-work matrix containing:

- current pool ID/title and scheduling priority;
- current image URL plus fingerprint/content SHA when known;
- consolidated schema/prompt/broker-policy versions;
- status for each mandatory dimension: `pass | blocked | stale | missing | notApplicable`;
- human reviewer/approval binding and completion hash;
- legacy canonical/rich/hotspot evidence flags;
- player-content status for image-grounded notes, reviewed `noPins`, hotspot coordinates, and guide-question count/quality, including `missing`, `templateThin`, and `specificReviewed` rather than relying on count alone;
- separate research coverage flags for verifier, guessability, and predict-human;
- exact reasons for blocked/stale/missing status;
- derived queues: `dailyOrHorizonBlockers`, `missingMandatory`, `blocked`, `stale`, `legacyOnly`, and `researchCoverage`.

The report must contain exactly one row per current pool work, list stale/orphan evidence separately, fail on duplicates or unknown status values, and be reproducible from a clean clone. Ignored `data/incoming` files cannot be the only evidence behind a claimed count.

## Completion and scheduling rules

- Replace bare-ID completion with a versioned eligibility record bound to work ID, sanitized image SHA, relevant catalog-answer hash, both prompt hashes, schema version, broker-policy version, model, completion hashes, and human approval.
- A partial approved patch may safely update an approved field, but **must not mark the work comprehensively complete**. Every mandatory dimension must be approved or explicitly `notApplicable`.
- Completion has independently visible components: `imageEligibility`, `richVisualRecord`, `teachingNotes`, `guideQuestions`, and `hotspots`. The overall work is complete only when all required components pass; an explicit reviewed `noPins` may satisfy hotspots, but an absent record may not. Five mechanically filled template slots do not satisfy `guideQuestions`.
- Any changed image bytes, relevant catalog answer, prompt, schema, or approval policy makes the prior result `stale`.
- `image.ok=false`, `imageQuality=poor`, non-`ok` framing, or unresolved identity/repair review produces `blocked`, not “audited.”
- `check-pool` must hard-fail when today's or the declared scheduling horizon contains `missing`, `blocked`, or `stale` eligibility. Corpus-wide burn-down may begin report-only, but it must always print the exact remaining IDs.
- Repair state must be tracked or derivable from the eligibility source; it cannot live only in ignored queues.

## Migration sequence

1. Implement and falsifiability-test the inventory generator against the current historical artifacts.
2. Freeze the canonical superset schema and the blind/metadata-informed prompt pair.
3. Update the G-03 runner/review/merge so one run produces the complete per-work record; prevent partial approvals from writing a comprehensive pass. The current G-03 retirement of the legacy v2 executables must not retire their questions or leave `data/vision.js` without a canonical successor.
4. Import **every field** from `data/vision.js`, `data/hotspots.js`, and `data/teach-works.js` as preserved legacy evidence and generate the initial 6,557-row matrix. No rich field may be silently dropped merely because the current runtime reads only pins.
5. Re-run in priority order: today/upcoming horizon, Easy rotation, other scheduled works, then the remaining playable pool.
6. Replace `vision-audit.json` only after the new ledger and hard daily gate are verified. Preserve historical evidence for auditability.

## Incident regression

`wikidata:Q606662` (*Elgin Marbles*), served first in Medium on 2026-08-28, is the required regression fixture. Its wide, dark gallery image was processed by the old image-grounded pass and received image-specific notes, yet still shipped with the subject lost in the room. Under the consolidated system it must become `blocked` for framing/image quality and remain ineligible until a focused replacement image and all image-dependent notes/pins are re-approved.

## No-discard migration rule

Before changing or deleting any historical vision writer/schema, enumerate every persisted field and prove one of:

1. it maps losslessly into the consolidated record;
2. it remains in a named, queryable research subrecord; or
3. the owner explicitly approves its retirement with the reason recorded here.

`data/vision.js` must remain intact until its 202 records have round-tripped through that migration check. The fact that the current UI reads mainly its pins is not authorization to discard palette, pose, evidence, recognition, guessability, condition, delight, or other rich fields.
