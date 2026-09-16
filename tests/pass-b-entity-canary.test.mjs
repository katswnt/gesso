// VSD-034 item 4 regressions: the bounded 4b runner, exercised OFFLINE via an injected mock callFn that
// returns synthetic stream-json transcripts + controller-owned transport receipts. No model calls. Covers:
// fatal apiKeySource abort (wrong + missing), immutable manifest + complete-binding runId recompute,
// transcript+transport-sourced verified resume without re-execution, unbound scoring, blocked status,
// tamper-rejection, and EXACT-confined-dir image Read verification (basename alone is insufficient).
import assert from 'node:assert';
import { readFileSync, writeFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ENTITY_GRAPH_VERSION } from '../scripts/lib/pass-b-entity-contract.mjs';
import { CALIBRATION_MODEL } from '../scripts/lib/pass-b-calibration.mjs';
import { loadFixtures, planWork, computeRunId, runCanary, deriveAttempt } from '../scripts/pass-b-entity-canary.mjs';

let n = 0;
const ok = (c, m) => { assert(c, m); n++; };
const safeId = (id) => id.replace(/[^a-z0-9]+/gi, '_');
const cleanup = [];
const outDir = () => { const base = mkdtempSync(join(tmpdir(), 'entity-canary-test-')); cleanup.push(base); return join(base, 'run'); };
const MOCK_DIR = '/tmp/mock-confined-dir'; // absolute confined call dir (string only; not created)

// Synthetic stream-json transcript. `readPath` is the exact file_path the Read tool reports.
function synthTranscript(readPath, graph, apiKeySource) {
  const init = { type: 'system', subtype: 'init', claude_code_version: '2.x', model: CALIBRATION_MODEL };
  if (apiKeySource !== 'OMIT') init.apiKeySource = apiKeySource;
  const ev = [
    init,
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: readPath } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', is_error: false, content: [{ type: 'image' }] }] } },
    { type: 'result', structured_output: graph, modelUsage: { [CALIBRATION_MODEL]: { output_tokens: 10 } }, usage: { output_tokens: 10 }, num_turns: 1, is_error: false },
  ];
  return `${ev.map((e) => JSON.stringify(e)).join('\n')}\n`;
}
const transportOf = (plan, dir = MOCK_DIR) => ({ callDir: dir, imageFile: plan.img.file, imageAbsPath: join(dir, plan.img.file) });

const { artifact, fixtures } = loadFixtures();
const plans = fixtures.map(planWork);
ok(plans.every((p) => p.img.receiptOk), 'all image receipts resolve offline');
const { runId, binding } = computeRunId(artifact, plans);
const graphOf = (workId) => fixtures.find((x) => x.workId === workId).label;
// Correct mock: Read targets the exact confined path inside the recorded callDir.
const mockOk = (plan) => ({ transcript: synthTranscript(join(MOCK_DIR, plan.img.file), graphOf(plan.workId), 'none'), exitCode: 0, transport: transportOf(plan) });

// ---- EXACT-confined-dir image Read verification (the reported bug + its fixes) ----
{
  const p0 = plans[0]; const g = graphOf(p0.workId);
  const outside = deriveAttempt(p0, synthTranscript(`/tmp/outside-confined-directory/${p0.img.file}`, g, 'none'), 0, MOCK_DIR);
  ok(!outside.ok && outside.evidence.imageReceipt.ok === false, 'correct basename read from OUTSIDE the confined dir FAILS');
  const insideAbs = deriveAttempt(p0, synthTranscript(join(MOCK_DIR, p0.img.file), g, 'none'), 0, MOCK_DIR);
  ok(insideAbs.ok && insideAbs.evidence.imageReceipt.ok, 'absolute Read inside the recorded call dir passes');
  const insideRel = deriveAttempt(p0, synthTranscript(p0.img.file, g, 'none'), 0, MOCK_DIR);
  ok(insideRel.ok && insideRel.evidence.imageReceipt.ok, 'relative Read resolved inside the recorded call dir passes');
  const noDir = deriveAttempt(p0, synthTranscript(join(MOCK_DIR, p0.img.file), g, 'none'), 0, null);
  ok(!noDir.ok && /transport callDir/.test(noDir.evidence.imageReceipt.reason || ''), 'missing callDir fails closed');
}

