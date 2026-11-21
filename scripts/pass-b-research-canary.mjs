// VSD-092 six-work canary for the research stopgap (design-2 §2.1). Runs exactly these works through B1–B3 at the
// new version, through the normal cloud wrapper and collector (lease, pacing, hours, epochs, persistence all apply).
// Default is a read-only plan. Nothing here calls a model itself.
//
//   node scripts/pass-b-research-canary.mjs              # plan: works, env, commands, expected calls (no writes)
//   node scripts/pass-b-research-canary.mjs --report     # offline inspection packet + B3 review template (needs data/incoming)
//   PASS_B_RESEARCH_CANARY_LIVE=1 node scripts/pass-b-research-canary.mjs --run
//       phase 1: B1 (fresh, new prompt) + B2 (new contract) + literal source capture. No B3 dispatches: every request
//       waits for inspection. Requires the evidence repo's state/pin.json to name this checkout's HEAD (Codex-reviewed).
//   phase 2: after inspection, PASS_B_RESEARCH_VERSION=stopgap-1 node scripts/pass-b-corpus-collect.mjs --review-b3 <review.json>
//       (offline, on the evidence checkout), push it, then --run again: only the approved physical requests reach B3.
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

// Picked from the research audit's 21 known cases (codex-research/report.md), one per required category.
export const CANARY = Object.freeze([
  { id: 'aic67362', category: 'narrative painting', name: 'El Greco, Saint Martin and the Beggar', audit: 'E17 patch: the cloak-sharing story and its meaning were never explained; NGA describes a different version' },
  { id: 'wikidata:Q18709475', category: 'abstract work', name: 'Kandinsky, White Cross', audit: 'E10 sufficient: negative-space cross from Guggenheim; B3 boxed the cream plane, not the cross' },
  { id: 'cleveland136178', category: 'print', name: 'Dürer, The Flight into Egypt', audit: 'E05 patch: the threat to the child vanished in the WebFetch summary; B3 got documentary requests' },
  { id: 'aic30661', category: 'ritual object', name: 'Khamsa Standard', audit: 'E08 redo: use and technique transferred from another standard; silver vs brass-and-silver unresolved' },
  { id: 'sinmafa_86-12-1', category: 'sculpture', name: 'Malian Archer Figure', audit: 'E13 patch: B1 inferred near life size from a studio photo (61.9 cm); B2 chased looting/TL dating' },
  { id: 'met53573', category: 'poorly documented work', name: 'Landscape Painting of Figure in Woodland Setting', audit: 'E07 redo: the scene is unexplained; catalog medium "Textile" is painting on silk' },
]);
export const CANARY_BUDGET = Object.freeze({ id: 'research-stopgap-canary-1', maxCalls: 20 }); // 6 B1 + 6 B2 + ≤2 retries + ≤6 B3
export const canaryEnv = () => ({
  PASS_B_RESEARCH_VERSION: 'stopgap-1', PASS_B_RESEARCH_ONLY: '1', PASS_B_RESEARCH_FRESH_B1: '1', PASS_B_SCOPE: 'corpus',
  PASS_B_CORPUS_ONLY: CANARY.map(w => w.id).join(','), PASS_B_CALL_BUDGET_ID: CANARY_BUDGET.id, PASS_B_MAX_CALLS: String(CANARY_BUDGET.maxCalls),
});
// Planning numbers from design-2 §3.4 (supplied 40-work measurements: ~168k tokens and ~16.2k output per work for
// B1+B2+B3, B2 ≈ 58% and B3 ≈ 12% of research tokens). Estimates, not quotes; the core-question agenda may fetch more.
export const EXPECTED = Object.freeze({
  phase1: { calls: 12, maxCalls: 14, tokens: '≈0.9M (≈6 × 50k B1 + 6 × 98k B2; most are cache reads)', output: '≈80k' },
  phase2: { calls: '0–6 (one B3 call per work with an approved physical request)', tokens: '≤≈0.12M', output: '≤≈10k' },
});

function plan() {
  console.log('VSD-092 research stopgap canary — READ-ONLY PLAN (no calls, no writes)');
  for (const w of CANARY) console.log(`  ${w.category.padEnd(22)} ${w.id.padEnd(20)} ${w.name}\n  ${''.padEnd(22)} audit: ${w.audit}`);
  console.log('\nEnvironment (added to the routine/laptop wrapper):');
  for (const [k, v] of Object.entries(canaryEnv())) console.log(`  ${k}=${v}`);
  console.log(`\nExpected: phase 1 ${EXPECTED.phase1.calls} calls (up to ${EXPECTED.phase1.maxCalls} with the one B2 validation retry or transport retries), ${EXPECTED.phase1.tokens} tokens, ${EXPECTED.phase1.output} output;`);
  console.log(`          phase 2 ${EXPECTED.phase2.calls}, ${EXPECTED.phase2.tokens} tokens. Shared allowance ${CANARY_BUDGET.id}, cap ${CANARY_BUDGET.maxCalls}.`);
  console.log('\nGates before --run: Codex code review of this branch; owner re-pins state/pin.json to the reviewed commit; broad collection stays paused.');
  console.log('Acceptance (design-2 §2.1): supported essentials or explicit actionable gaps per work; no documentary B3 dispatch; nothing summary-only labeled literal; migration receipts intact. Any failure keeps broad collection paused.');
}

