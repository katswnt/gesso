// Claim-first trial (owner 2026-09-29): 20 upcoming dailies through S1 judge claims -> S2 confirm visuals ->
// S3 write from supported items -> S4 check sentences. Same safeguards as the shadow audits (durable reservations,
// one attempt per work per stage, subscription provenance, pinned binary, VSD-045 hours, fatal stop, image
// confinement for S2). Quarantined output; no publication, approval or production write.
//   node scripts/pass-b-claim-first.mjs --snapshot   # plain GETs of cited pages (no model calls)
//   node scripts/pass-b-claim-first.mjs              # read-only plan
//   PASS_B_SHADOW_AUDIT_LIVE=1 [PASS_B_SHADOW_AUDIT_HOURS_EXCEPTION=YYYY-MM-DD] node scripts/pass-b-claim-first.mjs --run
//   node scripts/pass-b-claim-first.mjs --report     # offline scoring + review page
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { sha256, stableJson } from './lib/vision-legacy.mjs';
import { RUN_ROOT, CALIBRATION_MODEL, buildStageCommand } from './lib/pass-b-calibration.mjs';
import { stagePrompts } from './lib/pass-b-prompts.mjs';
import { CORPUS_RUN_DIR, pacificClock } from './pass-b-corpus-collect.mjs';
import { CALL_TIMEOUT_MS } from './pass-b-b4-structured-canary.mjs';
import { runAudit, auditHistory, countReservations, preservedFatal, callAuditPinned, loadB2 } from './pass-b-shadow-audit.mjs';
import { snapshot, snapshotTextV2 } from './pass-b-audit-evidence.mjs';
import * as CF from './lib/pass-b-claim-first.mjs';

const execFileP = promisify(execFile);
const OUT = join(RUN_ROOT, 'claim-first-v1'), SNAP = join(OUT, 'snapshots');
const safeWork = id => sha256(id).slice(0, 24);
const readJson = p => JSON.parse(readFileSync(p, 'utf8'));
const loadGlobal = (file, name) => { const w = {}; new Function('window', readFileSync(file, 'utf8'))(w); return w[name]; };
export const TRIAL = { primaryDate: '2026-10-02', fillDate: '2026-10-03', size: 20 };
// Per-trial model (owner 2026-09-30: Sonnet 5.5 pilot). Bound into every stage binding, so each model gets its own
// runs; the provenance check requires exactly this model.
export const OPTS = { model: CALIBRATION_MODEL, size: TRIAL.size };

// ---------- trial works: B1+B2 captured in the corpus run ----------
function completion(id, stage) {
  const dir = join(CORPUS_RUN_DIR, 'works', safeWork(id), 'completions');
  if (!existsSync(dir)) return null;
  const hit = readdirSync(dir).find(x => x.startsWith(`${stage.toLowerCase()}-`));
  if (!hit) return null;
  const text = readFileSync(join(dir, hit), 'utf8');
  return { body: JSON.parse(text).body, sha256: sha256(text) };
}

export function trialWorks() {
  const daily = loadGlobal('data/daily-order.js', 'ARTEFACTUM_DAILY');
  const ids = d => Object.values(daily.byDate[d] || {}).flat();
  const ready = id => completion(id, 'B1') && completion(id, 'B2');
  const out = ids(TRIAL.primaryDate).filter(ready);
  for (const id of ids(TRIAL.fillDate)) { if (out.length >= TRIAL.size) break; if (ready(id) && !out.includes(id)) out.push(id); }
  return out.slice(0, OPTS.size);
}

export function workBase(id) {
  const dir = join(CORPUS_RUN_DIR, 'works', safeWork(id));
  const b0 = readJson(join(dir, 'b0-prep.json'));
  const b1 = completion(id, 'B1'), b2 = completion(id, 'B2');
  return { id, dir, b0, catalog: b0.trustedCatalog, b1: b1.body, b2: b2.body, binding: { b0: sha256(readFileSync(join(dir, 'b0-prep.json'), 'utf8')), b1: b1.sha256, b2: b2.sha256 } };
}
const citedUrls = b2 => [...new Set((b2?.factChecks || []).flatMap(fc => (fc.sources || []).map(s => s.url)).filter(Boolean))];
const pageFor = url => { const key = sha256(url).slice(0, 24); return existsSync(join(SNAP, `${key}.meta.json`)) ? snapshotTextV2(key, SNAP) : null; };

