// One-off vocabulary consolidation: fold the flagged near-duplicate style labels (audit-labels' 28 descriptor
// groups + 2 word-order groups) onto a single canonical spelling each, so multiple-choice distractors stop
// being poisoned by "Ming dynasty" vs "Ming dynasty painting". Field-scoped: rewrites ONLY p.style; every
// other field is untouched. Canonical choice rule: (1) the winner must be a MOVEMENTS key (else the works
// lose their dates/emblem), (2) prefer the broad period/culture over a redundant medium suffix, but KEEP
// "painting"/"miniature" where it denotes the actual specific tradition (manuscript, court, red-figure).
//   node scripts/consolidate-styles.mjs
import { readFileSync, writeFileSync } from "node:fs";

// variant (loser) -> canonical (winner). Winners verified as MOVEMENTS keys.
const MAP = {
  "Dutch Golden Age painting": "Dutch Golden Age",
  "Early Netherlandish painting": "Early Netherlandish",
  "Tang dynasty painting": "Tang dynasty",
  "Qing dynasty Chinese painting": "Qing dynasty",
  "Qing dynasty Chinese art": "Qing dynasty",
  "Qing dynasty painting": "Qing dynasty",
  "Ming dynasty painting": "Ming dynasty",
  "Song dynasty painting": "Song dynasty",
  "Rinpa school": "Rinpa",
  "Kamakura-period Buddhist sculpture": "Kamakura Buddhist art",
  "Ayutthaya": "Ayutthaya period",
  "Rajput": "Rajput painting",
  "Yuan dynasty Buddhist painting": "Yuan dynasty Buddhist art",
  "Pala": "Pala period",
  "Yuan dynasty painting": "Yuan dynasty",
  "Pala-Sena": "Pala-Sena period",
  "Gothic": "Gothic art",
  "Asuka period Buddhist sculpture": "Asuka Buddhist art",
  "Amarna art": "Amarna period",
  "Jain painting": "Jain art",
  "Egyptian Late Period": "Late Period Egyptian",          // word-order
  "Neolithic Chinese jade culture": "Neolithic Chinese jade",
  "South Italian red-figure pottery": "South Italian red-figure",
  "Baga culture": "Baga",
  "Tang dynasty Buddhist sculpture": "Tang dynasty Buddhist art",
  "Tang dynasty Buddhist painting": "Tang dynasty Buddhist art",
  "American colonial portraiture": "Colonial American portraiture",  // word-order
  "Safavid Persian manuscript art": "Safavid Persian manuscript painting",
  "Qing court art": "Qing court painting",
  "Ottoman miniature": "Ottoman miniature painting",
};

// verify every canonical is a MOVEMENTS key before touching data
const html = readFileSync("index.html", "utf8");
const movKeys = new Set([...html.slice(html.indexOf("const MOVEMENTS={"), html.indexOf("const MOV_FAMILY=")).matchAll(/"([^"]+)":\{dates:/g)].map(m => m[1]));
const badWinners = [...new Set(Object.values(MAP))].filter(w => !movKeys.has(w));
if (badWinners.length) { console.error("ABORT — canonical labels not in MOVEMENTS (works would lose metadata):", badWinners); process.exit(1); }

const raw = readFileSync("data/pool.js", "utf8");
const pool = JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1));
const before = {}; for (const p of pool) if (p.style) before[p.style] = (before[p.style] || 0) + 1;

let changed = 0; const perMap = {};
for (const p of pool) { if (p.style && MAP[p.style]) { perMap[`${p.style} → ${MAP[p.style]}`] = (perMap[`${p.style} → ${MAP[p.style]}`] || 0) + 1; p.style = MAP[p.style]; changed++; } }

// preserve the `window.ARTEFACTUM_POOL = [...]` prefix/suffix (spaced form — legacy scripts parse it)
writeFileSync("data/pool.js", raw.slice(0, raw.indexOf("[")) + JSON.stringify(pool) + raw.slice(raw.lastIndexOf("]") + 1));
console.log(`consolidated ${changed} works across ${Object.keys(perMap).length} label mappings:`);
for (const [k, n] of Object.entries(perMap).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);
