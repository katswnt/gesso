// Enrich pool.js with dimensions (p.dim) and backfill blank medium (p.medium) from museum APIs.
// Keyless sources only: Met, AIC, Cleveland, V&A, Wikidata. Harvard/Smithsonian need keys (skipped).
// Resumable: skips works that already have p.dim. Run: node scripts/enrich-dimensions.mjs
import { readFileSync, writeFileSync } from "node:fs";
const UA = "GessoArtGame/1.0 (kathryn.swint@gmail.com)";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const raw = readFileSync("data/pool.js", "utf8");
const pre = raw.slice(0, raw.indexOf("[")), post = raw.slice(raw.lastIndexOf("]") + 1);
const pool = JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1));
const save = () => writeFileSync("data/pool.js", pre + JSON.stringify(pool) + post);

const HKEY = process.env.HARVARD_KEY;
const srcOf = id => /^met\d/.test(id) ? "met" : /^aic\d/.test(id) ? "aic" : /^cleveland\d/.test(id) ? "cleveland"
  : /^harvard\d/.test(id) ? (HKEY ? "harvard" : null) : /^va/i.test(id) ? "va" : /Q\d+/.test(id) ? "wikidata" : null;

// pull a clean "H × W cm" (or with depth) from a free-text dimension string
const cmFrom = s => {
  if (!s) return "";
  const m = String(s).match(/([\d.]+)\s*[x×]\s*([\d.]+)(?:\s*[x×]\s*([\d.]+))?\s*cm/i);
  if (!m) return "";
  return m[3] ? `${m[1]} × ${m[2]} × ${m[3]} cm` : `${m[1]} × ${m[2]} cm`;
};
async function getJSON(url, opts) {
  for (let t = 0; t < 3; t++) {
    try { const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, ...opts });
      if (r.status === 429 || r.status >= 500) { await sleep(1500 * (t + 1)); continue; }
      if (!r.ok) return null; return await r.json();
    } catch { await sleep(1000 * (t + 1)); }
  } return null;
}
const WD_UNIT = { Q174728: 1, Q11573: 100, Q3897: 0.1, Q218593: 2.54 }; // cm, m, mm, inch → cm

async function fetchOne(p) {
  const s = srcOf(p.id);
  try {
    if (s === "met") {
      const j = await getJSON(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${p.id.slice(3)}`);
      return j ? { medium: j.medium, dim: cmFrom(j.dimensions) } : null;
    }
    if (s === "aic") {
      const j = await getJSON(`https://api.artic.edu/api/v1/artworks/${p.id.slice(3)}?fields=medium_display,dimensions`);
      return j?.data ? { medium: j.data.medium_display, dim: cmFrom(j.data.dimensions) } : null;
    }
    if (s === "cleveland") {
      const j = await getJSON(`https://openaccess-api.clevelandart.org/api/artworks/${p.id.slice(9)}`);
      return j?.data ? { medium: j.data.technique, dim: cmFrom(j.data.measurements) } : null;
    }
    if (s === "harvard") {
      const j = await getJSON(`https://api.harvardartmuseums.org/object/${p.id.slice(7)}?apikey=${HKEY}`);
      return j ? { medium: j.medium, dim: cmFrom(j.dimensions) } : null;
    }
    if (s === "va") {
      const j = await getJSON(`https://api.vam.ac.uk/v2/object/${encodeURIComponent(p.id.slice(2))}`);
      const rec = j?.record; if (!rec) return null;
      let medium = ""; const mt = rec.materialsAndTechniques;
      if (typeof mt === "string") medium = mt; else if (Array.isArray(rec.materials)) medium = rec.materials.map(m => m?.text).filter(Boolean).join(", ");
      let dim = "";
      const dims = rec.dimensions || [];
      const h = dims.find(d => /height/i.test(d.dimension) && /cm/i.test(d.unit));
      const w = dims.find(d => /width/i.test(d.dimension) && /cm/i.test(d.unit));
      if (h && w) dim = `${h.value} × ${w.value} cm`;
      return { medium, dim };
    }
    if (s === "wikidata") {
      const q = p.id.match(/Q\d+/)[0];
      const j = await getJSON(`https://www.wikidata.org/w/api.php?action=wbgetentities&props=claims&ids=${q}&format=json&origin=*`);
      const cl = j?.entities?.[q]?.claims; if (!cl) return null;
      const qty = pid => { const c = cl[pid]?.[0]?.mainsnak?.datavalue?.value; if (!c) return null;
        const u = (c.unit || "").match(/Q\d+/)?.[0]; const f = WD_UNIT[u]; if (!f) return null;
        return +(parseFloat(c.amount) * f).toFixed(1); };
      const H = qty("P2048"), W = qty("P2049");
      return { medium: "", dim: (H && W) ? `${H} × ${W} cm` : "" };
    }
  } catch { return null; }
  return null;
}

const todo = pool.filter(p => srcOf(p.id) && !p.dim);
console.error(`enrich: ${todo.length} works to fetch (keyless sources); ${pool.length - todo.length} skipped (done/no-key)`);
let dimN = 0, medN = 0, done = 0;
const CONC = 6;
for (let i = 0; i < todo.length; i += CONC) {
  const batch = todo.slice(i, i + CONC);
  const res = await Promise.all(batch.map(fetchOne));
  batch.forEach((p, k) => {
    const r = res[k]; done++;
    p.dim = (r && r.dim) ? r.dim : ""; // mark as processed even if empty (so resume skips it)
    if (r && r.dim) dimN++;
    if (r && r.medium && !p.medium) { p.medium = String(r.medium).trim(); medN++; }
  });
  if (i % 60 === 0) { save(); console.error(`  ${done}/${todo.length} | +dim ${dimN} +medium ${medN}`); }
  await sleep(120);
}
save();
console.error(`DONE: ${dimN} dimensions added, ${medN} blank mediums backfilled, of ${todo.length} processed.`);
