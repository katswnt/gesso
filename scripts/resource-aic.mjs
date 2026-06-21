// Re-source AIC images to Wikimedia Commons where the same work exists there. Matches via Wikidata
// P4704 (Art Institute of Chicago artwork ID) = exact ID match (no fuzzy title guessing). Replaces the
// pool work's img with the Commons FilePath URL ONLY when Wikidata has a P18 image; keeps id/notes/
// hotspots/fame intact (keyed by id). AIC-direct stays as-is for unmatched works. Run: node scripts/resource-aic.mjs
import { readFileSync, writeFileSync } from "node:fs";
const UA="GessoAICResource/1.0 (kathryn.swint@gmail.com)";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const raw=readFileSync("data/pool.js","utf8");
const pool=JSON.parse(raw.slice(raw.indexOf("["),raw.lastIndexOf("]")+1));
const aicWorks=pool.filter(p=>/^aic\d+$/.test(p.id));
const aicId=p=>p.id.slice(3);
console.log("AIC works in pool:",aicWorks.length);

async function sparql(q){ const u="https://query.wikidata.org/sparql?format=json&query="+encodeURIComponent(q);
  for(let t=0;t<5;t++){ try{ const r=await fetch(u,{headers:{"User-Agent":UA,"Accept":"application/sparql-results+json"}});
    if(r.status===429||r.status>=500){ await sleep(2500*(t+1)); continue; } if(!r.ok){ console.error("  sparql",r.status); return null; }
    return await r.json(); }catch(e){ await sleep(1500*(t+1)); } } return null; }

// query Wikidata in batches: items whose P4704 matches our AIC ids, with their P18 image
const found={}; // aicId -> {qid, file}
const ids=aicWorks.map(aicId);
for(let i=0;i<ids.length;i+=120){
  const batch=ids.slice(i,i+120);
  const values=batch.map(x=>`"${x}"`).join(" ");
  const q=`SELECT ?item ?aic ?image WHERE { VALUES ?aic { ${values} } ?item wdt:P4704 ?aic. OPTIONAL { ?item wdt:P18 ?image. } }`;
  const j=await sparql(q); await sleep(400);
  if(j&&j.results){ for(const b of j.results.bindings){ const aic=b.aic.value; const qid=b.item.value.match(/Q\d+/)[0];
    const img=b.image?decodeURIComponent(b.image.value.split("/").pop()):null;
    if(img) found[aic]={qid,file:img}; } }
  console.error(`  batch ${i/120+1}: ${Object.keys(found).length} commons matches so far`);
}

let swapped=0; const log=[];
for(const p of aicWorks){ const f=found[aicId(p)]; if(!f) continue;
  const newImg=`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(f.file)}?width=900`;
  if(p.img===newImg) continue;
  p.aicImg=p.img;            // keep the AIC original as a record
  p.img=newImg; p.src="aic-commons";
  swapped++; log.push(`${p.id}  ${(p.artist||"—").slice(0,22).padEnd(22)} ${p.title.slice(0,40)}`);
}
writeFileSync("data/pool.js", raw.slice(0,raw.indexOf("["))+JSON.stringify(pool)+raw.slice(raw.lastIndexOf("]")+1));
console.log(`\nre-sourced ${swapped} AIC works to Commons | ${aicWorks.length-swapped} stay AIC-direct (no Commons match)`);
writeFileSync("data/incoming/aic-resourced.json",JSON.stringify(log,null,1));
console.log("log → data/incoming/aic-resourced.json");
