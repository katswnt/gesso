// OVERNIGHT coverage harvest — safe, unattended, STAGING ONLY (writes data/incoming/<category>/candidates.json,
// no pool write, no commit). Sources: Met, Cleveland, AIC Open Access (all CC0/PD, freely-licensed images).
// Categories: the thin regions Te Papa doesn't cover (Middle East, South America, Early-Medieval Europe) PLUS
// the Western GAPS the coverage doc flagged (European sculpture/decorative 1400-1700, canonical prints) — NOT
// more European oils (already over-weighted). Places by creation-country, never the museum. Robust: every
// source×category is independently try/caught so one failure can't stall the run.  node scripts/fetch-regions-overnight.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
const UA = "GessoRegions/1.0 (kathryn.swint@gmail.com)";
const sleep = ms => new Promise(r => setTimeout(r, ms));

const w = {}; new Function("window", readFileSync("data/pool.js", "utf8"))(w);
const POOL = w.ARTEFACTUM_POOL || [];
const haveId = new Set(POOL.map(p => p.id)), haveImg = new Set(POOL.map(p => p.img));
const staged = new Set();
// preload already-staged candidates so a re-run (e.g. to add Harvard+Smithsonian) APPENDS instead of duplicating
for(const cat of ["middle-east","south-america","early-medieval-europe","euro-sculpture-1400-1700","canonical-prints","oceania"]){
  try{ for(const r of JSON.parse(readFileSync(`data/incoming/${cat}/candidates.json`,"utf8"))){ if(r.id)staged.add(r.id); if(r.img)haveImg.add(r.img); } }catch{}
}
console.log(`preloaded ${staged.size} already-staged candidates (dedup guard)`);

const COORD = { iran:[32,53],iraq:[33,44],syria:[35,38],turkey:[39,35],egypt:[26,30],"saudi arabia":[24,45],yemen:[15,48],lebanon:[34,36],jordan:[31,36],israel:[31,35],afghanistan:[34,66],uzbekistan:[41,64],persia:[32,53],anatolia:[39,35],mesopotamia:[33,44],
  peru:[-10,-76],bolivia:[-17,-65],chile:[-30,-71],colombia:[4,-73],ecuador:[-1,-78],argentina:[-34,-64],
  france:[46.6,2.2],germany:[51,10.4],italy:[42.8,12.5],spain:[40,-4],"united kingdom":[54,-2],england:[52.5,-1.5],ireland:[53,-8],greece:[39,22],byzantine:[41,29],norway:[62,10],sweden:[62,15],denmark:[56,10],austria:[47.5,14],switzerland:[47,8],belgium:[50.5,4.5],netherlands:[52,5.5],"holy roman empire":[50,10],
  "new zealand":[-41,174],aotearoa:[-41,174],maori:[-41,174],"māori":[-41,174],fiji:[-17,178],samoa:[-14,-172],tonga:[-21,-175],hawaii:[20,-157],hawaiian:[20,-157],"papua new guinea":[-6,147],"new guinea":[-5,141],vanuatu:[-16,168],"solomon islands":[-9,160],"french polynesia":[-17,-149],tahiti:[-17,-149],"new caledonia":[-21,165],"cook islands":[-21,-159],"easter island":[-27,-109],"rapa nui":[-27,-109],australia:[-25,133],polynesia:[-15,-140],melanesia:[-8,160],micronesia:[7,150],marquesas:[-9,-139],sepik:[-4,143] };
const coord = c => { const s=(c||"").toLowerCase(); for (const k in COORD) if (s.includes(k)) return { lat:COORD[k][0], lng:COORD[k][1], place:k }; return null; };
const MED = { oil:"Oil paint",tempera:"Tempera",fresco:"Fresco",watercolor:"Watercolor",ink:"Ink",gold:"Gold",silver:"Silver",bronze:"Bronze",copper:"Copper",brass:"Bronze",ivory:"Ivory",wood:"Wood",stone:"Stone",marble:"Marble",limestone:"Stone",ceramic:"Ceramic",earthenware:"Ceramic",stoneware:"Ceramic",clay:"Ceramic",terracotta:"Ceramic",porcelain:"Ceramic",glass:"Glass",silk:"Textile",wool:"Textile",cotton:"Textile",textile:"Textile",tapestry:"Textile",parchment:"Ink",vellum:"Ink",enamel:"Glass",jade:"Jade",turquoise:"Stone",gilt:"Gold",etching:"Engraving",engraving:"Engraving",woodcut:"Woodblock print",lithograph:"Lithograph",drypoint:"Engraving",mezzotint:"Engraving",aquatint:"Engraving" };
const medBucket = m => { const s=(m||"").toLowerCase(); for (const k in MED) if (s.includes(k)) return MED[k]; return "Stone"; };

