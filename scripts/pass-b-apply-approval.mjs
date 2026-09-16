// CLI for the smallest Pass-B guarded approval/apply tool (VSD-023). One work at a time.
//   node scripts/pass-b-apply-approval.mjs create  <workId>   → writes a PENDING approval (ownerApproved:false) + a review card
//   node scripts/pass-b-apply-approval.mjs dry-run <workId>   → guarded dry-run (requires ownerApproved:true); prints diff + tests; NO write
//   node scripts/pass-b-apply-approval.mjs apply   <workId>   → guarded real write (requires ownerApproved:true + --yes)
// Owner approval is set by hand-editing "ownerApproved": true in the approval file AFTER inspecting the card.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildApproval, applyApproval, projectToProduction, APPROVABLE_FIELDS } from './lib/pass-b-approval.mjs';

// Default to the owner-reviewed offline-rehydrated B4 run, not the older upstream completion layout.
// The reconciliation loader verifies its full b4r -> b4c -> cal50 ancestry before approval can be staged.
const RUN = process.env.PASS_B_RUN || 'data/incoming/vision-calibration/b4r-8f1f74ddc30f';
const TEACH = 'data/teach-works.js';
const HOTSPOTS = 'data/hotspots.js';
const [cmd, workId] = process.argv.slice(2);
if (!cmd || !workId) { console.error('usage: pass-b-apply-approval.mjs <create|dry-run|apply> <workId>'); process.exit(2); }
const approvalPath = join(RUN, 'approvals', `${workId.replace(/[^a-z0-9]+/gi, '_')}.approval.json`);
const cardPath = join(RUN, 'approvals', `${workId.replace(/[^a-z0-9]+/gi, '_')}.card.html`);

// Owner-authorized field-level edits (documented). Only `why` is edited for the two mandatory-trim works.
const OWNER_EDITS = {
  cleveland170810: { why: "A Persian calligraphy page made around 1550 by Faqir Ali, copying a ghazal (lyric poem) by Badr al-Din Hilali Jaghata'i. The flowing nastaliq script runs diagonally through diamond-shaped panels, a virtuoso design intended for an album. About 150 years later, a collector added the decorative borders and remounted the page upside down, showing how the object continued to change as it passed between owners." },
  cleveland120847: { why: "A small bronze plaque, probably once gilded to resemble solid gold, shows an unnamed saint in the severe frontal style of sixth-century Byzantine Syria. Rigid symmetry and enlarged, unblinking eyes convey spiritual authority rather than lifelike naturalism. Its mottled green and rust surface is corrosion; originally, this devotional or protective object would have looked luminous." },
};
const LEAK = /B3 visual verification|visual verification confirms|\bB[1-4] (?:visual|verification|confirms)|the prompt (?:does|gives)|the metadata (?:does|gives)|the record (?:does not|gives)|the catalog (?:does not|gives)|the title (?:does not|gives)/i;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function leakScan(teach) {
  const hits = [];
  if (LEAK.test(teach.why || '')) hits.push('why');
  (teach.guide || []).forEach((g, i) => { if (LEAK.test(g.a || '') || LEAK.test(g.q || '')) hits.push(`guide[${i}]`); });
  (teach.notes || []).forEach((n, i) => { if (LEAK.test(n.body || '') || LEAK.test(n.head || '')) hits.push(`notes[${i}]`); });
  (teach.cues || []).forEach((c, i) => { if (LEAK.test(c)) hits.push(`cues[${i}]`); });
  return hits;
}

