// Country-level coord fixer: for works whose coords fall OUTSIDE their named country (the holding-museum
// class — a French work sitting at Amsterdam/Rijksmuseum, an Italian one at Paris/Louvre), re-geocode the
// place string and apply the new point ONLY if it lands inside/near the correct country (never introduce a
// worse location). Reads the detector report's coords-outside-country list. NETWORK (Nominatim).
//   node scripts/fix-country-coords.mjs            (dry)
//   node scripts/fix-country-coords.mjs --apply
import { readFileSync, writeFileSync } from "node:fs";
import { readGlobal, writeAssignment } from "./lib/static-module.mjs";

const APPLY = process.argv.includes("--apply");
const UA = "GessoCountryCoords/1.0 (kathryn.swint@gmail.com)";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pool = readGlobal("data/pool.js", "ARTEFACTUM_POOL");
const countries = readGlobal("data/countries.js", "ARTEFACTUM_COUNTRIES") || [];
const CO = {}; for (const c of countries) CO[c.n.toLowerCase()] = c;
// inline alias (same as detectors/index.html) — avoid a file dependency
const A = { "united states":"united states of america","usa":"united states of america","america":"united states of america","korea":"south korea","dr congo":"dem. rep. congo","ivory coast":"côte d'ivoire","cote d'ivoire":"côte d'ivoire","ottoman empire":"turkey","byzantine empire":"turkey","constantinople":"turkey","bohemia":"czechia","persia":"iran","england":"united kingdom","scotland":"united kingdom","wales":"united kingdom","britain":"united kingdom","flanders":"belgium","southern netherlands":"belgium","spanish netherlands":"belgium","burgundian netherlands":"belgium","prussia":"germany","bavaria":"germany","saxony":"germany" };
function placeCountry(place){ const raw=String(place||"").replace(/\([^)]*\)/g," ").toLowerCase();
  for(let seg of raw.split(/[,/]/)){ seg=seg.trim().replace(/^attributed to\s+/,""); if(!seg) continue; const a=A[seg]||seg; if(CO[a]) return CO[a]; } return null; }
const ptInRing=(x,y,r)=>{let ins=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const xi=r[i][0],yi=r[i][1],xj=r[j][0],yj=r[j][1];if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi))ins=!ins;}return ins;};
const ptIn=(lat,lng,c)=>{if(!c)return false;const[mnx,mny,mxx,mxy]=c.b;if(lng<mnx||lng>mxx||lat<mny||lat>mxy)return false;for(const r of c.r)if(ptInRing(lng,lat,r))return true;return false;};
const near=(lat,lng,c,g=60)=>{if(ptIn(lat,lng,c))return true;const cos=Math.cos(lat*Math.PI/180);for(const r of c.r)for(const[x,y]of r)if(Math.hypot((x-lng)*cos,(y-lat))*111<=g)return true;return false;};

function geoQuery(place){ const m=String(place).match(/^(.+?)\s*\((.+)\)\s*$/); const base=m?`${m[2].trim()}, ${m[1].trim()}`:String(place).trim();
  return base.replace(/\s*\/\s*/g, ", "); } // "Greece / Rome" → "Greece, Rome"
async function geocode(place){ const url=`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(geoQuery(place))}`;
  try{ const r=await fetch(url,{headers:{"User-Agent":UA}}); if(!r.ok)return null; const j=await r.json(); return j[0]?{lat:+j[0].lat,lng:+j[0].lon}:null; }catch{ return null; } }

const report = JSON.parse(readFileSync("data/incoming/detector-report.json","utf8"));
const targets = (report["coords-outside-country"]||[]).map(f => pool.find(p=>p.id===f.id)).filter(Boolean);
console.log(`coords-outside-country: ${targets.length}${APPLY?"":" (DRY)"}`);
const out = { fixed: [], skipped: [] };
for(let i=0;i<targets.length;i++){
  const p = targets[i]; const c = placeCountry(p.place);
  if(!c){ out.skipped.push({id:p.id,title:p.title,why:"no country"}); continue; }
  const g = await geocode(p.place);
  if(g && near(g.lat,g.lng,c)){ out.fixed.push({id:p.id,title:p.title,place:p.place,from:[p.lat,p.lng],to:[+g.lat.toFixed(4),+g.lng.toFixed(4)]}); p.lat=+g.lat.toFixed(4); p.lng=+g.lng.toFixed(4); }
  else out.skipped.push({id:p.id,title:p.title,place:p.place,why:g?"geocode still outside country":"geocode failed"});
  if((i+1)%20===0) console.error(`  ${i+1}/${targets.length}`);
  await sleep(1100); // Nominatim 1 req/sec
}
console.log(`fixed: ${out.fixed.length} | skipped: ${out.skipped.length}`);
writeFileSync("data/incoming/country-coords-report.json", JSON.stringify(out,null,1));
if(APPLY && out.fixed.length){ writeAssignment("data/pool.js","ARTEFACTUM_POOL",pool); console.log("wrote data/pool.js — run the gate as its own step."); }
else if(!APPLY) console.log("DRY — pass --apply to write. report → data/incoming/country-coords-report.json");