const ME=["iran","iraq","syria","turkey","egypt","saudi arabia","yemen","lebanon","jordan","israel","afghanistan","uzbekistan","anatolia","mesopotamia","persia","levant","islamic","ottoman","safavid","mamluk","qajar","seljuk","abbasid","umayyad"];
const SA=["peru","bolivia","chile","colombia","ecuador","andes","andean","moche","nazca","inca","chavin","tiwanaku","paracas","wari","chimu"];
const EUR=["france","germany","italy","spain","united kingdom","england","ireland","greece","byzantine","norway","sweden","denmark","austria","switzerland","belgium","netherlands","frankish","carolingian","ottonian","merovingian","insular","anglo-saxon","lombard","visigothic","viking"];
const PRINTMAKERS=["dürer","durer","rembrandt","goya","piranesi","hokusai","hiroshige","whistler","canaletto","callot","schongauer","mantegna","van dyck","blake","daumier","toulouse-lautrec","cassatt","utamaro","kuniyoshi"];
const OC=["new zealand","aotearoa","maori","māori","fiji","samoa","tonga","hawaii","hawaiian","papua new guinea","new guinea","vanuatu","solomon islands","french polynesia","polynesia","melanesia","micronesia","new caledonia","cook islands","tahiti","tahitian","easter island","rapa nui","marquesas","niue","kiribati","pacific","oceania","austral","sepik","asmat","taonga"];

// classify a normalized obj -> first matching category, or null
const hay = o => [o.country,o.culture,o.type,o.title].filter(Boolean).join(" | ").toLowerCase();
function classify(o){
  const h = hay(o), art = (o.artist||"").toLowerCase(), isPrint=/print|etching|engraving|woodcut|woodblock|drypoint|mezzotint|aquatint|lithograph/.test(h);
  if (OC.some(t=>h.includes(t))) return { cat:"oceania", region:"Oceania" };
  if (SA.some(t=>h.includes(t))) return { cat:"south-america", region:"South America" };
  if (ME.some(t=>h.includes(t))) return { cat:"middle-east", region:/egypt/.test(h)?"Africa":"Asia" };
  if (EUR.some(t=>h.includes(t)) && o.y!=null && o.y>=300 && o.y<=1080) return { cat:"early-medieval-europe", region:"Europe" };
  if (isPrint && PRINTMAKERS.some(p=>art.includes(p))) return { cat:"canonical-prints", region:coord(o.country)?.place && EUR.includes(coord(o.country).place)?"Europe":(/(japan|hokusai|hiroshige|utamaro|kuniyoshi)/.test(art+h)?"Asia":"Europe") };
  if (EUR.some(t=>h.includes(t)) && /(sculpture|statue|relief|bust|bronze|marble|terracotta|ivory|plaquette|medal|decorative)/.test(h) && o.y!=null && o.y>=1400 && o.y<=1700) return { cat:"euro-sculpture-1400-1700", region:"Europe" };
  return null;
}
function stage(cat, rec){
  const dir=`data/incoming/${cat}`; mkdirSync(dir,{recursive:true});
  const f=`${dir}/candidates.json`; let arr=[]; try{ arr=JSON.parse(readFileSync(f,"utf8")); }catch{}
  arr.push(rec); writeFileSync(f, JSON.stringify(arr,null,1));
}
function accept(o){
  if(!o.img||haveImg.has(o.img)||haveId.has(o.id)||staged.has(o.id))return null;
  const cls=classify(o); if(!cls)return null;
  const cc=coord(o.country||o.culture); if(!cc)return null;
  staged.add(o.id);
  const rec={ id:o.id, title:(o.title||"Untitled").slice(0,90), artist:(o.artist||"").slice(0,60), y:o.y, lat:cc.lat, lng:cc.lng,
    place:o.country||cc.place||"", region:cls.region, style:(o.culture||o.period||"").replace(/,.*$/,"").trim()||"", styleKind:"culture",
    medium:medBucket(o.medium||o.type), img:o.img, src:o.src, museum:o.museum, dim:(o.dim||"").slice(0,60) };
  stage(cls.cat, rec); return cls.cat;
}

