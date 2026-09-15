// VSD-029 Pass-B spatial presentation policy.
//
// This module keeps three decisions independent:
//   1. whether an observation is editorially useful;
//   2. whether it should be presented as a pin, an unpinned note, or merged;
//   3. which spatial candidate should supply a point when a pin is honest.
//
// It is deliberately pure and offline. It never edits evidence, accepts production approval, or runs a
// model. The optional localization stage consumes the neutral requests built here and can affect ONLY
// presentation/coordinates; it cannot rewrite the observation or its factual grounding.
import { EVIDENCE_AXES } from './vision-content-schema.mjs';
import { b4Lineage } from './pass-b-b4-delta.mjs';

export const SPATIAL_CALIBRATION_VERSION = 'passBSpatialCalibration/1';
export const LOCALIZATION_INPUT_VERSION = 'passBLocalizationInput/1';
export const LOCALIZATION_RESULT_VERSION = 'passBLocalizationResult/1';
export const SPATIAL_SCOPES = Object.freeze(['point', 'representative', 'distributed', 'global', 'notFound', 'ambiguous']);
export const LEGACY_AGREEMENT_DISTANCE = 5;
export const LEGACY_DISAGREEMENT_DISTANCE = 10;

const str = { type: 'string' }; const num = { type: 'number' };
const nullablePoint = { anyOf: [
  { type: 'object', additionalProperties: false, required: ['x', 'y'], properties: { x: num, y: num } },
  { type: 'null' },
] };
export const LOCALIZATION_WIRE_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: false, required: ['version', 'decisions', 'uncertainty'],
  properties: {
    version: { type: 'string', enum: [LOCALIZATION_RESULT_VERSION] },
    decisions: {
      type: 'array', items: {
        type: 'object', additionalProperties: false,
        required: ['requestId', 'scope', 'point', 'confidence', 'note'],
        properties: {
          requestId: str, scope: { type: 'string', enum: [...SPATIAL_SCOPES] }, point: nullablePoint,
          confidence: num, note: str,
        },
      },
    },
    uncertainty: str,
  },
});

const validPoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.y)
  && point.x >= 0 && point.x <= 100 && point.y >= 0 && point.y <= 100;

const clonePoint = point => validPoint(point) ? { x: point.x, y: point.y } : null;
const distance = (left, right) => validPoint(left) && validPoint(right)
  ? Math.hypot(left.x - right.x, left.y - right.y) : null;

function legacyIndex(ref) {
  const match = /^legacy[-:]h(\d+)$/i.exec(String(ref || ''));
  return match ? Number(match[1]) - 1 : null;
}

export function legacyHotspotCandidate(legacy, ref) {
  const index = legacyIndex(ref);
  if (index === null) return null;
  const hotspot = Array.isArray(legacy?.hotspots) ? legacy.hotspots[index] : null;
  if (!hotspot || !validPoint(hotspot)) return null;
  const noteIndex = Number.isInteger(hotspot.n) && hotspot.n >= 1 ? hotspot.n - 1 : index;
  const note = Array.isArray(legacy?.teaching?.notes) ? legacy.teaching.notes[noteIndex] : null;
  return {
    source: 'legacy', ref, index, noteIndex,
    point: clonePoint(hotspot),
    head: typeof note?.head === 'string' ? note.head : null,
    body: typeof note?.body === 'string' ? note.body : null,
  };
}

function groundingById(body) {
  const map = new Map();
  for (const axis of EVIDENCE_AXES) for (const item of (body?.evidence?.[axis] || [])) {
    map.set(item.evidenceId, { axis, target: item.feature, description: item.why, bbox: item.bbox ?? null, confidence: item.confidence });
  }
  for (const item of (body?.richDescriptors?.visual?.delights || [])) {
    map.set(item.delightId, { axis: 'delight', target: item.note, description: item.note, bbox: item.bbox ?? null, confidence: item.confidence });
  }
  return map;
}

