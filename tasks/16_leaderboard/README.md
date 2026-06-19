# Handoff — Leaderboard ("The Register")

A calm, salon-register leaderboard with a podium moment. *Design reference* in HTML — port into `index.html` as a new route. **Prerequisite:** a backend/store of scores, and (for Friends + persistent names) lightweight player identity — see below.

**Visual reference:** `Gesso Leaderboard.dc.html` (+ `support.js`) — board, podium, pinned self-row, pick-name/colour modal, share-rank card, badge legend, identity options.
**Tokens:** existing `:root`. Metals silver `#9aa0a6`/`#6c7177`, gold `#b3892f`/`#9a7b2e` (handoff 13). Archivo + IBM Plex Mono. Dab family = handoff 08.

---

## Tabs (two independent axes)
1. **Board:** Today · All-time · By tier. Selecting **By tier** enables the Easy/Medium/Hard/Impossible sub-segment (greyed + `pointer-events:none` otherwise).
2. **Who:** Global · Friends. (Friends needs follows/accounts — ship Global first.)

## Layout
- **Header** — "The Register", `no. <accession> · closes in HH:MM:SS` (live countdown for Today).
- **Podium (top 3)** — flat plinths (no gradients): gold `#ecca6f`, silver `#d4d8dc`, bronze `#dcab7c`; #1 raised + crown. Avatars are dabs.
- **Rows** — `rank · avatar + name (+ specialist badge) + ★/✦ counts · score`. Hover tint. Specialist badges: movement (green), region (blue), Attributor (gold ✦, 10+ artists nailed) — 90%+ threshold.
- **Self row** — `position:sticky;bottom:0`, ultramarine top-border, "your rank" + an **edit** link → opens the modal. Highlight inline if in visible range; otherwise pin at bottom.
- **Right rail** — share-rank card (rank/score/swatch result/"top N%"), specialist-badge legend, identity options.

## Avatars — cycle the dab family
Each avatar uses a **different dab shape** (handoff 08) by index, with a slight per-index rotation, so a column of avatars never looks stamped:
```js
av.style.borderRadius = DABS[(i+1) % DABS.length];     // reserve DABS[0] for the logo
av.style.transform    = `rotate(${((i*37)%13)-6}deg)`;
```

## Pick name & colour modal
Opens from the self-row **edit** link (and first time a player lands on the board with no name). Contents: a **live dab preview** (updates initials from the name + the chosen colour), a **name field** (≤16 chars), **8 colour swatches each rendered in a different dab shape**, Save. Esc / × / veil-click closes. Persist `{name, color}` to `localStorage["gesso.identity"]` (and to the account when accounts exist). Initials = first letters of the name's words, fallback "YOU".

## Identity — phased (3 options shown in the rail)
1. **Initials only** (anonymous, no login) — simplest.
2. **Pick-a-name + dab** (lightweight, no login) — **recommended first ship.**
3. **Account + avatar** — when Friends/cross-device needs it.

## Data shape
```js
{ rank, name, color, score, tier, perfects, masterpieces,
  badge:{kind:'movement'|'region'|'attributor', label} | null, isYou }
```
Today resets daily (seed by date); All-time = cumulative; By-tier filters the same rows. Friends = filter to followed ids.

## Tone / a11y
Calm editorial — the podium is the one energetic moment; rows stay quiet. Badges pair colour with a text label (not colour alone). Modal is keyboard-navigable; swatches are buttons with `aria-label`. Countdown + scores use `tabular-nums`.
