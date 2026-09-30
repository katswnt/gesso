// Corrected offline staging-pilot report (NO model calls, run preserved unchanged). Replaces the invalidated
// prior verdict. It: counts ALL transcript attempts across every process execution against the immutable cap;
// REOPENS every captured completion and verifies it against its actual raw response, transcript bytes, prompt
// hash, model, apiKeySource:none, exact confined-dir image receipt, and B2 web evidence; builds a post-run
// evidence manifest over the real preserved bytes; reconciles via the CANONICAL loadReconciliationSources (real
// file hashes, no fabricated bindings); and reports SEPARATED results (containment / execution-contract /
// completion yield / automatic-eligibility yield / owner-review volume) with NO vacuous passes — zero eligible
// is reported as "publication accuracy UNMEASURED", never a pass.
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256, stableJson } from './lib/vision-legacy.mjs';
import { projectToProduction, validateProductionProjection } from './lib/pass-b-approval.mjs';
import { loadReconciliationSources, buildClaimBundle, validateClaimBundle, buildDecisionArtifact, auditReconciliation, claimBundleSha256 } from './lib/pass-b-reconciliation.mjs';
import { applyPrecedence } from './lib/pass-b-identity-precedence.mjs';
import { loadCanonicalFindings, findingsForWork } from './lib/pass-b-blocked-findings.mjs';
import { stagePrompts } from './lib/pass-b-prompts.mjs';
import { assembleAndValidateB4 } from './lib/pass-b-b4-delta.mjs';
import {
  CALIBRATION_MODEL, neutralImageFile, parseStreamTranscript, transcriptFinal, primaryModelFromEnvelope,
  verifyB1ImageRead, verifyB2WebEvents, legacyContentInput, b2InputFor, b3Plan, compactB4DeltaInput,
} from './lib/pass-b-calibration.mjs';
import { countExistingAttempts } from './pass-b-staging-pilot.mjs';

const RUN_ID = process.argv[2] || 'pilot-108acf7f9f6b';
const RUN_DIR = join('data/incoming/vision-calibration', RUN_ID);
const OUT_DIR = join(RUN_DIR, 'owner-review');
const MAX_CALLS = 45;
const prompts = stagePrompts();
const wdir = (id) => join(RUN_DIR, 'works', sha256(id).slice(0, 24));
const completionsDir = (id) => join(wdir(id), 'completions');
const attemptsDir = (id) => join(wdir(id), 'attempts');
const readB0 = (id) => { const p = join(wdir(id), 'b0-prep.json'); return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null; };
const readCompletion = (id, stage) => { const d = completionsDir(id); if (!existsSync(d)) return null; const f = readdirSync(d).find(x => x.startsWith(`${stage.toLowerCase()}-`)); return f ? { file: join(d, f), body: JSON.parse(readFileSync(join(d, f), 'utf8')) } : null; };

// Pure verdict helpers (exported for regressions). Zero auto-eligible is NEVER a pass — publication accuracy
// is simply unmeasured when nothing reaches eligibility.
export function autoEligibilityVerdict(eligibleCount) { return eligibleCount === 0 ? 'UNMEASURED' : 'MEASURED'; }
export function executionCapVerdict(attempts, maxCalls) { return attempts <= maxCalls ? 'within-cap' : 'CAP-EXCEEDED'; }
// Tamper check: a recorded transcript sha must equal the sha of the bytes on disk.
export function transcriptIntact(bytes, recordedSha256, sha256fn) { return sha256fn(bytes) === recordedSha256; }

const CANON_FALSE = {
  'wikidata:Q16467705': [/skull/i, /memento[- ]?mori/i, /vanitas/i, /transi/i, /cadaver/i, /\bwing(ed|s)?\b/i, /carved wood/i, /\bwood\b/i],
  'wikidata:Q1211814': [/\blion/i, /quadruped/i, /\banimal\b/i],
};
const MUSEUM = /(clevelandart|metmuseum|nga\.gov|artic\.edu|harvardartmuseums|parismuseescollections|nationalgallery|rijksmuseum|britishmuseum|getty|smb\.museum|khm\.at|smk\.dk|museodelprado)/i;
const tierOf = (u) => MUSEUM.test(u || '') ? 'authoritative-museum' : /wikipedia\.org|wikidata\.org/i.test(u || '') ? 'tertiary' : (u ? 'other/UGC' : 'none');

