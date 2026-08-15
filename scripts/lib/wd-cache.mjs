// Shared Wikidata entity cache (Phase 3 efficiency). One incremental SPARQL pull of the facts the WD audits
// need — P31 (instance-of, for artwork/non-artwork classification) and P170 creator + P570 death year (for
// copyright) — cached to data/incoming/wd-entities.json keyed by QID. audit-p31, audit-misharvest, and
// audit-copyright read from this instead of each sweeping SPARQL separately (P31 was fetched 2-3x, creators
// again). Incremental: only QIDs absent from the cache are fetched; pass {refresh:true} to rebuild from scratch.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const UA = "GessoWdCache/1.0 (kathryn.swint@gmail.com)";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const CACHE = "data/incoming/wd-entities.json";

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

// Returns Map(qid → { p31:[{q,l}], creators:[{q,l,death}] }). Incremental against data/incoming/wd-entities.json.
// A QID that returns nothing is cached as fetched-empty so it isn't re-queried every run.
export async function loadWdEntities(qids, { refresh = false, onProgress } = {}) {
  const uniq = [...new Set(qids.filter(Boolean))];
  let cache = {};
  if (!refresh) { try { cache = JSON.parse(readFileSync(CACHE, "utf8")); } catch {} }
  const missing = uniq.filter(q => !(q in cache));
  const B = 100;
  for (let i = 0; i < missing.length; i += B) {
    const ids = missing.slice(i, i + B);
    const rows = await sparql(`SELECT ?w ?p31 ?p31Label ?creator ?creatorLabel ?death WHERE {
      VALUES ?w { ${ids.map(q => "wd:" + q).join(" ")} }
      OPTIONAL { ?w wdt:P31 ?p31. }
      OPTIONAL { ?w wdt:P170 ?creator. OPTIONAL { ?creator wdt:P570 ?d. BIND(YEAR(?d) AS ?death) } }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`);
    // seed every requested id (a no-result id caches as fetched-empty, not re-fetched forever)
    for (const q of ids) if (!cache[q]) cache[q] = { p31: [], creators: [] };
    if (rows) {
      const seenP = new Set(), seenC = new Set();
      for (const b of rows) {
        const q = (b.w.value.match(/Q\d+/) || [])[0]; if (!q) continue;
        const e = cache[q];
        if (b.p31) { const tq = (b.p31.value.match(/Q\d+/) || [])[0]; const k = q + "|" + tq;
          if (tq && !seenP.has(k)) { seenP.add(k); e.p31.push({ q: tq, l: /^Q\d+$/.test(b.p31Label?.value || "") ? "" : (b.p31Label?.value || "") }); } }
        if (b.creator) { const cq = (b.creator.value.match(/Q\d+/) || [])[0]; const k = q + "|" + cq;
          const death = b.death ? +b.death.value : null;
          if (cq && !seenC.has(k)) { seenC.add(k); e.creators.push({ q: cq, l: b.creatorLabel?.value || "", death }); }
          else if (cq && death != null) { const c = e.creators.find(x => x.q === cq); if (c && c.death == null) c.death = death; } }
      }
    }
    if (onProgress) onProgress(Math.min(i + B, missing.length), missing.length);
    await sleep(250);
  }
  if (missing.length) { try { mkdirSync("data/incoming", { recursive: true }); } catch {} writeFileSync(CACHE, JSON.stringify(cache)); }
  const out = new Map();
  for (const q of uniq) out.set(q, cache[q] || { p31: [], creators: [] });
  return out;
}
