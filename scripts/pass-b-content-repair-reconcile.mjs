// VSD-035/036 content-repair canary — OFFLINE reconciliation + artifacts for run cr2-af3d6ed79c1c.
// No model calls. Builds, per work: a claim bundle (with a SEPARATE bound source-span artifact), an EMPTY
// owner decisions artifact (all decisions/resolutions unresolved), a reconciliation report (contentReadiness),
// a content-addressed reconciliation set + active pointer, and the blocked-findings enforcement verdict. Then
// emits a single owner exception artifact (HTML). Everything is fail-closed and read-mostly.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { sha256, stableJson } from './lib/vision-legacy.mjs';
import {
  loadReconciliationSources, buildClaimBundle, validateClaimBundle, buildDecisionArtifact, validateDecisionArtifact,
  auditReconciliation, reconciliationPaths, reconciliationSetPaths, loadAndVerifyReconciliation,
  RECONCILIATION_ACTIVE_VERSION,
} from './lib/pass-b-reconciliation.mjs';
import { projectToProduction } from './lib/pass-b-approval.mjs';
import { loadCanonicalFindings, evaluateApproval, matchFinding, findingsForWork, canonicalBlockedWorkId } from './lib/pass-b-blocked-findings.mjs';

const RUN_ID = 'cr2-af3d6ed79c1c';
const RUN_DIR = join('data/incoming/vision-calibration', RUN_ID);
const OUT_DIR = join(RUN_DIR, 'owner-review');
const WORKS = [
  { name: 'La Gloire', workId: 'wikidata:Q16467705' },
  { name: 'St. John Chrysostom', workId: 'wikidata:Q1211814' },
];
const sha = (v) => sha256(stableJson(v));
const wdirOf = (workId) => join(RUN_DIR, 'works', sha256(workId).slice(0, 24));
const readCompletion = (workId, stage) => {
  const dir = join(wdirOf(workId), 'completions');
  const f = readdirSync(dir).find((x) => x.startsWith(`${stage.toLowerCase()}-`));
  return f ? JSON.parse(readFileSync(join(dir, f), 'utf8')) : null;
};
// The B4 raw delta (model structured_output) from the stage attempt transcript — for the blocked-findings fingerprint.
function freshB4Delta(workId) {
  const dir = join(wdirOf(workId), 'attempts');
  const f = readdirSync(dir).find((x) => x.startsWith('b4-'));
  const lines = readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) { try { const o = JSON.parse(lines[i]); if (o.type === 'result' && o.structured_output) return o.structured_output; } catch { /* skip */ } }
  throw new Error(`no B4 structured_output in transcript for ${workId}`);
}
// Recover per-URL fetched excerpts + retrieval hashes from the B2 transcript's WebFetch tool results.
function b2WebFetches(workId) {
  const dir = join(wdirOf(workId), 'attempts');
  const f = readdirSync(dir).find((x) => x.startsWith('b2-'));
  const raw = readFileSync(join(dir, f), 'utf8');
  const lines = raw.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const urlById = new Map(); const byUrl = new Map();
  for (const ev of lines) {
    const msg = ev.message || ev;
    const content = msg?.content;
    if (Array.isArray(content)) for (const b of content) {
      if (b.type === 'tool_use' && /webfetch/i.test(b.name || '') && b.input?.url) urlById.set(b.id, b.input.url);
      if (b.type === 'tool_result') {
        const url = urlById.get(b.tool_use_id);
        if (!url) continue;
        const txt = Array.isArray(b.content) ? b.content.map((c) => c.text || '').join('\n') : (typeof b.content === 'string' ? b.content : '');
        if (txt && !b.is_error) byUrl.set(url, { retrievedContentSha256: sha256(txt), fullLen: txt.length, text: txt });
      }
    }
  }
  return { byUrl, transcriptSha256: sha256(raw) };
}
// Best-effort excerpt: a window around the first claim keyword, else the head. Never fabricated — only from fetched bytes.
function excerptFor(text, claim) {
  const words = (claim.match(/[A-Za-zÀ-ÿ]{5,}/g) || []).slice(0, 6);
  let idx = -1; for (const w of words) { idx = text.toLowerCase().indexOf(w.toLowerCase()); if (idx >= 0) break; }
  const start = idx >= 0 ? Math.max(0, idx - 120) : 0;
  return text.slice(start, start + 480).replace(/\s+/g, ' ').trim().slice(0, 480);
}

