// Normalize over-long / date-spoiling style & culture strings in pool.js.
// Strips parenthetical date ranges, century/year tails, "X to Y period", canonicalizes demonyms,
// caps length. Writes pool.js back; emits data/incoming/restyled.json (works whose style changed)
// so their teach notes can be regenerated. Run: node scripts/clean-style.mjs
import { readFileSync, writeFileSync } from "node:fs";
const pool = JSON.parse(readFileSync("data/pool.js","utf8").replace("window.ARTEFACTUM_POOL = ","").replace(/;\s*$/,""));
function clean(s){
  if(!s) return s; let x=String(s);
  x=x.replace(/\s*\([^)]*\d[^)]*\)/g,'');                 // (1392–1573)
  x=x.replace(/,?\s*\d{1,2}(st|nd|rd|th)(\s*[–-]\s*\d{1,2}(st|nd|rd|th)?)?\s*century\b.*$/i,''); // ", 10th-16th century…"
  x=x.replace(/\s+to\s+.+$/i,'');                          // "… to Momoyama period"
  x=x.replace(/,?\s*(early|mid|late|c\.?)?\s*\d{3,4}\s*(b\.?c\.?e?\.?|ce|ad|bc)?\b.*$/i,''); // trailing years
  x=x.replace(/[\s,]+$/,'').trim();
  // over-long: drop any parenthetical detail, then keep the first 1-2 comma segments (no dangling "(")
  if(x.length>34){ x=x.replace(/\s*\(.*$/,'').trim(); const seg=x.split(',').map(t=>t.trim()).filter(Boolean); x=seg[0]+(seg[1]&&(seg[0].length+seg[1].length<30)?', '+seg[1]:''); }
  x=x.replace(/\s*\([^)]*$/,'').replace(/[\s,]+$/,'').trim(); // strip any unclosed paren tail
  return x.trim()||s;
}
let changed=[];
for(const p of pool){ if(!p.style) continue; const c=clean(p.style); if(c!==p.style){ changed.push({...p,_old:p.style,style:c}); p.style=c; } }
writeFileSync("data/pool.js","window.ARTEFACTUM_POOL = "+JSON.stringify(pool)+";\n");
writeFileSync("data/incoming/restyled.json", JSON.stringify(changed.map(({_old,...p})=>p)));
console.log(`cleaned ${changed.length} style strings; wrote pool.js + data/incoming/restyled.json`);
changed.slice(0,15).forEach(c=>console.log(`  "${c._old}" -> "${c.style}"`));
