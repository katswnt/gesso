// Systematic fix for the place=nationality bug. For every Wikidata-sourced work, re-pull the AUTHORITATIVE
// place of CREATION — P1071 (location of creation → P17 country), else P495 (country of origin) — and
// override the stored `place` (which was often the artist's nationality). Recomputes region (continentOf)
// and centroid coords. Works without P1071/P495 are left untouched (can't determine). Plain Node + Wikidata
// (no Codex). Writes pool.js atomically. Run: node scripts/reconcile-where.mjs
import { readFileSync } from "node:fs";
import { readGlobal, writeAssignment } from "./lib/static-module.mjs";
import { canonicalizePlace, continentOf } from "./lib/places.mjs";
const UA="GessoWhereReconcile/1.0 (kathryn.swint@gmail.com)";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const win={}; new Function("window",readFileSync("data/countries.js","utf8"))(win);
const CO={}; for(const c of win.ARTEFACTUM_COUNTRIES) CO[c.n.toLowerCase()]=c;
function centroid(c){let big=c.r[0];for(const r of c.r)if(r.length>big.length)big=r;let sx=0,sy=0;for(const[x,y]of big){sx+=x;sy+=y;}return[Math.round(sy/big.length*1000)/1000,Math.round(sx/big.length*1000)/1000];}
async function sparql(q){const u="https://query.wikidata.org/sparql?format=json&query="+encodeURIComponent(q);
  for(let t=0;t<6;t++){try{const r=await fetch(u,{headers:{"User-Agent":UA,"Accept":"application/sparql-results+json"}});
    if(r.status===429||r.status>=500){await sleep(3000*(t+1));continue;}if(!r.ok){console.error("sparql",r.status);return null;}return await r.json();}
    catch(e){await sleep(1500*(t+1));}}return null;}

const pool=readGlobal("data/pool.js","ARTEFACTUM_POOL");
const qOf=id=>{const m=String(id).match(/Q\d+/);return m?m[0]:null;};
const wd=pool.filter(p=>qOf(p.id)); const byQ={}; for(const p of wd) byQ[qOf(p.id)]=p;
const qids=Object.keys(byQ);
console.error(`Wikidata works: ${qids.length} of ${pool.length}`);

const creation={}; // qid -> canonical country name
for(let i=0;i<qids.length;i+=140){
  const batch=qids.slice(i,i+140); const values=batch.map(q=>"wd:"+q).join(" ");
  // P1071 location of creation → its country (P17); fall back to P495 country of origin
  const q=`SELECT ?w ?locC ?orig WHERE { VALUES ?w { ${values} }
    OPTIONAL { ?w wdt:P1071 ?loc. ?loc wdt:P17 ?lc. ?lc rdfs:label ?locC. FILTER(LANG(?locC)="en") }
    OPTIONAL { ?w wdt:P495 ?o. ?o rdfs:label ?orig. FILTER(LANG(?orig)="en") } }`;
  const j=await sparql(q); await sleep(400);
  if(j) for(const b of j.results.bindings){ const w=qOf(b.w.value);
    const name=(b.locC&&b.locC.value)||(b.orig&&b.orig.value); if(!name)continue;
    const canon=canonicalizePlace(name); if(CO[canon.toLowerCase()]&&!creation[w]) creation[w]=canon; }
  if(i%1400===0) console.error(`  ${i}/${qids.length} queried, ${Object.keys(creation).length} with creation-place`);
}

let changed=0; const samples=[];
for(const q in creation){ const p=byQ[q]; const c=creation[q];
  if(p.place!==c){ if(samples.length<25) samples.push(`  "${(p.title||"").slice(0,34)}" ${p.place} → ${c}`);
    p.place=c; p.region=continentOf(c)||p.region; const co=CO[c.toLowerCase()]; if(co){const[la,ln]=centroid(co);p.lat=la;p.lng=ln;} changed++; } }
writeAssignment("data/pool.js","ARTEFACTUM_POOL",pool);
console.log(`\nworks with a Wikidata creation-place: ${Object.keys(creation).length} | place CHANGED: ${changed}`);
console.log(samples.join("\n"));