// ---------- stage bindings and plans ----------
const STAGES = {
  S1: { tag: 'judge-claims', stage: 'B4', prompt: CF.S1.prompt, schema: CF.S1.schema, version: CF.S1.version, control: CF.S1.control },
  S2: { tag: 'confirm-visuals', stage: 'B3', prompt: stagePrompts().B3, schema: null, version: null, control: CF.controlConfirm, image: true, effort: 'low' }, // low effort: pilot 1 spent half its output here
  S3: { tag: 'write', stage: 'B4', prompt: CF.WRITE_PROMPT, schema: CF.WRITE_WIRE_SCHEMA, version: CF.WRITE_VERSION, control: CF.controlWrite },
  S4: { tag: 'check', stage: 'B4', prompt: CF.CHECK_PROMPT, schema: CF.CHECK_WIRE_SCHEMA, version: CF.CHECK_VERSION, control: CF.controlCheck },
};
export function stageBinding(key, works) {
  const st = STAGES[key];
  const command = buildStageCommand({ stage: st.stage, model: OPTS.model, effort: st.effort || null, promptText: '<per-work>', ...(st.schema ? { wireSchema: st.schema } : {}), ...(st.image ? { imageFile: `${'0'.repeat(64)}.jpg` } : {}) });
  // Only stages that changed after pilot 1 get new bindings: S2 (effort), S3 (write /2), S4 (checks /2 output).
  // S1 is unchanged, so its accepted pilot-1 results are reused, not re-called.
  const changes = { S2: { effort: st.effort }, S3: { write: CF.WRITE_VERSION }, S4: { write: CF.WRITE_VERSION } }[key] || {};
  return { version: `${CF.CLAIM_FIRST_VERSION}:${key}:${st.tag}`, model: OPTS.model, ...changes, promptSha256: sha256(st.prompt), wireSchemaSha256: command.wireSchemaSha256,
    toolsEnforced: command.toolsEnforced, removeKeys: command.env.removeKeys, callTimeoutMs: CALL_TIMEOUT_MS, maxReservations: works.length, works };
}
export const stageRunId = binding => `cf-${sha256(stableJson(binding)).slice(0, 12)}`;
const stageSpec = key => ({ model: OPTS.model, version: STAGES[key].version, allowedTools: STAGES[key].image ? ['Read', 'StructuredOutput'] : ['StructuredOutput'], image: !!STAGES[key].image, control: STAGES[key].control });

function mkPlan(key, base, input, binding, extra = {}) {
  const st = STAGES[key];
  let promptText, command;
  if (st.image) {
    const imageFile = `${base.b0.image.imgSha256}.${base.b0.image.ext}`;
    promptText = `${st.prompt}\n\nThe working directory contains exactly one image file: ./${imageFile}\nCall the Read tool on ./${imageFile}, then answer ONLY these targeted requests.\n\nLOCATE:\n${JSON.stringify(CF.confirmRequests(input.candidates))}`;
    command = buildStageCommand({ stage: 'B3', model: OPTS.model, effort: st.effort || null, promptText, imageFile });
    Object.assign(extra, { imageFile, imageSource: join(CORPUS_RUN_DIR, 'imgs', imageFile) });
  } else {
    promptText = `${st.prompt}\n\nINPUTS:\n${JSON.stringify(input)}`;
    command = buildStageCommand({ stage: st.stage, model: OPTS.model, promptText, wireSchema: st.schema });
  }
  return { spec: { name: base.catalog?.title || base.id }, workId: base.id, stageSpec: stageSpec(key), input, binding, controllerHolds: {},
    inputSha256: sha256(stableJson(input)), promptHash: sha256(promptText), command, ...extra };
}

