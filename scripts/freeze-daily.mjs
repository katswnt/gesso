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
const out={};

// --- EASY = two bands so every daily is 4 instantly-recognizable icons + 1 very-recognizable work ---
const T1_SIZE=110, T2_SIZE=300; // T1 icons (canon + top pageviews), T2 recognizable
const T1ids = ranked.slice(0, T1_SIZE).map(p=>p.id);
const T2ids = ranked.slice(T1_SIZE, T1_SIZE+T2_SIZE).map(p=>p.id);
const T1s=seededShuffle(T1ids,"gesso-easy-t1-v2"), T2s=seededShuffle(T2ids,"gesso-easy-t2-v2");
const nBlocks=Math.max(Math.ceil(T1s.length/4), T2s.length); // cycle both bands fully
const easy=[];
for(let b=0;b<nBlocks;b++){ for(let k=0;k<4;k++) easy.push(T1s[(b*4+k)%T1s.length]); easy.push(T2s[b%T2s.length]); }
out.easy=easy; // length nBlocks*5; dailyItems windows by 5 → 4 T1 + 1 T2 per day

// --- MEDIUM / HARD / IMPOSSIBLE = the remaining works by recognizability, split in thirds ---
const rest=ranked.slice(T1_SIZE+T2_SIZE).map(p=>p.id); const r=rest.length;
const mc=[0, Math.round(r*0.34), Math.round(r*0.67), r];
["medium","hard","impossible"].forEach((k,i)=>{ out[k]=seededShuffle(rest.slice(mc[i],mc[i+1]),`gesso-daily-freeze-v2|${k}`); });

const easyDistinctCount = new Set([...T1ids, ...T2ids]).size;
out.meta = {
  version: 1,
  policy: "gesso-daily-freeze-v2",
  poolSize: n,
  easy: {
    t1Size: T1ids.length,
    t2Size: T2ids.length,
    t1PerDay: 4,
    t2PerDay: 1,
    distinctCount: easyDistinctCount,
    rotationCount: easy.length
  },
  tiers: {
    easy: { distinctCount: easyDistinctCount, rotationCount: easy.length },
    medium: { distinctCount: out.medium.length, rotationCount: out.medium.length },
    hard: { distinctCount: out.hard.length, rotationCount: out.hard.length },
    impossible: { distinctCount: out.impossible.length, rotationCount: out.impossible.length }
  }
};

writeFileSync("data/daily-order.js","window.ARTEFACTUM_DAILY="+JSON.stringify(out)+";\n");
console.log(`froze: easy ${easy.length} (T1 ${T1s.length} icons + T2 ${T2s.length}, 4+1/day) / medium ${out.medium.length} / hard ${out.hard.length} / impossible ${out.impossible.length}`);
console.log("Easy daily = 4 icons + 1 recognizable; icons recur ~"+Math.round(T1s.length/4)+"d");
