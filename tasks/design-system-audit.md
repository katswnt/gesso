# Gesso — Design-System / Visual Consolidation Audit (READ-ONLY)

Scope: VISUAL/CSS/UI consolidation in `index.html` (whole-app, ~2223 lines, inline-HTML
template strings) against the token set in `styles.css` (`:root`, lines 2–6). Data/logic
duplication is out of scope (covered separately in `tasks/hardcoded-data-audit.md`). The
per-movement palette hexes (`MOVEMENTS` table, lines 367–557) and the `SWATCHES` avatar
palette (line 986) are intentional DATA and are explicitly OUT OF SCOPE.

Headline: the codebase is already strongly tokenized — **227 `var(--…)` references** in
`index.html` and a rich, near-complete `:root`. The chrome-hex problem is **small and
contained** (27 distinct non-data hex literals, most appearing once). The bigger wins are
**idiom/class consolidation** (modal/veil scaffold ×6, dab-avatar shape literal, chip/card
surfaces) and **glyph→icon migration** (emoji + HTML entities used as UI), plus a
**drift-guard** so neither regresses.

---

## 1. Hardcoded-color inventory (chrome only; DATA excluded)

Method: parsed every `#rrggbb` in `index.html` excluding the DATA regions (MOVEMENTS
367–557, SWATCHES 986, and `palette:[…]`/`GLOSSARY_EMBLEM`/`LOCKED_PALETTE`/`DABS` arrays).
Result: **27 distinct non-data hexes**. Only **6** of them sit literally inside a
`style="…"` attribute; the rest live in JS color maps / Leaflet marker options / SVG
fill-stroke strings / canvas rendering.

### 1a. Chrome hexes that MAP CLEANLY to an existing token → safe mechanical swaps

| Hex | → Token | Occurrences | Lines | Notes |
|-----|---------|-------------|-------|-------|
| `#2230b8` | `--accent` | 6 | 1389, 1670, 1832, 1933, 1934 | Leaflet markers (1670/1933/1934 are JS opts, not CSS vars — still safe to swap to the literal token value or a shared const) |
| `#2f8f5b` | `--full` | 7 | 797, 1389, 1832, 1899, 1930, 1939 | region color map + Leaflet + chart |
| `#cf9f3a` | `--partial` | 3 | 797, 1389, 1832 | |
| `#c14b3a` | `--miss` | 2 | 797, 1389 | |
| `#b3892f` | `--gold` | 1 | 1832 | |
| `#9a7b2e` | `--gold-ink` | 1 | 1053 | |
| `#6c7177` | `--silver-ink` | 2 | 1053 | |
| `#1b1916` | `--ink` | 1 | 1980 | `pixelizeIcon`: replaces `currentColor`→`#1b1916` for canvas; could use a JS const `INK='#1b1916'` |
| `#8a8472` | `--muted` | 1 | 1389 | |
| `#eceffb` | `--study-bg` | 2 | 1070, 1529 | both inside `style=`/gradient |
| `#a13526` | `--miss` (STALE FALLBACK) | 6 | 1237, 1244, 1310, 1325 | **All written as `var(--miss,#a13526)`** — the fallback is stale (real `--miss` is `#c14b3a`). Normalize the fallback to `#c14b3a`, or drop the fallback (token always defined). |
| `#7480d4`, `#3f4cbe`, `#aeb6e3`, `#232c84` | SWATCHES members | 797, 2054 | These are reuses of *data* palette values for `REGCOL`/`TIERDOT` maps — see 1c |

`#fff` (×5, lines 801, 993, 1031, 1228, 1242) is used as on-accent foreground. There is no
`--on-accent`/`--white` token. CSS classes already hardcode `color:#fff` throughout
styles.css (btn, pill.sel, etc.), so `#fff` inline is consistent with existing convention —
**leave as-is** (or introduce `--on-accent:#fff` as a future nicety; not required).

### 1b. GENUINE CHOICES for Kat (chrome hex with NO matching token — do not invent)

These are real UI colors with no `:root` equivalent. I am NOT proposing values; Kat must
decide whether to (a) add a token, (b) snap to an existing token, or (c) keep as intentional.

