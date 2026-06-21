// Merge v2 unified-reveal `notes` arrays into data/teach-works.js.
// Each input file is a JSON array of {id, notes:[{head,body,x?,y?}]}. We ADD the `notes` field onto the
// existing work (preserving why/cues/guide), so the reveal renderer switches that work to the unified format.
// Validates: ≥4 notes, every note has non-empty head+body, pinned notes (with x/y) have numeric 0–100 coords.
// Usage: node scripts/merge-v2notes.mjs <file1.json> [file2.json ...]
import { readFileSync, writeFileSync } from "node:fs";
const files = process.argv.slice(2);
if(!files.length){ console.error("usage: node scripts/merge-v2notes.mjs <shard.json> [...]"); process.exit(1); }
const OUT = "data/teach-works.js";
let out = {};
try { const t=readFileSync(OUT,"utf8"); out = JSON.parse(t.slice(t.indexOf("{",t.indexOf(".work")), t.lastIndexOf("}")+1)); } catch {}

const okCoord=v=>typeof v==="number"&&isFinite(v)&&v>=0&&v<=100;
let added=0, skipped=0;
for(const f of files){
  let arr; try{ arr=JSON.parse(readFileSync(f,"utf8")); }catch(e){ console.error(`skip file ${f}: ${e.message}`); continue; }
  if(!Array.isArray(arr)){ console.error(`skip file ${f}: not an array`); continue; }
  for(const it of arr){
    if(!(it&&typeof it.id==="string"&&Array.isArray(it.notes))){ skipped++; continue; }
    if(!out[it.id]){ console.error(`skip ${it.id}: no existing teach entry`); skipped++; continue; }
    const notes=[];
    let bad=false;
    for(const n of it.notes){
      if(!n||typeof n.head!=="string"||!n.head.trim()||typeof n.body!=="string"||!n.body.trim()){ bad=true; break; }
      const note={head:n.head.trim(),body:n.body.trim()};
      const pinned = n.x!=null||n.y!=null;
      if(pinned){ if(!okCoord(n.x)||!okCoord(n.y)){ bad=true; break; } note.x=n.x; note.y=n.y; }
      notes.push(note);
    }
    if(bad || notes.length<4){ console.error(`skip ${it.id}: invalid notes (n=${notes.length})`); skipped++; continue; }
    out[it.id]={ ...out[it.id], notes };
    added++;
  }
}
writeFileSync(OUT, "window.ARTEFACTUM_CUES=window.ARTEFACTUM_CUES||{};\nwindow.ARTEFACTUM_CUES.work="+JSON.stringify(out)+";\n");
const v2=Object.values(out).filter(n=>Array.isArray(n.notes)&&n.notes.length).length;
console.error(`merged v2 notes: +${added}, skipped ${skipped} | total works ${Object.keys(out).length} | v2 ${v2}`);
