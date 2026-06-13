// Build a diverse art pool from Wikidata (Western, movement-rich) + the Met
// Open Access API (global/non-Western). Run: node scripts/build-pool.mjs
// Output: data/pool.js  (window.ARTEFACTUM_POOL = [...])
import { writeFileSync, mkdirSync } from "node:fs";

const UA = "ArtefactumGame/0.3 (kathryn.swint@gmail.com)";
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchJSON(url, tries=4){
  for(let t=0;t<tries;t++){
    try{
      const r = await fetch(url, {headers:{Accept:"application/json","User-Agent":UA}});
      if(r.status===429 || r.status===403 || r.status>=500){ await sleep(500*(t+1)); continue; }
      const txt = await r.text();
      if(!txt) { await sleep(400*(t+1)); continue; }
      return JSON.parse(txt);
    }catch{ await sleep(400*(t+1)); }
  }
  return null;
}

// ---- shared helpers ----
function continentOf(lat, lng){
  if(lng>=-82&&lng<=-34&&lat<13&&lat>=-56) return "South America";
  if(lng>=-170&&lng<=-52&&lat>=13) return "North America";
  if(lng>=110&&lat<=-10) return "Oceania";
  if(lat>=36&&lng>=-25&&lng<=60) return "Europe";
  if(lat>=-35&&lat<36&&lng>=-20&&lng<=52) return "Africa";
  if(lng>40) return "Asia";
  return "Europe";
}
function mediumClass(s){
  if(!s) return "";
  s=s.toLowerCase();
  const has=w=>s.includes(w);
  if(has("woodblock")||has("woodcut")) return "Woodblock print";
  if(has("oil")) return "Oil paint";
  if(has("tempera")) return "Tempera";
  if(has("fresco")) return "Fresco";
  if(has("watercolor")||has("watercolour")||has("gouache")) return "Watercolor";
  if(has("ink")) return "Ink";
  if(has("bronze")) return "Bronze";
  if(has("marble")) return "Marble";
  if(has("jade")) return "Jade";
  if(has("gold")||has("gilt")) return "Gold";
  if(has("silver")) return "Silver";
  if(has("porcelain")||has("stoneware")||has("earthenware")||has("ceramic")||has("terracotta")||has("faience")) return "Ceramic";
  if(has("silk")||has("cotton")||has("wool")||has("textile")||has("tapestry")) return "Textile";
  if(has("wood")) return "Wood";
  if(has("limestone")||has("granite")||has("basalt")||has("sandstone")||has("stone")) return "Stone";
  if(has("ivory")) return "Ivory";
  if(has("glass")) return "Glass";
  if(has("paper")) return "Ink";
  if(has("canvas")) return "Oil paint";
  return "";
}
function cleanMov(m){return m?m.replace(/\s+painting$/i,'').replace(/\s+art$/i,'').trim():"";}

