// Promote the US-PD modern works (data/incoming/modern-fetched.json) into the live pool.
// Marks household-name icons canon:true (Easy); geocodes place→centroid; merges any notes.
// Then injects fame.json entries for the new ids and runs make-fame-js + audits.
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
const adds=JSON.parse(readFileSync("data/incoming/modern-fetched.json","utf8"));
// household-name icons → canon (guaranteed Easy). The rest rank by real pageviews.
const CANON=new Set([
 "Portrait of Adele Bloch-Bauer I","Madonna","The Sick Child","Composition VII",
 "Composition II in Red, Blue, and Yellow","Senecio","Twittering Machine","Woman with a Hat",
 "The Joy of Life","White on White","Unique Forms of Continuity in Space","The Large Blue Horses",
 "The Sleeping Gypsy","Dogs Playing Poker","Death and the Maiden","Reclining Nude"]);
global.window={}; new Function(readFileSync("data/countries.js","utf8"))();
const CO={}; for(const c of window.ARTEFACTUM_COUNTRIES) CO[c.n.toLowerCase()]=c;
function centroid(c){ let big=c.r[0]; for(const r of c.r) if(r.length>big.length) big=r; let sx=0,sy=0; for(const[x,y]of big){sx+=x;sy+=y;} return [Math.round(sy/big.length*1000)/1000,Math.round(sx/big.length*1000)/1000]; }
const raw=readFileSync("data/pool.js","utf8");
const pool=JSON.parse(raw.slice(raw.indexOf("["),raw.lastIndexOf("]")+1));
const have=new Set(pool.map(p=>p.id));
let added=0,skipped=0;
for(const w of adds){ if(have.has(w.id)){ skipped++; continue; }
  const co=CO[(w.place||"").toLowerCase()]; const [lat,lng]=co?centroid(co):[null,null];
  const canon=CANON.has(w.title);
  pool.push({ id:w.id, title:w.title, artist:w.artist||"", y:w.y, lat, lng, medium:w.medium||"",
    place:co?co.n:(w.place||""), fame:canon?200:120, img:w.img, src:"wd-modern",
    region:w.region||"Europe", style:w.style||"", styleKind:w.styleKind||(w.style?"movement":""),
    ...(canon?{canon:true}:{}) });
  have.add(w.id); added++;
}
writeFileSync("data/pool.js", raw.slice(0,raw.indexOf("["))+JSON.stringify(pool)+raw.slice(raw.lastIndexOf("]")+1));
console.log(`promoted ${added} modern works (skipped ${skipped}, ${[...CANON].length} canon-tagged) | pool now ${pool.length}`);
const noco=pool.filter(p=>p.src==="wd-modern"&&p.lat==null).map(p=>p.title); if(noco.length) console.log("no-coord:",noco.join(", "));
console.log("\n› injecting fame + rebuilding fame.js…");
execSync("node scripts/inject-modern-fame.mjs",{stdio:"inherit"});
console.log("\n› running audits…");
execSync("node scripts/audit-all.mjs",{stdio:"inherit"});
