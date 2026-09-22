// VSD-035 reconciliation regressions: model proposals are not decisions; conflicts block; owner/source
// decisions are append-only and component-bound; reports are immutable/recomputable; omissions/tampering fail.
import assert from 'node:assert';
import { sha256 } from '../scripts/lib/vision-legacy.mjs';
import {
  buildClaimBundle, validateClaimBundle, buildDecisionArtifact, validateDecisionArtifact,
  auditReconciliation, verifyReconciliationReport, verifyClaimBundleAgainstSources,
  claimBundleSha256, ineligibleApprovedComponents,
} from '../scripts/lib/pass-b-reconciliation.mjs';

let n = 0; const ok = (v, m) => { assert.ok(v, m); n++; };
const H = c => c.repeat(64);
const source = { sourceId: 's1', url: 'https://museum.example/work', title: 'Museum work', retrievedAt: '2026-09-15T00:00:00Z' };
const bindings = { runId: 'run-x', workId: 'w1', imageSha256: H('a'), manifestSha256: H('b'), b0Sha256: H('c'), b1CompletionSha256: H('d'), b2CompletionSha256: H('e'), b3CompletionSha256: H('f'), b4CompletionSha256: H('1'), b4BodySha256: H('2'), legacySnapshotSha256: H('3') };
const sources = {
  workId: 'w1', sourceBindings: bindings,
  b1: { evidence: { style: [{ evidenceId: 'e1', feature: 'visible fold', why: 'a carved fold is visible', bbox: [0.1, 0.1, 0.2, 0.2], confidence: 0.9 }] }, visual: { delights: [] } },
  b2: { factChecks: [{ claimId: 'c1', claim: 'The object is plaster.', verdict: 'supported', confidence: 0.9, sources: [source] }], targetedVerificationRequests: [{ requestId: 'r1', claimId: 'c1', whatToLocate: 'surface' }] },
  b3: { verifications: [{ requestId: 'r1', found: true, bbox: [0.1, 0.1, 0.2, 0.2], note: 'surface visible', confidence: 0.8 }] },
  b4: {
    proposedWhy: 'A teaching explanation.', proposedCues: ['fold → carved surface'],
    notes: [{ noteId: 'n1', head: 'Fold', body: 'A visible fold.', pin: null, role: 'technique', evidenceRef: 'e1', sourceRefs: ['s1'] }],
    hotspots: [{ hotspotId: 'h1', observationId: 'o1', x: 20, y: 20, region: null, rank: 1, role: 'technique', conciseText: 'Fold', deepText: 'Visible fold.', evidenceRef: 'e1', confidence: 0.9, sourceDependent: false }],
    guide: [{ questionId: 'q1', q: 'What is it made of?', a: 'Plaster.', kind: 'image', evidenceRef: 'e1', sourceRefs: ['s1'] }],
    conflicts: [],
  },
};
const projected = { teach: { why: sources.b4.proposedWhy, cues: sources.b4.proposedCues, notes: [{ head: 'Fold', body: 'A visible fold.', x: null, y: null }], guide: [{ q: 'What is it made of?', a: 'Plaster.' }] }, hotspots: [{ n: 1, x: 20, y: 20 }] };
const bundle = buildClaimBundle({ sources, projectedRecord: projected });

ok(validateClaimBundle(bundle).ok, 'conservative claim bundle validates');
assert.throws(() => buildClaimBundle({ sources, projectedRecord: projected, entityGraph: { version: 'bad', regions: [], entities: [], uncertainty: '' } }), /invalid entity graph/); n++;
const empty = buildDecisionArtifact({ workId: 'w1', claimBundleSha256: claimBundleSha256(bundle), decisions: [] });
const base = auditReconciliation(bundle, empty);
ok(base.ok && base.report.contentReadiness === 'review-required', 'model-supported claim does not become effectively accepted');
ok(base.report.claimStates[0].effectiveState === 'unresolved' && base.report.claimStates[0].proposedVerdict === 'supported', 'proposal and effective state remain separate');
ok(base.report.violations.some(v => v.code === 'source-entailment-unverifiable'), 'source presence without exact span is flagged');
ok(ineligibleApprovedComponents(base.report, ['why', 'notes']).length === 2, 'selected unready components are exposed to approval gate');

