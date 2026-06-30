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
  // a migration-stripped head lost its leading (capitalized) word, so it now starts LOWERCASE with an
  // aux/interrogative/stub word ("does this matter", "is the man", "technique should I notice"). Requiring a
  // lowercase start makes this precise — it won't false-flag legit capitalized heads ("Why it matters", "Technique to notice").
  const STRIPPED=/^(is|are|was|were|does|do|did|has|have|can|could|should|would|will|what's|technique|material|context|significance|medium|scene|shows)\b/;
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
      if(STRIPPED.test(h)){counts.choppedHead++;issues.push("chopped-head:"+h);}
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
  globalThis.__pinCoverage={missing:pinBacklog.length,reviewed:reviewedNoPins.size};

  // CENTURY CONSISTENCY: notes often state "the Nth century" — a systematic off-by-one crept in during note
  // generation (a work dated 700 saying "8th century"). Flag CE works where a note's claimed century is off
  // by exactly ±1 from the true century (high-signal; ignores far-off contextual mentions of other eras).
  const trueCent=y=>Math.floor((Math.abs(y)-1)/100)+1;
  const reCent=/\b(\d{1,2})(?:st|nd|rd|th)[- ]century\b/gi;
  const centBacklog=[];
  for(const [id,c] of Object.entries(teach)){
    const p=pool.find(x=>x.id===id); if(!p||p.y==null||p.y<0||!Array.isArray(c?.notes))continue;
    const tc=trueCent(p.y); const txt=(c.why||"")+" "+c.notes.map(n=>n.head+" "+n.body).join(" ");
    const claimed=new Set(); let m; reCent.lastIndex=0; while((m=reCent.exec(txt))) claimed.add(+m[1]);
    if(!claimed.size||claimed.has(tc))continue;
    if([...claimed].some(x=>Math.abs(x-tc)===1)){ centBacklog.push({id,title:p.title,trueCentury:tc,claimed:[...claimed]});
      warn.push(`[century-off] ${(p.title||id).slice(0,34)} · y${p.y}=${tc}th, note says ${[...claimed].join("/")}th`); }
  }
  try{ writeFileSync("data/incoming/century-backlog.json",JSON.stringify(centBacklog,null,1)); }catch{}
  globalThis.__century={off:centBacklog.length}; }

// STYLE-FROM-NOTE: a work whose style is a junk placeholder / empty but whose teach note clearly NAMES a
// mapped movement is leaving MOVEMENT unscored for no reason (the answer is sitting right in the note). Flag
// these so scripts/recover-style-from-notes.mjs can assign them. High-precision match only: multi-word movement
// names (substring) + unambiguous single words (case-sensitive proper noun) — never generic words like "realism".
{ let teachSFN={}; try{ const t=readFileSync("data/teach-works.js","utf8"); teachSFN=JSON.parse(t.slice(t.indexOf("{",t.indexOf(".work")),t.lastIndexOf("}")+1)); }catch{}
  const teach=teachSFN;
  const AMBIG=new Set(["Realism","Roman","Classical","Modern","Modernism","Academic","Realist","Classicism","Pop art","Color Field","Gothic"]);
  const junkRe=/anonymous|decorative work|unknown|^various|^none$|^n\/a$/i;
  const esc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"); const keys=[...movKeys];
  const sfnBacklog=[];
  for(const p of pool){
    const junk=!p.style||junkRe.test(p.style)||(!movKeys.has(p.style)&&p.styleKind!=="culture");
    if(!junk) continue; const why=teach[p.id]?.why; if(!why) continue;
    const cand=keys.filter(k=>{ if(AMBIG.has(k))return false; const multi=/[\s-]/.test(k);
      return multi?new RegExp("\\b"+esc(k)+"\\b","i").test(why):new RegExp("\\b"+esc(k)+"\\b").test(why); })
      .sort((x,y)=>y.length-x.length);
    if(cand.length){ sfnBacklog.push({id:p.id,title:p.title,style:p.style||null,suggested:cand[0]});
      warn.push(`[style-from-note] ${(p.title||p.id).slice(0,34)} · [${p.style||"—"}] → ${cand[0]}`); }
  }
  try{ writeFileSync("data/incoming/style-from-note-backlog.json",JSON.stringify(sfnBacklog,null,1)); }catch{}
  globalThis.__styleFromNote={n:sfnBacklog.length}; }

// THIN WORKS: a work shown to a player must record at least one of {medium, movement} (≤1 missing scoreable
// value). Works missing BOTH would show two "not scored" rows. WARN + backlog for the whole pool; HARD-fail if
// one is actually pinned in TODAY or a FUTURE daily (those would reach players — the runtime filter + freeze
// exclude them, so a hit here means a stale lock that must be scrubbed).
{ const complete=p=>!!(p&&((p.medium&&String(p.medium).trim())||(p.style&&(movKeys.has(p.style)||p.styleKind==="culture"||p.styleKind==="movement"))));
  const thinBacklog=pool.filter(p=>!complete(p)).map(p=>({id:p.id,title:p.title,medium:p.medium||null,style:p.style||null}));
  try{ writeFileSync("data/incoming/thin-backlog.json",JSON.stringify(thinBacklog,null,1)); }catch{}
  globalThis.__thin={n:thinBacklog.length};
  let daily={}; try{ const t=readFileSync("data/daily-order.js","utf8"); daily=JSON.parse(t.slice(t.indexOf("{"),t.lastIndexOf("}")+1)); }catch{}
  const byId=Object.fromEntries(pool.map(p=>[p.id,p]));
  const today=new Date(Date.now()).toISOString().slice(0,10);
  const thinSet=new Set(thinBacklog.map(t=>t.id));
  for(const [date,day] of Object.entries(daily.byDate||{})){ if(date<today)continue;
    for(const k of ["easy","medium","hard","impossible"]) for(const id of (day[k]||[]))
      if(thinSet.has(id)) hard.push(`[thin-in-daily] ${date}/${k}: ${(byId[id]?.title||id).slice(0,40)} (no medium+no movement)`); }
}

