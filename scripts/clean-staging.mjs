// Free (network/deterministic) cleaning of staged museum works in data/incoming/wd-museums.json:
//  - null genid/url artist strings
//  - add dimensions (Wikidata P2048 height / P2049 width)
//  - backfill medium from P186 if blank
//  - backfill place (origin) from P495 country, else creator's P27 nationality
// No LLM. Run: node scripts/clean-staging.mjs
import { readFileSync, writeFileSync } from "node:fs";
const UA = "GessoArtGame/1.0 (kathryn.swint@gmail.com)";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const FILE = "data/incoming/wd-museums.json";
const works = JSON.parse(readFileSync(FILE, "utf8"));
const qid = u => (String(u).match(/Q\d+/) || [])[0];
const WD_UNIT = { Q174728: 1, Q11573: 100, Q3897: 0.1, Q218593: 2.54 };

async function getJSON(u) { for (let t = 0; t < 4; t++) { try {
  const r = await fetch(u, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (r.status === 429 || r.status >= 500) { await sleep(1500 * (t + 1)); continue; }
  if (!r.ok) return null; return await r.json();
} catch { await sleep(1000 * (t + 1)); } } return null; }

async function entities(ids, props) {
  const out = {};
  for (let i = 0; i < ids.length; i += 45) {
    const j = await getJSON(`https://www.wikidata.org/w/api.php?action=wbgetentities&props=${props}&format=json&origin=*&ids=${ids.slice(i, i + 45).join("|")}`);
    Object.assign(out, j?.entities || {}); await sleep(120);
  } return out;
}
const claimVal = (cl, pid) => cl?.[pid]?.[0]?.mainsnak?.datavalue?.value;

// 1. null genid artists
let nulled = 0;
for (const w of works) if (/genid|^http/i.test(w.artist || "")) { w.artist = ""; nulled++; }

// 2. fetch work claims
const ids = works.map(w => qid(w.id)).filter(Boolean);
console.error(`cleaning ${works.length} staged works…`);
const wc = await entities(ids, "claims");
const creatorNeeded = [], countryQs = new Set();
for (const w of works) {
  const cl = wc[qid(w.id)]?.claims; if (!cl) continue;
  const h = claimVal(cl, "P2048"), wd = claimVal(cl, "P2049");
  const toCm = v => { if (!v) return null; const u = qid(v.unit), f = WD_UNIT[u]; return f ? +(parseFloat(v.amount) * f).toFixed(1) : null; };
  const H = toCm(h), W = toCm(wd); if (H && W) w.dim = `${H} × ${W} cm`;
  if (!w.medium) { const m = claimVal(cl, "P186"); if (m?.id) { w._medQ = m.id; countryQs.add(m.id); } }
  const oc = claimVal(cl, "P495"); // country of origin
  if (oc?.id) { w._placeQ = oc.id; countryQs.add(oc.id); }
  else if (!w.place) { const cr = claimVal(cl, "P170"); if (cr?.id) { w._creator = cr.id; creatorNeeded.push(cr.id); } }
}
// 3. creator nationalities → country
const cc = await entities([...new Set(creatorNeeded)], "claims");
for (const w of works) if (w._creator && !w._placeQ) { const c = claimVal(cc[w._creator]?.claims, "P27"); if (c?.id) { w._placeQ = c.id; countryQs.add(c.id); } }
// 4. resolve all country/material Q labels
const labs = await entities([...countryQs], "labels");
const label = q => labs[q]?.labels?.en?.value || "";
let dims = 0, meds = 0, places = 0;
for (const w of works) {
  if (w.dim) dims++;
  if (w._medQ && !w.medium) { const l = label(w._medQ); if (l) { w.medium = l[0].toUpperCase() + l.slice(1); meds++; } }
  if (w._placeQ && !w.place) { const l = label(w._placeQ); if (l) { w.place = l; places++; } }
  delete w._medQ; delete w._placeQ; delete w._creator;
}
writeFileSync(FILE, JSON.stringify(works));
console.error(`DONE: nulled ${nulled} genid artists | +${dims} dimensions | +${meds} mediums | +${places} places (origin)`);
