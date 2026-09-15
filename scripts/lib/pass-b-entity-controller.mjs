// VSD-034 item 3: controller logic over the experimental entity graph. Pure/deterministic, no model.
// possibleAlias: substantial region overlap + different KNOWN entity types + NO declared relation
//   (partOf/sameAs/distinctFrom) -> route to a neutral targeted reread. NEVER auto-merges entities.
//   A declared relation (incl. distinctFrom) is the model asserting "these overlap but are genuinely
//   separate" (rider-on-horse, figure-on-chair) and suppresses the flag. Same-type overlap (mother+child)
//   is not an alias signal. This catches St. John (human + animal, one region, no relation).
// unboundEntityClaim: a consequential identity claim whose required entity type is not present (optionally
//   at its region) cannot bind -> route to a neutral reread. This catches the St. John collapse case where
//   B1 emitted only an animal and the sourced "penitent human" claim has nothing to bind to.
// Thresholds are versioned/calibratable; item 4's canary measures their precision/recall before any use.
import { iou, unionBox } from './pass-b-entity-eval.mjs';

export const CONTROLLER_POLICY_VERSION = 'passBEntityController/1';
export const OVERLAP_IOU_MIN = 0.25; // "substantial" region overlap (calibratable via the canary)

function regionsMap(graph) { return new Map((graph.regions || []).map((r) => [r.regionId, r])); }
function typesDifferentKnown(a, b) { return a.entityType !== 'unknown' && b.entityType !== 'unknown' && a.entityType !== b.entityType; }
function hasDeclaredRelation(a, b) {
  return a.partOf === b.entityId || b.partOf === a.entityId || a.sameAs === b.entityId || b.sameAs === a.entityId
    || (a.distinctFrom || []).includes(b.entityId) || (b.distinctFrom || []).includes(a.entityId);
}

// Return the possibleAlias pairs. Each is a routing recommendation (neutral reread), never a merge.
export function possibleAliases(graph, { overlapMin = OVERLAP_IOU_MIN } = {}) {
  const rById = regionsMap(graph);
  const ents = (graph.entities || []).map((t) => ({ t, box: unionBox(t, rById) }));
  const out = [];
  for (let i = 0; i < ents.length; i++) {
    for (let j = i + 1; j < ents.length; j++) {
      const A = ents[i], B = ents[j];
      if (!A.box || !B.box) continue;
      if (!typesDifferentKnown(A.t, B.t)) continue;
      if (hasDeclaredRelation(A.t, B.t)) continue;
      const ov = iou(A.box, B.box);
      if (ov >= overlapMin) out.push({ entityA: A.t.entityId, entityB: B.t.entityId, iou: ov, types: [A.t.entityType, B.t.entityType], route: 'neutral-reread', reason: 'possible-alias' });
    }
  }
  return out;
}

// claims: [{ claimId, requiredType, region?:{x,y,w,h} }]. A claim binds if an entity of requiredType exists
// (and, when a region is given, overlaps it at >= overlapMin). Unbound claims route to a neutral reread.
export function detectUnboundClaims(graph, claims = [], { overlapMin = OVERLAP_IOU_MIN } = {}) {
  const rById = regionsMap(graph);
  const ents = (graph.entities || []).map((t) => ({ t, box: unionBox(t, rById) }));
  const out = [];
  for (const c of claims) {
    const bound = ents.some(({ t, box }) => t.entityType === c.requiredType && (!c.region || (box && iou(box, c.region) >= overlapMin)));
    if (!bound) out.push({ claimId: c.claimId, requiredType: c.requiredType, route: 'neutral-reread', reason: 'unbound-entity-claim' });
  }
  return out;
}

// Convenience: full controller pass over a graph + optional claims.
export function runController(graph, claims = [], opts = {}) {
  return { policyVersion: CONTROLLER_POLICY_VERSION, possibleAlias: possibleAliases(graph, opts), unbound: detectUnboundClaims(graph, claims, opts) };
}
