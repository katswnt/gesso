// Generate "teach me" notes for a SHARD of an input work-list via Codex. Parallel-safe & resumable.
// Usage: node scripts/gen-teach-shard.mjs <input.json> <shardIndex> <numShards> <out.json>
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const [INPUT, K, N, OUT] = [process.argv[2], +process.argv[3], +process.argv[4], process.argv[5]];
if(!INPUT||!OUT||!Number.isInteger(K)||!Number.isInteger(N)){ console.error("args: <input.json> <shardIdx> <numShards> <out.json>"); process.exit(1); }
const SCHEMA = "scripts/teach-schema.json";
const BATCH = 20;
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
  const prompt=`You are an art historian writing "teach me" notes for an art-guessing game. The whole point is to teach a player HOW THEY WOULD KNOW a work's date, place, school, medium, and artist by LOOKING — diagnostic reasoning, not description.
For EACH work below return an item:
- id: copy the id string exactly.
- why: ONE sentence that PLACES the work — concrete era + region + school/medium + the single biggest visual giveaway.
- cues: EXACTLY 4 cues. Each cue connects SOMETHING YOU CAN SEE to WHAT IT TELLS YOU, in the form "<visible feature> → <what that signals>". Across the 4 cues cover DIFFERENT axes: (1) WHEN — a feature that dates it; (2) WHERE — a feature that locates the region/culture; (3) SCHOOL/MOVEMENT — a feature diagnostic of the movement or tradition; (4) MEDIUM or ARTIST'S HAND — what the surface/technique reveals, and if the artist is known and distinctive, the tell-tale of their hand.
Example cue: "fluid wet-in-wet brushwork and tonal restraint → a Paris-trained hand, characteristic of Sargent" — NOT "fluid brushwork".
Rules: Be art-history accurate; the metadata is ground truth. If a specific is uncertain, reason at the style/region/medium level rather than inventing facts. Keep each cue to one tight clause before and after the arrow. No markdown, no prose outside the JSON.
Works:
${list}`;
  let js=null;
  try{
    const so = execFileSync("codex",["exec","-s","read-only","--ephemeral","--skip-git-repo-check","--color","never","--output-schema",SCHEMA,"-"],
      {input:prompt,encoding:"utf8",maxBuffer:1e8,timeout:300000});
    const a=so.indexOf("{"), b=so.lastIndexOf("}");
    if(a>=0&&b>a){ try{ js=JSON.parse(so.slice(a,b+1)); }catch{} }
  }catch(e){ console.error(`shard ${K} batch @${i} codex error`, String(e).slice(0,120)); }
  if(!js||!Array.isArray(js.items)){ console.error(`shard ${K} batch @${i} parse FAIL (retry on rerun)`); continue; }
  let added=0;
  for(const it of js.items){ if(it&&it.id&&it.why&&Array.isArray(it.cues)){ out[it.id]={why:it.why,cues:it.cues.slice(0,4)}; added++; } }
  save();
  console.error(`shard ${K} batch ${Math.floor(i/BATCH)+1}/${Math.ceil(todo.length/BATCH)}: +${added}, total ${Object.keys(out).length}`);
}
console.error(`shard ${K} FINISHED: ${Object.keys(out).length} notes`);
