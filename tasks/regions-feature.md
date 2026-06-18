# Feature: Historical culture/civilization geographic-range polygons (Anthropeum-style)

Status: **scaffold + data draft for review** (script written, `data/regions.js` generated).
NOT yet wired into `index.html`, NOT committed. Spec: `tasks/long-term-goals.md` →
"Historical geographic regions (the 'where to place your pin' range) — APPROVED".

## What was built

1. **`scripts/build-regions.mjs`** (Node ESM) — downloads the right historical-basemaps
   snapshot per culture, extracts the matching polity polygon(s), simplifies them
   (coords snapped to 0.25°, near-duplicate/near-collinear vertices dropped, holes
   removed), and writes `data/regions.js`:
   ```js
   window.ARTEFACTUM_REGIONS = {
     "Roman": { year: 200, name: "Roman Empire", geometry: [ [ [lng,lat], ... ], ... ] },
     ...
   }
   ```
   - KEY = `pool.style` exactly (the styleKind==="culture" name), so the app looks up
     `ARTEFACTUM_REGIONS[work.style]`.
   - `geometry` = array of outer rings; each ring is `[[lng,lat], ...]` (GeoJSON order).
   - Regenerable (same "no stale data" rule as `countries.js`): re-run to refresh from
     upstream. Caches era files under `.cache/hbm/`. `--offline` uses cache only.

2. **`data/regions.js`** — generated draft: **67 cultures, ~117 KB** (loaded once at
   reveal, no build step). All mapped cultures resolved; 0 unmapped.

## Source & license
- **aourednik/historical-basemaps** — `geojson/world_<year>.geojson` (BCE = `world_bc<year>`),
  one feature per polity with a `NAME` property. **License: GPL-3.0.** Must attribute
  in-app (e.g. on the reveal map or an About/credits line). Years available: BCE
  bc123000…bc1, then 100,200,…1500,1530,1600,1650,1700,1715,1783,1800,1815,1880,1900,…2010.

## Culture → (historical entity, era file) mapping (the curated bit)
Full table lives in `MAP` in `scripts/build-regions.mjs`. Era chosen from each culture's
median work-year snapped to the nearest snapshot where the polity is NAMEd. Highlights:

| pool.style | NAME | file |
|---|---|---|
| Roman / Roman, Pompeian / Roman Egypt | Roman Empire | 200 |
| Ancient Greece | Greek city-states | bc500 |
| Achaemenid | Achaemenid Empire | bc500 |
| Third Intermediate Period / Ancient Egypt | Egypt | bc1000/bc1500 |
| New Kingdom | Egypt + Kush | bc1500 |
| Old/Middle Kingdom, Predynastic | Egypt | bc3000/bc2000 |
| Ptolemaic Egypt | Ptolemaic Kingdom | bc200 |
| Sumerian art | Ur | bc3000 |
| Assyrian | Assyria | bc1000 |
| Hittite | Hittites | bc2000 |
| Han / Tang / Song / Yuan / Ming / Qing | Han, Tang Empire, Song Empire, Great Khanate, Ming Chinese Empire, Qing Empire | 200/800/1100/1300/1500/1800 |
| Shang–Zhou bronze | Zhou states | bc500 |
| Edo period / Ukiyo-e | Tokugawa shogunate | 1715 |
| Heian / Kamakura / Momoyama | Imperial Japan / Shogun Japan / Japan (Warring States) | 1100/1300/1600 |
| Korea (Goryeo/Joseon/…) | Korea | 1100–1715 |
| Safavid / Ottoman / Iznik / Mughal | Safavid, Ottoman, Mughal Empires | 1650/1600 |
| Seljuq / Ilkhanid / Timurid | Seljuk Empire / Ilkhanate / Timurid Emirates | 1100/1300/1500 |
| Byzantine / Coptic | Byzantine / Eastern Roman Empire | 800/600 |
| Inca / Chimú / Moche / Maya / Teotihuacan / Olmec | Inca, Chimú, Moche, Maya states, Teotihuacàn, Olmec | 1500/1300/600/bc500 |
| Benin (Edo) art / Ethiopia / Himalayan peoples | Benin / Ethiopia / Nepal + Tibet | 1600/1500/1650 |

**Caveats to review:** `Late Period Egypt` → Achaemenid Empire (only the 27th dynasty was
Persian-held; the dataset has no standalone Egypt at bc500). `Neolithic Chinese jade` →
"Dapenkeng culture" (nearest available neolithic E-Asia polygon; coarse). `Islamic`/`Iran`
mapped to Fatimid/Buyid as broad stand-ins.

## How to add reveal-shading in index.html
In `renderRound()`, the reveal map is `rm` (around **index.html:1399–1413**). `it` is the
work. Add right after the basemap tile layer / before fitBounds:

```js
// shade the work's historical culture range (Anthropeum-style)
const reg = (window.ARTEFACTUM_REGIONS||{})[it.style];
if (reg) {
  const gj = { type:"Feature", geometry:{ type:"MultiPolygon",
    coordinates: reg.geometry.map(ring => [ring]) } };
  const layer = L.geoJSON(gj, { style:{ color:'#2f8f5b', weight:1,
    fillColor:'#2f8f5b', fillOpacity:0.18 } }).addTo(rm);
  try { rm.fitBounds(layer.getBounds().extend(pts), {padding:[28,28], maxZoom:5}); } catch {}
}
```
(Skip the separate `fitBounds(pts,...)` when a region is shaded, or merge bounds as above,
so the whole empire is visible.) Note GeoJSON ring order is `[lng,lat]` — already correct
in `regions.js`, so no flip is needed (unlike the `[lat,lng]` Leaflet markers).

## Remaining work
- [ ] Wire the shading into `renderRound()` (above) + add a GPL-3.0 attribution line.
- [ ] **Region-aware scoring** (spec step 4): full WHERE credit for a guess anywhere
      inside the shaded polygon (point-in-polygon over `reg.geometry`), instead of the
      modern-country test, for works that have a region. Keeps shading and scoring honest.
- [ ] Modern-country fallback + a coverage audit that flags pool cultures with NO region
      mapping (so gaps surface instead of silently falling back). ~80 long-tail cultures
      (African peoples, small Andean/Mesoamerican groups, etc.) are not yet mapped.
- [ ] Review the caveat mappings above (Late Period Egypt, Neolithic jade, Islamic/Iran).
- [ ] Decide whether to also map a few high-count *movements* (e.g. national schools)
      — current scope is styleKind==="culture" only, which is correct per spec.
- [ ] Consider tighter simplification if 117 KB proves heavy (raise `tol` / 0.5° snap).
