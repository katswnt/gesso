// Safe read/write for the data/*.js "static module" files (each does `window.X = <json>`). Replaces the
// fragile slice-around-brackets parsing and in-place rewrites scattered across the pipeline:
//  - readGlobal() evaluates the file in a sandboxed window (robust to brackets inside strings).
//  - writeAtomic() writes a temp file, validates it with `node --check`, then renames over the target,
//    so an interruption or malformed value can never leave a half-written / corrupt corpus.
import { readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { execSync } from "node:child_process";

// Evaluate a data module and return the `window` object it populated (handles `window.X=...` and the
// `window.X=window.X||{}; window.X.work=...` merge form alike).
export function readModule(path){
  const win = {};
  new Function("window", readFileSync(path, "utf8"))(win);
  return win;
}
export function readGlobal(path, name){ return readModule(path)[name]; }

// Write `body` to `path` atomically: temp file → node --check (must parse) → rename.
export function writeAtomic(path, body){
  const tmp = path + ".tmp.js"; // .js so `node --check` can parse it (it infers type from the extension)
  writeFileSync(tmp, body);
  try { execSync(`node --check "${tmp}"`); }
  catch(e){ try{ unlinkSync(tmp); }catch{} throw new Error(`refusing to write ${path}: generated module fails node --check (${e.message})`); }
  renameSync(tmp, path);
}

// Canonical `window.NAME = <json>;` module (pool/fame/hotspots/daily-order/countries/…).
export function writeAssignment(path, name, value){
  writeAtomic(path, `window.${name}=${JSON.stringify(value)};\n`);
}

// teach-works.js merge form: adds `.work` to whatever cues.js already put on window.ARTEFACTUM_CUES,
// so it never clobbers the style/culture/region/medium maps. (See index.html deferred-load note.)
export function writeTeachWorks(path, workMap){
  writeAtomic(path, `window.ARTEFACTUM_CUES=window.ARTEFACTUM_CUES||{};\nwindow.ARTEFACTUM_CUES.work=${JSON.stringify(workMap)};\n`);
}
