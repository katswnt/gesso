#!/usr/bin/env node
// FAIL-CLOSED offline gate for the G-02 public-output allowlist. Proves, WITHOUT a network or a real deploy, that:
//   1. asset closure — index.html / styles.css cannot reference a local asset that isn't in the allowlist,
//   2. build completeness — build-public.mjs emits every allowlisted path (and the exact generated shard set),
//   3. no leak — the assembled output contains none of the private trees / source / build-input JSON,
//   4. config invariants — vercel.json points at the public dir via `npm run build`, its rewrites are EXACTLY the
//      manifest's route set (all → /index.html, nothing broad), and the no-store header still covers the shell.
// Honest caveat: this first runs scripts/build-teach-shards.mjs, which regenerates the gitignored SOURCE
// data/notes/ in place (a no-diff side effect); only the public ASSEMBLY is redirected to a throwaway temp dir —
// the real ./public is never touched by this gate.
//   node scripts/check-public-output.mjs
import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  PUBLIC_FILES, PUBLIC_DATA_SCRIPTS, PUBLIC_DIRS, isCovered, PLATFORM_EXCEPTIONS,
  referencedLocalAssets, cssUrlRefs, assetStringLiterals, VERCEL_REWRITE_SOURCES,
} from './public-manifest.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const R = p => resolve(ROOT, p);
const fails = [];
const need = (c, m) => { if (!c) fails.push(m); };
const setEq = (a, b) => a.length === b.length && [...a].sort().join(' ') === [...b].sort().join(' ');

function walk(dir, base = '') {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? base + '/' + e.name : e.name;
    if (e.isDirectory()) out.push(...walk(join(dir, e.name), rel));
    else out.push(rel);
  }
  return out;
}

