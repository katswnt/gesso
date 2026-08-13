# Movement / Culture pass — methodology (PARKED, not yet run)

The `style` field (the game's Movement/Culture category) is inconsistent: some values are too broad to be
a real answer ("Chinese Buddhist art" spans 453–1800 CE across ~7 dynasties), some are missing, some are
place-as-style, some are one-off descriptive strings. This is the plan to make the whole field consistent,
guessable, and educational, without a blind LLM rewrite.

## Design principle — the granularity rule (the crux)

A movement/culture label should be **the period a specialist would write on a wall label**: specific enough to
teach and to guess, broad enough to have peers. Concretely:

- **Named-artist Western art → the art-historical movement** (Impressionism, Baroque, Cubism, Northern
  Renaissance). `styleKind: "movement"`.
- **Dynastic / imperial traditions → dynasty-or-period + tradition** when the date pins it (Tang dynasty
  Buddhist art, Song dynasty painting, Edo-period ukiyo-e, Kamakura Buddhist sculpture, Safavid, Ottoman,
  Ptolemaic Egyptian). `styleKind: "period"` or `"culture"`.
- **Peoples / ethnographic traditions → the people/culture demonym** (Benin, Bamana, Rapa Nui, Chimú).
  `styleKind: "culture"`. Never the modern country (Khmer not Cambodia — already gated).
- **Reject mega-buckets**: a label spanning more than ~1 dynasty / ~3 centuries, or applied across a
  date range that crosses a period boundary, is too broad → split by era. ("Chinese Buddhist art" is the
  poster child: split Tang / Song / Ming / Qing etc. by year.)

Test for "is this label good?": could a knowledgeable museum-goer (a) plausibly guess it from the work, and
(b) learn something true by being told it? If no to either, it's too broad, too narrow, or wrong.

## Vocabulary first (Stage 0)

Build one canonical vocabulary before touching any work. Each entry:
`{ name, kind: movement|period|culture, dateRange:[lo,hi], regions:[...], family, aliases:[...] }`.

- Seed from the existing `MOVEMENTS` table (679 entries) + the derived `CULTS` set, then fill the dynastic
  gaps (a periods table: Chinese/Japanese/Korean/Egyptian/Islamic/Andean dynasties with date ranges).
- `family` groups peers for **partial-credit scoring** (the game already rewards related movements via
  `MOV_FAMILY`) — e.g. all Chinese-Buddhist dynasties share a family so a Tang-vs-Song miss is partial, not zero.
- `aliases` folds synonyms so the mapping stage is deterministic.
- This vocabulary is the single source of truth; every `style` in the pool must resolve to one entry.

## The pipeline (cheapest first — mirror the enrichment runbook)

**Stage 1 — deterministic period-from-(date+region).** For dynastic traditions, a work's period is a pure
function of year + region. A static table (Tang 618–907, Song 960–1279, Ming 1368–1644, Edo 1603–1868,
Kamakura 1185–1333, Ptolemaic 305–30 BCE, Safavid 1501–1736, …) assigns the period with zero LLM cost.
This alone fixes the "Chinese Buddhist art" class: 31 works → their dynasty-specific label by date.

**Stage 2 — text/metadata mapping (cheap subagents, no images).** For everything Stage 1 can't pin: map each
work's raw `style` + the museum's own culture/period/movement fields + artist+date+region → the canonical
vocabulary, with a confidence score. Reuse the movement-pass runbook (`docs/passes-runbook.md` §1). Only
fill/normalize; **never overwrite a good curated value**; fame-guard (a famous work can't get a label that's
not in `MOVEMENTS`).

**Stage 3 — vision assist for the low-confidence tail only.** Where style is genuinely a visual call
(Impressionist brushwork vs Realism), use the `movement_suggestion` already captured by the vision v2 pass —
no new image reads for works already audited. Vision is the tie-breaker, not the default.

**Stage 4 — merge + gate.** Apply high-confidence results, leave the rest for review, run `check-pool`
(existing style rules: `style-is-country`, `culture-is-country`, `style-verbose`, `famous-style-no-movement`
all still apply). Add a coverage report: style distribution + flag any label whose assigned works span a
date range wider than its vocabulary `dateRange` (catches new mega-buckets).

## Guardrails / gate additions

- Every pooled `style` must exist in the vocabulary → new HARD rule `style-not-in-vocab` (fame-scaled, like
  `famous-style-no-movement`).
- A `styleKind:"period"` label whose assigned work's year falls outside the vocabulary `dateRange` → flag
  (wrong-dynasty guard).
- Keep it fail-closed and in `npm test`, same as the dedup and copyright gates.

## Pilot before the full run

Run the whole pipeline on the **"Chinese Buddhist art" 31-work class** end to end (it's self-contained and
the one you flagged). If the dynasty split reads well in-game, scale to the rest of the dynastic traditions,
then the Western movements, then the ethnographic cultures. Report the style-distribution before/after so the
granularity is reviewable, not silent.

## Open questions for Kat

- How aggressive on splitting: dynasty-level everywhere, or only where the tradition genuinely changed
  visually across dynasties?
- Partial-credit families: should Tang-vs-Song count as a near-miss (same family) or a full miss?
- Do we surface the period on the reveal even when the movement is the scored answer (extra teaching)?
