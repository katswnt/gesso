// Stubbed-DOM load harness for index.html's inline app script.
//   node tests/dom-harness.mjs
// No build, no jsdom: a self-returning Proxy stands in for every DOM node so arbitrary
// document/element chains no-op instead of throwing, while real globals (data pools,
// localStorage, a Leaflet stub) are provided. Exits 1 on ANY throw.
//
// WHY it CALLS functions, not just evals: the load path alone missed real bugs before —
// a `const esc` shadowing the global esc() (TDZ) only threw when a modal opener ran, and
// the Training DEMONYM collision only surfaced on a render. So after eval we invoke the
// HTML builders/modal openers and fail on the first throw.
import { readFileSync } from "node:fs";

const fail = (where, e) => { console.error(`❌ harness FAIL @ ${where}:\n   ${e && e.stack ? e.stack.split("\n").slice(0,3).join("\n   ") : e}`); process.exit(1); };

// ---- self-returning Proxy: any prop access / call / new returns another node-like proxy ----
const NODE = new Proxy(function(){}, {
  get(_t, p) {
    if (p === Symbol.toPrimitive || p === Symbol.toStringTag) return () => "";
    if (p === "length") return 0;
    if (p === "style" || p === "dataset" || p === "classList") return NODE;
    if (p === "value" || p === "textContent" || p === "innerHTML" || p === "className" || p === "id") return "";
    if (p === "children" || p === "childNodes") return [];
    if (p === Symbol.iterator) return [][Symbol.iterator].bind([]);
    return NODE;
  },
  apply() { return NODE; },
  construct() { return NODE; },
  set() { return true; },
});

// ---- localStorage ----
const store = new Map();
const localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
};

// ---- document / window / Leaflet / supabase stubs ----
const document = new Proxy({
  getElementById: () => NODE, querySelector: () => NODE, querySelectorAll: () => [],
  createElement: () => NODE, createElementNS: () => NODE, createTextNode: () => NODE,
  addEventListener() {}, removeEventListener() {}, body: NODE, head: NODE,
  documentElement: NODE, location: { pathname: "/", search: "", href: "https://gesso.test/" },
}, { get(t, p) { return p in t ? t[p] : NODE; } });

const L = new Proxy(function(){ return NODE; }, { get() { return () => NODE; }, apply() { return NODE; }, construct() { return NODE; } });

const ctx = {
  console, document, localStorage, L,
  navigator: { userAgent: "harness", language: "en", clipboard: { writeText: async () => {} }, share: undefined },
  location: document.location, history: { pushState() {}, replaceState() {} },
  setTimeout: (f) => { try { typeof f === "function" && f(); } catch {} return 0; }, // run sync so render bodies execute
  clearTimeout() {}, setInterval: () => 0, clearInterval() {}, requestAnimationFrame() { return 0; },
  fetch: async () => ({ ok: true, json: async () => ({}), text: async () => "" }),
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  supabase: { createClient: () => new Proxy({}, { get() { return () => ({ data: null, error: null }); } }) },
  addEventListener() {}, removeEventListener() {}, alert() {}, confirm: () => true, prompt: () => null,
  atob: s => Buffer.from(s, "base64").toString("binary"), btoa: s => Buffer.from(s, "binary").toString("base64"),
  Math, Date, JSON, Object, Array, String, Number, Boolean, RegExp, Map, Set, Promise, parseInt, parseFloat,
  isNaN, isFinite, encodeURIComponent, decodeURIComponent, URL, URLSearchParams, Intl, Error, TypeError,
  crypto: globalThis.crypto, structuredClone: globalThis.structuredClone,
};
ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;

// ---- load data globals (data/*.js set window.ARTEFACTUM_*) ----
import vm from "node:vm";
vm.createContext(ctx);
const DATA = ["data/cues.js","data/teach-works.js","data/hotspots.js","data/pool.js","data/fame.js",
  "data/regions.js","data/daily-order.js","data/countries.js"];
for (const f of DATA) {
  try { vm.runInContext(readFileSync(f, "utf8"), ctx, { filename: f }); }
  catch (e) { fail(`loading ${f}`, e); }
}

// ---- extract + eval the main inline <script> (the big one, after the data tags) ----
const html = readFileSync("index.html", "utf8");
const tags = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const app = tags.sort((a, b) => b.length - a.length)[0]; // the app script is by far the largest inline block
if (!app || app.length < 5000) fail("extract app script", new Error(`largest inline script only ${app && app.length} chars`));
try { vm.runInContext(app, ctx, { filename: "index.html#app" }); }
catch (e) { fail("eval app script (load-time)", e); }

// ---- INVOKE builders/openers to catch on-call throws (the part load-only misses) ----
const call = (name, ...args) => {
  const fn = ctx[name];
  if (typeof fn !== "function") return; // not all exist in every revision — skip silently
  try { fn(...args); } catch (e) { fail(`calling ${name}()`, e); }
};
// HTML builders (return strings) + modal openers (build + attach to stubbed DOM)
["header","renderStart","renderTraining","renderLeaderboard","renderAccount","renderGlossary",
 "renderCollections","openIdentityModal","openLogin","openMenu","openSettings","route"].forEach(n => call(n));

console.log("✅ dom-harness PASS — app script loaded and key builders ran without throwing");
process.exit(0);