// Reconstruct the EXACT effective prompt runWorkStages sent, so promptHash can be verified independently.
function effectivePrompt(stage, { b0, b1body, b2body, imageFile }) {
  const legacyInput = legacyContentInput(b0?.legacy);
  if (stage === 'B1') return `${prompts.B1}\n\nThe working directory contains exactly one image file: ./${imageFile}\nCall the Read tool on ./${imageFile} to view the artwork, then inventory ONLY what you actually see. If Read fails or returns no image, set imageFitness.ok=false and do not invent content.`;
  if (stage === 'B2') return `${prompts.B2}\n\nCATALOG+SIGNALS:\n${JSON.stringify(b2InputFor(b0.work.id, b0.trustedCatalog, b1body))}\n\nEXISTING CONTENT:\n${JSON.stringify(legacyInput)}`;
  if (stage === 'B3') { const b3 = b3Plan(b2body); return `${prompts.B3}\n\nThe working directory contains exactly one image file: ./${imageFile}\nCall the Read tool on ./${imageFile}, then answer ONLY these targeted requests.\n\nLOCATE:\n${JSON.stringify(b3.requests)}`; }
  if (stage === 'B4') return `${prompts.B4}\n\nINPUTS:\n${JSON.stringify(compactB4DeltaInput({ b1: b1body, b2: b2body, b3: readCompletion(b0.work.id, 'B3')?.body?.body || null, legacyInput }))}`;
  return null;
}

// Find the attempt transcript whose bytes hash to the completion's recorded transcriptSha256.
function findTranscript(id, transcriptSha256) {
  const d = attemptsDir(id); if (!existsSync(d)) return null;
  for (const f of readdirSync(d)) { const p = join(d, f); const bytes = readFileSync(p, 'utf8'); if (sha256(bytes) === transcriptSha256) return { path: p, bytes }; }
  return null;
}

// Reopen a completion and verify it against actual bytes + receipts. Returns per-check booleans + overall ok.
function verifyCompletion(id, stage, comp, ctx) {
  const c = comp.body; const checks = {};
  const tr = findTranscript(id, c.transcriptSha256);
  checks.transcriptFound = !!tr;
  if (!tr) return { stage, ok: false, checks };
  checks.transcriptShaBound = sha256(tr.bytes) === c.transcriptSha256; // (tautological by lookup, but records the binding)
  const t = parseStreamTranscript(tr.bytes); const final = transcriptFinal(t);
  checks.apiKeySourceNone = t.init?.apiKeySource === 'none';
  checks.modelPinned = primaryModelFromEnvelope(final) === CALIBRATION_MODEL;
  if (stage === 'B4') {
    // B4 captures the HYDRATED body as its raw response; final.structured_output is the DELTA. Verify the
    // transcript's delta deterministically re-hydrates (via the unchanged assembler) to the stored completion.
    let asm = { ok: false }; try { asm = assembleAndValidateB4({ delta: final.structured_output, b1: ctx.b1body, b2: ctx.b2body, b3: ctx.b3body || null, legacy: ctx.b0?.legacy }); } catch { /* asm.ok stays false */ }
    checks.rawResponseMatches = asm.ok && sha256(JSON.stringify(asm.body)) === c.rawResponseSha256;
    checks.bodyIntegrity = asm.ok && typeof c.bodySha256 === 'string' && sha256(stableJson(asm.body)) === c.bodySha256 && sha256(stableJson(c.body)) === c.bodySha256;
  } else {
    checks.rawResponseMatches = !!final && typeof c.rawResponseSha256 === 'string' && sha256(JSON.stringify(final.structured_output)) === c.rawResponseSha256;
    checks.bodyIntegrity = typeof c.bodySha256 === 'string' && sha256(stableJson(c.body)) === c.bodySha256;
  }
  try { checks.promptHashMatches = c.promptHash === sha256(effectivePrompt(stage, ctx)); } catch { checks.promptHashMatches = false; }
  const imageFile = neutralImageFile(ctx.b0.image.imgSha256, ctx.b0.image.ext);
  if (stage === 'B1' || stage === 'B3') checks.imageReceipt = verifyB1ImageRead(t, { callDir: null, imageBasename: imageFile }).ok;
  if (stage === 'B2') checks.webEvidence = verifyB2WebEvents(t).ok;
  const ok = Object.values(checks).every(Boolean);
  return { stage, ok, checks };
}

