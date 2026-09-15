// VSD-034 item 2/3 (repaired): evaluator for the experimental entity-emission contract. Scores an emitted
// graph against a labeled fixture: schema conformance + region-binding + entity/type accuracy + alias
// precision/recall. Pure/deterministic. Key repairs: invalid emissions score ZERO downstream (and are tracked
// separately); matching is a global IoU-descending assignment (order-independent); entity overlap is the MAX
// IoU over region pairs (no phantom bounding rectangle); non-exhaustive labels do not penalise extra emitted
// entities (reported as unlabeled, not hallucinations); alias precision/recall is real.
import { validateEntityGraph } from './pass-b-entity-contract.mjs';

export function iou(a, b) {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const uni = a.w * a.h + b.w * b.h - inter;
  return uni <= 0 ? 0 : inter / uni;
}

// Max IoU over any region pair between two entities (avoids phantom overlap from a union bounding box).
function entityMaxIoU(la, ea, labRegById, emRegById) {
  let best = 0;
  for (const ra of la.regionRefs) for (const rb of ea.regionRefs) {
    const ga = labRegById.get(ra)?.geometry, gb = emRegById.get(rb)?.geometry;
    if (ga && gb) best = Math.max(best, iou(ga, gb));
  }
  return best;
}

// Global assignment: score all candidate pairs, sort by score desc (ties by index for determinism), assign
// greedily so each side is used once. Order-independent, unlike per-item greedy.
function globalMatch(scores) {
  const cands = [];
  for (let li = 0; li < scores.length; li++) for (let ei = 0; ei < (scores[li] || []).length; ei++) {
    if (scores[li][ei] > 0) cands.push({ li, ei, s: scores[li][ei] });
  }
  cands.sort((a, b) => (b.s - a.s) || (a.li - b.li) || (a.ei - b.ei));
  const usedL = new Set(), usedE = new Set(), pairs = [];
  for (const c of cands) { if (usedL.has(c.li) || usedE.has(c.ei)) continue; usedL.add(c.li); usedE.add(c.ei); pairs.push(c); }
  return pairs;
}

// Score one emitted graph against its labeled fixture. exhaustive=false => extra emitted entities are NOT
// penalised (label does not enumerate every entity), only reported as unlabeledEmitted.
export function scoreEmission(emitted, labeled, { iouThreshold = 0.3, exhaustive = true } = {}) {
  const v = validateEntityGraph(emitted);
  const labEnt = labeled.entities || [];
  if (!v.ok) {
    // Invalid emissions receive zero downstream credit and are tracked separately from valid ones.
    return { schemaValid: false, errors: v.errors, regions: { labeled: (labeled.regions || []).length, emitted: 0, matched: 0 }, entities: { labeled: labEnt.length, emitted: 0, matched: 0, typeCorrect: 0, unlabeledEmitted: 0, missed: labEnt.length, extras: 0 }, regionRecall: 0, entityRecall: 0, typeAccuracy: 0, typeAccuracyOverLabeled: 0 };
  }
  const labRegById = new Map((labeled.regions || []).map((r) => [r.regionId, r]));
  const emRegById = new Map((emitted.regions || []).map((r) => [r.regionId, r]));
  const emEnt = emitted.entities || [];

  // Region matching (global, IoU-descending).
  const rScores = (labeled.regions || []).map((lr) => (emitted.regions || []).map((er) => { const s = iou(lr.geometry, er.geometry); return s >= iouThreshold ? s : 0; }));
  const rPairs = globalMatch(rScores);
  const regionRecall = (labeled.regions || []).length ? rPairs.length / labeled.regions.length : 1;

  // Entity matching (global, max-region-IoU).
  const eScores = labEnt.map((le) => emEnt.map((ee) => { const s = entityMaxIoU(le, ee, labRegById, emRegById); return s >= iouThreshold ? s : 0; }));
  const ePairs = globalMatch(eScores);
  let typeCorrect = 0;
  for (const p of ePairs) if (labEnt[p.li].entityType === emEnt[p.ei].entityType) typeCorrect++;
  const matched = ePairs.length;
  const entityRecall = labEnt.length ? matched / labEnt.length : 1;
  const typeAccuracy = matched ? typeCorrect / matched : (labEnt.length ? 0 : 1);
  const typeAccuracyOverLabeled = labEnt.length ? typeCorrect / labEnt.length : 1;
  const surplus = emEnt.length - matched;

  return {
    schemaValid: true, errors: [],
    regions: { labeled: (labeled.regions || []).length, emitted: (emitted.regions || []).length, matched: rPairs.length },
    entities: { labeled: labEnt.length, emitted: emEnt.length, matched, typeCorrect, missed: labEnt.length - matched, extras: exhaustive ? surplus : 0, unlabeledEmitted: exhaustive ? 0 : surplus },
    regionRecall, entityRecall, typeAccuracy, typeAccuracyOverLabeled,
  };
}

// Alias precision/recall over normalized pair-key sets. precision null when nothing predicted; recall null
// when no gold positives (so a holdout with zero gold aliases yields recall:null, never a fake number).
export function aliasPrecisionRecall(predictedKeys, goldKeys) {
  const gold = new Set(goldKeys), pred = new Set(predictedKeys);
  let tp = 0; for (const k of pred) if (gold.has(k)) tp++;
  const fp = pred.size - tp, fn = gold.size - tp;
  return { tp, fp, fn, precision: pred.size ? tp / pred.size : null, recall: gold.size ? tp / gold.size : null };
}

// Aggregate per-work emission scores. schemaConformanceRate over ALL; accuracy means over VALID ONLY, both
// macro (per-work mean) and micro (pooled counts) so a dense scene is not down-weighted to a portrait.
export function aggregateEmission(scores) {
  const all = scores.length || 1;
  const valid = scores.filter((x) => x.schemaValid);
  const vn = valid.length || 1;
  const macro = (f) => valid.reduce((s, x) => s + f(x), 0) / vn;
  const sum = (f) => valid.reduce((s, x) => s + f(x), 0);
  const labeledTotal = sum((x) => x.entities.labeled);
  return {
    works: scores.length, validWorks: valid.length,
    schemaConformanceRate: scores.reduce((s, x) => s + (x.schemaValid ? 1 : 0), 0) / all,
    macro: { regionRecall: macro((x) => x.regionRecall), entityRecall: macro((x) => x.entityRecall), typeAccuracy: macro((x) => x.typeAccuracy), typeAccuracyOverLabeled: macro((x) => x.typeAccuracyOverLabeled) },
    micro: { entityRecall: labeledTotal ? sum((x) => x.entities.matched) / labeledTotal : null, typeAccuracyOverLabeled: labeledTotal ? sum((x) => x.entities.typeCorrect) / labeledTotal : null },
    totalUnlabeledEmitted: sum((x) => x.entities.unlabeledEmitted), totalExtras: sum((x) => x.entities.extras), totalMissed: sum((x) => x.entities.missed),
  };
}
