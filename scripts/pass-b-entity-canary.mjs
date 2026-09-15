// VSD-034 item 4a: OFFLINE validation for the entity canary. No model calls, no image reads, no writes.
// Verifies both sealed artifacts, re-checks every fixture (contract-validity + controller self-consistency +
// evaluator round-trip), confirms content-blocked enforcement fires, and prints the bounded 4b model-canary
// PLAN. Exits non-zero on any offline failure. 4b (the model run) is intentionally NOT implemented here.
import { readFileSync, existsSync } from 'node:fs';
import { loadCanonicalFindings } from './lib/pass-b-blocked-findings.mjs';
import { validateEntityGraph } from './lib/pass-b-entity-contract.mjs';
import { runController, aliasPairKeys } from './lib/pass-b-entity-controller.mjs';
import { scoreEmission } from './lib/pass-b-entity-eval.mjs';
import { verifyFixturesArtifact } from './pass-b-entity-canary-fixtures.mjs';
import { buildApproval } from './lib/pass-b-approval.mjs';

const FIX = 'data/vision-entity-canary-fixtures.json';
const problems = [];
const check = (c, m) => { if (!c) problems.push(m); };

// 1. Sealed artifacts load + verify (fail-closed).
let findings = [];
try { findings = loadCanonicalFindings(); check(findings.length >= 2, 'canonical findings has >=2'); }
catch (e) { problems.push(`findings load: ${e.message}`); }
if (!existsSync(FIX)) problems.push(`missing fixtures ${FIX}`);
const fixV = existsSync(FIX) ? verifyFixturesArtifact(JSON.parse(readFileSync(FIX, 'utf8'))) : { ok: false, error: 'absent' };
check(fixV.ok, `fixtures integrity: ${fixV.error || 'ok'}`);
const fixtures = fixV.ok ? fixV.fixtures : [];

// 2. Every fixture: label valid, controller self-consistent, evaluator round-trips, GOLD has zero aliases.
for (const f of fixtures) {
  check(validateEntityGraph(f.label).ok, `label valid: ${f.workId}`);
  const got = runController(f.label, f.claims);
  check(JSON.stringify(aliasPairKeys(got.possibleAlias)) === JSON.stringify([...f.expected.aliasPairs].sort()), `alias self-consistent: ${f.workId}`);
  check(JSON.stringify(got.unbound.map((u) => u.claimId).sort()) === JSON.stringify([...f.expected.unbound].sort()), `unbound self-consistent: ${f.workId}`);
  const s = scoreEmission(f.label, f.label, { exhaustive: f.exhaustive });
  check(s.schemaValid && s.entityRecall === 1 && s.typeAccuracy === 1, `evaluator round-trip perfect: ${f.workId}`);
}
check(fixtures.every((f) => f.expected.aliasPairs.length === 0), 'zero GOLD alias positives (recall undefined here — measured synthetically/owner-labeled)');

// 3. Content-blocked enforcement actually fires for the two canonical works via the guarded approval path.
const runDir = 'data/incoming/vision-calibration/cal50-0a47b6f7f332';
for (const wid of ['wikidata:Q16467705', 'wikidata:Q1211814']) {
  let blocked = false;
  try { buildApproval({ runDir, workId: wid, teachPath: 'data/teach-works.js', hotspotsPath: 'data/hotspots.js' }); }
  catch (e) { blocked = /content-blocked/.test(e.message); }
  check(blocked, `enforcement blocks ${wid}`);
}

// --- report ---
if (problems.length) { console.error(`4a OFFLINE VALIDATION FAILED (${problems.length}):\n  ` + problems.join('\n  ')); process.exit(1); }
console.log('4a OFFLINE VALIDATION: PASS');
console.log(`  findings: ${findings.length} sealed content-blocks enforced (fail-closed, cwd-independent)`);
console.log(`  fixtures: ${fixtures.length} sealed; all labels valid + controller self-consistent + evaluator round-trips`);
console.log('');
console.log('4b BOUNDED MODEL CANARY — PLAN (NOT RUN; requires explicit owner spend authorization):');
console.log(`  calls: ${fixtures.length} (one image-only entity-emission completion per fixture work)`);
for (const f of fixtures) console.log(`    - ${f.workId} [${f.set}] (image = existing cal50 sanitized derivative)`);
console.log('  transport: Read-tool confined temp dir, --tools Read, API keys stripped, apiKeySource:none (G-03 clean)');
console.log('  model: CALIBRATION_MODEL (claude-sonnet-4-6); wire schema: contentVisionEntityGraph/1');
console.log('  scoring: per work -> validateEntityGraph + scoreEmission(vs label, exhaustive per fixture) + runController;');
console.log('           aggregate -> schema-conformance rate, macro/micro entity+type accuracy, unbound rate,');
console.log('           alias PRECISION on real scenes (gold aliases = 0). RECALL is UNDEFINED (no gold positives)');
console.log('           and MUST NOT be reported until owner pixel-labeling supplies positives.');
console.log('  caveats to print in the report: holdout is authoritative-source-seeded (provisional); real-image');
console.log('           labels are non-exhaustive (extras reported as unlabeled, not hallucinations); geometry schematic.');
console.log('  STOP: do not run 4b without explicit owner authorization (it spends subscription usage).');
