// Oceania coverage harvest from the Met Open Access API (CC0). Dept 5 (Africa/Oceania/Americas) is
// combined, so we search Pacific terms, then keep only objects whose geography is genuinely Oceania AND
// isPublicDomain AND has an image. Origin place = the Met's `country` (where the work is FROM, not the
// museum). Culture -> guessable style. STAGES to data/incoming/oceania/candidates.json (no pool write).
//   node scripts/fetch-oceania.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const UA = "GessoOceania/1.0 (kathryn.swint@gmail.com)";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const API = "https://collectionapi.metmuseum.org/public/collection/v1";

// Pacific geography allowlist — an object counts as Oceania only if its country/region/culture hits one.
const PACIFIC = ["papua new guinea","new guinea","new zealand","aotearoa","fiji","vanuatu","new caledonia","solomon islands","hawaii","hawaiian","marquesas","tahiti","french polynesia","easter island","rapa nui","samoa","tonga","cook islands","micronesia","caroline islands","marshall islands","kiribati","palau","admiralty islands","new ireland","new britain","sepik","asmat","maori","polynesia","melanesia","micronesian","austral islands","society islands","bismarck","torres strait","aboriginal","australia"];
const isOceania = o => {
  const hay = [o.country, o.region, o.subregion, o.culture, o.geographyType, o.classification].filter(Boolean).join(" | ").toLowerCase();
  if (/africa|nigeria|benin|congo|mali|ghana|egypt|america|peru|mexico|maya|aztec|inca|andes|colombia|panama/.test(hay) && !/oceania|pacific/.test(hay)) {
    // dept-5 African/American object — exclude unless a Pacific term still appears
    if (!PACIFIC.some(t => hay.includes(t))) return false;
  }
  return PACIFIC.some(t => hay.includes(t));
};

const MED = { wood:"Wood", ivory:"Ivory", shell:"Shell", stone:"Stone", jade:"Jade", clay:"Ceramic", ceramic:"Ceramic", terracotta:"Ceramic", bronze:"Bronze", gold:"Gold", silver:"Silver", fiber:"Textile", bark:"Textile", tapa:"Textile", feather:"Textile", textile:"Textile", cotton:"Textile" };
const medBucket = m => { const s = (m||"").toLowerCase(); for (const k in MED) if (s.includes(k)) return MED[k]; return "Wood"; };
// rough centroids for placing the map pin by origin country
const COORD = { "papua new guinea":[-6,147], "new guinea":[-5,141], "new zealand":[-41,174], "fiji":[-17,178], "vanuatu":[-16,168], "new caledonia":[-21,165], "solomon islands":[-9,160], "hawaii":[20,-157], "marquesas":[-9,-139], "french polynesia":[-17,-149], "easter island":[-27,-109], "samoa":[-14,-172], "tonga":[-21,-175], "micronesia":[7,150], "palau":[7,134], "australia":[-25,133], "cook islands":[-21,-159], "kiribati":[1,173], "marshall islands":[7,171] };
const placeCoord = country => { const c = (country||"").toLowerCase(); for (const k in COORD) if (c.includes(k)) return { place: country || "Oceania", lat: COORD[k][0], lng: COORD[k][1] }; return { place: country || "Oceania", lat: -15, lng: 160 }; };

const w = {}; new Function("window", readFileSync("data/pool.js", "utf8"))(w);
const POOL = w.ARTEFACTUM_POOL || [];
const haveMet = new Set(POOL.map(p => p.id));
const haveImg = new Set(POOL.map(p => p.img));

const terms = ["Oceania","Maori","Papua New Guinea","Asmat","Sepik","Fiji","Hawaii","Marquesas","Easter Island","New Zealand","Vanuatu","Solomon Islands","New Caledonia","Polynesia","Melanesia","Samoa","Tonga","Micronesia","New Ireland","New Britain","Aboriginal Australia"];
const ids = new Set();
for (const t of terms) {
  try { const r = await fetch(`${API}/search?departmentId=5&hasImages=true&q=${encodeURIComponent(t)}`, { headers: { "User-Agent": UA } });
    const j = await r.json(); (j.objectIDs || []).forEach(id => ids.add(id)); } catch {}
  await sleep(120);
}
console.log(`fetching ${ids.size} dept-5 imaged objects...`);

const cand = []; let seen = 0, pd = 0, oc = 0;
for (const id of ids) {
  seen++;
  try {
    const r = await fetch(`${API}/objects/${id}`, { headers: { "User-Agent": UA } });
    if (!r.ok) { await sleep(70); continue; }
    const o = await r.json();
    if (!o.isPublicDomain) { await sleep(70); continue; } pd++;
    const img = o.primaryImage || o.primaryImageSmall; if (!img) { await sleep(70); continue; }
    if (!isOceania(o)) { await sleep(70); continue; } oc++;
    const metId = "met" + id;
    if (haveMet.has(metId) || haveImg.has(img)) { await sleep(70); continue; }
    const y = o.objectBeginDate != null && o.objectEndDate != null ? Math.round((o.objectBeginDate + o.objectEndDate) / 2) : (o.objectBeginDate ?? null);
    const { place, lat, lng } = placeCoord(o.country);
    const culture = (o.culture || "").replace(/,.*$/, "").trim() || (o.classification || "Oceanic art");
    cand.push({ id: metId, title: (o.title || o.objectName || "Untitled").slice(0, 90), artist: "", y, lat, lng, place, region: "Oceania",
      style: culture, styleKind: "culture", medium: medBucket(o.medium), img, src: "met",
      museum: "Metropolitan Museum of Art", dim: (o.dimensions || "").slice(0, 60), _rawCountry: o.country, _rawCulture: o.culture, _classification: o.classification });
    if (cand.length % 25 === 0) console.log(`  ${seen}/${ids.size} scanned · ${pd} PD · ${oc} Oceania · ${cand.length} new candidates`);
  } catch {}
  await sleep(70);
}
mkdirSync("data/incoming/oceania", { recursive: true });
writeFileSync("data/incoming/oceania/candidates.json", JSON.stringify(cand, null, 1));
console.log(`\nDONE: scanned ${seen} · ${pd} public-domain · ${oc} genuinely-Oceania · ${cand.length} NEW (deduped) candidates -> data/incoming/oceania/candidates.json`);
