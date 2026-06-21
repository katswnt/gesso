// Single fail-closed gate for the recurring pool data-quality bugs. Run after ANY pool change:
//   node scripts/check-pool.mjs        (exits 1 if any HARD violation — wire into npm test / pre-commit / CI)
// LOCAL only (no network); the creator-death copyright check is scripts/audit-copyright.mjs (Wikidata).
import { readFileSync } from "node:fs";
import { readGlobal } from "./lib/static-module.mjs";
import { simplifyMedium, BAD_STYLE, isInCopyright } from "./lib/domain.mjs";
import { isPlaceCanonical, canonicalizePlace, continentOf } from "./lib/places.mjs";

const pool = readGlobal("data/pool.js","ARTEFACTUM_POOL");
const html = readFileSync("index.html","utf8");
const movKeys = new Set([...html.slice(html.indexOf("const MOVEMENTS={"),html.indexOf("const MOV_FAMILY=")).matchAll(/"([^"]+)":\{dates:/g)].map(m=>m[1]));
const COUNTRY_NAMES = new Set((readGlobal("data/countries.js","ARTEFACTUM_COUNTRIES")||[]).map(c=>c.n)); // a style that's a bare country name (and not a curated culture) is the place-as-style bug
let fame={}; try{ const f=readFileSync("data/fame.js","utf8"); fame=JSON.parse(f.slice(f.indexOf("{"),f.lastIndexOf("}")+1)); }catch{}
const fa = p => fame[p.id]!=null?fame[p.id]:(p.fame||0);

const BUCKETS = new Set(["Oil paint","Tempera","Fresco","Watercolor","Ink","Drawing","Woodblock print","Bronze","Copper","Marble","Stone","Wood","Ivory","Jade","Ceramic","Glass","Textile","Gold","Silver","Lacquer","Photograph","Mixed media","Leather","Wax","Beadwork"]);

const hard=[], warn=[];
const add=(arr,cat,p,note)=>arr.push(`[${cat}] ${(p.title||"?").slice(0,40)} — ${p.artist||"anon"}${note?" · "+note:""}`);

for(const p of pool){
  // MEDIUM: simplified value must be a real bucket (else it leaks as a junk guess-option)
  if(p.medium){ const ms=simplifyMedium(p.medium); if(ms && !BUCKETS.has(ms)){
    if(ms.split(" ").length>2 || /album|scroll|sheet|folio|volume|first of|\bpage\b|untitled|reformatted|fragment/i.test(ms)) add(hard,"medium-junk",p,`"${ms}"`);
    else add(warn,"medium-nonbucket",p,`"${ms}"`); /* single real material (Leather/Wax) — fine as an answer */ } }
  if(p.medium && /^[a-z]/.test(p.medium)) add(hard,"medium-lowercase",p,`"${p.medium}"`);
  // STYLE
  if(p.style && /^[a-z]/.test(p.style)) add(hard,"style-lowercase",p,`"${p.style}"`);
  if(p.style && BAD_STYLE.test(p.style.trim())) add(hard,"style-is-place",p,`"${p.style}"`);
  if(p.style && COUNTRY_NAMES.has(p.style) && !movKeys.has(p.style)) add(hard,"style-is-country",p,`"${p.style}"`);
  if(p.style && /[,;]/.test(p.style) && !movKeys.has(p.style)) add(hard,"style-comma",p,`"${p.style}"`); // descriptive/listy style string (keep only curated comma-cultures)
  if(p.style && p.styleKind && !movKeys.has(p.style)) add(warn,"style-no-metadata",p,`"${p.style}"`);
  // COVERAGE GATE: a famous work whose style has no MOVEMENTS entry would ship "c. unknown" + generic emblem to
  // production with no human review — HARD-fail so it can't happen. Lower-fame gaps stay a warning.
  if(p.style && !movKeys.has(p.style)){ const f=fa(p);
    if(f>=300) add(hard,"famous-style-no-movement",p,`"${p.style}" · fame ${Math.round(f)}`);
    else add(warn,"style-no-movement",p,`"${p.style}"`); }
  // TITLE
  if(p.title && /^[a-z]/.test(p.title)) add(hard,"title-lowercase",p,`"${p.title.slice(0,40)}"`);
  if(!p.style && fa(p)>=300) add(warn,"famous-no-movement",p,`fame ${Math.round(fa(p))}`);
  // ARTIST
  if(p.artist && /[぀-ヿ㐀-䶿一-鿿]/.test(p.artist)) add(hard,"artist-CJK",p,`"${p.artist}"`);
  if(p.artist && /^Q\d+$/.test(p.artist)) add(hard,"artist-qid",p,`"${p.artist}"`);
  // COPYRIGHT (local denylist; full check = audit-copyright.mjs)
  if(isInCopyright(p.artist)) add(hard,"in-copyright",p,`"${p.artist}"`);
  // SCHEMA integrity
  if(!p.img) add(hard,"no-image",p);
  if(p.place && (p.lat==null||p.lng==null)) add(warn,"place-no-coords",p,p.place);
  if(p.place && !isPlaceCanonical(p.place)) add(hard,"place-noncanon",p,`"${p.place}" → "${canonicalizePlace(p.place)}"`);
  if(p.place){ const c=continentOf(p.place); if(!c) add(warn,"place-unmapped-continent",p,`"${p.place}"`); else if(p.region!==c) add(hard,"region-mismatch",p,`${p.place} → region "${p.region}" should be "${c}"`); }
}

// ARTIST DEDUP gate: two distinct spellings that collapse to the same key (diacritic-strip + lowercase +
// whitespace-collapse) are almost always the same person under two names (the "Edouard/Édouard Manet"
// class). WARN so a new harvest's variant surfaces for an ARTIST_MERGE entry before it recurs.
{ const norm=s=>String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/\s+/g," ").trim();
  const byKey={}; for(const p of pool){ if(p.artist) (byKey[norm(p.artist)]=byKey[norm(p.artist)]||new Set()).add(p.artist); }
  for(const set of Object.values(byKey)) if(set.size>1) warn.push(`[artist-near-dup] ${[...set].join(" | ")}`); }

const group=arr=>{const g={};for(const v of arr){const k=v.match(/^\[([^\]]+)\]/)[1];(g[k]=g[k]||[]).push(v);}return g;};
const report=(label,arr)=>{ const g=group(arr); console.log(`\n${label} (${arr.length}):`);
  for(const [k,v] of Object.entries(g).sort((a,b)=>b[1].length-a[1].length)){ console.log(`  ${k}: ${v.length}`); v.slice(0,4).forEach(x=>console.log("     "+x.replace(/^\[[^\]]+\] /,""))); } };

const unmappedStyles=new Set(); for(const p of pool){ if(p.style && !movKeys.has(p.style)) unmappedStyles.add(p.style); }
console.log(`=== check-pool: ${pool.length} works ===`);
console.log(`styles with no MOVEMENTS entry: ${unmappedStyles.size} distinct`);
report("⚠ HARD violations (block ship)", hard);
report("ℹ warnings (review)", warn);
console.log(`\n${hard.length?"❌ FAIL — "+hard.length+" hard violations":"✅ PASS — no hard violations"}`);
process.exit(hard.length?1:0);