function automaticRoute({ action, placement, suppression, legacyCandidate, legacyCoordinateEligible, proposedPoint }) {
  if (suppression) {
    if (suppression.reason === 'duplicate-evidence-ref') return { presentation: 'merge', reason: 'same-grounding-observation' };
    if (suppression.reason === 'near-duplicate-pin') return { presentation: 'note', reason: 'distinct-observation-at-colliding-location' };
    if (['near-full-frame-bbox', 'missing-localized-anchor'].includes(suppression.reason)) {
      return { presentation: 'note', reason: 'useful-but-not-honestly-point-localizable' };
    }
    return { presentation: 'hold', reason: 'unknown-spatial-suppression' };
  }
  if (placement?.method === 'localized-bbox-center') {
    return { presentation: 'localize', reason: 'bbox-center-is-not-an-approved-point' };
  }
  if (action === 'keep' && legacyCandidate && legacyCoordinateEligible) {
    return { presentation: 'pin', source: 'legacy', reason: 'unchanged-feature-keeps-prior-spatial-judgment' };
  }
  const disagreement = legacyCoordinateEligible ? distance(legacyCandidate?.point, proposedPoint) : null;
  if (Number.isFinite(disagreement) && disagreement <= LEGACY_AGREEMENT_DISTANCE) {
    return { presentation: 'pin', source: 'legacy', reason: 'legacy-and-b1-candidates-agree' };
  }
  if (Number.isFinite(disagreement) && disagreement > LEGACY_DISAGREEMENT_DISTANCE) {
    return { presentation: 'localize', reason: 'legacy-and-b1-candidates-disagree' };
  }
  if (validPoint(proposedPoint)) return { presentation: 'pin', source: 'b1', reason: 'localized-b1-candidate' };
  if (legacyCandidate && legacyCoordinateEligible) return { presentation: 'pin', source: 'legacy', reason: 'only-localized-candidate' };
  return { presentation: 'note', reason: 'no-honest-point-candidate' };
}

// Produce one row for every surviving B4 hotspot proposal. Suppressed observations remain rows with an
// explicit presentation route; they are never silently treated as editorial deletions.
export function spatialRowsForWork({ workId, imageSha256, legacyImageSha256, delta, body, hydration, legacy }) {
  const placements = new Map((hydration?.hotspots?.placements || []).map(row => [row.deltaIndex, row]));
  const suppressed = new Map((hydration?.hotspots?.suppressed || []).map(row => [row.deltaIndex, row]));
  const bodyById = new Map((body?.hotspots || []).map(row => [row.hotspotId, row]));
  const grounding = groundingById(body);
  return b4Lineage(delta).hotspots.filter(row => row.survives).map(row => {
    const source = delta.hotspots[row.deltaIndex] || {};
    const placement = placements.get(row.deltaIndex) || null;
    const suppression = suppressed.get(row.deltaIndex) || null;
    if (!placement && !suppression) throw new Error(`${workId}: hotspot delta[${row.deltaIndex}] has no hydration outcome`);
    const published = placement ? bodyById.get(placement.hotspotId) : null;
    if (placement && !published) throw new Error(`${workId}: hotspot delta[${row.deltaIndex}] placement has no body row`);
    const grounded = grounding.get(source.evidenceRef) || {};
    const legacyCandidate = legacyHotspotCandidate(legacy, source.ref);
    const legacyCoordinateEligible = !!legacyCandidate && /^[0-9a-f]{64}$/.test(legacyImageSha256 || '') && legacyImageSha256 === imageSha256;
    const proposedPoint = clonePoint(published);
    const candidates = [];
    if (legacyCoordinateEligible) candidates.push({ source: 'legacy', ref: legacyCandidate.ref, point: legacyCandidate.point });
    if (proposedPoint) candidates.push({ source: placement?.method || 'b1', ref: placement?.pinRef ?? source.evidenceRef ?? null, point: proposedPoint });
    const route = automaticRoute({ action: source.action, placement, suppression, legacyCandidate, legacyCoordinateEligible, proposedPoint });
    return {
      workId, imageSha256: imageSha256 ?? null, deltaIndex: row.deltaIndex,
      action: source.action, ref: source.ref ?? null, evidenceRef: source.evidenceRef ?? null,
      target: published?.conciseText || grounded.target || 'Visible feature',
      groundingTarget: grounded.target || null,
      role: source.role ?? published?.role ?? null,
      evidenceAxis: grounded.axis ?? null,
      state: published ? 'published' : 'suppressed',
      currentPoint: proposedPoint,
      placementMethod: placement?.method ?? null,
      suppressionReason: suppression?.reason ?? null,
      collidesWithHotspotId: suppression?.collidesWithHotspotId ?? null,
      legacyCandidate,
      legacyCoordinateEligible,
      candidateDistance: legacyCoordinateEligible ? distance(legacyCandidate?.point, proposedPoint) : null,
      candidates,
      contentDisposition: 'retain',
      automaticRoute: route,
    };
  });
}

