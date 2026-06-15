// Proactive vocabulary audit: dump every distinct movement / culture / medium with counts and flag
// suspect values (vague labels, type mismatches, variant clusters, raw Q-ids, casing, implausible).
// Read-only. Run: node scripts/audit-vocab.mjs  → prints report + writes data/incoming/vocab-audit.json
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const pool = JSON.parse(readFileSync("data/pool.js","utf8").match(/\[[\s\S]*\]/)[0]);
mkdirSync("data/incoming",{recursive:true});
const tally=(f)=>{const m={};for(const p of pool){const v=f(p);if(v)m[v]=(m[v]||0)+1;}return m;};
const movements=tally(p=>p.styleKind==="movement"?p.style:null);
const cultures=tally(p=>p.styleKind==="culture"?p.style:null);
const mediums=tally(p=>p.medium);

// shared flaggers
const VAGUE=/^\d{1,2}(st|nd|rd|th)[- ]century|^(north|south|east|west|central)?\s*(europe|asia|africa|america|american|european|asian|african|western|eastern|oceania)$|colonial|federal era|antebellum/i;
const CULTURE_WORDS=/\b(dynasty|period|empire|kingdom|people|peoples|culture|civilization|caliphate|sultanate)\b/i;
const MOVEMENT_ISM=/(ism|esque)$|^(baroque|rococo|gothic|mannerism|cubism|fauvism|surrealism|romanticism|realism|impressionism|expressionism|symbolism|pointillism|futurism|dadaism|suprematism|constructivism|minimalism)/i;
const variantClusters=(obj)=>{const norm=s=>s.toLowerCase().replace(/\b(empire|art|culture|period|dynasty|civilization|style|painting|sculpture|peoples?|the)\b/g,"").replace(/[^a-z]/g,"").trim();
  const g={};for(const s of Object.keys(obj)){const k=norm(s);if(k)(g[k]=g[k]||[]).push(s);}return Object.values(g).filter(v=>v.length>1);};

function audit(name,obj,kind){
  const keys=Object.keys(obj); const flags={};
  const add=(cat,v)=>{(flags[cat]=flags[cat]||[]).push(v+" ("+obj[v]+")");};
  for(const v of keys){
    if(/^Q\d+$/.test(v)) add("rawQid",v);
    if(v.includes(";")) add("semicolon",v);
    if(/^[a-z]/.test(v)) add("lowercaseStart",v);
    if(/\b[A-Z]{3,}\b/.test(v)) add("allcaps",v);
    if(v.length>45) add("tooLong",v);
    if(kind!=="medium"){
      if(VAGUE.test(v)) add("vague",v);
      if(/architect/i.test(v)) add("architecture",v);
      if(kind==="movement"&&CULTURE_WORDS.test(v)) add("shouldBeCulture",v);
      if(kind==="culture"&&MOVEMENT_ISM.test(v)) add("shouldBeMovement",v);
    } else {
      if(/[;,].*[;,]/.test(v)||/\b(and|with|over|on a|inlaid|traces of)\b/i.test(v)&&v.length>30) add("verboseMedium",v);
    }
  }
  const clusters=variantClusters(obj);
  console.log("\n===== "+name+" ("+keys.length+" distinct) =====");
  for(const c in flags){console.log("  ["+c+"] "+flags[c].length);flags[c].slice(0,30).forEach(x=>console.log("      "+x));}
  if(clusters.length){console.log("  [variantClusters] "+clusters.length);clusters.forEach(v=>console.log("      "+v.map(s=>s+"("+obj[s]+")").join("  ||  ")));}
  return {flags,clusters};
}
const out={
  movements:audit("MOVEMENTS",movements,"movement"),
  cultures:audit("CULTURES",cultures,"culture"),
  mediums:audit("MEDIUMS",mediums,"medium"),
  counts:{movements:Object.keys(movements).length,cultures:Object.keys(cultures).length,mediums:Object.keys(mediums).length},
  raw:{movements,cultures,mediums}
};
writeFileSync("data/incoming/vocab-audit.json",JSON.stringify(out,null,1));
console.log("\nwrote data/incoming/vocab-audit.json");
