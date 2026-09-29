// Shadow audit candidate v2: segment coverage, kind-enforced visual referral, citation checks, verdict
// aggregation, v2 dispatch through the durable runner, and the offline compact demo. Offline.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sha256, stableJson } from '../scripts/lib/vision-legacy.mjs';
import { CALIBRATION_MODEL, RUN_ROOT } from '../scripts/lib/pass-b-calibration.mjs';
import { AUDIT_V2_VERSION, segmentsOf, buildInputV2, controlAuditV2, compactFromV1 } from '../scripts/lib/pass-b-shadow-audit-v2.mjs';
import { deriveAuditAttempt, runAudit, auditHistory, scoreAudit, AUDIT_WORKS, planAudit, loadEvidence, auditBinding, auditRunId } from '../scripts/pass-b-shadow-audit.mjs';

let n = 0; const check = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error(`FAIL ${name}`); throw e; } };
const body = { proposedWhy: 'Why text.', proposedCues: [], notes: [{ noteId: 'n1', head: 'Wings behind Glory', body: 'Large wings fan out.' }],
  guide: [{ questionId: 'q1', q: 'Why give Glory wings?', a: 'Wings signal divinity.' }], hotspots: [] };
const workInput = { workId: 'w0', catalog: { title: 'Glory', medium: 'plaster' },
  authoritative: [{ passageId: 'p1', excerpt: 'Allégorie, la Gloire, femme, nu, drapé. Villiers, sommeil, cerceuil.' }],
  sources: [{ sourceId: 's1', status: 'fetched', digest: 'digest text' }, { sourceId: 's2', status: 'fetch-failed', digest: '' }],
  observations: [{ observationId: 'o1', proposition: 'wings' }],
  components: [{ componentId: 'why' }, { componentId: 'note:n1' }, { componentId: 'guide:q1' }] };
const evidenceWork = { sources: [{ sourceId: 's1', ok: true }, { sourceId: 's2', ok: false }], passages: [{ passageId: 'sp-s1-a', sourceId: 's1', text: 'The **Date:** 1906 plaster model.' }], perComponent: { why: ['sp-s1-a'] } };
const input = buildInputV2({ workInput, body, evidenceWork });
const C = (t, k, r, extra = {}) => ({ t, k, r, ...extra });
const full = (overrides = {}) => ({ v: AUDIT_V2_VERSION, segs: [
  { s: 'why#text', c: [C('made of plaster', 'material', 'supported', { e: 'catalog.medium', q: 'plaster' })] },
  { s: 'note:n1#head', c: [C('wings behind Glory', 'iconography', 'unsupported')], pre: [] },
  { s: 'note:n1#body', c: [C('wings fan out', 'visibility', 'visual', { x: 'spread shapes behind the upper figure', o: 'o1' })] },
  { s: 'guide:q1#q', c: [], pre: [C('Glory has wings', 'iconography', 'unsupported')] },
  { s: 'guide:q1#a', c: [C('wings signal divinity', 'interpretation', 'unsupported')] },
  ...(overrides.extra || [])].map(x => (overrides[x.s] ? { ...x, ...overrides[x.s] } : x)) });

