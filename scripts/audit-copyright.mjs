// Copyright audit: for every Wikidata-sourced pool work, look up the creator's death year via SPARQL
// and flag works whose creator died AFTER 1955 (our US-safe PD line — later deaths risk URAA/in-copyright).
// Read-only; writes data/incoming/copyright-flags.json for review. Run: node scripts/audit-copyright.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { loadWdEntities } from "./lib/wd-cache.mjs";
const pool=JSON.parse(readFileSync("data/pool.js","utf8").match(/\[[\s\S]*\]/)[0]);
const qid=id=>{const m=String(id).match(/Q\d+/);return m?m[0]:null;};
const wdWorks=pool.filter(p=>qid(p.id)); // all wikidata-id works (museum-API works have no Q-id → skip; those are PD-curated collections)
const byQ=Object.fromEntries(wdWorks.map(p=>[qid(p.id),p]));
console.log("Wikidata-id works to audit:",wdWorks.length);
// creator death years now come from the shared Wikidata cache (data/incoming/wd-entities.json) — no sweep.
const qids=Object.keys(byQ);
const ents=await loadWdEntities(qids, { onProgress:(d,t)=>{ if(d%750<100) console.error(`  ${d}/${t} fetched`); } });
const flags=[];
for(const q of qids){ const p=byQ[q]; const e=ents.get(q); if(!e) continue;
  for(const c of e.creators){ if(c.death!=null && c.death>1955) flags.push({id:p.id,artist:p.artist,creator:c.l||(p.artist||""),death:c.death,title:p.title,y:p.y,src:p.src}); } }
// dedupe by id (a work can have multiple creators)
const seen=new Set(), uniq=flags.filter(f=>seen.has(f.id)?false:seen.add(f.id));
uniq.sort((a,b)=>b.death-a.death);
writeFileSync("data/incoming/copyright-flags.json",JSON.stringify(uniq,null,1));
console.log(`\nFLAGGED ${uniq.length} works by creators who died >1955 (review → likely drop)`);
const bySrc={}; uniq.forEach(f=>bySrc[f.src]=(bySrc[f.src]||0)+1); console.log("by src:",JSON.stringify(bySrc));
const byArtist={}; uniq.forEach(f=>byArtist[f.creator]=(byArtist[f.creator]||0)+1);
console.log("top creators:"); Object.entries(byArtist).sort((a,b)=>b[1]-a[1]).slice(0,25).forEach(([a,n])=>console.log("  "+String(n).padStart(3)+"  "+a));
