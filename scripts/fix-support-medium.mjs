// Fix works whose `medium` is a SUPPORT material (Wood/Panel/Canvas/Copper/Cardboard…) when it should
// be the PAINT medium. Re-reads Wikidata P186 (material) and, if a paint material is present (oil,
// tempera, watercolor…), sets medium to that. Leaves genuine wood/metal SCULPTURES alone (no paint
// material → kept). Run: node scripts/fix-support-medium.mjs
import { readFileSync, writeFileSync } from "node:fs";
const UA="GessoMediumFix/1.0 (kathryn.swint@gmail.com)";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const qid=id=>{const m=String(id).match(/Q\d+/);return m?m[0]:null;};
async function wd(u){for(let t=0;t<5;t++){try{const r=await fetch(u,{headers:{"User-Agent":UA}});if(r.status===429||r.status>=500){await sleep(1500*(t+1));continue;}if(!r.ok)return null;return await r.json();}catch(e){await sleep(900);}}return null;}
// paint-medium detector on a material label → canonical medium name (else null = support/non-paint)
const PAINT=l=>{l=l.toLowerCase();
  if(/\boil\b/.test(l))return"Oil paint"; if(/tempera|distemper/.test(l))return"Tempera"; if(/fresco/.test(l))return"Fresco";
  if(/water-?colou?r|aquarelle/.test(l))return"Watercolor"; if(/gouache/.test(l))return"Gouache";
  if(/acrylic/.test(l))return"Acrylic"; if(/encaustic/.test(l))return"Encaustic";
  if(/\bink\b/.test(l))return"Ink"; if(/pastel|chalk|charcoal|graphite/.test(l))return"Drawing"; return null; };
const SUPPORT=/^(wood|panel|oak|poplar|canvas|copper|paper|board|cardboard|masonite|linen)$/i;

const raw=readFileSync("data/pool.js","utf8");
const pool=JSON.parse(raw.slice(raw.indexOf("["),raw.lastIndexOf("]")+1));
const targets=pool.filter(p=>SUPPORT.test((p.medium||"").trim())&&qid(p.id));
console.log("support-as-medium works with Q-id:",targets.length);

// 1) fetch P186 material Q-ids for each work (batched)
const matByWork={}; const allMat=new Set();
for(let i=0;i<targets.length;i+=45){ const batch=targets.slice(i,i+45);
  const j=await wd(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims&ids=${batch.map(p=>qid(p.id)).join("|")}`); await sleep(200);
  if(j&&j.entities) for(const p of batch){ const e=j.entities[qid(p.id)]; if(!e)continue;
    const mats=((e.claims&&e.claims.P186)||[]).map(c=>c.mainsnak.datavalue&&c.mainsnak.datavalue.value.id).filter(Boolean);
    matByWork[p.id]=mats; mats.forEach(m=>allMat.add(m)); }
  console.error(`  fetched materials ${Math.min(i+45,targets.length)}/${targets.length}`);
}
// 2) resolve material labels (batched)
const matLabel={}; const matIds=[...allMat];
for(let i=0;i<matIds.length;i+=50){ const batch=matIds.slice(i,i+50);
  const j=await wd(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=labels&languages=en&ids=${batch.join("|")}`); await sleep(150);
  if(j&&j.entities) for(const id of batch){ const e=j.entities[id]; matLabel[id]=e&&e.labels&&e.labels.en?e.labels.en.value:""; }
}
// 3) apply: if any material maps to a paint medium, use it (prefer oil>tempera>others by detector order)
const ORDER=["Oil paint","Tempera","Fresco","Watercolor","Gouache","Acrylic","Encaustic","Ink","Drawing"];
let fixed=0; const log=[], kept=[];
for(const p of targets){ const mats=matByWork[p.id]||[]; const paints=mats.map(m=>PAINT(matLabel[m]||"")).filter(Boolean);
  if(!paints.length){ kept.push(`${p.medium}: ${p.title.slice(0,40)}`); continue; } // genuine wood/metal object → keep
  const pick=ORDER.find(o=>paints.includes(o))||paints[0];
  if(pick!==p.medium){ log.push(`${p.medium}→${pick}  ${(p.artist||'—').slice(0,16)}  ${p.title.slice(0,34)}`); p.medium=pick; fixed++; }
}
writeFileSync("data/pool.js", raw.slice(0,raw.indexOf("["))+JSON.stringify(pool)+raw.slice(raw.lastIndexOf("]")+1));
writeFileSync("data/incoming/medium-fixes.json",JSON.stringify(log,null,1));
console.log(`\nfixed ${fixed} support→paint mediums | kept ${kept.length} (genuine wood/metal objects, no paint material)`);
console.log("sample fixes:"); log.slice(0,15).forEach(l=>console.log("  "+l));
console.log("sample kept:"); kept.slice(0,10).forEach(l=>console.log("  "+l));