1. **`#6a645b`** (lines 1520, 1524) — stroke/fill of the `catIcon` line-icons in the
   practice-recap. Close to but not equal to `--ink-soft #3a362d` or `--muted #8a8472`.
   GENUINE CHOICE: which token should category line-icons use? (recommend `--muted`, but
   it's a visible color decision.)
2. **`#d3ccbb`** (line 2082) — empty/locked tier-dot background in the archive day cells.
   Near `--line-card #ddd8ca` / `--track #dcd6c6` but distinct. GENUINE CHOICE: snap to
   `--track`, or add a `--dot-empty` token?
3. **`#6a645b`/`#6f6a5b` family** — note `--ink-soft` is `#3a362d` while several muted
   browns (`#6a645b`, `#6f6a5b` in styles.css `.hinttext`) drift between. Not strictly
   in-scope hex-in-HTML, but flagging the **mid-brown gap** in the token scale as a
   GENUINE CHOICE: is a `--ink-mid` (~`#6a645b`) warranted?

**GENUINE CHOICES needing Kat's input: 3.**

### 1c. Borderline — DATA-LIKE chrome maps (recommend LEAVE, document)

These are small color LOOKUP maps. They reuse accent/full/partial/miss/SWATCHES values but
function as *data* (region→color, tier→color), so the data-audit may also touch them. From a
pure-visual standpoint they should reference tokens, but converting JS string maps to
`getComputedStyle(--token)` is heavier than it's worth and risks Leaflet/canvas breakage.
**Recommendation: replace the literals that equal a token with that token's *value via a
shared JS const* (e.g. `const C={accent:'#2230b8',full:'#2f8f5b',…}` sourced once), NOT
ad-hoc.** Sites:
- `REGCOL` (line 797) — region→color for collections map.
- `colors` (line 1389) — region→color for mastery chart.
- `cols` (line 1832) — `[accent, full, partial, gold]` bar palette.
- `TIERDOT` (line 2054) — tier→color (all 4 are SWATCHES members → DATA; leave).
- `METAL` (line 1053) — gold/silver/bronze podium gradient array; `#9a7b2e`/`#6c7177`
  overlap tokens but the rest are a bespoke metallic ramp → treat as DATA, leave.

---

## 2. Repeated UI idioms → proposed canonical classes

| Idiom | Current state | Count | Proposal |
|-------|---------------|-------|----------|
| **Kicker** (`.kick`) | **Already a class** in styles.css L33; verified used as `class="kick"`. No inline duplication of its rule found. | ~37 class uses | ✅ No action — already consolidated. |
| **Secondary button** (`.btn2`) | **Already a class** (styles.css L70). | ~23 uses | ✅ No action. |
| **Modal/veil scaffold** | `document.createElement('div'); .className='settingsveil'; .innerHTML=…` repeated near-verbatim at **L125, L163, L996, L1128, L1322, L1367** (6 copies), each re-implementing veil create + `close()` + `onEsc`/`escClose` Esc handler (L134, L178, L1009, L1155, L1372, L1702 — 6 Esc handlers). | 6 | **JS helper** `openModal({label, body, onClose})` (see §4). CSS is fine (`.settingsveil`/`.settingspanel`/`.settingshead`/`.settingsclose` already exist). |
| **Modal header** | `<div class="settingshead"><span class="ttl">…</span><button …>&times;</button></div>` repeated in each veil (L126, L165, L999, L1131…). | ~6 | Fold into the `openModal` helper's chrome; pass `title`. |
| **Dab-avatar shape literal** `border-radius:50% 50% 50% 12%` | Appears in the `dabAvatar` helper (L993, the `i==null` branch) AND inline in the swatch-button render (L997). | 2 | Add `.blob-id{border-radius:50% 50% 50% 12%}` (a sibling to the existing `.blob` class at styles.css L454) and use it in both; OR have the swatch render call a shared shape const. (Note: the *organic* blob `63% 37% 56% 44% / 55% 48% 52% 45%` is already the `.blob` class + the `.dabo`/dab family — well consolidated.) |
| **Card surface** (surface + 1px `--line-card` + radius) | Mostly already classed (`.practice`, `.dif`, `.glosscard`, `.srccard`, `.colcard`, `.statile`, `.retcard`, `.countpanel`). Inline `border:1px solid var(--line-card);border-radius…` still appears **12×** in template strings. | 12 | Introduce a single utility `.card-surface{background:var(--surface);border:1px solid var(--line-card);border-radius:8px}` and adopt at the 12 inline sites (verify each radius — some use 9/10/12). |
| **Stat tiles** | `.statile` (L306) and `.statgrid > div` (L322) already exist; `.pmcard` (L326). | — | ✅ Adequately classed. |
| **Chips** | `.pill`, `.hintchip`, `.reportchip`, `.pchip`, `.tchip`, `.soonchip` — many chip variants, all already classes. | — | ✅ Classed. Optional future: a shared `.chip` base they extend — low priority, cosmetic. |

Net: the **only structural duplication worth a CSS class is `.card-surface` (12 sites)** and
**`.blob-id` (2 sites)**; the rest of the idiom win is the **JS modal helper**, not CSS.

---

## 3. Icons / glyphs used as UI

The app already has an `ICONS` SVG map (L608: `when/where/style/medium/artist`), a
`SETTINGS_ICON` (L918), and a `catIcon` SVG builder (L1520) — so the SVG-icon pattern is
established. The handoff (`tasks/20_account_prompts/`) mandates **custom line icons, no
emoji**. Remaining raw glyphs used as UI:

| Glyph | Form | Count | Locations | Handoff icon |
|-------|------|-------|-----------|--------------|
| `◎` | literal | 1 | L1422 (`.pinf` practice badge) | (loupe/target — see eye family) |
| `∞` / `&infin;` | entity | 2 | L1417 (`.pinf`), L1631 (hint meta) | "infinite" — keep as wordmark or custom glyph; not in named set |
| `★` / `&starf;` | mixed | 1 + 3 | L1577 (share text), L1543 (silver badge), L1873 | star/badge |
| `&#10022;` (✦) | entity | 3 | L1544 (gold badge), L1563, L1873 | masterpiece star |
| `&#9819;` (♛ crown) | entity | 1 | L1057 (podium #1) | crown |
| `👁` | emoji | 1 (in a comment) | L147 (comment only — already retired per the comment) | **eye** (mastery) |
| `&times;` (×) | entity | 6 | L126, L165, L999, L1131, +modal closes | **× close** |
| `&check;` / `✓` | entity/literal | 2 + 15 | L1878, swatch glyphs (L1813), `.hintchip.used::before` (CSS L107) | check |
| `✕` | literal | 4 | swatchGlyph (L1813), colorblind | miss mark |
| `◐` | literal | 2 | swatchGlyph (L1813) | partial mark |
| `&#8599;` (↗) | entity | 3 | L803, L1563, L1888 ("Visit ↗" external links) | external-link arrow |
| `→` / `&rarr;` | literal/entity | 38 + 13 | pervasive (copy, "next", wlink arrows) | arrow — mostly TYPOGRAPHIC, leave |

### Proposed `ICONS` extension (single map, string→inline-SVG)

Extend the existing `ICONS` object (L608) with the handoff's named line-icons rather than a
parallel map:

```
ICONS.flame    = `<svg …><path d="M12 3c3.4 3.2 5.2 5.4 5.2 8.4a5.2 5.2 0 11-10.4 0c0-1.4.5-2.6 1.3-3.6.2 1.3.9 2 1.9 2.3C9.4 9 10.3 6.2 12 3z"/></svg>`   // F3 Chunky
ICONS.pennant  = `<svg …><path d="M6 3v18"/><path d="M6 4h11l-3 3.6L17 11H6z"/></svg>`     // B5 glossary mark
ICONS.eye      = `<svg …>…</svg>`   // mastery (replaces ◎ / retired 👁)
ICONS.sync     = `<svg …>…</svg>`   // archive/devices (replaces any ↻ intent)
ICONS.close    = `<svg …><path d="M6 6l12 12M18 6L6 18"/></svg>`  // replaces &times; in modal heads
ICONS.external = `<svg …>…</svg>`   // replaces &#8599; on Visit links
ICONS.star     = `<svg …>…</svg>`   // replaces ★/&starf;/&#10022; badges
ICONS.crown    = `<svg …>…</svg>`   // replaces &#9819; podium
```
(Exact paths for eye/sync/star/crown/external live in `tasks/20_account_prompts/Gesso Icon
Variants.dc.html`.) `iconHTML(c)` (L615) already wraps in `.cicon`; add a `.gicon` variant
(exists, L37) for header-sized.

**Replacement sites (priority order):** modal `×`→`close` (6 sites; ties into §4 helper) →
podium `♛`→`crown` (L1057) → badges `★`/`✦`→`star` (L1543/1544/1873) → Visit `↗`→`external`
(L803/1563/1888) → practice `◎`/`∞`→`eye`/keep. Leave the typographic `→`/`—`/`·`/curly
quotes as-is (prose punctuation, not UI chrome). The `✓ ◐ ✕` swatch glyphs (colorblind
mode, L1813) are intentional accessibility text — leave, or map to tiny SVGs only if Kat
wants pixel parity.

---

## 4. JS UI helpers (consolidate near-duplicate DOM generation)

1. **`openModal({title, body, label, onClose, bottomSheet})` → returns `{veil, close}`.**
   Collapses the 6 veil scaffolds (L125, L163, L996, L1128, L1322, L1367) and their 6 Esc
   handlers into one. Builds `.settingsveil > .settingspanel > (.settingshead with .ttl +
   close button using ICONS.close) + body`, wires Esc + backdrop-click + focus, returns
   `close()`. Each caller shrinks to `openModal({title:'Settings', body: settingsBodyHTML()})`.
2. **`dabAvatar` (L993)** — already the canonical avatar helper; just route the swatch-button
   render (L997) through a shared `.blob-id` class so the `50% 50% 50% 12%` literal exists once.
3. **`iconHTML`/`ICONS`** — already the canonical icon helper; new icons go in the map (§3),
   no second mechanism.
4. **Region/chart color maps (`REGCOL` L797, `colors` L1389, `cols` L1832)** — define one
   shared `const PALETTE = {accent:'#2230b8', full:'#2f8f5b', partial:'#cf9f3a', miss:'#c14b3a',
   gold:'#b3892f', muted:'#8a8472'}` and build the maps from it, so token values aren't
   re-typed per map (single source of truth for JS-side chrome).

---

## 5. Drift-guard — `scripts/check-design.mjs` (fail-closed, like check-pool.mjs)

Mirror the existing gate style (no network, exits 1 on HARD). Wire into `npm test` (after
`check-pool.mjs`) and it's automatically covered by the existing `.githooks/pre-commit`.

Rules (sketch):
```
HARD (exit 1):
  R1 chrome-hex: any #rrggbb in index.html INSIDE a style="…" attr OR in a
     known-chrome context, that equals a token VALUE (allowlist map hex→token) →
     "use var(--token)". Skip DATA regions: lines within MOVEMENTS{…} / MOV_FAMILY,
     the SWATCHES= line, and any line matching /palette:\[|GLOSSARY_EMBLEM|LOCKED_PALETTE|DABS=/.
  R2 stale-fallback: any `var(--miss,#a13526)` (or any var(--X,#hex) where #hex !=
     the real :root value parsed from styles.css) → "fix/Remove stale fallback".
  R3 raw-emoji: any non-ASCII pictographic glyph (\u{1F000}-\u{1FAFF}, ☀-➿,
     plus the curated UI set ◎ ∞ ★ ☆ ◐ ✕ ✓ ↻ ⟳ 👁) used as UI → "use ICONS map".
     Allow inside JS comments and inside the colorblind swatchGlyph() line (allowlist
     line) so accessibility marks aren't blocked.
WARN (report, exit 0):
  W1 entity-glyph: &starf; &infin; &#10022; &#9819; &#8599; &times; used as UI → suggest ICONS.
  W2 new chrome-hex with NO token match (not in MOVEMENTS/SWATCHES) → "GENUINE CHOICE: add a token?"
Implementation: read styles.css :root, build hex→token + token→hex maps; read index.html;
  iterate lines with offsets so DATA regions are skipped by line range / regex; print grouped
  report exactly like check-pool.mjs; process.exit(hard?1:0).
```
Note: the repo's `tests/` currently has **no stubbed-DOM load harness** (only
`scoring/medium/static-module` tests) despite MEMORY.md referencing one — the analogous
"prove it loads" step here is `node --check`-equivalent + this static gate. If a DOM harness
is desired, that's a separate task.

---

## 6. Consolidation plan (ordered, small verifiable batches)

Each batch is independently shippable; after each run `npm test` (which exercises
check-pool + the new check-design once added) and visually spot-check the affected screens.

- **Batch 0 — guardrail first.** Add `scripts/check-design.mjs` (WARN-only for new hexes,
  HARD for the stale-fallback + style-attr token hexes). Wire into `npm test`. This makes
  every later batch self-verifying and prevents regressions while you work. *Δ inline: 0.*
- **Batch 1 — stale fallback normalize (R2).** Replace the 6 `var(--miss,#a13526)` with
  `var(--miss)` (token is always defined) or `var(--miss,#c14b3a)`. Lines 1237, 1244, 1310,
  1325. Lowest-risk, highest-correctness. *Δ inline hex: −6 stale.*
- **Batch 2 — style-attr chrome→token.** Swap the in-`style=` hexes that map to tokens:
  `#eceffb`→`var(--study-bg)` (L1070, 1529 gradient). *Δ: −2.*
- **Batch 3 — JS PALETTE single-source.** Add `const PALETTE` and rebuild `REGCOL`/`colors`/
  `cols`/Leaflet literals (797, 1389, 1670, 1832, 1899, 1930, 1933, 1934, 1939) from it.
  Reduces re-typed token values from ~20 occurrences to one definition. *Δ literal hexes: ~−14.*
- **Batch 4 — `.blob-id` class.** Add `.blob-id{border-radius:50% 50% 50% 12%}`; use in
  dabAvatar (L993) + swatch render (L997). *Δ inline shape literals: −2 → 1 class.*
- **Batch 5 — `.card-surface` utility.** Add the class; adopt at the 12 inline
  `border:1px solid var(--line-card);border-radius…` sites (verify radius per site). *Δ inline
  declarations: ~−24 (border+radius pairs) → 1 class + 12 class refs.*
- **Batch 6 — `openModal()` helper.** Refactor the 6 veil scaffolds + 6 Esc handlers into one
  helper; modal heads use `ICONS.close`. Biggest behavioral surface → ship alone, test each
  modal (settings, how-to, register, signin, account, glossary). *Δ duplicated scaffold/handler
  blocks: ~−6 copies; ~−60–100 lines.*
- **Batch 7 — icon migration.** Extend `ICONS` with flame/pennant/eye/sync/close/external/
  star/crown (paths from handoff). Replace glyph sites: × (done in B6), ♛, ★/✦, ↗, ◎. Flip
  check-design R3/W1 from WARN→HARD once clean. *Δ raw glyphs: ~−15 UI glyphs → ICONS calls.*

### Estimated inline-style reduction
`index.html` has **388 `style="…"` attributes** and 227 `var(--)` uses today. The
consolidation removes/condenses roughly: stale fallbacks −6, study-bg −2, JS literal
de-dup ~−14, blob −2, card-surface ~12 sites collapsed, modal scaffolds ~6 collapsed,
glyphs ~15 → icons. **Net `style="…"` attribute count: ~388 → ~360–365** (the card-surface
and modal batches remove the most attributes; most chrome-hex work is value-level inside
existing attrs so it lowers *literal* count more than *attribute* count). The headline
correctness win is **0 stale fallbacks, 0 token-value hexes in style attrs, 0 raw UI emoji,
all gated.**

---

## Appendix — verified facts
- `:root` tokens: `styles.css` L2–6 (matches the brief's list).
- `.kick` is a real class (L33); `.btn2` real (L70); `.blob` real (L454). No inline rule dup.
- `ICONS` map L608; `iconHTML` L615; `SETTINGS_ICON` L918; `catIcon` SVG builder L1520.
- `dabAvatar` L993; SWATCHES (DATA) L986; MOVEMENTS (DATA palettes) L367–557.
- 6 veil scaffolds: L125, L163, L996, L1128, L1322, L1367.
- `npm test` runs check-pool + 3 unit tests; `.githooks/pre-commit` runs `npm test`.
- No stubbed-DOM load harness present in `tests/` (only scoring/medium/static-module).
