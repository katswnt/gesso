# Briana Design-Gap Audit

A place-by-place inventory of where the **current combo site** (on-disk `styles.css` + `index.html`, identical to `main` at time of writing) diverges from **Briana's real redesign** (`origin/briana-redesign`; `origin/briana-pure` is near-identical, a 42-line diff, and agrees on every point below).

## How this was produced

- Combo files: `/Users/kathrynswint/Documents/artguessr/styles.css` (711 lines) and `index.html` (3625 lines).
- Briana source: `git show origin/briana-redesign:styles.css` (625 lines) / `:index.html` (2602 lines).
- Method: both stylesheets parsed rule-by-rule and diffed per selector (185 common selectors differ; 153 selectors exist only in Briana; 223 only in combo). HTML checked for copy casing and font links.

## IMPORTANT framing note

The design briefs under `tasks/` (`design-system-audit.md`, `16_leaderboard`, `19_dab_colors`, `howto-design-brief.md`, etc.) describe the **Archivo + IBM Plex Mono + hex** system — i.e. they describe the **combo** line, not Briana's redesign. Briana's redesign is a **later, different direction**: **Faculty Glyphic + Manrope + oklch tokens + lowercase**. This audit treats `briana-redesign` as the source of truth (per the request). Where the briefs conflict with Briana's branch, that conflict is itself a divergence to resolve with Briana, and is flagged.

---

# 1. COLOR DIVERGENCES

## 1a. Palette side-by-side (`:root`, styles.css line 2-14)

Same variable names, different values. Combo replaced Briana's oklch values with hex and **added** a large token block (radii, spacing, metals, font shorthands) that Briana's `:root` does not contain.

