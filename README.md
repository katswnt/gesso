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

All the page CSS lives in **`styles.css`** (linked from `index.html`'s `<head>` as `/styles.css`). Structure + behavior live in **`index.html`**.

> **Paths:** `index.html` has `<base href="/">`, and the app uses clean URLs like `/2026-06-15/easy`. So link assets **root-absolute** (`/styles.css`) or rely on the base tag — plain relative paths (`./x.css`) break on deep links.

### 1. Design tokens — `:root` at the top of `styles.css`
All colors/theme live here as CSS variables. Change these to restyle globally:
```
--bg --surface --surface-strong --ink --muted --faint --line --line-card
--accent (ultramarine #2230b8)  --full (green)  --partial (gold)  --miss (red)
--study-bg --study-border  --track
```
Light theme overrides live under `[data-theme="light"]`. Fonts: **Archivo** (display/body) + **IBM Plex Mono** (labels/numbers), loaded from Google Fonts in `<head>`.

### 2. Component CSS — `styles.css`
All reusable component CSS, by class. Key classes:
`.sheet` (page frame) · `.hd` (header bar) · `.plate` (artwork frame w/ crop-marks) · `.pill` (medium/movement options) · `.banner` (reveal score) · `.study` (teach-me note) · `.daycell`/`.tierdots` (archive) · `.btn`/`.btn2` (buttons) · responsive rules in `@media(max-width:680px)`.

### ⚠️ The gotcha: inline styles
~200 elements are still styled **inline** (`style="…"`) inside JS template strings in `index.html`, not in `styles.css`. To find a screen's markup, open the matching **render function** (below) and search there. When you can, prefer moving repeated inline styles into a class in `styles.css`.

### Screen → function map (all in the one `<script>`)
| Screen | Function |
|---|---|
| Home / tier picker | `renderStart()` |
| A round (guessing) | `renderRound()` |
| Reveal (score + study note) | `renderReveal()` |
| Final results | `renderFinal()` |
| Learning mode (endless) summary | `renderInfiniteSummary()` |
| Archive calendar | `renderArchive()` |
| A single day (paginated) | `renderDayView()` |
| Streak / Stats / Glossary / Movement / Collections | `renderStreak()` / `renderStats()` / `renderGlossary()` / `renderMovement()` / `renderCollections()` |
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
index.html            app structure + vanilla JS (Leaflet for maps)
styles.css            all page CSS (design tokens + components) — linked as /styles.css
vercel.json           SPA routing (so /YYYY-MM-DD/<level> deep links work)
favicon.* etc.        icons
data/                 generated content (don't hand-edit):
  pool.js             the artworks (window.ARTEFACTUM_POOL)
  fame.js             recognizability scores (pageviews-driven) → difficulty tiers
  daily-order.js      frozen rotation — Easy = curated icons (4 per day) + 1 recognizable
  teach-works.js      per-work "teach me" notes (why + cues + guide)
  hotspots.js         look-closer marker coordinates
  cues.js             movement/culture teaching cards
  collections.js      themed groupings (collections page)
  countries.js        compact country polygons for point-in-country geo scoring
scripts/              data pipeline (Node) — pulls museum/Wikidata APIs, scores fame,
                      generates teach notes/hotspots, audits data (P31 collisions,
                      images), freezes dailies. Not needed for design work.
tasks/                planning notes + backlog (todo.md, afk-plan.md)
```

## Data & licensing

Artworks come from open-access museum collections — the Met, Art Institute of Chicago, Cleveland, V&A, Harvard, Smithsonian — plus Wikidata/Wikimedia. **Images are public-domain / CC0 only** (this is why there's little post-1929 / contemporary art — most is still under copyright). See the in-app **FAQ & credits** on the home screen.

## Tech

Vanilla JS, single file, zero npm dependencies to run. Maps via [Leaflet](https://leafletjs.com/) (CDN). Deployed on Vercel.
