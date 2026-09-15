// VSD-034 item 2: QUARANTINED EXPERIMENTAL entity-emission contract.
//
// A B1-style image-only stage emits region-bound, TYPED entity observations (no identity names, no catalog,
// no research — those are downstream claims). This is the substrate the possibleAlias / unboundEntityClaim
// controller logic (item 3) runs on, and the canary measures whether models can emit it reliably. It is
// experimental and quarantined: not wired to any production sink, not part of passBValidation, its own version.
//
// Graph shape (one image):
//   { version, regions:[{regionId, geometry:{x,y,w,h}, scope, confidence}],
//     entities:[{entityId, regionRefs:[regionId], entityType, partOf|null, sameAs|null, distinctFrom:[entityId], confidence}],
//     uncertainty }
// Coordinates are 0..100. Types are coarse and incompatibility-meaningful (human vs animal is the St. John signal).

export const ENTITY_GRAPH_VERSION = 'contentVisionEntityGraph/1';
export const ENTITY_TYPES = Object.freeze(['human', 'animal', 'plant', 'object', 'architecture', 'inscription', 'decorative-motif', 'ground', 'vehicle', 'unknown']);
export const REGION_SCOPES = Object.freeze(['point', 'area', 'whole']);

// Structure-only wire schema for `claude -p --json-schema` (mirrors the house idiom; ranges/cross-refs are
// enforced by validateEntityGraph, never here).
const str = { type: 'string' }, num = { type: 'number' };
const enumOf = (v) => ({ type: 'string', enum: [...v] });
const nullable = (s) => ({ anyOf: [s, { type: 'null' }] });
const obj = (props) => ({ type: 'object', additionalProperties: false, required: Object.keys(props), properties: props });
const arr = (items) => ({ type: 'array', items });

export const ENTITY_GRAPH_WIRE_SCHEMA = Object.freeze(obj({
  version: { type: 'string', enum: [ENTITY_GRAPH_VERSION] },
  regions: arr(obj({ regionId: str, geometry: obj({ x: num, y: num, w: num, h: num }), scope: enumOf(REGION_SCOPES), confidence: num })),
  entities: arr(obj({ entityId: str, regionRefs: arr(str), entityType: enumOf(ENTITY_TYPES), partOf: nullable(str), sameAs: nullable(str), distinctFrom: arr(str), confidence: num })),
  uncertainty: str,
}));

const inRange = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;
const conf = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const isStr = (v) => typeof v === 'string' && v.length > 0 && v.length <= 200;

// Strict semantic validator. Returns { ok, errors }.
export function validateEntityGraph(graph) {
  const e = [];
  const need = (c, m) => { if (!c) e.push(m); };
  need(graph && typeof graph === 'object' && !Array.isArray(graph), 'graph object');
  if (e.length) return { ok: false, errors: e };
  need(graph.version === ENTITY_GRAPH_VERSION, 'version');
  need(Array.isArray(graph.regions), 'regions array');
  need(Array.isArray(graph.entities), 'entities array');
  need(typeof graph.uncertainty === 'string' && graph.uncertainty.length <= 2000, 'uncertainty');
  if (e.length) return { ok: false, errors: e };

  const regionIds = new Set();
  for (const r of graph.regions) {
    need(r && isStr(r.regionId) && !regionIds.has(r.regionId), `region id unique/valid: ${r?.regionId}`);
    regionIds.add(r?.regionId);
    const g = r?.geometry;
    need(g && inRange(g.x) && inRange(g.y) && inRange(g.w) && inRange(g.h), `region geometry range: ${r?.regionId}`);
    need(g && g.x + g.w <= 100.0001 && g.y + g.h <= 100.0001, `region within frame: ${r?.regionId}`);
    need(REGION_SCOPES.includes(r?.scope), `region scope: ${r?.regionId}`);
    need(conf(r?.confidence), `region confidence: ${r?.regionId}`);
  }

  const entIds = new Set();
  for (const t of graph.entities) {
    need(t && isStr(t.entityId) && !entIds.has(t.entityId), `entity id unique/valid: ${t?.entityId}`);
    entIds.add(t?.entityId);
    need(Array.isArray(t?.regionRefs) && t.regionRefs.length >= 1 && t.regionRefs.every((id) => regionIds.has(id)), `entity regionRefs resolve: ${t?.entityId}`);
    need(ENTITY_TYPES.includes(t?.entityType), `entity type: ${t?.entityId}`);
    need(conf(t?.confidence), `entity confidence: ${t?.entityId}`);
    need(Array.isArray(t?.distinctFrom), `distinctFrom array: ${t?.entityId}`);
  }
  // Relations resolve to OTHER existing entities (checked after all ids known).
  for (const t of graph.entities) {
    if (t?.partOf != null) need(entIds.has(t.partOf) && t.partOf !== t.entityId, `partOf resolves/non-self: ${t.entityId}`);
    if (t?.sameAs != null) need(entIds.has(t.sameAs) && t.sameAs !== t.entityId, `sameAs resolves/non-self: ${t.entityId}`);
    for (const d of (t?.distinctFrom || [])) need(entIds.has(d) && d !== t.entityId, `distinctFrom resolves/non-self: ${t.entityId}->${d}`);
  }
  // No partOf cycles.
  const parent = new Map(graph.entities.filter((t) => t?.partOf != null).map((t) => [t.entityId, t.partOf]));
  for (const start of parent.keys()) {
    let cur = start; const seen = new Set();
    while (cur != null && parent.has(cur)) {
      if (seen.has(cur)) { e.push(`partOf cycle at ${start}`); break; }
      seen.add(cur); cur = parent.get(cur);
    }
  }
  return { ok: e.length === 0, errors: e };
}
