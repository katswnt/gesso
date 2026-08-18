// SCOUT: probe Getty AAT for a sample of our movement/culture labels and print what comes back,
// so we can compare AAT's hierarchy to our MOV_FAMILY before filling anything.
// Read-only. Network — run LOCALLY with plain node (not a sandbox).
//   node scripts/aat-scout.mjs
import { writeFileSync } from "node:fs";

const ENDPOINT = "https://vocab.getty.edu/sparql.json";

function sparql(term) {
  const t = term.replace(/["\\]/g, " ").trim();
  return `
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX luc: <http://www.ontotext.com/owlim/lucene#>
PREFIX aat: <http://vocab.getty.edu/aat/>
PREFIX gvp: <http://vocab.getty.edu/ontology#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT ?s ?pref ?bId ?bLabel
  (GROUP_CONCAT(DISTINCT ?alt; separator=" | ") AS ?alts)
  (GROUP_CONCAT(DISTINCT ?ancL; separator=" > ") AS ?anc)
  (SAMPLE(?sn) AS ?note) WHERE {
  ?s luc:term "${t}" ; skos:inScheme aat: ; skos:prefLabel ?pref . FILTER(lang(?pref)="en")
  OPTIONAL { ?s gvp:broaderPreferred ?b . ?b skos:prefLabel ?bLabel . FILTER(lang(?bLabel)="en")
             BIND(REPLACE(STR(?b), ".*/", "") AS ?bId) }
  OPTIONAL { ?s skos:altLabel ?alt . FILTER(lang(?alt)="en") }
  OPTIONAL { ?s gvp:broaderPreferred+ ?ancC . ?ancC skos:prefLabel ?ancL . FILTER(lang(?ancL)="en") }
  OPTIONAL { ?s skos:scopeNote ?snN . ?snN rdf:value ?sn . FILTER(lang(?sn)="en") }
} GROUP BY ?s ?pref ?bId ?bLabel LIMIT 8`;
}

async function fetchAAT(term) {
  const url = ENDPOINT + "?query=" + encodeURIComponent(sparql(term));
  try {
    const r = await fetch(url, { headers: { Accept: "application/sparql-results+json" } });
    if (!r.ok) return { term, error: `HTTP ${r.status}` };
    const j = await r.json();
    const rows = (j.results?.bindings || []).map(b => ({
      id: (b.s?.value || "").split("/").pop(),
      pref: b.pref?.value || "",
      parent: b.bLabel?.value || "",
      parentId: b.bId?.value || "",
      alts: (b.alts?.value || "").split(" | ").filter(Boolean),
      ancestors: b.anc?.value || "",
      note: (b.note?.value || "").replace(/\s+/g, " ").slice(0, 180),
    }));
    // prefer an exact (case-insensitive) pref match, then exact alt match, else relevance order
    const lc = s => s.toLowerCase();
    const exact = rows.filter(m => lc(m.pref) === lc(term));
    const altEx = rows.filter(m => m.alts.some(a => lc(a) === lc(term)));
    const ordered = [...exact, ...altEx.filter(m => !exact.includes(m)),
                     ...rows.filter(m => !exact.includes(m) && !altEx.includes(m))];
    const match = exact.length ? "exact" : altEx.length ? "alt" : rows.length ? "fuzzy" : "none";
    return { term, match, matches: ordered };
  } catch (e) { return { term, error: String(e.message || e) }; }
}

const SCOUT = [
  // MOV_FAMILY.baroque — the whole family
  "Baroque","Dutch Golden Age","Flemish Baroque","Rococo","Caravaggisti","Italian Baroque",
  "Grand Manner","Vedute","Delft school","Auricular style","Caravaggism",
  // the 11 pool orphans (no MOVEMENTS def)
  "Māori art","Melanesian art","Polynesian art","Early Islamic","Ottonian","Trompe-l'oeil",
  "Viking art","Chola","Art Deco","Gallo-Roman","Colonial",
  // culture / period spread
  "Quechua","Gandhara","Hoysala","Olmec","Minoan","Etruscan","Gupta period","Ayutthaya period",
  // core movements to sanity-check parentage
  "Renaissance","Italian Renaissance","Mannerism","Impressionism","Neoclassicism",
];

const out = [];
for (const term of SCOUT) {
  const res = await fetchAAT(term);
  out.push(res);
  const m = res.matches?.[0];
  const tag = res.error ? `ERROR ${res.error}`
    : !res.matches?.length ? "— NO MATCH —"
    : `${res.match.toUpperCase().padEnd(5)} [${m.id}] "${m.pref}"  ⤴ "${m.parent || "(no parent)"}"  ${res.matches.length > 1 ? `(+${res.matches.length - 1})` : ""}`;
  console.log(`${term.padEnd(19)} ${tag}`);
  if (m?.ancestors) console.log(`${" ".repeat(20)}path: ${m.ancestors}`);
  if (m?.note) console.log(`${" ".repeat(20)}note: ${m.note}`);
}
writeFileSync("/tmp/aat-scout.json", JSON.stringify(out, null, 2));
console.log("\n-> /tmp/aat-scout.json");