function shouldLocalize(row, mode) {
  if (row.automaticRoute.presentation === 'hold') return true;
  if (mode === 'audit') return row.state === 'published' || row.automaticRoute.presentation === 'localize';
  return row.automaticRoute.presentation === 'localize';
}

// Human answers are intentionally not accepted by this function. The returned request can be handed to a
// spatial-only image process without leaking owner coordinates into its input.
export function buildLocalizationInput({ workId, imageSha256, imageExt, rows, mode = 'exceptions' }) {
  if (!['exceptions', 'audit'].includes(mode)) throw new Error(`unknown localization mode: ${mode}`);
  if (!/^[0-9a-f]{64}$/.test(imageSha256 || '')) throw new Error('localization input needs image sha256');
  if (!/^[a-z0-9]{1,5}$/.test(imageExt || '')) throw new Error('localization input needs safe image extension');
  const targets = (rows || []).filter(row => shouldLocalize(row, mode)).map(row => ({
    requestId: `sp-${row.deltaIndex}`,
    deltaIndex: row.deltaIndex,
    visualTarget: row.target,
    groundingTarget: row.groundingTarget,
    candidates: row.candidates.map(candidate => ({ source: candidate.source, point: { ...candidate.point } })),
  }));
  return { version: LOCALIZATION_INPUT_VERSION, workId, imageSha256, imageExt, mode, targets };
}

export function buildLocalizationPrompt(input, imageFile) {
  if (input?.version !== LOCALIZATION_INPUT_VERSION) throw new Error('invalid localization input version');
  if (!/^[0-9a-f]{64}\.[a-z0-9]{1,5}$/.test(imageFile || '')) throw new Error('localization prompt needs neutral image filename');
  return [
    'You are a spatial-localization checker. Your working directory contains exactly one sanitized artwork image. Open the named image with the Read tool. You are not researching or rewriting the artwork: your only job is to decide whether each supplied visual target can honestly be represented by one point.',
    'For each target, choose exactly one scope: point (one exact visible detail), representative (a repeated/distributed feature for which one clearly representative visible example is honest), distributed (visible in several places and no single example adequately represents it), global (describes the whole composition or object), notFound (the claimed visible target is not present), or ambiguous (the pixels do not support a reliable decision).',
    'For point or representative, return one x/y percentage point on the visible feature. For every other scope, point must be null. Candidate points are prior spatial proposals, not facts: inspect the pixels and choose either one of them or a better point. Do not assume a target exists merely because it was requested. Do not discuss artist, date, title, history, symbolism, or source claims.',
    'Return one bare JSON object only, with exactly {version,decisions,uncertainty}. Echo every requestId once. Each decision is exactly {requestId,scope,point,confidence,note}; confidence is 0-1 and note briefly describes only the visible spatial basis. Set version to passBLocalizationResult/1.',
    'Point coordinates use x/y percentages from 0-100, measured on the image itself.',
    `The image file is ./${imageFile}.`,
    `TARGETS:\n${JSON.stringify({ version: input.version, mode: input.mode, targets: input.targets })}`,
  ].join('\n\n');
}

