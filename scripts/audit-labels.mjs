// Label-quality audit — catches the CLASS of bug that keeps reaching dailies: fragmented near-duplicate
// style/culture labels (the "Greek Archaic" vs "Archaic Greek sculpture" mess), casing inconsistencies
// ("Social realism" vs "American Realism"), and orphan MOVEMENTS entries (keys with 0 pool works).
// Why the old movement/culture audits miss these: they check per-work structural fields, not the SHAPE of
// the label vocabulary. Two labels that a player can't tell apart are structurally valid but game-breaking
// when they co-appear as distractors. This audit looks at the vocabulary as a whole.
//   node scripts/audit-labels.mjs            # human report
//   node scripts/audit-labels.mjs --json     # machine report (for a gate)
import { readFileSync } from "node:fs";

const w = {}; new Function("window", readFileSync("data/pool.js", "utf8"))(w);
const POOL = w.ARTEFACTUM_POOL || [];

// count every style value in the pool
const styleCount = {};
for (const p of POOL) if (p.style) styleCount[p.style] = (styleCount[p.style] || 0) + 1;
const labels = Object.keys(styleCount);

// ---- 1. CASING: a word lowercased in one label but Capitalized in another (e.g. realism vs Realism) ----
const PARTICLES = new Set(["of","the","and","in","on","de","del","la","le","van","der","du","des","a","an","für","and/or"]);
const wordCase = {}; // lower(word) -> {cap:Set(labels), low:Set(labels)}
for (const l of labels) {
  const words = l.split(/[\s/-]+/).filter(Boolean);
  words.forEach((wd, i) => {
    const lw = wd.toLowerCase(); if (PARTICLES.has(lw) || lw.length < 3) return;
    const rec = wordCase[lw] || (wordCase[lw] = { cap: new Set(), low: new Set() });
    const isCap = wd[0] === wd[0].toUpperCase();
    // ignore the first word (always capitalized) unless it appears lowercase mid-phrase elsewhere
    if (i === 0 && isCap) return;
    (isCap ? rec.cap : rec.low).add(l);
  });
}
const casing = [];
for (const [wd, rec] of Object.entries(wordCase)) {
  if (rec.cap.size && rec.low.size) casing.push({ word: wd, capitalized: [...rec.cap], lowercased: [...rec.low] });
}

// ---- 2. FRAGMENTATION: cluster labels that share a distinctive root token (near-duplicates) ----
// strip generic descriptor tokens so "Attic black-figure pottery" and "Attic black-figure" collapse
const GENERIC = new Set(["art","painting","paintings","pottery","sculpture","ware","period","style","school","culture","figure","vessel","vase","ceramic","ceramics","design"]);
const sig = l => l.toLowerCase().split(/[\s/,-]+/).filter(t => t && !GENERIC.has(t) && !PARTICLES.has(t));
const norm = l => sig(l).slice().sort().join(" "); // order-independent signature
// group by normalized signature (exact near-dups: word-order / descriptor-only differences)
const byNorm = {};
for (const l of labels) { const k = norm(l); (byNorm[k] || (byNorm[k] = [])).push(l); }
const exactDups = Object.values(byNorm).filter(g => g.length > 1)
  .map(g => g.map(l => ({ label: l, n: styleCount[l] })).sort((a, b) => b.n - a.n));

// looser clusters: labels sharing a distinctive root token (greek, attic, song, ming, maya…) — fragmentation
const tokenToLabels = {};
for (const l of labels) for (const t of sig(l)) (tokenToLabels[t] || (tokenToLabels[t] = new Set())).add(l);
const fragments = Object.entries(tokenToLabels)
  .filter(([t, set]) => set.size >= 4 && t.length >= 4) // a root token spread across 4+ distinct labels = fragmented
  .map(([t, set]) => ({ root: t, count: set.size, labels: [...set].map(l => ({ label: l, n: styleCount[l] })).sort((a, b) => b.n - a.n) }))
  .sort((a, b) => b.count - a.count);

// ---- 3. ORPHAN MOVEMENTS entries: keys in the MOVEMENTS table with 0 pool works ----
let orphanMovements = [];
try {
  const html = readFileSync("index.html", "utf8");
  const m = html.match(/const MOVEMENTS=\{([\s\S]*?)\n\};/) || html.match(/const MOVEMENTS=\{([\s\S]*?)\};/);
  if (m) {
    const keys = [...m[1].matchAll(/"([^"]+)":\{dates:/g)].map(x => x[1]);
    const poolStyles = new Set(labels);
    orphanMovements = keys.filter(k => !poolStyles.has(k));
  }
} catch {}

const report = { totals: { styles: labels.length, works: POOL.length }, casing, exactDups, fragments, orphanMovements };

if (process.argv.includes("--json")) { console.log(JSON.stringify(report, null, 1)); process.exit(0); }

// ---- human report ----
const bar = "─".repeat(70);
console.log(`\nLABEL AUDIT — ${labels.length} distinct styles across ${POOL.length} works\n${bar}`);

console.log(`\n① CASING INCONSISTENCIES (${casing.length}) — same word cased differently across labels`);
if (!casing.length) console.log("   none");
for (const c of casing) console.log(`   "${c.word}":  lowercased in [${c.lowercased.join(", ")}]  vs  Capitalized in [${c.capitalized.slice(0, 4).join(", ")}${c.capitalized.length > 4 ? "…" : ""}]`);

console.log(`\n② EXACT NEAR-DUPLICATES (${exactDups.length}) — differ only by word order / a generic descriptor`);
if (!exactDups.length) console.log("   none");
for (const g of exactDups) console.log(`   ${g.map(x => `"${x.label}"(${x.n})`).join("  ≈  ")}`);

console.log(`\n③ FRAGMENTED VOCABULARIES (${fragments.length}) — one tradition split across many labels a player can't distinguish`);
if (!fragments.length) console.log("   none");
for (const f of fragments) {
  console.log(`   root "${f.root}" → ${f.count} labels:`);
  console.log(`      ${f.labels.map(x => `"${x.label}"(${x.n})`).join(", ")}`);
}

console.log(`\n④ ORPHAN MOVEMENTS ENTRIES (${orphanMovements.length}) — MOVEMENTS keys with 0 pool works (stale)`);
console.log(orphanMovements.length ? "   " + orphanMovements.map(k => `"${k}"`).join(", ") : "   none");

console.log(`\n${bar}\nSummary: ${casing.length} casing · ${exactDups.length} exact-dup groups · ${fragments.length} fragmented vocabularies · ${orphanMovements.length} orphan movements`);
console.log("These are DISTRACTOR-POISONING and label-cruft issues. Review, then apply a consolidation map + re-gate.\n");