| Role | Token | **Briana (briana-redesign)** | **Combo (current)** | Same? |
|---|---|---|---|---|
| Page background | `--bg` | `oklch(0.9823 0.0069 88.64)` (warm near-white) | `#e9e7e0` | different value |
| Surface | `--surface` | `#f6f4ee` | `#f6f4ee` | same |
| Surface strong | `--surface-strong` | `#edeae0` | `#edeae0` | same |
| Ink (text) | `--ink` | `oklch(0.2809 0.0000 0)` (neutral ~#1e1e1e) | `#1b1916` | different value |
| Muted | `--muted` | `oklch(0.5553 0.0292 285.41)` (violet-tinted gray) | `#8a8472` (warm gray) | **different hue** |
| Faint | `--faint` | `#a39d8c` | `#a39d8c` | same |
| Ink soft | `--ink-soft` | `#3a362d` | `#3a362d` | same |
| Line | `--line` | `oklch(0.8699 0.0000 0)` (neutral gray line) | `#e3ded1` (warm cream line) | **different hue** |
| Line card | `--line-card` | `#ddd8ca` | `#ddd8ca` | same |
| Accent | `--accent` | `#2230b8` | `#2230b8` | same |
| Accent underline | `--accent-underline` | `#b0b5e0` | `#b0b5e0` | same |
| Study bg | `--study-bg` | `#eceffb` | `#eceffb` | same |
| Study border | `--study-border` | `#d3d8ef` | `#d3d8ef` | same |
| Full/correct | `--full` | `oklch(0.7772 0.1083 144.81)` | `#2f8f5b` | different value |
| Partial | `--partial` | `oklch(0.8794 0.1352 97.96)` | `#cf9f3a` | different value |
| Miss | `--miss` | `oklch(0.7038 0.1448 21.44)` | `#c14b3a` | different value |
| Track | `--track` | `#dcd6c6` | `#dcd6c6` | same |
| Silver / silver-ink | — | **not defined** | `#9aa0a6` / `#6c7177` | combo-only |
| Gold / gold-ink | — | **not defined** | `#b3892f` / `#9a7b2e` | combo-only |
| Surface lift | `--surface-lift` | **not defined** | `#fdfcf9` | combo-only |

Net: bg, ink, muted, line, full, partial, miss all differ in exact value; muted and line differ in **hue** (Briana neutral/violet-tinted, combo warm). Combo adds metals + surface-lift tokens Briana never had.

## 1b. Accent-blue (`#2230b8`) where Briana does NOT use it

This is the single largest color theme. Combo paints **accent blue onto 44 spots** where Briana keeps the element **ink / muted / neutral**. Combo uses `var(--accent)` 90 times in CSS vs Briana's 54.

### Same-selector accent additions (19) — combo turns a Briana ink/muted element blue

| # | Selector | Briana color | Combo color |
|---|---|---|---|
| 1 | `.wordmark` (styles.css:36 / br:24) | `color:var(--ink)` | `color:var(--accent)` |
| 2 | `.navbtn` (l.242 / br) | `color:var(--ink)` | `color:var(--accent)` |
| 3 | `.navbtn:hover` | `color:var(--muted)` | underline in accent-underline |
| 4 | `.gearbtn` (l.248) | `color:var(--ink)` | `color:var(--accent)` |
| 5 | `.helpdab` | `border+color:var(--ink)`, `background:var(--surface)` | `border+color:var(--accent)`, transparent bg |
| 6 | `.helpdab:hover` | `opacity:.8` | fills `background:var(--accent);color:#fff` |
| 7 | `.menulist button` | `color:var(--ink)` | `color:var(--accent)` |
| 8 | `.moveback` | `color:var(--ink)` | `color:var(--accent)` |
| 9 | `.metarow .k` | `color:var(--ink)` | `color:var(--accent)` |
| 10 | `.cue .num` | `color:var(--ink)` (bordered circle) | `color:var(--accent)` (no circle) |
| 11 | `.dif .ct` (tier count) | `color:var(--muted)` | `color:var(--accent)` |
| 12 | `.dif:hover` | shadow lift only | `border-color:var(--accent)` |
| 13 | `.srccard:hover` | shadow lift only | `border-color:var(--accent)` |
| 14 | `.herokick` | `color:var(--muted)` | `color:var(--accent)` |
| 15 | `.btn2` | `border:var(--line-card)`, `color:var(--ink)` | `border+color:var(--accent)` |
| 16 | `.lookmark` (map pins) | `background:var(--ink)` | `background:var(--accent)` |
| 17 | `.andrail .b` | `color:var(--muted)`, `background:var(--surface)` | `color:var(--accent)`, `background:var(--study-bg)` |
| 18 | `.telllink` | bordered `var(--ink)` button | `color:var(--accent)` text link |
| 19 | `.dabo` (inline dab glyph) | uses SVG (no fill) | `background:var(--accent)` block |
| + | `::-webkit-scrollbar-thumb` | `background:transparent` | `background:var(--accent)` |

### Combo-only surfaces that introduce accent blue (25) — components Briana never designed, or renamed

`.hintchip`, `.hintchip:hover`, `.hintchip:disabled:not(.used):hover`, `.hinthl`, `.hintlabel`, `.hinttext` (combo's hint-**chip** system; Briana uses a `.hintrow*` system with muted/ink text), `.pip.done`, `.dif .tier`, `.practice .pinf`, `.practice .pchip:hover`, `.practwo .practice .pchip.setup`, `.wlink:hover .wt`, `button.glosscard:hover`, `.acedit:focus`, `.agnum.pinnum`, `.agrow.flash`, `.dabpin span`, `.savebtn.saved`, plus the entire onboarding (`.obdab`, `.obdots span.on`, `.obnext`) and the whole My-Gallery rework (`.gal-chip.active`, `.gal-sortbtn.on`, `.gal-study-title`, `.gal-accard-count`).

**Total accent-blue-where-Briana-does-not: 44** (19 same-selector recolors + 25 combo-only accent surfaces).

The visual effect: Briana's chrome (wordmark, nav, gear, help, back links, meta keys, map pins, scrollbar) is **neutral ink**, with blue reserved for true actions (primary `.btn`, `.pill.sel`, autocomplete hover, toggles, streak dab). Combo makes the whole chrome blue.

## 1c. Other non-accent color divergences

| Selector | Briana | Combo |
|---|---|---|
| `.hd` (l.316) | `border-bottom:1px solid var(--line)`; `background:var(--surface)` | `border-bottom:1.5px solid var(--ink)`; `background:var(--surface-strong)` (heavier, darker header) |
| `.glosshead` | transparent, no border | `background:var(--surface-strong)`, `border-bottom:1.5px solid var(--ink)` |
| `.banner` | plain, `border-bottom:1px solid var(--line)` | adds `background:linear-gradient(180deg,#eceffb,#f6f4ee)` (blue-tinted) |
| `.pill.sel` | `color:var(--bg)` | `color:#fff` |
| `.plate` | `background:transparent` | `background:#fff` + `box-shadow:0 10px 26px` |
| `.canonical img` | `background:var(--surface)` | `background:#efece4` |
| `.grp`, `.glosscard`, `.statile` cards | `background:var(--surface)` | `background:#fff` (brighter cards) |
| `.glosscard.locked` | `opacity:.7` only | `background:#efece4;border:1px dashed #c7c0ae` |
| `.study` | transparent, `border:1px solid var(--line-card)` | `background:var(--study-bg)` blue panel |
| `.settingsveil` | `rgba(27,25,22,.32)` / `.38` mobile | `rgba(27,25,22,.42)`+blur / `.5` mobile (darker) |
| `::-webkit-scrollbar-track` | `transparent` | `var(--line-card)` |
| `.tcount` | `background:var(--surface)` | `background:var(--study-bg)` (blue) |

---

# 2. TYPOGRAPHY DIVERGENCES

## 2a. Font families — total swap

| | **Briana** | **Combo** |
|---|---|---|
| Display / body font | **Faculty Glyphic** (serif-ish display), `body` uses it | **Archivo** (grotesque sans) |
| Label / mono font | **Manrope** | **IBM Plex Mono** |
| Google Fonts link (index.html head) | `family=Faculty+Glyphic:wght@400;500;600;700;800&family=Manrope:wght@400;500;600;700;800` | `family=Archivo:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600` |
| `body` (styles.css:772) | `font-family:'Faculty Glyphic',sans-serif` | `font-family:'Archivo',sans-serif` |
| `.mono` | `font-family:'Manrope',monospace` | `font-family:'IBM Plex Mono',monospace` |

Every one of Briana's `'Manrope'` occurrences (66) → combo `'IBM Plex Mono'`; every `'Faculty Glyphic'` (64) → combo `'Archivo'`. This is a wholesale two-font substitution affecting **~130 rules**. Also note: `*` selector — Briana adds `-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale`; combo dropped both.

## 2b. Weight & size philosophy

Briana's display sizing uses **`rem` + weight 400** (light, large, editorial). Combo uses **`px` + weight 700-800** (heavy, tighter). Representative per-component divergences:

| Selector | Briana | Combo |
|---|---|---|
| `.herobig` (home hero) | `400 4rem 'Faculty Glyphic'`, `line-height:1.0` | `800 56px 'Archivo'`, `letter-spacing:-.025em`, `1.06` |
| `.big` | `400 2rem 'Faculty Glyphic'` | `800 42px 'Archivo'`, `-.02em` |
| `.dif .nm` (difficulty name) | `400 2rem 'Faculty Glyphic'`, **`text-transform:lowercase`** | `700 20px 'Archivo'` (no lowercase) |
| `.movename` | `font-size:20px` (inherits Faculty 400) | `800 26px/1.05 'Archivo'`, `-.01em` |
| `.worktitle` | `400 1.25rem/1.3 'Faculty Glyphic'` | `700 19px/1.15 'Archivo'`, `-.01em` |
| `.statile .n` | `400 1.25rem 'Faculty Glyphic'` | `800 26px 'Archivo'` |
| `.streakdab span` | `400 2rem 'Faculty Glyphic'` (mobile 42px) | `800 52px 'Archivo'` |
| `.countpanel .time` | `400 1.25rem 'Faculty Glyphic'` | `700 26px 'Archivo'`, `.02em` |
| `.year` | `400 2rem 'Faculty Glyphic'` | `var(--num)` = `700 27px 'Archivo'`, `-.01em` |
| `.retcap .ttl`, `.settingshead .ttl`, `.settingspanel .ttl` | `400 2rem 'Faculty Glyphic'` | `700 16px 'Archivo'` (much smaller) |
| `.glosscard .nm` | `400 1rem/1.375 'Faculty Glyphic'` | `700 14px/1.15 'Archivo'` |
| `.setrow .name` | `400 1rem 'Faculty Glyphic'`, **lowercase** | `600 14px 'Archivo'` (no lowercase) |
| `.menulist button` | `400 1.25rem 'Faculty Glyphic'` (no caps) | `700 13px 'IBM Plex Mono'`, `.07em`, **uppercase** |
| `.lockinfo` | `400 1.25rem/1.4 'Faculty Glyphic'` | `500 12px/1.4 'Archivo'` |
| `.study .why` | `400 0.875rem/1.5 'Manrope'` | `500 18px/1.42 'Archivo'` |
| `.cue .tx` | `400 0.875rem/1.4 'Manrope'` | `13px/1.55 'IBM Plex Mono'`, `color:ink-soft` |
| `.aga` (guide answer) | `400 0.875rem/1.55 'Manrope'` | `400 13px/1.55 'Archivo'` |
| `.ginput` | `400 0.875rem 'Manrope'` | `600 15px Archivo` |

## 2c. Casing divergences (Briana favors lowercase; combo sentence/upper-case)

| Where | Briana | Combo |
|---|---|---|
| Home hero copy (index.html) | `take a gess` / `pick a difficulty.` (lowercase) | `Take a <em>gess</em>` / `Pick a difficulty.` (sentence case) |
| `.dif .nm` difficulty card names | CSS `text-transform:lowercase` | no lowercase transform |
| `.setrow .name` settings rows | CSS `text-transform:lowercase` | no lowercase transform |
| `.menulist button` | plain lowercase Faculty | `text-transform:uppercase` + `.07em` |
| Many kicker/label classes | rely on Manrope small caps at `.14em` | IBM Plex Mono uppercase, similar but different tracking |

Combo also converts several Faculty-Glyphic display labels into **uppercase mono** (`.metarow .k`, `.cue .num`→number, `.eratag`, `.narr`, `.orw`, `.seclbl`, `.srtag`) where Briana keeps them as lowercase/uppercase Faculty display text.

## 2d. Weight-only / tracking-only nits (same font role, wrong weight)

- `.accn`: both Manrope→IBM swap, weight `500` preserved.
- `.agq`: Briana `400 ... uppercase` vs combo `600 13px 'Archivo'` (no uppercase).
- `.agplus`: Briana no font set (icon) vs combo `700 16px 'Archivo'`.
- `.catpick`: Briana `400 Faculty uppercase` vs combo `600 11px IBM .06em`.
- `.kick`: Briana `600 10px Manrope` vs combo `var(--label-sm)` = `600 10px IBM`.
- `.herometa`: Briana `400 12px Faculty` vs combo `600 10px IBM .16em`.
- `.eratag`: Briana `400 0.75rem Faculty uppercase` vs combo `500 12px IBM` (no uppercase).

---

# 3. EVERYTHING ELSE — by screen / component

Combo systematically **rounds corners more** (Briana favors `1px`/`2px` sharp radii; combo uses `--r-sm 4px`/`--r-md 8px`/pill `20px`), **brightens cards to `#fff`**, and **replaces hover-shadow lifts with accent borders**. Radii and border tokens (`--r-*`, `--sp-*`) exist only in combo.

## 3a. Global chrome / header

- `.hd` border `1px var(--line)` → `1.5px var(--ink)`; bg `surface` → `surface-strong` (§1c).
- `.hdinner` / `.sheet` max-width **860px (Briana) → 1080px (combo)**; combo `.sheet` also adds left/right `1px solid var(--line)` borders + `padding-bottom:40px`.
- `.wrap`: combo adds `overflow-x:hidden` and `padding:14px 0 60px` (Briana `padding:0 0 60px`).
- `.navbits` gap same; font swap only.
- Scrollbar: Briana `5px` transparent, only tinted `html.scrolling`; combo `11px` always-on `var(--accent)` thumb on `var(--line-card)` track.
- `.helpdab`: Briana ink outline on surface, `opacity:.8` hover; combo accent outline transparent, fills accent on hover.

## 3b. Home screen

- `.hero` padding `48px 24px 20px` → `38px 24px 14px`.
- `.herobig` see §2b (Faculty 4rem/400 → Archivo 56px/800); hero copy lowercase → sentence-case (§2c).
- `.herokick` muted → accent, Faculty → IBM caps `.24em` (§1b/§2).
- `.heroglos`: Briana `400 0.875rem/1.6 'Manrope' var(--muted)`, full-width; combo `500 12px/1.7 'IBM Plex Mono' var(--faint)`, `max-width:560px`, `text-wrap:balance` — different copy structure (combo adds the ges·so dictionary block with an accent superscript `1`/`2`).
- `.difs` grid: Briana `perspective:900px` + 3D card tilt; combo flat. Padding `0 24px 24px` → `18px 24px 12px`.
- `.dif` card: Briana `text-align:center`, `border-radius:1px`, `padding:28px 18px`, `border:var(--line)`, cubic-bezier transform lift; combo `text-align:left`, `--r-md 8px`, `padding:18px`, `border:var(--line-card)`, `.12s`.
- `.dif:hover`: Briana `translateY(-4px) rotateX(3deg)` + layered shadow; combo `border-color:var(--accent);translateY(-2px)`.
- `.dif .nm/.bl/.ct`: see §1b/§2 (lowercase Faculty → Archivo/IBM, muted→accent on `.ct`).
- `.practice`: Briana just `margin:0 24px 8px`; combo wraps it in a full card (`max-width:620px;background:surface;border;--r-md;padding:18px;flex`). `.practice .pinf` combo-only accent dab.

## 3c. Daily round (play)

- `.plate`: transparent+`1px` radius (Briana) → `#fff`, `3px` radius, drop shadow (combo).
- `.canonical`: Briana bordered surface card `padding:16px`; combo `#fff`, `--r-md`, `overflow:hidden`, no padding, `margin-top:14px`, image `max-height:280px` (Briana `340px`), image bg `#efece4` (Briana `surface`).
- `.pill`: Briana `padding:12px`, `border-radius:1px`, Faculty `0.75rem` **uppercase**; combo `padding:8px 13px`, `--r-sm 4px`, IBM `500 12px` (no uppercase). `.pill.sel` text `var(--bg)`→`#fff`.
- `.opt`: Briana `background:surface`, `border-radius:2px`, Faculty uppercase; combo `#fff`, `border-radius:20px` (pill), IBM `600 12px`. `.opt:hover`/`.opt.on` combo adds accent.
- `.gchip`: Briana `surface`, `2px` radius, Faculty uppercase; combo `study-bg`, `20px` pill, IBM `600 12px`.
- Year slider `input[type=range]`: Briana `height:4px`, `background:var(--track)`, `border-radius:3px`; combo `height:22px`, `background:transparent` (no visible track rail). Thumb margin `-9px` → `-8.5px`. Briana has a separate diamond-shaped `#yr.nudge` thumb (`transform:rotate(45deg);border-radius:0`) that combo lacks.
- `.fieldlabel .nm/.ix/.hintrule`: Manrope→IBM swaps only.
- Map pins `.lookmark`: `background:var(--ink)` circle `50%` (Briana) → `background:var(--accent)` blob `60% 40% 55% 45%...` with `2px #fff` border (combo). `.palabel` font swap.
- Hint system is a **structural fork**: Briana `.hintrow*` (rows, muted/ink text) vs combo `.hintchip*` + `.hinthl/.hintlabel/.hinttext/.hintbox/.hintmeta` (accent chips). None of the combo `.hint*` selectors exist in Briana; Briana's `.hintrow`, `.hintrow-btn`, `.hintbox-body/-icon/-toggle`, `.hintrows`, `.hint-count`, `.hint-desc` don't exist in combo.
- `.dragslide`/`.dragtag`/`.minmax`: font swap only.
- `.submit-hint` / `.maptap` / `.newhere`: Briana-only accent selectors (present in Briana styles, differ in combo copy).

## 3d. Reveal / study

- `.revealgrid`: Briana `1fr 1fr`; combo `.92fr 1.08fr`.
- `.study`: Briana transparent bordered box `radius:1px`; combo `study-bg` blue panel, `--r-md`, `padding:22px`.
- `.study .why`: Manrope `400 0.875rem` → Archivo `500 18px` (much larger).
- `.studyfoot`: font swap only (Manrope→IBM); `.reportopen` accent link preserved.
- `.scrow`: Briana `padding:16px 0` only; combo full flex row with `border-bottom` + `.sq 24px` (Briana `.sq 20px`, radius `1px`→`5px`).
- `.metarow .k/.v`: Faculty/Manrope → IBM; `.k` ink→accent (§1b).
- `.cue` list: Briana bordered rows `border-bottom`, numbered circle (`.num` bordered `50%`, ink); combo tighter `padding:7px 0`, no border, accent number no circle. `.cue .tx` Manrope→IBM ink-soft.
- `.filed` stamp: Briana `right:18px`, `rotate(4deg)`; combo `left:18px`, `rotate(-4deg)` (mirrored) + Manrope→IBM.
- `.stamp` / `.perfectstamp` / `.reportchip` / `.reportthanks`: font swap only.
- `.attrib`: Briana `400 0.875rem 'Manrope'`, `margin-top:0`; combo `11px 'IBM Plex Mono'`, `margin-top:15px;padding:0 20px`.
- `.telllink`: Briana bordered ink button; combo accent text-link (§1b).

## 3e. Settings

- `.settingspanel`: near-identical (bottom-sheet). Diffs: Briana `overflow:hidden` desktop / `max-height:90dvh` mobile with `box-shadow:0 60px 0 0 var(--surface)`; combo `overflow-y:auto` + `overscroll-behavior:contain` desktop / `max-height:88dvh` and `box-shadow:0 -12px 32px` mobile.
- `.settingsveil`: opacity darker in combo + `backdrop-filter:blur(3px)` (Briana none).
- `.settingshead .ttl`: Faculty `2rem/400` → Archivo `16px/700`.
- `.settingsclose`: Briana icon button (no font); combo `700 22px 'Archivo'` (× glyph).
- `.setrow`: `padding:20px 0` → `16px 0`; border `line-card`→`line`.
- `.setrow .name` lowercase Faculty → Archivo `600` (§2c); `.setrow .hint` Manrope→IBM, `margin-top:5px`→`2px`.
- `.settingsfoot`/`.settingsbody`: font swap; body padding `24px`→`22px`.
- `.toggle[aria-pressed]` accent same. `.grp` card `surface`+`2px` → `#fff`+`11px` radius.
- `.swatch .sq`: Briana `36x20px radius:1px` → combo `36x36px --r-md`; `.swatchrow` gap `8px`→`11px`; `.swglyph` Briana empty flex → combo `800 15px 'Archivo'` white glyph.

## 3f. Leaderboard / streak / stats

- `.statile`: card radius `8px`→`--r-md`(8px same effectively); `.n` Faculty `1.25rem/400` → Archivo `26px/800`; `.l` Manrope→IBM (+ combo adds `letter-spacing:.08em`; note Briana `.l` has a typo `'Manrope'monospace` missing `;`).
- `.streakdab span` Faculty→Archivo 800 (§2b); `.streaklabel`/`.streakmeta`/`.countpanel` font swaps.
- `.weekd`, `.daycell` grids: `.daycell` radius `8px`→`--r-md`; `.dn` Faculty→Archivo; `.scorechip`/`.smallcap` Manrope→IBM.
- `.dowgrid`/`.legend`/`.matrix`/`.mbar`/`.barkey`/`.mastery`/`.msq`: font swaps + radii (`.msq` `1px`→`5px`, `36px`→`26px`; `.barkey i`/`.legend i` `2px`/`4px`→`--r-xs`/`--r-sm`).
- `.mblob`/`.agkick`/`.mastergrid`/`.statsgrid`: Briana-only or font-swapped.

## 3g. Collections / glossary / movements

- Glossary is heavily reworked. `.glosshead`: Briana transparent flex, `margin-bottom:24px`; combo `surface-strong` bar with `1.5px ink` bottom border, `padding:16px 22px`.
- `.glosswrap`: Briana `padding:32px 24px 48px;max-width:860px;margin:0 auto`; combo `padding:24px` (no max-width centering).
- `.glossgrid`: Briana `repeat(3,1fr)` no padding; combo adds `padding:16px 22px 22px`.
- `.glosscard`: Briana `surface`/`2px`/`padding:16px` with shadow-lift transitions and `min-height` unset; combo `#fff`/`--r-md`/`padding:15px`/`min-height:112px`, no shadow-lift.
- `.glosscard .nm/.sub`: Faculty/Manrope → Archivo/IBM (§2b).
- `.glosscard.locked`: `opacity:.7` → dashed border box (§1c).
- `.glossbar`: Briana `height:8px`, `margin-bottom:28px`, `radius:2px`, track `line-card`; combo `height:6px`, no margin, `radius:3px`, track `line`. `span` loses `border-radius:2px`.
- `.colcard`/`.colbar`: radius `2px`→`9px` / `2px`→`5px`; `.colbar` Faculty→IBM `700`, height `24px`→`26px`.
- `.srccard`: radius `2px`→`10px`; hover shadow-lift → accent border.
- `.eratag`/`.srtag`/`.soonchip`/`.narr`/`.orw`/`.seclbl`: font swaps + radii + casing (§2c).
- `.movehero`/`.movename`/`.moveback`/`.movesub`: Faculty→Archivo, moveback ink→accent, movehero gains layout (`display:flex;gap:20px;border-bottom`).
- `.collnote`/`.collnote .h/p`: font swap only; radius `8px`→`--r-md`.
- Map marker `.lookmark:nth-of-type(...)` color-cycle exists in both but combo split into 5 separate rules vs Briana's 1 grouped rule.
- **My Gallery / `.gal-*` (≈70 selectors) is entirely combo-only** — Briana's redesign has no `.gal-*` gallery-detail/masonry/filter/toast system. This whole screen has no Briana reference to match; it was built on the combo line and uses accent throughout (`.gal-chip.active`, `.gal-sortbtn.on`, `.gal-study-title`, `.gal-accard-count`).

## 3h. How-to modal & onboarding

- Briana has a full `.hto*` how-to modal system (`.howtomodal`, `.htobody`, `.htocontent`, `.htofoot`, `.htohead`, `.htoimg`, `.htoimg-el`, `.htopanel`, `.htopips`, `.htotext`, `.htotitle`, `.htotrack`) plus `.idmodal`, `.idprevdab`, `.faqacc/.faqitem/.faqq/.faqplus/.faqa*` FAQ accordion — **none of these exist in combo**.
- Combo instead uses a native `<details>`-based FAQ (`.faq summary`, `.faq summary::after`, `.faq[open] summary::after`) and an onboarding system (`.ob*`: `.obback`, `.obnext`, `.obbody`, `.obdab`, `.obdots`, `.obfoot`, `.obillus`) — **none of these exist in Briana**. This is a full structural fork of the help/onboarding UX.

## 3i. Guide accordion (Ask the guide)

- `.agq`: Briana `400 0.75rem 'Faculty' uppercase`; combo `600 13px 'Archivo'` (no uppercase).
- `.agnum`: Faculty→Archivo. `.agplus`: Briana icon (transition color) vs combo `700 16px 'Archivo'` `+` with `transform:rotate` on expand; `.agq[aria-expanded=true] .agplus` combo rotates 45°, Briana just recolors. Briana has icon-swap variants (`.agplus .icon-minus/.icon-plus`) combo lacks.
- `.aga`: Manrope→Archivo (§2b). `.agkick`: Manrope→IBM.

## 3j. Shapes, radii, misc

- Global radii philosophy: Briana uses literal `1px`/`2px`/`4px`/`8px` (mostly sharp); combo routes through `--r-xs 2px / --r-sm 4px / --r-md 8px / --r-lg 12px` and adds pill `20px` for chips. Result: combo is noticeably rounder.
- `.dabo` inline glyph: Briana renders an SVG dab (`.dabo svg`, `.dabo::after{display:none}`); combo renders a CSS blob (`background:var(--accent)` + `::after` highlight dot). `.dabo-lg` sizes differ (Briana 44×38 / mobile 21×20; combo 30×29).
- `.pip`/`.pips` progress dots: Briana `16×16` flex containers (SVG dabs) `gap:4px`; combo `22×5px` bars `--r-xs` with `.pip.done` accent, mobile blob variant. Structural difference.
- `.track` radius `4px`→`--r-sm`; `input[type=text]` radius `4px`→`--r-sm`, Manrope→IBM.
- Keyframes: Briana defines a spin (`0%→100% rotate(0→360)`) and an id-preview scale keyframe not in combo; combo's `from{width:0}` progress-bar keyframe not in Briana. Minor.

---

# Summary of counts

- **Palette roles differing in value:** 7 of 17 shared tokens (bg, ink, muted, line, full, partial, miss); 2 differ in **hue** (muted, line). Combo adds 5 tokens Briana lacks (silver, silver-ink, gold, gold-ink, surface-lift) plus the entire radii/spacing/font-shorthand token block.
- **Accent-blue-where-Briana-does-NOT:** **44 spots** (19 same-selector recolors of ink/muted elements + 25 combo-only accent surfaces).
- **Font substitution:** wholesale, ~130 rules — Faculty Glyphic→Archivo (64 refs), Manrope→IBM Plex Mono (66 refs); `body` and Google Fonts link both swapped.
- **Per-selector declaration diffs (common selectors):** 185.
- **Selectors only in Briana (combo missing):** 153 (esp. `.hto*` how-to modal, `.faq*` accordion, `.hintrow*` hint rows, `.idmodal`, dab SVGs).
- **Selectors only in combo (Briana never designed):** 223 (esp. `.gal-*` My-Gallery ≈70, `.ob*` onboarding, `.hintchip*` hints, `.faq summary` native details).

# Biggest themes (fix in this order for max visual impact)

1. **Two-font swap** — Faculty Glyphic + Manrope + `rem`/weight-400 editorial sizing is Briana's whole identity; combo runs Archivo + IBM Plex Mono + heavy `px` weights. Highest-impact single change.
2. **Accent-blue over-use (44 spots)** — Briana keeps chrome neutral ink and reserves blue for real actions; combo paints wordmark, nav, gear, help, back-links, meta keys, map pins, scrollbar, hint chips blue.
3. **Lowercase vs sentence-case** — hero copy, difficulty names, settings-row names are lowercase in Briana; combo capitalizes.
4. **Card treatment** — Briana `surface` bg + sharp `1px/2px` radii + shadow-lift hovers; combo `#fff` bg + `8px+` radii + accent-border hovers.
5. **Structural forks** — How-to modal + FAQ accordion (Briana `.hto*`/`.faq*` vs combo `.ob*`/native `<details>`), hint UI (`.hintrow*` vs `.hintchip*`), and the entire My-Gallery screen (`.gal-*`, no Briana reference). These need a design decision with Briana, not just token tweaks.
6. **Palette values** — bg/ink/muted/line/full/partial/miss all off; muted and line even shift hue (Briana neutral, combo warm).
