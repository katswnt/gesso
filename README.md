# Gesso

Daily art-history guessing: GeoGuessr-style place, date, medium, movement, and artist clues for public-domain artworks.

> Screenshot/GIF placeholder: add a current gameplay capture here before sharing the portfolio.

Live: [gesso.katswint.com](https://gesso.katswint.com)

## What It Is

Gesso is a no-login, daily guessing game for art history. Each round shows an artwork and asks the player to identify when it was made, where it originated, its medium, its movement or culture, and optionally the artist. It is interesting technically because the app is intentionally small at runtime while the data pipeline does the heavy lifting: public-domain filtering, museum/Wikidata enrichment, recognizability ranking, daily freezing, image validation, and teaching-note generation.

The project is deliberately a vanilla-JS SPA with no build step. That keeps the deployed artifact inspectable and durable, but it raises the bar for code organization: `index.html` contains the app shell and client logic, `styles.css` contains the design system and components, and `data/*.js` ships precomputed static modules on `window`.

## Architecture

- `index.html`: single-file SPA, routing, gameplay state, scoring, Leaflet maps, image fallback logic, local stats, and share cards.
- `styles.css`: design tokens, responsive layout, result states, settings, maps, reveal cards, and utility components.
- `data/pool.js`: artwork corpus loaded as `window.ARTEFACTUM_POOL`.
- `data/fame.js` / `data/fame.json`: recognizability scores used for difficulty tiers.
- `data/daily-order.js`: frozen per-tier daily rotation, by artwork ID.
- `data/countries.js`: compact country polygons for point-in-country scoring.
- `data/teach-works.js`, `data/hotspots.js`, `data/cues.js`: teaching notes, look-closer markers, and movement/culture cues.
- `api/report.js`: Vercel serverless endpoint for “report an error” submissions, backed by Upstash/Vercel KV env vars.
- `scripts/*.mjs`: Node data pipeline for pulling, normalizing, auditing, re-hosting, and freezing the corpus.

No bundler is required. Leaflet and fonts load from CDNs; generated data files are plain script tags.

## Daily, Scoring, And Difficulty

Dailies are deterministic and frozen. `scripts/freeze-daily.mjs` writes `data/daily-order.js`; the client uses that ID order so every player receives the same five works for a given date and tier. If the frozen file is absent, the client falls back to a seeded rotation, but production should use the frozen order.

Difficulty is based on recognizability, not intrinsic art-historical difficulty. Fame scores are derived from Wikidata sitelinks and pageviews, then sliced into tiers. Easy is intentionally canon-heavy because it reflects what broad audiences are likely to recognize; harder tiers expose more of the global corpus.

Each core category is worth up to 2,500 points:

- Date uses a tier-scaled year-difference curve with decade-level bullseyes.
- Place gives full credit for the country where the work was physically made (its place of creation), with distance decay outside that country.
- Medium uses a simplified artistic-medium taxonomy, not support material.
- Movement/culture gives exact credit for exact matches and capped partial credit for related movements.
- Artist is a bonus category with forgiving exact-name matching and conservative pool-derived partial credit.

Hints subtract from core score only. Artist points are bonus points and do not define a Perfect; a Masterpiece is a Perfect plus exact artist credit.

## Data And Licensing Discipline

The corpus is restricted to public-domain or CC0-safe images. The working rule is US-safe public domain: creator died by 1955 and/or the work was published before 1930; FSA and US-government works are public domain regardless. `scripts/audit-copyright.mjs` audits Wikidata-sourced works against creator death years and writes review flags.

Domain conventions are intentional:

- Place/origin means where the work was physically made (its place of creation) — not the holding museum, and not the artist’s nationality.
- Medium means artistic medium or process, not support.
- Dailies must remain deterministic and shared by date/tier.
- Secrets belong only in `.env` / `.env.local` or Vercel env vars; they are gitignored and must never be shipped in client data.

Images come from mixed public-domain sources: museum image services, Wikimedia Commons, and Vercel Blob for sources that gatekeep or fail in normal browsers. `displaySrc()` loads a card-sized image; `hiRes()` fetches a larger source only when the zoom lightbox opens; `imgFail()` retries and then proxies through weserv before showing a graceful fallback.

## Running Locally

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000`. A local server is preferred because the app uses script-loaded data files and clean routes such as `/2026-06-18/easy`.

Useful checks:

```bash
node --check scripts/audit-copyright.mjs
node --check scripts/freeze-daily.mjs
node scripts/audit-all.mjs
node scripts/audit-all.mjs --images
```

## Deployment

The site deploys to Vercel from `main`. `vercel.json` rewrites clean SPA routes back to `index.html`, and `api/report.js` runs as a Vercel serverless function when configured with KV/Upstash environment variables.

## Data Pipeline

The pipeline is a set of small Node scripts rather than one monolithic ETL job. Important entry points:

- `scripts/build-pool.mjs`: early corpus builder from Wikidata and the Met.
- `scripts/pull-*.mjs`: source adapters for AIC, Cleveland, Harvard, Smithsonian, V&A, Wikidata subsets, and modern/public-domain slices.
- `scripts/consolidate.mjs`: merges staged candidates into the pool with dedupe/geocoding checks.
- `scripts/fame-score.mjs`, `scripts/make-fame-js.mjs`, `scripts/check-fame.mjs`: recognizability scoring and review.
- `scripts/audit-data.mjs`, `scripts/audit-vocab.mjs`, `scripts/audit-p31.mjs`, `scripts/audit-copyright.mjs`, `scripts/audit-all.mjs`: data, vocabulary, entity, and copyright audits.
- `scripts/check-images.mjs`: resumable image validation with Commons API batching.
- `scripts/rehost-aic-blob.mjs`, `scripts/rehost-harvard-blob.mjs`: Vercel Blob re-hosting for fragile image hosts.
- `scripts/enrich-dimensions.mjs`, `scripts/enrich-wd-medium.mjs`, `scripts/geo-p937.mjs`: enrichment/backfill passes.
- `scripts/gen-teach*.mjs`, `scripts/merge-notes.mjs`, `scripts/hotspot-*.mjs`: teaching notes and look-closer marker generation.
- `scripts/freeze-daily.mjs`: writes the frozen deterministic daily order.

Several scripts require API keys (`HARVARD_KEY`, `SI_KEY`, `BLOB_READ_WRITE_TOKEN`) and should be run from a local environment or Vercel configuration, never from committed client code.

## Design Decisions And Tradeoffs

- Static data modules keep runtime simple and hosting cheap, but large generated files make initial load size a real performance constraint.
- A single-file SPA is easy to deploy and inspect, but it concentrates product logic, rendering, and scoring in one file; comments and section boundaries have to carry more weight.
- Fame-based difficulty makes the product approachable, but it inherits canon bias. The UI calls that out rather than pretending the bias is neutral.
- Place scoring targets where the work was physically made (its place of creation) — not the holding museum and not the artist’s nationality — using country containment with border grace as a pragmatic approximation for a game.
- Image reliability is handled defensively because public-domain image hosts vary widely in CORS, rate limits, file size, and mobile availability.
