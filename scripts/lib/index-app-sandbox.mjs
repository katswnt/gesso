// A stubbed-DOM sandbox that loads index.html's real inline app script (no build, no jsdom). Shared by
// tests/dom-harness.mjs (load + builder smoke) and the teaching-v2 current-renderer preview, which runs the
// actual reveal code instead of a hand copy (review finding 15). A self-returning Proxy stands in for every DOM
// node; the element with id "stage" is a recording object so a render's innerHTML can be read back.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

export const NODE = new Proxy(function () {}, {
  get(_t, p) {
    if (p === Symbol.toPrimitive || p === Symbol.toStringTag) return () => '';
    if (p === 'length') return 0;
    if (p === 'style' || p === 'dataset' || p === 'classList') return NODE;
    if (p === 'value' || p === 'textContent' || p === 'innerHTML' || p === 'className' || p === 'id') return '';
    if (p === 'children' || p === 'childNodes') return [];
    if (p === Symbol.iterator) return [][Symbol.iterator].bind([]);
    return NODE;
  },
  apply() { return NODE; },
  construct() { return NODE; },
  set() { return true; },
});

// The app script is by far the largest inline <script> block of index.html.
export function indexAppScript(root = '.') {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const app = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).sort((a, b) => b.length - a.length)[0];
  if (!app || app.length < 5000) throw new Error(`index.html: largest inline script only ${app && app.length} chars`);
  return app;
}
export const indexAppSha256 = (root = '.') => createHash('sha256').update(indexAppScript(root)).digest('hex');

export function createIndexSandbox({ root = '.', dataFiles = [], globals = {}, syncTimers = false, onDataError = null } = {}) {
  const store = new Map();
  const localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  const stage = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
  const location = { pathname: '/', search: '', href: 'https://gesso.test/', origin: 'https://gesso.test' };
  const document = new Proxy({
    getElementById: id => (id === 'stage' ? stage : NODE), querySelector: () => NODE, querySelectorAll: () => [],
    createElement: () => NODE, createElementNS: () => NODE, createTextNode: () => NODE,
    addEventListener() {}, removeEventListener() {}, body: NODE, head: NODE, documentElement: NODE, location,
  }, { get(t, p) { return p in t ? t[p] : NODE; } });
  const L = new Proxy(function () { return NODE; }, { get() { return () => NODE; }, apply() { return NODE; }, construct() { return NODE; } });
  const ctx = {
    console, document, localStorage, L,
    navigator: { userAgent: 'harness', language: 'en', clipboard: { writeText: async () => {} }, share: undefined },
    location, history: { pushState() {}, replaceState() {} },
    setTimeout: syncTimers ? (f) => { try { typeof f === 'function' && f(); } catch {} return 0; } : () => 0,
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
    ...globals,
  };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  for (const f of dataFiles) {
    try { vm.runInContext(readFileSync(join(root, f), 'utf8'), ctx, { filename: f }); }
    catch (e) { if (onDataError) onDataError(f, e); else throw e; }
  }
  const app = indexAppScript(root);
  vm.runInContext(app, ctx, { filename: 'index.html#app' });
  return { ctx, stage, run: code => vm.runInContext(code, ctx), appSha256: createHash('sha256').update(app).digest('hex') };
}
