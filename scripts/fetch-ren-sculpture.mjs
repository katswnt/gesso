// Harvest CC0 / public-domain RENAISSANCE SCULPTURE (1400–1600) to fill a coverage gap in the Gesso pool
// (1400–1600 has ~467 oils vs only ~87 sculptures). Pulls from TWO open sources and STAGES for review:
//   1. The Met Collection API  — isPublicDomain works in European Sculpture & Decorative Arts + named sculptors
//   2. Wikidata SPARQL         — instances of sculpture by those sculptors / movement Renaissance, with a Commons image
// Records are normalized to the pool-ready shape (id,title,artist,y,place,region,lat,lng,medium,style,styleKind,
// img,src,sitelinks[,wikidataid]) via the shared domain/places helpers, copyright-filtered, deduped by id and by
// Wikidata Q. STAGE ONLY — writes data/incoming/ren-sculpture.json. Nothing is promoted or committed.
// Run: node scripts/fetch-ren-sculpture.mjs
import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { normalizeArtist, simplifyMedium, canonicalizeStyle, isInCopyright } from "./lib/domain.mjs";
import { canonicalizePlace, continentOf } from "./lib/places.mjs";

const UA = "GessoRenSculpture/1.0 (kathryn.swint@gmail.com)";
const OUT = "data/incoming/ren-sculpture.json";
const MET_API = "https://collectionapi.metmuseum.org/public/collection/v1";
const SPARQL = "https://query.wikidata.org/sparql";
const YEAR_MIN = 1400, YEAR_MAX = 1600;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// --- sculpture material gate: keep only true sculpture materials -------------------------------------------------
const SCULPT_MED = new Set(["Bronze","Marble","Stone","Ceramic","Wood","Ivory","Gold","Silver","Copper","Glass"]);
// terracotta / plaster simplify to Ceramic / Stone respectively (see domain.simplifyMedium) — both kept.
const isSculptMedium = m => SCULPT_MED.has(m);

// --- geo: country centroid from data/countries.js (same approach as fetch-collection.mjs) ------------------------
const win = {}; new Function("window", readFileSync("data/countries.js", "utf8"))(win);
const CO = {}; for (const c of (win.ARTEFACTUM_COUNTRIES || [])) CO[c.n.toLowerCase()] = c;
function centroid(c){ let big=c.r[0]; for(const r of c.r) if(r.length>big.length) big=r;
  let sx=0,sy=0; for(const[x,y]of big){sx+=x;sy+=y;} return [Math.round(sy/big.length*1000)/1000, Math.round(sx/big.length*1000)/1000]; }
