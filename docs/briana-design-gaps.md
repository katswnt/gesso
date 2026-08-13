# Combo vs Briana — design gaps (corrected)

> **Correction:** an earlier version of this doc audited the **main** branch by mistake (main still runs
> Archivo + IBM Plex Mono + blue chrome). This version compares the **combo** branch (the Briana-design
> staging line) against `origin/briana-redesign`. Combo already shares Briana's **fonts** (Faculty Glyphic +
> Manrope), her **sharp radii** (all `--r-*` = 2px), her **structure** (round sidebar, movement grid, FAQ
> accordion), and even out-de-blues her in a couple of spots. The real remaining gaps were narrow, and most
> were ported in the 2026-08-13 pass (see "Done").

## What was actually different (and mostly now ported)

**1. Display weight.** Combo ran heavy (700–800) where Briana is light (400). Ported: `.herobig` 800→400/4rem,
`.big` 800→400, `.worktitle` 700→400, `.movename` 800→400, `.glosscard .nm` 700→400.

**2. Accent chrome → ink.** The genuine "combo blue where Briana is neutral" spots (only ~7, not 44): ported
`.wordmark`, `.navbtn` (+ hover→muted), `.gearbtn`, `.menulist button`, `.moveback`, `.metarow .k` accent→ink.
`.telllink` converted to Briana's ink outline button.

**3. `#fff` cards → surface.** Ported `.plate` (#fff+shadow → transparent), `.canonical`, `.glosscard`,
`.statile` (#fff → `var(--surface)`).

**4. Header bar.** `.hd` softened to Briana's `1px var(--line)` + `var(--surface)` (was `1.5px ink` +
`surface-strong`).

**5. Study panel.** `.study` de-filled (dropped the `--study-bg` cream that read darker than the page),
border kept.

**6. Settings gear motion.** Gear now spins its `.gicon` on hover (`spinGear`), matching Briana.

**7. Pills.** `.pill` → Faculty Glyphic 400 13px on `var(--surface)` (was Manrope 500 12px on #fff),
**sentence-case kept** (no lowercase transform).

## Left intentionally different (do NOT "fix")

- **Sentence-case display titles** — combo's case system, kept everywhere (Briana lowercases some display).
- **Combo is already MORE de-blued than Briana** at `.kick` and `.fieldlabel .ix` (ink in combo, still accent
  in Briana). Do not restore blue.
- **`--study-bg` / `--study-border`** are cream in combo vs blue in Briana — combo's is the better call, kept.
- **Combo-only families** — the whole My-Gallery (`.gal-*`), onboarding (`.ob*`), hint chips (`.hintchip*`),
  laurel/share actions, the `.dabpin`/`.mblob` bits: no Briana reference, kept as-is.
- **Collections page** — explicitly out of scope, untouched.

## The one open decision (not done)

The biggest *stylistic* difference that remains is the wholesale **small-label restyle**: Briana converted
~30 tiny UI labels from **Manrope 600 → Faculty Glyphic 400 uppercase** (`.cap`, `.eratag`, `.seclbl`,
`.roundhd`, field labels, etc.). Combo keeps them Manrope. This is a deliberate identity choice, not a bug —
decide it consciously rather than folding it in. If you want full Briana parity, that's the remaining lever.

## Method

Combo: on-disk `styles.css` (837 lines) / `index.html`. Briana: `git show origin/briana-redesign:styles.css`
(625 lines). Parsed rule-by-rule, diffed per selector, filtered out combo-only families and the Collections
page. Ports applied on the `combo` branch only (design changes never mirror to main).
