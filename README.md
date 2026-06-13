# Artefactum

A daily art-guessing game — *"Wordle meets GeoGuessr, for art history."*

You're shown a famous painting. For each one, guess four things:

- **🕰️ When** it was made (timeline slider, scored by era band)
- **🗺️ Where** it was made (drop a pin on the map)
- **🎨 Movement** (multiple choice)
- **🖌️ Artist** (typed autocomplete)

You earn up to **2,500 points per category** (10,000 max per piece), with **partial credit** for near-misses — a related art movement or a same-school artist. At the end you get a Wordle-style emoji grid to share.

## Features

- **Live puzzles** pulled from the [Wikidata Query Service](https://query.wikidata.org/) (creator, year, movement, country coordinates, image), with a curated offline fallback set.
- **Difficulty tiers** — Easy / Medium / Hard / Impossible, split by each painting's fame (Wikidata sitelink count).
- **Pin-vs-truth reveal map** showing your guess, the true origin, and the distance between them.
- Images served live from [Wikimedia Commons](https://commons.wikimedia.org/).

## Running it

No build step. Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Tech

Single self-contained `index.html` — vanilla JS + [Leaflet](https://leafletjs.com/) for maps. No dependencies to install.

## Credits

Artwork data & images: Wikidata and Wikimedia Commons contributors (CC licenses vary by work).
