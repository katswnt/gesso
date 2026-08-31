#!/usr/bin/env node
// Human field-level review → approved.json (G-03). The tool-less runner's completions are QUARANTINED; nothing is
// applied until a human approves. This script does NOT judge — it only binds a human's explicit decisions to the
// run's hashes so curate-merge can apply them safely.
//   node scripts/vision-review.mjs <runDir>                      → writes review-draft.json for the human to inspect
//   node scripts/vision-review.mjs <runDir> --approve <dec.json> → builds approved.json from the human's decisions
// decisions.json = { "items": [ { "id": "...", "approved": { ...a subset of the completion's OWN result to apply:
//   image, playable, imageQuality, framing, mediumLegible, fields?, notes, noPins? ... } } ] }
// SELECT-ONLY (secure default): the human chooses WHICH of the model's fields to apply — every approved value must
// match the reviewed completion VERBATIM. Editing/correcting a value is NOT allowed via this path (a mismatch is
// refused before anything is written; corrections are a separate, deferred human-authored capability). approved.json
// is bound to the run header + each image's sha + the reviewed completion file's sha, and self-checked.
import { readFileSync, writeFileSync, openSync, writeSync, closeSync, rmSync } from "node:fs";
import { join } from "node:path";
import { validateApprovedPatch, verifyApproval, completionFile, sha256, canonicalJson } from "./lib/vision-run.mjs";

const runDir = process.argv[2];
if (!runDir) { console.error("usage: vision-review.mjs <runDir> [--approve <decisions.json>]"); process.exit(1); }
const manifest = JSON.parse(readFileSync(join(runDir, "manifest.json"), "utf8"));
const byId = new Map(manifest.items.map(m => [m.id, m]));

const ai = process.argv.indexOf("--approve");
if (ai < 0) {
  // emit a draft of the quarantined completions for the human to inspect/edit into a decisions file
  const draft = [];
  for (const m of manifest.items) {
    if (m.imgStatus !== "ok") continue;
    let rec; try { rec = JSON.parse(readFileSync(join(runDir, "completions", completionFile(m.id)), "utf8")); } catch { continue; }
    draft.push({ id: m.id, meta: m.meta, model_result: rec.result });
  }
  writeFileSync(join(runDir, "review-draft.json"), JSON.stringify({ items: draft }, null, 1));
  console.log(`vision-review: wrote ${draft.length} quarantined completions to ${join(runDir, "review-draft.json")}.`);
  console.log(`  Inspect each, then author a decisions file {items:[{id, approved:{...}}]} and run:`);
  console.log(`  node scripts/vision-review.mjs ${runDir} --approve <decisions.json>`);
  process.exit(0);
}

// --approve: bind the human's decisions to the run's hashes + the reviewed completion's own header/model
const decisions = JSON.parse(readFileSync(process.argv[ai + 1], "utf8"));
const errors = [], items = [];
let modelId = null;
for (const d of (decisions.items || [])) {
  const m = byId.get(d.id);
  if (!m) { errors.push(`id not in run: ${d.id}`); continue; }
  if (m.imgStatus !== "ok" || !m.sha256) { errors.push(`no sanitized image for ${d.id}`); continue; }
  const v = validateApprovedPatch({ id: d.id, ...(d.approved || {}) });   // nonempty subset — only approved fields
  if (!v.ok) { errors.push(`approved values invalid for ${d.id}: ${v.errors.join(",")}`); continue; }
  let cf, rec; try { cf = readFileSync(join(runDir, "completions", completionFile(d.id))); rec = JSON.parse(cf.toString("utf8")); } catch { errors.push(`completion missing/unparseable for ${d.id}`); continue; }
  // SELECT-ONLY: every approved value MUST match the model's own completion value verbatim (no human edits here).
  let edited = false;
  for (const k of Object.keys(d.approved || {})) { if (canonicalJson(d.approved[k]) !== canonicalJson((rec.result || {})[k])) { errors.push(`approved '${k}' for ${d.id} was EDITED (does not match the reviewed completion — corrections not allowed; select the model's value or reject)`); edited = true; } }
  if (edited) continue;
  const mid = rec.header && rec.header.modelId;
  if (!mid) { errors.push(`completion has no modelId for ${d.id}`); continue; }
  if (modelId && modelId !== mid) { errors.push(`mixed models in run (${modelId} vs ${mid}) — approve one model at a time`); continue; }
  modelId = mid;
  items.push({ id: d.id, imgSha256: m.sha256, completionSha256: sha256(cf), approved: d.approved });
}
if (errors.length) { console.error("❌ review: refusing to write approved.json:"); for (const e of errors) console.error("  - " + e); process.exit(1); }

const approved = { header: { ...manifest.header, modelId }, items };
const fd = openSync(join(runDir, "approved.json"), "wx", 0o600);   // exclusive — never silently overwrite an approval
writeSync(fd, JSON.stringify(approved, null, 1)); closeSync(fd);

const check = verifyApproval(runDir);   // self-verify the binding immediately
if (!check.ok) {
  try { rmSync(join(runDir, "approved.json"), { force: true }); } catch {}   // don't leave a poisoned exclusive file behind
  console.error("❌ review: approved.json failed self-verification (removed it; fix the decisions and retry):"); for (const e of check.errors) console.error("  - " + e); process.exit(1);
}
console.log(`vision-review: approved ${items.length} item(s) → ${join(runDir, "approved.json")} (self-verified). Apply: node scripts/curate-merge.mjs --run ${runDir}`);
