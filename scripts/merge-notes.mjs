// Merge teach-note shard files (each a JSON array of {id,why,cues,guide}) into data/teach-works.js.
// Validates: 4 cues w/ arrows, guide ≥5 with non-empty {q,a}. Skips invalid items (reported).
// Usage: node scripts/merge-notes.mjs <file1.json> [file2.json ...]   (or a glob your shell expands)
import { readFileSync, writeFileSync } from "node:fs";
const files = process.argv.slice(2);
if(!files.length){ console.error("usage: node scripts/merge-notes.mjs <shard.json> [...]"); process.exit(1); }
const OUT = "data/teach-works.js";
let out = {};
try { const t=readFileSync(OUT,"utf8"); out = JSON.parse(t.slice(t.indexOf("{",t.indexOf(".work")), t.lastIndexOf("}")+1)); } catch {}

let added=0, skipped=0;
for(const f of files){
  let arr; try{ arr=JSON.parse(readFileSync(f,"utf8")); }catch(e){ console.error(`skip file ${f}: ${e.message}`); continue; }
  if(!Array.isArray(arr)){ console.error(`skip file ${f}: not an array`); continue; }
  for(const it of arr){
    if(!(it&&typeof it.id==="string"&&it.why&&Array.isArray(it.cues))){ skipped++; continue; }
    const cues=it.cues.filter(c=>typeof c==="string"&&c.includes("→")).slice(0,4);
    const guide=Array.isArray(it.guide)?it.guide.filter(g=>g&&typeof g.q==="string"&&g.q.trim()&&typeof g.a==="string"&&g.a.trim()).map(g=>({q:g.q.trim(),a:g.a.trim()})):[];
    if(cues.length!==4 || guide.length<5){ console.error(`skip ${it.id}: cues=${cues.length} guide=${guide.length}`); skipped++; continue; }
    out[it.id]={why:String(it.why).trim(),cues,guide};
    added++;
  }
}
writeFileSync(OUT, "window.ARTEFACTUM_CUES=window.ARTEFACTUM_CUES||{};\nwindow.ARTEFACTUM_CUES.work="+JSON.stringify(out)+";\n");
const withGuide=Object.values(out).filter(n=>Array.isArray(n.guide)&&n.guide.length>=5).length;
console.error(`merged: +${added}, skipped ${skipped} | total notes ${Object.keys(out).length} | with guide ${withGuide}`);
