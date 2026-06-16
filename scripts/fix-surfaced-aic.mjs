// Targeted: migrate the SURFACED (fame>=200) AIC works still on artic.edu to Commons — these are the
// user-facing ones (van Gogh, Seurat, Stieglitz…) that the strict pass skipped. Looser match (famous +
// unambiguous): title search → candidate with P18 + creator surname match. Swaps img. Run directly.
import { readFileSync, writeFileSync } from "node:fs";
const UA="GessoAICSurf/1.0 (kathryn.swint@gmail.com)";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function wd(u){for(let t=0;t<5;t++){try{const r=await fetch(u,{headers:{"User-Agent":UA}});if(r.status===429||r.status>=500){await sleep(1500*(t+1));continue;}if(!r.ok)return null;return await r.json();}catch(e){await sleep(900);}}return null;}
const claim=(e,p)=>{const c=e.claims&&e.claims[p];return c&&c[0]&&c[0].mainsnak&&c[0].mainsnak.datavalue?c[0].mainsnak.datavalue.value:null;};
const qOf=v=>v&&v.id?v.id:null;
const norm=s=>String(s||"").toLowerCase().replace(/[^a-z ]/g,"").trim();
const surname=a=>norm(a).split(/\s+/).pop();
async function label(q){if(!q)return"";const j=await wd(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=labels&languages=en&ids=${q}`);const e=j&&j.entities&&j.entities[q];return e&&e.labels&&e.labels.en?e.labels.en.value:"";}
global.window={}; new Function(readFileSync("data/fame.js","utf8"))(); const F=window.ARTEFACTUM_FAME;
const raw=readFileSync("data/pool.js","utf8");
const pool=JSON.parse(raw.slice(raw.indexOf("["),raw.lastIndexOf("]")+1));
const targets=pool.filter(p=>/artic\.edu\/iiif/.test(p.img||"")&&(F[p.id]||0)>=200&&p.title&&p.artist);
console.log("surfaced AIC works to fix:",targets.length);
const clean=t=>String(t||"").replace(/\s*[—-]\s*\d{4}.*$/,"").replace(/\s*\(\d{4}\).*$/,"").replace(/,?\s*from the series.*$/i,"").replace(/\s*\(.*?\)\s*$/,"").trim();
let swapped=0; const miss=[];
for(const p of targets){ const sn=surname(p.artist);
  const j=await wd(`https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&type=item&limit=10&search=${encodeURIComponent(clean(p.title))}`); await sleep(1400);
  const ids=(j&&j.search||[]).map(c=>c.id);
  if(!ids.length){ miss.push(p.title); continue; }
  const ej=await wd(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims&ids=${ids.slice(0,10).join("|")}`); await sleep(1000);
  let pick=null;
  for(const id of ids.slice(0,10)){ const e=ej&&ej.entities&&ej.entities[id]; if(!e)continue;
    const img=claim(e,"P18"); if(!img)continue;
    const cQ=qOf(claim(e,"P170")); const cName=cQ?await label(cQ):""; await sleep(500);
    if(sn&&sn.length>=3&&norm(cName).includes(sn)){ pick={img}; break; }
  }
  if(!pick){ miss.push(p.title); continue; }
  p.aicImg=p.img; p.img=`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(decodeURIComponent(pick.img))}?width=900`; p.src="aic-commons";
  swapped++; console.log("  ✓",p.artist.slice(0,18).padEnd(18),p.title.slice(0,38));
}
writeFileSync("data/pool.js", raw.slice(0,raw.indexOf("["))+JSON.stringify(pool)+raw.slice(raw.lastIndexOf("]")+1));
console.log(`\nswapped ${swapped}/${targets.length} | unresolved: ${miss.join(" | ")||"none"}`);
