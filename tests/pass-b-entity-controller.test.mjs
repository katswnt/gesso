// VSD-034 item 3 regressions (repaired): controller logic (synthetic) + seeded fixture self-consistency.
import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { ENTITY_GRAPH_VERSION, validateEntityGraph } from '../scripts/lib/pass-b-entity-contract.mjs';
import { possibleAliases, detectUnboundClaims, runController, aliasPairKeys, typesIncompatible, UNBOUND_DISPOSITION } from '../scripts/lib/pass-b-entity-controller.mjs';
import { verifyFixturesArtifact } from '../scripts/pass-b-entity-canary-fixtures.mjs';

let n = 0;
const ok = (c, m) => { assert(c, m); n++; };
const R = (regionId, x, y, w, h) => ({ regionId, geometry: { x, y, w, h }, scope: 'area', confidence: 0.9 });
const E = (entityId, regionRefs, entityType, o = {}) => ({ entityId, regionRefs, entityType, partOf: o.partOf ?? null, sameAs: o.sameAs ?? null, distinctFrom: o.distinctFrom ?? [], confidence: 0.9 });
const G = (regions, entities) => ({ version: ENTITY_GRAPH_VERSION, regions, entities, uncertainty: '' });
const rA = R('rA', 10, 10, 30, 30), rB = R('rB', 12, 12, 30, 30), rFar = R('rFar', 70, 70, 20, 20);

// ---- incompatibility relation (not just "different types") ----
ok(typesIncompatible('human', 'animal'), 'human/animal incompatible');
ok(!typesIncompatible('human', 'object'), 'human/object NOT incompatible (holding)');
ok(!typesIncompatible('object', 'inscription'), 'object/inscription NOT incompatible');
ok(!typesIncompatible('decorative-motif', 'object'), 'motif/vessel NOT incompatible');
ok(!typesIncompatible('animal', 'ground'), 'animal/ground NOT incompatible');
ok(!typesIncompatible('human', 'human'), 'same type not incompatible');
ok(!typesIncompatible('human', 'unknown'), 'unknown carries no signal');

// ---- possibleAlias: fires on incompatible + overlap; the synthetic St. John shape ----
ok(possibleAliases(G([rA, rB], [E('e1', ['rA'], 'human'), E('e2', ['rB'], 'animal')])).length === 1, 'human+animal overlap -> 1 alias (synthetic St. John)');
ok(possibleAliases(G([rA, rB], [E('e1', ['rA'], 'human'), E('e2', ['rB'], 'object')])).length === 0, 'human+object overlap -> no alias (compatible)');
ok(possibleAliases(G([rA, rB], [E('e1', ['rA'], 'human'), E('e2', ['rB'], 'human')])).length === 0, 'same type -> no alias');
ok(possibleAliases(G([rA, rFar], [E('e1', ['rA'], 'human'), E('e2', ['rFar'], 'animal')])).length === 0, 'no overlap -> no alias');

// ---- model-declared relations ANNOTATE, never SUPPRESS ----
ok(possibleAliases(G([rA, rB], [E('e1', ['rA'], 'human', { distinctFrom: ['e2'] }), E('e2', ['rB'], 'animal')])).length === 1, 'distinctFrom does NOT suppress the referral');
ok(possibleAliases(G([rA, rB], [E('e1', ['rA'], 'human', { partOf: 'e2' }), E('e2', ['rB'], 'animal')])).length === 1, 'partOf does NOT suppress');
const sa = possibleAliases(G([rA, rB], [E('e1', ['rA'], 'human', { sameAs: 'e2' }), E('e2', ['rB'], 'animal')]));
ok(sa.length === 1 && sa[0].priority === 'high', 'sameAs on incompatible types -> still referred, HIGH priority');
ok(possibleAliases(G([rA, rB], [E('e1', ['rA'], 'human', { distinctFrom: ['e2'] }), E('e2', ['rB'], 'animal')]))[0].priority === 'low', 'distinctFrom -> low priority (still referred)');
ok(possibleAliases(G([rA, rB], [E('e1', ['rA'], 'human'), E('e2', ['rB'], 'animal')]))[0].route === 'neutral-reread', 'alias routes to neutral reread, never merge');

