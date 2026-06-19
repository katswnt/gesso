# Handoff — Training filter builder

The setup UI for Training mode: search **or** browse to add filters, see the logic as stacked AND/OR groups, and watch a live match count + narrowing breakdown. Single-column (mobile-first). *Design reference* in HTML — port into `index.html`'s `renderTraining()` (see `tasks/training-mode-spec.md`).

**Visual reference:** `Gesso Filter Builder.dc.html` (+ `support.js`) — fully interactive.
**Tokens:** existing `:root`. Archivo + IBM Plex Mono. Dab `.blob`.

---

## Layout (one vertical flow — replaces the side-by-side concept)
1. **Search box** — type across *all* facet vocab at once; results dropdown shows each hit tagged with its category + count, click to add. (No reliance on the free-text *parser* — this is direct vocab search; the parser from spec §3 can still power paste-y multi-term input, but the picker is the primary path.)
2. **Browse-by-category tabs** — Era · Place · Movement · Medium · Artist. Tap a tab → that category's options as toggle chips (top ~8 + "type to search for more" for the long tail). Lets a player pick **dates first, then places**, etc.
3. **Your drill** — selected filters as **stacked groups**: one card per family, **OR** chips within a family, a bold **AND** rail between families. Each chip removable (×).
4. **Live count + breakdown** — an inline `eceffb` panel: big match count + "~N rounds before any repeat"; a "show breakdown" disclosure expands the **narrowing funnel** (All works → after each family → final). Empty-guard: under 8 shows a red "loosen a filter", Start dims at 0.
5. **Start training →**.

## ⚠️ Category model — match the game
- **Movement and Culture are ONE category** (in-game `style`, with `styleKind:'movement'|'culture'`). They share a tab, OR together in one group. Do **not** split them. (Source vocab: `MOVEMENT_NAMES` = `MOVS ∪ CULTS`.)
- **Place is NOT always a country.** The reference uses country chips as a stand-in. Confirm with engineering how origin is stored (the pool has `place`, `lat/lng`, `region`, and `placeCountry(place)`); the Place category should reflect whatever granularity ships (country, and/or region, and/or finer). The builder's family slot is agnostic — just feed it the right options + a count function.
- Families to wire: **Era** (century buckets via `centuryOf(y)`), **Place** (TBD granularity), **Movement** (`style`), **Medium** (`MED_FAMILY` families), **Artist** (the artist pool). Region can fold into Place or be its own family — engineering's call.

## Data wiring
- Each option needs `{label, family, count}` where **count = `trainingSet({that one facet}).length`** against the real `POOL` (the reference fakes counts with fractions — replace with real filtering).
- The big count = `trainingSet(TRAIN).length` for the full current selection; recompute on every add/remove. The funnel rows = cumulative `trainingSet` as each family is applied in order.
- Combine logic = the spec's **AND across families, OR within a family** — the stacked groups render exactly that; the count function already encodes it.
- On Start → build the `TRAIN` config (`facets` sets per family + `axis` from the Focus control, which lives on the Training screen alongside this) and call `startTraining(TRAIN)`.

## Mobile / a11y
- Single column collapses cleanly; search dropdown is full-width; chips wrap. ≥44px tap targets on options/chips.
- Search input is a real `<input>`; results are clickable rows (make them buttons/role=option for SR). Category tabs are buttons with `aria-selected`. The count panel should be an `aria-live="polite"` region so it announces as filters change.
- No motion beyond the funnel bar width transition (gate on `body.motion-ok` if added).
