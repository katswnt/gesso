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
    setAuth:(u)=>{ try{authUser=u;}catch{} }, banner:()=>bannerCount, resetBanner:()=>{bannerCount=0;},
    runDelete:(tok)=>runAccountDeletion(async()=>tok),
    isDeleting:()=>isAccountDeleting(), setDeleting:(on)=>setAccountDeleting(on),
    seedForDelete:()=>{ try{ SAVED=new Set(['w1']); SEEN=new Set(['s1']); SAVED_AT={w1:1}; __savedSynced=true; __regPromise=Promise.resolve(true); authUser={id:'u1'}; }catch{}
      localStorage.setItem('gesso.device','devx'); localStorage.setItem('gesso.cap','capx'); localStorage.setItem('gesso.saved','["w1"]'); localStorage.setItem('gesso.savedAt','{"w1":1}'); localStorage.setItem('gesso.seen','["s1"]'); localStorage.setItem('gesso.identity','{"name":"X"}'); },
    delState:()=>({ regPromise:__regPromise, savedSynced:__savedSynced, seen:SEEN.size, saved:SAVED.size, authUser:authUser }) }; })();`;
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

  // ---- account deletion (PR 4B) ----
  // 7. exact success: 200 {ok:true} → cleanup; identity/gallery/session storage + in-memory state fully reset; lock released
  freshDevice(); S.seedForDelete(); CALLS.length=0;
  FETCH = async u => u.includes('/api/delete-account') ? R(200,{ ok:true, counts:{} }) : R(200,{});
  let d = await S.runDelete('tok');
  ok(d.status==='deleted', 'case7: 200 {ok:true} → deleted');
  ok(store.get('gesso.device')===undefined && store.get('gesso.cap')===undefined, 'case7: device + cap storage cleared');
  ok(store.get('gesso.saved')===undefined && store.get('gesso.savedAt')===undefined && store.get('gesso.seen')===undefined, 'case7: gallery + seen storage cleared');
  { const st=S.delState(); ok(st.saved===0 && st.seen===0 && st.savedSynced===false && st.regPromise===null && st.authUser===null, 'case7: in-memory identity fully reset (SAVED/SEEN/__savedSynced/__regPromise/authUser)'); }
  ok(!S.isDeleting(), 'case7: deletion lock released after cleanup');

  // 8. malformed 200 (no ok:true) → NOT deleted; local data preserved; lock released
  freshDevice(); S.seedForDelete(); CALLS.length=0;
  FETCH = async u => u.includes('/api/delete-account') ? R(200,{ counts:{} }) : R(200,{});
  d = await S.runDelete('tok');
  ok(d.status==='error', 'case8: malformed 200 → error (not deleted)');
  ok(store.get('gesso.device')==='devx' && S.delState().saved===1, 'case8: local data preserved on malformed 200');
  ok(!S.isDeleting(), 'case8: lock released after malformed 200');

  // 9. 401 → unverified; ALL local data + session preserved (no cleanup)
  freshDevice(); S.seedForDelete(); CALLS.length=0;
  FETCH = async u => u.includes('/api/delete-account') ? R(401,{ error:'invalid session' }) : R(200,{});
  d = await S.runDelete('tok');
  ok(d.status==='unverified', 'case9: 401 → unverified');
  ok(store.get('gesso.device')==='devx' && store.get('gesso.saved')==='["w1"]', 'case9: 401 preserves device + gallery storage');
  { const st=S.delState(); ok(st.saved===1 && st.seen===1 && st.authUser && st.authUser.id==='u1', 'case9: 401 preserves in-memory identity + session'); }
  ok(!S.isDeleting(), 'case9: lock released after 401');

  // 10. 500 → error; preserved; lock released
  freshDevice(); S.seedForDelete(); CALLS.length=0;
  FETCH = async u => u.includes('/api/delete-account') ? R(500,{}) : R(200,{});
  d = await S.runDelete('tok');
  ok(d.status==='error' && store.get('gesso.device')==='devx' && !S.isDeleting(), 'case10: 500 → error, preserved, lock released');

  // 11. network failure (throw) → error; preserved
  freshDevice(); S.seedForDelete(); CALLS.length=0;
  FETCH = async u => { if(u.includes('/api/delete-account')) throw new Error('net'); return R(200,{}); };
  d = await S.runDelete('tok');
  ok(d.status==='error' && store.get('gesso.device')==='devx' && !S.isDeleting(), 'case11: network failure → error, preserved');

  // 12. double-submit: a second runDelete while one is in flight returns busy; exactly one POST
  freshDevice(); S.seedForDelete(); CALLS.length=0;
  let release; FETCH = async u => u.includes('/api/delete-account') ? new Promise(r=>{ release=()=>r(R(200,{ ok:true })); }) : R(200,{});
  const p1=S.runDelete('tok'); const p2=await S.runDelete('tok');
  ok(p2.status==='busy', 'case12: concurrent runDelete → busy');
  release(); await p1;
  ok(CALLS.filter(c=>c.url.includes('/api/delete-account')).length===1, 'case12: exactly one delete POST despite double-submit');

  // 13. protected calls blocked while deletion is pending (capFetch refuses to start; no request issued)
  freshDevice(); S.setDeleting(true); CALLS.length=0;
  let threw=false; try{ await S.capFetch((dev,cap)=>R(200,{})); }catch{ threw=true; }
  ok(threw, 'case13: capFetch rejects while deletion pending');
  ok(!CALLS.some(c=>c.url.includes('/api/register-device')||c.url.includes('/api/')), 'case13: no protected request started during deletion');
  S.setDeleting(false);

  // 14. stale cross-tab marker (crash/reload mid-delete) self-expires → capFetch works again
  freshDevice(); store.set('gesso.deleting', String(Date.now()-120000)); CALLS.length=0;
  FETCH = async u => R(200,{});
  ok(!S.isDeleting(), 'case14: stale deletion marker treated as expired');
  ok(store.get('gesso.deleting')===undefined, 'case14: stale marker cleared on read');
  let ran=false; await S.capFetch((dev,cap)=>{ ran=true; return R(200,{}); });
  ok(ran, 'case14: capFetch proceeds after stale-marker recovery');

  // 15. fresh cross-tab marker (another tab actively deleting) blocks capFetch
  freshDevice(); store.set('gesso.deleting', String(Date.now())); CALLS.length=0;
  ok(S.isDeleting(), 'case15: fresh deletion marker is active within lease');
  let blocked=false; try{ await S.capFetch((dev,cap)=>R(200,{})); }catch{ blocked=true; }
  ok(blocked, 'case15: capFetch blocked by a fresh cross-tab marker');
  store.delete('gesso.deleting');

  // 16. materially future-dated marker (clock skew / tamper) treated as stale; minor skew still active
  freshDevice(); store.set('gesso.deleting', String(Date.now()+3600000)); FETCH=async u=>R(200,{});
  ok(!S.isDeleting(), 'case16: 1h-future marker treated as stale');
  ok(store.get('gesso.deleting')===undefined, 'case16: future-dated marker cleared on read');
  freshDevice(); store.set('gesso.deleting', String(Date.now()+2000));
  ok(S.isDeleting(), 'case16: minor +2s skew still within tolerance (active)');
  store.delete('gesso.deleting');

  console.log(`client-capability.test: ${pass} assertions passed (registration-failure, retry, 409 rotation, conflict/unregistered banner, builder inventory, account-deletion success/malformed/401/500/network/double-submit/lock, deletion-lease stale-recovery)`);
}
main().catch(e => fail('main', e));
