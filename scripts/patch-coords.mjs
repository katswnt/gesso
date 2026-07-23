// One-time curated coordinate fix for the 11 genuine coords-outside-country records (holding-museum / wrong-city
// coordinates that disagreed with the work's stated place of origin). Each replacement is a verified point that
// matches the place label AND lands inside the country the label resolves to — re-run audit-detectors to confirm.
// The OTHER flagged works (Two Tahitian Women in Tahiti; the Moai on Easter Island) already have CORRECT coords
// far from their parent country's mainland — those are handled by a detector fix (overseas territories), not moved.
//   node scripts/patch-coords.mjs
import { readGlobal, writeAssignment } from "./lib/static-module.mjs";

const FIX = {
  "met326374":                                [27.33,  68.14],  // Indus Valley → Mohenjo-daro, Pakistan (was Washington DC / Freer)
  "cleveland119143":                          [47.32,   5.04],  // Dijon, Burgundy, France (was Madrid)
  "cleveland143381":                          [17.36, -90.28],  // El Perú–Waka', Petén, Guatemala (was Mexico City)
  "cleveland138885":                          [51.05,   3.72],  // Flanders, Ghent & Bruges → Ghent, Belgium (was Amsterdam)
  "http://www.wikidata.org/entity/Q19960944": [50.85,   4.35],  // Southern Netherlands → Brussels, Belgium
  "http://www.wikidata.org/entity/Q1516449":  [51.21,   3.22],  // Southern Netherlands → Bruges, Belgium (van Eyck)
  "http://www.wikidata.org/entity/Q18399815": [50.88,   4.70],  // Louvain, Burgundian Netherlands → Leuven, Belgium
  "http://www.wikidata.org/entity/Q185392":   [37.94,  27.34],  // Ephesus, Asia Minor → Ephesus, Turkey (was Athens)
  "http://www.wikidata.org/entity/Q1952284":  [52.37,   4.90],  // Low Countries → Amsterdam, Netherlands (was Wisconsin)
  "http://www.wikidata.org/entity/Q7934008":  [52.37,   4.90],  // Low Countries → Amsterdam, Netherlands (was Wisconsin)
  "wikidata:Q15284134":                       [36.69,  27.37],  // Knidos, Asia Minor → Knidos, Turkey (was Aegean Greece)
};

const pool = readGlobal("data/pool.js", "ARTEFACTUM_POOL");
let n = 0;
for (const p of pool) { const f = FIX[p.id]; if (f) { p.lat = f[0]; p.lng = f[1]; n++; } }
writeAssignment("data/pool.js", "ARTEFACTUM_POOL", pool);
console.log(`patched ${n}/${Object.keys(FIX).length} coordinate records`);
if (n !== Object.keys(FIX).length) console.error("WARNING: some ids not found in pool — check the id format");
