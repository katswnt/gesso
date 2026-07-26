// vision-next.mjs — select the next works to vision-audit, in DAILY-SCHEDULE ORDER (upcoming dates first),
// skipping any work already in the vision-audit ledger. Writes chunk input files for the Sonnet audit agents
// plus a manifest of the selected ids. This is what keeps the audit AHEAD of what players actually see.
//   node scripts/vision-next.mjs [count=20] [chunkSize=10]
// Output: data/incoming/vision/vw-in-<k>.json (chunks) + data/incoming/vision/vw-manifest.json (selected ids).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";

const COUNT = parseInt(process.argv[2] || "20", 10);
const CHUNK = parseInt(process.argv[3] || "10", 10);
const MODE = (process.argv[4] || "schedule").toLowerCase(); // "easy" = audit the easy tier first, then schedule order
const FMT = (process.argv[5] || "sonnet").toLowerCase();     // "codex" = also emit curate-codex input (in-*.json) + reset its codex-out
const OUT = "data/incoming/vision";

const load = (path, varName) => { const g = {}; global.window = g; new Function(readFileSync(path, "utf8"))(); return g[varName]; };
const DAILY = load("data/daily-order.js", "ARTEFACTUM_DAILY");
const POOL = load("data/pool.js", "ARTEFACTUM_POOL");
const CUES = load("data/teach-works.js", "ARTEFACTUM_CUES").work || {};
const HOT = (() => { const t = readFileSync("data/hotspots.js", "utf8"); return JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)); })();
const byId = new Map(POOL.map(p => [p.id, p]));
const ledger = JSON.parse(readFileSync("data/vision-audit.json", "utf8"));
const audited = new Set(ledger.ids || []);

const byDate = DAILY.byDate || {};
const today = new Date().toISOString().slice(0, 10);
const tiers = ["easy", "medium", "hard", "impossible"];
const dates = Object.keys(byDate).sort().filter(d => d > today); // upcoming only

const picked = [];
const seen = new Set();
// PRIORITY: ids listed in data/incoming/vision/priority.json (e.g. image-fixed blockers awaiting a re-audit)
// are picked FIRST, ahead of easy/schedule order, so a corrected work doesn't wait for its calendar slot.
try {
  const pri = JSON.parse(readFileSync("data/incoming/vision/priority.json", "utf8"));
  for (const id of pri) {
    if (picked.length >= COUNT) break;
    if (byId.has(id) && !audited.has(id) && !seen.has(id)) { seen.add(id); picked.push({ id, firstDate: "priority", tier: "priority" }); }
  }
} catch {}
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

// DEEP-POOL fallback: once the scheduled + easy-tier works are exhausted (the high-traffic set is
// audited), keep the burn-down going by filling from the rest of the playable un-audited pool,
// most-famous-first. This is what carries coverage past 100% of the calendar toward 100% of the pool.
if (picked.length < COUNT) {
  const rest = POOL.filter(p => p && p.play !== false && p.sensitive !== "remains" && !audited.has(p.id) && !seen.has(p.id))
    .sort((a, b) => (b.fame || 0) - (a.fame || 0));
  for (const p of rest) { if (picked.length >= COUNT) break; seen.add(p.id); picked.push({ id: p.id, firstDate: "deep-pool", tier: "deep" }); }
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

// CODEX FORMAT: emit curate-codex input (in-<letter>.json) for the SAME selection + reset the vision codex-out so
// nothing is skipped (curate-codex skips ids already in its codex-out; a fresh [] forces a re-audit of every pick).
if (FMT === "codex") {
  const ctx = id => { const p = byId.get(id) || {}, c = CUES[id] || {}; return { id, title: p.title, artist: p.artist || "anonymous", date: p.y, place: p.place, region: p.region, medium: p.medium || null, style: p.style || null, styleKind: p.styleKind || null, dim: p.dim || null, img: p.img, why: c.why, notes: (c.notes || []).map(n => { const o = { head: n.head, body: n.body }; if (typeof n.x === "number") { o.x = n.x; o.y = n.y; } return o; }), hotspotCount: (HOT[id] || []).length }; };
  const L = "abcdefghijklmnopqrstuvwxyz";
  // clear any stale in-*.json first
  for (const f of readdirSync(OUT)) if (/^in-[a-z]\.json$/.test(f)) unlinkSync(`${OUT}/${f}`);
  for (let k = 0; k < nChunks; k++) writeFileSync(`${OUT}/in-${L[k]}.json`, JSON.stringify(recs.slice(k * CHUNK, (k + 1) * CHUNK).map(r => ctx(r.id)), null, 1));
  writeFileSync(`${OUT}/codex-out.json`, "[]");
  console.log(`vision-next: also wrote ${nChunks} curate-codex chunk(s) + reset ${OUT}/codex-out.json`);
}

const span = recs.length ? `${recs[0].firstDate} .. ${recs[recs.length - 1].firstDate}` : "(none)";
console.log(`vision-next: selected ${recs.length} unaudited works (schedule order ${span}) into ${nChunks} chunk(s)`);
console.log(`ledger has ${audited.size} audited; ${dates.length} upcoming dates scanned`);
