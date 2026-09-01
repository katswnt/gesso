# Pilot protocol freeze — supplied identity and visual inference

**STATUS: PILOT PROTOCOL FROZEN BEFORE COLLECTION — gesso-recognition-pilot-2026-08-31-v1**

This is the first of two prospective freezes described in the v2 working design. The excluded pilot
tests instruments, reliability, missingness, transform feasibility, annotation feasibility, mask
attrition, and cost. It does not estimate the effect used to choose main-study `n`.

## Claims

The sole causal pilot contrast is within-work, identical-pixel facet performance under the correct
minimal identity cue versus a format/length-matched opaque sham. The primary outcome is the equal-
work-weighted mean of facets not literally disclosed by the correct cue. Correct versus no cue is a
secondary total-effect contrast; sham versus no cue is a manipulation diagnostic. The no-cue cell is
the canonical full-view Study A facet call.

Study A is a prominent registered secondary: uncued but explicitly elicited exact-work
identification over a complete view panel, and recognition-associated facet changes. It is not a
causal test of internal retrieval. Study C reports source-view-robust or source-view-dependent exact
identification for owner-verified views of the same physical object; it does not claim memorization.

## Sample and selection

- 36 unique works, excluded from the eventual main study.
- Five historical fame bands with fixed v1 cut points: exactly `0`, `(0,100]`, `(100,612]`,
  `(612,1000]`, and `>1000`.
- Europe versus non-Europe uses recorded creation place, with a flagged culture-region fallback.
- Every one of the ten fame×region cells has three works; six seeded cells have a fourth.
- Within those hard cells, deterministic greedy selection minimizes repeated broad medium, era,
  title type, play state, and source host; content richness and alternate availability are weak
  tie-breakers. Final ties use SHA-256 of seed+id.
- Six lowest-documentation/fame selected works are flagged as a stress subset, never as proof of
  training absence.
- Duplicate records/images and unusable images are replaced from a seeded reserve before freeze.

The generated selection is a draft. A work does not enter the frozen manifest merely because a
script selected it.

## Views

Every canonical image is fetched only through G-03 and re-encoded without metadata. Every view is
then generated from that single sanitized raster using `sharp 0.35.3` / libvips `8.18.3`:

| View | Intervention |
|---|---|
| `full` | normalized full raster |
| `crop70` | seeded-anchor nested crop retaining 70% width and height, resized to canonical dimensions |
| `crop45` | same anchor, 45% |
| `crop25` | same anchor, 25% |
| `mirror` | full-frame horizontal mirror |
| `rotate90` | full-frame 90° rotation |
| `grayscale` | full-frame grayscale branch |

Anchors are balanced over center/northwest/northeast/southwest/southeast and fixed per work before
outcomes. Crops never use Pass B evidence to choose location. JPEG quality 90, 4:4:4 chroma,
Lanczos3, sRGB, white flattening, maximum side 1,568px, and round-half-up extraction are frozen.
The canonical raster is also resized locally to the current native limit of 1,568 28×28 visual
patches, so the provider does not silently rescale a nominally 1,568px square. `golden-transform.json`
makes an encoder/library drift visible.

## Model requests

- Requested model: `claude-sonnet-4-6`.
- Anthropic API version: `2023-06-01`.
- Temperature: `0`.
- Output caps: identification 260, facets 650, identity-first 850 tokens.
- Per-request hard deadline: 180 seconds; entire pilot collection window: 24 hours from the first
  live runner invocation.
- Image bytes and frozen text only; no `tools` field, URL, source, path, filename, or catalog metadata
  reaches a blind call.
- Identification and facets use independent fresh contexts except the deliberately randomized
  identity-first protocol.
- A returned model id different from the frozen id stops the run.

The model returns strict JSON. One complete JSON fence may be removed without altering content;
prose-wrapped, malformed, or schema-invalid responses are preserved and marked missing, never
outcome-retried.

## Recognition and cue rules

