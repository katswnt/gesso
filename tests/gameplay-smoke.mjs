// Gameplay smoke test: drive the REAL score() and renderRound() over edge-case works in a stubbed vm context,
// so runtime throws in the hot scoring/reveal path (which the load-only dom-harness misses) fail CI. Focuses on
// the recently-changed surfaces: B1 place-NA (where axis dropped), B2 widened dates, A3 super-regions, 1c artist
// aliases, anonymous / no-medium works. Exits nonzero on any throw or nonsensical score.
//   node tests/gameplay-smoke.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";

const fail = (where, e) => { console.error(`❌ gameplay-smoke FAIL @ ${where}:\n   ${e && e.stack ? e.stack.split("\n").slice(0,4).join("\n   ") : e}`); process.exit(1); };

const NODE = new Proxy(function(){}, { get(_t,p){ if(p===Symbol.toPrimitive||p===Symbol.toStringTag)return()=>""; if(p==="length")return 0; if(p==="style"||p==="dataset"||p==="classList")return NODE; if(["value","textContent","innerHTML","className","id"].includes(p))return ""; if(p==="children"||p==="childNodes")return []; if(p===Symbol.iterator)return [][Symbol.iterator].bind([]); return NODE; }, apply(){return NODE;}, construct(){return NODE;}, set(){return true;} });
const store = new Map();
const localStorage = { getItem:k=>store.has(k)?store.get(k):null, setItem:(k,v)=>store.set(k,String(v)), removeItem:k=>store.delete(k) };
const document = new Proxy({ getElementById:()=>NODE, querySelector:()=>NODE, querySelectorAll:()=>[], createElement:()=>NODE, createElementNS:()=>NODE, createTextNode:()=>NODE, addEventListener(){}, removeEventListener(){}, body:NODE, head:NODE, documentElement:NODE, location:{pathname:"/",search:"",href:"https://gesso.test/"} }, { get(t,p){ return p in t?t[p]:NODE; } });
const L = new Proxy(function(){return NODE;}, { get(){return()=>NODE;}, apply(){return NODE;}, construct(){return NODE;} });
const ctx = { console, document, localStorage, L, navigator:{userAgent:"smoke",language:"en",clipboard:{writeText:async()=>{}}}, location:document.location, history:{pushState(){},replaceState(){}}, setTimeout:(f)=>{try{typeof f==="function"&&f();}catch{}return 0;}, clearTimeout(){}, setInterval:()=>0, clearInterval(){}, requestAnimationFrame(){return 0;}, fetch:async()=>({ok:true,json:async()=>({}),text:async()=>""}), matchMedia:()=>({matches:false,addEventListener(){},addListener(){}}), supabase:{createClient:()=>new Proxy({},{get(){return()=>({data:null,error:null});}})}, addEventListener(){}, removeEventListener(){}, alert(){}, confirm:()=>true, prompt:()=>null, scrollTo(){}, scroll(){}, scrollBy(){}, atob:s=>Buffer.from(s,"base64").toString("binary"), btoa:s=>Buffer.from(s,"binary").toString("base64"), Math, Date, JSON, Object, Array, String, Number, Boolean, RegExp, Map, Set, Promise, parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent, URL, URLSearchParams, Intl, Error, TypeError, crypto:globalThis.crypto, structuredClone:globalThis.structuredClone };
ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
for (const f of ["data/cues.js","data/teach-works.js","data/hotspots.js","data/pool.js","data/fame.js","data/regions.js","data/daily-order.js","data/countries.js","data/museums.js"]) {
  try { vm.runInContext(readFileSync(f,"utf8"), ctx, { filename:f }); } catch(e){ fail("load "+f, e); }
}
const html = readFileSync("index.html","utf8");
const app = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).sort((a,b)=>b.length-a.length)[0];
// harness hooks appended into the app scope (closure access to the let-scoped game/idx/guess/tier/score/renderRound)
const hooks = `
;globalThis.__smoke = {
  isPlaceNA: (typeof isPlaceNA!=='undefined'?isPlaceNA:null),
  byId: (function(){ const m={}; for(const p of POOL) m[p.id]=p; return m; })(),
  POOL,
  runScore: function(work, gs, tr){
    game=[work]; idx=0; tier=tr; infinite=false; TRAIN=null; runDate=null; results=[]; hintsUsed=0;
    guess={ year:(gs.year!=null?gs.year:1500), ll:gs.ll||null, medium:gs.medium||null, style:gs.style||null, artist:gs.artist||"", hints:new Set() };
    score();
    return results.length ? results[results.length-1] : null;
  },
  renderRound: function(work, tr){ game=[work]; idx=0; tier=tr; infinite=false; TRAIN=null; runDate=null; results=[]; try{ renderRound(); return true; }catch(e){ throw e; } }
};`;
try { vm.runInContext(app + hooks, ctx, { filename:"index.html#app" }); } catch(e){ fail("eval app", e); }
const S = ctx.__smoke;

let pass = 0;
const ok = (cond, msg) => { if (cond) pass++; else fail(msg, new Error("assertion failed")); };
const pick = (test, label) => { const w = S.POOL.filter(p=>p.play!==false).find(test); if(!w) console.warn("  (no sample for: "+label+")"); return w; };

// representative edge-case works
const placeNA = pick(p=>S.isPlaceNA&&S.isPlaceNA(p), "placeNA");
const cultureYr = pick(p=>p.styleKind==="culture" && p.y!=null && !(Array.isArray(p.yr)&&p.yr[0]!==p.yr[1]), "widened-date culture");
const superReg = pick(p=>/iran|china|egypt/i.test(p.place||"") && (p.y==null||p.y<1900), "super-region");
const anon = pick(p=>p.cats && !p.cats.includes("artist"), "anonymous");
const noMed = pick(p=>p.cats && !p.cats.includes("medium"), "no-medium");
const normal = pick(p=>p.region==="Europe" && p.cats && p.cats.includes("where") && p.cats.includes("artist"), "normal");

// guesses to throw at each: a full guess, a blank guess (no pin / default year), a wrong-hemisphere pin
const GUESSES = [
  { label:"full",  g:{ year:1600, ll:{lat:45,lng:10}, medium:"Oil paint", style:"Baroque", artist:"Rembrandt" } },
  { label:"blank", g:{ } },
  { label:"pin-only", g:{ ll:{lat:-33,lng:151} } },
];
for (const [label, w] of [["placeNA",placeNA],["cultureYr",cultureYr],["superReg",superReg],["anon",anon],["noMed",noMed],["normal",normal]]) {
  if (!w) continue;
  for (const { label:gl, g } of GUESSES) {
    let r;
    try { r = S.runScore(w, g, w.tier || "medium"); } catch(e){ fail(`score() [${label}/${gl}] ${w.id}`, e); }
    ok(r && r.cells, `score() [${label}/${gl}] returned cells`);
    // sanity: every scored cell has a finite non-negative pts
    for (const c in (r.cells||{})) ok(Number.isFinite(r.cells[c].pts) && r.cells[c].pts>=0, `cell ${c} pts finite/≥0 [${label}/${gl}]`);
    // placeNA invariant: 'where' must NOT be scored
    if (label==="placeNA") ok(!r.cells.where, `placeNA work has NO where cell [${gl}]`);
  }
  // reveal path must not throw
  try { S.renderRound(w, w.tier || "medium"); } catch(e){ fail(`renderRound() [${label}] ${w.id}`, e); }
  pass++;
}

console.log(`\n✅ gameplay-smoke PASS — ${pass} checks, score() + renderRound() ran clean over edge-case works`);
process.exit(0);
