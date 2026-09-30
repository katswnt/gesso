# Per-claim audit: design draft (2026-09-29)

Status: DRAFT for owner decisions. No code, no calls. Codex reviews once, after the owner answers the questions below.

## Why

- Full-work audits: about 14k output tokens per work, and they hold about 94% of texts.
- Judging one claim against one passage: under 1k output tokens for 8 claims, 6/8 correct, and it never wrongly said "supported".
- The expensive and unreliable part is finding every claim in free-written prose. So the design should avoid that step.

## The choice that shapes everything

**A. Write from checked claims (recommended).** Invert the pipeline: check claims first, then write.
1. B2 research and B1/B3 image observations produce claims, as now.
2. **Judge each claim** once against its source passage, the cheap judgment-only step we tested. Keep only the supported ones.
3. B4 writes copy **only** from the kept claims. Every sentence cites claim ids, and a rule forbids new facts.
4. The audit then checks two cheap things:
   - that each sentence says no more than its cited claims (a short, bounded judgment per sentence);
   - that questions and headings take for granted only claims on the list (the presupposition check that worked in v2).

There is no open-ended extraction. Yield is predictable: copy exists only where supported claims exist.

**B. Audit free prose.** Keep B4 as is, extract claims from the finished copy, and judge each one. Extraction is the step that cost about 14k tokens and missed errors; this path keeps that step.

## Pieces either way

- **Evidence:** saved page snapshots plus selected passages (built), and the museum catalog.
- **Image claims** (pose, colour, composition): see question 1.
- **Publish unit:** see question 2.
- **Launch bar:** see question 3.
- **Cost guess for A:** about 30 claims per work × a small judgment, plus a sentence check per text. Measure it on one day of 20 dailies before scaling.

## Plan once decided

1. Build offline and test against the known failures (La Gloire, St. John) and the 8 pairs.
2. One Codex review of the design, then run one day of dailies (about 20 works) with your authorization.
3. Look at yield and errors, decide, then run the nightly pipeline.

## Owner decisions (2026-09-29)

1. **Approach A:** write from checked claims.
2. **Image claims:** publish a visible-detail claim (pose, colour, composition) only when B1 and B3 both observed it.
   Identity, material and iconography always need a text source.
3. **Partly supported text:** trim and re-check. Remove sentences that cite unsupported claims (or none), then re-run
   the sentence check on the shorter text. A text that is empty, or no longer reads as a unit, is dropped.
4. **Launch bar:** a daily needs a passing why, notes and hotspots.

**Tension to measure first:** B3 runs only when B2 requests a targeted re-check, so most visible details are
observed by B1 alone. Requiring B1+B3 agreement may leave too few hotspot claims to meet the launch bar. The
one-day trial reports hotspot yield directly. If it is too low, the options are: always run a small B3
confirmation for hotspot candidates (one extra image call per work), or relax the bar for hotspots.
