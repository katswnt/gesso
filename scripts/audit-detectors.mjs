// Bug-detector suite: turns each bug CLASS we've hit into a deterministic scan, so we find them all at once
// instead of one-at-a-time by playing. Prints a count dashboard + writes details to
// data/incoming/detector-report.json. LOCAL by default; `--images` adds the networked low-res check.
//   node scripts/audit-detectors.mjs           (local detectors)
//   node scripts/audit-detectors.mjs --images   (also flag Commons images under MINPX)
import { readFileSync, writeFileSync } from "node:fs";
import { readGlobal } from "./lib/static-module.mjs";
import { continentOf } from "./lib/places.mjs";

const pool = readGlobal("data/pool.js", "ARTEFACTUM_POOL");
const countries = readGlobal("data/countries.js", "ARTEFACTUM_COUNTRIES") || [];
const CO = {}; for (const c of countries) CO[c.n.toLowerCase()] = c;

// --- country resolution (mirrors the fixed index.html placeCountry) ---
const ALIAS = { "united states":"united states of america","usa":"united states of america","u.s.":"united states of america","america":"united states of america","korea":"south korea","dr congo":"dem. rep. congo","democratic republic of the congo":"dem. rep. congo","ivory coast":"côte d'ivoire","cote d'ivoire":"côte d'ivoire","türkiye":"turkey","ottoman empire":"turkey","byzantine empire":"turkey","constantinople":"turkey","czech republic":"czechia","bohemia":"czechia","russia (soviet)":"russia","soviet union":"russia","ussr":"russia","persia":"iran","england":"united kingdom","scotland":"united kingdom","wales":"united kingdom","northern ireland":"united kingdom","britain":"united kingdom","great britain":"united kingdom","uk":"united kingdom","u.k.":"united kingdom","flanders":"belgium","southern netherlands":"belgium","spanish netherlands":"belgium","austrian netherlands":"belgium","burgundian netherlands":"belgium","flemish region":"belgium","prussia":"germany","bavaria":"germany","saxony":"germany","holy roman empire":"germany","russian empire":"russia","austria-hungary":"austria","austria–hungary":"austria","ottoman turkey":"turkey","dutch republic":"netherlands","low countries":"netherlands","roman empire":"italy","roman republic":"italy","venice":"italy","lombardy":"italy","tuscany":"italy","naples":"italy","sicily":"italy","duchy of brabant":"belgium","indus valley":"pakistan","gandhara":"pakistan","gandhara region":"pakistan","asia minor":"turkey","bukhara":"uzbekistan","central iran":"iran","southwestern iran":"iran","tibet":"china","central tibet":"china","hejaz":"saudi arabia","crete":"greece","apulia":"italy","lucania":"italy","south italy":"italy" };
function placeCountry(place){ const s0=String(place||"");
  const pd=s0.match(/\((?:present[- ]day|modern|now|today)\s+([^)]+)\)/i);
  const hit=x=>{x=String(x).trim().replace(/^attributed to\s+/,"").toLowerCase();const a=ALIAS[x]||x;return CO[a]||null;};
  if(pd){for(const seg of pd[1].split(/[,/;]/)){const h=hit(seg);if(h)return h;}}
  const raw=s0.replace(/\([^)]*\)/g," ").toLowerCase();
  for(let seg of raw.split(/[,/;]/)){ seg=seg.trim().replace(/^attributed to\s+/,""); if(!seg) continue; const a=ALIAS[seg]||seg; if(CO[a]) return CO[a]; }
  for(const m of s0.matchAll(/\(([^)]+)\)/g)){ for(const seg of m[1].split(/[,/;]/)){ const h=hit(seg); if(h) return h; } } return null; }