export function planS1(base) {
  const b2 = loadB2(base.dir);
  const digest = url => { const f = b2.fetches.find(x => x.url === url && x.status === 'fetched'); return f ? f.digest : null; };
  const input = CF.buildClaimJudgmentInput({ workId: base.id, catalog: base.catalog, b2: base.b2, page: pageFor, digest });
  return mkPlan('S1', base, input, { ...base.binding, pages: citedUrls(base.b2).map(u => pageFor(u)?.textSha256 || null) });
}
export function planS2(base) {
  const candidates = CF.visualCandidates(base.b1);
  return mkPlan('S2', base, { unit: base.id, candidates }, { ...base.binding });
}
const runDirFor = (key, works) => { const b = stageBinding(key, works), id = stageRunId(b); return { binding: b, runId: id, outDir: join(RUN_ROOT, id) }; };
const verified = (key, works, plan) => { const r = runDirFor(key, works); return existsSync(r.outDir) ? auditHistory(r.outDir, plan, r.runId) : null; };

export function planS3(base, works, s1Plan, s2Plan) {
  const h1 = verified('S1', works, s1Plan), h2 = verified('S2', works, s2Plan);
  if (h1?.kind !== 'accepted' || h2?.kind !== 'accepted') return null;
  const claims = CF.supportedClaims(s1Plan.input, h1.derived.audit), visuals = CF.confirmedVisuals(h2.derived.audit);
  const input = CF.buildWriteInput({ workId: base.id, catalog: base.catalog, claims, visuals });
  return { plan: mkPlan('S3', base, input, { ...base.binding, s1: h1.meta.resultSha256, s2: h2.meta.resultSha256 }), claims, visuals };
}
export function planS4(base, works, s3) {
  if (!s3) return null;
  const h3 = verified('S3', works, s3.plan);
  if (h3?.kind !== 'accepted') return null;
  const input = CF.buildCheckInput({ workId: base.id, writeInput: s3.plan.input, writeAudit: h3.derived.audit });
  return { plan: mkPlan('S4', base, input, { ...base.binding, s3: h3.meta.resultSha256 }), h3 };
}

function allPlans(works) {
  return works.map(id => {
    const base = workBase(id), s1 = planS1(base), s2 = planS2(base);
    const s3 = planS3(base, works, s1, s2), s4 = planS4(base, works, s3);
    return { id, base, s1, s2, s3, s4 };
  });
}

