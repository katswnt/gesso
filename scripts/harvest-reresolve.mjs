// Re-resolve the mis-picked works: choose the search candidate that is an ARTWORK with the MOST sitelinks
// (the famous piece, not a stub/concept). Recompute fame+bucket and pull image/date/etc.
import { readFileSync, writeFileSync } from "node:fs";
const UA={headers:{"User-Agent":"gesso-harvest/1.0 (kathryn.swint@gmail.com)"}};
const sleep=ms=>new Promise(r=>setTimeout(r,ms)); const ln=Math.log;
async function getJSON(u){ for(let t=0;t<5;t++){ try{ const r=await fetch(u,UA); if(r.ok)return await r.json(); if(r.status===404)return null; }catch{} await sleep(800*(t+1)); } return undefined; }
const ARTWORK=new Set(["Q3305213","Q860861","Q11060274","Q93184","Q838948","Q4502142","Q179700","Q2088357","Q15709879","Q15727816","Q860626","Q18573970","Q133067","Q2293986"]);
async function search(title){ const j=await getJSON(`https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&origin=*&language=en&type=item&limit=12&search=${encodeURIComponent(title)}`); return j?(j.search||[]).map(x=>x.id):[]; }
async function entities(ids){ const j=await getJSON(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&origin=*&props=claims|sitelinks&ids=${ids.join("|")}`); return j?(j.entities||{}):{}; }
async function pageviews(title){ const j=await getJSON(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodeURIComponent(title.replace(/ /g,"_"))}/monthly/20250601/20260531`); if(j===null)return 0; if(j===undefined)return -1; return (j.items||[]).reduce((a,b)=>a+(b.views||0),0); }
const cv=(e,p)=>{const cs=e.claims&&e.claims[p];return cs?cs.map(c=>c.mainsnak&&c.mainsnak.datavalue&&c.mainsnak.datavalue.value).filter(Boolean):[];};
const qids=v=>v.map(x=>x&&x.id).filter(Boolean);
const bucket=f=> f>=1104.2?"easy":f>=69?"medium":f>=5.5?"hard":"impossible";

const arr=JSON.parse(readFileSync("data/incoming/famous-harvest/buckets.json","utf8"));
const resolved=JSON.parse(readFileSync("data/incoming/famous-harvest/resolved.json","utf8"));
const fix=arr.filter(o=>o.bucket==="hard"||o.bucket==="impossible");
for(const o of fix){ await sleep(500);
  const ids=await search(o.title); if(!ids.length){ o.note="no-hit"; continue; }
  await sleep(400); const ents=await entities(ids.slice(0,12));
  let best=null;
  for(const id of ids){ const e=ents[id]; if(!e)continue; const types=new Set(qids(cv(e,"P31")));
    const isArt=[...types].some(t=>ARTWORK.has(t)); if(!isArt)continue;
    const sl=e.sitelinks?Object.keys(e.sitelinks).length:0; const en=e.sitelinks&&e.sitelinks.enwiki?e.sitelinks.enwiki.title:null;
    if(!best||sl>best.sl) best={id,e,sl,en}; }
  if(!best){ o.note="no-artwork-candidate"; continue; }
  await sleep(400); let pv= best.en? await pageviews(best.en):0; if(pv<0)pv=0;
  const inc=cv(best.e,"P571")[0]; const yr= inc?(()=>{const m=String(inc.time).match(/([+-]\d+)/);return m?parseInt(m[1],10):null;})():null;
  const img=cv(best.e,"P18")[0];
  o.qid=best.id; o.sitelinks=best.sl; o.pageviews=pv; o.en=best.en; o.fame=Math.round((120*ln(pv+1)+8*ln(best.sl+1))*10)/10; o.bucket=bucket(o.fame); o.note="reresolved";
  o.year=yr; o.image= img? "https://commons.wikimedia.org/wiki/Special:FilePath/"+encodeURIComponent(img.replace(/ /g,"_"))+"?width=900":null;
  o.material=qids(cv(best.e,"P186")); o.movementQ=qids(cv(best.e,"P135")); o.locCreationQ=qids(cv(best.e,"P1071")); o.countryOriginQ=qids(cv(best.e,"P495"));
}
writeFileSync("data/incoming/famous-harvest/buckets.json",JSON.stringify(arr,null,1));
const c={easy:0,medium:0,hard:0,impossible:0}; for(const o of arr)c[o.bucket]++;
console.error("RE-RESOLVED COUNTS:",JSON.stringify(c));
for(const o of fix.sort((a,b)=>b.fame-a.fame)) console.error(`  ${o.bucket}\t${o.fame}\tsl=${o.sitelinks}\t${o.title} — ${o.artist}\t${o.image?"IMG":"no-img"} (${o.note})`);
