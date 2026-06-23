// Merge vision pin output into teach-works.js (note x/y) + hotspots.js. Input files: arrays of
// {id, pins:[{i,x,y}]} where i = note index. Sets that note's x/y and builds the hotspots entry.
// Usage: node scripts/merge-hotspots.mjs <out1.json> [out2.json ...]
import { readFileSync, writeFileSync } from "node:fs";
const files = process.argv.slice(2);
const pt = readFileSync("data/teach-works.js", "utf8");
const teach = JSON.parse(pt.slice(pt.indexOf("{", pt.indexOf(".work")), pt.lastIndexOf("}") + 1));
const ht = readFileSync("data/hotspots.js", "utf8");
const hot = JSON.parse(ht.slice(ht.indexOf("{"), ht.lastIndexOf("}") + 1));
const ok = v => typeof v === "number" && isFinite(v) && v >= 0 && v <= 100;
let works = 0, pins = 0, skip = 0;
for (const f of files) {
  let arr; try { arr = JSON.parse(readFileSync(f, "utf8")); } catch (e) { console.error("bad", f, e.message); continue; }
  for (const r of arr) {
    if (!r || !r.id || !Array.isArray(r.pins) || !r.pins.length) { skip++; continue; }
    const c = teach[r.id]; if (!c || !Array.isArray(c.notes)) { skip++; continue; }
    const hs = [];
    for (const p of r.pins) {
      if (!ok(p.x) || !ok(p.y)) continue;
      const idx = p.i;
      if (typeof idx === "number" && c.notes[idx]) { c.notes[idx].x = p.x; c.notes[idx].y = p.y; }
      hs.push({ n: hs.length + 1, x: p.x, y: p.y });
    }
    if (hs.length) { hot[r.id] = hs; pins += hs.length; works++; }
  }
}
writeFileSync("data/teach-works.js", "window.ARTEFACTUM_CUES=window.ARTEFACTUM_CUES||{};\nwindow.ARTEFACTUM_CUES.work=" + JSON.stringify(teach) + ";\n");
writeFileSync("data/hotspots.js", "window.ARTEFACTUM_HOTSPOTS=" + JSON.stringify(hot) + ";\n");
console.error(`hotspots merged: ${works} works, ${pins} pins | skipped ${skip} (no pins / wrong-image)`);
