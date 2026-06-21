// Re-fetch pageviews for wd-modern works whose fame.json pageviews==0 (rate-limit casualties).
// Slower/gentler than the bulk pass. Rebuilds fame.js. Run: node scripts/refetch-modern-pv.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
const UA="GessoModernFame/1.0 (kathryn.swint@gmail.com)";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const qid=id=>{const m=String(id).match(/Q\d+/);return m?m[0]:null;};
async function get(u){for(let t=0;t<6;t++){try{const r=await fetch(u,{headers:{"User-Agent":UA}});if(r.status===429||r.status>=500){await sleep(2500*(t+1));continue;}if(r.status===404)return{__404:1};if(!r.ok)return null;return await r.json();}catch(e){await sleep(1500*(t+1));}}return null;}
const pool=JSON.parse(readFileSync("data/pool.js","utf8").match(/\[[\s\S]*\]/)[0]);
const fame=JSON.parse(readFileSync("data/fame.json","utf8"));
const targets=pool.filter(p=>p.src==="wd-modern"&&fame[p.id]&&fame[p.id].pageviews===0);
console.log("re-fetching pageviews for",targets.length,"works…");
for(const p of targets){ const q=qid(p.id);
  const sj=await get(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=sitelinks&ids=${q}`); await sleep(400);
  const e=sj&&sj.entities&&sj.entities[q]; const sl=e&&e.sitelinks?Object.keys(e.sitelinks).length:fame[p.id].sitelinks;
  const t=e&&e.sitelinks&&e.sitelinks.enwiki?e.sitelinks.enwiki.title:null;
  let pv=0;
  if(t){ const pj=await get(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia.org/all-access/all-agents/${encodeURIComponent(t.replace(/ /g,"_"))}/monthly/20240101/20241231`); await sleep(400);
    pv=(pj&&pj.items)?pj.items.reduce((a,x)=>a+(x.views||0),0):0; }
  fame[p.id]={...fame[p.id],sitelinks:sl,pageviews:pv};
  console.log(`  ${p.title.padEnd(36)} enwiki=${t?"y":"n"} sl=${sl} pv=${pv}`);
}
writeFileSync("data/fame.json",JSON.stringify(fame,null,2)+"\n");
console.log("→ rebuilding fame.js"); execSync("node scripts/make-fame-js.mjs",{stdio:"inherit"});
