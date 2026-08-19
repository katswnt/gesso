// Systematic EASY-tier exclusion: a work can be world-famous yet a bad EASY puzzle because a FACET is
// expert-level. The dominant offender is the WHEN facet: ancient works can't be dated within tolerance even
// when instantly recognized (you know it's Tutankhamun, but pinning 1323 BCE is not an "easy" ask). The old
// easy-exclude.json came from a SPARSE blinded probe, so it missed most antiquities. This computes the
// exclusion deterministically from the date, unions it with any hand-kept ids, and writes easy-exclude.json.
// The freeze demotes these to medium/hard by fame (they're not dropped). Does NOT re-freeze — run freeze-daily
// afterward (future dates only; today/past stay pinned).
//   node scripts/build-easy-exclude.mjs            # dry run: show what would be excluded
//   node scripts/build-easy-exclude.mjs --write [--cutoff 800]
import { readFileSync, writeFileSync } from "node:fs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const CUTOFF = +arg("--cutoff", 800); // exclude works dated before this year (CE). BCE is always below it.

const EASY_MARGIN = +arg("--margin", 650); // only the top-N works by fame can reach Easy (~410 band + margin);
// excluding ancient works BELOW this rank is pointless — they're already in medium/hard by fame.

let s = readFileSync("data/pool.js", "utf8");
const pool = JSON.parse(s.slice(s.indexOf("["), s.lastIndexOf("]") + 1));
const prev = JSON.parse(readFileSync("data/easy-exclude.json", "utf8"));
const keepIds = new Set(prev.ids || []); // preserve prior (probe-derived / hand) exclusions
// use the CORRECT fame (overlay fame.js wins over the sometimes-stale pool.fame field)
const overlay = JSON.parse(readFileSync("data/fame.js", "utf8").replace("window.ARTEFACTUM_FAME=", "").replace(/;\s*$/, ""));
const fameOf = p => overlay[p.id] != null ? overlay[p.id] : (p.fame || 0);
const easyZone = new Set([...pool].sort((a, b) => fameOf(b) - fameOf(a)).slice(0, EASY_MARGIN).map(p => p.id));

// WHEN-difficulty tier for reporting: how far off a good-faith century guess is likely to be.
const sev = y => y < -800 ? "brutal (pre-classical / BCE)" : y < 300 ? "hard (classical antiquity)" : "moderate (late antiquity / early medieval)";
// exclude only ancient works that are ALSO fame-competitive for Easy (else it's a no-op demotion)
const excluded = pool.filter(p => p.y != null && p.y < CUTOFF && easyZone.has(p.id));
const newlyExcluded = excluded.filter(p => !keepIds.has(p.id));

// group for the report
const byGroup = {};
for (const p of newlyExcluded) (byGroup[sev(p.y)] = byGroup[sev(p.y)] || []).push(p);
console.log(`EASY exclusion by WHEN facet — cutoff ${CUTOFF} CE\n`);
console.log(`already excluded (kept): ${keepIds.size} · newly excluded by date rule: ${newlyExcluded.length}\n`);
for (const g of ["brutal (pre-classical / BCE)", "hard (classical antiquity)", "moderate (late antiquity / early medieval)"]) {
  const ws = (byGroup[g] || []).sort((a, b) => a.y - b.y);
  if (!ws.length) continue;
  console.log(`── ${g} (${ws.length}) ──`);
  for (const p of ws) console.log(`   ${p.y > 0 ? p.y + " CE" : (-p.y) + " BCE"}  "${p.title}" — ${p.style} [${p.place}]`);
  console.log("");
}

if (process.argv.includes("--write")) {
  const ids = [...new Set([...keepIds, ...excluded.map(p => p.id)])];
  const out = { note: `Excluded from EASY: recognizable works whose WHEN facet is expert-level (dated before ${CUTOFF} CE — you can recognize it but not date it within tolerance). Deterministic date rule (scripts/build-easy-exclude.mjs); check-pool HARD-fails if this list goes stale. Demoted to medium/hard by fame, not dropped.`, cutoff: CUTOFF, margin: EASY_MARGIN, ids };
  writeFileSync("data/easy-exclude.json", JSON.stringify(out, null, 1));
  console.log(`✔ wrote data/easy-exclude.json (${ids.length} ids). Run freeze-daily (future dates only) to apply.`);
} else console.log("(dry run — pass --write [--cutoff N] to apply)");
