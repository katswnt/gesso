// Harvest the National Gallery of Art, Washington (NGA) open-data dump (CC0) → normalize to our schema
// and STAGE for review (no pool write, no promote, no commit). Mirrors fetch-collection.mjs in style.
//
// SOURCE: github.com/NationalGalleryOfArt/opendata  (license: CC0 1.0 Universal — the whole dataset).
// INPUT: CSVs in data/incoming/nga-raw/ (download first; this script reads them locally — no network):
//   objects.csv, published_images.csv, constituents.csv, objects_constituents.csv, objects_terms.csv
//   Download with:
//     mkdir -p data/incoming/nga-raw && cd data/incoming/nga-raw
//     for f in objects published_images constituents objects_constituents objects_terms; do \
//       curl -sSL -o $f.csv "https://raw.githubusercontent.com/NationalGalleryOfArt/opendata/main/data/$f.csv"; done
//
// GATES (both non-negotiable, US-safe):
//   1. LICENSE: keep ONLY objects with a PRIMARY published image whose openaccess=1 (NGA's PD/openaccess flag).
//   2. COPYRIGHT: drop isInCopyright(artist) AND require (creator death ≤1955 OR inception <1930 OR anonymous).
// DEDUPE: vs the live pool by Wikidata Q-id (object wikidataid) first, then by title+artist key.
// ORIGIN: place of CREATION via the artist's nationality → country → centroid (same centroid/countries
//   logic as fetch-collection). NGA's per-object "Place Executed" term is mostly US cities/states and too
//   noisy to map to countries, so nationality is the robust origin signal here.
// Run: node scripts/fetch-nga.mjs   → writes data/incoming/collection-nga.json (a JSON array).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { simplifyMedium, normalizeArtist, canonicalizeStyle, isInCopyright } from "./lib/domain.mjs";
import { readGlobal } from "./lib/static-module.mjs";

const RAW = "data/incoming/nga-raw";
const need = ["objects","published_images","constituents","objects_constituents","objects_terms"];
for(const f of need){ if(!existsSync(`${RAW}/${f}.csv`)){
  console.error(`missing ${RAW}/${f}.csv — download the NGA dump first (see header of this script).`); process.exit(1); } }

// --- RFC-4180 CSV parser: yields rows as string[] (handles quoted fields w/ embedded commas/newlines/quotes) ---
function* parseCSV(text){
  let i=0, n=text.length, row=[], field="", inQ=false;
  while(i<n){ const c=text[i];
    if(inQ){
      if(c==='"'){ if(text[i+1]==='"'){ field+='"'; i+=2; continue; } inQ=false; i++; continue; }
      field+=c; i++; continue;
    }
    if(c==='"'){ inQ=true; i++; continue; }
    if(c===','){ row.push(field); field=""; i++; continue; }
    if(c==='\r'){ i++; continue; }
    if(c==='\n'){ row.push(field); yield row; row=[]; field=""; i++; continue; }
    field+=c; i++;
  }
  if(field.length||row.length){ row.push(field); yield row; }
}
// Stream a CSV row-by-row, invoking cb(rowObject) — only the columns named in `keep` are retained,
// so the multi-MB assistivetext / provenance / dimensions fields never accumulate in the heap.
function streamCSV(name, keep, cb){
  const text = readFileSync(`${RAW}/${name}.csv`,"utf8");
  const it = parseCSV(text); const first = it.next();
  if(first.done) return;
  const head = first.value;
  const idx = keep.map(k=>[k, head.indexOf(k)]);
  for(const row of it){ const o={}; for(const [k,i] of idx) o[k] = i>=0 && row[i]!==undefined ? row[i] : ""; cb(o); }
}

// --- countries/centroid (same approach as fetch-collection.mjs) ---
global.window={}; new Function(readFileSync("data/countries.js","utf8"))();
const CO={}; for(const c of window.ARTEFACTUM_COUNTRIES) CO[c.n.toLowerCase()]=c;
function centroid(c){ let big=c.r[0]; for(const r of c.r) if(r.length>big.length) big=r;
  let sx=0,sy=0; for(const[x,y]of big){sx+=x;sy+=y;} return [Math.round(sy/big.length*1000)/1000,Math.round(sx/big.length*1000)/1000]; }

