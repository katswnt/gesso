// Shared Wikidata entity cache (Phase 3 efficiency). ONE incremental SPARQL pull of every fact the WD audits
// need, cached to data/incoming/wd-entities.json (gitignored) keyed by QID. audit-p31 / audit-misharvest /
// audit-copyright / audit-fields / audit-place / audit-style-text all read from this instead of each running
// its own whole-pool sweep (P31 was fetched 2-3x; the creator/P170 chain several more times).
//
// Per QID it stores: p31[{q,l}], creators[{q,l,death,birthCountry}], title, materials[], movements[],
// origCountry[], locCountry[], inception, enwiki. Fetched via 3 bounded sub-queries per batch (kept separate
// so multi-valued properties don't cartesian-explode). Incremental: only QIDs absent OR at an older schema
// are fetched; bump SCHEMA to force a rebuild; pass {refresh:true} to ignore the cache entirely.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const UA = "GessoWdCache/1.0 (kathryn.swint@gmail.com)";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const CACHE = "data/incoming/wd-entities.json";
const SCHEMA = 3;

async function sparql(qy) {
  const u = "https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(qy);
  for (let t = 0; t < 5; t++) {
    try {
      const r = await fetch(u, { headers: { "User-Agent": UA, Accept: "application/sparql-results+json" } });
      if (r.status === 429 || r.status >= 500) { await sleep(3000 * (t + 1)); continue; }
      if (!r.ok) return null;
      return (await r.json()).results.bindings;
    } catch { await sleep(1500 * (t + 1)); }
  }
  return null;
}
const qidOf = url => (String(url).match(/Q\d+/) || [])[0] || null;
const pushUniq = (arr, v) => { if (v && !arr.includes(v)) arr.push(v); };

// Returns Map(qid → entity). Incremental against data/incoming/wd-entities.json.
export async function loadWdEntities(qids, { refresh = false, onProgress } = {}) {
  const uniq = [...new Set(qids.filter(Boolean))];
  let cache = {};
  if (!refresh) { try { cache = JSON.parse(readFileSync(CACHE, "utf8")); } catch {} }
  const missing = uniq.filter(q => !(cache[q] && cache[q].v === SCHEMA));
  const B = 100;
  for (let i = 0; i < missing.length; i += B) {
    const ids = missing.slice(i, i + B);
    const values = ids.map(q => "wd:" + q).join(" ");
    // seed fresh entries at the current schema so a no-result QID caches as fetched-empty (not re-fetched)
    for (const q of ids) cache[q] = { v: SCHEMA, p31: [], creators: [], title: null, materials: [], movements: [], origCountry: [], locCountry: [], inception: null, enwiki: null };

    // A: item scalars + P31 + P495 origin + P571 inception + enwiki article
    const A = await sparql(`SELECT ?w ?p31 ?p31Label ?title ?origCLabel ?inception ?article WHERE {
      VALUES ?w { ${values} }
      OPTIONAL { ?w wdt:P31 ?p31. }
      OPTIONAL { ?w wdt:P1476 ?title. FILTER(LANG(?title)="en") }
      OPTIONAL { ?w wdt:P495 ?origC. }
      OPTIONAL { ?w wdt:P571 ?inception. }
      OPTIONAL { ?article schema:about ?w; schema:isPartOf <https://en.wikipedia.org/>. }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`) || [];
    const seenP31 = new Set();
    for (const b of A) { const q = qidOf(b.w.value); const e = cache[q]; if (!e) continue;
      if (b.p31) { const tq = qidOf(b.p31.value); const k = q + "|" + tq;
        if (tq && !seenP31.has(k)) { seenP31.add(k); e.p31.push({ q: tq, l: /^Q\d+$/.test(b.p31Label?.value || "") ? "" : (b.p31Label?.value || "") }); } }
      if (b.title && !e.title) e.title = b.title.value;
      if (b.origCLabel && !/^Q\d+$/.test(b.origCLabel.value)) pushUniq(e.origCountry, b.origCLabel.value);
      if (b.inception && !e.inception) e.inception = b.inception.value;
      if (b.article && !e.enwiki) e.enwiki = decodeURIComponent(b.article.value.split("/wiki/")[1] || "").replace(/_/g, " ") || null;
    }

    // B: creator(s) + death year + creator's birthplace country
    const Bq = await sparql(`SELECT ?w ?creator ?creatorLabel ?death ?birthCLabel WHERE {
      VALUES ?w { ${values} }
      OPTIONAL { ?w wdt:P170 ?creator.
        OPTIONAL { ?creator wdt:P570 ?d. BIND(YEAR(?d) AS ?death) }
        OPTIONAL { ?creator wdt:P19 ?bp. ?bp wdt:P17 ?birthC. } }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`) || [];
    for (const b of Bq) { const q = qidOf(b.w.value); const e = cache[q]; if (!e || !b.creator) continue;
      const cq = qidOf(b.creator.value); if (!cq) continue;
      let c = e.creators.find(x => x.q === cq);
      // the label service returns the bare QID when a creator has no English label — treat that as "no label"
      if (!c) { c = { q: cq, l: /^Q\d+$/.test(b.creatorLabel?.value || "") ? "" : (b.creatorLabel?.value || ""), death: null, birthCountry: null }; e.creators.push(c); }
      if (b.death && c.death == null) c.death = +b.death.value;
      if (b.birthCLabel && !c.birthCountry && !/^Q\d+$/.test(b.birthCLabel.value)) c.birthCountry = b.birthCLabel.value;
    }

    // C: multi-valued materials + movements + location-of-creation country
    const C = await sparql(`SELECT ?w ?materialLabel ?movementLabel ?locCLabel WHERE {
      VALUES ?w { ${values} }
      OPTIONAL { ?w wdt:P186 ?material. }
      OPTIONAL { ?w wdt:P135 ?movement. }
      OPTIONAL { ?w wdt:P1071 ?loc. ?loc wdt:P17 ?locC. }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`) || [];
    for (const b of C) { const q = qidOf(b.w.value); const e = cache[q]; if (!e) continue;
      if (b.materialLabel && !/^Q\d+$/.test(b.materialLabel.value)) pushUniq(e.materials, b.materialLabel.value);
      if (b.movementLabel && !/^Q\d+$/.test(b.movementLabel.value)) pushUniq(e.movements, b.movementLabel.value);
      if (b.locCLabel && !/^Q\d+$/.test(b.locCLabel.value)) pushUniq(e.locCountry, b.locCLabel.value);
    }

    if (onProgress) onProgress(Math.min(i + B, missing.length), missing.length);
    await sleep(200);
  }
  if (missing.length) { try { mkdirSync("data/incoming", { recursive: true }); } catch {} writeFileSync(CACHE, JSON.stringify(cache)); }
  const out = new Map();
  const empty = { v: SCHEMA, p31: [], creators: [], title: null, materials: [], movements: [], origCountry: [], locCountry: [], inception: null, enwiki: null };
  for (const q of uniq) out.set(q, cache[q] || empty);
  return out;
}
