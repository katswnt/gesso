#!/usr/bin/env node
// build-regions.mjs — generate data/regions.js (window.ARTEFACTUM_REGIONS).
//
// WHY: like Anthropeum, the reveal map should shade the work's TRUE historical
// geographic/cultural range (the whole Roman Empire for a Roman flask; all of
// Ancient Egypt for a Third-Intermediate-Period bronze) instead of just a modern
// country, so players learn where to pin cross-border / ancient cultures.
//
// SOURCE: aourednik/historical-basemaps — `geojson/world_<year>.geojson`, one file
// per snapshot year (BCE files are `world_bc<year>.geojson`). Each feature has a
// NAME property = the polity/culture name at that date. License: GPL-3.0
// (https://github.com/aourednik/historical-basemaps). Attribute in-app.
//
// WHAT IT DOES:
//   1. For each pool culture below, download the era file for the chosen year.
//   2. Pull the feature(s) whose NAME matches the mapped historical-entity name.
//   3. Simplify the polygon (drop precision + Douglas-Peucker-ish point thinning)
//      to keep data/regions.js small (rings shipped as [[ [lng,lat], ... ]]).
//   4. Write data/regions.js = window.ARTEFACTUM_REGIONS = {
//        "<pool.style>": { year, name, geometry:[ ring, ... ] }, ... }
//
// RUN: node scripts/build-regions.mjs            (uses ./.cache/hbm or downloads)
//      node scripts/build-regions.mjs --offline  (cache only, no network)
//
// The KEY of each entry is the culture name EXACTLY as it appears in pool.style
// (styleKind==="culture"). index.html can then look up REGIONS[work.style].

import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeAtomic } from "./lib/static-module.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, ".cache", "hbm");
mkdirSync(CACHE, { recursive: true });
const OFFLINE = process.argv.includes("--offline");
const RAW = "https://raw.githubusercontent.com/aourednik/historical-basemaps/master/geojson";

