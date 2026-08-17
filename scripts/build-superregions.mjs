#!/usr/bin/env node
// build-superregions.mjs — extend window.ARTEFACTUM_SUPERREGIONS (line 2 of data/regions.js) with the
// NON-EUROPEAN historical super-regions (A3). It is ADDITIVE and IDEMPOTENT:
//   • the existing entries (the 8 European ones, hand-authored) pass through UNTOUCHED,
//   • any entry whose name is in NEW below is rebuilt from country outlines and (re)appended,
//   • data/regions.js line 1 (ARTEFACTUM_REGIONS, built separately by build-regions.mjs) is left byte-identical.
//
// WHY super-regions: modern nation-states are the wrong PRIMARY unit for a pre-national corpus (see the B3
// where-scoring model). superRegionFor(work) keys off the work's COUNTRY + YEAR — not its style string — so
// one era-gated polygon credits BOTH blank-style works AND the long tail of mismatched style labels
// ("Qing dynasty literati painting" ≠ the "Qing dynasty" culture key) in a single move, robustly.
//
// GEOMETRY: like the 8 European super-regions, each is the union of its member modern-country outlines from
// data/countries.js (vetted, already simplified) — no hand-drawing. A work is always credited to the historical
// polity of ITS OWN country (membership is by placeCountry), so a Magna-Graecia vase catalogued in Italy still
// scores against the Italian peninsula, not the Greek world.
//
// DATE BOUNDARIES are editorial (each ends at the polity's fall / loss of independence) so a MODERN work in the
// same country does NOT match and correctly scores against its modern nation:
//   Imperial China …1912 (fall of Qing) · Greater Persia …1925 (end of Qajar) · the Nile Valley …1800 (pre-modern
//   Egypt) · Ancient Greek world …-30 (Roman conquest) · Ottoman core 1299…1922 · Indian subcontinent …1858
//   (British Raj) · Mesopotamia …-300 (Hellenistic) · Andean world …1533 (Spanish conquest).
//
// RUN: node scripts/build-superregions.mjs   (then gate + commit data/regions.js)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeAtomic } from "./lib/static-module.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const win = {};
new Function("window", readFileSync(join(ROOT, "data", "countries.js"), "utf8"))(win);
const COUNTRIES = win.ARTEFACTUM_COUNTRIES || [];
const RINGS = {}; for (const c of COUNTRIES) RINGS[c.n] = c.r; // country name → array of [lng,lat] rings

// Super-regions REBUILT from country outlines (dropped-then-reappended by name; the other hand-authored European
// entries pass through untouched). members = the modern countries whose art of that era belongs to the polity;
// geometry = the union of those countries' outlines. Names read naturally in the reveal nudge "…this is <name>".
const NEW = [
  // Correction (2026-08-17): the original "Russian/Soviet sphere" polygon spanned the WHOLE former USSR, so a pin
  // in Kyiv or Tashkent scored full credit for a Moscow-placed work (~2,800 km off) and quietly absorbed the other
  // republics under Russia. Shrink it to modern Russia proper — still enormous (any in-Russia pin = full), but a
  // pin in Ukraine / the Caucasus / Central Asia no longer counts as "in region".
  { name: "Russian/Soviet sphere",members: ["Russia"],                                  from: 1700,  to: 1991 },
  { name: "Imperial China",       members: ["China"],                                   from: -2000, to: 1912 },
  { name: "Greater Persia",       members: ["Iran"],                                    from: -3000, to: 1925 },
  { name: "the Nile Valley",      members: ["Egypt"],                                   from: -3100, to: 1800 },
  { name: "Ancient Greek world",  members: ["Greece", "Cyprus"],                        from: -1200, to: -30 },
  { name: "Ottoman core",         members: ["Turkey"],                                  from: 1299,  to: 1922 },
  { name: "Indian subcontinent",  members: ["India", "Pakistan", "Bangladesh", "Nepal"],from: -2500, to: 1858 },
  { name: "Mesopotamia",          members: ["Iraq"],                                    from: -4000, to: -300 },
  { name: "Andean world",         members: ["Peru", "Bolivia", "Ecuador"],              from: -1500, to: 1533 },
];

const newNames = new Set(NEW.map((s) => s.name));
const built = [];
const problems = [];
for (const s of NEW) {
  const geometry = [];
  for (const m of s.members) {
    if (!RINGS[m]) { problems.push(`${s.name}: no country outline for "${m}"`); continue; }
    geometry.push(...RINGS[m]);
  }
  if (!geometry.length) { problems.push(`${s.name}: EMPTY geometry — skipped`); continue; }
  built.push({ name: s.name, members: s.members, from: s.from, to: s.to, geometry });
}
if (problems.length) { console.error("✗ build problems:\n  " + problems.join("\n  ")); if (!built.length) process.exit(1); }

// read the 2-line file; keep line 1 (REGIONS) verbatim, rebuild line 2 (SUPERREGIONS)
const path = join(ROOT, "data", "regions.js");
const raw = readFileSync(path, "utf8");
const lines = raw.split("\n");
const srLineIdx = lines.findIndex((l) => l.startsWith("window.ARTEFACTUM_SUPERREGIONS="));
if (srLineIdx < 0) { console.error("✗ could not find the ARTEFACTUM_SUPERREGIONS line"); process.exit(1); }
const existing = [];
new Function("window", lines[srLineIdx] + "\nglobalThis.__SR=window.ARTEFACTUM_SUPERREGIONS;")({});
const prior = globalThis.__SR || [];
for (const sr of prior) if (!newNames.has(sr.name)) existing.push(sr); // drop old copies of NEW (idempotent)

const out = [...existing, ...built];
lines[srLineIdx] = `window.ARTEFACTUM_SUPERREGIONS=${JSON.stringify(out)};`;
writeAtomic(path, lines.join("\n"));

const kb = (Buffer.byteLength(lines[srLineIdx]) / 1024).toFixed(1);
console.log(`wrote data/regions.js — SUPERREGIONS now ${out.length} (${existing.length} untouched + ${built.length} rebuilt from country outlines), line = ${kb} KB`);
console.log("  rebuilt: " + built.map((s) => `${s.name} [${s.members.join("+")}] ${s.from}..${s.to}`).join("\n           "));
