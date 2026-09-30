// VSD-038 (proposed) regressions for the structured release-policy contract. Offline, deterministic. Every
// negative path must fail closed; the one positive path releases exactly one explicitly-grounded, non-identity,
// conflict-free, admissibly-accepted component while everything else stays held.
import assert from 'node:assert';
import { computeReleaseEligibility, validateStructuredRefs, admissibleClaimAcceptances } from '../scripts/lib/pass-b-release-grounding.mjs';

let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const verdict = (rep, id) => rep.components.find(c => c.componentId === id)?.verdict;

// Base fixture: 3 components; claims c1(date, non-identity), c2(skull, identity), c3(place, non-identity).
const baseBundle = () => ({
  components: [{ componentId: 'note:n1', surface: 'notes', claimRefs: ['inferred-c1'] }, { componentId: 'note:n2', surface: 'notes', claimRefs: [] }, { componentId: 'why', surface: 'why', claimRefs: [] }],
  claimAssertions: [{ claimId: 'c1', proposition: 'The work dates to c. 1500.' }, { claimId: 'c2', proposition: 'A skull is visible at the base.' }, { claimId: 'c3', proposition: 'Made in Florence.' }],
  conflicts: [], openClaims: [],
});
const catalog = { title: '', artist: '', date: 'c. 1500', place: 'Florence', medium: '', style: '' };
// c1 accepted via authoritative-source + admissible catalog-field mapping (date).
const acceptDate = { catalogFieldRefs: { c1: 'date' } };
const decAcceptC1 = { decisions: [{ decisionId: 'd1', targetKind: 'claim', targetId: 'c1', effectiveState: 'accepted', authority: 'authoritative-source', artifactRef: 'x', resolvesConflictIds: [] }] };

t('POSITIVE: one explicitly-grounded, admissibly-accepted, non-identity component releases; others held', () => {
  const rep = computeReleaseEligibility({ bundle: baseBundle(), decisions: decAcceptC1, structuredRefs: { componentClaimRefs: { 'note:n1': ['c1'] } }, acceptance: acceptDate, catalog });
  assert.strictEqual(rep.eligibleCount, 1);
  assert.strictEqual(verdict(rep, 'note:n1'), 'release-eligible');
  assert.strictEqual(verdict(rep, 'note:n2'), 'review-required'); // no explicit grounding
  assert.strictEqual(verdict(rep, 'why'), 'review-required');
});

t('NEG missing conflict refs → work-scope conflict blocks ALL (incl. otherwise-eligible n1)', () => {
  const b = baseBundle(); b.conflicts = [{ conflictId: 'k1', workScope: true }];
  const rep = computeReleaseEligibility({ bundle: b, decisions: decAcceptC1, structuredRefs: { componentClaimRefs: { 'note:n1': ['c1'] } }, acceptance: acceptDate, catalog });
  assert.strictEqual(rep.eligibleCount, 0);
  assert.strictEqual(verdict(rep, 'note:n1'), 'blocked');
});

t('NEG missing open-claim refs → work-scope open claim prevents eligibility (review)', () => {
  const b = baseBundle(); b.openClaims = [{ openClaimId: 'o1' }];
  const rep = computeReleaseEligibility({ bundle: b, decisions: decAcceptC1, structuredRefs: { componentClaimRefs: { 'note:n1': ['c1'] } }, acceptance: acceptDate, catalog });
  assert.strictEqual(rep.eligibleCount, 0);
  assert.strictEqual(verdict(rep, 'note:n1'), 'review-required');
});

t('NEG dangling/wrong component ref → whole bundle invalid, all blocked', () => {
  const rep = computeReleaseEligibility({ bundle: baseBundle(), decisions: decAcceptC1, structuredRefs: { componentClaimRefs: { 'note:NOPE': ['c1'] } }, acceptance: acceptDate, catalog });
  assert.ok(rep.invalidBundle && rep.eligibleCount === 0);
  assert.ok(rep.components.every(c => c.verdict === 'blocked'));
});

t('NEG model-declared grounding authority is not acceptance', () => {
  const dec = { decisions: [{ decisionId: 'd1', targetKind: 'claim', targetId: 'c1', effectiveState: 'accepted', authority: 'B4', artifactRef: 'x', resolvesConflictIds: [] }] };
  const rep = computeReleaseEligibility({ bundle: baseBundle(), decisions: dec, structuredRefs: { componentClaimRefs: { 'note:n1': ['c1'] } }, acceptance: acceptDate, catalog });
  assert.strictEqual(verdict(rep, 'note:n1'), 'review-required');
});