// ───────────────────────────────────────────────────────────────────────────
// CULTURE → (historical-basemaps NAME, era-file year) MAPPING TABLE
// ───────────────────────────────────────────────────────────────────────────
// key   = pool.style (styleKind "culture") — must match the corpus EXACTLY
// file  = "bc1000" | "200" | "1800" ...  (the world_<file>.geojson snapshot whose
//         boundaries best fit this culture's floruit)
// names = NAME property value(s) to extract from that file (union of polygons).
//         Multiple names → merged into one multi-ring region (e.g. Egypt+Kush).
//
// Eras chosen from each culture's median work-year (see scripts output) snapped
// to the nearest snapshot where the polity is named in the dataset.
const MAP = {
  // ── Egypt (all periods → the pharaonic/Egyptian polygon at the right date) ──
  "Third Intermediate Period": { file: "bc1000", names: ["Egypt"] },        // ~1000 BCE
  "New Kingdom":               { file: "bc1500", names: ["Egypt", "Kush"] },// ~1372 BCE, Nubia held
  "Middle Kingdom":            { file: "bc2000", names: ["Egypt"] },        // ~1978 BCE
  "Old Kingdom":               { file: "bc3000", names: ["Egypt"] },        // ~2417 BCE
  "Predynastic Egypt":         { file: "bc3000", names: ["Egypt"] },        // ~4000 BCE (earliest named)
  "Ancient Egypt":             { file: "bc1500", names: ["Egypt"] },        // generic
  "Late Period Egypt":         { file: "bc500",  names: ["Achaemenid Empire"] }, // 27th dyn = Persian-held; fallback below
  "Ptolemaic Egypt":           { file: "bc200",  names: ["Ptolemaic Kingdom"] }, // ~181 BCE
  "Roman Egypt":               { file: "200",    names: ["Roman Empire"] }, // province of Rome
  "Coptic art":                { file: "600",    names: ["Eastern Roman Empire"] },
  "Islamic Egypt":             { file: "1000",   names: ["Fatimid Caliphate"] }, // Fatimid Egypt

  // ── China (dynasty polygon at the right date) ──
  "Neolithic Chinese jade":    { file: "bc3000", names: ["Dapenkeng culture"] }, // best-available neolithic E-Asia
  "Shang–Zhou bronze":         { file: "bc500",  names: ["Zhou states"] }, // earliest named China polity
  "Han dynasty":               { file: "200",    names: ["Han"] },
  "Tang dynasty":              { file: "800",    names: ["Tang Empire"] },
  "Song dynasty":              { file: "1100",   names: ["Song Empire"] },
  "Yuan dynasty":              { file: "1300",   names: ["Great Khanate"] },
  "Ming dynasty":              { file: "1500",   names: ["Ming Chinese Empire"] },
  "Qing dynasty":              { file: "1800",   names: ["Qing Empire"] },
  "Chinese":                   { file: "1500",   names: ["Ming Chinese Empire"] },

  // ── Japan ──
  "Heian period":              { file: "1100",   names: ["Imperial Japan (Fujiwara)"] },
  "Kamakura period":           { file: "1300",   names: ["Shogun Japan (Kamakura)"] },
  "Japanese Buddhist art":     { file: "1300",   names: ["Shogun Japan (Kamakura)"] },
  "Momoyama period":           { file: "1600",   names: ["Japan (Warring States)"] },
  "Edo period":                { file: "1715",   names: ["Tokugawa shogunate"] },
  "Ukiyo-e":                   { file: "1715",   names: ["Tokugawa shogunate"] },
  "Japan":                     { file: "1800",   names: ["Japan"] },

  // ── Korea ──
  "Korea, Goryeo dynasty":     { file: "1100",   names: ["Korea"] },
  "Koreans":                   { file: "1100",   names: ["Korea"] },
  "Korean":                    { file: "1500",   names: ["Korea"] },
  "Korea, Joseon dynasty":     { file: "1715",   names: ["Korea"] },
  "Korea":                     { file: "1500",   names: ["Korea"] },

  // ── Iran / Persia / Islamic world ──
  "Achaemenid":                { file: "bc500",  names: ["Achaemenid Empire"] },
  "Parthian":                  { file: "200",    names: ["Parthian Empire"] },
  "Islamic":                   { file: "1000",   names: ["Fatimid Caliphate", "Buyid Emirate", "Caliphate of Córdoba"] }, // broad Islamic world
  "Persian Islamic pottery":   { file: "1100",   names: ["Seljuk Empire"] },
  "Ilkhanid art":              { file: "1300",   names: ["Ilkhanate"] },
  "Seljuq":                    { file: "1100",   names: ["Seljuk Empire"] },
  "Timurid":                   { file: "1500",   names: ["Timurid Emirates"] },
  "Safavid":                   { file: "1650",   names: ["Safavid Empire"] },
  "Safavid Iran":              { file: "1650",   names: ["Safavid Empire"] },
  "Iran":                      { file: "1000",   names: ["Buyid Emirate"] }, // medieval Persia
  "Qajar art":                 { file: "1800",   names: ["Persia"] },

  // ── Near East / Mediterranean antiquity ──
  "Assyrian":                  { file: "bc1000", names: ["Assyria"] },
  "Hittite":                   { file: "bc2000", names: ["Hittites"] },
  "Sumerian art":              { file: "bc3000", names: ["Ur"] },
  "Cycladic":                  { file: "bc3000", names: ["Cycladic"] },
  "Minoan":                    { file: "bc2000", names: ["Minoan"] },
  "Ancient Greece":            { file: "bc500",  names: ["Greek city-states"] },
  "Roman":                     { file: "200",    names: ["Roman Empire"] },
  "Roman, Pompeian":           { file: "200",    names: ["Roman Empire"] },
  "Byzantine":                 { file: "800",    names: ["Byzantine Empire"] },

  // ── Turkey / Ottoman ──
  "Ottoman":                   { file: "1600",   names: ["Ottoman Empire"] },
  "Iznik":                     { file: "1600",   names: ["Ottoman Empire"] },

  // ── India ──
  "Mughal painting":           { file: "1600",   names: ["Mughal Empire"] },

  // ── Americas ──
  "Moche":                     { file: "600",    names: ["Moche"] },
  "Chimú":                     { file: "1300",   names: ["Chimú Empire"] },
  "Inca":                      { file: "1500",   names: ["Inca Empire"] },
  "Maya":                      { file: "600",    names: ["Maya states"] },
  "Teotihuacan":               { file: "600",    names: ["Teotihuacàn"] },
  "Olmec":                     { file: "bc500",  names: ["Olmec"] },

  // ── Africa ──
  "Benin (Edo) art":           { file: "1600",   names: ["Benin"] },
  "Edo people":                { file: "1600",   names: ["Benin"] },
  "Ethiopia":                  { file: "1500",   names: ["Ethiopia"] },

  // ── Himalaya ──
  "Himalayan peoples":         { file: "1650",   names: ["Nepal", "Tibet"] },
  "Tibet":                     { file: "1500",   names: ["Tibet"] },
  "Central Tibet":             { file: "1500",   names: ["Tibet"] },
};

