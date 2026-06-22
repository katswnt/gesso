import { readFileSync, writeFileSync } from "node:fs";
const UA={headers:{"User-Agent":"gesso-harvest/1.0 (kathryn.swint@gmail.com)"}};
const sleep=ms=>new Promise(r=>setTimeout(r,ms)); const ln=Math.log;
const arr=JSON.parse(readFileSync("data/incoming/famous-harvest/buckets.json","utf8"));
async function getJSON(u){ for(let t=0;t<5;t++){ try{ const r=await fetch(u,UA); if(r.ok) return await r.json(); if(r.status===404) return null; }catch{} await sleep(900*(t+1)); } return undefined; }
async function sitelinks(qid){ const j=await getJSON(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&origin=*&props=sitelinks&ids=${qid}`); if(!j||!j.entities||!j.entities[qid]) return {count:-1,en:null}; const s=j.entities[qid].sitelinks||{}; return {count:Object.keys(s).length, en:s.enwiki?s.enwiki.title:null}; }
async function pageviews(title){ const j=await getJSON(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodeURIComponent(title.replace(/ /g,"_"))}/monthly/20250601/20260531`); if(j===null) return 0; if(j===undefined) return -1; return (j.items||[]).reduce((a,b)=>a+(b.views||0),0); }
const bucket=f=> f>=1104.2?"easy":f>=69?"medium":f>=5.5?"hard":"impossible";
const fix=arr.filter(o=>o.bucket==="hard"||o.bucket==="impossible");
for(const o of fix){ await sleep(700); const s=await sitelinks(o.qid); if(s.count<0){ o.note="sitelinks-fail"; continue; }
  await sleep(700); let p=0; if(s.en) p=await pageviews(s.en); if(p<0){ o.note="pv-fail"; continue; }
  o.sitelinks=s.count; o.pageviews=p; o.en=s.en; o.fame=Math.round((120*ln(p+1)+8*ln(s.count+1))*10)/10; o.bucket=bucket(o.fame); o.note="refetched"; }
writeFileSync("data/incoming/famous-harvest/buckets.json",JSON.stringify(arr,null,1));
const c={easy:0,medium:0,hard:0,impossible:0}; for(const o of arr)c[o.bucket]++;
console.error("CORRECTED COUNTS:",JSON.stringify(c));
console.error("\nrefetched set:");
for(const o of fix.sort((a,b)=>b.fame-a.fame)) console.error(`  ${o.bucket}\t${o.fame}\t${o.title} — ${o.artist}\t(${o.note||""}, en=${o.en||"?"})`);