Each work freezes its own exact-recognition rule (`recognitionKey.exactRequires` over one
`targetUnit`). A distinctive-title work is exact on a frozen accepted title/alias alone
(`title`); a generic or duplicated title also requires all frozen distinguishing qualifier groups
(`title+qualifier`), and a natural `distinguishingQualifierGuess` field carries the institution,
accession, or version so catalog text is never crammed into the title guess. A work earns exact from
one prespecified uniquely identifying fact only when its key is `uniqueFact`-type or explicitly sets
`allowUniqueFactAlternative`; otherwise a unique fact alone does not grant exact credit. Naming the
right accepted title without a required qualifier is partial identification, not confabulation;
artist/series/tradition without the exact work is partial attribution. A confident specific claim
that matches no accepted title is recorded as confabulation. A confident wrong title that
nonetheless supplies the correct unique fact is contradictory and routed to blinded adjudication,
never silently scored.

The correct cue is the smallest precommitted label that disambiguates the work. The sham replaces
every alphanumeric cue character with deterministic opaque characters while preserving punctuation,
spaces, token lengths, and total length.

Disclosure is literal only. After NFKD normalization, diacritic removal, lowercase conversion,
non-letter/number separation, and whitespace collapse, a complete accepted answer/alias must occur
as a complete phrase in the cue. Semantic entailment does not mask: `Guernica` does not literally
disclose Picasso, Spain, or 1937. One resulting mask is applied identically to no-cue, sham, and
correct-cue responses. Mask and contributing-work rates are reported by facet, cue type, and fame
band.

## Frozen research grading

Raw response text and exact structured guesses are preserved append-only and never overwritten by
derived grading; each stored response is bound to its SHA, which is recomputed and re-parsed on every
read, so an edited answer is detected rather than trusted.

- Date: one integer best year. Truth is a frozen interval. Distance is zero inside the interval;
  otherwise `credit = max(0, 1 - log1p(distance)/log1p(1000))`. Error of 1,000 years or more receives
  zero. Broad-period correctness is separately reported under the bins frozen in code.
- Place: top guess only. Accepted exact place/culture aliases receive `1`; a frozen accepted parent
  region receives `0.5`; otherwise `0`. Optional alternatives are stored but cannot rescue scoring.
- Medium: accepted exact material/technique/support `1`; accepted medium family `0.75`; broad object
  category `0.4`; otherwise `0`.
- Style/tradition: exact frozen site label/alias `1`; frozen family `0.65`; frozen curated related
  label `0.35`; otherwise `0`. Genuine non-applicability is excluded. Raw site labels are retained;
  the curator dedup map canonicalizes whole labels before comparison, and a level matches only on
  whole-label equality — substring containment (e.g. "Neo-Baroque" vs "Baroque") never earns credit.
- Artist: accepted maker/collective `1`; truth-consistent workshop/circle/attributed-to `0.6`;
  follower `0.4`; otherwise `0`. Culture-made or genuinely anonymous/unrecorded cases are
  `notApplicable` rather than forced wrong.
- Confidence: probability from 0–100 that the response receives full credit (`credit === 1`). Brier
  score uses that binary event. Frozen bins are 0–20–40–60–80–100.

Deterministic aliases apply first: the frozen date interval and the frozen exact/family/related (or
parent/broad) alias hierarchies decide credit, with the curator dedup map canonicalizing whole labels
first (whole-label equality; substring containment never earns credit). Per the owner-approved v2
design, a genuinely ambiguous facet response that the deterministic grader cannot resolve — a
substantive, confident guess (>=60) that matches no frozen alias at any level — is routed to blinded
facet adjudication rather than scored 0. Exact-work IDENTIFICATION contradictions (a confident wrong
title carrying the correct unique fact) are likewise adjudicated. Every adjudication cell — facet or
identification — is queued under an opaque adjudication id, bound to the reviewed response SHA, and
stays unresolved (its credit/recognition null, never a forced value) until a bound ruling resolves
it; the analysis refuses to finalize while any remain. The reviewer is blinded to experimental
condition (work, call, view, source, image, cue, fame, region, arm) but sees the exact response and
the minimum frozen ground truth needed to grade it; a separate private controller file (written apart
from the reviewer packet) is the only mapping from each opaque id back to its call and response. A ruling
set is bound to the exact blinded packet and the exact collection-evidence state it was made against
(packet SHA + collection-evidence SHA) as well as each response SHA, so a stale or edited packet cannot
carry rulings forward.

Within a work, the primary Study B score averages every eligible, applicable facet; then works are
weighted equally. A mandatory leave-artist-out sensitivity and artist-only secondary are reported.

## Exact calls and reliability

