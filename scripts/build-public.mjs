#!/usr/bin/env node
// G-02 deploy assembler: copy EXACTLY the public allowlist (scripts/public-manifest.mjs) into an output dir, so
// production's static root contains only browser assets — never source, docs, db, tests, or build inputs.
//   node scripts/build-public.mjs [outDir]      (outDir default: "public")
// Assumes the generated shards data/notes/ already exist (run scripts/build-teach-shards.mjs first; the canonical
// `npm run build` chains them). Fails LOUD if any allowlisted source is missing. Rejects symlinks and any path
// that would escape the source tree or the output dir (no traversal), so the copy can't be tricked into pulling
// in or writing outside the intended trees.
import { lstatSync, readdirSync, mkdirSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_FILES, PUBLIC_DATA_SCRIPTS, PUBLIC_DIRS } from './public-manifest.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT = resolve(process.cwd(), process.argv[2] || 'public');
const die = m => { console.error('❌ build-public: ' + m); process.exit(1); };

// resolve a repo-relative path and forbid symlinks + escape-above-root
function safeSrc(rel) {
  const abs = resolve(ROOT, rel);
  if (relative(ROOT, abs).startsWith('..')) die(`refusing source outside repo root: ${rel}`);
  let st; try { st = lstatSync(abs); } catch { return null; }         // missing -> caller decides
  if (st.isSymbolicLink()) die(`refusing to copy a symlink: ${rel}`);
  return { abs, st };
}
function safeDest(rel) {
  const abs = resolve(OUT, rel);
  if (relative(OUT, abs).startsWith('..')) die(`refusing destination outside output dir: ${rel}`);
  return abs;
}

let files = 0, bytes = 0;
function copyFile(rel) {
  const s = safeSrc(rel);
  if (!s) die(`missing allowlisted file: ${rel}`);
  if (!s.st.isFile()) die(`allowlisted file is not a regular file: ${rel}`);
  const dst = safeDest(rel);
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(s.abs, dst);
  files++; bytes += s.st.size;
}
function copyDir(rel) {
  const s = safeSrc(rel);
  if (!s) die(`missing allowlisted directory: ${rel}`);
  if (!s.st.isDirectory()) die(`allowlisted directory is not a directory: ${rel}`);
  for (const e of readdirSync(s.abs, { withFileTypes: true })) {
    const child = rel + '/' + e.name;
    if (e.isSymbolicLink()) die(`refusing to copy a symlink: ${child}`);
    if (e.isDirectory()) copyDir(child);
    else if (e.isFile()) copyFile(child);
    else die(`unexpected non-regular entry: ${child}`);
  }
}

// clean + rebuild the output dir
if (existsSync(OUT)) {
  if (lstatSync(OUT).isSymbolicLink()) die(`output path is a symlink: ${OUT}`);
  rmSync(OUT, { recursive: true, force: true });
}
mkdirSync(OUT, { recursive: true });

for (const f of PUBLIC_FILES) copyFile(f);
for (const f of PUBLIC_DATA_SCRIPTS) copyFile(f);
for (const d of PUBLIC_DIRS) copyDir(d);

console.log(`✅ build-public — ${files} files, ${(bytes / 1048576).toFixed(2)} MiB → ${relative(process.cwd(), OUT) || OUT}`);
