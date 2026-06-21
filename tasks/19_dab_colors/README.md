# Handoff — Dab colors (leaderboard / profile)

The pickable color set for a player's dab on the leaderboard + Account avatar. *Design reference* in HTML.

**Visual reference:** `Gesso Dab Colors.dc.html` (+ `support.js`).
**Tokens:** Archivo + IBM Plex Mono. Dab blob shapes listed below.

---

## The palette — 48 colors, 8 families × 6 steps
Drop straight into a `DAB_COLORS` array (grouped or flat). All chosen so a **white initial stays legible** and they harmonize on cream + with `--accent` #2230b8.

- **Ultramarine** — `#2230b8` `#1b2570` `#3f4cbe` `#5663d4` `#7480d4` `#9aa3e0`
- **Teal** — `#0f5b63` `#166b6b` `#1f7a8c` `#2a9d9d` `#3aa6a0` `#5cc0b6`
- **Green** — `#1f6b45` `#2f8f5b` `#3a9d4f` `#5a8f3a` `#6b9e3f` `#86ab57`
- **Ochre** — `#a7741f` `#b5852a` `#c9962f` `#cf9f3a` `#d9a441` `#e0b14a`
- **Terracotta** — `#a13526` `#b33d2e` `#c14b3a` `#cf5b45` `#d97150` `#e08c6a`
- **Rose** — `#a83a5c` `#b8466b` `#c4577a` `#d06b8a` `#d98ba3` `#e0a0b5`
- **Violet** — `#4d3590` `#5a3fa0` `#6b4fb8` `#7d5fc4` `#8e6fd0` `#a487da`
- **Ink & stone** — `#1b1916` `#3a362d` `#4a4640` `#6b6557` `#7d7866` `#8a8472`

(User chose to **keep all 48** including the lightest ochre/rose/blue tints.)

## Dab shapes — cycle independently of color
```
'63% 37% 56% 44% / 55% 48% 52% 45%'
'48% 52% 38% 62% / 56% 41% 59% 44%'
'60% 40% 47% 53% / 42% 56% 44% 58%'
'37% 63% 54% 46% / 49% 60% 40% 51%'
'55% 45% 62% 38% / 58% 46% 54% 42%'
'42% 58% 49% 51% / 63% 37% 60% 40%'
```

## Rules
- **Default** color = ultramarine `#2230b8`.
- **New players** get a **random** color (varied boards out of the box). Shape also random/cycled.
- White initial on every swatch; never tint text to the dab color.
- Picker UI = the existing leaderboard "pick your name & color" window: avatar preview + name input + a scrollable swatch grid (group by family or one flat wrap) + optional 🎲 shuffle. Selected swatch gets a `2.5px solid var(--ink)` outline, `outline-offset:2px`.
- Persist `{name, color, shape}` to the player's profile record (same record Account "Edit profile" edits).

## A11y
- Swatches in the picker are buttons with `aria-label` = color name + family; selected has `aria-pressed`. ≥30px hit target (bump to 44px on touch).
