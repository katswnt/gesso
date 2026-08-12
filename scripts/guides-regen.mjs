// Stable pipeline: regenerate thin/template "Ask the guide" Q&A for the priority cohort,
// TEXT-based (from each work's existing why/cues/hotspot-notes), via SONNET AGENTS.
// Do NOT run this through Codex — Codex reproduced the generic template (that is why we deleted gen-teach).
//
// Flow:
//   1) node scripts/guides-regen.mjs select [N=100] [chunkSize=14]
//        -> picks the top-N thin works by fame (priority), skips ids that already have an output,
//           writes data/incoming/guides/chunks/chunk-*.json (context per work) + selected.json
//   2) spawn ONE Sonnet agent per chunk with the prompt in docs/guides-pipeline.md; each agent reads
//        its chunk file and writes data/incoming/guides/out/out-<chunk>.json = {"<id>":[{"q","a"},...]}
//   3) node scripts/guides-regen.mjs merge
//        -> validates + writes the new guides into data/teach-works.js (guide field only), for selected ids
//   4) gate: node tests/dom-harness.mjs && node scripts/check-pool.mjs   (as its own step) then commit
//
// "Thin" = a guide of <=6 questions with >=2 pure-template phrases (the old-pipeline signature).
import fs from "node:fs"; import path from "node:path";
const DIR="data/incoming/guides", CH=path.join(DIR,"chunks"), OUT=path.join(DIR,"out");
const load=(p,k)=>{const w={};new Function("window",fs.readFileSync(p,"utf8"))(w);return w[k];};
const cues=()=>{const w={ARTEFACTUM_CUES:{}};new Function("window",fs.readFileSync("data/teach-works.js","utf8"))(w);return w.ARTEFACTUM_CUES.work||{};};
const q=g=>typeof g==="string"?g:(g&&g.q)||"";
const PURE=/(why does (this|it) (work|painting|piece|sculpture|object)? ?matter|what technique should i notice|who made it(,| and)? for whom|what should i (look for|notice)\??$)/i;
const isThin=g=>Array.isArray(g)&&g.length<=6&&g.filter(x=>PURE.test(q(x))).length>=2;

function selectThin(){ const CUES=cues(), pool=load("data/pool.js","ARTEFACTUM_POOL");
  let fame={}; try{const f=fs.readFileSync("data/fame.js","utf8");fame=JSON.parse(f.slice(f.indexOf("{"),f.lastIndexOf("}")+1));}catch{}
  return pool.filter(p=>CUES[p.id]&&isThin(CUES[p.id].guide)).map(p=>({p,f:fame[p.id]||p.fame||0})).sort((a,b)=>b.f-a.f).map(x=>x.p); }

const mode=process.argv[2];
if(mode==="select"){ const N=+(process.argv[3]||100), CHUNK=+(process.argv[4]||14);
  fs.mkdirSync(CH,{recursive:true}); fs.mkdirSync(OUT,{recursive:true});
  const CUES=cues(), sel=selectThin().slice(0,N);
  fs.writeFileSync(path.join(DIR,"selected.json"),JSON.stringify(sel.map(p=>p.id)));
  const have=new Set(); for(const f of fs.readdirSync(OUT)){ try{ Object.keys(JSON.parse(fs.readFileSync(path.join(OUT,f),"utf8"))).forEach(id=>have.add(id)); }catch{} }
  const todo=sel.filter(p=>!have.has(p.id));
  for(const f of fs.readdirSync(CH)) fs.unlinkSync(path.join(CH,f));
  let k=0; for(let i=0;i<todo.length;i+=CHUNK){ const chunk=todo.slice(i,i+CHUNK).map(p=>{const s=CUES[p.id]||{};
      return{id:p.id,title:p.title,artist:p.artist||"unknown",y:p.y,movement:p.style||"",place:p.place||"",why:s.why||"",cues:s.cues||[],notes:(s.notes||[]).map(n=>({head:n.head,body:n.body})),oldGuide:(s.guide||[]).map(q)};});
    fs.writeFileSync(path.join(CH,`chunk-${++k}.json`),JSON.stringify(chunk,null,1)); }
  console.log(`selected ${sel.length} | already generated ${sel.length-todo.length} | to generate ${todo.length} across ${k} chunks (size ${CHUNK})`);
  console.log(`spawn ${k} Sonnet agents, one per data/incoming/guides/chunks/chunk-<n>.json, writing data/incoming/guides/out/out-<n>.json`);
}
else if(mode==="merge"){ const sel=new Set(JSON.parse(fs.readFileSync(path.join(DIR,"selected.json"),"utf8")));
  const map={}; for(const f of fs.readdirSync(OUT)){ try{ const o=JSON.parse(fs.readFileSync(path.join(OUT,f),"utf8"));
      for(const [id,g] of Object.entries(o)){ if(!sel.has(id))continue; const clean=Array.isArray(g)?g.filter(x=>x&&typeof x.q==="string"&&x.q.trim()&&typeof x.a==="string"&&x.a.trim()).map(x=>({q:x.q.trim(),a:x.a.trim()})):[];
        if(clean.length>=6) map[id]=clean; } }catch(e){ console.error("skip",f,e.message); } }
  const CUES=cues(); let n=0,miss=0; for(const [id,g] of Object.entries(map)){ if(CUES[id]){ CUES[id].guide=g; n++; } else miss++; }
  fs.writeFileSync("data/teach-works.js","window.ARTEFACTUM_CUES=window.ARTEFACTUM_CUES||{};\nwindow.ARTEFACTUM_CUES.work="+JSON.stringify(CUES)+";\n");
  console.log(`merged guides for ${n} works (${miss} ids not found in teach-works)`);
}
else console.log("usage: guides-regen.mjs select [N] [chunkSize] | merge");
