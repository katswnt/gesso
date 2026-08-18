// Phase C: split colonial racial-geographic META-CATEGORIES into the specific people/place their own metadata
// supports (Nicholas Thomas's catch: "Melanesian"/"Polynesian" are Dumont d'Urville's 1832 constructs, not
// self-descriptions). Granularity rule (see docs/taxonomy.md): name the culture at the level scholarship/museums
// use, never a racial/continental construct, and never finer than a label that adds signal past the WHERE facet.
// So Polynesia splits to recognizable PEOPLES (Hawaiian, Tahitian, Cook Islands); Melanesia stops at NATION
// (Papua New Guinea, Solomon Islands) because finer would be a guess or a map-pin echo.
//   node scripts/split-metacategories.mjs           # dry run
//   node scripts/split-metacategories.mjs --write
import { readFileSync, writeFileSync } from "node:fs";

// construct label -> (work.place -> specific culture label). Peoples where recognizable; NEVER a country name
// (check-pool's culture-is-country gate blocks "Papua New Guinea" — the where-facet-duplication guard).
const SPLIT = {
  "Melanesian art": { "Solomon Islands": "Solomon Islands", "Papua New Guinea": "Sepik" },
  "Polynesian art": { "Hawaii (United States)": "Hawaiian", "Rarotonga (Cook Islands)": "Rarotongan", "Tahiti": "Tahitian" },
};
// per-work override (title substring): the ancient stone "Bird Head" (550 BCE) is NOT Sepik wood-carving —
// honest inference for a prehistoric PNG stone piece is the highlands tradition.
const OVERRIDE = [{ match: "Bird Head", to: "New Guinea Highlands" }];

const path = "data/pool.js";
const raw = readFileSync(path, "utf8");
const pre = raw.slice(0, raw.indexOf("[")), post = raw.slice(raw.lastIndexOf("]") + 1);
const pool = JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1));

const changes = [], unmapped = [];
for (const p of pool) {
  const map = SPLIT[p.style];
  if (!map) continue;
  const ov = OVERRIDE.find(o => (p.title || "").includes(o.match));
  const to = ov ? ov.to : map[p.place];
  if (!to) { unmapped.push({ id: p.id, style: p.style, place: p.place, title: p.title }); continue; }
  changes.push({ from: p.style, place: p.place, to, title: p.title });
  p.style = to; p.styleKind = "culture";
}
for (const c of changes) console.log(`  "${c.from}" [${c.place}] → "${c.to}"   ${c.title.slice(0, 40)}`);
const tally = {}; for (const c of changes) tally[c.to] = (tally[c.to] || 0) + 1;
console.log(`\nnew labels: ${Object.entries(tally).map(([k, v]) => `${k}(${v})`).join(", ")}`);
if (unmapped.length) { console.log(`\n⚠ UNMAPPED (place has no split target — fix before write):`); for (const u of unmapped) console.log(`  ${u.style} · place="${u.place}" · ${u.title}`); }

if (process.argv.includes("--write")) {
  if (unmapped.length) { console.error("\nABORT: unmapped works exist"); process.exit(1); }
  writeFileSync(path, pre + JSON.stringify(pool) + post);
  console.log(`\n✔ ${changes.length} works relabeled → data/pool.js. Next: add MOVEMENTS defs + remove construct defs.`);
} else console.log("\n(dry run — pass --write)");
