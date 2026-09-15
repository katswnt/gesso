// VSD-034 item 4 regressions: the bounded 4b runner, exercised OFFLINE via an injected mock callFn.
// No model calls. Covers: fatal apiKeySource abort (wrong + missing), immutable manifest binding,
// verified resume without repeated execution, unbound-claim scoring, and blocked report status.
import assert from 'node:assert';
import { readFileSync, existsSync, rmSync, mkdtempSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ENTITY_GRAPH_VERSION } from '../scripts/lib/pass-b-entity-contract.mjs';
import { loadFixtures, planWork, computeRunId, runCanary } from '../scripts/pass-b-entity-canary.mjs';

let n = 0;
const ok = (c, m) => { assert(c, m); n++; };
const tmp = () => mkdtempSync(join(tmpdir(), 'entity-canary-test-'));
const cleanup = [];
const outDir = () => { const d = join(tmp(), 'run'); cleanup.push(d); return d; }; // non-existent subdir so runCanary creates it

const { artifact, fixtures } = loadFixtures();
const plans = fixtures.map(planWork);
ok(plans.every((p) => p.img.receiptOk), 'all image receipts resolve offline');
const { runId, binding } = computeRunId(artifact, plans);
const EV = (plan, apiKeySource) => ({ apiKeySource, claudeCodeVersion: '2.x', usage: { output_tokens: 10 }, modelUsage: {}, numTurns: 1, imgSha256: plan.img.imgSha256, promptHash: plan.promptHash });
const emptyGraph = { version: ENTITY_GRAPH_VERSION, regions: [], entities: [], uncertainty: '' };
const mockOk = (plan) => { const f = fixtures.find((x) => x.workId === plan.workId); return { workId: plan.workId, ok: true, graph: f.label, errors: [], transcript: '{"init":1}\n', evidence: EV(plan, 'none') }; };

// ---- success run (all apiKeySource:none) ----
{
  const d = outDir();
  const { report, aborted } = await runCanary({ fixtures, plans, runId, binding, outDir: d, callFn: mockOk });
  ok(!aborted, 'no abort when apiKeySource is none');
  ok(report.kind === 'schema-emission-smoke' && report.measurementReadiness === 'blocked', 'report is smoke + measurement blocked');
  ok(existsSync(join(d, 'run-manifest.json')), 'immutable manifest written');
  const man = JSON.parse(readFileSync(join(d, 'run-manifest.json'), 'utf8'));
  ok(man.runId === runId && man.binding.fixturesSha256 === binding.fixturesSha256, 'manifest carries the full binding');
  ok(plans.every((p) => existsSync(join(d, 'works', p.workId.replace(/[^a-z0-9]+/gi, '_'), 'accepted.json'))), 'accepted checkpoints written');
  // Item 2: unbound reported. La Gloire wings+skull (2) unbound against its own label; St. John penitent binds.
  const lg = report.unbound.perWork.find((u) => u.workId === 'wikidata:Q16467705');
  ok(lg.claims === 2 && lg.unbound === 2, 'La Gloire unbound count reported (2/2 hand-authored)');
  ok(report.unbound.totalUnbound >= 2 && report.unbound.rate !== null, 'aggregate unbound rate reported');
  ok(report.emission.schemaConformanceRate === 1, 'schema-emission smoke: all valid (mock emits the gold labels)');
}

// ---- resume reuses checkpoints WITHOUT re-executing ----
{
  const d = outDir();
  await runCanary({ fixtures, plans, runId, binding, outDir: d, callFn: mockOk });
  const boom = () => { throw new Error('callFn must NOT run on a verified resume'); };
  const { report } = await runCanary({ fixtures, plans, runId, binding, outDir: d, callFn: boom, resume: true });
  ok(report.unbound.perWork.length === plans.length, 'resume completed all works by reusing checkpoints (no re-exec)');
}

// ---- resume with a mismatched runId is refused ----
{
  const d = outDir();
  await runCanary({ fixtures, plans, runId, binding, outDir: d, callFn: mockOk });
  await assert.rejects(runCanary({ fixtures, plans, runId: 'b6c-000000000000', binding, outDir: d, callFn: mockOk, resume: true }), /manifest\/binding mismatch/); n++;
}

// ---- FATAL apiKeySource: wrong value aborts after the first call, remaining calls not made ----
{
  const d = outDir();
  let calls = 0;
  const mockBadKey = (plan) => { calls++; return { workId: plan.workId, ok: true, graph: emptyGraph, errors: [], transcript: '', evidence: EV(plan, 'user') }; };
  const { aborted } = await runCanary({ fixtures, plans, runId, binding, outDir: d, callFn: mockBadKey });
  ok(aborted && aborted.apiKeySource === 'user', 'wrong apiKeySource aborts');
  ok(calls === 1, 'aborted after the FIRST call — remaining calls not made (no silent credit spend)');
  ok(!existsSync(join(d, 'works', plans[0].workId.replace(/[^a-z0-9]+/gi, '_'), 'accepted.json')), 'no accepted checkpoint for the aborted call');
  ok(existsSync(join(d, 'works', plans[0].workId.replace(/[^a-z0-9]+/gi, '_'), 'attempt-1.result.json')), 'aborted attempt preserved as evidence');
}

// ---- FATAL apiKeySource: missing value also aborts ----
{
  const d = outDir();
  let calls = 0;
  const mockNoKey = (plan) => { calls++; return { workId: plan.workId, ok: true, graph: emptyGraph, errors: [], transcript: '', evidence: EV(plan, undefined) }; };
  const { aborted } = await runCanary({ fixtures, plans, runId, binding, outDir: d, callFn: mockNoKey });
  ok(aborted && calls === 1, 'missing apiKeySource aborts after first call');
}

for (const d of cleanup) { try { rmSync(join(d, '..'), { recursive: true, force: true }); } catch { /* best effort */ } }
console.log(`ok - pass-b entity canary (offline mocked runner): ${n} checks passed`);
