# Gesso — teaching-notes guidelines (for review)

Everything in Gesso's teaching layer is **pre-generated and committed**. The game makes **zero AI calls at runtime** — players can't type anything that reaches a model, so there's nothing to abuse and no per-question cost. These guidelines cover *all* the teaching content: the three note types we already ship, plus a new "Ask the guide" accordion.

---

## 0. Philosophy & hard constraints
- **Reveal-only.** Every teaching note appears *after* the player has locked in their guess. So naming the date, artist, place, or medium in a note is fine — it's no longer a spoiler, it's the payoff.
- **No human review.** These ship straight to production, so **accuracy is non-negotiable** — see §5. The cardinal sin is a confident, wrong fact (especially inventing a figure's name).
- **Warm, plain, short.** Written for a smart first-timer (think someone's mum or aunt), not an art-history seminar. No unexplained jargon.
- **Self-contained per work.** Generated from the work's catalogue data + genuinely well-known facts. If the data is thin, the note leans on what's *visibly true* rather than guessing.

---

## 1. The complete data model

Four committed artifacts, all keyed by the work's `id` (e.g. `http://www.wikidata.org/entity/Q12418`, `met12345`):

| File | Field | What it is | Status |
|---|---|---|---|
| `data/teach-works.js` | `why` | one-sentence "how you'd date & place it" | **keep as-is** |
| `data/teach-works.js` | `cues[4]` | four look-closer diagnostic clues (arrow format) | **keep as-is** |
| `data/hotspots.js` | `[{n,x,y}]` | image coordinates anchoring each cue to a feature | **keep as-is** |
| `data/teach-works.js` | `guide[5]` | **NEW** — five-question "Ask the guide" accordion | **add** |

Target schema after enrichment:
```js
"http://www.wikidata.org/entity/Q12418": {
  why:   "Early 16th-century Florentine Italian Renaissance oil portrait…",
  cues:  ["…→…", "…→…", "…→…", "…→…"],
  guide: [
    {q:"Why this medium?",          a:"…"},
    {q:"Who or what am I seeing?",  a:"…"},
    {q:"Why does it matter?",       a:"…"},
    {q:"What should I look at?",    a:"…"},
    {q:"What's the story behind it?",a:"…"}
  ]
}
```

---

## 2. Note type A — `why` (the placement logic)  · KEEP
**Purpose:** in one sentence, the reasoning that places the work in time + place + tradition — the "here's how you'd have known" summary.
**Format:** a single sentence. Leads with era + region + movement, then the single most telling reason.
**Length:** ~20–35 words.
**Example (Mona Lisa):**
> *Early 16th-century Florentine Italian Renaissance oil portrait, placed above all by Leonardo's smoky sfumato dissolving the sitter into atmospheric landscape.*

**Do:** name the period, region, movement, and the *decisive* visual tell.
**Don't:** list every fact; that's what the cues and guide are for.

---

## 3. Note type B — `cues[4]` (look-closer diagnostics)  · KEEP
**Purpose:** four concrete, *visible* clues, each teaching how a feature in the image points to a conclusion. These are the game's "how the eye sees it" teaching moments and they feed the hotspots.
**Format:** exactly **4** cues, each `observable feature → what it tells you`. Always the `→` arrow.
**Length:** ~8–18 words each.
**Each cue must point at something locatable in the image** (a pose, a tool, a building, a texture) so a hotspot can anchor to it. Pure-technique observations with no single spot are allowed but won't get a pin.
**Example (Mona Lisa):**
> - *dark veil, modest gown, and half-length seated pose → early Cinquecento elite portrait fashion*
> - *Tuscan-like winding roads and blue-green hills behind the sitter → a Florentine Renaissance setting*
> - *stable pyramidal composition and calm three-quarter pose → High Renaissance balance*
> - *soft, nearly edgeless transitions around mouth and eyes → Leonardo's oil sfumato hand*

**Do:** make each cue independent and spatially anchored.
**Don't:** repeat the same clue reworded; don't use a cue that isn't actually visible.

---

## 4. Note type C — `hotspots` (image coordinates)  · KEEP
**Purpose:** maps each cue to a spot on the image, so "look closer" can drop a numbered marker on the feature the cue describes.
**Format:** `[{n,x,y}, …]` where `n` = the cue number (1–4), `x`/`y` = position as a **percentage of the image** (0–100), anchored to the feature that cue names.
**Rule:** only emit a hotspot for cues that point to a single locatable feature; skip pure-technique cues. A work with no locatable cues stores `[]`.
**Generation:** produced by reading the actual image (vision), not guessable from text — keep this a vision pass.

---

## 5. Note type D — `guide[5]` (the "Ask the guide" accordion)  · NEW

The feature request: players want to *ask a guide* things like "why ink instead of tempera?" or "tell me about that figure." Instead of a live chat (abuse + cost), we pre-answer the **five questions almost everyone would ask**, as an expandable accordion that reads like a guide talking.

**Format:** an array of `{q, a}` items. The **first five slots below are required and fixed** (always generated, in this order). Beyond those, **add as many extra well-supported questions as the work genuinely warrants** (Kat's call: as many as possible) — anything a curious visitor would ask that we can answer *accurately* from the data + well-known facts (e.g. "What's that animal a symbol of?", "Why is it so small?", "Where was it made?", "What happened to it later?"). Answers: **2–3 sentences, warm, plain.** No upper cap, but every extra question must clear the §5 accuracy bar — never pad with filler or invented detail. Obscure works may have only the five; famous works may have 8–10.

### The five required slots (in display order)

**1. Why this medium?** — material reasoning + why-not-the-alternative.
Explain what the material let the artist do, and contrast with a plausible alternative they *didn't* use. This is the aunt's ink-vs-tempera question, generalized.
> *Why ink, not paint?* — "Ink on paper let the artist work fast and gesturally; one loaded brush gives both a hairline twig and a wet, bleeding wash in a single stroke. Oil or tempera would have meant slow, opaque layers — but the whole effect here depends on the bare paper breathing through."

**2. Who or what am I seeing?** — subject & figures.
Identify the key figures or subject and how you'd recognize them (attributes, gestures, setting). **This is the slot most prone to hallucination — see guardrails.**
> *Who's the figure?* — "A young woman in Florentine dress, shown half-length against a distant landscape — most likely Lisa del Giocondo, a Florentine merchant's wife. There are no saints' symbols or props; the whole interest is her presence and that famous, ambiguous half-smile."

**3. Why does it matter?** — significance.
What was new, influential, or important about this work or artist.
> *Why is it famous?* — "It pioneered a softer, more lifelike kind of portrait, where edges melt into shadow instead of being drawn as hard lines. Generations of painters copied that atmospheric approach — and the sitter's unreadable expression has fascinated viewers for 500 years."

**4. What should I look at?** — technique / craft detail.
Point to *how* it was made — brushwork, carving, glazing, perspective — anchored to the same features the hotspots mark, so it reinforces the look-closer.
> *What's the craft?* — "Look at the corners of the mouth and eyes: there are no outlines, just dozens of near-invisible glaze layers blurring the transitions. That technique, sfumato ('gone to smoke'), is what makes the expression shift the longer you look."

**5. What's the story behind it?** — story / context  *(NEW — added per request).*
Who made it, for whom, and the human backstory: commission, function, where it lived, what happened to it.
> *What's the backstory?* — "Leonardo began it around 1503 and never quite let it go, carrying it with him for years and reworking it. It was likely a private commission that he kept; today it hangs behind glass in the Louvre, the most visited painting on earth."

### Slot adaptation
- If a slot genuinely doesn't apply (e.g. a decorative bowl has no "figures"), repurpose that slot's *question* to the closest fit — for **slot 2** that becomes "What is this object and what was it for?" Keep five slots; don't drop to four.
- Question phrasing should sound like a curious visitor, not a textbook ("Why is it famous?" beats "Discuss the work's art-historical significance").

---

## 6. Global accuracy guardrails (apply to every note type)
1. **Only assert what you'd stake the game's credibility on.** Use the catalogue data we pass (title, artist, year, medium, place, movement, culture) + facts that are genuinely well-known for famous works.
2. **Never invent a named figure.** If you can't confidently identify who's depicted, *describe what's visible* ("a seated woman in red holding a book") instead of naming a saint/person. Wrong names are the worst failure mode.
3. **Obscure works lean safe.** When data is thin, build the notes from things that are always true from the image + material + region: medium reasoning, visible-subject description, technique, and general regional/period context. Skip specific claims you can't support.
4. **No hedging filler** ("it is believed that perhaps…"). Either state it plainly because it's solid, or describe the visible instead.
5. **Tone:** warm, encouraging, jargon explained inline the first time ("sfumato — 'gone to smoke'"). Answers 2–3 sentences; `why` one sentence; cues a clause each.

---

## 7. Generation pipeline
- **Input passed to the model per work:** id, title, artist, year, medium, place, region, movement/culture (everything in the pool record). For famous works the model also draws on well-known facts; for the `guide` slots that's where richness comes from.
- **Order of operations:** generate `why` + `cues` + `guide` in the text pass (`gen-teach-shard`); generate `hotspots` in the separate **vision** pass (it needs the image). Both keyed by id, both committed.
- **This folds into the pending batch:** the ~700 newest works (modern + Wikidata-museum + African) get the *full* richer schema in one pass; existing 2,738 works can be back-filled with `guide` in a follow-up sweep.
- **Validation before commit:** exactly 4 cues / 5 guide items; every `q` and `a` non-empty; no answer over ~60 words; arrow present in every cue; no raw catalogue echo (don't just restate the title).

---

## 8. Reveal UI — accordion (per request)
- The reveal screen keeps its current `why` line + the look-closer cues/hotspots.
- Below that, an **"Ask the guide"** accordion: five collapsed rows, each showing the question; tap to expand the answer. Quiet, study-note styling (the existing `--study-bg` / `--study-border` chip palette), one open at a time. Not chips — a calm, scannable list she can read top to bottom or dip into.

---

## Decisions (locked)
- **As many guide questions as the work supports** — 5 required slots + unlimited extra accurate ones. Mobile accordion collapses all by default so length never overwhelms.
- **Back-fill `guide` for all 2,738 existing works**, plus the full schema on the ~700 new works. Suggested order: famous tiers first (richest, most-played), then the long tail.
- Accordion lives on the reveal, **below** the "Look closer" loupe (see handoff 9) — looking first, then the deeper Q&A.
</content>
</invoke>
