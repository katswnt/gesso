// Codex vision: hotspots + an image-match spot-check for STAGED works, in ONE pass (piggybacked, ~free).
// Reads data/incoming/staged-hotspot-worklist.json [{id,img,cues}] + titles from pool.
// Writes data/incoming/staged-hotspots/hotspots.json AND data/incoming/staged-hotspots/image-flags.json.
// Resumable. NO git/commit/push. (Key fix: stdin MUST be closed or codex hangs "reading from stdin".)
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const SCHEMA = "/tmp/hotschema.json";
writeFileSync(SCHEMA, JSON.stringify({type:"object",additionalProperties:false,required:["hotspots","imageOk","reason"],properties:{
  hotspots:{type:"array",items:{type:"object",additionalProperties:false,required:["n","x","y"],properties:{n:{type:"integer"},x:{type:"number"},y:{type:"number"}}}},
  imageOk:{type:"boolean"}, reason:{type:"string"}}})); // strict mode: every property must be in required
const UA="GessoHotspots/1.0 (kathryn.swint@gmail.com)";
const pool=JSON.parse(readFileSync("data/pool.js","utf8").replace("window.ARTEFACTUM_POOL = ","").replace(/;\s*$/,""));
const titleOf=Object.fromEntries(pool.map(p=>[p.id,p.title]));
const WL=JSON.parse(readFileSync("data/incoming/staged-hotspot-worklist.json","utf8"));
mkdirSync("data/incoming/staged-hotspots",{recursive:true});
const HS="data/incoming/staged-hotspots/hotspots.json", FL="data/incoming/staged-hotspots/image-flags.json";
let done={}; if(existsSync(HS)){ try{done=JSON.parse(readFileSync(HS,"utf8"));}catch{} }
let flags={}; if(existsSync(FL)){ try{flags=JSON.parse(readFileSync(FL,"utf8"));}catch{} }
const todo=WL.filter(w=>!(w.id in done));
console.error(`staged hotspots+spot-check: ${Object.keys(done).length} done, ${todo.length} to do`);

async function dl(w){ const path=join("/tmp", w.id.replace(/[^a-z0-9]/gi,"_")+".jpg");
  try{ const r=await fetch(w.img,{headers:{"User-Agent":UA}}); if(!r.ok) return null; writeFileSync(path,Buffer.from(await r.arrayBuffer())); return path; }catch{ return null; } }

// spawn codex with stdin IGNORED (closed) — otherwise codex hangs "Reading additional input from stdin"
function codex(args){ return new Promise(res=>{ const c=spawn("codex",args,{stdio:["ignore","ignore","ignore"]});
  const t=setTimeout(()=>{try{c.kill("SIGKILL");}catch{}; res(false);},180000);
  c.on("close",code=>{clearTimeout(t);res(code===0);}); c.on("error",()=>{clearTimeout(t);res(false);}); }); }

async function analyze(path, title, cues){
  const c=(cues||[]).map((x,i)=>`${i+1}) ${x}`).join("; ");
  const out=join(mkdtempSync(join(tmpdir(),"hc-")),"o.json");
  const prompt=`The attached image should be the artwork titled "${title}". (1) For EACH cue that points to a single locatable visible feature, output {n,x,y} = cue index + percent-of-image location; skip pure material/technique cues. Cues: ${c}. (2) Set imageOk=false (with a short reason) ONLY if the image clearly is NOT this artwork — e.g. it's a map, flag, watermark, blank/error, museum label, or an unrelated object/photo; otherwise imageOk=true. Output JSON {"hotspots":[...],"imageOk":bool,"reason":""}.`;
  const ok=await codex(["exec","-s","read-only","--skip-git-repo-check","--color","never","-i",path,"--output-schema",SCHEMA,"-o",out,prompt]);
  if(!ok) return null;
  try{ const j=JSON.parse(readFileSync(out,"utf8"));
    const hs=(j.hotspots||[]).filter(h=>h&&Number.isFinite(h.x)&&Number.isFinite(h.y)&&Number.isInteger(h.n)&&h.x>=0&&h.x<=100&&h.y>=0&&h.y<=100).map(h=>({n:h.n,x:Math.round(h.x*10)/10,y:Math.round(h.y*10)/10}));
    return {hs, imageOk:j.imageOk!==false, reason:j.reason||""};
  }catch{ return null; }
}
let i=0, fails=0, ok=0, bad=0;
async function worker(){
  while(i<todo.length){ const w=todo[i++]; const path=await dl(w); if(!path){ done[w.id]=[]; continue; }
    const r=await analyze(path, titleOf[w.id]||"this work", w.cues);
    if(r===null){ fails++; if(fails>=15){ console.error("too many Codex failures (limit?) — stopping; re-run to resume"); writeFileSync(HS,JSON.stringify(done)); writeFileSync(FL,JSON.stringify(flags)); process.exit(0); } continue; }
    done[w.id]=r.hs; ok++; if(!r.imageOk){ flags[w.id]={title:titleOf[w.id],reason:r.reason}; bad++; }
    if(ok%8===0){ writeFileSync(HS,JSON.stringify(done)); writeFileSync(FL,JSON.stringify(flags)); console.error(`${Object.keys(done).length}/${WL.length} | image-flags ${Object.keys(flags).length}`); }
  }
}
await Promise.all([worker(),worker(),worker()]);
writeFileSync(HS,JSON.stringify(done)); writeFileSync(FL,JSON.stringify(flags));
console.error(`DONE: ${Object.keys(done).length}/${WL.length} hotspots | ${Object.keys(flags).length} image-mismatch flags`);
