// Stage works for the cross-field consistency sweep (metadata-only). Selects playable, un-swept works in
// daily-schedule order and writes cs-in-N.json chunks + a manifest. Tracks swept ids in
// data/incoming/consistency/ledger.json so re-runs advance instead of repeating.
//   node scripts/consistency-next.mjs [count=100] [chunkSize=50]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { readGlobal } from "./lib/static-module.mjs";

const COUNT = parseInt(process.argv[2] || "100", 10);
const CHUNK = parseInt(process.argv[3] || "50", 10);
const OUT = "data/incoming/consistency";
mkdirSync(OUT, { recursive: true });

const pool = readGlobal("data/pool.js", "ARTEFACTUM_POOL");
const DAILY = readGlobal("data/daily-order.js", "ARTEFACTUM_DAILY");
let swept = new Set(); try { swept = new Set(JSON.parse(readFileSync(`${OUT}/ledger.json`, "utf8")).ids || []); } catch {}

const byId = new Map(pool.map(p => [p.id, p]));
const today = new Date().toISOString().slice(0, 10);
const eligible = p => p && p.play !== false && p.sensitive !== "remains" && !swept.has(p.id);

// schedule order first (upcoming dailies), then any remaining playable works
const picked = []; const seen = new Set();
for (const d of Object.keys(DAILY.byDate || {}).sort().filter(d => d > today)) {
  for (const t of ["easy","medium","hard","impossible"]) for (const id of (DAILY.byDate[d][t] || [])) {
    if (picked.length >= COUNT) break; const p = byId.get(id);
    if (eligible(p) && !seen.has(id)) { seen.add(id); picked.push(p); }
  }
  if (picked.length >= COUNT) break;
}
for (const p of pool) { if (picked.length >= COUNT) break; if (eligible(p) && !seen.has(p.id)) { seen.add(p.id); picked.push(p); } }

const recs = picked.map(p => ({ id: p.id, title: p.title || "", artist: p.artist || "", year: p.y, place: p.place || "", region: p.region || "", style: p.style || "", styleKind: p.styleKind || "", medium: p.medium || "" }));
const n = Math.ceil(recs.length / CHUNK);
for (let k = 0; k < n; k++) writeFileSync(`${OUT}/cs-in-${k + 1}.json`, JSON.stringify(recs.slice(k * CHUNK, (k + 1) * CHUNK), null, 1));
writeFileSync(`${OUT}/cs-manifest.json`, JSON.stringify({ ids: recs.map(r => r.id), count: recs.length, chunks: n }, null, 1));
console.log(`consistency-next: ${recs.length} works into ${n} chunk(s) | ${swept.size} already swept`);
