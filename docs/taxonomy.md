# Style, movement, and culture taxonomy

How Gesso labels an object's style, why the labels are structured as a hierarchy, and how the Getty
Art & Architecture Thesaurus (AAT) is used as a backstage authority to keep that structure honest.

This is the reference behind the short README section "Style, movement, and the Getty AAT backbone."

## The problem

Every scored work carries a `style` (e.g. "Baroque", "Ukiyo-e", "Dutch Golden Age", "Maori") and a
`styleKind` (`movement` | `school` | `period` | `tradition` | `culture` | `genre`). The style facet is one of
the five things a player guesses, so the label set has two jobs at once:

1. **Teach** — the label should be the name a curator would actually use for the object.
2. **Score fairly** — the label appears as one option among distractors, and (in future) as a target for
   partial credit. So the vocabulary's *shape* matters as much as any single label: two labels a player
   cannot fairly be asked to tell apart must never appear together as options.

These two jobs pull in different directions, and the tension shows up most sharply in one recurring
question: should a broad movement like "Baroque" be split into national variants like "French Baroque"
and "Italian Baroque"?

## The decision

We asked the question three ways — as an art historian, a museum curator, and a product designer would.
They converged:

1. **Model a hierarchy; display the parent.** The parent movement ("Baroque") is the guessable, scored
   label. Children exist in the structure but are not multiplied for their own sake.
2. **Never nationalize mechanically.** We do *not* mint "[Country] + Baroque" for every country. We split a
   parent only into a **named school with a diagnostic look** that a specialist recognizes as its own thing:
   Dutch Golden Age, Caravaggism, Utrecht Caravaggism, Siglo de Oro, Flemish Baroque. Not "French Baroque"
   invented purely to record that a work is French.
3. **Geography lives in the WHERE facet, not the style label.** Gesso already scores place, region, and
   country as its own facet. Baking a nationality into the style string would double-count geography and
   pollute the style distractors. Style tests style; place tests place.

Why not just adopt a professional vocabulary's structure wholesale? Because AAT's tree is a *cataloguing*
structure (it optimizes for shelving concepts), and our family grouping is a *confusability* structure (it
optimizes for "would a player confuse these"). AAT is both too coarse for us in one place — it fuses
Renaissance and Baroque into one "Renaissance-Baroque styles" branch, and we do not want a "Renaissance"
guess earning partial credit on a "Baroque" answer — and too fine in another — it lumps Dutch Golden Age and
Italian Baroque under regional umbrellas as near-siblings, when visually they are distinct and make a *good*,
teachable distractor pair. So we keep our own grouping and use AAT to validate it, not to replace it.

## How it is implemented

- **`MOVEMENTS`** (`index.html`) — the unified `label → { dates, region, palette }` lookup for every
  style/culture label. `dates` drives the date-tolerance window (`movEra`); `region` drives the map and
  distractor spread; `palette` is ours (an aesthetic choice AAT does not supply).
- **`MOV_FAMILY`** (`index.html`) — the hand-tuned **confusability grouping**: which labels share a parent.
  Inverted into `MOV_FAM_OF`, it powers `movementSim` and the `styleChoices` distractor de-dup, so two
  options from the same family at different granularity ("Baroque" vs "Italian Baroque") never co-appear. It
  is also the reserved parent for future parent/child partial credit. It is **not** a taxonomy; it is a
  game-fairness grouping, validated against AAT but not dictated by it.
- **`parentStyle(style)`** — resolves a label to its family display label via `MOV_FAMILY`.

## The Getty AAT backbone (backstage)

AAT is the standard controlled vocabulary curators catalogue against. We map every Gesso style/culture label
to an AAT concept id and keep the result in **`data/aat-map.json`** — a sidecar data file, kept out of the
app bundle and **never shown to players**. It buys four things:

1. **Canonical spelling.** AAT's preferred term corrects our hand-authored labels (e.g. our "Caravaggisti"
   → AAT's `Caravaggism`, id `300386054`).
2. **Hierarchy validation.** AAT's parent/ancestor chain flags any label we filed under the wrong family.
3. **Concept-identity de-duplication.** Two of our labels resolving to the *same* AAT id are the same
   concept — a stronger near-duplicate signal than string similarity (feeds `audit-labels.mjs`).
4. **Dates.** AAT scope notes carry period dates we would otherwise guess, to seed `MOVEMENTS.dates`.

### Regenerating the map

`node scripts/aat-fetch.mjs` (run **locally with plain node** — it needs network; a sandbox cannot reach
Getty). It is paced with backoff and checkpoints every label to `data/incoming/aat-map.json`, so re-running
resumes. Matching is deliberate: an **indexed exact-literal** lookup (pref/alt label, with case/diacritic/
suffix variants) is tried first, because Getty's full-text relevance ranking buries exact concepts
("Baroque" ranks below "Naryshkin Baroque"). Only on an exact miss do we fall back to a relevance-ranked
fuzzy search, tagged `fuzzy` for human review. Matches outside the Styles-and-Periods facet (object-types
like *vedute*, or peoples/cultures filed in another AAT facet) are tagged `offfacet`. **We never
auto-accept a fuzzy or off-facet match as canonical** — those are a review queue, not a result.

Match tiers, highest to lowest confidence: `exact` (pref label) → `alt` (alternate label) → `base` (matched
a stripped/folded variant, e.g. "Ayutthaya period" → "Ayudhya") → `fuzzy` (relevance guess) → `none`. Any of
these may carry an `-offfacet` suffix.
