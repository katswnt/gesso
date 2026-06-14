// Pull African-ORIGIN artworks (country of origin's continent = Africa), ranked by Wikidata sitelinks,
// regardless of which museum holds them. Free Commons images only. Run: node scripts/pull-wd-africa.mjs
import { writeFileSync } from "node:fs";
const UA="GessoArtGame/1.0 (kathryn.swint@gmail.com)";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function sparql(query){
  const url="https://query.wikidata.org/sparql?format=json&query="+encodeURIComponent(query);
  for(let t=0;t<4;t++){ try{
    const r=await fetch(url,{headers:{Accept:"application/sparql-results+json","User-Agent":UA}});
    if(r.status===429||r.status>=500){await sleep(2000*(t+1));continue;}
    if(!r.ok){console.error("http",r.status);return null;} return (await r.json()).results.bindings;
  }catch(e){console.error(String(e).slice(0,80));await sleep(1500*(t+1));} } return null;
}
// art-ish instance types (direct P31, kept narrow for query speed)
const TYPES="wd:Q3305213 wd:Q860861 wd:Q93184 wd:Q179700 wd:Q207816 wd:Q838948 wd:Q220659 wd:Q4502142 wd:Q11107242 wd:Q2293009";
const query=`SELECT ?item ?itemLabel ?creatorLabel (YEAR(?inception) AS ?yr) ?countryLabel ?movementLabel ?materialLabel ?image ?sl WHERE {
  VALUES ?type { ${TYPES} }
  ?item wdt:P31 ?type ; wdt:P18 ?image ; wikibase:sitelinks ?sl ; wdt:P495 ?country .
  ?country wdt:P30 wd:Q15 . FILTER(?sl>0)
  OPTIONAL{?item wdt:P571 ?inception.} OPTIONAL{?item wdt:P170 ?creator.}
  OPTIONAL{?item wdt:P135 ?movement.} OPTIONAL{?item wdt:P186 ?material.}
  SERVICE wikibase:label{bd:serviceParam wikibase:language "en".}
} ORDER BY DESC(?sl) LIMIT 600`;
const rows=await sparql(query);
if(!rows){console.error("query failed");process.exit(1);}
const seen=new Set(), out=[];
for(const b of rows){ const g=k=>b[k]&&b[k].value; const id=g("item"); if(!id||seen.has(id))continue; seen.add(id);
  const y=parseInt(g("yr"),10), img=g("image"); if(!Number.isFinite(y)||!img)continue;
  out.push({ id, title:g("itemLabel")||"Untitled", artist:g("creatorLabel")||"", year:y,
    place:g("countryLabel")||"", culture:"", movement:(g("movementLabel")||"").replace(/\s+(painting|art)$/i,""),
    medium:g("materialLabel")||"", image:img.replace(/^http:/,"https:")+"?width=900", src:"wdafrica", fameHint:parseInt(g("sl"),10)||0 });
}
writeFileSync("data/incoming/wd-africa.json", JSON.stringify(out));
const byc={};for(const o of out)byc[o.place]=(byc[o.place]||0)+1;
console.log(`pulled ${out.length} African-origin works`);
console.log("by country:", Object.entries(byc).sort((a,b)=>b[1]-a[1]).slice(0,18).map(([k,v])=>`${k} ${v}`).join(" · "));
console.log("top:", out.slice(0,10).map(o=>o.title.slice(0,22)).join(" · "));
