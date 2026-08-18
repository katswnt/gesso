// Phase D: collapse over-fine THEME compounds into the base period they fragment. "<period> Buddhist art" adds a
// cross-cutting SUBJECT (Buddhist) to a period; the subject is visible in the work, the period is the guessable
// unit, and the base period label already exists — so the compound is redundant fragmentation. NOT touched:
// genuine named STYLES (Persian miniature, Red-figure pottery, Rajput/Mughal painting) — those are real, keep them.
// styleKind is unified to the target period's dominant kind so the merged label isn't split across MOVS/CULTS.
//   node scripts/collapse-theme-compounds.mjs [--write]
import { readFileSync, writeFileSync } from "node:fs";

const COLLAPSE = {
  "Tang dynasty Buddhist art": "Tang dynasty", "Song dynasty Buddhist art": "Song dynasty",
  "Yuan dynasty Buddhist art": "Yuan dynasty", "Qing dynasty Buddhist art": "Qing dynasty",
  "Ming dynasty Buddhist art": "Ming dynasty", "Kamakura Buddhist art": "Kamakura period",
  "Kamakura-period Japanese Buddhist painting": "Kamakura period", "Heian Buddhist art": "Heian period",
  "Muromachi Buddhist art": "Muromachi period", "Nara Buddhist art": "Nara period",
  "Nara-period Japanese Buddhist art": "Nara period", "Asuka Buddhist art": "Asuka period",
  "Edo Buddhist art": "Edo period", "Goryeo Buddhist painting": "Goryeo dynasty",
  "Vietnamese Buddhist art": "Vietnamese",
};

const path = "data/pool.js";
const raw = readFileSync(path, "utf8");
const pre = raw.slice(0, raw.indexOf("[")), post = raw.slice(raw.lastIndexOf("]") + 1);
const pool = JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1));

// dominant styleKind of each collapse TARGET (from its existing works), so relabeled works adopt it
const kinds = {};
for (const p of pool) { const t = new Set(Object.values(COLLAPSE)); if (t.has(p.style)) (kinds[p.style] = kinds[p.style] || {})[p.styleKind] = (kinds[p.style]?.[p.styleKind] || 0) + 1; }
const domKind = t => Object.entries(kinds[t] || { culture: 1 }).sort((a, b) => b[1] - a[1])[0][0];

const changes = [];
for (const p of pool) {
  const to = COLLAPSE[p.style];
  if (!to) continue;
  const dk = domKind(to);
  changes.push({ from: p.style, to, kindFrom: p.styleKind, kindTo: dk, title: p.title });
  p.style = to; p.styleKind = dk;
}
const tally = {};
for (const c of changes) tally[`${c.from} → ${c.to}`] = (tally[`${c.from} → ${c.to}`] || 0) + 1;
for (const [k, v] of Object.entries(tally)) console.log(`  ${k}  (${v}w)`);
console.log(`\nTOTAL: ${changes.length} works collapsed into ${new Set(Object.values(COLLAPSE)).size} period labels`);

if (process.argv.includes("--write")) { writeFileSync(path, pre + JSON.stringify(pool) + post); console.log("\n✔ written to data/pool.js"); }
else console.log("\n(dry run — pass --write)");