async function report() {
  process.env.PASS_B_RESEARCH_VERSION = 'stopgap-1';
  const C = await import('./pass-b-corpus-collect.mjs');
  const { snapshotLegacy, trustedCatalog } = await import('./lib/pass-b-calibration.mjs');
  const runDir = C.CORPUS_RUN_DIR;
  if (!existsSync(runDir)) throw new Error(`no stopgap run at ${runDir}: run phase 1 first (or point data/incoming at the evidence checkout)`);
  const load = (file, name) => { const w = {}; new Function('window', readFileSync(file, 'utf8'))(w); return w[name]; };
  const pool = load('data/pool.js', 'ARTEFACTUM_POOL'), byId = new Map(pool.map(p => [p.id, p]));
  const teach = (load('data/teach-works.js', 'ARTEFACTUM_CUES') || {}).work || {}, hotspots = load('data/hotspots.js', 'ARTEFACTUM_HOTSPOTS') || {}, vision = load('data/vision.js', 'ARTEFACTUM_VISION') || {};
  const auditIds = new Set(JSON.parse(readFileSync('data/vision-audit.json', 'utf8')).ids || []);
  const works = [], template = { version: 'passBB3DispatchReviewRequest/1', runId: C.CORPUS_RUN_ID, reviewedBy: '', reason: 'VSD-092 canary B3 inspection', reviewedAt: '', works: [] };
  const sha = s => createHash('sha256').update(s).digest('hex');
  for (const w of CANARY) {
    const p = byId.get(w.id), legacy = snapshotLegacy(w.id, { teach, hotspots, vision, auditIds });
    const row = C.inspectWork({ runDir, id: w.id, catalog: trustedCatalog(p), legacy });
    const wd = join(runDir, 'works', sha(w.id).slice(0, 24)), read = f => existsSync(join(wd, f)) ? JSON.parse(readFileSync(join(wd, f), 'utf8')) : null;
    const manifest = read('imports/manifest.json'), coverage = read('research/coverage.json'), capture = read('research/source-capture.json');
    const reqs = row.bodies.B2?.targetedVerificationRequests || [];
    if (reqs.length) template.works.push({ workId: w.id, decisions: reqs.map(r => ({ requestId: r.requestId, whatToLocate: r.whatToLocate, whatToLocateSha256: sha(r.whatToLocate), decision: null, note: '' })) });
    works.push({ ...w, status: row.research?.status, done: row.done, terminalReasons: row.terminalReasons,
      migration: manifest && { sourceRunId: manifest.sourceRunId, b0: manifest.b0.image?.imgSha256, b1Imported: !!manifest.b1, b1NotImported: manifest.b1NotImported },
      b1: row.bodies.B1 ? { seen: row.bodies.B1.seen, uncertainty: row.bodies.B1.uncertainty } : null,
      b2: row.bodies.B2 ? { guideAnswers: row.bodies.B2.guideAnswers, uncertainty: row.bodies.B2.uncertainty, factChecks: row.bodies.B2.factChecks.map(f => ({ claim: f.claim, verdict: f.verdict, urls: f.sources.map(s => s.url) })) } : null,
      coverage: coverage && { gaps: coverage.gaps, coverageStatus: coverage.coverageStatus },
      capture: capture && { status: capture.status, coreLinks: capture.coreLinks, sources: capture.sources.map(s => ({ id: s.id, url: s.url, chain: s.chain, status: s.status, kind: s.kind, httpStatus: s.httpStatus ?? null, fullTextChars: s.fullTextChars ?? 0, storedChars: s.storedChars ?? 0, truncated: s.truncated ?? null, identity: s.identity ?? null, text: s.text ?? null })) },
      b3: { pending: row.research?.b3Pending || [], requests: reqs, verifications: row.bodies.B3?.verifications || null } });
  }
  const out = join(runDir, 'canary'); mkdirSync(out, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  writeFileSync(join(out, `report-${stamp}.json`), `${JSON.stringify({ version: 'passBResearchCanaryReport/1', runId: C.CORPUS_RUN_ID, works }, null, 1)}\n`, { flag: 'wx', mode: 0o600 });
  writeFileSync(join(out, `b3-review-template-${stamp}.json`), `${JSON.stringify(template, null, 1)}\n`, { flag: 'wx', mode: 0o600 });
  for (const w of works) console.log(`${w.category.padEnd(22)} ${w.id.padEnd(20)} ${JSON.stringify(w.status || 'not started')} | gaps ${w.coverage?.gaps?.join(',') ?? '-'} | capture ${w.capture?.status ?? '-'} | B3 pending ${w.b3.pending.length}`);
  console.log(`report + B3 review template written under ${out} (decide every request; documentary/identity requests must be "reject"). No calls.`);
}

function run() {
  if (process.env.PASS_B_RESEARCH_CANARY_LIVE !== '1') throw new Error('refusing --run: set PASS_B_RESEARCH_CANARY_LIVE=1 (owner-authorized canary only)');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const pin = JSON.parse(Buffer.from(execFileSync('gh', ['api', 'repos/katswnt/gesso-pass-b-evidence/contents/state/pin.json?ref=claude/pass-b-state', '--jq', '.content'], { encoding: 'utf8' }), 'base64').toString('utf8')).commit;
  if (pin !== head) throw new Error(`refusing --run: the cloud wrapper runs the pinned commit ${pin}, not this checkout (${head}). Pin the Codex-reviewed commit first.`);
  const r = spawnSync('bash', ['scripts/pass-b-cloud-nightly.sh'], { stdio: 'inherit', env: { ...process.env, ...canaryEnv() } });
  process.exit(r.status ?? 1);
}

const args = process.argv.slice(2);
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  (args[0] === '--run' ? Promise.resolve().then(run) : args[0] === '--report' ? report() : Promise.resolve().then(plan))
    .catch(e => { console.error(`FAIL-CLOSED: ${e.message}`); process.exit(1); });
}
