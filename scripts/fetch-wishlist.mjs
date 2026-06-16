// Artist-based US-PD harvester for the wishlist. For each artist, pulls their Commons-imaged works
// from Wikidata via SPARQL under the right rule, dedups vs pool, sets origin from the artist's
// citizenship (NOT holding museum), and STAGES to data/incoming/wishlist-fetched.json for review.
// Modes: pre1931 (green: inception<1931), pre1930 (marginal US: inception<1930), gov (FSA: all imaged
// works, flagged govReview). Does NOT promote. Run: node scripts/fetch-wishlist.mjs
import { readFileSync, writeFileSync } from "node:fs";
const UA="GessoWishlist/1.0 (kathryn.swint@gmail.com)";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

const ARTISTS=[
  // 🟢 green — died ≤1955, pre-1931 works
  {name:"Henri Matisse", mode:"pre1931"}, {name:"Wassily Kandinsky", mode:"pre1931"},
  {name:"Paul Klee", mode:"pre1931"}, {name:"Piet Mondrian", mode:"pre1931"},
  {name:"Edward McKnight Kauffer", mode:"pre1931"}, {name:"László Moholy-Nagy", mode:"pre1931"},
  {name:"Albrecht Heubner", mode:"pre1931"}, {name:"Theo van Doesburg", mode:"pre1931"},
  {name:"Alexandra Exter", mode:"pre1931"}, {name:"Gustav Klutsis", mode:"pre1931"},
  {name:"Vera Ermolaeva", mode:"pre1931"}, {name:"Emil Ganso", mode:"pre1931"},
  {name:"Doris Ulmann", mode:"pre1931"}, {name:"Joseph Stella", mode:"pre1931"},
  {name:"El Lissitzky", mode:"pre1931"},
  // 🟢 US government works (PD regardless) — FSA photographers; flag for review
  {name:"Dorothea Lange", mode:"gov"}, {name:"Walker Evans", mode:"gov"},
  // 🟡 marginal US authors — only works published pre-1930
  {name:"Georgia O'Keeffe", mode:"pre1930"}, {name:"Frank Lloyd Wright", mode:"pre1930"},
  {name:"Henry F. Swift", mode:"pre1930"},
];

async function wd(u){for(let t=0;t<5;t++){try{const r=await fetch(u,{headers:{"User-Agent":UA}});if(r.status===429||r.status>=500){await sleep(2000*(t+1));continue;}if(!r.ok)return null;return await r.json();}catch(e){await sleep(1200*(t+1));}}return null;}
async function sparql(q){const u="https://query.wikidata.org/sparql?format=json&query="+encodeURIComponent(q);
  for(let t=0;t<6;t++){try{const r=await fetch(u,{headers:{"User-Agent":UA,"Accept":"application/sparql-results+json"}});
    if(r.status===429||r.status>=500){await sleep(3000*(t+1));continue;}if(!r.ok){console.error("  sparql",r.status);return null;}return await r.json();}catch(e){await sleep(1500*(t+1));}}return null;}
const claim=(e,p)=>{const c=e.claims&&e.claims[p];return c&&c[0]&&c[0].mainsnak&&c[0].mainsnak.datavalue?c[0].mainsnak.datavalue.value:null;};
const qOf=v=>v&&v.id?v.id:null;
const yr=t=>{if(!t||!t.time)return null;const m=t.time.match(/([+-]\d+)/);return m?parseInt(m[1],10):null;};
async function label(q){if(!q)return"";const j=await wd(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=labels&languages=en&ids=${q}`);const e=j&&j.entities&&j.entities[q];return e&&e.labels&&e.labels.en?e.labels.en.value:"";}

// resolve artist → {qid, death, country}
async function resolveArtist(name){
  const j=await wd(`https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&type=item&limit=8&search=${encodeURIComponent(name)}`);
  for(const c of (j&&j.search||[])){ const d=(c.description||"").toLowerCase();
    if(!/painter|artist|photograph|designer|architect|sculptor|printmaker/.test(d)) continue;
    const ej=await wd(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims&ids=${c.id}`); await sleep(120);
    const e=ej&&ej.entities&&ej.entities[c.id]; if(!e) continue;
    const p31=(e.claims.P31||[]).map(x=>x.mainsnak.datavalue&&x.mainsnak.datavalue.value.id);
    if(!p31.includes("Q5")) continue; // must be human
    return {qid:c.id, death:yr(claim(e,"P570")), country:await label(qOf(claim(e,"P27")))};
  }
  return null;
}