// NGA "nationality" is an adjective (American, Italian, …). Map demonym → our country name.
const NAT={
  american:"United States of America", italian:"Italy", french:"France", german:"Germany", dutch:"Netherlands",
  flemish:"Belgium", belgian:"Belgium", british:"United Kingdom", english:"United Kingdom", scottish:"United Kingdom",
  irish:"Ireland", welsh:"United Kingdom", spanish:"Spain", austrian:"Austria", swiss:"Switzerland",
  russian:"Russia", swedish:"Sweden", norwegian:"Norway", danish:"Denmark", finnish:"Finland", polish:"Poland",
  czech:"Czechia", hungarian:"Hungary", portuguese:"Portugal", greek:"Greece", mexican:"Mexico",
  canadian:"Canada", brazilian:"Brazil", argentine:"Argentina", "argentinian":"Argentina", chilean:"Chile",
  peruvian:"Peru", colombian:"Colombia", japanese:"Japan", chinese:"China", korean:"South Korea",
  indian:"India", turkish:"Turkey", iranian:"Iran", persian:"Iran", egyptian:"Egypt", "south african":"South Africa",
  australian:"Australia", "new zealander":"New Zealand", romanian:"Romania", bulgarian:"Bulgaria",
  croatian:"Croatia", serbian:"Serbia", ukrainian:"Ukraine", lithuanian:"Lithuania", latvian:"Latvia",
  estonian:"Estonia", slovenian:"Slovenia", slovak:"Slovakia", icelandic:"Iceland", luxembourgish:"Luxembourg",
};
const CONT={ // country → region/continent (covers the demonym targets above)
  "united states of america":"North America","canada":"North America","mexico":"North America",
  "brazil":"South America","argentina":"South America","chile":"South America","peru":"South America","colombia":"South America",
  "egypt":"Africa","south africa":"Africa",
  "china":"Asia","japan":"Asia","india":"Asia","south korea":"Asia","turkey":"Asia","iran":"Asia",
  "australia":"Oceania","new zealand":"Oceania",
};
const regionOf = country => country ? (CONT[country.toLowerCase()] || "Europe") : ""; // demonym set is Euro-heavy → default Europe
function natToCountry(nat){ const k=String(nat||"").toLowerCase().trim(); return NAT[k]||""; }
const yr=v=>{ const m=String(v||"").match(/(-?\d{3,4})/); return m?parseInt(m[1],10):null; };

console.error("indexing NGA CSVs (streaming)…");

// --- index: PRIMARY open-access image per objectid (the LICENSE gate) ---
const primaryImg = new Map(); // objectid -> iiifurl
streamCSV("published_images", ["iiifurl","viewtype","openaccess","depictstmsobjectid"], im=>{
  if(im.viewtype!=="primary") return;
  if(String(im.openaccess).trim()!=="1") return;
  const oid=String(im.depictstmsobjectid||"").trim(); if(!oid) return;
  if(!primaryImg.has(oid)) primaryImg.set(oid, im.iiifurl);
});

// --- index: constituent by id (artist meta) ---
const constById = new Map();
streamCSV("constituents", ["constituentid","forwarddisplayname","preferreddisplayname","nationality","endyear"], c=>{
  constById.set(String(c.constituentid), c);
});

// --- index: artist constituent for an object (lowest displayorder among roletype=artist) ---
const artistLink = new Map(); // objectid -> {constituentid, displayorder}
streamCSV("objects_constituents", ["objectid","constituentid","displayorder","roletype"], oc=>{
  if(oc.roletype!=="artist") return;
  const oid=String(oc.objectid); const ord=parseInt(oc.displayorder||"999",10);
  const cur=artistLink.get(oid);
  if(!cur || ord<cur.displayorder) artistLink.set(oid,{constituentid:String(oc.constituentid),displayorder:ord});
});

// --- index: Style term per object. We use ONLY the "Style" termtype (Renaissance, Baroque,
// Impressionist, …) — NGA's "School" termtype is bare nationalities (French/British/Dutch), which are
// not movements and canonicalizeStyle would void them anyway, so we don't bother with that fallback. ---
const styleByObj=new Map();
streamCSV("objects_terms", ["objectid","termtype","term"], t=>{
  if(t.termtype==="Style" && !styleByObj.has(String(t.objectid))) styleByObj.set(String(t.objectid),t.term);
});

