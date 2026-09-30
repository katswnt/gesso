// B1–B3 model test (owner 2026-09-30): run the corpus collector's exact B1→B2→B3 prompts on Sonnet 5.5 for 5 works
// that already have banked Sonnet 4.6 output, then compare validity, cost and content side by side. Same safeguards
// as the claim-first trial (durable reservations, one attempt per work per stage, subscription provenance, image
// confinement, B2 must genuinely retrieve pages, VSD-045 hours). Quarantined; the banked corpus is only READ.
//   node scripts/pass-b-b13-model-test.mjs            # plan
//   PASS_B_SHADOW_AUDIT_LIVE=1 [PASS_B_SHADOW_AUDIT_HOURS_EXCEPTION=YYYY-MM-DD] node scripts/pass-b-b13-model-test.mjs --run
//   node scripts/pass-b-b13-model-test.mjs --report
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { sha256, stableJson } from './lib/vision-legacy.mjs';
import { RUN_ROOT, buildStageCommand, parseStreamTranscript, verifyB2WebEvents, b3Plan, b2InputFor } from './lib/pass-b-calibration.mjs';
import { validateStageBody } from './lib/vision-content-schema.mjs';
import { stagePrompts } from './lib/pass-b-prompts.mjs';
import { CORPUS_RUN_DIR, effectivePromptFor } from './pass-b-corpus-collect.mjs';
import { CALL_TIMEOUT_MS } from './pass-b-b4-structured-canary.mjs';
import { runAudit, auditHistory, countReservations, callAuditPinned } from './pass-b-shadow-audit.mjs';
import { trialWorks, workBase, OPTS } from './pass-b-claim-first.mjs';

const execFileP = promisify(execFile);
export const TEST_MODEL = 'claude-sonnet-5-5', N = 5;
const readJson = p => JSON.parse(readFileSync(p, 'utf8'));

export function testWorks() {
  OPTS.size = 20;
  return trialWorks().filter(id => { const d = join(CORPUS_RUN_DIR, 'works', sha256(id).slice(0, 24), 'completions'); return existsSync(d) && readdirSync(d).some(f => f.startsWith('b3-')); }).slice(0, N);
}
const binding = (stage, works) => ({ version: `passBB13ModelTest/1:${stage}`, model: TEST_MODEL, promptSha256: sha256(stagePrompts()[stage]),
  callTimeoutMs: CALL_TIMEOUT_MS, maxReservations: works.length, works });
const runOf = (stage, works) => { const b = binding(stage, works), id = `b13-${sha256(stableJson(b)).slice(0, 12)}`; return { binding: b, runId: id, outDir: join(RUN_ROOT, id) }; };
const verified = (stage, works, plan) => { const r = runOf(stage, works); return existsSync(r.outDir) ? auditHistory(r.outDir, plan, r.runId) : null; };

function plan(stage, base, bodies) {
  const b0 = base.b0, imageFile = `${b0.image.imgSha256}.${b0.image.ext}`, image = stage !== 'B2';
  const promptText = effectivePromptFor(stage, { id: base.id, catalog: base.catalog, legacy: b0.legacy, imageFile, b1body: bodies.B1, b2body: bodies.B2 });
  const context = stage === 'B2' ? { evidenceIds: b2InputFor(base.id, base.catalog, bodies.B1).visibleSignals.map(s => s.evidenceId) } : stage === 'B3' ? { requestIds: b3Plan(bodies.B2).requestIds } : {};
  const input = { unit: base.id, stage, promptSha256: sha256(promptText) };
  return { spec: { name: base.catalog.title }, workId: base.id, input, binding: { b0: base.binding.b0, prior: stableJson({ B1: bodies.B1 ? sha256(stableJson(bodies.B1)) : null, B2: bodies.B2 ? sha256(stableJson(bodies.B2)) : null }) },
    controllerHolds: {}, inputSha256: sha256(stableJson(input)), promptHash: sha256(promptText),
    command: buildStageCommand({ stage, model: TEST_MODEL, promptText, ...(image ? { imageFile } : {}) }),
    ...(image ? { imageFile, imageSource: join(CORPUS_RUN_DIR, 'imgs', imageFile) } : {}),
    stageSpec: { model: TEST_MODEL, image, allowedTools: image ? ['Read', 'StructuredOutput'] : ['WebSearch', 'WebFetch', 'StructuredOutput'],
      control: out => { const v = validateStageBody(stage, out, context); return { errors: v.ok ? [] : v.errors.map(e => `invalid body: ${e}`) }; },
      ...(stage === 'B2' ? { transcriptCheck: t => { const w = verifyB2WebEvents(parseStreamTranscript(t)); return w.ok ? null : w.reason; } } : {}) } };
}
function plansFor(works) {
  return works.map(id => {
    const base = workBase(id), out = { id, base, B1: plan('B1', base, {}) };
    const h1 = verified('B1', works, out.B1);
    if (h1?.kind === 'accepted') {
      out.B2 = plan('B2', base, { B1: h1.derived.output });
      const h2 = verified('B2', works, out.B2);
      if (h2?.kind === 'accepted' && b3Plan(h2.derived.output).run) out.B3 = plan('B3', base, { B1: h1.derived.output, B2: h2.derived.output });
    }
    return out;
  });
}

