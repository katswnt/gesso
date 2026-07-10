// fetch-yr.mjs — populate the `yr:[lo,hi]` uncertain-date range from Wikidata, ONLY where Wikidata itself
// expresses uncertainty (explicit earliest/latest, or a coarse inception precision: decade/century).
// Point-precision dates get NO yr (fmtDate/dateRange fall back to the single `y`). Additive + conservative.
//   node scripts/fetch-yr.mjs
import { readFileSync, writeFileSync } from "node:fs";
const UA = "GessoYr/1.0 (kathryn.swint@gmail.com)";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const src = readFileSync("data/pool.js", "utf8");
const a = src.indexOf("["), b = src.lastIndexOf("]");
const pool = JSON.parse(src.slice(a, b + 1));
const qid = id => { const m = String(id).match(/Q\d+/); return m ? m[0] : null; };
const wd = pool.filter(p => qid(p.id) && !Array.isArray(p.yr)); // skip any already ranged
const byQ = Object.fromEntries(wd.map(p => [qid(p.id), p]));
const qids = Object.keys(byQ);
console.error(`fetch-yr: ${qids.length} Wikidata works to check`);

async function sparql(q) { const u = "https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(q);
  for (let t = 0; t < 6; t++) { try { const r = await fetch(u, { headers: { "User-Agent": UA, "Accept": "application/sparql-results+json" } });
    if (r.status === 429 || r.status >= 500) { await sleep(3000 * (t + 1)); continue; } if (!r.ok) return null; return await r.json(); } catch { await sleep(1500 * (t + 1)); } } return null; }

const yOf = iso => { const m = String(iso).match(/^(-?\d+)/); return m ? parseInt(m[1], 10) : null; };
let ranged = 0, checked = 0;
for (let i = 0; i < qids.length; i += 120) {
  const values = qids.slice(i, i + 120).map(q => "wd:" + q).join(" ");
  // inception value+precision, plus explicit earliest(P1319)/latest(P1326)
  const q = `SELECT ?work ?t ?prec ?earliest ?latest WHERE { VALUES ?work { ${values} }
    OPTIONAL { ?work p:P571/psv:P571 [ wikibase:timeValue ?t; wikibase:timePrecision ?prec ] }
    OPTIONAL { ?work wdt:P1319 ?earliest } OPTIONAL { ?work wdt:P1326 ?latest } }`;
  const j = await sparql(q); await sleep(400);
  if (!j || !j.results) continue;
  for (const bnd of j.results.bindings) {
    const p = byQ[bnd.work.value.match(/Q\d+/)[0]]; if (!p) continue; checked++;
    let lo = null, hi = null;
    if (bnd.earliest && bnd.latest) { lo = yOf(bnd.earliest.value); hi = yOf(bnd.latest.value); }
    else if (bnd.t && bnd.prec) { const y = yOf(bnd.t.value), prec = +bnd.prec.value;
      if (prec === 8) { lo = Math.floor(y / 10) * 10; hi = lo + 9; }          // decade
      else if (prec === 7) { lo = Math.floor(y / 100) * 100; hi = lo + 99; }  // century
    }
    if (lo != null && hi != null && lo !== hi) {
      // only set if it actually brackets the stored y (else the stored y is a better single estimate)
      if (typeof p.y !== "number" || (p.y >= lo - 5 && p.y <= hi + 5)) { p.yr = [lo, hi]; ranged++; }
    }
  }
  if ((i / 120) % 8 === 0) console.error(`  ${i}/${qids.length} · ranged ${ranged}`);
}
writeFileSync("data/pool.js", src.slice(0, a) + JSON.stringify(pool) + src.slice(b + 1));
console.error(`fetch-yr DONE: ${ranged} works given a yr range (of ${checked} with a date) -> data/pool.js`);
