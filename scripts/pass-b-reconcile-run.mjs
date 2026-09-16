// VSD-035 cohort reconciliation. Deterministic, offline, no model/network/production write.
//
//   node scripts/pass-b-reconcile-run.mjs <run-dir>          # audit whole run, no writes
//   node scripts/pass-b-reconcile-run.mjs <run-dir> --check  # require + verify every playable active set
//   node scripts/pass-b-reconcile-run.mjs <run-dir> --write  # immutable baseline bundles/reports
//
// Baselines use no effective decisions: model proposals never become approval. Existing per-work
// reconciliation artifacts are reopened and verified instead of being overwritten.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { projectToProduction } from './lib/pass-b-approval.mjs';
import {
  loadReconciliationSources, buildClaimBundle, buildDecisionArtifact, auditReconciliation,
  claimBundleSha256, reconciliationPaths, reconciliationSetPaths, buildReconciliationActivation,
  loadAndVerifyReconciliation,
} from './lib/pass-b-reconciliation.mjs';

const [runDir, ...flags] = process.argv.slice(2);
if (!runDir) { console.error('usage: pass-b-reconcile-run.mjs <run-dir> [--write]'); process.exit(2); }
const write = flags.includes('--write');
const check = flags.includes('--check');
if (write && check) { console.error('--write and --check are mutually exclusive'); process.exit(2); }
const manifest = JSON.parse(readFileSync(join(runDir, 'run-manifest.json'), 'utf8'));

function workIds() {
  if (Array.isArray(manifest.selection)) return manifest.selection.map(x => typeof x === 'string' ? x : x.id).filter(Boolean);
  if (Array.isArray(manifest.works)) return manifest.works.slice();
  if (manifest.sourceRun && existsSync(join(manifest.sourceRun, 'run-manifest.json'))) {
    const src = JSON.parse(readFileSync(join(manifest.sourceRun, 'run-manifest.json'), 'utf8'));
    if (Array.isArray(src.works)) return src.works.slice();
  }
  // Last-resort discovery for flat derived runs. The id inside each record remains authoritative.
  const dir = join(runDir, 'works');
  return readdirSync(dir).filter(f => f.endsWith('.b4.json')).map(f => JSON.parse(readFileSync(join(dir, f), 'utf8')).id).filter(Boolean);
}
function immutableWrite(path, value) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  if (existsSync(path)) {
    if (readFileSync(path, 'utf8') !== body) throw new Error(`refusing to overwrite different reconciliation artifact: ${path}`);
    return;
  }
  writeFileSync(path, body, { flag: 'wx', mode: 0o600 });
}

const rows = [];
for (const workId of workIds()) {
  try {
    const flatPath = join(runDir, 'works', `${String(workId).replace(/[^a-z0-9]+/gi, '_')}.b4.json`);
    if (existsSync(flatPath) && JSON.parse(readFileSync(flatPath, 'utf8')).ok === false) {
      rows.push({ workId, status: 'not-playable-or-quarantined' }); continue;
    }
    const sources = loadReconciliationSources(runDir, workId);
    if (sources.b4Completion?.ok === false || sources.b4?.playable === false) {
      rows.push({ workId, status: 'not-playable-or-quarantined' }); continue;
    }
    const projectedRecord = projectToProduction(sources.b4, {});
    const paths = reconciliationPaths(sources);
    let bundle, decisions, report;
    if (existsSync(paths.active)) {
      const loaded = loadAndVerifyReconciliation({ sources, projectedRecord });
      if (!loaded.ok) throw new Error(loaded.errors.join('|'));
      ({ bundle, decisions, report } = loaded);
    } else {
      if (check) throw new Error(`required active reconciliation missing: ${paths.active}`);
      bundle = buildClaimBundle({ sources, projectedRecord });
      decisions = buildDecisionArtifact({ workId, claimBundleSha256: claimBundleSha256(bundle), decisions: [] });
      const audited = auditReconciliation(bundle, decisions);
      if (!audited.ok) throw new Error(audited.errors.join('|'));
      report = audited.report;
      if (write) {
        const setPaths = reconciliationSetPaths(sources, report.reportSha256);
        mkdirSync(setPaths.setDir, { recursive: true, mode: 0o700 });
        immutableWrite(setPaths.bundle, bundle); immutableWrite(setPaths.decisions, decisions); immutableWrite(setPaths.report, report);
        const activation = buildReconciliationActivation(report);
        mkdirSync(paths.activations, { recursive: true, mode: 0o700 });
        immutableWrite(join(paths.activations, `${activation.activationSha256}.json`), activation);
        const tmp = `${paths.active}.tmp-${process.pid}`; writeFileSync(tmp, `${JSON.stringify(activation, null, 2)}\n`, { mode: 0o600 }); renameSync(tmp, paths.active);
      }
    }
    const counts = Object.fromEntries(['eligible', 'review-required', 'blocked'].map(s => [s, report.componentReadiness.filter(c => c.contentReadiness === s).length]));
    rows.push({ workId, status: report.contentReadiness, components: counts, claims: bundle.claimAssertions.length, observations: bundle.observations.length });
  } catch (e) { rows.push({ workId, status: 'error', error: e.message }); }
}

const count = status => rows.filter(r => r.status === status).length;
console.log(`run: ${manifest.runId || runDir}`);
console.log(`works: ${rows.length} | eligible=${count('eligible')} review=${count('review-required')} blocked=${count('blocked')} quarantined=${count('not-playable-or-quarantined')} errors=${count('error')}`);
for (const row of rows.filter(r => r.status === 'error')) console.log(`  ERROR ${row.workId}: ${row.error}`);
console.log(write ? 'WROTE content-addressed baseline reconciliation artifacts (existing artifacts verified, never overwritten by this tool).'
  : check ? 'CHECKED every playable active reconciliation set; no artifacts written.'
  : 'DRY ONLY — no artifacts written (use --write).');
if (count('error')) process.exitCode = 1;
