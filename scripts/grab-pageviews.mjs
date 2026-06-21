// Grab real Wikipedia pageviews (recognizability signal) for every pool work — FREE, no AI tokens.
// For Wikidata works: resolve enwiki sitelink title (batched), then sum 12 months of pageviews.
// Writes data/incoming/pageviews.json {id: totalViews}. Resumable.
// Run: node scripts/grab-pageviews.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const UA="GessoPageviews/1.0 (kathryn.swint@gmail.com)";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const pool=JSON.parse(readFileSync("data/pool.js","utf8").match(/\[[\s\S]*\]/)[0]);
const qid=id=>{const m=String(id).match(/Q\d+/);return m?m[0]:null;};
const OUT="data/incoming/pageviews.json";
let pv={}; if(existsSync(OUT)){ try{pv=JSON.parse(readFileSync(OUT,"utf8")); }catch{} }

async function get(url){ for(let t=0;t<4;t++){ try{ const r=await fetch(url,{headers:{"User-Agent":UA}});
  if(r.status===429||r.status>=500){ await sleep(1200*(t+1)); continue; } if(r.status===404) return {__404:true}; if(!r.ok) return null; return await r.json();
}catch(e){ await sleep(900*(t+1)); } } return null; }

// 1) resolve enwiki titles for Q-id works (batched)
const need=pool.filter(p=>qid(p.id)&&!(p.id in pv));
const titleById={};
for(let i=0;i<need.length;i+=50){
  const batch=need.slice(i,i+50);
  const j=await get(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=sitelinks&sitefilter=enwiki&ids=${batch.map(p=>qid(p.id)).join("|")}`);
  if(j&&j.entities){ for(const p of batch){ const e=j.entities[qid(p.id)]; const t=e&&e.sitelinks&&e.sitelinks.enwiki&&e.sitelinks.enwiki.title;
    if(t) titleById[p.id]=t; else pv[p.id]=0; } } // no enwiki article → 0 (correctly low recognizability)
  if(i%500===0){ writeFileSync(OUT,JSON.stringify(pv)); console.error(`  titles ${i}/${need.length}`); }
  await sleep(150);
}
writeFileSync(OUT,JSON.stringify(pv));

// 2) pageviews per title (12-month sum)
const START="20240101", END="20241231";
const ids=Object.keys(titleById); let done=0;
for(const id of ids){ if(id in pv){done++;continue;} const t=titleById[id];
  const j=await get(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia.org/all-access/all-agents/${encodeURIComponent(t.replace(/ /g,"_"))}/monthly/${START}/${END}`);
  pv[id]= (j&&j.items)?j.items.reduce((a,x)=>a+(x.views||0),0):0;
  done++; if(done%150===0){ writeFileSync(OUT,JSON.stringify(pv)); console.error(`  pageviews ${done}/${ids.length} | max ${Math.max(0,...Object.values(pv))}`); }
  await sleep(80);
}
writeFileSync(OUT,JSON.stringify(pv));
const nonzero=Object.values(pv).filter(v=>v>0).length;
console.log(`DONE: pageviews for ${Object.keys(pv).length} works (${nonzero} >0) → ${OUT}`);
