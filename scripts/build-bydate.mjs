// Add an explicit per-DATE daily lock to data/daily-order.js so re-freezes never disturb served days.
// byDate[YYYY-MM-DD][tier] = [5 work ids]. dailyItems() prefers byDate; falls back to the rotation.
// Dates <= today are generated from the OLD order (what players already saw); future from the NEW order.
// Re-runnable: existing byDate entries for dates <= today are PRESERVED; only future dates regenerate.
// Usage: node scripts/build-bydate.mjs [todayISO]   (default reads system date via arg; pass it explicitly)
import { readFileSync, writeFileSync } from "node:fs";
const TODAY_ISO = process.argv[2] || "2026-06-21";
const ROUNDS=5, TIERS=["easy","medium","hard","impossible"];
const parse=src=>JSON.parse(src.slice(src.indexOf("{"), src.lastIndexOf("}")+1));
const pool=JSON.parse(readFileSync("data/pool.js","utf8").replace("window.ARTEFACTUM_POOL = ","").replace(/;\s*$/,""));
const byId=Object.fromEntries(pool.map(p=>[p.id,p]));
const NEW=parse(readFileSync("data/daily-order.js","utf8"));
let OLD; try{ OLD=parse(readFileSync("/tmp/old-daily.js","utf8")); }catch{ OLD=NEW; }
const existingByDate = NEW.byDate || (()=>{ try{return parse(readFileSync("data/daily-order.js","utf8")).byDate||{};}catch{return {};} })();

const tkey=p=>String(p&&p.title||"").toLowerCase().replace(/[^a-z0-9]/g,"");
const akey=p=>{const a=String(p&&p.artist||"").trim().toLowerCase();return (a&&!/^(unknown|anon|unidentified)/.test(a))?a:"";};
function dayIdsFor(order,key,day){
  const perm=(order[key]||[]).map(id=>byId[id]).filter(Boolean); const len=perm.length; if(!len)return [];
  const start=((day*ROUNDS)%len+len)%len; const out=[],seen=new Set(),sa=new Set();
  for(let k=0;k<len&&out.length<ROUNDS;k++){ const p=perm[(start+k)%len]; if(!p)continue; const tk=tkey(p),ak=akey(p);
    if(seen.has(tk)||(ak&&sa.has(ak)))continue; seen.add(tk); if(ak)sa.add(ak); out.push(p.id); }
  return out;
}
const dayNum=iso=>Math.floor(Date.parse(iso+"T00:00:00")/86400000);
const isoFor=d=>new Date(d*86400000).toISOString().slice(0,10);
const today=dayNum(TODAY_ISO);

const byDate={};
for(let d=today-3; d<=today+180; d++){
  const iso=isoFor(d);
  if(existingByDate[iso] && d<=today){ byDate[iso]=existingByDate[iso]; continue; } // preserve already-served
  const order = d<=today ? OLD : NEW;       // lock past/today to what was served; future from current order
  const rec={}; for(const t of TIERS) rec[t]=dayIdsFor(order,t,d);
  byDate[iso]=rec;
}
NEW.byDate=byDate;
writeFileSync("data/daily-order.js","window.ARTEFACTUM_DAILY="+JSON.stringify(NEW)+";\n");
console.error(`byDate written: ${Object.keys(byDate).length} dates (${isoFor(today-3)} .. ${isoFor(today+180)}); today=${TODAY_ISO}`);
console.error("today easy ids:", byDate[TODAY_ISO].easy.map(id=>byId[id]?.title).join(" | "));
