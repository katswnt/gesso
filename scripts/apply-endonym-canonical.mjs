// Endonym-first canonical naming: when two labels name one concept, the CANONICAL label is the endonym /
// scholarly-precise form; the exonym / common form becomes a searchable alias (CANON_STYLE in index.html).
// This reverses two earlier merges that defaulted to the colonial/common form. Reasoned from the thinkers the
// Collections page cites (Sarr-Savoy, Hicks, Mignolo, TK Labels): naming authority should not default to the
// conqueror's or the popular exonym. See docs/taxonomy.md.
//   node scripts/apply-endonym-canonical.mjs            # dry run
//   node scripts/apply-endonym-canonical.mjs --write
import { readFileSync, writeFileSync } from "node:fs";

// exonym / common form (current pool label) -> endonym / precise canonical
const RELABEL = {
  "Aztec": "Mexica",   // Mexica is the people's own name; "Aztec" is a 19th-c. exonym (Prescott). Endonym leads.
  "Seljuk": "Seljuq",  // "Seljuq" is the precise transliteration of the qaf; "Seljuk" is the common English form.
};

const path = "data/pool.js";
const raw = readFileSync(path, "utf8");
const pre = raw.slice(0, raw.indexOf("[")), post = raw.slice(raw.lastIndexOf("]") + 1);
const pool = JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1));

const changes = [];
for (const p of pool) {
  if (RELABEL[p.style]) { changes.push({ id: p.id, from: p.style, to: RELABEL[p.style], title: p.title }); p.style = RELABEL[p.style]; }
}
console.log(`style relabels: ${changes.length}`);
for (const c of changes) console.log(`  "${c.from}" → "${c.to}"   ${(c.title || "").slice(0, 44)}`);
const tally = {}; for (const c of changes) tally[`${c.from}→${c.to}`] = (tally[`${c.from}→${c.to}`] || 0) + 1;
console.log("\n" + Object.entries(tally).map(([k, v]) => `  ${k}: ${v} works`).join("\n"));

if (process.argv.includes("--write")) {
  writeFileSync(path, pre + JSON.stringify(pool) + post);
  console.log("\n✔ written to data/pool.js — now rename MOVEMENTS def keys + add CANON_STYLE aliases in index.html");
} else console.log("\n(dry run — pass --write to apply)");
