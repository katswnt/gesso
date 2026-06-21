// Re-pull raw Wikidata P186 medium strings and re-run the current medium classifier for non-Wikidata
// sources. Museum API re-pulls are intentionally deferred. Run: node scripts/medium-revalidate.mjs
import { readGlobal, writeAssignment } from "./lib/static-module.mjs";
import { simplifyMedium } from "./lib/domain.mjs";

const UA = "GessoMediumRevalidate/1.0 (kathryn.swint@gmail.com)";
const BATCH = 120;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const qid = id => { const m = String(id || "").match(/Q\d+/); return m ? m[0] : null; };

async function sparql(qy){
  const u = "https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(qy);
  for(let t = 0; t < 6; t++){
    try{
      const r = await fetch(u, { headers: { "User-Agent": UA, "Accept": "application/sparql-results+json" } });
      if(r.status === 429 || r.status >= 500){ await sleep(3000 * (t + 1)); continue; }
      if(!r.ok){ console.error("sparql", r.status); return null; }
      return await r.json();
    }catch(e){
      await sleep(1500 * (t + 1));
    }
  }
  return null;
}

const pool = readGlobal("data/pool.js", "ARTEFACTUM_POOL") || [];
const wdWorks = pool.filter(p => qid(p.id));
const nonWdWorks = pool.filter(p => !qid(p.id));
const byQ = new Map();
for(const p of wdWorks){
  const q = qid(p.id);
  if(q && !byQ.has(q)) byQ.set(q, []);
  if(q) byQ.get(q).push(p);
}

console.log("museum API medium re-pull: TODO (aic/met/va/harvard/cleveland/loc-*); applying simplifyMedium to stored non-Wikidata medium only.");

let wdRepulled = 0, simplifyOnlyUpdates = 0, totalChanged = 0;
const samples = [];

for(let i = 0; i < nonWdWorks.length; i++){
  const p = nonWdWorks[i];
  const before = p.medium || "";
  const after = simplifyMedium(before);
  if(after && after !== before){
    p.medium = after;
    simplifyOnlyUpdates++;
    totalChanged++;
    const bSimple = simplifyMedium(before);
    const aSimple = simplifyMedium(after);
    if(samples.length < 20 && bSimple !== aSimple) samples.push(`${p.title}: ${bSimple || "—"} -> ${aSimple || "—"}`);
  }
}

const qids = [...byQ.keys()];
for(let i = 0; i < qids.length; i += BATCH){
  const batch = qids.slice(i, i + BATCH);
  const values = batch.map(q => "wd:" + q).join(" ");
  const q = `SELECT ?work (GROUP_CONCAT(DISTINCT ?materialLabel; separator=" ") AS ?material) WHERE {
    VALUES ?work { ${values} }
    OPTIONAL { ?work wdt:P186 ?materialItem. ?materialItem rdfs:label ?materialLabel. FILTER(LANG(?materialLabel)="en") }
  } GROUP BY ?work`;

  const j = await sparql(q);
  await sleep(500);
  if(!j?.results) continue;

  for(const b of j.results.bindings){
    const q = qid(b.work?.value);
    const raw = (b.material?.value || "").trim();
    if(!q || !raw) continue;
    for(const p of byQ.get(q) || []){
      const before = p.medium || "";
      if(raw !== before){
        const beforeSimple = simplifyMedium(before);
        const afterSimple = simplifyMedium(raw);
        p.medium = raw;
        wdRepulled++;
        totalChanged++;
        if(samples.length < 20 && beforeSimple !== afterSimple) samples.push(`${p.title}: ${beforeSimple || "—"} -> ${afterSimple || "—"}`);
      }
    }
  }
  console.error(`  ${Math.min(i + BATCH, qids.length)}/${qids.length} wikidata ids checked | changed ${totalChanged}`);
}

writeAssignment("data/pool.js", "ARTEFACTUM_POOL", pool);

console.log(`works checked: ${pool.length}`);
console.log(`wikidata medium re-pulled: ${wdRepulled}`);
console.log(`simplify-only updates: ${simplifyOnlyUpdates}`);
console.log(`total changed: ${totalChanged}`);
console.log("sample medSimple changes:");
for(const s of samples) console.log("  " + s);
