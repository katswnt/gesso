// FAIL-CLOSED route-restoration test for G-02. The narrowed vercel.json rewrites promise that every allowlisted
// SPA path is served index.html AND actually restores a real view (not a 404, not a silent home fallback we
// didn't intend). This drives index.html's renderFromPath() (index.html:2652) for each exact route form in a
// stubbed DOM and asserts which view it dispatches to — this is what proves a rewrite target is restorable and
// what would have caught the /gallery mismatch (pathFor emits /gallery but renderFromPath can't restore it).
//
// Deliberately NOT folded into tests/dom-harness.mjs, which (per audit finding G-14) silently skips missing
// functions and suppresses timer throws. This file THROWS if renderFromPath, its DOM fixture, the observation
// hook, or any expected view marker is missing — no silent skips.
//   node tests/routes.test.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { ROUTE_PATTERNS } from '../scripts/public-manifest.mjs';

const die = (m) => { console.error('❌ routes.test FAIL — ' + m); process.exit(1); };

// ---- stubbed DOM (mirrors dom-harness.mjs: a self-returning Proxy no-ops all DOM writes) ----
const NODE = new Proxy(function () {}, {
  get(_t, p) {
    if (p === Symbol.toPrimitive || p === Symbol.toStringTag) return () => '';
    if (p === 'length') return 0;
    if (p === 'style' || p === 'dataset' || p === 'classList') return NODE;
    if (p === 'value' || p === 'textContent' || p === 'innerHTML' || p === 'className' || p === 'id') return '';
    if (p === 'children' || p === 'childNodes') return [];
    if (p === Symbol.iterator) return [][Symbol.iterator].bind([]);
    return NODE;
  },
  apply() { return NODE; }, construct() { return NODE; }, set() { return true; },
});
const store = new Map();
const localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
const location = { pathname: '/', search: '', href: 'https://gesso.test/' };   // MUTABLE — reassign pathname per case
const document = new Proxy({
  getElementById: () => NODE, querySelector: () => NODE, querySelectorAll: () => [],
  createElement: () => NODE, createElementNS: () => NODE, createTextNode: () => NODE,
  addEventListener() {}, removeEventListener() {}, body: NODE, head: NODE, documentElement: NODE, location,
}, { get(t, p) { return p in t ? t[p] : NODE; } });
const L = new Proxy(function () { return NODE; }, { get() { return () => NODE; }, apply() { return NODE; }, construct() { return NODE; } });

const ctx = {
  console, document, localStorage, L, location,
  navigator: { userAgent: 'harness', language: 'en', clipboard: { writeText: async () => {} }, share: undefined },
  history: { pushState() {}, replaceState() {} },
  setTimeout: (f) => { try { typeof f === 'function' && f(); } catch {} return 0; },
  clearTimeout() {}, setInterval: () => 0, clearInterval() {}, requestAnimationFrame() { return 0; },
  fetch: async () => ({ ok: true, json: async () => ({}), text: async () => '' }),
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  supabase: { createClient: () => new Proxy({}, { get() { return () => ({ data: null, error: null }); } }) },
  addEventListener() {}, removeEventListener() {}, alert() {}, confirm: () => true, prompt: () => null,
  scrollTo() {}, scroll() {}, scrollBy() {},
  atob: s => Buffer.from(s, 'base64').toString('binary'), btoa: s => Buffer.from(s, 'binary').toString('base64'),
  Math, Date, JSON, Object, Array, String, Number, Boolean, RegExp, Map, Set, Promise, parseInt, parseFloat,
  isNaN, isFinite, encodeURIComponent, decodeURIComponent, URL, URLSearchParams, Intl, Error, TypeError,
  crypto: globalThis.crypto, structuredClone: globalThis.structuredClone,
};
ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);

// ---- load data globals + the app script ----
for (const f of ['data/cues.js', 'data/teach-works.js', 'data/hotspots.js', 'data/pool.js', 'data/fame.js',
  'data/regions.js', 'data/daily-order.js', 'data/countries.js', 'data/museums.js']) {
  try { vm.runInContext(readFileSync(f, 'utf8'), ctx, { filename: f }); } catch (e) { die(`loading ${f}: ${e && e.message}`); }
}
const html = readFileSync('index.html', 'utf8');
const app = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).sort((a, b) => b.length - a.length)[0];
if (!app || app.length < 5000) die('could not extract the app script from index.html');
try { vm.runInContext(app, ctx, { filename: 'index.html#app' }); } catch (e) { die(`eval app script: ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}`); }

if (typeof ctx.renderFromPath !== 'function') die('renderFromPath is not defined — cannot verify routing');

// ---- install view spies (top-level function decls are global props, so reassignment is observable) ----
// Any dispatch target renderFromPath can reach; a required one that is missing is a hard failure below.
const SPY_FNS = ['renderStart', 'renderDayView', 'startGame', 'startInfinite', 'renderMovement', 'renderLeaderboard',
  'renderTraining', 'renderAccount', 'route', 'renderFinal', 'renderRound', 'renderReveal'];
