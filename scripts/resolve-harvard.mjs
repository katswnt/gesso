// Harvard images use nrs.harvard.edu/...­_dynmc resolver URLs that 303→ a FULL-res image. The resolver
// hop + huge file + a retry/fallback that breaks on the resolver URL = "image unavailable" on slower
// networks. Resolve each to the DIRECT, size-bounded Harvard IIIF URL (ids.lib.harvard.edu .../full/1200,/)
// — small, direct, and IIIF so displaySrc/hiRes handle it. Run: node scripts/resolve-harvard.mjs
import { readFileSync, writeFileSync } from "node:fs";
const UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const raw=readFileSync("data/pool.js","utf8");
const pool=JSON.parse(raw.slice(raw.indexOf("["),raw.lastIndexOf("]")+1));
const targets=pool.filter(p=>/nrs\.harvard\.edu/.test(p.img||""));
console.log("Harvard resolver URLs to resolve:",targets.length);
let done=0,fail=0; const fails=[];
for(const p of targets){
  try{
    const r=await fetch(p.img,{method:"HEAD",headers:{"User-Agent":UA},redirect:"manual"});
    let loc=r.headers.get("location");
    if(!loc){ // some need GET to surface the redirect
      const r2=await fetch(p.img,{headers:{"User-Agent":UA},redirect:"manual"}); loc=r2.headers.get("location"); }
    if(loc&&/ids\.lib\.harvard\.edu/.test(loc)){
      const bounded=loc.replace(/\/full\/[^/]+\//,"/full/1200,/").split("#")[0];
      p.harvardOrig=p.img; p.img=bounded; done++;
    } else { fail++; fails.push(p.id+" — no ids.lib redirect"); }
  }catch(e){ fail++; fails.push(p.id+" — "+e.message); }
  if((done+fail)%40===0){ writeFileSync("data/pool.js", raw.slice(0,raw.indexOf("["))+JSON.stringify(pool)+raw.slice(raw.lastIndexOf("]")+1)); console.error(`  ${done+fail}/${targets.length} | ok ${done} fail ${fail}`); }
  await sleep(80);
}
writeFileSync("data/pool.js", raw.slice(0,raw.indexOf("["))+JSON.stringify(pool)+raw.slice(raw.lastIndexOf("]")+1));
writeFileSync("data/incoming/harvard-resolve-fails.json",JSON.stringify(fails,null,1));
console.log(`\nresolved ${done}/${targets.length} Harvard images to direct IIIF | failed ${fail}`);
