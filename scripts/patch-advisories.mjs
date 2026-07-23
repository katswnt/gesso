// Clear the fair-scoring advisory flags: a work must never SCORE a category whose answer field is blank
// (a player can't be marked wrong on an artist/culture the data doesn't have). Strips 'artist' from cats
// when the artist is blank, and 'style' from cats when the style is blank — pool-wide, as a correctness
// invariant. Also sets the one missing styleKind (Cubo-Futurism is a movement). Fairness only — never invents
// a value. (Assigning actual culture labels to blank-style works is a separate image-grounded pass.)
//   node scripts/patch-advisories.mjs
import { readGlobal, writeAssignment } from "./lib/static-module.mjs";

const pool = readGlobal("data/pool.js", "ARTEFACTUM_POOL");
const blank = v => !v || !String(v).trim();
let artist = 0, style = 0, kind = 0;

for (const p of pool) {
  if (Array.isArray(p.cats)) {
    if (p.cats.includes("artist") && blank(p.artist)) { p.cats = p.cats.filter(c => c !== "artist"); artist++; }
    if (p.cats.includes("style") && blank(p.style))  { p.cats = p.cats.filter(c => c !== "style");  style++; }
  }
  // style present but styleKind missing → the one flagged case is a movement
  if (p.id === "wikidata:Q60480463" && !blank(p.style) && blank(p.styleKind)) { p.styleKind = "movement"; kind++; }
}

writeAssignment("data/pool.js", "ARTEFACTUM_POOL", pool);
console.log(`de-scored blank artist: ${artist} | de-scored blank style: ${style} | styleKind set: ${kind}`);