// ---------- Met ----------
async function met(){
  const MET="https://collectionapi.metmuseum.org/public/collection/v1";
  const terms=["Islamic","Iran","Ottoman","Safavid","Mamluk","Persian","Seljuk","Abbasid","Assyrian","Sasanian","Moche","Nazca","Inca","Chavin","Tiwanaku","Andean","Peru","Carolingian","Byzantine","Viking","Anglo-Saxon","Merovingian","Ottonian","Coptic","Renaissance sculpture","Italian bronze","Baroque sculpture","Dürer","Rembrandt etching","Goya","Piranesi","Hokusai print"];
  const ids=new Set();
  for(const t of terms){ try{ const r=await fetch(`${MET}/search?hasImages=true&q=${encodeURIComponent(t)}`,{headers:{"User-Agent":UA}}); const j=await r.json(); (j.objectIDs||[]).slice(0,300).forEach(id=>ids.add(id)); }catch{} await sleep(120); }
  console.log(`[met] scanning ${ids.size}...`); let n=0;
  for(const id of ids){ try{ const r=await fetch(`${MET}/objects/${id}`,{headers:{"User-Agent":UA}}); if(!r.ok){await sleep(55);continue;} const o=await r.json();
    if(!o.isPublicDomain){await sleep(55);continue;} const img=o.primaryImage||o.primaryImageSmall; if(!img){await sleep(55);continue;}
    const y=o.objectBeginDate!=null&&o.objectEndDate!=null?Math.round((o.objectBeginDate+o.objectEndDate)/2):(o.objectBeginDate??null);
    const c=accept({ id:"met"+id, title:o.title||o.objectName, artist:o.artistDisplayName, y, country:o.country, culture:o.culture, type:o.classification||o.objectName, medium:o.medium, img, src:"met", museum:"Metropolitan Museum of Art", dim:o.dimensions });
    if(c)n++; if(n&&n%25===0)console.log(`  [met] +${n}`); }catch{} await sleep(55); }
  console.log(`[met] done: +${n}`);
}
// ---------- Cleveland ----------
async function cleveland(){
  const B="https://openaccess-api.clevelandart.org/api/artworks/";
  const qs=["culture=Iran","culture=Turkey","culture=Egypt","culture=Peru","culture=Byzantine","type=Sculpture","type=Print","type=Textile","type=Ceramic"];
  let n=0;
  for(const q of qs){ let skip=0; for(let page=0;page<4;page++){ try{
    const r=await fetch(`${B}?cc0=1&has_image=1&limit=100&skip=${skip}&${q}`,{headers:{"User-Agent":UA}}); const j=await r.json();
    for(const o of (j.data||[])){ const img=o.images?.web?.url||o.images?.print?.url; if(!img)continue;
      const y=o.creation_date_earliest!=null&&o.creation_date_latest!=null?Math.round((+o.creation_date_earliest+ +o.creation_date_latest)/2):(o.creation_date_earliest!=null?+o.creation_date_earliest:null);
      const c=accept({ id:"cleveland"+o.id, title:o.title, artist:(o.creators?.[0]?.description||"").split(" (")[0], y, country:(Array.isArray(o.culture)?o.culture[0]:o.culture)||"", culture:(Array.isArray(o.culture)?o.culture[0]:o.culture)||"", type:o.type, medium:o.technique, img, src:"cleveland", museum:"Cleveland Museum of Art", dim:o.measurements });
      if(c)n++; }
    if(!(j.data||[]).length)break; skip+=100; }catch{} await sleep(200); } }
  console.log(`[cleveland] done: +${n}`);
}
// ---------- AIC ----------
async function aic(){
  const B="https://api.artic.edu/api/v1/artworks/search";
  const F="id,title,is_public_domain,image_id,place_of_origin,artist_display,classification_title,medium_display,date_start,date_end,dimensions";
  const terms=["Moche","Nazca","Inca","Islamic Iran","Ottoman","Byzantine","Coptic","Renaissance sculpture","Dürer print","Rembrandt etching","Goya print","Hokusai"];
  let n=0;
  for(const t of terms){ try{
    const r=await fetch(`${B}?q=${encodeURIComponent(t)}&limit=80&fields=${F}`,{headers:{"User-Agent":UA}}); const j=await r.json();
    for(const o of (j.data||[])){ if(!o.is_public_domain||!o.image_id)continue;
      const img=`https://www.artic.edu/iiif/2/${o.image_id}/full/843,/0/default.jpg`;
      const y=o.date_start!=null&&o.date_end!=null?Math.round((o.date_start+o.date_end)/2):(o.date_start??null);
      const c=accept({ id:"aic"+o.id, title:o.title, artist:(o.artist_display||"").split("\n")[0], y, country:o.place_of_origin, culture:o.place_of_origin, type:o.classification_title, medium:o.medium_display, img, src:"aic", museum:"Art Institute of Chicago", dim:o.dimensions });
      if(c)n++; }
  }catch{} await sleep(200); }
  console.log(`[aic] done: +${n}`);
}

