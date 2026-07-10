# Briana Redesign — Reconciliation Report

**Branch:** `origin/briana-redesign`  
**Date of report:** 2026-07-10  
**Prepared for:** Manual re-apply to `main` (NOT a raw git merge)

---

## 1. Exact Branch Name

```
origin/briana-redesign
```

Latest commit: `379def4 — Redesign: editorial UI overhaul (typography, color, layout, interactions)`

The branch has **9 commits** on top of a shared early history and is **not rebased** against main. There is no clean merge base — the two branches diverged early and main has since grown to 3362 lines of index.html while Briana's sits at 1306. A raw `git merge` would produce hundreds of conflicts across every file.

---

## 2. `git diff --stat` (briana-redesign vs main)

```
198 files changed, 1833 insertions(+), 40318 deletions(-)
```

The headline number is misleading: the bulk of the deletions are files that exist on main but not on Briana's earlier branch (API files, tests, scripts, task docs, data files). The genuine design work is in two files:

| File | Briana lines | Main lines | Net |
|------|-------------|------------|-----|
| `index.html` | 1306 | 3362 | Briana is ~2000 lines shorter — she worked on a pre-accounts codebase |
| `styles.css` | 452 | 705 | Briana is ~250 lines shorter — her CSS predates several later features |

---

## 3. What Briana Changed — File by File

### `styles.css` — Full Visual Overhaul

**Design token layer (`:root`)**
- Replaced all `oklch(…)` color values with plain hex codes (e.g. `--ink: oklch(0.2809…)` → `--ink: #1b1916`), making the values legible and copy-pasteable.
- Changed score colors: `--full`, `--partial`, `--miss` now use plain hex (`#2f8f5b`, `#cf9f3a`, `#c14b3a`) instead of oklch.
- Added new semantic tokens: `--silver`, `--gold`, `--silver-ink`, `--gold-ink` (for leaderboard podium metals).
- Added a **radius scale**: `--r-xs:2px`, `--r-sm:4px`, `--r-md:8px`, `--r-lg:12px`.
- Added a **spacing step**: `--sp-1` through `--sp-6` (4 / 8 / 12 / 16 / 20 / 24 px).
- Added a **type scale**: `--label`, `--label-sm`, `--display`, `--num` shorthands.
- Added `--surface-lift: #fdfcf9` for secondary card backgrounds.

**Typography — font family swap (the biggest change)**
- Body font: `Faculty Glyphic` → `Archivo`
- Monospace: `Manrope` → `IBM Plex Mono`
- Added type utility classes: `.t-label`, `.t-label-sm`, `.t-display`, `.t-num`
- The Google Fonts `<link>` in `index.html` changed accordingly.

**Header**
- Border: `1px solid var(--line)` → `1.5px solid var(--ink)` (bolder, black-ish)
- Background: `var(--surface)` → `var(--surface-strong)` (slightly darker cream)
- `.wordmark` color: `var(--ink)` → `var(--accent)` (blue)
- Max-width of `.hdinner`/`.sheet`: 860px → 1080px

**Progress pips**
- Changed from coin-image pips with a spin animation (`<img>` 16×16) to simple **rectangular bar segments** (22×5px, border-radius 2px, filled with accent/ink color).
- The 5 coin asset images (`coin.*.png`) in `assets/` are from Briana's branch but are no longer used in her final implementation.

**Lookmark blob variety**
- Added 5 `nth-of-type` rules to vary the `border-radius` of look-closer hotspot markers so they look hand-dabbed rather than stamped.

**Other CSS changes**
- `.sheet` gained `border-left/right: 1px solid var(--line)` and `padding-bottom:40px`
- `.ac-list` (autocomplete) retained `z-index:1000` — unchanged
- Many font references updated from `Manrope` → `IBM Plex Mono`

### `index.html` — How-to Modal + Nav Restructure

**How-to modal (`openHowTo`) — the real work**

Briana's version is a complete rewrite of the onboarding modal, replacing the icon-based `openModal()` wrapper with a custom full-screen overlay (`settingsveil`) featuring:

