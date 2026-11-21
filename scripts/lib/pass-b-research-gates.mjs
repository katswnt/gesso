// VSD-092 review fixes 12 and 14: the two ways the research stopgap may spend calls, each verified AFTER every wrapper
// override (boost, routine values, nightly) from the environment the collector actually received.
//   1. The frozen six-work canary: exact IDs, research-only, fresh B1, a per-phase allowance (phase 1 = B1+B2+capture,
//      at most 14 calls; phase 2 = reviewed B3 only, at most 6), so the total can never pass 20 and phase 1 retries
//      can never eat the B3 allowance. Boost settings are refused.
//   2. Anything else on the stopgap version needs an explicit gap-routing manifest: only works routed to a model call
//      for a NAMED unresolved gap are queued. Absence of the new-version artifact is never a reason to buy B2 again.
// No network, no model calls.
import { readFileSync, existsSync } from 'node:fs';

export const CANARY = Object.freeze([
  { id: 'aic67362', category: 'narrative painting', name: 'El Greco, Saint Martin and the Beggar', audit: 'E17 patch: the cloak-sharing story and its meaning were never explained; NGA describes a different version' },
  { id: 'wikidata:Q18709475', category: 'abstract work', name: 'Kandinsky, White Cross', audit: 'E10 sufficient: negative-space cross from Guggenheim; B3 boxed the cream plane, not the cross' },
  { id: 'cleveland136178', category: 'print', name: 'Dürer, The Flight into Egypt', audit: 'E05 patch: the threat to the child vanished in the WebFetch summary; B3 got documentary requests' },
  { id: 'aic30661', category: 'ritual object', name: 'Khamsa Standard', audit: 'E08 redo: use and technique transferred from another standard; silver vs brass-and-silver unresolved' },
  { id: 'sinmafa_86-12-1', category: 'sculpture', name: 'Malian Archer Figure', audit: 'E13 patch: B1 inferred near life size from a studio photo (61.9 cm); B2 chased looting/TL dating' },
  { id: 'met53573', category: 'poorly documented work', name: 'Landscape Painting of Figure in Woodland Setting', audit: 'E07 redo: the scene is unexplained; catalog medium "Textile" is painting on silk' },
]);
export const CANARY_ID = 'research-stopgap-canary-1';
export const CANARY_TOTAL_MAX_CALLS = 20;
export const CANARY_PHASES = Object.freeze({
  1: Object.freeze({ budgetId: `${CANARY_ID}-p1`, maxCalls: 14, stages: Object.freeze(['B1', 'B2']) }), // 6 B1 + 6 B2 + ≤2 retries
  2: Object.freeze({ budgetId: `${CANARY_ID}-p2`, maxCalls: 6, stages: Object.freeze(['B3']) }),      // ≤1 reviewed B3 per work
});
const BOOST_KEYS = ['PASS_B_BOOST_UNTIL', 'PASS_B_BOOST_WORKERS', 'PASS_B_BOOST_MAX_CALLS'];
export function canaryEnv(phase) {
  const p = CANARY_PHASES[phase]; if (!p) throw new Error(`canary phase must be 1 or 2, got ${phase}`);
  return {
    PASS_B_RESEARCH_CANARY: `${CANARY_ID}/phase-${phase}`, PASS_B_RESEARCH_VERSION: 'stopgap-1', PASS_B_RESEARCH_ONLY: '1', PASS_B_RESEARCH_FRESH_B1: '1',
    PASS_B_SCOPE: 'corpus', PASS_B_CORPUS_ONLY: CANARY.map(w => w.id).join(','), PASS_B_CALL_BUDGET_ID: p.budgetId, PASS_B_MAX_CALLS: String(p.maxCalls),
    // The launcher's boost block would replace the cap: blank every boost key so the block cannot apply.
    ...Object.fromEntries(BOOST_KEYS.map(k => [k, ''])),
  };
}
// Returns null when no canary is declared; otherwise { phase, ...spec } after proving every setting is exactly frozen.
export function verifyCanaryEnv(env = process.env) {
  const marker = env.PASS_B_RESEARCH_CANARY;
  if (!marker) return null;
  const m = /^research-stopgap-canary-1\/phase-([12])$/.exec(marker);
  if (!m) throw new Error(`unknown research canary ${marker}`);
  const phase = Number(m[1]), want = canaryEnv(phase), bad = [];
  for (const [k, v] of Object.entries(want)) {
    if (k === 'PASS_B_CORPUS_ONLY') { const got = String(env[k] || '').split(',').map(x => x.trim()).filter(Boolean).sort(); if (JSON.stringify(got) !== JSON.stringify(CANARY.map(w => w.id).sort())) bad.push(k); continue; }
    if (BOOST_KEYS.includes(k)) { if (String(env[k] || '').trim()) bad.push(k); continue; }
    if (String(env[k] ?? '') !== v) bad.push(`${k}=${env[k] ?? ''}`);
  }
  if (bad.length) throw new Error(`refusing: canary ${marker} settings changed after the wrapper (${bad.join(', ')}); expected the frozen spec`);
  return { phase, ...CANARY_PHASES[phase], ids: CANARY.map(w => w.id) };
}

// ---- gap-routing manifest (finding 12): the only way to queue non-canary work on the stopgap version ----
export const ROUTING_VERSION = 'passBResearchRouting/1';
export const ROUTES = Object.freeze({ 'fresh-research': true, 'focused-repair': true, reuse: false, 'capture-and-synthesize': false }); // true = needs model calls
export function loadRoutingManifest(path, runId) {
  if (!path || !existsSync(path)) throw new Error('refusing --run: stopgap collection beyond the frozen canary needs PASS_B_RESEARCH_ROUTING=<routing.json> (design-2 §2.2–2.3: screen the completed bank and route named gaps first)');
  const m = JSON.parse(readFileSync(path, 'utf8')), e = [];
  if (m.version !== ROUTING_VERSION) e.push('version');
  if (m.runId !== runId) e.push(`runId ${m.runId} != ${runId}`);
  if (!String(m.reviewedBy || '').trim() || !Number.isFinite(Date.parse(m.reviewedAt)) || !String(m.reason || '').trim()) e.push('reviewedBy/reviewedAt/reason');
  if (!Array.isArray(m.works) || !m.works.length) e.push('works');
  const seen = new Set();
  for (const w of m.works || []) {
    if (typeof w.workId !== 'string' || seen.has(w.workId)) { e.push(`work ${w.workId}: id missing or repeated`); continue; }
    seen.add(w.workId);
    if (!(w.route in ROUTES)) e.push(`${w.workId}: route ${w.route}`);
    if (ROUTES[w.route] && !(Array.isArray(w.gaps) && w.gaps.length && w.gaps.every(g => typeof g === 'string' && g.trim().length >= 3))) e.push(`${w.workId}: a ${w.route} route must name its unresolved gaps`);
  }
  if (e.length) throw new Error(`invalid routing manifest ${path}: ${e.slice(0, 5).join('; ')}`);
  return { ...m, callIds: new Set(m.works.filter(w => ROUTES[w.route]).map(w => w.workId)) };
}
