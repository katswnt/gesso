// Merge enrichment shard files (data/incoming/enrich/shard-*.json, each {id:{why,cues,guide}})
// into data/teach-works.js, overlaying existing entries. Validates each; records unfinished works.
// Run: node scripts/merge-enrich.mjs
import { readFileSync, writeFileSync, readdirSync } from "node:fs";

const TW = "data/teach-works.js";
const s = readFileSync(TW, "utf8");
const map = JSON.parse(s.slice(s.indexOf(".work=") + 6, s.lastIndexOf("};") + 1));

const valid = e => e && typeof e.why === "string" && e.why.trim() &&
  Array.isArray(e.cues) && e.cues.length === 4 && e.cues.every(c => typeof c === "string" && c.includes("→")) &&
  Array.isArray(e.guide) && e.guide.length >= 5 && e.guide.every(g => g && g.q && g.a);

const merged = new Set();
let added = 0, skipped = 0;
for (const f of readdirSync("data/incoming/enrich").filter(f => /^shard-\d+\.json$/.test(f))) {
  const obj = JSON.parse(readFileSync(`data/incoming/enrich/${f}`, "utf8"));
  for (const [id, e] of Object.entries(obj)) {
    if (valid(e)) { map[id] = e; merged.add(id); added++; }
    else { skipped++; console.error(`  skip invalid: ${f} ${id}`); }
  }
}

// which of the requested 500 are still unfinished → REMAINING.json (full records, re-runnable)
const input = JSON.parse(readFileSync("data/incoming/enrich/input.json", "utf8"));
const remaining = input.filter(w => !merged.has(w.id));
writeFileSync("data/incoming/enrich/REMAINING.json", JSON.stringify(remaining));

writeFileSync(TW, `window.ARTEFACTUM_CUES=window.ARTEFACTUM_CUES||{};\nwindow.ARTEFACTUM_CUES.work=${JSON.stringify(map)};\n`);
console.log(`merged ${added} entries (skipped ${skipped} invalid) | total now ${Object.keys(map).length} | remaining unfinished: ${remaining.length} → data/incoming/enrich/REMAINING.json`);
