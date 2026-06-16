// Post-promote cleanup for the modern cohort: (1) fix Léger "The City" (city-concept collision) &
// verify "Three Women"; (2) capitalize lowercase mediums; (3) re-fetch pageviews for pv==0 works.
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
const UA="GessoFixModern/1.0 (kathryn.swint@gmail.com)";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function get(u){for(let t=0;t<4;t++){try{const r=await fetch(u,{headers:{"User-Agent":UA}});if(r.status===429||r.status>=500){await sleep(1200*(t+1));continue;}if(r.status===404)return{__404:1};if(!r.ok)return null;return await r.json();}catch(e){await sleep(900);}}return null;}
const claim=(e,p)=>{const c=e.claims&&e.claims[p];return c&&c[0]&&c[0].mainsnak&&c[0].mainsnak.datavalue?c[0].mainsnak.datavalue.value:null;};
const yearOf=t=>{if(!t||!t.time)return null;const m=t.time.match(/([+-]\d+)/);return m?parseInt(m[1],10):null;};
const qid=id=>{const m=String(id).match(/Q\d+/);return m?m[0]:null;};
global.window={}; new Function(readFileSync("data/countries.js","utf8"))();
const CO={}; for(const c of window.ARTEFACTUM_COUNTRIES) CO[c.n.toLowerCase()]=c;
function centroid(c){ let big=c.r[0]; for(const r of c.r) if(r.length>big.length) big=r; let sx=0,sy=0; for(const[x,y]of big){sx+=x;sy+=y;} return [Math.round(sy/big.length*1000)/1000,Math.round(sx/big.length*1000)/1000]; }

const raw=readFileSync("data/pool.js","utf8");
const pool=JSON.parse(raw.slice(raw.indexOf("["),raw.lastIndexOf("]")+1));
const have=new Set(pool.map(p=>p.id));

// (1) fix "The City" — find the Léger painting (has P18, creator Léger, inception<1931)
async function findLegerCity(){
  const j=await get(`https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&type=item&limit=15&search=${encodeURIComponent("The City")}`);
  for(const c of (j&&j.search||[])){ if(!/léger|leger/i.test(c.description||"")) continue;
    const ej=await get(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims&ids=${c.id}`); await sleep(150);
    const e=ej&&ej.entities&&ej.entities[c.id]; if(e&&claim(e,"P18")) return {id:c.id,img:claim(e,"P18"),y:yearOf(claim(e,"P571"))};
  }
  // fallback: French label "La Ville"
  const k=await get(`https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=fr&type=item&limit=15&search=${encodeURIComponent("La Ville Léger")}`);
  for(const c of (k&&k.search||[])){ const ej=await get(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims&ids=${c.id}`); await sleep(150);
    const e=ej&&ej.entities&&ej.entities[c.id]; const cr=claim(e,"P170"); if(e&&claim(e,"P18")&&cr&&cr.id==="Q153793") return {id:c.id,img:claim(e,"P18"),y:yearOf(claim(e,"P571"))}; }
  return null;
}
const idx=pool.findIndex(p=>p.id==="wikidata:Q23311");
if(idx>=0){ const fix=await findLegerCity();
  if(fix && !have.has("wikidata:"+fix.id)){ const co=CO["france"]; const [lat,lng]=centroid(co);
    pool[idx]={...pool[idx], id:"wikidata:"+fix.id, y:fix.y||1919, lat, lng, place:"France",
      img:`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fix.img)}?width=900`};
    console.log("fixed The City →", fix.id, "y="+(fix.y||1919));
  } else { pool.splice(idx,1); console.log("dropped The City (no clean Léger match)"); }
}
// (2) verify "Three Women" Q669622 is the Léger painting
{ const e=(await get(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims|labels&ids=Q669622`)).entities.Q669622;
  const cr=claim(e,"P170"); const ok=cr&&cr.id==="Q153793"&&claim(e,"P18");
  console.log("Three Women Q669622:", ok?"OK (Léger painting)":"SUSPECT — creator "+(cr&&cr.id)); }

// (3) capitalize lowercase mediums on the modern cohort
const CAP={"oil paint":"Oil paint","paper":"Paper","bronze":"Bronze","watercolor":"Watercolor","tempera":"Tempera"};
let capped=0; for(const p of pool){ if(p.src==="wd-modern"&&CAP[p.medium]){ p.medium=CAP[p.medium]; capped++; } }
console.log("capitalized mediums:",capped);
writeFileSync("data/pool.js", raw.slice(0,raw.indexOf("["))+JSON.stringify(pool)+raw.slice(raw.lastIndexOf("]")+1));

// (4) re-fetch pageviews for wd-modern works with pv==0 in fame.json
const fame=JSON.parse(readFileSync("data/fame.json","utf8"));
const zero=pool.filter(p=>p.src==="wd-modern"&&fame[p.id]&&fame[p.id].pageviews===0);
console.log("re-fetching pageviews for",zero.length,"zero-pv works…");
for(const p of zero){ const q=qid(p.id);
  const sj=await get(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=sitelinks&ids=${q}`); await sleep(120);
  const e=sj&&sj.entities&&sj.entities[q]; const sl=e&&e.sitelinks?Object.keys(e.sitelinks).length:0;
  const t=e&&e.sitelinks&&e.sitelinks.enwiki?e.sitelinks.enwiki.title:null;
  let pv=0; if(t){ const pj=await get(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia.org/all-access/all-agents/${encodeURIComponent(t.replace(/ /g,"_"))}/monthly/20240101/20241231`); await sleep(100);
    pv=(pj&&pj.items)?pj.items.reduce((a,x)=>a+(x.views||0),0):0; }
  fame[p.id]={wikidata:q,sitelinks:sl,pageviews:pv,fame:0,tier:"medium"};
  console.log(`  ${p.title.padEnd(34)} sl=${sl} pv=${pv}`);
}
// also add a fame entry for any newly-swapped id (The City fix) missing from fame.json
for(const p of pool){ if(p.src==="wd-modern"&&!fame[p.id]){ const q=qid(p.id);
  const sj=await get(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=sitelinks&ids=${q}`); await sleep(120);
  const e=sj&&sj.entities&&sj.entities[q]; const sl=e&&e.sitelinks?Object.keys(e.sitelinks).length:0;
  const t=e&&e.sitelinks&&e.sitelinks.enwiki?e.sitelinks.enwiki.title:null; let pv=0;
  if(t){ const pj=await get(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia.org/all-access/all-agents/${encodeURIComponent(t.replace(/ /g,"_"))}/monthly/20240101/20241231`); await sleep(100); pv=(pj&&pj.items)?pj.items.reduce((a,x)=>a+(x.views||0),0):0; }
  fame[p.id]={wikidata:q,sitelinks:sl,pageviews:pv,fame:0,tier:"medium"}; console.log(`  +${p.title} sl=${sl} pv=${pv}`); } }
writeFileSync("data/fame.json",JSON.stringify(fame,null,2)+"\n");
console.log("→ rebuilding fame.js"); execSync("node scripts/make-fame-js.mjs",{stdio:"inherit"});
