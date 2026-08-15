// Freeze a STABLE per-tier daily ordering by work ID, so dailies never drift when fame/pool changes.
// Tiers are computed from the current fame ordering, then each tier's IDs are deterministically shuffled
// into a fixed rotation. Re-run only when you deliberately want to reset the rotation.
// Run: node scripts/freeze-daily.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { simplifyMedium } from "./lib/domain.mjs";
import { baselineDim, classifyRes } from "./lib/img-dimensions.mjs";
// never schedule remains, or works the vision audit judged unplayable (featureless), or works whose
// fingerprinted image is genuinely low-res (LOW = blurry at reveal) — a blurry image is a bad puzzle in
// any tier, so keep it OUT of the rotation at the source instead of catching it after the fact. Works not
// yet fingerprinted can't be assessed here → they're allowed, and audit-dailies / the weekly Action catch them.
const isLowRes = p => { const d = baselineDim(p); return d && classifyRes(d) === "LOW"; };
const pool = JSON.parse(readFileSync("data/pool.js","utf8").replace("window.ARTEFACTUM_POOL = ","").replace(/;\s*$/,""))
  .filter(p => p.sensitive !== "remains" && p.play !== false && !isLowRes(p));
const overlay = JSON.parse(readFileSync("data/fame.js","utf8").replace("window.ARTEFACTUM_FAME=","").replace(/;\s*$/,""));
const poolFame = Object.fromEntries(pool.map(p=>[p.id, p.fame||0])); // fallback for freshly-promoted works not yet in the overlay — matches buildIndexes
const fameOf = id => overlay[id]!=null ? overlay[id] : (poolFame[id]||0);
// PLAYABILITY: a work shown to a player must have at most one missing scoreable value — i.e. record at least
// one of {medium, movement}. Works missing BOTH are excluded from every tier so they never enter a daily.
const _html=readFileSync("index.html","utf8"); const _a=_html.indexOf("const MOVEMENTS={"),_b=_html.indexOf("const MOV_FAMILY=");
const _movKeys=new Set([..._html.slice(_a,_b).matchAll(/"([^"]+)":\{dates:/g)].map(m=>m[1]));
const workComplete=p=>!!(p&&((p.medium&&String(p.medium).trim())||(p.style&&(_movKeys.has(p.style)||p.styleKind==="culture"||p.styleKind==="movement"))));

// --- daily diversity: no two works by the same NAMED artist in one day's set; soft region/era spread ---
const byId = Object.fromEntries(pool.map(p=>[p.id,p]));
const namedArtist = id => { const a=String(byId[id]?.artist||"").trim(); return (a && !/^(unknown|anonymous|unidentified)/i.test(a)) ? a.toLowerCase() : ""; };
const regionOf = id => byId[id]?.region||"";
const centOf = id => { const y=byId[id]?.y; return y==null?"~":Math.floor(y/100); };
const styleOf = id => String(byId[id]?.style||"").toLowerCase();          // culture/movement — spreads "5 Chinese textiles"
const medOf = id => simplifyMedium(byId[id]?.medium||"");                  // bucketed medium — spreads "all textiles"
const countryOf = id => { const p=String(byId[id]?.place||"").replace(/\([^)]*\)/g,"").trim(); const parts=p.split(","); return (parts[parts.length-1]||"").trim().toLowerCase(); }; // spreads "5 Italian" easy days within Europe
// Reorder so any window of `win` consecutive avoids a repeated NAMED artist (hard) and spreads
// culture/medium/region/century (soft) — anonymous works (textiles, ceramics) have no artist to dedupe,
// so without the culture+medium terms a day could be all one theme (e.g. Chinese textiles).
function diversify(ids, win){
  const rem=ids.slice(), out=[];
  while(rem.length){
    const recent=out.slice(-(win-1));
    const ra=recent.map(namedArtist).filter(Boolean), rr=recent.map(regionOf), rc=recent.map(centOf),
          rs=recent.map(styleOf).filter(Boolean), rm=recent.map(medOf).filter(Boolean), rq=recent.map(countryOf).filter(Boolean);
    let bestI=0, best=Infinity;
    for(let i=0;i<rem.length;i++){ const id=rem[i], a=namedArtist(id), s=styleOf(id), m=medOf(id), cq=countryOf(id);
      const score=(a&&ra.includes(a)?1000:0)+(s&&rs.includes(s)?8:0)+(cq&&rq.includes(cq)?5:0)+(m&&rm.includes(m)?4:0)+(rr.includes(regionOf(id))?1:0)+(rc.includes(centOf(id))?1:0)+i*0.0001;
      if(score<best){best=score;bestI=i; if(best<0.5)break;} }
    out.push(rem.splice(bestI,1)[0]);
  }
  return out;
}

