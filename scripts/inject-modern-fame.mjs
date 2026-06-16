// Fetch sitelinks + 12-month enwiki pageviews for the newly-promoted modern works and inject them
// into data/fame.json, then rebuild fame.js via make-fame-js. Surgical (only new ids), not a full rescore.
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
const UA="GessoModernFame/1.0 (kathryn.swint@gmail.com)";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const pool=JSON.parse(readFileSync("data/pool.js","utf8").match(/\[[\s\S]*\]/)[0]);
const fame=JSON.parse(readFileSync("data/fame.json","utf8"));
const qid=id=>{const m=String(id).match(/Q\d+/);return m?m[0]:null;};
const need=pool.filter(p=>p.src==="wd-modern" && !(p.id in fame) && qid(p.id));
async function get(u){for(let t=0;t<4;t++){try{const r=await fetch(u,{headers:{"User-Agent":UA}});if(r.status===429||r.status>=500){await sleep(1200*(t+1));continue;}if(r.status===404)return{__404:1};if(!r.ok)return null;return await r.json();}catch(e){await sleep(900);}}return null;}
console.log("injecting fame for",need.length,"modern works…");
for(const p of need){ const q=qid(p.id);
  const j=await get(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=sitelinks&ids=${q}`); await sleep(120);
  const e=j&&j.entities&&j.entities[q]; const sl=e&&e.sitelinks?Object.keys(e.sitelinks).length:0;
  const t=e&&e.sitelinks&&e.sitelinks.enwiki?e.sitelinks.enwiki.title:null;
  let pv=0;
  if(t){ const pj=await get(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia.org/all-access/all-agents/${encodeURIComponent(t.replace(/ /g,"_"))}/monthly/20240101/20241231`); await sleep(100);
    pv=(pj&&pj.items)?pj.items.reduce((a,x)=>a+(x.views||0),0):0; }
  fame[p.id]={wikidata:q,sitelinks:sl,pageviews:pv,fame:0,tier:"medium"};
  console.log(`  ${p.title.padEnd(38)} sl=${String(sl).padStart(3)} pv=${pv}`);
}
writeFileSync("data/fame.json",JSON.stringify(fame,null,2)+"\n");
console.log("→ rebuilding fame.js");
execSync("node scripts/make-fame-js.mjs",{stdio:"inherit"});
