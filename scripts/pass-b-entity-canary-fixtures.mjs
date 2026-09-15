// VSD-034 item 3 (repaired): generate the frozen, sealed entity-canary fixture set.
//
// Repairs after Codex review: visual GOLD graphs contain ONLY real entities (no hallucinated lion in
// St. John, no invented horse in Castor — the erroneous two-entity graph lives in the SYNTHETIC controller
// test, not the gold). Expected alias is a set of identified PAIRS, not a count. Real-image labels are
// non-exhaustive (exhaustive:false) so correct extra model observations are not scored as hallucinations.
// The holdout is precision-only (zero gold alias positives) and authoritative-source-seeded -> recall is
// UNDEFINED here and must not be reported until owner pixel-labeling supplies positives.
//   node scripts/pass-b-entity-canary-fixtures.mjs           # write (refuses to overwrite a changed seal)
//   node scripts/pass-b-entity-canary-fixtures.mjs --check   # verify on-disk artifact only
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sha256, stableJson } from './lib/vision-legacy.mjs';
import { ENTITY_GRAPH_VERSION, validateEntityGraph } from './lib/pass-b-entity-contract.mjs';
import { runController, aliasPairKeys, CONTROLLER_POLICY_VERSION } from './lib/pass-b-entity-controller.mjs';

export const FIXTURES_VERSION = 'passBEntityCanaryFixtures/2';
const OUT = 'data/vision-entity-canary-fixtures.json';

const R = (regionId, x, y, w, h, scope = 'area', confidence = 0.9) => ({ regionId, geometry: { x, y, w, h }, scope, confidence });
const E = (entityId, regionRefs, entityType, o = {}) => ({ entityId, regionRefs, entityType, partOf: o.partOf ?? null, sameAs: o.sameAs ?? null, distinctFrom: o.distinctFrom ?? [], confidence: o.confidence ?? 0.9 });
const G = (regions, entities, uncertainty = '') => ({ version: ENTITY_GRAPH_VERSION, regions, entities, uncertainty });

const FIXTURES = [
  // --- Canonical regressions (audit-confirmed). GOLD = real entities only. ---
  {
    set: 'canonicalRegressions', workId: 'wikidata:Q16467705', labelSource: 'audit-confirmed', exhaustive: false,
    note: 'GOLD real scene: two humans (Villiers clothed above in the coffin, Glory nude below) + the plaster slab (object). No alias in the true scene. The false wings and skull are entities the copy asserts but the image lacks -> unbound claims. Documents the LIMIT: the entity controller does not test figure-identity inversion (claim layer, unbuilt).',
    label: G(
      [R('r_upper', 38, 12, 24, 40), R('r_lower', 28, 45, 26, 45), R('r_slab', 40, 5, 22, 55, 'area', 0.85), R('r_hand', 30, 48, 6, 6, 'point', 0.6)],
      [E('e_villiers', ['r_upper'], 'human'), E('e_glory', ['r_lower'], 'human'), E('e_slab', ['r_slab'], 'object')],
      'upper clothed figure and lower nude figure both human; slab behind is an object',
    ),
    claims: [{ claimId: 'wings', requiredType: 'decorative-motif', region: { x: 40, y: 10, w: 24, h: 30 } }, { claimId: 'skull', requiredType: 'object', region: { x: 30, y: 48, w: 6, h: 6 } }],
    expected: { aliasPairs: [], unbound: ['wings', 'skull'] },
  },
  {
    set: 'canonicalRegressions', workId: 'wikidata:Q1211814', labelSource: 'audit-confirmed', exhaustive: false,
    note: 'GOLD real scene: the crawling penitent (St. John Chrysostom, per NGA) is HUMAN, plus a seated woman and a child, all human. There is NO lion in the real work — the audit found the pipeline hallucinated one. The true scene therefore has NO alias; the alias-DETECTION positive is a SYNTHETIC controller test, not the gold. penitent-human claim binds to the real human.',
    label: G(
      [R('r_saint', 5, 62, 22, 26), R('r_woman', 40, 28, 20, 46), R('r_child', 47, 46, 12, 24)],
      [E('e_saint', ['r_saint'], 'human'), E('e_woman', ['r_woman'], 'human'), E('e_child', ['r_child'], 'human')],
      'small crawling figure lower-left; seated woman with a child at right',
    ),
    claims: [{ claimId: 'penitent-human', requiredType: 'human', region: { x: 5, y: 62, w: 22, h: 26 } }],
    expected: { aliasPairs: [], unbound: [] },
  },
  // --- Legitimate-overlap controls (authoritative-source-seeded; should NOT flag) ---
  {
    set: 'legitimateOverlapControls', workId: 'http://www.wikidata.org/entity/Q1190706', labelSource: 'authoritative-source-seeded', exhaustive: false,
    note: 'Castor and Pollux: per the actual image (Codex pixel check) two youths, an altar/torch, and a small draped attendant — NO horse (the earlier fixture invented one, the mythology-over-pixels prior). Humans same-type + human/object(altar) compatible -> no alias. Provisional geometry.',
    label: G(
      [R('r_y1', 18, 18, 20, 55), R('r_y2', 42, 16, 20, 57), R('r_altar', 30, 60, 22, 24), R('r_att', 60, 40, 12, 34)],
      [E('e_y1', ['r_y1'], 'human'), E('e_y2', ['r_y2'], 'human'), E('e_altar', ['r_altar'], 'object'), E('e_att', ['r_att'], 'human')],
      'two youths, an altar/torch between them, a small attendant at right',
    ),
    claims: [], expected: { aliasPairs: [], unbound: [] },
  },
  {
    set: 'legitimateOverlapControls', workId: 'met247010', labelSource: 'authoritative-source-seeded', exhaustive: false,
    note: 'Boscoreale two-figure dyad. Both human -> same-type overlap is not an alias signal. Provisional geometry.',
    label: G([R('r_a', 30, 18, 20, 60), R('r_b', 40, 20, 20, 58)], [E('e_a', ['r_a'], 'human'), E('e_b', ['r_b'], 'human')], 'two overlapping human figures'),
    claims: [], expected: { aliasPairs: [], unbound: [] },
  },
  // --- Holdout (authoritative-source-seeded; PRECISION-ONLY; zero gold aliases -> recall UNDEFINED here) ---
  {
    set: 'holdout', workId: 'met450509', labelSource: 'authoritative-source-seeded', exhaustive: false,
    note: 'Emperor\'s Carpet: many animals in the field, all type animal -> same-type overlaps are not alias signals. Precision negative. Non-exhaustive. Provisional geometry.',
    label: G([R('r_a1', 20, 20, 14, 14), R('r_a2', 26, 24, 14, 14), R('r_a3', 55, 55, 14, 14)], [E('e_a1', ['r_a1'], 'animal'), E('e_a2', ['r_a2'], 'animal'), E('e_a3', ['r_a3'], 'animal')], 'stylized animals in the field'),
    claims: [], expected: { aliasPairs: [], unbound: [] },
  },
  {
    set: 'holdout', workId: 'harvard216218', labelSource: 'authoritative-source-seeded', exhaustive: false,
    note: 'Francis I portrait bust. Precision negative. Non-exhaustive (inscription/framing not labeled; extras must not be penalised). Provisional geometry.',
    label: G([R('r_f', 30, 15, 40, 70)], [E('e_f', ['r_f'], 'human')], 'single portrait figure'),
    claims: [], expected: { aliasPairs: [], unbound: [] },
  },
];

