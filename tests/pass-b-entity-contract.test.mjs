// VSD-034 item 2 regressions: experimental entity-emission contract + evaluator.
import assert from 'node:assert';
import { validateEntityGraph, ENTITY_GRAPH_VERSION, ENTITY_GRAPH_WIRE_SCHEMA } from '../scripts/lib/pass-b-entity-contract.mjs';
import { scoreEmission, aggregateEmission, iou } from '../scripts/lib/pass-b-entity-eval.mjs';

let n = 0;
const ok = (c, m) => { assert(c, m); n++; };
const clone = (o) => JSON.parse(JSON.stringify(o));

const G = {
  version: ENTITY_GRAPH_VERSION,
  regions: [
    { regionId: 'r1', geometry: { x: 10, y: 10, w: 20, h: 20 }, scope: 'area', confidence: 0.9 },
    { regionId: 'r2', geometry: { x: 55, y: 55, w: 20, h: 20 }, scope: 'area', confidence: 0.8 },
  ],
  entities: [
    { entityId: 'e1', regionRefs: ['r1'], entityType: 'human', partOf: null, sameAs: null, distinctFrom: [], confidence: 0.9 },
    { entityId: 'e2', regionRefs: ['r2'], entityType: 'animal', partOf: null, sameAs: null, distinctFrom: ['e1'], confidence: 0.8 },
  ],
  uncertainty: '',
};

// ---- validator: valid ----
ok(validateEntityGraph(G).ok, 'valid graph passes');
ok(ENTITY_GRAPH_WIRE_SCHEMA.properties.version.enum[0] === ENTITY_GRAPH_VERSION, 'wire schema version pinned');

// ---- validator: malformations rejected ----
const breaks = {
  'dup region id': (g) => { g.regions[1].regionId = 'r1'; },
  'dangling regionRef': (g) => { g.entities[0].regionRefs = ['rX']; },
  'empty regionRefs': (g) => { g.entities[0].regionRefs = []; },
  'self partOf': (g) => { g.entities[0].partOf = 'e1'; },
  'sameAs nonexistent': (g) => { g.entities[0].sameAs = 'e9'; },
  'geometry out of range': (g) => { g.regions[0].geometry.x = 150; },
  'region outside frame': (g) => { g.regions[0].geometry = { x: 90, y: 10, w: 20, h: 20 }; },
  'bad entity type': (g) => { g.entities[0].entityType = 'alien'; },
  'distinctFrom self': (g) => { g.entities[0].distinctFrom = ['e1']; },
  'bad confidence': (g) => { g.entities[0].confidence = 1.5; },
  'bad scope': (g) => { g.regions[0].scope = 'blob'; },
  'partOf cycle': (g) => { g.entities[0].partOf = 'e2'; g.entities[1].partOf = 'e1'; },
  'bad version': (g) => { g.version = 'nope'; },
};
for (const [name, mutate] of Object.entries(breaks)) {
  const g = clone(G); mutate(g);
  ok(!validateEntityGraph(g).ok, `rejected: ${name}`);
}

// ---- evaluator: iou sanity ----
ok(iou({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 10, h: 10 }) === 1, 'iou identical = 1');
ok(iou({ x: 0, y: 0, w: 10, h: 10 }, { x: 50, y: 50, w: 10, h: 10 }) === 0, 'iou disjoint = 0');

// ---- evaluator: perfect emission ----
const perfect = scoreEmission(clone(G), G);
ok(perfect.schemaValid && perfect.regionRecall === 1 && perfect.entityRecall === 1 && perfect.typeAccuracy === 1, 'perfect emission scores 100%');

// ---- evaluator: type error (St. John shape: a human emitted as animal) ----
const typeErr = clone(G); typeErr.entities[1].entityType = 'human';
const st = scoreEmission(typeErr, G);
ok(st.schemaValid && st.entityRecall === 1 && st.typeAccuracy === 0.5, 'one type error halves type accuracy');

// ---- evaluator: missed entity ----
const missed = clone(G); missed.entities.pop(); missed.regions.pop();
const ms = scoreEmission(missed, G);
ok(ms.entityRecall === 0.5 && ms.entities.missed === 1 && ms.entities.extras === 0, 'dropped entity lowers recall');

// ---- evaluator: hallucinated extra entity ----
const extra = clone(G);
extra.regions.push({ regionId: 'r3', geometry: { x: 5, y: 80, w: 10, h: 10 }, scope: 'area', confidence: 0.4 });
extra.entities.push({ entityId: 'e3', regionRefs: ['r3'], entityType: 'object', partOf: null, sameAs: null, distinctFrom: [], confidence: 0.4 });
const ex = scoreEmission(extra, G);
ok(ex.entityRecall === 1 && ex.entities.extras === 1, 'hallucinated entity counted as extra, recall intact');

// ---- evaluator: schema-invalid emission does not throw; reports schemaValid:false ----
const bad = clone(G); bad.entities[0].regionRefs = ['rX'];
const bs = scoreEmission(bad, G);
ok(bs.schemaValid === false && Array.isArray(bs.errors) && bs.errors.length > 0, 'invalid emission scored, not thrown');

// ---- aggregate ----
const agg = aggregateEmission([perfect, st]);
ok(agg.schemaConformanceRate === 1 && agg.meanTypeAccuracy === 0.75, 'aggregate emission metrics');

console.log(`ok - pass-b entity contract + evaluator: ${n} checks passed`);
