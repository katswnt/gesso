// Freeze a STABLE per-tier daily ordering by work ID, so dailies never drift when fame/pool changes.
// Tiers are computed from the current fame ordering, then each tier's IDs are deterministically shuffled
// into a fixed rotation. Re-run only when you deliberately want to reset the rotation.
// Run: node scripts/freeze-daily.mjs
import { readFileSync, writeFileSync } from "node:fs";
const pool = JSON.parse(readFileSync("data/pool.js","utf8").replace("window.ARTEFACTUM_POOL = ","").replace(/;\s*$/,""));
const overlay = JSON.parse(readFileSync("data/fame.js","utf8").replace("window.ARTEFACTUM_FAME=","").replace(/;\s*$/,""));
const poolFame = Object.fromEntries(pool.map(p=>[p.id, p.fame||0])); // fallback for freshly-promoted works not yet in the overlay — matches buildIndexes
const fameOf = id => overlay[id]!=null ? overlay[id] : (poolFame[id]||0);

// deterministic PRNG + shuffle (seeded), independent of fame so the order is frozen
function seedHash(s){let h=1779033703^s.length;for(let i=0;i<s.length;i++){h=Math.imul(h^s.charCodeAt(i),3432918353);h=h<<13|h>>>19;}return h>>>0;}
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function seededShuffle(arr,seedStr){const r=mulberry32(seedHash(seedStr));const a=arr.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}

const ranked = pool.slice().sort((a,b)=>fameOf(b.id)-fameOf(a.id));
const n = ranked.length;
const cuts=[0, Math.round(n*0.10), Math.round(n*0.35), Math.round(n*0.65), n];
const keys=["easy","medium","hard","impossible"];
const out={};
keys.forEach((k,i)=>{ const ids=ranked.slice(cuts[i],cuts[i+1]).map(p=>p.id); out[k]=seededShuffle(ids,`gesso-daily-freeze-v1|${k}`); });
writeFileSync("data/daily-order.js","window.ARTEFACTUM_DAILY="+JSON.stringify(out)+";\n");
console.log("froze daily order:", keys.map(k=>`${k} ${out[k].length}`).join(" / "), "— each work recurs no sooner than (len/5) days:", keys.map(k=>`${k} ~${Math.round(out[k].length/5)}d`).join(", "));
