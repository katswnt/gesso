// vision-next.mjs — select the next works to vision-audit, in DAILY-SCHEDULE ORDER (upcoming dates first),
// skipping any work already in the vision-audit ledger. Writes chunk input files for the Sonnet audit agents
// plus a manifest of the selected ids. This is what keeps the audit AHEAD of what players actually see.
//   node scripts/vision-next.mjs [count=20] [chunkSize=10]
// Output: data/incoming/vision/vw-in-<k>.json (chunks) + data/incoming/vision/vw-manifest.json (selected ids).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const COUNT = parseInt(process.argv[2] || "20", 10);
const CHUNK = parseInt(process.argv[3] || "10", 10);
const MODE = (process.argv[4] || "schedule").toLowerCase(); // "easy" = audit the easy tier first, then schedule order
const OUT = "data/incoming/vision";

const load = (path, varName) => { const g = {}; global.window = g; new Function(readFileSync(path, "utf8"))(); return g[varName]; };
const DAILY = load("data/daily-order.js", "ARTEFACTUM_DAILY");
const POOL = load("data/pool.js", "ARTEFACTUM_POOL");
const CUES = load("data/teach-works.js", "ARTEFACTUM_CUES").work || {};
const byId = new Map(POOL.map(p => [p.id, p]));
const ledger = JSON.parse(readFileSync("data/vision-audit.json", "utf8"));
const audited = new Set(ledger.ids || []);

const byDate = DAILY.byDate || {};
const today = new Date().toISOString().slice(0, 10);
const tiers = ["easy", "medium", "hard", "impossible"];
const dates = Object.keys(byDate).sort().filter(d => d > today); // upcoming only

const picked = [];
const seen = new Set();
// EASY-FIRST: the easy tier is what beginners see most and recurs ~monthly, so verify it to completion first.
// D.easy is the rotation [4 icons, 1 recognizable, ...] so iterating in order front-loads the most-seen icons.
if (MODE === "easy") {
  for (const id of (DAILY.easy || [])) {
    if (audited.has(id) || seen.has(id)) continue;
    seen.add(id); picked.push({ id, firstDate: "easy-tier", tier: "easy" });
    if (picked.length >= COUNT) break;
  }
}
// Fill the remainder (or the whole batch, in schedule mode) by upcoming daily date, de-duped.
outer: for (const d of dates) {
  if (picked.length >= COUNT) break;
  for (const t of tiers) for (const id of (byDate[d][t] || [])) {
    if (audited.has(id) || seen.has(id)) continue;
    seen.add(id); picked.push({ id, firstDate: d, tier: t });
    if (picked.length >= COUNT) break outer;
  }
}

// Build the per-work input records the audit agents consume (mirrors the nw-in schema).
const recs = picked.map(({ id, firstDate }) => {
  const p = byId.get(id) || {}; const c = CUES[id] || {};
  return {
    id, firstDate, title: p.title || "", artist: p.artist || "", img: p.img || "",
    place: p.place || "", date: p.y, medium: p.medium || "", style: p.style || "",
    why: c.why || "",
    notes: (c.notes || []).map(n => ({ head: n.head, body: n.body, ...(n.x != null ? { x: n.x, y: n.y } : {}) })),
    hotspotCount: (c.notes || []).filter(n => n.x != null).length
  };
});

mkdirSync(OUT, { recursive: true });
const nChunks = Math.ceil(recs.length / CHUNK);
for (let k = 0; k < nChunks; k++) writeFileSync(`${OUT}/vw-in-${k + 1}.json`, JSON.stringify(recs.slice(k * CHUNK, (k + 1) * CHUNK), null, 1));
writeFileSync(`${OUT}/vw-manifest.json`, JSON.stringify({ selected: recs.map(r => r.id), count: recs.length, chunks: nChunks }, null, 1));

const span = recs.length ? `${recs[0].firstDate} .. ${recs[recs.length - 1].firstDate}` : "(none)";
console.log(`vision-next: selected ${recs.length} unaudited works (schedule order ${span}) into ${nChunks} chunk(s)`);
console.log(`ledger has ${audited.size} audited; ${dates.length} upcoming dates scanned`);
