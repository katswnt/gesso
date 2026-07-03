// Harvest the holding museum (+ city + coordinates) for pool works.
//   node scripts/harvest-museums.mjs
// Wikidata works: query P276 (collection/location), walk P361* up to the entity that is a
// museum (P31/P279* Q33506), take its label + coordinates (P625) + city (P131). Branded-src
// works (met/aic/…) get their museum from a static SRC map. Writes data/incoming/museums-harvest.json
// (work-id -> {museum, city, lat, lng}) + a deduped MUSEUMS table. Does NOT mutate the pool.
import { readFileSync, writeFileSync } from "node:fs";

globalThis.window = {}; new Function(readFileSync("data/pool.js", "utf8"))();
const pool = window.ARTEFACTUM_POOL;
const qidOf = w => { const m = (w.id || "").match(/Q\d+/); return m ? m[0] : null; };

// museums whose identity is fixed by the source (coords hardcoded — these never come from Wikidata reliably)
const SRC_MUSEUM = {
  met:{name:"The Metropolitan Museum of Art",city:"New York",lat:40.7794,lng:-73.9632},
  aic:{name:"Art Institute of Chicago",city:"Chicago",lat:41.8796,lng:-87.6237},
  cleveland:{name:"Cleveland Museum of Art",city:"Cleveland",lat:41.5085,lng:-81.6117},
  harvard:{name:"Harvard Art Museums",city:"Cambridge, MA",lat:42.3743,lng:-71.1140},
  va:{name:"Victoria and Albert Museum",city:"London",lat:51.4966,lng:-0.1722},
  nga:{name:"National Gallery of Art",city:"Washington, DC",lat:38.8913,lng:-77.0199},
  loc:{name:"Library of Congress",city:"Washington, DC",lat:38.8887,lng:-77.0047},
  britishmuseum:{name:"British Museum",city:"London",lat:51.5194,lng:-0.1270},
  lacma:{name:"Los Angeles County Museum of Art",city:"Los Angeles",lat:34.0639,lng:-118.3592},
  walters:{name:"Walters Art Museum",city:"Baltimore",lat:39.2969,lng:-76.6160},
  brooklyn:{name:"Brooklyn Museum",city:"New York",lat:40.6712,lng:-73.9636},
  quaibranly:{name:"Musée du quai Branly",city:"Paris",lat:48.8608,lng:2.2977},
  smithsonian:{name:"Smithsonian Institution",city:"Washington, DC",lat:38.8887,lng:-77.0260},
};

const SPARQL = "https://query.wikidata.org/sparql";
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function query(qids) {
  const values = qids.map(q => "wd:" + q).join(" ");
  const q = `SELECT ?art ?museum ?museumLabel ?coord ?cityLabel WHERE {
    VALUES ?art { ${values} }
    ?art wdt:P276 ?loc. ?loc wdt:P361* ?museum.
    ?museum wdt:P31/wdt:P279* wd:Q33506.
    OPTIONAL { ?museum wdt:P625 ?coord. }
    OPTIONAL { ?museum wdt:P131 ?city. }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`;
  const url = SPARQL + "?query=" + encodeURIComponent(q) + "&format=json";
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(url, { headers: { Accept: "application/sparql-results+json", "User-Agent": "gesso-museum-harvest/1.0 (contact: kat)" } });
      if (r.status === 429) { await sleep(3000 * (attempt + 1)); continue; }
      if (!r.ok) throw new Error("http " + r.status);
      return (await r.json()).results.bindings;
    } catch (e) { if (attempt === 3) throw e; await sleep(1500 * (attempt + 1)); }
  }
  return [];
}

// unique QIDs
const qids = [...new Set(pool.map(qidOf).filter(Boolean))];
console.log("querying", qids.length, "Wikidata QIDs for P276…");
const wdMuseum = {}; // qid -> {museum, city, lat, lng}
const BATCH = 120;
for (let i = 0; i < qids.length; i += BATCH) {
  const batch = qids.slice(i, i + BATCH);
  let rows = [];
  try { rows = await query(batch); } catch (e) { console.error("  batch", i, "failed:", e.message); }
  for (const row of rows) {
    const art = row.art.value.split("/").pop();
    if (wdMuseum[art]) continue; // first museum wins
    const name = row.museumLabel?.value; if (!name || /^Q\d+$/.test(name)) continue;
    let lat = null, lng = null;
    if (row.coord?.value) { const m = row.coord.value.match(/Point\(([-\d.]+) ([-\d.]+)\)/); if (m) { lng = +m[1]; lat = +m[2]; } }
    wdMuseum[art] = { museum: name, city: row.cityLabel?.value || "", lat, lng };
  }
  if ((i / BATCH) % 5 === 0) console.error(`  ${Math.min(i + BATCH, qids.length)}/${qids.length} | resolved ${Object.keys(wdMuseum).length}`);
  await sleep(400);
}

// assign per-work + build MUSEUMS table
const byWork = {}; const museums = {};
let fromWd = 0, fromSrc = 0, none = 0;
for (const w of pool) {
  const s = (w.src || "").split("-")[0];
  const q = qidOf(w);
  let m = null;
  if (q && wdMuseum[q]) { m = wdMuseum[q]; fromWd++; }
  else if (SRC_MUSEUM[s]) { m = SRC_MUSEUM[s]; fromSrc++; }
  else { none++; continue; }
  byWork[w.id] = m.museum;
  if (!museums[m.museum]) museums[m.museum] = { city: m.city || "", lat: m.lat ?? null, lng: m.lng ?? null };
  else if ((museums[m.museum].lat == null) && m.lat != null) museums[m.museum] = { city: m.city || museums[m.museum].city, lat: m.lat, lng: m.lng };
}
writeFileSync("data/incoming/museums-harvest.json", JSON.stringify({ byWork, museums }, null, 1));
console.log(`\nassigned museum to ${Object.keys(byWork).length}/${pool.length} works (wd ${fromWd}, src ${fromSrc}) | no museum: ${none}`);
console.log(`distinct museums: ${Object.keys(museums).length} | with coords: ${Object.values(museums).filter(x => x.lat != null).length}`);
console.log("top holders:", Object.entries(byWork).reduce((a, [, m]) => (a[m] = (a[m] || 0) + 1, a), {}) && Object.entries(Object.entries(byWork).reduce((a, [, m]) => (a[m] = (a[m] || 0) + 1, a), {})).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([m, n]) => `${m}:${n}`).join(", "));
