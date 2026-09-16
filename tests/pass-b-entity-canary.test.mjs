// VSD-034 item 4 regressions: the bounded 4b runner, exercised OFFLINE via an injected mock callFn that
// returns synthetic stream-json transcripts. No model calls. Covers: fatal apiKeySource abort (wrong +
// missing), immutable manifest + complete-binding runId recompute, transcript-sourced verified resume
// without re-execution, unbound-claim scoring, blocked status, and tamper-rejection on resume.
import assert from 'node:assert';
import { readFileSync, writeFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ENTITY_GRAPH_VERSION } from '../scripts/lib/pass-b-entity-contract.mjs';
import { CALIBRATION_MODEL } from '../scripts/lib/pass-b-calibration.mjs';
import { loadFixtures, planWork, computeRunId, runCanary } from '../scripts/pass-b-entity-canary.mjs';

let n = 0;
const ok = (c, m) => { assert(c, m); n++; };
const safeId = (id) => id.replace(/[^a-z0-9]+/gi, '_');
const cleanup = [];
const outDir = () => { const base = mkdtempSync(join(tmpdir(), 'entity-canary-test-')); cleanup.push(base); return join(base, 'run'); };

// A synthetic stream-json transcript that parseStreamTranscript/verifyB1ImageRead/etc. accept.
// apiKeySource === 'OMIT' truly omits the field (tests the missing-provenance case).
function synthTranscript(imageFile, graph, apiKeySource) {
  const init = { type: 'system', subtype: 'init', claude_code_version: '2.x', model: CALIBRATION_MODEL };
  if (apiKeySource !== 'OMIT') init.apiKeySource = apiKeySource;
  const ev = [
    init,
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: imageFile } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', is_error: false, content: [{ type: 'image' }] }] } },
    { type: 'result', structured_output: graph, modelUsage: { [CALIBRATION_MODEL]: { output_tokens: 10 } }, usage: { output_tokens: 10 }, num_turns: 1, is_error: false },
  ];
  return `${ev.map((e) => JSON.stringify(e)).join('\n')}\n`;
}

const { artifact, fixtures } = loadFixtures();
const plans = fixtures.map(planWork);
ok(plans.every((p) => p.img.receiptOk), 'all image receipts resolve offline');
const { runId, binding } = computeRunId(artifact, plans);
const graphOf = (workId) => fixtures.find((x) => x.workId === workId).label;
const mockOk = (plan) => ({ transcript: synthTranscript(plan.img.file, graphOf(plan.workId), 'none'), exitCode: 0 });

// ---- success run ----
{
  const d = outDir();
  const { report, aborted } = await runCanary({ fixtures, plans, runId, binding, outDir: d, callFn: mockOk });
  ok(!aborted, 'no abort when apiKeySource is none');
  ok(report.kind === 'schema-emission-smoke' && report.measurementReadiness === 'blocked', 'report is smoke + measurement blocked');
  const man = JSON.parse(readFileSync(join(d, 'run-manifest.json'), 'utf8'));
  ok(man.runId === runId && man.binding.version === 'passBEntityCanary/2' && man.binding.works[0].commandPolicySha256, 'manifest carries complete binding (contract /2 + command policy)');
  ok(plans.every((p) => existsSync(join(d, 'works', safeId(p.workId), 'accepted.json'))), 'accepted checkpoints written');
  const lg = report.unbound.perWork.find((u) => u.workId === 'wikidata:Q16467705');
  ok(lg.claims === 2 && lg.unbound === 2, 'La Gloire unbound reported (2/2 hand-authored)');
  ok(report.emission.schemaConformanceRate === 1, 'schema-emission smoke: all valid');
}

// ---- verified resume reuses checkpoints WITHOUT re-executing (transcript is re-verified + recomputed) ----
{
  const d = outDir();
  await runCanary({ fixtures, plans, runId, binding, outDir: d, callFn: mockOk });
  const boom = () => { throw new Error('callFn must NOT run on a verified resume'); };
  const { report } = await runCanary({ fixtures, plans, runId, binding, outDir: d, callFn: boom, resume: true });
  ok(report.unbound.perWork.length === plans.length, 'resume completed by reopening + recomputing preserved evidence (no re-exec)');
}

