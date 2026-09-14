// Guarded Pass-B approval/apply regressions (VSD-023): binding tampering, missing approval, unauthorized
// fields, invalid edited output, tampered verbatim fields, concurrent-change, partial-write prevention,
// dry-run/no-write, and a successful atomic apply. Offline; no model/network; temp fixtures only.
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256 } from '../scripts/lib/vision-legacy.mjs';
import { completionKey } from '../scripts/lib/vision-content-capture.mjs';
import { syntheticFixture } from '../scripts/lib/pass-b-calibration.mjs';
import { assembleAndValidateB4 } from '../scripts/lib/pass-b-b4-delta.mjs';
import { buildApproval, applyApproval, APPROVABLE_FIELDS } from '../scripts/lib/pass-b-approval.mjs';

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
  assert.equal(res.diff.teach.action, 'add');
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
t('unauthorized field / edit-not-approved is rejected', () => {
  const { runDir, teachPath, hotspotsPath } = makeRun();
  const a1 = { ...mkApproval(runDir, teachPath, hotspotsPath), approvedFields: ['why', 'bogus'] };
  assert.ok(applyApproval({ approval: a1, runDir, teachPath, hotspotsPath }).errors.some((e) => e === 'unauthorized-field:bogus'));
  const a2 = { ...mkApproval(runDir, teachPath, hotspotsPath), approvedFields: ['cues'], ownerEdits: { why: 'x' } };
  assert.ok(applyApproval({ approval: a2, runDir, teachPath, hotspotsPath }).errors.some((e) => e === 'edit-not-approved:why'));
});
t('invalid edited output (why over 500) is rejected before any write', () => {
  const { runDir, teachPath, hotspotsPath } = makeRun();
  const before = readFileSync(teachPath, 'utf8');
  const a = { ...mkApproval(runDir, teachPath, hotspotsPath), ownerEdits: { why: 'x'.repeat(600) } };
  const res = applyApproval({ approval: a, runDir, teachPath, hotspotsPath, apply: true });
  assert.ok(!res.ok && res.errors.some((e) => e.startsWith('invalid-edited-output')) && !res.wrote);
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

let pass = 0;
for (const { n, fn } of tests) { try { fn(); pass++; console.log('ok -', n); } catch (e) { console.error('FAIL -', n, '\n   ', e.message); process.exitCode = 1; } }
console.log(`\n${pass} checks passed`);
