// Teaching-v2 Phase A reporting denominators (review finding 17). The all-50 operational results, the
// gold-contaminated works and the non-gold evaluation works are always reported separately. The design's
// feasibility gate keeps its original wording (§6.5: at least 35/50 free of known serious content/pin defects);
// the non-gold works are reported alongside it, never as a silent substitute denominator.
export const GATE_WORDING = 'design §6.5: at least 35/50 free of known serious content/pin defects';
export function denominators(rows, flags) {
  const agg = rs => ({ works: rs.length, acceptedForReview: rs.filter(r => r.status === 'accepted-for-review').length, held: rs.filter(r => r.status === 'hold').length, notStarted: rs.filter(r => r.status === 'not-started' || r.status === 'pending').length, calls: rs.reduce((n, r) => n + (r.calls || 0), 0), priorRunCalls: rs.reduce((n, r) => n + (r.priorRunCalls || 0), 0) });
  const gold = rows.filter(r => flags?.[r.id]?.goldOverlap), nonGold = rows.filter(r => !flags?.[r.id]?.goldOverlap);
  return {
    allOperational: agg(rows), goldContaminated: { ids: gold.map(r => r.id), ...agg(gold) }, nonGold: agg(nonGold),
    feasibilityGate: { wording: GATE_WORDING, denominatorAsWritten: 50, reportedAlongside: `non-gold works (${Object.values(flags || {}).filter(f => !f.goldOverlap).length} of the ${Object.keys(flags || {}).length}), separately`, status: 'not evaluable from automatic outcomes: accepted-for-review is not "free of known serious defects"; that needs the review labels' },
  };
}
