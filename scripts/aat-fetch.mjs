// Map every Gesso movement/culture label to a Getty AAT concept, as a BACKSTAGE data-quality authority.
//
// WHY: our style/culture vocabulary was hand-authored. AAT (the Getty Art & Architecture Thesaurus) is the
// standard controlled vocabulary curators catalogue against. Anchoring each label to an AAT concept id gives us
// (a) canonical spelling, (b) a real parent/ancestor chain to VALIDATE our MOV_FAMILY groupings against,
// (c) concept-identity for near-duplicate detection (two labels -> same AAT id = the same thing), and
// (d) dates from AAT scope notes to seed MOVEMENTS. AAT is a REFERENCE, never shown to players; MOV_FAMILY stays
// our game-tuned "confusability" grouping (see index.html). See docs/taxonomy.md for the full rationale.
//
// MATCHING: naive full-text (luc:term) relevance-ranks garbage to the top ("Melanesian art" -> "Nose art"), so we
// match EXACT preferred/alt label first, restricted to the Styles-and-Periods facet (300264088, which also holds
// cultures). Only on an exact miss do we fall back to a facet-restricted fuzzy search, tagged 'fuzzy' for human
// review. We NEVER auto-accept a fuzzy match as canonical.
//
// OPERational: the Getty endpoint throttles ("Service temporarily degraded"), so this is PACED with backoff and
// CHECKPOINTS after every label to data/incoming/aat-map.json. Re-running resumes (skips already-mapped labels).
// Run LOCALLY with plain node (needs network; a sandbox can't reach Getty):
//   node scripts/aat-fetch.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const EP = "https://vocab.getty.edu/sparql.json";
const FACET = "300264088"; // Styles and Periods Facet (styles, periods, AND cultures)
const OUT = "data/incoming/aat-map.json";
const PACE_MS = 500;       // between labels, be polite
const MAX_RETRY = 6;

const PFX = `PREFIX skos:<http://www.w3.org/2004/02/skos/core#>
PREFIX aat:<http://vocab.getty.edu/aat/>
PREFIX gvp:<http://vocab.getty.edu/ontology#>
PREFIX luc:<http://www.ontotext.com/owlim/lucene#>
PREFIX rdf:<http://www.w3.org/1999/02/22-rdf-syntax-ns#>`;

