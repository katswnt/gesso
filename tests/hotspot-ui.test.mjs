// Focused regression for the player-facing look-closer (hotspot) interaction contract.
//   node tests/hotspot-ui.test.mjs
// Runs the REAL app script in a vm context and exercises the actual normalization / session / transform
// functions — not source-string matching, and not the load-only dom-harness. The pre-answer-safety case is
// behavioural: it captures the app's own document click listener and spies openZoom to prove that an ordinary
// `.art` click is handed NO marker or note data.
import { readFileSync } from "node:fs";
import vm from "node:vm";

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log("  ok   " + m); } else { fail++; console.log("  FAIL " + m); } };
const fatal = (where, e) => { console.error(`❌ hotspot-ui FAIL @ ${where}:\n   ${e && e.stack ? e.stack.split("\n").slice(0,4).join("\n   ") : e}`); process.exit(1); };

// ---- stubs (gameplay-smoke idiom, plus real listener recording for the click-handler assertion) ----
const NODE = new Proxy(function(){}, { get(_t,p){ if(p===Symbol.toPrimitive||p===Symbol.toStringTag)return()=>""; if(p==="length")return 0; if(p==="style"||p==="dataset"||p==="classList")return NODE; if(["value","textContent","innerHTML","className","id"].includes(p))return ""; if(p==="children"||p==="childNodes")return []; if(p===Symbol.iterator)return [][Symbol.iterator].bind([]); return NODE; }, apply(){return NODE;}, construct(){return NODE;}, set(){return true;} });
const store = new Map();
const localStorage = { getItem:k=>store.has(k)?store.get(k):null, setItem:(k,v)=>store.set(k,String(v)), removeItem:k=>store.delete(k) };
const docListeners = [];
const document = new Proxy({
  getElementById:()=>NODE, querySelector:()=>NODE, querySelectorAll:()=>[], createElement:()=>NODE,
  createElementNS:()=>NODE, createTextNode:()=>NODE,
  addEventListener(type,fn){ docListeners.push({type,fn}); }, removeEventListener(){},
  body:NODE, head:NODE, documentElement:NODE, activeElement:null,
  location:{pathname:"/",search:"",href:"https://gesso.test/"},
}, { get(t,p){ return p in t ? t[p] : NODE; } });
const L = new Proxy(function(){return NODE;}, { get(){return()=>NODE;}, apply(){return NODE;}, construct(){return NODE;} });
const ctx = { console, document, localStorage, L, navigator:{userAgent:"hotspot",language:"en",clipboard:{writeText:async()=>{}}},
  location:document.location, history:{pushState(){},replaceState(){}},
  setTimeout:(f)=>{try{typeof f==="function"&&f();}catch{}return 0;}, clearTimeout(){}, setInterval:()=>0, clearInterval(){},
  requestAnimationFrame(f){ try{typeof f==="function"&&f();}catch{} return 0; },
  fetch:async()=>({ok:true,json:async()=>({}),text:async()=>""}),
  matchMedia:()=>({matches:false,addEventListener(){},addListener(){}}),
  supabase:{createClient:()=>new Proxy({},{get(){return()=>({data:null,error:null});}})},
  addEventListener(){}, removeEventListener(){}, alert(){}, confirm:()=>true, prompt:()=>null,
  scrollTo(){}, scroll(){}, scrollBy(){}, atob:s=>Buffer.from(s,"base64").toString("binary"), btoa:s=>Buffer.from(s,"binary").toString("base64"),
  Math, Date, JSON, Object, Array, String, Number, Boolean, RegExp, Map, Set, Promise, parseInt, parseFloat, isNaN, isFinite,
  encodeURIComponent, decodeURIComponent, URL, URLSearchParams, Intl, Error, TypeError, crypto:globalThis.crypto, structuredClone:globalThis.structuredClone };
ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
for (const f of ["data/cues.js","data/teach-works.js","data/hotspots.js","data/pool.js","data/fame.js","data/regions.js","data/daily-order.js","data/countries.js","data/museums.js"]) {
  try { vm.runInContext(readFileSync(f,"utf8"), ctx, { filename:f }); } catch(e){ fatal("load "+f, e); }
}
const html = readFileSync("index.html","utf8");
const app = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).sort((a,b)=>b.length-a.length)[0];
const hooks = `
;globalThis.__hs = {
  revealDetails, newDetailSession, detailVisible, toggleAllDetails, toggleOneDetail,
  nextDetailSelection, clampDetailPan, centerOnDetail, detailToggleHTML, detailMarksHTML,
  DETAIL_SCALE, DETAIL_MAX_SCALE, LOOK_EYE, LOOK_EYE_OFF,
  addHotspots(id, arr){ HOTSPOTS[id] = arr; },
  setVision(map){ __VISMAP = map; },
  spyZoom(){ const calls=[]; const orig=openZoom; openZoom=function(){ calls.push([...arguments]); }; return { calls, restore(){ openZoom=orig; } }; },
};`;
try { vm.runInContext(app + hooks, ctx, { filename:"index.html" }); } catch(e){ fatal("eval app", e); }
const H = ctx.__hs;
const D = H.revealDetails;

