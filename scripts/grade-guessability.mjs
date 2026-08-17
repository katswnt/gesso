// Grade the blinded guessability probe into STORED scores, then backtest per-puzzle guessability.
//
// Reads data/incoming/vision-guessability-<model>-adaptive.json (raw blinded inferences: the model's when/where/
// medium/style/artist guessed from pixels alone). Grades each inference with the GAME'S OWN scoring functions —
// loaded live from index.html in a stubbed vm context (like tests/dom-harness.mjs), so there is NO parallel copy
// to drift. Writes data/incoming/guessability-scores.json = per-work per-facet g∈[0,1] + per-work G. Then it
// backtests A(day) = mean G over each frozen EASY daily and prints the distribution + candidate bands.
//
//   node scripts/grade-guessability.mjs [--tier=easy]
import { readFileSync, writeFileSync } from "node:fs";
import vm from "node:vm";

const TIER = (process.argv.find(a => a.startsWith("--tier=")) || "--tier=easy").split("=")[1];
const PROBE = "data/incoming/vision-guessability-claude-sonnet-4-6-adaptive.json";
const OUT = "data/incoming/guessability-scores.json";

// ---- stubbed DOM/vm context (mirrors tests/dom-harness.mjs) ----
const NODE = new Proxy(function(){}, { get(_t,p){ if(p===Symbol.toPrimitive||p===Symbol.toStringTag)return()=>""; if(p==="length")return 0; if(p==="style"||p==="dataset"||p==="classList")return NODE; if(["value","textContent","innerHTML","className","id"].includes(p))return ""; if(p==="children"||p==="childNodes")return []; if(p===Symbol.iterator)return [][Symbol.iterator].bind([]); return NODE; }, apply(){return NODE;}, construct(){return NODE;}, set(){return true;} });
const store = new Map();
const localStorage = { getItem:k=>store.has(k)?store.get(k):null, setItem:(k,v)=>store.set(k,String(v)), removeItem:k=>store.delete(k) };
const document = new Proxy({ getElementById:()=>NODE, querySelector:()=>NODE, querySelectorAll:()=>[], createElement:()=>NODE, createElementNS:()=>NODE, createTextNode:()=>NODE, addEventListener(){}, removeEventListener(){}, body:NODE, head:NODE, documentElement:NODE, location:{pathname:"/",search:"",href:"https://gesso.test/"} }, { get(t,p){ return p in t?t[p]:NODE; } });
const L = new Proxy(function(){return NODE;}, { get(){return()=>NODE;}, apply(){return NODE;}, construct(){return NODE;} });
const ctx = { console, document, localStorage, L, navigator:{userAgent:"grade",language:"en",clipboard:{writeText:async()=>{}}}, location:document.location, history:{pushState(){},replaceState(){}}, setTimeout:()=>0, clearTimeout(){}, setInterval:()=>0, clearInterval(){}, requestAnimationFrame(){return 0;}, fetch:async()=>({ok:true,json:async()=>({}),text:async()=>""}), matchMedia:()=>({matches:false,addEventListener(){},addListener(){}}), supabase:{createClient:()=>new Proxy({},{get(){return()=>({data:null,error:null});}})}, addEventListener(){}, removeEventListener(){}, alert(){}, confirm:()=>true, prompt:()=>null, scrollTo(){}, scroll(){}, scrollBy(){}, atob:s=>Buffer.from(s,"base64").toString("binary"), btoa:s=>Buffer.from(s,"binary").toString("base64"), Math, Date, JSON, Object, Array, String, Number, Boolean, RegExp, Map, Set, Promise, parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent, URL, URLSearchParams, Intl, Error, TypeError, crypto:globalThis.crypto, structuredClone:globalThis.structuredClone };
ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
for (const f of ["data/pool.js","data/fame.js","data/regions.js","data/daily-order.js","data/countries.js","data/cues.js","data/teach-works.js","data/hotspots.js","data/museums.js"]) {
  try { vm.runInContext(readFileSync(f,"utf8"), ctx, { filename:f }); } catch(e){ console.error("load",f,e.message); process.exit(1); }
}
const html = readFileSync("index.html","utf8");
const app = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).sort((a,b)=>b.length-a.length)[0];
// append an exporter that captures the real scoring internals via closure, plus a faithful copy of score()'s
// per-facet grading (the where/when blocks are inline in score(), so we reconstruct them over the SAME helpers).
const exporter = `
;globalThis.__G = (function(){
  const g = n => { try { return eval(n); } catch { return undefined; } };
  const MAXC = g('MAX_CAT')||2500, D0 = (g('DIFF')||{});
  function scoreWhere(it, ll, D){
    if(!ll) return 0;
    const rad=radiusFor(it.place), wc=placeCountry(it.place), reg=regionFor(it), hasReg=!!reg;
    const dist=km(ll.lat,ll.lng,it.lat,it.lng);
    const inReg=(reg?ptInRegion(ll.lat,ll.lng,reg):false)||(hasReg&&dist<=200);
    const countryHit = wc?nearCountry(ll.lat,ll.lng,wc):(dist<=rad);
    const inCont = !(inReg||countryHit) && continentOf(ll.lat,ll.lng)===it.region && dist<=3000;
    const distPts=Math.round(MAXC*Math.exp(-dist/D.distK));
    return whereCredit({inReg,countryHit,hasReg,inCont,distPts}).pts;
  }
  function scoreWhen(it, year, D){
    let [lo,hi]=dateRange(it);
    if(lo===hi && it.styleKind==='culture'){ const era=movEra(it.style);
      if(era && era[0]<=it.y && it.y<=era[1]){ let a=era[0],b=era[1]; if(b-a>400){a=Math.max(a,it.y-200);b=Math.min(b,it.y+200);} lo=a;hi=b; } }
    const gy = year<lo?lo : year>hi?hi : year;
    const pd = Math.abs(yearToPos(year)-yearToPos(gy));
    return timeScore(Math.round(pd/D.timeMult)).pts;
  }
  function scoreMedium(it, guessText){
    const gm = simplifyMedium(guessText); if(!gm) return 0;
    if(gm===it.medSimple) return MAXC;
    const MF = g('MED_FAMILY')||{};
    if(MF[gm] && MF[gm]===MF[it.medSimple]) return Math.round(MAXC*0.5);
    return 0;
  }
  function resolveStyle(guessText){ // map free-text vision style → best known movement name (for movementSim)
    if(!guessText) return "";
    const names = g('MOVEMENT_NAMES')||[]; const t=String(guessText).toLowerCase();
    for(const n of names){ if(t===n.toLowerCase()) return n; }
    for(const n of names){ if(n.length>=5 && t.includes(n.toLowerCase())) return n; }
    return guessText;
  }
  function scoreStyle(it, guessText, D){
    const gs = resolveStyle(guessText); if(!gs) return 0;
    if(gs===it.style) return MAXC;
    const RM = g('RELATED_MOV')||{};
    const sim = (RM[it.style]||[]).includes(gs) ? 1 : (movementSim(gs, it.style)||0);
    return sim>0 ? Math.round(MAXC*D.relMov*sim) : 0;
  }
  function scoreArtist(it, guessText){
    if(!isNamedArtist(it.artist)) return null;         // artist not a scoreable facet for this work
    if(!guessText || /^(unknown|unattributed|anonymous|n\\/a|none)$/i.test(String(guessText).trim())) return 0;
    return artistMatch(guessText, it.artist) ? MAXC : 0;  // conservative: exact-ish only (guessability, not partial credit)
  }
  return { MAXC, DIFF:D0, scoreWhere, scoreWhen, scoreMedium, scoreStyle, scoreArtist,
           placeCountry:g('placeCountry'), COUNTRIES:g('COUNTRIES')||[], buildIndexes:g('buildIndexes'), POOL:g('POOL') };
})();`;
try { vm.runInContext(app + exporter, ctx, { filename:"index.html#app" }); } catch(e){ console.error("eval app:", e.stack?.split("\n").slice(0,3).join("\n")); process.exit(1); }
const API = ctx.__G;
if (API.buildIndexes && API.POOL && !API.POOL[0]?.medSimple) { try { API.buildIndexes(); } catch(e){ console.error("buildIndexes:", e.message); } }

