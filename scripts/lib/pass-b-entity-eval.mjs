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

// Hungarian (Kuhn-Munkres) min-cost assignment on a square matrix; rows<=cols required. Returns colForRow.
function hungarian(cost) {
  const n = cost.length, m = cost[0].length, INF = Infinity;
  const u = new Array(n + 1).fill(0), v = new Array(m + 1).fill(0), p = new Array(m + 1).fill(0), way = new Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i; let j0 = 0;
    const minv = new Array(m + 1).fill(INF), used = new Array(m + 1).fill(false);
    do {
      used[j0] = true; const i0 = p[j0]; let delta = INF, j1 = -1;
      for (let j = 1; j <= m; j++) if (!used[j]) {
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= m; j++) { if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta; }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const colForRow = new Array(n).fill(-1);
  for (let j = 1; j <= m; j++) if (p[j] > 0) colForRow[p[j] - 1] = j - 1;
  return colForRow;
}

// Optimal bipartite matching that maximizes CARDINALITY first, then total IoU (weight = CARD_BONUS+iou per
// edge, so an extra match always outweighs any IoU gain). `iouMatrix[li][ei]` holds thresholded IoU (>0 = an
// allowable edge). Returns [{li, ei, iou}] — provably >= greedy cardinality (see greedy-failure regression).
const CARD_BONUS = 1000;
export function maxWeightMatch(iouMatrix) {
  const rows = iouMatrix.length, cols = rows ? iouMatrix[0].length : 0;
  if (!rows || !cols) return [];
  const transpose = rows > cols;
  const R = transpose ? cols : rows, C = transpose ? rows : cols;
  const w = Array.from({ length: R }, (_, i) => Array.from({ length: C }, (_, j) => {
    const val = transpose ? iouMatrix[j][i] : iouMatrix[i][j];
    return val > 0 ? CARD_BONUS + val : 0; // non-edge contributes nothing
  }));
  const maxW = CARD_BONUS + 1;
  const cost = w.map((r) => r.map((x) => maxW - x)); // min-cost of (maxW - weight) == max weight
  const colForRow = hungarian(cost);
  const pairs = [];
  for (let i = 0; i < R; i++) {
    const j = colForRow[i];
    if (j < 0 || w[i][j] <= 0) continue; // only real edges count
    const li = transpose ? j : i, ei = transpose ? i : j;
    pairs.push({ li, ei, iou: iouMatrix[li][ei] });
  }
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

  // Region matching (optimal max-cardinality/max-IoU).
  const rScores = (labeled.regions || []).map((lr) => (emitted.regions || []).map((er) => { const s = iou(lr.geometry, er.geometry); return s >= iouThreshold ? s : 0; }));
  const rPairs = maxWeightMatch(rScores);
  const regionRecall = (labeled.regions || []).length ? rPairs.length / labeled.regions.length : 1;

  // Entity matching (optimal, max-region-IoU per entity pair).
  const eScores = labEnt.map((le) => emEnt.map((ee) => { const s = entityMaxIoU(le, ee, labRegById, emRegById); return s >= iouThreshold ? s : 0; }));
  const ePairs = maxWeightMatch(eScores);
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

// Aggregate per-work emission scores. Reports the HEADLINE `unconditional` metrics over ALL works (invalid
// emissions retained as zero, so they cannot be hidden), PLUS explicitly named `validOnly` diagnostics over
// schema-valid emissions. Both macro (per-work mean) and micro (pooled counts, so a dense scene is not
// down-weighted to a portrait) are given, and schemaConformanceRate is reported alongside.
export function aggregateEmission(scores) {
  const all = scores.length || 1;
  const valid = scores.filter((x) => x.schemaValid);
  const macroOver = (set, f) => (set.length ? set.reduce((s, x) => s + f(x), 0) / set.length : null);
  const microOver = (set, num, den) => { const d = set.reduce((s, x) => s + den(x), 0); return d ? set.reduce((s, x) => s + num(x), 0) / d : null; };
  const labeled = (x) => x.entities.labeled, matched = (x) => x.entities.matched, typeCorrect = (x) => x.entities.typeCorrect;
  return {
    works: scores.length, validWorks: valid.length,
    schemaConformanceRate: valid.length / all,
    // Headline: every work counts; invalid emissions contribute zero recall/accuracy.
    unconditional: {
      macro: { regionRecall: macroOver(scores, (x) => x.regionRecall), entityRecall: macroOver(scores, (x) => x.entityRecall), typeAccuracyOverLabeled: macroOver(scores, (x) => x.typeAccuracyOverLabeled) },
      micro: { entityRecall: microOver(scores, matched, labeled), typeAccuracyOverLabeled: microOver(scores, typeCorrect, labeled) },
    },
    // Diagnostics: schema-valid emissions only (clearly separated so it can never masquerade as the headline).
    validOnly: {
      macro: { regionRecall: macroOver(valid, (x) => x.regionRecall), entityRecall: macroOver(valid, (x) => x.entityRecall), typeAccuracy: macroOver(valid, (x) => x.typeAccuracy), typeAccuracyOverLabeled: macroOver(valid, (x) => x.typeAccuracyOverLabeled) },
      micro: { entityRecall: microOver(valid, matched, labeled), typeAccuracyOverLabeled: microOver(valid, typeCorrect, labeled) },
    },
    totals: { unlabeledEmitted: valid.reduce((s, x) => s + x.entities.unlabeledEmitted, 0), extras: valid.reduce((s, x) => s + x.entities.extras, 0), missed: scores.reduce((s, x) => s + x.entities.missed, 0) },
  };
}
