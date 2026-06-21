// Pool-wide dedup: same Wikidata Q-id (pulled twice under http:// vs wikidata: prefixes) + shared image.
// Keeps the entry with teaching notes / richest fields / highest pageviews. Also drops named non-artworks.
// Run: node scripts/dedup-pool.mjs
import { readFileSync, writeFileSync } from "node:fs";
const raw=readFileSync("data/pool.js","utf8");
let pool=JSON.parse(raw.slice(raw.indexOf("["),raw.lastIndexOf("]")+1));
const fame=JSON.parse(readFileSync("data/fame.json","utf8"));
global.window={}; new Function(readFileSync("data/teach-works.js","utf8"))();
const NOTES=window.ARTEFACTUM_CUES.work||{};
const pv=id=>fame[id]&&fame[id].pageviews||0;
const dec=s=>{try{return decodeURIComponent(s)}catch{return s}};
const qid=id=>{const m=String(id).match(/Q\d+/);return m?m[0]:null};
const h=v=>v&&String(v).trim();
const score=p=>(NOTES[p.id]?1e6:0)+(h(p.medium)?1:0)+(h(p.style)?1:0)+(h(p.artist)?1:0)+(p.lat!=null?1:0)+pv(p.id)/1e7;

const before=pool.length;
// 1) drop named non-artworks (fashion, prayers, etc.)
const DROP=/^(tahajjud|meat dress)|meat dress of lady gaga/i;
const droppedNonart=pool.filter(p=>DROP.test((p.title||"").trim())).map(p=>p.title);
pool=pool.filter(p=>!DROP.test((p.title||"").trim()));

// 2) dedup by Q-id, then by shared image — keep best-scoring entry
function dedup(keyFn,label){
  const groups={}; for(const p of pool){ const k=keyFn(p); if(k) (groups[k]=groups[k]||[]).push(p); }
  const drop=new Set(); let n=0;
  for(const k in groups){ const g=groups[k]; if(g.length<2) continue;
    g.sort((a,b)=>score(b)-score(a)); for(const p of g.slice(1)){ drop.add(p.id); n++; } }
  pool=pool.filter(p=>!drop.has(p.id));
  console.log(`dedup by ${label}: removed ${n}`);
}
dedup(p=>qid(p.id), "Q-id");
dedup(p=>dec((p.img||"").replace(/[?&]width=\d+/,"").toLowerCase()), "image");

writeFileSync("data/pool.js", raw.slice(0,raw.indexOf("["))+JSON.stringify(pool)+raw.slice(raw.lastIndexOf("]")+1));
console.log("dropped non-artworks:", droppedNonart.join(", ")||"(none)");
console.log("pool:", before, "→", pool.length, "(removed", before-pool.length+")");
