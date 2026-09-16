// VSD-034 item 3 (repaired): controller logic over the experimental entity graph. Pure/deterministic.
//
// possibleAlias fires on: substantial region overlap (max IoU over region pairs — NOT a union bounding box,
// which would invent overlap between disjoint parts) AND an EXPLICIT type-incompatibility (both types are
// mutually-exclusive "subject" kinds: human/animal/architecture/vehicle/plant). Compatible overlaps
// (human+object holding, inscription+object, motif+vessel, animal+ground) never fire. Same-type never fires.
//
// Model-declared relations (partOf/sameAs/distinctFrom) are PROPOSALS that annotate/reprioritise a referral
// but NEVER suppress it (a model that mis-declares must not be able to dismiss a real conflict). sameAs
// between incompatible types is a STRONGER conflict signal (raises priority), not grounds to dismiss.
// Every possibleAlias routes to a neutral targeted reread; the controller NEVER auto-merges.
//
// unboundEntityClaim: a required entity type absent (optionally at its region, matched by max region IoU) ->
// neutral reread. Thresholds/incompatibility are versioned; item 4's canary calibrates them before any use.
import { iou } from './pass-b-entity-eval.mjs';

export const CONTROLLER_POLICY_VERSION = 'passBEntityController/2';
export const OVERLAP_IOU_MIN = 0.25; // "substantial" region overlap (calibratable)
// Mutually-exclusive subject kinds: one image region cannot legitimately be two of these at once.
export const SUBJECT_TYPES = Object.freeze(['human', 'animal', 'architecture', 'vehicle', 'plant']);

function regionsMap(graph) { return new Map((graph.regions || []).map((r) => [r.regionId, r])); }
export function typesIncompatible(a, b) { return a !== b && SUBJECT_TYPES.includes(a) && SUBJECT_TYPES.includes(b); }
// Overlap between two entities = the MAX IoU over any pair of their regions (avoids the phantom-rectangle
// artifact of bounding disjoint regions into one box).
function entityOverlap(a, b, rById) {
  let best = 0;
  for (const ra of a.regionRefs) for (const rb of b.regionRefs) {
    const ga = rById.get(ra)?.geometry, gb = rById.get(rb)?.geometry;
    if (ga && gb) best = Math.max(best, iou(ga, gb));
  }
  return best;
}
function declaredRelation(a, b) {
  if (a.sameAs === b.entityId || b.sameAs === a.entityId) return 'sameAs';
  if (a.partOf === b.entityId || b.partOf === a.entityId) return 'partOf';
  if ((a.distinctFrom || []).includes(b.entityId) || (b.distinctFrom || []).includes(a.entityId)) return 'distinctFrom';
  return 'none';
}
// A model relation reprioritises but never removes a referral.
function priorityFor(relation) {
  if (relation === 'sameAs') return 'high'; // incompatible types declared identical => stronger conflict
  if (relation === 'distinctFrom' || relation === 'partOf') return 'low'; // model asserts separate; still confirm
  return 'medium';
}

// possibleAlias pairs, each a neutral-reread referral (never a merge/suppression).
export function possibleAliases(graph, { overlapMin = OVERLAP_IOU_MIN } = {}) {
  const rById = regionsMap(graph);
  const ents = graph.entities || [];
  const out = [];
  for (let i = 0; i < ents.length; i++) {
    for (let j = i + 1; j < ents.length; j++) {
      const A = ents[i], B = ents[j];
      if (!typesIncompatible(A.entityType, B.entityType)) continue;
      const ov = entityOverlap(A, B, rById);
      if (ov < overlapMin) continue;
      const relation = declaredRelation(A, B);
      out.push({ entityA: A.entityId, entityB: B.entityId, iou: ov, types: [A.entityType, B.entityType], declaredRelation: relation, priority: priorityFor(relation), route: 'neutral-reread', reason: 'possible-alias' });
    }
  }
  return out;
}

// Normalized unordered pair keys, for set comparison in fixtures/tests (order-independent).
export function aliasPairKeys(aliases) {
  return aliases.map((a) => [a.entityA, a.entityB].sort().join('::')).sort();
}

// An unbound claim means BINDING NOT ESTABLISHED — route to a neutral reread. It is NEVER a factual verdict:
// not "absent", not "false", not "refuted", not "rejected". (La Gloire's skull came back unbound purely from
// coarse type/geometry binding while the emission said "possibly a skull" — that is a reread, not a rejection.)
export const UNBOUND_DISPOSITION = 'binding-not-established';
// claims: [{ claimId, requiredType, region?:{x,y,w,h} }]. Binds if an entity of requiredType exists (and,
// when a region is given, some region of it overlaps at >= overlapMin). Unbound -> neutral reread.
export function detectUnboundClaims(graph, claims = [], { overlapMin = OVERLAP_IOU_MIN } = {}) {
  const rById = regionsMap(graph);
  const ents = graph.entities || [];
  const out = [];
  for (const c of claims) {
    const bound = ents.some((t) => t.entityType === c.requiredType && (!c.region || t.regionRefs.some((rid) => {
      const g = rById.get(rid)?.geometry; return g && iou(g, c.region) >= overlapMin;
    })));
    if (!bound) out.push({ claimId: c.claimId, requiredType: c.requiredType, disposition: UNBOUND_DISPOSITION, route: 'neutral-reread', reason: 'unbound-entity-claim' });
  }
  return out;
}

export function runController(graph, claims = [], opts = {}) {
  return { policyVersion: CONTROLLER_POLICY_VERSION, possibleAlias: possibleAliases(graph, opts), unbound: detectUnboundClaims(graph, claims, opts) };
}
