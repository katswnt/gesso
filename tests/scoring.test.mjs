// Fixture tests for Gesso's pure scoring helpers. We extract the ACTUAL functions from index.html and
// evaluate them, so the tests exercise shipped code (no parallel copy to drift). Covers the recently-
// added movement-similarity gradient and the BCE date parsing — the nuanced hot path.
// Run: node tests/scoring.test.mjs   (exits nonzero on any failure)
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../index.html", import.meta.url), "utf8");

// pull the pure pieces we need out of the single-file SPA
const grab = (re, label) => { const m = src.match(re); if (!m) throw new Error("could not extract " + label); return m[0]; };
const sandbox = [
  "let styleRegion={};",
  grab(/const MAX_CAT=[^\n]*/, "consts"),
  grab(/const DIFF=\{[\s\S]*?\n\};/, "DIFF"),
  grab(/function timeScore\(diff\)\{[\s\S]*?\n\}/, "timeScore"),
  grab(/const MOVEMENTS=\{[\s\S]*?\n\};/, "MOVEMENTS"),
  grab(/const MOV_FAMILY=\{[\s\S]*?return Math\.min\(1,sim\);\n\}/, "movementSim block"),
  "globalThis.MAX_CAT=MAX_CAT; globalThis.DIFF=DIFF; globalThis.timeScore=timeScore; globalThis.movementSim=movementSim; globalThis.movEra=movEra;",
].join("\n");
new Function(sandbox)();

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error("  ✗ " + msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)}, expected ${JSON.stringify(b)})`);

// --- timeScore: stepped curve, bullseye, and never-negative ---
eq(timeScore(0).pts, MAX_CAT, "0 yrs off = full");
ok(timeScore(0).bull === true, "0 yrs off = bullseye");
eq(timeScore(12).pts, MAX_CAT, "<=12 scaled = full");
eq(timeScore(13).pts, 2250, "13 = 2250 band");
eq(timeScore(9999).pts, 0, "way off = 0");
ok(timeScore(80).pts > timeScore(160).pts, "monotonic: closer scores higher");

// --- movEra: BCE / CE range parsing (the historically buggy part) ---
const era = n => globalThis.movEra(n);
eq(JSON.stringify(era("Baroque")), JSON.stringify([1600, 1750]), "CE range");
eq(JSON.stringify(era("Assyrian")), JSON.stringify([-900, -600]), "BCE range (both BCE)");

// --- movementSim: 0..1, exact, graded, and the invariant that partial < exact ---
eq(movementSim("Baroque", "Baroque"), 1, "identical = 1");
ok(movementSim("Romanticism", "Academic art") > 0, "Romanticism~Academic art earns partial");
eq(movementSim("Baroque", "Surrealism"), 0, "no family/era overlap = 0 (region alone doesn't count)");
ok(movementSim("Cubism", "Futurism") > 0, "same modernist family earns partial");
const relMovMax = Math.max(...Object.values(DIFF).map(d => d.relMov));
ok(MAX_CAT * relMovMax * 1 < MAX_CAT, "INVARIANT: max partial movement credit can never reach an exact match");
for (const a of ["Romanticism", "Cubism", "Edo period"]) for (const b of ["Academic art", "Futurism", "Baroque"]) {
  const s = movementSim(a, b); ok(s >= 0 && s <= 1, `sim(${a},${b}) in [0,1]`);
}

console.log(`\nscoring.test: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
