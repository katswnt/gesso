// Guarded Pass-B approval/apply regressions (VSD-023): binding tampering, missing approval, unauthorized
// fields, invalid edited output, tampered verbatim fields, concurrent-change, partial-write prevention,
// dry-run/no-write, and a successful atomic apply. Offline; no model/network; temp fixtures only.
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync, readdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256, stableJson } from '../scripts/lib/vision-legacy.mjs';
import { completionKey } from '../scripts/lib/vision-content-capture.mjs';
import { syntheticFixture } from '../scripts/lib/pass-b-calibration.mjs';
import { assembleAndValidateB4 } from '../scripts/lib/pass-b-b4-delta.mjs';
import { buildApproval, applyApproval, projectToProduction, validateProductionProjection, surfaceCouplingViolation, APPROVABLE_FIELDS, APPROVAL_VERSION } from '../scripts/lib/pass-b-approval.mjs';
import {
  loadReconciliationSources, buildClaimBundle, buildDecisionArtifact, auditReconciliation,
  claimBundleSha256, reconciliationPaths, reconciliationSetPaths, buildReconciliationActivation,
} from '../scripts/lib/pass-b-reconciliation.mjs';

const tests = []; const t = (n, fn) => tests.push({ n, fn });
const SHA = 'a'.repeat(64);
const fx = syntheticFixture();
const id = fx.workId;
const assembled = assembleAndValidateB4({ delta: fx.bodies.B4Delta, b1: fx.bodies.B1, b2: fx.bodies.B2, b3: fx.bodies.B3, legacy: { teaching: {} } });
assert.ok(assembled.ok, 'fixture B4 assembles');
const b4body = assembled.body;

const sj = (evs) => evs.map((e) => JSON.stringify(e)).join('\n') + '\n';
const b4txFor = (delta) => sj([
  { type: 'system', subtype: 'init', apiKeySource: 'none', claude_code_version: '2.1.259', model: 'claude-sonnet-4-6' },
  { type: 'result', subtype: 'success', is_error: false, structured_output: delta, modelUsage: { 'claude-sonnet-4-6': { output_tokens: 100 } }, num_turns: 1 },
]);
const b4transcript = b4txFor(fx.bodies.B4Delta);
const tsha = sha256(b4transcript);

function writeReconciliation(runDir, workId) {
  const sources = loadReconciliationSources(runDir, workId);
  const bundle = buildClaimBundle({ sources, projectedRecord: projectToProduction(sources.b4, {}) });
  const decisions = buildDecisionArtifact({
    workId, claimBundleSha256: claimBundleSha256(bundle),
    decisions: bundle.components.map((c, i) => ({ decisionId: `test-owner-${i}`, targetKind: 'component', targetId: c.componentId, effectiveState: 'accepted', authority: 'owner', artifactRef: 'test-owner-review', supersedesDecisionId: null })),
  });
  const audited = auditReconciliation(bundle, decisions); assert.ok(audited.ok, 'fixture reconciliation audits');
  const base = reconciliationPaths(sources); const set = reconciliationSetPaths(sources, audited.report.reportSha256);
  mkdirSync(set.setDir, { recursive: true });
  writeFileSync(set.bundle, `${JSON.stringify(bundle, null, 2)}\n`);
  writeFileSync(set.decisions, `${JSON.stringify(decisions, null, 2)}\n`);
  writeFileSync(set.report, `${JSON.stringify(audited.report, null, 2)}\n`);
  const activation = buildReconciliationActivation(audited.report);
  mkdirSync(base.activations, { recursive: true });
  writeFileSync(join(base.activations, `${activation.activationSha256}.json`), `${JSON.stringify(activation, null, 2)}\n`);
  writeFileSync(base.active, `${JSON.stringify(activation, null, 2)}\n`);
}
function activeReconciliationPaths(runDir, workId) {
  const sources = loadReconciliationSources(runDir, workId); const base = reconciliationPaths(sources);
  const active = JSON.parse(readFileSync(base.active, 'utf8'));
  return reconciliationSetPaths(sources, active.reportSha256);
}