await check('segments split headings, questions and bodies; evidence uses passages, digests only without a snapshot', () => {
  assert.deepEqual(segmentsOf(body).map(s => `${s.id}:${s.role}`), ['why#text:text', 'note:n1#head:heading', 'note:n1#body:text', 'guide:q1#q:question', 'guide:q1#a:text']);
  assert.deepEqual(input.evidence.map(e => `${e.id}:${e.type}`), ['p1:authoritative', 'sp-s1-a:page-passage']);
  assert.deepEqual(input.unavailable, ['s2']);
  assert.throws(() => buildInputV2({ workInput: { ...workInput, components: [{ componentId: 'why' }] }, body, evidenceWork }), /segments do not match/);
});
await check('complete, well-cited output: verdicts computed per component; presuppositions counted', () => {
  const r = controlAuditV2(full(), input);
  assert.deepEqual(r.errors, []); assert.deepEqual(r.stats.coverageGaps, []);
  assert.deepEqual(r.components.map(c => `${c.componentId}:${c.verdict}`), ['why:text-covered', 'note:n1:hold', 'guide:q1:hold']);
  assert.equal(r.stats.presuppositions, 1);
  assert.equal(r.components[2].assertions.find(a => a.text === 'Glory has wings').form, 'presupposition');
});
await check('identity/material/iconography can never go to the image check (enforced and counted)', () => {
  for (const k of ['identity', 'material', 'iconography', 'maker-date-place', 'interpretation', 'context']) {
    const r = controlAuditV2(full({ 'note:n1#body': { c: [C('a lion rests lower left', k, 'visual', { x: 'shape lower left' })] } }), input);
    const cl = r.segments.find(s => s.id === 'note:n1#body').claims[0];
    assert.equal(cl.r, 'unsupported'); assert.equal(cl.misrouted, true); assert.equal(r.stats.misroutedVisual, 1);
  }
  const ok = controlAuditV2(full(), input).segments.find(s => s.id === 'note:n1#body').claims[0];
  assert.equal(ok.r, 'visual'); assert.equal(ok.misrouted, false);
});
await check('missing segments and missing presupposition lists are coverage gaps that hold', () => {
  const noPre = full({ 'guide:q1#q': { c: [C('asks about wings', 'context', 'unsupported')], pre: undefined } });
  delete noPre.segs.find(s => s.s === 'guide:q1#q').pre;
  const r = controlAuditV2(noPre, input);
  assert.deepEqual(r.stats.coverageGaps, ['guide:q1#q: no-presupposition-list']);
  const missing = { v: AUDIT_V2_VERSION, segs: full().segs.filter(s => s.s !== 'why#text') };
  const r2 = controlAuditV2(missing, input);
  assert.equal(r2.components[0].verdict, 'hold'); assert.deepEqual(r2.components[0].incomplete, ['why#text: missing']);
  const r3 = controlAuditV2({ v: AUDIT_V2_VERSION, segs: [...full().segs, { s: 'why#text', c: [] }, { s: 'zz#q', c: [] }] }, input);
  assert.ok(r3.errors.some(e => /duplicate/.test(e)) && r3.errors.some(e => /unknown segment/.test(e)));
});
await check('citations: formatting-tolerant quotes pass; observations, unknown ids, wrong fields and paraphrases fail', () => {
  const cite = extra => controlAuditV2(full({ 'why#text': { c: [C('claim', 'maker-date-place', 'supported', extra)] } }), input).segments[0].claims[0];
  assert.equal(cite({ e: 'sp-s1-a', q: 'Date: 1906 plaster' }).r, 'supported');
  assert.equal(cite({ e: 'p1', q: 'sommeil' }).r, 'supported');
  assert.match(cite({ e: 'o1', q: 'wings' }).error, /observation cited as evidence/);
  assert.match(cite({ e: 's2', q: 'x' }).error, /unknown evidence/); // unavailable sources are not evidence
  assert.match(cite({ e: 'catalog.artist', q: 'x' }).error, /unknown catalog field/);
  assert.match(cite({ e: 'sp-s1-a', q: 'made in 1906 from plaster' }).error, /quote not in evidence/);
  assert.match(cite({ e: 'sp-s1-a', q: 'Date: 1906 … model' }).error, /quote not in evidence/);
  const contra = controlAuditV2(full({ 'note:n1#body': { c: [C('writer strides forward', 'visibility', 'contradicted', { e: 'p1', q: 'Villiers, sommeil' })] } }), input);
  assert.equal(contra.segments.find(s => s.id === 'note:n1#body').claims[0].r, 'contradicted');
});

