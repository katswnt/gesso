// Fix the "map dot sits on the holding museum, not where the work was made" bug class.
//
// ~101 pool works have lat/lng on a DIFFERENT CONTINENT than their `place` text names
// (African works plotted in Paris = Quai Branly; Russian/French works plotted in the US).
// The `place` string is correct; the coordinates were taken from the holding institution.
// This re-geocodes each mismatched work's `place` text (OpenStreetMap Nominatim) and, only
// if the geocoded point lands on the CONTINENT the place names (sanity gate — never introduce
// a new wrong location), overwrites lat/lng. Falls back to the named country's bbox centroid.
//
//   node scripts/fix-place-coords.mjs            # apply
//   DRY_RUN=1 node scripts/fix-place-coords.mjs  # report only
//
// NETWORK required (Nominatim). Idempotent. After applying, run the gate as its own step.
import { readGlobal, writeAssignment } from "./lib/static-module.mjs";
import { continentOf } from "./lib/places.mjs";
import { writeFileSync } from "node:fs";

const DRY = !!process.env.DRY_RUN;
const UA = "Gesso/1.0 (art-history game; coord repair; kathryn.swint@gmail.com)";
const sleep = ms => new Promise(r => setTimeout(r, ms));

const pool = readGlobal("data/pool.js", "ARTEFACTUM_POOL");
const countries = readGlobal("data/countries.js", "ARTEFACTUM_COUNTRIES");
const inBox = (lat, lng, b) => lng >= b[0] && lat >= b[1] && lng <= b[2] && lat <= b[3];
// ray-casting point-in-polygon over a ring of [lng,lat] points
const pip = (lng, lat, ring) => { let inside=false; for(let i=0,j=ring.length-1;i<ring.length;j=i++){ const xi=ring[i][0],yi=ring[i][1],xj=ring[j][0],yj=ring[j][1]; if(((yi>lat)!==(yj>lat)) && (lng < (xj-xi)*(lat-yi)/(yj-yi)+xi)) inside=!inside; } return inside; };
// accurate country lookup: bbox prefilter, then true polygon containment (bboxes overlap; polygons don't)
const coordCountry = (lat, lng) => { for(const c of countries){ if(!inBox(lat,lng,c.b)) continue; if(Array.isArray(c.r) && c.r.some(ring => pip(lng,lat,ring))) return c.n; } return null; };
const contOfCoord = (lat, lng) => { const c = coordCountry(lat, lng); return c ? continentOf(c) : null; };

// "England (London)" → "London, England"; "Nigeria, Benin Kingdom" → "Nigeria, Benin Kingdom"; else as-is.
function geoQuery(place){
  const m = String(place).match(/^(.+?)\s*\((.+)\)\s*$/);
  return m ? `${m[2].trim()}, ${m[1].trim()}` : String(place).trim();
}
async function geocode(place){
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(geoQuery(place))}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if(!res.ok) return null;
  const j = await res.json();
  if(!Array.isArray(j) || !j[0]) return null;
  return { lat: +j[0].lat, lng: +j[0].lon };
}
// centroid of the named country's bbox, if we can match a country name inside the place string
function countryCentroid(place){
  const t = String(place).toLowerCase();
  for(const c of countries){ if(t.includes(c.n.toLowerCase())){ const [x0,y0,x1,y1]=c.b; return { lat:(y0+y1)/2, lng:(x0+x1)/2 }; } }
  return null;
}

// Two candidate sets, both about coords on the wrong continent:
//  1. place text is recognized → we KNOW the intended continent; fix if coords sit elsewhere.
//  2. place text is unrecognized (e.g. "England (London)") → no declared continent, so instead
//     geocode and replace ONLY when the geocoded continent differs from where the coords currently sit.
const hasCoord = p => typeof p.lat==="number" && typeof p.lng==="number" && p.place;
const targets1 = pool.filter(p => { if(!hasCoord(p)) return false; const dc=continentOf(p.place); if(!dc||dc==="Unknown") return false; const cc=contOfCoord(p.lat,p.lng); if(!cc||cc==="Unknown") return false; return dc!==cc; });
const targets2 = pool.filter(p => { if(!hasCoord(p)) return false; const dc=continentOf(p.place); return !dc||dc==="Unknown"; });
const targets = [...targets1, ...targets2];
console.log(`recognized-place mismatches: ${targets1.length} · unrecognized-place checks: ${targets2.length}${DRY?" (DRY RUN)":""}`);

const report = { fixed: [], centroid: [], skipped: [], failed: [] };
for(let i=0;i<targets.length;i++){
  const p = targets[i];
  const declared = continentOf(p.place);
  const known = declared && declared!=="Unknown";
  const oldCont = contOfCoord(p.lat, p.lng); // where the coords currently sit
  try {
    const np = await geocode(p.place);
    const npCont = np ? contOfCoord(np.lat, np.lng) : null;
    // known place → accept if geocode lands on the declared continent.
    // unknown place → accept only if geocode is on a KNOWN continent that DIFFERS from the current coords
    //                 (so we never touch works whose odd place string already has correct coords).
    const accept = np && npCont && (known ? npCont===declared : (oldCont && npCont!==oldCont));
    if(accept){
      p.lat = +np.lat.toFixed(4); p.lng = +np.lng.toFixed(4);
      report.fixed.push({ id:p.id, place:p.place, lat:p.lat, lng:p.lng, title:p.title });
    } else if(known){
      const cen = countryCentroid(p.place);
      if(cen && contOfCoord(cen.lat,cen.lng)===declared){
        p.lat = +cen.lat.toFixed(4); p.lng = +cen.lng.toFixed(4);
        report.centroid.push({ id:p.id, place:p.place, lat:p.lat, lng:p.lng, title:p.title });
      } else report.skipped.push({ id:p.id, place:p.place, why:"no confident coord", title:p.title });
    } // unknown-place non-accepts are left silently (coords presumed already fine)
  } catch(e){ report.failed.push({ id:p.id, place:p.place, err:String(e.message).slice(0,100) }); }
  if((i+1)%20===0) console.log(`  ${i+1}/${targets.length} …`);
  await sleep(1100); // Nominatim usage policy: max 1 req/sec
}

console.log(`\ngeocoded: ${report.fixed.length} · centroid: ${report.centroid.length} · skipped: ${report.skipped.length} · failed: ${report.failed.length}`);
writeFileSync("data/incoming/place-coords-report.json", JSON.stringify(report, null, 2));
console.log("report → data/incoming/place-coords-report.json");
if(DRY){ console.log("DRY RUN — pool NOT written."); }
else if(report.fixed.length || report.centroid.length){
  writeAssignment("data/pool.js","ARTEFACTUM_POOL",pool);
  console.log("wrote data/pool.js — now run:  node scripts/check-pool.mjs  (as its own step)");
} else console.log("no changes.");
