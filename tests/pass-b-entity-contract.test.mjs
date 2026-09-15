// VSD-034 item 2 regressions (repaired): entity-emission contract + evaluator.
import assert from 'node:assert';
import { validateEntityGraph, ENTITY_GRAPH_VERSION, ENTITY_GRAPH_WIRE_SCHEMA } from '../scripts/lib/pass-b-entity-contract.mjs';
import { scoreEmission, aggregateEmission, aliasPrecisionRecall, maxWeightMatch, iou } from '../scripts/lib/pass-b-entity-eval.mjs';

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

// ---- validator ----
ok(validateEntityGraph(G).ok, 'valid graph passes');
ok(ENTITY_GRAPH_WIRE_SCHEMA.properties.version.enum[0] === ENTITY_GRAPH_VERSION, 'wire schema version pinned');
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
  'duplicate distinctFrom': (g) => { g.entities[0].distinctFrom = ['e2', 'e2']; },
  'sameAs + distinctFrom same target': (g) => { g.entities[0].sameAs = 'e2'; g.entities[0].distinctFrom = ['e2']; },
  'partOf + distinctFrom same target': (g) => { g.entities[0].partOf = 'e2'; g.entities[0].distinctFrom = ['e2']; },
  'sameAs equals partOf target': (g) => { g.entities[0].sameAs = 'e2'; g.entities[0].partOf = 'e2'; },
  'mutual sameAs vs distinctFrom': (g) => { g.entities[0].sameAs = 'e2'; }, // base e2.distinctFrom = ['e1']
  'bad confidence': (g) => { g.entities[0].confidence = 1.5; },
  'bad scope': (g) => { g.regions[0].scope = 'blob'; },
  'partOf cycle': (g) => { g.entities[0].partOf = 'e2'; g.entities[1].partOf = 'e1'; },
  'bad version': (g) => { g.version = 'nope'; },
};
for (const [name, mutate] of Object.entries(breaks)) { const g = clone(G); mutate(g); ok(!validateEntityGraph(g).ok, `rejected: ${name}`); }

// ---- iou ----
ok(iou({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 10, h: 10 }) === 1, 'iou identical = 1');
ok(iou({ x: 0, y: 0, w: 10, h: 10 }, { x: 50, y: 50, w: 10, h: 10 }) === 0, 'iou disjoint = 0');

// ---- evaluator: perfect ----
const perfect = scoreEmission(clone(G), G);
ok(perfect.schemaValid && perfect.regionRecall === 1 && perfect.entityRecall === 1 && perfect.typeAccuracy === 1 && perfect.typeAccuracyOverLabeled === 1, 'perfect emission scores 100%');

// ---- evaluator: type error ----
const typeErr = clone(G); typeErr.entities[1].entityType = 'human';
const st = scoreEmission(typeErr, G);
ok(st.schemaValid && st.entityRecall === 1 && st.typeAccuracy === 0.5 && st.typeAccuracyOverLabeled === 0.5, 'one type error halves type accuracy');

// ---- evaluator: missed entity ----
const missed = clone(G); missed.entities.pop(); missed.regions.pop();
const ms = scoreEmission(missed, G);
ok(ms.entityRecall === 0.5 && ms.entities.missed === 1, 'dropped entity lowers recall; typeAccuracyOverLabeled counts the miss');
ok(ms.typeAccuracyOverLabeled === 0.5, 'typeAccuracyOverLabeled penalises the missed hard entity');

// ---- evaluator: extra emitted entity, exhaustive vs non-exhaustive ----
const extra = clone(G);
extra.regions.push({ regionId: 'r3', geometry: { x: 5, y: 80, w: 10, h: 10 }, scope: 'area', confidence: 0.4 });
extra.entities.push({ entityId: 'e3', regionRefs: ['r3'], entityType: 'object', partOf: null, sameAs: null, distinctFrom: [], confidence: 0.4 });
ok(scoreEmission(extra, G, { exhaustive: true }).entities.extras === 1, 'exhaustive label: extra counted as hallucination');
const ne = scoreEmission(extra, G, { exhaustive: false });
ok(ne.entities.extras === 0 && ne.entities.unlabeledEmitted === 1, 'non-exhaustive label: extra reported unlabeled, NOT penalised');

// ---- evaluator: INVALID emission gets ZERO downstream (repair) ----
const bad = clone(G); bad.entities[0].regionRefs = ['rX'];
const bs = scoreEmission(bad, G);
ok(bs.schemaValid === false && bs.regionRecall === 0 && bs.entityRecall === 0 && bs.typeAccuracy === 0, 'invalid emission scores ZERO downstream (cannot inflate metrics)');

// ---- evaluator: matching is order-independent AND optimal (max cardinality, then IoU) ----
const shuffled = clone(G); shuffled.entities.reverse(); shuffled.regions.reverse();
ok(scoreEmission(shuffled, G).entityRecall === 1, 'reordered emission matches identically (global assignment)');
// Greedy-failure regression: IoU-descending greedy takes (0,0)=0.9 and strands row 1 -> 1 match; the optimal
// max-cardinality matching yields 2. (matrix is thresholded: >0 = allowable edge.)
ok(maxWeightMatch([[0.9, 0.5], [0.5, 0]]).length === 2, 'optimal matching beats greedy cardinality (2 vs 1)');
ok(maxWeightMatch([[0.9, 0]]).length === 1 && maxWeightMatch([[0, 0]]).length === 0, 'matcher counts only real edges');

// ---- aggregate: unconditional (invalid retained as zero) + explicitly named valid-only ----
const agg = aggregateEmission([perfect, st, bs]);
ok(Math.abs(agg.schemaConformanceRate - 2 / 3) < 1e-9, 'schemaConformanceRate over ALL works (2/3)');
ok(agg.validWorks === 2, 'validWorks counted');
ok(agg.validOnly.macro.typeAccuracy === 0.75, 'validOnly macro typeAccuracy = 0.75');
ok(Math.abs(agg.unconditional.macro.entityRecall - 2 / 3) < 1e-9, 'unconditional entityRecall includes invalid as zero (2/3)');
ok(agg.validOnly.macro.entityRecall === 1, 'validOnly entityRecall excludes the invalid work (1.0)');
ok(agg.unconditional.macro.entityRecall < agg.validOnly.macro.entityRecall, 'invalid emissions drag the headline below valid-only');

// ---- alias precision/recall ----
const pr1 = aliasPrecisionRecall(['a::b', 'c::d'], ['a::b']);
ok(pr1.tp === 1 && pr1.fp === 1 && pr1.precision === 0.5 && pr1.recall === 1, 'precision/recall computed');
ok(aliasPrecisionRecall([], []).recall === null, 'recall null when no gold positives (holdout case)');
ok(aliasPrecisionRecall([], ['a::b']).precision === null, 'precision null when nothing predicted');

console.log(`ok - pass-b entity contract + evaluator: ${n} checks passed`);
