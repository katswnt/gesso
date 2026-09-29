// Shadow audit (four-call experiment): citation controller, call provenance, durable four-reservation runner,
// scheduling gate, scoring, and (when the quarantined evidence exists) the real frozen inputs. Offline.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sha256, stableJson } from '../scripts/lib/vision-legacy.mjs';
import { CALIBRATION_MODEL, RUN_ROOT } from '../scripts/lib/pass-b-calibration.mjs';
import {
  AUDIT_VERSION, AUDIT_WORKS, MAX_RESERVATIONS, controlAudit, deriveAuditAttempt, runAudit, auditHistory, countReservations,
  startGate, scoreAudit, planAudit, auditBinding, auditRunId,
} from '../scripts/pass-b-shadow-audit.mjs';

let n = 0; const check = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error(`FAIL ${name}`); throw e; } };
const transcript = (output, { apiKeySource = 'none', model = CALIBRATION_MODEL, tools = ['StructuredOutput'], initTools = ['StructuredOutput'] } = {}) => `${[
  { type: 'system', subtype: 'init', apiKeySource, model, tools: initTools, claude_code_version: 'test' },
  ...(tools.length ? [{ type: 'assistant', message: { content: tools.map((name, i) => ({ type: 'tool_use', id: `t${i}`, name, input: name === 'StructuredOutput' ? output : {} })) } }] : []),
  { type: 'result', subtype: 'success', is_error: false, structured_output: output, result: '', modelUsage: { [model]: { output_tokens: 10 } }, usage: { input_tokens: 100, output_tokens: 10 }, num_turns: 1 },
].map(r => JSON.stringify(r)).join('\n')}\n`;
const usageTranscript = () => `${[
  { type: 'system', subtype: 'init', apiKeySource: 'none', model: CALIBRATION_MODEL, tools: ['StructuredOutput'] },
  { type: 'result', subtype: 'error', is_error: true, api_error_status: 429, result: 'usage limit reached' },
].map(r => JSON.stringify(r)).join('\n')}\n`;

const input = {
  workId: 'w1', catalog: { title: 'Glory Pulling X From His Eternal Sleep', date: '1906', medium: 'plaster' },
  authoritative: [{ passageId: 'p1', url: 'u', field: 'Description', excerpt: "Allégorie, la Gloire, femme, nu, drapé. Villiers, sommeil, cerceuil." }],
  sources: [{ sourceId: 's1', url: 'a', status: 'fetched', digest: 'The work depicts a nude female figure (representing “Glory”) opening a coffin.' },
    { sourceId: 's2', url: 'b', status: 'fetch-failed', digest: '' }],
  observations: [{ observationId: 'o1', principal: 'B1', proposition: 'figure lower left' }],
  components: [{ componentId: 'why', surface: 'why', text: 'x' }, { componentId: 'note:n1', surface: 'note', text: 'y' }],
};
const A = (cls, extra = {}) => ({ text: 't', form: 'statement', class: cls, why: 'w', ...extra });
const out = comps => ({ version: AUDIT_VERSION, components: comps });

