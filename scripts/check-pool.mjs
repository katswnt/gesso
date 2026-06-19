// Single fail-closed gate for the recurring pool data-quality bugs. Run after ANY pool change:
//   node scripts/check-pool.mjs        (exits 1 if any HARD violation — wire into npm test / pre-commit / CI)
// LOCAL only (no network); the creator-death copyright check is scripts/audit-copyright.mjs (Wikidata).
import { readFileSync } from "node:fs";
import { readGlobal } from "./lib/static-module.mjs";
import { simplifyMedium } from "./lib/domain.mjs";

const pool = readGlobal("data/pool.js","ARTEFACTUM_POOL");
const html = readFileSync("index.html","utf8");
const movKeys = new Set([...html.slice(html.indexOf("const MOVEMENTS={"),html.indexOf("const MOV_FAMILY=")).matchAll(/"([^"]+)":\{dates:/g)].map(m=>m[1]));
let fame={}; try{ const f=readFileSync("data/fame.js","utf8"); fame=JSON.parse(f.slice(f.indexOf("{"),f.lastIndexOf("}")+1)); }catch{}
const fa = p => fame[p.id]!=null?fame[p.id]:(p.fame||0);

const BUCKETS = new Set(["Oil paint","Tempera","Fresco","Watercolor","Ink","Drawing","Woodblock print","Bronze","Copper","Marble","Stone","Wood","Ivory","Jade","Ceramic","Glass","Textile","Gold","Silver","Lacquer","Photograph","Mixed media"]);
// styles that are really a nationality / country / region, not a movement-or-culture
const BAD_STYLE = /^(americans?|koreans?|chinese|austrian|turkey|ethiopia|colombia|arab world|africa|democratic republic|sierra leone|holy roman empire|netherlandish|contemporary art)$/i;
// living / died-after-1955 artists that must never be in the pool (museum-API works the SPARQL audit skips)
const IC_ARTIST = /Georgia O.?Keeffe|Marcel Breuer|Berndt Friberg|Walter Gropius|Lyonel Feininger|Edward Steichen|Ravinder Reddy|Pablo Picasso|Salvador Dal[ií]|Andy Warhol|Roy Lichtenstein|Jackson Pollock|Ren[ée] Magritte|Frida Kahlo|Mark Rothko|Edward Hopper|Diego Rivera/i;

const hard=[], warn=[];
const add=(arr,cat,p,note)=>arr.push(`[${cat}] ${(p.title||"?").slice(0,40)} — ${p.artist||"anon"}${note?" · "+note:""}`);

for(const p of pool){
  // MEDIUM: simplified value must be a real bucket (else it leaks as a junk guess-option)
  if(p.medium){ const ms=simplifyMedium(p.medium); if(ms && !BUCKETS.has(ms)){
    if(ms.split(" ").length>2 || /album|scroll|sheet|folio|volume|first of|\bpage\b|untitled|reformatted|fragment/i.test(ms)) add(hard,"medium-junk",p,`"${ms}"`);
    else add(warn,"medium-nonbucket",p,`"${ms}"`); /* single real material (Leather/Wax) — fine as an answer */ } }
  if(p.medium && /^[a-z]/.test(p.medium)) add(hard,"medium-lowercase",p,`"${p.medium}"`);
  // STYLE
  if(p.style && /^[a-z]/.test(p.style)) add(hard,"style-lowercase",p,`"${p.style}"`);
  if(p.style && BAD_STYLE.test(p.style.trim())) add(hard,"style-is-place",p,`"${p.style}"`);
  if(p.style && p.styleKind && !movKeys.has(p.style)) add(warn,"style-no-metadata",p,`"${p.style}"`);
  if(!p.style && fa(p)>=300) add(warn,"famous-no-movement",p,`fame ${Math.round(fa(p))}`);
  // ARTIST
  if(p.artist && /[぀-ヿ㐀-䶿一-鿿]/.test(p.artist)) add(hard,"artist-CJK",p,`"${p.artist}"`);
  if(p.artist && /^Q\d+$/.test(p.artist)) add(hard,"artist-qid",p,`"${p.artist}"`);
  // COPYRIGHT (local denylist; full check = audit-copyright.mjs)
  if(IC_ARTIST.test(p.artist||"")) add(hard,"in-copyright",p,`"${p.artist}"`);
  // SCHEMA integrity
  if(!p.img) add(hard,"no-image",p);
  if(p.place && (p.lat==null||p.lng==null)) add(warn,"place-no-coords",p,p.place);
}

const group=arr=>{const g={};for(const v of arr){const k=v.match(/^\[([^\]]+)\]/)[1];(g[k]=g[k]||[]).push(v);}return g;};
const report=(label,arr)=>{ const g=group(arr); console.log(`\n${label} (${arr.length}):`);
  for(const [k,v] of Object.entries(g).sort((a,b)=>b[1].length-a[1].length)){ console.log(`  ${k}: ${v.length}`); v.slice(0,4).forEach(x=>console.log("     "+x.replace(/^\[[^\]]+\] /,""))); } };

console.log(`=== check-pool: ${pool.length} works ===`);
report("⚠ HARD violations (block ship)", hard);
report("ℹ warnings (review)", warn);
console.log(`\n${hard.length?"❌ FAIL — "+hard.length+" hard violations":"✅ PASS — no hard violations"}`);
process.exit(hard.length?1:0);
