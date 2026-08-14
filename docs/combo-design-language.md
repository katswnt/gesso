# Combo design language register

The pinned rules for combo's visual design, so porting Briana's redesign screen by screen stays
cohesive without re-deciding the same thing every time. Read this before any design port; normalize
each ported screen to it; the mechanical rules are (or will be) enforced by `scripts/check-design.mjs`.

Columns: **Briana's convention · why (my read, confirm with Briana) · Kat's call · enforcement.**
"My read" is inference from the code, not from Briana. Correct it after the walkthrough session.

## Briana's core method (the reason her design feels consistent)
She builds a small set of **reused primitives**, not bespoke screens. The settings modal *is* the
how-to modal shell (`howtomodal` / `htohead` / `htocloseX` / x.svg close). Consistency falls out of
using the same parts, it isn't hand-maintained. **When porting, reach for an existing primitive
before inventing markup.** The old (main) screens are bespoke one-offs; that is what we're retiring.

## The case system (Kat's decision: sentence-case display, keep chrome)
Briana's casing is a deliberate three-tier system, not "lowercase everywhere." Kat overrides tier 1 only.

| Tier | Where | Type | Briana | **Kat's call** | Why |
|---|---|---|---|---|---|
| 1 Display / titles | modal titles, page headers, wordmark | Faculty Glyphic serif | lowercase (`settings`) | **Sentence case** (`Settings`) | Kat prefers it; lowercase editorial calm is not her voice |
| 2 Labels / body | setting names, buttons, prose | Manrope sans | Sentence case | **Sentence case** (unchanged) | human, functional |
| 3 Micro-chrome | CM/IN segments, kickers (`STUDY NOTE`), accession stamps, tier tabs | tiny serif/mono | UPPERCASE | **UPPERCASE** (keep) | reads as catalog metadata / system chrome; gives the UI its texture and hierarchy |

**Normalization rule at port time:** any Faculty Glyphic *display title* that comes over lowercase from
Briana's branch gets converted to Sentence case. Leave tier-2 labels and tier-3 uppercase micro-chrome
exactly as Briana built them. Do NOT sentence-case the kickers/stamps/segment labels.

## Component & token conventions (decoded from the settings modal; apply everywhere)
| Element | Rule |
|---|---|
| Modals | Reuse the `howtomodal` shell: `htohead` with a display title left + `htocloseX` (x.svg) right, a scroll body, optional centered muted footer note. No bespoke modal frames, no text "Close/Done" buttons. |
| Rows | `setrow` pattern: bold **name** + muted **hint** on the left, control on the right. One rhythm for every settings-like row. |
| Toggles | `toggle` pill with `aria-pressed`, not a checkbox. |
| Choice-of-N | segmented control (accent-filled active segment), not a dropdown. |
| Color | accent (var(--accent), the salmon) means "active/on" ONLY. No decorative color. State = color, nothing else. |
| Fonts | Faculty Glyphic (display) + Manrope (body/mono). Already globally migrated on combo (0 Archivo / 0 Plex). Never reintroduce Archivo or IBM Plex Mono. |
| Corners | square (2px), site-wide (Briana design system). |
| Reassurance copy | quiet, centered, muted, Manrope. E.g. "Preferences saved to this browser." |
| Icons | from the ICONS map / assets SVGs, never entity glyphs or emoji (already gated by check-design R-rules). |

## Copy voice inside the design
Kat's voice rules still apply to every string that lands: no em-dashes, sentence case per the table above,
dry and plain, no earnest/preachy register. See memory `kat-writing-voice`.

## Per-screen porting checklist (run for each design port onto combo)
1. Pull Briana's render markup from `briana-pure` for that screen.
2. Re-apply it onto combo's CURRENT logic (keep combo's data wiring + handlers; never wholesale-merge
   `briana-pure`, it is ~360 commits behind on logic).
3. Confirm the classes it uses already exist in combo's `styles.css` (most do). Add only the missing rules
   (e.g. `.menupanel`). Adding CSS is a design act, so note it here.
4. Apply the case-system normalization above (sentence-case tier-1 titles; leave tiers 2 and 3).
5. Strip em-dashes; apply Kat's voice to any copy.
6. Gate as separate steps: `node tests/dom-harness.mjs` then `node scripts/check-pool.mjs`. Commit to combo.
7. Push to the combo preview; Kat eyeballs it before the next screen.

## Enforcement (the "pin")
- `scripts/check-design.mjs` already gates tokens/glyphs in `npm test`. **TODO:** add a WARN rule that flags
  a Faculty Glyphic display title rendered all-lowercase (tier-1 case violation). Start as WARN; flip to HARD
  once the case system is settled. This stops lowercase drift from creeping back across dozens of ports.
- This register is the source of truth for design decisions; update it as decisions are made, and use it as
  the agenda for the Briana walkthrough (walk in with her system articulated + Kat's overrides marked).

## Open questions for the Briana session (my reads to confirm)
- Is lowercase display type meant as the "gallery-wall / editorial calm" signal I inferred? Sentence-case
  overrides it on combo; does that break anything she intended?
- Are the uppercase micro-labels (kickers, CM/IN, stamps) a deliberate "catalog metadata" tier? (We're keeping them.)
- Any component primitives beyond the modal shell / setrow / toggle / segmented control that should be the
  canonical parts (cards, chips, nav)?