global.window={}; new Function(readFileSync("data/countries.js","utf8"))();
const CO={}; for(const c of window.ARTEFACTUM_COUNTRIES) CO[c.n.toLowerCase()]=c;
const ALIAS={"united states":"united states of america","kingdom of the netherlands":"netherlands","russian empire":"russia","soviet union":"russia","weimar republic":"germany","german empire":"germany","austria-hungary":"austria","kingdom of italy":"italy","french third republic":"france"};
const CONT={"united states of america":"North America"};
const toCo=l=>{if(!l)return"";let k=l.toLowerCase().trim();k=ALIAS[k]||k;return CO[k]?CO[k].n:""};

const pool=JSON.parse(readFileSync("data/pool.js","utf8").match(/\[[\s\S]*\]/)[0]);
const have=new Set(pool.map(p=>{const m=String(p.id).match(/Q\d+/);return m?m[0]:null;}).filter(Boolean));

const out=[]; const summary=[];
for(const a of ARTISTS){
  const info=await resolveArtist(a.name); await sleep(200);
  if(!info){ summary.push(`${a.name}: ✗ not resolved`); continue; }
  // US-safe death guard for non-gov/marginal modes
  if(a.mode==="pre1931" && info.death!=null && info.death>1955){ summary.push(`${a.name}: ✗ d.${info.death} >1955 (skipped)`); continue; }
  const ORIGIN_OVERRIDE={"Paul Klee":"Switzerland","László Moholy-Nagy":"Hungary","El Lissitzky":"Russia"};
  const origin=ORIGIN_OVERRIDE[a.name]||toCo(info.country)||"";
  const yearCap = a.mode==="pre1930" ? 1930 : a.mode==="gov" ? 9999 : 1931;
  const filter = a.mode==="gov" ? "" : `?item wdt:P571 ?inc. FILTER(YEAR(?inc) < ${yearCap})`;
  const q=`SELECT ?item ?inc ?img ?medL ?movL WHERE {
    ?item wdt:P170 wd:${info.qid}; wdt:P18 ?img.
    ${filter}
    OPTIONAL { ?item wdt:P571 ?inc. }
    OPTIONAL { ?item wdt:P186 ?med. ?med rdfs:label ?medL. FILTER(LANG(?medL)="en") }
    OPTIONAL { ?item wdt:P135 ?mov. ?mov rdfs:label ?movL. FILTER(LANG(?movL)="en") }
  } LIMIT 80`;
  const j=await sparql(q); await sleep(500);
  if(!j||!j.results){ summary.push(`${a.name}: ✗ sparql failed`); continue; }
  const seen=new Set(); let added=0;
  for(const b of j.results.bindings){ const qid=b.item.value.match(/Q\d+/)[0];
    if(seen.has(qid)||have.has(qid)) continue; seen.add(qid);
    const y=b.inc?parseInt(b.inc.value.match(/^-?\d+/)[0],10):null; // SPARQL date e.g. "1916-01-01T..."
    if(a.mode!=="gov" && y==null) continue;          // need a year for non-gov
    const file=decodeURIComponent(b.img.value.split("/").pop());
    out.push({ id:"wikidata:"+qid, artist:a.name, y, place:origin,
      region: origin?(CONT[origin.toLowerCase()]||"Europe"):"Europe",
      medium: b.medL?b.medL.value:"", style: b.movL?b.movL.value:"", styleKind: b.movL?"movement":"",
      img:`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=900`,
      src:"wd-wishlist", mode:a.mode, ...(a.mode==="gov"?{govReview:true}:{}), ...(a.mode==="pre1930"?{marginalReview:true}:{}) });
    have.add(qid); added++;
  }
  summary.push(`${a.name}: ${added} works (d.${info.death||"?"}, ${origin||"?"}, ${a.mode})`);
  console.error(`✓ ${a.name}: ${added}`);
}
// titles: fetch in a batch
const ids=out.map(o=>o.id.slice(9));
for(let i=0;i<ids.length;i+=45){ const batch=ids.slice(i,i+45);
  const j=await wd(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=labels&languages=en&ids=${batch.join("|")}`); await sleep(200);
  if(j&&j.entities) for(const o of out){ const q=o.id.slice(9); const e=j.entities[q]; if(e&&e.labels&&e.labels.en) o.title=o.title||e.labels.en.value; }
}
writeFileSync("data/incoming/wishlist-fetched.json",JSON.stringify(out.filter(o=>o.title),null,1));
console.log("\n=== SUMMARY ==="); summary.forEach(s=>console.log("  "+s));
console.log(`\nSTAGED ${out.filter(o=>o.title).length} works → data/incoming/wishlist-fetched.json (NOT promoted)`);
