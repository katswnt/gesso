// Consolidate data/incoming/*.json museum pulls into merge-ready candidates.
// Normalize -> geocode -> region -> dedup (within + vs current pool). DRY RUN by default:
// writes data/incoming/_candidates.json + prints a report. Pass --merge to append into data/pool.js.
// Run: node scripts/consolidate.mjs   |   node scripts/consolidate.mjs --merge
import { readFileSync, writeFileSync } from "node:fs";

const MERGE = process.argv.includes("--merge");
const SRCS = ["wd-culture","wd-africa","wd-museums","modern","wikidata-extra","met-extra","cleveland","harvard","va","smithsonian","aic"]; // priority order for dedup keep

// ---- helpers copied from build-pool.mjs (kept in sync) ----
function continentOf(lat,lng){
  if(lng>=-82&&lng<=-34&&lat<13&&lat>=-56) return "South America";
  if(lng>=-170&&lng<=-52&&lat>=13) return "North America";
  if(lng>=110&&lat<=-10) return "Oceania";
  if(lng>34.5&&lat<42&&lat>=12) return "Asia";
  if(lat>=36&&lng>=-25&&lng<=60) return "Europe";
  if(lat>=-35&&lat<36&&lng>=-20&&lng<=52) return "Africa";
  if(lng>40) return "Asia";
  return "Europe";
}
function mediumClass(s){ if(!s) return ""; s=String(s).toLowerCase(); const has=w=>s.includes(w);
  if(has("woodblock")||has("woodcut")) return "Woodblock print";
  if(has("oil")) return "Oil paint"; if(has("tempera")) return "Tempera"; if(has("fresco")) return "Fresco";
  if(has("watercolor")||has("watercolour")||has("gouache")) return "Watercolor"; if(has("ink")) return "Ink";
  if(has("bronze")) return "Bronze"; if(has("marble")) return "Marble"; if(has("jade")) return "Jade";
  if(has("gold")||has("gilt")) return "Gold"; if(has("silver")) return "Silver";
  if(has("porcelain")||has("stoneware")||has("earthenware")||has("ceramic")||has("terracotta")||has("faience")) return "Ceramic";
  if(has("silk")||has("cotton")||has("wool")||has("textile")||has("tapestry")||has("embroider")) return "Textile";
  if(has("wood")) return "Wood"; if(has("lacquer")) return "Lacquer";
  if(has("limestone")||has("granite")||has("basalt")||has("sandstone")||has("stone")) return "Stone";
  if(has("ivory")) return "Ivory"; if(has("glass")) return "Glass";
  if(has("paper")) return "Ink"; if(has("canvas")) return "Oil paint"; return ""; }
function cleanMov(m){return m?String(m).replace(/\s+painting$/i,'').replace(/\s+art$/i,'').trim():"";}