// ---- citation controller ----
await check('catalog and passage and source citations verify; quotes normalize typography', () => {
  const r = controlAudit(out([
    { componentId: 'why', verdict: 'text-covered', assertions: [A('catalog-supported', { catalogField: 'medium', catalogValue: 'plaster' }), A('source-supported', { sourceId: 's1', quote: 'representing "Glory") opening a coffin' })] },
    { componentId: 'note:n1', verdict: 'hold', assertions: [A('contradicted', { passageId: 'p1', quote: 'Villiers, sommeil' })] },
  ]), input);
  assert.deepEqual(r.errors, []);
  assert.equal(r.components[0].verdict, 'text-covered'); assert.equal(r.components[1].verdict, 'hold');
  assert.ok(r.components[0].assertions.every(a => a.quoteVerified && !a.citationError));
});
await check('invalid citations downgrade to unsupported and hold', () => {
  const bad = [
    A('catalog-supported', { catalogField: 'medium', catalogValue: 'bronze' }), A('catalog-supported', { catalogField: 'nope', catalogValue: 'x' }),
    A('source-supported', { sourceId: 's2', quote: '' }), A('source-supported', { sourceId: 's1', quote: 'a winged woman' }),
    A('source-supported', { sourceId: 's9', quote: 'x' }), A('source-supported', { passageId: 'p1', sourceId: 's1', quote: 'sommeil' }),
    A('contradicted', {}), A('visual-only', {}), A('source-supported', { passageId: 'p1', quote: '' }),
  ];
  for (const a of bad) {
    const r = controlAudit(out([{ componentId: 'why', verdict: 'text-covered', assertions: [a] }, { componentId: 'note:n1', verdict: 'text-covered', assertions: [A('visual-only', { visualCheck: 'a figure' })] }]), input);
    assert.equal(r.components[0].assertions[0].class, 'unsupported', JSON.stringify(a));
    assert.ok(r.components[0].assertions[0].citationError);
    assert.equal(r.components[0].verdict, 'hold'); assert.equal(r.components[0].verdictDisagreement, true);
    assert.equal(r.components[1].verdict, 'needs-visual-check');
  }
});
await check('a non-fetched source never supports, even if it carries text', () => {
  const withText = { ...input, sources: [{ sourceId: 's3', url: 'c', status: 'fetch-failed', digest: 'HTTP 403 Forbidden bronze' }] };
  const r = controlAudit(out([{ componentId: 'why', verdict: 'text-covered', assertions: [A('source-supported', { sourceId: 's3', quote: 'bronze' })] }]), withText);
  assert.equal(r.components[0].assertions[0].class, 'unsupported'); assert.match(r.components[0].assertions[0].citationError, /fetch-failed/);
});
await check('missing, unknown, duplicate and empty components', () => {
  const r = controlAudit(out([{ componentId: 'why', verdict: 'text-covered', assertions: [] }, { componentId: 'why', verdict: 'hold', assertions: [] }, { componentId: 'zzz', verdict: 'hold', assertions: [] }]), input);
  assert.ok(r.errors.some(e => /duplicate/.test(e)) && r.errors.some(e => /unknown component/.test(e)));
  assert.equal(r.components[0].verdict, 'hold'); assert.match(r.components[0].reason, /no assertions/);
  assert.equal(r.components[1].verdict, 'hold'); assert.match(r.components[1].reason, /missing/);
});
await check('unknown observationId is recorded, not trusted', () => {
  const r = controlAudit(out([{ componentId: 'why', verdict: 'needs-visual-check', assertions: [A('visual-only', { visualCheck: 'x', observationId: 'o9' })] }]), input);
  assert.match(r.components[0].assertions[0].obsError, /unknown observationId/);
});

// ---- call provenance ----
const goodOut = out([{ componentId: 'why', verdict: 'text-covered', assertions: [A('catalog-supported', { catalogField: 'date', catalogValue: '1906' })] }, { componentId: 'note:n1', verdict: 'hold', assertions: [A('unsupported')] }]);
const plan = { workId: 'w1', input, inputSha256: sha256(stableJson(input)), promptHash: 'ph', binding: { b0Sha256: 'b0' }, controllerHolds: { why: [], 'note:n1': ['open-claim: z'] } };
await check('provenance: accepted, fatal, usage-limit, held', () => {
  assert.equal(deriveAuditAttempt(plan, transcript(goodOut)).kind, 'accepted');
  assert.equal(deriveAuditAttempt(plan, transcript(goodOut, { apiKeySource: 'ANTHROPIC_API_KEY' })).kind, 'fatal');
  assert.equal(deriveAuditAttempt(plan, transcript(goodOut, { model: 'claude-opus-x' })).kind, 'fatal');
  assert.equal(deriveAuditAttempt(plan, transcript(goodOut, { tools: ['StructuredOutput', 'WebFetch'] })).kind, 'fatal');
  assert.equal(deriveAuditAttempt(plan, transcript(goodOut, { initTools: ['StructuredOutput', 'Read'] })).kind, 'fatal');
  assert.equal(deriveAuditAttempt(plan, usageTranscript()).kind, 'usage-limit');
  assert.equal(deriveAuditAttempt(plan, transcript({ ...goodOut, version: 'x' })).kind, 'held');
  assert.equal(deriveAuditAttempt(plan, transcript(goodOut), 'timeout').kind, 'held');
});

// ---- durable runner ----
const inWindow = () => new Date('2026-09-29T08:00:00Z'); // 01:00 PT
const daytime = () => new Date('2026-09-29T20:00:00Z'); // 13:00 PT
const mkPlans = k => Array.from({ length: k }, (_, i) => ({ ...plan, workId: `w${i}`, input: { ...input, workId: `w${i}` } })).map(p => ({ ...p, inputSha256: sha256(stableJson(p.input)) }));
const tmp = () => mkdtempSync(join(tmpdir(), 'sa-test-'));
const good = async () => ({ transcript: transcript(goodOut), exitCode: 0 });