const esc = s => String(s).replace(/["\\]/g, " ").trim();

// PERF: the Getty endpoint 499s (times out) on an unbound transitive `broaderPreferred+` closure combined with a
// full-label-scan filter. So we do TWO cheap queries per label instead of one monster:
//   1) qCandidates — indexed full-text (luc:term), no closure: returns concepts + immediate parent + alts + note.
//   2) qPath — ancestor closure on the ONE chosen concept id (bound subject = cheap): path + facet check.
// We pick the exact pref/alt match from (1) in JS, then verify facet + get the path with (2).

// case/diacritic/suffix variants of a label, as exact literals to match against AAT's (inconsistently-cased)
// pref/alt labels. Getty stores e.g. "Baroque" and "vedute" and "Delft School" — mixed case — so we try several.
function variants(term) {
  const fold = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const title = s => s.replace(/\b\w/g, c => c.toUpperCase());
  const strip = s => s.replace(/\s+(art|culture|style|styles|period|periods|ware|school|dynasty)$/i, "").trim();
  const seen = new Set(), out = [];
  const add = (v, base) => { v = (v || "").trim(); if (v && !seen.has(v)) { seen.add(v); out.push({ v, base }); } };
  for (const base of [false, true]) {
    const t = base ? strip(term) : term;
    if (base && t === term) continue;
    for (const f of [t, fold(t)]) { add(f, base); add(f.toLowerCase(), base); add(title(f), base); }
  }
  return out;
}
// EXACT: indexed literal match against pref/alt over all variants at once (VALUES = cheap, no relevance ranking,
// no ancestor closure). Returns each matching concept + which variant literal it matched.
function qLiteral(term) {
  const vals = variants(term).map(x => `"${esc(x.v)}"@en`).join(" ");
  return `${PFX}
SELECT ?s ?pref ?lab ?bId ?bLabel
  (GROUP_CONCAT(DISTINCT ?alt; separator=" | ") AS ?alts)
  (SAMPLE(?sn) AS ?note) WHERE {
  VALUES ?lab { ${vals} }
  { ?s skos:prefLabel ?lab } UNION { ?s skos:altLabel ?lab }
  ?s skos:inScheme aat: ; skos:prefLabel ?pref . FILTER(lang(?pref)="en")
  OPTIONAL { ?s gvp:broaderPreferred ?b . ?b skos:prefLabel ?bLabel . FILTER(lang(?bLabel)="en")
             BIND(REPLACE(STR(?b), ".*/", "") AS ?bId) }
  OPTIONAL { ?s skos:altLabel ?alt . FILTER(lang(?alt)="en") }
  OPTIONAL { ?s skos:scopeNote ?x . ?x rdf:value ?sn . FILTER(lang(?sn)="en") }
} GROUP BY ?s ?pref ?lab ?bId ?bLabel LIMIT 12`;
}
// FUZZY fallback: indexed full-text, relevance-ranked (only used when no exact literal hit).
function qCandidates(term) {
  const t = esc(term);
  return `${PFX}
SELECT ?s ?pref ?bId ?bLabel
  (GROUP_CONCAT(DISTINCT ?alt; separator=" | ") AS ?alts)
  (SAMPLE(?sn) AS ?note) WHERE {
  ?s luc:term "${t}" ; skos:inScheme aat: ; skos:prefLabel ?pref . FILTER(lang(?pref)="en")
  OPTIONAL { ?s gvp:broaderPreferred ?b . ?b skos:prefLabel ?bLabel . FILTER(lang(?bLabel)="en")
             BIND(REPLACE(STR(?b), ".*/", "") AS ?bId) }
  OPTIONAL { ?s skos:altLabel ?alt . FILTER(lang(?alt)="en") }
  OPTIONAL { ?s skos:scopeNote ?x . ?x rdf:value ?sn . FILTER(lang(?sn)="en") }
} GROUP BY ?s ?pref ?bId ?bLabel LIMIT 20`;
}
// PATH: ancestor labels for ONE bound concept (cheap). Used to verify the Styles&Periods facet + record provenance.
function qPath(id) {
  return `${PFX}
SELECT (GROUP_CONCAT(DISTINCT ?ancL; separator=" > ") AS ?anc)
       (GROUP_CONCAT(DISTINCT ?ancId; separator=" ") AS ?ancIds) WHERE {
  aat:${id} gvp:broaderPreferred+ ?ancC . ?ancC skos:prefLabel ?ancL . FILTER(lang(?ancL)="en")
  BIND(REPLACE(STR(?ancC), ".*/", "") AS ?ancId)
}`;
}

async function run(query) {
  for (let a = 0; a < MAX_RETRY; a++) {
    if (a) await sleep(1500 * a); // linear backoff on degraded endpoint
    try {
      const r = await fetch(EP + "?query=" + encodeURIComponent(query), { headers: { Accept: "application/sparql-results+json" } });
      const txt = await r.text();
      if (r.ok && txt.trim().startsWith("{")) return JSON.parse(txt).results?.bindings || [];
    } catch {}
  }
  return null; // endpoint failure (distinct from "no match")
}
const sleep = ms => new Promise(res => setTimeout(res, ms));
// pull a plausible date range out of an AAT scope note ("ca. 1700", "1609 until 1702", "1920s and 1930s")
function datesFromNote(note) {
  if (!note) return "";
  const yrs = [...note.matchAll(/\b(\d{3,4})s?\b/g)].map(m => +m[1]).filter(y => y > 300 && y < 2100);
  if (!yrs.length) return "";
  const lo = Math.min(...yrs), hi = Math.max(...yrs);
  return lo === hi ? String(lo) : `${lo}–${hi}`;
}
function toCand(b) {
  const note = (b.note?.value || "").replace(/\s+/g, " ");
  return {
    aatId: (b.s?.value || "").split("/").pop(),
    aatPref: b.pref?.value || "",
    parentId: b.bId?.value || "",
    parentPref: b.bLabel?.value || "",
    alts: (b.alts?.value || "").split(" | ").filter(Boolean),
    noteDate: datesFromNote(note),
    note: note.slice(0, 240),
  };
}
// AAT often qualifies a period label parenthetically ("Edo (Japanese period)", "New Kingdom (Egyptian)").
// Normalize BOTH sides (drop diacritics, parentheticals, punctuation) so we can match those; a looser form also
// drops generic descriptors (period/dynasty/style/culture/art). Used to rescue candidates the raw relevance
// ranker orders wrong (it puts "Hittite Empire" above "New Kingdom (Egyptian)" for "New Kingdom").
const norm = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const normLoose = s => norm(s).replace(/\b(art|culture|cultures|styles?|periods?|dynasty|dynasties|era|painting|school)\b/g, " ").replace(/\s+/g, " ").trim();
// tag each candidate with a match TIER against the term (does not pick — the caller facet-checks then picks).
const TIER_RANK = { exact: 5, alt: 4, norm: 3, base: 2, fuzzy: 1 };
function tierOf(term, c) {
  const lc = s => s.toLowerCase(), nt = norm(term), lt = normLoose(term);
  if (lc(c.aatPref) === lc(term)) return "exact";
  if (c.alts.some(a => lc(a) === lc(term))) return "alt";
  if (norm(c.aatPref) === nt || c.alts.some(a => norm(a) === nt)) return "norm";
  if (lt.length >= 3 && (normLoose(c.aatPref) === lt || c.alts.some(a => normLoose(a) === lt))) return "norm";
  return null; // matched only a stripped/folded literal variant, or only relevance-ranked (base/fuzzy)
}

const worklist = JSON.parse(readFileSync("data/incoming/aat-worklist.json", "utf8"));
const map = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
let done = Object.keys(map).length, errs = 0;
console.log(`AAT fetch: ${worklist.length} labels, ${done} already mapped, ${worklist.length - done} to go`);

const FACET_ANCESTORS = new Set([FACET]); // a concept is in-facet if 300264088 is among its ancestor ids
async function facetCheck(id) {
  const p = await run(qPath(id));
  if (p === null) return null; // endpoint hiccup
  const path = p[0]?.anc?.value || "";
  const ancIds = p[0]?.ancIds?.value ? p[0].ancIds.value.split(" ") : [];
  return { path, inFacet: ancIds.some(x => FACET_ANCESTORS.has(x)), facet: (path.split(" > ").pop() || "").trim() };
}
for (const { label, kinds, works } of worklist) {
  if (map[label] && map[label].match !== "endpoint-error") continue; // resume
  // 1) indexed exact-literal lookup (reliable); 2) fuzzy full-text only if that misses. Tier every candidate.
  let rows = await run(qLiteral(label));
  let cands = rows === null ? null : rows.map(toCand).filter(c => c.aatId).map(c => ({ ...c, tier: tierOf(label, c) || "base" }));
  if (rows !== null && (!cands.length || !cands.some(c => c.tier !== "base"))) {
    await sleep(PACE_MS);
    const cRows = await run(qCandidates(label));
    if (cRows === null) rows = null;
    else { const fz = cRows.map(toCand).filter(c => c.aatId).map(c => ({ ...c, tier: tierOf(label, c) || "fuzzy" }));
           cands = [...(cands || []), ...fz]; }
  }
  let res;
  if (rows === null) { res = { match: "endpoint-error" }; errs++; }
  else if (!cands || !cands.length) { res = { match: "none" }; }
  else {
    // facet-check the tiered candidates (+ the top relevance hit if all are pure fuzzy), then PREFER an in-facet
    // style/period/culture concept over an off-facet homograph (language/object-type). Bounded to a few queries.
    const toCheck = cands.filter(c => c.tier !== "fuzzy" && c.tier !== "base").slice(0, 6);
    if (!toCheck.length) toCheck.push(cands[0]);
    for (const c of toCheck) { await sleep(PACE_MS); Object.assign(c, (await facetCheck(c.aatId)) || { path: "", inFacet: false, facet: "" }); }
    // score: an in-facet LABEL match dominates; a pure-fuzzy in-facet hit gets NO boost (avoids in-facet junk
    // beating a genuine off-facet exact like "vedute"). Ties break by tier rank.
    const score = c => (c.inFacet && c.tier !== "fuzzy" ? 100 : 0) + (TIER_RANK[c.tier] || 0);
    const pick = toCheck.slice().sort((a, b) => score(b) - score(a))[0];
    res = { ...pick, match: pick.inFacet ? pick.tier : pick.tier + "-offfacet" };
  }
  map[label] = { label, kinds, works, ...res };
  writeFileSync(OUT, JSON.stringify(map, null, 2)); // checkpoint every label
  done++;
  const r = map[label];
  const tag = r.match === "endpoint-error" ? "ERR"
    : r.match === "none" ? "—none—"
    : `${r.match.padEnd(13)} [${r.aatId}] "${r.aatPref}"${r.noteDate ? ` (${r.noteDate})` : ""}${r.inFacet ? "" : " ⚠off-facet"}`;
  console.log(`${String(done).padStart(3)}/${worklist.length} ${label.slice(0, 26).padEnd(27)} ${tag}`);
  await sleep(PACE_MS);
}
const tally = {};
for (const v of Object.values(map)) tally[v.match] = (tally[v.match] || 0) + 1;
console.log(`\nDONE. tiers:`, tally, errs ? `(re-run to retry ${errs} endpoint errors)` : "");
console.log(`-> ${OUT}`);
