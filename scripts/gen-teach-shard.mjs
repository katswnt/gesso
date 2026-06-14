// Generate "teach me" notes for a SHARD of an input work-list via Codex. Parallel-safe & resumable.
// Usage: node scripts/gen-teach-shard.mjs <input.json> <shardIndex> <numShards> <out.json>
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const [INPUT, K, N, OUT] = [process.argv[2], +process.argv[3], +process.argv[4], process.argv[5]];
if(!INPUT||!OUT||!Number.isInteger(K)||!Number.isInteger(N)){ console.error("args: <input.json> <shardIdx> <numShards> <out.json>"); process.exit(1); }
const SCHEMA = "scripts/teach-schema.json";
const BATCH = 4; // richer schema (why + cues + variable-length guide) is a big payload → small batches avoid Codex timeouts
const fy = y => y<0 ? (-y)+" BCE" : y+" CE";

const all = JSON.parse(readFileSync(INPUT,"utf8"));
const mine = all.filter((_,i)=> i%N===K);
let out = {};
if(existsSync(OUT)){ try{ out = JSON.parse(readFileSync(OUT,"utf8")); }catch{} }
const todo = mine.filter(p=>!out[p.id]);
console.error(`shard ${K}/${N}: ${mine.length} works, ${Object.keys(out).length} done, ${todo.length} to do`);

const save = () => writeFileSync(OUT, JSON.stringify(out));

for(let i=0;i<todo.length;i+=BATCH){
  const batch = todo.slice(i,i+BATCH);
  const list = batch.map(p=>`id=${JSON.stringify(p.id)} | "${p.title}" | ${p.artist||"anonymous"} | ${fy(p.y)} | ${p.place||p.region} | school: ${p.style||"—"} | medium: ${p.medium||"—"}`).join("\n");
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
- For obscure works with thin data, lean on what is always safe: medium reasoning, visible-subject description, technique, and general regional/period context. Skip specific claims you can't support; drop optional questions rather than speculate.
- No hedging filler ("it is believed perhaps"). State it plainly because it's solid, or describe the visible instead.
No markdown, no prose outside the JSON.
Works:
${list}`;
  let js=null;
  try{
    const so = execFileSync("codex",["exec","-s","read-only","--ephemeral","--skip-git-repo-check","--color","never","--output-schema",SCHEMA,"-"],
      {input:prompt,encoding:"utf8",maxBuffer:1e8,timeout:600000});
    const a=so.indexOf("{"), b=so.lastIndexOf("}");
    if(a>=0&&b>a){ try{ js=JSON.parse(so.slice(a,b+1)); }catch{} }
  }catch(e){ console.error(`shard ${K} batch @${i} codex error`, String(e).slice(0,120)); }
  if(!js||!Array.isArray(js.items)){ console.error(`shard ${K} batch @${i} parse FAIL (retry on rerun)`); continue; }
  let added=0;
  for(const it of js.items){
    if(!(it&&it.id&&it.why&&Array.isArray(it.cues)))continue;
    const guide=Array.isArray(it.guide)?it.guide.filter(g=>g&&typeof g.q==='string'&&g.q.trim()&&typeof g.a==='string'&&g.a.trim()).map(g=>({q:g.q.trim(),a:g.a.trim()})):[];
    if(guide.length<5){ console.error(`shard ${K} skip ${it.id}: only ${guide.length} guide items (need 5+), retry on rerun`); continue; }
    out[it.id]={why:it.why,cues:it.cues.slice(0,4),guide};
    added++;
  }
  save();
  console.error(`shard ${K} batch ${Math.floor(i/BATCH)+1}/${Math.ceil(todo.length/BATCH)}: +${added}, total ${Object.keys(out).length}`);
}
console.error(`shard ${K} FINISHED: ${Object.keys(out).length} notes`);
