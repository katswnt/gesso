// Audit: same ARTIST, divergent MOVEMENT labels. A named artist's works usually share a movement (or a coherent
// set); wildly different styles on one artist are often a harvest mislabel (e.g. Jean Fouquet's French court
// portrait tagged "Early Netherlandish"). Some divergence is legitimate (a long career spanning movements), so
// this RANKS by suspicion — cross-REGION divergence (a French painter labeled a Low-Countries school) is the
// strong error signal; same-region divergence is likely a real career span. Report-only; review before editing.
//   node scripts/audit-artist-style.mjs
import { readFileSync } from "node:fs";

const raw = readFileSync("data/pool.js", "utf8");
const pool = JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1)).filter(p => p.play !== false);
const src = readFileSync("index.html", "utf8");
const grab = re => { const m = src.match(re); return m ? m[0] : ""; };
// style → region (MOVEMENTS) + a real placeCountry() so we can tell a "mover" (works span countries) from a
// mislabel (works all one country, but a style points to a different one — the Jean-Fouquet case).
let MOV = {}; try { MOV = new Function(grab(/const MOVEMENTS=\{[\s\S]*?\n\};/) + "\nreturn MOVEMENTS;")(); } catch {}
const win = {}; try { new Function("window", readFileSync("data/countries.js", "utf8"))(win); } catch {}
let placeCountry = () => null;
try { placeCountry = new Function("window", [grab(/const COUNTRIES = [^\n]*/), grab(/const CO_BYNAME = \{\}[^\n]*/), grab(/const PLACE_ALIAS = \{[\s\S]*?\};/), grab(/function placeCountry\(place\)\{[\s\S]*?\n\}/), "return placeCountry;"].join("\n"))(win); } catch {}
const regionOf = style => (MOV[style] && MOV[style].region) || null;
const countryOfPlace = p => { const c = placeCountry(p); return c ? c.n : null; };
// does a style's region string clearly name a DIFFERENT country than the artist's? (loose substring match)
const regionNamesCountry = (region, country) => { if (!region || !country) return false; const r = region.toLowerCase(), c = country.toLowerCase();
  return r.includes(c) || c.includes(r) || r.split(/[ ,\/]+/).some(w => w.length > 3 && c.includes(w)); }; // bidirectional (US "United States" ⊂ "United States of America")

const GENERIC = /^(unknown|anonymous|unidentified|unattributed|various|workshop|attributed|circle of|follower of|after |manner of|school of|n\/a|none)/i;
const byArtist = {};
for (const p of pool) { const a = (p.artist || "").trim(); if (!a || GENERIC.test(a) || !p.style) continue;
  (byArtist[a] = byArtist[a] || []).push(p); }

const rows = [];
for (const [artist, works] of Object.entries(byArtist)) {
  if (works.length < 2) continue;
  const styleCount = {}; for (const w of works) styleCount[w.style] = (styleCount[w.style] || 0) + 1;
  const styles = Object.keys(styleCount); if (styles.length < 2) continue;
  const placeCountries = [...new Set(works.map(w => countryOfPlace(w.place)).filter(Boolean))];
  const home = placeCountries.length === 1 ? placeCountries[0] : null; // place-consistent artist → a "mover" isn't
  // MISLABEL smell: the artist worked in ONE country, but a style's region names a DIFFERENT specific country
  // (not a continent). The Jean-Fouquet case: works all in France, one style tagged Netherlandish.
  const offStyles = home ? styles.filter(s => { const r = regionOf(s); return r && !/\b(europe|asia|africa|americas?|north america|world|middle east)\b/i.test(r) && !regionNamesCountry(r, home); }) : [];
  rows.push({ artist, works: works.length, styles, styleCount, home, offStyles });
}
const mislabel = rows.filter(r => r.offStyles.length).sort((a, b) => a.works - b.works); // small oeuvres = clearer outliers
const other = rows.filter(r => !r.offStyles.length).sort((a, b) => b.styles.length - a.styles.length);
console.log(`artists with 2+ works and 2+ distinct movement labels: ${rows.length}\n`);
console.log(`── LIKELY MISLABELS: artist worked in ONE country, but a style points ELSEWHERE (${mislabel.length}) ──`);
for (const r of mislabel) console.log(`  ${r.artist}  (all works in ${r.home})  →  off: ${r.offStyles.map(s => `"${s}"×${r.styleCount[s]} (${regionOf(s)})`).join(", ")}\n      all styles: ${r.styles.map(s => `"${s}"×${r.styleCount[s]}`).join(" · ")}`);
console.log(`\n── other divergence (${other.length}) — usually a legit career span (Mondrian, Matisse) or granularity (Titian) ──`);
for (const r of other.slice(0, 25)) console.log(`  ${r.artist} (${r.works}w): ${r.styles.map(s => `"${s}"×${r.styleCount[s]}`).join(" · ")}`);
if (other.length > 25) console.log(`  …and ${other.length - 25} more`);
