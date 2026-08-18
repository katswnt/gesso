// Build the tracked, PLURAL authority crosswalk from the AAT working map. This is the data-model expression of
// the decolonial critique (Mignolo, TK Labels, Sarr-Savoy, Hicks): no single institution is "the backbone".
// Each concept carries multiple authority slots (Getty AAT, Wikidata, TK Label) and a `canonical` field naming
// which one we defer to — including the honest state "none-adequate" when no source holds a community-grounded
// concept (the Maori case), rather than forcing a wrong Getty id. Getty is ONE advisory voice, not the truth.
//   node scripts/build-authorities.mjs            # dry run (counts)
//   node scripts/build-authorities.mjs --write    # write data/authorities.json (TRACKED)
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const AAT = "data/incoming/aat-map.json";
if (!existsSync(AAT)) { console.error(`missing ${AAT} — run scripts/aat-fetch.mjs`); process.exit(1); }
const aat = JSON.parse(readFileSync(AAT, "utf8"));
const OUT = "data/authorities.json";
const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {}; // preserve manual tkLabel/canonical overrides

// key off the CURRENT pool labels (+ MOVEMENTS keys), NOT the AAT map — so renamed/merged labels (Mexica, Seljuq)
// are present and removed labels drop out. The AAT map is just the lookup for the aat slot.
const raw = readFileSync("data/pool.js", "utf8");
const pool = JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1));
const SCORED = new Set(["movement", "culture", "period", "school", "tradition", "genre"]);
const current = new Map(); // label -> {kinds:Set, works}
for (const p of pool) { if (!p.style || !SCORED.has(p.styleKind)) continue; const e = current.get(p.style) || { kinds: new Set(), works: 0 }; e.kinds.add(p.styleKind); e.works++; current.set(p.style, e); }
const idx = readFileSync("index.html", "utf8");
for (const m of (idx.match(/const MOVEMENTS=\{[\s\S]*?\n\};/)?.[0] || "").matchAll(/"([^"]+)":\{/g)) if (!current.has(m[1])) current.set(m[1], { kinds: new Set(["(movements-map-only)"]), works: 0 });

// a clean, trustworthy AAT match = an in-facet label match (no -offfacet suffix), tier exact/alt/norm/base
const CLEAN = new Set(["exact", "alt", "norm", "base"]);
const isClean = m => CLEAN.has(m || "");

// ENDONYM OVERRIDES: concepts where AAT holds a valid concept id but under an EXONYM/imprecise pref, so we
// deliberately DON'T defer to AAT for the NAME. The aat id stays a cross-reference; canonical becomes "endonym"
// (later a Wikidata/community source can back it). This is the naming-authority half of the decolonial fix.
const ENDONYM = {
  "Mexica": "endonym; AAT pref is the exonym \"Aztec\" (300017033). We display the people's own name.",
  "Seljuq": "precise transliteration of the qaf; AAT pref is the common form \"Seljuk\" (300021736).",
};

const out = {};
for (const [label, cur] of current) {
  const r = aat[label] || { match: "none", kinds: [...cur.kinds], works: cur.works };
  r.kinds = [...cur.kinds]; r.works = cur.works; // authoritative from current pool
  const clean = isClean(r.match);
  const p = prev[label] || {};
  const manualTk = p.authorities?.tkLabel ?? null;
  const manualWd = p.authorities?.wikidata ?? null; // preserve a Wikidata slot if a later fetch already filled it
  const aatSlot = r.aatId
    ? { id: r.aatId, pref: r.aatPref, match: r.match, inFacet: !!r.inFacet, ...(r.noteDate ? { dates: r.noteDate } : {}) }
    : null;
  // canonical: which authority we defer to for the NAME. tkLabel (community) wins; then a deliberate endonym
  // override; then a preserved manual choice; then AAT when the match is confident; else none is adequate yet.
  let canonical = manualTk ? "tkLabel" : ENDONYM[label] ? "endonym"
    : (p.canonical && !["none-adequate", "aat", "endonym"].includes(p.canonical)) ? p.canonical
    : clean ? "aat" : "none-adequate";
  let note = ENDONYM[label] || p.note || "";
  if (canonical === "none-adequate" && !note) {
    note = "no confident institutional match; for Indigenous/community material prefer a community protocol " +
           "(Local Contexts / TK Labels) over an institutional id — see docs/taxonomy.md";
  }
  out[label] = {
    label, kinds: r.kinds || [], works: r.works || 0,
    authorities: { aat: aatSlot, wikidata: manualWd, tkLabel: manualTk },
    canonical, note,
    constructType: p.constructType || null, // Phase C: flags colonial meta-categories (Melanesian/Polynesian art)
  };
}

const tally = {};
for (const v of Object.values(out)) tally[v.canonical] = (tally[v.canonical] || 0) + 1;
console.log(`authorities: ${Object.keys(out).length} concepts`);
console.log(`canonical source: ${Object.entries(tally).map(([k, v]) => `${k}:${v}`).join("  ")}`);
const naWithWorks = Object.values(out).filter(v => v.canonical === "none-adequate" && v.works > 0).length;
console.log(`none-adequate with pool works (real gaps to source better): ${naWithWorks}`);

if (process.argv.includes("--write")) { writeFileSync(OUT, JSON.stringify(out, null, 2)); console.log(`\n✔ wrote ${OUT} (tracked)`); }
else console.log(`\n(dry run — pass --write)`);
