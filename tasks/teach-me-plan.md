# "Teach Me" content generation plan

## Vision
Every work eventually has a **5-axis Teach Me** that helps you *place it geographically, date it chronologically, situate it in a movement, read its medium, and ID the hand*. Built **top-down** from reusable building blocks, composed per work at runtime. **Zero runtime tokens** — all committed JSON keyed dictionaries.

## Architecture
`window.ARTEFACTUM_CUES = { style{}, culture{}, region{}, medium{}, artist{}, place{}, era{}, work{} }`
- Loaded via `<script src>` (cues.js + teach-*.js). App composes `teachFor(item)` → a panel with up to 5 axis cards:
  - **Place it** ← place[country] / region
  - **Date it** ← era[century] / movement dates
  - **The school** ← style[movement] / culture[culture]
  - **The medium** ← medium[medium]
  - **The hand** ← artist[artist]  (only when known)
  - Plus a work-specific `why` + "how the eye sees it" from work[id] when authored.
- Per work: if `work[id]` exists, its content overrides/augments; otherwise compose from building blocks (never invent per-work specifics).

## Normalization (prerequisite)
- Fix `cleanMov` (stop stripping " art" → restores Land/Pop/Academic/Op art). [build]
- `CANON_STYLE` map (casing + variants → canonical keys). [app, no rebuild]
- `CANON_CULTURE` map: collapse Met's granular strings → ~25 canonical cultures (Gandhara, Greek, Roman, Maya, etc.).
- `CANON_PLACE` map: historical → modern (Republic of Florence → Italy, French Third Republic → France, …) for clean place keys.

## Generation order (highest level first, as token budget allows)
- **L1 Movements** (32 canonical) — {why, cues[3]}.  ← START HERE
- **L2 Cultures** (44→~25 canonical) — covers 145 culture-only works. Highest work-coverage.
- **L3 Artists** (122) — "the hand": signature traits, dates, region, 1–2 tells.
- **L4 Places** (40→canonical) — geographic placement cues.
- **L5 Eras/centuries** (~10, NOT 111 decades) — chronology cues; finer dating lives at work level.
- **L6 Mediums** (16) — enrich existing notes.
- **L7 Per-work** (306, in batches) — work-specific `why` + axis overrides for recognizable works; obscure works rely on composition.

## Generation method
- **Bounded layers (L1, L4, L5, L6)**: author directly — small, high-accuracy.
- **Large layers (L2 cultures, L3 artists, L7 works)**: generate-then-**verify** (second-pass fact-check; soften/drop unverified claims; obscure items fall back to composition, no invention). Candidate for a generate→verify Workflow or a Codex loop.

## Accuracy guardrails
- Style-level generalizations only, unless a work/artist is well-documented.
- Verify pass on generated artist/work claims; prefer omission over a confident wrong fact (it's a teaching app).
- Source link already on every reveal for "go check."

## Status
- [ ] L1 Movements — in progress
- [ ] Normalization (CANON_STYLE applied; cleanMov fix; culture/place maps)
- [ ] L2 Cultures … L7 Works
- [ ] Multi-axis Teach Me panel (lands once L3/L4/L5 exist)
- [ ] Infinite mode (after teach-me kickoff)
