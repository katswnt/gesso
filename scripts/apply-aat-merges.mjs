// One-time: apply the AAT-confirmed near-duplicate MERGES to the pool (relabel style strings to a single
// canonical label per concept). Reviewed + approved by Kat. Dry-run by default; pass --write to save.
//   node scripts/apply-aat-merges.mjs           # dry run: show field-scoped diff
//   node scripts/apply-aat-merges.mjs --write    # apply to data/pool.js
import { readFileSync, writeFileSync } from "node:fs";

// old style label -> canonical style label (both variants had pool works; same AAT concept)
const RELABEL = {
  "Neoclassical": "Neoclassicism",       // 300021477 — form variant, keep dominant noun
  "Gandharan": "Gandhara",               // 300018889 — adjectival variant
  "Seljuq": "Seljuk",                    // 300021736 — spelling variant
  "Aesthetic Movement": "Aestheticism",  // 300018124 — same movement, keep dominant
  "Aztec (Mexica)": "Aztec",             // 300017033 — one culture, drop parenthetical
  "Pala period": "Pala-Sena period",     // 300018917 — combined Pala-Sena is the standard style term
};
// concept -> the styleKind every work under the canonical label should have (fixes merge-induced mixes)
const KIND = { "Aztec": "culture" };

const path = "data/pool.js";
const raw = readFileSync(path, "utf8");
const pre = raw.slice(0, raw.indexOf("[")), post = raw.slice(raw.lastIndexOf("]") + 1);
const pool = JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1));

const changes = [];
for (const p of pool) {
  let changed = null;
  if (RELABEL[p.style]) { changed = { id: p.id, field: "style", from: p.style, to: RELABEL[p.style] }; p.style = RELABEL[p.style]; }
  // unify styleKind on canonical labels that would otherwise end up mixed (e.g. Aztec)
  if (KIND[p.style] && p.styleKind !== KIND[p.style]) {
    changes.push({ id: p.id, field: "styleKind", from: p.styleKind, to: KIND[p.style], title: p.title });
    p.styleKind = KIND[p.style];
  }
  if (changed) { changed.title = p.title; changes.push(changed); }
}

// field-scoped diff report
const byField = {};
for (const c of changes) (byField[c.field] = byField[c.field] || []).push(c);
for (const [f, cs] of Object.entries(byField)) {
  console.log(`\n${f}: ${cs.length} works changed`);
  for (const c of cs) console.log(`  "${c.from}" → "${c.to}"   ${(c.title || "").slice(0, 42)}`);
}
console.log(`\nTOTAL: ${changes.length} field changes across ${new Set(changes.map(c => c.id)).size} works`);

if (process.argv.includes("--write")) {
  writeFileSync(path, pre + JSON.stringify(pool) + post);
  console.log("\n✔ written to data/pool.js");
} else {
  console.log("\n(dry run — pass --write to apply)");
}
