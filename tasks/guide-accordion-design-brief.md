# Design brief — "Ask the guide" accordion (reveal screen)

For Claude Design. This is the **one reveal-screen piece not yet designed** — it came out of player testing *after* handoffs 7–9. Pairs with the "Look closer" loupe (handoff 9); see §"How it sits with Look closer."

## What it is & why
Players (real first-timers) wanted to *ask a museum guide* things like "why ink instead of tempera?" or "who's that figure?". A live chat invites abuse + per-question cost, so instead we **pre-write the answers** to the questions everyone asks and present them as a calm, expandable **accordion** on the reveal — it reads like a guide talking, but it's static committed content (zero runtime cost, nothing to abuse).

## The content shape (already authored per work)
A per-work array of question/answer pairs — **variable length**: a required core of 5, plus as many extra accurate ones as the work warrants (obscure works ≈5, famous works 8–10).
```js
guide: [
  {q:"Why this medium?",           a:"…2–3 warm sentences…"},
  {q:"Who or what am I seeing?",   a:"…"},
  {q:"Why does it matter?",        a:"…"},
  {q:"What should I look at?",     a:"…"},
  {q:"What's the story behind it?",a:"…"},
  // …optional extras, same shape…
]
```
Design must handle **any count from 5 up** gracefully — don't hard-code five rows.

## The component
An accordion titled **"Ask the guide"** (kicker in the IBM Plex Mono caps style we use for section labels, maybe a small loupe/speech dab icon).
- Each row: the **question** (tappable, full-width), a chevron/`+` affordance, expands to the **answer**.
- **Collapsed by default**, all rows — so a 10-question work never overwhelms. **One open at a time** (opening one closes the last) keeps it tidy.
- Styling: the existing **study-note palette** (`--study-bg` / `--study-border`), Archivo for answers, plain and readable. Quiet and secondary — it should feel like supplementary reading, not compete with the artwork.
- A subtle dab motif is welcome (e.g. the row marker / icon), honoring `body.motion-ok` / `prefers-reduced-motion` for any expand animation.

## Mobile
- Full-width rows, generous ≥44px tap targets, collapsed by default (critical on mobile given the length). Smooth height expand, motion-gated.

## a11y
- Rows are real `<button>`s with `aria-expanded`; answer region `aria-hidden` when collapsed. Enter/Space toggles; Esc isn't needed (inline, not a modal).

## How it sits with "Look closer" (handoff 9)
The reveal's reading flow, top to bottom:
1. **`why`** — the existing one-line "how you'd place it."
2. **"Look closer"** button → the loupe overlay (handoff 9): numbered marks on the canvas + the look-closer cues. *Looking first.*
3. **"Ask the guide"** accordion (this brief) → the deeper Q&A. *Then learning.*

So: the line, then *look*, then *ask*. The accordion is the calm endnote of the reveal.

## Tokens / patterns
Existing `:root` (styles.css). Fonts Archivo + IBM Plex Mono. Dab `.blob` = `border-radius:63% 37% 56% 44% / 55% 48% 52% 45%`. Accent `--accent` #2230b8. Study palette `--study-bg` #eceffb / `--study-border` #d3d8ef. Deliver as a `.dc.html` reference like prior handoffs; I'll port it (render the `guide[]` array into the accordion).

## Engineering note (not Design's concern, flagged for the porter)
Handoff 9 assumed cues live at the **movement** level (`CUES[styleKind][style].cues`, 3 each) with hotspots `{x,y,zoom}`. Reality has since moved to **per-work** cues (`teach-works.js` → `cues[4]`, 4 each) with hotspots `{n,x,y}` (no `zoom`). When porting Look closer: drive markers/loupe off the **per-work** cues + `{n,x,y}` coords (derive `zoom` from x/y), not the movement-level data.
</content>
