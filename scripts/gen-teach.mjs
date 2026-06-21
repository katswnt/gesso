// Generate per-work "teach me" notes via the Codex CLI (uses the user's logged-in Codex).
// Resumable + BACKFILL: generates works missing from data/teach-works.js AND back-fills any
// existing entry that lacks the richer `guide` array. Run: node scripts/gen-teach.mjs
//   optional: node scripts/gen-teach.mjs <shardIdx> <numShards>   (to split across parallel runs)
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { readGlobal } from "./lib/static-module.mjs";

// robust load (writeAssignment writes "window.X=[...]" without spaces; a naive string-replace breaks on it)
const pool = readGlobal("data/pool.js","ARTEFACTUM_POOL");
const SCHEMA = "scripts/teach-schema.json";
const OUT = "data/teach-works.js";
const BATCH = 8; // richer schema (why + cues + variable-length guide) → smaller batches keep responses reliable
const [K,N] = [parseInt(process.argv[2],10), parseInt(process.argv[3],10)];
const sharded = Number.isInteger(K) && Number.isInteger(N) && N>0;

let out = {};
try { const t=readFileSync(OUT,"utf8"); out = JSON.parse(t.slice(t.indexOf("{",t.indexOf(".work")), t.lastIndexOf("}")+1)); } catch {}
const fy = y => y<0 ? (-y)+" BCE" : y+" CE";
// done = has the FULL richer schema (why + cues + guide). Entries with only why+cues get back-filled.
const done = id => out[id] && Array.isArray(out[id].guide) && out[id].guide.length>=5;
// generate easy→medium→hard: order missing-notes works by recognizability (fame.js overlay, else pool fame)
let FAME={}; try{ const f=readFileSync("data/fame.js","utf8"); FAME=JSON.parse(f.slice(f.indexOf("{"), f.lastIndexOf("}")+1)); }catch{}
const fameOf = p => (FAME[p.id]!=null ? FAME[p.id] : (p.fame||0));
let work = pool.filter(p=>!done(p.id)).sort((a,b)=>fameOf(b)-fameOf(a));
if(sharded) work = work.filter((_,i)=> i%N===K);
const todo = work;
const missingGuide = pool.filter(p=>out[p.id] && !done(p.id)).length;
console.error(`pool ${pool.length} | fully done ${pool.filter(p=>done(p.id)).length} | to generate ${todo.length} (incl. ${missingGuide} back-fills missing guide)${sharded?` | shard ${K}/${N}`:""}`);

function save(){ writeFileSync(OUT, "window.ARTEFACTUM_CUES=window.ARTEFACTUM_CUES||{};\nwindow.ARTEFACTUM_CUES.work="+JSON.stringify(out)+";\n"); }