t('NEG inferred source-ID mapping is never promoted (only structured componentClaimRefs count)', () => {
  // n1 carries an INFERRED bundle.claimRefs but NO structured componentClaimRefs entry → not eligible.
  const rep = computeReleaseEligibility({ bundle: baseBundle(), decisions: decAcceptC1, structuredRefs: {}, acceptance: acceptDate, catalog });
  assert.strictEqual(rep.eligibleCount, 0);
  assert.strictEqual(verdict(rep, 'note:n1'), 'review-required');
});

t('NEG unverified source excerpt is not authority', () => {
  const rep = computeReleaseEligibility({ bundle: baseBundle(), decisions: decAcceptC1, structuredRefs: { componentClaimRefs: { 'note:n1': ['c1'] } }, acceptance: { verifiedSpans: { c1: { spanId: 's1' } } }, catalog }); // no reverifiedBytesSha256/entailment
  assert.strictEqual(verdict(rep, 'note:n1'), 'review-required');
  const adm = admissibleClaimAcceptances({ bundle: baseBundle(), catalog, acceptance: { verifiedSpans: { c1: { spanId: 's1' } } } });
  assert.ok(!adm.accepted.has('c1'), 'bare excerpt is not admissible');
});

t('NEG identity-axis claim requires owner (skull → not auto-released)', () => {
  const dec = { decisions: [{ decisionId: 'd', targetKind: 'claim', targetId: 'c2', effectiveState: 'accepted', authority: 'owner', artifactRef: 'x', resolvesConflictIds: [] }] };
  const rep = computeReleaseEligibility({ bundle: baseBundle(), decisions: dec, structuredRefs: { componentClaimRefs: { 'note:n2': ['c2'] } }, acceptance: {}, catalog });
  assert.strictEqual(verdict(rep, 'note:n2'), 'review-required');
});

t('POSITIVE-scoped: a structured conflict blocks its component while an unrelated grounded component stays eligible', () => {
  const b = baseBundle();
  b.conflicts = [{ conflictId: 'k1' }];
  b.components.push({ componentId: 'note:n3', surface: 'notes', claimRefs: [] });
  b.claimAssertions.push({ claimId: 'c4', proposition: 'Painted in tempera on panel around 1500.' });
  const rep = computeReleaseEligibility({
    bundle: b, decisions: { decisions: [decAcceptC1.decisions[0], { decisionId: 'd4', targetKind: 'claim', targetId: 'c4', effectiveState: 'accepted', authority: 'authoritative-source', artifactRef: 'x', resolvesConflictIds: [] }] },
    structuredRefs: { componentClaimRefs: { 'note:n1': ['c1'], 'note:n3': ['c4'] }, conflictRefs: { k1: { componentRefs: ['note:n3'], claimRefs: ['c4'] } } },
    acceptance: { catalogFieldRefs: { c1: 'date', c4: 'date' } }, catalog: { ...catalog, date: '1500' },
  });
  assert.strictEqual(verdict(rep, 'note:n1'), 'release-eligible', 'unrelated grounded component stays eligible');
  assert.strictEqual(verdict(rep, 'note:n3'), 'blocked', 'the conflict-scoped component is blocked');
});

t('NEG canonical blocked work stays fully blocked', () => {
  const rep = computeReleaseEligibility({ bundle: baseBundle(), decisions: decAcceptC1, structuredRefs: { componentClaimRefs: { 'note:n1': ['c1'] } }, acceptance: acceptDate, catalog, blockedFindingActive: true });
  assert.strictEqual(rep.eligibleCount, 0);
  assert.ok(rep.components.every(c => c.verdict === 'blocked'));
});

t('validateStructuredRefs is fail-closed on dangling refs', () => {
  assert.ok(!validateStructuredRefs(baseBundle(), { componentClaimRefs: { 'note:n1': ['nope'] } }).ok);
  assert.ok(validateStructuredRefs(baseBundle(), { componentClaimRefs: { 'note:n1': ['c1'] } }).ok);
});

console.log(`\n${n} release-grounding regressions passed`);
