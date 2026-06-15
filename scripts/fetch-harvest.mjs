// Fetch full metadata for the harvested PD artworks (qids known) → pool-format entries in staging.
// Reads /tmp/harvest-novel.json [{title,artist,qid,...}]. Writes data/incoming/harvest-fetched.json.
// Run: node scripts/fetch-harvest.mjs
import { readFileSync, writeFileSync } from "node:fs";
const UA="GessoHarvest/1.0 (kathryn.swint@gmail.com)";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const novel=JSON.parse(readFileSync("/tmp/harvest-novel.json","utf8"));
global.window={}; new Function(readFileSync("data/countries.js","utf8"))();
const CO={}; for(const c of window.ARTEFACTUM_COUNTRIES) CO[c.n.toLowerCase()]=c;
const ALIAS={"united states":"united states of america","kingdom of the netherlands":"netherlands","people's republic of china":"china","czech republic":"czechia"};
function toCountry(l){ if(!l)return ""; let c=l.toLowerCase().trim(); c=ALIAS[c]||c; if(CO[c])return CO[c].n; const s=c.replace(/^(the )?(kingdom|republic|state|grand duchy|duchy|empire|crown) of (the )?/,""); return CO[s]?CO[s].n:""; }
const CONT={"united states of america":"North America","canada":"North America","mexico":"North America","brazil":"South America","argentina":"South America",
  "egypt":"Africa","nigeria":"Africa","china":"Asia","japan":"Asia","india":"Asia","iran":"Asia","turkey":"Asia","french polynesia":"Oceania","australia":"Oceania"};
const contOf=c=>CONT[c.toLowerCase()]||"Europe";

async function wd(url){ for(let t=0;t<4;t++){ try{ const r=await fetch(url,{headers:{"User-Agent":UA}}); if(r.status===429||r.status>=500){await sleep(1500*(t+1));continue;} if(!r.ok)return null; return await r.json(); }catch(e){await sleep(1000*(t+1));} } return null; }
const claim=(e,p)=>{const c=e.claims&&e.claims[p];return c&&c[0]&&c[0].mainsnak&&c[0].mainsnak.datavalue?c[0].mainsnak.datavalue.value:null;};
const qOf=v=>v&&v.id?v.id:null;
async function label(q){ if(!q)return ""; const j=await wd(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=labels&languages=en&ids=${q}`); const e=j&&j.entities&&j.entities[q]; return e&&e.labels&&e.labels.en?e.labels.en.value:""; }
async function countryOf(q){ if(!q)return ""; const j=await wd(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims|labels&languages=en&ids=${q}`); const e=j&&j.entities&&j.entities[q]; if(!e)return ""; const c=qOf(claim(e,"P17")); if(c)return await label(c); return e.labels&&e.labels.en?e.labels.en.value:""; }

const out=[]; let noimg=0;
for(const m of novel){ const qid=m.qid; if(!qid)continue;
  const j=await wd(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims|labels&languages=en&ids=${qid}`); await sleep(150);
  const e=j&&j.entities&&j.entities[qid]; if(!e){continue;}
  const img=claim(e,"P18"); if(!img){noimg++; continue;}
  const inc=claim(e,"P571"); let y=null; if(inc&&inc.time){const mm=inc.time.match(/([+-]\d+)/); if(mm)y=parseInt(mm[1],10);}
  const creator=await label(qOf(claim(e,"P170")))||m.artist||""; await sleep(100);
  const locQ=qOf(claim(e,"P1071"))||qOf(claim(e,"P276")); const placeRaw=locQ?await countryOf(locQ):""; await sleep(100);
  const place=toCountry(placeRaw)||"";
  const material=await label(qOf(claim(e,"P186")))||""; await sleep(100);
  const movement=await label(qOf(claim(e,"P135")))||""; await sleep(100);
  out.push({ id:"wikidata:"+qid, title:m.title, artist:creator, y, place, region:place?contOf(place):"Europe",
    medium:material, style:movement, styleKind:movement?"movement":"",
    img:`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(img)}?width=900`, src:"wd-harvest", harvest:true });
  console.error(`✓ ${m.title} | ${y||"?"} | ${place||"?"} | ${creator.slice(0,18)}`);
}
writeFileSync("data/incoming/harvest-fetched.json", JSON.stringify(out,null,1));
console.log(`\nfetched ${out.length}/${novel.length} (${noimg} had no P18 image) → data/incoming/harvest-fetched.json`);
