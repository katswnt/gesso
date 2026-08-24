// Single fail-closed gate for the recurring pool data-quality bugs. Run after ANY pool change:
//   node scripts/check-pool.mjs        (exits 1 if any HARD violation — wire into npm test / pre-commit / CI)
// LOCAL only (no network); the creator-death copyright check is scripts/audit-copyright.mjs (Wikidata).
import { readFileSync, writeFileSync } from "node:fs";
import { readGlobal } from "./lib/static-module.mjs";
import { simplifyMedium, BAD_STYLE, isInCopyright, styleSignature } from "./lib/domain.mjs";
import { isPlaceCanonical, canonicalizePlace, continentOf } from "./lib/places.mjs";
import { scanLanguage } from "./check-language.mjs";

const CONTINENTS = new Set(["Europe","Asia","Africa","North America","South America","Oceania"]);
const pool = readGlobal("data/pool.js","ARTEFACTUM_POOL");
const html = readFileSync("index.html","utf8");
const movKeys = new Set([...html.slice(html.indexOf("const MOVEMENTS={"),html.indexOf("const MOV_FAMILY=")).matchAll(/"([^"]+)":\{dates:/g)].map(m=>m[1]));
const COUNTRY_NAMES = new Set((readGlobal("data/countries.js","ARTEFACTUM_COUNTRIES")||[]).map(c=>c.n)); // a style that's a bare country name (and not a curated culture) is the place-as-style bug
let fame={}; try{ const f=readFileSync("data/fame.js","utf8"); fame=JSON.parse(f.slice(f.indexOf("{"),f.lastIndexOf("}")+1)); }catch{}
const fa = p => fame[p.id]!=null?fame[p.id]:(p.fame||0);

const BUCKETS = new Set(["Oil paint","Tempera","Fresco","Watercolor","Ink","Drawing","Woodblock print","Bronze","Steel","Iron","Metal","Copper","Marble","Stone","Wood","Ivory","Jade","Ceramic","Glass","Textile","Gold","Silver","Lacquer","Photograph","Mixed media","Leather","Wax","Beadwork","Engraving","Lithograph"]);

const PD_OK = new Set(["wd:Q1960268"]); // Steichen, The Pond—Moonlight (1904, US-PD by publication)
// STRUCTURAL copyright guard: isInCopyright (below) is a hand-maintained artist DENYLIST — incomplete by design,
// so any in-copyright artist not on it slips through (that's how living artists + URAA-restored works entered).
// A visible, NAMED-artist work published after the rolling 95-year US-PD cutoff is a copyright risk (URAA restored
// most foreign post-1928 works; a museum "open access" license covers the PHOTO, not the underlying artwork).
// Fail closed. Ids in data/uraa-pending.json are grandfathered pending adjudication (docs/uraa-review.md) — prune
// as works are removed/verified. To keep a genuinely-PD post-cutoff work, add its id to PD_OK with a basis comment.
const PD_CUTOFF = new Date().getUTCFullYear() - 96; // 2026 -> 1930: published this year or earlier = US-PD (95yr term)
let PD_PENDING = new Set(); try{ PD_PENDING = new Set(JSON.parse(readFileSync("data/uraa-pending.json","utf8"))); }catch{}
const isNamedArtist = a => a && !/(century|workshop|school|dynasty|period|culture|anonymous|unknown|master of|circle of|follower|after |artist$|people$|maker$|tribe)/i.test(a);
if(PD_PENDING.size) console.error(`  ⓘ post-pd-cutoff guard active; ${PD_PENDING.size} works grandfathered pending URAA adjudication (docs/uraa-review.md)`);
const hard=[], warn=[];
const add=(arr,cat,p,note)=>arr.push(`[${cat}] ${(p.title||"?").slice(0,40)} — ${p.artist||"anon"}${note?" · "+note:""}`);

for(const p of pool){
  // INVISIBLE-WORK guard: a work with an image but no cats is silently dropped by the game's runtime
  // POOL filter (x.img && x.cats) — it never appears anywhere. That's a bug UNLESS the work is
  // intentionally excluded: in-copyright (isInCopyright), or vision-judged-unplayable (play===false, the
  // canonical "never gamified" marker that playable() and the daily-schedule gate already honor — e.g. a
  // church building or featureless work whose all-language fame overshoots but which is not a real artwork).
  // A famous public-domain work going invisible for NO such reason is a hard fail (the class of bug that
  // hid 417 works incl. Vitruvian Man / The Scream).
  if(p.img && p.play!==false && (!Array.isArray(p.cats) || !p.cats.length)){
    if(!isInCopyright(p.artist)){
      if(fa(p) >= 300) add(hard,"invisible-famous",p,"no cats — famous public-domain work dropped from the game");
      else add(warn,"invisible-work",p,"no cats — dropped from the game (fix cats or confirm intentional)");
    }
  }
  // FRAGILE-IMAGE guard: a hardcoded Commons thumbnail URL (upload.wikimedia.org/.../thumb/<file>/<size>px-…) breaks
  // the instant Commons renames/deletes the file — it hid Battersea Shield on a live daily. The Special:FilePath
  // redirect follows renames. scripts/normalize-images.mjs converts them; fail closed here so the class can't return.
  if(p.img && /upload\.wikimedia\.org\/wikipedia\/commons\/thumb/.test(p.img)) add(hard,"fragile-thumb-url",p,"hardcoded Commons thumbnail — run scripts/normalize-images.mjs (→ Special:FilePath)");
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
  // a culture/movement is a NAME, never a descriptive sentence — "Roman sculpture with Baroque restoration",
  // "…funerary art", etc. read as junk quiz answers. No MOVEMENTS exemption: these must be renamed, not whitelisted.
  if(p.style && (/ with | restoration\b/i.test(p.style) || p.style.split(/\s+/).length>4)) add(hard,"style-verbose",p,`"${p.style}" — use a concise culture/movement name`);
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
  if(p.artist && /genid|^https?:\/\/|\.well-known/i.test(p.artist)) add(hard,"artist-genid-url",p,`"${p.artist}"`); // blank-node/URL leaked as a creator name
  // nationality glued to a PERSONAL name (harvest artifact), e.g. "American Daniel Hudson Burnham". Skip anonymous
  // descriptors where the nationality IS the attribution ("Dutch 17th Century", "Florentine sculpture workshop").
  if(p.artist && /^(American|French|Italian|Dutch|German|Spanish|British|English|Flemish|Netherlandish|Belgian|Austrian|Russian|Japanese|Chinese|Korean|Indian|Mexican|Greek|Roman|Egyptian|Persian|Ottoman|Swiss|Swedish|Norwegian|Danish|Polish|Scottish|Irish|Canadian|Venetian|Florentine)\s+[A-Z][a-zA-Z.'-]+\s+[A-Z]/.test(p.artist) && !/(century|workshop|school|dynasty|period|culture|anonymous|unknown|master of|circle of|follower|after )/i.test(p.artist)) add(hard,"artist-nationality-prefix",p,`"${p.artist}"`);
  // FAIR SCORING: never score a category whose answer field is blank — a player can't be marked right on a
  // missing answer. (A prior process cleared style/artist without updating cats; this keeps them in sync.)
  if(Array.isArray(p.cats) && p.cats.includes("artist") && (!p.artist || !String(p.artist).trim())) add(hard,"scores-blank-artist",p);
  if(Array.isArray(p.cats) && p.cats.includes("style") && (!p.style || !String(p.style).trim())) add(hard,"scores-blank-style",p);
  // COPYRIGHT (local denylist; full check = audit-copyright.mjs)
  // PD_OK: works by a denylisted artist that are themselves verified public-domain by US publication date
  // (e.g. Steichen's 1904 "The Pond—Moonlight", first published 1906 → pre-1929 PD). Per-id, not per-artist.
  if(isInCopyright(p.artist) && !PD_OK.has(p.id) && Array.isArray(p.cats) && p.cats.length) add(hard,"in-copyright",p,`"${p.artist}"`); // only if VISIBLE — a hidden (no-cats) in-copyright work is correctly excluded
  // STRUCTURAL guard: a FOREIGN named-artist work published after the PD cutoff is a URAA copyright risk
  // (museum open-access covers the image, not the artwork). US works have no URAA; their PD turns on US
  // formalities that the source museums/LOC actually verify (FSA/gov photography = PD), so US place is exempt.
  if(p.y!=null && p.y>PD_CUTOFF && isNamedArtist(p.artist) && !/United States|\bUSA\b/i.test(p.place||"") && !PD_OK.has(p.id) && !PD_PENDING.has(p.id) && Array.isArray(p.cats) && p.cats.length)
    add(hard,"post-pd-cutoff",p,`${p.y} > ${PD_CUTOFF} foreign, named artist — likely URAA-restored (museum CC0 covers image, not artwork)`);
  // SCHEMA integrity
  if(!p.img) add(hard,"no-image",p);
  if(p.place && (p.lat==null||p.lng==null)) add(warn,"place-no-coords",p,p.place);
  if(p.place && !isPlaceCanonical(p.place)) add(hard,"place-noncanon",p,`"${p.place}" → "${canonicalizePlace(p.place)}"`);
  if(p.place){ const c=continentOf(p.place); if(!c) add(warn,"place-unmapped-continent",p,`"${p.place}"`); else if(p.region!==c) add(hard,"region-mismatch",p,`${p.place} → region "${p.region}" should be "${c}"`); }
  // region must be a real continent — never a sub-region bucket like "Middle East" (folds into Asia)
  if(p.region && !CONTINENTS.has(p.region)) add(hard,"region-not-continent",p,`"${p.region}" is not one of ${[...CONTINENTS].join(", ")}`);
}

// ARTIST DEDUP gate: two distinct spellings that collapse to the same key (diacritic-strip + lowercase +
// whitespace-collapse) are almost always the same person under two names (the "Edouard/Édouard Manet"
// class). WARN so a new harvest's variant surfaces for an ARTIST_MERGE entry before it recurs.
{ const norm=s=>String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/\s+/g," ").trim();
  const byKey={}; for(const p of pool){ if(p.artist) (byKey[norm(p.artist)]=byKey[norm(p.artist)]||new Set()).add(p.artist); }
  for(const set of Object.values(byKey)) if(set.size>1) warn.push(`[artist-near-dup] ${[...set].join(" | ")}`); }

// DUPLICATE-QID gate: the SAME artwork imported twice under different id prefixes (wd:Qx vs wikidata:Qx vs
// the full entity URL) is one work in two pool slots — it can get scheduled on two days and splits its
// notes/pins. HARD-fail so it can't recur; run scripts/dedup-qid.mjs to collapse to the ledger-referenced id.
{ const byQid={}; for(const p of pool){ const m=String(p.id).match(/Q\d+/); if(m) (byQid[m[0]]=byQid[m[0]]||[]).push(p.id); }
  for(const [q,ids] of Object.entries(byQid)) if(ids.length>1) hard.push(`[duplicate-qid] ${q} → ${ids.length} entries: ${ids.join(" , ")} — run scripts/dedup-qid.mjs`); }
  // NOTE: transliteration (Vasily/Wassily) + abbreviation (Hokusai/Katsushika Hokusai) variants aren't caught
  // here — a generic detector produced too many false positives (Manet/Monet, Zhang Lu/Zhang Hong, Rembrandt/
  // Rembrandt Peale share signatures but are different people). Fix those by hand when a screenshot surfaces one.

// STYLE-VOCAB gate: a label written two ways forks the vocabulary and poisons multiple-choice distractors.
// All three classes are HARD (the pool was consolidated 2026-08-15; a new harvest that reintroduces one must
// map it before it can ship). Each group is reported at its MOST-SPECIFIC class:
//   style-casing-dup     — differ ONLY by case ("Academic realism" ≡ "Academic Realism"); canonicalizeStyle folds these
//   style-wordorder-dup  — same words, different order ("Late Period Egyptian" ≈ "Egyptian Late Period")
//   style-descriptor-dup — differ by a generic descriptor ("Ming dynasty" ≈ "Ming dynasty painting")
// To resolve: add the loser→winner pair to scripts/consolidate-styles.mjs (winner MUST be a MOVEMENTS key) and re-run it.
{ const fold=s=>String(s).normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase();
  const GENERIC=new Set(["art","painting","paintings","pottery","sculpture","ware","period","style","school","culture","figure","vessel","vase","ceramic","ceramics","design"]);
  const PART=new Set(["of","the","and","in","on","de","del","la","le","van","der","du","des","a","an"]);
  const dsig=l=>l.toLowerCase().split(/[\s/,-]+/).filter(t=>t&&!GENERIC.has(t)&&!PART.has(t)).slice().sort().join(" ");
  const styles=[...new Set(pool.map(p=>p.style).filter(Boolean))];
  const byDsig={}; for(const s of styles){ const k=dsig(s); (byDsig[k]=byDsig[k]||[]).push(s); }
  for(const g of Object.values(byDsig)){ if(g.length<2) continue;
    const cls = new Set(g.map(fold)).size===1 ? "style-casing-dup"
              : new Set(g.map(styleSignature)).size===1 ? "style-wordorder-dup"
              : "style-descriptor-dup";
    hard.push(`[${cls}] ${g.map(l=>`"${l}"`).join(" ≈ ")} — one vocabulary item written ${g.length} ways; consolidate to one`); } }

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
    for(const k of ["easy","medium","hard","impossible"]) for(const id of (day[k]||[])){
      if(thinSet.has(id)) hard.push(`[thin-in-daily] ${date}/${k}: ${(byId[id]?.title||id).slice(0,40)} (no medium+no movement)`);
      if(byId[id]?.sensitive==='remains') hard.push(`[remains-in-daily] ${date}/${k}: ${(byId[id]?.title||id).slice(0,40)} — human/ancestral remains must not be gamified`);
      if(byId[id]?.play===false && date>today) hard.push(`[unplayable-in-daily] ${date}/${k}: ${(byId[id]?.title||id).slice(0,40)} — vision-judged featureless, must not be scheduled`); } }
  // LEDGER IMMUTABILITY: a served day (<= today) in daily-order MUST match the append-only ledger verbatim.
  // If it differs, a refreeze silently altered a day a player already saw — fail loudly.
  { let ledger={}; try{ const t=readFileSync("data/daily-history.js","utf8"); ledger=(JSON.parse(t.slice(t.indexOf("{"),t.lastIndexOf("}")+1)).byDate)||{}; }catch{}
    for(const [date,day] of Object.entries(daily.byDate||{})){ if(date>today) continue; const led=ledger[date]; if(!led){ (date<today?hard:warn).push(`[ledger-missing] ${date} served but absent from daily-history.js (run freeze to record)`); continue; }
      for(const k of ["easy","medium","hard","impossible"]) if((day[k]||[]).join(",")!==(led[k]||[]).join(",")) hard.push(`[ledger-drift] ${date}/${k}: daily-order differs from ledger — a served day was altered`); } }
  // VISION-AUDIT COVERAGE: how many works scheduled in the next VIS_WIN days have NOT had a genuine image-grounded
  // notes/pins pass (data/vision-audit.json). WARN only — this is the rollout gauge that keeps the audit ahead of
  // what players see. When it reaches 0, upcoming dailies are fully vision-verified.
  { const VIS_WIN=14; let audited=new Set(); try{ audited=new Set((JSON.parse(readFileSync("data/vision-audit.json","utf8")).ids)||[]); }catch{}
    const horizon=new Date(Date.now()+VIS_WIN*86400000).toISOString().slice(0,10);
    const gap=new Set();
    for(const [date,day] of Object.entries(daily.byDate||{})){ if(date<=today||date>horizon) continue;
      for(const k of ["easy","medium","hard","impossible"]) for(const id of (day[k]||[])) if(!audited.has(id)) gap.add(id); }
    if(gap.size) globalThis.__visgap={n:gap.size,win:VIS_WIN,sample:[...gap].slice(0,6).map(id=>(byId[id]?.title||id).slice(0,34))}; }
  // MISSING-CATEGORY COVERAGE (schedule-first): upcoming daily works with NO movement or NO medium reach players
  // with a dead scorecard row. Surface them ahead of time so a curate/vision pass can fill the blank before go-live.
  { const WIN=14; const horizon=new Date(Date.now()+WIN*86400000).toISOString().slice(0,10);
    const noMov=new Set(), noMed=new Set();
    for(const [date,day] of Object.entries(daily.byDate||{})){ if(date<=today||date>horizon) continue;
      for(const k of ["easy","medium","hard","impossible"]) for(const id of (day[k]||[])){ const p=byId[id]; if(!p)continue;
        if(!p.style||!String(p.style).trim()) noMov.add(id); if(!p.medium||!String(p.medium).trim()) noMed.add(id); } }
    if(noMov.size||noMed.size) globalThis.__catgap={win:WIN,mov:noMov.size,med:noMed.size,
      sample:[...noMov].slice(0,5).map(id=>(byId[id]?.title||id).slice(0,30))}; }
  // FIELD-COVERAGE FLOORS (schedule-first backstop): freeze-daily's repairCoverage prevents dead scorecard rows;
  // assert it. A future EASY or MEDIUM day where ZERO of its 5 works can score a core category (style/artist/medium)
  // plays as a fully dead row on a tier where players expect every skill → HARD. hard/impossible legitimately carry
  // anonymous/unmapped works, so a dead row there is only a WARN. Uses cats (the true scoreability), id-form-robust.
  { const FWIN=30; const fhz=new Date(Date.now()+FWIN*86400000).toISOString().slice(0,10);
    const resolve=id=>{ if(byId[id])return byId[id]; const m=String(id).match(/Q\d+/); return m?byId["wikidata:"+m[0]]:null; };
    for(const [date,day] of Object.entries(daily.byDate||{})){ if(date<=today||date>fhz) continue;
      for(const k of ["easy","medium","hard","impossible"]){ const works=(day[k]||[]).map(resolve).filter(Boolean); if(!works.length) continue;
        for(const c of ["style","artist","medium"]){ if(works.some(p=>(p.cats||[]).includes(c))) continue;
          const msg=`[dead-row] ${date}/${k}: 0 of ${works.length} works score ${c}`;
          (k==="easy"||k==="medium") ? hard.push(msg) : warn.push(msg); } } } }
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
// ── harmful / dated language (our voice). Inherited museum TITLES are kept verbatim; but slurs/dated
// ethnonyms in OUR text (why / note bodies / guide) are flagged for rewording. WARN — see check-language.mjs.
{ let teachL={}; try{ const t=readFileSync("data/teach-works.js","utf8"); teachL=JSON.parse(t.slice(t.indexOf("{",t.indexOf(".work")),t.lastIndexOf("}")+1)); }catch{}
  const { ourVoice, needsContext } = scanLanguage(pool, teachL);
  for(const h of ourVoice) warn.push(`[our-voice-language] "${h.term}" · ${(h.title||h.id).slice(0,40)}`);
  for(const h of needsContext) warn.push(`[title-needs-context] "${h.term}" · ${(h.title||h.id).slice(0,40)}`);
  globalThis.__language = { voice: ourVoice.length, ctx: needsContext.length };
}

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
{ const vg=globalThis.__visgap; if(vg) console.log(`vision-audit gap: ${vg.n} works scheduled in the next ${vg.win}d NOT yet image-grounded (${vg.sample.join(", ")}${vg.n>vg.sample.length?", …":""}) — run scripts/vision-next.mjs`); }
{ const cg=globalThis.__catgap; if(cg) console.log(`category gap (next ${cg.win}d dailies): ${cg.mov} missing MOVEMENT, ${cg.med} missing MEDIUM — dead scorecard rows (${cg.sample.join(", ")}${cg.mov>cg.sample.length?", …":""})`); }
{ const lg=globalThis.__language; if(lg&&(lg.voice||lg.ctx)) console.log(`harmful-language: ${lg.voice} our-voice hits (reword), ${lg.ctx} harmful titles missing a context note`); }
// FAME-DRIFT: pool.fame must equal the fame.js overlay (the value scheduling + this gate actually read). A stale
// pool.fame silently misleads tiering + debugging (it read 59 for famous works). Deterministic + network-free, so
// gate it — regenerate with `node scripts/resync-fame.mjs`. (Overlay-uncovered works are left alone.)
{ let drift=0; const eg=[];
  for(const p of pool){ if(fame[p.id]==null) continue; const v=Math.round(fame[p.id]); if((p.fame||0)!==v){ drift++; if(eg.length<4) eg.push(`${(p.title||p.id).slice(0,26)} ${p.fame||0}≠${v}`); } }
  if(drift) hard.push(`[fame-drift] ${drift} works: pool.fame ≠ fame.js overlay (${eg.join("; ")}) — run scripts/resync-fame.mjs`); }

// EASY-EXCLUDE STALENESS: a fame-competitive ANCIENT work (dated before the cutoff AND within the top-margin by
// fame, i.e. reachable by the Easy tier) MUST be in easy-exclude.json — else it lands in Easy with an ungettable
// WHEN facet (famous but not gettable). Deterministic, so gate it — regenerate with `node scripts/build-easy-exclude.mjs`.
{ let ex={}; try{ ex=JSON.parse(readFileSync("data/easy-exclude.json","utf8")); }catch{}
  const cutoff=ex.cutoff??800, margin=ex.margin??650, ids=new Set(ex.ids||[]);
  const zone=new Set([...pool].sort((a,b)=>fa(b)-fa(a)).slice(0,margin).map(p=>p.id));
  const miss=pool.filter(p=>p.y!=null && p.y<cutoff && zone.has(p.id) && !ids.has(p.id));
  if(miss.length) hard.push(`[easy-exclude-stale] ${miss.length} fame-top ancient works missing from easy-exclude.json (${miss.slice(0,4).map(p=>`"${(p.title||"").slice(0,24)}"(${p.y})`).join(", ")}) — run scripts/build-easy-exclude.mjs`); }

// AUTHORITIES COVERAGE: every current pool style label must have an entry in the backstage authority crosswalk,
// else it drifted (a style was added/renamed without rebuilding). Deterministic → gate it. Fix: npm run normalize.
{ let auth={}; try{ auth=JSON.parse(readFileSync("data/authorities.json","utf8")); }catch{}
  const KIND=new Set(["movement","culture","period","school","tradition","genre"]);
  const styles=new Set(); for(const p of pool) if(p.style&&KIND.has(p.styleKind)) styles.add(p.style);
  const miss=[...styles].filter(l=>!auth[l]);
  if(miss.length) hard.push(`[authorities-stale] ${miss.length} pool styles missing from data/authorities.json (${miss.slice(0,4).map(l=>`"${l}"`).join(", ")}) — run npm run normalize`); }

// EASY-FREEZE STALE: the frozen FUTURE easy rotation must not contain an easy-exclude work — else the exclusion
// rule changed but the freeze wasn't re-run (past+today stay pinned, so only future is checked). Fix: RESHUFFLE_FUTURE=1 npm run freeze.
{ let excl=new Set(); try{ excl=new Set(JSON.parse(readFileSync("data/easy-exclude.json","utf8")).ids); }catch{}
  const variants=id=>[id, id.replace("http://www.wikidata.org/entity/","wd:"), id.replace("http://www.wikidata.org/entity/","wikidata:")];
  const today=new Date().toISOString().slice(0,10);
  let bd={}; try{ const w={}; new Function("window",readFileSync("data/daily-order.js","utf8"))(w); bd=(w.ARTEFACTUM_DAILY&&w.ARTEFACTUM_DAILY.byDate)||{}; }catch{}
  let bad=0; const eg=[]; for(const [date,d] of Object.entries(bd)){ if(date<=today)continue; for(const id of (d.easy||[])) if(variants(id).some(x=>excl.has(x))){ bad++; if(eg.length<3)eg.push(date); } }
  if(bad) hard.push(`[easy-freeze-stale] ${bad} easy-exclude works still pinned in FUTURE easy days (${eg.join(", ")}…) — run RESHUFFLE_FUTURE=1 npm run freeze`); }

report("⚠ HARD violations (block ship)", hard);
report("ℹ warnings (review)", warn);
console.log(`\n${hard.length?"❌ FAIL — "+hard.length+" hard violations":"✅ PASS — no hard violations"}`);
process.exit(hard.length?1:0);
