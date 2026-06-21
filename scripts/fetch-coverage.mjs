// Harvest coverage-gap artworks (see tasks/coverage-gaps.md) from Wikidata SPARQL, normalized to our
// schema and STAGED for review (never writes the pool). Per gap we query works with a Commons image (P18)
// and an inception/date, pulling the per-item sitelink count (wikibase:sitelinks) as the easy/medium fame
// proxy. Works with sitelinks >= CUTOFF (or a clearly canonical maker) go to data/incoming/coverage-easymed/
// <gap>.json; the long tail is appended to data/incoming/coverage-parked.json for later review.
//
// Run: node scripts/fetch-coverage.mjs            (all gaps)
//      node scripts/fetch-coverage.mjs oceania     (one gap)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { readGlobal } from "./lib/static-module.mjs";
import { normalizeArtist, canonicalizeStyle, isInCopyright, simplifyMedium } from "./lib/domain.mjs";
import { canonicalizePlace, continentOf } from "./lib/places.mjs";

const UA = "GessoCoverage/1.0 (kathryn.swint@gmail.com) coverage-gap harvest";
const SITELINK_CUTOFF = 6;        // easy/medium proxy threshold
const PER_GAP_LIMIT = 700;        // SPARQL row cap per gap query
const sleep = ms => new Promise(r => setTimeout(r, ms));

// --- country centroid (mirrors fetch-collection.mjs) ---
const W = {}; new Function("window", readFileSync("data/countries.js","utf8"))(W);
const CO = {}; for (const c of (W.ARTEFACTUM_COUNTRIES||[])) CO[c.n.toLowerCase()] = c;
function centroid(c){ let big=c.r[0]; for(const r of c.r) if(r.length>big.length) big=r; let sx=0,sy=0; for(const[x,y]of big){sx+=x;sy+=y;} return [Math.round(sy/big.length*1000)/1000, Math.round(sx/big.length*1000)/1000]; }
const yr = v => { const m = String(v||"").match(/(-?\d{1,4})/); return m ? parseInt(m[1],10) : null; };

async function sparql(qy){
  const u = "https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(qy);
  for(let t=0;t<6;t++){
    try{ const r = await fetch(u,{headers:{"User-Agent":UA,"Accept":"application/sparql-results+json"}});
      if(r.status===429||r.status>=500){ await sleep(4000*(t+1)); continue; }
      if(!r.ok){ console.error("  sparql HTTP",r.status); return null; }
      return await r.json();
    } catch(e){ console.error("  sparql err",e.message); await sleep(2000*(t+1)); }
  }
  return null;
}

// Common SELECT/aggregation tail. ?core is a WHERE fragment binding ?i (the artwork). ORDER BY sitelinks
// so the LIMIT keeps the most recognizable works.
const buildQ = core => `SELECT ?i (SAMPLE(?img) AS ?image) (SAMPLE(?t) AS ?title) (SAMPLE(?inc) AS ?year)
  (SAMPLE(?creatorL) AS ?creator) (SAMPLE(?countryL) AS ?country) (SAMPLE(?locCountryL) AS ?locCountry)
  (SAMPLE(?cultureL) AS ?culture) (SAMPLE(?matL) AS ?material) (SAMPLE(?movL) AS ?movement)
  (MAX(?sl) AS ?sitelinks) WHERE {
  ${core}
  ?i wdt:P18 ?img; wikibase:sitelinks ?sl.
  OPTIONAL { ?i rdfs:label ?t. FILTER(LANG(?t)="en") }
  OPTIONAL { ?i wdt:P571 ?inc. }
  OPTIONAL { ?i wdt:P170 ?cr. ?cr rdfs:label ?creatorL. FILTER(LANG(?creatorL)="en") }
  OPTIONAL { ?i wdt:P495 ?c. ?c rdfs:label ?countryL. FILTER(LANG(?countryL)="en") }
  OPTIONAL { ?i wdt:P1071 ?loc. ?loc wdt:P17 ?lc. ?lc rdfs:label ?locCountryL. FILTER(LANG(?locCountryL)="en") }
  OPTIONAL { ?i wdt:P2596 ?cul. ?cul rdfs:label ?cultureL. FILTER(LANG(?cultureL)="en") }
  OPTIONAL { ?i wdt:P186 ?m. ?m rdfs:label ?matL. FILTER(LANG(?matL)="en") }
  OPTIONAL { ?i wdt:P135 ?mv. ?mv rdfs:label ?movL. FILTER(LANG(?movL)="en") }
} GROUP BY ?i ORDER BY DESC(?sitelinks) LIMIT ${PER_GAP_LIMIT}`;

