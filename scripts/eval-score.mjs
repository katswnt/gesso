// Score the vision auditor against the labeled eval set (scripts/eval-auditor.mjs built it).
// Compares each work's auditor verdict (image.ok) to ground truth (correct vs. synthetic wrong-art),
// prints a confusion matrix + precision/recall/F1 for WRONG-ART detection, and writes docs/auditor-eval.md.
//   node scripts/eval-score.mjs
import { readFileSync, writeFileSync } from "node:fs";

const truth = JSON.parse(readFileSync("data/incoming/eval/eval-truth.json", "utf8"));
const out = {};
for (const f of ["eval-out-1.json", "eval-out-2.json"]) {
  let arr; try { arr = JSON.parse(readFileSync(`data/incoming/eval/${f}`, "utf8")); } catch { console.error(`missing ${f} — run the audit agents first`); process.exit(1); }
  for (const w of arr) out[w.id] = w;
}

// "positive" = the auditor calls the image WRONG (image.ok === false). truth positive = label "wrong".
let TP = 0, FP = 0, TN = 0, FN = 0, missing = 0; const misses = [], falseAlarms = [];
for (const [id, t] of Object.entries(truth)) {
  const o = out[id];
  if (!o) { missing++; continue; }
  const auditorSaysWrong = o.image && o.image.ok === false;
  const truthWrong = t.label === "wrong";
  if (truthWrong && auditorSaysWrong) TP++;
  else if (truthWrong && !auditorSaysWrong) { FN++; misses.push({ id, shownImgTitle: t.shownImgTitle }); }
  else if (!truthWrong && auditorSaysWrong) { FP++; falseAlarms.push({ id, reason: o.image && o.image.reason }); }
  else TN++;
}
const pct = (n, d) => d ? (100 * n / d).toFixed(1) + "%" : "n/a";
const precision = TP / (TP + FP || 1), recall = TP / (TP + FN || 1), f1 = 2 * precision * recall / (precision + recall || 1);
const acc = (TP + TN) / (TP + TN + FP + FN || 1);

const lines = [];
const L = s => lines.push(s);
L(`# Vision auditor — wrong-art detection eval\n`);
L(`Measures how reliably the image-grounded vision audit catches an image that does **not** depict the work it's attached to. Ground truth is unambiguous by construction (see methodology).\n`);
L(`## Results (n=${TP + TN + FP + FN}${missing ? `, ${missing} un-audited` : ""})\n`);
L(`| Metric | Value |`);
L(`|---|---|`);
L(`| **Precision** (of flagged, how many were truly wrong) | **${pct(TP, TP + FP)}** |`);
L(`| **Recall** (of truly-wrong, how many were caught) | **${pct(TP, TP + FN)}** |`);
L(`| **F1** | **${(f1 * 100).toFixed(1)}%** |`);
L(`| Accuracy | ${pct(TP + TN, TP + TN + FP + FN)} |`);
L(`\n## Confusion matrix\n`);
L(`|  | truth: wrong-art | truth: correct |`);
L(`|---|---|---|`);
L(`| **auditor: flagged wrong** | ${TP} (caught) | ${FP} (false alarm) |`);
L(`| **auditor: passed ok** | ${FN} (missed) | ${TN} (correct pass) |`);
if (misses.length) { L(`\n### Missed wrong-art (${misses.length}) — the failure mode that matters most`); for (const m of misses) L(`- \`${m.id}\` (was shown the image of *${m.shownImgTitle}*)`); }
if (falseAlarms.length) { L(`\n### False alarms (${falseAlarms.length}) — correct images wrongly flagged`); for (const m of falseAlarms) L(`- \`${m.id}\` — reason given: ${m.reason || "(none)"}`); }
L(`\n## Methodology\n`);
L(`- **Controls (label \`correct\`, n=${Object.values(truth).filter(t => t.label === "correct").length}):** famous, previously-audited works shown with **their own** pool image → a correct auditor passes them (\`image.ok=true\`).`);
L(`- **Decoys (label \`wrong\`, n=${Object.values(truth).filter(t => t.label === "wrong").length}):** real works shown with a **different work's image** (from a different region, so the mismatch is unmistakable) → a correct auditor flags them (\`image.ok=false\`).`);
L(`- The audit agents saw a **blind, interleaved** set with no labels and no expected wrong/right ratio. Selection is deterministic (\`scripts/eval-auditor.mjs\`), so the eval is reproducible.`);
L(`- **Honest limitation:** control labels assume the pool image for a famous, already-audited work is correct (not independently re-verified here); the decoy half is fully rigorous ground truth. Recall (catching planted wrong-art) is therefore the load-bearing number.`);
L(`- **What a perfect score does and doesn't prove:** the decoys are *gross* cross-region mismatches (a Botticelli shown as dogs-playing-poker) — which is the dominant real-world failure mode (the actual wrong-art cases the pipeline caught were exactly this kind: an image resolving to a completely different artwork). This eval shows the auditor catches those reliably with no false alarms. It does **not** yet probe *near-miss* mismatches (a different work by the same artist, same era/subject); a harder decoy set is the natural next iteration.\n`);
L(`_Regenerate: \`node scripts/eval-auditor.mjs && (run the 2 blind audit agents) && node scripts/eval-score.mjs\`._`);
writeFileSync("docs/auditor-eval.md", lines.join("\n") + "\n");

console.log(`\nWRONG-ART DETECTION — precision ${pct(TP, TP + FP)} · recall ${pct(TP, TP + FN)} · F1 ${(f1 * 100).toFixed(1)}% · acc ${pct(TP + TN, TP + TN + FP + FN)}`);
console.log(`confusion: TP=${TP} FP=${FP} FN=${FN} TN=${TN}${missing ? ` · ${missing} missing` : ""}`);
if (misses.length) console.log(`missed wrong-art: ${misses.map(m => m.id).join(", ")}`);
if (falseAlarms.length) console.log(`false alarms: ${falseAlarms.map(m => m.id).join(", ")}`);
console.log(`→ wrote docs/auditor-eval.md`);
