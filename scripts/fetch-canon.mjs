// Fetch the public-domain canon icons missing from the pool. Resolve each (title+artist) to a
// Wikidata Q-id via search, then pull image/inception/creator/location/material/movement.
// Writes pool-format entries to data/incoming/canon-additions.json for review (NOT promoted).
// Run: node scripts/fetch-canon.mjs
import { readFileSync, writeFileSync } from "node:fs";
const UA="GessoCanon/1.0 (kathryn.swint@gmail.com)";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const missing=JSON.parse(readFileSync("data/incoming/canon-missing.json","utf8"));
const COPYR=/picasso|dalí|dali|warhol|pollock|magritte|matisse|mondrian|kahlo|lichtenstein|koons|banksy|brâncuși|brancusi|duchamp|chagall|wyeth|rousseau|coolidge|landowski|eriksen|di modica/i;
const pd=missing.filter(e=>!COPYR.test(e.artist));
console.error(`fetching ${pd.length} public-domain canon icons…`);

async function wd(url){ for(let t=0;t<4;t++){ try{ const r=await fetch(url,{headers:{"User-Agent":UA}});
  if(r.status===429||r.status>=500){ await sleep(1500*(t+1)); continue; } if(!r.ok) return null; return await r.json();
}catch(e){ await sleep(1000*(t+1)); } } return null; }

async function search(title,artist){ // wbsearchentities → best Q-id
  const q=encodeURIComponent(artist?`${title} ${artist}`:title);
  const j=await wd(`https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&type=item&limit=5&search=${q}`);
  if(j&&j.search&&j.search.length) return j.search[0].id;
  // retry title-only
  const j2=await wd(`https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&type=item&limit=5&search=${encodeURIComponent(title)}`);
  return j2&&j2.search&&j2.search[0]?j2.search[0].id:null;
}
const claim=(e,p)=>{ const c=e.claims&&e.claims[p]; return c&&c[0]&&c[0].mainsnak&&c[0].mainsnak.datavalue?c[0].mainsnak.datavalue.value:null; };
const qOf=v=>v&&v.id?v.id:null;
async function label(qid){ if(!qid) return ""; const j=await wd(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=labels&languages=en&ids=${qid}`);
  const e=j&&j.entities&&j.entities[qid]; return e&&e.labels&&e.labels.en?e.labels.en.value:""; }
async function countryOfPlace(qid){ if(!qid) return ""; const j=await wd(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims|labels&languages=en&ids=${qid}`);
  const e=j&&j.entities&&j.entities[qid]; if(!e) return ""; const c=claim(e,"P17"); const cq=qOf(c); if(cq) return await label(cq);
  return e.labels&&e.labels.en?e.labels.en.value:""; }

const out=[];
for(const m of pd){ const qid=await search(m.title,m.artist); await sleep(200);
  if(!qid){ console.error("  no Q-id:",m.title); continue; }
  const j=await wd(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims|labels&languages=en&ids=${qid}`); await sleep(200);
  const e=j&&j.entities&&j.entities[qid]; if(!e){ console.error("  no entity:",m.title); continue; }
  const img=claim(e,"P18"); // commons filename
  if(!img){ console.error("  NO IMAGE (P18):",m.title); continue; }
  const inc=claim(e,"P571"); let year=null; if(inc&&inc.time){ const mm=inc.time.match(/([+-]\d+)/); if(mm) year=parseInt(mm[1],10); }
  const creator=await label(qOf(claim(e,"P170")))||m.artist||""; await sleep(120);
  const loc=qOf(claim(e,"P1071"))||qOf(claim(e,"P276")); const place=loc?await countryOfPlace(loc):""; await sleep(120);
  const material=await label(qOf(claim(e,"P186")))||""; await sleep(120);
  const movement=await label(qOf(claim(e,"P135")))||""; await sleep(120);
  out.push({ id:"wikidata:"+qid, title:m.title, artist:creator, y:year,
    place, medium:material, style:movement, styleKind: movement?"movement":"",
    img:`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(img)}?width=900`,
    src:"wd-canon", canon:true });
  console.error(`  ✓ ${m.title} → ${qid} | ${year||"?"} | ${place||"?"} | img:${img.slice(0,30)}`);
}
writeFileSync("data/incoming/canon-additions.json", JSON.stringify(out,null,1));
console.log(`\nfetched ${out.length}/${pd.length} with images → data/incoming/canon-additions.json`);
