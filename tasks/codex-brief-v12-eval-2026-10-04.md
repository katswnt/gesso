# Codex brief: evaluate writer v12 against earlier versions and the gold (2026-10-04)

**From:** the owner (Kathryn), prepared by Claude.

**Task:** score claim-first writer **v12** with the rubric from your 2026-10-02 audit, against:
- (a) earlier versions v6, v7, v9, v10 and v11 of the same five works;
- (b) the gold standard.

**How:** investigation only. Make no model calls, no pushes to `gesso` or the evidence repo, and no code
changes. Write your report in your own workspace or `data/incoming/` (gitignored).

**Claude is scoring the same set independently.** Its scores are in a file named at the end of this brief. Open
it only **after** you have finished your own scoring, then compare.

## 1. What changed since your audit

**Writer v11** (`passBClaimFirstWrite/11`, VSD-062):
- The prompt is built from `docs/teaching-copy-examples.md`. These are 8 north stars adapted to today's shape
  and rules; the other 15 are held out.
- One sentence per row; multi-sentence rows are split, and the parts keep their citations.
- A hotspot's text must cite its own pin.
- Image-confirmation caveats are stripped from the writer's visual text.
- The checker (/5) has paired allow/deny examples and sees each sentence's unit.
- Assembly (/3) has no ID-based de-duplication, keeps the source-speak trim, and adds a dangling-continuation
  guard.

**Owner decision VSD-061:** framed readings are allowed ("One way to read this…" and variants). They must be
tied to a visible detail, and never stated as fact, as the artist's intent, or credited to scholars or viewers
without a source.

**Writer v12** (`/12`, checker `/6`, assembly `/4`, VSD-063). These are your bounded corrections:
- The why opens with a distinctive, supported feature, not a catalog label. Significance follows option (b):
  rank or importance needs a source.
- The closing "identify this in the game" question is optional.
- Story and identity pins are fine when they explain.
- Restraint in general statements; the examples were corrected ("the woodcut's only way" became "main way").
- The checker has a catalog-citation example.
- Heading punctuation is cleaned.

**Assembly /5** (after the v12 run; no calls): the dangling guard now catches only words that need the cut
sentence ("That makes…", "It was later…", connective + reference word). It no longer catches a bare
"He"/"It"/"They": Café's why had been dropped for "He painted it outdoors at night…".

The canonical guide is `docs/teaching-copy-guide.md`. The decision log is `docs/vision-system.md`, VSD-059 to
VSD-063. Code is in `scripts/lib/pass-b-claim-first.mjs` (`g-03-image-agent-boundary`, at or after `05349f4`).

## 2. The copy to score

Works and filename keys (`<sha24>` = the first 24 hex characters of sha256(work id)):

| Work | Id | `<sha24>` |
|---|---|---|
| *The Execution of Lady Jane Grey* | `http://www.wikidata.org/entity/Q1213453` | `66289831df143b2f30e2481b` |
| *Café Terrace at Night* | `wikidata:Q1025704` | `58af0b692f1c78ea2e76028b` |
| *Boy with a Basket of Fruit* | `http://www.wikidata.org/entity/Q2610936` | `9cdbeb05a947051dc967ad49` |
| *Psyche Revived by Cupid's Kiss* | `http://www.wikidata.org/entity/Q517408` | `81d2428b8dac10ffb3b5eb6c` |
| *Composition VII* | `wikidata:Q2990634` | `8116ec9c4ad20e5469093f40` |

All paths below are in the evidence repo, `katswnt/gesso-pass-b-evidence`, branch `claude/pass-b-state`, under
`incoming/vision-calibration/claim-first-nightly/copy/` (local: `~/Documents/gesso-pass-b-evidence/...`).

- **v6, v7, v9, v10:** `2026-10-01/<sha24>.w6.json`, `.w7.json`, `.w9.json` and `.w10.json`. These are the
  same files you scored on 2026-10-02.
- **v11:** `*/<sha24>.w11.a3.json`. The date folder is each work's next daily: `2026-11-01`, `2026-11-02`,
  `2026-11-05`, or `undated` for Café and Boy.
- **v12 as run:** `*/<sha24>.w12.a4.json` (assembly /4).
- **v12 re-assembled with assembly /5:** `katswnt/gesso-archive`,
  `incoming/teaching-copy-eval-2026-10-04/v12-assembly5/<sha24>.json` (local: `~/Documents/gesso-archive/...`).
  **This is the version to score as "v12".** It is the same S3/S4 evidence with today's assembly; only Café's
  why differs from `.a4`.
- **Stage evidence:**
  - v11: S3 `cf-9f2fbcbd026c`, S4 `cf-d363a442fb74`.
  - v12: S3 `cf-51f78535fba1`, S4 `cf-a64be1a631e5`.
  - Each run has `works/<work>/attempt-1.result.json` (rows, verdicts and reasons) and its input file.

## 3. The gold

Unchanged from your audit:
- the 20 + 3 north-star records (ids in `docs/vision-study-guide-style.md`; records in `data/teach-works.js` and
  `data/hotspots.js`);
- the Julius Caesar guide.

**Note:** 8 records are now adapted into the writer prompt. These are the Hydria (`harvard303416`),
Fujimigahara (`aic24573`), the Korean Ten Kings (`harvard173617`), the Prodigal Son
(`http://www.wikidata.org/entity/Q512755`), the Red Studio (`wikidata:Q6455615`), the Triumphal Chariot
(`wikidata:Q2454480`), the Virahotkanthita Nayika (`harvard303830`) and Meleager (`vaO40991`).

**Compare v12 against the held-out 15 (and Julius Caesar),** not against these 8, so the comparison isn't
circular. Your gold calibration scores are in `gesso-archive`,
`incoming/codex-teaching-copy-audit-2026-10-02/scores.json`.

## 4. What to deliver

1. **Scores.** v12 (assembly /5) for each of the five works on your 8 dimensions (H, Q, A, R, W, D, S, L; 0–4,
   total /32), with a one-line rationale per dimension quoting the surviving text. Recompute or reuse your v6–v10
   scores, score v11, and give a per-version mean table.
2. **Against the gold.** For each dimension, how far v12 is from the held-out gold, with concrete quoted
   examples of where it matches gold and where it still falls short.
3. **Regressions.** Anything v12 lost that an earlier version had. The owner has flagged:
   - v6's whys;
   - v7 and v9's questions;
   - v9's answer depth.
4. **Failure analysis.** For every trimmed sentence in v12, was the checker right? Also, where do one-sentence
   answers come from: a writer stub, or the checker trimming? Known examples:
   - Composition: "If it is abstract, what is it about?"
   - Psyche: "What is happening in this scene?" and "What makes this Neoclassical?"
   - Jane: "What makes this Romantic history painting?"
5. **Rule compliance.**
   - framed readings used correctly;
   - no unframed meaning;
   - no pipeline language;
   - restraint (no absolutes);
   - hotspots describe their own pins;
   - no repeated answers;
   - the closing question not overused.
6. **Ranked next fixes, no extra calls per work.** Also say whether v12 is good enough to resume overnight copy
   writing (the owner's decision; give your recommendation and the risks).
7. **Comparison with Claude's scores.** After finishing 1–6, open Claude's independent scores and note where you
   disagree by 2 or more points on any dimension, and why.

**Claude's independent scores** (open only after finishing 1–6): `gesso-archive`,
`incoming/teaching-copy-eval-2026-10-04/claude-scores.md`.
