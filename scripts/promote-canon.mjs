// Promote the 52 enriched canon icons into the live pool + merge their notes into teach-works.js.
// Tags each with canon:true (Easy T1). Run: node scripts/promote-canon.mjs
import { readFileSync, writeFileSync } from "node:fs";
const adds=JSON.parse(readFileSync("data/incoming/canon-additions.json","utf8"));
const notes=JSON.parse(readFileSync("/tmp/canon-notes-all.json","utf8"));
const noteById=Object.fromEntries(notes.map(n=>[n.id,n]));
global.window={}; new Function(readFileSync("data/countries.js","utf8"))();
const CO={}; for(const c of window.ARTEFACTUM_COUNTRIES) CO[c.n.toLowerCase()]=c;
function centroid(c){ let big=c.r[0]; for(const r of c.r) if(r.length>big.length) big=r; let sx=0,sy=0; for(const[x,y]of big){sx+=x;sy+=y;} return [Math.round(sy/big.length*1000)/1000,Math.round(sx/big.length*1000)/1000]; }
const CONT={ "italy":"Europe","france":"Europe","netherlands":"Europe","spain":"Europe","greece":"Europe","norway":"Europe","austria":"Europe","belgium":"Europe","united kingdom":"Europe","germany":"Europe","vatican city":"Europe",
  "egypt":"Africa","china":"Asia","people's republic of china":"Asia","united states":"North America","united states of america":"North America","mexico":"North America","french polynesia":"Oceania" };
const ALIAS={"united states":"united states of america","people's republic of china":"china","french polynesia":null,"vatican city":"italy"};

const raw=readFileSync("data/pool.js","utf8");
const pool=JSON.parse(raw.slice(raw.indexOf("["),raw.lastIndexOf("]")+1));
const have=new Set(pool.map(p=>p.id));

let added=0, skipped=0;
for(const w of adds){ const n=noteById[w.id]; if(!n){ skipped++; continue; } if(have.has(w.id)){ skipped++; continue; }
  const placeName=(n.place||w.place||"").trim();
  let coKey=placeName.toLowerCase(); coKey=(coKey in ALIAS)?ALIAS[coKey]:coKey;
  const co=coKey&&CO[coKey]; const [lat,lng]= co?centroid(co):[null,null];
  const region=CONT[placeName.toLowerCase()]||"Europe";
  pool.push({ id:w.id, title:w.title, artist:w.artist||"", y:(n.y!=null?n.y:w.y),
    lat, lng, medium:n.medium||w.medium||"", place:placeName, fame:200, // fame placeholder; Easy uses canon flag + pageviews
    img:w.img, src:"wd-canon", region, style:n.style||w.style||"", styleKind:n.styleKind||w.styleKind||"", canon:true });
  added++;
}
writeFileSync("data/pool.js", raw.slice(0,raw.indexOf("["))+JSON.stringify(pool)+raw.slice(raw.lastIndexOf("]")+1));

// merge notes into teach-works.js
global.window.ARTEFACTUM_CUES=undefined; new Function(readFileSync("data/teach-works.js","utf8"))();
const CUES=window.ARTEFACTUM_CUES; CUES.work=CUES.work||{};
let notesAdded=0;
for(const n of notes){ if(!CUES.work[n.id]){ CUES.work[n.id]={why:n.why,cues:n.cues,guide:n.guide}; notesAdded++; } }
writeFileSync("data/teach-works.js","window.ARTEFACTUM_CUES="+JSON.stringify(CUES)+";\n");

console.log(`promoted ${added} canon icons (skipped ${skipped}) | pool now ${pool.length} | notes added ${notesAdded}`);
const noCoord=pool.filter(p=>p.canon&&(p.lat==null)).map(p=>p.title);
if(noCoord.length) console.log("WARN no coords (place unmapped):",noCoord.join(", "));
