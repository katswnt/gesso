# Gesso

A daily art-guessing game — *"Wordle meets GeoGuessr, for art history."* Live at **[gesso.katswint.com](https://gesso.katswint.com)**.

You're shown an artwork. For each, guess (categories adapt per work):

- **🕰️ When** it was made (timeline slider, scored by era band)
- **🗺️ Where** it was made (drop a pin on the map; scored by distance)
- **🖼️ Medium** (pills) · **🎨 Movement / Culture** (pills) · **🖌️ Artist** (typed autocomplete, bonus)

Up to **2,500 pts/category**, partial credit for near-misses, a shareable emoji grid + image, streaks, archive, and a "teach me" study note on every reveal.

---

## Running it locally (no build step!)

```bash
python3 -m http.server 8000     # from the repo root, then open http://localhost:8000
```
Just edit `index.html` and refresh. (Open `file://` directly mostly works, but a local server is needed for the data files + clean URLs.)

---

## 🎨 Design guide (start here, Briana!)

Everything visual lives in **`index.html`** (one self-contained file). Two places to edit:

### 1. Design tokens — `:root` at the top of the `<style>` block (~line 18)
All colors/theme live here as CSS variables. Change these to restyle globally:
```
--bg --surface --surface-strong --ink --muted --faint --line --line-card
--accent (ultramarine #2230b8)  --full (green)  --partial (gold)  --miss (red)
--study-bg --study-border  --track
```
Fonts: **Archivo** (display/body) + **IBM Plex Mono** (labels/numbers), loaded from Google Fonts in `<head>`.

### 2. The `<style>` block (~lines 17–366)
All reusable component CSS, by class. Key classes:
`.sheet` (page frame) · `.hd` (header bar) · `.plate` (artwork frame w/ crop-marks) · `.pill` (medium/movement options) · `.banner` (reveal score) · `.study` (teach-me note) · `.daycell`/`.tierdots` (archive) · `.btn`/`.btn2` (buttons) · responsive rules in `@media(max-width:680px)` (~line 330).

### ⚠️ The gotcha: inline styles
~120 elements are styled **inline** (`style="…"`) inside JS template strings, not in the `<style>` block. To find a screen's markup, open the matching **render function** (below) and search there. When you can, prefer moving repeated inline styles into a class in the `<style>` block.

### Screen → function map (all in the one `<script>`)
| Screen | Function |
|---|---|
| Home / tier picker | `renderStart()` |
| A round (guessing) | `renderRound()` |
| Reveal (score + study note) | `renderReveal()` |
| Final results | `renderResults()` |
| Archive calendar | `renderArchive()` |
| A single day (paginated) | `renderDayView()` |
| Streak / Stats / Glossary / Movement | `renderStreak()` / `renderStats()` / `renderGlossary()` / `renderMovement()` |
| Settings panel | `openSettings()` |
| Share image (canvas) | `downloadShareImage()` |

Motion respects a **reduce-motion** setting — gate any new animation on `body.motion-ok` / `settings.reduceMotion`.

---

## Working together (recommended workflow)

The site auto-deploys to Vercel from `main`, so **don't commit straight to `main`**. Instead:

```bash
git checkout -b briana/whatever      # branch
# …edit index.html…
git commit -am "tweak: …"  &&  git push -u origin briana/whatever
# open a Pull Request on GitHub
```
Vercel posts a **preview URL on every branch/PR** — open it to see your changes live, share it for review, then merge the PR to ship. This keeps prod safe and lets you iterate visually.

---

## Project structure

```
index.html            the entire app (HTML + CSS + vanilla JS, Leaflet for maps)
vercel.json           SPA routing (so /YYYY-MM-DD/<level> deep links work)
favicon.* etc.        icons
data/                 generated content (don't hand-edit):
  pool.js             the artworks (window.ARTEFACTUM_POOL)
  fame.js             recognizability scores → difficulty tiers
  daily-order.js      frozen per-tier rotation (keeps dailies stable)
  teach-works.js      per-work "teach me" notes
  hotspots.js         look-closer marker coordinates
  cues.js             movement/culture teaching cards
scripts/              data pipeline (Node) — pulls from museum APIs, scores fame,
                      generates teach notes/hotspots, freezes dailies. Not needed for design work.
tasks/                planning notes + backlog (todo.md, long-term-goals.md)
```

## Data & licensing

Artworks come from open-access museum collections — the Met, Art Institute of Chicago, Cleveland, V&A, Harvard, Smithsonian — plus Wikidata/Wikimedia. **Images are public-domain / CC0 only** (this is why there's little post-1929 / contemporary art — most is still under copyright). See the in-app **FAQ & credits** on the home screen.

## Tech

Vanilla JS, single file, zero npm dependencies to run. Maps via [Leaflet](https://leafletjs.com/) (CDN). Deployed on Vercel.