for(let i=0;i<todo.length;i+=BATCH){
  const batch=todo.slice(i,i+BATCH);
  const list=batch.map(p=>`id=${JSON.stringify(p.id)} | "${p.title}" | ${p.artist||"anonymous"} | ${fy(p.y)} | ${p.place||p.region} | school: ${p.style||"—"} | medium: ${p.medium||"—"}`).join("\n");
  const prompt=`You are a warm, knowledgeable museum guide writing "teach me" notes for an art-guessing game. The notes appear AFTER the player has guessed, so naming the date/place/artist is fine. Two jobs: (1) teach HOW you'd KNOW a work's date/place/school/medium/artist by LOOKING (diagnostic reasoning), and (2) answer the questions a curious visitor would ask a guide. Audience: a smart first-timer (think someone's mum or aunt) — warm, plain, no unexplained jargon.
For EACH work below return an item with EXACTLY these fields:
- id: copy the id string exactly.
- why: ONE sentence that PLACES the work — concrete era + region + school/medium + the single biggest visual giveaway.
- cues: EXACTLY 4 cues. Each connects SOMETHING YOU CAN SEE to WHAT IT TELLS YOU, in the form "<visible feature> → <what that signals>". Cover 4 DIFFERENT axes: (1) WHEN — dates it; (2) WHERE — locates the region/culture; (3) SCHOOL/MOVEMENT — diagnostic of the movement/tradition; (4) MEDIUM or ARTIST'S HAND — what the surface/technique reveals (name the artist's tell only if known and distinctive). Each cue = one tight clause before and after the arrow. Example: "fluid wet-in-wet brushwork and tonal restraint → a Paris-trained hand, characteristic of Sargent" — NOT "fluid brushwork".
- guide: an "Ask the guide" Q&A list. Each item is {q,a}: q = a natural question a visitor would ask; a = 2-3 warm, plain sentences. The FIRST FIVE are REQUIRED and MUST appear in this order:
    1. q about the MEDIUM: why this material, what it let the artist do, AND why not a plausible alternative (e.g. ink vs oil/tempera).
    2. q about the SUBJECT/FIGURES: who or what you're looking at and how to recognize the key figures (for a non-figurative object: what it is and what it was for).
    3. q about SIGNIFICANCE: why this work or artist matters / what was new.
    4. q about TECHNIQUE: how it was made — the craft detail worth noticing up close.
    5. q about STORY/CONTEXT: who made it, for whom, and the human backstory (commission, function, where it lived, what happened to it).
  THEN add AS MANY EXTRA {q,a} items as the work genuinely supports — any further question a curious visitor would ask that you can answer ACCURATELY (symbolism, scale, location made, later history, comparisons). No fixed cap. Famous works may warrant 8-10 total; obscure works may have only the required 5. NEVER pad with filler or speculation to hit a number.
ACCURACY GUARDRAILS (critical — these ship with no human review):
- The metadata below is ground truth. Beyond it, assert ONLY facts that are genuinely well-known for the work/artist.
- NEVER invent a named figure or person. If you cannot confidently identify who is depicted, DESCRIBE WHAT IS VISIBLE ("a seated woman in red holding a book") instead of guessing a name. Wrong names are the worst failure.
- If the medium below shows "—" (unknown), DO NOT name or guess a specific material (no "marble", "oil", "bronze", etc.) anywhere in the note — describe the visible surface/form instead ("a worked, matte surface"), and make the medium question about visible technique rather than asserting a material. (This prevents the classic error of guessing "marble" for what is actually terracotta.)
- For obscure works with thin data, lean on what is always safe: medium reasoning (only if the medium is known), visible-subject description, technique, and general regional/period context. Skip specific claims you can't support; drop optional questions rather than speculate.
- No hedging filler ("it is believed perhaps"). State it plainly because it's solid, or describe the visible instead.
No markdown, no prose outside the JSON.
Works:
${list}`;
  const r=spawnSync("codex",["exec","-s","read-only","--ephemeral","--skip-git-repo-check","--color","never","--output-schema",SCHEMA,"-"],
    {input:prompt,encoding:"utf8",maxBuffer:1e8,timeout:300000});
  const so=r.stdout||"";
  let js=null; const a=so.indexOf("{"), b=so.lastIndexOf("}");
  if(a>=0&&b>a){ try{ js=JSON.parse(so.slice(a,b+1)); }catch(e){} }
  if(!js||!Array.isArray(js.items)){ console.error(`batch @${i} parse FAIL (will retry on rerun)`); continue; }
  let added=0;
  for(const it of js.items){
    if(!(it&&it.id&&it.why&&Array.isArray(it.cues)))continue;
    const guide=Array.isArray(it.guide)?it.guide.filter(g=>g&&typeof g.q==='string'&&g.q.trim()&&typeof g.a==='string'&&g.a.trim()).map(g=>({q:g.q.trim(),a:g.a.trim()})):[];
    if(guide.length<5){ console.error(`skip ${it.id}: only ${guide.length} guide items (need 5+), retry on rerun`); continue; }
    out[it.id]={why:it.why,cues:it.cues.slice(0,4),guide};
    added++;
  }
  save();
  console.error(`batch ${Math.floor(i/BATCH)+1}/${Math.ceil(todo.length/BATCH)}: +${added}, total ${Object.keys(out).length}`);
}
console.error(`FINISHED. total notes: ${Object.keys(out).length}/${pool.length}`);
