// Promote staged wishlist works (data/incoming/wishlist-fetched.json) into the pool, geocode origin,
// inject sitelinks+pageviews fame for the new ids (so tiers come from real recognizability, not a flat
// placeholder), rebuild fame.js, run audits. No bulk canon-tagging. Run: node scripts/promote-wishlist.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
const UA="GessoWishlistPromote/1.0 (kathryn.swint@gmail.com)";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const adds=JSON.parse(readFileSync("data/incoming/wishlist-fetched.json","utf8"));
global.window={}; new Function(readFileSync("data/countries.js","utf8"))();
const CO={}; for(const c of window.ARTEFACTUM_COUNTRIES) CO[c.n.toLowerCase()]=c;
function centroid(c){ let big=c.r[0]; for(const r of c.r) if(r.length>big.length) big=r; let sx=0,sy=0; for(const[x,y]of big){sx+=x;sy+=y;} return [Math.round(sy/big.length*1000)/1000,Math.round(sx/big.length*1000)/1000]; }
const raw=readFileSync("data/pool.js","utf8");
const pool=JSON.parse(raw.slice(raw.indexOf("["),raw.lastIndexOf("]")+1));
const have=new Set(pool.map(p=>p.id));
let added=0,skip=0;
for(const w of adds){ if(have.has(w.id)){skip++;continue;}
  const co=CO[(w.place||"").toLowerCase()]; const [lat,lng]=co?centroid(co):[null,null];
  pool.push({ id:w.id, title:w.title, artist:w.artist||"", y:w.y, lat, lng, medium:w.medium||"",
    place:co?co.n:(w.place||""), fame:120, img:w.img, src:"wd-wishlist", region:w.region||"Europe",
    style:w.style||"", styleKind:w.styleKind||(w.style?"movement":""),
    ...(w.govReview?{govReview:true}:{}), ...(w.marginalReview?{marginalReview:true}:{}) });
  have.add(w.id); added++;
}
writeFileSync("data/pool.js", raw.slice(0,raw.indexOf("["))+JSON.stringify(pool)+raw.slice(raw.lastIndexOf("]")+1));
console.log(`promoted ${added} wishlist works (skipped ${skip} dups) | pool now ${pool.length}`);
const noco=pool.filter(p=>p.src==="wd-wishlist"&&p.lat==null).map(p=>p.title); if(noco.length) console.log("no-coord:",noco.join(", "));

// inject fame (sitelinks + 12mo enwiki pageviews) for new ids
async function get(u){for(let t=0;t<5;t++){try{const r=await fetch(u,{headers:{"User-Agent":UA}});if(r.status===429||r.status>=500){await sleep(1500*(t+1));continue;}if(r.status===404)return{__404:1};if(!r.ok)return null;return await r.json();}catch(e){await sleep(900);}}return null;}
const qid=id=>{const m=String(id).match(/Q\d+/);return m?m[0]:null;};
const fame=JSON.parse(readFileSync("data/fame.json","utf8"));
const need=pool.filter(p=>p.src==="wd-wishlist"&&!(p.id in fame)&&qid(p.id));
console.log("injecting fame for",need.length,"works…");
let n=0;
for(const p of need){ const q=qid(p.id);
  const sj=await get(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=sitelinks&ids=${q}`); await sleep(110);
  const e=sj&&sj.entities&&sj.entities[q]; const sl=e&&e.sitelinks?Object.keys(e.sitelinks).length:0;
  const t=e&&e.sitelinks&&e.sitelinks.enwiki?e.sitelinks.enwiki.title:null;
  let pv=0; if(t){ const pj=await get(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia.org/all-access/all-agents/${encodeURIComponent(t.replace(/ /g,"_"))}/monthly/20240101/20241231`); await sleep(90);
    pv=(pj&&pj.items)?pj.items.reduce((a,x)=>a+(x.views||0),0):0; }
  fame[p.id]={wikidata:q,sitelinks:sl,pageviews:pv,fame:0,tier:"medium"};
  if(++n%40===0) console.error(`  ${n}/${need.length}`);
}
writeFileSync("data/fame.json",JSON.stringify(fame,null,2)+"\n");
console.log("→ rebuilding fame.js"); execSync("node scripts/make-fame-js.mjs",{stdio:"inherit"});
console.log("→ audits"); execSync("node scripts/audit-all.mjs",{stdio:"inherit"});
