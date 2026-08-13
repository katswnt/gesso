// Vision-pass-v2 MERGE. Folds the image-grounded subagent outputs (/tmp/v2/out/out-*.json) into a consolidated
// data/vision.js record, writes a REVIEWABLE flags backlog (metadata corrections / playability / wrong-image /
// movement suggestions — never auto-applied), validates all bboxes to [0,1], and prints the cross-check:
// vision-derived movement/medium vs the text-pass values already in the pool, so we can judge quality.
//   node scripts/vision-v2-merge.mjs
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";

const w = {}; new Function("window", readFileSync("data/pool.js", "utf8"))(w);
const byId = {}; for (const p of w.ARTEFACTUM_POOL) { byId[p.id] = p; const m = String(p.id).match(/Q\d+/); if (m) byId["wikidata:" + m[0]] = byId["http://www.wikidata.org/entity/" + m[0]] = p; }
const pool = id => byId[id] || (String(id).match(/Q\d+/) && byId["wikidata:" + String(id).match(/Q\d+/)[0]]) || null;

let outs = [];
try { for (const f of readdirSync("/tmp/v2/out")) if (f.endsWith(".json")) { const j = JSON.parse(readFileSync("/tmp/v2/out/" + f, "utf8")); outs.push(...(Array.isArray(j) ? j : j.works || [])); } } catch (e) { console.error("no outputs in /tmp/v2/out:", e.message); process.exit(1); }
console.log(`subagent outputs: ${outs.length} works\n`);

const inBox = b => Array.isArray(b) && b.length === 4 && b.every(n => typeof n === "number" && n >= 0 && n <= 1.001);
let badBox = 0;
const vision = {}, flags = [];
for (const o of outs) {
  const id = o.id; if (!id) continue; const p = pool(id) || {};
  // validate/clean bboxes on evidence, pins, delights
  const cleanEv = {}; for (const [f, arr] of Object.entries(o.evidence || {})) cleanEv[f] = (arr || []).map(e => { if (e.bbox && !inBox(e.bbox)) { badBox++; delete e.bbox; } return e; });
  const pins = (o.pins || []).filter(pn => pn && typeof pn.x === "number" && typeof pn.y === "number");
  const delights = (o.delights || []).map(d => { if (d.bbox && !inBox(d.bbox)) { badBox++; delete d.bbox; } return d; });
  vision[id] = { seen: o.seen, evidence: cleanEv, pins, palette: o.palette, format: o.format, figures: o.figures,
    pose: o.pose_gesture, delights, signature: o.signature, condition: o.condition, artifacts: o.artifacts,
    image_quality: o.image_quality, recognized: o.recognized, guessability: o.guessability, movement_suggestion: o.movement_suggestion,
    notes: (o.notes && o.notes !== "keep") ? o.notes : undefined };
  // flags backlog (reviewed before any pool change)
  if (o.consistent === false) flags.push({ id, title: p.title, kind: "wrong-image", seen: o.seen });
  if (o.playable === false) flags.push({ id, title: p.title, kind: "unplayable", why: o.playable_why || o.condition });
  if (o.metadata_flags && Object.keys(o.metadata_flags).length) flags.push({ id, title: p.title, kind: "metadata", flags: o.metadata_flags });
}
mkdirSync("data/incoming", { recursive: true });
writeFileSync("data/vision.js", "window.ARTEFACTUM_VISION=" + JSON.stringify(vision) + ";\n");
writeFileSync("data/incoming/vision-v2-flags.json", JSON.stringify(flags, null, 1));
console.log(`wrote data/vision.js (${Object.keys(vision).length} works) · flags backlog ${flags.length} · dropped ${badBox} out-of-range bboxes\n`);

// CROSS-CHECK: vision movement vs the text-pass style already in the pool
const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
let agree = 0, disagree = [], nostyle = 0;
for (const o of outs) { const p = pool(o.id); if (!p) continue; const cur = p.style, sug = o.movement_suggestion;
  if (!sug) continue; if (!cur) { nostyle++; continue; }
  if (norm(cur) === norm(sug) || norm(cur).includes(norm(sug)) || norm(sug).includes(norm(cur))) agree++;
  else disagree.push({ title: (p.title || o.id).slice(0, 30), pool: cur, vision: sug }); }
console.log(`=== cross-check: vision movement vs pool style ===`);
console.log(`agree: ${agree} · disagree: ${disagree.length} · pool had no style: ${nostyle}`);
disagree.slice(0, 20).forEach(d => console.log(`  ${d.title.padEnd(30)} pool="${d.pool}"  vision="${d.vision}"`));
console.log(`\nflags to review (wrong-image / unplayable / metadata): data/incoming/vision-v2-flags.json`);
const rec = outs.filter(o => o.recognized).length, gLow = outs.filter(o => o.guessability && Object.values(o.guessability).every(v => v <= 20)).length;
console.log(`recognized by model: ${rec}/${outs.length} · near-unguessable (playability-floor candidates): ${gLow}`);
