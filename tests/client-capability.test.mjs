// PR 3 client capability lifecycle — network-free VM harness (in test:ci). Loads the REAL index.html app
// script in a stubbed context and drives the browser-side capability path with a programmable fetch, since
// two prior High bugs lived in this client code (registration-failure downgrade, identity-rotation mismatch).
//   node tests/client-capability.test.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const fail = (where, e) => { console.error(`❌ client-capability FAIL @ ${where}: ${e && e.stack ? e.stack.split('\n').slice(0,3).join(' ') : e}`); process.exit(1); };

const NODE = new Proxy(function(){}, { get(_t,p){ if(p===Symbol.toPrimitive||p===Symbol.toStringTag)return()=>''; if(p==='length')return 0; if(p==='style'||p==='dataset'||p==='classList')return NODE; if(['value','textContent','innerHTML','className','id'].includes(p))return ''; if(p==='children'||p==='childNodes')return []; if(p===Symbol.iterator)return [][Symbol.iterator].bind([]); return NODE; }, apply(){return NODE;}, construct(){return NODE;}, set(){return true;} });
const store = new Map();
const localStorage = { getItem:k=>store.has(k)?store.get(k):null, setItem:(k,v)=>store.set(k,String(v)), removeItem:k=>store.delete(k) };
const document = new Proxy({ getElementById:()=>NODE, querySelector:()=>NODE, querySelectorAll:()=>[], createElement:()=>NODE, createElementNS:()=>NODE, createTextNode:()=>NODE, addEventListener(){}, removeEventListener(){}, body:NODE, head:NODE, documentElement:NODE, location:{pathname:'/',search:'',href:'https://gesso.test/'} }, { get(t,p){ return p in t?t[p]:NODE; } });
const L = new Proxy(function(){return NODE;}, { get(){return()=>NODE;}, apply(){return NODE;}, construct(){return NODE;} });

// programmable fetch + call recorder
const CALLS = [];
let FETCH = async () => ({ ok:true, status:200, json:async()=>({}), text:async()=>'' });
const R = (status, data) => ({ ok: status < 400, status, json: async()=>data, text: async()=>JSON.stringify(data) });
const fetchImpl = (url, opts) => { const u=String(url); CALLS.push({ url:u, opts:opts||{} }); return FETCH(u, opts||{}); };

// controllable supabase client (for syncAccount)
const supabase = { createClient: () => ({ auth: { getSession: async()=>({ data:{ session:{ access_token:'tok' } } }), onAuthStateChange(){}, signOut:async()=>{} } }) };

const ctx = { console, document, localStorage, L, supabase, navigator:{ userAgent:'capt', language:'en', clipboard:{ writeText:async()=>{} } }, location:document.location, history:{ pushState(){}, replaceState(){} }, setTimeout:()=>0, clearTimeout(){}, setInterval:()=>0, clearInterval(){}, requestAnimationFrame(){return 0;}, fetch:fetchImpl, matchMedia:()=>({ matches:false, addEventListener(){}, addListener(){} }), addEventListener(){}, removeEventListener(){}, alert(){}, confirm:()=>true, prompt:()=>null, scrollTo(){}, scroll(){}, scrollBy(){}, atob:s=>Buffer.from(s,'base64').toString('binary'), btoa:s=>Buffer.from(s,'binary').toString('base64'), Math, Date, JSON, Object, Array, String, Number, Boolean, RegExp, Map, Set, Promise, parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent, URL, URLSearchParams, Intl, Error, TypeError, crypto:globalThis.crypto, structuredClone:globalThis.structuredClone };
ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
for (const f of ['data/cues.js','data/teach-works.js','data/hotspots.js','data/pool.js','data/fame.js','data/regions.js','data/daily-order.js','data/countries.js','data/museums.js']) {
  try { vm.runInContext(readFileSync(f,'utf8'), ctx, { filename:f }); } catch(e){ fail('load '+f, e); }
}
const html = readFileSync('index.html','utf8');
const app = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).sort((a,b)=>b.length-a.length)[0];
const hooks = `
;globalThis.__capT=(function(){ let bannerCount=0; showDeviceConflict=function(){bannerCount++;};
  return { capability, deviceId, newDeviceIdentity, ensureDeviceRegistered, capFetch, syncAccount,
    resetReg:()=>{ try{__regPromise=null;}catch{} }, resetSync:()=>{ try{_syncInFlight=null;}catch{} },
    setAuth:(u)=>{ try{authUser=u;}catch{} }, banner:()=>bannerCount, resetBanner:()=>{bannerCount=0;} }; })();`;
