// Build data/fame.js (the runtime overlay) from data/fame.json with anti-collision guards.
// Fame = real recognizability only: 100*ln(sitelinks+1) + 12*ln(pageviews+1); unresolved -> 0.
// GUARD: anonymous works with a generic one-word/common-object title are zeroed — their Wikidata
// title-match almost always hit the *concept* article (e.g. "Mask", "Vessel") not the object.
// Run: node scripts/make-fame-js.mjs
import { readFileSync, writeFileSync } from "node:fs";
const pool = JSON.parse(readFileSync("data/pool.js","utf8").replace("window.ARTEFACTUM_POOL = ","").replace(/;\s*$/,""));
const fame = JSON.parse(readFileSync("data/fame.json","utf8"));
const ln=Math.log;

const GENERIC = new Set(["mask","vessel","head","jar","bowl","figure","figurine","plate","dish","cup","vase","bottle",
  "fragment","fragments","statuette","statue","relief","panel","tile","box","ring","pendant","bead","beads","coin",
  "seal","stele","stela","sculpture","painting","drawing","portrait","untitled","amulet","plaque","jug","ewer","flask",
  "censer","mirror","comb","buckle","brooch","necklace","earring","bracelet","vessel fragment","shabti","scarab",
  "textile","fragment of a textile","tapestry","cup and saucer","teapot","candlestick","incense burner","altarpiece"]);
const isGeneric = t => GENERIC.has(String(t||"").toLowerCase().replace(/[.,;:!?'"`’]/g,"").trim());

let zeroed=0;
const o={};
// iterate the POOL (not just fame.json) so freshly-promoted works get a CONSISTENT formula score:
// use fame.json's sitelinks/pageviews if present, else fall back to the work's own fame (= Wikidata sitelinks).
for(const p of pool){
  const e=fame[p.id]||{};
  const sl=Number.isFinite(e.sitelinks)?e.sitelinks:(Number.isFinite(p.fame)?p.fame:0);
  const pv=Number.isFinite(e.pageviews)?e.pageviews:0;
  let f = 100*ln(sl+1) + 12*ln(pv+1);
  if(f>0 && !p.artist && isGeneric(p.title)){ f=0; zeroed++; } // generic-title concept-collision guard
  o[p.id]=Math.round(f*10)/10;
}
writeFileSync("data/fame.js","window.ARTEFACTUM_FAME="+JSON.stringify(o)+";\n");
console.log("wrote data/fame.js |", Object.keys(o).length, "scores |", Object.values(o).filter(v=>v>0).length, "with fame>0 | zeroed", zeroed, "generic-title collisions");
