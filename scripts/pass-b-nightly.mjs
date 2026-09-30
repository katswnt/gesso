// Nightly Pass B job (VSD-056): finish the NEAREST dailies end to end, then replenish collection.
//   1. Claim-first, date order: every 30-day-window work whose B1–B3 evidence the collector VERIFIES (inspectWork),
//      one work at a time through S1/S2 -> SI -> SJ -> S3 -> S4, until the window is covered or pacing/hours stop.
//      Each finished work's assembled copy is written (quarantined) for the later publication path.
//   2. Optional (--collect): the corpus collector for works still missing B1–B3, under its own gates and pacing.
// Same safeguards as every runner: durable reservation before each call, one attempt per work per stage, provenance,
// pinned binary, VSD-045 hours (00:00–08:30 start, 09:00 finish), VSD-055 pacing before every reservation, fatal stop.
// No publication, approval or production write.
//   node scripts/pass-b-nightly.mjs                 # read-only plan
//   PASS_B_NIGHTLY_LIVE=1 node scripts/pass-b-nightly.mjs --run [--collect]
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { sha256 } from './lib/vision-legacy.mjs';
import { RUN_ROOT, trustedCatalog, snapshotLegacy } from './lib/pass-b-calibration.mjs';
import { CORPUS_RUN_DIR, buildPriorityQueue, inspectWork, pacificClock, USAGE_LOG, SESSION_CALL_CAP } from './pass-b-corpus-collect.mjs';
import { runAudit, auditHistory, callAuditPinned } from './pass-b-shadow-audit.mjs';
import { snapshot } from './pass-b-audit-evidence.mjs';
import { makePacer } from './lib/pass-b-pacing.mjs';
import { remoteRoot, persist } from './lib/pass-b-remote-evidence.mjs';
import * as CF from './lib/pass-b-claim-first.mjs';
import { OPTS, setBaseProvider, stageBinding, stageRunId, planS1, planS2, planSI, planSJ, planS3, planS4 } from './pass-b-claim-first.mjs';

const execFileP = promisify(execFile);
const OUT = join(RUN_ROOT, 'claim-first-nightly'), SNAP = join(RUN_ROOT, 'claim-first-v1', 'snapshots');
const loadGlobal = (file, name) => { const w = {}; new Function('window', readFileSync(file, 'utf8'))(w); return w[name]; };
const HALT = r => ['fatal-provenance', 'preserved-fatal', 'protected-hours', 'usage-limit'].includes(r.stop) || String(r.stop).startsWith('pacing');

export function loadCorpusContext() {
  const pool = loadGlobal('data/pool.js', 'ARTEFACTUM_POOL');
  const daily = loadGlobal('data/daily-order.js', 'ARTEFACTUM_DAILY') || { byDate: {} };
  const teach = (loadGlobal('data/teach-works.js', 'ARTEFACTUM_CUES') || {}).work || {};
  const hotspots = loadGlobal('data/hotspots.js', 'ARTEFACTUM_HOTSPOTS') || {};
  const vision = loadGlobal('data/vision.js', 'ARTEFACTUM_VISION') || {};
  const auditIds = new Set(JSON.parse(readFileSync('data/vision-audit.json', 'utf8')).ids || []);
  return { pool, daily, legacyOf: id => snapshotLegacy(id, { teach, hotspots, vision, auditIds }) };
}

// Base for claim-first from the collector's VERIFIED inspection only (Codex 2026-09-30). null if not ready.
export function verifiedBaseFactory({ pool, legacyOf, runDir = CORPUS_RUN_DIR }) {
  const cache = new Map();
  return id => {
    if (cache.has(id)) return cache.get(id);
    let base = null;
    const p = pool.find(x => x.id === id);
    if (p) {
      const r = inspectWork({ runDir, id, catalog: trustedCatalog(p), legacy: legacyOf(id) });
      if (r.done && !r.fatal && r.bodies.B1 && r.bodies.B2) {
        const dir = join(runDir, 'works', sha256(id).slice(0, 24)), b0Text = readFileSync(join(dir, 'b0-prep.json'), 'utf8');
        base = { id, dir, b0: JSON.parse(b0Text), catalog: JSON.parse(b0Text).trustedCatalog, b1: r.bodies.B1, b2: r.bodies.B2,
          binding: { b0: sha256(b0Text), b1: sha256(JSON.stringify(r.bodies.B1)), b2: sha256(JSON.stringify(r.bodies.B2)) } };
      }
    }
    cache.set(id, base);
    return base;
  };
}

