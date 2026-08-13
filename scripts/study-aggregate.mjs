// Pull the friends-and-family study data and aggregate it into per-work, per-field HUMAN difficulty — the
// ground-truth set the vision-guessability engine gets validated against. Reads the `rounds` JSON that
// /api/score already logs for every finished daily (raw per-field guesses + points per category).
//
// Run:  SUPABASE_SECRET_KEY=sk_... node scripts/study-aggregate.mjs [date ...]
//   - pass the study dates to scope it (recommended), e.g. 2026-07-11 2026-07-25 2026-08-05
//   - no dates → every logged run
//   - add --cold to keep only first-attempt runs (cleanest signal; drops replays)
//
// The SECRET (service_role) key is needed because RLS hides other devices' rows from the anon key. Get it
// from Vercel env (SUPABASE_SECRET_KEY) or the Supabase dashboard. It is never written to disk by this script.
// Output: a console table + data/incoming/study-human-difficulty.json for the vision comparison step.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const URL = process.env.SUPABASE_URL || "https://jmrpqmejupouqfergyyg.supabase.co";
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) { console.error("Missing SUPABASE_SECRET_KEY (service_role). Run:\n  SUPABASE_SECRET_KEY=sk_... node scripts/study-aggregate.mjs 2026-07-11 2026-07-25 2026-08-05"); process.exit(1); }

const args = process.argv.slice(2);
const coldOnly = args.includes("--cold");
const dates = args.filter(a => /^\d{4}-\d{2}-\d{2}$/.test(a));
const MAX_CAT = 2500;
const FIELDS = ["when", "where", "medium", "style", "artist"];

// robust work-id resolver (daily-order/rounds store ids in several forms)
const w = {}; new Function("window", readFileSync("data/pool.js", "utf8"))(w);
const idx = {}; for (const p of w.ARTEFACTUM_POOL) { idx[p.id] = p; const m = String(p.id).match(/Q\d+/); if (m) { idx["wikidata:" + m[0]] = p; idx["http://www.wikidata.org/entity/" + m[0]] = p; } }
const res = id => idx[id] || (String(id).match(/Q\d+/) && idx["wikidata:" + String(id).match(/Q\d+/)[0]]) || null;

// pull scores rows (rounds JSON) via PostgREST
let q = `${URL}/rest/v1/scores?select=device_id,date,tier,total,cold,rounds&limit=100000`;
if (dates.length) q += `&date=in.(${dates.join(",")})`;
if (coldOnly) q += `&cold=is.true`;
const r = await fetch(q, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
if (!r.ok) { console.error("query failed", r.status, (await r.text()).slice(0, 300)); process.exit(1); }
const rows = await r.json();
console.log(`rows: ${rows.length}${dates.length ? ` (dates ${dates.join(", ")})` : " (all dates)"}${coldOnly ? " · cold-only" : ""}`);
if (!rows.length) { console.error("no rows — has anyone played the study dailies yet?"); process.exit(0); }

// aggregate per work × field: collect points + the raw guessed values (for confusion analysis)
const devices = new Set(), work = {}; // work[id] = {tier, byField:{when:{pts:[],guesses:[]}}, n}
for (const row of rows) { devices.add(row.device_id);
  for (const rd of (row.rounds || [])) { const id = rd.id; if (!id) continue;
    const wk = work[id] || (work[id] = { tier: row.tier, plays: 0, byField: {} });
    wk.plays++;
    const pts = rd.cells || {}, g = rd.guess || {};
    const gv = { when: g.year, where: g.ll ? `${(+g.ll[0]).toFixed(1)},${(+g.ll[1]).toFixed(1)}` : null, medium: g.medium, style: g.style, artist: g.artist };
    // hints (labels) map to the field they help — a field people repeatedly hint on is a difficulty tell
    const hintField = l => /century/i.test(l) ? "when" : /continent/i.test(l) ? "where" : /rule out|movement|cultur/i.test(l) ? "style" : /initial/i.test(l) ? "artist" : null;
    const hinted = new Set((rd.hints || []).map(hintField).filter(Boolean));
    for (const f of FIELDS) { if (pts[f] == null) continue; const b = wk.byField[f] || (wk.byField[f] = { pts: [], guesses: [], hints: 0 }); b.pts.push(pts[f]); if (gv[f] != null && gv[f] !== "") b.guesses.push(gv[f]); if (hinted.has(f)) b.hints++; }
  } }

const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const works = Object.entries(work).map(([id, wk]) => {
  const p = res(id); const byField = {};
  for (const f of FIELDS) { const b = wk.byField[f]; if (!b || !b.pts.length) continue;
    byField[f] = { meanPts: Math.round(mean(b.pts)), pct: Math.round(mean(b.pts) / MAX_CAT * 100), n: b.pts.length, hintRate: Math.round((b.hints || 0) / b.pts.length * 100), guesses: b.guesses }; }
  const fieldPcts = Object.values(byField).map(x => x.pct);
  return { id, title: p?.title || "?", artist: p?.artist || "", tier: wk.tier, plays: wk.plays, overallPct: Math.round(mean(fieldPcts)), byField };
}).sort((a, b) => a.overallPct - b.overallPct); // hardest (lowest human %) first

// overall per-field means across all works
console.log(`participants (distinct devices): ${devices.size} · distinct works: ${works.length}\n`);
console.log("overall human accuracy per field (higher = easier for humans):");
for (const f of FIELDS) { const all = works.flatMap(wk => wk.byField[f] ? [wk.byField[f].pct] : []); const hr = works.flatMap(wk => wk.byField[f] ? [wk.byField[f].hintRate] : []); if (all.length) console.log(`  ${f.padEnd(7)} ${Math.round(mean(all))}% accuracy · ${Math.round(mean(hr))}% hint-lean  (${all.length} works)`); }

console.log("\nhardest works for humans (lowest overall %, min 2 plays):");
for (const wk of works.filter(x => x.plays >= 2).slice(0, 20)) {
  console.log(`  ${String(wk.overallPct).padStart(3)}%  ${(wk.title).slice(0, 30).padEnd(30)} ${wk.tier.padEnd(6)} n=${wk.plays}  [${FIELDS.filter(f => wk.byField[f]).map(f => `${f[0]}${wk.byField[f].pct}`).join(" ")}]`);
}

try { mkdirSync("data/incoming", { recursive: true }); } catch {}
writeFileSync("data/incoming/study-human-difficulty.json", JSON.stringify({ dates: dates.length ? dates : "all", coldOnly, participants: devices.size, works }, null, 1));
console.log(`\nwrote data/incoming/study-human-difficulty.json (${works.length} works) — the vision PoC validates against this.`);
