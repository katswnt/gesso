// Second deterministic pass over the review queue: verify date/place/title corrections for NON-Wikidata
// works against their museum's open API (Met, AIC, Cleveland, V&A). Uses museum data as ground truth:
//  - date : set pool yr to the museum's authoritative [begin,end] range (or discard if it confirms current)
//  - title/place : confirm the proposed value against the museum; apply if it matches, else leave for eyes
//   node scripts/queue-museum.mjs           (dry report)
//   node scripts/queue-museum.mjs --apply   (write pool + trimmed queue)
import { readFileSync, writeFileSync } from "node:fs";
import { readGlobal, writeAssignment } from "./lib/static-module.mjs";

const APPLY = process.argv.includes("--apply");
const UA = "GessoQueueMuseum/1.0 (kathryn.swint@gmail.com)";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => String(s || "").toLowerCase().replace(/[\s.,'’\-–—]+/g, " ").trim();

const queue = JSON.parse(readFileSync("data/incoming/curate/review-queue.json", "utf8"));
const pool = readGlobal("data/pool.js", "ARTEFACTUM_POOL");
const byId = new Map(pool.map(p => [p.id, p]));
const jget = async url => { try { const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } }); return r.ok ? await r.json() : null; } catch { return null; } };

// museum adapters → normalized {title, begin, end, place}
async function fetchRec(id){
  let m;
  if((m = id.match(/^met(\d+)/))){ const j = await jget(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${m[1]}`); if(!j) return null;
    return { title: j.title, begin: +j.objectBeginDate, end: +j.objectEndDate, place: j.country || j.culture || j.region || "" }; }
  if((m = id.match(/^aic(\d+)/))){ const j = await jget(`https://api.artic.edu/api/v1/artworks/${m[1]}?fields=title,date_start,date_end,place_of_origin`); const d = j?.data; if(!d) return null;
    return { title: d.title, begin: +d.date_start, end: +d.date_end, place: d.place_of_origin || "" }; }
  if((m = id.match(/^cleveland(\d+)/))){ const j = await jget(`https://openaccess-api.clevelandart.org/api/artworks/${m[1]}`); const d = j?.data; if(!d) return null;
    return { title: d.title, begin: +d.creation_date_earliest, end: +d.creation_date_latest, place: (d.culture && d.culture[0]) || "" }; }
  if((m = id.match(/^va[A-Za-z]?(\w+)/))){ const sn = id.replace(/^va/, ""); const j = await jget(`https://api.vam.ac.uk/v2/museumobject/${sn}`); const r = j?.record; if(!r) return null;
    const pd = (r.productionDates && r.productionDates[0]) || {}; const y = s => { const n = String(s||"").match(/-?\d{3,4}/); return n ? +n[0] : NaN; };
    return { title: (r.titles && r.titles[0] && r.titles[0].title) || r.objectType || "", begin: y(pd.date && pd.date.earliest), end: y(pd.date && pd.date.latest), place: (r.placesOfOrigin && r.placesOfOrigin[0] && r.placesOfOrigin[0].place && r.placesOfOrigin[0].place.text) || "" }; }
  return null;
}

const dateRange = v => { const n = String(v).match(/-?\d{3,4}/g); if(!n) return null; const a=+n[0]; let b=n[1]?+n[1]:a; if(b<a && n[1].length<4) b=+(String(a).slice(0,String(a).length-n[1].length)+n[1]); return [a,b]; };

const targets = queue.filter(it => /^(met|aic|cleveland|va)/.test(it.id) && ["date","place","title"].includes(it.type));
const recCache = new Map();
const res = { apply: [], discard: [], review: [] };
let done = 0;
for(const it of targets){
  if(!recCache.has(it.id)) { recCache.set(it.id, await fetchRec(it.id)); await sleep(120); }
  const rec = recCache.get(it.id); const p = byId.get(it.id);
  if(!rec || !p){ res.review.push({ it, how: "no museum record" }); continue; }
  if(it.type === "date"){
    const b = rec.begin, e = Number.isFinite(rec.end) ? rec.end : rec.begin;
    if(!Number.isFinite(b)){ res.review.push({ it, how: "museum date missing" }); }
    else if(b === Number(it.from) && (e === b)){ res.discard.push({ it, how: "museum confirms current year" }); }
    else { res.apply.push({ it, how: `museum date [${b}${e!==b?"–"+e:""}]`, yr: [b, e] }); }
  } else if(it.type === "title"){
    if(!rec.title){ res.review.push({ it, how: "no museum title" }); }
    else if(norm(rec.title) === norm(it.to)){ res.apply.push({ it, how: "museum title == proposed", val: it.to }); }
    else if(norm(rec.title) === norm(it.from)){ res.discard.push({ it, how: "museum title == current" }); }
    else res.review.push({ it, how: `museum title "${rec.title}"` });
  } else if(it.type === "place"){
    const mp = norm(rec.place);
    if(!mp){ res.review.push({ it, how: "no museum place" }); }
    else if(mp && (norm(it.to).includes(mp) || mp.includes(norm(it.to).split(" ")[0]))){ res.apply.push({ it, how: `museum place "${rec.place}"`, val: it.to }); }
    else res.review.push({ it, how: `museum place "${rec.place}" ≠ proposed` });
  }
  if(++done % 40 === 0) console.error(`  ${done}/${targets.length}`);
}

const sum = b => { const t = {}; for(const x of res[b]) t[x.it.type] = (t[x.it.type]||0)+1; return t; };
console.log("\n===== MUSEUM-API PASS =====");
console.log(`checked ${targets.length} met/aic/cleveland/va date+place+title items`);
console.log(`APPLY   ${res.apply.length}`, JSON.stringify(sum("apply")));
console.log(`DISCARD ${res.discard.length}`, JSON.stringify(sum("discard")));
console.log(`REVIEW  ${res.review.length}`, JSON.stringify(sum("review")));

if(APPLY){
  let c = 0;
  for(const x of res.apply){ const p = byId.get(x.it.id); if(!p) continue;
    if(x.it.type === "date"){ p.yr = x.yr; p.y = x.yr[0]; c++; }
    else if(x.it.type === "title"){ p.title = x.val; c++; }
    else if(x.it.type === "place"){ p.place = x.val; c++; }
  }
  const resolved = new Set([...res.apply, ...res.discard].map(x => x.it));
  const trimmed = queue.filter(it => !resolved.has(it));
  writeAssignment("data/pool.js", "ARTEFACTUM_POOL", pool);
  writeFileSync("data/incoming/curate/review-queue.json", JSON.stringify(trimmed, null, 1));
  console.log(`\napplied ${c} to pool; queue ${queue.length} → ${trimmed.length}. Run the gate as its own step.`);
} else console.log("\nDRY RUN — pass --apply to write.");
