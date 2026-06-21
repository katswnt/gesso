// Harvest specific famous works by Wikidata Q-id. Stages normalized records for review; does not write
// the live pool. Run: node scripts/fetch-byids.mjs /tmp/famous-qids.txt
import { readFileSync, writeFileSync } from "node:fs";
import { normalizeArtist } from "./lib/domain.mjs";
import { readGlobal } from "./lib/static-module.mjs";

const FILE = process.argv[2];
if(!FILE){ console.error("usage: node scripts/fetch-byids.mjs <qids-file>"); process.exit(1); }

const UA = "GessoFamousByIds/1.0 (kathryn.swint@gmail.com)";
const BATCH = 120;
const OUT = "data/incoming/famous-works.json";
const sleep = ms => new Promise(r => setTimeout(r, ms));

global.window = {};
new Function(readFileSync("data/countries.js", "utf8"))();
const CO = {};
for(const c of window.ARTEFACTUM_COUNTRIES) CO[c.n.toLowerCase()] = c;
const ALIAS = {"united states":"united states of america","kingdom of the netherlands":"netherlands","democratic republic of the congo":"democratic republic of the congo","people's republic of china":"china","czech republic":"czechia"};
const CONT = {"united states of america":"North America","canada":"North America","mexico":"North America","brazil":"South America","peru":"South America","colombia":"South America","egypt":"Africa","nigeria":"Africa","mali":"Africa","democratic republic of the congo":"Africa","guinea":"Africa","china":"Asia","japan":"Asia","india":"Asia","indonesia":"Asia","papua new guinea":"Oceania","vanuatu":"Oceania","new zealand":"Oceania"};
function centroid(c){ let big = c.r[0]; for(const r of c.r) if(r.length > big.length) big = r; let sx = 0, sy = 0; for(const [x,y] of big){ sx += x; sy += y; } return [Math.round(sy / big.length * 1000) / 1000, Math.round(sx / big.length * 1000) / 1000]; }
const toCo = l => { if(!l) return ""; let k = l.toLowerCase().trim(); k = ALIAS[k] || k; return CO[k] ? CO[k].n : ""; };
const yr = v => { const m = String(v || "").match(/^(-?\d{1,4})/); return m ? parseInt(m[1], 10) : null; };
const qid = id => { const m = String(id || "").match(/Q\d+/); return m ? m[0] : null; };

async function sparql(qy){
  const u = "https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(qy);
  for(let t = 0; t < 6; t++){
    try{
      const r = await fetch(u, { headers: { "User-Agent": UA, "Accept": "application/sparql-results+json" } });
      if(r.status === 429 || r.status >= 500){ await sleep(3000 * (t + 1)); continue; }
      if(!r.ok){ console.error("sparql", r.status); return null; }
      return await r.json();
    }catch(e){
      await sleep(1500 * (t + 1));
    }
  }
  return null;
}