const ownerDecisions = buildDecisionArtifact({
  workId: 'w1', claimBundleSha256: claimBundleSha256(bundle),
  decisions: bundle.components.map((c, i) => ({ decisionId: `d${i}`, targetKind: 'component', targetId: c.componentId, effectiveState: 'accepted', authority: 'owner', artifactRef: 'owner-review.json', supersedesDecisionId: null })),
});
ok(validateDecisionArtifact(ownerDecisions, bundle).ok, 'explicit owner component decisions validate');
const accepted = auditReconciliation(bundle, ownerDecisions);
ok(accepted.report.contentReadiness === 'eligible' && accepted.report.componentReadiness.every(c => c.contentReadiness === 'eligible'), 'owner decisions make exact bound components eligible');
ok(verifyReconciliationReport(accepted.report, bundle, ownerDecisions).ok, 'report recomputes byte-for-byte');
const tampered = structuredClone(accepted.report); tampered.contentReadiness = 'blocked';
ok(!verifyReconciliationReport(tampered, bundle, ownerDecisions).ok, 'tampered report rejected');

const selfResolvedBundle = structuredClone(bundle);
selfResolvedBundle.conflicts = [{ conflictId: 'x1', claimRefs: ['c1'], componentRefs: ['note:n1'], workScope: false, left: 'wood', right: 'plaster', modelStatus: 'resolved', resolutionProposal: 'plaster' }];
const conflictReport = auditReconciliation(selfResolvedBundle, buildDecisionArtifact({ workId: 'w1', claimBundleSha256: claimBundleSha256(selfResolvedBundle), decisions: [] }));
ok(conflictReport.report.componentReadiness.find(c => c.componentId === 'note:n1').contentReadiness === 'blocked', 'model self-resolved conflict still blocks affected component');
ok(conflictReport.report.violations.some(v => v.code === 'model-self-resolution-ignored'), 'model self-resolution recorded as ignored');
const ownerConflictDecision = buildDecisionArtifact({ workId: 'w1', claimBundleSha256: claimBundleSha256(selfResolvedBundle), decisions: [{ decisionId: 'owner-n1', targetKind: 'component', targetId: 'note:n1', effectiveState: 'accepted', authority: 'owner', artifactRef: 'owner-reviewed-exact-note.json', resolvesConflictIds: ['x1'], supersedesDecisionId: null }] });
ok(auditReconciliation(selfResolvedBundle, ownerConflictDecision).report.componentReadiness.find(c => c.componentId === 'note:n1').contentReadiness === 'eligible', 'owner exact-component review can adjudicate a coarse inherited conflict');
const unboundConflictDecision = structuredClone(ownerConflictDecision); delete unboundConflictDecision.decisions[0].resolvesConflictIds;
ok(!validateDecisionArtifact(unboundConflictDecision, selfResolvedBundle).ok, 'owner acceptance must name every applicable conflict it resolves');
const workConflictBundle = structuredClone(bundle);
workConflictBundle.conflicts = [{ conflictId: 'work-x', claimRefs: [], componentRefs: [], workScope: true, left: 'A', right: 'B', modelStatus: 'open', resolutionProposal: '' }];
const workOverride = buildDecisionArtifact({ workId: 'w1', claimBundleSha256: claimBundleSha256(workConflictBundle), decisions: [{ decisionId: 'owner-work', targetKind: 'component', targetId: 'note:n1', effectiveState: 'accepted', authority: 'owner', artifactRef: 'owner-reviewed-work-conflict.json', resolvesConflictIds: [], supersedesDecisionId: null }] });
ok(!validateDecisionArtifact(workOverride, workConflictBundle).ok, 'work-scope conflict cannot be overridden without an explicit conflict reference');
const pendingConflictDecision = buildDecisionArtifact({ workId: 'w1', claimBundleSha256: claimBundleSha256(selfResolvedBundle), decisions: [{ decisionId: 'pending-n1', targetKind: 'component', targetId: 'note:n1', effectiveState: 'unresolved', authority: 'owner', artifactRef: 'pending-template.json', supersedesDecisionId: null }] });
ok(auditReconciliation(selfResolvedBundle, pendingConflictDecision).report.componentReadiness.find(c => c.componentId === 'note:n1').contentReadiness === 'blocked', 'pending owner template cannot downgrade an unresolved conflict');