// ---- v2 through the durable runner ----
const transcript = output => `${[
  { type: 'system', subtype: 'init', apiKeySource: 'none', model: CALIBRATION_MODEL, tools: ['StructuredOutput'], claude_code_version: 'test' },
  { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't0', name: 'StructuredOutput', input: output }] } },
  { type: 'result', subtype: 'success', is_error: false, structured_output: output, result: '', modelUsage: { [CALIBRATION_MODEL]: { output_tokens: 5 } }, usage: { input_tokens: 9, output_tokens: 5 }, num_turns: 1 },
].map(r => JSON.stringify(r)).join('\n')}\n`;
const plan = { variant: 2, workId: 'w0', input, v1Input: workInput, controllerHolds: {}, binding: { b0Sha256: 'b' }, promptHash: 'ph', inputSha256: sha256(stableJson(input)) };
await check('v2 attempts derive with the v2 controller and verify on resume; wrong version is held', async () => {
  assert.equal(deriveAuditAttempt(plan, transcript(full())).kind, 'accepted');
  assert.equal(deriveAuditAttempt(plan, transcript({ ...full(), v: 'passBShadowAudit/1' })).kind, 'held');
  const dir = mkdtempSync(join(tmpdir(), 'sa2-'));
  await runAudit({ plans: [plan], outDir: dir, runId: 'sa-t2', binding: {}, callFn: async () => ({ transcript: transcript(full()), exitCode: 0 }), now: () => new Date('2026-09-29T08:00:00Z') });
  assert.equal(auditHistory(dir, plan, 'sa-t2').kind, 'accepted');
  const rep = scoreAudit({ plans: [plan], outDir: dir, runId: 'sa-t2', sealed: () => [],
    known: [{ workId: 'w0', componentId: 'guide:q1', expected: 'hold', errorTarget: { pattern: '\\bglory\\b.*\\bwing', expectedKind: 'iconography' } }], ownerLabels: [] });
  const item = rep.summary.knownErrors.items[0];
  assert.equal(item.level, 'identified'); assert.equal(item.kindCorrect, true);
  rmSync(dir, { recursive: true });
});
await check('compact demo re-expresses a v1 output with every segment and presupposition slot', () => {
  const v1 = { version: 'passBShadowAudit/1', components: [{ componentId: 'guide:q1', verdict: 'hold', assertions: [
    { text: 'Glory has wings', form: 'presupposition', class: 'unsupported', why: 'w' }, { text: 'Wings signal divinity', form: 'interpretation', class: 'unsupported', why: 'w' }] }] };
  const c = compactFromV1(v1, input);
  assert.equal(c.segs.length, input.segments.length);
  assert.equal(c.segs.find(s => s.s === 'guide:q1#q').pre[0].t, 'Glory has wings');
});

// ---- real prepared inputs (quarantined; skipped where absent) ----
if (existsSync(join(RUN_ROOT, 'audit-evidence-v1', 'evidence.json')) && existsSync(join(RUN_ROOT, 'b4s-06e99464c52b'))) {
  await check('real v2 plans: four works, no tools, no labels leak, run id distinct from v1', () => {
    const ev = loadEvidence(), plans = AUDIT_WORKS.map(s => planAudit(s, undefined, 2, ev));
    for (const p of plans) {
      const argv = p.command.argv, prompt = argv[argv.indexOf('-p') + 1];
      assert.equal(argv[argv.indexOf('--tools') + 1], '');
      for (const bad of ['not-this-error', 'cb-d4c407b953ac', 'expectedKind', 'errorTarget', 'openClaimEcho', 'proposedVerdict']) assert.ok(!prompt.includes(bad), `${p.workId} leaks ${bad}`);
      assert.ok(p.input.segments.length > p.v1Input.components.length);
    }
    assert.notEqual(auditRunId(auditBinding(2, ev)), auditRunId(auditBinding(1)));
    assert.equal(auditRunId(auditBinding(1)), 'sa-dc474939fdab'); // v1 identity frozen
  });
}
console.log(`pass-b-shadow-audit-v2.test: ${n} checks passed`);