// ---------- V&A (keyless) — pre-1900 objects with images (age-PD proxy; promote re-verifies license) ----------
async function vam(){
  const B="https://api.vam.ac.uk/v2/objects/search";
  const terms=["Islamic Iran","Ottoman","Safavid","Mughal","Renaissance bronze","Italian sculpture","Baroque bronze","Dürer","Rembrandt etching","Goya","Piranesi","Byzantine","Coptic","Andean Peru"];
  let n=0;
  for(const t of terms){ try{
    const r=await fetch(`${B}?q=${encodeURIComponent(t)}&page_size=45&images_exist=1&year_made_to=1900`,{headers:{"User-Agent":UA}}); const j=await r.json();
    for(const rec of (j.records||[])){ const iid=rec._primaryImageId; if(!iid)continue;
      const img=`https://framemark.vam.ac.uk/collections/${iid}/full/843,/0/default.jpg`;
      const y=rec._primaryDate? (parseInt((String(rec._primaryDate).match(/-?\d{3,4}/)||[])[0],10)||null):null;
      const c=accept({ id:"va"+(rec.systemNumber||iid), title:rec._primaryTitle||rec.objectType, artist:rec._primaryMaker?.name||"", y,
        country:rec._primaryPlace||"", culture:rec._primaryPlace||"", type:rec.objectType, medium:rec.objectType, img, src:"va", museum:"Victoria and Albert Museum", dim:"" });
      if(c)n++; }
  }catch{} await sleep(200); }
  console.log(`[va] done: +${n} (license re-verified at promote)`);
}
// ---------- Wikidata / Commons — spans ALL museums; Commons images are freely licensed ----------
async function wikidata(){
  const UAX={"User-Agent":UA,Accept:"application/sparql-results+json"};
  const run=async q=>{ try{ const r=await fetch("https://query.wikidata.org/sparql?format=json&query="+encodeURIComponent(q),{headers:UAX}); if(!r.ok)return[]; return (await r.json()).results.bindings; }catch{ return []; } };
  const norm=b=>{ const qid=b.item.value.match(/Q\d+/)[0]; const img="https://commons.wikimedia.org/wiki/Special:FilePath/"+encodeURIComponent(decodeURIComponent(b.img.value.split("/").pop()));
    let y=null; if(b.date){const m=(b.date.value.match(/-?\d{1,4}/)||[])[0]; if(m){y=b.date.value.startsWith("-")?-parseInt(m):parseInt(m);} }
    return { id:"wikidata:"+qid, title:b.itemLabel?.value, artist:b.creatorLabel?.value||"", y, country:b.countryLabel?.value||"", culture:b.cultureLabel?.value||"", type:b.typeLabel?.value||"", medium:b.matLabel?.value||"", img, src:"wd", museum:b.collLabel?.value||"" }; };
  const LBL='SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }';
  const OPTS='OPTIONAL{?item wdt:P571 ?date} OPTIONAL{?item wdt:P170 ?creator} OPTIONAL{?item wdt:P495 ?country} OPTIONAL{?item wdt:P2596 ?culture} OPTIONAL{?item wdt:P186 ?mat} OPTIONAL{?item wdt:P31 ?type} OPTIONAL{?item wdt:P195 ?coll}';
  const queries=[
    `SELECT DISTINCT ?item ?itemLabel ?img ?date ?creatorLabel ?countryLabel ?cultureLabel ?matLabel ?typeLabel ?collLabel WHERE { ?item wdt:P18 ?img; wdt:P495 ?c. ?c wdt:P30 wd:Q18. ${OPTS} ${LBL} } LIMIT 600`, // South America
    `SELECT DISTINCT ?item ?itemLabel ?img ?date ?creatorLabel ?countryLabel ?cultureLabel ?matLabel ?typeLabel ?collLabel WHERE { ?item wdt:P18 ?img; wdt:P495 ?c. VALUES ?c { wd:Q794 wd:Q796 wd:Q858 wd:Q43 wd:Q79 wd:Q851 wd:Q810 wd:Q822 wd:Q801 wd:Q889 } ${OPTS} ${LBL} } LIMIT 700`, // Middle East countries
    `SELECT DISTINCT ?item ?itemLabel ?img ?date ?creatorLabel ?countryLabel ?cultureLabel ?matLabel ?typeLabel ?collLabel WHERE { ?item wdt:P18 ?img; wdt:P31/wdt:P279* wd:Q860861; wdt:P571 ?date; wdt:P495 ?c. ?c wdt:P30 wd:Q46. FILTER(YEAR(?date)>=1400 && YEAR(?date)<=1700) ${OPTS} ${LBL} } LIMIT 500`, // Euro sculpture 1400-1700
    `SELECT DISTINCT ?item ?itemLabel ?img ?date ?creatorLabel ?countryLabel ?cultureLabel ?matLabel ?typeLabel ?collLabel WHERE { ?item wdt:P18 ?img; wdt:P170 ?creator. VALUES ?creator { wd:Q5580 wd:Q5598 wd:Q5432 wd:Q313093 wd:Q5586 wd:Q214279 wd:Q167654 wd:Q41264 } ${OPTS} ${LBL} } LIMIT 500`, // canonical printmakers
    `SELECT DISTINCT ?item ?itemLabel ?img ?date ?creatorLabel ?countryLabel ?cultureLabel ?matLabel ?typeLabel ?collLabel WHERE { ?item wdt:P18 ?img; wdt:P571 ?date; wdt:P495 ?c. ?c wdt:P30 wd:Q46. FILTER(YEAR(?date)>=400 && YEAR(?date)<=1080) ${OPTS} ${LBL} } LIMIT 500`, // Early medieval Europe
  ];
  let n=0;
  for(const q of queries){ const rows=await run(q); for(const b of rows){ const c=accept(norm(b)); if(c)n++; } await sleep(1500); }
  console.log(`[wikidata] done: +${n}`);
}

