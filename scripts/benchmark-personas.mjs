// PROTOTYPE: benchmark "ghost" users for the leaderboard. Each persona is an art-history EXPERTISE PROFILE
// (region + era), and we score them with the same category structure the real game uses, so a ghost's total
// is what a player pinning those answers would get. Personas score on works of ANY period (alive-today domain
// expert), strong in their region/era, weaker elsewhere, with a universal "famous works everyone knows" bump.
//   node scripts/benchmark-personas.mjs [tier=easy] [days=3]
import { readGlobal } from "./lib/static-module.mjs";
import { readFileSync } from "node:fs";

const tier = process.argv[2] || "easy", DAYS = +(process.argv[3] || 3);
const pool = readGlobal("data/pool.js", "ARTEFACTUM_POOL"); const byId = Object.fromEntries(pool.map(p => [p.id, p]));
const daily = readGlobal("data/daily-order.js", "ARTEFACTUM_DAILY");
let fame = {}; try { const f = readFileSync("data/fame.js", "utf8"); fame = JSON.parse(f.slice(f.indexOf("{"), f.lastIndexOf("}") + 1)); } catch {}
const fa = p => fame[p.id] != null ? fame[p.id] : (p.fame || 0);
const MAX = 2500, clamp = x => Math.max(0, Math.min(1, x));
const COMMON_MED = new Set(["Oil paint", "Tempera", "Fresco", "Watercolor", "Bronze", "Marble", "Stone", "Ink"]);

// PERSONAS — alive-today domain experts. regions = continents they command; era = their deep period.
const PERSONAS = [
  { name: "Leonardo da Vinci", regions: ["Europe"], era: 1500, deep: 250, blurb: "Italian Renaissance / pre-modern Europe" },
  { name: "Katsushika Hokusai", regions: ["Asia"], era: 1820, deep: 1200, blurb: "Japanese & Asian art + the global canon" },
];

// expertise e in [0,1] for a (persona, work). Smooth gradients (no flat caps) so a persona varies by era:
// region affinity (home continent vs not), era affinity (gaussian around their deep period), and a universal
// fame bump (the canon is known to all). Master-at-home ~0.9; same-region-far-era ~0.7; canon-elsewhere ~0.55.
function expertise(P, w) {
  const region = w.region || "", y = w.y, fn = clamp(fa(w) / 1500);
  const regionMatch = P.regions.includes(region);
  const regionAff = regionMatch ? 1 : 0.25;
  const eraAff = y == null ? 0.5 : Math.exp(-Math.pow((y - P.era) / P.deep, 2)); // 1 at their era, decays smoothly
  // in-region knowledge is strong across all eras but peaks in their deep era; out-region leans on fame
  const e = clamp(0.10 + 0.45 * regionAff * (0.55 + 0.45 * eraAff) + 0.35 * fn);
  return { e, regionMatch, fn, eraAff };
}
function scoreWork(P, w) {
  const { e, regionMatch, fn } = expertise(P, w);
  const when = MAX * clamp(0.18 + 0.72 * e);
  const where = MAX * clamp(regionMatch ? 0.7 + 0.3 * e : 0.22 + 0.45 * e + 0.2 * fn);
  const medium = MAX * (COMMON_MED.has(w.medium) ? clamp(0.8 + 0.2 * e) : clamp(0.4 + 0.5 * e));
  const movement = MAX * clamp(0.15 + 0.8 * e);
  const core = Math.round(when + where + medium + movement);
  const artist = Math.round(MAX * (fn > 0.8 ? 0.8 : (regionMatch && e > 0.8 ? 0.55 : 0.1 * e))); // bonus
  return { core, artist, total: core + artist, e: +e.toFixed(2) };
}

const t0 = Math.floor(Date.now() / 86400000);
for (let d = t0; d < t0 + DAYS; d++) {
  const k = new Date(d * 86400000).toISOString().slice(0, 10);
  const ids = (daily.byDate?.[k]?.[tier] || []); if (!ids.length) continue;
  console.log(`\n=== ${k} · ${tier} ===`);
  console.log("  " + ids.map(id => (byId[id]?.title || "").slice(0, 16).padEnd(17)).join(""));
  const tot = {};
  for (const P of PERSONAS) {
    const per = ids.map(id => scoreWork(P, byId[id]));
    tot[P.name] = per.reduce((a, x) => a + x.total, 0);
    console.log(P.name.padEnd(18) + per.map(x => String(x.total).padStart(6) + " ".padEnd(11)).join("").trim());
  }
  console.log("  DAY TOTALS: " + Object.entries(tot).map(([n, v]) => `${n.split(" ").pop()} ${v.toLocaleString()}`).join("  |  ") + `  (max ${(ids.length*12500).toLocaleString()})`);
}
console.log("\nper-work detail for day 1:");
const k0 = new Date(t0 * 86400000).toISOString().slice(0, 10);
for (const id of (daily.byDate?.[k0]?.[tier] || [])) { const w = byId[id];
  console.log(`  ${(w.title||"").slice(0,28).padEnd(29)} ${w.region}/${w.y}/${w.style||"-"}`.slice(0,60));
  for (const P of PERSONAS) { const s = scoreWork(P, w); console.log(`     ${P.name.split(" ").pop().padEnd(10)} ${String(s.total).padStart(6)} (e=${s.e})`); }
}
