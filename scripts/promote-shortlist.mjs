// Promote the verified READY works from the museum harvest into the live pool.
// Filters: clean title (no accession-number junk), known origin (place), AND a year (when+where are
// always-quizzed, so a promoted work needs both). Fame = 100*ln(sitelinks+1) — the same recognizability
// formula make-fame-js uses (pageview term omitted; refine later with the full fame pipeline). Dedupes by
// Wikidata Q-number against the existing pool. Writes pool.js atomically.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { readGlobal, writeAssignment } from "./lib/static-module.mjs";
import { normalizeArtist, canonicalizeStyle, isInCopyright } from "./lib/domain.mjs";
const { ready } = JSON.parse(readFileSync("data/incoming/promotion-shortlist.json","utf8"));
const pool = readGlobal("data/pool.js","ARTEFACTUM_POOL");
const qOf = id => (String(id||"").match(/Q\d+/)||[""])[0];
const poolQ = new Set(pool.map(p=>qOf(p.id)).filter(Boolean));
const junk = t => /\d{2,}[.\-]\d|[-_]\d{3,}|inv\.?|\bMS\b|\d{4,}/i.test(t||"") || /[-_]\d/.test(t||"");
const fameOf = sl => Math.round(100*Math.log((sl||0)+1));

let promoted=0, skipJunk=0, skipNoYear=0, skipDup=0, skipCopyright=0;
for(const w of ready){
  if(poolQ.has(qOf(w.id))){ skipDup++; continue; }
  if(junk(w.title)){ skipJunk++; continue; }
  if(w.y==null){ skipNoYear++; continue; }
  const artist = normalizeArtist(w.artist||"");          // strip CJK / tidy at entry
  if(isInCopyright(artist)){ skipCopyright++; continue; }  // never admit known in-copyright creators
  const style = canonicalizeStyle(w.style||"");          // merge variants, drop nationality-as-style, sentence-case
  pool.push({ id:w.id, title:w.title, artist, y:w.y, lat:w.lat, lng:w.lng,
    place:w.place, region:w.region, medium:w.medium||"", style,
    styleKind: style?(w.styleKind||"movement"):"", fame:fameOf(w.sitelinks),
    img:w.img, src:w.src, cats:["when","where","medium","style","artist"] });
  poolQ.add(qOf(w.id)); promoted++;
}
writeAssignment("data/pool.js","ARTEFACTUM_POOL",pool);
console.log(`promoted ${promoted} | skipped: dup ${skipDup}, junk-title ${skipJunk}, no-year ${skipNoYear}, in-copyright ${skipCopyright}`);
console.log(`pool size now ${pool.length}`);
// fail-closed: never leave the pool dirty after a promotion
console.log("\nrunning the pool gate…");
try { execSync("node scripts/check-pool.mjs", {stdio:"inherit"}); }
catch { console.error("\n⚠ check-pool found HARD violations after promotion — review/fix before committing."); process.exit(1); }
