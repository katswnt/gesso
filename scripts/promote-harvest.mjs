import { readFileSync, writeFileSync } from "node:fs";
const base = Object.fromEntries(JSON.parse(readFileSync("data/incoming/harvest-fetched.json","utf8")).map(p=>[p.id,p]));
let recs=[]; for(let i=0;i<7;i++){ try{ recs=recs.concat(JSON.parse(readFileSync("/tmp/hv-out-"+i+".json","utf8"))); }catch(e){} }
global.window={}; new Function(readFileSync("data/countries.js","utf8"))();
const CO={}; for(const c of window.ARTEFACTUM_COUNTRIES) CO[c.n.toLowerCase()]=c;
function centroid(c){ let big=c.r[0]; for(const r of c.r) if(r.length>big.length) big=r; let sx=0,sy=0; for(const[x,y]of big){sx+=x;sy+=y;} return [Math.round(sy/big.length*1000)/1000,Math.round(sx/big.length*1000)/1000]; }
const ALIAS={"united states":"united states of america","peoples republic of china":"china","czech republic":"czechia"};
const CONT={"united states of america":"North America","canada":"North America","mexico":"North America","brazil":"South America","egypt":"Africa","china":"Asia","japan":"Asia","india":"Asia","iran":"Asia","turkey":"Asia","taiwan":"Asia","french polynesia":"Oceania"};
const norm=s=>String(s||"").toLowerCase().replace(/[^a-z ]/g,"").trim();
const raw=readFileSync("data/pool.js","utf8");
const pool=JSON.parse(raw.slice(raw.indexOf("["),raw.lastIndexOf("]")+1));
const have=new Set(pool.map(p=>p.id));
let added=0; const notes={};
for(const r of recs){ const b=base[r.id]; if(!b||have.has(r.id)) continue;
  let pl=(r.place||b.place||"").trim(); let key=pl.toLowerCase(); key=ALIAS[norm(pl)]||key; const co=CO[key];
  const [lat,lng]= co?centroid(co):[null,null];
  pool.push({ id:r.id, title:b.title, artist:r.artist||b.artist||"", y:(r.y!=null?r.y:b.y), lat, lng,
    medium:r.medium||b.medium||"", place:co?co.n:pl, fame:120, img:b.img, src:"wd-harvest",
    region:CONT[(co?co.n:pl).toLowerCase()]||"Europe", style:r.style||"", styleKind:r.styleKind||(r.style?"movement":""), harvest:true });
  if(r.why) notes[r.id]={why:r.why,cues:r.cues,guide:r.guide};
  have.add(r.id); added++;
}
writeFileSync("data/pool.js", raw.slice(0,raw.indexOf("["))+JSON.stringify(pool)+raw.slice(raw.lastIndexOf("]")+1));
global.window.ARTEFACTUM_CUES=undefined; new Function(readFileSync("data/teach-works.js","utf8"))();
const CUES=window.ARTEFACTUM_CUES; CUES.work=CUES.work||{}; let nn=0;
for(const id in notes){ if(!CUES.work[id]){ CUES.work[id]=notes[id]; nn++; } }
writeFileSync("data/teach-works.js","window.ARTEFACTUM_CUES=window.ARTEFACTUM_CUES||{};\nwindow.ARTEFACTUM_CUES.work="+JSON.stringify(CUES.work||CUES)+";\n");
console.log("promoted harvest:",added,"| notes:",nn,"| pool now",pool.length);
const noco=pool.filter(p=>p.harvest&&p.lat==null).map(p=>p.title); if(noco.length) console.log("no-coord:",noco.join(", "));
// auto-run the audit suite after import
console.log("\n› running audits on the updated pool…");
(await import("node:child_process")).execSync("node scripts/audit-all.mjs",{stdio:"inherit"});