| Aspect | Briana's version | Current main |
|--------|-----------------|--------------|
| Container | Custom `<div class="howtomodal">` built directly | Uses `openModal()` wrapper |
| Imagery | **Full-size photos** loaded from `/assets/*.png` (5 images, ~14-22 MB each) per step | SVG icon in a coloured circle (`.obdab`) |
| Layout | Image top, text below; horizontal slide animation between steps | Icon left, text right; no animation |
| Step copy | Same 5 steps, same titles and body text | Identical |
| Navigation | `navbtn` / `navbtn--filled` styled buttons; "Skip" / "Back" / "Next" | Unstyled `.obskip`, `.obback`, `.obnext` |
| Animations | `transform:translateX` slide with `cubic-bezier(.22,1,.36,1)` | None |
| Pip indicators | Uses `pipsHTML()` utility | Dot spans with `.on` class |
| Scroll lock | `document.body.style.overflow='hidden'` | Not set |
| Keyboard | `keyNav` listener with Escape / Arrow keys | Arrow keys via `onKey` hook |

The new image assets required (`/assets/`):
- `guess what you can.png` (~18 MB)
- `when was it made.png` (~23 MB)
- `where in the world.png` (~20 MB)
- `pick what fits.png` (~15 MB)
- `lock in and learn.png` (~15 MB)

These images are NOT on main — they only exist on `briana-redesign`.

