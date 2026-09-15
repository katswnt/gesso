// VSD-034 item 3: generate the frozen, sealed entity-canary fixture set. Labels are seeded from the
// forensic audit (canonical regressions) and authoritative catalog descriptions (controls + holdout);
// holdout-derived recall is PROVISIONAL pending owner ratification. Geometry is schematic-but-valid: the
// label + its expected controller output are self-consistent (asserted here), which is what item 3 tests.
// Item 4 scores the MODEL's emitted graph against these labels (where geometry realism matters -> provisional).
// No model call, no image read. Writes a TRACKED, self-hashed artifact so the offline gate works anywhere.
//   node scripts/pass-b-entity-canary-fixtures.mjs           # write (refuses to overwrite changed seal)
//   node scripts/pass-b-entity-canary-fixtures.mjs --check   # verify on-disk artifact only
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { sha256, stableJson } from './lib/vision-legacy.mjs';
import { ENTITY_GRAPH_VERSION, validateEntityGraph } from './lib/pass-b-entity-contract.mjs';
import { runController, CONTROLLER_POLICY_VERSION } from './lib/pass-b-entity-controller.mjs';

export const FIXTURES_VERSION = 'passBEntityCanaryFixtures/1';
const OUT = 'data/vision-entity-canary-fixtures.json';

const R = (regionId, x, y, w, h, scope = 'area', confidence = 0.9) => ({ regionId, geometry: { x, y, w, h }, scope, confidence });
const E = (entityId, regionRefs, entityType, o = {}) => ({ entityId, regionRefs, entityType, partOf: o.partOf ?? null, sameAs: o.sameAs ?? null, distinctFrom: o.distinctFrom ?? [], confidence: o.confidence ?? 0.9 });
const G = (regions, entities, uncertainty = '') => ({ version: ENTITY_GRAPH_VERSION, regions, entities, uncertainty });

// --- Canonical regressions (audit-confirmed ground truth) ---
const laGloire = {
  set: 'canonicalRegressions', workId: 'wikidata:Q16467705', labelSource: 'audit-confirmed',
  note: 'Glory=nude woman below, Villiers=clothed man in coffin above (Musee Carnavalet). Two humans (not an entity alias); the false wings and skull are entities the copy asserts but the image lacks -> unbound claims. Documents the LIMIT: the entity controller does not catch figure-identity inversion (that is the claim layer), but does catch absent-entity claims.',
  label: G(
    [R('r_upper', 38, 12, 24, 40), R('r_lower', 28, 45, 26, 45), R('r_coffin', 40, 5, 22, 55, 'area', 0.85), R('r_hand', 30, 48, 6, 6, 'point', 0.6)],
    [E('e_villiers', ['r_upper'], 'human', { distinctFrom: ['e_coffin'] }), E('e_glory', ['r_lower'], 'human'), E('e_coffin', ['r_coffin'], 'object')],
    'upper clothed figure and lower nude figure both human; slab behind is a distinct object',
  ),
  claims: [{ claimId: 'wings', requiredType: 'decorative-motif', region: { x: 40, y: 10, w: 24, h: 30 } }, { claimId: 'skull', requiredType: 'object', region: { x: 30, y: 48, w: 6, h: 6 } }, { claimId: 'coffin', requiredType: 'object', region: { x: 40, y: 5, w: 22, h: 55 } }],
  expected: { possibleAlias: 0, unbound: ['wings', 'skull'] },
};
const stJohn = {
  set: 'canonicalRegressions', workId: 'wikidata:Q1211814', labelSource: 'audit-confirmed',
  note: 'Lower-left is a crawling HUMAN penitent (St. John Chrysostom, per NGA); the audit found it also described as a separate crouching lion at the same region with conflicts:[]. Two overlapping incompatible-type entities, no declared relation -> possibleAlias (the canonical positive).',
  label: G(
    [R('r_saint', 5, 60, 26, 32), R('r_lion', 8, 62, 24, 28), R('r_mother', 40, 25, 18, 45), R('r_child', 46, 40, 12, 28)],
    [E('e_saint', ['r_saint'], 'human'), E('e_lion', ['r_lion'], 'animal'), E('e_mother', ['r_mother'], 'human'), E('e_child', ['r_child'], 'human', { partOf: null })],
    'lower-left crawling figure',
  ),
  claims: [{ claimId: 'penitent-human', requiredType: 'human', region: { x: 5, y: 60, w: 26, h: 32 } }],
  expected: { possibleAlias: 1, unbound: [] },
};