export function validateLocalizationResult(input, result) {
  const errors = [];
  const need = (condition, message) => { if (!condition) errors.push(message); };
  need(result && typeof result === 'object' && !Array.isArray(result), 'result object');
  if (!result || typeof result !== 'object' || Array.isArray(result)) return { ok: false, errors };
  need(result.version === LOCALIZATION_RESULT_VERSION, 'result version');
  need(Array.isArray(result.decisions), 'decisions array');
  need(typeof result.uncertainty === 'string' && result.uncertainty.length <= 1000, 'uncertainty');
  const wanted = new Set((input?.targets || []).map(target => target.requestId));
  const seen = new Set();
  for (const decision of (result.decisions || [])) {
    need(decision && typeof decision === 'object' && !Array.isArray(decision), 'decision object');
    if (!decision || typeof decision !== 'object') continue;
    need(wanted.has(decision.requestId), `unexpected requestId: ${decision.requestId}`);
    need(!seen.has(decision.requestId), `duplicate requestId: ${decision.requestId}`);
    seen.add(decision.requestId);
    need(SPATIAL_SCOPES.includes(decision.scope), `scope: ${decision.scope}`);
    const pointRequired = ['point', 'representative'].includes(decision.scope);
    need(pointRequired ? validPoint(decision.point) : decision.point === null, `point/scope mismatch: ${decision.requestId}`);
    need(typeof decision.confidence === 'number' && decision.confidence >= 0 && decision.confidence <= 1, `confidence: ${decision.requestId}`);
    need(typeof decision.note === 'string' && decision.note.length <= 500, `note: ${decision.requestId}`);
  }
  need(seen.size === wanted.size && [...wanted].every(id => seen.has(id)), 'one decision per requested target');
  return { ok: errors.length === 0, errors };
}

export function resolveLocalization(row, decision, { minimumConfidence = 0.75 } = {}) {
  if (!decision) return { presentation: row.automaticRoute.presentation, point: null, status: 'not-run', reason: row.automaticRoute.reason };
  if (decision.confidence < minimumConfidence || decision.scope === 'ambiguous') {
    return { presentation: 'hold', point: null, status: 'human-review', reason: 'low-confidence-or-ambiguous-localization' };
  }
  if (decision.scope === 'notFound') return { presentation: 'hold', point: null, status: 'claim-review', reason: 'visual-target-not-found' };
  if (['distributed', 'global'].includes(decision.scope)) {
    return { presentation: 'note', point: null, status: 'auto', reason: `spatial-scope-${decision.scope}` };
  }
  return { presentation: 'pin', point: clonePoint(decision.point), status: 'auto', reason: `spatial-scope-${decision.scope}` };
}

const quantile = (values, q) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
};

function ownerChoice(reviewHotspot, row) {
  const review = reviewHotspot?.review;
  const decision = review?.decision || 'abstain';
  const finalPoint = decision === 'move' && validPoint(review) ? clonePoint(review)
    : decision === 'keep' ? clonePoint(row.currentPoint) : null;
  return {
    decision, finalPoint,
    // The v1 packet's drop control mixed editorial rejection with spatial removal. Never learn a factual or
    // usefulness negative from it. On a suppressed row it is only evidence that no point should publish.
    spatialSignal: ['drop', 'discard', 'note'].includes(decision) ? 'unpin'
      : decision === 'auto' ? row.automaticRoute?.presentation || 'auto' : (finalPoint ? 'pin' : 'none'),
    contentSignal: decision === 'discard' ? 'discard'
      : ['auto', 'note', 'keep', 'move'].includes(decision) ? 'retain' : 'unknown',
  };
}

