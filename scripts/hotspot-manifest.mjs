// Build fame-ordered hotspot manifests for parallel Claude agents + pre-download images.
// Usage: node scripts/hotspot-manifest.mjs <topN> <numShards>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const TOP = parseInt(process.argv[2]||"800",10);
const N = parseInt(process.argv[3]||"8",10);

const pool = JSON.parse(readFileSync("data/pool.js","utf8").replace("window.ARTEFACTUM_POOL = ","").replace(/;\s*$/,""));
const h = readFileSync("data/hotspots.js","utf8"); const hs = JSON.parse(h.slice(h.indexOf("{"),h.lastIndexOf("}")+1));
const tw = readFileSync("data/teach-works.js","utf8"); const work = JSON.parse(tw.slice(tw.indexOf("{",tw.indexOf(".work")),tw.lastIndexOf("}")+1));
// prefer re-scored fame if available
let fame={}; try{ fame=JSON.parse(readFileSync("data/fame.json","utf8")); }catch{}
const fameOf = p => (fame[p.id]&&Number.isFinite(fame[p.id].fame))?fame[p.id].fame:(p.fame||0);

const lacking = pool.filter(p=>!hs[p.id] && p.img && work[p.id]&&work[p.id].cues&&work[p.id].cues.length)
  .sort((a,b)=>fameOf(b)-fameOf(a))
  .slice(0,TOP);

mkdirSync("/tmp/hot",{recursive:true});
const shards = Array.from({length:N},()=>[]);
let ok=0, fail=0, idx=0;
for(const p of lacking){
  const path=`/tmp/hot/${p.id.replace(/[^a-z0-9]/gi,"_")}.jpg`;
  try{
    const r=await fetch(p.img,{headers:{"User-Agent":"GessoHotspots/1.0 (kathryn.swint@gmail.com)"}});
    if(!r.ok) throw new Error("http "+r.status);
    const buf=Buffer.from(await r.arrayBuffer());
    if(buf.length<800) throw new Error("tiny");
    writeFileSync(path, buf); ok++;
    shards[idx%N].push({id:p.id, title:p.title, path, cues:work[p.id].cues}); idx++;
  }catch(e){ fail++; }
}
for(let k=0;k<N;k++) writeFileSync(`data/incoming/hot-manifest-${k}.json`, JSON.stringify(shards[k]));
console.log(`downloaded ${ok}, failed ${fail}; sharded into ${N} (~${Math.round(ok/N)} each)`);