// --- Legitimate-overlap controls (authoritative-source-seeded; should NOT flag) ---
const castor = {
  set: 'legitimateOverlapControls', workId: 'http://www.wikidata.org/entity/Q1190706', labelSource: 'authoritative-source-seeded',
  note: 'Castor and Pollux (the Dioscuri) with horses. Human+animal legitimately overlap; the model DECLARES them distinct -> suppressed (tests the declared-relation escape). Provisional geometry.',
  label: G(
    [R('r_man', 20, 18, 22, 52), R('r_horse', 22, 24, 24, 50)],
    [E('e_man', ['r_man'], 'human', { distinctFrom: ['e_horse'] }), E('e_horse', ['r_horse'], 'animal')],
    'youth beside a horse, overlapping but distinct',
  ),
  claims: [], expected: { possibleAlias: 0, unbound: [] },
};
const boscoreale = {
  set: 'legitimateOverlapControls', workId: 'met247010', labelSource: 'authoritative-source-seeded',
  note: 'Boscoreale two-figure dyad. Both human -> same-type overlap is not an alias signal. Provisional geometry.',
  label: G(
    [R('r_a', 30, 18, 20, 60), R('r_b', 40, 20, 20, 58)],
    [E('e_a', ['r_a'], 'human'), E('e_b', ['r_b'], 'human')],
    'two overlapping human figures',
  ),
  claims: [], expected: { possibleAlias: 0, unbound: [] },
};

// --- Sealed holdout (authoritative-source-seeded; PROVISIONAL; withheld-in-spirit, precision-focused) ---
const emperorsCarpet = {
  set: 'holdout', workId: 'met450509', labelSource: 'authoritative-source-seeded',
  note: 'Emperor\'s Carpet: many animals across the field, all type animal -> overlaps among same type are not alias signals. Precision negative. Provisional geometry.',
  label: G(
    [R('r_a1', 20, 20, 14, 14), R('r_a2', 26, 24, 14, 14), R('r_a3', 55, 55, 14, 14)],
    [E('e_a1', ['r_a1'], 'animal'), E('e_a2', ['r_a2'], 'animal'), E('e_a3', ['r_a3'], 'animal')],
    'stylized animals in the field',
  ),
  claims: [], expected: { possibleAlias: 0, unbound: [] },
};
const francisI = {
  set: 'holdout', workId: 'harvard216218', labelSource: 'authoritative-source-seeded',
  note: 'Francis I: single human portrait bust. Precision negative. Provisional geometry.',
  label: G([R('r_f', 30, 15, 40, 70)], [E('e_f', ['r_f'], 'human')], 'single portrait figure'),
  claims: [], expected: { possibleAlias: 0, unbound: [] },
};

const FIXTURES = [laGloire, stJohn, castor, boscoreale, emperorsCarpet, francisI];

// Self-consistency: each label validates AND runController(label) matches its authored expected. Fail generation otherwise.
function verifyFixture(f) {
  const v = validateEntityGraph(f.label);
  if (!v.ok) return `INVALID LABEL ${f.workId}: ${v.errors.join('; ')}`;
  const got = runController(f.label, f.claims);
  if (got.possibleAlias.length !== f.expected.possibleAlias) return `${f.workId}: possibleAlias ${got.possibleAlias.length} != expected ${f.expected.possibleAlias}`;
  const gotUnbound = got.unbound.map((u) => u.claimId).sort();
  if (stableJson(gotUnbound) !== stableJson([...f.expected.unbound].sort())) return `${f.workId}: unbound ${JSON.stringify(gotUnbound)} != expected ${JSON.stringify(f.expected.unbound)}`;
  return null;
}

