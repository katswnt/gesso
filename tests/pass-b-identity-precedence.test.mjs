// VSD-037 regression: identity precedence + omission REVIEW aid. Offline, deterministic. Two layers of coverage:
//   (1) synthetic unit fixtures for the axis/omission/gate logic (incl. the `coffin` iconography term);
//   (2) the tracked real content-repair-failure B4 bodies (tests/fixtures/pass-b-content-repair/*.b4-body.json),
//       asserting the known false La Gloire / St. John language cannot survive the review projection.
// This aid only ever OMITS on a disputed axis; it never affirms and is not the release mechanism.
import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { disputedIdentityAxes, applyPrecedence, assertNoDisputedAffirmative, axisOfBlockedClaim, classifyFragment } from '../scripts/lib/pass-b-identity-precedence.mjs';
import { projectToProduction } from '../scripts/lib/pass-b-approval.mjs';
import { loadCanonicalFindings, findingsForWork } from '../scripts/lib/pass-b-blocked-findings.mjs';
import { sha256 } from '../scripts/lib/vision-legacy.mjs';

let n = 0; const t = (name, fn) => { fn(); n++; console.log(`ok ${name}`); };
const FIX = 'tests/fixtures/pass-b-content-repair';
const projectForReview = (b4, conflicts, blockedClaims) => {
  const p = applyPrecedence({ projected: projectToProduction(b4), conflicts, blockedClaims });
  assertNoDisputedAffirmative(p);
  return p;
};
const affirmativeText = (p) => {
  const tt = p.affirmative.teach;
  return [tt.why || '', ...(tt.cues || []), ...(tt.notes || []).map((x) => `${x.head} ${x.body}`), ...(tt.guide || []).map((x) => `${x.q} ${x.a}`)].join(' • ').toLowerCase();
};

// ---- unit: axis mapping + gate ----
t('axisOfBlockedClaim maps sealed claims to axes', () => {
  assert.deepStrictEqual(axisOfBlockedClaim('wrong-medium: rich index asserts carved wood; the work is plaster'), ['medium']);
  assert.ok(axisOfBlockedClaim('invented-skull: skull / memento-mori / vanitas program').includes('iconography'));
  assert.ok(axisOfBlockedClaim('entity-aliasing: crawling human penitent AND crouching lion; the figure is a crawling man').includes('human-vs-animal'));
});

t('coffin is a canonical iconography term (negative control for the earlier miss)', () => {
  const projected = { teach: { why: null, cues: [], notes: [{ head: 'The coffin', body: 'A broken coffin at the base.' }, { head: 'Documented attribution', body: 'Attribution rests on archival records.' }], guide: [] }, hotspots: [] };
  const r = applyPrecedence({ projected, blockedClaims: ['invented-skull: skull / memento-mori / vanitas'] }); // iconography disputed
  const heads = r.affirmative.teach.notes.map((x) => x.head);
  assert.ok(!heads.some((h) => /coffin/i.test(h)), `coffin note survived affirmative copy: ${heads}`);
  assert.ok(heads.includes('Documented attribution'), 'neutral note wrongly dropped');
  assertNoDisputedAffirmative(r);
});

t('bindings are HELD for review on a disputed work, never dropped or affirmed', () => {
  const projected = { teach: { why: 'A neutral line.', cues: [], notes: [], guide: [] }, hotspots: [{ n: 1, x: 10, y: 20 }, { n: 2, x: 30, y: 40 }] };
  const r = applyPrecedence({ projected, blockedClaims: ['wrong-medium: carved wood; the work is plaster'] });
  assert.strictEqual(r.affirmative.hotspots.length, 0, 'no pin should be auto-published on a disputed work');
  assert.strictEqual(r.heldPins.length, 2, 'both pins must be HELD (not dropped)');
  assert.match(r.heldForReviewNote || '', /held for owner review/i);
});

t('an unrelated work with no disputed axis passes hotspots through', () => {
  const projected = { teach: { why: 'Neutral.', cues: [], notes: [], guide: [] }, hotspots: [{ n: 1, x: 5, y: 5 }] };
  const r = applyPrecedence({ projected, conflicts: [], blockedClaims: [] });
  assert.strictEqual(r.disputedAxes.length, 0);
  assert.strictEqual(r.affirmative.hotspots.length, 1, 'undisputed hotspots should pass through');
  assert.strictEqual(r.heldPins.length, 0);
});

t('neutral, non-identity copy survives on a disputed work', () => {
  const projected = { teach: { why: null, cues: [], notes: [{ head: 'Provenance', body: 'Multiple institutional impressions are documented in museum catalogues.' }], guide: [] }, hotspots: [] };
  const r = applyPrecedence({ projected, blockedClaims: ['wrong-medium: carved wood; the work is plaster'] });
  assert.strictEqual(r.affirmative.teach.notes.length, 1, 'neutral provenance note wrongly omitted');
});

t('gate throws if a disputed fragment is forced into affirmative copy', () => {
  const bad = { disputedAxes: ['iconography'], affirmative: { teach: { why: 'A prominent skull dominates the base.', cues: [], notes: [], guide: [] }, hotspots: [] } };
  assert.throws(() => assertNoDisputedAffirmative(bad), /VSD-037 violation/);
});

// ---- real regression: the tracked content-repair-failure B4 bodies ----
const fixturesPresent = existsSync(join(FIX, 'fixtures.json'));
t('tracked fixtures exist for both content-repair-failure works', () => {
  assert.ok(fixturesPresent, `missing ${FIX}/fixtures.json — run scripts/pass-b-content-repair-owner-review.mjs`);
  for (const id of ['wikidata:Q16467705', 'wikidata:Q1211814']) assert.ok(existsSync(join(FIX, `${sha256(id).slice(0, 12)}.b4-body.json`)), `missing fixture for ${id}`);
});

const FALSE_LANG = {
  'wikidata:Q16467705': [/skull/i, /memento[- ]?mori/i, /vanitas/i, /transi/i, /cadaver/i, /\bwing/i, /coffin/i, /carved wood/i, /\bwood\b/i],
  'wikidata:Q1211814': [/\blion/i, /quadruped/i, /\banimal\b/i],
};
for (const workId of Object.keys(FALSE_LANG)) {
  t(`review projection removes all known false language for ${workId}`, () => {
    if (!fixturesPresent) { console.log('  (skipped: fixtures absent)'); return; }
    const fx = JSON.parse(readFileSync(join(FIX, `${sha256(workId).slice(0, 12)}.b4-body.json`), 'utf8'));
    const findings = loadCanonicalFindings();
    const blockedClaims = findingsForWork(findings, workId).flatMap((f) => f.blockedClaims);
    const p = projectForReview(fx.b4Body, fx.b4Body.conflicts || [], blockedClaims);
    const text = affirmativeText(p);
    for (const re of FALSE_LANG[workId]) assert.ok(!re.test(text), `false language ${re} survived affirmative copy for ${workId}`);
    assert.ok(p.disputedDiagnostic.length > 0, 'expected removed fragments recorded as disputed diagnostic');
    assert.strictEqual(p.affirmative.hotspots.length, 0, 'disputed work must publish no pins');
  });
}

console.log(`\n${n} identity-precedence tests passed`);