function buildSourceSpans(workId, b2) {
  const { byUrl, transcriptSha256 } = b2WebFetches(workId);
  const spans = []; const spanMeta = []; let n = 0;
  for (const fc of b2.factChecks || []) {
    for (const s of fc.sources || []) {
      const fetched = byUrl.get(s.url);
      const spanId = `span-${fc.claimId}--${s.sourceId}`.replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 159);
      if (!fetched) { spanMeta.push({ spanId, claimId: fc.claimId, sourceId: s.sourceId, url: s.url, excerpt: null, recovered: false, note: 'URL not fetched in B2 transcript (searched-only or fetch failed); no excerpt to bind' }); continue; }
      const excerpt = excerptFor(fetched.text, fc.claim) || fetched.text.slice(0, 200);
      spans.push({ sourceSpanId: spanId, claimId: fc.claimId, sourceId: s.sourceId, excerpt, retrievedContentSha256: fetched.retrievedContentSha256 });
      spanMeta.push({ spanId, claimId: fc.claimId, atomicClaim: fc.claim, verdict: fc.verdict, confidence: fc.confidence, sourceId: s.sourceId, url: s.url, title: s.title, retrievedContentSha256: fetched.retrievedContentSha256, retrievedBytes: fetched.fullLen, excerpt, recovered: true });
    }
  }
  return { spans, spanMeta, transcriptSha256 };
}