const runOf = key => { const b = stageBinding(key, []), id = stageRunId(b); return { binding: b, runId: id, outDir: join(RUN_ROOT, id) }; };
const historyOf = (key, plan) => { const r = runOf(key); return existsSync(r.outDir) ? auditHistory(r.outDir, plan, r.runId) : null; };
// Status of one work across stages; 'copy' when S4 is accepted.
export function workStatus(base) {
  const s1 = planS1(base), s2 = planS2(base), h1 = historyOf('S1', s1), h2 = historyOf('S2', s2);
  if (!h1 || !h2) return { next: 'S1S2', s1, s2 };
  if (h1.kind !== 'accepted' || h2.kind !== 'accepted') return { next: 'terminal', why: `S1 ${h1.kind}, S2 ${h2.kind}` };
  const si = planSI(base, [], s2), hi = historyOf('SI', si);
  if (!hi) return { next: 'SI', si };
  if (hi.kind !== 'accepted') return { next: 'terminal', why: `SI ${hi.kind}` };
  const sj = planSJ(base, [], si);
  if (sj.plan.input.pairs.length) { const hj = historyOf('SJ', sj.plan); if (!hj) return { next: 'SJ', sj }; if (hj.kind !== 'accepted') return { next: 'terminal', why: `SJ ${hj.kind}` }; }
  const s3 = planS3(base, [], s1, s2, sj), h3 = historyOf('S3', s3.plan);
  if (!h3) return { next: 'S3', s3 };
  if (h3.kind !== 'accepted') return { next: 'terminal', why: `S3 ${h3.kind}` };
  const s4 = planS4(base, [], s3), h4 = historyOf('S4', s4.plan);
  if (!h4) return { next: 'S4', s4 };
  if (h4.kind !== 'accepted') return { next: 'terminal', why: `S4 ${h4.kind}` };
  return { next: 'copy', copy: CF.assemble({ writeAudit: h3.derived.audit, checkAudit: h4.derived.audit, visuals: s3.visuals }), s3 };
}