// MEDIUM-FROM-NOTE: the why sentence describes the artwork's own technique; when it DECLARES a medium that
// conflicts with the medium field (e.g. note "egg tempera"/"engraving"/"wall painting" but field says Oil
// paint/Woodblock/Stone), trust the note. High-precision technique phrases only (never "Bronze Age" / depicted
// content). WARN + backlog so the medium-from-note fix can re-run after each harvest.
{ let teachM={}; try{ const t=readFileSync("data/teach-works.js","utf8"); teachM=JSON.parse(t.slice(t.indexOf("{",t.indexOf(".work")),t.lastIndexOf("}")+1)); }catch{}
  const RULES=[[/egg tempera|in tempera\b|tempera (?:on|panel|painting|portrait)/i,"Tempera"],[/wall painting|painted plaster|plaster fragment|\bfresco\b/i,"Fresco"],[/\bengraving\b/i,"Engraving"],[/woodblock print|woodcut\b/i,"Woodblock print"],[/\bin ink\b|ink drawing|drawing in ink|ink and (?:colou?r|wash)/i,"Ink"],[/terracotta|terra-cotta/i,"Ceramic"],[/\bwooden\b (?:sculpture|figure|statue|object|mask|box|panel|relief|carving)|carved (?:from )?wood\b/i,"Wood"]];
  const whyBucket=why=>{ for(const [re,b] of RULES) if(re.test(why)) return b; return null; };
  const mcBacklog=[];
  for(const p of pool){ const why=teachM[p.id]?.why; if(!why||!p.medium)continue;
    const wb=whyBucket(why); if(!wb)continue; const cur=simplifyMedium(p.medium)||p.medium;
    if(wb!==cur){ mcBacklog.push({id:p.id,title:p.title,medium:p.medium,suggested:wb}); warn.push(`[medium-from-note] ${(p.title||p.id).slice(0,32)} · [${cur}] → ${wb}`); } }
  try{ writeFileSync("data/incoming/medium-conflict-backlog.json",JSON.stringify(mcBacklog,null,1)); }catch{}
  globalThis.__medConflict={n:mcBacklog.length}; }

const group=arr=>{const g={};for(const v of arr){const k=v.match(/^\[([^\]]+)\]/)[1];(g[k]=g[k]||[]).push(v);}return g;};
const report=(label,arr)=>{ const g=group(arr); console.log(`\n${label} (${arr.length}):`);
  for(const [k,v] of Object.entries(g).sort((a,b)=>b[1].length-a[1].length)){ console.log(`  ${k}: ${v.length}`); v.slice(0,4).forEach(x=>console.log("     "+x.replace(/^\[[^\]]+\] /,""))); } };

const unmappedStyles=new Set(); for(const p of pool){ if(p.style && !movKeys.has(p.style)) unmappedStyles.add(p.style); }
console.log(`=== check-pool: ${pool.length} works ===`);
console.log(`styles with no MOVEMENTS entry: ${unmappedStyles.size} distinct`);
{ const ci=globalThis.__copyIntegrity; if(ci) console.log(`copy-integrity backlog: ${ci.works} works · ${JSON.stringify(ci.counts)} → data/incoming/copy-integrity-backlog.json`); }
{ const pc=globalThis.__pinCoverage; if(pc) console.log(`pin-coverage: ${pc.missing} figurative works with 0 pins (excl. abstract + ${pc.reviewed} reviewed) → data/incoming/pin-backlog.json`); }
{ const cn=globalThis.__century; if(cn) console.log(`century-off (note ±1 vs date): ${cn.off} works → data/incoming/century-backlog.json`); }
{ const sf=globalThis.__styleFromNote; if(sf) console.log(`style-from-note: ${sf.n} junk-style works whose note names a mapped movement → data/incoming/style-from-note-backlog.json`); }
{ const th=globalThis.__thin; if(th) console.log(`thin works (no medium AND no movement — excluded from play): ${th.n} → data/incoming/thin-backlog.json`); }
{ const mc=globalThis.__medConflict; if(mc) console.log(`medium-from-note conflicts (note declares a different technique): ${mc.n} → data/incoming/medium-conflict-backlog.json`); }
report("⚠ HARD violations (block ship)", hard);
report("ℹ warnings (review)", warn);
console.log(`\n${hard.length?"❌ FAIL — "+hard.length+" hard violations":"✅ PASS — no hard violations"}`);
process.exit(hard.length?1:0);
