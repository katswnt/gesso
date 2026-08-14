// Does MAX-language pageviews (a work's single most-read Wikipedia) de-bias the fame metric vs
// SUM-across-all-languages? Kat's "clump the languages" intuition, made testable. Stratified sample,
// fetch per-language pageviews, compare median fame per region under fame_SUM vs fame_MAX. Read-only.
import fs from "node:fs";
const UA = "GessoMaxTest/1.0 (kathryn.swint@gmail.com)";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = new Date();
const s = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)), e = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
const st = d => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
const START = st(s) + "00", END = st(e) + "00";
async function jget(u, t = 0) { try { const r = await fetch(u, { headers: { "User-Agent": UA, Accept: "application/json" } }); if ((r.status === 429 || r.status >= 500) && t < 6) { await sleep(2500 * (t + 1)); return jget(u, t + 1); } return r.ok ? r.json() : null; } catch { if (t < 4) { await sleep(1500); return jget(u, t + 1); } return null; } }
const NON = new Set(["commonswiki","specieswiki","metawiki","wikidatawiki","mediawikiwiki","incubatorwiki","sourceswiki","foundationwiki","outreachwiki","testwiki"]);
const isL = k => /^[a-z0-9_]+wiki$/.test(k) && !NON.has(k);
const proj = k => k.slice(0, -4).replace(/_/g, "-") + ".wikipedia";
async function pv(p, t) { const j = await jget(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/${p}/all-access/user/${encodeURIComponent(t.replace(/ /g, "_"))}/monthly/${START}/${END}`); const v = j?.items?.[0]?.views; return Number.isFinite(v) ? v : 0; }
async function mapLimit(items, limit, fn) { let n = 0; const wk = async () => { while (n < items.length) { const i = n++; await fn(items[i]); } }; await Promise.all(Array.from({ length: limit }, wk)); }
const ln = Math.log, med = a => a.length ? (a.sort((x, y) => x - y), Math.round(a[a.length >> 1])) : 0;

const w = {}; new Function("window", fs.readFileSync("data/pool.js", "utf8"))(w);
const P = w.ARTEFACTUM_POOL.filter(p => /Q\d+/.test(String(p.id)));
const R = ["Europe","Asia","Africa","North America","South America","Oceania"];
const PER = 55;
// stratified: within each region, spread across the fame range (not all famous, not all obscure)
const samp = [];
for (const r of R) { const pool = P.filter(p => p.region === r).sort((a, b) => (b.fame || 0) - (a.fame || 0));
  const step = Math.max(1, Math.floor(pool.length / PER));
  for (let i = 0; i < pool.length && samp.filter(x => x.region === r).length < PER; i += step) samp.push({ id: pool[i].id, qid: String(pool[i].id).match(/Q\d+/)[0], region: r }); }
console.log("sample:", samp.length, "works (" + R.map(r => r.slice(0, 4) + ":" + samp.filter(x => x.region === r).length).join(" ") + ")\n");

const results = [];
for (let i = 0; i < samp.length; i += 40) { const batch = samp.slice(i, i + 40);
  const ents = (await jget(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${batch.map(x => x.qid).join("|")}&props=sitelinks&format=json`))?.entities || {};
  for (const x of batch) { const ent = ents[x.qid]; if (!ent || ent.missing !== undefined) continue; const sl = ent.sitelinks || {}; const langs = Object.keys(sl).filter(isL);
    let sum = 0, mx = 0; await mapLimit(langs, 8, async k => { const v = await pv(proj(k), sl[k].title); sum += v; if (v > mx) mx = v; });
    results.push({ ...x, sitelinks: Object.keys(sl).length, sumPv: sum, maxPv: mx }); }
  await sleep(150); if ((i / 40) % 3 === 0) console.log("  fetched", results.length, "/", samp.length); }

const fame = (p, sl) => 120 * ln(p + 1) + 8 * ln(sl + 1);
const euroSum = med(results.filter(r => r.region === "Europe").map(r => fame(r.sumPv, r.sitelinks))) || 1;
const euroMax = med(results.filter(r => r.region === "Europe").map(r => fame(r.maxPv, r.sitelinks))) || 1;
console.log("\n=== MEDIAN FAME per region: SUM-of-languages vs MAX-language ===");
console.log("region         n   fame(SUM)  vsEu    fame(MAX)  vsEu");
for (const r of R) { const rs = results.filter(x => x.region === r); if (!rs.length) continue;
  const fs = med(rs.map(x => fame(x.sumPv, x.sitelinks))), fm = med(rs.map(x => fame(x.maxPv, x.sitelinks)));
  console.log(`  ${r.padEnd(13)}${String(rs.length).padStart(2)}   ${String(fs).padStart(6)}   ${(fs / euroSum).toFixed(2)}x   ${String(fm).padStart(6)}   ${(fm / euroMax).toFixed(2)}x`); }
console.log("\nREAD: if the non-Europe 'vsEu' ratios RISE from the SUM column to the MAX column, max-aggregation");
console.log("narrows the Western skew (Kat's clumping intuition works). If they stay flat, sum vs max makes no difference.");

