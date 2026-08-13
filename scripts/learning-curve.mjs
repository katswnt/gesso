// Your scores are confounded by WHEN you played: a work you did early in your learning looks harder than one you
// did last week, even if it isn't — because you improved, not the work. This pulls your play history with timestamps,
// fits your skill trend over time, and reports each work's difficulty as the RESIDUAL after removing that trend —
// so an "early" low score isn't mistaken for a hard work. Reads the scores table (service_role key, RLS).
//   SUPABASE_SECRET_KEY=... node scripts/learning-curve.mjs [name]     (default name: kat)
import { readFileSync } from "node:fs";
const URL = process.env.SUPABASE_URL || "https://jmrpqmejupouqfergyyg.supabase.co";
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) { console.error("Missing SUPABASE_SECRET_KEY (service_role)."); process.exit(1); }
const NAME = (process.argv[2] || "kat").toLowerCase();
const MAX_CAT = 2500, FIELDS = ["when", "where", "medium", "style", "artist"];
const rest = p => fetch(`${URL}/rest/v1/${p}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } }).then(r => r.json());

// pool titles for labeling
const w = {}; new Function("window", readFileSync("data/pool.js", "utf8"))(w);
const idx = {}; for (const p of w.ARTEFACTUM_POOL) { idx[p.id] = p; const m = String(p.id).match(/Q\d+/); if (m) idx["wikidata:" + m[0]] = idx["http://www.wikidata.org/entity/" + m[0]] = p; }
const title = id => (idx[id] || (String(id).match(/Q\d+/) && idx["wikidata:" + String(id).match(/Q\d+/)[0]]) || {}).title || id;

// find your device(s) by profile name
const profs = await rest(`profiles?select=device_id,name`);
const mine = new Set((profs || []).filter(p => String(p.name || "").toLowerCase() === NAME).map(p => p.device_id));
if (!mine.size) { console.error(`no profile named "${NAME}" (names seen: ${[...new Set((profs||[]).map(p=>p.name))].slice(0,10).join(", ")})`); process.exit(0); }
const rows = (await rest(`scores?device_id=in.(${[...mine].map(encodeURIComponent).join(",")})&select=device_id,date,tier,total,cold,rounds,updated_at&order=updated_at.asc`)) || [];
console.log(`${NAME}: ${mine.size} device(s) · ${rows.length} finished runs\n`);
if (rows.length < 3) { console.error("too few plays to trend yet — keep playing."); process.exit(0); }

// per-run overall pct (achieved / achievable), from the stored per-field points
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const runs = rows.map((r, i) => {
  let got = 0, max = 0; const fieldPts = {};
  for (const rd of (r.rounds || [])) for (const f of FIELDS) { const v = rd.cells?.[f]; if (v == null) continue; got += v; max += MAX_CAT; (fieldPts[f] = fieldPts[f] || []).push(v / MAX_CAT * 100); }
  return { i, date: (r.updated_at || r.date || "").slice(0, 10), tier: r.tier, cold: r.cold, pct: max ? Math.round(got / max * 100) : null, fieldPts, rounds: r.rounds || [] };
}).filter(r => r.pct != null);

// learning trend: linear fit of pct vs play-order
const xs = runs.map(r => r.i), ys = runs.map(r => r.pct), n = runs.length;
const mx = mean(xs), my = mean(ys);
const slope = xs.reduce((s, x, k) => s + (x - mx) * (ys[k] - my), 0) / (xs.reduce((s, x) => s + (x - mx) ** 2, 0) || 1);
const trend = i => my + slope * (i - mx);
console.log("=== your learning curve (overall % per run, oldest → newest) ===");
console.log(runs.map(r => r.pct).join("  "));
console.log(`slope: ${(slope * n).toFixed(1)} pts across your ${n} runs → ${slope > 0.3 ? "IMPROVING" : slope < -0.3 ? "declining" : "flat"}`);
console.log("\nper-field, first third vs last third of your plays (are you learning that skill?):");
const third = Math.max(1, Math.floor(n / 3));
for (const f of FIELDS) { const early = runs.slice(0, third).flatMap(r => r.fieldPts[f] || []), late = runs.slice(-third).flatMap(r => r.fieldPts[f] || []);
  if (early.length && late.length) console.log(`  ${f.padEnd(7)} ${Math.round(mean(early))}% → ${Math.round(mean(late))}%  (${mean(late) - mean(early) > 5 ? "↑ learning" : mean(late) - mean(early) < -5 ? "↓" : "flat"})`); }

// per-work difficulty = residual vs your trend at the time you played it (negative = harder than your level then)
const byWork = {};
runs.forEach(r => { for (const rd of r.rounds) { const id = rd.id; if (!id) continue;
  let got = 0, max = 0; for (const f of FIELDS) { const v = rd.cells?.[f]; if (v == null) continue; got += v; max += MAX_CAT; }
  if (!max) continue; const pct = got / max * 100;
  (byWork[id] = byWork[id] || []).push({ pct, resid: pct - trend(r.i), when: r.i, date: r.date }); } });
const works = Object.entries(byWork).map(([id, ps]) => ({ id, title: title(id), n: ps.length, pct: Math.round(mean(ps.map(p => p.pct))), resid: Math.round(mean(ps.map(p => p.resid))), first: Math.min(...ps.map(p => p.when)) }));
console.log(`\n=== hardest works for you, learning-adjusted (residual < 0 = harder than your skill when you played it) ===`);
for (const wk of works.sort((a, b) => a.resid - b.resid).slice(0, 15))
  console.log(`  resid ${String(wk.resid).padStart(4)}  (raw ${String(wk.pct).padStart(3)}%)  ${wk.title.slice(0, 40).padEnd(40)} played run#${wk.first + 1}/${n}`);
console.log("\nresidual removes your learning trend, so an early low score on an easy work won't read as 'hard'. compare to the vision predictions on the same works.");
