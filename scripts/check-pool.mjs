// Single fail-closed gate for the recurring pool data-quality bugs. Run after ANY pool change:
//   node scripts/check-pool.mjs        (exits 1 if any HARD violation — wire into npm test / pre-commit / CI)
// LOCAL only (no network); the creator-death copyright check is scripts/audit-copyright.mjs (Wikidata).
import { readFileSync, writeFileSync } from "node:fs";
import { readGlobal } from "./lib/static-module.mjs";
import { simplifyMedium, BAD_STYLE, isInCopyright } from "./lib/domain.mjs";
import { isPlaceCanonical, canonicalizePlace, continentOf } from "./lib/places.mjs";

const pool = readGlobal("data/pool.js","ARTEFACTUM_POOL");
const html = readFileSync("index.html","utf8");
const movKeys = new Set([...html.slice(html.indexOf("const MOVEMENTS={"),html.indexOf("const MOV_FAMILY=")).matchAll(/"([^"]+)":\{dates:/g)].map(m=>m[1]));
const COUNTRY_NAMES = new Set((readGlobal("data/countries.js","ARTEFACTUM_COUNTRIES")||[]).map(c=>c.n)); // a style that's a bare country name (and not a curated culture) is the place-as-style bug
let fame={}; try{ const f=readFileSync("data/fame.js","utf8"); fame=JSON.parse(f.slice(f.indexOf("{"),f.lastIndexOf("}")+1)); }catch{}
const fa = p => fame[p.id]!=null?fame[p.id]:(p.fame||0);

const BUCKETS = new Set(["Oil paint","Tempera","Fresco","Watercolor","Ink","Drawing","Woodblock print","Bronze","Copper","Marble","Stone","Wood","Ivory","Jade","Ceramic","Glass","Textile","Gold","Silver","Lacquer","Photograph","Mixed media","Leather","Wax","Beadwork","Engraving","Lithograph"]);

const PD_OK = new Set(["wd:Q1960268"]); // Steichen, The Pond—Moonlight (1904, US-PD by publication)
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
  // a CULTURE tag must never be a bare modern country (use the demonym/tradition: Khmer not Cambodia, Persian
  // not Iran). This fires even if the country was added to MOVEMENTS — that loophole let ~45 slip before.
  if(p.style && p.styleKind==="culture" && COUNTRY_NAMES.has(p.style)) add(hard,"culture-is-country",p,`"${p.style}" → use the demonym/tradition`);
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
  // PD_OK: works by a denylisted artist that are themselves verified public-domain by US publication date
  // (e.g. Steichen's 1904 "The Pond—Moonlight", first published 1906 → pre-1929 PD). Per-id, not per-artist.
  if(isInCopyright(p.artist) && !PD_OK.has(p.id)) add(hard,"in-copyright",p,`"${p.artist}"`);
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

// COPY-INTEGRITY gate: the v1->v2 note migration left broken reveal copy in works not yet curated —
// note bodies cut off mid-thought ("..."), heads that are stripped Q&A fragments ("does this painting
// matter", "technique should I notice"), dangling-article heads ("Honthorst Built The"), and template
// stubs ("Material and technique"). Also duplicate pin coordinates (fallback/never-placed pins).
// WARN for now (the backlog is large; a pool-wide curate pass will clear it) + write the full worklist
// to data/incoming/copy-integrity-backlog.json so the fix pass has an exact target list.
{ let teach={}, hot={};
  try{ const t=readFileSync("data/teach-works.js","utf8"); teach=JSON.parse(t.slice(t.indexOf("{",t.indexOf(".work")),t.lastIndexOf("}")+1)); }catch{}
  try{ const h=readFileSync("data/hotspots.js","utf8"); hot=JSON.parse(h.slice(h.indexOf("{"),h.lastIndexOf("}")+1)); }catch{}
  const STRIPPED=/^(is|are|was|were|does|do|did|has|have|can|could|should|would|will|what'?s|technique|material|context|scene|shows)\b/i;
  const STUB=/^(material and technique|context and meaning|significance|medium and technique|the story|who made it|why it matters)$/i;
  const DANGLE=/\b(the|a|an|of|by|and|in|with|to|for)$/i;
  const counts={truncBody:0,choppedHead:0,dangleHead:0,stubHead:0,dupPins:0};
  const backlog=[];
  for(const [id,c] of Object.entries(teach)){
    if(!c||!Array.isArray(c.notes))continue;
    const issues=[]; const coords=new Set(); let dup=false;
    for(const n of c.notes){
      const h=(n.head||"").trim(), b=(n.body||"").trim(), ws=h.split(/\s+/).filter(Boolean);
      if(/(\.\.\.|…)$/.test(b)){counts.truncBody++;issues.push("trunc-body");}
      if(STRIPPED.test(h)&&!h.endsWith("?")&&ws.length<=6&&!/^(the|a|an)\b/i.test(h)){counts.choppedHead++;issues.push("chopped-head:"+h);}
      else if(ws.length>=2&&DANGLE.test(h)){counts.dangleHead++;issues.push("dangle-head:"+h);}
      else if(STUB.test(h)){counts.stubHead++;issues.push("stub-head:"+h);}
      if(typeof n.x==="number"){const k=Math.round(n.x)+","+Math.round(n.y);if(coords.has(k))dup=true;coords.add(k);}
    }
    if(dup){counts.dupPins++;issues.push("dup-pins");}
    if(issues.length){ const p=pool.find(x=>x.id===id);
      backlog.push({id,title:p?.title||"?",issues:[...new Set(issues.map(s=>s.split(":")[0]))]});
      warn.push(`[copy-integrity] ${(p?.title||id).slice(0,38)} · ${[...new Set(issues.map(s=>s.split(":")[0]))].join(",")}`); }
  }
  try{ writeFileSync("data/incoming/copy-integrity-backlog.json",JSON.stringify(backlog,null,1)); }catch{}
  globalThis.__copyIntegrity={counts,works:backlog.length};

  // PIN COVERAGE: figurative works should carry >=1 look-closer pin. But pins are meaningless on genuinely
  // non-objective work (Suprematism, color fields, pure pattern) and bare monochrome/text objects — those
  // legitimately have ZERO. So a 0-pin work is only a MISS if it's NOT abstract and NOT already reviewed.
  // Abstract styles auto-exempt; the vision re-pin pass writes ids it judged unpinnable to no-pins-reviewed.json.
  const ABSTRACT=new Set(["Suprematism","De Stijl","Neoplasticism","Constructivism","Abstract art","Abstract Expressionism","Color Field","Color field painting","Minimalism","Concrete art","Op Art","Orphism","Hard-edge painting"]);
  let reviewedNoPins=new Set(); try{ reviewedNoPins=new Set(JSON.parse(readFileSync("data/incoming/no-pins-reviewed.json","utf8"))); }catch{}
  const pinBacklog=[];
  for(const [id,c] of Object.entries(teach)){
    if(!c||!Array.isArray(c.notes)||!c.notes.length)continue;
    const pinned=c.notes.some(n=>typeof n.x==="number")||(Array.isArray(hot[id])&&hot[id].length);
    if(pinned)continue;
    const p=pool.find(x=>x.id===id); if(!p)continue;
    if(ABSTRACT.has(p.style)||reviewedNoPins.has(id))continue; // legitimately pin-less
    pinBacklog.push({id,title:p.title||"?",style:p.style||null});
  }
  try{ writeFileSync("data/incoming/pin-backlog.json",JSON.stringify(pinBacklog,null,1)); }catch{}
  globalThis.__pinCoverage={missing:pinBacklog.length,reviewed:reviewedNoPins.size}; }

const group=arr=>{const g={};for(const v of arr){const k=v.match(/^\[([^\]]+)\]/)[1];(g[k]=g[k]||[]).push(v);}return g;};
const report=(label,arr)=>{ const g=group(arr); console.log(`\n${label} (${arr.length}):`);
  for(const [k,v] of Object.entries(g).sort((a,b)=>b[1].length-a[1].length)){ console.log(`  ${k}: ${v.length}`); v.slice(0,4).forEach(x=>console.log("     "+x.replace(/^\[[^\]]+\] /,""))); } };

const unmappedStyles=new Set(); for(const p of pool){ if(p.style && !movKeys.has(p.style)) unmappedStyles.add(p.style); }
console.log(`=== check-pool: ${pool.length} works ===`);
console.log(`styles with no MOVEMENTS entry: ${unmappedStyles.size} distinct`);
{ const ci=globalThis.__copyIntegrity; if(ci) console.log(`copy-integrity backlog: ${ci.works} works · ${JSON.stringify(ci.counts)} → data/incoming/copy-integrity-backlog.json`); }
{ const pc=globalThis.__pinCoverage; if(pc) console.log(`pin-coverage: ${pc.missing} figurative works with 0 pins (excl. abstract + ${pc.reviewed} reviewed) → data/incoming/pin-backlog.json`); }
report("⚠ HARD violations (block ship)", hard);
report("ℹ warnings (review)", warn);
console.log(`\n${hard.length?"❌ FAIL — "+hard.length+" hard violations":"✅ PASS — no hard violations"}`);
process.exit(hard.length?1:0);