function postRunEvidenceManifest(ids) {
  const files = [];
  for (const id of ids) {
    const add = (p) => { if (existsSync(p)) { const b = readFileSync(p); files.push({ path: p.replace(RUN_DIR + '/', ''), sha256: sha256(b), bytes: b.length }); } };
    add(join(wdir(id), 'b0-prep.json'));
    const cd = completionsDir(id); if (existsSync(cd)) for (const f of readdirSync(cd)) add(join(cd, f));
    const ad = attemptsDir(id); if (existsSync(ad)) for (const f of readdirSync(ad)) add(join(ad, f));
  }
  const manifest = { version: 'passBPostRunEvidence/1', generatedAfterCalls: true, note: 'Created OFFLINE, AFTER the pilot calls, over the preserved bytes. This is a post-hoc integrity index, NOT a pre-call binding and NOT an execution-time evidence manifest.', runId: RUN_ID, fileCount: files.length, files };
  manifest.manifestSha256 = sha256(stableJson(files));
  writeFileSync(join(OUT_DIR, 'post-run-evidence-manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`, { mode: 0o600 });
  return manifest;
}

function analyze(work, findings) {
  const id = work.id; const b0 = readB0(id);
  const b1 = readCompletion(id, 'B1'); const b2 = readCompletion(id, 'B2'); const b3 = readCompletion(id, 'B3'); const b4 = readCompletion(id, 'B4');
  const ctx = { b0, b1body: b1?.body?.body, b2body: b2?.body?.body, b3body: b3?.body?.body, imageFile: b0 ? neutralImageFile(b0.image.imgSha256, b0.image.ext) : null };
  const verifications = [];
  for (const [stage, comp] of [['B1', b1], ['B2', b2], ['B3', b3], ['B4', b4]]) if (comp) verifications.push(verifyCompletion(id, stage, comp, ctx));
  const allVerified = verifications.length > 0 && verifications.every(v => v.ok);
  const forWork = findingsForWork(findings, id); const blocked = forWork.length > 0;
  const complete = !!b4;
  if (!complete) return { id, label: work.label, complete: false, blocked, blockedFindingIds: forWork.map(f => f.findingId), status: work.status, verifications, allVerified, held: true };

  // Canonical reconciliation from REAL files/hashes (no fabricated sourcesFor()).
  let recon = null, projValid = null, projErrors = [], canonHits = [], disputedAxes = [], removed = [], heldPins = 0, disagreements = [], sources = [], reconError = null;
  try {
    const sr = loadReconciliationSources(RUN_DIR, id);
    const projected = projectToProduction(sr.b4);
    const pv = validateProductionProjection(projected); projValid = pv.ok; projErrors = pv.errors;
    const bundle = buildClaimBundle({ sources: sr, projectedRecord: projected, sourceSpans: [] });
    if (!validateClaimBundle(bundle).ok) throw new Error('bundle invalid');
    const rep = auditReconciliation(bundle, buildDecisionArtifact({ workId: id, claimBundleSha256: claimBundleSha256(bundle), decisions: [] })).report;
    recon = { contentReadiness: rep.contentReadiness, eligibleCount: rep.componentReadiness.filter(c => c.contentReadiness === 'eligible').length, heldCount: rep.componentReadiness.filter(c => c.contentReadiness !== 'eligible').length, components: rep.componentReadiness.map(c => ({ id: c.componentId, surface: c.surface, readiness: c.contentReadiness, reasons: c.reasons })) };
    const prec = applyPrecedence({ projected, conflicts: (sr.b4.conflicts) || [], blockedClaims: forWork.flatMap(f => f.blockedClaims) });
    disputedAxes = prec.disputedAxes; heldPins = prec.heldPins.length;
    removed = prec.disputedDiagnostic.map(x => ({ surface: x.surface, axes: x.axes, text: (x.text || '').slice(0, 100) }));
    const affirm = [prec.affirmative.teach.why || '', ...(prec.affirmative.teach.cues || []), ...(prec.affirmative.teach.notes || []).map(n => `${n.head} ${n.body}`), ...(prec.affirmative.teach.guide || []).map(g => `${g.q} ${g.a}`)].join(' • ');
    canonHits = (CANON_FALSE[id] || []).filter(re => re.test(affirm)).map(String);
    disagreements = (sr.b4.conflicts || []).map(c => ({ field: c.field, left: c.left, right: c.right, status: c.status }));
    sources = [...new Map((sr.b2?.factChecks || []).flatMap(fc => (fc.sources || []).map(s => [s.sourceId, s])).filter(Boolean)).values()].map(s => ({ sourceId: s.sourceId, url: s.url, tier: tierOf(s.url) }));
  } catch (e) { reconError = e.message; }
  return { id, label: work.label, complete: true, blocked, blockedFindingIds: forWork.map(f => f.findingId), verifications, allVerified, projValid, projErrors, canonHits, disputedAxes, removed, heldPins, disagreements, sources, recon, reconError };
}

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const pilot = existsSync(join(RUN_DIR, 'pilot.json')) ? JSON.parse(readFileSync(join(RUN_DIR, 'pilot.json'), 'utf8')) : { works: [] };
  const findings = loadCanonicalFindings();
  const rows = pilot.works.map(w => analyze(w, findings));
  const done = rows.filter(r => r.complete); const heldWorks = rows.filter(r => !r.complete);
  const attempts = countExistingAttempts(RUN_DIR);
  const manifest = postRunEvidenceManifest(rows.map(r => r.id));

  // Verification tallies over reopened bytes.
  const allChecks = rows.flatMap(r => r.verifications);
  const apiNoneAll = allChecks.every(v => v.checks.apiKeySourceNone);
  const modelAll = allChecks.every(v => v.checks.modelPinned);
  const rawAll = allChecks.every(v => v.checks.rawResponseMatches && v.checks.bodyIntegrity && v.checks.transcriptFound);
  const promptAll = allChecks.every(v => v.checks.promptHashMatches);
  const receiptAll = allChecks.every(v => (v.checks.imageReceipt !== false) && (v.checks.webEvidence !== false));
  const totalEligible = done.reduce((a, r) => a + (r.recon?.eligibleCount || 0), 0);
  const totalHeldComp = done.reduce((a, r) => a + (r.recon?.heldCount || 0), 0);
  const canonEscapes = done.reduce((a, r) => a + r.canonHits.length, 0);
  const sealedDone = done.filter(r => r.blocked);

  // SEPARATED results — each is pass | fail | UNMEASURED; no vacuous/unconditional pass.
  const results = {
    'execution-contract compliance': {
      verdict: (attempts <= MAX_CALLS && apiNoneAll && modelAll && rawAll && promptAll && receiptAll) ? 'PASS' : 'FAIL',
      detail: `call cap: ${attempts}/${MAX_CALLS} attempts across all executions ${attempts <= MAX_CALLS ? 'OK' : 'EXCEEDED (CALLS reset on resume in the run as executed)'}; apiKeySource:none ${apiNoneAll ? 'all' : 'FAIL'}; model pinned ${modelAll ? 'all' : 'FAIL'}; raw/body/transcript integrity ${rawAll ? 'all' : 'FAIL'}; promptHash reconstructed+matched ${promptAll ? 'all' : 'FAIL'}; image/web receipts ${receiptAll ? 'all' : 'FAIL'} (verified by reopening ${allChecks.length} completions)`,
    },
    'containment of known canonical failures': {
      verdict: canonEscapes === 0 && sealedDone.every(r => r.recon?.contentReadiness === 'blocked' && r.disputedAxes.length > 0) ? 'PASS' : 'FAIL',
      detail: `sealed works held: ${sealedDone.map(r => `${r.label}:${r.recon?.contentReadiness}(${r.disputedAxes.join('/')})`).join(', ') || 'none completed'}; canonical terms in any affirmative copy: ${canonEscapes}`,
    },
    'completion yield': { verdict: 'METRIC', detail: `${done.length}/${rows.length} works full B1-B4; ${heldWorks.length} held by validators: ${heldWorks.map(r => `${r.label} ${esc(JSON.stringify(r.status))}`).join('; ')}` },
    'automatic-eligibility yield (publication accuracy)': {
      verdict: autoEligibilityVerdict(totalEligible),
      detail: totalEligible === 0 ? `0 components auto-eligible under empty owner decisions → publication accuracy UNMEASURED (cannot claim zero canonical escapes into published output when nothing is eligible)` : `${totalEligible} eligible; canonical escapes among eligible: ${canonEscapes}`,
    },
    'owner-review volume': { verdict: 'METRIC', detail: `${totalHeldComp} held components across ${done.length} completed works; ${rows.filter(r => r.blocked).length} blocked works; ${heldWorks.length} held works; ${done.reduce((a, r) => a + r.disagreements.length, 0)} model conflicts; 0 eligible` },
  };

  const out = { version: 'passBStagingPilotReport/2-corrected', runId: RUN_ID, supersedes: 'the prior pilot-report pass verdict (invalid)', attemptsAcrossAllExecutions: attempts, maxCalls: MAX_CALLS, callCapExceeded: attempts > MAX_CALLS, postRunEvidenceManifestSha256: manifest.manifestSha256, results, works: rows };
  writeFileSync(join(OUT_DIR, 'pilot-report.json'), `${JSON.stringify(out, null, 1)}\n`, { mode: 0o600 });
  writeFileSync(join(OUT_DIR, 'pilot-report.html'), htmlReport(rows, results, attempts, manifest), { mode: 0o600 });

  console.log(`CORRECTED PILOT REPORT — run ${RUN_ID}`);
  console.log(`attempts across ALL executions: ${attempts}/${MAX_CALLS} ${attempts > MAX_CALLS ? '*** CAP EXCEEDED ***' : 'ok'}`);
  console.log(`completions reopened+verified: ${allChecks.length} (apiNone:${apiNoneAll} model:${modelAll} raw/body:${rawAll} promptHash:${promptAll} receipts:${receiptAll})`);
  for (const [k, v] of Object.entries(results)) console.log(`  [${v.verdict}] ${k} — ${v.detail}`);
  console.log(`\nreport: ${join(OUT_DIR, 'pilot-report.html')} + .json ; evidence: post-run-evidence-manifest.json`);
}

function htmlReport(rows, results, attempts, manifest) {
  const vClass = (v) => v === 'PASS' ? 'p' : v === 'FAIL' ? 'f' : 'w';
  const resRows = Object.entries(results).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="${vClass(v.verdict)}">${v.verdict}</td><td>${esc(v.detail)}</td></tr>`).join('');
  const sec = rows.map(r => {
    const vch = r.verifications.map(v => `<tr><td>${v.stage}</td><td class="${v.ok ? 'p' : 'f'}">${v.ok ? 'verified' : 'FAIL'}</td><td>${esc(Object.entries(v.checks).map(([k, val]) => `${k}:${val}`).join(' '))}</td></tr>`).join('');
    if (!r.complete) return `<section><h2>${esc(r.label)} <span class="qid">${esc(r.id)}</span> <span class="badge f">HELD</span></h2><p>${esc(JSON.stringify(r.status))}</p><h4>Completion verification (reopened bytes)</h4><table><tr><th>stage</th><th>ok</th><th>checks</th></tr>${vch || '<tr><td colspan=3>no completions</td></tr>'}</table></section>`;
    const comps = (r.recon?.components || []).map(c => `<tr><td>${esc(c.id)}</td><td>${esc(c.surface)}</td><td class="${c.readiness === 'eligible' ? 'p' : c.readiness === 'blocked' ? 'f' : 'w'}">${esc(c.readiness)}</td><td>${esc((c.reasons || []).join(', '))}</td></tr>`).join('');
    const src = r.sources.map(s => `<tr><td>${esc(s.sourceId)}</td><td>${esc((s.url || '').slice(0, 58))}</td><td class="${s.tier === 'authoritative-museum' ? 'p' : s.tier === 'tertiary' ? 'w' : 'f'}">${esc(s.tier)}</td></tr>`).join('');
    const dis = r.disagreements.map(d => `<li><b>${esc(d.field)}</b>: ${esc((d.left || '').slice(0, 80))} vs ${esc((d.right || '').slice(0, 80))} [${esc(d.status)}]</li>`).join('');
    const rm = r.removed.map(d => `<li><span class="axis">${esc(d.axes.join('/'))}</span> ${esc(d.surface)}: ${esc(d.text)}</li>`).join('');
    return `<section>
      <h2>${esc(r.label)} <span class="qid">${esc(r.id)}</span> ${r.blocked ? '<span class="badge f">blocked finding</span>' : ''} <span class="badge ${r.allVerified ? 'p' : 'f'}">completion ${r.allVerified ? 'verified' : 'VERIFY FAIL'}</span></h2>
      <p><span class="badge">reconciliation: ${esc(r.recon?.contentReadiness || r.reconError || '?')}</span> <span class="badge">eligible: ${r.recon?.eligibleCount ?? '?'}</span> <span class="badge">held components: ${r.recon?.heldCount ?? '?'}</span> <span class="badge ${r.projValid ? 'p' : 'f'}">projection ${r.projValid ? 'valid' : 'INVALID'}</span> <span class="badge ${r.canonHits.length ? 'f' : 'p'}">canonical in affirmative: ${r.canonHits.length}</span> <span class="badge">held pins: ${r.heldPins}</span></p>
      <h4>Completion verification (reopened transcript bytes)</h4><table><tr><th>stage</th><th>ok</th><th>checks</th></tr>${vch}</table>
      <div class="grid"><div><h4>Disagreements (identity/role/medium/iconography)</h4><ul>${dis || '<li><i>none</i></li>'}</ul>
      <h4>Removed from affirmative (disputed axes: ${esc(r.disputedAxes.join(', ') || 'none')})</h4><ul class="rm">${rm || '<li><i>none</i></li>'}</ul></div>
      <div><h4>Source support &amp; tier</h4><table><tr><th>id</th><th>url</th><th>tier</th></tr>${src || '<tr><td colspan=3><i>none</i></td></tr>'}</table></div></div>
      <h4>Component readiness (empty owner decisions)</h4><table><tr><th>component</th><th>surface</th><th>readiness</th><th>reasons</th></tr>${comps}</table>
    </section>`;
  }).join('\n');
  return `<!doctype html><meta charset="utf-8"><title>Pass B staging pilot — corrected report</title>
  <style>body{font:14px/1.5 -apple-system,system-ui,sans-serif;max-width:1180px;margin:22px auto;padding:0 18px;color:#1a1a1a}
  h1{font-size:22px}h2{font-size:17px;border-top:2px solid #ddd;padding-top:14px;margin-top:24px}.qid{font:11px monospace;color:#888}
  h4{font-size:12px;margin:9px 0 3px;color:#444}ul{margin:3px 0;padding-left:18px}li{margin:4px 0}
  table{border-collapse:collapse;width:100%;font-size:12px;margin:6px 0 12px}th,td{border:1px solid #ddd;padding:5px 7px;text-align:left;vertical-align:top}th{background:#f5f5f5}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.p{color:#1a7f37;font-weight:600}.f{color:#b3261e;font-weight:600}.w{color:#b26a00;font-weight:600}
  .badge{display:inline-block;background:#eef;border-radius:3px;padding:1px 7px;margin:2px 3px;font-size:11px}.badge.p{background:#e6f4ea}.badge.f{background:#fde8e6}
  .axis{font:11px monospace;background:#fde8e6;color:#b3261e;padding:1px 4px;border-radius:3px}.rm li{color:#b3261e}</style>
  <h1>Pass B staging pilot — corrected report (supersedes prior pass verdict)</h1>
  <p>Run <code>${esc(RUN_ID)}</code>. The prior verdict is <b>invalid</b>. Corrected offline from preserved bytes: no model calls, run unchanged. <b>Call cap: ${attempts}/${MAX_CALLS} attempts across ALL process executions — ${attempts > MAX_CALLS ? '<span class="f">EXCEEDED</span> (CALLS reset on each resume in the run as executed; the harness is now fixed to count run-wide)' : 'ok'}.</b> Every completion was reopened and verified against actual raw response, transcript bytes, prompt hash, model, apiKeySource:none, exact image receipt, and B2 web evidence. Reconciliation uses the canonical verifier over real file hashes. Post-run evidence manifest: <code>${esc(manifest.manifestSha256.slice(0, 16))}</code> (${manifest.fileCount} files, generated AFTER the calls — not a pre-call binding).</p>
  <h2 style="border:0">Separated results — no vacuous passes</h2>
  <table><tr><th>result</th><th>verdict</th><th>detail</th></tr>${resRows}</table>
  ${sec}`;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
