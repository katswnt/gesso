// Print the next batch of works lacking hotspots + download their images for the vision pass.
// Usage: node scripts/next-hotspots.mjs [batchSize]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const N = parseInt(process.argv[2]||"6",10);
const pool = JSON.parse(readFileSync("data/pool.js","utf8").replace("window.ARTEFACTUM_POOL = ","").replace(/;\s*$/,""));
const tw = readFileSync("data/teach-works.js","utf8");
const notes = JSON.parse(tw.slice(tw.indexOf("{",tw.indexOf(".work")), tw.lastIndexOf("}")+1));
let hs={}; try{ const h=readFileSync("data/hotspots.js","utf8"); hs=JSON.parse(h.slice(h.indexOf("{"),h.lastIndexOf("}")+1)); }catch{}
const todo = pool.filter(p=>!hs[p.id]).slice(0,N);
mkdirSync("/tmp/hot",{recursive:true});
const batch=[];
for(const p of todo){
  const path=`/tmp/hot/${p.id}.jpg`;
  try{ const r=await fetch(p.img); writeFileSync(path, Buffer.from(await r.arrayBuffer())); }
  catch{ console.error("download failed",p.id); continue; }
  batch.push({id:p.id, title:p.title, path, cues:(notes[p.id]&&notes[p.id].cues)||[]});
}
console.log(JSON.stringify({remaining:pool.filter(p=>!hs[p.id]).length, batch}, null, 1));
