// Find genuinely-broken pool images. Commons Special:FilePath throttles bulk hits (429 ≠ broken),
// so for Commons files we use the SANCTIONED Commons API (imageinfo, 50/batch) which returns a real
// "missing" flag. Non-Commons hosts (Met/Harvard/AIC/Cleveland) don't throttle → plain fetch.
// Resumable. Run: node scripts/check-images.mjs -> data/incoming/broken-images.json (+ image-status.json)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const pool = JSON.parse(readFileSync("data/pool.js","utf8").replace("window.ARTEFACTUM_POOL = ","").replace(/;\s*$/,""));
const UA = "GessoImgCheck/1.0 (kathryn.swint@gmail.com)";
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const OUT="data/incoming/broken-images.json", ST="data/incoming/image-status.json";
let status={}; if(existsSync(ST)){ try{status=JSON.parse(readFileSync(ST,"utf8")); }catch{} }

const commonsName = url => { const m=String(url).match(/Special:FilePath\/([^?]+)/i); return m?decodeURIComponent(m[1].replace(/_/g," ")):null; };
const isCommons = url => /commons\.wikimedia\.org/i.test(url);

// --- Commons API batch existence check (returns Set of MISSING filenames) ---
async function commonsMissing(names){
  const titles = names.map(n=>"File:"+n).join("|");
  const url = "https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url&titles="+encodeURIComponent(titles);
  for(let t=0;t<4;t++){ try{
    const r=await fetch(url,{headers:{"User-Agent":UA}});
    if(r.status===429||r.status>=500){ await sleep(1500*(t+1)); continue; }
    if(!r.ok) return null;
    const j=await r.json(); const pages=(j.query&&j.query.pages)||{}; const norm={};
    // map normalized/redirected titles back is overkill; rely on returned title
    const missing=new Set();
    for(const k in pages){ const pg=pages[k]; const nm=(pg.title||"").replace(/^File:/,"");
      if(pg.missing!==undefined || pg.invalid!==undefined) missing.add(nm); }
    return missing;
  }catch(e){ await sleep(1200*(t+1)); } }
  return null;
}
async function plainOk(url){
  for(let t=0;t<3;t++){ try{
    const c=new AbortController(); const to=setTimeout(()=>c.abort(),15000);
    const r=await fetch(url,{headers:{"User-Agent":UA,"Accept":"image/*,*/*"},redirect:"follow",signal:c.signal}); clearTimeout(to);
    if(r.status===404||r.status===410) return "broken";
    if(r.status>=200&&r.status<400){ const ct=r.headers.get("content-type")||""; return ct.includes("text/html")?"broken":"ok"; }
    if(r.status===429||r.status>=500){ await sleep(1000*(t+1)); continue; }
    return "broken";
  }catch(e){ await sleep(800*(t+1)); } }
  return "unknown";
}

const commons=pool.filter(p=>isCommons(p.img)&&commonsName(p.img)&&!(p.id in status));
const others=pool.filter(p=>!isCommons(p.img)&&!(p.id in status));
console.error(`Commons: ${commons.length} via API | other hosts: ${others.length} via fetch | cached: ${Object.keys(status).length}`);

// Commons in batches of 50
for(let i=0;i<commons.length;i+=50){
  const batch=commons.slice(i,i+50); const names=batch.map(p=>commonsName(p.img));
  const missing=await commonsMissing(names);
  if(missing===null){ batch.forEach(p=>status[p.id]="unknown"); }
  else batch.forEach(p=>{ const nm=commonsName(p.img); status[p.id]= missing.has(nm)?"broken":"ok"; });
  if(i%500===0){ writeFileSync(ST,JSON.stringify(status)); console.error(`  commons ${i}/${commons.length} | broken so far ${Object.values(status).filter(v=>v==="broken").length}`); }
  await sleep(250);
}
writeFileSync(ST,JSON.stringify(status));
// other hosts, light concurrency
let i=0; const N=6;
async function w(){ while(i<others.length){ const p=others[i++]; status[p.id]=await plainOk(p.img);
  if(i%200===0){ writeFileSync(ST,JSON.stringify(status)); console.error(`  others ${i}/${others.length}`);} } }
await Promise.all(Array.from({length:N},w));
writeFileSync(ST,JSON.stringify(status));
const broken=Object.entries(status).filter(([,v])=>v==="broken").map(([id])=>id);
const unknown=Object.entries(status).filter(([,v])=>v==="unknown").map(([id])=>id);
writeFileSync(OUT,JSON.stringify(broken));
console.log(`DONE: ${broken.length} broken, ${unknown.length} unknown of ${pool.length} — wrote ${OUT}`);
