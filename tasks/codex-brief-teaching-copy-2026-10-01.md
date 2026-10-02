# Codex brief: teaching copy audit (2026-10-01)

> **Superseded** by `tasks/codex-brief-teaching-copy-2026-10-02.md` (this version wrongly said no approved gold examples exist).

**From:** the owner (Kathryn), prepared by Claude. **Repos:** `katswnt/gesso` branch
`g-03-image-agent-boundary` (code, docs), `katswnt/gesso-pass-b-evidence` branch
`claude/pass-b-state` (generated copy and stage evidence). This is an investigation and audit. Make no model
calls, no pushes to the evidence repo, and no production changes.

## What the owner wants from you

1. **Investigate why we are still iterating on teaching copy**, and reconcile it with the work the
   owner remembers doing (guides, north stars, a 50-work editorial review). Explain where the
   approved intent was lost and why it kept getting lost.
2. **Audit today's results** (four writer versions for the same five works; see below) and propose
   concrete solutions.
3. **Speculate on holes we haven't hit yet**: what else will break or disappoint when this runs
   unattended over ~600 works for 30 days of dailies. Claude's own list is at the end; extend or
   challenge it.

## Product intent (owner-approved)

Gesso is a daily art-guessing game. After each guess the player gets teaching copy in three parts.
The canonical spec is **`docs/teaching-copy-guide.md`** (written today). It consolidates, in this
order of authority:

1. the owner's teaching goal, 2026-09-30 / 10-01 (Claude memory; reproduced in the guide): guided
   depth, a why on *why the work matters*, strict interpretation (meaning and emotion need a
   source), plain style, sourced identities, and widely known general knowledge needs no source;
2. `docs/vision-study-guide-style.md`, 2026-09-03 (VSD-020): follow-up question selection, arc,
   answer voice, the Julius Caesar golden example, and 20 north-star records;
3. `tasks/teaching-notes-guidelines.md`, 2026-06-14: diagnostic "visible feature → what it tells
   you" reading;
4. the owner's 2026-09-15 editorial review of 50 B4 works (37 approved). The export is local to the
   owner and is summarized in the guide: approved hotspots were tagged by what they teach (style,
   when, where, medium, format, artist), plus a minority of "delight".

Constraints: wrong is worse than thin; no owner hand-audit at scale; **no extra model calls per
work** (owner, today).

## The pipeline (where the writing happens)

- B1–B3 (settled, unchanged today): B1 records visible evidence, B2 researches facts, B3 confirms
  details in the image. `scripts/pass-b-corpus-collect.mjs`, `scripts/lib/pass-b-prompts.mjs`.
- Claim-first (VSD-053, `scripts/lib/pass-b-claim-first.mjs`, runner `scripts/pass-b-claim-first.mjs`,
  nightly `scripts/pass-b-nightly.mjs`):
  - S1 judges B2 claims against page text;
  - S2 confirms B1 visuals with B3;
  - SI/SJ add sourced identities;
  - **S3 writes** from cited items only;
  - **S4 checks** each sentence against its cited items;
  - `assemble()` trims failed sentences and builds the copy.
- B4 (the previous writer) used a condensed copy of the 2026-09-03 guide in its prompt but never
  published (canary holds). See `docs/vision-system.md` VSD-020 and VSD-040 to VSD-048.
- Decision log for today: `docs/vision-system.md` VSD-057 to VSD-060.

## Today's writer versions (all from the same B1–B3 evidence)

| Writer | What changed | Owner verdict |
|---|---|---|
| /6 | Guided why (owner rule), notes and hotspots, first guide Q&A | Best why. Questions boring ("Where is this café?"). Unpinned notes looked like questions. |
| /7 | Brought in the 2026-09-03 guide: questions with an arc, unpinned notes folded into the guide | Questions much better. Why worse: Claude swapped in the 2026-09-03 why rule over the owner's newer one. |
| /9 | Canonical guide: owner's why, axis-tagged hotspots, no overlap | Liked. But hotspots mostly fell back to "delight", because sources rarely state diagnostic links. Some whys collapsed to fragments. |
| /10 | Widely known general knowledge ("gk") allowed. Hotspots must say why. Code drops why fragments and repeats of the why. | "Lost what I liked about v9." Hotspots still overlap with questions. Two works too thin. |

