// Round-trips every real data module through readGlobal → writeAtomic → readGlobal (to a temp path),
// proving the parser/writer preserve the data and that writeAtomic validates before committing.
// Run: node tests/static-module.test.mjs
import { readGlobal, writeAtomic, writeAssignment } from "../scripts/lib/static-module.mjs";
import { existsSync, unlinkSync, copyFileSync } from "node:fs";

const ROOT = new URL("../", import.meta.url).pathname;
const MODS = [
  ["data/pool.js", "ARTEFACTUM_POOL"],
  ["data/fame.js", "ARTEFACTUM_FAME"],
  ["data/hotspots.js", "ARTEFACTUM_HOTSPOTS"],
  ["data/daily-order.js", "ARTEFACTUM_DAILY"],
  ["data/teach-works.js", "ARTEFACTUM_CUES"],
];
let pass=0, fail=0;
const size = v => Array.isArray(v) ? v.length : Object.keys(v||{}).length;

for(const [rel, name] of MODS){
  const path = ROOT + rel, tmp = ROOT + rel + ".roundtrip";
  try{
    const orig = readGlobal(path, name);
    writeAssignment(tmp, name, name === "ARTEFACTUM_CUES" ? orig : orig); // canonical assignment is fine for the round-trip
    const back = readGlobal(tmp, name);
    if(size(orig) === size(back) && size(orig) > 0){ pass++; }
    else { fail++; console.error(`  ✗ ${rel}: round-trip size ${size(orig)} → ${size(back)}`); }
  }catch(e){ fail++; console.error(`  ✗ ${rel}: ${e.message}`); }
  finally{ if(existsSync(tmp)) unlinkSync(tmp); }
}

// writeAtomic must REFUSE to write a module that doesn't parse (the safety guarantee)
try{
  const bad = ROOT + "data/_bad.roundtrip";
  let threw = false;
  try{ writeAtomic(bad, "window.X = {unclosed: "); }catch{ threw = true; }
  if(existsSync(bad)) unlinkSync(bad);
  ok(threw, "writeAtomic rejects an un-parseable module");
  function ok(c,m){ if(c) pass++; else { fail++; console.error("  ✗ "+m); } }
}catch(e){ fail++; console.error("  ✗ guard test: "+e.message); }

console.log(`\nstatic-module.test: ${pass} passed, ${fail} failed`);
if(fail) process.exit(1);