function verifyFixture(f) {
  const v = validateEntityGraph(f.label);
  if (!v.ok) return `INVALID LABEL ${f.workId}: ${v.errors.join('; ')}`;
  const got = runController(f.label, f.claims);
  const gotPairs = aliasPairKeys(got.possibleAlias);
  if (stableJson(gotPairs) !== stableJson([...f.expected.aliasPairs].sort())) return `${f.workId}: aliasPairs ${JSON.stringify(gotPairs)} != expected ${JSON.stringify(f.expected.aliasPairs)}`;
  const gotUnbound = got.unbound.map((u) => u.claimId).sort();
  if (stableJson(gotUnbound) !== stableJson([...f.expected.unbound].sort())) return `${f.workId}: unbound ${JSON.stringify(gotUnbound)} != expected ${JSON.stringify(f.expected.unbound)}`;
  return null;
}

function seal(fixtures) {
  const holdout = fixtures.filter((f) => f.set === 'holdout');
  const holdoutSealSha256 = sha256(stableJson(holdout));
  return {
    version: FIXTURES_VERSION, contractVersion: ENTITY_GRAPH_VERSION, policyVersion: CONTROLLER_POLICY_VERSION,
    provenanceNote: 'Canonical regressions are audit-confirmed; controls and holdout are authoritative-source-seeded with schematic, NON-EXHAUSTIVE geometry. Gold scenes contain only real entities. There are ZERO gold alias positives (real scenes contain no aliases; aliases are model errors), so alias RECALL is undefined here and must not be reported until owner pixel-labeling supplies positives; alias detection is regression-tested synthetically. Holdout accuracy/recall are descriptive-pilot only pending owner ratification.',
    fixtures, holdoutSealSha256, fixturesSha256: sha256(stableJson(fixtures)),
  };
}

export function verifyFixturesArtifact(artifact) {
  if (!artifact || artifact.version !== FIXTURES_VERSION) return { ok: false, error: 'bad-version' };
  if (sha256(stableJson(artifact.fixtures || [])) !== artifact.fixturesSha256) return { ok: false, error: 'fixtures-sha-mismatch' };
  const holdout = (artifact.fixtures || []).filter((f) => f.set === 'holdout');
  if (sha256(stableJson(holdout)) !== artifact.holdoutSealSha256) return { ok: false, error: 'holdout-seal-mismatch' };
  return { ok: true, fixtures: artifact.fixtures };
}

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
    console.error(`REFUSING to overwrite ${OUT}: sealed content changed. Delete deliberately if intended.`); process.exit(1);
  }
  writeFileSync(OUT, `${JSON.stringify(artifact, null, 2)}\n`, { flag: 'wx' });
  console.log(`wrote ${OUT}: ${FIXTURES.length} sealed fixtures (gold scenes contain only real entities; zero gold aliases)`);
  for (const f of FIXTURES) console.log(`  [${f.set}] ${f.workId} aliasPairs=${JSON.stringify(f.expected.aliasPairs)} unbound=${JSON.stringify(f.expected.unbound)} exhaustive=${f.exhaustive} (${f.labelSource})`);
}
