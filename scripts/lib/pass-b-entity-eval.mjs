// VSD-034 item 2: evaluator for the experimental entity-emission contract. Scores an emitted entity graph
// against a labeled fixture graph: schema conformance + region-binding accuracy + entity-type accuracy.
// Pure/deterministic; no model, no image. Alias precision/recall (controller logic) is scored in item 3.
import { validateEntityGraph } from './pass-b-entity-contract.mjs';

// Intersection-over-union of two {x,y,w,h} boxes.
export function iou(a, b) {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const uni = a.w * a.h + b.w * b.h - inter;
  return uni <= 0 ? 0 : inter / uni;
}

// Bounding box covering all of an entity's referenced regions.
export function unionBox(entity, regionsById) {
  const boxes = entity.regionRefs.map((id) => regionsById.get(id)?.geometry).filter(Boolean);
  if (!boxes.length) return null;
  const x1 = Math.min(...boxes.map((b) => b.x)), y1 = Math.min(...boxes.map((b) => b.y));
  const x2 = Math.max(...boxes.map((b) => b.x + b.w)), y2 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

// Greedy best-IoU matching of labeled -> emitted (each emitted used at most once).
function greedyMatch(labeledBoxes, emittedBoxes, thr) {
  const used = new Set(); const pairs = [];
  for (let li = 0; li < labeledBoxes.length; li++) {
    let best = -1, bestIoU = thr;
    for (let ei = 0; ei < emittedBoxes.length; ei++) {
      if (used.has(ei) || !labeledBoxes[li] || !emittedBoxes[ei]) continue;
      const v = iou(labeledBoxes[li], emittedBoxes[ei]);
      if (v >= bestIoU) { bestIoU = v; best = ei; }
    }
    if (best >= 0) { used.add(best); pairs.push({ li, ei: best, iou: bestIoU }); }
  }
  return { pairs, matchedEmitted: used };
}

// Score one emitted graph against its labeled fixture. iouThreshold governs region/entity spatial matching.
export function scoreEmission(emitted, labeled, { iouThreshold = 0.3 } = {}) {
  const v = validateEntityGraph(emitted);
  const labRegById = new Map((labeled.regions || []).map((r) => [r.regionId, r]));
  const emRegById = new Map((emitted?.regions || []).map((r) => [r.regionId, r]));

  // Region matching.
  const rPairs = greedyMatch((labeled.regions || []).map((r) => r.geometry), (emitted?.regions || []).map((r) => r.geometry), iouThreshold);
  const regionRecall = (labeled.regions || []).length ? rPairs.pairs.length / labeled.regions.length : 1;

  // Entity matching by union-box IoU; type accuracy over matched pairs.
  const labEnt = (labeled.entities || []); const emEnt = (emitted?.entities || []);
  const labBoxes = labEnt.map((t) => unionBox(t, labRegById));
  const emBoxes = emEnt.map((t) => unionBox(t, emRegById));
  const ePairs = greedyMatch(labBoxes, emBoxes, iouThreshold);
  let typeCorrect = 0;
  for (const p of ePairs.pairs) if (labEnt[p.li].entityType === emEnt[p.ei].entityType) typeCorrect++;
  const entityRecall = labEnt.length ? ePairs.pairs.length / labEnt.length : 1;
  const typeAccuracy = ePairs.pairs.length ? typeCorrect / ePairs.pairs.length : (labEnt.length ? 0 : 1);

  return {
    schemaValid: v.ok, errors: v.errors,
    regions: { labeled: (labeled.regions || []).length, emitted: (emitted?.regions || []).length, matched: rPairs.pairs.length },
    entities: { labeled: labEnt.length, emitted: emEnt.length, matched: ePairs.pairs.length, typeCorrect, extras: emEnt.length - ePairs.pairs.length, missed: labEnt.length - ePairs.pairs.length },
    regionRecall, entityRecall, typeAccuracy,
  };
}

// Aggregate per-work scores into canary emission metrics.
export function aggregateEmission(scores) {
  const n = scores.length || 1;
  const mean = (f) => scores.reduce((s, x) => s + f(x), 0) / n;
  return {
    works: scores.length,
    schemaConformanceRate: mean((x) => (x.schemaValid ? 1 : 0)),
    meanRegionRecall: mean((x) => x.regionRecall),
    meanEntityRecall: mean((x) => x.entityRecall),
    meanTypeAccuracy: mean((x) => x.typeAccuracy),
    totalExtras: scores.reduce((s, x) => s + x.entities.extras, 0),
    totalMissed: scores.reduce((s, x) => s + x.entities.missed, 0),
  };
}
