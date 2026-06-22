import { readFileSync, writeFileSync } from "node:fs";
const UA={headers:{"User-Agent":"gesso-harvest/1.0 (kathryn.swint@gmail.com)"}};
const sleep=ms=>new Promise(r=>setTimeout(r,ms)); const ln=Math.log;
const arr=JSON.parse(readFileSync("data/incoming/famous-harvest/buckets.json","utf8"));
async function sl(qid){ for(let t=0;t<4;t++){ try{ const r=await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&origin=*&props=sitelinks&ids=${qid}`,UA); if(r.ok){ const j=await r.json(); const s=(j.entities[qid]&&j.entities[qid].sitelinks)||{}; return {count:Object.keys(s).length, en:s.enwiki?s.enwiki.title:null}; } }catch{} await sleep(500*(t+1)); } return {count:0,en:null}; }
async function pv(title){ for(let t=0;t<4;t++){ try{ const u=`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodeURIComponent(title.replace(/ /g,"_"))}/monthly/20250601/20260531`; const r=await fetch(u,UA); if(r.ok){ const j=await r.json(); return (j.items||[]).reduce((a,b)=>a+(b.views||0),0); } if(r.status===404) return 0; }catch{} await sleep(500*(t+1)); } return -1; }
const bucket=f=> f>=1104.2?"easy":f>=69?"medium":f>=5.5?"hard":"impossible";
const low=arr.filter(o=>o.fame<100);
for(const o of low){ const s=await sl(o.qid); await sleep(300); let p=0; if(s.en) p=await pv(s.en); await sleep(300);
  if(p>=0){ o.sitelinks=s.count; o.pageviews=p; o.fame=Math.round((120*ln(p+1)+8*ln(s.count+1))*10)/10; o.bucket=bucket(o.fame); o.fixed=true; } }
writeFileSync("data/incoming/famous-harvest/buckets.json",JSON.stringify(arr,null,1));
const c={easy:0,medium:0,hard:0,impossible:0}; for(const o of arr)c[o.bucket]++;
console.error("FINAL BUCKET COUNTS:",JSON.stringify(c),"of",arr.length);
console.error("\nstill hard/impossible after retry:");
for(const o of arr.filter(o=>o.bucket==="hard"||o.bucket==="impossible").sort((a,b)=>a.fame-b.fame)) console.error(`  ${o.bucket} ${o.fame}  ${o.title} — ${o.artist}`);
