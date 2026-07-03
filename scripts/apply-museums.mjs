// Apply the museum harvest to the pool: set w.museum on each work that has one,
// and write data/museums.js (window.ARTEFACTUM_MUSEUMS = { name: {city,lat,lng} }).
//   node scripts/apply-museums.mjs
import { readFileSync, writeFileSync } from "node:fs";

const { byWork, museums } = JSON.parse(readFileSync("data/incoming/museums-harvest.json", "utf8"));

// pool
const psrc = readFileSync("data/pool.js", "utf8");
globalThis.window = {}; new Function(psrc)();
const pool = window.ARTEFACTUM_POOL;
let set = 0;
for (const w of pool) { const m = byWork[w.id]; if (m) { w.museum = m; set++; } else if (w.museum) delete w.museum; }
const pi = psrc.indexOf("["), pj = psrc.lastIndexOf("]");
writeFileSync("data/pool.js", psrc.slice(0, pi) + JSON.stringify(pool) + psrc.slice(pj + 1));

// museums table (only those actually referenced, keep it tight)
const used = new Set(Object.values(byWork));
const table = {};
for (const name of used) table[name] = museums[name] || { city: "", lat: null, lng: null };
writeFileSync("data/museums.js", "window.ARTEFACTUM_MUSEUMS=" + JSON.stringify(table) + ";\n");

console.log(`set museum on ${set}/${pool.length} works | museums table: ${Object.keys(table).length} (${Object.values(table).filter(x => x.lat != null).length} with coords)`);
