// Freeze a STABLE per-tier daily ordering by work ID, so dailies never drift when fame/pool changes.
// Tiers are computed from the current fame ordering, then each tier's IDs are deterministically shuffled
// into a fixed rotation. Re-run only when you deliberately want to reset the rotation.
// Run: node scripts/freeze-daily.mjs
import { readFileSync, writeFileSync } from "node:fs";
const pool = JSON.parse(readFileSync("data/pool.js","utf8").replace("window.ARTEFACTUM_POOL = ","").replace(/;\s*$/,""));
const overlay = JSON.parse(readFileSync("data/fame.js","utf8").replace("window.ARTEFACTUM_FAME=","").replace(/;\s*$/,""));
const poolFame = Object.fromEntries(pool.map(p=>[p.id, p.fame||0])); // fallback for freshly-promoted works not yet in the overlay — matches buildIndexes
const fameOf = id => overlay[id]!=null ? overlay[id] : (poolFame[id]||0);

// --- daily diversity: no two works by the same NAMED artist in one day's set; soft region/era spread ---
const byId = Object.fromEntries(pool.map(p=>[p.id,p]));
const namedArtist = id => { const a=String(byId[id]?.artist||"").trim(); return (a && !/^(unknown|anonymous|unidentified)/i.test(a)) ? a.toLowerCase() : ""; };
const regionOf = id => byId[id]?.region||"";
const centOf = id => { const y=byId[id]?.y; return y==null?"~":Math.floor(y/100); };
// Reorder so any window of `win` consecutive avoids a repeated NAMED artist (hard) and spreads region+century (soft).
function diversify(ids, win){
  const rem=ids.slice(), out=[];
  while(rem.length){
    const recent=out.slice(-(win-1));
    const ra=recent.map(namedArtist).filter(Boolean), rr=recent.map(regionOf), rc=recent.map(centOf);
    let bestI=0, best=Infinity;
    for(let i=0;i<rem.length;i++){ const id=rem[i], a=namedArtist(id);
      const score=(a&&ra.includes(a)?1000:0)+(rr.includes(regionOf(id))?2:0)+(rc.includes(centOf(id))?1:0)+i*0.0001;
      if(score<best){best=score;bestI=i; if(best<0.5)break;} }
    out.push(rem.splice(bestI,1)[0]);
  }
  return out;
}

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
// Easy keeps the 4-icons + 1-recognizable structure (recognizability rule untouched); diversity only REORDERS
// within the bands — never swaps an icon out. T1 diversified so each day's 4 icons have distinct artists +
// region/era spread; T2 picked to not repeat a named artist already in that day's icons. Region stays soft
// (Easy is ~91% European — can't be forced diverse without breaking the canon rule).
const T1s=diversify(seededShuffle(T1ids,"gesso-easy-t1-v2"),4), T2q=seededShuffle(T2ids,"gesso-easy-t2-v2");
const nBlocks=Math.max(Math.ceil(T1s.length/4), T2q.length); // cycle both bands fully
const easy=[]; let t2i=0;
for(let b=0;b<nBlocks;b++){
  const four=[]; for(let k=0;k<4;k++) four.push(T1s[(b*4+k)%T1s.length]);
  const fa=four.map(namedArtist).filter(Boolean);
  let t2=T2q[t2i%T2q.length];
  for(let tries=0; tries<T2q.length && fa.includes(namedArtist(t2)); tries++){ t2i++; t2=T2q[t2i%T2q.length]; }
  t2i++; easy.push(...four, t2);
}
out.easy=easy; // length nBlocks*5; dailyItems windows by 5 → 4 T1 + 1 T2 per day

// --- MEDIUM / HARD / IMPOSSIBLE = the remaining works by recognizability, split in thirds ---
const rest=ranked.slice(T1_SIZE+T2_SIZE).map(p=>p.id); const r=rest.length;
const mc=[0, Math.round(r*0.34), Math.round(r*0.67), r];
["medium","hard","impossible"].forEach((k,i)=>{ out[k]=diversify(seededShuffle(rest.slice(mc[i],mc[i+1]),`gesso-daily-freeze-v2|${k}`),5); });

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

// --- PER-DATE LOCK: preserve already-served days, (re)generate only future dates from the new order ---
// so adding works / re-freezing never disturbs today or the past. byDate[YYYY-MM-DD][tier] = [5 ids].
{ let prior={}; try{ const s=readFileSync("data/daily-order.js","utf8"); prior=(JSON.parse(s.slice(s.indexOf("{"),s.lastIndexOf("}")+1)).byDate)||{}; }catch{}
  const RND=5, TRS=["easy","medium","hard","impossible"];
  const tk2=p=>String(p&&p.title||"").toLowerCase().replace(/[^a-z0-9]/g,"");
  const ak2=p=>{const a=String(p&&p.artist||"").trim().toLowerCase();return (a&&!/^(unknown|anon|unidentified)/.test(a))?a:"";};
  const dayIds=(key,day)=>{ const perm=(out[key]||[]).map(id=>byId[id]).filter(Boolean); const len=perm.length; if(!len)return [];
    const start=((day*RND)%len+len)%len; const o=[],seen=new Set(),sa=new Set();
    for(let k=0;k<len&&o.length<RND;k++){ const p=perm[(start+k)%len]; if(!p)continue; const t=tk2(p),a=ak2(p);
      if(seen.has(t)||(a&&sa.has(a)))continue; seen.add(t); if(a)sa.add(a); o.push(p.id); } return o; };
  const todayNum=Math.floor(Date.now()/86400000);
  const iso=d=>new Date(d*86400000).toISOString().slice(0,10);
  const byDate={};
  for(let d=todayNum-3; d<=todayNum+180; d++){ const k=iso(d);
    if(prior[k] && d<=todayNum){ byDate[k]=prior[k]; continue; }   // lock served/today to what was already shown
    const rec={}; for(const t of TRS) rec[t]=dayIds(t,d); byDate[k]=rec; }
  out.byDate=byDate;
}
writeFileSync("data/daily-order.js","window.ARTEFACTUM_DAILY="+JSON.stringify(out)+";\n");
console.log(`froze: easy ${easy.length} (T1 ${T1s.length} icons + T2 ${T2q.length}, 4+1/day) / medium ${out.medium.length} / hard ${out.hard.length} / impossible ${out.impossible.length}`);
console.log("Easy daily = 4 icons + 1 recognizable; icons recur ~"+Math.round(T1s.length/4)+"d");