// ---------------------------------------------------------------- normalization
console.log("\nNORMALIZATION ACROSS CONTENT GENERATIONS");
{ // 1. v2 notes → exact heading/body/coordinate binding, numbering matched to the Study Notes row
  const study = { notes:[
    { head:"Hidden cards", body:"Palmed behind his back.", x:10, y:65 },
    { head:"Sideways glance", body:"The conspiracy's hinge.", x:34, y:38 },
    { head:"Unpinned thought", body:"No coordinates, so no marker." } ] };
  const d = D({id:"v2-work"}, study);
  ok("v2: only pinned notes become markers", d.length === 2);
  ok("v2: heading bound exactly", d[0].head === "Hidden cards" && d[1].head === "Sideways glance");
  ok("v2: body bound exactly", d[0].body === "Palmed behind his back." && d[1].body === "The conspiracy's hinge.");
  ok("v2: coordinates preserved as percent", d[0].x === 10 && d[0].y === 65 && d[1].x === 34 && d[1].y === 38);
  ok("v2: marker number matches the Study Notes row (index+1)", d[0].index === 0 && d[0].n === 1 && d[1].index === 1 && d[1].n === 2);
  ok("v2: unpinned note is excluded from markers but keeps its own note row", !d.some(x => x.head === "Unpinned thought"));
  ok("v2: source tagged", d.every(x => x.source === "note"));
}
{ // 2. legacy hotspots + study.cues fallback
  H.addHotspots("legacy-work", [{n:1,x:20,y:30},{n:2,x:60,y:70}]);
  const d = D({id:"legacy-work"}, { cues:["Cue one","Cue two"] });
  ok("legacy: both hotspots become markers", d.length === 2);
  ok("legacy: neutral 'Detail N' heading when none is authored", d[0].head === "Detail 1" && d[1].head === "Detail 2");
  ok("legacy: cue text shown honestly as the body", d[0].body === "Cue one" && d[1].body === "Cue two");
  ok("legacy: hotspot numbering preserved", d[0].n === 1 && d[1].n === 2);
  ok("legacy: source tagged", d.every(x => x.source === "cue"));
  const noCue = D({id:"legacy-work"}, {});
  ok("legacy: missing cue yields an empty body, never invented copy", noCue.length === 2 && noCue[0].body === "" && noCue[1].body === "");
}
{ // 3. label-only vision pins (0–1 fractions)
  H.setVision({ "pin-work": { pins:[ {x:0.25,y:0.5,label:"Gilded rim"}, {x:0.8,y:0.2} ] } });
  const d = D({id:"pin-work"}, { notes:[{head:"unpinned",body:"b"}] });   // v2 record with no pinned note → pins
  ok("pins: label used as the heading", d[0].head === "Gilded rim");
  ok("pins: no body is fabricated", d.every(x => x.body === ""));
  ok("pins: 0–1 fractions converted to percent", d[0].x === 25 && d[0].y === 50 && d[1].x === 80 && d[1].y === 20);
  ok("pins: label-less pin falls back to a neutral heading", d[1].head === "Detail 2");
}
{ // 4. malformed / out-of-range coordinates are dropped gracefully
  const bad = { notes:[
    { head:"null x", body:"b", x:null, y:10 }, { head:"string x", body:"b", x:"12", y:10 },
    { head:"NaN y", body:"b", x:10, y:NaN }, { head:"negative", body:"b", x:-5, y:10 },
    { head:"over 100", body:"b", x:120, y:10 }, { head:"missing y", body:"b", x:10 },
    { head:"good", body:"b", x:50, y:50 } ] };
  const d = D({id:"malformed"}, bad);
  ok("malformed coordinates excluded, valid one kept", d.length === 1 && d[0].head === "good");
  ok("boundary coordinates 0 and 100 are valid", D({id:"edge"},{notes:[{head:"a",body:"",x:0,y:0},{head:"b",body:"",x:100,y:100}]}).length === 2);
  ok("a work with no markers yields an empty list", D({id:"nothing-at-all"}, {}).length === 0);
}