function makeRun({ delta = fx.bodies.B4Delta } = {}) {
  const asm = assembleAndValidateB4({ delta, b1: fx.bodies.B1, b2: fx.bodies.B2, b3: fx.bodies.B3, legacy: { teaching: {} } });
  const body = asm.ok ? asm.body : b4body;
  const transcript = b4txFor(delta);
  const localTsha = sha256(transcript);
  const runDir = realpathSync(mkdtempSync(join(tmpdir(), 'passb-appr-')));
  const wdir = join(runDir, 'works', sha256(id).slice(0, 24));
  mkdirSync(join(wdir, 'completions'), { recursive: true });
  mkdirSync(join(wdir, 'attempts'), { recursive: true });
  writeFileSync(join(runDir, 'run-manifest.json'), JSON.stringify({ runId: 'run-x', selection: [{ id }] }));
  writeFileSync(join(wdir, 'b0-prep.json'), JSON.stringify({ image: { imgSha256: SHA, ext: 'jpg' }, legacy: { teaching: {} } }));
  for (const s of ['B1', 'B2', 'B3']) writeFileSync(join(wdir, 'completions', `${s.toLowerCase()}-${completionKey(s, id)}.json`), JSON.stringify({ body: fx.bodies[s] }));
  writeFileSync(join(wdir, 'completions', `b4-${completionKey('B4', id)}.json`), JSON.stringify({ workId: id, imgSha256: SHA, transcriptSha256: localTsha, body }));
  writeFileSync(join(wdir, 'attempts', 'b4-fixture.transcript.jsonl'), transcript);
  const teachPath = join(runDir, 'teach-works.js');
  const hotspotsPath = join(runDir, 'hotspots.js');
  writeFileSync(teachPath, 'window.ARTEFACTUM_CUES=window.ARTEFACTUM_CUES||{};\nwindow.ARTEFACTUM_CUES.work={};\n');
  writeFileSync(hotspotsPath, 'window.ARTEFACTUM_HOTSPOTS = {};\n');
  // Reconciliation is mandatory under passBApproval/2. The fixture uses explicit owner component decisions
  // so approval tests exercise the guarded sink rather than bypassing content readiness.
  writeReconciliation(runDir, id);
  return { runDir, teachPath, hotspotsPath };
}
const mkApproval = (runDir, teachPath, hotspotsPath, over = {}) => {
  const a = buildApproval({ runDir, workId: id, approvedFields: APPROVABLE_FIELDS.slice(), ownerEdits: {}, teachPath, hotspotsPath });
  return { ...a, ownerApproved: true, ...over };
};