// P31 visual-work classes we treat as "artwork" (artwork, painting, sculpture, print, drawing, woodblock,
// etching, engraving, mask, statue, ...). Reused across gaps via VALUES.
const ART_TYPES = "wd:Q838948 wd:Q3305213 wd:Q860861 wd:Q11060274 wd:Q93184 wd:Q18761202 wd:Q18219090 wd:Q15123870 wd:Q22669139 wd:Q179700 wd:Q4502142 wd:Q207628 wd:Q133067 wd:Q2293009";

// --- gap definitions: each `core` is a SPARQL WHERE fragment binding ?i ---
const GAPS = {
  // 1. Oceania: anchor on a Pacific CULTURE (P2596) — reliable for indigenous art. The bare
  // country-of-origin branch was dropped: P495=Australia/NZ pulls modern films/media (e.g. "The Matrix").
  // Country branch kept only when paired with an ethnographic culture OR a sculpture/mask type pre-1900.
  // NOTE: `wdt:P31/wdt:P279*` deep paths + big VALUES + the aggregation tail time out the WDQS endpoint.
  // Culture/country/maker/inception anchors are already selective enough that we rely on them + P18 and
  // skip the type filter (these sets are overwhelmingly artworks); a single-hop `wdt:P31 ?t VALUES` is used
  // only where extra noise-filtering is cheap.
  // 1. Oceania: Pacific country-of-origin (P495) restricted to an art-type P31 (drops films/media like
  // "The Matrix" that share P495=Australia/NZ), UNION Pacific culture (P2596). Pacific art on Wikidata is
  // thin and rarely P2596-tagged, so the country branch is where most works live.
  oceania: `{
      VALUES ?country { wd:Q664 wd:Q691 wd:Q683 wd:Q717146 wd:Q408 wd:Q686 wd:Q712 wd:Q678 wd:Q3960 wd:Q672 wd:Q697 wd:Q35555 wd:Q7825 }
      ?i wdt:P495 ?country.
      ?i wdt:P31 ?type. VALUES ?type { ${ART_TYPES} }
    } UNION {
      VALUES ?cul { wd:Q204034 wd:Q331959 wd:Q723444 wd:Q1153484 wd:Q33549 wd:Q241248 wd:Q172587 wd:Q815436 wd:Q1075293 wd:Q1196172 wd:Q34366 wd:Q9332 }
      ?i wdt:P2596 ?cul.
      ?i wdt:P31 ?type. VALUES ?type { ${ART_TYPES} }
    }`,

  // 2. Canonical prints / works on paper by the named masters: Dürer, Rembrandt, Goya, Piranesi,
  // Schongauer, Callot, Goltzius. Type filter restricted to PRINTS/DRAWINGS (print Q11060274, etching
  // Q18219090, engraving Q15123870, woodcut Q18761202, lithograph Q22669139, drawing Q93184) so the
  // makers' paintings don't slip in.
  prints: `VALUES ?maker { wd:Q5580 wd:Q5598 wd:Q5432 wd:Q316307 wd:Q155575 wd:Q460124 wd:Q165367 }
    ?i wdt:P170 ?maker.
    ?i wdt:P31 ?type. VALUES ?type { wd:Q11060274 wd:Q18219090 wd:Q15123870 wd:Q18761202 wd:Q22669139 wd:Q93184 wd:Q1278452 }`,

  // 3. Early-medieval Europe 500–1000 CE: artwork inception in that window, anchored on the inception
  // range (selective) + art-type P31. No P30 continent join (it times out); region is derived at
  // normalize time from the resolved country instead, and non-European results are rare in this window.
  early_medieval: `?i wdt:P571 ?inc. FILTER(YEAR(?inc) >= 450 && YEAR(?inc) <= 1050)
    ?i wdt:P31 ?type. VALUES ?type { ${ART_TYPES} }`,

  // 4. South & Southeast Asian: India, Nepal, Cambodia, Thailand, Indonesia, Sri Lanka, Myanmar, Pakistan, Vietnam, Laos.
  south_se_asia: `VALUES ?country { wd:Q668 wd:Q837 wd:Q424 wd:Q869 wd:Q252 wd:Q854 wd:Q836 wd:Q843 wd:Q881 wd:Q819 wd:Q1049 }
    ?i wdt:P495 ?country.
    ?i wdt:P31 ?type. VALUES ?type { ${ART_TYPES} }`,

  // 5. Pre-Columbian Americas: Maya, Aztec, Inca, Moche, Nazca, Olmec, Zapotec, Toltec, Chimú,
  // Teotihuacan, Tiwanaku, Paracas cultures (P2596).
  pre_columbian: `VALUES ?cul { wd:Q28567 wd:Q12542 wd:Q28573 wd:Q208188 wd:Q210570 wd:Q135364 wd:Q844750 wd:Q187897 wd:Q901198 wd:Q172613 wd:Q61750 wd:Q1127723 }
    ?i wdt:P2596 ?cul.
    ?i wdt:P31 ?type. VALUES ?type { ${ART_TYPES} }`,

  // 6. Post-1945 PD-eligible: artwork inception >= 1945 with creator who died <= 1955 (mirrors the
  // audit-copyright PD rule). isInCopyright is a further guard at normalize time.
  post1945: `?i wdt:P170 ?cr. ?cr wdt:P570 ?death. FILTER(YEAR(?death) <= 1955)
    ?i wdt:P571 ?inc. FILTER(YEAR(?inc) >= 1945)
    ?i wdt:P31 ?type. VALUES ?type { ${ART_TYPES} }`,
};

