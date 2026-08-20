// Date sanity audit (reads the shared WD cache; run with plain `node`, NOT codex sandbox). Compares each pool
// work's `y` against its Wikidata P571 inception and flags large disagreements for REVIEW. WD inception is not
// ground truth either — it can pick an early study/variant (e.g. Bonaparte Before the Sphinx: WD 1867 vs the
// known 1886 Hearst version) — so this is a review signal, not an auto-fix. Complements check-pool's
// century-off check (which compares `y` against the NOTE text); a work flagged by BOTH is high-confidence.
// Writes data/incoming/date-audit/report.json. Usage: node scripts/audit-date.mjs
import { readGlobal } from "./lib/static-module.mjs";
import { loadWdEntities } from "./lib/wd-cache.mjs";
import { writeFileSync, mkdirSync } from "node:fs";

const DIR = "data/incoming/date-audit"; mkdirSync(DIR, { recursive: true });
const pool = readGlobal("data/pool.js", "ARTEFACTUM_POOL");
const qidOf = p => { const m = String(p.id).match(/Q\d+/); return (m && /^(wikidata:|http:\/\/www\.wikidata)/.test(p.id)) ? m[0] : null; };
const works = pool.map(p => ({ p, qid: qidOf(p) })).filter(x => x.qid && Number.isFinite(x.p.y));
const yearOf = v => { const m = String(v || "").match(/^([+-]?)0*(\d+)/); if (m) { const y = (m[1] === "-" ? -1 : 1) * parseInt(m[2], 10); return y || null; } return null; };
const centuryOf = y => Math.floor((y - 1) / 100) + 1; // CE century (y=1..100 → 1st)

const ents = await loadWdEntities(works.map(w => w.qid), { onProgress: (d, t) => { if (d % 600 < 100) console.error(`  ${d}/${t} fetched`); } });
// WD inception is noisy, so classify the DISAGREEMENT rather than blindly trust WD:
//   POOL_SUSPECT — pool `y` looks like a digit typo of a plausible WD date (|10·a − b| ≤ 50 either way, e.g.
//                  Swimming Reindeer −1100 vs WD −11000). These are the actionable pool-side errors to fix.
//   WD_SIGN      — |poolY| == |wdY| with opposite signs → WD dropped the BCE minus; the pool date is correct.
//   WD_JUNK      — WD inception is a placeholder (exactly year 2000 while the pool date is pre-1950). Pool correct.
//   REVIEW       — genuine disagreement (≥25y or century-off) that isn't one of the above → human adjudication.
//   MED          — 3–24y wobble (variant/period dating), low priority.
const buckets = { POOL_SUSPECT: [], WD_SIGN: [], WD_JUNK: [], REVIEW: [], MED: [] };
for (const w of works) {
  const e = ents.get(w.qid); const wy = yearOf(e?.inception); if (wy == null) continue;
  const py = w.p.y, diff = Math.abs(py - wy); if (diff < 3) continue;
  const centuryOff = py > 0 && wy > 0 && centuryOf(py) !== centuryOf(wy);
  const a = Math.abs(py), b = Math.abs(wy);
  // one date is ~10× the other AND the larger is in the thousands → a dropped/added zero (e.g. −1100 vs
  // −11000). The "larger ≥ 1000" guard avoids coincidences at small magnitudes (Portland Vase 5 vs 100,
  // Laocoön 42 vs 1) where both are plausible dates and the pool is fine.
  const digitShift = (Math.abs(a * 10 - b) <= 50 && b >= 1000) || (Math.abs(b * 10 - a) <= 50 && a >= 1000);
  const signFlip = py === -wy && py !== 0;
  const wdJunk = wy === 2000 && py < 1950;
  const rec = { id: w.p.id, title: (w.p.title || "").slice(0, 50), artist: w.p.artist, poolY: py, wdY: wy, diff, centuryOff };
  let k;
  if (signFlip) k = "WD_SIGN";
  else if (wdJunk) k = "WD_JUNK";
  else if (digitShift) k = "POOL_SUSPECT";
  else if (diff >= 25 || centuryOff) k = "REVIEW";
  else k = "MED";
  buckets[k].push(rec);
}
for (const k of Object.keys(buckets)) buckets[k].sort((x, y) => y.diff - x.diff);
writeFileSync(`${DIR}/report.json`, JSON.stringify(buckets, null, 1));
console.error(`\nPOOL_SUSPECT (pool y looks like a digit-typo — FIX): ${buckets.POOL_SUSPECT.length}`);
console.error(`WD_SIGN  (WD dropped BCE sign, pool OK): ${buckets.WD_SIGN.length}`);
console.error(`WD_JUNK  (WD placeholder year 2000, pool OK): ${buckets.WD_JUNK.length}`);
console.error(`REVIEW   (genuine ≥25y / century-off disagreement): ${buckets.REVIEW.length}`);
console.error(`MED      (3–24y wobble): ${buckets.MED.length}`);
console.error(`\n-- POOL_SUSPECT (adjudicate/fix) --`);
for (const r of buckets.POOL_SUSPECT) console.error(`  y${r.poolY} vs WD ${r.wdY} (Δ${r.diff})  ${r.title} — ${r.artist || "anon"}`);
console.error(`\n-- REVIEW (top 30) --`);
for (const r of buckets.REVIEW.slice(0, 30)) console.error(`  y${r.poolY} vs WD ${r.wdY} (Δ${r.diff}${r.centuryOff ? ", century-off" : ""})  ${r.title} — ${r.artist || "anon"}`);
