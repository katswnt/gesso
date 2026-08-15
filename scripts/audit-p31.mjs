// Catch wrong-image title-collisions + non-artworks CHEAPLY (no vision): check each Wikidata work's
// P31 (instance-of). Real artworks are painting/sculpture/print/etc.; collisions are city/taxon/series/
// building/concept. Flags everything whose P31 has NO artwork type → data/incoming/p31-flags.json.
// Run: node scripts/audit-p31.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { loadWdEntities } from "./lib/wd-cache.mjs";
const pool=JSON.parse(readFileSync("data/pool.js","utf8").match(/\[[\s\S]*\]/)[0]);
const qid=id=>{const m=String(id).match(/Q\d+/);return m?m[0]:null;};
const wd=pool.filter(p=>qid(p.id));
// Q-ids that ARE artwork types (instance-of these = legit)
const ARTWORK=new Set(["Q3305213","Q860861","Q11060274","Q93184","Q18761202","Q125191","Q838948","Q4502142","Q179700","Q207628","Q87167","Q2772772"]); // painting, sculpture, print, drawing, etching, photograph, work of art, visual artwork, etc. (regex on label is the main check)
// names treated as artwork (fallback by label keyword)
const ARTWORK_RE=/\b(painting|sculpture|drawing|print|etching|engraving|lithograph|woodcut|fresco|altarpiece|triptych|portrait|still life|watercolo|artwork|work of art|statue|bust|relief|tapestry|manuscript|miniature|icon|mural|mosaic|ceramic|vase|pottery|figurine|stele|stela|sarcophagus|mask|jewellery|jewelry|vessel|installation|drawing|collage|photograph)\b/i;

// P31 now comes from the shared Wikidata cache (data/incoming/wd-entities.json) — no separate sweep.
const ents=await loadWdEntities(wd.map(p=>qid(p.id)), { onProgress:(d,t)=>{ if(d%800<100) console.error(`  ${d}/${t} fetched`); } });
const inst={}; for(const p of wd){ const q=qid(p.id); inst[q]=(ents.get(q)?.p31)||[]; }
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
