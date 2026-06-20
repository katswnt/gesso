# Handoff — Account page (the "You" hub)

A signed-in player's home for everything personal. Now that accounts exist, this consolidates the scattered progress views (streak / archive / stats) and gives Settings + account management a permanent home. *Design reference* in HTML — port into `index.html` as a new `renderAccount()` route (`/account`).

**Visual reference:** `Gesso Account.dc.html` (+ `support.js`) — desktop + mobile.
**Tokens:** existing `:root` in `styles.css`. Archivo + IBM Plex Mono. Dab avatar uses the signature blob `border-radius:63% 37% 56% 44%/55% 48% 52% 45%`.

---

## Layout (desktop; mobile reflows to a single column)
1. **Identity strip** — dab avatar (filled with the player's leaderboard color + initial), display name, `@handle · member since <month yr>`, **Edit profile** button. *Reuse the leaderboard "pick your name & color" window for edit.*
2. **At-a-glance** — 4 stat tiles: **Current streak** (+ longest), **All-time points** (+ works played), **Global rank** (+ percentile), **Top results** (perfect + masterpiece counts).
3. **Your eye** (mastery) — accuracy bar per category (Movement / When / Medium / Where) colored by the result scale (`--full` / `--partial` / `--miss`); "You nail" vs "You whiff" lists by movement & region; a **Train your weak spots →** button that opens the Training filter builder **pre-seeded** with the weak facets.
4. **Side rail** — **Movements met** (`18/44` + emblem dots, → Glossary), **Specialist badges**, **This week** mini activity bars (→ Archive).
5. **Settings** — Reduce motion / Colorblind-safe results / Hard mode (soon). Same state as the header Settings sheet — one source of truth.
6. **Account** — email, **Sign out**, **Delete** (destructive, red outline → confirm step).

## Data wiring (all already tracked)
- Streak/longest/byDay → `loadStreak()`. Points/rank → leaderboard store. Perfect/masterpiece counts → tally from results history. Mastery → the `byStyle`/`byRegion` mastery maps (`bumpMastery`). Glossary `met` count → glossary unlock store. Badges → specialist thresholds.
- **Train weak spots** builds a `TRAIN` config from the lowest-accuracy facets and calls `startTraining(TRAIN)` (see `17_training/`).
- **Edit profile** writes the same name/color record the leaderboard uses.

## Routing & entry
- New route `/account` (add to `route()` / `renderFromPath()` / `pathFor()`).
- **Header avatar → Account** (primary entry). This supersedes the separate "You ▾" dropdown from the home-entry mock — clicking the avatar just goes to Account; keep the dropdown only if you want a power-user shortcut. (See `Gesso Home Entry.dc.html` for the slimmed header: inline row = Training · Glossary · Collections + avatar.)
- Glossary, Archive, Collections remain their own top-level pages — Account links *into* them, doesn't absorb them.

## Mobile
- Identity centers; at-a-glance becomes 2×2; mastery shows top + bottom category only with the Train button; the rail collapses into a stacked **link list** (Glossary 18/44 · Archive · Badges · Settings · Sign out).
- ≥44px tap targets on every row/button. Toggles are real checkboxes for SR; stat tiles are static text.

## A11y / motion
- Accuracy bars may animate width on entry — gate on `body.motion-ok` (reduced-motion users see them filled instantly).
- Mastery colors must not be the *only* signal — pair the % number with the bar (already done); colorblind-safe mode applies the same shape/glyph cues used on result swatches.

## Open question for eng/design
- **Share-your-stats card** — not in this mock. If wanted, reuse the share-image canvas pipeline (`downloadShareImage`) with a stats layout (eye %s + rank + streak). Flag if you want it specced.
