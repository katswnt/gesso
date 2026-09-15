// VSD-034 item 3 regressions: entity controller logic (synthetic) + seeded fixture self-consistency.
import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { ENTITY_GRAPH_VERSION, validateEntityGraph } from '../scripts/lib/pass-b-entity-contract.mjs';
import { possibleAliases, detectUnboundClaims, runController } from '../scripts/lib/pass-b-entity-controller.mjs';
import { verifyFixturesArtifact } from '../scripts/pass-b-entity-canary-fixtures.mjs';

let n = 0;
const ok = (c, m) => { assert(c, m); n++; };
const R = (regionId, x, y, w, h) => ({ regionId, geometry: { x, y, w, h }, scope: 'area', confidence: 0.9 });
const E = (entityId, regionRefs, entityType, o = {}) => ({ entityId, regionRefs, entityType, partOf: o.partOf ?? null, sameAs: o.sameAs ?? null, distinctFrom: o.distinctFrom ?? [], confidence: 0.9 });
const G = (regions, entities) => ({ version: ENTITY_GRAPH_VERSION, regions, entities, uncertainty: '' });

// overlapping regions (high IoU)
const rA = R('rA', 10, 10, 30, 30), rB = R('rB', 12, 12, 30, 30), rFar = R('rFar', 70, 70, 20, 20);

// ---- possibleAlias ----
ok(possibleAliases(G([rA, rB], [E('e1', ['rA'], 'human'), E('e2', ['rB'], 'animal')])).length === 1, 'human+animal overlap, no relation -> 1 alias (St. John shape)');
ok(possibleAliases(G([rA, rB], [E('e1', ['rA'], 'human', { distinctFrom: ['e2'] }), E('e2', ['rB'], 'animal')])).length === 0, 'declared distinctFrom suppresses (rider+horse)');
ok(possibleAliases(G([rA, rB], [E('e1', ['rA'], 'human', { partOf: 'e2' }), E('e2', ['rB'], 'animal')])).length === 0, 'declared partOf suppresses');
ok(possibleAliases(G([rA, rB], [E('e1', ['rA'], 'human'), E('e2', ['rB'], 'human')])).length === 0, 'same type overlap not an alias (mother+child)');
ok(possibleAliases(G([rA, rFar], [E('e1', ['rA'], 'human'), E('e2', ['rFar'], 'animal')])).length === 0, 'no overlap -> no alias');
ok(possibleAliases(G([rA, rB], [E('e1', ['rA'], 'human'), E('e2', ['rB'], 'unknown')])).length === 0, 'unknown type carries no incompatibility signal');
ok(possibleAliases(G([rA, rB], [E('e1', ['rA'], 'human'), E('e2', ['rB'], 'animal')]))[0].route === 'neutral-reread', 'alias routes to neutral reread, never merge');

// ---- unboundEntityClaim ----
const animalOnly = G([rA], [E('e1', ['rA'], 'animal')]);
ok(detectUnboundClaims(animalOnly, [{ claimId: 'penitent', requiredType: 'human' }]).length === 1, 'human claim over animal-only graph -> unbound (St. John collapse)');
ok(detectUnboundClaims(G([rA], [E('e1', ['rA'], 'human')]), [{ claimId: 'penitent', requiredType: 'human' }]).length === 0, 'human claim binds to human entity');
ok(detectUnboundClaims(G([rA], [E('e1', ['rA'], 'human')]), [{ claimId: 'p', requiredType: 'human', region: { x: 70, y: 70, w: 20, h: 20 } }]).length === 1, 'right type wrong region -> unbound');
const rc = runController(animalOnly, [{ claimId: 'penitent', requiredType: 'human' }]);
ok(rc.unbound.length === 1 && rc.policyVersion, 'runController reports policy + unbound');

// ---- seeded fixture artifact: integrity + self-consistency ----
const OUT = 'data/vision-entity-canary-fixtures.json';
if (existsSync(OUT)) {
  const v = verifyFixturesArtifact(JSON.parse(readFileSync(OUT, 'utf8')));
  ok(v.ok, 'fixtures artifact integrity');
  for (const f of v.fixtures) {
    ok(validateEntityGraph(f.label).ok, `fixture label valid: ${f.workId}`);
    const got = runController(f.label, f.claims);
    ok(got.possibleAlias.length === f.expected.possibleAlias, `fixture alias matches: ${f.workId}`);
    ok(JSON.stringify(got.unbound.map((u) => u.claimId).sort()) === JSON.stringify([...f.expected.unbound].sort()), `fixture unbound matches: ${f.workId}`);
  }
  const stJohn = v.fixtures.find((f) => f.workId === 'wikidata:Q1211814');
  ok(stJohn && runController(stJohn.label).possibleAlias.length === 1, 'St. John canonical alias positive present');
  const laGloire = v.fixtures.find((f) => f.workId === 'wikidata:Q16467705');
  ok(laGloire && runController(laGloire.label, laGloire.claims).unbound.length === 2, 'La Gloire wings+skull unbound present');
} else {
  console.log('  (skipped fixtures artifact: not generated)');
}

console.log(`ok - pass-b entity controller + fixtures: ${n} checks passed`);
