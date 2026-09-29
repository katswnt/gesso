// Judgment-only pairs: anchors, spacing-fixed extraction, controller, scoring, one-reservation runner. Offline.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sha256, stableJson } from '../scripts/lib/vision-legacy.mjs';
import { CALIBRATION_MODEL, RUN_ROOT } from '../scripts/lib/pass-b-calibration.mjs';
import { extractText, extractTextV2 } from '../scripts/pass-b-audit-evidence.mjs';
import { JUDGMENT_VERSION, extractPassage, buildJudgmentInput, controlJudgment, scoreJudgment } from '../scripts/lib/pass-b-audit-judgment.mjs';
import { deriveAuditAttempt, runAudit, auditHistory, planJudgment, auditBinding, auditRunId } from '../scripts/pass-b-shadow-audit.mjs';

let n = 0; const check = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error(`FAIL ${name}`); throw e; } };
await check('passBSourceText/2 removes tag-induced spaces before punctuation; /1 unchanged', () => {
  const html = '<p>the <a>British Museum</a>, where "<i>Theses</i>" (<b>1940</b>).</p>';
  assert.equal(extractText(html), 'the British Museum , where " Theses " ( 1940 ).');
  assert.equal(extractTextV2(html), 'the British Museum, where "Theses" (1940).');
});
await check('passages come from unique anchors, or fail closed', () => {
  assert.equal(extractPassage('a. The jewel is X. b.', 'The jewel', 'X.'), 'The jewel is X.');
  assert.throws(() => extractPassage('abc', 'zz', 'c'), /anchor not found/);
  assert.throws(() => extractPassage('The a. The b.', 'The', '.'), /not unique/);
  assert.throws(() => extractPassage('The a', 'The', 'zz'), /end anchor/);
});
const spec = { pairs: [
  { id: 'P1', claim: 'X is asleep.', evidence: [{ ref: 'E1', url: 'u' }, { ref: 'E2', authoritative: 'f#s' }], accept: ['supported'], case: 'hidden case', basis: 'hidden basis' },
  { id: 'P2', claim: 'Y has wings.', evidence: [{ ref: 'E1', url: 'u' }], accept: ['unsupported', 'contradicted'] }] };
spec.pairs[0].evidence[0].start = 'X'; spec.pairs[0].evidence[0].end = 'asleep.'; spec.pairs[1].evidence[0].start = 'Y'; spec.pairs[1].evidence[0].end = 'nude.';
const resolve = { snapshotText: () => ({ text: 'X is asleep. Y is nude.', textSha256: 't', extraction: 'passBSourceText/2' }), authoritative: () => ({ text: 'sommeil', sha: 'f' }) };
const { input } = buildJudgmentInput(spec, resolve);
await check('the input carries ids, claims and evidence only (no case, basis or expected verdicts)', () => {
  assert.deepEqual(input.pairs[0], { id: 'P1', claim: 'X is asleep.', evidence: [{ ref: 'E1', text: 'X is asleep.' }, { ref: 'E2', text: 'sommeil' }] });
  const s = JSON.stringify(input); for (const bad of ['hidden', 'accept', 'unsupported']) assert.ok(!s.includes(bad));
});
await check('controller flags unknown refs, verdicts without refs, missing and duplicate pairs; scoring uses accept sets', () => {
  const r = controlJudgment({ v: JUDGMENT_VERSION, j: [{ id: 'P1', verdict: 'supported', ref: 'E9', reason: 'r' }, { id: 'P1', verdict: 'supported', ref: 'E1', reason: 'r' }, { id: 'P9', verdict: 'supported', ref: 'E1', reason: 'r' }] }, input);
  assert.ok(r.errors.some(e => /duplicate/.test(e)) && r.errors.some(e => /unknown pair/.test(e)));
  assert.deepEqual(r.rows[0].issues, ['unknown ref E9']); assert.deepEqual(r.rows[1].issues, ['missing']);
  const ok = controlJudgment({ v: JUDGMENT_VERSION, j: [{ id: 'P1', verdict: 'supported', ref: 'E1', reason: 'states it' }, { id: 'P2', verdict: 'contradicted', ref: 'none', reason: 'x' }] }, input);
  assert.deepEqual(ok.rows[1].issues, ['contradicted without a ref']);
  const sc = scoreJudgment(spec, ok);
  assert.equal(sc.correct, 2); assert.equal(sc.rows[1].correct, true); // contradicted is in P2's accept set
});
const transcript = output => `${[
  { type: 'system', subtype: 'init', apiKeySource: 'none', model: CALIBRATION_MODEL, tools: ['StructuredOutput'], claude_code_version: 'test' },
  { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't0', name: 'StructuredOutput', input: output }] } },
  { type: 'result', subtype: 'success', is_error: false, structured_output: output, result: '', modelUsage: { [CALIBRATION_MODEL]: { output_tokens: 5 } }, usage: { input_tokens: 9, output_tokens: 5 }, num_turns: 1 },
].map(r => JSON.stringify(r)).join('\n')}\n`;
await check('variant 3 runs through the durable runner with ONE reservation in total', async () => {
  const plan = { variant: 3, workId: 'judgment-pairs-v1', input, binding: { p: 1 }, promptHash: 'ph', inputSha256: sha256(stableJson(input)), controllerHolds: {} };
  const out = { v: JUDGMENT_VERSION, j: [{ id: 'P1', verdict: 'supported', ref: 'E1', reason: 'r' }, { id: 'P2', verdict: 'unsupported', ref: 'none', reason: 'r' }] };
  assert.equal(deriveAuditAttempt(plan, transcript(out)).kind, 'accepted');
  assert.equal(deriveAuditAttempt(plan, transcript({ ...out, v: 'x' })).kind, 'held');
  const dir = mkdtempSync(join(tmpdir(), 'sa3-')), plan2 = { ...plan, workId: 'other' };
  let calls = 0; const fn = async () => { calls++; return { transcript: transcript(out), exitCode: 0 }; };
  const r = await runAudit({ plans: [plan, plan2], outDir: dir, runId: 'sa-t3', binding: { maxReservations: 1 }, callFn: fn, now: () => new Date('2026-09-29T08:00:00Z') });
  assert.equal(calls, 1); assert.equal(r.stop, 'reservation-cap'); assert.equal(auditHistory(dir, plan, 'sa-t3').kind, 'accepted');
  rmSync(dir, { recursive: true });
});
if (existsSync(join(RUN_ROOT, 'audit-evidence-v1', 'snapshots'))) {
  await check('real frozen pairs: 8 pairs resolve from preserved bytes, no labels in the prompt, one reservation', () => {
    const p = planJudgment(), prompt = p.command.argv[p.command.argv.indexOf('-p') + 1];
    assert.equal(p.input.pairs.length, 8);
    for (const bad of ['mustNot', 'accept', 'basis', '"case"', 'pendingOwnerAdjudication']) assert.ok(!prompt.includes(bad), bad);
    assert.equal(p.command.argv[p.command.argv.indexOf('--tools') + 1], '');
    assert.equal(auditBinding(3).maxReservations, 1);
    assert.ok(/^sa-[0-9a-f]{12}$/.test(auditRunId(auditBinding(3))));
  });
}
console.log(`pass-b-audit-judgment.test: ${n} checks passed`);