const CENTROIDS = [
  [/japan|ukiyo|kyoto|nara|heian|meiji|edo period/i,35.68,139.69,"Japan"],
  [/chin|qing|ming|tang|song dynasty|han dynasty|qianlong|jingdezhen|beijing|lake tai/i,39.9,116.4,"China"],
  [/korea|joseon|goryeo/i,37.57,126.98,"Korea"],
  [/tibet|nepal|himalaya|kathmandu/i,27.7,85.3,"Nepal / Tibet"],
  [/india|mughal|rajput|deccan|pala|chola|gandhara|jain|hindu|bengal/i,28.6,77.2,"India"],
  [/iran|persia|safavid|qajar|sasanian|achaemenid|isfahan|shiraz|iznik?|kashan/i,35.7,51.4,"Iran"],
  [/edo peoples|edo,? nigeria|\boba\b|nigeria|benin|yoruba|ife|igbo/i,6.5,3.38,"Nigeria"],
  [/turk|ottoman|anatolia|byzan/i,41.0,28.98,"Turkey"],
  [/palestin|jerusalem|west bank|gaza|holy land/i,31.95,35.23,"Palestine"],
  [/syria|levant|damascus|palmyra/i,33.5,36.3,"Syria"],
  [/iraq|mesopotam|babylon|assyria|sumer|nimrud|akkad/i,33.3,44.4,"Iraq"],
  [/egypt|coptic|nubia|thebes|amarna/i,30.0,31.2,"Egypt"],
  [/greece|greek|minoan|cyclad|hellen|attic|corinth/i,37.98,23.73,"Greece"],
  [/rome|roman|etruscan|pompeii|latium/i,41.9,12.5,"Italy (Rome)"],
  [/mexic|aztec|maya|olmec|teotihuacan|zapotec|mixtec/i,19.43,-99.13,"Mexico"],
  [/peru|inca|nazca|moche|chimu|wari|paracas|sican|lambayeque/i,-12.05,-77.04,"Peru"],
  [/colombia|muisca|quimbaya|calima|tolima/i,4.7,-74.07,"Colombia"],
  [/ecuador|tolita|tumaco/i,-0.18,-78.47,"Ecuador"],
  [/mali|djenne|bamana|dogon/i,12.65,-8.0,"Mali"],
  [/ghana|akan|asante|ashanti/i,5.6,-0.19,"Ghana"],
  [/congo|kongo|kuba|luba/i,-4.32,15.31,"DR Congo"],
  [/cameroon|grassland/i,3.85,11.5,"Cameroon"],
  [/ethiopia|aksum/i,9.03,38.74,"Ethiopia"],
  [/indonesia|java|bali|sumatra/i,-6.2,106.8,"Indonesia"],
  [/thai|siam|ayutthaya/i,13.75,100.5,"Thailand"],
  [/cambodia|khmer|angkor/i,11.55,104.9,"Cambodia"],
  [/vietnam|champa/i,21.03,105.85,"Vietnam"],
  [/myanmar|burma|bagan/i,16.8,96.15,"Myanmar"],
  [/sri lanka|ceylon/i,6.93,79.85,"Sri Lanka"],
  [/papua|new guinea|melanesia|sepik|asmat|mabuiag|torres strait/i,-6.3,143.95,"Papua New Guinea"],
  [/polynesia|hawaii|maori|samoa|tahiti|fiji|tonga/i,-17.7,-149.4,"Polynesia"],
  [/australia|aborigin/i,-25.0,133.0,"Australia"],
  [/navajo|hopi|pueblo|sioux|inuit|tlingit|haida|native american|americas, north/i,38.9,-105.0,"North America (Indigenous)"],
];
// country / city gazetteer (name regex -> lat,lng,label) for plain place strings
const GAZ = [
  [/united states|u\.?s\.?a?\b|america/i,38.9,-77.04,"United States"],
  [/france|french|paris/i,48.85,2.35,"France"],
  [/united kingdom|england|britain|british|london|scotland|wales/i,51.5,-0.13,"United Kingdom"],
  [/germany|german|nuremberg|nürnberg|augsburg|munich|münchen|cologne|dresden/i,52.52,13.4,"Germany"],
  [/ital(y|ian)|florence|venice|rome|milan|naples|sicily|rimini/i,41.9,12.5,"Italy"],
  [/spain|spanish|madrid|seville|catalan/i,40.42,-3.7,"Spain"],
  [/netherlands|dutch|flanders|flemish|amsterdam|holland|haarlem/i,52.37,4.9,"Netherlands"],
  [/belgium|antwerp|bruges/i,50.85,4.35,"Belgium"],
  [/austria|vienna|wien/i,48.21,16.37,"Austria"],
  [/switzerland|swiss/i,46.95,7.45,"Switzerland"],
  [/russia|soviet|moscow/i,55.75,37.62,"Russia"],
  [/denmark|copenhagen|danish/i,55.68,12.57,"Denmark"],
  [/sweden|stockholm/i,59.33,18.07,"Sweden"],
  [/norway/i,59.91,10.75,"Norway"],
  [/portugal|portuguese|lisbon/i,38.72,-9.13,"Portugal"],
  [/poland|polish|krak/i,52.23,21.01,"Poland"],
  [/czech|bohemia|prague/i,50.08,14.44,"Czechia"],
  [/hungary|budapest/i,47.5,19.04,"Hungary"],
  [/canada/i,45.42,-75.7,"Canada"],
  [/brazil/i,-15.79,-47.88,"Brazil"],
  [/argentina/i,-34.6,-58.38,"Argentina"],
  [/afghan/i,34.53,69.17,"Afghanistan"],
  [/pakistan|lahore/i,31.55,74.34,"Pakistan"],
  [/sierra leone/i,8.48,-13.23,"Sierra Leone"],
  [/c[oô]te d['’ ]?ivoire|ivory coast|baule|senufo/i,7.54,-5.55,"Côte d'Ivoire"],
  [/uganda/i,0.35,32.58,"Uganda"],
  [/cameroon|grassfields/i,3.85,11.5,"Cameroon"],
  [/senegal|dakar/i,14.69,-17.44,"Senegal"],
  [/tanzania|kenya|east africa/i,-3.0,36.0,"East Africa"],
  [/morocco|fez|fes/i,33.97,-6.85,"Morocco"],
  [/tunisia|carthage/i,36.8,10.18,"Tunisia"],
  // historical states / regions (recover famous works tagged to old polities)
  [/papal states|signoria|grand duchy of tuscany|republic of (florence|venice|genoa|siena|lucca|pisa)|duchy of (modena|ferrara|milan|savoy|urbino|mantua|parma)|kingdom of (naples|sicily|sardinia)|correggio|romagna|tuscany|lombardy|piedmont|umbria/i,41.9,12.5,"Italy"],
  [/crown of castile|crown of aragon|kingdom of (castile|aragon|spain)|castile|andalusia|valencia/i,40.42,-3.7,"Spain"],
  [/duchy of (lorraine|burgundy)|kingdom of france|county of (provence|toulouse)|normandy|burgundy/i,48.85,2.35,"France"],
  [/northern low countries|dutch republic|united provinces|county of holland/i,52.37,4.9,"Netherlands"],
  [/southern low countries|duchy of brabant|county of flanders|spanish netherlands|habsburg netherlands|prince-bishopric of li[eè]ge/i,50.85,4.35,"Belgium"],
  [/holy roman empire|electorate of|duchy of (saxony|bavaria|w[uü]rttemberg)|kingdom of (prussia|bavaria)|free imperial city|franconia|swabia|rhineland|westphalia/i,52.52,13.4,"Germany"],
  [/chaozhou|guangdong|jiangxi|zhejiang|fujian|sichuan|shaanxi|jiangsu|shanxi|hebei|henan|yunnan/i,39.9,116.4,"China"],
  [/chicago|new york|boston|philadelphia|washington|massachusetts|virginia|pennsylvania/i,38.9,-77.04,"United States"],
  [/eritrea|horn of africa/i,15.3,38.9,"Eritrea"],
  [/arab world|middle east|near east|islamic world|mamluk|abbasid|umayyad/i,33.5,36.3,"Syria"],
  [/central africa|africa/i,6.6,20.94,"Central Africa"],
];
// Test each origin signal in priority order — style/movement/culture (true origin) BEFORE
// place (often the holding museum's country, e.g. an Austrian Pietà catalogued under "United States").
function geocode(...fields){
  for(const field of fields){
    if(!field) continue;
    for(const [re,la,ln,lab] of CENTROIDS) if(re.test(field)) return {lat:la,lng:ln,place:lab};
    for(const [re,la,ln,lab] of GAZ) if(re.test(field)) return {lat:la,lng:ln,place:lab};
  }
  return null;
}

function normYear(y){ y=parseInt(y,10); return Number.isFinite(y)?y:null; }
function httpsImg(u){ return u? String(u).replace(/^http:/,"https:") : ""; }
function norm(r){
  const y=normYear(r.year); const img=httpsImg(r.image);
  if(!y||!img) return null;
  const g=geocode(r.movement,r.culture,r.place); if(!g) return {__nogeo:`${r.culture||""}|${r.place||""}`};
  const movement=cleanMov(r.movement); const culture=cleanMov(r.culture);
  const style = movement || (culture||""); const styleKind = movement?"movement":(culture?"culture":"");
  const medium = r.medium||""; // keep the rich catalogue medium; the app simplifies at runtime (simplifyMedium)
  const cats=["when","where"]; if(medium)cats.push("medium"); if(style)cats.push("style"); if(r.artist)cats.push("artist");
  const region=continentOf(g.lat,g.lng);
  return { id:String(r.id), title:r.title||"Untitled", artist:r.artist||"", y, lat:g.lat, lng:g.lng,
    place:g.place, region, style, styleKind, medium, dim:r.dim||"", fame: Number.isFinite(r.fameHint)?r.fameHint:0,
    img, src:r.src||"mus", cats };
}

// ---- load ----
const pool = JSON.parse(readFileSync("data/pool.js","utf8").replace("window.ARTEFACTUM_POOL = ","").replace(/;\s*$/,""));
const wdId = id => { const m=String(id).match(/Q\d+/); return m?m[0]:null; };
const cl = s => String(s||"").toLowerCase().replace(/[^a-z0-9]/g,"");
// named works dedup on title+artist; anonymous works dedup on image URL only (generic titles like
// "Head"/"Mask" are distinct objects across cultures, so title-dedup would wrongly delete them).
const tkey = (t,a)=> cl(a)? `${cl(t).slice(0,40)}|${cl(a).slice(0,20)}` : null;
const seenWd=new Set(), seenTk=new Set(), seenImg=new Set();
for(const p of pool){ const q=wdId(p.id); if(q)seenWd.add(q); const tk=tkey(p.title,p.artist); if(tk)seenTk.add(tk); if(p.img)seenImg.add(p.img); }

const kept=[]; const stats={}; const nogeo={}; let dupes=0, badfields=0;
for(const s of SRCS){
  let arr=[]; try{ arr=JSON.parse(readFileSync(`data/incoming/${s}.json`,"utf8")); }catch{ continue; }
  stats[s]={raw:arr.length,kept:0};
  for(const r of arr){
    const n=norm(r);
    if(!n){ badfields++; continue; }
    if(n.__nogeo){ nogeo[n.__nogeo]=(nogeo[n.__nogeo]||0)+1; continue; }
    const q=wdId(n.id), tk=tkey(n.title,n.artist), ik=n.img;
    if((q&&seenWd.has(q))||(tk&&seenTk.has(tk))||seenImg.has(ik)){ dupes++; continue; }
    if(q)seenWd.add(q); if(tk)seenTk.add(tk); seenImg.add(ik);
    kept.push(n); stats[s].kept++;
  }
}

// ---- report ----
const dist={}; for(const k of kept) dist[k.region]=(dist[k.region]||0)+1;
console.log("=== consolidation report ===");
for(const s of SRCS) if(stats[s]) console.log(`  ${s.padEnd(15)} raw ${String(stats[s].raw).padStart(4)} -> kept ${stats[s].kept}`);
console.log(`dropped: ${dupes} duplicates, ${badfields} missing year/image`);
const ng=Object.entries(nogeo).sort((a,b)=>b[1]-a[1]); const ngTotal=ng.reduce((a,[,v])=>a+v,0);
console.log(`un-geocoded: ${ngTotal} (top: ${ng.slice(0,12).map(([k,v])=>k+"×"+v).join(", ")})`);
console.log(`KEPT TOTAL: ${kept.length} new candidates`);
console.log("new-pool region mix (current+candidates):");
const merged={}; for(const p of pool) merged[p.region]=(merged[p.region]||0)+1; for(const k in dist) merged[k]=(merged[k]||0)+dist[k];
const tot=pool.length+kept.length; for(const r of Object.keys(merged).sort((a,b)=>merged[b]-merged[a])) console.log(`  ${r.padEnd(15)} ${merged[r]} (${Math.round(merged[r]/tot*100)}%)`);

writeFileSync("data/incoming/_candidates.json", JSON.stringify(kept));
console.log(`\nwrote data/incoming/_candidates.json (${kept.length})`);
if(MERGE){
  const out=[...pool,...kept];
  writeFileSync("data/pool.js","window.ARTEFACTUM_POOL = "+JSON.stringify(out)+";\n");
  console.log(`MERGED -> data/pool.js now ${out.length} works`);
} else {
  console.log("DRY RUN — re-run with --merge to append into data/pool.js");
}
