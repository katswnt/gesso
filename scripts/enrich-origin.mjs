// Fill missing physical origin country for staged collection files using only
// creation/origin signals from Wikidata. Writes sidecar .enriched.json files.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const UA = "GessoCollection/1.0 (kathryn.swint@gmail.com)";
const IN_DIR = "data/incoming";
const BATCH = 150;
const BETWEEN_BATCHES_MS = 1200;

const sleep = ms => new Promise(r => setTimeout(r, ms));

global.window = {};
new Function(readFileSync("data/countries.js", "utf8"))();

const CO = {};
for (const c of window.ARTEFACTUM_COUNTRIES) CO[c.n.toLowerCase()] = c;

const ALIAS = {
  "united states": "united states of america",
  "kingdom of the netherlands": "netherlands",
  "democratic republic of the congo": "democratic republic of the congo",
  "people's republic of china": "china",
  "czech republic": "czechia",
  "republic of korea": "south korea",
  "south korea": "south korea",
  "north korea": "north korea",
  "russian empire": "russia",
  "soviet union": "russia",
  "ottoman empire": "turkey",
  "persia": "iran",
  "iran (islamic republic of)": "iran",
  "kingdom of great britain": "united kingdom",
  "united kingdom of great britain and ireland": "united kingdom",
  "great britain": "united kingdom",
  "viet nam": "vietnam",
  "bolivia, plurinational state of": "bolivia",
  "venezuela, bolivarian republic of": "venezuela",
  "syrian arab republic": "syria",
  "lao people's democratic republic": "laos",
  "côte d'ivoire": "ivory coast",
  "cote d'ivoire": "ivory coast",
  "republic of the congo": "republic of congo",
  "congo": "republic of congo",
  "myanmar": "burma",
};

const CONT = {
  "united states of america": "North America",
  "canada": "North America",
  "mexico": "North America",
  "guatemala": "North America",
  "honduras": "North America",
  "costa rica": "North America",
  "panama": "North America",
  "cuba": "North America",
  "haiti": "North America",
  "dominican republic": "North America",
  "jamaica": "North America",
  "trinidad and tobago": "North America",
  "brazil": "South America",
  "peru": "South America",
  "colombia": "South America",
  "argentina": "South America",
  "chile": "South America",
  "bolivia": "South America",
  "ecuador": "South America",
  "venezuela": "South America",
  "paraguay": "South America",
  "uruguay": "South America",
  "egypt": "Africa",
  "nigeria": "Africa",
  "mali": "Africa",
  "democratic republic of the congo": "Africa",
  "republic of congo": "Africa",
  "guinea": "Africa",
  "morocco": "Africa",
  "algeria": "Africa",
  "tunisia": "Africa",
  "libya": "Africa",
  "ethiopia": "Africa",
  "ghana": "Africa",
  "cameroon": "Africa",
  "ivory coast": "Africa",
  "benin": "Africa",
  "burkina faso": "Africa",
  "senegal": "Africa",
  "sudan": "Africa",
  "south sudan": "Africa",
  "kenya": "Africa",
  "tanzania": "Africa",
  "uganda": "Africa",
  "rwanda": "Africa",
  "south africa": "Africa",
  "china": "Asia",
  "japan": "Asia",
  "india": "Asia",
  "indonesia": "Asia",
  "iran": "Asia",
  "iraq": "Asia",
  "syria": "Asia",
  "turkey": "Asia",
  "israel": "Asia",
  "lebanon": "Asia",
  "jordan": "Asia",
  "saudi arabia": "Asia",
  "yemen": "Asia",
  "afghanistan": "Asia",
  "pakistan": "Asia",
  "nepal": "Asia",
  "bangladesh": "Asia",
  "sri lanka": "Asia",
  "thailand": "Asia",
  "burma": "Asia",
  "cambodia": "Asia",
  "laos": "Asia",
  "vietnam": "Asia",
  "malaysia": "Asia",
  "philippines": "Asia",
  "south korea": "Asia",
  "north korea": "Asia",
  "mongolia": "Asia",
  "russia": "Europe",
  "france": "Europe",
  "germany": "Europe",
  "austria": "Europe",
  "netherlands": "Europe",
  "norway": "Europe",
  "italy": "Europe",
  "spain": "Europe",
  "united kingdom": "Europe",
  "belgium": "Europe",
  "switzerland": "Europe",
  "greece": "Europe",
  "czechia": "Europe",
  "poland": "Europe",
  "denmark": "Europe",
  "sweden": "Europe",
  "finland": "Europe",
  "ireland": "Europe",
  "portugal": "Europe",
  "romania": "Europe",
  "hungary": "Europe",
  "croatia": "Europe",
  "serbia": "Europe",
  "ukraine": "Europe",
  "lithuania": "Europe",
  "latvia": "Europe",
  "estonia": "Europe",
  "papua new guinea": "Oceania",
  "vanuatu": "Oceania",
  "new zealand": "Oceania",
  "australia": "Oceania",
  "fiji": "Oceania",
  "samoa": "Oceania",
  "tonga": "Oceania",
  "solomon islands": "Oceania",
};