function renderCard(workId, teach, hotspots, leaks, edited) {
  const cue = (c) => `<li>${esc(c)}</li>`;
  const g = (x) => `<div class="qa"><div class="q">${esc(x.q)}</div><div class="a">${esc(x.a)}</div></div>`;
  const n = (x) => `<div class="note"><b>${esc(x.head)}</b> <span class="xy">(${x.x},${x.y})</span><div>${esc(x.body)}</div></div>`;
  return `<!doctype html><meta charset="utf-8"><title>Approval card ${esc(workId)}</title><style>
  body{font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:900px;margin:24px auto;padding:0 18px;color:#1c1a17;background:#faf9f7}
  h1{font-size:20px}h2{font-size:14px;text-transform:uppercase;letter-spacing:.04em;color:#6b665e;margin:20px 0 6px}
  .why{background:#fff;border:1px solid #e4e0d8;border-radius:8px;padding:12px 14px}.wc{color:#2f7d4f;font-size:12px}
  .qa{margin:8px 0}.q{font-weight:600}.a{color:#333}.note{margin:8px 0}.xy{color:#9a8f7e;font-size:12px}
  ul{margin:4px 0 0 18px}.warn{background:#fdeaea;border:1px solid #e2a5a5;border-radius:8px;padding:10px 14px;color:#8a2b2b;margin:14px 0}
  .edited{color:#9a6a12;font-size:12px}</style>
  <h1>Approval card — ${esc(workId)}</h1>
  <p><b>PENDING</b> · nothing approved, nothing merged. Projected production content below (what would ship). Inspect, then set <code>"ownerApproved": true</code> in the approval file only if correct.</p>
  ${leaks.length ? `<div class="warn"><b>⚠ Internal-production-language leaks in player copy:</b> ${esc(leaks.join(', '))}. These say things like "B3 visual verification confirms…", which the editorial standard forbids. This content is NOT shippable verbatim — it needs owner edits (or a leak-clean canary) before approval.</div>` : ''}
  <h2>Why ${edited ? '<span class="edited">(owner-edited)</span>' : ''}</h2>
  <div class="why">${esc(teach.why)} <span class="wc">(${(teach.why || '').length} chars)</span></div>
  <h2>Cues</h2><ul>${(teach.cues || []).map(cue).join('')}</ul>
  <h2>Guide (${(teach.guide || []).length})</h2>${(teach.guide || []).map(g).join('')}
  <h2>Notes (${(teach.notes || []).length})</h2>${(teach.notes || []).map(n).join('')}
  <h2>Hotspots</h2><ul>${(hotspots || []).map((h) => `<li>#${h.n} @ (${h.x},${h.y})</li>`).join('')}</ul>`;
}

if (cmd === 'create') {
  mkdirSync(join(RUN, 'approvals'), { recursive: true });
  const approval = buildApproval({ runDir: RUN, workId, approvedFields: APPROVABLE_FIELDS.slice(), ownerEdits: OWNER_EDITS[workId] || {}, teachPath: TEACH, hotspotsPath: HOTSPOTS });
  writeFileSync(approvalPath, `${JSON.stringify(approval, null, 1)}\n`);
  const { teach, hotspots } = approval.approvedRecord;
  const leaks = leakScan(teach);
  writeFileSync(cardPath, renderCard(workId, teach, hotspots, leaks, !!OWNER_EDITS[workId]));
  console.log(`PENDING approval written: ${approvalPath}`);
  console.log(`  ownerApproved: false (a human must set true AFTER inspecting the card)`);
  console.log(`  bindings: runId=${approval.runId} b4Sha=${approval.b4CompletionSha256.slice(0, 12)} vcv=${approval.validationContractVersion}`);
  console.log(`  reconciliation: ${approval.reconciliation.reportSha256.slice(0, 12)} (${approval.reconciliation.eligibleComponentIds.length} eligible components)`);
  console.log(`  why length: ${(teach.why || '').length}${OWNER_EDITS[workId] ? ' (owner-edited)' : ''}`);
  console.log(`  leaks in player copy: ${leaks.length ? leaks.join(', ') : 'none'}`);
  console.log(`  card: ${cardPath}`);
  process.exit(0);
}

if (cmd === 'dry-run' || cmd === 'apply') {
  if (!existsSync(approvalPath)) { console.error(`no approval at ${approvalPath} — run "create" first`); process.exit(2); }
  const approval = JSON.parse(readFileSync(approvalPath, 'utf8'));
  const doApply = cmd === 'apply';
  if (doApply && !process.argv.includes('--yes')) { console.error('apply requires --yes (guarded real write)'); process.exit(2); }
  const res = applyApproval({ approval, runDir: RUN, teachPath: TEACH, hotspotsPath: HOTSPOTS, apply: doApply });
  if (!res.ok) { console.error(`REJECTED (nothing written): ${res.errors.join(', ')}`); process.exit(1); }
  console.log(`${res.wrote ? 'APPLIED' : 'DRY-RUN (no write)'} — ${approval.workId}`);
  console.log(`  teach: ${res.diff.teach.action} | hotspots: ${res.diff.hotspots.action}`);
  console.log(`  tests that would run: ${res.diff.testsThatWouldRun.join(', ')}`);
  console.log(JSON.stringify(res.diff, null, 1));
  process.exit(0);
}
console.error(`unknown command: ${cmd}`); process.exit(2);
