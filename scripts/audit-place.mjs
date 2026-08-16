// Place-provenance audit (network; run with plain `node`, NOT codex sandbox).
// Detects the "place = artist's BIRTHPLACE, not where the work was made" harvest bug.
// For every pool work with a Wikidata QID, pulls: creator birthplace country (P170→P19→P17),
// location-of-creation country (P1071→P17), and country of origin (P495). Then:
//   - suggested = location-of-creation country, else country-of-origin
//   - HIGH  : current place == creator-birthplace country  AND  a suggested country exists & differs  → likely the bug
//   - MED   : suggested exists & differs from current place (but place != birthplace)                → review
// Caches raw WD results to data/incoming/place-audit/wd.json (resumable). Writes report.json.
// Usage: node scripts/audit-place.mjs            (gather + analyze)
//        node scripts/audit-place.mjs --apply    (also write HIGH-confidence fixes into data/pool.js)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { readGlobal } from "./lib/static-module.mjs";
import { canonicalizePlace, isPlaceCanonical, continentOf } from "./lib/places.mjs";
import { loadWdEntities } from "./lib/wd-cache.mjs";

const DIR = "data/incoming/place-audit";
mkdirSync(DIR, { recursive: true });
const apply = process.argv.includes("--apply");

const pool = readGlobal("data/pool.js", "ARTEFACTUM_POOL");
const qidOf = p => { const m = String(p.id).match(/Q\d+/); return (m && /^(wikidata:|http:\/\/www\.wikidata)/.test(p.id)) ? m[0] : null; };
const works = pool.map(p => ({ p, qid: qidOf(p) })).filter(x => x.qid && x.p.place);
const byQid = {}; for (const w of works) (byQid[w.qid] = byQid[w.qid] || []).push(w.p);

// birthplace-country / location / origin / inception now come from the shared Wikidata cache — no sweep.
const yearOf = v => { const m = String(v || "").match(/^(-?)0*(\d+)/); if (m) { const y = (m[1] ? -1 : 1) * parseInt(m[2], 10); return y || null; } return null; };
const ents = await loadWdEntities(works.map(w => w.qid), { onProgress: (d, t) => { if (d % 600 < 100) console.error(`  ${d}/${t} fetched`); } });
const cache = {};
for (const q of Object.keys(byQid)) { const e = ents.get(q); const inc = yearOf(e.inception);
  cache[q] = { birth: [...new Set(e.creators.map(c => c.birthCountry).filter(Boolean))], loc: e.locCountry, orig: e.origCountry, inc: inc ? [inc] : [] }; }

// ---- analyze ----
// Wikidata returns HISTORICAL state names for location/origin (Republic of Venice, Dutch Republic, Safavid
// Iran…). Normalize each to the modern pool country so we only flag genuine cross-country mismatches.
const NORM = {
  "United States":"United States of America",
  "Ancient Egypt":"Egypt","Fatimid Egyptian Caliphate":"Egypt","Mamluk Sultanate of Egypt":"Egypt",
  "Qing dynasty":"China","Ming dynasty":"China","Northern Song dynasty":"China","Southern Song dynasty":"China","Tang dynasty":"China","People's Republic of China":"China",
  "Safavid Iran":"Iran","Achaemenid Empire":"Iran","Afsharid Iran":"Iran","Qajar Iran":"Iran","Sasanian Empire":"Iran","Parthian Empire":"Iran",
  "Soviet Union":"Russia","Russian Soviet Federative Socialist Republic":"Russia",
  "Tokugawa shogunate":"Japan","Edo":"Japan","Empire of Japan":"Japan",
  "First French Empire":"France","Second French Empire":"France","Kingdom of France":"France","July Monarchy":"France","Bourbon Restoration":"France",
  "Northern Low Countries":"Netherlands","Seventeen Provinces":"Netherlands",
  "Republic of Venice":"Italy","Republic of Florence":"Italy","Papal States":"Italy","Duchy of Milan":"Italy","Roman Empire":"Italy","Ancient Rome":"Italy","Roman Republic":"Italy",
  "French Third Republic":"France","Free Imperial City of Strasbourg":"France",
  "United Kingdom of Great Britain and Ireland":"United Kingdom","Kingdom of Great Britain":"United Kingdom","England":"United Kingdom","Kingdom of England":"United Kingdom","Scotland":"United Kingdom","Wales":"United Kingdom",
  "Dutch Republic":"Netherlands","Kingdom of the Netherlands":"Netherlands",
  "Russian Empire":"Russia","Kingdom of Prussia":"Germany","German Empire":"Germany",
  "Hejaz":"Saudi Arabia","Carthage":"Tunisia","Babylonia":"Iraq","Sumer":"Iraq",
  "Ancient Greece":"Greece","Kathmandu Valley":"Nepal","Benin Empire":"Nigeria","Malwa Sultanate":"India","Gujarat":"India",
};
// genuinely ambiguous historical polities spanning >1 modern country — never auto-suggest from these
const AMBIG = new Set(["Holy Roman Empire","Ottoman Empire","Byzantine Empire","Austria–Hungary","Austria-Hungary","Habsburg Netherlands","Habsburg Monarchy"]);
const canon = s => { try { return canonicalizePlace(s); } catch { return s; } };
const modern = s => { if (NORM[s]) return NORM[s]; if (AMBIG.has(s)) return null; const cs = canon(s); return isPlaceCanonical(cs) ? cs : null; };
const HIGH = [], MED = [];
for (const w of works) {
  const c = cache[w.qid]; if (!c) continue;
  const place = canon(w.p.place);
  const birth = new Set((c.birth || []).map(modern).filter(Boolean));
  // ONLY use P1071 location-of-creation. P495 country-of-origin is unreliable (WD frequently sets it to the
  // artist's nationality, which produces false positives — a van Gogh painted in France flagged as Netherlands).
  const sugg = [...new Set((c.loc || []).map(modern).filter(Boolean))];
  const better = sugg.find(s => s !== place);
  if (!better) continue;
  const rec = { id: w.p.id, title: (w.p.title || "").slice(0, 50), artist: w.p.artist, current: w.p.place, suggest: better,
    suggestRegion: continentOf(better) || null, birthplaceMatch: birth.has(place) };
  if (birth.has(place)) HIGH.push(rec); else MED.push(rec);
}
writeFileSync(`${DIR}/report.json`, JSON.stringify({ HIGH, MED }, null, 1));
console.error(`\nHIGH (place==birthplace, has better origin): ${HIGH.length}`);
console.error(`MED  (better origin differs, review): ${MED.length}`);
for (const r of HIGH.slice(0, 25)) console.error(`  HIGH ${r.current} → ${r.suggest}  | ${r.title} — ${r.artist}`);

if (apply && HIGH.length) {
  const t = readFileSync("data/pool.js", "utf8");
  const arr = JSON.parse(t.slice(t.indexOf("["), t.lastIndexOf("]") + 1));
  const fix = {}; for (const r of HIGH) fix[r.id] = r;
  let n = 0;
  for (const p of arr) { const r = fix[p.id]; if (!r) continue;
    p.place = r.suggest; const reg = continentOf(r.suggest); if (reg) p.region = reg;
    // drop now-stale coords so they aren't wrong-country; harvest backfill can re-resolve
    delete p.lat; delete p.lng; n++; }
  writeFileSync("data/pool.js", "window.ARTEFACTUM_POOL = " + JSON.stringify(arr) + ";\n");
  console.error(`\napplied ${n} HIGH-confidence place fixes to data/pool.js (cleared their coords)`);
}