// ---- item 5a: modifying manifest.binding.model must reject resume ----
{
  const d = outDir();
  await runCanary({ fixtures, plans, runId, binding, outDir: d, callFn: mockOk });
  const mp = join(d, 'run-manifest.json'); const m = JSON.parse(readFileSync(mp, 'utf8'));
  m.binding.model = 'evil-model'; writeFileSync(mp, JSON.stringify(m, null, 2));
  await assert.rejects(runCanary({ fixtures, plans, runId, binding, outDir: d, callFn: mockOk, resume: true }), /manifest runId does not match its binding|mismatch/); n++;
}

// ---- item 5b: modifying an accepted score to entityRecall:123 must reject resume ----
{
  const d = outDir();
  await runCanary({ fixtures, plans, runId, binding, outDir: d, callFn: mockOk });
  const sp = join(d, 'works', safeId(plans[0].workId), 'attempt-1.score.json');
  const s = JSON.parse(readFileSync(sp, 'utf8')); s.entityRecall = 123; writeFileSync(sp, `${JSON.stringify(s, null, 2)}\n`);
  await assert.rejects(runCanary({ fixtures, plans, runId, binding, outDir: d, callFn: mockOk, resume: true }), /score tampered/); n++;
}

// ---- item 5c: modifying transcript or result/controller evidence must reject resume ----
{
  const d = outDir();
  await runCanary({ fixtures, plans, runId, binding, outDir: d, callFn: mockOk });
  const tp = join(d, 'works', safeId(plans[0].workId), 'attempt-1.transcript.jsonl');
  writeFileSync(tp, `${readFileSync(tp, 'utf8')}\n{"type":"system","subtype":"tampered"}`);
  await assert.rejects(runCanary({ fixtures, plans, runId, binding, outDir: d, callFn: mockOk, resume: true }), /transcript tampered/); n++;
}
{
  const d = outDir();
  await runCanary({ fixtures, plans, runId, binding, outDir: d, callFn: mockOk });
  const rp = join(d, 'works', safeId(plans[0].workId), 'attempt-1.result.json');
  const r = JSON.parse(readFileSync(rp, 'utf8')); r.controller.unbound = ['spoofed']; writeFileSync(rp, `${JSON.stringify(r, null, 2)}\n`);
  await assert.rejects(runCanary({ fixtures, plans, runId, binding, outDir: d, callFn: mockOk, resume: true }), /result evidence tampered/); n++;
}

// ---- FATAL apiKeySource: wrong value aborts after the first call ----
{
  const d = outDir();
  let calls = 0;
  const empty = { version: ENTITY_GRAPH_VERSION, regions: [], entities: [], uncertainty: '' };
  const mockBadKey = (plan) => { calls++; return { transcript: synthTranscript(plan.img.file, empty, 'user'), exitCode: 0 }; };
  const { aborted } = await runCanary({ fixtures, plans, runId, binding, outDir: d, callFn: mockBadKey });
  ok(aborted && aborted.apiKeySource === 'user', 'wrong apiKeySource aborts');
  ok(calls === 1, 'aborted after the FIRST call — remaining calls not made');
  ok(!existsSync(join(d, 'works', safeId(plans[0].workId), 'accepted.json')), 'no accepted checkpoint for the aborted call');
  ok(existsSync(join(d, 'works', safeId(plans[0].workId), 'attempt-1.result.json')), 'aborted attempt preserved as evidence');
}

// ---- FATAL apiKeySource: missing value also aborts ----
{
  const d = outDir();
  let calls = 0;
  const empty = { version: ENTITY_GRAPH_VERSION, regions: [], entities: [], uncertainty: '' };
  const mockNoKey = (plan) => { calls++; return { transcript: synthTranscript(plan.img.file, empty, 'OMIT'), exitCode: 0 }; };
  const { aborted } = await runCanary({ fixtures, plans, runId, binding, outDir: d, callFn: mockNoKey });
  ok(aborted && calls === 1, 'missing apiKeySource aborts after first call');
}

for (const d of cleanup) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
console.log(`ok - pass-b entity canary (offline mocked runner): ${n} checks passed`);