const ptInRing=(x,y,r)=>{let ins=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const xi=r[i][0],yi=r[i][1],xj=r[j][0],yj=r[j][1];if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi))ins=!ins;}return ins;};
const ptInCountry=(lat,lng,c)=>{if(!c)return false;const[mnx,mny,mxx,mxy]=c.b;if(lng<mnx||lng>mxx||lat<mny||lat>mxy)return false;for(const r of c.r)if(ptInRing(lng,lat,r))return true;return false;};
const nearCountry=(lat,lng,c,grace=60)=>{if(ptInCountry(lat,lng,c))return true;const cos=Math.cos(lat*Math.PI/180);for(const r of c.r)for(const[x,y]of r){if(Math.hypot((x-lng)*cos,(y-lat))*111<=grace)return true;}return false;};

const anon = a => !a || /unknown|anonymous|unidentified|artist|culture|maker|undetermined|workshop/i.test(a);
const STYLED = new Set(["culture","movement","period","school","tradition","genre"]);
const report = {};
const flag = (k, o) => (report[k] = report[k] || []).push(o);

// overseas territories that legitimately sit far outside their parent country's mainland polygon
const TERRITORIES = [
  { re: /tahiti|french polynesia/i, lat: -17.65, lng: -149.45, km: 500 },
  { re: /rapa nui|easter island/i, lat: -27.12, lng: -109.35, km: 250 },
];

for (const p of pool) {
  const playable = p.play !== false && p.sensitive !== "remains";

  // 1. coords sit outside the named country (holding-museum / centroid mislocation). EXCEPT overseas territories,
  //    which legitimately sit far outside the parent country's mainland polygon (Tahiti→France, Easter Island→Chile) —
  //    when the place names such a territory and the coords are near its real point, the coords are correct, not a bug.
  if (playable && p.place && typeof p.lat === "number" && typeof p.lng === "number") {
    const c = placeCountry(p.place);
    if (c && !nearCountry(p.lat, p.lng, c)) {
      const cos = Math.cos(p.lat * Math.PI / 180);
      const inTerritory = TERRITORIES.some(t => t.re.test(p.place) && Math.hypot((p.lng - t.lng) * cos, (p.lat - t.lat)) * 111 <= t.km);
      if (!inTerritory) flag("coords-outside-country", { id: p.id, title: p.title, place: p.place, lat: p.lat, lng: p.lng, country: c.n });
    }
  }
  // 2. place can't resolve to a country → loose 360km "right country" scoring (the England/Paris bug)
  if (playable && p.place && !placeCountry(p.place)) flag("place-unresolvable", { id: p.id, title: p.title, place: p.place });
  // 3. region doesn't match the place's continent
  if (playable && p.place) { const cont = continentOf(p.place); if (cont && cont !== "Unknown" && p.region && p.region !== cont) flag("region-vs-place", { id: p.id, title: p.title, place: p.place, region: p.region, expect: cont }); }
  // 4. style set but styleKind empty/invalid → shows in reveal but never scores (the Skater)
  if (p.style && String(p.style).trim() && !STYLED.has(p.styleKind)) flag("style-not-scored", { id: p.id, title: p.title, style: p.style, styleKind: p.styleKind || "" });
  // 5. non-Western + anonymous + no culture/movement → blank scored category (the Vanuatu stone)
  if (playable && ["Africa","Oceania","South America"].includes(p.region) && anon(p.artist) && !(p.style && String(p.style).trim())) flag("culture-gap", { id: p.id, title: p.title, place: p.place, region: p.region });
  // 6. scores the ARTIST category but the artist field is blank (the Mona Lisa / Poussin class)
  if (Array.isArray(p.cats) && p.cats.includes("artist") && (!p.artist || !String(p.artist).trim())) flag("blank-artist-scored", { id: p.id, title: p.title });
  // 7. date is null/absent but the work is scheduled-eligible
  if (playable && (p.y == null || p.y === "") && Array.isArray(p.cats) && p.cats.includes("when")) flag("no-date-scored", { id: p.id, title: p.title });
}