// ───────────────────────────────────────────────────────────────────────────
// helpers
// ───────────────────────────────────────────────────────────────────────────
async function loadEra(file) {
  const path = join(CACHE, `world_${file}.geojson`);
  if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8"));
  if (OFFLINE) throw new Error(`offline: missing cache ${path}`);
  const url = `${RAW}/world_${file}.geojson`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  const txt = await res.text();
  writeFileSync(path, txt);
  return JSON.parse(txt);
}

// Polygon/MultiPolygon → array of rings ([ [lng,lat], ... ]). Outer rings only
// (drop holes — visual shading doesn't need them and it halves the size).
function ringsOf(geom) {
  if (!geom) return [];
  if (geom.type === "Polygon") return [geom.coordinates[0]];
  if (geom.type === "MultiPolygon") return geom.coordinates.map((p) => p[0]);
  return [];
}

// Coarsen a ring: round coords to ~0.25° and drop near-collinear / near-duplicate
// vertices. Keeps shapes recognizable while shrinking the payload a lot.
function simplifyRing(ring, tol = 0.35) {
  const r = ring.map(([x, y]) => [Math.round(x / 0.25) * 0.25, Math.round(y / 0.25) * 0.25]);
  const out = [r[0]];
  for (let i = 1; i < r.length - 1; i++) {
    const [px, py] = out[out.length - 1];
    const [x, y] = r[i];
    if (Math.abs(x - px) < tol && Math.abs(y - py) < tol) continue; // too close
    out.push([x, y]);
  }
  out.push(r[r.length - 1]);
  // ensure closed
  const a = out[0], b = out[out.length - 1];
  if (a[0] !== b[0] || a[1] !== b[1]) out.push(a);
  return out.length >= 4 ? out : r; // don't degenerate
}

function round2(rings) {
  return rings.map((ring) => simplifyRing(ring).map(([x, y]) => [
    Math.round(x * 100) / 100, Math.round(y * 100) / 100,
  ]));
}

// ───────────────────────────────────────────────────────────────────────────
// build
// ───────────────────────────────────────────────────────────────────────────
const eraCache = new Map();
async function getEra(file) {
  if (!eraCache.has(file)) eraCache.set(file, await loadEra(file));
  return eraCache.get(file);
}

const out = {};
const missing = [];
const yearOfFile = (f) => (f.startsWith("bc") ? -Number(f.slice(2)) : Number(f));

for (const [culture, { file, names }] of Object.entries(MAP)) {
  let fc;
  try { fc = await getEra(file); }
  catch (e) { missing.push(`${culture}: ${e.message}`); continue; }
  const feats = fc.features.filter((f) => names.includes(f.properties?.NAME));
  if (!feats.length) { missing.push(`${culture}: no NAME ${JSON.stringify(names)} in world_${file}`); continue; }
  let rings = [];
  for (const f of feats) rings.push(...ringsOf(f.geometry));
  rings = round2(rings);
  out[culture] = { year: yearOfFile(file), name: names.join(" + "), geometry: rings };
}

const body = `window.ARTEFACTUM_REGIONS=${JSON.stringify(out)};\n`;
writeAtomic(join(ROOT, "data", "regions.js"), body);

const bytes = Buffer.byteLength(body);
console.log(`wrote data/regions.js — ${Object.keys(out).length} cultures, ${(bytes / 1024).toFixed(1)} KB`);
if (missing.length) {
  console.log(`\n${missing.length} UNMAPPED / MISSING (fall back to modern country in-app):`);
  for (const m of missing) console.log("  - " + m);
}