t('dry-run (approved) writes NOTHING and returns a diff', () => {
  const { runDir, teachPath, hotspotsPath } = makeRun();
  const before = readFileSync(teachPath, 'utf8');
  const res = applyApproval({ approval: mkApproval(runDir, teachPath, hotspotsPath), runDir, teachPath, hotspotsPath, apply: false });
  assert.ok(res.ok && res.dryRun && !res.wrote, 'dry-run ok, no write');
  assert.equal(readFileSync(teachPath, 'utf8'), before, 'teach file byte-identical after dry-run');
  assert.equal(res.diff.teach.action, 'add-approved-fields');
});
t('derived offline B4 approval binds repaired body plus upstream ancestry', () => {
  const upstream = makeRun();
  const sourceRun = join(upstream.runDir, 'source-b4'); const derivedRun = join(upstream.runDir, 'derived-b4');
  mkdirSync(join(sourceRun, 'works'), { recursive: true }); mkdirSync(join(derivedRun, 'works'), { recursive: true });
  writeFileSync(join(sourceRun, 'run-manifest.json'), `${JSON.stringify({ runId: 'source-run' }, null, 2)}\n`);
  const safe = id.replace(/[^a-z0-9]+/gi, '_');
  const sourceTx = 'derived approval source transcript\n';
  writeFileSync(join(sourceRun, 'works', `${safe}.transcript.jsonl`), sourceTx);
  const sourceRecord = { id, ok: true, evidence: { transcriptSha256: sha256(sourceTx), apiKeySource: 'none' }, rawDelta: fx.bodies.B4Delta, body: b4body };
  const sourcePath = join(sourceRun, 'works', `${safe}.b4.json`);
  const sourceRaw = `${JSON.stringify(sourceRecord, null, 2)}\n`; writeFileSync(sourcePath, sourceRaw);
  const upWork = join(upstream.runDir, 'works', sha256(id).slice(0, 24));
  const hashFile = p => sha256(readFileSync(p, 'utf8'));
  const evidencePaths = [
    join(sourceRun, 'run-manifest.json'), join(upstream.runDir, 'run-manifest.json'),
    join(upWork, 'b0-prep.json'),
    ...['B1', 'B2', 'B3'].map(s => join(upWork, 'completions', `${s.toLowerCase()}-${completionKey(s, id)}.json`)),
    sourcePath, join(sourceRun, 'works', `${safe}.transcript.jsonl`),
  ];
  const files = evidencePaths.map(path => { const raw = readFileSync(path, 'utf8'); return { path, bytes: Buffer.byteLength(raw), sha256: sha256(raw) }; });
  const evidenceManifestSha256 = sha256(stableJson(files));
  writeFileSync(join(derivedRun, 'run-manifest.json'), `${JSON.stringify({ runId: 'derived-run', sourceRun, upstreamRun: upstream.runDir, evidenceManifestSha256 }, null, 2)}\n`);
  writeFileSync(join(derivedRun, 'evidence-manifest.json'), `${JSON.stringify({ evidenceManifestSha256, files }, null, 2)}\n`);
  const derivedRecord = {
    id, ok: true, derivedOffline: true, evidence: sourceRecord.evidence, rawDelta: fx.bodies.B4Delta, body: b4body,
    source: {
      b4RecordSha256: sha256(sourceRaw), b0PrepSha256: hashFile(join(upWork, 'b0-prep.json')),
      B1CompletionSha256: hashFile(join(upWork, 'completions', `b1-${completionKey('B1', id)}.json`)),
      B2CompletionSha256: hashFile(join(upWork, 'completions', `b2-${completionKey('B2', id)}.json`)),
      B3CompletionSha256: hashFile(join(upWork, 'completions', `b3-${completionKey('B3', id)}.json`)),
    },
  };
  writeFileSync(join(derivedRun, 'works', `${safe}.b4.json`), `${JSON.stringify(derivedRecord, null, 2)}\n`);
  writeReconciliation(derivedRun, id);
  const approval = { ...buildApproval({ runDir: derivedRun, workId: id, teachPath: upstream.teachPath, hotspotsPath: upstream.hotspotsPath }), ownerApproved: true };
  const res = applyApproval({ approval, runDir: derivedRun, teachPath: upstream.teachPath, hotspotsPath: upstream.hotspotsPath, apply: false });
  assert.ok(res.ok && res.dryRun && approval.runId === 'derived-run', 'derived approval verifies and remains dry');
  const b1Path = join(upWork, 'completions', `b1-${completionKey('B1', id)}.json`);
  const originalB1 = readFileSync(b1Path, 'utf8'); const changedB1 = JSON.parse(originalB1);
  changedB1.body.seen = 'fabricated observation'; writeFileSync(b1Path, JSON.stringify(changedB1));
  const ancestryForged = JSON.parse(readFileSync(join(derivedRun, 'works', `${safe}.b4.json`), 'utf8'));
  ancestryForged.source.B1CompletionSha256 = hashFile(b1Path);
  writeFileSync(join(derivedRun, 'works', `${safe}.b4.json`), `${JSON.stringify(ancestryForged, null, 2)}\n`);
  assert.throws(() => buildApproval({ runDir: derivedRun, workId: id, teachPath: upstream.teachPath, hotspotsPath: upstream.hotspotsPath }), /B1 is absent from or disagrees with evidence manifest/);
  writeFileSync(b1Path, originalB1); writeFileSync(join(derivedRun, 'works', `${safe}.b4.json`), `${JSON.stringify(derivedRecord, null, 2)}\n`);
  const tampered = JSON.parse(readFileSync(join(derivedRun, 'works', `${safe}.b4.json`), 'utf8'));
  tampered.body.proposedWhy = 'tampered body that did not come from the preserved delta';
  writeFileSync(join(derivedRun, 'works', `${safe}.b4.json`), `${JSON.stringify(tampered, null, 2)}\n`);
  assert.throws(() => buildApproval({ runDir: derivedRun, workId: id, teachPath: upstream.teachPath, hotspotsPath: upstream.hotspotsPath }), /deterministic rehydration mismatch/);
});
t('missing owner approval is rejected (never inferred), even with apply', () => {
  const { runDir, teachPath, hotspotsPath } = makeRun();
  const a = { ...mkApproval(runDir, teachPath, hotspotsPath), ownerApproved: false };
  const res = applyApproval({ approval: a, runDir, teachPath, hotspotsPath, apply: true });
  assert.ok(!res.ok && res.errors.includes('missing-owner-approval'));
  assert.ok(!res.wrote);
});
t('binding tampering (wrong completion SHA) is rejected', () => {
  const { runDir, teachPath, hotspotsPath } = makeRun();
  const a = { ...mkApproval(runDir, teachPath, hotspotsPath), b4CompletionSha256: 'f'.repeat(64) };
  const res = applyApproval({ approval: a, runDir, teachPath, hotspotsPath, apply: true });
  assert.ok(!res.ok && res.errors.some((e) => e === 'binding:completion-sha') && !res.wrote);
});
t('missing reconciliation artifact fails closed before approval can be staged', () => {
  const { runDir, teachPath, hotspotsPath } = makeRun();
  unlinkSync(activeReconciliationPaths(runDir, id).report);
  assert.throws(() => buildApproval({ runDir, workId: id, approvedFields: APPROVABLE_FIELDS.slice(), ownerEdits: {}, teachPath, hotspotsPath }), /reconciliation-invalid.*artifact missing/);
});
t('missing activation-history record fails closed before approval can be staged', () => {
  const { runDir, teachPath, hotspotsPath } = makeRun();
  const sources = loadReconciliationSources(runDir, id); const base = reconciliationPaths(sources);
  const active = JSON.parse(readFileSync(base.active, 'utf8'));
  unlinkSync(join(base.activations, `${active.activationSha256}.json`));
  assert.throws(() => buildApproval({ runDir, workId: id, approvedFields: APPROVABLE_FIELDS.slice(), ownerEdits: {}, teachPath, hotspotsPath }), /activation history missing/);
});
t('reconciliation decision tampering fails closed at apply', () => {
  const { runDir, teachPath, hotspotsPath } = makeRun();
  const a = mkApproval(runDir, teachPath, hotspotsPath);
  const decisionsPath = activeReconciliationPaths(runDir, id).decisions;
  const decisions = JSON.parse(readFileSync(decisionsPath, 'utf8'));
  decisions.decisions[0].effectiveState = 'rejected';
  writeFileSync(decisionsPath, `${JSON.stringify(decisions, null, 2)}\n`);
  const res = applyApproval({ approval: a, runDir, teachPath, hotspotsPath, apply: true });
  assert.ok(!res.ok && res.errors.some((e) => e.startsWith('reconciliation-invalid')) && !res.wrote);
});
t('switching to a newer immutable reconciliation set invalidates an older approval', () => {
  const { runDir, teachPath, hotspotsPath } = makeRun();
  const approval = mkApproval(runDir, teachPath, hotspotsPath);
  const sources = loadReconciliationSources(runDir, id); const oldSet = activeReconciliationPaths(runDir, id);
  const bundle = JSON.parse(readFileSync(oldSet.bundle, 'utf8'));
  const decisions = JSON.parse(readFileSync(oldSet.decisions, 'utf8'));
  const first = decisions.decisions[0];
  decisions.decisions.push({ ...first, decisionId: 'new-owner-rejection', effectiveState: 'rejected', artifactRef: 'new-owner-review', supersedesDecisionId: first.decisionId });
  const audited = auditReconciliation(bundle, decisions); assert.ok(audited.ok);
  const nextSet = reconciliationSetPaths(sources, audited.report.reportSha256); mkdirSync(nextSet.setDir, { recursive: true });
  writeFileSync(nextSet.bundle, `${JSON.stringify(bundle, null, 2)}\n`); writeFileSync(nextSet.decisions, `${JSON.stringify(decisions, null, 2)}\n`); writeFileSync(nextSet.report, `${JSON.stringify(audited.report, null, 2)}\n`);
  const nextActivation = buildReconciliationActivation(audited.report); const base = reconciliationPaths(sources);
  mkdirSync(base.activations, { recursive: true });
  writeFileSync(join(base.activations, `${nextActivation.activationSha256}.json`), `${JSON.stringify(nextActivation, null, 2)}\n`);
  writeFileSync(base.active, `${JSON.stringify(nextActivation, null, 2)}\n`);
  const res = applyApproval({ approval, runDir, teachPath, hotspotsPath, apply: true });
  assert.ok(!res.ok && res.errors.includes('binding:reconciliation') && !res.wrote);
});
t('unauthorized field / edit-not-approved is rejected', () => {
  const { runDir, teachPath, hotspotsPath } = makeRun();
  const a1 = { ...mkApproval(runDir, teachPath, hotspotsPath), approvedFields: ['why', 'bogus'] };
  assert.ok(applyApproval({ approval: a1, runDir, teachPath, hotspotsPath }).errors.some((e) => e === 'unauthorized-field:bogus'));
  const a2 = { ...mkApproval(runDir, teachPath, hotspotsPath), approvedFields: ['cues'], ownerEdits: { why: 'x' } };
  assert.ok(applyApproval({ approval: a2, runDir, teachPath, hotspotsPath }).errors.some((e) => e === 'edit-not-approved:why'));
  const a3 = { ...mkApproval(runDir, teachPath, hotspotsPath), approvedFields: [] };
  assert.ok(applyApproval({ approval: a3, runDir, teachPath, hotspotsPath }).errors.includes('invalid-approved-fields'));
  const a4 = { ...mkApproval(runDir, teachPath, hotspotsPath), approvedFields: ['why', 'why'] };
  assert.ok(applyApproval({ approval: a4, runDir, teachPath, hotspotsPath }).errors.includes('invalid-approved-fields'));
});
t('partial field approval preserves every unapproved production surface', () => {
  const { runDir, teachPath, hotspotsPath } = makeRun();
  const oldTeach = { why: 'old why', cues: ['old cue'], guide: [{ q: 'old q', a: 'old a' }], notes: [{ head: 'old', body: 'old body', x: null, y: null }] };
  const oldHotspots = [{ n: 99, x: 1, y: 2 }];
  writeFileSync(teachPath, `window.ARTEFACTUM_CUES=window.ARTEFACTUM_CUES||{};\nwindow.ARTEFACTUM_CUES.work=${JSON.stringify({ [id]: oldTeach })};\n`);
  writeFileSync(hotspotsPath, `window.ARTEFACTUM_HOTSPOTS = ${JSON.stringify({ [id]: oldHotspots })};\n`);
  const approval = buildApproval({ runDir, workId: id, approvedFields: ['why'], ownerEdits: {}, teachPath, hotspotsPath });
  approval.ownerApproved = true;
  const res = applyApproval({ approval, runDir, teachPath, hotspotsPath, apply: true });
  assert.ok(res.ok && res.wrote);
  const teach = {}; new Function('window', readFileSync(teachPath, 'utf8'))(teach);
  assert.notEqual(teach.ARTEFACTUM_CUES.work[id].why, oldTeach.why, 'approved why changed');
  assert.deepEqual(teach.ARTEFACTUM_CUES.work[id].cues, oldTeach.cues, 'unapproved cues preserved');
  assert.deepEqual(teach.ARTEFACTUM_CUES.work[id].guide, oldTeach.guide, 'unapproved guide preserved');
  assert.deepEqual(teach.ARTEFACTUM_CUES.work[id].notes, oldTeach.notes, 'unapproved notes preserved');
  const hs = {}; new Function('window', readFileSync(hotspotsPath, 'utf8'))(hs);
  assert.deepEqual(hs.ARTEFACTUM_HOTSPOTS[id], oldHotspots, 'unapproved hotspots preserved');
});
t('edited output not bound by reconciliation is rejected before any write', () => {
  const { runDir, teachPath, hotspotsPath } = makeRun();
  const before = readFileSync(teachPath, 'utf8');
  const a = { ...mkApproval(runDir, teachPath, hotspotsPath), ownerEdits: { why: 'x'.repeat(600) } };
  const res = applyApproval({ approval: a, runDir, teachPath, hotspotsPath, apply: true });
  assert.ok(!res.ok && res.errors.some((e) => e.startsWith('reconciliation-invalid')) && !res.wrote);
  assert.equal(readFileSync(teachPath, 'utf8'), before, 'no write on invalid output');
});
t('tampered verbatim field (approvedRecord mutated) is rejected', () => {
  const { runDir, teachPath, hotspotsPath } = makeRun();
  const a = mkApproval(runDir, teachPath, hotspotsPath);
  a.approvedRecord.teach.cues = [...(a.approvedRecord.teach.cues || []), 'INJECTED CUE'];
  const res = applyApproval({ approval: a, runDir, teachPath, hotspotsPath, apply: true });
  assert.ok(!res.ok && res.errors.some((e) => e === 'tampered:cues') && !res.wrote);
});
t('concurrent-change detection: teach file changed after approval built', () => {
  const { runDir, teachPath, hotspotsPath } = makeRun();
  const a = mkApproval(runDir, teachPath, hotspotsPath);
  writeFileSync(teachPath, readFileSync(teachPath, 'utf8') + '\n// changed elsewhere\n');
  const res = applyApproval({ approval: a, runDir, teachPath, hotspotsPath, apply: true });
  assert.ok(!res.ok && res.errors.some((e) => e === 'concurrent-change:teach') && !res.wrote);
});
t('partial-write prevention: a rejected apply leaves BOTH files byte-identical', () => {
  const { runDir, teachPath, hotspotsPath } = makeRun();
  const tb = readFileSync(teachPath, 'utf8'); const hb = readFileSync(hotspotsPath, 'utf8');
  const a = { ...mkApproval(runDir, teachPath, hotspotsPath), b4CompletionSha256: 'f'.repeat(64) };
  applyApproval({ approval: a, runDir, teachPath, hotspotsPath, apply: true });
  assert.equal(readFileSync(teachPath, 'utf8'), tb); assert.equal(readFileSync(hotspotsPath, 'utf8'), hb);
});
t('successful atomic apply inserts the one entry, preserves the rest, leaves no temp file', () => {
  const { runDir, teachPath, hotspotsPath } = makeRun();
  const res = applyApproval({ approval: mkApproval(runDir, teachPath, hotspotsPath), runDir, teachPath, hotspotsPath, apply: true });
  assert.ok(res.ok && res.wrote);
  const teach = {}; new Function('window', readFileSync(teachPath, 'utf8'))(teach);
  assert.ok(teach.ARTEFACTUM_CUES.work[id], 'entry inserted');
  assert.ok('why' in teach.ARTEFACTUM_CUES.work[id] && Array.isArray(teach.ARTEFACTUM_CUES.work[id].cues), 'entry has why+cues');
  const hs = {}; new Function('window', readFileSync(hotspotsPath, 'utf8'))(hs);
  assert.ok(Array.isArray(hs.ARTEFACTUM_HOTSPOTS[id]), 'hotspots entry inserted');
  assert.ok(!existsSync(`${teachPath}.tmp-approve`) && !existsSync(`${hotspotsPath}.tmp-approve`), 'no temp file left');
  assert.ok(readdirSync(join(runDir, 'works', sha256(id).slice(0, 24), 'completions')).length === 4, 'quarantined completions untouched');
});

