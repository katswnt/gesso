// Style audit via TEXT (near-zero model tokens). For each pool work with a Wikipedia article, fetch the
// intro extract and keyword-match it against the MOVEMENTS vocabulary to derive the "documented" movement,
// then compare to the pool's `style`. Network only — no model calls. Writes a review report.
//   step 1: SPARQL → enwiki article title per QID   (cache: titles.json)
//   step 2: Wikipedia API → intro extract per title (cache: extracts.json)
//   step 3: keyword-match extract vs MOVEMENTS keys → compare to pool.style
// Usage: node scripts/audit-style-text.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { readGlobal } from "./lib/static-module.mjs";

const DIR = "data/incoming/style-text"; mkdirSync(DIR, { recursive: true });
const pool = readGlobal("data/pool.js", "ARTEFACTUM_POOL");
const html = readFileSync("index.html", "utf8");
const movBlock = html.slice(html.indexOf("const MOVEMENTS={"), html.indexOf("const MOV_FAMILY="));
const MOVKEYS = [...movBlock.matchAll(/"([^"]+)":\{dates:/g)].map(m => m[1]);

const qidOf = p => { const m = String(p.id).match(/Q\d+/); return (m && /^(wikidata:|http:\/\/www\.wikidata)/.test(p.id)) ? m[0] : null; };
const works = pool.map(p => ({ p, qid: qidOf(p) })).filter(x => x.qid && x.p.style);
const byQid = {}; for (const w of works) (byQid[w.qid] = byQid[w.qid] || []).push(w.p);
const qids = Object.keys(byQid);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- step 1: enwiki titles ----
let titles = {}; try { titles = JSON.parse(readFileSync(`${DIR}/titles.json`, "utf8")); } catch {}
const needT = qids.filter(q => !(q in titles));
console.error(`works(styled,wd)=${works.length} QIDs=${qids.length} need-titles=${needT.length}`);
for (let i = 0; i < needT.length; i += 100) {
  const slice = needT.slice(i, i + 100);
  const q = `SELECT ?item ?article WHERE { VALUES ?item { ${slice.map(x => "wd:" + x).join(" ")} }
    OPTIONAL { ?article schema:about ?item; schema:isPartOf <https://en.wikipedia.org/>. } }`;
  let tries = 0;
  while (true) { try {
    const r = await fetch("https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(q), { headers: { "User-Agent": "gesso-style-text/1.0 (kathryn.swint@gmail.com)" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    for (const x of slice) titles[x] = null;
    for (const b of j.results.bindings) { const id = b.item.value.match(/Q\d+/)[0]; if (b.article) titles[id] = decodeURIComponent(b.article.value.split("/wiki/")[1]).replace(/_/g, " "); }
    break;
  } catch (e) { if (++tries >= 3) { console.error(`titles batch ${i} failed: ${e.message}`); break; } await sleep(2000 * tries); } }
  writeFileSync(`${DIR}/titles.json`, JSON.stringify(titles));
  await sleep(250);
}
const withArticle = qids.filter(q => titles[q]);
console.error(`have enwiki article: ${withArticle.length}/${qids.length}`);

// ---- step 2: intro extracts ----
let extracts = {}; try { extracts = JSON.parse(readFileSync(`${DIR}/extracts.json`, "utf8")); } catch {}
const needE = [...new Set(withArticle.map(q => titles[q]))].filter(t => !(t in extracts));
console.error(`need-extracts=${needE.length}`);
for (let i = 0; i < needE.length; i += 20) {
  const slice = needE.slice(i, i + 20);
  const url = "https://en.wikipedia.org/w/api.php?action=query&format=json&prop=extracts&exintro=1&explaintext=1&redirects=1&titles=" + encodeURIComponent(slice.join("|"));
  let tries = 0;
  while (true) { try {
    const r = await fetch(url, { headers: { "User-Agent": "gesso-style-text/1.0 (kathryn.swint@gmail.com)" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    const norm = {}; for (const n of (j.query?.normalized || [])) norm[n.from] = n.to;
    for (const t of slice) extracts[t] = ""; // default empty so we don't refetch
    for (const id in (j.query?.pages || {})) { const pg = j.query.pages[id]; if (pg.title && pg.extract != null) extracts[pg.title] = pg.extract; }
    break;
  } catch (e) { if (++tries >= 3) { console.error(`extract batch ${i} failed: ${e.message}`); break; } await sleep(2000 * tries); } }
  writeFileSync(`${DIR}/extracts.json`, JSON.stringify(extracts));
  if (i % 200 === 0) console.error(`  extracts ${Math.min(i + 20, needE.length)}/${needE.length}`);
  await sleep(200);
}

// ---- step 3: match ----
const strip = s => String(s || "").toLowerCase();
// build keyword → canonical-movement index; longer keys first so "Italian Renaissance" beats "Renaissance"
const KEYS = MOVKEYS.slice().sort((a, b) => b.length - a.length);
function documentedMovements(text) {
  const t = strip(text); const hits = [];
  for (const k of KEYS) { const kl = strip(k); if (kl.length < 4) continue; if (t.includes(kl)) hits.push(k); }
  // dedup: drop a key that is a substring of an already-found longer key (Renaissance ⊂ Italian Renaissance)
  return hits.filter(h => !hits.some(o => o !== h && strip(o).includes(strip(h))));
}
const MATCH = [], MISMATCH = [], NOMENTION = [], NOARTICLE = [];
for (const w of works) {
  const t = titles[w.qid]; if (!t) { NOARTICLE.push(w); continue; }
  const ex = extracts[t] || ""; if (!ex) { NOARTICLE.push(w); continue; }
  const docs = documentedMovements(ex);
  if (!docs.length) { NOMENTION.push({ id: w.p.id, title: (w.p.title || "").slice(0, 36), pool: w.p.style }); continue; }
  if (docs.some(d => strip(d) === strip(w.p.style) || strip(d).includes(strip(w.p.style)) || strip(w.p.style).includes(strip(d)))) MATCH.push(w);
  else MISMATCH.push({ id: w.p.id, title: (w.p.title || "").slice(0, 40), pool: w.p.style, documented: docs.join(" | ") });
}
writeFileSync(`${DIR}/report.json`, JSON.stringify({ MISMATCH, NOMENTION: NOMENTION.slice(0, 400) }, null, 1));
console.error(`\n=== style-vs-text (of ${works.length} styled WD works) ===`);
console.error(`MATCH (text confirms pool style): ${MATCH.length}`);
console.error(`MISMATCH (text names a DIFFERENT movement): ${MISMATCH.length}`);
console.error(`NO-MENTION (article has no movement keyword): ${NOMENTION.length}`);
console.error(`NO-ARTICLE / no extract: ${NOARTICLE.length}`);
console.error(`\n-- MISMATCH (first 30) --`);
for (const r of MISMATCH.slice(0, 30)) console.error(`  pool "${r.pool}"  vs text "${r.documented}"  | ${r.title}`);