const controllerAccept = buildDecisionArtifact({ workId: 'w1', claimBundleSha256: claimBundleSha256(bundle), decisions: [{ decisionId: 'dc', targetKind: 'claim', targetId: 'c1', effectiveState: 'accepted', authority: 'controller', artifactRef: 'rule', supersedesDecisionId: null }] });
ok(!validateDecisionArtifact(controllerAccept, bundle).ok, 'controller cannot self-accept semantic truth under policy /1');
const sourceComponentAccept = buildDecisionArtifact({ workId: 'w1', claimBundleSha256: claimBundleSha256(bundle), decisions: [{ decisionId: 'ds', targetKind: 'component', targetId: 'note:n1', effectiveState: 'accepted', authority: 'authoritative-source', artifactRef: 'museum-page', supersedesDecisionId: null }] });
ok(!validateDecisionArtifact(sourceComponentAccept, bundle).ok, 'source authority cannot directly approve finished player copy');
const sourceClaimWithoutSpan = buildDecisionArtifact({ workId: 'w1', claimBundleSha256: claimBundleSha256(bundle), decisions: [{ decisionId: 'dsc', targetKind: 'claim', targetId: 'c1', effectiveState: 'accepted', authority: 'authoritative-source', artifactRef: 'museum-page', supersedesDecisionId: null }] });
ok(!validateDecisionArtifact(sourceClaimWithoutSpan, bundle).ok, 'source authority cannot accept claim without exact source span');
const spanBundle = buildClaimBundle({ sources, projectedRecord: projected, sourceSpans: [{ sourceSpanId: 'span1', claimId: 'c1', sourceId: 's1', excerpt: 'The object is plaster.', retrievedContentSha256: H('9') }] });
const sourceClaimWithSpan = buildDecisionArtifact({ workId: 'w1', claimBundleSha256: claimBundleSha256(spanBundle), decisions: [{ decisionId: 'dsc2', targetKind: 'claim', targetId: 'c1', effectiveState: 'accepted', authority: 'authoritative-source', artifactRef: 'museum-page#span1', supersedesDecisionId: null }] });
ok(validateDecisionArtifact(sourceClaimWithSpan, spanBundle).ok, 'source authority can adjudicate an atomic claim with a stored exact span');
const modelGrounded = structuredClone(spanBundle); const modelNote = modelGrounded.components.find(c => c.componentId === 'note:n1');
modelNote.claimRefs = ['c1']; modelNote.groundingMode = 'explicit'; modelNote.groundingAuthority = 'model-proposal';
const modelGroundedDecision = buildDecisionArtifact({ workId: 'w1', claimBundleSha256: claimBundleSha256(modelGrounded), decisions: [{ ...sourceClaimWithSpan.decisions[0] }] });
ok(auditReconciliation(modelGrounded, modelGroundedDecision).report.componentReadiness.find(c => c.componentId === 'note:n1').contentReadiness === 'review-required', 'model-declared claim grounding cannot turn an accepted fact into approved copy');
const wrongSourceSpan = structuredClone(spanBundle); wrongSourceSpan.sourceSpans[0].sourceId = 'not-cited';
ok(!validateClaimBundle(wrongSourceSpan).ok, 'source span must belong to a source actually cited by that claim');
const findingResolution = buildDecisionArtifact({
  workId: 'w1', claimBundleSha256: claimBundleSha256(bundle), decisions: [],
  blockedFindingResolutions: [{ findingId: 'cb-example', authority: 'owner', artifactRef: 'owner-correction-review.json', freshRun: true, resolvedClaims: [{ claim: 'invented wings' }] }],
});
ok(validateDecisionArtifact(findingResolution, bundle).ok, 'fresh-run blocked-finding resolution is schema-bound in decisions artifact');
const malformedFindingResolution = structuredClone(findingResolution); malformedFindingResolution.blockedFindingResolutions[0].freshRun = false;
ok(!validateDecisionArtifact(malformedFindingResolution, bundle).ok, 'blocked-finding resolution must explicitly attest a fresh run');
const badTransition = buildDecisionArtifact({ workId: 'w1', claimBundleSha256: claimBundleSha256(bundle), decisions: [
  { decisionId: 'd1', targetKind: 'claim', targetId: 'c1', effectiveState: 'disputed', authority: 'owner', artifactRef: 'a1', supersedesDecisionId: null },
  { decisionId: 'd2', targetKind: 'claim', targetId: 'c1', effectiveState: 'accepted', authority: 'owner', artifactRef: 'a2', supersedesDecisionId: null },
] });
ok(!validateDecisionArtifact(badTransition, bundle).ok, 'decision transition must append with explicit supersedes id');
badTransition.decisions[1].supersedesDecisionId = 'd1';
ok(validateDecisionArtifact(badTransition, bundle).ok, 'append-only reopening/resolution with supersedes validates');
const authorityDowngrade = buildDecisionArtifact({ workId: 'w1', claimBundleSha256: claimBundleSha256(bundle), decisions: [
  { decisionId: 'owner-block', targetKind: 'claim', targetId: 'c1', effectiveState: 'rejected', authority: 'owner', artifactRef: 'owner-review', supersedesDecisionId: null },
  { decisionId: 'controller-reopen', targetKind: 'claim', targetId: 'c1', effectiveState: 'unresolved', authority: 'controller', artifactRef: 'controller-rule', supersedesDecisionId: 'owner-block' },
] });
ok(!validateDecisionArtifact(authorityDowngrade, bundle).ok, 'lower authority cannot supersede an owner decision');