try { vm.runInContext(app + hooks, ctx, { filename:'index.html#app' }); } catch(e){ fail('eval app', e); }
const S = ctx.__capT;

let pass = 0; const ok = (c, m) => { if (c) pass++; else fail(m, new Error('assertion failed')); };
const regCount = () => CALLS.filter(c => c.url.includes('/api/register-device')).length;
const freshDevice = () => { store.delete('gesso.cap'); store.delete('gesso.device'); S.resetReg(); };

async function main(){
  // 1. registration 403 → protected request STILL carries a cap (never cap-less legacy)
  freshDevice(); CALLS.length=0; FETCH = async u => u.includes('/api/register-device') ? R(403,{ ok:false }) : R(200,{});
  let received=null; await S.capFetch((dev,cap)=>{ received={dev,cap}; return R(403,{ error:'device revoked' }); });
  ok(received && /^[A-Za-z0-9_-]{43}$/.test(received.cap), 'case1: builder receives a valid cap even after registration 403 (server can reject as revoked, not legacy)');

  // 2. registration 502 → op still carries cap; a SECOND op retries registration (promise reset on failure)
  freshDevice(); CALLS.length=0; FETCH = async u => u.includes('/api/register-device') ? R(502,{}) : R(200,{});
  await S.capFetch((dev,cap)=>R(200,{})); const after1 = regCount();
  await S.capFetch((dev,cap)=>R(200,{})); const after2 = regCount();
  ok(after1 >= 1 && after2 > after1, `case2: registration retried after 502 (calls ${after1} → ${after2})`);

  // 3. registration 409 → rotate identity → 2nd registration succeeds → op uses the NEW id + NEW cap (consistent)
  freshDevice(); const origDev = S.deviceId(); const origCap = S.capability(); CALLS.length=0;
  let reg=0; FETCH = async u => { if(u.includes('/api/register-device')){ reg++; return reg===1 ? R(409,{ ok:false }) : R(200,{ ok:true }); } return R(200,{}); };
  let got=null; await S.capFetch((dev,cap)=>{ got={dev,cap}; return R(200,{}); });
  ok(reg === 2, 'case3: 409 triggers a second (post-rotation) registration');
  ok(got && got.dev !== origDev, 'case3: protected op uses the NEW device id after rotation');
  ok(got && got.cap !== origCap && /^[A-Za-z0-9_-]{43}$/.test(got.cap), 'case3: protected op uses the NEW cap (consistent pair, no old-id/new-cap mix)');

  // 4. syncAccount 409 account-conflict → banner shown, /api/claim NEVER called
  freshDevice(); S.setAuth({ id:'u1' }); S.resetSync(); S.resetBanner(); CALLS.length=0;
  FETCH = async u => { if(u.includes('/api/register-device')) return R(200,{}); if(u.includes('/api/sync')) return R(409,{ error:'device belongs to another account' }); if(u.includes('/api/claim')) return R(200,{}); return R(200,{}); };
  await S.syncAccount();
  ok(S.banner() === 1, 'case4: account-conflict 409 shows the device-conflict banner');
  ok(!CALLS.some(c => c.url.includes('/api/claim')), 'case4: no /api/claim retry on account conflict');

  // 5. syncAccount 409 unregistered → NO banner, still no /api/claim
  freshDevice(); S.setAuth({ id:'u1' }); S.resetSync(); S.resetBanner(); CALLS.length=0;
  FETCH = async u => { if(u.includes('/api/register-device')) return R(200,{}); if(u.includes('/api/sync')) return R(409,{ error:'device not registered' }); if(u.includes('/api/claim')) return R(200,{}); return R(200,{}); };
  await S.syncAccount();
  ok(S.banner() === 0, 'case5: unregistered 409 does NOT show the account-conflict banner');
  ok(!CALLS.some(c => c.url.includes('/api/claim')), 'case5: no /api/claim on unregistered 409');

  // 6. mechanical inventory: exactly 7 rotation-safe builders, and no string-form capFetch remains
  const builders = (app.match(/capFetch\(\(dev,cap\)=>fetch\(/g) || []).length;
  const stringForm = (app.match(/capFetch\(['"]/g) || []).length;
  ok(builders === 7, `case6: exactly 7 rotation-safe capFetch builders (found ${builders})`);
  ok(stringForm === 0, 'case6: no legacy string-form capFetch("...") remains');

  console.log(`client-capability.test: ${pass} assertions passed (registration-failure, retry, 409 rotation, conflict/unregistered banner, builder inventory)`);
}
main().catch(e => fail('main', e));