export function summarizeOwnerSpatialReview({ workRows, review }) {
  const rowsByWork = new Map((workRows || []).map(work => [work.workId, work]));
  const labeled = [];
  for (const reviewedWork of (review?.works || [])) {
    const work = rowsByWork.get(reviewedWork.workId);
    if (!work || reviewedWork.kind !== 'completed') continue;
    const reviewByDelta = new Map((reviewedWork.hotspots || []).map(hotspot => [hotspot.deltaIndex, hotspot]));
    for (const row of work.rows) {
      const choice = ownerChoice(reviewByDelta.get(row.deltaIndex), row);
      labeled.push({
        ...row, owner: choice,
        distanceFromCurrent: pointDistance(choice.finalPoint, row.currentPoint),
        distanceFromLegacy: pointDistance(choice.finalPoint, row.legacyCandidate?.point),
      });
    }
  }
  const decisionNames = ['keep', 'move', 'note', 'auto', 'discard', 'drop', 'abstain'];
  const count = values => Object.fromEntries(decisionNames.map(value => [value, values.filter(row => row.owner.decision === value).length]));
  const moved = labeled.filter(row => row.owner.decision === 'move');
  const pointReviewed = labeled.filter(row => ['keep', 'move'].includes(row.owner.decision));
  const comparableLegacyMoves = moved.filter(row => Number.isFinite(row.distanceFromLegacy) && Number.isFinite(row.distanceFromCurrent));
  const comparableLegacyPointLabels = pointReviewed.filter(row => Number.isFinite(row.distanceFromLegacy) && Number.isFinite(row.distanceFromCurrent));
  const closerCounts = values => {
    const closer = { legacy: 0, current: 0, tie: 0 };
    for (const row of values) {
      if (row.distanceFromLegacy + 0.5 < row.distanceFromCurrent) closer.legacy++;
      else if (row.distanceFromCurrent + 0.5 < row.distanceFromLegacy) closer.current++;
      else closer.tie++;
    }
    return closer;
  };
  const by = field => {
    const groups = new Map();
    for (const row of labeled.filter(row => row.state === 'published')) {
      const key = row[field] || 'none';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    return Object.fromEntries([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, values]) => {
      const pointReviewed = values.filter(row => ['keep', 'move'].includes(row.owner.decision));
      const groupMoves = pointReviewed.filter(row => row.owner.decision === 'move');
      return [key, {
        pointReviewed: pointReviewed.length, moved: groupMoves.length,
        moveRate: pointReviewed.length ? groupMoves.length / pointReviewed.length : null,
        medianMoveDistance: quantile(groupMoves.map(row => row.distanceFromCurrent), 0.5),
      }];
    }));
  };
  return {
    version: SPATIAL_CALIBRATION_VERSION,
    sourceReviewVersion: review?.version ?? null,
    runId: review?.runId ?? null,
    totals: {
      works: rowsByWork.size,
      observations: labeled.length,
      published: labeled.filter(row => row.state === 'published').length,
      suppressed: labeled.filter(row => row.state === 'suppressed').length,
      choices: count(labeled),
      suppressedChoices: count(labeled.filter(row => row.state === 'suppressed')),
      ambiguousContentDrops: labeled.filter(row => row.owner.decision === 'drop').length,
    },
    movement: {
      moved: moved.length,
      median: quantile(moved.map(row => row.distanceFromCurrent), 0.5),
      p75: quantile(moved.map(row => row.distanceFromCurrent), 0.75),
      p90: quantile(moved.map(row => row.distanceFromCurrent), 0.9),
      pointReviewed: pointReviewed.length,
      comparableLegacyPointLabels: comparableLegacyPointLabels.length,
      pointLabelCloser: closerCounts(comparableLegacyPointLabels),
      comparableLegacyMoves: comparableLegacyMoves.length,
      closer: closerCounts(comparableLegacyMoves),
      returnedWithinLegacy: {
        three: comparableLegacyMoves.filter(row => row.distanceFromLegacy <= 3).length,
        five: comparableLegacyMoves.filter(row => row.distanceFromLegacy <= 5).length,
        ten: comparableLegacyMoves.filter(row => row.distanceFromLegacy <= 10).length,
      },
    },
    byPlacementMethod: by('placementMethod'),
    byEvidenceAxis: by('evidenceAxis'),
    learningRules: {
      abstain: 'excluded-from-training-and-approval-inference',
      legacyCoordinate: 'candidate-not-ground-truth',
      suppressedDrop: 'spatial-unpin-only-content-unknown',
      publishedDrop: 'ambiguous-v1-signal-content-unknown',
      explicitMove: 'positive-point-label',
      explicitKeep: 'positive-current-point-label',
    },
    rows: labeled,
  };
}

export const pointDistance = distance;