await check('four calls, then a resume makes zero calls', async () => {
  const dir = tmp(), plans = mkPlans(4);
  let calls = 0; const fn = async () => { calls++; return good(); };
  const r1 = await runAudit({ plans, outDir: dir, runId: 'sa-t', binding: { b: 1 }, callFn: fn, now: inWindow });
  assert.equal(r1.calls, 4); assert.equal(r1.accepted, 4); assert.equal(countReservations(dir), 4);
  const r2 = await runAudit({ plans, outDir: dir, runId: 'sa-t', binding: { b: 1 }, callFn: fn, now: inWindow });
  assert.equal(r2.calls, 0); assert.equal(r2.skipped, 4); assert.equal(calls, 4);
  assert.equal(auditHistory(dir, plans[0], 'sa-t').kind, 'accepted');
  rmSync(dir, { recursive: true });
});
await check('unknown outcome consumes its slot and is never retried', async () => {
  const dir = tmp(), plans = mkPlans(2);
  const r1 = await runAudit({ plans, outDir: dir, runId: 'sa-t', binding: {}, callFn: async p => { if (p.workId === 'w0') throw new Error('crash'); return good(); }, now: inWindow });
  assert.equal(r1['unknown-outcome'], 1); assert.equal(auditHistory(dir, plans[0], 'sa-t').kind, 'unknown-outcome');
  let calls = 0;
  const r2 = await runAudit({ plans, outDir: dir, runId: 'sa-t', binding: {}, callFn: async () => { calls++; return good(); }, now: inWindow });
  assert.equal(calls, 0); assert.equal(r2.skipped, 2);
  rmSync(dir, { recursive: true });
});
await check('usage-limit stops the session and consumes the slot', async () => {
  const dir = tmp(), plans = mkPlans(3);
  const r = await runAudit({ plans, outDir: dir, runId: 'sa-t', binding: {}, callFn: async () => ({ transcript: usageTranscript(), exitCode: 1 }), now: inWindow });
  assert.equal(r.stop, 'usage-limit'); assert.equal(r.calls, 1);
  let calls = 0; await runAudit({ plans, outDir: dir, runId: 'sa-t', binding: {}, callFn: async () => { calls++; return good(); }, now: inWindow });
  assert.equal(calls, 2); assert.equal(countReservations(dir), 3); // the limited work is not retried
  rmSync(dir, { recursive: true });
});
await check('fatal persists and every later run refuses to call', async () => {
  const dir = tmp(), plans = mkPlans(3);
  const r = await runAudit({ plans, outDir: dir, runId: 'sa-t', binding: {}, callFn: async () => ({ transcript: transcript(goodOut, { apiKeySource: 'x' }), exitCode: 0 }), now: inWindow });
  assert.equal(r.stop, 'fatal-provenance'); assert.ok(existsSync(join(dir, 'fatal.json')));
  let calls = 0; const r2 = await runAudit({ plans, outDir: dir, runId: 'sa-t', binding: {}, callFn: async () => { calls++; return good(); }, now: inWindow });
  assert.equal(r2.stop, 'preserved-fatal'); assert.equal(calls, 0);
  rmSync(dir, { recursive: true });
});
await check('four reservations total across resumes, whatever the work list', async () => {
  const dir = tmp();
  await runAudit({ plans: mkPlans(4), outDir: dir, runId: 'sa-t', binding: {}, callFn: good, now: inWindow });
  const extra = mkPlans(6).slice(4); // the manifest refuses a changed work list outright
  await assert.rejects(runAudit({ plans: [...mkPlans(4), ...extra], outDir: dir, runId: 'sa-t', binding: {}, callFn: good, now: inWindow }), /frozen input changed/);
  // even a hand-made extra work dir cannot push past the cap
  const d2 = tmp(); const p5 = mkPlans(5);
  await runAudit({ plans: p5, outDir: d2, runId: 'sa-t', binding: {}, callFn: good, now: inWindow }).then(r => { assert.equal(r.calls, MAX_RESERVATIONS); assert.equal(r.stop, 'reservation-cap'); });
  rmSync(dir, { recursive: true }); rmSync(d2, { recursive: true });
});
await check('frozen input or binding change is refused after reservation', async () => {
  const dir = tmp(), plans = mkPlans(1);
  await runAudit({ plans, outDir: dir, runId: 'sa-t', binding: {}, callFn: good, now: inWindow });
  const changed = { ...plans[0], input: { ...plans[0].input, catalog: { title: 'other' } } }; changed.inputSha256 = sha256(stableJson(changed.input));
  await assert.rejects(runAudit({ plans: [changed], outDir: dir, runId: 'sa-t', binding: {}, callFn: good, now: inWindow }), /frozen input changed/);
  assert.throws(() => auditHistory(dir, changed, 'sa-t'), /frozen input changed/);
  await assert.rejects(runAudit({ plans, outDir: dir, runId: 'sa-t', binding: { other: 1 }, callFn: good, now: inWindow }), /manifest differs/);
  rmSync(dir, { recursive: true });
});
await check('tampered evidence is detected', async () => {
  const dir = tmp(), plans = mkPlans(1);
  await runAudit({ plans, outDir: dir, runId: 'sa-t', binding: {}, callFn: good, now: inWindow });
  const w = join(dir, 'works', readdirSync(join(dir, 'works'))[0]);
  rmSync(join(w, 'attempt-1.result.json')); writeFileSync(join(w, 'attempt-1.result.json'), '{}');
  assert.throws(() => auditHistory(dir, plans[0], 'sa-t'), /evidence changed/);
  rmSync(dir, { recursive: true });
});
await check('protected hours: no reservation by day; a dated owner exception is required and recorded', async () => {
  assert.throws(() => startGate(daytime(), undefined), /protected-hours/);
  assert.throws(() => startGate(daytime(), '2026-09-28'), /protected-hours/);
  assert.equal(startGate(daytime(), '2026-09-29').hoursException, '2026-09-29');
  assert.equal(startGate(inWindow(), undefined).hoursException, null);
  const dir = tmp(), plans = mkPlans(2);
  const r = await runAudit({ plans, outDir: dir, runId: 'sa-t', binding: {}, callFn: good, now: daytime });
  assert.equal(r.stop, 'protected-hours'); assert.equal(countReservations(dir), 0);
  const r2 = await runAudit({ plans, outDir: dir, runId: 'sa-t', binding: {}, callFn: good, now: daytime, exception: '2026-09-29' });
  assert.equal(r2.calls, 2); assert.equal(auditHistory(dir, plans[0], 'sa-t').reservation.hoursException, '2026-09-29');
  rmSync(dir, { recursive: true });
});

