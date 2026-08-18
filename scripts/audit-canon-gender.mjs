// Nochlin's axis (report-only): the taxonomy work interrogated the pool's GEOGRAPHIC bias; this surfaces its
// GENDER skew, so the canon's male-default is a tracked open problem on the same footing. Resolves each work's
// creator gender via Wikidata (work QID -> P170 creator -> P21 sex-or-gender). Coverage is partial (only works
// that carry a Wikidata QID); the report states it honestly rather than implying a full census.
// Run LOCALLY with plain node (needs network). NOT in CI.
//   node scripts/audit-canon-gender.mjs
import { readFileSync, writeFileSync } from "node:fs";

const EP = "https://query.wikidata.org/sparql";
const UA = "GessoArtGame/1.0 (canon gender audit; github.com/katswnt/gesso)";
const sleep = ms => new Promise(r => setTimeout(r, ms));

let s = readFileSync("data/pool.js", "utf8");
const pool = JSON.parse(s.slice(s.indexOf("["), s.lastIndexOf("]") + 1));
const anon = a => !a || /^(unknown|anonymous|unattributed|unidentified|various|workshop|attributed|circle|follower|after |manner of|school of)/i.test(a.trim());
const qidOf = id => (String(id).match(/Q\d+$/) || [])[0];
const works = pool.filter(p => !anon(p.artist) && qidOf(p.id)).map(p => ({ qid: qidOf(p.id), artist: p.artist.trim() }));
console.log(`resolving creator gender for ${works.length} named-artist works with a Wikidata QID…`);

async function wdqs(qids) {
  const values = qids.map(q => `wd:${q}`).join(" ");
  const query = `SELECT ?work ?creator ?genderLabel WHERE {
    VALUES ?work { ${values} }
    ?work wdt:P170 ?creator . OPTIONAL { ?creator wdt:P21 ?gender . }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
  }`;
  for (let a = 0; a < 5; a++) {
    if (a) await sleep(1500 * a);
    try {
      const r = await fetch(EP + "?format=json&query=" + encodeURIComponent(query), { headers: { "User-Agent": UA, Accept: "application/sparql-results+json" } });
      if (r.ok) return (await r.json()).results.bindings;
    } catch {}
  }
  return null;
}

const workGender = {}, creatorGender = {};
let errs = 0;
for (let i = 0; i < works.length; i += 150) {
  const batch = works.slice(i, i + 150);
  const rows = await wdqs(batch.map(w => w.qid));
  if (rows === null) { errs += batch.length; continue; }
  for (const b of rows) {
    const wq = qidOf(b.work.value), cq = qidOf(b.creator.value), g = (b.genderLabel?.value || "unknown").toLowerCase();
    workGender[wq] = workGender[wq] || g;
    if (cq) creatorGender[cq] = g;
  }
  process.stdout.write(`\r  ${Math.min(i + 150, works.length)}/${works.length}`);
  await sleep(300);
}
console.log("");

const norm = g => /female|woman|trans woman/.test(g) ? "female" : /male|man/.test(g) && !/female/.test(g) ? "male" : g === "unknown" ? "unknown" : "other/non-binary";
const tally = obj => { const t = {}; for (const g of Object.values(obj)) t[norm(g)] = (t[norm(g)] || 0) + 1; return t; };
const wt = tally(workGender), ct = tally(creatorGender);
const pct = (n, d) => d ? `${(100 * n / d).toFixed(1)}%` : "—";
const known = t => (t.male || 0) + (t.female || 0) + (t["other/non-binary"] || 0);

console.log(`\n── CANON GENDER SKEW (works with a resolvable Wikidata creator) ──`);
console.log(`works resolved: ${Object.keys(workGender).length} / ${works.length} QID-works (of ${pool.filter(p => !anon(p.artist)).length} named-artist works total)`);
console.log(`\nby WORK:    male ${wt.male || 0} (${pct(wt.male || 0, known(wt))})  ·  female ${wt.female || 0} (${pct(wt.female || 0, known(wt))})  ·  other/nb ${wt["other/non-binary"] || 0}  ·  unknown ${wt.unknown || 0}`);
console.log(`by ARTIST:  male ${ct.male || 0} (${pct(ct.male || 0, known(ct))})  ·  female ${ct.female || 0} (${pct(ct.female || 0, known(ct))})  ·  other/nb ${ct["other/non-binary"] || 0}  ·  unknown ${ct.unknown || 0}`);
if (errs) console.log(`\n(${errs} works errored on the endpoint — re-run to improve coverage)`);
writeFileSync("data/incoming/canon-gender.json", JSON.stringify({ byWork: wt, byArtist: ct, resolved: Object.keys(workGender).length, ofQidWorks: works.length }, null, 2));
console.log(`\n-> data/incoming/canon-gender.json — a tracked open problem, not a solved metric.`);
