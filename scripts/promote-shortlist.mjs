// Promote the verified READY works from the museum harvest into the live pool.
// Filters: clean title (no accession-number junk), known origin (place), AND a year (when+where are
// always-quizzed, so a promoted work needs both). Fame = 100*ln(sitelinks+1) — the same recognizability
// formula make-fame-js uses (pageview term omitted; refine later with the full fame pipeline). Dedupes by
// Wikidata Q-number against the existing pool. Writes pool.js atomically.
import { readFileSync } from "node:fs";
import { readGlobal, writeAssignment } from "./lib/static-module.mjs";
const { ready } = JSON.parse(readFileSync("data/incoming/promotion-shortlist.json","utf8"));
const pool = readGlobal("data/pool.js","ARTEFACTUM_POOL");
const qOf = id => (String(id||"").match(/Q\d+/)||[""])[0];
const poolQ = new Set(pool.map(p=>qOf(p.id)).filter(Boolean));
const junk = t => /\d{2,}[.\-]\d|[-_]\d{3,}|inv\.?|\bMS\b|\d{4,}/i.test(t||"") || /[-_]\d/.test(t||"");
const fameOf = sl => Math.round(100*Math.log((sl||0)+1));

let promoted=0, skipJunk=0, skipNoYear=0, skipDup=0;
for(const w of ready){
  if(poolQ.has(qOf(w.id))){ skipDup++; continue; }
  if(junk(w.title)){ skipJunk++; continue; }
  if(w.y==null){ skipNoYear++; continue; }
  pool.push({ id:w.id, title:w.title, artist:w.artist||"", y:w.y, lat:w.lat, lng:w.lng,
    place:w.place, region:w.region, medium:w.medium||"", style:w.style||"",
    styleKind:w.styleKind||"", fame:fameOf(w.sitelinks),
    img:w.img, src:w.src, cats:["when","where","medium","style","artist"] });
  poolQ.add(qOf(w.id)); promoted++;
}
writeAssignment("data/pool.js","ARTEFACTUM_POOL",pool);
console.log(`promoted ${promoted} | skipped: dup ${skipDup}, junk-title ${skipJunk}, no-year ${skipNoYear}`);
console.log(`pool size now ${pool.length}`);
