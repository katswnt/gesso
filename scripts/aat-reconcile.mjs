// Reconcile the backstage Getty AAT map (data/incoming/aat-map.json) against our own MOVEMENTS + MOV_FAMILY.
// Report-only: produces the human REVIEW QUEUE and machine proposals; changes NOTHING. See docs/taxonomy.md.
//   node scripts/aat-reconcile.mjs            # human report
//   node scripts/aat-reconcile.mjs --json     # write data/incoming/aat-proposals.json
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const MAP = "data/incoming/aat-map.json";
if (!existsSync(MAP)) { console.error(`no ${MAP} — run scripts/aat-fetch.mjs first`); process.exit(1); }
const map = JSON.parse(readFileSync(MAP, "utf8"));
const rows = Object.values(map);

// pull MOVEMENTS + MOV_FAMILY straight out of index.html (single source of truth)
const src = readFileSync("index.html", "utf8");
const grab = re => { const m = src.match(re); return m ? m[0] : ""; };
let MOVEMENTS = {}, MOV_FAMILY = {};
try { MOVEMENTS = new Function(grab(/const MOVEMENTS=\{[\s\S]*?\n\};/) + "\nreturn MOVEMENTS;")(); } catch (e) { console.error("MOVEMENTS parse fail", e.message); }
try { MOV_FAMILY = new Function(grab(/const MOV_FAMILY=\{[\s\S]*?\n\};/) + "\nreturn MOV_FAMILY;")(); } catch (e) { console.error("MOV_FAMILY parse fail", e.message); }
const famOf = {}; for (const f in MOV_FAMILY) for (const m of MOV_FAMILY[f]) famOf[m] = f;

const isFuzzy = m => /fuzzy|offfacet|none/.test(m || "");
const inFamily = l => famOf[l] !== undefined;

// ---- 1. coverage by tier ----
const tier = {}; for (const r of rows) tier[r.match] = (tier[r.match] || 0) + 1;
const done = rows.length;
console.log(`AAT map: ${done} labels\n tiers: ${Object.entries(tier).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}:${v}`).join("  ")}\n`);

// ---- 2. REVIEW QUEUE: known movements (in MOV_FAMILY) that did NOT get a clean match ----
// these are the highest-value fixes: a curated movement we couldn't map is usually a spelling variant
// (e.g. our "Caravaggisti" -> AAT preferred "Caravaggism").
const knownUnmapped = rows.filter(r => inFamily(r.label) && isFuzzy(r.match))
  .sort((a,b)=>b.works-a.works);
console.log(`── A. CURATED movements that did NOT cleanly map (fix first: likely a spelling variant) — ${knownUnmapped.length} ──`);
for (const r of knownUnmapped) console.log(`  ${r.label}  (${famOf[r.label]} family, ${r.works}w)  → best guess: ${r.match} ${r.aatId?`[${r.aatId}] "${r.aatPref}"`:"none"}`);

// ---- 3. LABEL-RENAME proposals: our label is an AAT altLabel whose pref differs, AND our label reads worse ----
// we generally KEEP our display label; only flag when ours looks like an error, not a better plain term.
const looksTechnical = s => /\(|style\)|form of|technique|language|ware/i.test(s);
const renameCandidates = rows.filter(r => r.match === "exact" && r.aatPref && r.aatPref !== r.label && !looksTechnical(r.aatPref));
console.log(`\n── B. exact matches where AAT's spelling differs from ours (review, mostly keep ours) — ${renameCandidates.length} ──`);
for (const r of renameCandidates.slice(0, 30)) console.log(`  "${r.label}"  vs AAT "${r.aatPref}"  [${r.aatId}]`);
if (renameCandidates.length > 30) console.log(`  …and ${renameCandidates.length - 30} more`);

// ---- 4. off-facet "movements": we call it a movement/school, AAT files it as an object-type/genre/concept ----
const offFacet = rows.filter(r => /offfacet/.test(r.match) && r.aatId && r.works > 0)
  .sort((a,b)=>b.works-a.works);
console.log(`\n── C. our style label maps OUTSIDE AAT's Styles&Periods facet (maybe a genre/object-type, not a movement) — ${offFacet.length} ──`);
for (const r of offFacet.slice(0, 25)) console.log(`  ${r.label} (${r.works}w) → [${r.aatId}] "${r.aatPref}"  facet: ${r.facet||"?"}`);
if (offFacet.length > 25) console.log(`  …and ${offFacet.length - 25} more`);

// ---- 5. concept-identity duplicates: two of OUR labels share one AAT id = same concept ----
const byId = {}; for (const r of rows) if (r.aatId && !isFuzzy(r.match)) (byId[r.aatId] = byId[r.aatId] || []).push(r.label);
const dupes = Object.entries(byId).filter(([, ls]) => ls.length > 1);
console.log(`\n── D. NEAR-DUPLICATE labels (same AAT concept id) — ${dupes.length} ──`);
for (const [id, ls] of dupes) console.log(`  [${id}] "${map[ls[0]].aatPref}" ← ${ls.map(l=>`"${l}"`).join(", ")}`);

// ---- 6. date seeds: MOVEMENTS entry has no dates but AAT scope note gives one ----
const dateSeeds = rows.filter(r => !isFuzzy(r.match) && r.noteDate && MOVEMENTS[r.label] && !((MOVEMENTS[r.label].dates||"").trim()));
console.log(`\n── E. MOVEMENTS entries missing dates that AAT can seed — ${dateSeeds.length} ──`);
for (const r of dateSeeds.slice(0, 25)) console.log(`  ${r.label} → ${r.noteDate}  (from: "${(r.note||"").slice(0,70)}…")`);
if (dateSeeds.length > 25) console.log(`  …and ${dateSeeds.length - 25} more`);

// ---- 7. family validation: members of one MOV_FAMILY whose AAT parents scatter (possible mis-grouping) ----
console.log(`\n── F. MOV_FAMILY groups vs AAT parents (scatter = review the grouping) ──`);
for (const [fam, members] of Object.entries(MOV_FAMILY)) {
  const parents = {};
  for (const m of members) { const r = map[m]; if (r && !isFuzzy(r.match) && r.parentPref) parents[r.parentPref] = (parents[r.parentPref]||0)+1; }
  const ps = Object.entries(parents).sort((a,b)=>b[1]-a[1]);
  if (ps.length) console.log(`  ${fam}: ${ps.map(([p,n])=>`${p}×${n}`).join(" · ")}`);
}

if (process.argv.includes("--json")) {
  const proposals = { tier, knownUnmapped, renameCandidates, offFacet, dupes, dateSeeds };
  writeFileSync("data/incoming/aat-proposals.json", JSON.stringify(proposals, null, 2));
  console.log(`\n-> data/incoming/aat-proposals.json`);
}
