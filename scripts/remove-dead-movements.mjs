// One-time: remove DUPLICATE dead MOVEMENTS defs — labels with 0 pool works that are the same AAT concept as a
// live label (surfaced by data/incoming/aat-map.json, section D). MOVS/CULTS/guessable options come from POOL
// works only, so these never reach players; this is clutter cleanup + it clears audit-labels near-dup noise.
// Targeted string deletion (NOT re-serialization) to preserve the MOVEMENTS structure that other scripts regex.
// Verifies: MOVEMENTS still parses and dropped EXACTLY the intended keys; then run dom-harness.
//   node scripts/remove-dead-movements.mjs           # dry run
//   node scripts/remove-dead-movements.mjs --write
import { readFileSync, writeFileSync } from "node:fs";

// duplicate dead-defs to remove (all 0 pool works, each duplicating a live canonical concept)
const DEAD = [
  "Neoclassical", "Gandharan", "Seljuq", "Aesthetic Movement", "Aztec (Mexica)", "Pala period", // just-merged losers
  "Vedute", "Baga culture", "Ejagham (Cross River)", "Song dynasty painting", "Yuan dynasty painting",
  "Ming Dynasty Painting", "Ming dynasty painting", "Qing dynasty painting", "Literati painting", "Gandharan art",
  "Pala-Sena", "Rajput", "Amarna art", "Japanese Buddhist art", "Early Netherlandish painting", "Venetian School",
  "Dutch Golden Age painting",
];
// NOTE: we remove ONLY the MOVEMENTS defs. We deliberately LEAVE any leftover mentions of these labels in
// MOV_FAMILY / RELATED_MOV / alias maps: those labels have 0 pool works, so they are never an answer or a
// distractor (MOVS/CULTS come from POOL), and styleChoices filters related lists to pool labels — so a dangling
// mention is inert. Stripping them globally is what corrupted "key":"value" alias entries before.
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
let src = readFileSync("index.html", "utf8");
const parseMovs = t => { const m = t.match(/const MOVEMENTS=\{[\s\S]*?\n\};/); return m ? new Function(m[0] + "\nreturn MOVEMENTS;")() : null; };
const before = parseMovs(src);
if (!before) { console.error("could not parse MOVEMENTS"); process.exit(1); }

// 1) remove each dead key's MOVEMENTS entry "Key":{...} (value has no nested braces — palette uses [])
let removed = [], missing = [];
for (const k of DEAD) {
  const re = new RegExp(`(,\\s*)?"${esc(k)}":\\{[^{}]*\\}(\\s*,)?`);
  if (re.test(src)) { src = src.replace(re, (m, pre, post) => (pre && post ? "," : "")); removed.push(k); }
  else missing.push(k);
}
// 2) verify: re-parse, confirm exactly the intended keys are gone and nothing else changed
const after = parseMovs(src);
if (!after) { console.error("FATAL: MOVEMENTS no longer parses — aborting"); process.exit(1); }
const beforeKeys = new Set(Object.keys(before)), afterKeys = new Set(Object.keys(after));
const droppedKeys = [...beforeKeys].filter(k => !afterKeys.has(k));
const addedKeys = [...afterKeys].filter(k => !beforeKeys.has(k));
console.log(`MOVEMENTS: ${beforeKeys.size} -> ${afterKeys.size} keys`);
console.log(`dropped (${droppedKeys.length}): ${droppedKeys.join(", ")}`);
if (missing.length) console.log(`NOT FOUND as defs (skipped): ${missing.join(", ")}`);
if (addedKeys.length) { console.error(`FATAL: keys unexpectedly ADDED: ${addedKeys.join(", ")}`); process.exit(1); }
const unexpected = droppedKeys.filter(k => !DEAD.includes(k));
if (unexpected.length) { console.error(`FATAL: dropped UNINTENDED keys: ${unexpected.join(", ")}`); process.exit(1); }

// 3) full-script syntax check: extract the inline app <script> and parse it — catches ANY breakage, not just
// MOVEMENTS (this is what would have caught the alias-map corruption).
const scripts = [...src.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const appScript = scripts.sort((a, b) => b.length - a.length)[0] || "";
try { new Function(appScript); } catch (e) { console.error(`FATAL: inline script no longer parses: ${e.message}`); process.exit(1); }
console.log("inline app script parses OK");

if (process.argv.includes("--write")) { writeFileSync("index.html", src); console.log("\n✔ written to index.html — run tests/dom-harness.mjs next"); }
else console.log("\n(dry run — pass --write to apply)");