const omitted = structuredClone(bundle); omitted.claimAssertions = [];
ok(!verifyClaimBundleAgainstSources(omitted, sources, projected).ok, 'preserved B2 claim omission fails');
const alteredB2 = structuredClone(bundle); alteredB2.claimAssertions.find(c => c.assertedBy === 'B2').sourceRefs = ['invented-source'];
ok(!verifyClaimBundleAgainstSources(alteredB2, sources, projected).ok, 'preserved B2 source/verdict core cannot be rewritten in reconciliation');
const changedComponent = structuredClone(bundle); changedComponent.components[0].contentSha256 = sha256('changed');
ok(!verifyClaimBundleAgainstSources(changedComponent, sources, projected).ok, 'component content mismatch fails');
const forgedGrounding = structuredClone(bundle); Object.assign(forgedGrounding.components.find(c => c.componentId === 'note:n1'), { claimRefs: ['c1'], groundingMode: 'explicit', groundingAuthority: 'controller', groundingArtifactRef: 'forged://rule' });
ok(!verifyClaimBundleAgainstSources(forgedGrounding, sources, projected).ok, 'component grounding must be rebound to source-derived grounding');
const omittedConflict = structuredClone(selfResolvedBundle); omittedConflict.conflicts = [];
ok(!verifyClaimBundleAgainstSources(omittedConflict, { ...sources, b4: { ...sources.b4, conflicts: [{ field: 'notes', left: 'wood', right: 'plaster', status: 'resolved', resolution: 'plaster' }] } }, projected).ok, 'B4 conflict omission fails source verification');
const omittedObservation = structuredClone(bundle); omittedObservation.observations = omittedObservation.observations.filter(o => o.observationId !== 'e1');
ok(!verifyClaimBundleAgainstSources(omittedObservation, sources, projected).ok, 'preserved visual observation omission fails');
const alteredObservation = structuredClone(bundle); alteredObservation.observations.find(o => o.observationId === 'e1').proposition = 'different pixels';
ok(!verifyClaimBundleAgainstSources(alteredObservation, sources, projected).ok, 'preserved visual observation text/region cannot be rewritten');
const inventedObservation = structuredClone(bundle); inventedObservation.observations.push({ observationId: 'invented', principal: 'owner', kind: 'visible-detail', proposition: 'invented visual evidence', region: null, confidence: 1, claimRefs: [] });
ok(!verifyClaimBundleAgainstSources(inventedObservation, sources, projected).ok, 'invented observation cannot enter a source-bound bundle');