function seal(fixtures) {
  const holdout = fixtures.filter((f) => f.set === 'holdout');
  const holdoutSealSha256 = sha256(stableJson(holdout.map((f) => ({ workId: f.workId, label: f.label, expected: f.expected }))));
  const cores = fixtures.map((f) => ({ set: f.set, workId: f.workId, labelSource: f.labelSource, label: f.label, claims: f.claims, expected: f.expected }));
  return {
    version: FIXTURES_VERSION, contractVersion: ENTITY_GRAPH_VERSION, policyVersion: CONTROLLER_POLICY_VERSION,
    provenanceNote: 'Canonical regressions are audit-confirmed. Controls and holdout are authoritative-source-seeded with schematic geometry; holdout-derived recall/precision is PROVISIONAL pending owner ratification (owner pixel-labeling replaces these). Labels are self-consistent with the controller policy.',
    fixtures, holdoutSealSha256, fixturesSha256: sha256(stableJson(cores)),
  };
}

export function verifyFixturesArtifact(artifact) {
  if (!artifact || artifact.version !== FIXTURES_VERSION) return { ok: false, error: 'bad-version' };
  const cores = (artifact.fixtures || []).map((f) => ({ set: f.set, workId: f.workId, labelSource: f.labelSource, label: f.label, claims: f.claims, expected: f.expected }));
  if (sha256(stableJson(cores)) !== artifact.fixturesSha256) return { ok: false, error: 'fixtures-sha-mismatch' };
  const holdout = (artifact.fixtures || []).filter((f) => f.set === 'holdout');
  if (sha256(stableJson(holdout.map((f) => ({ workId: f.workId, label: f.label, expected: f.expected })))) !== artifact.holdoutSealSha256) return { ok: false, error: 'holdout-seal-mismatch' };
  return { ok: true, fixtures: artifact.fixtures };
}

// --- run (only when invoked directly; importing this module must not execute or exit) ---
import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--check')) {
    if (!existsSync(OUT)) { console.error(`missing ${OUT}`); process.exit(1); }
    const v = verifyFixturesArtifact(JSON.parse(readFileSync(OUT, 'utf8')));
    console.log(v.ok ? `OK ${OUT}: ${v.fixtures.length} sealed fixtures, integrity verified` : `FAIL ${OUT}: ${v.error}`);
    process.exit(v.ok ? 0 : 1);
  }
  const problems = FIXTURES.map(verifyFixture).filter(Boolean);
  if (problems.length) { console.error('fixture self-consistency FAILED:\n  ' + problems.join('\n  ')); process.exit(1); }
  const artifact = seal(FIXTURES);
  if (existsSync(OUT)) {
    const cur = JSON.parse(readFileSync(OUT, 'utf8'));
    if (cur.fixturesSha256 === artifact.fixturesSha256) { console.log(`unchanged: ${OUT} (${FIXTURES.length} fixtures)`); process.exit(0); }
    console.error(`REFUSING to overwrite ${OUT}: sealed content changed. Delete deliberately if intended.`);
    process.exit(1);
  }
  writeFileSync(OUT, `${JSON.stringify(artifact, null, 2)}\n`, { flag: 'wx' });
  console.log(`wrote ${OUT}: ${FIXTURES.length} sealed fixtures (${FIXTURES.filter((f) => f.set === 'canonicalRegressions').length} regressions, ${FIXTURES.filter((f) => f.set === 'legitimateOverlapControls').length} controls, ${FIXTURES.filter((f) => f.set === 'holdout').length} holdout)`);
  for (const f of FIXTURES) console.log(`  [${f.set}] ${f.workId} alias=${f.expected.possibleAlias} unbound=${JSON.stringify(f.expected.unbound)} (${f.labelSource})`);
}
