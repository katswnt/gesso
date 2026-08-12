# combo ← main: logic/feature reconciliation inventory

**Goal (Kat, 2026-08-12):** bring **all of prod's (main) logic and features** onto combo, so flipping combo→prod is a simple switch. **Design stays Kat's call, piece by piece** — this list touches behavior/logic/copy only, never Brianna's visual system (fonts, palette, layout, CSS, assets).

## How this was derived (so nothing is missed)
- combo forked from main at **`ce9b450`** (2026-08-03). Since then main's `index.html` changed via **exactly 17 commits** — so that set is the *complete* universe of prod logic combo could be missing. Nothing else on main's index.html moved.
- **All `data/*.js` are already byte-identical** between main and combo (pool, fame, teach-works/guides, hotspots, regions, daily-order, countries, museums). So every data/notes/guide/scoring-table change is already on combo. The only logic-bearing file that diverges is **`index.html`**. `styles.css` + `assets/` are pure design (Kat's call, excluded).
- Each of the 17 was checked against combo by signature-string grep on the extracted script bodies.

## ALREADY on combo (ported earlier via explicit "sync/port from main" commits) — no action
| Prod change | Ported to combo as |
|---|---|
| Map search center/clamp/fitBounds (f23961a, 91ae0c6, 529aa44) | eb9f5f7 / e7b916f / f3a0291 ✓ |
| Map `keyboard:false` first-click nudge (fbcba85) | 5976e9e ✓ |
| Where-scoring: right country/region = full credit (f4a8595) | 539afd9 ✓ |
| Where-scoring: decay outside area, kill flat 360km disc (b0cf9e4) | cb9241e ✓ |
| Historical super-regions credit whole culture (9e2b8f7) | 4cfa37e ✓ (cross-ported) |
| Normalize 74 verbose cultures + style-verbose gate guard (1b4e6b0) | 0dbc064 ✓ |
| Tier B style curation (d935b0b) | data — already synced ✓ |
| Harmful-title plain-language labels (d51b010) | on combo ✓ |
| `track()` / gtag instrumentation | equal on both (13 calls each) — not a gap ✓ |

## MISSING on combo — needs porting (logic/copy only)

### 1. Shareable per-work reveal page (`?w=<id>`) + Share buttons — commit `4d214a9`
- **What:** `renderWorkPage(id)`, `shareWork(it,btnId)`, `shareWorkURL(id)` (`/?w=<id>`), a `?w=` boot handler, and "Share this work" buttons on the standalone page + gallery detail. Lets a user send a friend the whole reveal page for one work.
- **Status:** fully absent from combo (0 hits for all three functions + the `w` param handler).
- **Risk:** LOW — additive functions + one boot branch. The share **button** lands in reveal/gallery markup, which combo redesigned, so place the button into combo's markup by hand (don't paste main's surrounding HTML).

### 2. Non-punitive blank-reveal nudge (B5) — commit `478927d`
- **What:** on the reveal, a category left blank shows `· skipped, no penalty — here's the tell` (pointing to the answer/note) instead of silently nothing; and category cells read `· optional` instead of `· bonus`.
- **Status:** absent from combo (0 hits for the nudge string).
- **Risk:** MEDIUM — the logic (`const blank = !cell.you || cell.you==='—'`) is simple, but it lives inside the reveal category-cell render, and **combo's reveal is redesigned** (two-column notes-rail / questions grid). Re-apply the conditional into combo's reveal template by hand; verify against combo's markup.

### 3. Ethos copy rename: "global recognizability" → "documentation density" + artist "bonus" → "optional" — commit `8e69051`
- **What / where combo still has the old wording:**
  - Collections card 02 "Fame = Wikipedia" (combo line ~1479): "documentation density" + the "it measures the archive as much as the art" clause.
  - FAQ "How is difficulty decided?" (combo line ~2453): "documentation density".
  - Artist field label "Attributed to · **bonus**" → "· **optional**" (2 spots) and reveal category cell `· bonus` → `· optional`.
  - How-to 'choose' step body "that one's a bonus" → "it's optional and never counts against you" — **verify this surface renders on combo** (combo's how-to is Brianna's image carousel; the text-steps array may or may not still show).
- **Status:** combo still says "global recognizability" in 2 confirmed spots; artist "bonus" wording likely still present.
- **Risk:** LOW — text-only swaps. Keep combo's font/markup (e.g. Faculty Glyphic in the card); change only the words.

## YOUR CALL — content/design, NOT a prod-logic port (flagged, not queued)
- **Collections card 06 "Where these choices come from" (decolonial lineage)** — commits 50768bf + 74bbccb. combo does **not** have it (grep confirms absent). But combo deliberately **deleted/reworked collections cards** as a design choice (334937c, a72c75b). Whether combo's collections page should carry card 06 is a **content/design decision for you**, not required prod logic. Say the word and I'll port the de-preachified version.
- **How-to onboarding voice edits** (fce0fe4, 4ef61d2) — **N/A to combo**: main edited the *text* how-to steps; combo replaced the how-to with Brianna's **image carousel** (`HOWTO_IMAGES`). The text main touched doesn't render on combo. Only the 'choose'-step wording overlaps, folded into item 3 above.

## Porting method (respects "design is my call")
- Apply items 1–3 as **targeted logic/text edits into combo's own index.html** — never `git merge main` (the earlier revert left main "logically merged," so a merge would no-op or re-drag design) and never `git checkout main -- index.html` (clobbers Brianna design).
- After each: `node tests/dom-harness.mjs` then `node scripts/check-pool.mjs` (separate step, read PASS), then commit to combo.
- Keep index.html changes on **both** branches going forward so this gap doesn't reopen.
