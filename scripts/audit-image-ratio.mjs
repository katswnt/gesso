// Flag pool works whose IMAGE has an extreme aspect ratio (unviewable slivers — long handscrolls, sutra
// strips, panoramas) or whose image is broken. Resolves NATIVE dims via the shared resolver (fingerprint
// baseline first, then imageinfo for Commons / Range for museum) — NOT a Range read of the Commons ?width=
// URL, which returns the SERVED/scaled size, not the master. Read-only: writes data/incoming/image-ratio-
// flags.json for review. Run: node scripts/audit-image-ratio.mjs [--refresh]
import { writeFileSync } from "node:fs";
import { readGlobal } from "./lib/static-module.mjs";
import { resolveDims } from "./lib/img-dimensions.mjs";
const pool = readGlobal("data/pool.js","ARTEFACTUM_POOL");
const EXTREME = 3.2;           // flag if max(w/h, h/w) >= this
const useCache = !process.argv.includes("--refresh");

const dimsById = await resolveDims(pool, { useCache });
const flags=[];
for(const p of pool){
  const d = dimsById.get(p.id);
  if(!d || d.err){ flags.push({ id:p.id, title:p.title, src:p.src, broken: d?.err ? String(d.err) : "no-dims" }); continue; }
  const ratio = Math.max(d.w/d.h, d.h/d.w);
  if(ratio>=EXTREME) flags.push({ id:p.id, title:p.title, src:p.src, w:d.w, h:d.h, ratio:Math.round(ratio*100)/100, orient: d.w>=d.h?"wide":"tall" });
}
const extreme=flags.filter(f=>f.ratio).sort((a,b)=>b.ratio-a.ratio);
const broken=flags.filter(f=>f.broken);
writeFileSync("data/incoming/image-ratio-flags.json", JSON.stringify({extreme,broken},null,1));
console.log(`\nEXTREME ratio (>=${EXTREME}:1): ${extreme.length} | BROKEN: ${broken.length}`);
console.log("\nworst 25 extreme:");
extreme.slice(0,25).forEach(f=>console.log(`  ${f.ratio}:1 ${f.orient}  "${(f.title||"").slice(0,40)}" [${f.src}] ${f.w}x${f.h}`));
