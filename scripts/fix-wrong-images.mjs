import { readFileSync, writeFileSync } from "node:fs";
const C="https://commons.wikimedia.org/wiki/Special:FilePath/";
const img=f=>C+encodeURIComponent(f)+"?width=900";
const raw=readFileSync("data/pool.js","utf8");
let pool=JSON.parse(raw.slice(raw.indexOf("["),raw.lastIndexOf("]")+1));
// 1) fix the two title-collision works: correct id + image + facts (migrate notes)
const FIX={
 "wikidata:Q156901": {id:"wikidata:Q2282256", img:img("Irises-Vincent van Gogh.jpg"), place:"France", y:1889, region:"Europe"},
 "http://www.wikidata.org/entity/Q42735": {id:"wikidata:Q737062", img:img("Edouard Manet - Olympia - Google Art Project 3.jpg"), place:"France", y:1863, region:"Europe"},
 "wikidata:Q42735": {id:"wikidata:Q737062", img:img("Edouard Manet - Olympia - Google Art Project 3.jpg"), place:"France", y:1863, region:"Europe"},
};
global.window={}; new Function(readFileSync("data/teach-works.js","utf8"))();
const CUES=window.ARTEFACTUM_CUES; CUES.work=CUES.work||{};
let fixed=0;
for(const p of pool){ const f=FIX[p.id]; if(f){ const old=p.id; if(CUES.work[old]&&!CUES.work[f.id]) CUES.work[f.id]=CUES.work[old];
  Object.assign(p,f); fixed++; } }
// 2) remove genuine non-artworks (cities, buildings, unit) — KEEP sculptures/monuments
const REMOVE=new Set(["Tipasa","Eryx","Tzistarakis Mosque","Santa Prassede","saa","Gargantua","Skull Tower","Burj al-Rus","Black Paintings"]);
const before=pool.length;
const removed=pool.filter(p=>REMOVE.has(p.title)).map(p=>p.title);
pool=pool.filter(p=>!REMOVE.has(p.title));
writeFileSync("data/pool.js", raw.slice(0,raw.indexOf("["))+JSON.stringify(pool)+raw.slice(raw.lastIndexOf("]")+1));
writeFileSync("data/teach-works.js","window.ARTEFACTUM_CUES="+JSON.stringify(CUES)+";\n");
console.log("fixed collisions (Irises, Olympia):",fixed,"| removed non-art:",removed.join(", "),"| pool",before,"→",pool.length);