const sourcesWithSeams = structuredClone(sources);
sourcesWithSeams.b4.corrections = { consequential: [{ field: 'medium', from: 'wood', to: 'plaster', evidenceRef: 'e1', sourceRefs: ['s1'], confidence: 0.95 }] };
sourcesWithSeams.b4.uncertainty = 'The claimed wings are not visually confirmed.';
const seamBundle = buildClaimBundle({ sources: sourcesWithSeams, projectedRecord: projected });
ok(seamBundle.claimAssertions.some(c => c.assertedBy === 'B4' && c.kind === 'correction-proposal'), 'B4 structured correction enters graph as a proposal');
ok(seamBundle.openClaims.length === 1, 'B4 free-text uncertainty enters graph as an open concern');
ok(auditReconciliation(seamBundle).report.componentReadiness.every(c => c.contentReadiness !== 'eligible'), 'open uncertainty cannot silently become eligibility');
const omittedCorrection = structuredClone(seamBundle); omittedCorrection.claimAssertions = omittedCorrection.claimAssertions.filter(c => c.assertedBy !== 'B4');
ok(!verifyClaimBundleAgainstSources(omittedCorrection, sourcesWithSeams, projected).ok, 'B4 correction omission fails source verification');
const omittedUncertainty = structuredClone(seamBundle); omittedUncertainty.openClaims = [];
ok(!verifyClaimBundleAgainstSources(omittedUncertainty, sourcesWithSeams, projected).ok, 'B4 uncertainty omission fails source verification');

// ---- VSD-038 B4 fork: structured model proposals scope holds, but never become authority/eligibility ----
const structuredSources = structuredClone(sources);
structuredSources.b4.conflicts = [{ field: 'ambiguous legacy wording', left: 'wood', right: 'plaster', status: 'humanReview', resolution: '' }];
structuredSources.b4.uncertainty = 'The guide wording still needs review.';
structuredSources.b4.structuredGrounding = {
  version: 'passBStructuredGrounding/1',
  components: [
    { target: 'note:0', componentId: 'note:n1', surface: 'notes', ordinal: 0, claimRefs: ['c1'], observationRefs: ['e1'] },
    { target: 'guide:0', componentId: 'guide:q1', surface: 'guide', ordinal: 0, claimRefs: ['c1'], observationRefs: ['b3:r1'] },
  ],
  unresolvedComponentTargets: [],
  conflicts: [{ conflictId: 'b4-conflict:0', conflictIndex: 0, componentRefs: ['note:n1'], claimRefs: ['c1'], workScope: false, unresolvedTargets: [] }],
  openClaims: [{ openClaimId: 'open-guide-1', proposition: 'The guide wording still needs review.', componentRefs: ['guide:q1'], claimRefs: ['c1'], workScope: false, unresolvedTargets: [] }],
};
const structuredBundle = buildClaimBundle({ sources: structuredSources, projectedRecord: projected });
ok(validateClaimBundle(structuredBundle).ok, 'structured B4 grounding produces a valid reconciliation bundle');
ok(structuredBundle.policyVersion === 'passBReconciliationPolicy/2-structured-b4', 'structured B4 forks reconciliation policy without rewriting legacy baseline sets');
ok(structuredBundle.components.find(c => c.componentId === 'note:n1').groundingAuthority === 'model-proposal', 'structured B4 binding remains a model proposal, never controller authority');
ok(structuredBundle.conflicts[0].componentRefs.join() === 'note:n1' && !structuredBundle.conflicts[0].workScope, 'structured conflict scopes to its exact translated component');
ok(structuredBundle.openClaims[0].componentRefs.join() === 'guide:q1' && !structuredBundle.openClaims[0].workScope, 'structured open claim scopes to its exact translated component');
const structuredReport = auditReconciliation(structuredBundle).report;
ok(structuredReport.componentReadiness.find(c => c.componentId === 'note:n1').contentReadiness === 'blocked', 'structured conflict blocks its note');
ok(structuredReport.componentReadiness.find(c => c.componentId === 'guide:q1').contentReadiness === 'review-required', 'structured open claim holds its guide');
ok(structuredReport.componentReadiness.find(c => c.componentId === 'why').contentReadiness === 'review-required', 'unrelated component is not blocked but remains ungrounded/review-required');
ok(verifyClaimBundleAgainstSources(structuredBundle, structuredSources, projected).ok, 'structured scope and grounding rederive exactly from the bound B4 source');
const forgedScope = structuredClone(structuredBundle); forgedScope.conflicts[0].componentRefs = ['why'];
ok(!verifyClaimBundleAgainstSources(forgedScope, structuredSources, projected).ok, 'stored reconciliation cannot rewrite controller-translated conflict scope');