// ---------- Harvard Art Museums (needs HARVARD_KEY) — strong in Islamic (ex-Sackler) + prints; age-PD proxy, license re-verified at promote ----------
async function harvard(){
  const KEY=process.env.HARVARD_KEY; if(!KEY){ console.log("[harvard] no HARVARD_KEY — skip"); return; }
  const B="https://api.harvardartmuseums.org/object";
  const F="id,title,dated,datebegin,dateend,people,culture,classification,medium,primaryimageurl,dimensions";
  const terms=["Islamic","Iran","Ottoman","Safavid","Mughal","Persian","Byzantine","Coptic","Sasanian","Andean","Peru","Nazca","Moche","Dürer","Rembrandt","Goya","Piranesi","Italian sculpture","Renaissance bronze","Carolingian"];
  let n=0;
  for(const t of terms){ for(let page=1;page<=3;page++){ try{
    const r=await fetch(`${B}?apikey=${KEY}&size=100&page=${page}&hasimage=1&q=${encodeURIComponent(t)}&fields=${F}`,{headers:{"User-Agent":UA}});
    const j=await r.json(); const recs=j.records||[]; if(!recs.length)break;
    for(const o of recs){ const img=o.primaryimageurl; if(!img)continue;
      const y=o.datebegin!=null&&o.dateend!=null&&o.dateend!==0?Math.round((o.datebegin+o.dateend)/2):(o.datebegin||null);
      if(y!=null&&y>1900)continue; // age-PD proxy (promote re-verifies license)
      const person=(o.people||[]).find(p=>/artist|maker|draughtsman|printmaker|painter|engraver/i.test(p.role||""))||o.people?.[0];
      const c=accept({ id:"harvard"+o.id, title:o.title, artist:(person?.name||"").split(" (")[0], y, country:o.culture||"", culture:o.culture||"",
        type:o.classification, medium:o.medium, img, src:"harvard", museum:"Harvard Art Museums", dim:o.dimensions });
      if(c)n++; }
  }catch{} await sleep(160); } }
  console.log(`[harvard] done: +${n} (license re-verified at promote)`);
}
// ---------- Smithsonian Open Access (needs SI_KEY) — only the art units that inline a CC0 image via this API
// (Cooper Hewitt design, American Art, Hirshhorn). Freer|Sackler/NMAI don't expose inline media here, so this
// is mostly a decorative-arts/prints source; accept() keeps only the works that bucket into a target category. ----------
async function smithsonian(){
  const KEY=process.env.SI_KEY; if(!KEY){ console.log("[smithsonian] no SI_KEY — skip"); return; }
  const B="https://api.si.edu/openaccess/api/v1.0/search";
  const UNITS=["CHNDM","SAAM","HMSG"];
  const terms=["Islamic","Iran","Persian","Ottoman","Safavid","Mughal","Byzantine","Coptic","Andean","Peru","Nazca","Moche","Chavin","Dürer","Rembrandt","Goya","Piranesi","Renaissance"];
  let n=0;
  for(const t of terms){ for(const u of UNITS){ try{
    const q=`${t} AND unit_code:"${u}"`;
    const r=await fetch(`${B}?api_key=${KEY}&rows=100&q=${encodeURIComponent(q)}`,{headers:{"User-Agent":UA}});
    const j=await r.json(); const rows=j.response?.rows||[];
    for(const row of rows){ const c=row.content, dnr=c?.descriptiveNonRepeating, ft=c?.freetext, idx=c?.indexedStructured;
      if(dnr?.metadata_usage?.access!=="CC0")continue; // explicit open-access flag
      const media=dnr?.online_media?.media?.[0]; const img=media?.content||media?.thumbnail; if(!img)continue;
      const dateStr=ft?.date?.[0]?.content||""; const m=(String(dateStr).match(/-?\d{3,4}/)||[])[0]; const y=m?(dateStr.trim().startsWith("-")?-parseInt(m):parseInt(m)):null;
      const person=(ft?.name||[]).find(x=>/artist|maker|creator|painter|printmaker/i.test(x.label||""))||ft?.name?.[0];
      const place=ft?.place?.[0]?.content||"", culture=idx?.culture?.[0]||place;
      const c2=accept({ id:"si"+row.id, title:dnr?.title?.content||row.title, artist:(person?.content||"").split(" (")[0], y,
        country:place||culture, culture, type:ft?.objectType?.[0]?.content||idx?.object_type?.[0]||"", medium:ft?.physicalDescription?.[0]?.content||"",
        img, src:"si", museum:dnr?.dataSource||"Smithsonian" });
      if(c2)n++; }
  }catch{} await sleep(200); } }
  console.log(`[smithsonian] done: +${n}`);
}

