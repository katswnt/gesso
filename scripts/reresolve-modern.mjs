// Re-resolve the modern works that fetch-modern dropped as "no image" — pick the search candidate
// that actually has P18 + inception<1931. Appends keepers to data/incoming/modern-fetched.json.
import { readFileSync, writeFileSync } from "node:fs";
const UA="GessoModern/1.0 (kathryn.swint@gmail.com)";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const poolQ=new Set(JSON.parse(readFileSync("data/pool.js","utf8").match(/\[[\s\S]*\]/)[0]).map(p=>{const m=String(p.id).match(/Q\d+/);return m?m[0]:null;}).filter(Boolean));
const have=new Set(JSON.parse(readFileSync("data/incoming/modern-fetched.json","utf8")).map(x=>x.id.match(/Q\d+/)[0]));
global.window={}; new Function(readFileSync("data/countries.js","utf8"))();
const CO={}; for(const c of window.ARTEFACTUM_COUNTRIES) CO[c.n.toLowerCase()]=c;
const ALIAS={"united states":"united states of america","kingdom of the netherlands":"netherlands"};
const toCountry=l=>{if(!l)return"";let c=l.toLowerCase().trim();c=ALIAS[c]||c;return CO[c]?CO[c].n:""};
const CONT={"united states of america":"North America","russia":"Europe","france":"Europe","germany":"Europe","austria":"Europe","netherlands":"Europe","norway":"Europe","italy":"Europe","spain":"Europe","switzerland":"Europe"};
const targets=[
 {title:"Danaë",surname:"klimt"},
 {title:"Death and the Maiden",surname:"schiele"},
 {title:"The Family",surname:"schiele"},
 {title:"Madonna",surname:"munch"},
 {title:"Vampire",surname:"munch"},
 {title:"The Joy of Life",surname:"matisse"},
 {title:"Goldfish",surname:"matisse"},
 {title:"Harmony in Red",surname:"matisse"},
 {title:"Black Square",surname:"malevich"},
 {title:"The Dream",surname:"rousseau"},
 {title:"The Turning Road, L'Estaque",surname:"derain"},
 {title:"The Cyclops",surname:"redon"},
 {title:"Schloss Kammer Park",surname:"klimt"},
];
async function wd(u){for(let t=0;t<4;t++){try{const r=await fetch(u,{headers:{"User-Agent":UA}});if(r.status===429||r.status>=500){await sleep(1500*(t+1));continue;}if(!r.ok)return null;return await r.json();}catch(e){await sleep(900);}}return null;}
const claim=(e,p)=>{const c=e.claims&&e.claims[p];return c&&c[0]&&c[0].mainsnak&&c[0].mainsnak.datavalue?c[0].mainsnak.datavalue.value:null;};
const qOf=v=>v&&v.id?v.id:null;
const yearOf=t=>{if(!t||!t.time)return null;const m=t.time.match(/([+-]\d+)/);return m?parseInt(m[1],10):null;};
async function label(q){if(!q)return"";const j=await wd(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=labels&languages=en&ids=${q}`);const e=j&&j.entities&&j.entities[q];return e&&e.labels&&e.labels.en?e.labels.en.value:"";}
async function deathYear(q){if(!q)return null;const e=(await wd(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims&ids=${q}`)).entities[q];return e?yearOf(claim(e,"P570")):null;}
async function countryOf(q){if(!q)return"";const e=(await wd(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims|labels&languages=en&ids=${q}`)).entities[q];if(!e)return"";const c=qOf(claim(e,"P17"));return c?await label(c):(e.labels&&e.labels.en?e.labels.en.value:"");}
const out=JSON.parse(readFileSync("data/incoming/modern-fetched.json","utf8")); const added=[];
for(const m of targets){
  const j=await wd(`https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&type=item&limit=12&search=${encodeURIComponent(m.title)}`);
  const ids=(j&&j.search||[]).filter(x=>(x.description||"").toLowerCase().includes(m.surname)).map(x=>x.id); await sleep(150);
  if(!ids.length){console.log("✗ no cands —",m.title);continue;}
  const ej=await wd(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims|labels&languages=en&ids=${ids.join("|")}`); await sleep(150);
  let pick=null;
  for(const id of ids){const e=ej.entities[id]; if(!e)continue; const img=claim(e,"P18"); if(!img)continue;
    const y=yearOf(claim(e,"P571")); if(y!=null&&y>=1931)continue; pick={id,e,img,y}; break;}
  if(!pick){console.log("✗ none w/ PD image —",m.title);continue;}
  if(poolQ.has(pick.id)||have.has(pick.id)){console.log("· dup —",m.title,pick.id);continue;}
  const e=pick.e;
  const creatorQ=qOf(claim(e,"P170")); const dY=await deathYear(creatorQ); await sleep(120);
  if(dY!=null&&dY>1955){console.log("✗ creator d."+dY+" —",m.title);continue;}
  const creator=await label(creatorQ)||m.artist; await sleep(100);
  const placeRaw=await countryOf(qOf(claim(e,"P1071"))||qOf(claim(e,"P276"))); await sleep(100);
  const place=toCountry(placeRaw)||"";
  const medium=await label(qOf(claim(e,"P186")))||""; await sleep(100);
  const movement=await label(qOf(claim(e,"P135")))||""; await sleep(100);
  const rec={id:"wikidata:"+pick.id,title:m.title,artist:creator,y:pick.y,place,region:place?(CONT[place.toLowerCase()]||"Europe"):"Europe",
    medium,style:movement,styleKind:movement?"movement":"",img:`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(pick.img)}?width=900`,src:"wd-modern"};
  out.push(rec); have.add(pick.id); added.push(rec);
  console.log(`✓ ${m.title} — ${creator} | ${pick.y||"?"} | d.${dY||"?"} | ${place||"?"} | ${pick.id}`);
}
writeFileSync("data/incoming/modern-fetched.json",JSON.stringify(out,null,1));
console.log(`\nrecovered ${added.length} | total fetched now ${out.length}`);
