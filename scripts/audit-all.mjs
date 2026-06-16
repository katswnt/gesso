// Run the full audit suite + print a consolidated summary. Read-only (flags only, fixes nothing).
// Auto-invoked at the end of imports (promote-canon/harvest, consolidate --merge); also run manually:
//   node scripts/audit-all.mjs            (fast + P31 instance-of)
//   node scripts/audit-all.mjs --images   (also the slow Commons broken-image scan)
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
const run=(label,cmd)=>{ console.log(`\n━━━━━━ ${label} ━━━━━━`); try{ execSync(cmd,{stdio:"inherit"}); }catch(e){ console.log("  ⚠ audit errored (continuing):",e.message); } };
const jlen=(f,pick)=>{ try{ const j=JSON.parse(readFileSync(f,"utf8")); const v=pick?pick(j):j; return Array.isArray(v)?v.length:Object.keys(v).length; }catch{ return null; } };

run("Data audit — origin / fame / entities / dups / images / missing", "node scripts/audit-data.mjs");
run("Vocabulary audit — movements / cultures / mediums", "node scripts/audit-vocab.mjs");
run("P31 instance-of audit — wrong-entity collisions / non-artworks", "node scripts/audit-p31.mjs");
if(process.argv.includes("--images")) run("Broken-image scan — Commons API (slow)", "node scripts/check-images.mjs");

// ---- consolidated summary, split into actionable vs informational ----
const A="data/incoming/audit/", row=(k,n)=>console.log("  "+String(n==null?"—":n).padStart(5)+"  "+k);
const v=existsSync("data/incoming/vocab-audit.json")?JSON.parse(readFileSync("data/incoming/vocab-audit.json","utf8")):null;
const fcat=(o,cats)=>o?cats.reduce((a,c)=>a+((o.flags&&o.flags[c]||[]).length),0):null;
const allFlags=o=>o?Object.values(o.flags||{}).reduce((a,x)=>a+x.length,0):0;

console.log("\n══════ ⚠ REVIEW (likely real issues) ══════");
row("P31 wrong-entity / non-artwork", jlen("data/incoming/p31-flags.json"));
row("fame collisions",                jlen(A+"fameCollision.json"));
row("non-artwork entities",           jlen(A+"entities.json"));
row("shared images (true dups)",      jlen(A+"sharedImage.json"));
row("bad image filenames",            jlen(A+"badImageName.json"));
row("missing fields (place/img/etc)", jlen(A+"missing.json"));
if(v){ row("vocab movement issues", allFlags(v.movements)+(v.movements.clusters?.length||0));
  row("vocab culture issues",  allFlags(v.cultures)+(v.cultures.clusters?.length||0));
  row("medium variants/junk",  (v.mediums.clusters?.length||0)+fcat(v.mediums,["rawQid","lowercaseStart","allcaps"])); }
if(existsSync("data/incoming/broken-images.json")) row("broken images", jlen("data/incoming/broken-images.json"));

console.log("\n── ℹ informational (usually expected) ──");
row("artist-origin (worked-abroad false-pos)", jlen(A+"artistOrigin.json"));
row("same-title works (mostly distinct sets)", jlen(A+"dupTitleArtist.json"));
if(v) row("verbose catalog mediums (kept by design)", fcat(v.mediums,["verboseMedium","tooLong","semicolon"]));

console.log("\nDetails: data/incoming/audit/*.json · vocab-audit.json · p31-flags.json"+(existsSync("data/incoming/broken-images.json")?" · broken-images.json":""));
console.log("(Read-only — nothing changed. Address ⚠ items, then re-run.)");
