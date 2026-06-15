// Cheap Wikidata field-backfill (no AI tokens) for staged works. Fills ONLY missing fields:
// style(P135 movement), medium(P186 material), year(P571), place(creator P937 work-location → P17,
// else P27 citizenship — origin proxy, avoids holding-museum contamination). Batched SPARQL.
// Resumable. Run: node scripts/backfill-staged.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const UA="GessoBackfill/1.0 (kathryn.swint@gmail.com)";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const FILE="data/incoming/staged-missing.json";
const works=JSON.parse(readFileSync(FILE,"utf8"));
const qid=id=>{const m=String(id).match(/Q\d+/);return m?m[0]:null;};
const has=v=>v&&String(v).trim();
const need=works.filter(w=>qid(w.id) && (!has(w.style)||!has(w.place)||!has(w.medium)||!(w.y||w.y===0)));
console.error(`${works.length} staged | ${need.length} need backfill`);

// reuse country normalization
global.window={}; new Function(readFileSync("data/countries.js","utf8"))();
const CO={}; for(const c of window.ARTEFACTUM_COUNTRIES) CO[c.n.toLowerCase()]=c;
const ALIAS={"united states":"united states of america","kingdom of the netherlands":"netherlands"};
function toCountry(l){ if(!l)return ""; let c=l.toLowerCase().trim(); c=ALIAS[c]||c; if(CO[c])return CO[c].n;
  const s=c.replace(/^(the )?(kingdom|republic|state|grand duchy|duchy|empire|crown) of (the )?/,""); return CO[s]?CO[s].n:""; }

async function sparql(q){ for(let t=0;t<4;t++){ try{
  const r=await fetch("https://query.wikidata.org/sparql?format=json&query="+encodeURIComponent(q),{headers:{"User-Agent":UA,"Accept":"application/sparql-results+json"}});
  if(r.status===429||r.status>=500){ await sleep(2000*(t+1)); continue; } if(!r.ok) return null; return (await r.json()).results.bindings;
}catch(e){ await sleep(1500*(t+1)); } } return null; }

const data={}; const B=40;
for(let i=0;i<need.length;i+=B){
  const batch=need.slice(i,i+B).map(w=>qid(w.id));
  const q=`SELECT ?work ?movementLabel ?cultureLabel ?materialLabel ?inception ?wlcLabel ?p27Label ?p17Label WHERE {
    VALUES ?work { ${batch.map(x=>"wd:"+x).join(" ")} }
    OPTIONAL { ?work wdt:P135 ?movement } OPTIONAL { ?work wdt:P2596 ?culture } OPTIONAL { ?work wdt:P186 ?material } OPTIONAL { ?work wdt:P571 ?inception }
    OPTIONAL { ?work wdt:P495 ?origin. ?origin wdt:P17 ?p17 }
    OPTIONAL { ?work wdt:P170 ?creator. OPTIONAL { ?creator wdt:P937 ?wl. ?wl wdt:P17 ?wlc } OPTIONAL { ?creator wdt:P27 ?p27 } }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`;
  const rows=await sparql(q);
  if(rows){ for(const b of rows){ const w=b.work.value.split("/").pop(); const d=data[w]=data[w]||{wl:{},cit:{}};
    if(b.movementLabel&&!d.style){ d.style=b.movementLabel.value; d.styleKind="movement"; }
    if(b.cultureLabel&&!d.culture){ d.culture=b.cultureLabel.value; }
    if(b.materialLabel&&!d.medium) d.medium=b.materialLabel.value;
    if(b.inception&&!d.year){ const m=b.inception.value.match(/([+-]\d+)/); if(m) d.year=parseInt(m[1],10); }
    const o17=toCountry(b.p17Label&&b.p17Label.value); if(o17) d.origin=o17; // P495 country of origin (authoritative for the work)
    const wl=toCountry(b.wlcLabel&&b.wlcLabel.value); if(wl) d.wl[wl]=(d.wl[wl]||0)+1;
    const cit=toCountry(b.p27Label&&b.p27Label.value); if(cit) d.cit[cit]=(d.cit[cit]||0)+1; } }
  if(i%400===0) console.error(`  ${i}/${need.length}`);
  await sleep(300);
}

let filled={style:0,medium:0,year:0,place:0};
for(const w of works){ const d=data[qid(w.id)]; if(!d) continue;
  if(!has(w.style)){ // movement first, else culture
    if(d.style){ w.style=d.style; w.styleKind="movement"; filled.style++; }
    else if(d.culture){ w.style=d.culture; w.styleKind="culture"; filled.style++; } }
  if(!has(w.medium)&&d.medium){ w.medium=d.medium; filled.medium++; }
  if(!(w.y||w.y===0)&&d.year!=null){ w.y=d.year; filled.year++; }
  if(!has(w.place)){ // P495 country-of-origin (authoritative) > work-location > single citizenship
    const wl=Object.entries(d.wl).sort((a,b)=>b[1]-a[1])[0];
    const cit=Object.keys(d.cit);
    const place = d.origin || (wl?wl[0]:(cit.length===1?cit[0]:""));
    if(place){ w.place=place; filled.place++; } } }
writeFileSync(FILE, JSON.stringify(works,null,1));
console.log(`backfilled → style ${filled.style}, medium ${filled.medium}, year ${filled.year}, place ${filled.place} (${FILE})`);
