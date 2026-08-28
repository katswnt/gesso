#!/usr/bin/env node
// G-02 deploy assembler: copy EXACTLY the public allowlist (scripts/public-manifest.mjs) into an output dir, so
// production's static root contains only browser assets — never source, docs, db, tests, or build inputs.
//   node scripts/build-public.mjs [outDir]
//     no arg  -> the canonical repo ./public (cleaned + rebuilt)
//     outDir  -> must be a FRESH (non-existent) path under the OS temp dir (used by the offline gate)
// Assumes the generated shards data/notes/ already exist (run scripts/build-teach-shards.mjs first; the canonical
// `npm run build` chains them). Fails LOUD if any allowlisted source is missing, if any data/notes entry is not a
// generated shard, or if any assets entry is not an image/font. Rejects symlinks and any path that would escape
// the source tree or the output dir. The output target is validated so a bad/typo'd argument (e.g. "..") can NEVER
// recursively delete an unrelated directory: only the repo ./public or a fresh temp child may be (re)created.
import { lstatSync, readdirSync, mkdirSync, copyFileSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { join, resolve, relative, dirname, sep, parse } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { PUBLIC_FILES, PUBLIC_DATA_SCRIPTS, PUBLIC_DIRS, isAllowedInDir } from './public-manifest.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url)).replace(/[\\/]$/, '');   // repo root, no trailing sep
const CANONICAL = resolve(ROOT, 'public');
const die = m => { console.error('❌ build-public: ' + m); process.exit(1); };

// -------- choose + validate the output directory (destructive-delete safety) --------
const arg = process.argv[2];
const OUT = arg ? resolve(process.cwd(), arg) : CANONICAL;
(function validateOut() {
  if (OUT === parse(OUT).root) die('refusing filesystem root as output');
  if (OUT === ROOT) die('refusing repo root as output');
  if ((ROOT + sep).startsWith(OUT + sep)) die(`refusing an ancestor of the repo as output: ${OUT}`);
  const insideRepo = (OUT + sep).startsWith(ROOT + sep);
  if (OUT === CANONICAL) return;                                   // the one in-repo location we own
  if (insideRepo) die(`refusing an output inside the repo other than ./public: ${OUT}`);
  // otherwise it MUST be a fresh path under the OS temp dir
  const realTmp = realpathSync(tmpdir());
  let realParent; try { realParent = realpathSync(dirname(OUT)); } catch { die(`output parent does not exist: ${dirname(OUT)}`); }
  if (realParent !== realTmp && !realParent.startsWith(realTmp + sep)) die(`custom output must live under the OS temp dir (${realTmp}): ${OUT}`);
  if (existsSync(OUT)) die(`custom output must not already exist: ${OUT}`);
})();

// -------- copy helpers (symlink- + traversal-safe) --------
function safeSrc(rel) {
  const abs = resolve(ROOT, rel);
  if (relative(ROOT, abs).startsWith('..')) die(`refusing source outside repo root: ${rel}`);
  let st; try { st = lstatSync(abs); } catch { return null; }
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
// copy a whole public dir; every FILE must pass the dir's entry allowlist (else fail loud, never silently ship)
function copyDir(topDir, rel = topDir) {
  const s = safeSrc(rel);
  if (!s) die(`missing allowlisted directory: ${rel}`);
  if (!s.st.isDirectory()) die(`allowlisted directory is not a directory: ${rel}`);
  for (const e of readdirSync(s.abs, { withFileTypes: true })) {
    const child = rel + '/' + e.name;
    if (e.isSymbolicLink()) die(`refusing to copy a symlink: ${child}`);
    if (e.isDirectory()) { copyDir(topDir, child); continue; }
    if (!e.isFile()) die(`unexpected non-regular entry: ${child}`);
    if (!isAllowedInDir(topDir, e.name)) die(`disallowed entry in ${topDir}/: ${child} (only the intended shard/asset types may be published)`);
    copyFile(child);
  }
}

// -------- (re)create the output dir --------
if (existsSync(OUT)) {
  if (lstatSync(OUT).isSymbolicLink()) die(`output path is a symlink: ${OUT}`);
  rmSync(OUT, { recursive: true, force: true });
}
mkdirSync(OUT, { recursive: true });

for (const f of PUBLIC_FILES) copyFile(f);
for (const f of PUBLIC_DATA_SCRIPTS) copyFile(f);
for (const d of PUBLIC_DIRS) copyDir(d);

console.log(`✅ build-public — ${files} files, ${(bytes / 1048576).toFixed(2)} MiB → ${relative(process.cwd(), OUT) || OUT}`);
