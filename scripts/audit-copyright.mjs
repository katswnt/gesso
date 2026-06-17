// Copyright audit: for every Wikidata-sourced pool work, look up the creator's death year via SPARQL
// and flag works whose creator died AFTER 1955 (our US-safe PD line — later deaths risk URAA/in-copyright).
// Read-only; writes data/incoming/copyright-flags.json for review. Run: node scripts/audit-copyright.mjs
import { readFileSync, writeFileSync } from "node:fs";
const UA="GessoCopyrightAudit/1.0 (kathryn.swint@gmail.com)";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const pool=JSON.parse(readFileSync("data/pool.js","utf8").match(/\[[\s\S]*\]/)[0]);
const qid=id=>{const m=String(id).match(/Q\d+/);return m?m[0]:null;};
const wdWorks=pool.filter(p=>qid(p.id)); // all wikidata-id works (museum-API works have no Q-id → skip; those are PD-curated collections)
const byQ=Object.fromEntries(wdWorks.map(p=>[qid(p.id),p]));
console.log("Wikidata-id works to audit:",wdWorks.length);
async function sparql(q){const u="https://query.wikidata.org/sparql?format=json&query="+encodeURIComponent(q);
  for(let t=0;t<6;t++){try{const r=await fetch(u,{headers:{"User-Agent":UA,"Accept":"application/sparql-results+json"}});
    if(r.status===429||r.status>=500){await sleep(3000*(t+1));continue;}if(!r.ok){console.error("  sparql",r.status);return null;}return await r.json();}catch(e){await sleep(1500*(t+1));}}return null;}
const flags=[]; const qids=Object.keys(byQ);
for(let i=0;i<qids.length;i+=150){
  const batch=qids.slice(i,i+150);
  const values=batch.map(q=>"wd:"+q).join(" ");
  const q=`SELECT ?work ?cl ?death WHERE { VALUES ?work { ${values} } ?work wdt:P170 ?c. ?c wdt:P570 ?d. ?c rdfs:label ?cl. FILTER(LANG(?cl)="en") BIND(YEAR(?d) AS ?death) }`;
  const j=await sparql(q); await sleep(500);
  if(j&&j.results){ for(const b of j.results.bindings){ if(!b.work||!b.death)continue; const q2=b.work.value.match(/Q\d+/)[0]; const death=+b.death.value;
    if(death>1955){ const p=byQ[q2]; if(p) flags.push({id:p.id,artist:p.artist,creator:b.cl?b.cl.value:(p.artist||""),death,title:p.title,y:p.y,src:p.src}); } } }
  if((i/150)%5===0) console.error(`  ${i}/${qids.length} | flagged ${flags.length}`);
}
// dedupe by id (a work can have multiple creators)
const seen=new Set(), uniq=flags.filter(f=>seen.has(f.id)?false:seen.add(f.id));
uniq.sort((a,b)=>b.death-a.death);
writeFileSync("data/incoming/copyright-flags.json",JSON.stringify(uniq,null,1));
console.log(`\nFLAGGED ${uniq.length} works by creators who died >1955 (review → likely drop)`);
const bySrc={}; uniq.forEach(f=>bySrc[f.src]=(bySrc[f.src]||0)+1); console.log("by src:",JSON.stringify(bySrc));
const byArtist={}; uniq.forEach(f=>byArtist[f.creator]=(byArtist[f.creator]||0)+1);
console.log("top creators:"); Object.entries(byArtist).sort((a,b)=>b[1]-a[1]).slice(0,25).forEach(([a,n])=>console.log("  "+String(n).padStart(3)+"  "+a));