// ---------------------------------------------------------------- title-row control
console.log("\nTITLE-ROW VISIBILITY CONTROL");
{ // 5 + zero-marker case
  ok("zero markers → NO control rendered at all", H.detailToggleHTML(0, true) === "");
  const vis = H.detailToggleHTML(7, true), hid = H.detailToggleHTML(7, false);
  ok("visible: shows the count as the only visible text", /<span>7 details<\/span>/.test(vis));
  ok("visible: aria-pressed=true", /aria-pressed="true"/.test(vis));
  ok("visible: aria-label offers to HIDE", /aria-label="Hide 7 look-closer details"/.test(vis));
  ok("visible: shows the crossed-eye icon (the action is to hide)", vis.includes(H.LOOK_EYE_OFF) && !vis.includes(H.LOOK_EYE));
  ok("hidden: aria-pressed=false", /aria-pressed="false"/.test(hid));
  ok("hidden: aria-label offers to SHOW", /aria-label="Show 7 look-closer details"/.test(hid));
  ok("hidden: shows the magnifier icon (the action is to restore)", hid.includes(H.LOOK_EYE) && !hid.includes(H.LOOK_EYE_OFF));
  ok("singular count reads correctly", /<span>1 detail<\/span>/.test(H.detailToggleHTML(1,true)));
  ok("no user-facing 'focus' wording", !/focus/i.test(vis + hid));
}

// ---------------------------------------------------------------- shared session state
console.log("\nSHARED MARKER SESSION (card ⇄ enlarged view)");
{ // 6 + 7 + 11
  const details = D({id:"v2-work"}, { notes:[{head:"A",body:"a",x:10,y:10},{head:"B",body:"b",x:20,y:20},{head:"C",body:"c",x:30,y:30}] });
  const s = H.newDetailSession(details);
  ok("fresh session: all markers visible", details.every(d => H.detailVisible(s, d.index)));
  ok("fresh session: nothing selected", s.selected === null);
  H.toggleAllDetails(s);
  ok("hide-all from EITHER surface hides every marker (one shared state)", details.every(d => !H.detailVisible(s, d.index)) && s.allVisible === false);
  H.toggleAllDetails(s);
  ok("restore-all brings them all back", details.every(d => H.detailVisible(s, d.index)) && s.allVisible === true);
  H.toggleOneDetail(s, 1);
  ok("hide-one hides ONLY that marker", H.detailVisible(s,0) && !H.detailVisible(s,1) && H.detailVisible(s,2));
  ok("hide-one leaves the note data itself untouched", details[1].head === "B" && details[1].body === "b");
  H.toggleOneDetail(s, 1);
  ok("hide-one is reversible from the tray", H.detailVisible(s, 1));
  H.toggleOneDetail(s, 2); H.toggleAllDetails(s); H.toggleAllDetails(s);
  ok("'Show all markers' also clears individual hides (always recoverable)", details.every(d => H.detailVisible(s, d.index)));
  const s2 = H.newDetailSession(details);
  ok("re-rendering a reveal starts from a clean session", s2.allVisible === true && s2.selected === null && s2.hidden.size === 0);
}

// ---------------------------------------------------------------- selection + transform
console.log("\nMARKER-DIRECTED ZOOM");
{ // 8 + 9 + 12
  ok("selecting a marker goes to 1.5x", H.nextDetailSelection(null, 2).scale === H.DETAIL_SCALE && H.DETAIL_SCALE === 1.5);
  ok("selecting the SAME marker again returns to the whole work at 1x", H.nextDetailSelection(2, 2).selected === null && H.nextDetailSelection(2, 2).scale === 1);
  ok("selecting a DIFFERENT marker re-selects at 1.5x", H.nextDetailSelection(2, 5).selected === 5 && H.nextDetailSelection(2, 5).scale === 1.5);

  // canvas 1000x800 fitted inside a 1000x800 stage; at 1.5x the content is 1500x1200
  const baseW=1000, baseH=800, stageW=1000, stageH=800, sc=1.5;
  const mid = H.centerOnDetail(50, 50, baseW, baseH, stageW, stageH, sc);
  ok("a centre marker needs no pan", Math.abs(mid.tx) < 1e-9 && Math.abs(mid.ty) < 1e-9);
  const right = H.centerOnDetail(75, 50, baseW, baseH, stageW, stageH, sc);
  ok("an off-centre marker pans toward centre", right.tx < 0 && Math.abs(right.tx) > 1);
  // clamp limits: (baseW*scale - stageW)/2 = (1500-1000)/2 = 250 ; (1200-800)/2 = 200
  const edge = H.centerOnDetail(0, 0, baseW, baseH, stageW, stageH, sc);
  ok("an EDGE marker is clamped to the content edge, not flung into empty space", edge.tx === 250 && edge.ty === 200);
  const far = H.centerOnDetail(100, 100, baseW, baseH, stageW, stageH, sc);
  ok("the opposite edge clamps symmetrically", far.tx === -250 && far.ty === -200);
  ok("clamp bounds a wild pan", JSON.stringify(H.clampDetailPan(99999,-99999,baseW,baseH,stageW,stageH,sc)) === JSON.stringify({tx:250,ty:-200}));
  const at1 = H.clampDetailPan(120, 90, baseW, baseH, stageW, stageH, 1);
  ok("at 1x the content is not larger than the stage, so pan is pinned to 0", at1.tx === 0 && at1.ty === 0);
  const detailsX = D({id:"v2-work"}, { notes:[{head:"A",body:"aa",x:10,y:10},{head:"B",body:"bb",x:90,y:90}] });
  const a = H.centerOnDetail(detailsX[0].x, detailsX[0].y, baseW, baseH, stageW, stageH, sc);
  const b = H.centerOnDetail(detailsX[1].x, detailsX[1].y, baseW, baseH, stageW, stageH, sc);
  ok("selecting a different marker moves the centre", a.tx !== b.tx && a.ty !== b.ty);
  ok("and swaps in that marker's own text", detailsX[0].body === "aa" && detailsX[1].body === "bb");
}

