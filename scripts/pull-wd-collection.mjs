// Pull the most-famous works (by Wikidata sitelinks) from museum collections that have free Commons images.
// Pure Wikidata SPARQL — no Codex. Writes data/incoming/wd-museums.json + prints per-museum coverage.
// Run: node scripts/pull-wd-collection.mjs [perMuseumLimit]
import { writeFileSync } from "node:fs";
const FLOOR = parseInt(process.argv[2]||"4",10); // sitelinks floor (notability); uncapped per museum
const UA = "GessoArtGame/1.0 (kathryn.swint@gmail.com)";
const sleep = ms => new Promise(r=>setTimeout(r,ms));

// candidate museums (Q-ids best-effort; a 0 count means wrong id or no Wikidata coverage)
const MUSEUMS = [
  // — Western canon (fills missing masterpieces) —
  {q:"Q160112",name:"Museo del Prado (Madrid)",region:"EU"},
  // Louvre works live under its DEPARTMENT collections, not Q19675 (which is near-empty on Wikidata)
  {q:"Q3044768",name:"Louvre (Paris)",region:"EU"}, // Paintings
  {q:"Q3044747",name:"Louvre (Paris)",region:"EU"}, // Greek/Etruscan/Roman antiquities
  {q:"Q3044751",name:"Louvre (Paris)",region:"EU"}, // Near Eastern antiquities
  {q:"Q3044772",name:"Louvre (Paris)",region:"EU"}, // Sculptures
  {q:"Q3044749",name:"Louvre (Paris)",region:"EU"}, // Egyptian antiquities
  {q:"Q3044767",name:"Louvre (Paris)",region:"EU"}, // Decorative arts
  {q:"Q3044753",name:"Louvre (Paris)",region:"EU"}, // Prints & drawings
  {q:"Q3044748",name:"Louvre (Paris)",region:"EU"}, // Islamic arts
  {q:"Q683074", name:"Louvre (Paris)",region:"EU"}, // Borghese Collection (at the Louvre)
  {q:"Q180788",name:"National Gallery (London)",region:"EU"},
  {q:"Q51252", name:"Uffizi (Florence)",region:"EU"},
  {q:"Q190804",name:"Rijksmuseum (Amsterdam)",region:"EU"},
  {q:"Q214867",name:"National Gallery of Art (DC)",region:"NA"},
  {q:"Q1416890",name:"Fine Arts Museums of SF (de Young)",region:"NA"},
  // — Asia (museums located in Asia) —
  {q:"Q540668",name:"National Palace Museum (Taipei)",region:"AS"},
  {q:"Q653433", name:"Tokyo National Museum",region:"AS"},
  {q:"Q494407", name:"National Museum of Korea (Seoul)",region:"AS"},
  {q:"Q170495", name:"Topkapı Palace Museum (Istanbul)",region:"AS"},
  // — Africa (museums located in Africa) —
  {q:"Q201219", name:"Egyptian Museum (Cairo)",region:"AF"},
];

async function sparql(query){
  const url="https://query.wikidata.org/sparql?format=json&query="+encodeURIComponent(query);
  for(let t=0;t<4;t++){ try{
    const r=await fetch(url,{headers:{Accept:"application/sparql-results+json","User-Agent":UA}});
    if(r.status===429||r.status>=500){await sleep(1500*(t+1));continue;}
    if(!r.ok) return null; return (await r.json()).results.bindings;
  }catch(e){ await sleep(1000*(t+1)); } } return null;
}
const q = (museumQ)=>`SELECT ?item ?itemLabel ?creatorLabel (YEAR(?inception) AS ?yr) ?movementLabel ?materialLabel ?countryLabel ?image ?sl WHERE {
  ?item wdt:P195 wd:${museumQ}; wdt:P18 ?image; wikibase:sitelinks ?sl. FILTER(?sl>=${FLOOR})
  OPTIONAL{?item wdt:P571 ?inception.} OPTIONAL{?item wdt:P170 ?creator.}
  OPTIONAL{?item wdt:P135 ?movement.} OPTIONAL{?item wdt:P186 ?material.} OPTIONAL{?item wdt:P495 ?country.}
  SERVICE wikibase:label{bd:serviceParam wikibase:language "en".}
} ORDER BY DESC(?sl) LIMIT 3000`;

const out=[]; const report=[]; const seen=new Set(); // global dedup (e.g. across Louvre departments)
for(const m of MUSEUMS){
  const rows=await sparql(q(m.q)); await sleep(400);
  if(!rows){ report.push(`  ${m.name.padEnd(42)} ERROR`); continue; }
  let n=0;
  for(const b of rows){ const g=k=>b[k]&&b[k].value; const id=g("item"); if(!id||seen.has(id))continue; seen.add(id);
    const y=parseInt(g("yr"),10), img=g("image"); if(!Number.isFinite(y)||!img)continue;
    out.push({ id, title:g("itemLabel")||"Untitled", artist:g("creatorLabel")||"", year:y,
      place:g("countryLabel")||"", culture:"", movement:(g("movementLabel")||"").replace(/\s+(painting|art)$/i,""),
      medium:g("materialLabel")||"", image:img.replace(/^http:/,"https:")+"?width=900", src:"wdmus", fameHint:parseInt(g("sl"),10)||0 });
    n++; }
  report.push(`  ${m.name.padEnd(42)} ${String(n).padStart(4)}  [${m.region}]`);
}
writeFileSync("data/incoming/wd-museums.json", JSON.stringify(out));
console.log(`=== per-museum coverage (works with image + sitelinks ≥${FLOOR}) ===`);
report.forEach(r=>console.log(r));
console.log(`\nTOTAL pulled: ${out.length} -> data/incoming/wd-museums.json`);
