// Resolve each pool movement/culture to its English Wikipedia page (verified to exist) → data/movement-wiki.js
// { "High Renaissance": "https://en.wikipedia.org/wiki/High_Renaissance", ... }  (only entries that resolve)
import { readFileSync, writeFileSync } from "node:fs";
const UA="GessoWiki/1.0 (kathryn.swint@gmail.com)";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const w={}; new Function("window",readFileSync("data/pool.js","utf8"))(w);
const styles=[...new Set(w.ARTEFACTUM_POOL.map(p=>p.style).filter(Boolean))];
console.error(`resolving ${styles.length} movements/cultures…`);
async function wp(title){ const u=`https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageprops&ppprop=wikibase_item&redirects=1&titles=${encodeURIComponent(title)}`;
  for(let t=0;t<3;t++){ try{ const r=await fetch(u,{headers:{"User-Agent":UA}}); if(!r.ok){await sleep(800);continue;} const j=await r.json();
    const pages=(j.query&&j.query.pages)||{}; for(const k in pages){ const p=pages[k]; if(p.missing!==undefined)return null; return p.title; } return null;
  }catch(e){ await sleep(800); } } return null; }
const map={}; let ok=0;
for(let i=0;i<styles.length;i++){ const s=styles[i];
  // try the name as-is, then "<name> (art movement)"
  let title=await wp(s); if(!title){ await sleep(120); title=await wp(s+" (art movement)"); }
  if(title){ map[s]="https://en.wikipedia.org/wiki/"+encodeURIComponent(title.replace(/ /g,"_")); ok++; }
  if((i+1)%50===0) console.error(`  ${i+1}/${styles.length} · ${ok} resolved`);
  await sleep(140);
}
writeFileSync("data/movement-wiki.js","window.ARTEFACTUM_MOVEMENT_WIKI="+JSON.stringify(map)+";\n");
console.error(`\nwrote data/movement-wiki.js · ${ok}/${styles.length} resolved`);
