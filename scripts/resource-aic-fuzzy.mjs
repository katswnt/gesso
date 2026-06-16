// Migrate AIC images -> Wikimedia Commons by STRICT match (AIC's Cloudflare blocks all proxies +
// challenges mobile IPs, so AIC URLs break for phone users; Commons CDN is reliable). For each AIC
// work still on artic.edu, find a Wikidata item with: title hit + creator surname match + inception
// within ±2y + a P18 image + an artwork P31. Swap img->Commons, src->aic-commons. Keeps aicImg.
// Conservative to avoid the Olympia/Irises wrong-image trap. Run: node scripts/resource-aic-fuzzy.mjs
import { readFileSync, writeFileSync } from "node:fs";
const UA="GessoAICMigrate/1.0 (kathryn.swint@gmail.com)";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function wd(u){for(let t=0;t<5;t++){try{const r=await fetch(u,{headers:{"User-Agent":UA}});if(r.status===429||r.status>=500){await sleep(1500*(t+1));continue;}if(!r.ok)return null;return await r.json();}catch(e){await sleep(900);}}return null;}
const claim=(e,p)=>{const c=e.claims&&e.claims[p];return c&&c[0]&&c[0].mainsnak&&c[0].mainsnak.datavalue?c[0].mainsnak.datavalue.value:null;};
const claimsAll=(e,p)=>((e.claims&&e.claims[p])||[]).map(c=>c.mainsnak.datavalue&&c.mainsnak.datavalue.value).filter(Boolean);
const qOf=v=>v&&v.id?v.id:null;
const yearOf=t=>{if(!t||!t.time)return null;const m=t.time.match(/([+-]\d+)/);return m?parseInt(m[1],10):null;};
async function label(q){if(!q)return"";const j=await wd(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=labels&languages=en&ids=${q}`);const e=j&&j.entities&&j.entities[q];return e&&e.labels&&e.labels.en?e.labels.en.value:"";}
const surname=a=>String(a||"").toLowerCase().replace(/[^a-z\s].*/,"").trim().split(/\s+/).pop();
const norm=s=>String(s||"").toLowerCase().replace(/[^a-z0-9 ]/g,"").replace(/\s+/g," ").trim();
// artwork P31s we accept (painting, drawing, print, sculpture, photograph, etc.)
const ARTWORK=new Set(["Q3305213","Q93184","Q11060274","Q125191","Q860861","Q11835431","Q179700","Q4502142","Q838948","Q15709879","Q18761202","Q21281546","Q2647254","Q1278452"]);

const raw=readFileSync("data/pool.js","utf8");
const pool=JSON.parse(raw.slice(raw.indexOf("["),raw.lastIndexOf("]")+1));
const have=new Set(pool.map(p=>{const m=String(p.id).match(/Q\d+/);return m?m[0]:null;}).filter(Boolean));
const targets=pool.filter(p=>/artic\.edu\/iiif/.test(p.img||"")&&p.title&&p.artist);
console.log("AIC works still on artic.edu (with title+artist):",targets.length);

let swapped=0, checked=0; const log=[];
for(const p of targets){ checked++;
  const sn=surname(p.artist); if(!sn||sn.length<3) continue;
  const j=await wd(`https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&type=item&limit=8&search=${encodeURIComponent(p.title)}`); await sleep(160);
  const cands=(j&&j.search||[]).filter(c=>(c.description||"").toLowerCase().includes(sn)||/painting|drawing|print|sculpture|photograph|artwork/.test((c.description||"").toLowerCase()));
  if(!cands.length){ if(checked%50===0)console.error(`  ${checked}/${targets.length} | ${swapped} swapped`); continue; }
  const ids=cands.slice(0,6).map(c=>c.id);
  const ej=await wd(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims|labels&languages=en&ids=${ids.join("|")}`); await sleep(160);
  let pick=null;
  for(const id of ids){ const e=ej&&ej.entities&&ej.entities[id]; if(!e) continue;
    if(have.has(id)) continue;                                   // already in pool elsewhere
    const img=claim(e,"P18"); if(!img) continue;
    const p31=claimsAll(e,"P31").map(qOf); if(!p31.some(q=>ARTWORK.has(q))) continue;   // must be an artwork
    const y=yearOf(claim(e,"P571")); if(p.y!=null && y!=null && Math.abs(y-p.y)>2) continue;  // year guard
    const creatorL=(e.labels&&e.labels.en?e.labels.en.value:"");                            // not creator; skip
    pick={id,img}; break;
  }
  // verify creator surname on the picked item
  if(pick){ const e=ej.entities[pick.id]; const cQ=qOf(claim(e,"P170"));
    const cName=cQ?await label(cQ):""; await sleep(120);
    if(!norm(cName).includes(sn)){ pick=null; }                 // creator must match → blocks wrong-artwork collisions
  }
  if(!pick){ if(checked%50===0)console.error(`  ${checked}/${targets.length} | ${swapped} swapped`); continue; }
  const file=decodeURIComponent(pick.img);
  p.aicImg=p.img; p.img=`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=900`; p.src="aic-commons";
  have.add(pick.id); swapped++; log.push(`${p.id} ${pick.id}  ${p.artist.slice(0,20)} — ${p.title.slice(0,40)}`);
  if(checked%50===0)console.error(`  ${checked}/${targets.length} | ${swapped} swapped`);
}
writeFileSync("data/pool.js", raw.slice(0,raw.indexOf("["))+JSON.stringify(pool)+raw.slice(raw.lastIndexOf("]")+1));
writeFileSync("data/incoming/aic-fuzzy-resourced.json",JSON.stringify(log,null,1));
console.log(`\nMIGRATED ${swapped} more AIC works -> Commons (of ${targets.length}) | log: data/incoming/aic-fuzzy-resourced.json`);
const left=pool.filter(p=>/artic\.edu\/iiif/.test(p.img||"")).length;
console.log(`AIC-direct remaining: ${left} (no safe Commons match — mostly prints/photos not on Commons)`);
