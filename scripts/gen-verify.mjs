// Fact-check the per-work teach notes via Codex (adversarial framing). Overwrites corrections in place.
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const pool = JSON.parse(readFileSync("data/pool.js","utf8").replace("window.ARTEFACTUM_POOL = ","").replace(/;\s*$/,""));
const t = readFileSync("data/teach-works.js","utf8");
const notes = JSON.parse(t.slice(t.indexOf("{",t.indexOf(".work")), t.lastIndexOf("}")+1));
const SCHEMA="scripts/teach-schema.json", OUT="data/teach-works.js", BATCH=18;
let doneIds=new Set(); try{ doneIds=new Set(JSON.parse(readFileSync("scripts/.verified.json","utf8"))); }catch{}
const fy=y=>y<0?(-y)+" BCE":y+" CE";
const todo=pool.filter(p=>notes[p.id]&&!doneIds.has(p.id));
console.error(`verifying ${todo.length} of ${pool.length}`);
const save=()=>{ writeFileSync(OUT,"window.ARTEFACTUM_CUES=window.ARTEFACTUM_CUES||{};\nwindow.ARTEFACTUM_CUES.work="+JSON.stringify(notes)+";\n");
  writeFileSync("scripts/.verified.json",JSON.stringify([...doneIds])); };
for(let i=0;i<todo.length;i+=BATCH){
  const batch=todo.slice(i,i+BATCH);
  const list=batch.map(p=>`id=${JSON.stringify(p.id)}\n  META (ground truth): "${p.title}" | ${p.artist||"anonymous"} | ${fy(p.y)} | ${p.place||p.region} | school: ${p.style||"—"} | medium: ${p.medium||"—"}\n  why: ${notes[p.id].why}\n  cues: ${JSON.stringify(notes[p.id].cues)}`).join("\n");
  const prompt=`You are an art-history fact-checker. The "teach me" notes below were written by an AI (NOT by you), and a reviewer has confirmed several contain factual ERRORS — wrong period or region, anachronistic techniques, mis-stated movements, claims not supported by the work's medium, or invented specifics. Find them and fix them.
For EACH work return: id (copy exactly), why (ONE corrected sentence placing it by era+region+school/medium with the biggest giveaway), cues (exactly 3 concrete, ACCURATE visual tells). The META line is ground truth — never contradict it. If a claim can't be supported, replace it with a safe style/region-level fact. Return all works. JSON only.
Works:
${list}`;
  const r=spawnSync("codex",["exec","-s","read-only","--ephemeral","--skip-git-repo-check","--color","never","--output-schema",SCHEMA,"-"],{input:prompt,encoding:"utf8",maxBuffer:1e8,timeout:300000});
  const so=r.stdout||""; let js=null; const a=so.indexOf("{"),b=so.lastIndexOf("}");
  if(a>=0&&b>a){ try{ js=JSON.parse(so.slice(a,b+1)); }catch{} }
  if(!js||!Array.isArray(js.items)){ console.error(`batch @${i} parse FAIL`); continue; }
  let n=0; for(const it of js.items){ if(it&&it.id&&notes[it.id]&&it.why&&Array.isArray(it.cues)){ notes[it.id]={why:it.why,cues:it.cues.slice(0,3)}; doneIds.add(it.id); n++; } }
  save(); console.error(`batch ${Math.floor(i/BATCH)+1}/${Math.ceil(todo.length/BATCH)}: verified ${n}, total ${doneIds.size}`);
}
console.error(`FINISHED verified ${doneIds.size}`);