async function main() {
  const args = process.argv.slice(2), live = args.includes('--run');
  if (live && process.env.PASS_B_NIGHTLY_LIVE !== '1') throw new Error('refusing --run: set PASS_B_NIGHTLY_LIVE=1');
  OPTS.nightly = true; OPTS.identities = true; // model: CF default (Sonnet 5.5)
  const ctx = loadCorpusContext(), clock = pacificClock();
  setBaseProvider(verifiedBaseFactory(ctx));
  const order = buildPriorityQueue(ctx.pool, ctx.daily, { today: clock.date });
  // each work's NEXT daily on or after today (works recur; the first-ever date is irrelevant)
  const dateOf = new Map(); for (const [d, v] of Object.entries(ctx.daily.byDate).filter(([d]) => d >= clock.date).sort(([a], [b]) => a.localeCompare(b))) for (const id of Object.values(v).flat()) if (!dateOf.has(id)) dateOf.set(id, d);
  const counts = { window: order.length, notReady: 0, copy: 0, terminal: 0, pending: 0 }, pending = [];
  for (const id of order) {
    const base = (await import('./pass-b-claim-first.mjs')).workBase(id);
    if (!base) { counts.notReady++; continue; }
    const st = workStatus(base);
    if (st.next === 'copy') counts.copy++; else if (st.next === 'terminal') counts.terminal++; else { counts.pending++; pending.push(id); }
  }
  console.log(`nightly (claim-first ${OPTS.model} + identities) | Pacific ${clock.date} | in start window ${clock.mayStart}`);
  console.log(`  window ${counts.window}: copy done ${counts.copy} | pending ${counts.pending} | terminal ${counts.terminal} | B1–B3 not verified yet ${counts.notReady}`);
  for (const k of ['S1', 'S2', 'SI', 'SJ', 'S3', 'S4']) console.log(`  ${k}: run ${runOf(k).runId}`);
  if (!live) { console.log(`READ-ONLY PLAN: no calls or writes. Next up: ${pending.slice(0, 5).map(id => `${dateOf.get(id)} ${id}`).join('; ')}`); return; }

  const bin = realpathSync(String((await execFileP('/bin/sh', ['-c', 'command -v claude'])).stdout).trim());
  const pacer = makePacer({ logPath: USAGE_LOG, maxCalls: SESSION_CALL_CAP });
  const call = async (key, plan) => { const r = runOf(key); return runAudit({ plans: [plan], outDir: r.outDir, runId: r.runId, binding: r.binding, pacer, usageLog: USAGE_LOG, callFn: (p, gate) => callAuditPinned(p, { bin, timeout: gate.timeout }) }); };
  mkdirSync(SNAP, { recursive: true, mode: 0o700 });
  let stop = null, finished = 0;
  for (const id of pending) {
    if (stop) break;
    const base = (await import('./pass-b-claim-first.mjs')).workBase(id);
    for (const u of [...new Set((base.b2?.factChecks || []).flatMap(f => (f.sources || []).map(s => s.url)).filter(Boolean))]) await snapshot(u, SNAP); // plain GETs, no model
    // Cloud: page snapshots are frozen S1 inputs; push them before any call so a later night never re-fetches a changed page.
    try { persist(remoteRoot(), [SNAP], `snapshots for ${id}`); } catch (e) { stop = `persist-failed: ${e.message}`; break; }
    for (let guard = 0; guard < 8 && !stop; guard++) {
      const st = workStatus(base);
      if (st.next === 'copy') {
        const f = join(OUT, 'copy', dateOf.get(id) || 'undated', `${sha256(id).slice(0, 24)}.json`);
        mkdirSync(join(OUT, 'copy', dateOf.get(id) || 'undated'), { recursive: true, mode: 0o700 });
        if (!existsSync(f)) writeFileSync(f, `${JSON.stringify({ version: 'passBClaimFirstCopy/1', workId: id, date: dateOf.get(id) || null, model: OPTS.model, ...st.copy }, null, 1)}\n`, { flag: 'wx', mode: 0o600 });
        try { persist(remoteRoot(), [f], `copy ${id}`); } catch (e) { stop = `persist-failed: ${e.message}`; }
        finished++; break;
      }
      if (st.next === 'terminal') break;
      const results = st.next === 'S1S2' ? await Promise.all([call('S1', st.s1), call('S2', st.s2)])
        : [await call(st.next, st.next === 'SI' ? st.si : st.next === 'SJ' ? st.sj.plan : st.next === 'S3' ? st.s3.plan : st.s4.plan)];
      const h = results.find(HALT); if (h) stop = h.stop;
    }
  }
  console.log(`claim-first: finished ${finished} work(s) this session; stop=${stop || 'window covered'}; pacer calls ${pacer.calls}`);
  if (!stop && args.includes('--collect')) {
    console.log('collection: handing over to the corpus collector (own gates and pacing)');
    const r = await execFileP('node', ['scripts/pass-b-corpus-collect.mjs', '--run'], { env: { ...process.env, PASS_B_CORPUS_LIVE: '1' }, maxBuffer: 64 * 1024 * 1024 }).catch(e => e);
    console.log(String(r.stdout || '').trim().split('\n').slice(-6).join('\n'));
  }
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main().catch(e => { console.error(`FAIL-CLOSED: ${e.message}`); process.exit(1); });
