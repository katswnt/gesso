// Offline throughput report from the PRESERVED prior corpus run (no model calls, run unchanged). Honest and
// explicitly labeled: this is a rough extrapolation from a small, interrupted sample — NOT a five-hour-window
// result and NOT a statement of plan capacity.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const RUN = process.argv[2] || 'corpus-b3-d0d9f638d9c1';
const RUN_DIR = join('data/incoming/vision-calibration', RUN);
const REMAINING_CORPUS = Number(process.argv[3] || 6532);

function eventsOf(text) { return text.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
function tsRange(events) { const ts = []; for (const e of events) { const t = e.timestamp || e.message?.timestamp; if (t) ts.push(Date.parse(t)); } return ts.length ? [Math.min(...ts), Math.max(...ts)] : [null, null]; }
function tokensOf(events) { const r = events.find(e => e.type === 'result'); const u = r?.usage || {}; return { input: u.input_tokens || 0, output: u.output_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, cacheCreate: u.cache_creation_input_tokens || 0, durationMs: r?.duration_ms || 0 }; }

function main() {
  const worksDir = join(RUN_DIR, 'works');
  const ledger = existsSync(join(RUN_DIR, 'ledger.json')) ? JSON.parse(readFileSync(join(RUN_DIR, 'ledger.json'), 'utf8')) : { doneIds: [], heldIds: [] };
  const attempts = []; // {work, stage, start, end, tokens}
  const perWork = new Map();
  for (const w of (existsSync(worksDir) ? readdirSync(worksDir) : [])) {
    const ad = join(worksDir, w, 'attempts'); if (!existsSync(ad)) continue;
    for (const f of readdirSync(ad).filter(x => x.endsWith('.transcript.jsonl'))) {
      const stage = (f.match(/^(b[1-4])/) || [])[1]?.toUpperCase() || '?';
      const events = eventsOf(readFileSync(join(ad, f), 'utf8'));
      const [start, end] = tsRange(events); const tok = tokensOf(events);
      attempts.push({ work: w, stage, start, end, tok });
      if (!perWork.has(w)) perWork.set(w, {});
      const pw = perWork.get(w); pw[stage] = pw[stage] || { attempts: 0, input: 0, output: 0 };
      pw[stage].attempts++; pw[stage].input += tok.input; pw[stage].output += tok.output;
    }
  }
  const byStage = attempts.reduce((m, a) => (m[a.stage] = (m[a.stage] || 0) + 1, m), {});
  const withTs = attempts.filter(a => a.start && a.end).sort((x, y) => x.start - y.start);
  const earliest = withTs.length ? new Date(withTs[0].start).toISOString() : null;
  const latest = withTs.length ? new Date(Math.max(...withTs.map(a => a.end))).toISOString() : null;
  // active elapsed = total span minus inter-attempt gaps > 10 minutes
  const TENMIN = 10 * 60 * 1000; let gapsOver = 0; const gaps = [];
  for (let i = 1; i < withTs.length; i++) { const gap = withTs[i].start - withTs[i - 1].end; if (gap > TENMIN) { gapsOver += gap; gaps.push({ afterWork: withTs[i - 1].work, minutes: Math.round(gap / 60000) }); } }
  const totalSpanMs = withTs.length ? (Math.max(...withTs.map(a => a.end)) - withTs[0].start) : 0;
  const activeMs = Math.max(0, totalSpanMs - gapsOver);
  const activeHours = activeMs / 3.6e6;
  const doneCount = (ledger.doneIds || []).length, heldCount = (ledger.heldIds || []).length;
  const totalTokens = attempts.reduce((m, a) => ({ input: m.input + a.tok.input, output: m.output + a.tok.output }), { input: 0, output: 0 });
  // rough per-completed-work rates (sample of `doneCount` completed works)
  const attemptsPerWork = doneCount ? attempts.length / doneCount : 0;
  const activeHoursPerWork = doneCount ? activeHours / doneCount : 0;
  const report = {
    version: 'passBCorpusThroughput/1', run: RUN, disclaimer: 'ROUGH EXTRAPOLATION from a small, usage-limit-interrupted sample. NOT a five-hour-window measurement and NOT a statement of subscription plan capacity.',
    attempts: { total: attempts.length, byStage },
    works: { completed: doneCount, held: heldCount },
    timestamps: { earliest, latest, totalSpanMinutes: Math.round(totalSpanMs / 60000), pauseGapsOver10min: gaps, activeMinutesExclLongGaps: Math.round(activeMs / 60000), activeHoursExclLongGaps: Number(activeHours.toFixed(2)) },
    tokens: { total: totalTokens },
    perCompletedWork: { attempts: Number(attemptsPerWork.toFixed(2)), activeHours: Number(activeHoursPerWork.toFixed(3)) },
    roughProjectionRemaining: { corpusRemaining: REMAINING_CORPUS, projectedAttempts: Math.round(attemptsPerWork * REMAINING_CORPUS), projectedActiveHours: Math.round(activeHoursPerWork * REMAINING_CORPUS), note: 'Multiply-out of a tiny sample; real yield depends on per-work stage conditionality, B2/B3 rates, retries, and (dominant) usage-limit windows which this does NOT model.' },
    perWorkByStage: Object.fromEntries([...perWork.entries()].map(([w, s]) => [w, s])),
  };
  console.log(`THROUGHPUT (preserved run ${RUN}) — ROUGH, interrupted sample`);
  console.log(`attempts ${report.attempts.total} (${JSON.stringify(byStage)}) | completed works ${doneCount} | held ${heldCount}`);
  console.log(`window ${earliest} .. ${latest} | span ${report.timestamps.totalSpanMinutes}min | active(excl >10min gaps) ${report.timestamps.activeMinutesExclLongGaps}min (${report.timestamps.activeHoursExclLongGaps}h) | long gaps: ${gaps.length}`);
  console.log(`tokens total in/out ${totalTokens.input}/${totalTokens.output} | per completed work: ${report.perCompletedWork.attempts} attempts, ${report.perCompletedWork.activeHours}h active`);
  console.log(`ROUGH projection for ${REMAINING_CORPUS} remaining: ~${report.roughProjectionRemaining.projectedAttempts} attempts, ~${report.roughProjectionRemaining.projectedActiveHours} active hours (extrapolation only; usage-limit windows dominate real elapsed and are NOT modeled)`);
  const out = join(RUN_DIR, 'throughput-report.json');
  writeFileSync(out, `${JSON.stringify(report, null, 1)}\n`, { mode: 0o600 });
  console.log(`\nartifact: ${out}`);
}
main();
