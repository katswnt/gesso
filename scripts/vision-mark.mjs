// vision-mark.mjs — record work ids as VISION-AUDITED in data/vision-audit.json (grow-only, deduped).
// Run AFTER a vision audit's output has been merged into the pool.
//   node scripts/vision-mark.mjs <ids-source.json> [...]
// Each source may be: an array of ids, an array of {id}, or {ids:[...]} / {selected:[...]}.
import { readFileSync, writeFileSync } from "node:fs";

const files = process.argv.slice(2);
if (!files.length) { console.error("usage: vision-mark.mjs <source.json> [...]"); process.exit(1); }

const extract = (j) => {
  if (Array.isArray(j)) return j.map(x => typeof x === "string" ? x : x && x.id).filter(Boolean);
  if (j && Array.isArray(j.ids)) return j.ids;
  if (j && Array.isArray(j.selected)) return j.selected;
  return [];
};

const ledger = JSON.parse(readFileSync("data/vision-audit.json", "utf8"));
const set = new Set(ledger.ids || []);
let added = 0;
for (const f of files) { for (const id of extract(JSON.parse(readFileSync(f, "utf8")))) if (!set.has(id)) { set.add(id); added++; } }
ledger.ids = [...set].sort();
writeFileSync("data/vision-audit.json", JSON.stringify(ledger, null, 1));
console.log(`vision-mark: +${added} → ${ledger.ids.length} works vision-audited`);
