// DRY triage of data/incoming/curate/review-queue.json — categorize each item WITHOUT changing anything,
// using deterministic sources (Wikidata batch queries + HTTP image tests). Reports how many auto-resolve
// before any agent tokens are spent. Writes verdicts to data/incoming/curate/triage.json.
//   node scripts/queue-triage.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { readGlobal } from "./lib/static-module.mjs";
import { continentOf } from "./lib/places.mjs";

const UA = "GessoQueueTriage/1.0 (kathryn.swint@gmail.com)";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const qid = id => { const m = String(id || "").match(/Q\d+/); return m ? m[0] : null; };
const norm = s => String(s || "").toLowerCase().replace(/[\s.,'’-]+/g, " ").trim();

const queue = JSON.parse(readFileSync("data/incoming/curate/review-queue.json", "utf8"));
const items = Array.isArray(queue) ? queue : (queue.items || Object.values(queue).flat());
const pool = readGlobal("data/pool.js", "ARTEFACTUM_POOL");
const byId = new Map(pool.map(p => [p.id, p]));

// ---- batch-fetch Wikidata facts for every wd-id in the queue ----
const qids = [...new Set(items.map(it => qid(it.id)).filter(Boolean))];
const wd = new Map(); // qid -> {label, years:Set, locs:Set, image}
async function sparql(qy){
  const u = "https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(qy);
  for(let t=0;t<5;t++){ try{
    const r = await fetch(u, { headers: { "User-Agent": UA, Accept: "application/sparql-results+json" } });
    if(r.status===429||r.status>=500){ await sleep(3000*(t+1)); continue; }
    if(!r.ok) return null; return await r.json();
  }catch{ await sleep(1500*(t+1)); } }
  return null;
}
console.error(`fetching Wikidata facts for ${qids.length} works...`);
for(let i=0;i<qids.length;i+=150){
  const batch = qids.slice(i,i+150);
  const values = batch.map(q=>"wd:"+q).join(" ");
  const j = await sparql(`SELECT ?work ?workLabel (YEAR(?inc) AS ?y) ?locLabel ?img WHERE {
    VALUES ?work { ${values} }
    OPTIONAL { ?work wdt:P571 ?inc. }
    OPTIONAL { ?work wdt:P1071 ?loc. ?loc rdfs:label ?locLabel. FILTER(LANG(?locLabel)="en") }
    OPTIONAL { ?work wdt:P18 ?img. }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
  }`);
  await sleep(400);
  for(const b of (j?.results?.bindings || [])){
    const q = qid(b.work?.value); if(!q) continue;
    if(!wd.has(q)) wd.set(q, { label:"", years:new Set(), locs:new Set(), image:"" });
    const e = wd.get(q);
    if(b.workLabel?.value && !/^Q\d+$/.test(b.workLabel.value)) e.label = b.workLabel.value;
    if(b.y?.value) e.years.add(parseInt(b.y.value,10));
    if(b.locLabel?.value) e.locs.add(b.locLabel.value);
    if(b.img?.value) e.image = b.img.value;
  }
  console.error(`  ${Math.min(i+150,qids.length)}/${qids.length}`);
}

// parse a proposed date field that may be "1884", "1884/86", "c. 1500", "1500-1510"
function dateRange(v){
  const nums = String(v).match(/\d{3,4}/g); if(!nums) return null;
  const a = parseInt(nums[0],10); let b = nums[1] ? parseInt(nums[1],10) : a;
  if(b < a) b = parseInt(String(a).slice(0,2)+String(nums[1]).padStart(2,"0"),10); // "1884/86" -> 1886
  return [a,b];
}

const verdict = { apply:[], discard:[], review:[] };
const put = (bucket,it,how)=>verdict[bucket].push({ ...it, how });

async function head(url){ try{ const r=await fetch(url,{method:"GET",headers:{"User-Agent":UA}}); return { code:r.status, type:r.headers.get("content-type")||"" }; }catch{ return {code:0,type:""}; } }

let imgChecked=0;
for(const it of items){
  const q = qid(it.id); const e = q && wd.get(q); const p = byId.get(it.id);
  if(it.type === "region"){
    // deterministic: does the CURRENT pool place's continent equal the proposed region?
    if(p && continentOf(p.place) === it.to) put("apply",it,"continentOf(place) confirms"); else put("review",it,"continent mismatch");
  } else if(it.type === "title"){
    if(!e || !e.label) put("review",it,"no wikidata label");
    else if(norm(e.label) === norm(it.to)) put("apply",it,"wikidata label == proposed");
    else if(norm(e.label) === norm(it.from)) put("discard",it,"wikidata label == current (flag stale)");
    else put("review",it,`wikidata label "${e.label}" differs from both`);
  } else if(it.type === "date"){
    const r = dateRange(it.to); const yrs=[...(e?.years||[])];
    if(!yrs.length || !r) put("review",it,"no wikidata inception");
    else if(yrs.some(y=>y>=r[0]&&y<=r[1])) put("apply",it,`wikidata year ${yrs[0]} within proposed`);
    else if(yrs.includes(Number(it.from))) put("discard",it,"wikidata confirms current year (flag stale)");
    else put("review",it,`wikidata year ${yrs[0]} matches neither`);
  } else if(it.type === "place"){
    const locs=[...(e?.locs||[])].map(norm);
    if(!locs.length) put("review",it,"no wikidata location");
    else if(locs.some(l=>norm(it.to).includes(l)||l.includes(norm(it.to).split(" ")[0]))) put("apply",it,"wikidata location supports proposed");
    else put("review",it,"wikidata location doesn't confirm");
  } else if(it.type === "image"){
    imgChecked++;
    const cur = p && p.img ? await head(p.img) : {code:0};
    if(it.issue && /wrong-art|wrong-work|cropped|composite|detail/.test(it.issue+it.reason)) put("review",it,"content judgment — needs eyes");
    else if(cur.code===200 && /image\//.test(cur.type)) put("discard",it,"current image loads fine (transient failure)");
    else if(e && e.image) put("apply",it,`replace with Wikidata P18: ${e.image}`);
    else put("review",it,`image dead (${cur.code}), no P18 fallback`);
    await sleep(150);
  } else if(it.type === "style-unmapped"){
    put("review",it,"needs movement registration (dates/region/palette)");
  } else put("review",it,"unknown type");
}

const sum = b => { const t={}; for(const x of verdict[b]) t[x.type]=(t[x.type]||0)+1; return t; };
console.log("\n===== TRIAGE (dry) =====");
console.log(`AUTO-APPLY  ${verdict.apply.length}\t`, JSON.stringify(sum("apply")));
console.log(`DISCARD     ${verdict.discard.length}\t`, JSON.stringify(sum("discard")), "(stale flags — current data already correct)");
console.log(`NEEDS-EYES  ${verdict.review.length}\t`, JSON.stringify(sum("review")));
writeFileSync("data/incoming/curate/triage.json", JSON.stringify(verdict,null,1));
console.log("\nwrote data/incoming/curate/triage.json (nothing applied — dry run)");