let tmp;
try {
  // --- assemble into a throwaway dir (regenerates source data/notes/ first; only assembly is redirected) ---
  execFileSync('node', ['scripts/build-teach-shards.mjs'], { cwd: ROOT, stdio: 'pipe' });
  tmp = mkdtempSync(join(tmpdir(), 'gesso-public-'));
  execFileSync('node', ['scripts/build-public.mjs', tmp], { cwd: ROOT, stdio: 'pipe' });

  const index = readFileSync(R('index.html'), 'utf8');
  const css = readFileSync(R('styles.css'), 'utf8');

  // 1. ASSET CLOSURE — nothing the browser is told to load may fall outside the allowlist ----------------------
  const referenced = referencedLocalAssets(index);
  for (const rel of referenced) need(isCovered(rel), `index.html references un-allowlisted local asset: ${rel}`);
  for (const rel of cssUrlRefs(css)) need(isCovered(rel), `styles.css url() references un-allowlisted local asset: ${rel}`);
  for (const rel of assetStringLiterals(index)) {
    need(isCovered(rel), `index.html string literal references un-allowlisted asset: ${rel}`);
    need(existsSync(R(rel)), `index.html references a missing asset file: ${rel}`);
  }
  // data-script allowlist must EXACTLY equal the data/*.js the page actually loads (can't ship an unloaded data file)
  const refDataScripts = referenced.filter(r => /^data\/[^/]+\.js$/.test(r));
  need(setEq(refDataScripts, PUBLIC_DATA_SCRIPTS),
    `data-script allowlist != data/*.js referenced by index.html\n      allowlist: ${[...PUBLIC_DATA_SCRIPTS].sort().join(', ')}\n      referenced: ${[...refDataScripts].sort().join(', ')}`);
  need(PLATFORM_EXCEPTIONS.includes('_vercel/insights/script.js'), 'platform-exception list must excuse _vercel insights');

  // 2. BUILD COMPLETENESS -------------------------------------------------------------------------------------
  const emitted = walk(tmp);
  const emittedSet = new Set(emitted);
  for (const f of [...PUBLIC_FILES, ...PUBLIC_DATA_SCRIPTS]) need(emittedSet.has(f), `output missing allowlisted file: ${f}`);
  // generated shard set must match source exactly
  const srcNotes = existsSync(R('data/notes')) ? readdirSync(R('data/notes')).sort() : [];
  const outNotes = emitted.filter(f => f.startsWith('data/notes/')).map(f => f.slice('data/notes/'.length)).sort();
  need(srcNotes.length > 0, 'source data/notes/ is empty (shard build did not run?)');
  need(setEq(srcNotes, outNotes), `output data/notes/ set != source (${outNotes.length} vs ${srcNotes.length})`);
  need(emitted.some(f => f.startsWith('assets/')), 'output has no assets/');

  // 3. NO LEAK — private trees / source / build inputs must never be in the output ---------------------------
  const PRIVATE_TOP = ['docs', 'db', 'tasks', 'tests', 'server', 'scripts', '.github', 'api', 'node_modules'];
  for (const f of emitted) {
    const top = f.split('/')[0];
    need(!PRIVATE_TOP.includes(top), `LEAK: private tree in output: ${f}`);
    need(!/\.mjs$/.test(f), `LEAK: .mjs source in output: ${f}`);
    need(!['README.md', 'package.json', 'package-lock.json', 'vercel.json', '.gitignore'].includes(f), `LEAK: repo meta in output: ${f}`);
    // data/: only the allowlisted *.js and the generated data/notes/ shards are public — never a build-input json
    if (top === 'data' && f !== 'data' ) {
      const okData = PUBLIC_DATA_SCRIPTS.includes(f) || f.startsWith('data/notes/');
      need(okData, `LEAK: non-public data file in output: ${f}`);
    }
  }

  // 4. CONFIG INVARIANTS ------------------------------------------------------------------------------------
  const vj = JSON.parse(readFileSync(R('vercel.json'), 'utf8'));
  need(vj.outputDirectory === 'public', `vercel.json outputDirectory must be "public" (got ${JSON.stringify(vj.outputDirectory)})`);
  need(vj.buildCommand === 'npm run build', `vercel.json buildCommand must be "npm run build" (got ${JSON.stringify(vj.buildCommand)})`);
  const rw = Array.isArray(vj.rewrites) ? vj.rewrites : [];
  need(rw.every(r => r.destination === '/index.html'), 'every rewrite must target /index.html (no proxy/broad rewrites)');
  need(rw.every(r => !/^\/(api|data)\b/.test(r.source)), 'no rewrite may shadow /api or /data (they must fall through to functions/files)');
  need(setEq(rw.map(r => r.source), VERCEL_REWRITE_SOURCES),
    `vercel.json rewrite sources != manifest route set\n      vercel: ${rw.map(r => r.source).sort().join('  ')}\n      manifest: ${[...VERCEL_REWRITE_SOURCES].sort().join('  ')}`);
  // no-store header must still cover the app shell but not data/api
  const noStore = (vj.headers || []).find(h => (h.headers || []).some(x => x.key === 'Cache-Control' && /no-store/.test(x.value)));
  need(!!noStore, 'vercel.json must keep a no-store Cache-Control header block for the app shell');
  if (noStore) {
    let shellRe; try { shellRe = new RegExp('^' + noStore.source + '$'); } catch { shellRe = null; }
    need(!!shellRe, `no-store header source is not a usable pattern: ${noStore.source}`);
    if (shellRe) {
      for (const p of ['/', '/training', '/leaderboard', '/2026-08-27/easy']) need(shellRe.test(p), `no-store must cover shell route ${p}`);
      for (const p of ['/data/pool.js', '/api/score']) need(!shellRe.test(p), `no-store must NOT cover ${p}`);
    }
  }
} catch (e) {
  fails.push('gate crashed: ' + (e && e.message ? e.message : e));
} finally {
  if (tmp) try { rmSync(tmp, { recursive: true, force: true }); } catch {}
}

if (fails.length) {
  console.error(`❌ FAIL — public-output gate (${fails.length} problem${fails.length > 1 ? 's' : ''}):`);
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log('✅ PASS — public-output: allowlist closed over index.html+styles.css, build complete (files + exact shard set), no private-tree/source/json leak, vercel.json points at public via `npm run build` with the exact narrow rewrite set and a shell-only no-store header');