**Header nav restructure**
- Removed: `leaderboard`, `training`, `account` (avatar), `?` (how-to circle button)
- Added: `how to play` as a filled primary nav button (`navbtn navbtn--filled`)
- Removed: `archive`, `stats` from nav (Briana's version had these, main moved them elsewhere)
- This reflects the state before accounts/leaderboard features were built.

**Homepage (`renderStart`)**
- Added decorative image rows between sections (`/assets/MET picture frame.png`, `/assets/silver pin.png`, `/assets/dagger.png`)
- Uses the word `gess` in the wordmark with an embedded SVG palette icon (`.dabo`)
- Attribution line credits both Kat Swint and **Briana Das** with links

**CSS classes added to `styles.css` (used in HTML)**
- `.howtomodal`, `.htohead`, `.htocontent`, `.htotrack`, `.htopanel`, `.htoimg`, `.htobody`, `.htotitle`, `.htotext`, `.htopips`, `.htofoot`
- `.navbtn`, `.navbtn--filled` (button styles used throughout the modal and nav)
- `.obbody`, `.obnav`, `.obfoot`, `.obskip`, `.obback`, `.obnext` — retained as class names but with new styling
- `.heroimg`, `.hero`, `.herokick`, `.herobig`, `.heroglos` (new home-page hero section)
- `.dabo`, `.dabo-lg`, `.dabo-float` (floating palette SVG decorations)

---

## 4. What Briana Did NOT Touch

The following are entirely safe/unaffected by her branch and exist only on `main`:

- **Accounts & auth system** — Supabase integration, `syncAccount()`, `refreshAuth()`, `onAuthApplied()`, `openLogin()`, `renderAccount()`, `openIdentityModal()`, `dabAvatar()`, identity/color/streak persistence
- **Leaderboard** — `renderLeaderboard()`, `lbTier`, all `/api/leaderboard` calls, podium HTML, `mastersBandHTML()`, `coldBadge()`, `lbRowHTML()`
- **Training mode** — `renderTraining()`, `startTraining()`, `trainPlaceFit()`, `trainMediaFams()`, `TRAIN_SPAN`
- **Gallery & collections detail** — `renderGallery()`, `renderGalleryDetail()`, `renderCollections()` (her branch has an earlier version)
- **Scoring logic** — `timeScore()`, `placeScore()`, `score()`, `geoElim()` — entirely unmodified
- **Distractor generation** — `mediumChoices()`, `fill3()`, `pickN()` — unchanged
- **API endpoints** (`api/`) — all 11 serverless functions; none exist on her branch
- **Data pipeline scripts** — `check-pool.mjs`, `audit-*.mjs`, most `scripts/` files
- **Test suite** — `tests/scoring.test.mjs`, `tests/medium.test.mjs`, `tests/static-module.test.mjs`, `tests/dom-harness.mjs` — none exist on her branch
- **CI config** — `.github/workflows/check.yml` and `supabase-keepalive.yml` — not on her branch
- **Infinite mode summary** — `renderInfiniteSummary()` — predates her branch in a different form
- **Streak, stats, archive** — `renderStreak()`, `renderStats()`, `renderArchive()` — her branch has earlier stubs; main's are richer

---

## 5. Recommended Reconciliation Plan

> **Key maintainer context:** This is a manual re-apply, NOT a git merge. Main has diverged significantly. The CSS is the easy part; the how-to modal is the real work.

### Phase A — CSS token + font swap (low risk, high impact, ~30 min)

Apply Briana's design system changes to `styles.css` on main:

1. Update `:root` color tokens to her hex values (plain hex over oklch — safe, same visual).
2. Change `--bg`, `--ink`, `--muted`, `--full`, `--partial`, `--miss` to her values.
3. Add her new tokens: `--silver`, `--gold`, `--silver-ink`, `--gold-ink`, `--surface-lift`, radius scale (`--r-*`), spacing scale (`--sp-*`), type scale (`--label`, `--display`, `--num`).
4. Add `.t-label`, `.t-label-sm`, `.t-display`, `.t-num` utility classes.
5. Change the Google Fonts `<link>` from `Faculty Glyphic + Manrope` to `Archivo + IBM Plex Mono`.
6. Update every `font-family:'Faculty Glyphic'` → `'Archivo'` and `'Manrope'` → `'IBM Plex Mono'` in styles.css and inline styles in index.html.
7. Update header: `border-bottom: 1.5px solid var(--ink)`, `background: var(--surface-strong)`, wordmark color to `var(--accent)`.
8. Update `.sheet` max-width from 860px → 1080px (verify this doesn't break the play grid at narrow widths).
9. Replace coin-image pips with bar pips (safe — the pip HTML already uses `.done`/`.cur` classes in main).
10. Add lookmark `nth-of-type` blob-variety rules.

**Conflicts/stale areas:** Main's styles.css is 250 lines longer. The additions (leaderboard styles, account modal styles, masters band, training, gallery) have no counterpart in Briana's CSS and are safe to keep as-is.

### Phase B — How-to modal (medium risk, ~1–2 hours)

This is the careful part. The current `openHowTo()` in main uses the `openModal()` wrapper; Briana's builds a custom overlay. Steps:

1. Add the 5 how-to image assets from `briana-redesign` to main's `assets/` directory (large files, ~90 MB total — consider whether to commit them to git or host them on a CDN/Vercel blob).
2. Add `HOWTO_IMAGES` map in `openHowTo()`.
3. Replace the `openModal()` call with Briana's custom `settingsveil` approach. Key structural change: the modal wraps its own veil rather than delegating to `openModal()`.
4. Port the slide-animation `go()` function (the `translateX` approach is in `briana-redesign:index.html` lines ~148–158).
5. Replace icon rendering (`obdab` + `howtoIcon()`) with `<img class="htoimg-el">`.
6. Update CSS: add `.howtomodal`, `.htohead`, `.htocontent`, `.htotrack`, `.htopanel`, `.htoimg`, `.htobody`, `.htotitle`, `.htotext`, `.htopips`, `.htofoot` from her `styles.css` (they don't exist in main).
7. Update `.obbody`, `.obfoot` etc. styles to match her design.
8. Update `navbtn`/`navbtn--filled` button styles (her nav uses these in the modal footer too).
9. **Watch for:** `openHowTo()` is called from Settings (via `data-replaytut`), from the `?` button (now gone in her nav but kept in main as `.helpdab`), and on first visit. All three call sites stay the same.
10. Run `npm test` after this change — `dom-harness.mjs` exercises modal open/close.

### Phase C — Homepage hero (low risk, ~30 min)

Optionally adopt her home-page hero section (decorative images between sections). Less critical. The asset files (`MET picture frame.png`, `silver pin.png`, `dagger.png`) are needed. The hero copy and the attribution crediting Briana are worth keeping.

### Phase D — Nav restructure (medium risk — functional impact)

Briana's nav omits leaderboard, training, and account (because they didn't exist on her branch). Main's nav has all of these and they are load-bearing. Do NOT copy her nav structure wholesale. Instead, apply only the styling changes:
- `.navbtn` and `.navbtn--filled` styles from her CSS
- The "how to play" button style treatment can be applied without removing leaderboard/training/account

### Things to skip / not apply

- Her API files — she has none; main's are complete and should be kept.
- Her `data/fame.json` — main's is current and hers is a stub.
- Her scripts — main's are more complete.
- Her test suite removal — main has tests; keep them.

### Potential merge conflicts (areas of overlap)

| Area | Risk | Notes |
|------|------|-------|
| Font references in inline styles | Medium | ~40 inline `'Faculty Glyphic'` / `'Manrope'` occurrences in index.html |
| `.ac-list` z-index | None | Main already bumped to 2000 in this PR |
| `lbTier` default | None | Main already fixed to 'easy' in this PR |
| Pip HTML (`pipsHTML()`) | Medium | Main generates `<img>` pip elements; Briana's CSS expects `<div>` bar pips — need to update `pipsHTML()` function in index.html too |
| `openModal()` API | Low | Briana's how-to doesn't use it; the function can stay for settings/identity modals |