// ---- comparison with the banked Sonnet 4.6 output for the same works ----
const PRICE = { 'claude-sonnet-5-5': { in: 2, w5: 2.5, w1: 4, r: 0.2, out: 10 }, 'claude-sonnet-4-6': { in: 3, w5: 3.75, w1: 6, r: 0.3, out: 15 } };
function usageOf(text) {
  const e = JSON.parse(text.trim().split('\n').at(-1)); const u = e.usage || {}, c = u.cache_creation || {}, model = Object.keys(e.modelUsage || {})[0], p = PRICE[model];
  const usd = p ? ((u.input_tokens || 0) * p.in + (c.ephemeral_5m_input_tokens || 0) * p.w5 + (c.ephemeral_1h_input_tokens || 0) * p.w1 + (u.cache_read_input_tokens || 0) * p.r + (u.output_tokens || 0) * p.out) / 1e6 : null;
  return { model, usd, out: u.output_tokens || 0, thinking: u.output_tokens_details?.thinking_tokens ?? 0, webSearches: u.server_tool_use?.web_search_requests ?? null, ms: e.duration_ms ?? null };
}
function banked(id, stage) {
  const dir = join(CORPUS_RUN_DIR, 'works', sha256(id).slice(0, 24)), f = readdirSync(join(dir, 'completions')).find(x => x.startsWith(`${stage.toLowerCase()}-`));
  if (!f) return null;
  const c = readJson(join(dir, 'completions', f));
  const t = readdirSync(join(dir, 'attempts')).filter(x => x.startsWith(`${stage.toLowerCase()}-`) && x.endsWith('.jsonl')).map(x => readFileSync(join(dir, 'attempts', x), 'utf8')).find(x => sha256(x) === c.transcriptSha256);
  return { body: c.body, usage: t ? usageOf(t) : null };
}
const shape = (stage, b) => !b ? null : stage === 'B1' ? { evidence: Object.values(b.evidence || {}).flat().length, delights: (b.visual?.delights || []).length, noteCandidates: (b.noteCandidates || []).length, researchQuestions: (b.researchQuestions || []).length, figures: (b.visual?.figures || []).length }
  : stage === 'B2' ? { factChecks: (b.factChecks || []).length, supported: (b.factChecks || []).filter(f => f.verdict === 'supported').length, sources: new Set((b.factChecks || []).flatMap(f => (f.sources || []).map(s => s.url))).size, b3Requests: (b.targetedVerificationRequests || []).length }
  : { verifications: (b.verifications || []).length, found: (b.verifications || []).filter(v => v.found).length };
export function report(works) {
  const rows = plansFor(works).map(p => {
    const row = { id: p.id, title: p.base.catalog.title, stages: {} };
    for (const stage of ['B1', 'B2', 'B3']) {
      const h = p[stage] ? verified(stage, works, p[stage]) : null, b = banked(p.id, stage);
      const tr = h ? readFileSync(join(runOf(stage, works).outDir, 'works', sha256(p.id).slice(0, 24), 'attempt-1.transcript.jsonl'), 'utf8') : null;
      row.stages[stage] = { s55: h ? { outcome: h.kind, errors: h.derived.errors, usage: usageOf(tr), shape: shape(stage, h.derived.output), seen: stage === 'B1' ? h.derived.output?.seen : undefined } : { outcome: p[stage] ? 'not-run' : 'not-needed' },
        s46: b ? { usage: b.usage, shape: shape(stage, b.body), seen: stage === 'B1' ? b.body.seen : undefined } : null };
    }
    return row;
  });
  const tot = m => rows.reduce((n, r) => n + Object.values(r.stages).reduce((k, s) => k + (s[m]?.usage?.usd || 0), 0), 0);
  return { version: 'passBB13ModelTestReport/1', model: TEST_MODEL, works: rows.length, usd: { s55: +tot('s55').toFixed(3), s46: +tot('s46').toFixed(3) }, rows };
}

async function main() {
  const args = process.argv.slice(2), works = testWorks();
  if (args.includes('--report')) { const r = report(works); writeFileSync(join(RUN_ROOT, `b13-model-test-report.json`), `${JSON.stringify(r, null, 1)}\n`, { mode: 0o600 }); console.log(JSON.stringify(r, null, 1)); return; }
  const live = args.includes('--run');
  if (live && process.env.PASS_B_SHADOW_AUDIT_LIVE !== '1') throw new Error('refusing --run: set PASS_B_SHADOW_AUDIT_LIVE=1');
  console.log(`B1–B3 model test: ${TEST_MODEL} on ${works.length} works with banked Sonnet 4.6 output: ${works.map(id => workBase(id).catalog.title).join('; ')}`);
  for (const s of ['B1', 'B2', 'B3']) { const r = runOf(s, works); console.log(`  ${s}: run ${r.runId}, reservations ${countReservations(r.outDir)}/${works.length}`); }
  if (!live) { console.log('READ-ONLY PLAN: no calls or writes. Max calls 15.'); return; }
  const bin = realpathSync(String((await execFileP('/bin/sh', ['-c', 'command -v claude'])).stdout).trim());
  for (const s of ['B1', 'B2', 'B3']) {
    const ps = plansFor(works).map(p => p[s]).filter(Boolean), r = runOf(s, works);
    const res = await runAudit({ plans: ps, outDir: r.outDir, runId: r.runId, binding: r.binding, callFn: (pl, gate) => callAuditPinned(pl, { bin, timeout: gate.timeout }) });
    console.log(`${s}: ${JSON.stringify(res)}`);
    if (['fatal-provenance', 'preserved-fatal', 'protected-hours', 'usage-limit'].includes(res.stop)) { console.log('stopped'); return; }
  }
  console.log('next: node scripts/pass-b-b13-model-test.mjs --report');
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main().catch(e => { console.error(`FAIL-CLOSED: ${e.message}`); process.exit(1); });