function writeReconciliationSet(sources, bundle, decisions, report) {
  const base = reconciliationPaths(sources);
  const setP = reconciliationSetPaths(sources, report.reportSha256);
  for (const d of [base.dir, base.sets, base.activations, base.templates, setP.setDir]) mkdirSync(d, { recursive: true, mode: 0o700 });
  writeFileSync(setP.bundle, `${JSON.stringify(bundle, null, 1)}\n`, { mode: 0o600 });
  writeFileSync(setP.decisions, `${JSON.stringify(decisions, null, 1)}\n`, { mode: 0o600 });
  writeFileSync(setP.report, `${JSON.stringify(report, null, 1)}\n`, { mode: 0o600 });
  const core = { version: RECONCILIATION_ACTIVE_VERSION, workId: sources.workId, reportSha256: report.reportSha256, claimBundleSha256: report.claimBundleSha256, decisionsSha256: report.decisionsSha256, projectedRecordSha256: report.projectedRecordSha256 };
  const active = { ...core, activationSha256: sha(core) };
  writeFileSync(base.active, `${JSON.stringify(active, null, 1)}\n`, { mode: 0o600 });
  writeFileSync(join(base.activations, `${active.activationSha256}.json`), `${JSON.stringify(active, null, 1)}\n`, { mode: 0o600 });
  return { setP, base };
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true, mode: 0o700 });
  if (!existsSync(join(RUN_DIR, 'run-manifest.json'))) writeFileSync(join(RUN_DIR, 'run-manifest.json'), `${JSON.stringify({ version: 'passBRunManifest/1', runId: RUN_ID, kind: 'content-repair-canary', works: WORKS.map((w) => w.workId) }, null, 1)}\n`, { mode: 0o600 });
  const findings = loadCanonicalFindings();
  const report = [];
  for (const w of WORKS) {
    const sources = loadReconciliationSources(RUN_DIR, w.workId);
    const projected = projectToProduction(sources.b4);
    const { spans, spanMeta, transcriptSha256 } = buildSourceSpans(w.workId, sources.b2);
    const bundle = buildClaimBundle({ sources, projectedRecord: projected, sourceSpans: spans });
    const bv = validateClaimBundle(bundle); if (!bv.ok) throw new Error(`${w.name} bundle invalid: ${bv.errors.join('|')}`);
    const decisions = buildDecisionArtifact({ workId: w.workId, claimBundleSha256: sha(bundle), decisions: [], blockedFindingResolutions: [] });
    const dv = validateDecisionArtifact(decisions, bundle); if (!dv.ok) throw new Error(`${w.name} decisions invalid: ${dv.errors.join('|')}`);
    const audit = auditReconciliation(bundle, decisions); if (!audit.ok) throw new Error(`${w.name} audit failed: ${audit.errors.join('|')}`);
    const { setP } = writeReconciliationSet(sources, bundle, decisions, audit.report);
    const verify = loadAndVerifyReconciliation({ sources, projectedRecord: projected });

    // Blocked-findings enforcement on this fresh content.
    const freshDelta = freshB4Delta(w.workId);
    const rawDeltaSha256 = sha256(stableJson(freshDelta));
    const rawResponseSha256 = readCompletion(w.workId, 'B4').rawResponseSha256;
    const candidate = { workId: w.workId, rawDeltaSha256, rawResponseSha256 };
    const exact = matchFinding(findings, candidate);
    const verdict = evaluateApproval({ findings, candidate, resolution: null });
    const forWork = findingsForWork(findings, w.workId);

    // Separate bound source-span artifact.
    const spanArtifact = { version: 'passBSourceSpans/1', runId: RUN_ID, workId: w.workId, b2TranscriptSha256: transcriptSha256, spans: spanMeta };
    writeFileSync(join(OUT_DIR, `${sha256(w.workId).slice(0, 12)}.source-spans.json`), `${JSON.stringify(spanArtifact, null, 1)}\n`, { mode: 0o600 });

    // Owner-resolution TEMPLATE: review metadata only; all decisions/resolutions UNRESOLVED (empty).
    const applicableConflicts = bundle.conflicts.map((c) => ({ conflictId: c.conflictId, field: c.left?.slice ? undefined : undefined, workScope: c.workScope, componentRefs: c.componentRefs, left: c.left, right: c.right, modelStatus: c.modelStatus, ownerResolution: '' }));
    const template = {
      version: 'passBOwnerResolutionTemplate/1', workId: w.workId, claimBundleSha256: sha(bundle),
      instructions: 'All fields below begin UNRESOLVED. To release a component the owner must add explicit decisions (authority:owner) that resolve every applicable conflict, and — because this work has a sealed blocked finding — a blockedFindingResolution that truthfully resolves EVERY blocked claim, attests freshRun:true, and points at new (non-blocked) content. Do not pre-fill.',
      blockedFinding: forWork.map((f) => ({ findingId: f.findingId, blockedClaims: f.blockedClaims.map((c) => ({ claim: c, ownerResolved: false, evidence: '' })) })),
      applicableConflicts,
      openUncertainty: bundle.openClaims.map((o) => ({ openClaimId: o.openClaimId, proposition: o.proposition, ownerDisposition: '' })),
      componentsNeedingDecision: audit.report.componentReadiness.filter((c) => c.contentReadiness !== 'eligible').map((c) => ({ componentId: c.componentId, surface: c.surface, contentReadiness: c.contentReadiness, reasons: c.reasons, ownerDecision: '' })),
    };
    writeFileSync(join(base_templatePath(reconciliationPaths(sources))), `${JSON.stringify(template, null, 1)}\n`, { mode: 0o600 });

    report.push({ ...w, sources, projected, bundle, audit: audit.report, verify, spanMeta, transcriptSha256, blocked: { rawDeltaSha256, rawResponseSha256, exactDescendant: !!exact, verdict, forWork } });
    console.log(`\n=== ${w.name} (${w.workId}) ===`);
    console.log(`  contentReadiness: ${audit.report.contentReadiness}  (components: ${audit.report.componentReadiness.map((c) => c.contentReadiness).join(',')})`);
    console.log(`  reconciliation set: ${setP.setDir.replace(RUN_DIR + '/', '')}  loadAndVerify.ok=${verify.ok}${verify.ok ? '' : ' errors=' + (verify.errors || []).join('|')}`);
    console.log(`  blocked-findings: exactDescendant=${!!exact}  verdict=${verdict.allowed ? 'ALLOWED' : 'BLOCKED'} (${verdict.reason})  findingId=${verdict.findingId}`);
    console.log(`  freshDeltaSha=${rawDeltaSha256.slice(0, 12)} vs sealedDelta=${forWork[0].rawDeltaSha256.slice(0, 12)}  (recur? new delta, blocked by work)`);
    console.log(`  source spans bound: ${spanMeta.filter((s) => s.recovered).length}/${spanMeta.length} (recovered/total)`);
  }
  writeOwnerArtifact(report);
  console.log(`\nOwner review artifact: ${join(OUT_DIR, 'owner-review.html')}`);
}

