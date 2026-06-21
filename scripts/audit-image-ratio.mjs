// Flag pool works whose IMAGE has an extreme aspect ratio (unviewable slivers — long handscrolls, sutra
// strips, panoramas) or whose image is broken. Fetches the first 64KB of each image and parses the pixel
// width/height from the JPEG/PNG header — no full download, no deps. Read-only: writes a flag report to
// data/incoming/image-ratio-flags.json for review. Run: node scripts/audit-image-ratio.mjs
import { writeFileSync } from "node:fs";
import { readGlobal } from "./lib/static-module.mjs";
const pool = readGlobal("data/pool.js","ARTEFACTUM_POOL");
const EXTREME = 3.2;           // flag if max(w/h, h/w) >= this
const CONC = 12;

function dims(buf){
  // PNG: 8-byte sig, IHDR width@16 height@20 (big-endian)
  if(buf[0]===0x89 && buf[1]===0x50) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  // JPEG: scan segments for a SOF marker (0xFFC0..0xCF, excl C4/C8/CC) → [.., h(2), w(2)]
  if(buf[0]===0xFF && buf[1]===0xD8){
    let o=2;
    while(o+9<buf.length){
      if(buf[o]!==0xFF){ o++; continue; }
      const m=buf[o+1];
      if(m>=0xC0 && m<=0xCF && m!==0xC4 && m!==0xC8 && m!==0xCC){ return { h: buf.readUInt16BE(o+5), w: buf.readUInt16BE(o+7) }; }
      if(m===0xD8||m===0xD9||(m>=0xD0&&m<=0xD7)){ o+=2; continue; }
      o += 2 + buf.readUInt16BE(o+2);
    }
  }
  return null;
}
async function probe(p){
  try{
    const r=await fetch(p.img,{headers:{Range:"bytes=0-65535"}});
    if(!r.ok && r.status!==206) return { id:p.id, title:p.title, src:p.src, broken:`HTTP ${r.status}` };
    const buf=Buffer.from(await r.arrayBuffer());
    const d=dims(buf);
    if(!d || !d.w || !d.h) return { id:p.id, title:p.title, src:p.src, broken:"no-dims" };
    const ratio=Math.max(d.w/d.h, d.h/d.w);
    if(ratio>=EXTREME) return { id:p.id, title:p.title, src:p.src, w:d.w, h:d.h, ratio:Math.round(ratio*100)/100, orient: d.w>=d.h?"wide":"tall" };
    return null;
  }catch(e){ return { id:p.id, title:p.title, src:p.src, broken:String(e).slice(0,40) }; }
}
const flags=[]; let done=0;
for(let i=0;i<pool.length;i+=CONC){
  const batch=pool.slice(i,i+CONC);
  const res=await Promise.all(batch.map(probe));
  for(const x of res) if(x) flags.push(x);
  done+=batch.length; if(done%480===0) console.error(`  ${done}/${pool.length} probed, ${flags.length} flagged`);
}
const extreme=flags.filter(f=>f.ratio).sort((a,b)=>b.ratio-a.ratio);
const broken=flags.filter(f=>f.broken);
writeFileSync("data/incoming/image-ratio-flags.json", JSON.stringify({extreme,broken},null,1));
console.log(`\nEXTREME ratio (>=${EXTREME}:1): ${extreme.length} | BROKEN: ${broken.length}`);
console.log("\nworst 25 extreme:");
extreme.slice(0,25).forEach(f=>console.log(`  ${f.ratio}:1 ${f.orient}  "${(f.title||"").slice(0,40)}" [${f.src}] ${f.w}x${f.h}`));
