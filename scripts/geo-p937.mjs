// Fix holding-museum geo contamination via Wikidata. For each Wikidata-sourced work with a creator,
// the artist's TRUE footprint = citizenship (P27) ∪ work-locations (P937→P17 country). If the work's
// stored place-country is NOT in that footprint, it's almost certainly the collection's location
// (e.g. Renoir "in" Brazil = São Paulo museum) → re-geocode to the artist's primary work-location.
// Conservative: only acts when footprint is non-empty AND a clear target exists. Van Gogh→France stays
// (France ∈ his work-locations). Dry-run by default; pass --apply to write data/pool.js.
// Run: node scripts/geo-p937.mjs [--apply]
import { readFileSync, writeFileSync } from "node:fs";
const APPLY = process.argv.includes("--apply");
const UA = "GessoGeo/1.0 (kathryn.swint@gmail.com)";
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const raw = readFileSync("data/pool.js","utf8");
const pool = JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]")+1));
global.window={}; new Function(readFileSync("data/countries.js","utf8"))();
const COUNTRIES = window.ARTEFACTUM_COUNTRIES;
const CO_BYNAME = {}; for(const c of COUNTRIES) CO_BYNAME[c.n.toLowerCase()] = c;

// normalize a Wikidata place/country label → our dataset country name (or null)
const ALIAS = {"united states":"united states of america","usa":"united states of america","korea":"south korea","south korea":"south korea","dr congo":"democratic republic of the congo","democratic republic of the congo":"democratic republic of the congo","côte d'ivoire":"ivory coast","türkiye":"turkey","czech republic":"czechia","kingdom of the netherlands":"netherlands","united kingdom of great britain and northern ireland":"united kingdom"};
const POLITY=[[/florence|tuscany|venice|genoa|siena|papal states|naples|sicily|duchy of (milan|modena|ferrara|savoy|urbino|mantua|parma)|kingdom of italy|roman empire/i,"italy"],[/french .*republic|kingdom of france|french empire|gaul/i,"france"],[/kingdom of (great britain|england|scotland)|british empire/i,"united kingdom"],[/dutch republic|united provinces/i,"netherlands"],[/spanish netherlands|county of flanders|duchy of brabant/i,"belgium"],[/crown of (castile|aragon)|kingdom of (castile|aragon|spain)/i,"spain"],[/holy roman empire|kingdom of prussia|weimar|east germany|german empire|nazi germany|west germany/i,"germany"],[/soviet union|russian empire|russian soviet|ussr|muscovy/i,"russia"],[/ottoman empire|byzantine empire/i,"turkey"],[/qing|ming|tang|song|han dynasty|people's republic of china/i,"china"],[/empire of japan/i,"japan"]];
function toCountry(label){ if(!label) return null; let c=label.toLowerCase().trim();
  if(ALIAS[c]) c=ALIAS[c]; if(CO_BYNAME[c]) return c;
  for(const[re,name] of POLITY) if(re.test(c)) return CO_BYNAME[name]?name:null;
  // try stripping leading "kingdom of / republic of / state of"
  const s=c.replace(/^(the )?(kingdom|republic|state|grand duchy|duchy|principality|empire|crown) of (the )?/,"");
  return CO_BYNAME[s]?s:null; }
function placeCountryName(place){ let c=String(place||"").replace(/\s*\(.*$/,"").split("/")[0].trim().toLowerCase(); if(!c)return null; c=ALIAS[c]||c; return CO_BYNAME[c]?c:(toCountry(c)); }
function centroid(c){ // centroid of the largest ring (more reliably inside than bbox center)
  let big=c.r[0]; for(const r of c.r) if(r.length>big.length) big=r;
  let sx=0,sy=0; for(const[x,y] of big){sx+=x;sy+=y;} return [Math.round(sy/big.length*1000)/1000, Math.round(sx/big.length*1000)/1000]; }

// works with a Wikidata Q-id (the id IS the work's entity)
const qid = id => { const m=String(id).match(/(Q\d+)/); return m?m[1]:null; };
const wdWorks = pool.filter(p=>qid(p.id) && p.place);
console.error(`${wdWorks.length} Wikidata works with a place; querying creator footprints…`);

async function sparql(qids){
  const Q=`SELECT ?work ?p27Label ?wlcLabel WHERE { VALUES ?work { ${qids.map(q=>"wd:"+q).join(" ")} }
    ?work wdt:P170 ?creator . OPTIONAL { ?creator wdt:P27 ?p27 . } OPTIONAL { ?creator wdt:P937 ?wl . ?wl wdt:P17 ?wlc . }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`;
  for(let t=0;t<4;t++){ try{
    const r=await fetch("https://query.wikidata.org/sparql?format=json&query="+encodeURIComponent(Q),{headers:{"User-Agent":UA,"Accept":"application/sparql-results+json"}});
    if(r.status===429||r.status>=500){ await sleep(2000*(t+1)); continue; } if(!r.ok) return null;
    return (await r.json()).results.bindings;
  }catch(e){ await sleep(1500*(t+1)); } } return null; }

const foot={}; // workQ -> {countries:Set, wl:[ordered]}
const B=45;
for(let i=0;i<wdWorks.length;i+=B){
  const batch=wdWorks.slice(i,i+B).map(p=>qid(p.id));
  const rows=await sparql(batch);
  if(rows){ for(const b of rows){ const w=b.work.value.split("/").pop(); const f=foot[w]=foot[w]||{countries:new Set(),wl:[]};
    const cit=toCountry(b.p27Label&&b.p27Label.value); if(cit)f.countries.add(cit);
    const wl=toCountry(b.wlcLabel&&b.wlcLabel.value); if(wl){ f.countries.add(wl); f.wl.push(wl); } } }
  if(i%450===0) console.error(`  ${i}/${wdWorks.length}`);
  await sleep(300);
}

const changes=[];
for(const p of wdWorks){ const w=qid(p.id), f=foot[w]; if(!f||!f.countries.size) continue;
  const cur=placeCountryName(p.place); if(!cur) continue; // can't resolve current → skip
  if(f.countries.has(cur)) continue; // current place is within artist footprint → correct, keep
  // pick target = most frequent work-location country, else first footprint country
  let target=null; if(f.wl.length){ const cnt={}; f.wl.forEach(c=>cnt[c]=(cnt[c]||0)+1); target=Object.entries(cnt).sort((a,b)=>b[1]-a[1])[0][0]; }
  else target=[...f.countries][0];
  if(!target||!CO_BYNAME[target]) continue;
  const cc=CO_BYNAME[target], [lat,lng]=centroid(cc);
  changes.push({id:p.id,title:p.title,artist:p.artist,from:p.place,fromC:cur,to:cc.n,footprint:[...f.countries],lat,lng});
}
writeFileSync("data/incoming/geo-p937-changes.json", JSON.stringify(changes,null,1));
console.log(`\nproposed re-geocodes: ${changes.length} of ${wdWorks.length} wd works`);
changes.slice(0,25).forEach(c=>console.log(`  ${c.title.slice(0,32).padEnd(32)} ${c.artist.slice(0,18).padEnd(18)} ${c.fromC} → ${c.to}  [foot: ${c.footprint.join(",")}]`));

if(APPLY){ const map=Object.fromEntries(changes.map(c=>[c.id,c]));
  for(const p of pool){ const c=map[p.id]; if(c){ p.place=c.to; p.lat=c.lat; p.lng=c.lng; } }
  writeFileSync("data/pool.js", raw.slice(0,raw.indexOf("["))+JSON.stringify(pool)+raw.slice(raw.lastIndexOf("]")+1));
  console.log(`APPLIED ${changes.length} re-geocodes → data/pool.js`);
} else console.log(`\n(dry-run — wrote data/incoming/geo-p937-changes.json; re-run with --apply to write pool)`);