// ---- scoring ----
await check('scoring separates auditor verdicts from controller and sealed holds; unsure unscored', async () => {
  const dir = tmp(), plans = mkPlans(1);
  await runAudit({ plans, outDir: dir, runId: 'sa-t', binding: {}, callFn: good, now: inWindow });
  const rep = scoreAudit({ plans, outDir: dir, runId: 'sa-t', sealed: () => [{ findingId: 'cb' }],
    known: [{ workId: 'w0', componentId: 'note:n1', expected: 'hold' }], ownerLabels: [{ workId: 'w0', componentId: 'why', label: 'unsure' }] });
  assert.equal(rep.summary.knownHolds.caughtByAuditor, 1); assert.equal(rep.summary.unscoredUnsure, 1);
  assert.deepEqual(rep.summary.verdicts, { hold: 1, 'needs-visual-check': 0, 'text-covered': 1 });
  const row = rep.rows.find(r => r.componentId === 'note:n1');
  assert.deepEqual(row.controllerHolds, ['open-claim: z']); assert.equal(row.sealedHold, true);
  assert.equal(rep.works[0].outputTokens, 10);
  rmSync(dir, { recursive: true });
});

// ---- real frozen inputs (quarantined data; skipped where absent, e.g. CI) ----
if (existsSync(join(RUN_ROOT, 'b4s-06e99464c52b')) && existsSync(join(RUN_ROOT, 'b4w-04b88c97e6eb'))) {
  await check('real inputs: four works, no tools, no labels or gate results leak into prompts', () => {
    const plans = AUDIT_WORKS.map(s => planAudit(s));
    assert.equal(plans.length, 4);
    for (const p of plans) {
      const argv = p.command.argv, prompt = argv[argv.indexOf('-p') + 1];
      assert.equal(argv[argv.indexOf('--tools') + 1], '');
      assert.ok(!argv.includes('--allowedTools'));
      for (const bad of ['not-this-error', 'cb-d4c407b953ac', 'cb-273b4c707b9c', 'openClaimEcho', 'proposedVerdict', 'claimRefs', 'expectedClass']) assert.ok(!prompt.includes(bad), `${p.workId} leaks ${bad}`);
      assert.ok(p.input.sources.every(s => s.status === 'fetched' ? s.digest.length > 0 : s.digest === ''));
    }
    assert.equal(plans[0].input.authoritative[0].passageId, 'span-carnavalet-iconography');
    assert.ok(/^sa-[0-9a-f]{12}$/.test(auditRunId(auditBinding())));
  });
}
console.log(`pass-b-shadow-audit.test: ${n} checks passed`);
