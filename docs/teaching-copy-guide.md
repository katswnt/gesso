# Gesso teaching copy guide (canonical)

**Owner approved:** 2026-10-01 (VSD-059). **Updated:** 2026-10-02 (VSD-061 framed readings; VSD-062 gold set,
worked examples, and the Codex audit corrections).
**Used by:** the claim-first writer and checker (`scripts/lib/pass-b-claim-first.mjs`, write /11+). The writer
prompt is built from this guide and from `docs/teaching-copy-examples.md`. Any future pipeline that writes
player-facing copy must follow both files. Change them only with an owner decision recorded in
`docs/vision-system.md`.

## The gold set (what "good" means)

- **North-star records:** 20 + 3 qualified, chosen by the owner on 2026-09-03 from the "richest current
  study guides" gallery. Ids are in `docs/vision-study-guide-style.md`; full records are in
  `data/teach-works.js` and `data/hotspots.js`; the gallery is in the private repo `katswnt/gesso-archive`.
  The qualified ones are: *The Ambassadors* (latter half only), *The Little Street* (scrutinize its
  interpretation), *Meleager* (the boar's head only if it can be located).
- **Golden example:** the Mino da Fiesole *Julius Caesar* guide (`docs/vision-study-guide-style.md`).
- **Worked examples for the writer:** `docs/teaching-copy-examples.md`. These are 8 north stars adapted
  to today's shape and rules. The other 15 are held out as the evaluation set; never put them in a prompt.
- **Scoring:** the rubric in the Codex audit of 2026-10-02 (`gesso-archive`,
  `incoming/codex-teaching-copy-audit-2026-10-02/report.md`), scored on the final assembled copy. The
  gold averages 26.8/32. Its eight dimensions:
  - diagnostic hotspots
  - curiosity
  - teaching arc
  - complementary parts
  - why
  - answer depth
  - plain style
  - clean player voice

The gold shows the method. It is not a template to copy literally: it has 15–21 questions where we want the
strongest 5–7, some literal repeats, and some unframed emotional readings that the rules below no longer
allow.

## Purpose

The daily guess is the hook. After each work, a curious non-specialist should understand it better and get
better at the game. That means knowing:
- why it matters;
- what to notice;
- how a visible detail reveals when, where, in what medium, in what movement or by whom it was made.

Wrong is worse than thin. Every statement about the specific work is traceable to a source or to something
confirmed visible.

## The three parts

| Part | Job | Shape |
|---|---|---|
| **Why** | A reason to look: what makes this work worth attention. | 2–3 sentences (guided depth). Open with a distinctive, supported feature that stands on its own ("Canova makes marble read as skin, cloth and rough rock"), not a catalog label. A claim about the work's historical rank or importance ("a key work", "a masterpiece", "early", "leading") needs a source (VSD-063). Not a recap of the label and not a fun fact. |
| **Hotspots** | What to notice in a spot you can point at, and what it tells you. | 2–5 pins on the image. A short head naming the place to look, plus 1–2 sentences. Each carries one tag: `when`, `where`, `medium`, `style`, `artist`, `format` or `delight`. |
| **Follow-up questions** | What a curious person wonders about after looking: the story, the choices, the terms, the comparisons, how to recognize it elsewhere. | The strongest 5–7. Answers of 2–4 sentences, each readable on its own. |

There is no separate list of unpinned notes. Anything not anchored to a spot on the image is a follow-up
question.

### Hotspots

- **They teach.** A hotspot never just names or describes an object ("the wooden block sits in the
  foreground" is not a hotspot). It says what to notice, then what that tells you.
- **Most hotspots teach a guessing category,** like "Red figures on black slip… the key clue for red-figure
  pottery" or "Hydria shape… a jar for carrying water". The link can come from a source or from widely known
  general knowledge (below).
- **`delight` is the minority,** and still says why the detail is worth noticing.
- **The text describes its own pin.** It must describe the detail the pin sits on.
- **Explain, don't just name.** Technique, format and object-type pins teach well, and so do story and identity pins
  that explain ("This is Saint Peter Martyr; the wound in his head identifies him"). The weak pin is one that only
  names or describes an object.

### Follow-up questions

- **Make the reader want to open the answer.** Point at something specific and surprising in this work: a
  detail, a choice, a contradiction, a puzzle.
- **The north stars use the same moves again and again:**
  - **what the object is and what it was for:** "What is a kylix?", "How were viewers meant to handle it?";
  - **why this choice:** "Why use tempera for a scene this detailed?", "Why a woodcut instead of a painting?";
  - **what a term means:** red-figure, contrapposto, yamato-e, rasa;
  - **how it differs from something similar:** black-figure, a hanging scroll, Mughal portraits, German
    Expressionism;
  - **how to date it, or what makes it this movement;**
  - **the attribution pair:** "How can we tell this is by X from the work itself?" then "How do I spot X
    elsewhere?";
  - **a closing summary, optional:** "How should I identify this in the game?" sometimes; prefer an object-specific
    closing question when it teaches more. Never on every work: the guide is not a questionnaire.
- **Never ask what the label answers or a glance shows,** like "What style is it?" or "What is the medium?".
  These are trimmed automatically.
- **Run an arc:** decode this work first, then teach transferable looking.
- **Teach reading the evidence:** "Look for…", "Notice…". Present technique as its visible effect, explain
  terms, and hedge honestly. Model restraint: general statements say "often", "typically", "a way", not "only",
  "always", "the way", unless that is strictly true.
- **A question must not take for granted anything its sources do not state.**

### Overlap

**Don't repeat an answer; deepen the detail.** A detail can come back if it goes somewhere new. The hydria
names red-figure in a pin, explains how it works in one question, why it mattered in another, and how to
spot it in a third. A question that only re-describes a hotspot, or repeats the why, is out. (Literal
"each fact appears once" was tried on 2026-10-01 and deleted good teaching.)

## Rules that always win

- **General knowledge (2026-10-01, VSD-060).** A widely known, uncontroversial art-history generalization
  needs no source, like the school rule: an artist's typical technique ("thick, single-stroke paint is typical
  of Van Gogh"), a movement's hallmarks, what a medium does, a period's conventions. It is how hotspots and
  answers connect a visible detail to era, place, medium, style or artist. It never covers:
  - a fact about this specific work (date, owner, identity, event, attribution);
  - anything contested.
  No extra research calls per work.
- **Interpretation (2026-09-30, extended 2026-10-02, VSD-061).**
  - **Allowed freely:** a light reading of how a visible detail works on the eye ("draws the eye", "sets the
    figure apart").
  - **Allowed only framed:** meaning, theme, emotion and symbolism, as a clearly framed, possible reading tied
    to a visible detail: "One way to read this…", "This can be read as…", "One reading is that…".
  - **A framed reading is never:** stated as fact, the artist's intent, or credited to "scholars" or "many
    viewers" unless a source says so.
  - **Unframed** meaning, theme, emotion or symbolism needs a source.
  - Players must never think the software decided what the art means.
- **Plain style (2026-10-01).** Concrete words. No literary flourishes ("painfully human", "uneasy
  stillness"), and never tell the viewer what to feel.
- **Identities.** Name saints, figures, characters and places only when a source names them.
- **Player copy only.** Never mention research, sources, catalogs, records, metadata, museum
  classification, the prompt or the model. Never narrate what cannot be said ("left to the viewer", "not
  stated here"); leave it out instead.

## History

The September 3 study-guide style and its north stars, the June diagnostic guidelines, and the September 15
editorial review (37 of 50 works approved; hotspots tagged by axis) are all folded into this file.
`docs/vision-study-guide-style.md` remains the source of the gold ids and the Julius Caesar guide.
