// Resync each work's pool.js `fame` field to the authoritative data/fame.js overlay (the output of the
// fame-scoring pipeline). pool.fame is a stale harvest-time snapshot; the OVERLAY is what scheduling
// (freeze-daily) and the gate (check-pool) actually read via `fame[id] ?? p.fame`. So this doesn't change
// any behavior — it just makes pool.fame truthful so it can't mislead future debugging (e.g. Whistler's
// Mother read 31 in the pool but 3482 in the overlay). Re-run whenever the fame overlay is regenerated.
//   node scripts/resync-fame.mjs [--dry]
import { readFileSync } from "node:fs";
import { readGlobal, writeAssignment } from "./lib/static-module.mjs";

const DRY = process.argv.includes("--dry");
const ov = JSON.parse((() => { const f = readFileSync("data/fame.js", "utf8"); return f.slice(f.indexOf("{"), f.lastIndexOf("}") + 1); })());
const pool = readGlobal("data/pool.js", "ARTEFACTUM_POOL");

let changed = 0, uncovered = 0;
for (const p of pool) {
  if (ov[p.id] == null) { uncovered++; continue; }
  const v = Math.round(ov[p.id]);
  if ((p.fame || 0) !== v) { if (!DRY) p.fame = v; changed++; }
}
if (!DRY) writeAssignment("data/pool.js", "ARTEFACTUM_POOL", pool);
console.log(`${DRY ? "[DRY] " : ""}resynced pool.fame ← fame.js overlay: ${changed} works updated | ${uncovered} not in overlay (left as-is)`);
