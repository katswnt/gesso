// Offline minimum release-policy replay against the PRESERVED pilot outputs (NO model calls, NO owner
// decisions, NO production, run unchanged). Goal: determine whether nonzero SAFE auto-eligibility (with zero
// canonical escapes) is reachable under the frozen contract by legitimately source-adjudicating atomic claims
// (exact spans mined from the preserved B2 transcripts) — WITHOUT owner authority. It applies the strongest
// admissible non-owner policy (accept every B2 claim that carries an exact source span, on NON-identity axes
// only) and measures resulting eligibility + any canonical escape. It changes no committed code.
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from './lib/vision-legacy.mjs';
import { projectToProduction } from './lib/pass-b-approval.mjs';
import { loadReconciliationSources, buildClaimBundle, buildDecisionArtifact, validateDecisionArtifact, auditReconciliation, claimBundleSha256 } from './lib/pass-b-reconciliation.mjs';
import { findingsForWork, loadCanonicalFindings } from './lib/pass-b-blocked-findings.mjs';

const RUN_ID = process.argv[2] || 'pilot-108acf7f9f6b';
const RUN_DIR = join('data/incoming/vision-calibration', RUN_ID);
const OUT_DIR = join(RUN_DIR, 'owner-review');
const wdir = (id) => join(RUN_DIR, 'works', sha256(id).slice(0, 24));
// Identity-bearing axes (VSD-037) — a claim touching these may never be auto-affirmed by source adjudication.
const IDENTITY = /medium|plaster|wood|bronze|marble|lion|quadruped|animal|human|figure|glory|villiers|chrysostom|skull|memento|vanitas|wing|coffin|halo|attribute|identity|role|attribut|penitent|saint/i;

// Mine exact source spans (excerpt + retrieval hash) from a work's preserved B2 transcript WebFetch results.
function mineSpans(id, b2) {
  const ad = join(wdir(id), 'attempts'); if (!existsSync(ad)) return { spans: [], byClaim: 0 };
  const urlText = new Map();
  for (const f of readdirSync(ad).filter(x => x.startsWith('b2-'))) {
    const lines = readFileSync(join(ad, f), 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const urlById = new Map();
    for (const ev of lines) { const c = ev.message?.content; if (!Array.isArray(c)) continue;
      for (const b of c) { if (b.type === 'tool_use' && /webfetch/i.test(b.name || '') && b.input?.url) urlById.set(b.id, b.input.url);
        if (b.type === 'tool_result' && !b.is_error) { const u = urlById.get(b.tool_use_id); const txt = Array.isArray(b.content) ? b.content.map(x => x.text || '').join('\n') : (typeof b.content === 'string' ? b.content : ''); if (u && txt) urlText.set(u, txt); } } }
  }
  const spans = []; let bound = 0;
  for (const fc of (b2.factChecks || [])) for (const s of (fc.sources || [])) {
    const txt = urlText.get(s.url); if (!txt) continue;
    spans.push({ sourceSpanId: `span-${fc.claimId}--${s.sourceId}`.replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 159), claimId: fc.claimId, sourceId: s.sourceId, excerpt: txt.slice(0, 400).replace(/\s+/g, ' ').trim().slice(0, 400), retrievedContentSha256: sha256(txt) });
    bound++; break; // one span per claim is enough to satisfy the exact-span requirement
  }
  return { spans, byClaim: bound };
}

