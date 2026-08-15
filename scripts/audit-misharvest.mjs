// Sweep for misharvested pool entries: Wikidata items that are NOT artworks (concepts, genres, events,
// deities, iconographic themes) that got imported as if they were objects — like Q1821239 "Day of Judgment"
// (a religious concept) carrying a Michelangelo image. Flags wd works whose P31 (instance of) contains no
// artwork-type class. Reports candidates to data/incoming/misharvest-flags.json (does NOT modify the pool).
//   node scripts/audit-misharvest.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { readGlobal } from "./lib/static-module.mjs";
import { loadWdEntities } from "./lib/wd-cache.mjs";

const qid = id => { const m = String(id||"").match(/Q\d+/); return m ? m[0] : null; };
// words in a P31 label that indicate a real physical artwork/object
const ARTWORK = /\b(painting|drawing|sculpture|statue|bust|relief|print|engraving|etching|lithograph|woodcut|woodblock|photograph|photo|fresco|mural|altarpiece|triptych|diptych|polyptych|manuscript|codex|folio|miniature|illumination|icon|panel|tapestry|textile|carpet|rug|embroidery|vase|vessel|bowl|dish|jar|ewer|cup|plate|amphora|krater|jug|bottle|flask|mask|figure|figurine|statuette|idol|pendant|brooch|ring|necklace|jewel|jewellery|jewelry|crown|coin|medal|seal|scroll|screen|fan|netsuke|inro|lacquer|ceramic|porcelain|earthenware|stoneware|faience|bronze|jade|ivory|carving|stele|stela|sarcophagus|tomb|monument|fountain|tapiss|artefact|artifact|artwork|work of art|art object|cultural (heritage|property)|object|furniture|chair|table|cabinet|clock|instrument|armour|armor|helmet|sword|dagger|shield|banner|flag|book|atlas|map|poster|tile|plaque|medallion|reliquary|monstrance|chalice|censer|thangka|byobu|ukiyo|drawing|watercolo|collage|assemblage|installation|tapestry)\b/i;

const pool = readGlobal("data/pool.js","ARTEFACTUM_POOL");
const wd = pool.filter(p => qid(p.id));
const qids = [...new Set(wd.map(p => qid(p.id)))];
console.error(`checking P31 for ${qids.length} Wikidata works...`);

// P31 + creator now come from the shared Wikidata cache (data/incoming/wd-entities.json) — no separate sweep.
const ents = await loadWdEntities(qids, { onProgress:(d,t)=>{ if(d%700<100) console.error(`  ${d}/${t} fetched`); } });
const info = new Map(); // qid -> {p31:Set<label>, hasCreator:bool}
for(const q of qids){ const e = ents.get(q) || { p31:[], creators:[] };
  info.set(q, { p31: new Set(e.p31.map(x=>x.l).filter(Boolean)), hasCreator: e.creators.length>0 }); }

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
