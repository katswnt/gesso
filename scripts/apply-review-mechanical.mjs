// Apply the MECHANICAL slice of the review queue: formatting-only title fixes +
// deterministically-parseable date changes (ranges / BCE sign fixes). Judgment items
// (places, substantive titles, images, styles, un-parseable dates) are left in the queue.
// Reversible: prints exactly what it changed; re-run curate gate afterwards.
import { readFileSync, writeFileSync } from "node:fs";

const QUEUE = "data/incoming/curate/review-queue.json";
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const qnum = id => { const m = String(id).match(/Q\d+/); return m ? m[0] : String(id); };

// --- load pool.js preserving the window.ARTEFACTUM_POOL = [...] wrapper ---
const raw = readFileSync("data/pool.js", "utf8");
globalThis.window = {};
new Function(raw)();
const pool = window.ARTEFACTUM_POOL;
const byId = new Map();
for (const w of pool) { byId.set(w.id, w); byId.set(qnum(w.id), w); }
const find = id => byId.get(id) || byId.get(qnum(id));

// --- date "to" parser: returns [lo,hi] or null ---
function parseRange(to) {
  let t = String(to).trim().replace(/^(c\.?|ca\.?|circa)\s*/i, "").replace(/[‒-―]/g, "-").trim();
  // range: digits - digits  (both sides, second may be shorthand like 1884/86)
  let m = t.match(/^(-?\d+)\s*[\/-]\s*(-?\d+)$/);
  if (m) {
    let lo = parseInt(m[1], 10), hi = parseInt(m[2], 10);
    if (hi < lo && hi >= 0 && String(Math.abs(hi)).length < String(Math.abs(lo)).length) {
      // shorthand "1884/86" -> 1886 : borrow high-order digits from lo
      const s = String(lo); hi = parseInt(s.slice(0, s.length - String(m[2]).replace("-", "").length) + m[2], 10);
    }
    if (Number.isFinite(lo) && Number.isFinite(hi) && hi >= lo) return [lo, hi];
    return null;
  }
  // single (incl. negative BCE)
  m = t.match(/^(-?\d+)$/);
  if (m) { const y = parseInt(m[1], 10); return Number.isFinite(y) ? [y, y] : null; }
  return null;
}

const q = JSON.parse(readFileSync(QUEUE, "utf8"));
const applied = [], skipped = [], keep = [];

for (const e of q) {
  if (e.type === "title" && norm(e.from) === norm(e.to)) {
    const w = find(e.id);
    if (w && w.title !== e.to) { w.title = e.to; applied.push(`title  ${e.id}  "${e.from}" -> "${e.to}"`); }
    else if (!w) { keep.push(e); skipped.push(`title  ${e.id}  (not in pool)`); }
    else applied.push(`title  ${e.id}  (already "${e.to}")`);
    continue;
  }
  if (e.type === "date") {
    const r = parseRange(e.to);
    if (!r) { keep.push(e); continue; }                 // un-parseable -> judgment
    const w = find(e.id);
    if (!w) { keep.push(e); skipped.push(`date   ${e.id}  (not in pool)`); continue; }
    const [lo, hi] = r;
    const oldY = w.y, oldYr = JSON.stringify(w.yr || null);
    w.y = lo;                                            // primary year = range start (display)
    w.yr = lo === hi ? [lo, hi] : [lo, hi];
    if (w.y !== oldY || JSON.stringify(w.yr) !== oldYr)
      applied.push(`date   ${e.id}  y ${oldY}->${lo}  yr=[${lo},${hi}]`);
    continue;
  }
  keep.push(e);                                          // everything else stays for Sonnet
}

// write pool.js back with identical wrapper
writeFileSync("data/pool.js", raw.slice(0, raw.indexOf("[")) + JSON.stringify(pool) + raw.slice(raw.lastIndexOf("]") + 1));
writeFileSync(QUEUE, JSON.stringify(keep, null, 0));

console.log(`APPLIED ${applied.length}  |  SKIPPED(not in pool) ${skipped.length}  |  REMAINING in queue ${keep.length}`);
console.log("--- sample applied ---");
applied.slice(0, 12).forEach(l => console.log("  " + l));
if (skipped.length) { console.log("--- skipped ---"); skipped.slice(0, 8).forEach(l => console.log("  " + l)); }
const remTypes = {}; for (const e of keep) remTypes[e.type] = (remTypes[e.type] || 0) + 1;
console.log("remaining by type:", remTypes);
