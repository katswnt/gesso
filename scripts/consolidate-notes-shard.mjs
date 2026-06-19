// Consolidate/improve EXISTING teach-me guides for a SHARD via Codex. Parallel-safe & resumable.
// Input = JSON array of works that ALREADY have a note: {id,title,artist,y,place,region,style,medium,why,cues,guide}.
// Output = OBJECT keyed by id: {id:{why,cues,guide}}. Merge later with the object-format merge (NOT merge-notes.mjs).
// Usage: node scripts/consolidate-notes-shard.mjs <input.json> <shardIndex> <numShards> <out.json>
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const [INPUT,K,N,OUT]=[process.argv[2],+process.argv[3],+process.argv[4],process.argv[5]];
if(!INPUT||!OUT||!Number.isInteger(K)||!Number.isInteger(N)){ console.error("args: <input.json> <shardIdx> <numShards> <out.json>"); process.exit(1); }
const SCHEMA="scripts/teach-schema.json";
const BATCH=5;
const fy=y=>y<0?(-y)+" BCE":y+" CE";
const all=JSON.parse(readFileSync(INPUT,"utf8"));
const mine=all.filter((_,i)=>i%N===K);
let out={}; if(existsSync(OUT)){ try{ out=JSON.parse(readFileSync(OUT,"utf8")); }catch{} }
const todo=mine.filter(p=>!out[p.id]);
console.error(`shard ${K}/${N}: ${mine.length} works, ${Object.keys(out).length} done, ${todo.length} to do`);
const save=()=>writeFileSync(OUT,JSON.stringify(out));

const PROMPT=(items)=>`You are refining the "Ask the guide" Q&A in an art-guessing game's teach-me notes. For each work I give its metadata, current "why" + "cues", and its CURRENT guide. Rewrite the GUIDE to be higher quality. Rules:
- Keep AND EXPAND: include as MANY genuinely interesting, work-SPECIFIC questions as the work honestly supports. Do NOT cap the number — more good questions is better. Only cut true duplicates or filler.
- VARY the questions and make them specific to THIS work. AVOID the generic template repeated across works ("What medium is this? Who is the figure? Why does it matter? What technique? What's the story?"). Ask things a curious person would actually wonder about this particular work — symbolism, composition, history, technique, comparisons, controversies, scale, function.
- If there is NO identifiable named subject (non-figurative, decorative, or anonymous object), do NOT ask "how do I recognize the subject?" — instead ask what the object IS, what it was FOR, or what is depicted in general terms.
- NEVER assert the work "gives one reading" / "the safest reading is". If interpretation is debated, write "a common reading is…" (only if genuinely true).
- ACCURACY: never invent a name or attribution; if unsure who/what, describe what is visible. Each answer = 2-3 warm, plain sentences (audience: a smart first-timer). Preserve all real info from the current guide — consolidate, don't lose it.
Return EXACTLY the schema: items:[{id, why, cues, guide:[{q,a}...]}]. Keep why and the 4 cues (lightly polish if needed). id must match exactly.
WORKS:
${items.map(p=>`id=${JSON.stringify(p.id)} | "${p.title}" | ${p.artist||"anonymous"} | ${fy(p.y)} | ${p.place||p.region} | school: ${p.style||"—"} | medium: ${p.medium||"—"}
  why: ${p.why}
  cues: ${JSON.stringify(p.cues)}
  current guide: ${JSON.stringify(p.guide)}`).join("\n")}`;

for(let i=0;i<todo.length;i+=BATCH){
  const batch=todo.slice(i,i+BATCH);
  try{
    const res=execFileSync("codex",["exec","-s","read-only","--ephemeral","--skip-git-repo-check","--color","never","--output-schema",SCHEMA,"-"],{input:PROMPT(batch),encoding:"utf8",maxBuffer:1e8,timeout:300000});
    const j=JSON.parse(res.slice(res.indexOf("{"),res.lastIndexOf("}")+1));
    for(const it of (j.items||[])){
      const guide=Array.isArray(it.guide)?it.guide.filter(g=>g&&typeof g.q==="string"&&g.q.trim()&&typeof g.a==="string"&&g.a.trim()).map(g=>({q:g.q.trim(),a:g.a.trim()})):[];
      const cues=Array.isArray(it.cues)?it.cues.filter(c=>typeof c==="string"&&c.includes("→")).slice(0,4):[];
      if(it.id&&it.why&&cues.length===4&&guide.length>=5) out[it.id]={why:String(it.why).trim(),cues,guide};
    }
    save();
    console.error(`shard ${K} batch @${i}: total ${Object.keys(out).length}`);
  }catch(e){ console.error(`shard ${K} batch @${i} FAIL: ${String(e).slice(0,90)}`); if(/usage limit/i.test(String(e))){ console.error("USAGE LIMIT — stopping shard (resumable)"); break; } }
}
console.error(`shard ${K} done: ${Object.keys(out).length}/${mine.length}`);
