// Harvest a museum collection via Wikidata/Wikimedia Commons (for museums without their own open-access
// image program, e.g. quai Branly / British Museum). Pulls every object in the collection that has a
// freely-licensed Commons image, normalized to our schema, and STAGES it for review (no pool write).
// Origin = country of creation (P495 country-of-origin → P1071 location). Culture (P2596) becomes the
// guessable "style". Run: node scripts/fetch-collection.mjs <museumQid> <srcTag> [cap]
//   e.g. node scripts/fetch-collection.mjs Q167863 quaibranly 400
import { readFileSync, writeFileSync } from "node:fs";
const [QID, SRC="collection", CAP="600"] = process.argv.slice(2);
if(!/^Q\d+$/.test(QID||"")){ console.error("usage: node scripts/fetch-collection.mjs <museumQid> <srcTag> [cap]"); process.exit(1); }
const UA="GessoCollection/1.0 (kathryn.swint@gmail.com)";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
global.window={}; new Function(readFileSync("data/countries.js","utf8"))();
const CO={}; for(const c of window.ARTEFACTUM_COUNTRIES) CO[c.n.toLowerCase()]=c;
const ALIAS={"united states":"united states of america","kingdom of the netherlands":"netherlands","democratic republic of the congo":"democratic republic of the congo","people's republic of china":"china","czech republic":"czechia"};
const CONT={"united states of america":"North America","canada":"North America","mexico":"North America","brazil":"South America","peru":"South America","colombia":"South America","egypt":"Africa","nigeria":"Africa","mali":"Africa","democratic republic of the congo":"Africa","guinea":"Africa","china":"Asia","japan":"Asia","india":"Asia","indonesia":"Asia","papua new guinea":"Oceania","vanuatu":"Oceania","new zealand":"Oceania"};
function centroid(c){ let big=c.r[0]; for(const r of c.r) if(r.length>big.length) big=r; let sx=0,sy=0; for(const[x,y]of big){sx+=x;sy+=y;} return [Math.round(sy/big.length*1000)/1000,Math.round(sx/big.length*1000)/1000]; }
const toCo=l=>{ if(!l)return""; let k=l.toLowerCase().trim(); k=ALIAS[k]||k; return CO[k]?CO[k].n:""; };
const yr=v=>{ const m=String(v||"").match(/^(-?\d{1,4})/); return m?parseInt(m[1],10):null; };

async function sparql(qy){ const u="https://query.wikidata.org/sparql?format=json&query="+encodeURIComponent(qy);
  for(let t=0;t<6;t++){ try{ const r=await fetch(u,{headers:{"User-Agent":UA,"Accept":"application/sparql-results+json"}});
    if(r.status===429||r.status>=500){ await sleep(3000*(t+1)); continue; } if(!r.ok){ console.error("sparql",r.status); return null; } return await r.json(); }
    catch(e){ await sleep(1500*(t+1)); } } return null; }

// one row per object (SAMPLE collapses multi-valued props); label/material/culture in English
const Q=`SELECT ?i (SAMPLE(?img) AS ?image) (SAMPLE(?t) AS ?title) (SAMPLE(?inc) AS ?year)
  (SAMPLE(?creatorL) AS ?creator) (SAMPLE(?countryL) AS ?country) (SAMPLE(?locCountryL) AS ?locCountry)
  (SAMPLE(?cultureL) AS ?culture) (SAMPLE(?matL) AS ?material) (SAMPLE(?movL) AS ?movement) WHERE {
  ?i wdt:P195 wd:${QID}; wdt:P18 ?img.
  OPTIONAL { ?i rdfs:label ?t. FILTER(LANG(?t)="en") }
  OPTIONAL { ?i wdt:P571 ?inc. }
  OPTIONAL { ?i wdt:P170 ?cr. ?cr rdfs:label ?creatorL. FILTER(LANG(?creatorL)="en") }
  OPTIONAL { ?i wdt:P495 ?c. ?c rdfs:label ?countryL. FILTER(LANG(?countryL)="en") }
  OPTIONAL { ?i wdt:P1071 ?loc. ?loc wdt:P17 ?lc. ?lc rdfs:label ?locCountryL. FILTER(LANG(?locCountryL)="en") }
  OPTIONAL { ?i wdt:P2596 ?cul. ?cul rdfs:label ?cultureL. FILTER(LANG(?cultureL)="en") }
  OPTIONAL { ?i wdt:P186 ?m. ?m rdfs:label ?matL. FILTER(LANG(?matL)="en") }
  OPTIONAL { ?i wdt:P135 ?mv. ?mv rdfs:label ?movL. FILTER(LANG(?movL)="en") }
} GROUP BY ?i LIMIT ${parseInt(CAP,10)}`;

const j=await sparql(Q);
if(!j||!j.results){ console.error("no results"); process.exit(1); }
const out=[];
for(const b of j.results.bindings){
  const id="wikidata:"+b.i.value.match(/Q\d+/)[0];
  const title=b.title?b.title.value:null; if(!title) continue;
  const file=decodeURIComponent(b.image.value.split("/").pop());
  const country=(b.country&&toCo(b.country.value))||(b.locCountry&&toCo(b.locCountry.value))||"";
  const co=country?CO[country.toLowerCase()]:null; const [lat,lng]=co?centroid(co):[null,null];
  const culture=b.culture?b.culture.value:""; const movement=b.movement?b.movement.value:"";
  out.push({ id, title, artist:b.creator?b.creator.value:"", y:b.year?yr(b.year.value):null,
    place:country, region:country?(CONT[country.toLowerCase()]||"Africa"):"", lat, lng,
    medium:b.material?b.material.value:"", style:culture||movement, styleKind:culture?"culture":(movement?"movement":""),
    img:`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=900`, src:SRC });
}
const file=`data/incoming/collection-${SRC}.json`;
writeFileSync(file, JSON.stringify(out,null,1));
console.log(`STAGED ${out.length} works from ${QID} → ${file}`);
const noPlace=out.filter(o=>!o.place).length, noYear=out.filter(o=>o.y==null).length;
console.log(`  no origin country: ${noPlace} | no year: ${noYear} | with culture: ${out.filter(o=>o.styleKind==='culture').length}`);
console.log("  (review, then promote with the existing pipeline after the WHERE job finishes)");