const toCo = label => { if(!label) return ""; const k = label.toLowerCase().trim(); return CO[k] ? CO[k].n : ""; };

function normalize(b, gap){
  const qm = b.i.value.match(/Q\d+/); if(!qm) return null;
  const title = b.title ? b.title.value : null; if(!title) return null;
  const file = decodeURIComponent(b.image.value.split("/").pop());
  const country = (b.country && toCo(b.country.value)) || (b.locCountry && toCo(b.locCountry.value)) || "";
  const place = canonicalizePlace(country);
  const co = country ? CO[country.toLowerCase()] : null;
  const [lat,lng] = co ? centroid(co) : [null,null];
  const culture = b.culture ? b.culture.value : "";
  const movement = b.movement ? b.movement.value : "";
  const rawStyle = culture || movement;
  const style = canonicalizeStyle(rawStyle);
  const artist = b.creator ? normalizeArtist(b.creator.value) : "";
  return {
    id: "http://www.wikidata.org/entity/" + qm[0],
    wikidataid: qm[0],
    title,
    artist,
    y: b.year ? yr(b.year.value) : null,
    lat, lng,
    place,
    region: continentOf(place) || "",
    medium: simplifyMedium(b.material ? b.material.value : ""),
    style,
    styleKind: style ? (culture ? "culture" : "movement") : "",
    img: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=900`,
    src: "coverage-" + gap,
    gap,
    sitelinks: b.sitelinks ? parseInt(b.sitelinks.value,10) : 0,
  };
}

// --- Met API supplement (for gaps where Wikidata is thin: Oceania, pre-Columbian) ---
// The Met has no sitelink concept, so the easy/med proxy here is the Met's own canon signal:
// isHighlight OR isTimelineWork → staged; everything else → parked.
const MET = "https://collectionapi.metmuseum.org/public/collection/v1";
async function metFetch(url, t=0){
  try{ const r = await fetch(url,{headers:{"User-Agent":UA,Accept:"application/json"}});
    if((r.status===403||r.status===429||r.status>=500)&&t<5){ await sleep(1500*2**t); return metFetch(url,t+1); }
    if(!r.ok) return null; return await r.json();
  }catch(e){ if(t<5){ await sleep(1500*2**t); return metFetch(url,t+1);} return null; }
}
// search terms per gap (Met dept 5 = Arts of Africa, Oceania, and the Americas)
const MET_GAPS = {
  oceania: ["Oceania","Maori","Asmat","Sepik","New Guinea","Polynesia","Melanesia","Aboriginal Australia","Solomon Islands","New Ireland","Hawaii"],
  pre_columbian: ["Maya","Aztec","Inca","Moche","Nazca","Olmec","Zapotec","Mixtec","Teotihuacan","Precolumbian","Peru ceramic","Mexico mask"],
};
function metNormalize(o, gap){
  const begin=Number(o.objectBeginDate), end=Number(o.objectEndDate);
  const y = (Number.isFinite(begin)&&Number.isFinite(end)) ? Math.round((begin+end)/2) : (Number.isFinite(begin)?begin:(Number.isFinite(end)?end:null));
  const img = (o.primaryImage||"").trim();
  const culture = (o.culture||"").trim();
  const place = canonicalizePlace((o.country||o.region||culture||"").trim());
  if(!o.isPublicDomain || !img || y===null) return null;
  const co = place ? CO[place.toLowerCase()] : null; const [lat,lng] = co?centroid(co):[null,null];
  const style = canonicalizeStyle(culture);
  return {
    id:`met:${o.objectID}`, metid:o.objectID, title:o.title||"", artist:normalizeArtist(o.artistDisplayName||""),
    y, lat, lng, place, region:continentOf(place)||(gap==="oceania"?"Oceania":""),
    medium:simplifyMedium(o.medium||""), style, styleKind:style?"culture":"",
    img, src:"coverage-"+gap, gap, sitelinks:0, metCanon: !!(o.isHighlight||o.isTimelineWork),
  };
}
async function runMet(gap, parked, parkedQs, poolMetIds){
  console.log(`\n=== gap: ${gap} (Met API supplement) ===`);
  const ids = new Set();
  for(const q of MET_GAPS[gap]){
    const u = new URL(`${MET}/search`); u.searchParams.set("hasImages","true"); u.searchParams.set("departmentId","5"); u.searchParams.set("q",q);
    const j = await metFetch(u.toString()); (j&&Array.isArray(j.objectIDs)?j.objectIDs:[]).slice(0,80).forEach(id=>ids.add(id));
    await sleep(350);
  }
  console.log(`  ${ids.size} candidate object ids`);
  const staged=[]; let pStaged=0,pParked=0,dDup=0,dCopyright=0;
  let n=0;
  for(const id of ids){
    if(++n>500) break;
    const o = await metFetch(`${MET}/objects/${id}`); await sleep(300);
    const w = o && metNormalize(o, gap); if(!w) continue;
    if(poolMetIds.has(`met${id}`)||poolMetIds.has(w.id)){ dDup++; continue; }
    if(seenMet.has(w.id)){ dDup++; continue; } seenMet.add(w.id);
    if(isInCopyright(w.artist)){ dCopyright++; continue; }
    if(w.metCanon){ delete w.metCanon; staged.push(w); pStaged++; }
    else { delete w.metCanon; if(!parkedQs.has(w.id)){ parked.push({ id:w.id, wikidataid:w.id, title:w.title, artist:w.artist, gap, sitelinks:0, img:w.img }); parkedQs.add(w.id); } pParked++; }
  }
  const outPath = `data/incoming/coverage-easymed/${gap}-met.json`;
  writeFileSync(outPath, JSON.stringify(staged,null,1));
  console.log(`  STAGED ${pStaged} → ${outPath}`);
  console.log(`  parked ${pParked} | skipped: pool-dup ${dDup}, in-copyright ${dCopyright}`);
  return { gap:gap+" (met)", staged:pStaged, parked:pParked, dup:dDup, copyright:dCopyright };
}
const seenMet = new Set();

// --- main ---
const only = process.argv[2];
const metMode = only === "met";
const gapNames = (only && !metMode) ? [only] : Object.keys(GAPS);
if(only && !metMode && !GAPS[only]){ console.error("unknown gap:", only, "| known:", Object.keys(GAPS).join(", "), "| or 'met'"); process.exit(1); }

const pool = readGlobal("data/pool.js","ARTEFACTUM_POOL");
const poolQs = new Set(pool.flatMap(p => [(String(p.id).match(/Q\d+/)||[])[0], (String(p.wikidataid||"").match(/Q\d+/)||[])[0]]).filter(Boolean));
console.log(`pool has ${pool.length} works (${poolQs.size} Q-ids) to dedup against`);

mkdirSync("data/incoming/coverage-easymed", { recursive: true });
const parkedPath = "data/incoming/coverage-parked.json";
const parked = existsSync(parkedPath) ? JSON.parse(readFileSync(parkedPath,"utf8")) : [];
const parkedQs = new Set(parked.map(p => p.wikidataid));
const seenThisRun = new Set();
const summary = [];

if(metMode){
  const poolMetIds = new Set(pool.map(p=>String(p.id)).filter(s=>/^met/.test(s)));
  for(const gap of Object.keys(MET_GAPS)){
    summary.push(await runMet(gap, parked, parkedQs, poolMetIds));
  }
  writeFileSync(parkedPath, JSON.stringify(parked, null, 1));
  console.log(`\n=== MET SUMMARY (proxy: isHighlight/isTimelineWork) ===`);
  let mt=0; for(const s of summary){ console.log(`  ${s.gap.padEnd(20)} staged ${String(s.staged).padStart(4)} | parked ${String(s.parked).padStart(4)}`); mt+=s.staged; }
  console.log(`  TOTAL STAGED (met): ${mt}`);
  console.log(`  parked list now ${parked.length} → ${parkedPath}`);
  console.log("\nNothing promoted, nothing committed.");
  process.exit(0);
}

for(const gap of gapNames){
  console.log(`\n=== gap: ${gap} ===`);
  const j = await sparql(buildQ(GAPS[gap]));
  if(!j || !j.results){ console.log("  NO RESULTS (API unreachable or query failed) — skipping"); summary.push({gap, staged:0, parked:0, note:"API unreachable / no results"}); continue; }
  const rows = j.results.bindings;
  console.log(`  ${rows.length} raw rows`);
  const staged = [];
  let pStaged=0, pParked=0, dDup=0, dCopyright=0;
  for(const b of rows){
    const w = normalize(b, gap);
    if(!w) continue;
    if(poolQs.has(w.wikidataid)){ dDup++; continue; }       // already in pool
    if(seenThisRun.has(w.wikidataid)){ dDup++; continue; }   // cross-gap dup
    if(isInCopyright(w.artist)){ dCopyright++; continue; }
    seenThisRun.add(w.wikidataid);
    // prints by canonical masters are inherently lower-sitelink, so use a relaxed cutoff for that gap;
    // everything else uses the standard easy/medium proxy.
    const cutoff = gap === "prints" ? 3 : SITELINK_CUTOFF;
    if(w.sitelinks >= cutoff){
      staged.push(w); pStaged++;
    } else {
      if(!parkedQs.has(w.wikidataid)){ parked.push({ id:w.id, wikidataid:w.wikidataid, title:w.title, artist:w.artist, gap, sitelinks:w.sitelinks, img:w.img }); parkedQs.add(w.wikidataid); }
      pParked++;
    }
  }
  const outPath = `data/incoming/coverage-easymed/${gap}.json`;
  writeFileSync(outPath, JSON.stringify(staged, null, 1));
  console.log(`  STAGED ${pStaged} → ${outPath}`);
  console.log(`  parked ${pParked} | skipped: pool-dup ${dDup}, in-copyright ${dCopyright}`);
  summary.push({ gap, staged:pStaged, parked:pParked, dup:dDup, copyright:dCopyright });
  await sleep(1500);
}

writeFileSync(parkedPath, JSON.stringify(parked, null, 1));
console.log(`\n=== SUMMARY (sitelink cutoff = ${SITELINK_CUTOFF}) ===`);
let total=0;
for(const s of summary){ console.log(`  ${s.gap.padEnd(16)} staged ${String(s.staged).padStart(4)} | parked ${String(s.parked||0).padStart(4)}${s.note?"  ("+s.note+")":""}`); total += s.staged; }
console.log(`  TOTAL STAGED: ${total}`);
console.log(`  parked list now ${parked.length} works → ${parkedPath}`);
console.log("\nNothing promoted, nothing committed. Staged to data/incoming/ for review.");
