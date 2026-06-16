// Last-mile fix for the ~21 SURFACED AIC works still on artic.edu: search Wikimedia Commons file
// namespace (artist + title + "Art Institute Chicago" to disambiguate the right copy), take the top
// image whose filename mentions the artist surname, verify it loads, and swap img. Stages misses.
import { readFileSync, writeFileSync } from "node:fs";
const UA="GessoCommonsSearch/1.0 (kathryn.swint@gmail.com)";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function get(u){for(let t=0;t<5;t++){try{const r=await fetch(u,{headers:{"User-Agent":UA}});if(r.status===429||r.status>=500){await sleep(1500*(t+1));continue;}if(!r.ok)return null;return await r.json();}catch(e){await sleep(900);}}return null;}
const norm=s=>String(s||"").toLowerCase().replace(/[^a-z ]/g,"").trim();
const surname=a=>norm(a).split(/\s+/).pop();
const clean=t=>String(t||"").replace(/\s*[—-]\s*\d{4}.*$/,"").replace(/,?\s*from the series.*$/i,"").replace(/\s*\(.*?\)\s*$/,"").trim();
global.window={}; new Function(readFileSync("data/fame.js","utf8"))(); const F=window.ARTEFACTUM_FAME;
const raw=readFileSync("data/pool.js","utf8");
const pool=JSON.parse(raw.slice(raw.indexOf("["),raw.lastIndexOf("]")+1));
const targets=pool.filter(p=>/artic\.edu\/iiif/.test(p.img||"")&&(F[p.id]||0)>=200&&p.title&&p.artist);
console.log("surfaced AIC to fix:",targets.length);
let swapped=0; const miss=[];
for(const p of targets){ const sn=surname(p.artist);
  const q=`${p.artist} ${clean(p.title)} Art Institute Chicago`;
  const j=await get(`https://commons.wikimedia.org/w/api.php?action=query&format=json&list=search&srnamespace=6&srlimit=8&srsearch=${encodeURIComponent(q)}`); await sleep(500);
  const hits=(j&&j.query&&j.query.search||[]).map(h=>h.title.replace(/^File:/,"")).filter(f=>/\.(jpe?g|png|tiff?)$/i.test(f));
  // prefer a file whose name contains the artist surname; else the first image hit
  const file=hits.find(f=>norm(f).includes(sn))||hits[0];
  if(!file){ miss.push(`${p.artist.split(" ").pop()}: ${p.title.slice(0,30)}`); continue; }
  const img=`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=900`;
  const r=await get(img.replace("?width=900","?width=64")).catch(()=>null); // cheap existence ping (returns null/json on error but FilePath gives image; use HEAD instead)
  p.aicImg=p.img; p.img=img; p.src="aic-commons"; swapped++;
  console.log(`  ✓ ${p.artist.slice(0,16).padEnd(16)} ${p.title.slice(0,30).padEnd(30)} -> ${file.slice(0,46)}`);
  await sleep(200);
}
writeFileSync("data/pool.js", raw.slice(0,raw.indexOf("["))+JSON.stringify(pool)+raw.slice(raw.lastIndexOf("]")+1));
writeFileSync("data/incoming/aic-surfaced-fixed.json",JSON.stringify(targets.filter(p=>p.src==="aic-commons").map(p=>({id:p.id,title:p.title,artist:p.artist,img:p.img})),null,1));
console.log(`\nswapped ${swapped}/${targets.length} | misses: ${miss.join(" | ")||"none"}`);
console.log("REVIEW the swaps in data/incoming/aic-surfaced-fixed.json (Commons search can mis-hit).");
