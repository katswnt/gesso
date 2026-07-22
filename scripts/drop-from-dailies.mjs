// Surgically remove specific work-ids from FUTURE dailies WITHOUT reshuffling the whole calendar.
// For each future date/tier slot holding a flagged id, swap in a same-tier-band replacement that isn't
// used within ±WORK_GAP days — leaving every other slot untouched. This is the safe alternative to
// RESHUFFLE_FUTURE=1 (which regenerates the entire future and bounces works between adjacent days →
// cross-day repeats for anyone playing across the churn). Served days (<= today) are never modified.
//   node scripts/drop-from-dailies.mjs <id> [<id> ...]
//   node scripts/drop-from-dailies.mjs --unplayable   (auto: every play:false / sensitive:remains work)
import { readFileSync, writeFileSync } from "node:fs";
import { readGlobal } from "./lib/static-module.mjs";

const pool = readGlobal("data/pool.js", "ARTEFACTUM_POOL");
const overlay = (() => { try { const f = readFileSync("data/fame.js", "utf8"); return JSON.parse(f.slice(f.indexOf("{"), f.lastIndexOf("}") + 1)); } catch { return {}; } })();
const fameOf = id => overlay[id] != null ? overlay[id] : ((pool.find(p => p.id === id) || {}).fame || 0);
const byId = new Map(pool.map(p => [p.id, p]));
const workComplete = p => p && !!((p.medium && String(p.medium).trim()) || (p.style && String(p.style).trim())) && p.sensitive !== "remains" && p.play !== false;

const DAILY = JSON.parse(readFileSync("data/daily-order.js", "utf8").replace("window.ARTEFACTUM_DAILY=", "").replace(/;\s*$/, ""));
const today = new Date().toISOString().slice(0, 10);
const TIERS = ["easy", "medium", "hard", "impossible"];
const WORK_GAP = 21;

let drop;
if (process.argv.includes("--unplayable")) drop = new Set(pool.filter(p => p.play === false || p.sensitive === "remains").map(p => p.id));
else drop = new Set(process.argv.slice(2).filter(a => !a.startsWith("--")));
if (!drop.size) { console.error("usage: drop-from-dailies.mjs <id...> | --unplayable"); process.exit(1); }

// fame-ranked candidate pool, sliced into the same bands freeze-daily uses (so a swap stays in-tier).
const ranked = pool.filter(workComplete).sort((a, b) => fameOf(b.id) - fameOf(a.id)).map(p => p.id);
const n = ranked.length;
const bandFor = { easy: ranked.slice(0, 410), medium: ranked.slice(Math.round(n * 0.10), Math.round(n * 0.35)),
  hard: ranked.slice(Math.round(n * 0.35), Math.round(n * 0.65)), impossible: ranked.slice(Math.round(n * 0.65)) };

// what appears in each tier within ±WORK_GAP days of a given date (to avoid a fresh repeat)
const dates = Object.keys(DAILY.byDate).sort();
function nearby(date, tier) {
  const t0 = new Date(date).getTime(); const s = new Set();
  for (const d of dates) { if (Math.abs((new Date(d).getTime() - t0) / 86400000) <= WORK_GAP) for (const id of (DAILY.byDate[d][tier] || [])) s.add(id); }
  return s;
}

let swaps = 0; const log = [];
for (const date of dates) {
  if (date <= today) continue; // never touch served days / today
  for (const tier of TIERS) {
    const arr = DAILY.byDate[date][tier]; if (!Array.isArray(arr)) continue;
    for (let i = 0; i < arr.length; i++) {
      if (!drop.has(arr[i])) continue;
      const used = new Set([...nearby(date, tier), ...arr]); used.delete(arr[i]);
      const repl = bandFor[tier].find(id => !used.has(id) && !drop.has(id));
      if (repl) { log.push(`${date}/${tier}[${i}] ${(byId.get(arr[i])?.title || arr[i]).slice(0, 24)} → ${(byId.get(repl)?.title || repl).slice(0, 24)}`); arr[i] = repl; swaps++; }
      else log.push(`${date}/${tier}[${i}] NO replacement found (band exhausted)`);
    }
  }
}

console.log(`dropped ${drop.size} id(s) from future dailies · ${swaps} slot swaps`);
for (const l of log.slice(0, 30)) console.log("  " + l);
if (swaps) { writeFileSync("data/daily-order.js", "window.ARTEFACTUM_DAILY=" + JSON.stringify(DAILY) + ";\n"); console.log("wrote data/daily-order.js — run the gate as its own step."); }
