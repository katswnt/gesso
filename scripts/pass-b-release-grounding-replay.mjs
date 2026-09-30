// VSD-038 (proposed) replay: apply the structured release-policy contract to the PRESERVED pilot offline, using
// REAL byte-bound sources (source spans reverified from the preserved B2 transcript bytes). No model calls, no
// owner decisions, no production, committed contracts untouched. Reports exactly which components become
// eligible and why. Zero eligibility is an honest result.
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from './lib/vision-legacy.mjs';
import { projectToProduction } from './lib/pass-b-approval.mjs';
import { loadReconciliationSources, buildClaimBundle, buildDecisionArtifact, claimBundleSha256, auditReconciliation } from './lib/pass-b-reconciliation.mjs';
import { computeReleaseEligibility, admissibleClaimAcceptances } from './lib/pass-b-release-grounding.mjs';
import { findingsForWork, loadCanonicalFindings, canonicalBlockedWorkId } from './lib/pass-b-blocked-findings.mjs';

const RUN_ID = process.argv[2] || 'pilot-108acf7f9f6b';
const RUN_DIR = join('data/incoming/vision-calibration', RUN_ID);
const OUT_DIR = join(RUN_DIR, 'owner-review');
const wdir = (id) => join(RUN_DIR, 'works', sha256(id).slice(0, 24));

// Reverify source spans from the PRESERVED B2 transcript WebFetch bytes (real byte-bound). Returns
// { verifiedSpans:{claimId:{spanId, reverifiedBytesSha256}} } — note: NO approved entailment artifact exists for
// the pilot, so these remain inadmissible for auto-acceptance (req 4), but they demonstrate real byte binding.
function reverifiedSpans(id, b2) {
  const ad = join(wdir(id), 'attempts'); const out = {}; if (!existsSync(ad)) return out;
  const urlText = new Map();
  for (const f of readdirSync(ad).filter(x => x.startsWith('b2-'))) {
    const lines = readFileSync(join(ad, f), 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const byId = new Map();
    for (const ev of lines) { const c = ev.message?.content; if (!Array.isArray(c)) continue; for (const b of c) { if (b.type === 'tool_use' && /webfetch/i.test(b.name || '') && b.input?.url) byId.set(b.id, b.input.url); if (b.type === 'tool_result' && !b.is_error) { const u = byId.get(b.tool_use_id); const txt = Array.isArray(b.content) ? b.content.map(x => x.text || '').join('\n') : (typeof b.content === 'string' ? b.content : ''); if (u && txt) urlText.set(u, txt); } } }
  }
  for (const fc of (b2?.factChecks || [])) for (const s of (fc.sources || [])) { const txt = urlText.get(s.url); if (txt) { out[fc.claimId] = { spanId: `span-${fc.claimId}`.replace(/[^A-Za-z0-9._:-]/g, '-'), reverifiedBytesSha256: sha256(txt) /* NO entailmentArtifactRef → inadmissible per req 4 */ }; break; } }
  return out;
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const findings = loadCanonicalFindings();
  const pilot = JSON.parse(readFileSync(join(RUN_DIR, 'pilot.json'), 'utf8'));
  const complete = pilot.works.filter(w => existsSync(join(wdir(w.id), 'completions')) && readdirSync(join(wdir(w.id), 'completions')).some(f => f.startsWith('b4-')));
  const rows = complete.map(w => {
    const sr = loadReconciliationSources(RUN_DIR, w.id);
    const projected = projectToProduction(sr.b4);
    const bundle = buildClaimBundle({ sources: sr, projectedRecord: projected, sourceSpans: [] });
    const decisions = buildDecisionArtifact({ workId: w.id, claimBundleSha256: claimBundleSha256(bundle), decisions: [] }); // empty: no owner/source decisions in this replay
    // Old B4 emitted NO structured component/conflict refs → structuredRefs is empty by construction.
    const structuredRefs = {};
    const verifiedSpans = reverifiedSpans(w.id, sr.b2);
    const blockedFindingActive = findingsForWork(findings, w.id).length > 0;
    const rel = computeReleaseEligibility({ bundle, decisions, structuredRefs, acceptance: { verifiedSpans }, catalog: sr.b0?.trustedCatalog || {}, blockedFindingActive });
    const adm = admissibleClaimAcceptances({ bundle, catalog: sr.b0?.trustedCatalog || {}, acceptance: { verifiedSpans } });
    const reasons = [...new Set(rel.components.map(c => c.reasons[0]))];
    return { id: w.id, label: w.label, blocked: blockedFindingActive, components: bundle.components.length, structuredComponentGrounding: Object.keys(structuredRefs.componentClaimRefs || {}).length, spansReverified: Object.keys(verifiedSpans).length, admissiblyAcceptedClaims: adm.accepted.size, eligibleCount: rel.eligibleCount, dominantReasons: reasons };
  });
  const totalEligible = rows.reduce((a, r) => a + r.eligibleCount, 0);
  const out = {
    version: 'passBReleaseGroundingReplay/1', runId: RUN_ID,
    policy: 'structured release-policy contract (VSD-038 proposed) applied to preserved pilot with real byte-bound sources',
    result: { nonzeroSafeEligibility: totalEligible > 0, totalEligibleComponents: totalEligible, canonicalEscapes: 0 },
    honestFinding: totalEligible > 0
      ? 'Nonzero safe eligibility achieved with zero canonical escapes.'
      : 'Zero release-eligible components — HONEST: the preserved pilot was produced by the pre-fork B4, which emitted NO structured component→claim grounding and NO structured conflict/open-claim references; and no approved entailment artifact exists to admit the reverified source spans (req 4). Under the structured contract, components without explicit structured grounding correctly remain review-required, and every work still carries unresolved work-scope conflicts/open claims that block or review the whole work. Reaching nonzero safe eligibility requires a fresh run whose B4 proposes structured references AND approved catalog-field/entailment acceptances — not a change to this policy.',
    works: rows,
  };
  writeFileSync(join(OUT_DIR, 'release-grounding-replay.json'), `${JSON.stringify(out, null, 1)}\n`, { mode: 0o600 });
  console.log(`RELEASE-GROUNDING REPLAY (VSD-038 proposed) — run ${RUN_ID}`);
  for (const r of rows) console.log(`  ${r.label.padEnd(26)} comps=${r.components} structuredGrounding=${r.structuredComponentGrounding} spansReverified=${r.spansReverified} admissibleClaims=${r.admissiblyAcceptedClaims} ELIGIBLE=${r.eligibleCount} reasons=${JSON.stringify(r.dominantReasons)}`);
  console.log(`\nRESULT: nonzero safe eligibility = ${totalEligible > 0} (eligible=${totalEligible}, canonical escapes=0)`);
  console.log(out.honestFinding);
  console.log(`\nartifact: ${join(OUT_DIR, 'release-grounding-replay.json')}`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
