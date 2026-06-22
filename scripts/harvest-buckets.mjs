// Estimate the difficulty bucket for each resolved famous-gap work using the SAME fame formula as the game:
//   fame = 120*ln(pageviews+1) + 8*ln(sitelinks+1)   (pageviews = ~last 12 months enwiki)
// Thresholds (from current pool): easy>=1104.2, medium>=69, hard>=5.5, else impossible.
import { readFileSync, writeFileSync } from "node:fs";
const UA={headers:{"User-Agent":"gesso-harvest/1.0 (kathryn.swint@gmail.com)"}};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ln=Math.log;
const resolved=JSON.parse(readFileSync("data/incoming/famous-harvest/resolved.json","utf8")).filter(r=>r.image);
const MONTHS=["20250601","20250701","20250801","20250901","20251001","20251101","20251201","20260101","20260201","20260301","20260401","20260501"];

async function sitelinksAndTitle(qid){
  const r=await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&origin=*&props=sitelinks&ids=${qid}`,UA);
  const j=await r.json(); const sl=j.entities&&j.entities[qid]&&j.entities[qid].sitelinks||{};
  return { count:Object.keys(sl).length, en: sl.enwiki?sl.enwiki.title:null };
}
async function pageviews(title){
  const t=encodeURIComponent(title.replace(/ /g,"_"));
  const url=`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${t}/monthly/${MONTHS[0]}/20260531`;
  try{ const r=await fetch(url,UA); if(!r.ok)return 0; const j=await r.json(); return (j.items||[]).reduce((a,b)=>a+(b.views||0),0); }catch{ return 0; }
}
const bucket=f=> f>=1104.2?"easy":f>=69?"medium":f>=5.5?"hard":"impossible";
const out=[];
for(const w of resolved){
  const {count:sl,en}=await sitelinksAndTitle(w.qid); await sleep(120);
  const pv= en ? await pageviews(en) : 0; await sleep(120);
  const fame=Math.round((120*ln(pv+1)+8*ln(sl+1))*10)/10;
  out.push({title:w.title,artist:w.artist,qid:w.qid,isArtwork:w.isArtwork,sitelinks:sl,pageviews:pv,fame,bucket:bucket(fame)});
}
out.sort((a,b)=>b.fame-a.fame);
writeFileSync("data/incoming/famous-harvest/buckets.json",JSON.stringify(out,null,1));
const cnt={easy:0,medium:0,hard:0,impossible:0}; for(const o of out)cnt[o.bucket]++;
console.error("BUCKET COUNTS:",JSON.stringify(cnt),"of",out.length);
console.error("\nEASY:"); for(const o of out.filter(o=>o.bucket==="easy"))console.error(`  ${o.fame}  ${o.title} — ${o.artist}${o.isArtwork?"":" [!not-artwork?]"}`);
console.error("\nMEDIUM:"); for(const o of out.filter(o=>o.bucket==="medium"))console.error(`  ${o.fame}  ${o.title} — ${o.artist}${o.isArtwork?"":" [!]"}`);
console.error("\nHARD:"); for(const o of out.filter(o=>o.bucket==="hard"))console.error(`  ${o.fame}  ${o.title} — ${o.artist}`);
console.error("\nIMPOSSIBLE:"); for(const o of out.filter(o=>o.bucket==="impossible"))console.error(`  ${o.fame}  ${o.title} — ${o.artist}`);