// ---------- report ----------
function tokensOf(h) {
  const u = h?.derived?.evidence?.usage; if (!u) return null;
  return { input: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), output: u.output_tokens || 0, thinking: u.output_tokens_details?.thinking_tokens ?? 0, ms: h.meta?.durationMs ?? 0 };
}
export function report(works) {
  const rows = allPlans(works).map(w => {
    const h = { S1: verified('S1', works, w.s1), S2: verified('S2', works, w.s2), S3: w.s3 ? verified('S3', works, w.s3.plan) : null, S4: w.s4 ? verified('S4', works, w.s4.plan) : null };
    const out = { id: w.id, title: w.base.catalog?.title, outcomes: Object.fromEntries(Object.entries(h).map(([k, v]) => [k, v?.kind || 'not-run'])),
      tokens: Object.fromEntries(Object.entries(h).map(([k, v]) => [k, tokensOf(v)])) };
    out.claims = { total: w.s1.input.pairs.length, supported: h.S1?.kind === 'accepted' ? CF.supportedClaims(w.s1.input, h.S1.derived.audit).length : null };
    out.visuals = { candidates: w.s2.input.candidates.length, confirmed: h.S2?.kind === 'accepted' ? CF.confirmedVisuals(h.S2.derived.audit).length : null };
    if (h.S3?.kind === 'accepted' && h.S4?.kind === 'accepted') {
      const a = CF.assemble({ writeAudit: h.S3.derived.audit, checkAudit: h.S4.derived.audit, visuals: w.s3.visuals });
      Object.assign(out, { sentences: h.S3.derived.audit.sentences.length, trimmed: a.trimmed, anchorIssues: h.S3.derived.audit.anchorIssues, copy: { why: a.why, notes: a.notes, hotspots: a.hotspots }, usable: a.usable });
    }
    return out;
  });
  const sumTok = k => rows.reduce((n, r) => n + Object.values(r.tokens).reduce((m, t) => m + (t?.[k] || 0), 0), 0);
  const usable = { minimal: rows.filter(r => r.usable?.minimal).length, strict: rows.filter(r => r.usable?.strict).length };
  const total = { input: sumTok('input'), output: sumTok('output'), thinking: sumTok('thinking'), ms: sumTok('ms') };
  const per = n => n ? { input: Math.round(total.input / n), output: Math.round(total.output / n), thinking: Math.round(total.thinking / n) } : null;
  return { version: 'passBClaimFirstReport/1', works: rows.length, usable, withWhy: rows.filter(r => r.copy?.why).length,
    withNotes: rows.filter(r => r.copy?.notes.length).length, withHotspots: rows.filter(r => r.copy?.hotspots.length).length,
    trimmedSentences: rows.reduce((n, r) => n + (r.trimmed?.length || 0), 0), totalSentences: rows.reduce((n, r) => n + (r.sentences || 0), 0),
    tokens: { total, perUsableStrict: per(usable.strict), perUsableMinimal: per(usable.minimal), byStage: Object.fromEntries(['S1', 'S2', 'S3', 'S4'].map(k => [k, rows.reduce((n, r) => n + (r.tokens[k]?.output || 0), 0)])) },
    rows };
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function reviewPage(rep, works) {
  const cards = rep.rows.map(r => {
    const base = workBase(r.id), img = `../corpus-b3-6401bc543ead/imgs/${base.b0.image.imgSha256}.${base.b0.image.ext}`;
    const copy = r.copy ? `<h4>Why</h4><p>${esc(r.copy.why || '(none survived)')}</p><h4>Notes</h4>${r.copy.notes.map(n => `<p><b>${esc(n.head)}</b> ${esc(n.body)}</p>`).join('') || '<p>(none)</p>'}
      <h4>Hotspots</h4>${r.copy.hotspots.map(h => `<p><b>${esc(h.head)}</b> <span class="m">(${Math.round(h.x * 100)}%, ${Math.round(h.y * 100)}%)</span> ${esc(h.body)}</p>`).join('') || '<p>(none)</p>'}
      <details><summary>${r.trimmed.length} trimmed sentence(s)</summary>${r.trimmed.map(t => `<p class="m"><s>${esc(t.s)}</s> — ${esc(t.why)}</p>`).join('')}</details>` : `<p class="m">Incomplete: ${esc(JSON.stringify(r.outcomes))}</p>`;
    return `<section><h3>${esc(r.title)} <span class="m">${r.usable?.strict ? 'usable (strict)' : r.usable?.minimal ? 'usable (minimal)' : 'not usable'}</span></h3><div class="g"><a href="${esc(img)}" target="_blank"><img src="${esc(img)}" alt="" loading="lazy"></a><div>${copy}</div></div></section>`;
  }).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Claim-first trial</title><style>body{margin:0;padding:16px;font:15px/1.5 system-ui;background:#faf8f2;color:#1b1916}section{background:#fff;border:1px solid #ddd8ca;border-radius:6px;padding:12px;margin:0 0 16px}.g{display:grid;grid-template-columns:minmax(0,300px) 1fr;gap:16px}@media(max-width:700px){.g{grid-template-columns:1fr}}img{width:100%}.m{color:#6b6557;font-size:13px}</style></head><body><h2>Claim-first trial: ${rep.usable.strict}/${rep.works} usable (strict), ${rep.usable.minimal}/${rep.works} (minimal)</h2>${cards}</body></html>`;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = k => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
  if (opt('--model')) OPTS.model = opt('--model');
  if (opt('--works')) OPTS.size = Math.max(1, Math.min(TRIAL.size, Number(opt('--works'))));
  const works = trialWorks();
  mkdirSync(SNAP, { recursive: true, mode: 0o700 });
  if (args.includes('--snapshot')) {
    const urls = [...new Set(works.flatMap(id => citedUrls(workBase(id).b2)))];
    let ok = 0; for (const u of urls) { const m = await snapshot(u, SNAP); if (m.ok) ok++; else console.log(`  miss ${m.error}: ${u}`); }
    console.log(`snapshots: ${ok}/${urls.length} cited pages`); return;
  }
  if (args.includes('--report')) {
    const rep = report(works);
    const tag = `${OPTS.model}-${works.length}w-${runDirFor('S3', works).runId}`;
    writeFileSync(join(OUT, `report-${tag}.json`), `${JSON.stringify(rep, null, 1)}\n`, { mode: 0o600 });
    writeFileSync(join(OUT, `review-${tag}.html`), reviewPage(rep, works), { mode: 0o600 });
    console.log(`wrote report-${tag}.json and review-${tag}.html`);
    const { rows, ...summary } = rep; console.log(JSON.stringify(summary, null, 1)); return;
  }
  const live = args.includes('--run');
  if (live && process.env.PASS_B_SHADOW_AUDIT_LIVE !== '1') throw new Error('refusing --run: set PASS_B_SHADOW_AUDIT_LIVE=1');
  const plans = allPlans(works), clock = pacificClock();
  console.log(`claim-first trial: model ${OPTS.model} | ${works.length} works (${TRIAL.primaryDate} + fill from ${TRIAL.fillDate}) | Pacific ${clock.date} | in start window ${clock.mayStart} | hours exception today ${process.env.PASS_B_SHADOW_AUDIT_HOURS_EXCEPTION === clock.date}`);
  for (const key of ['S1', 'S2', 'S3', 'S4']) { const r = runDirFor(key, works); console.log(`  ${key} ${STAGES[key].tag}: run ${r.runId}, reservations ${countReservations(r.outDir)}/${works.length}${preservedFatal(r.outDir) ? ' PRESERVED FATAL' : ''}`); }
  const claims = plans.reduce((n, p) => n + p.s1.input.pairs.length, 0), cands = plans.reduce((n, p) => n + p.s2.input.candidates.length, 0);
  const pagesHave = plans.reduce((n, p) => n + citedUrls(p.base.b2).filter(u => pageFor(u)).length, 0), pagesAll = plans.reduce((n, p) => n + citedUrls(p.base.b2).length, 0);
  console.log(`  inputs: ${claims} research claims, ${cands} visual candidates, cited pages snapshotted ${pagesHave}/${pagesAll}; max calls ${works.length * 4}`);
  if (!live) { console.log('READ-ONLY PLAN: no calls or writes.'); return; }
  const bin = realpathSync(String((await execFileP('/bin/sh', ['-c', 'command -v claude'])).stdout).trim());
  const run = async (key, ps) => { const r = runDirFor(key, works); const res = await runAudit({ plans: ps, outDir: r.outDir, runId: r.runId, binding: r.binding, callFn: (plan, gate) => callAuditPinned(plan, { bin, timeout: gate.timeout }) }); console.log(`${key}: ${JSON.stringify(res)}`); return res; };
  const [r1, r2] = await Promise.all([run('S1', plans.map(p => p.s1)), run('S2', plans.map(p => p.s2))]);
  if ([r1, r2].some(r => ['fatal-provenance', 'preserved-fatal', 'protected-hours', 'usage-limit'].includes(r.stop))) { console.log('stopped before writing'); return; }
  const p3 = allPlans(works).map(p => p.s3?.plan).filter(Boolean);
  const r3 = await run('S3', p3);
  if (['fatal-provenance', 'preserved-fatal', 'protected-hours', 'usage-limit'].includes(r3.stop)) { console.log('stopped before checking'); return; }
  const p4 = allPlans(works).map(p => p.s4?.plan).filter(Boolean);
  await run('S4', p4);
  console.log('next: node scripts/pass-b-claim-first.mjs --report');
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main().catch(e => { console.error(`FAIL-CLOSED: ${e.message}`); process.exit(1); });