// ---------------------------------------------------------------- pre-answer safety (behavioural)
console.log("\nPRE-ANSWER SAFETY");
{ // 10
  const spy = H.spyZoom();
  const clickHandlers = docListeners.filter(l => l.type === "click");
  ok("the app registers a document click handler for ordinary artwork", clickHandlers.length >= 1);
  const evt = { target:{ classList:{ contains:c => c === "art" }, dataset:{ zoom:"https://example.test/art.jpg" }, src:"https://example.test/art.jpg" },
                preventDefault(){}, stopPropagation(){}, stopImmediatePropagation(){} };
  for(const l of clickHandlers){ try{ l.fn(evt); }catch{} }
  ok("an ordinary .art click opens the viewer", spy.calls.length >= 1);
  const withDetails = spy.calls.filter(a => a[1] && Array.isArray(a[1].details) && a[1].details.length);
  ok("NO marker/detail data is passed to an ordinary (pre-answer) zoom", withDetails.length === 0);
  const anyOpts = spy.calls.filter(a => a.length > 1 && a[1] != null);
  ok("the global handler passes the source only — no options object at all", anyOpts.length === 0);
  const leaked = spy.calls.filter(a => a[1] && (a[1].session || a[1].selectedIndex != null));
  ok("no session or preselected detail leaks into a pre-answer zoom", leaked.length === 0);
  spy.restore();
}

// ---------------------------------------------------------------- marker markup
console.log("\nCARD MARKER MARKUP");
{
  const details = D({id:"v2-work"}, { notes:[{head:"Hidden cards",body:"b",x:10,y:65},{head:"Glance",body:"b",x:34,y:38}] });
  const html2 = H.detailMarksHTML(details);
  ok("markers carry data-detail for wiring", (html2.match(/data-detail="/g)||[]).length === 2);
  ok("marker position comes from the note coordinates", html2.includes("top:65%;left:10%"));
  ok("marker keeps the existing .lookmark class (declutter still applies)", (html2.match(/class="lookmark"/g)||[]).length === 2);
  ok("marker has an accessible label naming the detail", html2.includes('aria-label="Detail 1: Hidden cards"'));
  ok("zero details render no marker container", H.detailMarksHTML([]) === "");
}

// ---------------------------------------------------------------- shared-state-on-open guard
// Regression guard for a real bug found in browser verification: the viewer built its markers but never applied
// the shared session before first paint, so opening the enlarged view after "hide all" showed the markers again.
// The behavioural proof lives in the browser suite; this keeps the wiring from silently disappearing.
console.log("\nVIEWER APPLIES SHARED STATE ON OPEN");
{
  const src = readFileSync("index.html","utf8");
  const start = src.indexOf("function openZoom(src, opts)");
  const end = src.indexOf("document.addEventListener('click'", start);
  const body = src.slice(start, end);
  const appendAt = body.indexOf("document.body.appendChild(lb)");
  const syncAt = body.indexOf("syncMarkers(); renderFooter(); apply();", appendAt);   // the OPEN-time call, after the node is in the document
  ok("openZoom body located", start > -1 && end > start && body.length > 500);
  ok("openZoom applies the shared marker state at open time", syncAt > -1 && appendAt > -1 && syncAt > appendAt);
  ok("openZoom defines exactly one shared-state sync path", (body.match(/const syncMarkers\s*=/g)||[]).length === 1);
}

console.log(`\n${fail ? "❌" : "✅"} hotspot-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
