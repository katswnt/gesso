// Apply the DETERMINISTIC verdicts from data/incoming/curate/triage.json:
//  - "apply"  : Wikidata-confirmed corrections → write into the pool
//  - "discard": stale flags → just drop from the queue (no pool change)
// Leaves the "review" (needs-eyes) items in review-queue.json. Run AFTER queue-triage.mjs.
//   node scripts/queue-apply.mjs           (dry: report only)
//   node scripts/queue-apply.mjs --apply   (write pool + trimmed queue)
import { readFileSync, writeFileSync } from "node:fs";
import { readGlobal, writeAssignment } from "./lib/static-module.mjs";

const APPLY = process.argv.includes("--apply");
const tri = JSON.parse(readFileSync("data/incoming/curate/triage.json", "utf8"));
const pool = readGlobal("data/pool.js", "ARTEFACTUM_POOL");
const byId = new Map(pool.map(p => [p.id, p]));

const dateRange = v => { const n = String(v).match(/\d{3,4}/g); if(!n) return null; const a=+n[0]; let b=n[1]?+n[1]:a; if(b<a) b=+(String(a).slice(0,2)+String(n[1]).padStart(2,"0")); return [a,b]; };

const counts = { date:0, place:0, title:0, image:0, skip:0 };
for(const it of tri.apply){
  const p = byId.get(it.id); if(!p){ counts.skip++; continue; }
  if(it.type === "date"){ const r = dateRange(it.to); if(r){ p.yr = r; p.y = r[0]; counts.date++; } }
  else if(it.type === "place"){ p.place = it.to; counts.place++; }
  else if(it.type === "title"){ p.title = it.to; counts.title++; }
  else if(it.type === "image"){ const m = String(it.how).match(/P18:\s*(\S+)/); if(m){ let u = m[1]; if(!/width=/.test(u)) u += (u.includes("?")?"&":"?")+"width=1600"; p.img = u; counts.image++; } }
}

// trimmed queue = only the needs-eyes items
const trimmed = tri.review.map(({ how, ...it }) => it);

console.log(`APPLY: date ${counts.date}, place ${counts.place}, title ${counts.title}, image ${counts.image} (skipped ${counts.skip})`);
console.log(`DISCARD: ${tri.discard.length} stale flags dropped`);
console.log(`queue after: ${trimmed.length} needs-eyes items remain`);
if(APPLY){
  writeAssignment("data/pool.js", "ARTEFACTUM_POOL", pool);
  writeFileSync("data/incoming/curate/review-queue.json", JSON.stringify(trimmed, null, 1));
  console.log("WROTE data/pool.js + trimmed review-queue.json — now run the gate as its own step.");
} else console.log("DRY RUN — pass --apply to write.");
