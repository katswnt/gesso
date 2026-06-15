// Validate every pool image URL POLITELY (Commons rate-limits hard → 429 ≠ broken).
// Only flags DEFINITIVE failures (404/410, or persistent non-429 errors after retries).
// Resumable: re-run to continue. Run: node scripts/check-images.mjs -> data/incoming/broken-images.json
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const pool = JSON.parse(readFileSync("data/pool.js","utf8").replace("window.ARTEFACTUM_POOL = ","").replace(/;\s*$/,""));
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36";
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const OUT="data/incoming/broken-images.json", ST="data/incoming/image-status.json";
let status={}; if(existsSync(ST)){ try{status=JSON.parse(readFileSync(ST,"utf8"));}catch{} }

// returns "ok" | "broken" | "unknown" (gave up due to persistent 429/network — NOT counted as broken)
async function check(url){
  for(let t=0;t<6;t++){
    try{
      const c=new AbortController(); const to=setTimeout(()=>c.abort(),20000);
      const r=await fetch(url,{headers:{"User-Agent":UA,"Accept":"image/*,*/*"},redirect:"follow",signal:c.signal});
      clearTimeout(to);
      if(r.status===404||r.status===410) return "broken";
      if(r.status>=200&&r.status<400){ const ct=r.headers.get("content-type")||""; return (ct.startsWith("image/")||ct==="")?"ok":(ct.includes("text/html")?"broken":"ok"); }
      if(r.status===429||r.status===403||r.status>=500){ await sleep(800*Math.pow(1.8,t)); continue; } // backoff & retry
      return "broken";
    }catch(e){ await sleep(700*(t+1)); }
  }
  return "unknown"; // persistent throttle/network — don't penalize the work
}

const N=3, todo=pool.filter(p=>!(p.id in status)); let i=0, done=Object.keys(status).length;
console.error(`image check: ${done} cached, ${todo.length} to check (concurrency ${N})`);
async function worker(){ while(i<todo.length){ const p=todo[i++]; status[p.id]=await check(p.img); done++;
  if(done%150===0){ writeFileSync(ST,JSON.stringify(status)); const b=Object.values(status).filter(v=>v==="broken").length, u=Object.values(status).filter(v=>v==="unknown").length;
    console.error(`checked ${done}/${pool.length} | broken ${b} | unknown ${u}`); }
  await sleep(120); } }
await Promise.all(Array.from({length:N},worker));
writeFileSync(ST,JSON.stringify(status));
const broken=Object.entries(status).filter(([,v])=>v==="broken").map(([id])=>id);
const unknown=Object.entries(status).filter(([,v])=>v==="unknown").map(([id])=>id);
writeFileSync(OUT,JSON.stringify(broken));
console.log(`DONE: ${broken.length} broken, ${unknown.length} unknown (throttled — re-run to retry) of ${pool.length}`);
