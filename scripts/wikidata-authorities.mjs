// Add WIKIDATA as a co-authority in data/authorities.json. Wikidata is community-editable and endonym-rich where
// Getty is one institution's frame — the concrete "delinking" (Mignolo): Getty stops being sole arbiter. For each
// label we search Wikidata, then PREFER an item whose P31 (instance of) is a culture/people/movement/period over a
// same-named LANGUAGE or disambiguation page (the Wikidata analog of the AAT facet-preference that fixed
// "Yoruba"->language). Where a good Wikidata concept exists for a currently none-adequate label, we promote its
// canonical to "wikidata" and record the item's native/endonym label. Never forces a bad hit: no confident P31
// match stays none-adequate. See docs/taxonomy.md.
//   node scripts/wikidata-authorities.mjs [--all]   # default: only none-adequate + endonym labels (the gaps)
import { readFileSync, writeFileSync } from "node:fs";

const API = "https://www.wikidata.org/w/api.php";
const UA = "GessoArtGame/1.0 (taxonomy authority crosswalk; contact via github.com/katswnt/gesso)";
const OUT = "data/authorities.json";
const PACE = 250;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// P31 values that mark a concept as a style/culture/period/people (GOOD), vs to avoid (language/disambig).
const GOOD_P31 = new Set([
  "Q968159",   // art movement
  "Q1792379",  // art genre / style
  "Q2198291",  // art style
  "Q11042",    // culture
  "Q465299",   // archaeological culture
  "Q41710",    // ethnic group
  "Q220414",   // ethnic/cultural group (people)
  "Q11514315", // historical period
  "Q186081",   // time interval / era
  "Q164950",   // dynasty
  "Q3024240",  // historical country/period
  "Q28171280", // ancient civilization
  "Q11772",    // (Ancient) civilization-ish
  "Q4204501",  // art period
  "Q30880248", // artistic style
]);
const BAD_P31 = new Set(["Q34770", "Q4167410", "Q315"]); // language, Wikimedia disambiguation, language(alt)

async function api(params) {
  const url = API + "?" + new URLSearchParams({ format: "json", origin: "*", ...params });
  for (let a = 0; a < 5; a++) {
    if (a) await sleep(1000 * a);
    try { const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
      if (r.ok) return await r.json(); } catch {}
  }
  return null;
}
async function search(label) {
  const j = await api({ action: "wbsearchentities", search: label, language: "en", uselang: "en", type: "item", limit: "8" });
  return j?.search?.map(s => ({ qid: s.id, label: s.label, desc: s.description || "" })) || (j === null ? null : []);
}
async function entities(qids) {
  if (!qids.length) return {};
  const j = await api({ action: "wbgetentities", ids: qids.join("|"), props: "claims|labels", languages: "en" });
  return j?.entities || {};
}
const p31Of = ent => (ent?.claims?.P31 || []).map(c => c.mainsnak?.datavalue?.value?.id).filter(Boolean);
const nativeLabelOf = ent => (ent?.claims?.P1705 || [])[0]?.mainsnak?.datavalue?.value?.text || ""; // native label (endonym)

async function resolve(label) {
  const cands = await search(label);
  if (cands === null) return { error: true };
  if (!cands.length) return { none: true };
  const ents = await entities(cands.map(c => c.qid));
  // score: GOOD P31 = strong; BAD P31 (language/disambig) = reject; description mentioning "language" penalized.
  let best = null, bestScore = -1;
  for (const c of cands) {
    const ent = ents[c.qid];
    const p31 = p31Of(ent);
    if (p31.some(x => BAD_P31.has(x))) continue;
    if (/\blanguage\b/i.test(c.desc) && !/\b(culture|people|art|style|period|dynasty)\b/i.test(c.desc)) continue;
    let score = 0;
    if (p31.some(x => GOOD_P31.has(x))) score += 10;
    if (/\b(culture|people|art|style|movement|period|dynasty|civilization|kingdom|empire|ethnic)\b/i.test(c.desc)) score += 3;
    if (c.label.toLowerCase() === label.toLowerCase()) score += 2;
    if (score > bestScore) { bestScore = score; best = { qid: c.qid, label: c.label, desc: c.desc, p31, endonym: nativeLabelOf(ent) }; }
  }
  if (!best || bestScore < 3) return { none: true };       // no confident culture/style/period item
  return { hit: best, confident: bestScore >= 10 };         // >=10 means a GOOD P31 (strong)
}

const auth = JSON.parse(readFileSync(OUT, "utf8"));
const all = process.argv.includes("--all");
const targets = Object.values(auth).filter(v => (all || v.canonical === "none-adequate" || v.canonical === "endonym") && v.authorities.wikidata == null);
console.log(`wikidata: ${targets.length} labels to resolve (${all ? "all missing" : "none-adequate + endonym gaps"})`);

let done = 0, filled = 0, promoted = 0, errs = 0;
for (const v of targets) {
  const r = await resolve(v.label);
  if (r.error) { errs++; }
  else if (r.hit) {
    v.authorities.wikidata = { qid: r.hit.qid, label: r.hit.label, desc: r.hit.desc, p31: r.hit.p31, ...(r.hit.endonym ? { endonym: r.hit.endonym } : {}), confident: !!r.confident };
    filled++;
    // promote a currently none-adequate label to canonical=wikidata when the match is confident (GOOD P31)
    if (v.canonical === "none-adequate" && r.confident) { v.canonical = "wikidata"; v.note = `Wikidata ${r.hit.qid} (${r.hit.desc})`; promoted++; }
  } else { v.authorities.wikidata = null; }
  done++;
  if (done % 10 === 0 || r.hit) console.log(`${String(done).padStart(3)}/${targets.length} ${v.label.slice(0, 24).padEnd(25)} ${r.hit ? `[${r.hit.qid}] ${r.hit.label}${r.confident ? " ✓" : " ?"}` : r.error ? "ERR" : "—none—"}`);
  writeFileSync(OUT, JSON.stringify(auth, null, 2)); // checkpoint
  await sleep(PACE);
}
console.log(`\nDONE. filled ${filled}, promoted to canonical=wikidata ${promoted}, none ${done - filled - errs}, errors ${errs}`);
