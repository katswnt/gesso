// Promote the reviewed coverage set (data/incoming/promote-final.json) into the live pool. Appends via
// writeAssignment (preserves pool.js format), dedups defensively, and does a last inline scrub of
// culture-names-as-artist. Does NOT gate/commit — run check-pool as its OWN step after, then commit.
//   node scripts/promote-coverage.mjs
import { readFileSync } from "node:fs";
import { readGlobal, writeAssignment } from "./lib/static-module.mjs";

const { ready } = JSON.parse(readFileSync("data/incoming/promote-final.json", "utf8"));
const pool = readGlobal("data/pool.js", "ARTEFACTUM_POOL");
const poolIds = new Set(pool.map(p => String(p.id)));
const poolQs = new Set(pool.map(p => (String(p.id).match(/Q\d+/) || [])[0]).filter(Boolean));
const poolImgs = new Set(pool.map(p => p.img));

// a culture/people/provenance descriptor is not an artist. Matches a bare culture name OR a museum provenance
// string like "Byzantine; Eastern Mediterranean" / "Coptic; Egypt" (culture prefix, then ; or place).
const CULTURE_ARTIST = /^(franks|frankish|byzantine|coptic|sasanian|sassanian|roman|greek|hellenistic|nazca|moche|chimu|wari|inca|maya|aztec|olmec|viking|anglo-saxon|merovingian|carolingian|ottonian|langobard|lombard|visigothic|egyptian|persian|islamic|ottoman|safavid|mamluk|dogon|luba|benin|yoruba)\b/i;

let added = 0, dup = 0;
for (const r of ready) {
  const q = (String(r.id).match(/Q\d+/) || [])[0];
  if (poolIds.has(String(r.id)) || (q && poolQs.has(q)) || poolImgs.has(r.img)) { dup++; continue; }
  const rec = { ...r };
  if (CULTURE_ARTIST.test(rec.artist || "")) { rec.artist = ""; rec.cats = rec.cats.filter(c => c !== "artist"); } // culture ≠ artist
  pool.push(rec); poolIds.add(String(r.id)); if (q) poolQs.add(q); poolImgs.add(r.img); added++;
}
writeAssignment("data/pool.js", "ARTEFACTUM_POOL", pool);
console.log(`promoted ${added} coverage works (skipped ${dup} dup) — pool size now ${pool.length}`);
// auto-run the advisory audit suite, matching the other promoters (promote-canon/harvest/modern/wishlist)
(await import("node:child_process")).execSync("node scripts/audit-all.mjs", { stdio: "inherit" });
console.log("NEXT: run  node scripts/check-pool.mjs  as its own step; commit only if it prints ✅ PASS.");
