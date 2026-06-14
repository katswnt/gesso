// Pull sub-Saharan (and other) works by CULTURE (P2596) whose ethnic group's country is in Africa —
// catches Yoruba/Edo/Dogon/Kuba/etc. that lack a country-of-origin. No sitelink floor (under-documented).
// Run: node scripts/pull-wd-culture.mjs
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
const query=`SELECT ?item ?itemLabel ?cultureLabel ?countryLabel (YEAR(?inception) AS ?yr) ?creatorLabel ?materialLabel ?image ?sl WHERE {
  ?item wdt:P2596 ?culture ; wdt:P18 ?image ; wdt:P571 ?inception .
  ?culture wdt:P17 ?country . ?country wdt:P30 wd:Q15 . FILTER(?country != wd:Q79)
  OPTIONAL{?item wikibase:sitelinks ?sl.} OPTIONAL{?item wdt:P170 ?creator.} OPTIONAL{?item wdt:P186 ?material.}
  SERVICE wikibase:label{bd:serviceParam wikibase:language "en".}
} LIMIT 1200`;
const rows=await sparql(query);
if(!rows){console.error("query failed");process.exit(1);}
const seen=new Set(), out=[];
for(const b of rows){ const g=k=>b[k]&&b[k].value; const id=g("item"); if(!id||seen.has(id))continue; seen.add(id);
  const y=parseInt(g("yr"),10), img=g("image"); if(!Number.isFinite(y)||!img)continue;
  out.push({ id, title:g("itemLabel")||"Untitled", artist:g("creatorLabel")||"", year:y,
    place:g("countryLabel")||"", culture:g("cultureLabel")||"", movement:"",
    medium:g("materialLabel")||"", image:img.replace(/^http:/,"https:")+"?width=900", src:"wdculture", fameHint:parseInt(g("sl"),10)||0 });
}
writeFileSync("data/incoming/wd-culture.json", JSON.stringify(out));
const byc={};for(const o of out)byc[o.culture||o.place]=(byc[o.culture||o.place]||0)+1;
console.log(`pulled ${out.length} culture-tagged works`);
console.log("by culture:", Object.entries(byc).sort((a,b)=>b[1]-a[1]).slice(0,20).map(([k,v])=>`${k} ${v}`).join(" · "));