// ---- success run ----
{
  const d = outDir();
  const { report, aborted } = await runCanary({ fixtures, plans, runId, binding, outDir: d, callFn: mockOk });
  ok(!aborted, 'no abort when apiKeySource is none');
  ok(report.kind === 'schema-emission-smoke' && report.measurementReadiness === 'blocked', 'report is smoke + measurement blocked');
  const man = JSON.parse(readFileSync(join(d, 'run-manifest.json'), 'utf8'));
  ok(man.binding.version === 'passBEntityCanary/3', 'contract /3 in manifest');
  ok(plans.every((p) => existsSync(join(d, 'works', safeId(p.workId), 'accepted.json'))), 'accepted checkpoints written');
  ok(plans.every((p) => existsSync(join(d, 'works', safeId(p.workId), 'attempt-1.transport.json'))), 'transport receipts persisted');
  const acc0 = JSON.parse(readFileSync(join(d, 'works', safeId(plans[0].workId), 'accepted.json'), 'utf8'));
  ok(!!acc0.transportSha256, 'accepted binds transportSha256');
  const lg = report.unbound.perWork.find((u) => u.workId === 'wikidata:Q16467705');
  ok(lg.claims === 2 && lg.unbound === 2, 'La Gloire unbound reported (2/2 hand-authored)');
}

// ---- verified resume reuses checkpoints WITHOUT re-executing ----
{
  const d = outDir();
  await runCanary({ fixtures, plans, runId, binding, outDir: d, callFn: mockOk });
  const boom = () => { throw new Error('callFn must NOT run on a verified resume'); };
  const { report } = await runCanary({ fixtures, plans, runId, binding, outDir: d, callFn: boom, resume: true });
  ok(report.unbound.perWork.length === plans.length, 'resume completed by reopening + recomputing preserved evidence (no re-exec)');
}

// ---- tamper rejections on resume ----
const tamperReject = async (mutate, re) => {
  const d = outDir();
  await runCanary({ fixtures, plans, runId, binding, outDir: d, callFn: mockOk });
  mutate(d);
  await assert.rejects(runCanary({ fixtures, plans, runId, binding, outDir: d, callFn: mockOk, resume: true }), re);
  n++;
};
const w0 = (d) => join(d, 'works', safeId(plans[0].workId));
await tamperReject((d) => { const mp = join(d, 'run-manifest.json'); const m = JSON.parse(readFileSync(mp, 'utf8')); m.binding.model = 'evil'; writeFileSync(mp, JSON.stringify(m, null, 2)); }, /manifest runId does not match its binding|mismatch/);
await tamperReject((d) => { const sp = join(w0(d), 'attempt-1.score.json'); const s = JSON.parse(readFileSync(sp, 'utf8')); s.entityRecall = 123; writeFileSync(sp, `${JSON.stringify(s, null, 2)}\n`); }, /score tampered/);
await tamperReject((d) => { const tp = join(w0(d), 'attempt-1.transcript.jsonl'); writeFileSync(tp, `${readFileSync(tp, 'utf8')}\n{"x":1}`); }, /transcript tampered/);
await tamperReject((d) => { const rp = join(w0(d), 'attempt-1.result.json'); const r = JSON.parse(readFileSync(rp, 'utf8')); r.controller.unbound = ['spoof']; writeFileSync(rp, `${JSON.stringify(r, null, 2)}\n`); }, /result evidence tampered/);
await tamperReject((d) => { const tr = join(w0(d), 'attempt-1.transport.json'); const t = JSON.parse(readFileSync(tr, 'utf8')); t.callDir = '/tmp/outside-confined-directory'; writeFileSync(tr, `${JSON.stringify(t, null, 2)}\n`); }, /transport receipt tampered/);

// ---- FATAL apiKeySource: wrong + missing abort after the first call ----
const empty = { version: ENTITY_GRAPH_VERSION, regions: [], entities: [], uncertainty: '' };
{
  const d = outDir(); let calls = 0;
  const mockBadKey = (plan) => { calls++; return { transcript: synthTranscript(join(MOCK_DIR, plan.img.file), empty, 'user'), exitCode: 0, transport: transportOf(plan) }; };
  const { aborted } = await runCanary({ fixtures, plans, runId, binding, outDir: d, callFn: mockBadKey });
  ok(aborted && aborted.apiKeySource === 'user' && calls === 1, 'wrong apiKeySource aborts after first call');
  ok(!existsSync(join(w0(d), 'accepted.json')) && existsSync(join(w0(d), 'attempt-1.result.json')), 'aborted attempt preserved, not accepted');
}
{
  const d = outDir(); let calls = 0;
  const mockNoKey = (plan) => { calls++; return { transcript: synthTranscript(join(MOCK_DIR, plan.img.file), empty, 'OMIT'), exitCode: 0, transport: transportOf(plan) }; };
  const { aborted } = await runCanary({ fixtures, plans, runId, binding, outDir: d, callFn: mockNoKey });
  ok(aborted && calls === 1, 'missing apiKeySource aborts after first call');
}

for (const d of cleanup) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
console.log(`ok - pass-b entity canary (offline mocked runner): ${n} checks passed`);