function base_templatePath(base) { return join(base.templates, 'owner-resolution-template.json'); }

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function writeOwnerArtifact(report) {
  const rd = (v) => ({ eligible: '#1a7f37', 'review-required': '#b26a00', blocked: '#b3261e' }[v] || '#555');
  const sections = report.map((r) => {
    const b4 = r.sources.b4;
    const spans = r.spanMeta;
    const cr = r.audit.componentReadiness;
    const conflicts = r.bundle.conflicts;
    const blocked = r.blocked;
    const notes = (b4.notes || []).map((n) => `<li><b>${esc(n.head)}</b> <span class="role">[${esc(n.role)}]</span><br>${esc((n.body || '').slice(0, 320))}</li>`).join('');
    const guide = (b4.guide || []).map((g) => `<li><b>${esc(g.q)}</b><br>${esc((g.a || '').slice(0, 300))}</li>`).join('');
    const spanRows = spans.map((s) => `<tr><td>${esc(s.claimId)}</td><td>${esc(s.atomicClaim || '')}${s.verdict ? ` <em>(${esc(s.verdict)} ${s.confidence ?? ''})</em>` : ''}</td><td>${esc(s.sourceId)}<br><a href="${esc(s.url)}">${esc((s.title || s.url || '').slice(0, 50))}</a></td><td>${s.recovered ? `<code>${esc(s.retrievedContentSha256.slice(0, 12))}</code><br><span class="ex">${esc(s.excerpt)}</span>` : `<span class="miss">${esc(s.note)}</span>`}</td></tr>`).join('');
    const conflictRows = conflicts.map((c) => `<tr><td>${esc(c.conflictId)}${c.workScope ? ' <b>[work-scope]</b>' : ''}</td><td><b>model:</b> ${esc(c.left)}<br><b>vs:</b> ${esc(c.right)}</td><td>${esc(c.modelStatus)} → <b>unresolved</b></td></tr>`).join('');
    const crRows = cr.map((c) => `<tr><td>${esc(c.componentId)}</td><td>${esc(c.surface)}</td><td style="color:${rd(c.contentReadiness)}"><b>${esc(c.contentReadiness)}</b></td><td>${esc((c.reasons || []).join(', '))}</td></tr>`).join('');
    const blockedClaims = blocked.forWork[0].blockedClaims.map((c) => `<li>${esc(c)}</li>`).join('');
    return `<section>
      <h2>${esc(r.name)} <span class="qid">${esc(r.workId)}</span></h2>
      <div class="readiness" style="background:${rd(r.audit.contentReadiness)}">content readiness: ${esc(r.audit.contentReadiness)}</div>
      <div class="grid">
        <div class="col">
          <h3>Proposed player copy (fresh run ${esc(RUN_ID)})</h3>
          <p class="why"><b>Why:</b> ${esc((b4.proposedWhy || '').slice(0, 500)) || '<i>(none)</i>'}</p>
          <h4>Notes</h4><ul>${notes || '<li><i>none</i></li>'}</ul>
          <h4>Guide</h4><ul>${guide || '<li><i>none</i></li>'}</ul>
        </div>
        <div class="col">
          <h3>Blocked-findings enforcement</h3>
          <p class="verdict ${blocked.verdict.allowed ? 'ok' : 'bad'}">${blocked.verdict.allowed ? 'ALLOWED' : 'BLOCKED'} — ${esc(blocked.verdict.reason)} (${esc(blocked.verdict.findingId)})</p>
          <p>exact-content descendant of sealed bad delta? <b>${blocked.exactDescendant ? 'yes' : 'no (fresh, different delta)'}</b><br>
             fresh Δsha <code>${esc(blocked.rawDeltaSha256.slice(0, 16))}</code> ≠ sealed <code>${esc(blocked.forWork[0].rawDeltaSha256.slice(0, 16))}</code></p>
          <h4>Sealed blocked claims (must ALL be truthfully resolved to release)</h4><ul class="sealed">${blockedClaims}</ul>
          <h3>Owner decisions needed</h3>
          <p>Owner-resolution template written; <b>all decisions/resolutions begin empty</b>. No component is <span style="color:#1a7f37">eligible</span> under empty decisions.</p>
        </div>
      </div>
      <h3>Atomic claims ↔ bound source spans</h3>
      <table><thead><tr><th>claimId</th><th>atomic claim</th><th>source</th><th>excerpt (retrieval-hash bound)</th></tr></thead><tbody>${spanRows}</tbody></table>
      <h3>Conflicts (all unresolved) & component readiness</h3>
      <table><thead><tr><th>conflictId</th><th>model left vs right</th><th>status</th></tr></thead><tbody>${conflictRows || '<tr><td colspan=3><i>none</i></td></tr>'}</tbody></table>
      <table><thead><tr><th>component</th><th>surface</th><th>readiness</th><th>reasons</th></tr></thead><tbody>${crRows}</tbody></table>
    </section>`;
  }).join('\n');
  const html = `<!doctype html><meta charset="utf-8"><title>Content-repair canary — owner review</title>
  <style>body{font:14px/1.5 -apple-system,system-ui,sans-serif;max-width:1100px;margin:24px auto;padding:0 18px;color:#1a1a1a}
  h1{font-size:22px}h2{font-size:18px;border-top:2px solid #ddd;padding-top:16px;margin-top:28px}.qid{font:12px monospace;color:#888}
  .readiness{color:#fff;display:inline-block;padding:3px 10px;border-radius:4px;font-weight:600;margin:6px 0}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}.col h3{font-size:14px;margin:12px 0 6px}
  ul{margin:4px 0;padding-left:18px}li{margin:5px 0}.role{color:#999;font-size:12px}
  table{border-collapse:collapse;width:100%;margin:8px 0 18px;font-size:12px}th,td{border:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top}
  th{background:#f5f5f5}code{font-size:11px;color:#555}.ex{color:#444;font-style:italic}.miss{color:#b3261e}
  .verdict{padding:6px 10px;border-radius:4px;font-weight:600}.verdict.bad{background:#fde8e6;color:#b3261e}.verdict.ok{background:#e6f4ea;color:#1a7f37}
  .sealed li{color:#b3261e}.why{background:#f8f8f8;padding:8px;border-radius:4px}</style>
  <h1>Pass B content-repair canary — owner review</h1>
  <p>Run <code>${esc(RUN_ID)}</code>. Two canonical failures re-run end-to-end through the corrected contract, then reconciled with <b>empty owner decisions</b>. Nothing is production-approved. Each work carries a sealed blocked finding, so the blocked-findings layer refuses release until the owner truthfully resolves every sealed claim on a fresh, non-blocked run.</p>
  ${sections}`;
  writeFileSync(join(OUT_DIR, 'owner-review.html'), html, { mode: 0o600 });
}

main();