// deterministic PRNG + shuffle (seeded), independent of fame so the order is frozen
function seedHash(s){let h=1779033703^s.length;for(let i=0;i<s.length;i++){h=Math.imul(h^s.charCodeAt(i),3432918353);h=h<<13|h>>>19;}return h>>>0;}
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function seededShuffle(arr,seedStr){const r=mulberry32(seedHash(seedStr));const a=arr.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}

const ranked = pool.filter(workComplete).sort((a,b)=>fameOf(b.id)-fameOf(a.id));
const n = ranked.length;
const out={};

// --- EASY = two bands so every daily is 4 instantly-recognizable icons + 1 very-recognizable work ---
const T1_SIZE=140, T2_SIZE=270; // T1 icons (canon + top pageviews), T2 recognizable. T1=140 → icons recur ~35d (>30d no-repeat); Easy stays ~410.
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
const T2SET=new Set(T2ids); // the "recognizable" band — capped at 1/easy-day so icon-starved days repeat an icon, not harden

// --- MEDIUM / HARD / IMPOSSIBLE = the remaining works by recognizability, split in thirds ---
// Split the rest by FAME THRESHOLDS, not equal rank-thirds. The fame curve is a cliff, so equal thirds
// dumped a huge range into medium (fame 1195 down to ~60) — a "medium" day could pair a famous work with a
// fame-69 village object. Thresholds keep medium recognizable: medium = fame>=300, hard = 30-300, impossible = <30.
const restP=ranked.slice(T1_SIZE+T2_SIZE); const rest=restP.map(p=>p.id); const r=rest.length;
const idxBelow=thr=>{ const i=restP.findIndex(p=>fameOf(p.id)<thr); return i<0?r:i; };
const mc=[0, idxBelow(500), idxBelow(120), r]; // recalibrated for all-language fame (~2x): medium fame>=500, hard 120-500, impossible <120 (the cliff)
["medium","hard","impossible"].forEach((k,i)=>{ out[k]=diversify(seededShuffle(rest.slice(mc[i],mc[i+1]),`gesso-daily-freeze-v2|${k}`),5); });