t('leaky player copy is rejected by the guarded merge (player-copy-leak), nothing written', () => {
  const delta = JSON.parse(JSON.stringify(fx.bodies.B4Delta));
  const note = (delta.notes || []).find((n) => n.action !== 'keep' && n.action !== 'remove');
  assert.ok(note, 'fixture delta has an editable note');
  note.body = 'B3 visual verification confirms the diagonal baseline is present.';
  const { runDir, teachPath, hotspotsPath } = makeRun({ delta });
  const before = readFileSync(teachPath, 'utf8');
  const res = applyApproval({ approval: mkApproval(runDir, teachPath, hotspotsPath), runDir, teachPath, hotspotsPath, apply: true });
  assert.ok(!res.ok && res.errors.some((e) => e.startsWith('player-copy-leak')) && !res.wrote, 'leaky copy rejected');
  assert.equal(readFileSync(teachPath, 'utf8'), before, 'no write on leak');
});

// VSD-037 one-way coupling: notes-without-hotspots rejected; hotspots-only allowed; both allowed.
t('surfaceCouplingViolation is one-way (notes→hotspots)', () => {
  assert.strictEqual(surfaceCouplingViolation(['notes']), 'notes-approval-requires-hotspots');
  assert.strictEqual(surfaceCouplingViolation(['notes', 'hotspots']), null);
  assert.strictEqual(surfaceCouplingViolation(['hotspots']), null); // coordinate-only review allowed
  assert.strictEqual(surfaceCouplingViolation(['why', 'cues', 'guide']), null);
});
t('buildApproval rejects notes without hotspots (early, before disk)', () => {
  assert.throws(() => buildApproval({ runDir: '/nonexistent', workId: 'wikidata:Q1', approvedFields: ['notes'], teachPath: 'x', hotspotsPath: 'y' }), /notes-approval-requires-hotspots/);
});
t('applyApproval rejects notes without hotspots', () => {
  const r = applyApproval({ approval: { version: APPROVAL_VERSION, ownerApproved: true, approvedFields: ['notes'], ownerEdits: {} }, runDir: '/nonexistent', teachPath: 'x', hotspotsPath: 'y', apply: false });
  assert.ok(!r.ok && /notes-approval-requires-hotspots/.test((r.errors || []).join('|')), 'coupling rejection expected');
});
t('validateProductionProjection catches malformed / out-of-range / orphan / duplicate hotspots and bad shapes', () => {
  const base = { teach: { why: 'w', cues: ['c'], guide: [{ q: 'q', a: 'a' }], notes: [{ head: 'h', body: 'b', x: null, y: null }] } };
  assert.ok(validateProductionProjection({ ...base, hotspots: [] }).ok, 'empty hotspots is a valid shape');
  assert.ok(validateProductionProjection({ ...base, hotspots: [{ n: 1, x: 10, y: 20 }] }).ok, 'valid hotspot referencing note 1');
  assert.ok(!validateProductionProjection({ ...base, hotspots: [{ n: 1, x: 120, y: 20 }] }).ok, 'out-of-range coordinate rejected');
  assert.ok(!validateProductionProjection({ ...base, hotspots: [{ n: 2, x: 10, y: 20 }] }).ok, 'orphan rank (no such note) rejected');
  assert.ok(!validateProductionProjection({ ...base, hotspots: [{ n: 1.5, x: 10, y: 20 }] }).ok, 'non-integer rank rejected');
  assert.ok(!validateProductionProjection({ ...base, hotspots: [{ n: 1, x: 10, y: 20 }, { n: 1, x: 5, y: 5 }] }).ok, 'duplicate rank rejected');
  assert.ok(!validateProductionProjection({ teach: { why: 5, cues: [], guide: [], notes: [] }, hotspots: [] }).ok, 'non-string why rejected');
  assert.ok(!validateProductionProjection({ teach: { why: 'w', cues: [1], guide: [], notes: [] }, hotspots: [] }).ok, 'non-string cue rejected');
  assert.ok(!validateProductionProjection({ teach: { why: 'w', cues: [], guide: [], notes: [{ head: 'h', body: 'b', x: 150, y: 0 }] }, hotspots: [] }).ok, 'note coord out of range rejected');
});

let pass = 0;
for (const { n, fn } of tests) { try { fn(); pass++; console.log('ok -', n); } catch (e) { console.error('FAIL -', n, '\n   ', e.message); process.exitCode = 1; } }
console.log(`\n${pass} checks passed`);
