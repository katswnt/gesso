# Gesso — Portfolio Showcase (shot list + before/after)

A hiring committee plays for 30 seconds and leaves. This is the guide to *showing* the depth they'd otherwise miss. Pair each with a screenshot/GIF.

## The three screens that tell the story
1. **The reveal panel** — the teaching payload. Show: numbered **look-closer pins** on the image, the **"Ask the guide" Q&A** (goes beyond the visible), and the new **Context callout** (provenance/sensitivity). *Caption: "Every guess ends in a two-minute lesson."*
2. **The Collections "where the art comes from" page** — the honesty surface. Show the live region breakdown + the "the canon's bias runs deep" copy. *Caption: "We tell you how copyright and popularity shaped the collection — instead of hiding it."*
3. **A contested object** (e.g., a Benin Bronze) with its provenance Context callout. *Caption: "Objects with contested histories are shown with context, not as trophies."*

## Before / after (data quality — the rigor proof)
| Dimension | Before | After |
|---|---|---|
| Easy-tier vision-audited | ~75% | **100%** (399/399) |
| Medium labels | systematic "Textile"/raw-P186 junk | fixed across **~130** works |
| Wrong-art images | unknown, unaudited | **~11** caught + replaced/held |
| Dates | single year (false precision) | **670** honest "c. X–Y" ranges |
| Non-Western taxonomy | forced "movement" | **207** reclassified culture/period |
| Contested provenance | none | **71** works with acquisition context |
| Human/ancestral remains | playable | **excluded** + gate-enforced |
| Quality gate | check-pool only | check-pool + **6 audits in `npm test`** + auto copyright check on harvest |

## Numbers worth quoting
- ~**5,950** curated public-domain works; grew coverage (Russian Peredvizhniki, PD women, German/Belgian, national icons) via an artist-seeded harvest → copyright-audited → promoted.
- AI-assisted QA surfaced **417 hidden works** and caught the England/Paris place-resolution bug, *The Skater*'s unscored style, and the Vanuatu stone's missing cultural category.
- ~20 commits this cycle, **zero shipped regressions** (one near-miss corruption caught + reverted by the gate).

## The one-line narrative (use verbatim)
> *"I built and run a daily art-history game, and I treat its ~6,000-work collection the way a museum would — decolonized taxonomy, provenance ethics, attribution rigor — while shipping AI-generated teaching content behind fail-closed quality gates."*

That single sentence signals **consumer craft + data rigor + ethics + AI ops**.

## Reading order for a reviewer
`docs/icp.md` (who + why) → `docs/metrics.md` (how success is measured) → `docs/case-study-honesty-pass.md` (the hero decision) → this file (proof) → `docs/monetization.md` (business judgment).
