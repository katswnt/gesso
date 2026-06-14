# Design brief — "How to play" onboarding  ⭐ TOP PRIORITY

## The problem (real user testing — Kat's mom & aunt, first-time players)
On opening the page cold, they:
1. **Didn't know what to tap first** — the play screen shows 4–5 input fields with no "start here."
2. **Didn't know whether they had to answer every category** (you don't — skipping is fine, partial credit).
3. **Didn't realize the timeline was a slider** (the big "1700 CE" + track read as static text).
4. **Didn't realize the map could be zoomed.**

Net: experienced players get it; newcomers bounce. We need first-run onboarding **plus** better inline affordances (a modal alone won't fix #3/#4 — people dismiss modals without reading).

## Goal
A friendly **"How to play"** that (a) auto-appears on a player's **first visit**, (b) is **reopenable** anytime, and (c) is backed by small inline cues on the play screen so the game is self-explanatory even if the modal is skipped.

---

## Part 1 — The "How to play" overlay
Reuse the existing modal pattern: `openSettings()` (index.html ~line 82) builds `.settingsveil` > `.settingspanel` with `.settingshead`/`.settingsbody`/`.settingsfoot`, an × close, Esc-to-close, click-veil-to-close. Mirror that for an `openHowTo()`.

**Content to convey (designer's call on layout/illustration — keep it short, ~5 steps):**
1. **The goal** — "You're shown an artwork. Guess what you can about it; you don't have to know everything."
2. **WHEN** — *drag the slider* to the year it was made.
3. **WHERE** — *tap the map* to drop a pin (and **pinch / use +/− to zoom** — scroll does NOT zoom, see Part 2).
4. **MEDIUM · MOVEMENT/CULTURE** — tap an option (multiple choice).
5. **ARTIST** — type a name (optional **bonus**).
6. **Lock in** to see the answer + a "teach me" study note. **Partial credit** for near-misses; skip anything you don't know.
Optionally: a line on scoring (up to 2,500 pts/category) and hints (3 hints, −500 each).

**Behavior:**
- Show automatically once on first visit — gate on a localStorage flag (suggest `gesso.seenhowto`), set on close.
- Reopenable from: a **"How to play"** entry in the header nav (next to glossary/collections/etc., ~line 467) AND/OR inside the Settings panel. Also nice: a subtle **"New here? How to play"** link on the start/tier-pick hero (`renderStart`, ~line 550).
- Mobile: same bottom-sheet treatment Settings already uses at ≤680px.

## Part 2 — Inline affordances (do these too; they fix the root confusions)
- **Slider looks draggable:** the WHEN control is a real `<input type=range>` with a dab-shaped thumb, but the big "1700 CE" reads as static. Add a cue like "drag to set the year" and/or make the thumb more obviously grabbable. (Field built in `renderRound`; there's already a `#schemehint` line ~645.)
- **Map zoom is discoverable:** the play map (`#map`, ~line 701) has **`scrollWheelZoom:false`** on purpose (so the page can scroll), so zoom is only via the **+/− buttons or pinch**. Current label is "CLICK TO MARK" (~line 677). Suggest: "TAP TO PIN · PINCH / +/− TO ZOOM", and/or make the +/− control more prominent. (Don't enable scroll-zoom — it traps page scroll on mobile.)
- **"Answer what you can":** a one-line cue near the fields that skipping is OK and partial credit applies.

## Tokens / patterns
Existing `:root` tokens (styles.css). Fonts Archivo + IBM Plex Mono. Dab shape: `border-radius:63% 37% 56% 44% / 55% 48% 52% 45%`. Accent `--accent` #2230b8. Reuse `.settingsveil/.settingspanel`. Honor reduce-motion (`body.motion-ok`).

## Key facts for accuracy
- Categories adapt per work (when/where always; medium, movement-or-culture, artist vary). Artist = bonus.
- Scoring: up to **2,500 pts/category**, 5 works/day, partial credit, hints 3×−500.
- Deliver as a `.dc.html` reference like prior handoffs; I'll port it into `index.html` (`openHowTo()` + the inline cues + the localStorage first-run trigger).