- Study A: `36 × 7 × 2 = 504` separate identification/facet calls.
- Study B additions: 36 sham + 36 correct-cue facet calls = 72.
- Identity-first subset: 12 calls.
- Study C alternate full views: 6 identification + 6 facet calls = 12.
- Base calls: 600.
- Repeat all six canonical and six alternate Study C identification cells: 12.
- Seed 59 general repeats from the other 588 base cells.
- Total before transport retries: **671**.

The first valid response is primary. If exact-identification agreement is below 85%, the main
preregistration must repeat identification broadly or model identification probability rather than
treat one read as a stable state.

## Checkpoint, retry, drift, and cost

Call order is hash-seeded and interleaved across tasks, works, arms, views, fame, and region. An
append-only attempt intent — bound to the frozen call hash and the exact request evidence (freeze
commit, image SHA, prompt SHA, request-policy version, requested model, conservative cost) — is
published before any network request. Every response/failure is a separate append-only artifact.
Integrity comes not from filesystem immutability but from an attempt state machine that re-derives every
outcome from the verified raw bytes and from an externally sealed collection-evidence commit, not from
trusting the files. The 24-hour collection window is enforced before every attempt. A returned model id
different from the frozen id is fatal: it stops the run and invalidates collection. Only transport /
rate-limit failures with no substantive answer may retry; a schema-invalid or malformed substantive
response is preserved and marked missing and is never outcome-retried; the first valid response is
primary and a later response after any terminal outcome is a protocol violation. A crash after intent but
before a stored response reserves that attempt's full conservative cost. Resume skips valid or terminal
calls and continues the exact order.

Only no-substantive-response transport/rate-limit failures are retryable, at most three attempts per
planned call. Scheduled repeats are distinct preregistered calls, not retries.

The exact cost preflight uses every transformed image's dimensions, exact prompt+schema bytes, frozen
output caps, the official 28×28 visual-patch calculation, a $3/M input and $15/M output price
snapshot, a one-token-per-UTF-8-byte text upper bound plus 256 input-overhead tokens per request,
and a 20-worst-call retry reserve. The run
cannot start if the upper bound exceeds **$15** and cannot begin an attempt whose conservative cost
exceeds remaining authorization. Actual usage and request ids are stored.

Price and vision-token snapshots were verified on 2026-08-31 against Anthropic's official
[Sonnet 4.6 model page](https://platform.claude.com/docs/en/models/sonnet-4-6/overview) and
[vision documentation](https://platform.claude.com/docs/en/build-with-claude/vision). They are
rechecked at final freeze; a changed price/model/native-resolution contract requires a recorded
protocol revision, not an unlogged runtime adjustment.

## Data boundary and two freezes

All derivatives, attempts, raw results, grades, and diagnostics live under isolated research paths.
No pilot script changes the corpus, fame, notes, hotspots, playability, dailies, tiers, or Pass B
ledger. Batch execution remains disabled until a post-pilot equivalence test.

The protocol freeze requires a dedicated frozen repository commit before the first model response; no OSF
or external registration is required. The frozen manifest stores a stable freeze id and
the exact required commit subject, not a self-referential commit hash. Before the first call, the
runner derives that commit, proves every frozen path is tracked and byte-identical to it, and
writes the derived hash to append-only run evidence. The later main-study freeze may use pilot
variance, reliability, missingness, transition availability, mask attrition, annotation reliability,
and measured cost. It may not use
the observed pilot treatment effect or direction to choose hypotheses or sample size.

## Freeze checklist

- [ ] Owner approves all 36 works, recognition keys, cues, masks, and truth hierarchies.
- [ ] Images pass the four-state protocol; canonical and all view hashes are frozen.
- [ ] Six same-object alternate views and rights fields are owner-approved.
- [ ] Style near-duplicates are resolved in the frozen snapshot.
- [ ] Ten-language metadata snapshot is complete and isolated.
- [ ] Exact cost preflight passes under $15.
- [ ] Offline tests, structural gate, and full `test:ci` pass.
- [ ] Manifest/artifact hashes and collection window are frozen.
- [ ] Dedicated protocol-freeze commit exists with the exact generated subject; every frozen
  path is byte-identical and the runner can derive its hash.
- [ ] Status changes to `PILOT PROTOCOL FROZEN BEFORE COLLECTION` before any response.