function geoFor(place){ const base=String(place||"").replace(/\s*\(.*$/,"").split("/")[0].trim().toLowerCase();
  const c=CO[base]; return c?centroid(c):[null,null]; }

const yr = v => { const m=String(v||"").match(/(-?\d{3,4})/); return m?parseInt(m[1],10):null; };
const inRange = y => y!=null && y>=YEAR_MIN && y<=YEAR_MAX;

// Renaissance sculptors — used as Met artist queries and to tag style/place when explicit data is absent.
const SCULPTORS = ["Donatello","Michelangelo","Luca della Robbia","Andrea della Robbia","Lorenzo Ghiberti",
  "Andrea del Verrocchio","Benvenuto Cellini","Andrea Riccio","Jacopo Sansovino","Tullio Lombardo","Antico",
  "Giambologna","Desiderio da Settignano","Bartolomeo Bellano","Severo da Ravenna","Pier Jacopo Alari Bonacolsi"];

// Map a nationality/culture adjective (Met "culture" is usually "Italian, Florence"; WD creator citizenship is a
// country label) to a Gesso country name. Renaissance sculpture is overwhelmingly Italian; cover the usual suspects.
const NATIONALITY = {
  italian:"Italy", florentine:"Italy", venetian:"Italy", roman:"Italy", paduan:"Italy", sienese:"Italy",
  lombard:"Italy", neapolitan:"Italy", tuscan:"Italy",
  french:"France", german:"Germany", flemish:"Belgium", netherlandish:"Netherlands", dutch:"Netherlands",
  spanish:"Spain", english:"United Kingdom", british:"United Kingdom", austrian:"Austria", swiss:"Switzerland",
  // historical Italian/European states appearing as WD country-of-citizenship labels for 15th–16th-c sculptors
  "republic of florence":"Italy", "republic of venice":"Italy", "republic of siena":"Italy",
  "duchy of milan":"Italy", "papal states":"Italy", "kingdom of naples":"Italy", "grand duchy of tuscany":"Italy",
  "kingdom of italy":"Italy", "kingdom of france":"France", "kingdom of england":"United Kingdom",
  "holy roman empire":"Germany", "kingdom of spain":"Spain", "crown of castile":"Spain",
};
function placeFromCulture(s){
  const raw=String(s||"").trim(); if(!raw) return "";
  // try each comma/paren-delimited token; "Italian, Florence" → italian → Italy
  for(const tok of raw.toLowerCase().split(/[,(;/]/).map(t=>t.trim())){
    if(NATIONALITY[tok]) return NATIONALITY[tok];
    if(CO[tok]) return CO[tok].n;            // already a country name
  }
  return "";
}
// Last-resort place fallback from a known sculptor's nationality. Renaissance sculpture in this harvest is almost
// entirely Italian; map the non-Italian few explicitly, default the rest of these named masters to Italy. Only
// applied to creators we recognize — unknown artists stay place-less (and are dropped at promotion, not guessed).
const ARTIST_COUNTRY = {
  // non-Italian Renaissance sculptors that may appear
  "tilman riemenschneider":"Germany","veit stoss":"Germany","peter vischer the elder":"Germany",
  "conrat meit":"Germany","gregor erhart":"Germany","adriaen de vries":"Netherlands","willem van den broecke":"Belgium",
  "germain pilon":"France","jean goujon":"France","ligier richier":"France","pierre bontemps":"France",
};
const ITALIAN_MASTERS = new Set([...SCULPTORS,
  "Battista di Domenico Lorenzi","Antonio Rossellino","Baccio Bandinelli","Antonio Susini","Pisanello",
  "Giovanni della Robbia","Michelozzo","Bartolomeo Ammannati","Vincenzo Danti","Pierino da Vinci",
  "Niccolò Roccatagliata","Agostino di Duccio","Bernardo Rossellino","Mino da Fiesole","Benedetto da Maiano",
  "Antonio del Pollaiuolo","Bertoldo di Giovanni","Vittore Gambello","Moderno","Giovanni Francesco Rustici",
].map(s=>s.toLowerCase()));
function placeFromArtist(artist){
  const a=String(artist||"").trim().toLowerCase(); if(!a) return "";
  if(ARTIST_COUNTRY[a]) return ARTIST_COUNTRY[a];
  if(ITALIAN_MASTERS.has(a)) return "Italy";
  return "";
}

// ============================================================ MET =================================================
async function metFetch(url, attempt=1){
  try{
    const r = await fetch(url, { headers:{ "user-agent":UA, accept:"application/json" } });
    if((r.status===403||r.status===429||r.status>=500) && attempt<=5){ await sleep(1200*2**(attempt-1)); return metFetch(url,attempt+1); }
    if(!r.ok) return null;
    return await r.json();
  }catch(e){ if(attempt<=5){ await sleep(1200*attempt); return metFetch(url,attempt+1); } return null; }
}
function metSearchUrl(params){
  const u = new URL(`${MET_API}/search`);
  u.searchParams.set("hasImages","true");
  u.searchParams.set("isPublicDomain","true");
  for(const[k,v] of Object.entries(params)) if(v!=null && v!=="") u.searchParams.set(k,String(v));
  return u.toString();
}
async function metHarvest(){
  const ids = new Set();
  const searches = [
    // European Sculpture and Decorative Arts dept (id 21), date-bounded sculpture
    { departmentId:12, q:"sculpture", dateBegin:YEAR_MIN, dateEnd:YEAR_MAX },
    { departmentId:12, q:"statue",    dateBegin:YEAR_MIN, dateEnd:YEAR_MAX },
    { departmentId:12, q:"relief",    dateBegin:YEAR_MIN, dateEnd:YEAR_MAX },
    { departmentId:12, q:"bust",      dateBegin:YEAR_MIN, dateEnd:YEAR_MAX },
    { departmentId:12, q:"bronze",    dateBegin:YEAR_MIN, dateEnd:YEAR_MAX },
    { departmentId:12, q:"terracotta",dateBegin:YEAR_MIN, dateEnd:YEAR_MAX },
    { q:"sculpture", dateBegin:YEAR_MIN, dateEnd:YEAR_MAX },
    ...SCULPTORS.map(a => ({ q:a, dateBegin:YEAR_MIN, dateEnd:YEAR_MAX })),
  ];
  for(const params of searches){
    const j = await metFetch(metSearchUrl(params));
    if(j && Array.isArray(j.objectIDs)) for(const id of j.objectIDs) ids.add(id);
    await sleep(300);
  }
  console.log(`[met] candidate object IDs: ${ids.size}`);
  const out = [];
  let i=0;
  for(const id of ids){
    i++; if(i%100===0) console.log(`[met] fetched ${i}/${ids.size}…`);
    const o = await metFetch(`${MET_API}/objects/${id}`);
    await sleep(120);
    if(!o) continue;
    if(!o.isPublicDomain) continue;
    const image = String(o.primaryImage||"").trim();
    if(!image) continue;
    // classification / medium must look like a sculpture (drop furniture, ceramics-as-tableware, prints, etc.)
    const medium = simplifyMedium(o.medium||"");
    const cls = String(o.classification||"").toLowerCase();
    const looksSculpture = /sculptur|statu|relief|bust|bronze|marble|figure|medal|plaquette/.test(cls)
      || /sculptur|statu|relief|bust|figure/.test(String(o.objectName||"").toLowerCase());
    if(!isSculptMedium(medium)) continue;
    if(!looksSculpture && o.department!=="European Sculpture and Decorative Arts") continue;
    const begin=Number(o.objectBeginDate), end=Number(o.objectEndDate);
    let y = (Number.isFinite(begin)&&Number.isFinite(end)) ? Math.round((begin+end)/2)
          : Number.isFinite(begin) ? begin : Number.isFinite(end) ? end : null;
    if(!inRange(y)) continue;
    const artist = normalizeArtist(o.artistDisplayName||"");
    const place = canonicalizePlace(
      (typeof o.country==="string"&&o.country.trim() ? o.country.trim() : "")
      || placeFromCulture(o.culture) || placeFromArtist(artist) );
    const [lat,lng] = geoFor(place);
    out.push({
      id:`met${o.objectID}`, title:o.title||"", artist, y, place,
      region:continentOf(place)||"", lat, lng, medium,
      style:"", styleKind:"", img:image, src:"met",
      sitelinks:0, fameHint:o.isHighlight?2:(o.isTimelineWork?1:0),
    });
  }
  console.log(`[met] kept ${out.length} PD Renaissance sculptures`);
  return out;
}

// ============================================================ WIKIDATA ============================================
async function sparql(query, attempt=1){
  const u = `${SPARQL}?format=json&query=${encodeURIComponent(query)}`;
  try{
    const r = await fetch(u, { headers:{ "User-Agent":UA, "Accept":"application/sparql-results+json" } });
    if((r.status===429||r.status>=500) && attempt<=6){ await sleep(3000*attempt); return sparql(query,attempt+1); }
    if(!r.ok){ console.error("[wd] sparql HTTP",r.status); return null; }
    return await r.json();
  }catch(e){ if(attempt<=6){ await sleep(2000*attempt); return sparql(query,attempt+1); } console.error("[wd] sparql failed",e.message); return null; }
}
// sculptures (P31/P279* Q860861) that are EITHER movement Renaissance (Q4692) OR by a Renaissance sculptor
// (creator's movement Renaissance), inception 1400–1600, with a Commons image (P18).
const WD_QUERY = `SELECT ?i (SAMPLE(?img) AS ?image) (SAMPLE(?t) AS ?title) (SAMPLE(?inc) AS ?year)
  (SAMPLE(?creatorL) AS ?creator) (SAMPLE(?countryL) AS ?country) (SAMPLE(?matL) AS ?material)
  (SAMPLE(?movL) AS ?movement) (SAMPLE(?czL) AS ?citizenship) (MAX(?sl) AS ?sitelinks) WHERE {
  ?i wdt:P31/wdt:P279* wd:Q860861 ;
     wdt:P18 ?img ;
     wdt:P571 ?inc ;
     wikibase:sitelinks ?sl .
  FILTER(YEAR(?inc) >= ${YEAR_MIN} && YEAR(?inc) <= ${YEAR_MAX})
  { ?i wdt:P135 wd:Q4692 } UNION { ?i wdt:P170 ?cr0 . ?cr0 wdt:P135 wd:Q4692 }
  OPTIONAL { ?i rdfs:label ?t.       FILTER(LANG(?t)="en") }
  OPTIONAL { ?i wdt:P170 ?cr. ?cr rdfs:label ?creatorL. FILTER(LANG(?creatorL)="en") }
  OPTIONAL { ?i wdt:P495 ?c. ?c rdfs:label ?countryL.   FILTER(LANG(?countryL)="en") }
  OPTIONAL { ?i wdt:P170 ?cr2. ?cr2 wdt:P27 ?cz. ?cz rdfs:label ?czL. FILTER(LANG(?czL)="en") }
  OPTIONAL { ?i wdt:P186 ?m. ?m rdfs:label ?matL.       FILTER(LANG(?matL)="en") }
  OPTIONAL { ?i wdt:P135 ?mv. ?mv rdfs:label ?movL.     FILTER(LANG(?movL)="en") }
} GROUP BY ?i LIMIT 1500`;

async function wdHarvest(){
  const j = await sparql(WD_QUERY);
  if(!j || !j.results){ console.error("[wd] no results (API unreachable?)"); return []; }
  const rows = j.results.bindings;
  console.log(`[wd] raw rows: ${rows.length}`);
  const out = [];
  for(const b of rows){
    const q = b.i.value.match(/Q\d+/)[0];
    const title = b.title ? b.title.value : null; if(!title) continue;
    const y = b.year ? yr(b.year.value) : null; if(!inRange(y)) continue;
    const medium = simplifyMedium(b.material ? b.material.value : "");
    if(!isSculptMedium(medium)) continue;
    const file = decodeURIComponent(b.image.value.split("/").pop());
    const wdArtist = b.creator ? normalizeArtist(b.creator.value) : "";
    const place = canonicalizePlace(
      (b.country ? b.country.value : "")
      || placeFromCulture(b.citizenship ? b.citizenship.value : "")
      || placeFromArtist(wdArtist) );
    const [lat,lng] = geoFor(place);
    const movement = b.movement ? b.movement.value : "";
    out.push({
      id:`wikidata:${q}`, wikidataid:q, title,
      artist: wdArtist, y,
      place, region:continentOf(place)||"", lat, lng, medium,
      style: movement || "Renaissance", styleKind:"movement",
      img:`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=900`,
      src:"wikidata", sitelinks: b.sitelinks ? parseInt(b.sitelinks.value,10) : 0,
    });
  }
  console.log(`[wd] kept ${out.length} sculptures`);
  return out;
}

// ============================================================ MAIN ================================================
function canonStyleRecord(w){
  // Met records: tag style "Renaissance" by default for these date-bounded European sculptures, then canonicalize.
  let style = w.style || (w.src==="met" ? "Renaissance" : "");
  style = canonicalizeStyle(style);
  return { ...w, style, styleKind: style ? (w.styleKind||"movement") : "" };
}

async function main(){
  console.log("=== Renaissance sculpture harvest (1400–1600) — STAGING ONLY ===");
  let met=[], wd=[];
  try { met = await metHarvest(); } catch(e){ console.error("[met] harvest error:", e.message); }
  try { wd  = await wdHarvest();  } catch(e){ console.error("[wd] harvest error:", e.message); }

  // merge + dedup: by id, then by Wikidata Q (cross-source). Met has no Q so only id-dedups against itself.
  const seenId = new Set(), seenQ = new Set();
  const merged = [];
  let dupId=0, dupQ=0, droppedCopyright=0;
  for(const raw of [...wd, ...met]){            // WD first so a Q-bearing record wins; Met fills the rest
    const w = canonStyleRecord(raw);
    if(isInCopyright(w.artist)){ droppedCopyright++; continue; }  // belt-and-suspenders (creators are 1400s anyway)
    if(seenId.has(w.id)){ dupId++; continue; }
    const q = w.wikidataid || (String(w.id).match(/Q\d+/)||[])[0];
    if(q && seenQ.has(q)){ dupQ++; continue; }
    seenId.add(w.id); if(q) seenQ.add(q);
    merged.push(w);
  }

  await mkdir("data/incoming", { recursive: true });
  await writeFile(OUT, JSON.stringify(merged, null, 1) + "\n");

  // ---- report ----
  const bySrc = {}, byMed = {}, byReg = {};
  for(const w of merged){ bySrc[w.src]=(bySrc[w.src]||0)+1; byMed[w.medium||"(none)"]=(byMed[w.medium||"(none)"]||0)+1; byReg[w.region||"(none)"]=(byReg[w.region||"(none)"]||0)+1; }
  const noPlace = merged.filter(w=>!w.place).length, noYear = merged.filter(w=>w.y==null).length, noArtist = merged.filter(w=>!w.artist).length;
  console.log(`\n=== STAGED ${merged.length} works → ${OUT} ===`);
  console.log("source:", bySrc);
  console.log("medium:", byMed);
  console.log("region:", byReg);
  console.log(`dedup: dropped ${dupId} by-id, ${dupQ} by-Q | copyright-dropped ${droppedCopyright}`);
  console.log(`quality: ${noPlace} no-place, ${noYear} no-year, ${noArtist} no-artist`);
  console.log("\nNOTHING PROMOTED, NOTHING COMMITTED — review data/incoming/ren-sculpture.json before promotion.");
}
main().catch(e=>{ console.error(e); process.exitCode=1; });
