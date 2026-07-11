// audit-local.mjs — runs the LOCAL, no-network advisory audits and prints a one-line summary each,
// so they surface on every `npm test` instead of only when someone remembers `npm run audit`.
// These are ADVISORY (review backlogs, not hard violations), so this always exits 0 — the blocking
// gate stays check-pool.mjs. The NETWORK audits (copyright, images, p31) run post-harvest, not here.
//   node scripts/audit-local.mjs
import { execSync } from "node:child_process";

const AUDITS = [
  ["fields",   "audit-fields.mjs"],      // pool field vs Wikidata mismatches
  ["place",    "audit-place.mjs"],       // origin/place canonicalization + better-origin suggestions
  ["style-text","audit-style-text.mjs"], // assigned style vs style implied by the note text
  ["vocab",    "audit-vocab.mjs"],       // controlled-vocab near-duplicates (medium/style spelling variants)
  ["fame",     "check-fame.mjs"],        // fame outliers / tier-placement sanity
  // NOTE: medium-revalidate.mjs was REMOVED from this advisory chain — it WRITES pool.js (overwrote clean
  // medium with raw Wikidata P186 concatenations like "oil paint walnut panel", tripping the gate's
  // medium-lowercase check). An advisory audit must never mutate the pool. Run it manually with --apply only.
];

console.log("=== local advisory audits (review backlogs — non-blocking) ===");
let ran = 0;
for (const [name, script] of AUDITS) {
  try {
    const out = execSync(`node scripts/${script} 2>&1`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const lines = out.trim().split("\n").map(l => l.trim()).filter(Boolean);
    // headline = a line that both mentions a count and a flag/backlog word; else the last line.
    const head = lines.find(l => /\d/.test(l) && /(flag|found|mismatch|review|conflict|backlog|wrote|:\s*\d)/i.test(l))
      || lines[lines.length - 1] || "(no output)";
    console.log(`  ${name.padEnd(12)} ${head.slice(0, 90)}`);
    ran++;
  } catch (e) {
    console.log(`  ${name.padEnd(12)} ⚠ errored (${String(e.message || e).slice(0, 40)})`);
  }
}
console.log(`(${ran}/${AUDITS.length} advisory audits ran — full detail via each script or 'npm run audit')`);
process.exit(0);