// ---- VSD-037: owner-approved empty collection surface (via the existing *-set:empty component) + coupling ----
const { surfaceCouplingViolation } = await import('../scripts/lib/pass-b-approval.mjs');
const projectedNoHot = { teach: projected.teach, hotspots: [] };
const bundleNoHot = buildClaimBundle({ sources, projectedRecord: projectedNoHot });
const emptyHotComp = bundleNoHot.components.find(c => c.surface === 'hotspots').componentId;
ok(emptyHotComp === 'hotspot-set:empty', 'an empty hotspots surface is represented by a stable hotspot-set:empty component');
const noteComp = bundleNoHot.components.find(c => c.surface === 'notes').componentId;
const acc = (id, tid) => ({ decisionId: id, targetKind: 'component', targetId: tid, effectiveState: 'accepted', authority: 'owner', artifactRef: 'owner-review candidate', resolvesConflictIds: [], supersedesDecisionId: null });

// (a) replacing notes + clearing hotspots to [] succeeds after REAL owner approval (accept note + accept the empty hotspot set)
const approved = buildDecisionArtifact({ workId: 'w1', claimBundleSha256: claimBundleSha256(bundleNoHot), decisions: [acc('own-note', noteComp), acc('own-emptyhot', emptyHotComp)] });
ok(validateDecisionArtifact(approved, bundleNoHot).ok, 'owner decisions incl. empty-set acceptance validate');
const repA = auditReconciliation(bundleNoHot, approved).report;
ok(repA.componentReadiness.find(c => c.componentId === emptyHotComp).contentReadiness === 'eligible', 'owner-accepted empty hotspot set is eligible');
ok(ineligibleApprovedComponents(repA, ['notes', 'hotspots']).length === 0, 'replacing notes + owner-cleared empty hotspots is fully approvable');
ok(surfaceCouplingViolation(['notes', 'hotspots']) === null, 'notes+hotspots approved together satisfies coupling');

// (b) ONE-WAY coupling: changing notes without hotspots is rejected; approving hotspots alone is allowed
ok(surfaceCouplingViolation(['notes']) === 'notes-approval-requires-hotspots', 'notes without hotspots is rejected (one-way coupling)');
ok(surfaceCouplingViolation(['hotspots']) === null, 'hotspots-only is allowed (coordinate-only review while notes unchanged)');
ok(surfaceCouplingViolation(['why', 'cues', 'guide']) === null, 'unrelated surfaces are unaffected by coupling');

// (c) no empty surface becomes eligible automatically — without the explicit owner-accept the empty set is not eligible
const noAccept = buildDecisionArtifact({ workId: 'w1', claimBundleSha256: claimBundleSha256(bundleNoHot), decisions: [acc('own-note', noteComp)] });
const repC = auditReconciliation(bundleNoHot, noAccept).report;
ok(repC.componentReadiness.find(c => c.componentId === emptyHotComp).contentReadiness !== 'eligible', 'an empty surface is never eligible without an explicit owner acceptance');
ok(ineligibleApprovedComponents(repC, ['notes', 'hotspots']).some(r => r.componentId === emptyHotComp), 'the un-accepted empty hotspot set blocks approval of the hotspots surface');

console.log(`ok - pass-b reconciliation: ${n} checks passed`);