function centroid(c) {
  let big = c.r[0];
  for (const r of c.r) if (r.length > big.length) big = r;
  let sx = 0, sy = 0;
  for (const [x, y] of big) {
    sx += x;
    sy += y;
  }
  return [
    Math.round(sy / big.length * 1000) / 1000,
    Math.round(sx / big.length * 1000) / 1000,
  ];
}

function toCo(label) {
  if (!label) return "";
  let k = String(label).toLowerCase().trim();
  k = ALIAS[k] || k;
  return CO[k] ? CO[k].n : "";
}

async function sparql(qy) {
  const u = "https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(qy);
  for (let t = 0; t < 6; t++) {
    try {
      const r = await fetch(u, { headers: { "User-Agent": UA, "Accept": "application/sparql-results+json" } });
      if (r.status === 429 || r.status >= 500) {
        await sleep(3000 * (t + 1));
        continue;
      }
      if (!r.ok) {
        console.error("sparql", r.status, (await r.text()).slice(0, 200).replace(/\s+/g, " "));
        return null;
      }
      return await r.json();
    } catch (e) {
      const code = e?.cause?.code || "";
      if (code === "ENOTFOUND") throw new Error(`cannot reach query.wikidata.org (${code})`);
      if (t === 5) console.error("sparql fetch failed", e?.message || e);
      await sleep(1500 * (t + 1));
    }
  }
  return null;
}

function qidFromId(id) {
  const m = String(id || "").match(/^wikidata:(Q\d+)$/);
  return m ? m[1] : null;
}

function pickCountry(row) {
  const candidates = [
    ["P495", row.P495],
    ["P1071", row.P1071],
    ["culture", row.cultureP17 || row.cultureP495],
    ["P189-found", row.P189],
  ];
  for (const [source, label] of candidates) {
    const country = toCo(label);
    if (country) return { country, source };
  }
  return null;
}

function value(row, key) {
  return row[key] ? row[key].value : "";
}

function buildQuery(qids) {
  const values = qids.map(q => `wd:${q}`).join(" ");
  return `SELECT ?i
    (SAMPLE(?p495L) AS ?P495)
    (SAMPLE(?p1071CountryL) AS ?P1071)
    (SAMPLE(?cultureP17L) AS ?cultureP17)
    (SAMPLE(?cultureP495L) AS ?cultureP495)
    (SAMPLE(?p189CountryL) AS ?P189)
  WHERE {
    VALUES ?i { ${values} }
    OPTIONAL { ?i wdt:P495 ?p495. ?p495 rdfs:label ?p495L. FILTER(LANG(?p495L)="en") }
    OPTIONAL { ?i wdt:P1071 ?p1071. ?p1071 wdt:P17 ?p1071Country. ?p1071Country rdfs:label ?p1071CountryL. FILTER(LANG(?p1071CountryL)="en") }
    OPTIONAL { ?i wdt:P2596 ?culture. ?culture wdt:P17 ?cultureP17. ?cultureP17 rdfs:label ?cultureP17L. FILTER(LANG(?cultureP17L)="en") }
    OPTIONAL { ?i wdt:P2596 ?culture2. ?culture2 wdt:P495 ?cultureP495. ?cultureP495 rdfs:label ?cultureP495L. FILTER(LANG(?cultureP495L)="en") }
    OPTIONAL { ?i wdt:P189 ?p189. ?p189 wdt:P17 ?p189Country. ?p189Country rdfs:label ?p189CountryL. FILTER(LANG(?p189CountryL)="en") }
  } GROUP BY ?i`;
}

