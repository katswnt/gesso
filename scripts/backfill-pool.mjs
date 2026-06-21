// Backfill missing medium/style/place on LIVE pool works (Wikidata, no AI tokens). Fills only gaps.
// Default targets Easy-tier works; pass --all for the whole pool. Run: node scripts/backfill-pool.mjs [--all]
import { readFileSync, writeFileSync } from "node:fs";
const UA="GessoBackfill/1.0 (kathryn.swint@gmail.com)";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ALL=process.argv.includes("--all");
const raw=readFileSync("data/pool.js","utf8");
const pool=JSON.parse(raw.slice(raw.indexOf("["),raw.lastIndexOf("]")+1));
const qid=id=>{const m=String(id).match(/Q\d+/);return m?m[0]:null;};
const has=v=>v&&String(v).trim();
global.window={}; new Function(readFileSync("data/countries.js","utf8"))();
const CO={}; for(const c of window.ARTEFACTUM_COUNTRIES) CO[c.n.toLowerCase()]=c;
const ALIAS={"united states":"united states of america","kingdom of the netherlands":"netherlands","people's republic of china":"china"};
function toCountry(l){ if(!l)return ""; let c=l.toLowerCase().trim(); c=ALIAS[c]||c; if(CO[c])return CO[c].n;
  const s=c.replace(/^(the )?(kingdom|republic|state|grand duchy|duchy|empire|crown) of (the )?/,""); return CO[s]?CO[s].n:""; }

let target;
if(ALL) target=pool;
else { global.window.ARTEFACTUM_DAILY=undefined; new Function(readFileSync("data/daily-order.js","utf8"))();
  const easy=new Set(window.ARTEFACTUM_DAILY.easy); target=pool.filter(p=>easy.has(p.id)); }
const need=target.filter(p=>qid(p.id) && (!has(p.medium)||!has(p.style)||!has(p.place)));
console.error(`${target.length} target works | ${need.length} need backfill (Q-id + a gap)`);

async function sparql(q){ for(let t=0;t<4;t++){ try{
  const r=await fetch("https://query.wikidata.org/sparql?format=json&query="+encodeURIComponent(q),{headers:{"User-Agent":UA,"Accept":"application/sparql-results+json"}});
  if(r.status===429||r.status>=500){ await sleep(2000*(t+1)); continue; } if(!r.ok) return null; return (await r.json()).results.bindings;
}catch(e){ await sleep(1500*(t+1)); } } return null; }

const data={}; const B=35;
for(let i=0;i<need.length;i+=B){ const batch=need.slice(i,i+B).map(p=>qid(p.id));
  const q=`SELECT ?work ?movementLabel ?cultureLabel ?materialLabel ?p17Label WHERE {
    VALUES ?work { ${batch.map(x=>"wd:"+x).join(" ")} }
    OPTIONAL { ?work wdt:P135 ?movement } OPTIONAL { ?work wdt:P2596 ?culture } OPTIONAL { ?work wdt:P186 ?material }
    OPTIONAL { ?work wdt:P495 ?o. ?o wdt:P17 ?p17 }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`;
  const rows=await sparql(q);
  if(rows) for(const b of rows){ const w=b.work.value.split("/").pop(); const d=data[w]=data[w]||{};
    if(b.movementLabel&&!d.style){d.style=b.movementLabel.value;d.kind="movement";}
    if(b.cultureLabel&&!d.culture)d.culture=b.cultureLabel.value;
    if(b.materialLabel&&!d.medium)d.medium=b.materialLabel.value;
    const o=toCountry(b.p17Label&&b.p17Label.value); if(o&&!d.place)d.place=o; }
  if(i%350===0) console.error(`  ${i}/${need.length}`); await sleep(300);
}
let f={medium:0,style:0,place:0};
for(const p of target){ const d=data[qid(p.id)]; if(!d)continue;
  if(!has(p.medium)&&d.medium){p.medium=d.medium;f.medium++;}
  if(!has(p.style)){ if(d.style){p.style=d.style;p.styleKind="movement";f.style++;} else if(d.culture){p.style=d.culture;p.styleKind="culture";f.style++;} }
  if(!has(p.place)&&d.place){p.place=d.place;f.place++;} }
writeFileSync("data/pool.js",raw.slice(0,raw.indexOf("["))+JSON.stringify(pool)+raw.slice(raw.lastIndexOf("]")+1));
console.log(`backfilled medium ${f.medium}, style ${f.style}, place ${f.place}`);