// ---------- Te Papa (needs TEPAPA_KEY) — the real Oceania source: Māori taonga + Pacific. Gated on the
// representation's own width so nothing blurry is staged. contentUrl "/full" is the high-res master. ----------
async function tepapa(){
  const KEY=process.env.TEPAPA_KEY; if(!KEY){ console.log("[tepapa] no TEPAPA_KEY — skip"); return; }
  const B="https://data.tepapa.govt.nz/collection/search";
  const terms=["cloak","carving","pounamu","hei-tiki","weapon","god figure","mask","canoe","figure","ornament","tapa","club","adze","pendant","bowl","feather","staff","drum","comb","headdress"];
  let n=0;
  for(const t of terms){ for(let from=0;from<300;from+=100){ try{
    const r=await fetch(B,{method:"POST",headers:{"User-Agent":UA,"Content-Type":"application/json","x-api-key":KEY},
      body:JSON.stringify({query:t,size:100,from,filters:[{field:"type",keyword:"Object"}]})});
    const j=await r.json(); const results=j.results||[]; if(!results.length)break;
    for(const o of results){
      const rep=(o.hasRepresentation||[]).find(x=>(x.contentUrl||x.previewUrl)); if(!rep)continue;
      if(rep.width && rep.width<900) continue;                 // no blurry masters
      const img=rep.contentUrl||rep.previewUrl; if(!img)continue;
      const prod=(o.production||[])[0]||{};
      const y=prod.facetCreatedDate?.year?parseInt(prod.facetCreatedDate.year,10):null;
      const place=prod.spatial?.title||"New Zealand";
      const art=prod.contributor?.title; const artist=(art&&!/unknown|unidentified/i.test(art))?art:"";
      const mat=(o.isMadeOf||[]).map(m=>m.title||m).filter(Boolean).join(" ");
      const c=accept({ id:"tepapa"+o.id, title:o.title||o.additionalType?.[0]||"Untitled", artist, y,
        country:place, culture:o.collection||place, type:(o.additionalType||[]).join(" "), medium:mat, img, src:"tepapa", museum:"Museum of New Zealand Te Papa Tongarewa" });
      if(c)n++; }
  }catch{} await sleep(150); } }
  console.log(`[tepapa] done: +${n} (license re-verified at promote)`);
}
// ---------- Europeana (needs EUROPEANA_KEY) — deep European + Islamic + Byzantine; open-licensed only ----------
async function europeana(){
  const KEY=process.env.EUROPEANA_KEY; if(!KEY){ console.log("[europeana] no EUROPEANA_KEY — skip"); return; }
  const B="https://api.europeana.eu/record/v2/search.json";
  const terms=["Safavid","Ottoman","Mamluk","Qajar Persian","Byzantine icon","Coptic","Carolingian","Merovingian","Viking art","Anglo-Saxon","Ottonian","Renaissance bronze","Baroque sculpture","Dürer engraving","Rembrandt etching","Goya Caprichos","Piranesi","Andean textile","Nazca","Moche"];
  let n=0;
  for(const t of terms){ for(let start=1;start<=200;start+=100){ try{
    const u=`${B}?wskey=${KEY}&query=${encodeURIComponent(t)}&rows=100&start=${start}&profile=rich&media=true&reusability=open&qf=TYPE:IMAGE`;
    const r=await fetch(u,{headers:{"User-Agent":UA}}); const j=await r.json(); const items=j.items||[]; if(!items.length)break;
    for(const it of items){
      const rights=(it.rights||[])[0]||""; if(!/creativecommons|publicdomain\/mark|\/pdm|\/cc0|zero\/1\.0|NoC-/i.test(rights))continue; // PD/CC0/CC-BY only
      const img=(it.edmIsShownBy||[])[0]||(it.edmObject||[])[0]; if(!img)continue;
      const yr=(it.year||[])[0]; const y=yr?(parseInt(String(yr).match(/-?\d{1,4}/)?.[0],10)||null):null;
      const country=(it.country||[])[0]||"";
      const creator=((it.dcCreator||[]).find(c=>!/^https?:/.test(c))||"").replace(/\s*\(.*$/,"").trim();
      const c=accept({ id:"europeana:"+encodeURIComponent(it.id), title:(it.title||[])[0]||"Untitled", artist:creator, y,
        country, culture:country, type:(it.dcType||[])[0]||"", medium:(it.dcType||[])[0]||"", img, src:"europeana", museum:(it.dataProvider||[])[0]||"" });
      if(c)n++; }
  }catch{} await sleep(200); } }
  console.log(`[europeana] done: +${n} (license re-verified at promote)`);
}
// NOTE: DPLA intentionally NOT wired as an image source — its API returns ~150px thumbnails with mixed/unknown
// rights (much of it in-copyright), which would reintroduce exactly the low-res problem. Useful only as a
// discovery index; revisit separately if we want it for coverage leads (not images).

// SOURCES=harvard,smithsonian runs a subset (e.g. to append new sources without re-fetching what's already staged)
const ONLY=(process.env.SOURCES||"").split(",").map(s=>s.trim()).filter(Boolean);
const ALL=[["met",met],["cleveland",cleveland],["aic",aic],["va",vam],["harvard",harvard],["smithsonian",smithsonian],["tepapa",tepapa],["europeana",europeana],["wikidata",wikidata]];
for(const [name,fn] of (ONLY.length?ALL.filter(([n])=>ONLY.includes(n)):ALL)){
  try{ console.log(`\n=== SOURCE: ${name} ===`); await fn(); }catch(e){ console.log(`[${name}] FAILED: ${e.message}`); }
}
console.log("\n=== OVERNIGHT HARVEST COMPLETE (staged to data/incoming/<category>/candidates.json, no pool changes) ===");
for(const cat of ["middle-east","south-america","early-medieval-europe","euro-sculpture-1400-1700","canonical-prints","oceania"]){
  const f=`data/incoming/${cat}/candidates.json`; let n=0; try{ n=JSON.parse(readFileSync(f,"utf8")).length; }catch{}
  console.log(`  ${cat}: ${n} candidates`);
}