function filePath(image){
  const file = decodeURIComponent(String(image || "").split("/").pop() || "");
  return file ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=900` : "";
}

function safeCopyright(row){
  const creatorCount = row.creatorCount ? Number(row.creatorCount.value) : 0;
  const deathMax = row.deathMax ? Number(row.deathMax.value) : null;
  const inception = row.year ? yr(row.year.value) : null;
  return creatorCount === 0 || (inception != null && inception < 1930) || (deathMax != null && deathMax <= 1955);
}

const rawIds = readFileSync(FILE, "utf8").match(/Q\d+/g) || [];
const ids = [...new Set(rawIds)];
const pool = readGlobal("data/pool.js", "ARTEFACTUM_POOL") || [];
const liveQids = new Set(pool.map(p => qid(p.id)).filter(Boolean));

let hadImage = 0, droppedCopyright = 0, droppedDup = 0;
const staged = [];

for(let i = 0; i < ids.length; i += BATCH){
  const batch = ids.slice(i, i + BATCH);
  const values = batch.map(q => "wd:" + q).join(" ");
  const q = `SELECT ?work (SAMPLE(?img) AS ?image) (SAMPLE(?title) AS ?title) (SAMPLE(?yearValue) AS ?year)
    (GROUP_CONCAT(DISTINCT ?creatorLabel; separator="; ") AS ?creator)
    (COUNT(DISTINCT ?creatorItem) AS ?creatorCount) (MAX(?deathYear) AS ?deathMax)
    (SAMPLE(?originCountryLabel) AS ?originCountry) (SAMPLE(?originLabel) AS ?origin)
    (SAMPLE(?locCountryLabel) AS ?locCountry)
    (GROUP_CONCAT(DISTINCT ?materialLabel; separator=" ") AS ?material)
    (SAMPLE(?movementLabel) AS ?movement) (SAMPLE(?cultureLabel) AS ?culture)
  WHERE {
    VALUES ?work { ${values} }
    ?work wdt:P18 ?img.
    OPTIONAL { ?work rdfs:label ?title. FILTER(LANG(?title)="en") }
    OPTIONAL { ?work wdt:P571 ?yearValue. }
    OPTIONAL {
      ?work wdt:P170 ?creatorItem.
      OPTIONAL { ?creatorItem rdfs:label ?creatorLabel. FILTER(LANG(?creatorLabel)="en") }
      OPTIONAL { ?creatorItem wdt:P570 ?death. BIND(YEAR(?death) AS ?deathYear) }
    }
    OPTIONAL {
      ?work wdt:P495 ?originItem.
      OPTIONAL { ?originItem wdt:P17 ?originCountryItem. ?originCountryItem rdfs:label ?originCountryLabel. FILTER(LANG(?originCountryLabel)="en") }
      OPTIONAL { ?originItem rdfs:label ?originLabel. FILTER(LANG(?originLabel)="en") }
    }
    OPTIONAL { ?work wdt:P1071 ?loc. ?loc wdt:P17 ?locCountryItem. ?locCountryItem rdfs:label ?locCountryLabel. FILTER(LANG(?locCountryLabel)="en") }
    OPTIONAL { ?work wdt:P186 ?materialItem. ?materialItem rdfs:label ?materialLabel. FILTER(LANG(?materialLabel)="en") }
    OPTIONAL { ?work wdt:P135 ?movementItem. ?movementItem rdfs:label ?movementLabel. FILTER(LANG(?movementLabel)="en") }
    OPTIONAL { ?work wdt:P2596 ?cultureItem. ?cultureItem rdfs:label ?cultureLabel. FILTER(LANG(?cultureLabel)="en") }
  } GROUP BY ?work`;

  const j = await sparql(q);
  await sleep(500);
  if(!j?.results) continue;

  for(const b of j.results.bindings){
    const q = qid(b.work?.value);
    const title = b.title?.value || q;
    if(!q || !b.image?.value) continue;
    hadImage++;
    if(!safeCopyright(b)){ droppedCopyright++; continue; }
    if(liveQids.has(q)){ droppedDup++; continue; }

    const country = toCo(b.originCountry?.value) || toCo(b.origin?.value) || toCo(b.locCountry?.value);
    const co = country ? CO[country.toLowerCase()] : null;
    const [lat, lng] = co ? centroid(co) : [null, null];
    const culture = b.culture?.value || "";
    const movement = b.movement?.value || "";
    staged.push({
      id: "wikidata:" + q,
      title,
      artist: normalizeArtist(b.creator?.value || ""),
      y: b.year ? yr(b.year.value) : null,
      lat,
      lng,
      place: country,
      region: country ? (CONT[country.toLowerCase()] || "") : "",
      medium: b.material?.value || "",
      style: culture || movement,
      styleKind: culture ? "culture" : (movement ? "movement" : ""),
      img: filePath(b.image.value),
      src: "wd-famous"
    });
  }
  console.error(`  ${Math.min(i + BATCH, ids.length)}/${ids.length} queried | staged ${staged.length}`);
}

writeFileSync(OUT, JSON.stringify(staged, null, 1));
console.log(`queried: ${ids.length}`);
console.log(`had-image: ${hadImage}`);
console.log(`dropped-copyright: ${droppedCopyright}`);
console.log(`dropped-dup: ${droppedDup}`);
console.log(`staged: ${staged.length} -> ${OUT}`);
console.log("staged titles:");
for(const w of staged) console.log("  " + w.title);
