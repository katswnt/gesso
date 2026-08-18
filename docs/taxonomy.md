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

## A plural authority crosswalk (backstage), not one backbone

The Collections page cites a reading list — the Sarr–Savoy Report, Dan Hicks's *The Brutish Museums*, Walter
Mignolo, Local Contexts / Traditional Knowledge (TK) Labels, Nicholas Thomas, Linda Nochlin, *Statues Also
Die*, *Dahomey*. Read against our own data work, they make one demand: **no single institution should be
"the backbone."** Resolving every plural tradition to one Getty hierarchy is, in Mignolo's terms,
subordinating many knowledges to one locus of enunciation — and AAT's own frame shows it (it fuses
Renaissance-Baroque, and files living cultures under *languages*).

So the model is a crosswalk, not a backbone. **`data/authorities.json`** (tracked; never shown to players)
gives every concept several authority slots and one field naming which we defer to *for the name*:

```
"Mexica": {
  authorities: { aat: {id:"300017033", pref:"Aztec (culture or style)", ...}, wikidata: {...}, tkLabel: null },
  canonical: "endonym",   // AAT holds the concept but under the EXONYM "Aztec" — we don't defer to it for the name
  note: "endonym; AAT pref is the exonym Aztec. We display the people's own name."
}
```

`canonical` values:
- **`aat`** — Getty holds the concept and names it compatibly with us. One advisory voice, useful for concept
  identity, hierarchy validation, and period dates. Not the truth.
- **`wikidata`** — a community-editable, endonym-richer item is the better source (e.g. `Yoruba` →
  `Q190168` "Yoruba people"). The concrete delinking: Getty stops being sole arbiter.
- **`endonym`** — the concept exists in an institutional source but under an exonym/imprecise pref, so we use
  the community's own name and keep the institutional id only as a cross-reference (`Mexica` not "Aztec",
  `Seljuq` not "Seljuk").
- **`tkLabel`** — a Local Contexts / TK Label protocol governs this heritage; the source community's
  authority outranks any thesaurus. (Manual; always wins.)
- **`none-adequate`** — **no source holds a community-grounded concept** (`Māori art`, the over-fine compound
  tail). We record *that*, with a note pointing to Local Contexts / TK Labels, instead of forcing a wrong
  Getty id. This honest "we don't have the right to name this here" is the whole point.

What the crosswalk buys, unchanged from before: canonical spelling, hierarchy validation, concept-identity
de-duplication (two labels → one id = the same concept; feeds `audit-labels.mjs`), and period dates.

### Regenerating the crosswalk

Two backstage fetches feed `data/authorities.json` (built by `scripts/build-authorities.mjs`, which keys off
the *current* pool and preserves manual `tkLabel`/`canonical` overrides). Both run **locally with plain node**
(they need network; a sandbox can't reach Getty or Wikidata), are paced with backoff, and checkpoint so a
re-run resumes:

- `scripts/aat-fetch.mjs` → `data/incoming/aat-map.json`. Matching is deliberate: an **indexed exact-literal**
  lookup (pref/alt, with case/diacritic/suffix variants) first, because Getty's relevance ranking buries exact
  concepts ("Baroque" ranks below "Naryshkin Baroque"); then a facet-preferred fuzzy fallback that favors an
  in-facet style/period/culture concept over a same-named language/object-type. Match tiers: `exact` → `alt`
  → `norm` (parenthetical-qualified, e.g. "New Kingdom (Egyptian)") → `base` → `fuzzy` → `none`, any of which
  may carry `-offfacet`. **We never auto-accept a fuzzy or off-facet match** — those stay a review queue.
- `scripts/wikidata-authorities.mjs` → fills the `wikidata` slot, preferring an item whose P31 (*instance of*)
  is a culture/people/movement/period over a same-named language or disambiguation page — the Wikidata analog
  of the AAT facet-preference. A confident match on a currently `none-adequate` label promotes it to
  `canonical: "wikidata"`.
