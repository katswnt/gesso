// Generate per-work "teach me" notes via the Codex CLI (uses the user's logged-in Codex).
// Resumable: only generates works missing from data/teach-works.js. Run: node scripts/gen-teach.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const pool = JSON.parse(readFileSync("data/pool.js","utf8").replace("window.ARTEFACTUM_POOL = ","").replace(/;\s*$/,""));
const SCHEMA = "scripts/teach-schema.json";
const OUT = "data/teach-works.js";
const BATCH = 20;

let out = {};
try { const t=readFileSync(OUT,"utf8"); out = JSON.parse(t.slice(t.indexOf("{",t.indexOf(".work")), t.lastIndexOf("}")+1)); } catch {}
const fy = y => y<0 ? (-y)+" BCE" : y+" CE";
const todo = pool.filter(p=>!out[p.id]);
console.error(`pool ${pool.length}, already done ${Object.keys(out).length}, to generate ${todo.length}`);

function save(){ writeFileSync(OUT, "window.ARTEFACTUM_CUES=window.ARTEFACTUM_CUES||{};\nwindow.ARTEFACTUM_CUES.work="+JSON.stringify(out)+";\n"); }

for(let i=0;i<todo.length;i+=BATCH){
  const batch=todo.slice(i,i+BATCH);
  const list=batch.map(p=>`id=${JSON.stringify(p.id)} | "${p.title}" | ${p.artist||"anonymous"} | ${fy(p.y)} | ${p.place||p.region} | school: ${p.style||"—"} | medium: ${p.medium||"—"}`).join("\n");
  const prompt=`You are an art historian writing concise "teach me" notes for an art-guessing game that teaches people to place works by eye.
For EACH work below return an item:
- id: copy the id string exactly.
- why: ONE sentence telling the player how to PLACE this work — name a concrete period/era, the region, and the school or medium, and the single biggest giveaway.
- cues: EXACTLY 3 short, concrete visual tells a viewer could actually spot (palette, technique, motif, composition, support).
Rules: Be art-history accurate. The metadata given is ground truth. If you are unsure of a work-specific fact, stay at the level of style/region/medium generalization — do NOT invent signatures, anecdotes, or attributions. No markdown, no prose outside the JSON.
Works:
${list}`;
  const r=spawnSync("codex",["exec","-s","read-only","--ephemeral","--skip-git-repo-check","--color","never","--output-schema",SCHEMA,"-"],
    {input:prompt,encoding:"utf8",maxBuffer:1e8,timeout:300000});
  const so=r.stdout||"";
  let js=null; const a=so.indexOf("{"), b=so.lastIndexOf("}");
  if(a>=0&&b>a){ try{ js=JSON.parse(so.slice(a,b+1)); }catch(e){} }
  if(!js||!Array.isArray(js.items)){ console.error(`batch @${i} parse FAIL (will retry on rerun)`); continue; }
  let added=0;
  for(const it of js.items){ if(it&&it.id&&it.why&&Array.isArray(it.cues)){ out[it.id]={why:it.why,cues:it.cues.slice(0,3)}; added++; } }
  save();
  console.error(`batch ${Math.floor(i/BATCH)+1}/${Math.ceil(todo.length/BATCH)}: +${added}, total ${Object.keys(out).length}`);
}
console.error(`FINISHED. total notes: ${Object.keys(out).length}/${pool.length}`);
