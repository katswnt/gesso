// VSD-035 offline reconciliation writer. No model/network/production write.
//
//   node scripts/pass-b-reconcile.mjs <run-dir> <work-id>                 # dry report
//   node scripts/pass-b-reconcile.mjs <run-dir> <work-id> --write         # immutable bundle/report
//   node scripts/pass-b-reconcile.mjs <run-dir> <work-id> --template      # pending owner decision template
//   node scripts/pass-b-reconcile.mjs <run-dir> <work-id> --write --decisions <path>
//   node scripts/pass-b-reconcile.mjs <run-dir> <work-id> --owner-edits <path>
// Optional enrichment inputs are evidence only; they never create an effective decision.
//   --source-spans <path>  array of exact source-span records
//   --entity-graph <path>  contentVisionEntityGraph/1 body
//
// The report lives beside the work evidence under reconciliation/. Existing completions are read-only.
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { projectToProduction } from './lib/pass-b-approval.mjs';
import {
  loadReconciliationSources, buildClaimBundle, buildDecisionArtifact, auditReconciliation,
  validateClaimBundle, validateDecisionArtifact, verifyReconciliationReport, claimBundleSha256,
  reconciliationPaths, reconciliationSetPaths, buildReconciliationActivation,
} from './lib/pass-b-reconciliation.mjs';

const args = process.argv.slice(2);
const runDir = args[0]; const workId = args[1];
if (!runDir || !workId) {
  console.error('usage: pass-b-reconcile.mjs <run-dir> <work-id> [--write] [--template] [--decisions <path>] [--owner-edits <path>] [--source-spans <path>] [--entity-graph <path>]');
  process.exit(2);
}
const valueAfter = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const write = args.includes('--write');
const template = args.includes('--template');
const decisionsPath = valueAfter('--decisions');
const ownerEditsPath = valueAfter('--owner-edits');
const sourceSpansPath = valueAfter('--source-spans');
const entityGraphPath = valueAfter('--entity-graph');
const readOptional = (path, fallback) => path ? JSON.parse(readFileSync(path, 'utf8')) : fallback;

const sources = loadReconciliationSources(runDir, workId);
const ownerEdits = readOptional(ownerEditsPath, {});
const sourceSpans = readOptional(sourceSpansPath, []);
const entityGraph = readOptional(entityGraphPath, null);
const projectedRecord = projectToProduction(sources.b4, ownerEdits);
const bundle = buildClaimBundle({ sources, projectedRecord, sourceSpans, entityGraph });
const bv = validateClaimBundle(bundle);
if (!bv.ok) { console.error(`claim bundle invalid: ${bv.errors.join('; ')}`); process.exit(1); }
const defaultDecisions = buildDecisionArtifact({ workId, claimBundleSha256: claimBundleSha256(bundle), decisions: [] });
const decisions = decisionsPath ? JSON.parse(readFileSync(decisionsPath, 'utf8')) : defaultDecisions;
const dv = validateDecisionArtifact(decisions, bundle);
if (!dv.ok) { console.error(`decisions invalid: ${dv.errors.join('; ')}`); process.exit(1); }
const audited = auditReconciliation(bundle, decisions);
if (!audited.ok) { console.error(`reconciliation failed: ${audited.errors.join('; ')}`); process.exit(1); }

const basePaths = reconciliationPaths(sources);
const setPaths = reconciliationSetPaths(sources, audited.report.reportSha256);
const outDir = basePaths.dir;
const pendingPath = join(basePaths.templates, `${claimBundleSha256(bundle)}.decisions.template.json`);

function immutableWrite(path, value) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  if (existsSync(path)) {
    if (readFileSync(path, 'utf8') !== body) throw new Error(`refusing to overwrite different reconciliation artifact: ${path}`);
    return;
  }
  writeFileSync(path, body, { flag: 'wx', mode: 0o600 });
}

if (template) {
  mkdirSync(basePaths.templates, { recursive: true, mode: 0o700 });
  const rows = bundle.components.map((c, i) => ({
    decisionId: `owner-component-${i + 1}`,
    targetKind: 'component', targetId: c.componentId,
    effectiveState: 'unresolved', authority: 'owner',
    artifactRef: 'OWNER MUST REPLACE WITH A REVIEW ARTIFACT REFERENCE',
    resolvesConflictIds: [], // accepting a held component requires explicitly naming every applicable conflict
    supersedesDecisionId: null,
  }));
  immutableWrite(pendingPath, buildDecisionArtifact({ workId, claimBundleSha256: claimBundleSha256(bundle), decisions: rows }));
  console.log(`PENDING owner-decision template: ${pendingPath}`);
  console.log('  Every state is unresolved. Nothing is approved by generating this file.');
}

if (write) {
  mkdirSync(setPaths.setDir, { recursive: true, mode: 0o700 });
  immutableWrite(setPaths.bundle, bundle);
  immutableWrite(setPaths.decisions, decisions);
  immutableWrite(setPaths.report, audited.report);
  const verify = verifyReconciliationReport(JSON.parse(readFileSync(setPaths.report, 'utf8')), JSON.parse(readFileSync(setPaths.bundle, 'utf8')), JSON.parse(readFileSync(setPaths.decisions, 'utf8')));
  if (!verify.ok) throw new Error(`written reconciliation failed verification: ${verify.errors.join('; ')}`);
  const activation = buildReconciliationActivation(audited.report);
  mkdirSync(basePaths.activations, { recursive: true, mode: 0o700 });
  immutableWrite(join(basePaths.activations, `${activation.activationSha256}.json`), activation);
  const tmp = `${basePaths.active}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(activation, null, 2)}\n`, { mode: 0o600 }); renameSync(tmp, basePaths.active);
  console.log(`WROTE immutable reconciliation set + activated: ${setPaths.report}`);
}

console.log(`work: ${workId}`);
console.log(`contentReadiness: ${audited.report.contentReadiness}`);
for (const surface of ['why', 'cues', 'notes', 'hotspots', 'guide']) {
  const rows = audited.report.componentReadiness.filter(c => c.surface === surface);
  const counts = Object.fromEntries(['eligible', 'review-required', 'blocked'].map(s => [s, rows.filter(r => r.contentReadiness === s).length]));
  console.log(`  ${surface}: eligible=${counts.eligible} review=${counts['review-required']} blocked=${counts.blocked}`);
}
console.log(`claims: ${bundle.claimAssertions.length} | observations: ${bundle.observations.length} | violations: ${audited.report.violations.length}`);
if (ownerEditsPath) console.log(`owner edits bound: ${ownerEditsPath}`);
if (sourceSpansPath) console.log(`source spans bound: ${sourceSpansPath}`);
if (entityGraphPath) console.log(`entity graph bound: ${entityGraphPath}`);
if (!write) console.log('DRY ONLY — no artifact written (use --write).');
