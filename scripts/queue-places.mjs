// Wrong-origin place pass: for queued place-corrections on Wikidata works, use Wikidata's authoritative
// "location of creation" (P1071) + its coordinates (P625) to set the correct origin + map pin. This is the
// class behind the confusing map pins (Holbein "Italy (Rome)" → England). Applies P1071-confident ones;
// writes the residue (no P1071) to data/incoming/curate/places-residue.json for a Sonnet pass.
//   node scripts/queue-places.mjs           (dry)
//   node scripts/queue-places.mjs --apply
import { readFileSync, writeFileSync } from "node:fs";
import { readGlobal, writeAssignment } from "./lib/static-module.mjs";

const APPLY = process.argv.includes("--apply");
const UA = "GessoQueuePlaces/1.0 (kathryn.swint@gmail.com)";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const qid = id => { const m = String(id||"").match(/Q\d+/); return m ? m[0] : null; };

const queue = JSON.parse(readFileSync("data/incoming/curate/review-queue.json","utf8"));
const pool = readGlobal("data/pool.js","ARTEFACTUM_POOL");
const byId = new Map(pool.map(p => [p.id, p]));
const items = queue.filter(it => it.type === "place" && qid(it.id));
const qids = [...new Set(items.map(it => qid(it.id)))];

async function sparql(qy){
  const u = "https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(qy);
  for(let t=0;t<5;t++){ try{ const r = await fetch(u,{headers:{"User-Agent":UA,Accept:"application/sparql-results+json"}});
    if(r.status===429||r.status>=500){ await sleep(3000*(t+1)); continue; } if(!r.ok) return null; return await r.json();
  }catch{ await sleep(1500*(t+1)); } } return null;
}
const wd = new Map();
console.error(`fetching P1071 location-of-creation for ${qids.length} works...`);
for(let i=0;i<qids.length;i+=120){
  const values = qids.slice(i,i+120).map(q=>"wd:"+q).join(" ");
  const j = await sparql(`SELECT ?work ?locLabel ?coord ?locCountryLabel ?p495Label WHERE {
    VALUES ?work { ${values} }
    OPTIONAL { ?work wdt:P1071 ?loc. OPTIONAL { ?loc wdt:P625 ?coord. } OPTIONAL { ?loc wdt:P17 ?locCountry. } }
    OPTIONAL { ?work wdt:P495 ?p495. }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`);
  await sleep(400);
  for(const b of (j?.results?.bindings||[])){
    const q = qid(b.work?.value); if(!q) continue;
    if(!wd.has(q)) wd.set(q, {});
    const e = wd.get(q);
    if(b.locLabel?.value && !/^Q\d+$/.test(b.locLabel.value)) e.loc = b.locLabel.value;
    if(b.coord?.value){ const m = b.coord.value.match(/Point\(([-\d.]+) ([-\d.]+)\)/); if(m){ e.lng=+m[1]; e.lat=+m[2]; } }
    if(b.locCountryLabel?.value && !/^Q\d+$/.test(b.locCountryLabel.value)) e.country = b.locCountryLabel.value;
    if(b.p495Label?.value && !/^Q\d+$/.test(b.p495Label.value)) e.p495 = b.p495Label.value;
  }
  console.error(`  ${Math.min(i+120,qids.length)}/${qids.length}`);
}

const report = { applied: [], residue: [] };
const resolved = new Set();
for(const it of items){
  const p = byId.get(it.id); const e = wd.get(qid(it.id));
  if(!p || !e || !e.loc){ report.residue.push({ id: it.id, title: it.title, from: it.from, proposed: it.to }); continue; }
  const country = e.country || e.p495;
  const place = (country && country.toLowerCase() !== e.loc.toLowerCase()) ? `${country} (${e.loc})` : e.loc;
  const rec = { id: it.id, title: p.title, from: p.place, to: place };
  if(Number.isFinite(e.lat) && Number.isFinite(e.lng)){ rec.lat = e.lat; rec.lng = e.lng; }
  report.applied.push(rec); resolved.add(it);
}

console.log(`\n===== PLACE WRONG-ORIGIN PASS =====`);
console.log(`P1071 auto-apply: ${report.applied.length} | residue (no location-of-creation → Sonnet): ${report.residue.length}`);
report.applied.slice(0,10).forEach(r=>console.log(`  ${r.from} → ${r.to}${r.lat?" @"+r.lat.toFixed(1)+","+r.lng.toFixed(1):""}  (${r.title.slice(0,30)})`));
writeFileSync("data/incoming/curate/places-residue.json", JSON.stringify(report.residue,null,1));

if(APPLY){
  for(const r of report.applied){ const p = byId.get(r.id); if(!p) continue; p.place = r.to; if(r.lat!=null){ p.lat=r.lat; p.lng=r.lng; } }
  const trimmed = queue.filter(it => !resolved.has(it));
  writeAssignment("data/pool.js","ARTEFACTUM_POOL",pool);
  writeFileSync("data/incoming/curate/review-queue.json", JSON.stringify(trimmed,null,1));
  console.log(`\napplied ${report.applied.length}; queue ${queue.length} → ${trimmed.length}. Gate as its own step.`);
} else console.log("\nDRY RUN — pass --apply to write. Residue → data/incoming/curate/places-residue.json");