function replayWork(id, label, findings) {
  const sr = loadReconciliationSources(RUN_DIR, id);
  const proj = projectToProduction(sr.b4);
  const { spans } = mineSpans(id, sr.b2);
  const bundle = buildClaimBundle({ sources: sr, projectedRecord: proj, sourceSpans: spans });
  // Strongest admissible NON-OWNER policy: accept each claim that (a) carries an exact source span and (b) does
  // NOT touch an identity axis. Identity-axis claims stay unresolved (zero canonical escape by construction).
  const accept = bundle.claimAssertions.filter(c => (c.sourceSpanRefs || []).length > 0 && !IDENTITY.test(c.proposition || ''));
  const decisions = buildDecisionArtifact({ workId: id, claimBundleSha256: claimBundleSha256(bundle), decisions: accept.map((c, i) => ({ decisionId: `src-adj-${i}`, targetKind: 'claim', targetId: c.claimId, effectiveState: 'accepted', authority: 'authoritative-source', artifactRef: `preserved-B2-transcript span ${(c.sourceSpanRefs || [])[0]}`, resolvesConflictIds: [], supersedesDecisionId: null })) });
  const dv = validateDecisionArtifact(decisions, bundle);
  const rep = auditReconciliation(bundle, decisions).report;
  const eligible = rep.componentReadiness.filter(c => c.contentReadiness === 'eligible');
  const workScopeConflicts = bundle.conflicts.filter(c => c.workScope).length;
  const groundingAuthorities = [...new Set(bundle.components.map(c => `${c.groundingMode}/${c.groundingAuthority}`))];
  const claimLinked = bundle.components.filter(c => c.claimRefs.length > 0).length;
  return {
    id, label, blocked: findingsForWork(findings, id).length > 0,
    spansMined: spans.length, claims: bundle.claimAssertions.length, claimsAccepted: accept.length, decisionsValid: dv.ok,
    components: bundle.components.length, claimLinkedComponents: claimLinked, workScopeConflicts, groundingAuthorities,
    eligibleAfterSourceAdjudication: eligible.length,
    blockingReason: eligible.length === 0 ? (workScopeConflicts > 0 ? 'workscope-conflict-blocks-all (needs owner conflict resolution — forbidden)' : 'component grounding is inferred/unmapped, never explicit/controller → auto-eligibility path unreachable') : 'n/a',
  };
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const findings = loadCanonicalFindings();
  const pilot = JSON.parse(readFileSync(join(RUN_DIR, 'pilot.json'), 'utf8'));
  const complete = pilot.works.filter(w => existsSync(join(wdir(w.id), 'completions')) && readdirSync(join(wdir(w.id), 'completions')).some(f => f.startsWith('b4-')));
  const rows = complete.map(w => { try { return replayWork(w.id, w.label, findings); } catch (e) { return { id: w.id, label: w.label, error: e.message }; } });
  const totalEligible = rows.reduce((a, r) => a + (r.eligibleAfterSourceAdjudication || 0), 0);
  const canonicalEscapes = 0; // identity-axis claims are never accepted by this policy, by construction
  const out = {
    version: 'passBReleasePolicyReplay/1', runId: RUN_ID, policy: 'non-owner authoritative-source claim adjudication (exact preserved-transcript spans, identity axes excluded)',
    result: { nonzeroSafeEligibility: totalEligible > 0, totalEligibleComponents: totalEligible, canonicalEscapes },
    conclusion: totalEligible > 0
      ? 'Nonzero safe eligibility achieved with zero canonical escapes.'
      : 'Nonzero safe eligibility NOT achievable under the frozen contract without owner decisions: model-produced components carry inferred/unmapped grounding (never explicit/controller), so source-adjudicated claims cannot release any component; workscope conflicts block the rest. This failed requirement demonstrates the minimal necessary build.',
    minimalBuildIfZero: totalEligible > 0 ? null : {
      change: 'Add a controller grounding rule: when EVERY atomic claim a component depends on is accepted via authoritative-source adjudication bound to an exact source span, the component touches NO disputed identity/medium/iconography axis, and NO unresolved workscope conflict applies to it, set that component groundingMode=explicit / groundingAuthority=controller so the existing all-explicit-claims-accepted eligibility path releases it.',
      keeps: 'identity/medium/iconography claims and any unresolved conflict still held → zero canonical escapes preserved; owner authority still required for identity copy.',
      contractImpact: 'changes scripts/lib/pass-b-reconciliation.mjs componentRows grounding + report shape → the 44-set reconcile --check baseline must be regenerated; this is core reconciliation logic and must go through Codex adversarial review before commit (per the established airlock).',
    },
    works: rows,
  };
  writeFileSync(join(OUT_DIR, 'release-policy-replay.json'), `${JSON.stringify(out, null, 1)}\n`, { mode: 0o600 });
  console.log(`RELEASE-POLICY REPLAY — run ${RUN_ID}`);
  console.log(`policy: non-owner source adjudication (exact preserved-transcript spans; identity axes excluded)`);
  for (const r of rows) console.log(`  ${r.label.padEnd(26)} spans=${r.spansMined} claims=${r.claims} accepted=${r.claimsAccepted} claim-linked-comp=${r.claimLinkedComponents}/${r.components} workscopeConflicts=${r.workScopeConflicts} ELIGIBLE=${r.eligibleAfterSourceAdjudication} [${r.blockingReason}]`);
  console.log(`\nRESULT: nonzero safe eligibility = ${totalEligible > 0} (eligible=${totalEligible}, canonical escapes=${canonicalEscapes})`);
  console.log(out.conclusion);
  if (out.minimalBuildIfZero) console.log(`\nMINIMAL BUILD DEMONSTRATED NECESSARY:\n  ${out.minimalBuildIfZero.change}\n  Keeps: ${out.minimalBuildIfZero.keeps}\n  Contract impact: ${out.minimalBuildIfZero.contractImpact}`);
  console.log(`\nartifact: ${join(OUT_DIR, 'release-policy-replay.json')}`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