// PERCENTILE-MIX pools: each medium/hard/impossible daily draws one work from each fame-quintile of its band,
// so no day is all-faint or all-famous (graduated difficulty). Diversity rules still WIN over this (see dayIds).
// Easy is exempt — it already has the deliberate 4-icons + 1-recognizable spread.
const QUINT={};
for(const key of ["medium","hard","impossible"]){
  const ids=(out[key]||[]).slice().sort((a,b)=>fameOf(b)-fameOf(a));                 // fame, most → least famous
  const per=Math.max(1,Math.ceil(ids.length/5)); const q=[[],[],[],[],[]];
  ids.forEach((id,i)=>q[Math.min(4,Math.floor(i/per))].push(id));                    // Q0 = top fame … Q4 = faintest
  QUINT[key]=q.map((arr,qi)=>diversify(seededShuffle(arr,`gesso-quint-${key}-${qi}`),5)); // spread within each quintile
}

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
  // PERSISTENT LEDGER (append-only): the authoritative record of every day ever served. It is NEVER reshuffled
  // or truncated — served days are copied from it verbatim, and the anti-repeat windows below seed from its full
  // tail (not just the 3 days daily-order keeps). This is what kills cross-refreeze repeats.
  let ledger={}; try{ const s=readFileSync("data/daily-history.js","utf8"); ledger=(JSON.parse(s.slice(s.indexOf("{"),s.lastIndexOf("}")+1)).byDate)||{}; }catch{}
  const RND=5, TRS=["easy","medium","hard","impossible"];
  const tk2=p=>String(p&&p.title||"").toLowerCase().replace(/[^a-z0-9]/g,"");
  const ak2=p=>{const a=String(p&&p.artist||"").trim().toLowerCase();return (a&&!/^(unknown|anon|unidentified)/.test(a))?a:"";};
  const sk2=p=>String(p&&p.style||"").trim().toLowerCase();
  // clusterKey: for ANONYMOUS works only, a normalized (object-noun + region + century) key so near-identical
  // artifacts (12 fish palettes, 29 "Dish", 23 Nauny shabti) can't flood a window. Named works → "" (unconstrained;
  // they're already governed by the artist gap). Mirrors the near-dup audit's stem logic.
  const clk=p=>{ if(!p||ak2(p)) return ""; const s=String(p.title||"").toLowerCase()
    .replace(/\([^)]*\)/g," ").replace(/[-–][a-z]*\s*\d[\d.\s]*/g," ").replace(/[0-9]+/g," ").replace(/[^a-z ]/g," ").replace(/\s+/g," ").trim();
    if(!s) return ""; const c=typeof p.y==="number"?Math.round(p.y/100):"?"; return s+"|"+(p.region||p.place||"?")+"|"+c; };
  const STYLE_CAP=2;    // at most 2 works of the same movement/style per day (kills "3 Dutch Golden Age" clustering)
  const ARTIST_GAP=5;   // don't repeat a NAMED artist within this many days (prevents back-to-back clustering without over-spreading)
  const WORK_GAP=30;    // don't repeat the SAME work within this many days (kills cross-refreeze near-dupes + the "same icon twice in a month" bug)
  const CLUSTER_GAP=14; // don't repeat an anonymous near-dup CLUSTER within this many days (kills palette/shabti/dish monotony)
  // RESHUFFLE_FUTURE=1 regenerates future dates with current rules (use only when diversity rules change).
  // Default: PRESERVE every already-frozen date (past AND future) so re-freezing never drifts the calendar —
  // re-running only extends the horizon. This is what stops the "same work a few days apart" from re-freezes.
  const RESHUFFLE = process.env.RESHUFFLE_FUTURE === '1';
  // `avoidA` = artists in the last ARTIST_GAP days; `avoidW` = work-ids in the last WORK_GAP days. Both soft.
  // Per-day acceptance test (mutates o/seen/sa/sc/dc). DIVERSITY RULES ALWAYS WIN; the percentile preference bends first.
  //   relax 0 = all rules; relax 1 = drop style-cap + artist-gap + cluster-gap; relax 2 = also drop work-gap (last resort).
  //   within-day title + named-artist dedupe is NEVER relaxed (no two same-artist works in a day).
  const dayIds=(key,day,avoidA,avoidW,avoidCL)=>{
    const o=[],seen=new Set(),sa=new Set(),sc={},dc=new Set();
    const take=(id,relax)=>{ const p=byId[id]; if(!p)return false; const t=tk2(p),a=ak2(p),s=sk2(p),cl=clk(p);
      if(seen.has(t)||(a&&sa.has(a)))return false;                                                   // within-day dedupe: always
      if(relax<2 && avoidW && avoidW.has(id))return false;                                           // work gap: until last resort
      if(relax<1 && ((s&&(sc[s]||0)>=STYLE_CAP)||(a&&avoidA&&avoidA.has(a))||(cl&&(dc.has(cl)||(avoidCL&&avoidCL.has(cl))))))return false; // style/artist/cluster gaps
      seen.add(t); if(a)sa.add(a); if(s)sc[s]=(sc[s]||0)+1; if(cl)dc.add(cl); o.push(id); return true; };
    const pickOne=(list,relax,off)=>{ const len=list.length; if(!len)return false; const start=((day*7+off)%len+len)%len; for(let k=0;k<len;k++){ if(take(list[(start+k)%len],relax))return true; } return false; };
    const sweep=(list,relax,off)=>{ const len=list.length; if(!len)return; const start=((day*RND+off)%len+len)%len; for(let k=0;k<len&&o.length<RND;k++) take(list[(start+k)%len],relax); };
    if(QUINT[key]){ const qs=QUINT[key];                                    // MEDIUM/HARD/IMPOSSIBLE: one work per fame-quintile (graduated spread)
      for(let qi=0;qi<RND && o.length<RND;qi++){ if(!pickOne(qs[qi],0,qi*13)) pickOne(qs[qi],1,qi*13); } // diversity-first, then relaxed, per quintile
      const all=qs.flat(); for(let relax=0;relax<3 && o.length<RND;relax++) sweep(all,relax,0);          // backfill any blocked slot (percentile bends, diversity holds)
      return dayShuffle(repairCoverage(o.slice(0,RND),all,avoidW),key,day);
    }
    // EASY: 4 icons + 1 recognizable. Cap the recognizable (non-icon T2) band at 1/day — when fresh icons run
    // short (30-day gap), REPEAT an icon rather than pull a 2nd non-icon, so easy days never drift harder than 4+1.
    const ids=(out[key]||[]).map(p2=>byId[p2]).filter(Boolean).map(p2=>p2.id);
    let t2n=0;
    const takeE=(id,relax,capOff)=>{ if(T2SET.has(id)&&t2n>=1&&!capOff)return false; if(take(id,relax)){ if(T2SET.has(id))t2n++; return true;} return false; };
    const sweepE=(relax,capOff)=>{ const len=ids.length; if(!len)return; const start=((day*RND)%len+len)%len; for(let k=0;k<len&&o.length<RND;k++) takeE(ids[(start+k)%len],relax,capOff); };
    for(let relax=0;relax<3 && o.length<RND;relax++) sweepE(relax,false); // prefer icon-repeat (relax=2) over a 2nd non-icon
    if(o.length<RND) sweepE(2,true);                                       // last resort only: allow a 2nd recognizable work
    return dayShuffle(repairCoverage(o.slice(0,RND),ids,avoidW),key,day); };
  // FIELD-COVERAGE FLOORS: a scorecard row (style/artist/medium) with too few scoreable works that day plays as a
  // dead row. Repair AFTER assembly (never during — diversity/anti-repeat come first): if a field is below floor, swap
  // a work that LACKS it for a pool candidate that HAS it, but only when the swap keeps within-day title+artist dedupe,
  // respects the work-gap, and drops no already-met floor. Fails OPEN (leaves the day as-is) — the gate is the backstop.
  // artist floor is deliberately low (≥1): forcing named artists re-Westernizes the tier (anon works skew non-Western).
  const repairCoverage=(o,poolIds,avoidW)=>{ const FLOOR={style:2,artist:1,medium:2};
    const catsOf=id=>byId[id]?.cats||[], liveOf=(arr,c)=>arr.reduce((n,id)=>n+(catsOf(id).includes(c)?1:0),0);
    for(const [field,floor] of Object.entries(FLOOR)){ let guard=0;
      while(liveOf(o,field)<floor && guard++<12){ let swapped=false;
        for(let vi=0; vi<o.length && !swapped; vi++){ if(catsOf(o[vi]).includes(field)) continue; // victim must lack the field
          const without=o.filter((_,i)=>i!==vi);
          let breaks=false; for(const [f2,fl2] of Object.entries(FLOOR)) if(f2!==field && liveOf(o,f2)>=fl2 && liveOf(without,f2)<fl2){breaks=true;break;}
          if(breaks) continue;                                                                          // don't rob another met floor
          const titles=new Set(without.map(id=>tk2(byId[id]))), arts=new Set(without.map(id=>ak2(byId[id])).filter(Boolean));
          const cand=poolIds.find(id=> !o.includes(id) && catsOf(id).includes(field)
            && !titles.has(tk2(byId[id])) && !(ak2(byId[id])&&arts.has(ak2(byId[id]))) && !(avoidW&&avoidW.has(id)));
          if(cand){ o[vi]=cand; swapped=true; } }
        if(!swapped) break; } }
    return o; };
  // PRESENTATION ORDER: the picks above are assembled famous→faint (quintile walk); freezing that order would make
  // slot 1 ALWAYS the day's most recognizable work — a difficulty telegraph + it spends the "oh, I know this!" delight
  // on first load. Shuffle the final N with a per-day/tier seed so the famous work lands in a random-but-fixed slot.
  // Deterministic → identical for every player (leaderboard-fair), stable, reproducible. Which works are chosen (the
  // quintile variety guarantee) is untouched; only presentation order changes.
  const dayShuffle=(arr,key,day)=>seededShuffle(arr,`gesso-dayorder-${key}-${day}`);
  const todayNum=Math.floor(Date.now()/86400000);
  const iso=d=>new Date(d*86400000).toISOString().slice(0,10);
  const dayNumOf=k=>Math.floor(Date.parse(k+"T00:00:00Z")/86400000);
  const artistsOf=ids=>{const s=new Set();for(const id of ids){const a=ak2(byId[id]);if(a)s.add(a);}return s;};
  const clustersOf=ids=>{const s=new Set();for(const id of ids){const c=clk(byId[id]);if(c)s.add(c);}return s;};
  // served days come from the LEDGER first (immutable), then any prior daily-order day, then get generated.
  const served={...prior,...ledger};        // ledger wins — a served day can never be altered by a refreeze
  const byDate={}; let recAG=[]; let recW=[]; let recCL=[]; // GLOBAL across tiers: artist gap + work gap + cluster gap
  // PRE-SEED the anti-repeat windows from the ledger's tail (days that fall BEFORE the loop's -3 start) so the
  // 21-day work gap / 5-day artist gap are enforced against real served history, not just the 3 kept days.
  for(const [k,rec] of Object.entries(ledger)){ const d=dayNumOf(k); if(!(d>=todayNum-WORK_GAP && d<=todayNum-4)) continue;
    const allIds=[]; for(const t of TRS) allIds.push(...((rec&&rec[t])||[]));
    recAG.push({day:d,artists:artistsOf(allIds)}); recW.push({day:d,ids:allIds}); recCL.push({day:d,keys:clustersOf(allIds)}); }
  for(let d=todayNum-3; d<=todayNum+180; d++){ const k=iso(d);
    let rec;
    const preserve = served[k] && (d<=todayNum || !RESHUFFLE);       // past+today always (from ledger); future too unless reshuffling
    if(preserve){ rec=served[k]; }
    else { rec={}; const dayUsed=new Set(); const dayArtists=new Set(); const dayClusters=new Set(); // work + artist + cluster used in an earlier tier today are off-limits in later tiers
      for(const t of TRS){
        const avoidA=new Set(dayArtists); for(const e of recAG) if(d-e.day<=ARTIST_GAP) for(const a of e.artists) avoidA.add(a); // GLOBAL: every tier in the last ARTIST_GAP days (kills cross-tier back-to-back same artist)
        const avoidW=new Set(dayUsed); for(const e of recW) if(d-e.day<=WORK_GAP) for(const id of e.ids) avoidW.add(id); // GLOBAL: every tier in the last WORK_GAP days
        const avoidCL=new Set(dayClusters); for(const e of recCL) if(d-e.day<=CLUSTER_GAP) for(const c of e.keys) avoidCL.add(c); // GLOBAL: anon clusters in the last CLUSTER_GAP days
        rec[t]=dayIds(t,d,avoidA,avoidW,avoidCL);
        for(const id of rec[t]){ dayUsed.add(id); const a=ak2(byId[id]); if(a)dayArtists.add(a); const c=clk(byId[id]); if(c)dayClusters.add(c); } } }
    byDate[k]=rec;
    const allIds=[];
    for(const t of TRS){ const ids=(rec&&rec[t])||[]; allIds.push(...ids); }
    recAG.push({day:d,artists:artistsOf(allIds)}); // one global artist window entry per day across all tiers
    recW.push({day:d,ids:allIds});   // one global work window entry per day across all tiers
    recCL.push({day:d,keys:clustersOf(allIds)}); // one global cluster window entry per day across all tiers
  }
  out.byDate=byDate;
  // APPEND newly-served days into the ledger (grow-only; an existing entry is NEVER overwritten or dropped).
  const newLedger={...ledger}; let added=0;
  for(const [k,rec] of Object.entries(byDate)){ if(dayNumOf(k)<=todayNum && !newLedger[k]){ newLedger[k]=rec; added++; } }
  writeFileSync("data/daily-history.js","window.ARTEFACTUM_DAILY_HISTORY="+JSON.stringify({byDate:newLedger})+";\n");
  console.log(`ledger: ${Object.keys(newLedger).length} served days recorded (+${added} new)`);
}
writeFileSync("data/daily-order.js","window.ARTEFACTUM_DAILY="+JSON.stringify(out)+";\n");
console.log(`froze: easy ${easy.length} (T1 ${T1s.length} icons + T2 ${T2q.length}, 4+1/day) / medium ${out.medium.length} / hard ${out.hard.length} / impossible ${out.impossible.length}`);
console.log("Easy daily = 4 icons + 1 recognizable; icons recur ~"+Math.round(T1s.length/4)+"d");