// ---- data ----
const POOL = ctx.ARTEFACTUM_POOL || API.POOL || [];
const byId = Object.fromEntries(POOL.map(p=>[p.id, p]));
const D = API.DIFF[TIER] || API.DIFF.medium, MAXC = API.MAXC;
const probe = JSON.parse(readFileSync(PROBE,"utf8"));
const centroid = name => { const c = API.placeCountry(name); if(!c||!c.b) return null; const [mnx,mny,mxx,mxy]=c.b; return { lat:(mny+mxy)/2, lng:(mnx+mxx)/2 }; };

// ---- grade each probed work ----
const scores = {}; let graded=0, skipped=0;
for (const w of probe.works) {
  const it = byId[w.id]; const V = w.vision;
  if (!it || !V || !V.when) { skipped++; continue; }
  const coreCats = (it.cats||[]).filter(c=>["when","where","medium","style"].includes(c));
  const gf = {};
  if (it.cats?.includes("when"))   gf.when   = +(API.scoreWhen(it, V.when.year, D)/MAXC).toFixed(3);
  if (it.cats?.includes("where"))  gf.where  = +(API.scoreWhere(it, V.where && centroid(V.where.country), D)/MAXC).toFixed(3);
  if (it.cats?.includes("medium")) gf.medium = +(API.scoreMedium(it, V.medium && V.medium.guess)/MAXC).toFixed(3);
  if (it.cats?.includes("style"))  gf.style  = +(API.scoreStyle(it, V.style && V.style.guess, D)/MAXC).toFixed(3);
  const ar = API.scoreArtist(it, V.artist && V.artist.guess); if (ar!=null) gf.artist = +(ar/MAXC).toFixed(3);
  const core = coreCats.map(c=>gf[c]).filter(v=>v!=null);
  const G = core.length ? +(core.reduce((a,b)=>a+b,0)/core.length).toFixed(3) : null;
  scores[w.id] = { title:w.title, recognized:!!(V.recognized), stopRung:w.stopRung, cats:coreCats, g:gf, G };
  graded++;
}
writeFileSync(OUT, JSON.stringify({ model:probe.model, tier:TIER, note:"g[facet]∈[0,1] = game score of the blinded inference ÷ MAX_CAT, graded at "+TIER+" tier; G = mean over core cats", works:scores }, null, 1));
console.log(`graded ${graded} works · skipped ${skipped} (no pool match or no inference) -> ${OUT}`);