// 8. artist ABBREVIATION variants: one artist's token-set ⊂ another's (Hokusai ⊂ Katsushika Hokusai)
{ const skip=/\b(artist|artists|painter|group|master|workshop|atelier|follower|circle|manner|attributed|imitator|unidentified|unknown|anonymous|undetermined|formerly|the|of|de|del|di|van|von|da)\b/i;
  const toks=s=>new Set(String(s).normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z ]/g,"").split(/\s+/).filter(w=>w.length>2));
  const names=[...new Set(pool.map(p=>p.artist).filter(a=>a&&!skip.test(a)))].map(a=>({a,t:toks(a)})).filter(x=>x.t.size>=2); // require 2+ tokens to cut same-surname noise
  // known DISTINCT artists whose token-set happens to subset (not abbreviations — different people)
  const DISTINCT = new Set(["William Morris|William Morris Hunt","Utagawa Kunisada I|Utagawa Kunisada III","John F. Francis|John Francis Murphy"]);
  for(const A of names)for(const B of names){ if(A.a===B.a)continue; if(A.t.size<B.t.size && [...A.t].every(w=>B.t.has(w)) && !DISTINCT.has(A.a+"|"+B.a)) flag("artist-abbrev", { short:A.a, long:B.a }); } }

// 10. NON-ARTWORK ENTITY tell: a scheduled work whose title is itself a country/place (a Wikidata place or
//     monument entity that slipped into the artwork pool with an inflated fame score), or whose title exactly
//     equals its own place field. Such an entity scores every category off something that isn't an artwork.
{ const countryNames = new Set(Object.keys(CO));
  for (const p of pool) { if (p.play === false || p.sensitive === "remains") continue;
    const t = String(p.title || "").trim(), tl = t.toLowerCase();
    const isCountry = countryNames.has(ALIAS[tl] || tl);
    const titleIsPlace = t && p.place && tl === String(p.place).trim().toLowerCase();
    // require the OTHER non-artwork tells too — a real artwork can be *titled* after a place (Exter's "Venice"),
    // so only flag when it's also anonymous AND carries no artistic medium/style (i.e. a bare place entity).
    const thin = anon(p.artist) && !(p.medium && String(p.medium).trim()) && !(p.style && String(p.style).trim());
    if ((isCountry || titleIsPlace) && thin) flag("non-artwork-entity", { id: p.id, title: t, place: p.place || "", fame: p.fame || 0 }); } }

// 9 (optional, networked): Commons images under MINPX on the long side → too low-res
if (process.argv.includes("--images")) {
  const MINPX = 800; const UA = "GessoDetectors/1.0 (kathryn.swint@gmail.com)";
  const commons = pool.filter(p => p.play !== false && /commons\.wikimedia\.org.*FilePath\//.test(p.img || ""));
  console.error(`checking resolution of ${commons.length} Commons images (--images)…`);
  const fileOf = u => decodeURIComponent(String(u).split("FilePath/")[1].split("?")[0]);
  for (let i = 0; i < commons.length; i++) {
    const p = commons[i]; const f = fileOf(p.img);
    try { const j = await (await fetch(`https://commons.wikimedia.org/w/api.php?action=query&titles=File:${encodeURIComponent(f)}&prop=imageinfo&iiprop=size&format=json`, { headers: { "User-Agent": UA } })).json();
      const ii = Object.values(j.query.pages)[0]?.imageinfo?.[0];
      if (ii && Math.max(ii.width, ii.height) < MINPX) flag("low-res-image", { id: p.id, title: p.title, px: `${ii.width}x${ii.height}` });
    } catch {}
    if ((i+1) % 200 === 0) console.error(`  ${i+1}/${commons.length}`);
    await new Promise(r => setTimeout(r, 30));
  }
}

// --- dashboard ---
const order = ["coords-outside-country","place-unresolvable","region-vs-place","style-not-scored","culture-gap","blank-artist-scored","no-date-scored","artist-abbrev","non-artwork-entity","low-res-image"];
console.log("\n===== BUG DETECTOR DASHBOARD =====");
let total = 0;
for (const k of order) { const n = (report[k]||[]).length; total += n; console.log(`  ${String(n).padStart(4)}  ${k}`); }
console.log(`  ${String(total).padStart(4)}  TOTAL flags`);
writeFileSync("data/incoming/detector-report.json", JSON.stringify(report, null, 1));
console.log("\nfull details → data/incoming/detector-report.json");
