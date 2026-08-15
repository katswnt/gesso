// Weekly network-audit driver (Phase 2 of the quality-enforcement plan). The fail-closed image audits
// (drift, dailies) need the network, so they can't live in the push-CI gate — this runs them on a schedule
// (.github/workflows/image-audit.yml) and exits nonzero ONLY when something genuinely needs a human, so the
// workflow opens/updates a GitHub issue. Advisory audits (copyright) are attached FYI but never gate.
//   node scripts/scheduled-audit.mjs
import { execSync } from "node:child_process";
import { writeFileSync, appendFileSync } from "node:fs";

function runJson(cmd) {
  let out = "", code = 0;
  try { out = execSync(cmd, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { code = e.status ?? 1; out = (e.stdout || "") + "\n" + (e.stderr || ""); }
  let json = null; try { json = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)); } catch {}
  return { code, out, json };
}

const today = new Date().toISOString().slice(0, 10);
let md = `# Weekly image audit — ${today}\n\n`;
const problems = [];

// 1. IMAGE DRIFT — alert only on GENUINE upstream change (content sha1 / museum byte-size / gone).
// url-changed just means WE repointed the pool image since the last fingerprint — expected, not a problem.
const drift = runJson("node scripts/check-image-drift.mjs --json");
const bk = drift.json?.byKind || {};
const badDrift = (bk["content-changed"] || 0) + (bk["size-changed"] || 0) + (bk["gone"] || 0);
md += `## Image drift — ${badDrift ? `🔴 ${badDrift} changed upstream` : "✅ none"} `
   +  `(checked ${drift.json?.checked ?? "?"}; url-only changes ignored: ${bk["url-changed"] || 0})\n\n`;
md += "```json\n" + JSON.stringify(bk, null, 1) + "\n```\n\n";
if (!drift.json) md += `> ⚠ drift check produced no parseable output (exit ${drift.code}); tail:\n\n\`\`\`\n${drift.out.trim().split("\n").slice(-8).join("\n")}\n\`\`\`\n\n`;
if (badDrift) problems.push(`image drift: ${badDrift} works changed upstream (content/size/gone) — see data/incoming/image-drift.json → re-audit`);

// 2. DAILY IMAGES — a scheduled (next-28d) work that is blurry or genuinely gone. Split the "unreachable"
// bucket: 404/410 = actually gone (gate); 403/5xx = the audit's fetch was bot-blocked by a museum CDN
// (AIC/Te Papa) but the image renders fine for players (FYI, don't gate — else it fires every week).
const dailies = runJson("node scripts/audit-dailies.mjs 28 --json");
const dfAll = dailies.json?.findings || [];
const low = dfAll.filter(f => f.status === "LOW");
const gone = dfAll.filter(f => f.status === "unreachable" && /^(404|410)$/.test(String(f.err)));
const blocked = dfAll.filter(f => f.status === "unreachable" && !/^(404|410)$/.test(String(f.err)));
const actionable = [...low, ...gone];
md += `## Daily images (next 28 days) — ${actionable.length ? `🔴 ${actionable.length} blurry/gone` : "✅ all ok"} (checked ${dailies.json?.checked ?? "?"})\n\n`;
if (actionable.length) md += actionable.map(f => `- [${f.tier}] ${f.dates?.[0]} · "${f.title}" · ${f.status} ${f.nativeW ? f.nativeW + "px" : f.err}`).join("\n") + "\n\n";
if (blocked.length) md += `<details><summary>${blocked.length} museum-CDN bot-blocks (403/5xx — image likely fine for players, FYI)</summary>\n\n${blocked.map(f => `- [${f.tier}] "${f.title}" · ${f.err}`).join("\n")}\n</details>\n\n`;
if (actionable.length) problems.push(`daily images: ${actionable.length} scheduled works blurry or gone — swap before they're served`);

// 3. COPYRIGHT — standing advisory backlog. FYI only; never opens an issue on its own (it always flags some).
const cr = runJson("node scripts/audit-copyright.mjs");
md += `## Copyright backlog (advisory — not gating)\n\n\`\`\`\n${cr.out.trim().split("\n").slice(-4).join("\n")}\n\`\`\`\n`;

writeFileSync("data/incoming/scheduled-audit-report.md", md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
console.log(md);
if (problems.length) { console.error("\nATTENTION NEEDED:\n" + problems.map(p => " - " + p).join("\n")); process.exit(1); }
console.log("\n✅ no attention needed");