// --- live pool: dedupe keys ---
const pool = readGlobal("data/pool.js","ARTEFACTUM_POOL");
const poolQ = new Set(pool.map(p=>(String(p.id).match(/Q\d+/)||[""])[0]).filter(Boolean));
const keyTA = (t,a)=>`${String(t||"").toLowerCase().replace(/\s+/g," ").trim()}|${String(a||"").toLowerCase().replace(/\s+/g," ").trim()}`;
const poolTA = new Set(pool.map(p=>keyTA(p.title,p.artist)));

const out=[];
let dropLicense=0, dropCopyright=0, dropDupQ=0, dropDupTA=0, dropNoTitle=0;
streamCSV("objects",
  ["objectid","title","displaydate","beginyear","endyear","medium","attribution","wikidataid"],
  o=>{
  const oid=String(o.objectid);
  const iiif=primaryImg.get(oid);
  if(!iiif){ dropLicense++; return; }                         // LICENSE GATE: no primary open-access image
  const title=(o.title||"").trim(); if(!title){ dropNoTitle++; return; }

  // --- artist + creator death year ---
  const link=artistLink.get(oid); const c=link?constById.get(link.constituentid):null;
  const rawArtist = c ? (c.forwarddisplayname || c.preferreddisplayname || "") : (o.attribution||"");
  const anonymous = !rawArtist || /^anonymous$/i.test(rawArtist) || /unknown/i.test(rawArtist);
  const artist = anonymous ? "" : normalizeArtist(rawArtist);
  const deathY = c ? yr(c.endyear) : null;                    // constituent endyear = death year (for persons)

  // --- inception year (object) ---
  const y = yr(o.beginyear) ?? yr(o.endyear) ?? yr(o.displaydate);

  // COPYRIGHT GATE: never admit known in-copyright creators; require US-safe vintage.
  if(isInCopyright(artist)){ dropCopyright++; return; }
  const usSafe = anonymous || (deathY!=null && deathY<=1955) || (y!=null && y<1930);
  if(!usSafe){ dropCopyright++; return; }

  // DEDUPE vs live pool
  const q=(String(o.wikidataid||"").match(/Q\d+/)||[""])[0];
  if(q && poolQ.has(q)){ dropDupQ++; return; }
  if(poolTA.has(keyTA(title,artist))){ dropDupTA++; return; }

  // --- origin (place of creation) via artist nationality ---
  const country = c ? natToCountry(c.nationality) : "";
  const co = country ? CO[country.toLowerCase()] : null;
  const [lat,lng] = co ? centroid(co) : [null,null];

  // --- style (movement/school) ---
  const rawStyle = styleByObj.get(oid) || "";
  const style = canonicalizeStyle(rawStyle);

  // --- image (NGA IIIF; explicit size — path form, NGA does not honor ?width) ---
  const img = `${iiif}/full/!900,900/0/default.jpg`;

  out.push({
    id:`nga${oid}`, title, artist,
    y, lat, lng, place:country, region: country?regionOf(country):"",
    medium:(o.medium||"").trim(),                              // raw catalogue string (simplifyMedium runs downstream)
    style, styleKind: style ? "movement" : "",
    img, src:"nga",
    ...(q ? { wikidataid:q } : {}),
  });
  if(q) poolQ.add(q); poolTA.add(keyTA(title,artist));
});

const outfile="data/incoming/collection-nga.json";
writeFileSync(outfile, JSON.stringify(out,null,1));

const withPlace=out.filter(o=>o.place).length;
const withYear =out.filter(o=>o.y!=null).length;
const withStyle=out.filter(o=>o.style).length;
const withMed  =out.filter(o=>simplifyMedium(o.medium)).length;
console.log(`\nSTAGED ${out.length} NGA works → ${outfile}  (license: CC0 1.0)`);
console.log(`  dropped: license(no primary open-access img) ${dropLicense} | copyright ${dropCopyright} | dup-Qid ${dropDupQ} | dup-title+artist ${dropDupTA} | no-title ${dropNoTitle}`);
console.log(`  coverage: place ${withPlace}/${out.length} | year ${withYear}/${out.length} | style ${withStyle}/${out.length} | simplifiable-medium ${withMed}/${out.length}`);
console.log("  (stage-only — promote later via promote-shortlist.mjs + check-pool gate)");
