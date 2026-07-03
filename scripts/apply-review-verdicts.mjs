// Apply VERIFIED review-queue verdicts (verify-out-*.json) to the pool.
//   node scripts/apply-review-verdicts.mjs data/incoming/curate/verify-out-*.json
// Each verdict: { id, type, action:'apply'|'reject', value, value2?, movementMeta?, reason }
// - place: w.place=value; w.region=value2 (if given)
// - title: w.title=value
// - date : parse value ("-130" | "1620-1640" | 1615) -> w.y=lo, w.yr=[lo,hi]
// - image: w.img=value
// - style-unmapped: w.style=value; w.styleKind=value2||'movement'; register movementMeta in index.html MOVEMENTS
// Rejects are dropped from the queue too (decision made). Applied+rejected ids leave the queue.
import { readFileSync, writeFileSync } from "node:fs";
import { canonicalizePlace, continentOf } from "./lib/places.mjs";

const files = process.argv.slice(2);
if (!files.length) { console.error("usage: apply-review-verdicts.mjs <verify-out-*.json>..."); process.exit(1); }

const qnum = id => { const m = String(id).match(/Q\d+/); return m ? m[0] : String(id); };
function parseRange(to) {
  let t = String(to).trim().replace(/^(c\.?|ca\.?|circa)\s*/i, "").replace(/[‒–—]/g, "-").trim();
  let m = t.match(/^(-?\d+)\s*-\s*(-?\d+)$/);
  if (m) { const lo = +m[1], hi = +m[2]; return (Number.isFinite(lo) && Number.isFinite(hi) && hi >= lo) ? [lo, hi] : null; }
  m = t.match(/^(-?\d+)$/); if (m) { const y = +m[1]; return Number.isFinite(y) ? [y, y] : null; }
  return null;
}

// ---- load pool.js ----
const psrc = readFileSync("data/pool.js", "utf8");
globalThis.window = {};
new Function(psrc)();
const pool = window.ARTEFACTUM_POOL;
const byId = new Map(); for (const w of pool) { byId.set(w.id, w); byId.set(qnum(w.id), w); }
const find = id => byId.get(id) || byId.get(qnum(id));

// ---- load index.html MOVEMENTS keys ----
let html = readFileSync("index.html", "utf8");
const movStart = html.indexOf("const MOVEMENTS={");
const movKeys = new Set([...html.slice(movStart, html.indexOf("};", movStart)).matchAll(/"([^"]+)":\{/g)].map(m => m[1]));
const newMovements = [];

const applied = { place: 0, title: 0, date: 0, image: 0, "style-unmapped": 0 }, skipped = [], rejected = [];
const doneIds = new Set(); // (id|type) pairs removed from queue

for (const file of files) {
  const fileType = (file.match(/verify-out-(place|title|date|image|style-unmapped)/) || [])[1] || null; // agents sometimes omit v.type
  const verdicts = JSON.parse(readFileSync(file, "utf8"));
  for (const raw of verdicts) {
    const v = { ...raw, type: raw.type || fileType };
    doneIds.add(v.id + "|" + v.type);
    if (v.action !== "apply") { rejected.push(v.type + " " + v.id); continue; }
    const w = find(v.id);
    if (!w) { skipped.push(`${v.type} ${v.id} (not in pool)`); continue; }
    if (v.type === "place") { if (v.value) { w.place = canonicalizePlace(v.value); const cont = continentOf(w.place); w.region = cont || v.value2 || w.region; applied.place++; } }
    else if (v.type === "title") { if (v.value) { w.title = v.value; applied.title++; } }
    else if (v.type === "date") { const r = parseRange(v.value); if (r) { w.y = r[0]; w.yr = [r[0], r[1]]; applied.date++; } else skipped.push(`date ${v.id} unparseable "${v.value}"`); }
    else if (v.type === "image") { if (v.value && /^https?:\/\//.test(v.value)) { w.img = v.value; applied.image++; } else skipped.push(`image ${v.id} bad url`); }
    else if (v.type === "style-unmapped") {
      if (!v.value) continue;
      w.style = v.value; w.styleKind = v.value2 || "movement"; applied["style-unmapped"]++;
      if (v.movementMeta && v.movementMeta.dates && !movKeys.has(v.value) && !newMovements.find(m => m.key === v.value)) {
        const palette = Array.isArray(v.movementMeta.palette) && v.movementMeta.palette.length === 4 ? v.movementMeta.palette : ["#7a3e24", "#a98244", "#1f6f5b", "#e8ddc3"];
        newMovements.push({ key: v.value, dates: v.movementMeta.dates, region: v.movementMeta.region || w.region || "", palette });
      }
    }
  }
}

// ---- insert new MOVEMENTS right after the opening brace ----
if (newMovements.length) {
  const anchor = "const MOVEMENTS={";
  const at = html.indexOf(anchor) + anchor.length;
  const ins = "\n" + newMovements.map(m => `  ${JSON.stringify(m.key)}:{dates:${JSON.stringify(m.dates)},region:${JSON.stringify(m.region)},palette:${JSON.stringify(m.palette)}},`).join("\n");
  html = html.slice(0, at) + ins + html.slice(at);
  writeFileSync("index.html", html);
}

// ---- write pool.js back (preserve wrapper) ----
const pi = psrc.indexOf("["), pj = psrc.lastIndexOf("]");
writeFileSync("data/pool.js", psrc.slice(0, pi) + JSON.stringify(pool) + psrc.slice(pj + 1));

// ---- prune the queue of every decided (id,type) ----
const qpath = "data/incoming/curate/review-queue.json";
const q = JSON.parse(readFileSync(qpath, "utf8"));
const keep = q.filter(e => !doneIds.has(e.id + "|" + e.type));
writeFileSync(qpath, JSON.stringify(keep, null, 0));

console.log("APPLIED:", JSON.stringify(applied));
console.log("new MOVEMENTS:", newMovements.map(m => m.key).join(", ") || "(none)");
console.log(`rejected (dropped from queue): ${rejected.length} | skipped: ${skipped.length} | queue now: ${keep.length}`);
if (skipped.length) skipped.slice(0, 10).forEach(s => console.log("  skip:", s));