Copy files (the evidence repo, `incoming/vision-calibration/claim-first-nightly/copy/2026-10-01/`):
`<sha24>.w6.json`, `.w7.json`, `.w9.json`, `.w10.json` for Lady Jane Grey (Q1213453), Café Terrace at
Night (Q1025704), Boy with a Basket of Fruit (Q2610936), Psyche Revived (Q517408) and Composition VII
(Q2990634). Each file has `why`, `hotspots` (with `axis` from /9), `guide` and `trimmed` (each cut
sentence with the checker's reason). Stage run evidence (S3 output, S4 verdicts and reasons) is in the
`cf-*` run directories beside it.

## Specific symptoms to explain

- Hotspots and follow-up questions overlap, even though the prompt forbids it. Café Terrace /10:
  the cobblestone hotspot plus "How was the pavement made?". The assembly rule only catches answer
  sentences that cite nothing but a hotspot's visual.
- Run-to-run variation: each version was a single sample. How much of "v10 lost v9's strengths" is
  the prompt, and how much is sampling noise?
- Thin output: Boy with a Basket ended with 1 hotspot and 2 questions; Composition VII with 2
  questions. The S4 checker cuts small overstatements ("each grape" when the source says "small
  highlights"). The writer has no second pass, and the owner forbids extra calls.
- Answers cut to one weak sentence. "How do I spot Van Gogh elsewhere?" was answered by "The museum
  classes it as Post-Impressionism." A code rule that dropped such stubs was tried today and reverted:
  it removed far more good questions than stubs.
- Pipeline language keeps finding new forms: "the catalog classes…", "left to the viewer",
  "not stated here".
- The writer prompt has grown with each version. Instructions may now be competing (strictness
  against richness against overlap rules).

## Questions for you

1. Root cause: why did approved intent get lost twice (B4 to claim-first; /7 overriding the
   owner's why)? What process or structural change prevents it? For example, a single spec file the
   prompt is generated from, plus a golden-example evaluation that runs offline before any paid run.
2. Is one writer call per work the right shape, or would a *planning* section inside the same call
   help? For example, the writer first allocates each item to the why, a hotspot or a question, then
   writes. That could cure overlap without extra calls.
3. Is S4 too strict, too loose, or strict in the wrong places, given today's verdict reasons?
4. How should we compare versions given sampling noise, with no extra calls? For example, an offline
   rubric, hand-written gold copy for 3–5 works, or a scored checklist.
5. What concrete changes would you make to the prompt, the assembly or the checker? Rank them.

## Claude's speculation: holes we haven't patched yet

1. **No golden reference.** We compare versions by eye on 5 works, one sample each. Without 3–5
   owner-approved gold examples and a rubric, every change is a guess, and fixes trade one flaw for
   another (as /7 → /10 did).
2. **Prompt sprawl.** Each review added rules. The writer now balances interpretation limits,
   general knowledge, axes, arcs, overlap and style at once, and later rules may crowd out earlier
   ones. The spec should be short and ranked, with examples doing the heavy lifting.
3. **Overlap is structural.** The writer gets one small pool of items (often about 10 claims and
   5–8 visuals) and fills three sections from it. Without an allocation step it will reuse the
   strongest items.
4. **Thin works will be common** wherever B2 found little: anonymous objects, non-Western works with
   English-poor sources, abstract art. The launch bar ("why + ≥2 hotspots + ≥3 questions") may fail
   for a large share. We need a measured yield over a bigger sample, not 5 works.
5. **General-knowledge risk.** The "gk" path is now judged by the checker's own knowledge. It may
   wave through confident clichés ("chiaroscuro is a hallmark of Baroque") that are true but generic,
   or wrongly attribute traits to lesser-known artists. There is no spot-check loop yet.
6. **Hotspot coordinates.** Pins come from B1/B3 boxes; at least one was visibly off target today
   (Lady Jane Grey's crimson hose). Nothing measures pin accuracy in production.
7. **Repeated works.** Works recur in the daily rotation. Copy is filed by date and writer version,
   but nothing decides which version is published when a work recurs, and nothing stops a later
   nightly from producing different copy for the same work.
8. **Publication path.** Only a preview publisher exists (`scripts/pass-b-publish-preview.mjs`). There
   is no automated audit gate, no production publish and no rollback drill. The launch gate (30 days of
   dailies, auto-published, no hand-audit) depends on it.
9. **Game UI coupling.** The game hides unpinned notes when 2+ pins exist, and guide questions go in a
   separate column. The unmerged hotspot redesign (`origin/claude/hotspot-reveal-ui-20260915`) changes
   how hotspots display. Copy structure and UI need to be designed together.
10. **Contract churn.** Today's fixes changed run identities (the B3 wire schema moved S2's run) and
    re-derivation (a regex used by S3's control). Both were caught, but each code change to claim-first
    risks breaking resumption of accepted evidence. A pre-pin check that re-derives every finished
    work would catch this automatically.

## Deliverable

A short report: root causes, an audit of the four versions (with your own rubric), ranked solutions
with no extra calls per work, and your additions or challenges to the list of holes above. Cite file
paths and copy files.
