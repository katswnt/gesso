// Notable-artists-per-movement pass. For every movement that resolves to an English Wikipedia
// page (data/movement-wiki.js), resolve its Wikidata QID via enwiki pageprops (the reliable
// title->QID path; wbsearchentities is not — see memory gesso-canon-resolve-via-enwiki), then
// SPARQL for people linked to that movement by P135 (movement), ranked by sitelink count as a
// fame proxy. Writes data/movement-artists.js = window.ARTEFACTUM_MOVEMENT_ARTISTS = {movement:[names]}.
//
// Pure network, NO LLM. Run with plain node (no sandbox — it needs Wikidata/Wikipedia):
//   node scripts/movement-artists.mjs
// Env: LIMIT=n (cap movements, for testing), TOP=12 (artists per movement).
import { readFileSync, writeFileSync } from "node:fs";

const TOP = +(process.env.TOP || 12);
const LIMIT = process.env.LIMIT ? +process.env.LIMIT : Infinity;
const UA = "GessoArtGame/1.0 (movement-artists; kathryn.swint@gmail.com)";
const sleep = ms => new Promise(r => setTimeout(r, ms));

// load the movement -> wiki-url map
const w = {}; new Function("window", readFileSync("data/movement-wiki.js", "utf8"))(w);
const WIKI = w.ARTEFACTUM_MOVEMENT_WIKI || {};
const entries = Object.entries(WIKI).slice(0, LIMIT === Infinity ? undefined : LIMIT);
console.log(`movement-artists · ${entries.length} movements with wiki pages · TOP=${TOP}\n`);

const titleFromUrl = u => decodeURIComponent(String(u).split("/wiki/")[1] || "").replace(/_/g, " ");

// batch-resolve enwiki titles -> QIDs via pageprops
async function resolveQIDs(titles) {
  const out = {};
  for (let i = 0; i < titles.length; i += 40) {
    const batch = titles.slice(i, i + 40);
    const url = "https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageprops&ppprop=wikibase_item&redirects=1&titles=" + encodeURIComponent(batch.join("|"));
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    const j = await r.json();
    const q = j.query || {};
    const norm = {}; for (const n of (q.normalized || [])) norm[n.from] = n.to;
    const redir = {}; for (const n of (q.redirects || [])) redir[n.from] = n.to;
    const pageByTitle = {}; for (const p of Object.values(q.pages || {})) pageByTitle[p.title] = p;
    for (const t of batch) {
      const t2 = redir[norm[t] || t] || norm[t] || t;
      const p = pageByTitle[t2] || pageByTitle[norm[t] || t] || pageByTitle[t];
      const qid = p && p.pageprops && p.pageprops.wikibase_item;
      if (qid) out[t] = qid;
    }
    await sleep(120);
  }
  return out;
}

async function sparql(query) {
  const url = "https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(query);
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/sparql-results+json" } });
    if (r.ok) return r.json();
    if (r.status === 429 || r.status === 400 || r.status >= 500) { await sleep(1500 * (attempt + 1)); continue; }
    throw new Error("SPARQL " + r.status);
  }
  throw new Error("SPARQL exhausted retries");
}
const names = j => (j.results.bindings || [])
  .map(b => b.aLabel && b.aLabel.value)
  .filter(n => n && !/^Q\d+$/.test(n));   // drop unlabeled QIDs

// Visual artists linked to this movement (P135). Rank by count of catalogued artworks they created
// (P170) - a truer artist-fame proxy than total sitelinks, which floats up writers/composers who
// merely dabbled in painting. Heavy movements can time out; fall back to the cheap sitelink query.
// NOTE: SPARQL comments are '#', never '//' - a // line inside the query string 400s the whole request.
async function artistsFor(qid) {
  const byWorks = `
    SELECT ?a ?aLabel (COUNT(DISTINCT ?work) AS ?n) WHERE {
      ?a wdt:P135 wd:${qid} .
      ?a wdt:P106/wdt:P279* wd:Q3391743 .
      OPTIONAL { ?work wdt:P170 ?a . }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    } GROUP BY ?a ?aLabel ORDER BY DESC(?n) LIMIT ${TOP}`;
  const bySitelinks = `
    SELECT ?a ?aLabel (COUNT(DISTINCT ?sl) AS ?n) WHERE {
      ?a wdt:P135 wd:${qid} .
      ?a wdt:P106/wdt:P279* wd:Q3391743 .
      OPTIONAL { ?sl schema:about ?a ; schema:isPartOf ?site . FILTER(CONTAINS(STR(?site),"wikipedia")) }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    } GROUP BY ?a ?aLabel ORDER BY DESC(?n) LIMIT ${TOP}`;
  try { return names(await sparql(byWorks)); }
  catch { return names(await sparql(bySitelinks)); }
}

const titles = entries.map(([m, u]) => [m, titleFromUrl(u)]).filter(([, t]) => t);
console.log("resolving QIDs...");
const qidByTitle = await resolveQIDs(titles.map(([, t]) => t));
console.log(`resolved ${Object.keys(qidByTitle).length}/${titles.length} QIDs\n`);

const result = {};
let done = 0, hit = 0;
for (const [mov, title] of titles) {
  done++;
  const qid = qidByTitle[title];
  if (!qid) continue;
  try {
    const arts = await artistsFor(qid);
    if (arts.length) { result[mov] = arts; hit++; }
    if (done % 25 === 0 || arts.length) console.log(`[${done}/${titles.length}] ${mov} (${qid}) -> ${arts.length} artists`);
  } catch (e) {
    console.log(`[${done}/${titles.length}] ${mov} (${qid}) ERROR ${e.message}`);
  }
  await sleep(200);
}

const header = "// Notable artists per movement, from Wikidata (P135 movement links, ranked by sitelink count).\n" +
  "// Generated by scripts/movement-artists.mjs. Includes artists NOT in the pool; merged with pool\n" +
  "// artists at runtime by movementArtists(). Zero LLM.\n";
writeFileSync("data/movement-artists.js", header + "window.ARTEFACTUM_MOVEMENT_ARTISTS=" + JSON.stringify(result) + ";\n");
console.log(`\nwrote data/movement-artists.js · ${hit} movements with Wikidata artists`);
