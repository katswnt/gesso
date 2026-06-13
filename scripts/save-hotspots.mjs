// Merge a hotspots JSON ({id:[{n,x,y}...]}) into data/hotspots.js.
// Usage: node scripts/save-hotspots.mjs [/tmp/hot/out.json]
import { readFileSync, writeFileSync } from "node:fs";
const add = JSON.parse(readFileSync(process.argv[2]||"/tmp/hot/out.json","utf8"));
let hs={}; try{ const h=readFileSync("data/hotspots.js","utf8"); hs=JSON.parse(h.slice(h.indexOf("{"),h.lastIndexOf("}")+1)); }catch{}
let n=0; for(const id in add){ hs[id]=add[id]; n++; }
writeFileSync("data/hotspots.js","window.ARTEFACTUM_HOTSPOTS = "+JSON.stringify(hs)+";\n");
const pool = JSON.parse(readFileSync("data/pool.js","utf8").replace("window.ARTEFACTUM_POOL = ","").replace(/;\s*$/,""));
console.log(`saved ${n} | total ${Object.keys(hs).length}/${pool.length} | remaining ${pool.filter(p=>!hs[p.id]).length}`);