const CENTROIDS = [
  [/japan|ukiyo|kyoto|nara|heian|meiji|edo period/i, 35.68, 139.69, "Japan"],
  [/chin|qing|ming|tang|song dynasty|han dynasty|qianlong/i, 39.9, 116.4, "China"],
  [/korea|joseon|goryeo/i, 37.57, 126.98, "Korea"],
  [/tibet|nepal|himalaya|kathmandu/i, 27.7, 85.3, "Nepal / Tibet"],
  [/india|mughal|rajput|deccan|pala|chola|gandhara|jain|hindu/i, 28.6, 77.2, "India"],
  [/iran|persia|safavid|qajar|sasanian|achaemenid|isfahan|shiraz/i, 35.7, 51.4, "Iran"],
  [/edo peoples|nigeria|benin|yoruba|ife|igbo/i, 6.5, 3.38, "Nigeria"],
  [/turk|ottoman|anatolia|byzan|iznik/i, 41.0, 28.98, "Turkey"],
  [/syria|levant|damascus|palmyra/i, 33.5, 36.3, "Syria"],
  [/iraq|mesopotam|babylon|assyria|sumer|nimrud|akkad/i, 33.3, 44.4, "Iraq"],
  [/egypt|coptic|nubia|thebes|amarna/i, 30.0, 31.2, "Egypt"],
  [/greece|greek|minoan|cyclad|hellen|attic|corinth/i, 37.98, 23.73, "Greece"],
  [/rome|roman|etruscan|pompeii|latium/i, 41.9, 12.5, "Italy (Rome)"],
  [/mexic|aztec|maya|olmec|teotihuacan|zapotec|mixtec/i, 19.43, -99.13, "Mexico"],
  [/peru|inca|nazca|moche|chimu|wari|paracas/i, -12.05, -77.04, "Peru"],
  [/colombia|muisca|quimbaya/i, 4.7, -74.07, "Colombia"],
  [/mali|djenne|bamana|dogon/i, 12.65, -8.0, "Mali"],
  [/ghana|akan|asante|ashanti/i, 5.6, -0.19, "Ghana"],
  [/congo|kongo|kuba|luba/i, -4.32, 15.31, "DR Congo"],
  [/cameroon|grassland/i, 3.85, 11.5, "Cameroon"],
  [/ethiopia|aksum/i, 9.03, 38.74, "Ethiopia"],
  [/indonesia|java|bali|sumatra/i, -6.2, 106.8, "Indonesia"],
  [/thai|siam|ayutthaya/i, 13.75, 100.5, "Thailand"],
  [/cambodia|khmer|angkor/i, 11.55, 104.9, "Cambodia"],
  [/vietnam/i, 21.03, 105.85, "Vietnam"],
  [/myanmar|burma|bagan/i, 16.8, 96.15, "Myanmar"],
  [/sri lanka|ceylon/i, 6.93, 79.85, "Sri Lanka"],
  [/papua|new guinea|melanesia|sepik|asmat/i, -6.3, 143.95, "Papua New Guinea"],
  [/polynesia|hawaii|maori|samoa|tahiti|fiji|tonga/i, -17.7, -149.4, "Polynesia"],
  [/australia|aborigin/i, -25.0, 133.0, "Australia"],
  [/navajo|hopi|pueblo|sioux|inuit|tlingit|haida|native american/i, 38.9, -105.0, "North America (Indigenous)"],
];
function geocodeCulture(...fields){
  const s = fields.filter(Boolean).join(" ");
  for(const [re,lat,lng,label] of CENTROIDS) if(re.test(s)) return {lat,lng,place:label};
  return null;
}
// fallback geocode by Met department when culture text is unhelpful
const DEPT_GEO = {
  10:{lat:30.0,lng:31.2,place:"Egypt"},
  3:{lat:33.3,lng:44.4,place:"Mesopotamia"},
  13:{lat:41.9,lng:12.5,place:"Greece / Rome"},
};

function item(o){
  o.region = continentOf(o.lat, o.lng);
  o.style = o.movement || o.culture || "";
  o.styleKind = o.movement ? "movement" : (o.culture ? "culture" : "");
  o.cats = ["when","where"];
  if(o.medium) o.cats.push("medium");
  if(o.style) o.cats.push("style");
  if(o.artist) o.cats.push("artist"); // bonus
  return o;
}

// ---- Wikidata ----
async function fromWikidata(){
  const q = `SELECT ?item ?itemLabel ?creatorLabel (YEAR(?inception) AS ?yr) ?movementLabel ?materialLabel ?coord ?image ?s WHERE {
    VALUES ?type { wd:Q3305213 wd:Q11060274 wd:Q93184 wd:Q860861 }
    ?item wdt:P31 ?type; wdt:P18 ?image; wdt:P170 ?creator; wdt:P571 ?inception;
          wdt:P495 ?country; wikibase:sitelinks ?s.
    ?country wdt:P625 ?coord.
    OPTIONAL { ?item wdt:P135 ?movement. }
    OPTIONAL { ?item wdt:P186 ?material. }
    FILTER(?s>12)
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
  } ORDER BY DESC(?s) LIMIT 600`;
  const url = "https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(q);
  const data = await fetchJSON(url);
  const byId = new Map();
  for(const b of (data?.results?.bindings||[])){
    const g=k=>b[k]&&b[k].value;
    const id=g('item'), title=g('itemLabel'), artist=g('creatorLabel'), y=parseInt(g('yr'),10);
    const coord=g('coord'), img=g('image');
    if(!id||!title||!y||!coord||!img) continue;
    if(/^Q\d+$/.test(title)||/^Q\d+$/.test(artist||"")) continue;
    const mp=coord.match(/Point\(([-\d.]+) ([-\d.]+)\)/); if(!mp) continue;
    let it=byId.get(id);
    if(!it){
      it=item({id,title,artist:artist||"",y,lat:+mp[2],lng:+mp[1],
        movement:cleanMov(g('movementLabel')||""), medium:mediumClass(g('materialLabel')||""),
        culture:"", place:"", fame:parseInt(g('s'),10)||0, img:img.replace(/^http:/,'https:')+"?width=900", src:"wd"});
      byId.set(id,it);
    } else {
      if(!it.movement) it.movement=cleanMov(g('movementLabel')||"");
      if(!it.medium) it.medium=mediumClass(g('materialLabel')||"");
      item(it);
    }
  }
  return [...byId.values()];
}

