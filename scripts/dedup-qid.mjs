// Collapse pool entries that share the same Wikidata QID under different id prefixes
// (e.g. "wd:Q2717022" vs "wikidata:Q2717022" vs "http://www.wikidata.org/entity/Q2717022").
// These are the SAME artwork imported twice, so the work can get scheduled on two days.
//
// Rule: KEEP the id that the immutable ledger (data/daily-history.js) references — a served
// day can never be rewritten to point at a different id. If neither side is in the ledger,
// keep the non-"wd:" prefix (the canonical harvest). Merge any field the kept entry is MISSING
// from the dropped one (never overwrite good data), drop the other pool entry, and rename the
// dropped id -> kept id in the enrichment files (teach-works / hotspots / vision) so notes/pins
// follow. Then RE-FREEZE future (RESHUFFLE_FUTURE=1) so the double-scheduling clears, and gate.
//   node scripts/dedup-qid.mjs [--apply]
import { readFileSync, writeFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const raw = readFileSync("data/pool.js", "utf8");
const w = {}; new Function("window", raw)(w);
const pool = w.ARTEFACTUM_POOL;
const ledger = readFileSync("data/daily-history.js", "utf8");

const qOf = id => { const m = String(id).match(/Q\d+/); return m ? m[0] : null; };
const byQ = {}; for (const p of pool) { const q = qOf(p.id); if (!q) continue; (byQ[q] = byQ[q] || []).push(p); }
const dupes = Object.entries(byQ).filter(([q, ps]) => ps.length > 1);
const inLedger = id => ledger.includes(JSON.stringify(id).slice(1, -1));

const drops = [];        // { keepId, dropId }
for (const [q, ps] of dupes) {
  // choose keep: ledger-referenced first, else non-"wd:" prefix, else the longer record
  let keep = ps.find(p => inLedger(p.id))
          || ps.find(p => !/^wd:/.test(p.id))
          || ps.slice().sort((a, b) => JSON.stringify(b).length - JSON.stringify(a).length)[0];
  for (const p of ps) {
    if (p === keep) continue;
    if (inLedger(p.id)) { console.error(`!! ABORT: both ids of ${q} are in the ledger — needs a manual id-normalization (${p.id} + ${keep.id})`); process.exit(1); }
    // merge: fill any field the keeper is missing/empty from the dropped entry (never overwrite)
    for (const k of Object.keys(p)) { if (keep[k] === undefined || keep[k] === "" || keep[k] === null) keep[k] = p[k]; }
    drops.push({ keepId: keep.id, dropId: p.id, title: keep.title });
  }
}

console.log(`duplicate QIDs: ${dupes.length} · entries to drop: ${drops.length}`);
for (const d of drops) console.log(`  keep ${d.keepId}\n  drop ${d.dropId}   (${d.title})`);

if (!APPLY) { console.log("\n(dry run — pass --apply to write)"); process.exit(0); }

// remove dropped entries from the pool
const dropIds = new Set(drops.map(d => d.dropId));
const kept = pool.filter(p => !dropIds.has(p.id));
writeFileSync("data/pool.js", raw.slice(0, raw.indexOf("[")) + JSON.stringify(kept) + raw.slice(raw.lastIndexOf("]") + 1));

// rename dropId -> keepId in the enrichment files (so notes/pins/vision follow the kept id)
for (const f of ["data/teach-works.js", "data/hotspots.js", "data/vision.js", "data/daily-order.js"]) {
  let s; try { s = readFileSync(f, "utf8"); } catch { continue; }
  let n = 0; for (const d of drops) { const from = JSON.stringify(d.dropId).slice(1, -1), to = JSON.stringify(d.keepId).slice(1, -1);
    if (s.includes(from)) { s = s.split(from).join(to); n++; } }
  if (n) { writeFileSync(f, s); console.log(`  renamed ${n} id(s) in ${f}`); }
}

// verify roundtrip
const v = {}; new Function("window", readFileSync("data/pool.js", "utf8"))(v);
console.log(`\napplied. pool now ${v.ARTEFACTUM_POOL.length} works (was ${pool.length}).`);
console.log("NEXT: RESHUFFLE_FUTURE=1 node scripts/freeze-daily.mjs  (clear double-scheduling)  ·  then node scripts/check-pool.mjs");
