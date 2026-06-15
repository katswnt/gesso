// Catch wrong-image title-collisions + non-artworks CHEAPLY (no vision): check each Wikidata work's
// P31 (instance-of). Real artworks are painting/sculpture/print/etc.; collisions are city/taxon/series/
// building/concept. Flags everything whose P31 has NO artwork type → data/incoming/p31-flags.json.
// Run: node scripts/audit-p31.mjs
import { readFileSync, writeFileSync } from "node:fs";
const UA="GessoP31/1.0 (kathryn.swint@gmail.com)";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const pool=JSON.parse(readFileSync("data/pool.js","utf8").match(/\[[\s\S]*\]/)[0]);
const qid=id=>{const m=String(id).match(/Q\d+/);return m?m[0]:null;};
const wd=pool.filter(p=>qid(p.id));
// Q-ids that ARE artwork types (instance-of these = legit)
const ARTWORK=new Set(["Q3305213","Q860861","Q11060274","Q93184","Q18761202","Q125191","Q838948","Q4502142","Q179700","Q207628","Q87167","Q2772772"]); // painting, sculpture, print, drawing, etching, photograph, work of art, visual artwork, etc. (regex on label is the main check)
// names treated as artwork (fallback by label keyword)
const ARTWORK_RE=/\b(painting|sculpture|drawing|print|etching|engraving|lithograph|woodcut|fresco|altarpiece|triptych|portrait|still life|watercolo|artwork|work of art|statue|bust|relief|tapestry|manuscript|miniature|icon|mural|mosaic|ceramic|vase|pottery|figurine|stele|stela|sarcophagus|mask|jewellery|jewelry|vessel|installation|drawing|collage|photograph)\b/i;

async function batch(qids){
  const q=`SELECT ?w ?wLabel ?t ?tLabel WHERE { VALUES ?w { ${qids.map(x=>"wd:"+x).join(" ")} } OPTIONAL { ?w wdt:P31 ?t } SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`;
  for(let t=0;t<4;t++){ try{ const r=await fetch("https://query.wikidata.org/sparql?format=json&query="+encodeURIComponent(q),{headers:{"User-Agent":UA,"Accept":"application/sparql-results+json"}});
    if(r.status===429||r.status>=500){await sleep(2000*(t+1));continue;} if(!r.ok)return null; return (await r.json()).results.bindings; }catch(e){await sleep(1500*(t+1));} } return null;
}
const inst={}; const B=80;
for(let i=0;i<wd.length;i+=B){ const ids=wd.slice(i,i+B).map(p=>qid(p.id));
  const rows=await batch(ids);
  if(rows) for(const b of rows){ const w=b.w.value.split("/").pop(); const tQ=b.t?b.t.value.split("/").pop():null; const tL=b.tLabel?b.tLabel.value:"";
    (inst[w]=inst[w]||[]).push({q:tQ,l:tL}); }
  if(i%800===0) console.error(`  ${i}/${wd.length}`); await sleep(250);
}
writeFileSync("data/incoming/p31-raw.json", JSON.stringify(inst));
// BLOCKLIST: instance-of types that an actual artwork can NEVER be → genuine collision / non-artwork
const NONART_RE=/\b(city|town|municipality|human settlement|capital|village|commune|taxon|genus|species|family of plants|monotypic|breed|given name|family name|surname|male given name|female given name|building|church building|mosque|cathedral|temple|basilica|palace|tower|country|sovereign state|nation|battle|military conflict|war|treaty|event|holiday|religion|religious concept|prayer|ritual|river|mountain|lake|island|peninsula|geographic|unit of|profession|occupation|wikimedia|disambiguation)\b/i;
const flags=[];
for(const p of wd){ const q=qid(p.id); const types=inst[q]||[];
  const labels=types.map(t=>t.l).filter(Boolean);
  const bad=labels.some(l=>NONART_RE.test(l));
  if(bad) flags.push({id:p.id,title:p.title,artist:p.artist,instanceOf:labels.join(", ")||"(none)"});
}
writeFileSync("data/incoming/p31-flags.json", JSON.stringify(flags,null,1));
console.log(`\n${wd.length} Wikidata works checked | ${flags.length} flagged as NON-artwork instance-of:`);
flags.slice(0,40).forEach(f=>console.log(`  ✗ ${f.title.slice(0,40).padEnd(40)} → ${f.instanceOf.slice(0,45)}`));
