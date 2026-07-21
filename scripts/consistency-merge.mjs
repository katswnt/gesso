// Merge cross-field consistency-sweep results (cs-out-N.json) into the review queue and advance the ledger.
// Consistency flags are ADVISORY (queued for review), never auto-applied — a wrong "correction" is worse
// than the original. Run after the sweep agents finish.
//   node scripts/consistency-merge.mjs
import { readFileSync, writeFileSync, readdirSync } from "node:fs";

const OUT = "data/incoming/consistency";
const manifest = JSON.parse(readFileSync(`${OUT}/cs-manifest.json`, "utf8"));
let queue = []; try { queue = JSON.parse(readFileSync("data/incoming/curate/review-queue.json", "utf8")); } catch {}
const have = new Set(queue.map(it => it.id + "|" + it.type + "|" + (it.detail || "")));

let flagged = 0, added = 0; const typeCount = {};
for (const f of readdirSync(OUT).filter(f => /^cs-out-\d+\.json$/.test(f))) {
  let arr; try { arr = JSON.parse(readFileSync(`${OUT}/${f}`, "utf8")); } catch { continue; }
  for (const w of arr) {
    if (!Array.isArray(w.flags) || !w.flags.length) continue; flagged++;
    for (const fl of w.flags) {
      const it = { id: w.id, type: "consistency", subtype: fl.type, detail: fl.detail || "", suggest: fl.suggest || null };
      const key = it.id + "|consistency|" + it.detail;
      typeCount[fl.type] = (typeCount[fl.type] || 0) + 1;
      if (!have.has(key)) { queue.push(it); have.add(key); added++; }
    }
  }
}
writeFileSync("data/incoming/curate/review-queue.json", JSON.stringify(queue, null, 1));

// advance the ledger with every id we sent to the agents (swept, whether flagged or clean)
let led = { ids: [] }; try { led = JSON.parse(readFileSync(`${OUT}/ledger.json`, "utf8")); } catch {}
led.ids = [...new Set([...(led.ids || []), ...manifest.ids])];
writeFileSync(`${OUT}/ledger.json`, JSON.stringify(led, null, 1));

console.log(`consistency-merge: ${flagged} works flagged | ${added} new queue items | swept ledger now ${led.ids.length}`);
console.log("by type:", JSON.stringify(typeCount));
