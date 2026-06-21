// Fetch US-public-domain modern works (rolling PD + already-free moderns). Resolves seed (title+artist)
// → Wikidata, keeps ONLY: has Commons image AND inception <1931 AND creator died ≤1955 (US-safe rule).
// Dedups vs pool. Writes data/incoming/modern-fetched.json (+ drops with reasons). Run: node scripts/fetch-modern.mjs
import { readFileSync, writeFileSync } from "node:fs";
const UA="GessoModern/1.0 (kathryn.swint@gmail.com)";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const seed=JSON.parse(readFileSync("data/incoming/modern-seed.json","utf8"));
const poolQ=new Set(JSON.parse(readFileSync("data/pool.js","utf8").match(/\[[\s\S]*\]/)[0]).map(p=>{const m=String(p.id).match(/Q\d+/);return m?m[0]:null;}).filter(Boolean));
global.window={}; new Function(readFileSync("data/countries.js","utf8"))();
const CO={}; for(const c of window.ARTEFACTUM_COUNTRIES) CO[c.n.toLowerCase()]=c;
const ALIAS={"united states":"united states of america","kingdom of the netherlands":"netherlands"};
const toCountry=l=>{if(!l)return"";let c=l.toLowerCase().trim();c=ALIAS[c]||c;return CO[c]?CO[c].n:""};
const CONT={"united states of america":"North America","russia":"Europe","france":"Europe","germany":"Europe","austria":"Europe","netherlands":"Europe","norway":"Europe","italy":"Europe","spain":"Europe","united kingdom":"Europe","belgium":"Europe","switzerland":"Europe"};
async function wd(u){for(let t=0;t<4;t++){try{const r=await fetch(u,{headers:{"User-Agent":UA}});if(r.status===429||r.status>=500){await sleep(1500*(t+1));continue;}if(!r.ok)return null;return await r.json();}catch(e){await sleep(900*(t+1));}}return null;}
const claim=(e,p)=>{const c=e.claims&&e.claims[p];return c&&c[0]&&c[0].mainsnak&&c[0].mainsnak.datavalue?c[0].mainsnak.datavalue.value:null;};
const qOf=v=>v&&v.id?v.id:null;
const yearOf=t=>{if(!t||!t.time)return null;const m=t.time.match(/([+-]\d+)/);return m?parseInt(m[1],10):null;};
async function label(q){if(!q)return"";const j=await wd(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=labels&languages=en&ids=${q}`);const e=j&&j.entities&&j.entities[q];return e&&e.labels&&e.labels.en?e.labels.en.value:"";}
async function deathYear(q){if(!q)return null;const j=await wd(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims&ids=${q}`);const e=j&&j.entities&&j.entities[q];return e?yearOf(claim(e,"P570")):null;}
async function countryOf(q){if(!q)return"";const j=await wd(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims|labels&languages=en&ids=${q}`);const e=j&&j.entities&&j.entities[q];if(!e)return"";const c=qOf(claim(e,"P17"));if(c)return await label(c);return e.labels&&e.labels.en?e.labels.en.value:"";}
async function search(title,artist){
  for(const q of [title+" "+artist,title]){const j=await wd(`https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&type=item&limit=6&search=${encodeURIComponent(q)}`);
    const hit=(j&&j.search||[]).find(x=>/painting|sculpture|artwork|drawing|by /i.test(x.description||"")); if(hit)return hit.id;
    if(j&&j.search&&j.search[0]&&q===title)return j.search[0].id;}
  return null;
}
const out=[],dropped=[];
for(const m of seed){ const qid=await search(m.title,m.artist); await sleep(150);
  if(!qid){dropped.push({...m,why:"no Q-id"});continue;}
  if(poolQ.has(qid)){dropped.push({...m,why:"already in pool"});continue;}
  const j=await wd(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims|labels&languages=en&ids=${qid}`); await sleep(150);
  const e=j&&j.entities&&j.entities[qid]; if(!e){dropped.push({...m,why:"no entity"});continue;}
  const img=claim(e,"P18"); if(!img){dropped.push({...m,why:"no Commons image (likely still in copyright)"});continue;}
  const y=yearOf(claim(e,"P571"));
  const creatorQ=qOf(claim(e,"P170")); const dY=await deathYear(creatorQ); await sleep(120);
  if(y!=null && y>=1931){dropped.push({...m,qid,why:`inception ${y} ≥1931 (not yet US-PD)`});continue;}
  if(dY!=null && dY>1955){dropped.push({...m,qid,why:`creator d.${dY} >1955 (URAA risk — skip)`});continue;}
  const creator=await label(creatorQ)||m.artist; await sleep(100);
  const placeRaw=await countryOf(qOf(claim(e,"P1071"))||qOf(claim(e,"P276"))); await sleep(100);
  const place=toCountry(placeRaw)||"";
  const medium=await label(qOf(claim(e,"P186")))||""; await sleep(100);
  const movement=await label(qOf(claim(e,"P135")))||""; await sleep(100);
  out.push({id:"wikidata:"+qid,title:m.title,artist:creator,y,place,region:place?(CONT[place.toLowerCase()]||"Europe"):"Europe",
    medium,style:movement,styleKind:movement?"movement":"",img:`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(img)}?width=900`,src:"wd-modern"});
  console.error(`✓ ${m.title} — ${creator} | ${y||"?"} | d.${dY||"?"} | ${place||"?"}`);
}
writeFileSync("data/incoming/modern-fetched.json",JSON.stringify(out,null,1));
writeFileSync("data/incoming/modern-dropped.json",JSON.stringify(dropped,null,1));
console.log(`\nKEPT ${out.length} US-PD modern works | dropped ${dropped.length}`);
const byReason={};dropped.forEach(d=>byReason[d.why]=(byReason[d.why]||0)+1);console.log("drop reasons:",JSON.stringify(byReason,null,0));
