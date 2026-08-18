// Report-only guard: flag colonial RACIAL-GEOGRAPHIC meta-categories used as culture/style labels, so a future
// harvest can't silently reintroduce them (Phase C split "Melanesian art"/"Polynesian art" into specific
// peoples/places). These are European constructs (Dumont d'Urville 1832 for the Oceania trio; "Oriental",
// "Primitive", "Tribal", and continent-as-culture likewise), not self-descriptions. See docs/taxonomy.md.
// NOT in CI (report-only, like the other label audits). Run after any harvest/promote.
//   node scripts/find-metacategories.mjs
import { readFileSync } from "node:fs";

let s = readFileSync("data/pool.js", "utf8");
const pool = JSON.parse(s.slice(s.indexOf("["), s.lastIndexOf("]") + 1));

// patterns that name a race/continent, not a people/tradition. NB: "Orientalism"/"Orientalizing period" are
// legitimate named art terms (the European movement; the Greek period) — excluded via negative lookahead.
const RULES = [
  { re: /\b(melanesian|polynesian|micronesian)\b/i, why: "Dumont d'Urville's 1832 racial division of Oceania — use the specific people/place" },
  { re: /\boceanic art\b/i, why: "continent-as-culture — use the specific people/place" },
  { re: /\b(primitive|tribal)\b/i, why: "colonial value-term, not a culture" },
  { re: /\boriental(?!ism|izing)/i, why: "colonial catch-all (Said) — use the specific culture" },
  { re: /^(african|asian|oceanian|european|american) art$/i, why: "continent-as-culture — too coarse; use the specific culture" },
  { re: /\bnegro\b/i, why: "slur/dated term — reword" },
];

const flags = [];
for (const p of pool) {
  const st = p.style || "";
  for (const r of RULES) if (r.re.test(st)) flags.push({ style: st, why: r.why, title: p.title, place: p.place });
}
const byStyle = {};
for (const f of flags) (byStyle[f.style] = byStyle[f.style] || { why: f.why, works: [] }).works.push(f);

const labels = Object.keys(byStyle);
if (!labels.length) { console.log("✅ no colonial meta-category labels in the pool"); process.exit(0); }
console.log(`⚠ ${labels.length} colonial meta-category label(s) — split into specific peoples/places:\n`);
for (const [style, g] of Object.entries(byStyle)) {
  console.log(`  "${style}" (${g.works.length}w) — ${g.why}`);
  for (const w of g.works) console.log(`      · ${w.title} [${w.place}]`);
}
process.exitCode = 1; // non-zero so a wrapper/hook can notice, but this script is not wired into test:ci
