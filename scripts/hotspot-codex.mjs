// Autonomous hotspot loop driven by Codex vision (saves Claude tokens).
// Loops: next-hotspots -> codex reads each image + cues -> {n,x,y} -> save-hotspots -> commit/push.
// Run: node scripts/hotspot-codex.mjs   (intended to run in background until remaining===0)
import { execFileSync, execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BATCH = 6, CONCURRENCY = 3;
const SCHEMA = "/tmp/hotschema.json";
writeFileSync(SCHEMA, JSON.stringify({type:"object",additionalProperties:false,properties:{hotspots:{type:"array",items:{type:"object",additionalProperties:false,properties:{n:{type:"integer"},x:{type:"number"},y:{type:"number"}},required:["n","x","y"]}}},required:["hotspots"]}));

const sh = (cmd) => execSync(cmd, { encoding: "utf8", stdio: ["pipe","pipe","pipe"] });

function codexHotspots(work){
  const cues = (work.cues||[]).map((c,i)=>`${i+1}) ${c}`).join("; ");
  const prompt = `The attached image is an artwork titled "${work.title}". Diagnostic cues (1-indexed): ${cues}. For EACH cue that points to a single locatable visible feature in the image, output {n,x,y} where n is the cue's 1-based index and x,y are percentages (0-100) of image width/height anchored to that feature. Skip cues that are pure material/technique with no single visible location. Output JSON {"hotspots":[...]}.`;
  const last = join(mkdtempSync(join(tmpdir(),"hc-")),"last.json");
  try{
    execFileSync("codex",["exec","-s","read-only","--skip-git-repo-check","--color","never","-i",work.path,"--output-schema",SCHEMA,"-o",last,prompt],
      {stdio:["ignore","ignore","ignore"],timeout:180000});
    const j = JSON.parse(readFileSync(last,"utf8"));
    const hs = (j.hotspots||[]).filter(h=>h&&Number.isFinite(h.x)&&Number.isFinite(h.y)&&h.x>=0&&h.x<=100&&h.y>=0&&h.y<=100&&Number.isInteger(h.n))
      .map(h=>({n:h.n,x:Math.round(h.x*10)/10,y:Math.round(h.y*10)/10}));
    return hs;
  }catch(e){ console.error("codex failed for",work.id,String(e).slice(0,120)); return null; }
}

async function pool(items, fn, n){
  const out=new Array(items.length); let i=0;
  async function worker(){ while(i<items.length){ const k=i++; out[k]=await fn(items[k],k); } }
  await Promise.all(Array.from({length:Math.min(n,items.length)},worker));
  return out;
}

function gitCommit(total,doPush){
  for(let t=0;t<4;t++){
    try{
      sh(`git add data/hotspots.js`);
      sh(`git -c user.name="Kathryn Swint" -c user.email="kathryn.swint@gmail.com" commit -q -m "Add look-closer hotspots batch (${total}) [codex]\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`);
      if(doPush){ try{ sh(`git pull --rebase -q`); }catch{} sh(`git push -q`); }
      return true;
    }catch(e){ console.error("git retry",t,String(e).slice(0,100)); execSync("sleep 3"); }
  }
  return false;
}

let round=0;
while(true){
  const out = JSON.parse(sh(`node scripts/next-hotspots.mjs ${BATCH}`));
  if(!out.batch || out.batch.length===0 || out.remaining===0){ console.log(`DONE. remaining=${out.remaining}`); break; }
  const results = await pool(out.batch, w=>codexHotspots(w), CONCURRENCY);
  if(results.every(r=>r===null)){ console.error("all codex calls failed (token limit?), stopping — re-run to resume"); break; }
  const merged={};
  out.batch.forEach((w,k)=>{ const hs=results[k]; if(hs!==null) merged[w.id]=hs; }); // store [] too → marks zero-hotspot works done
  writeFileSync("/tmp/hot/out.json", JSON.stringify(merged));
  const saveOut = sh(`node scripts/save-hotspots.mjs`).trim();
  const m = saveOut.match(/total (\d+\/\d+)/);
  console.log(`round ${++round}: ${saveOut}`);
  gitCommit(m?m[1]:"?", round%12===0);
}