let lastCalls = [];
for (const n of SPY_FNS) {
  if (typeof ctx[n] === 'function') ctx[n] = (...a) => { lastCalls.push(n); return undefined; };
}
const drive = (pathname) => { lastCalls = []; ctx.location.pathname = pathname; try { ctx.renderFromPath(); } catch (e) { die(`renderFromPath('${pathname}') threw: ${e && e.message}`); } };

// fail-closed observability sanity: '/' MUST restore home via the renderStart spy, else we cannot observe routing
drive('/');
if (!lastCalls.includes('renderStart')) die("cannot observe routing (renderStart spy never fired for '/') — refusing to pass blind");

// ---- exact route cases (date-based use a PAST date so cold-vs-today game state can't shift the dispatch) ----
const CASES = [
  { name: 'date',             path: '/2020-01-01',                 expect: 'renderDayView' },
  { name: 'date/tier',        path: '/2020-01-01/easy',            expect: 'startGame' },
  { name: 'date/tier/result', path: '/2020-01-01/easy/result',     expect: 'renderDayView' },
  { name: 'date/tier/round',  path: '/2020-01-01/easy/r2',         expect: 'renderDayView' },
  { name: 'leaderboard',      path: '/leaderboard',                expect: 'renderLeaderboard' },
  { name: 'leaderboard/date', path: '/leaderboard/2020-01-01',     expect: 'renderLeaderboard' },
  { name: 'register',         path: '/register',                   expect: 'renderLeaderboard' },
  { name: 'register/date',    path: '/register/2020-01-01',        expect: 'renderLeaderboard' },
  { name: 'infinite/tier',    path: '/infinite/easy',              expect: 'startInfinite' },
  { name: 'movement/slug',    path: '/movement/Impressionism',     expect: 'renderMovement' },
  { name: 'training',         path: '/training',                   expect: 'renderTraining' },
  { name: 'account',          path: '/account',                    expect: 'renderAccount' },
  { name: 'archive',          path: '/archive',                    expect: 'route' },
  { name: 'streak',           path: '/streak',                     expect: 'route' },
  { name: 'stats',            path: '/stats',                      expect: 'route' },
  { name: 'glossary',         path: '/glossary',                   expect: 'route' },
  { name: 'collections',      path: '/collections',                expect: 'route' },
  { name: 'gallery',          path: '/gallery',                    expect: 'home' },     // known non-restore -> home
  { name: 'gallery/id',       path: '/gallery/some-work-id',       expect: 'home' },     // known non-restore -> home
];

// every ROUTE_PATTERN must have a case (no route silently untested) and vice-versa
const casesByName = new Set(CASES.map(c => c.name));
for (const p of ROUTE_PATTERNS) if (!casesByName.has(p.name)) die(`ROUTE_PATTERNS has '${p.name}' but routes.test has no case for it`);
const patByName = new Map(ROUTE_PATTERNS.map(p => [p.name, p]));

for (const c of CASES) {
  const pat = patByName.get(c.name) || die(`case '${c.name}' has no matching ROUTE_PATTERN`);
  if (!pat.re.test(c.path)) die(`case path ${c.path} does not match its own pattern ${pat.re}`);
  if (c.expect === 'home') {
    // home-fallback: renderStart fires and NO real deep-view spy fires
    drive(c.path);
    if (!lastCalls.includes('renderStart')) die(`${c.path} should fall back to home (renderStart) but did not`);
    const deep = lastCalls.filter(n => n !== 'renderStart');
    if (deep.length) die(`${c.path} is a home-fallback but also dispatched: ${deep.join(', ')}`);
  } else {
    if (typeof ctx[c.expect] !== 'function') die(`expected view fn ${c.expect} for ${c.path} is not defined`);
    drive(c.path);
    if (!lastCalls.includes(c.expect)) die(`${c.path} expected to restore ${c.expect}, got: ${lastCalls.join(', ') || '(nothing)'}`);
    if (lastCalls.includes('renderStart')) die(`${c.path} expected ${c.expect} but fell back to home (renderStart)`);
  }
}

// ---- exactness: private / unknown / over-long paths must match NO route pattern (so prod 404s them) ----
const NEGATIVE = [
  '/docs/audits/finding-ledger-2026-08-24.md', '/db/devices.sql', '/server/api/device-ownership.js',
  '/scripts/check-pool.mjs', '/README.md', '/package.json', '/vercel.json', '/api/score', '/api/score.js',
  '/data/pool.js', '/secretpage', '/futuredir/x.txt',
  '/2020-01-01/easy/r2/extra', '/movement/a/b', '/gallery/a/b', '/infinite/nope', '/leaderboard/not-a-date',
];
for (const p of NEGATIVE) {
  const hit = ROUTE_PATTERNS.find(pat => pat.re.test(p));
  if (hit) die(`negative path ${p} unexpectedly matches route pattern '${hit.name}' (${hit.re}) — rewrite is too broad`);
}

console.log(`✅ routes.test PASS — ${CASES.length} exact SPA routes restore their expected view (gallery = intentional home-fallback), ${NEGATIVE.length} private/unknown paths match no rewrite (prod 404)`);
process.exit(0);
