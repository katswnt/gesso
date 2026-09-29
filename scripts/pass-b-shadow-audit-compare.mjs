// Offline comparison of shadow-audit v1 (sa-dc474939fdab) and v2 (VSD-051) on the same four works. No calls.
// Reads the verified attempts through the runner (evidence re-derived and hash-checked) and the reports.
//   node scripts/pass-b-shadow-audit-compare.mjs   -> <v2 run>/comparison.json
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RUN_ROOT } from './lib/pass-b-calibration.mjs';
import { findingsForWork, loadCanonicalFindings } from './lib/pass-b-blocked-findings.mjs';
import { AUDIT_WORKS, planAudit, auditBinding, auditRunId, auditHistory, scoreAudit, loadEvidence } from './pass-b-shadow-audit.mjs';

const readJson = p => JSON.parse(readFileSync(p, 'utf8'));

function tokens(h) {
  const u = h?.derived?.evidence?.usage;
  if (!u) return null;
  const thinking = u.output_tokens_details?.thinking_tokens ?? null;
  return { input: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), inputUncached: u.input_tokens || 0,
    cacheRead: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0,
    output: u.output_tokens || 0, thinking, visible: thinking == null ? null : (u.output_tokens || 0) - thinking, durationMs: h.meta?.durationMs ?? null };
}

function variantSummary(variant, controller) {
  const ev = variant === 2 ? loadEvidence() : null;
  const plans = AUDIT_WORKS.map(s => planAudit(s, undefined, variant, ev));
  const runId = auditRunId(auditBinding(variant, ev)), outDir = join(RUN_ROOT, runId);
  const known = readJson('data/pass-b-audit-eval-known-failures.json').items;
  const boundPath = join(RUN_ROOT, 'audit-eval-v1', 'owner-labels.bound.json');
  const ownerLabels = existsSync(boundPath) ? readJson(boundPath).rows : [];
  const findings = loadCanonicalFindings();
  const report = scoreAudit({ plans, outDir, runId, known, ownerLabels, sealed: id => findingsForWork(findings, id), controller });
  const perWork = plans.map(p => { const h = auditHistory(outDir, p, runId); return { workId: p.workId, name: p.spec.name, outcome: h?.kind || 'not-run', tokens: tokens(h), audit: h?.derived?.audit || null }; });
  const sum = k => perWork.reduce((n, w) => n + (w.tokens?.[k] ?? 0), 0);
  const ke = report.summary.knownErrors;
  const presupItem = ke.items.find(i => i.componentId === 'guide:q_5c5598faa0');
  const visualAll = perWork.reduce((n, w) => n + (w.audit ? (variant === 2 ? w.audit.segments.flatMap(s => s.claims).filter(c => c.modelR === 'visual').length : w.audit.components.flatMap(c => c.assertions).filter(a => a.class === 'visual-only').length) : 0), 0);
  const v2stats = variant === 2 ? perWork.reduce((acc, w) => {
    const st = w.audit?.stats; if (!st) return acc;
    const qh = w.audit.segments.filter(s => s.role === 'question' || s.role === 'heading');
    acc.claims += st.claims; acc.presuppositions += st.presuppositions; acc.misroutedVisual += st.misroutedVisual; acc.citationDowngrades += st.citationDowngrades;
    acc.coverageGaps.push(...st.coverageGaps.map(g => `${w.name}: ${g}`));
    acc.questionsHeadings += qh.length; acc.emptyPresuppositionLists += qh.filter(s => s.preCount === 0).length;
    for (const [k, v] of Object.entries(st.byKind)) acc.byKind[k] = (acc.byKind[k] || 0) + v;
    return acc;
  }, { claims: 0, presuppositions: 0, misroutedVisual: 0, citationDowngrades: 0, coverageGaps: [], questionsHeadings: 0, emptyPresuppositionLists: 0, byKind: {} }) : null;
  return {
    variant, runId, controller: variant === 2 ? 'v2' : controller,
    outcomes: perWork.map(w => `${w.name}: ${w.outcome}`),
    tokens: { perWork: perWork.map(w => ({ name: w.name, ...w.tokens })), total: { input: sum('input'), cacheRead: sum('cacheRead'), cacheWrite: sum('cacheWrite'), output: sum('output'), thinking: sum('thinking'), visible: sum('visible'), durationMs: sum('durationMs') } },
    verdicts: report.summary.verdicts,
    specificErrors: { total: ke.total, identified: ke.errorIdentified, partialOrAmbiguous: ke.partialOrAmbiguous, routedToVisual: ke.routedToVisual, accepted: ke.accepted, notExtracted: ke.notExtracted, kindCorrect: ke.kindCorrect ?? null, kindWrong: ke.kindWrong ?? null,
      items: ke.items.map(i => ({ componentId: i.componentId, level: i.level, contradicted: i.contradicted, declaredKinds: i.declaredKinds, expectedKind: i.expectedKind, targets: i.targets })) },
    presuppositions: { knownWingsQuestion: presupItem?.level ?? null, ...(v2stats ? { extracted: v2stats.presuppositions, questionsHeadings: v2stats.questionsHeadings, emptyLists: v2stats.emptyPresuppositionLists, coverageGaps: v2stats.coverageGaps } : {}) },
    visualReferrals: { total: visualAll, knownErrorsRoutedToVisual: ke.routedToVisual, ...(v2stats ? { misroutedNonVisibility: v2stats.misroutedVisual } : {}) },
    control: report.summary.notThisErrorControls.map(c => ({ componentId: c.componentId, auditor: c.auditor, pass: c.pass })),
    ownerSupported: { total: report.summary.ownerSupported.total, held: report.summary.ownerSupported.held.map(h => `${h.workId} ${h.componentId}: ${h.holdReasons.slice(0, 3).join(' | ')}`),
      needsVisualCheck: report.summary.ownerSupported.needsVisualCheck, textCovered: report.summary.ownerSupported.textCovered },
    ...(v2stats ? { claims: v2stats.claims, byKind: v2stats.byKind, citationDowngrades: v2stats.citationDowngrades } : { citationDowngrades: report.summary.citationDowngrades }),
  };
}

const v1 = variantSummary(1, 2), v2 = variantSummary(2, null);
const out = { version: 'passBShadowAuditComparison/1', at: new Date().toISOString(), v1, v2,
  caveat: 'Four works; six known errors in two works (regression challenges, not recall). Three owner-supported components. Counts, not rates. v1 is scored with the corrected controller 2 (report.v2.json semantics); its stored evidence is unchanged.' };
writeFileSync(join(RUN_ROOT, v2.runId, 'comparison.json'), `${JSON.stringify(out, null, 1)}\n`, { mode: 0o600 });
console.log(JSON.stringify(out, null, 1));