async function fetchOrigins(qids) {
  const out = new Map();
  for (let i = 0; i < qids.length; i += BATCH) {
    const batch = qids.slice(i, i + BATCH);
    const json = await sparql(buildQuery(batch));
    if (!json?.results?.bindings) {
      console.error(`  batch ${Math.floor(i / BATCH) + 1}: no result`);
      await sleep(BETWEEN_BATCHES_MS);
      continue;
    }
    for (const b of json.results.bindings) {
      const qid = value(b, "i").match(/Q\d+$/)?.[0];
      if (!qid) continue;
      const picked = pickCountry({
        P495: value(b, "P495"),
        P1071: value(b, "P1071"),
        cultureP17: value(b, "cultureP17"),
        cultureP495: value(b, "cultureP495"),
        P189: value(b, "P189"),
      });
      if (picked) out.set(qid, picked);
    }
    await sleep(BETWEEN_BATCHES_MS);
  }
  return out;
}

function sourceCounts(rows) {
  const counts = {};
  for (const r of rows) {
    if (!r.placeSource) continue;
    counts[r.placeSource] = (counts[r.placeSource] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0])));
}

const files = readdirSync(IN_DIR)
  .filter(f => /^collection-.*\.json$/.test(f) && !/\.enriched\.json$/.test(f))
  .sort();

let combinedTotal = 0;
let combinedWithPlace = 0;
const combinedSources = {};

for (const file of files) {
  const path = join(IN_DIR, file);
  const works = JSON.parse(readFileSync(path, "utf8"));
  const qids = [...new Set(works.filter(w => !w.place).map(w => qidFromId(w.id)).filter(Boolean))];
  console.log(`${file}: ${works.length} works, ${qids.length} missing-place Wikidata ids`);
  const origins = await fetchOrigins(qids);

  for (const w of works) {
    if (w.place) continue;
    const qid = qidFromId(w.id);
    const resolved = qid ? origins.get(qid) : null;
    if (!resolved) continue;
    const co = CO[resolved.country.toLowerCase()];
    if (!co) continue;
    const [lat, lng] = centroid(co);
    w.place = resolved.country;
    w.placeSource = resolved.source;
    w.region = CONT[resolved.country.toLowerCase()] || w.region || "";
    w.lat = lat;
    w.lng = lng;
  }

  const outFile = file.replace(/\.json$/, ".enriched.json");
  writeFileSync(join(IN_DIR, outFile), JSON.stringify(works, null, 1));

  const withPlace = works.filter(w => w.place).length;
  const counts = sourceCounts(works);
  for (const [k, v] of Object.entries(counts)) combinedSources[k] = (combinedSources[k] || 0) + v;
  combinedTotal += works.length;
  combinedWithPlace += withPlace;
  console.log(`  wrote ${outFile}`);
  console.log(`  total works: ${works.length} | now have place: ${withPlace} | placeSource: ${JSON.stringify(counts)}`);
}

console.log(`combined total works: ${combinedTotal} | now have place: ${combinedWithPlace} | placeSource: ${JSON.stringify(Object.fromEntries(Object.entries(combinedSources).sort((a, b) => a[0].localeCompare(b[0]))))}`);
