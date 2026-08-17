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
  grab(/function ptInRing\(x,y,ring\)\{[\s\S]*?return inside; \}/, "ptInRing"),
  grab(/function ptInRegion\(lat,lng,reg\)\{[\s\S]*?return false; \}/, "ptInRegion"),
  grab(/function whereCredit\(\{[\s\S]*?\n\}/, "whereCredit"),
  // artist alias matching (1c) + its deps
  "function norm(s){return (s||'').toLowerCase().replace(/[^a-z ]/g,'').trim();}",
  grab(/function deaccent\(s\)\{[^\n]*\}/, "deaccent"),
  grab(/function lev\(a,b\)\{[\s\S]*?return d\[m\]\[n\]; \}/, "lev"),
  grab(/const NAME_PARTICLES=[^\n]*/, "NAME_PARTICLES"),
  grab(/const ARTIST_ALIAS_GROUPS=\[[\s\S]*?\];/, "ARTIST_ALIAS_GROUPS"),
  grab(/function aliasHit\(s,i\)\{[^\n]*\}/, "aliasHit"),
  grab(/function aliasGroupOf\(s\)\{[^\n]*\}/, "aliasGroupOf"),
  grab(/function artistMatch\(g,a\)\{[\s\S]*?return false; \}/, "artistMatch"),
  // place-NA (B1)
  grab(/const PLACE_NA_RE=[^\n]*/, "PLACE_NA_RE"),
  grab(/function isPlaceNA\(p\)\{[\s\S]*?\n\}/, "isPlaceNA"),
  "globalThis.MAX_CAT=MAX_CAT; globalThis.DIFF=DIFF; globalThis.timeScore=timeScore; globalThis.movementSim=movementSim; globalThis.movEra=movEra; globalThis.ptInRegion=ptInRegion; globalThis.whereCredit=whereCredit; globalThis.artistMatch=artistMatch; globalThis.isPlaceNA=isPlaceNA;",
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

// --- ptInRegion: full WHERE credit anywhere inside a historical culture/empire polygon ---
// a simple 10x10 deg box around (0,0) as a stand-in region; geometry is [[ [lng,lat], ... ]]
const box = { geometry: [[[-5,-5],[5,-5],[5,5],[-5,5],[-5,-5]]] };
ok(globalThis.ptInRegion(0, 0, box) === true, "ptInRegion: pin inside polygon = true");
ok(globalThis.ptInRegion(20, 20, box) === false, "ptInRegion: pin outside polygon = false");
ok(globalThis.ptInRegion(0, 0, null) === false, "ptInRegion: no region entry = false (falls back to country logic)");
ok(globalThis.ptInRegion(0, 0, {}) === false, "ptInRegion: missing geometry = false");

// --- whereCredit: B3 tiered place credit ---
const wc = globalThis.whereCredit;
const distPts = 400; // stand-in distance falloff value for the fallback tier
// 1) inside the historical cultural region (or a bullseye) → FULL, regardless of anything else
eq(wc({ inReg: true, countryHit: true, hasReg: true, inCont: false, distPts }).pts, MAX_CAT, "in-region = full credit");
eq(wc({ inReg: true, countryHit: false, hasReg: true, inCont: false, distPts }).pts, MAX_CAT, "in-region (bullseye outside country) = full");
// 2) THE B3 CHANGE: right modern country, but the work HAS a deeper cultural region → 0.8 + teaching tier
const only = wc({ inReg: false, countryHit: true, hasReg: true, inCont: false, distPts });
eq(only.pts, Math.round(MAX_CAT * 0.8), "right country but region exists = 0.8 (Benin bronze pinned in Nigeria)");
eq(only.kind, "countryOnly", "the 0.8 tier is flagged countryOnly (drives the reveal nudge)");
ok(only.pts < MAX_CAT, "INVARIANT: country-only can never equal in-region credit");
// 3) right modern country and NO region concept → FULL (the nation genuinely is the answer) — unchanged behavior
eq(wc({ inReg: false, countryHit: true, hasReg: false, inCont: false, distPts }).pts, MAX_CAT, "right country, no region = full (modern work)");
// 4) fallbacks unchanged: right continent floor vs distance falloff
eq(wc({ inReg: false, countryHit: false, hasReg: true, inCont: true, distPts }).pts, Math.max(Math.round(MAX_CAT * 0.5), distPts), "continent tier = max(0.5, distPts)");
eq(wc({ inReg: false, countryHit: false, hasReg: false, inCont: false, distPts }).pts, distPts, "miss = distance falloff");

// --- 1c: artist alias matching (cross-language exonyms + bynames), bidirectional, with guards ---
const am = globalThis.artistMatch;
ok(am("Titian", "Tiziano Vecellio"), "Titian ↔ Tiziano Vecellio");
ok(am("Tiziano", "Titian"), "alias is bidirectional (Tiziano → Titian)");
ok(am("Raphael", "Raffaello Sanzio"), "Raphael ↔ Raffaello Sanzio");
ok(am("El Greco", "Doménikos Theotokópoulos"), "El Greco ↔ Theotokópoulos");
ok(am("Tintoretto", "Jacopo Robusti"), "Tintoretto ↔ Jacopo Robusti");
ok(am("Donatello", "Donato di Niccolò di Betto Bardi"), "Donatello ↔ birth name");
ok(am("Canaletto", "Giovanni Antonio Canal, Venetian"), "alias matches a record with trailing tokens");
// existing behavior still works (mononyms/surnames/typos/deaccent)
ok(am("Leonardo", "Leonardo da Vinci"), "distinctive single name still matches");
ok(am("Vermeer", "Johannes Vermeer"), "surname still matches");
// GUARDS: aliases must not cross groups or collide with near-names
ok(!am("Titian", "Raffaello Sanzio"), "GUARD: different alias groups don't match");
ok(!am("Monet", "Édouard Manet"), "GUARD: Monet ≠ Manet (near-collision stays distinct)");
ok(!am("Canaletto", "Giorgione"), "GUARD: unrelated aliased artists don't match");

// --- B1: place-NA detection (drops the where axis for unscoreable locations) ---
const na = globalThis.isPlaceNA;
ok(na({ lat: null, lng: null, place: "Egypt" }), "no coordinate → placeNA");
ok(na({ lat: 0, lng: 20, place: "Central Africa" }), "continent-only place → placeNA");
ok(na({ lat: 40, lng: -100, style: "Native North America", place: "North America (Indigenous)" }), "Native North America → placeNA");
ok(!na({ lat: 41.9, lng: 12.5, place: "Rome, Italy" }), "a real located work is NOT placeNA");
ok(!na({ lat: 48.8, lng: 2.3, place: "" }), "blank place WITH coords is still distance-scored (not NA)");

// --- B2: object-datability floor — the movEra spans that back it ---
eq(JSON.stringify(globalThis.movEra("Ming dynasty")), JSON.stringify([1368, 1644]), "Ming span parses (widen source)");
ok(globalThis.movEra("Ming dynasty")[1] - globalThis.movEra("Ming dynasty")[0] > 200, "a dynasty span is much wider than ±12 (the point of B2)");

console.log(`\nscoring.test: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