// ---- The Met ----
const MET_DEPTS = [
  {id:6,  name:"Asian Art"},
  {id:14, name:"Islamic Art"},
  {id:5,  name:"Arts of Africa, Oceania, and the Americas"},
  {id:10, name:"Egyptian Art"},
  {id:3,  name:"Ancient Near Eastern Art"},
  {id:13, name:"Greek and Roman Art"},
];
const MET_QS = ["painting","figure","vessel","mask"];
const PER_DEPT = 42;

async function metSearchIds(deptId){
  const ids=new Set();
  for(const q of MET_QS){
    const u=`https://collectionapi.metmuseum.org/public/collection/v1/search?departmentId=${deptId}&hasImages=true&q=${encodeURIComponent(q)}`;
    const d=await fetchJSON(u);
    (d?.objectIDs||[]).slice(0,150).forEach(i=>ids.add(i));
    await sleep(150);
  }
  return [...ids];
}
async function metObject(id, deptId){
  const o = await fetchJSON(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`);
  if(!o || !o.isPublicDomain || !o.primaryImageSmall || !o.objectBeginDate) return null;
  const geo = geocodeCulture(o.culture, o.country, o.region, o.title) || DEPT_GEO[deptId];
  if(!geo) return null;
  const y=Math.round(((o.objectBeginDate||0)+(o.objectEndDate||o.objectBeginDate||0))/2);
  if(!y || y<-3000 || y>2025) return null;
  return item({
    id:"met"+o.objectID, title:o.title||o.classification||"Untitled",
    artist:(o.artistDisplayName||"").trim(), y, lat:geo.lat, lng:geo.lng, place:geo.place,
    movement:"", medium:mediumClass(o.medium), culture:(o.culture||geo.place||"").trim(),
    fame:8, img:o.primaryImageSmall, src:"met"
  });
}
async function pmap(arr, fn, conc=6){
  const out=[]; let i=0;
  async function worker(){ while(i<arr.length){ const idx=i++; out[idx]=await fn(arr[idx]); await sleep(60); } }
  await Promise.all(Array.from({length:conc}, worker));
  return out;
}
async function fromMet(){
  const all=[];
  for(const d of MET_DEPTS){
    const ids=await metSearchIds(d.id);
    const step=Math.max(1, Math.floor(ids.length / (PER_DEPT*3)));
    const sampled=ids.filter((_,k)=>k%step===0).slice(0, PER_DEPT*3);
    const objs=(await pmap(sampled, x=>metObject(x, d.id))).filter(Boolean);
    all.push(...objs.slice(0, PER_DEPT));
    console.error(`  Met ${d.name}: ${ids.length} ids -> ${objs.length} usable -> kept ${Math.min(objs.length,PER_DEPT)}`);
  }
  return all;
}

// ---- main ----
const wd = await fromWikidata();
console.error(`Wikidata: ${wd.length} works`);
const met = await fromMet();
console.error(`Met: ${met.length} works`);

const seen=new Set(), pool=[];
for(const it of [...wd, ...met]){
  const key=(it.title+"|"+it.artist).toLowerCase();
  if(seen.has(key)) continue; seen.add(key);
  delete it.movement; delete it.culture; // keep style/styleKind only
  pool.push(it);
}
const dist={};
for(const it of pool) dist[it.region]=(dist[it.region]||0)+1;
console.error("Region distribution:", dist, "TOTAL", pool.length);

mkdirSync("data",{recursive:true});
writeFileSync("data/pool.js", "window.ARTEFACTUM_POOL = "+JSON.stringify(pool)+";\n");
console.error("Wrote data/pool.js");
