# Codex brief: teaching copy, measured against the approved gold set (2026-10-02)

**Supersedes** `tasks/codex-brief-teaching-copy-2026-10-01.md`, which wrongly said there were no
approved gold examples.

**From:** the owner (Kathryn), prepared by Claude.

**Repos:**
- `katswnt/gesso`, branch `g-03-image-agent-boundary`: code, docs and the game data.
- `katswnt/gesso-pass-b-evidence`, branch `claude/pass-b-state`: generated copy and stage evidence.

**Investigation only.** Make no model calls, no pushes to either repo and no production changes. Write
your report as a file in your own workspace and give the owner the summary.

## 1. The approved gold set (start here)

The owner approved these as the standard. **Measure everything against them.**

**North-star records:**
- **Where they are listed:** by id in `docs/vision-study-guide-style.md`, under "Owner-selected legacy north
  stars".
- **When and how they were chosen:** on 2026-09-03, from the gallery
  `data/incoming/vision-calibration/rich-existing-teaching-gallery.html`, "Thirty of Gesso's richest current
  study guides and note sets". That file is local to the owner's machine; the ids are in the doc.
- **The set:** 20 whole records, plus 3 qualified ones (*The Ambassadors*: the latter half only;
  *The Little Street*: scrutinize its interpretation; *Meleager*: keep the boar's head only if it can be
  located).
- **Where to read them:** every record is intact in `data/teach-works.js` (`ARTEFACTUM_CUES.work[id]`: `why`,
  `cues`, `notes` with x/y pins, `guide`) and `data/hotspots.js`.
- **Start with these:** `harvard303416` (the Ransom of Hector hydria), `aic24573` (Hokusai, *Fujimigahara*),
  `http://www.wikidata.org/entity/Q512755` (*The Return of the Prodigal Son*), `wikidata:Q6455615`
  (*The Red Studio*) and `harvard173617` (the Korean Ten Kings painting).

**The golden example:**
- The Mino da Fiesole *Julius Caesar* guide, written out in full in `docs/vision-study-guide-style.md`.

**The owner's 2026-09-15 editorial review of 50 B4 works:**
- 37 of the 50 were approved.
- The export lives on the owner's machine; the pattern is summarized in `docs/teaching-copy-guide.md`.
- Approved hotspots are tagged by what they teach: style, when, where, medium, format, artist. A minority
  are "delight".

