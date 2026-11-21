// Teaching-v2 Phase A coordinate diagnostic (VSD-093; design draft 2 §5). On 20 preselected calibration works,
// compare W's proposed point with a FRESH B3 point located from W's literal target only (no title, identity,
// sources, W point or earlier box), with identical note text. Both projections get the same fresh V check and a
// blind reviewer sheet. These are separately counted experiment calls, never part of a work's 5-call budget.
import { sha256 } from './vision-legacy.mjs';
import { validateAgainstWire } from './pass-b-wire-schema.mjs';
import { LOCALIZATION_WIRE, bboxError, pointInBox } from './teaching-v2-contract.mjs';

export const PIN_DIAGNOSTIC_VERSION = 'teachingV2PinDiagnostic/1';
export const EXPERIMENT_CALLS_PER_WORK = 3; // one B3D + a fresh V (no replacement) on each of the two projections
export const BLIND_SEED = 'teaching-v2-phase-a/pin-blind/1';

export function diagnosticRequests(draft) {
  const anchors = new Map((draft.anchors || []).map(a => [a.hotspotId, a]));
  return (draft.lesson?.hotspots || []).filter(h => h.x !== null).map(h => ({ requestId: `loc-${h.id}`, hotspotId: h.id, literalTarget: anchors.get(h.id)?.targetDescription || h.head }));
}
export function validateLocalization(loc, requests) {
  const errors = validateAgainstWire(LOCALIZATION_WIRE, loc).map(e => `localization wire ${e}`);
  if (errors.length) return { ok: false, errors };
  const want = new Set(requests.map(r => r.requestId)); const seen = new Set();
  for (const v of loc.verifications) {
    if (!want.has(v.requestId)) errors.push(`unrequested ${v.requestId}`);
    if (seen.has(v.requestId)) errors.push(`duplicate ${v.requestId}`); seen.add(v.requestId);
    if (!v.found) { if (v.bbox !== null || v.point !== null) errors.push(`${v.requestId}: found:false requires null bbox and point`); continue; }
    const b = v.bbox === null ? 'found:true needs a bbox' : bboxError(v.bbox); if (b) errors.push(`${v.requestId}: ${b}`);
    if (!v.point) errors.push(`${v.requestId}: found:true needs a point`);
    else if (v.bbox && !pointInBox(v.point.x, v.point.y, v.bbox)) errors.push(`${v.requestId}: point outside its box (a geometric check, not proof it lies on the feature)`);
  }
  for (const r of want) if (!seen.has(r)) errors.push(`missing ${r}`);
  return { ok: errors.length === 0, errors };
}
// Same lesson text; each dotted note takes the fresh B3 point, or no dot when B3 abstains. No-dot notes stay no-dot.
export function b3Lesson(lesson, loc, requests) {
  const byHotspot = new Map(requests.map(r => [r.hotspotId, loc.verifications.find(v => v.requestId === r.requestId)]));
  return { ...lesson, hotspots: lesson.hotspots.map(h => {
    if (h.x === null) return h;
    const v = byHotspot.get(h.id);
    return v?.found && v.point ? { ...h, x: v.point.x, y: v.point.y } : { ...h, x: null, y: null };
  }) };
}
export function compareMethods(wLesson, bLesson) {
  const rows = wLesson.hotspots.filter(h => h.x !== null).map(h => {
    const b = bLesson.hotspots.find(x => x.id === h.id);
    return { hotspotId: h.id, w: { x: h.x, y: h.y }, b3: b.x === null ? null : { x: b.x, y: b.y }, b3Abstained: b.x === null, distancePct: b.x === null ? null : Math.round(Math.hypot(b.x - h.x, b.y - h.y) * 1000) / 10 };
  });
  return { dots: rows.length, b3Abstentions: rows.filter(r => r.b3Abstained).length, rows };
}
// Blind order for reviewers: A/B by a seeded hash per work; the mapping is kept in a separate private file.
export function blindOrder(workId, seed = BLIND_SEED) { return parseInt(sha256(`${seed}:${workId}`).slice(0, 8), 16) % 2 === 0 ? ['W', 'B3'] : ['B3', 'W']; }