// ---- distribution helpers ----
const pctl = (arr,p)=>{ const s=[...arr].sort((a,b)=>a-b); return s[Math.min(s.length-1, Math.floor(p/100*s.length))]; };
const dist = (arr,label)=>{ if(!arr.length){console.log("  "+label+": (none)");return;} const a=[...arr].sort((x,y)=>x-y); console.log(`  ${label} (n=${a.length}): min ${a[0].toFixed(2)} · p10 ${pctl(a,10).toFixed(2)} · p25 ${pctl(a,25).toFixed(2)} · median ${pctl(a,50).toFixed(2)} · p75 ${pctl(a,75).toFixed(2)} · max ${a[a.length-1].toFixed(2)}`); };

console.log("\n=== per-work guessability G (graded @ "+TIER+") ===");
dist(Object.values(scores).map(s=>s.G).filter(v=>v!=null), "G");
for (const f of ["when","where","medium","style","artist"]) dist(Object.values(scores).map(s=>s.g[f]).filter(v=>v!=null), "g."+f);

// ---- backtest A(day) over the frozen EASY dailies ----
const bd = (ctx.ARTEFACTUM_DAILY||{}).byDate || {};
const days = Object.entries(bd).map(([date,day])=>({date, ids:(day[TIER]||[])})).filter(d=>d.ids.length);
const puzzles = [];
for (const {date, ids} of days) {
  const gs = ids.map(id=>scores[id]?.G).filter(v=>v!=null);
  if (gs.length < ids.length) continue;   // skip days with any ungraded work (drift/failures) so the backtest is clean
  puzzles.push({ date, A:+(gs.reduce((a,b)=>a+b,0)/gs.length).toFixed(3), floor:+Math.min(...gs).toFixed(3) });
}
console.log(`\n=== per-puzzle backtest over ${puzzles.length} frozen ${TIER} dailies (fully-graded only) ===`);
dist(puzzles.map(p=>p.A), "A(day) = mean G");
dist(puzzles.map(p=>p.floor), "floor = min G");
console.log("\nCANDIDATE BANDS (from percentiles — tune to taste):");
const A = puzzles.map(p=>p.A);
console.log(`  ease floor @ p10 of current days = ${pctl(A,10).toFixed(2)}  (10% of today's ${TIER} days already fall below this — the hardest)`);
console.log(`  ease floor @ p25 = ${pctl(A,25).toFixed(2)}  ·  median day = ${pctl(A,50).toFixed(2)}`);