What the gold looks like (Claude's reading; verify it):

- **Hotspots are diagnostic.** Hydria: "Red figures on black slip: the key clue: this is red-figure pottery,
  not black-figure silhouette work." "Hydria shape: the wide body, narrow neck… identify this as a hydria."
  Each pin teaches how to identify the medium, object type, period or workshop, mostly through widely known
  general knowledge.
- **Cues are "visible feature → what it tells you"** across the guessing axes. Example: "Bold anatomy and
  foreshortening → experimental Pioneer Group".
- **Questions point at something specific and surprising:** "Why would a water jar carry a scene from the
  Iliad?", "Why make Fuji so tiny?", "What should I look for to recognize Hokusai's style elsewhere?".
  They run in an arc: first decoding this work, then skills that carry to other works.
- **The why is one dense sentence:** date, culture, medium and the giveaway.

## 2. What the owner wants from you

1. **Build a rubric from the gold set**, applicable offline to any copy, with no model calls if possible.
   - Criteria: diagnostic hotspots, how well questions provoke curiosity, the arc, overlap between why,
     hotspots and questions, why shape, answer depth, plain style, and pipeline-language leaks.
   - Score the gold records themselves first, to calibrate the rubric.
2. **Score the generated copy against it.**
   - **Which copy:** writer versions /6, /7, /9 and /10 for five works. The files are in the evidence repo,
     `incoming/vision-calibration/claim-first-nightly/copy/2026-10-01/<sha24>.w6.json` / `.w7.json` /
     `.w9.json` / `.w10.json`. `<sha24>` = the first 24 hex characters of sha256(work id).
   - **The five works:**
     - *Lady Jane Grey*: `http://www.wikidata.org/entity/Q1213453`
     - *Café Terrace at Night*: `wikidata:Q1025704`
     - *Boy with a Basket of Fruit*: `http://www.wikidata.org/entity/Q2610936`
     - *Psyche Revived*: `http://www.wikidata.org/entity/Q517408`
     - *Composition VII*: `wikidata:Q2990634`
   - **Owner verdicts so far:**
     - /6 had the best why.
     - /7 and /9 had the best questions.
     - /10 "lost what I liked about v9".
     - Hotspots and questions still overlap.
     - Hotspots that just name an object (the Lady Jane Grey block) are boring.
3. **Root causes.** Explain why the approved intent kept getting lost, and why it took until now to find the
   gold set:
   - B4 carried a condensed version of the guide but never published (`docs/vision-system.md` VSD-020 and
     VSD-040 to VSD-048).
   - The claim-first writer (VSD-053) was written without the guide.
   - Today's /6 to /10 iterations (VSD-057 to VSD-060) were tuned by eye on five works, one sample each,
     without the gold set.
4. **Ranked solutions that add no model calls per work** (an owner constraint). Questions to address:
   - Should two or three complete gold records go into the writer prompt as worked examples (for
     structure and voice only, never facts), replacing most of the accumulated rules?
   - Should the writer allocate each item to the why, a hotspot or a question inside its single call, to
     prevent overlap?
   - Is the S4 checker strict in the right places?
5. **Holes:** challenge and extend the list in section 4.

## 3. Context

**Pipeline:**
- B1–B3 are settled research stages (visible evidence, sourced facts, confirmed details).
- The claim-first writer is `scripts/lib/pass-b-claim-first.mjs`:
  - S1/S2/SI/SJ prepare verified items;
  - **S3 writes** (`WRITE_PROMPT`, now `passBClaimFirstWrite/10`);
  - **S4 checks** each sentence (`CHECK_PROMPT`, `/4`);
  - `assemble()` trims and builds the copy.
- Nightly runner: `scripts/pass-b-nightly.mjs`.

**Canonical spec:** `docs/teaching-copy-guide.md` (2026-10-01). It sets an order of authority across:
1. the owner's teaching goal;
2. `docs/vision-study-guide-style.md`;
3. `tasks/teaching-notes-guidelines.md`;
4. the September 15 review.

It does not yet name the north-star records as the gold set. Recommend how it should.

**Owner rules, newest first:**
- No extra model calls per work.
- Widely known, uncontroversial art-history knowledge needs no source ("the middle-school rule"). Facts
  about the specific work do need one.
- Meaning, theme, emotion and symbolism need a source (2026-09-30).
- Plain style: no "painfully human"-type flourishes.
- Name identities only when sourced.
- Wrong is worse than thin.

**An open conflict for the owner, to address in your report.** Some gold answers interpret freely ("Why is
Priam's visit to Achilles so moving?", "Hokusai gives ordinary labor dignity"). That conflicts with the later
interpretation rule. Assess what the gold loses under the strict rule, and propose a line the owner could
choose.

## 4. Known and suspected holes (extend or challenge)

1. **No measurement against the gold set.** Versions have been compared by eye, one sample each, so fixes
   trade one flaw for another.
2. **Prompt sprawl.** Each review added rules to the writer prompt, and they now compete.
3. **Structural overlap.** Hotspots and questions are written from one small item pool, with no allocation
   step.
4. **Thin works where B2 found little.** For example anonymous, non-Western and abstract works. The launch
   yield is unmeasured beyond five works.
5. **General-knowledge risk.** The checker judges "gk" by its own knowledge. It may pass generic clichés, or
   wrong traits attributed to lesser-known artists. There is no spot-check loop.
6. **Pin accuracy is unmeasured.** At least one of today's pins was visibly off target.
7. **Recurring works.** Nothing decides which copy version publishes when a work recurs in the daily rotation.
8. **Only a preview publisher exists.** There is no automated audit gate, no production publish and no
   rollback drill, yet the launch gate requires 30 days of auto-published dailies.
9. **Copy and UI need designing together.** The game hides unpinned notes when two or more pins exist. The
   unmerged hotspot redesign `origin/claude/hotspot-reveal-ui-20260915` changes how hotspots display.
10. **Contract churn.** Two of today's code changes altered run identity or re-derivation of accepted
    evidence. Both were caught. A pre-pin check that re-derives every finished work would catch this
    automatically.

## Deliverable

A report covering:
- the gold-derived rubric, with gold calibration scores;
- scores for /6, /7, /9 and /10 on the five works;
- root causes;
- ranked fixes that add no model calls per work;
- additions to the holes list.

Cite file paths, record ids and quoted lines.
