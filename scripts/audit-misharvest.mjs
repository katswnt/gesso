// Sweep for misharvested pool entries: Wikidata items that are NOT artworks (concepts, genres, events,
// deities, iconographic themes) that got imported as if they were objects — like Q1821239 "Day of Judgment"
// (a religious concept) carrying a Michelangelo image. Flags wd works whose P31 (instance of) contains no
// artwork-type class. Reports candidates to data/incoming/misharvest-flags.json (does NOT modify the pool).
//   node scripts/audit-misharvest.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { readGlobal } from "./lib/static-module.mjs";

const UA = "GessoMisharvestAudit/1.0 (kathryn.swint@gmail.com)";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const qid = id => { const m = String(id||"").match(/Q\d+/); return m ? m[0] : null; };
// words in a P31 label that indicate a real physical artwork/object
const ARTWORK = /\b(painting|drawing|sculpture|statue|bust|relief|print|engraving|etching|lithograph|woodcut|woodblock|photograph|photo|fresco|mural|altarpiece|triptych|diptych|polyptych|manuscript|codex|folio|miniature|illumination|icon|panel|tapestry|textile|carpet|rug|embroidery|vase|vessel|bowl|dish|jar|ewer|cup|plate|amphora|krater|jug|bottle|flask|mask|figure|figurine|statuette|idol|pendant|brooch|ring|necklace|jewel|jewellery|jewelry|crown|coin|medal|seal|scroll|screen|fan|netsuke|inro|lacquer|ceramic|porcelain|earthenware|stoneware|faience|bronze|jade|ivory|carving|stele|stela|sarcophagus|tomb|monument|fountain|tapiss|artefact|artifact|artwork|work of art|art object|cultural (heritage|property)|object|furniture|chair|table|cabinet|clock|instrument|armour|armor|helmet|sword|dagger|shield|banner|flag|book|atlas|map|poster|tile|plaque|medallion|reliquary|monstrance|chalice|censer|thangka|byobu|ukiyo|drawing|watercolo|collage|assemblage|installation|tapestry)\b/i;

const pool = readGlobal("data/pool.js","ARTEFACTUM_POOL");
const wd = pool.filter(p => qid(p.id));
const qids = [...new Set(wd.map(p => qid(p.id)))];
console.error(`checking P31 for ${qids.length} Wikidata works...`);

async function sparql(qy){
  const u = "https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(qy);
  for(let t=0;t<5;t++){ try{ const r = await fetch(u,{headers:{"User-Agent":UA,Accept:"application/sparql-results+json"}});
    if(r.status===429||r.status>=500){ await sleep(3000*(t+1)); continue; } if(!r.ok) return null; return await r.json();
  }catch{ await sleep(1500*(t+1)); } } return null;
}

const info = new Map(); // qid -> {p31:Set<label>, hasCreator:bool}
for(let i=0;i<qids.length;i+=140){
  const values = qids.slice(i,i+140).map(q=>"wd:"+q).join(" ");
  const j = await sparql(`SELECT ?w ?p31Label ?creator WHERE {
    VALUES ?w { ${values} }
    OPTIONAL { ?w wdt:P31 ?p31. }
    OPTIONAL { ?w wdt:P170 ?creator. }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`);
  await sleep(400);
  for(const b of (j?.results?.bindings||[])){
    const q = qid(b.w?.value); if(!q) continue;
    if(!info.has(q)) info.set(q, { p31:new Set(), hasCreator:false });
    const e = info.get(q);
    if(b.p31Label?.value && !/^Q\d+$/.test(b.p31Label.value)) e.p31.add(b.p31Label.value);
    if(b.creator?.value) e.hasCreator = true;
  }
  if((i+140)%700<140) console.error(`  ${Math.min(i+140,qids.length)}/${qids.length}`);
}

const byQ = new Map(); for(const p of wd){ const q=qid(p.id); if(!byQ.has(q)) byQ.set(q,p); }
const flags = [];
for(const [q,e] of info){
  const p31s = [...e.p31];
  const isArtwork = p31s.some(l => ARTWORK.test(l));
  if(p31s.length && !isArtwork){ // typed, but as something that isn't an artwork → suspicious
    const p = byQ.get(q);
    flags.push({ id: p.id, title: p.title, artist: p.artist||"", p31: p31s, hasCreator: e.hasCreator });
  }
}
// most-suspicious first: no creator + concept-like P31
flags.sort((a,b)=> (a.hasCreator?1:0)-(b.hasCreator?1:0));
console.log(`\nflagged ${flags.length} works whose Wikidata P31 is NOT an artwork type (of ${qids.length} wd works)`);
for(const f of flags.slice(0,40)) console.log(`  ${f.hasCreator?"[has-creator] ":"[NO-creator]  "}${f.title.slice(0,34).padEnd(35)} p31=${f.p31.join(", ").slice(0,55)}`);
writeFileSync("data/incoming/misharvest-flags.json", JSON.stringify(flags,null,1));
console.log(`\nfull list → data/incoming/misharvest-flags.json`);
