// Pre-publish FAME AUDIT — eyeball the Easy tier + flag likely fame bugs before deploying.
// Run: node scripts/check-fame.mjs
import { readFileSync } from "node:fs";
const pool = JSON.parse(readFileSync("data/pool.js","utf8").replace("window.ARTEFACTUM_POOL = ","").replace(/;\s*$/,""));
const fame = JSON.parse(readFileSync("data/fame.json","utf8"));
const overlay = JSON.parse(readFileSync("data/fame.js","utf8").replace("window.ARTEFACTUM_FAME=","").replace(/;\s*$/,""));
const fameOf = id => overlay[id]||0;
const n = pool.length;
const cuts=[0, Math.round(n*0.10), Math.round(n*0.35), Math.round(n*0.65), n];
const ranked = pool.map(p=>({p,fame:fameOf(p.id),e:fame[p.id]||{}})).sort((a,b)=>b.fame-a.fame);
const easy = ranked.slice(0, cuts[1]);

console.log(`pool ${n} | tiers: easy ${cuts[1]} / med ${cuts[2]-cuts[1]} / hard ${cuts[3]-cuts[2]} / imp ${n-cuts[3]}`);
console.log(`works with real fame (>0): ${ranked.filter(r=>r.fame>0).length}`);

console.log("\n=== EASY tier — eyeball these (top 25) ===");
ranked.slice(0,25).forEach(r=>console.log("  "+String(Math.round(r.fame)).padStart(4),"sl="+String(r.e.sitelinks??"-").padStart(3),(r.p.artist||"anon").slice(0,18).padEnd(19),r.p.title.slice(0,36)));

// FLAG 1: anonymous works high in Easy (title-collision false-positive risk)
const anonEasy = easy.filter(r=>!r.p.artist && r.fame>0);
console.log(`\n[FLAG] anonymous works in Easy with fame>0 (collision risk): ${anonEasy.length}`);
anonEasy.slice(0,12).forEach(r=>console.log("  "+String(Math.round(r.fame)).padStart(4),"sl="+(r.e.sitelinks??"-"),"|",r.p.title.slice(0,42)));

// FLAG 2: low-sitelink works that still made Easy
const lowSl = easy.filter(r=>(r.e.sitelinks||0)<5);
console.log(`\n[FLAG] Easy works with <5 sitelinks (weak signal): ${lowSl.length}`);

// FLAG 3: duplicate titles (one resolved/famous, another not → possible mis-resolution)
const byTitle={}; for(const p of pool){ const k=p.title.toLowerCase().trim(); (byTitle[k]=byTitle[k]||[]).push(p); }
const dupFamous = Object.entries(byTitle).filter(([k,ps])=>ps.length>1 && ps.some(p=>fameOf(p.id)>200));
console.log(`\n[FLAG] shared titles where one copy is "famous" (collision suspects): ${dupFamous.length}`);
dupFamous.slice(0,8).forEach(([k,ps])=>console.log("  "+k.slice(0,30)+" ×"+ps.length+"  fames="+ps.map(p=>Math.round(fameOf(p.id))).join("/")));

// FLAG 4: allowlist — these MUST be in Easy; denylist — these must NOT be
const must=["Mona Lisa","The Starry Night","The Night Watch","American Gothic","Guernica","The Scream","Las Meninas"];
const easyTitles=new Set(easy.map(r=>r.p.title));
const missing=must.filter(t=>![...easyTitles].some(et=>et.includes(t)));
console.log(`\n[CHECK] famous works present in pool but NOT in Easy:`);
must.forEach(t=>{ const found=pool.find(p=>p.title.includes(t)); if(found) console.log("  "+(easyTitles.has(found.title)?"✓":"✗ MISSING")+" "+t+" (fame "+Math.round(fameOf(found.id))+")"); });
console.log("\nReview the flags above before deploying. High anonymous/low-sitelink counts in Easy = fame bugs to fix.");