// ---- max-region-IoU: disjoint parts must not create phantom overlap ----
const disjoint = G(
  [R('p1', 0, 0, 10, 10), R('p2', 80, 80, 10, 10), R('q1', 40, 40, 10, 10)],
  [E('eHuman', ['p1', 'p2'], 'human'), E('eAnimal', ['q1'], 'animal')],
);
ok(possibleAliases(disjoint).length === 0, 'union-box would overlap but no region pair does -> no phantom alias');

// ---- aliasPairKeys order-independent ----
ok(JSON.stringify(aliasPairKeys([{ entityA: 'b', entityB: 'a' }])) === JSON.stringify(['a::b']), 'pair keys normalized/sorted');

// ---- unbound claims ----
ok(detectUnboundClaims(G([rA], [E('e1', ['rA'], 'animal')]), [{ claimId: 'p', requiredType: 'human' }]).length === 1, 'human claim over animal-only -> unbound');
ok(detectUnboundClaims(G([rA], [E('e1', ['rA'], 'human')]), [{ claimId: 'p', requiredType: 'human' }]).length === 0, 'human claim binds to human');
ok(detectUnboundClaims(G([rA], [E('e1', ['rA'], 'human')]), [{ claimId: 'p', requiredType: 'human', region: { x: 70, y: 70, w: 20, h: 20 } }]).length === 1, 'right type wrong region -> unbound');
// unbound means BINDING NOT ESTABLISHED (route to reread), NEVER refuted/absent/false/rejected.
const ub = detectUnboundClaims(G([rA], [E('e1', ['rA'], 'animal')]), [{ claimId: 'p', requiredType: 'human' }]);
ok(ub[0].disposition === UNBOUND_DISPOSITION && ub[0].disposition === 'binding-not-established', 'unbound disposition = binding-not-established');
ok(ub[0].route === 'neutral-reread' && ub[0].reason === 'unbound-entity-claim', 'unbound routes to neutral reread');
ok(!/refuted|absent|false|rejected/i.test(JSON.stringify(ub)), 'unbound never carries refuted/absent/false/rejected semantics');

// ---- seeded fixtures: integrity + self-consistency (gold scenes have ZERO aliases) ----
const OUT = 'data/vision-entity-canary-fixtures.json';
if (existsSync(OUT)) {
  const v = verifyFixturesArtifact(JSON.parse(readFileSync(OUT, 'utf8')));
  ok(v.ok, 'fixtures artifact integrity');
  for (const f of v.fixtures) {
    ok(validateEntityGraph(f.label).ok, `fixture label valid: ${f.workId}`);
    const got = runController(f.label, f.claims);
    ok(JSON.stringify(aliasPairKeys(got.possibleAlias)) === JSON.stringify([...f.expected.aliasPairs].sort()), `fixture aliasPairs match: ${f.workId}`);
    ok(JSON.stringify(got.unbound.map((u) => u.claimId).sort()) === JSON.stringify([...f.expected.unbound].sort()), `fixture unbound match: ${f.workId}`);
    ok(f.exhaustive === false, `real-image label marked non-exhaustive: ${f.workId}`);
  }
  const stJohn = v.fixtures.find((f) => f.workId === 'wikidata:Q1211814');
  ok(stJohn && runController(stJohn.label).possibleAlias.length === 0, 'St. John GOLD has no lion / no alias (hallucination removed)');
  const laGloire = v.fixtures.find((f) => f.workId === 'wikidata:Q16467705');
  ok(laGloire && runController(laGloire.label, laGloire.claims).unbound.length === 2, 'La Gloire wings+skull unbound present');
  ok(v.fixtures.filter((f) => f.expected.aliasPairs.length > 0).length === 0, 'zero gold alias positives (recall undefined here — measured synthetically/owner-labeled)');
} else {
  console.log('  (skipped fixtures artifact: not generated)');
}

console.log(`ok - pass-b entity controller + fixtures: ${n} checks passed`);
