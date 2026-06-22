// Deterministic v1→v2: give every teach work a unified `notes` array so no reveal shows the old two-section
// format. Pinned notes from the 4 cues (head=observation, body=what it signals, +hotspot x/y); then the
// guide Q&A as unpinned notes (already rich). Works already v2 (have notes[]) are left untouched.
// Usage: node scripts/merge-v1-to-v2.mjs
import { readFileSync, writeFileSync } from "node:fs";
const parse=(f,after)=>{const s=readFileSync(f,"utf8");const i=after?s.indexOf("{",s.indexOf(after)):s.indexOf("{");return JSON.parse(s.slice(i,s.lastIndexOf("}")+1));};
const CUES=parse("data/teach-works.js",".work");
let HOT={}; try{ HOT=parse("data/hotspots.js"); }catch{}
const cap=s=>s?s.charAt(0).toUpperCase()+s.slice(1):s;
let conv=0, skip=0;
for(const id in CUES){
  const c=CUES[id];
  if(Array.isArray(c.notes)&&c.notes.length){ skip++; continue; }      // already v2
  if(!Array.isArray(c.cues)||!c.cues.length){ skip++; continue; }       // nothing to convert
  const hs=HOT[id]||[];
  const pinned=c.cues.slice(0,4).map((cue,i)=>{
    const parts=String(cue).split(/\s*(?:→|->)\s*/);
    let head=parts[0].trim(), body=parts.length>1?parts.slice(1).join(" → ").trim():"";
    body=body?cap(body):head;
    if(!/[.!?]$/.test(body)) body+=".";
    const n={head,body}; const h=hs[i];
    if(h&&typeof h.x==="number"&&typeof h.y==="number"){ n.x=h.x; n.y=h.y; }
    return n;
  });
  const qa=Array.isArray(c.guide)?c.guide.filter(g=>g&&g.q&&g.a).map(g=>({head:String(g.q),body:String(g.a)})):[];
  c.notes=[...pinned,...qa];
  conv++;
}
writeFileSync("data/teach-works.js","window.ARTEFACTUM_CUES=window.ARTEFACTUM_CUES||{};\nwindow.ARTEFACTUM_CUES.work="+JSON.stringify(CUES)+";\n");
const v2=Object.values(CUES).filter(c=>Array.isArray(c.notes)&&c.notes.length).length;
console.error(`converted ${conv} v1→v2 | left ${skip} (already v2 or no cues) | total v2 now ${v2}/${Object.keys(CUES).length}`);
