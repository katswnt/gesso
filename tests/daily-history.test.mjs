// Offline contract + integration tests for the decoupled daily-history ledger.
// NEVER touches canonical data: every write happens in a disposable /private/tmp fixture whose large
// read-only corpus files are SYMLINKED and whose two written files (daily-order.js, daily-history.js)
// are real COPIES, so a writer can never reach the real repo through a link.
//   node tests/daily-history.test.mjs
// Bounded env overrides for mutation testing (mirrors the CURATE_MERGE_SCRIPT pattern):
//   DAILY_HISTORY_MODULE=<abs path>   alternate pure module
//   FREEZE_SCRIPT=<abs path>          alternate freeze script (used for the old-code regression)
//   CHECK_POOL_SCRIPT=<abs path>      alternate gate script
import { mkdtempSync, mkdirSync, symlinkSync, copyFileSync, readdirSync, readFileSync,
         writeFileSync, rmSync, existsSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const MOD = process.env.DAILY_HISTORY_MODULE || join(REPO, 'scripts/lib/daily-history.mjs');
const FREEZE = process.env.FREEZE_SCRIPT || join(REPO, 'scripts/freeze-daily.mjs');
const CHECKPOOL = process.env.CHECK_POOL_SCRIPT || join(REPO, 'scripts/check-pool.mjs');
const CLI = join(REPO, 'scripts/record-daily-history.mjs');
const { liveDateSet, servedThroughDate, reconcile, validateRecord, serializeHistory, isIsoDate } = await import(MOD);

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m); } };
const sha = f => createHash('sha256').update(readFileSync(f)).digest('hex');
const ids = n => Array.from({ length: 5 }, (_, i) => `w${n}-${i}`);
const rec = n => ({ easy: ids(n + 'e'), medium: ids(n + 'm'), hard: ids(n + 'h'), impossible: ids(n + 'i') });
const parse = (p, name) => { const g = {}; new Function('window', readFileSync(p, 'utf8'))(g); return g[name].byDate; };

// ---------------------------------------------------------------- pure: live-date model
console.log('\nLIVE-DATE MODEL (UTC-12 … UTC+14)');
{ // 12. exact UTC+14 boundary
  ok('2026-09-01T09:59:59.999Z -> latest live date 2026-09-01', servedThroughDate(Date.parse('2026-09-01T09:59:59.999Z')) === '2026-09-01');
  ok('2026-09-01T10:00:00.000Z -> latest live date 2026-09-02', servedThroughDate(Date.parse('2026-09-01T10:00:00.000Z')) === '2026-09-02');
  // 13. the set covers every distinct date live somewhere
  const s = liveDateSet(Date.parse('2026-09-01T10:00:00.000Z'));
  ok('liveDateSet spans UTC-12 … UTC+14 (>=2 distinct dates, sorted, unique)',
     s.length >= 2 && JSON.stringify(s) === JSON.stringify([...new Set(s)].sort()));
  ok('liveDateSet at that instant contains both 2026-09-01 and 2026-09-02', s.includes('2026-09-01') && s.includes('2026-09-02'));
  const mid = liveDateSet(Date.parse('2026-09-01T00:00:00.000Z'));
  // At exactly UTC midnight the window is Aug 31 12:00 … Sep 1 14:00 — TWO distinct dates.
  ok('liveDateSet at UTC midnight spans exactly [2026-08-31, 2026-09-01]', JSON.stringify(mid) === '["2026-08-31","2026-09-01"]');
}

// ---------------------------------------------------------------- pure: reconciliation
console.log('\nRECONCILIATION');
{ // 1. already current
  const h = { '2026-09-01': rec(1) }, o = { '2026-09-01': rec(1) };
  const r = reconcile({ order: o, history: h, throughDate: '2026-09-01' });
  ok('current ledger: ok, changed=false, nothing added', r.ok && !r.changed && r.addedDates.length === 0);
}
{ // 2. one missing live date
  const r = reconcile({ order: { '2026-09-01': rec(1), '2026-09-02': rec(2) }, history: { '2026-09-01': rec(1) }, throughDate: '2026-09-02' });
  ok('one missing date appended exactly', r.ok && JSON.stringify(r.addedDates) === '["2026-09-02"]');
  ok('appended record equals the daily-order record', JSON.stringify(r.value['2026-09-02']) === JSON.stringify(rec(2)));
}
{ // 3. multiple missed, chronological
  const o = { '2026-09-01': rec(1), '2026-09-02': rec(2), '2026-09-03': rec(3), '2026-09-04': rec(4) };
  const r = reconcile({ order: o, history: { '2026-09-01': rec(1) }, throughDate: '2026-09-04' });
  ok('all missing dates appended in chronological order', r.ok && JSON.stringify(r.addedDates) === '["2026-09-02","2026-09-03","2026-09-04"]');
  ok('result keys are chronological', JSON.stringify(Object.keys(r.value)) === '["2026-09-01","2026-09-02","2026-09-03","2026-09-04"]');
}
{ // 4. existing records untouched  +  5. idempotent second pass
  const h = { '2026-09-01': rec(1) }, o = { '2026-09-01': rec(1), '2026-09-02': rec(2) };
  const r1 = reconcile({ order: o, history: h, throughDate: '2026-09-02' });
  ok('existing record is key/order/JSON-equal after append', JSON.stringify(r1.value['2026-09-01']) === JSON.stringify(h['2026-09-01']));
  const r2 = reconcile({ order: o, history: r1.value, throughDate: '2026-09-02' });
  ok('second reconcile is idempotent (changed=false)', r2.ok && !r2.changed);
  ok('second reconcile is byte-identical', serializeHistory(r2.value) === serializeHistory(r1.value));
}
{ // 6. drift rejected
  const drift = { ...rec(1), easy: ['x1', 'x2', 'x3', 'x4', 'x5'] };
  const r = reconcile({ order: { '2026-09-01': drift }, history: { '2026-09-01': rec(1) }, throughDate: '2026-09-01' });
  ok('tier drift rejected', !r.ok && r.errors.some(e => /ledger drift/.test(e)));
  ok('drift returns no additions and changed=false', r.addedDates.length === 0 && !r.changed);
}
{ // 6b. REORDERED tier is drift too (order-sensitive)
  const ro = { ...rec(1), easy: [...rec(1).easy].reverse() };
  const r = reconcile({ order: { '2026-09-01': ro }, history: { '2026-09-01': rec(1) }, throughDate: '2026-09-01' });
  ok('reordered tier is treated as drift (order-sensitive compare)', !r.ok);
}
{ // 7. malformed shapes each fail closed
  const bad = {
    'missing tier':   (() => { const r = rec(1); delete r.hard; return r; })(),
    'non-array tier': { ...rec(1), medium: 'nope' },
    'four items':     { ...rec(1), easy: ids('a').slice(0, 4) },
    'six items':      { ...rec(1), easy: [...ids('a'), 'extra'] },
    'empty id':       { ...rec(1), easy: ['a', 'b', 'c', 'd', ''] },
    'non-string id':  { ...rec(1), easy: ['a', 'b', 'c', 'd', 7] },
    'duplicate id':   { ...rec(1), easy: ['a', 'b', 'c', 'd', 'd'] },
  };
  for (const [label, r0] of Object.entries(bad)) {
    const r = reconcile({ order: { '2026-09-01': r0 }, history: {}, throughDate: '2026-09-01' });
    ok(`malformed rejected: ${label}`, !r.ok && r.errors.length > 0 && !r.changed);
  }
  ok('validateRecord flags a good record as clean', validateRecord(rec(1), 'x').length === 0);
}
{ // 8. nothing later than throughDate
  const r = reconcile({ order: { '2026-09-01': rec(1), '2026-09-05': rec(5) }, history: {}, throughDate: '2026-09-01' });
  ok('date later than throughDate is not appended', r.ok && !r.value['2026-09-05'] && JSON.stringify(r.addedDates) === '["2026-09-01"]');
}
{ // 9. future entry already in history is rejected
  const r = reconcile({ order: { '2026-09-01': rec(1) }, history: { '2026-09-01': rec(1), '2026-12-01': rec(9) }, throughDate: '2026-09-01' });
  ok('future history entry rejected as corruption', !r.ok && r.errors.some(e => /future-history corruption/.test(e)));
}
{ // 10. unrecoverable gap
  const r = reconcile({ order: { '2026-09-01': rec(1), '2026-09-04': rec(4) }, history: { '2026-09-01': rec(1) }, throughDate: '2026-09-04' });
  ok('unrecoverable gap rejected (absent from BOTH sources)', !r.ok && r.errors.some(e => /unrecoverable gap at 2026-09-02/.test(e)));
  ok('gap rejection writes nothing (changed=false)', !r.changed && r.addedDates.length === 0);
}
{ // 10b. REAL-DATA SHAPE: holes older than the daily-order window are permanent history, not errors.
  // The live ledger has exactly this shape (2026-07-16, 2026-07-29..31 predate the order window).
  const r = reconcile({
    order:   { '2026-08-21': rec(21), '2026-08-22': rec(22) },
    history: { '2026-07-04': rec(4), '2026-07-17': rec(17), '2026-08-21': rec(21) },  // hole at 2026-07-05..16
    throughDate: '2026-08-22' });
  ok('pre-window historical holes do NOT block reconciliation', r.ok && JSON.stringify(r.addedDates) === '["2026-08-22"]');
  ok('pre-window history entries are preserved verbatim', JSON.stringify(r.value['2026-07-04']) === JSON.stringify(rec(4)));
}
{ // 11. empty-history bootstrap
  const r = reconcile({ order: { '2026-09-03': rec(3), '2026-09-04': rec(4) }, history: {}, throughDate: '2026-09-04' });
  ok('empty history bootstraps at the earliest scheduled date', r.ok && JSON.stringify(r.addedDates) === '["2026-09-03","2026-09-04"]');
  ok('bootstrap invents nothing before the schedule begins', !r.value['2026-09-02']);
}

// ---------------------------------------------------------------- fixtures
function mkFixture({ order, history }) {
  const dir = mkdtempSync('/private/tmp/gesso-dh-');
  mkdirSync(join(dir, 'data'));
  for (const f of readdirSync(join(REPO, 'data'))) {
    if (f === 'daily-order.js' || f === 'daily-history.js') continue;
    try { symlinkSync(join(REPO, 'data', f), join(dir, 'data', f)); } catch {}
  }
  writeFileSync(join(dir, 'data/daily-order.js'), `window.ARTEFACTUM_DAILY=${JSON.stringify({ byDate: order })};\n`);
  writeFileSync(join(dir, 'data/daily-history.js'), serializeHistory(history));
  try { symlinkSync(join(REPO, 'index.html'), join(dir, 'index.html')); } catch {}
  return dir;
}
const runCLI = (dir, args) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8' });

console.log('\nCLI (temp fixtures only)');
// CLOCK-RELATIVE FIXTURES. These previously hard-coded 2026-09-01/02, which silently became invalid the
// moment the calendar rolled: reconciliation runs through servedThroughDate(), so a fixture whose schedule
// stops before that date is a legitimate unrecoverable gap and the CLI correctly fails closed. Deriving the
// dates from the clock keeps the fixtures meaningful on every future day without weakening any assertion.
const shiftDate = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const T_THRU = servedThroughDate();          // the date reconciliation runs through, right now
const T_PREV = shiftDate(T_THRU, -1);        // the day before it

{ // 16. --check reports and does not write
  const dir = mkFixture({ order: { [T_PREV]: rec(1), [T_THRU]: rec(2) }, history: { [T_PREV]: rec(1) } });
  const before = sha(join(dir, 'data/daily-history.js'));
  const r = runCLI(dir, ['--check']);
  ok('--check exits nonzero when reconciliation is needed', r.status !== 0);
  ok(`--check names the exact missing date (${T_THRU})`, new RegExp(T_THRU).test(r.stderr || ''));
  ok('--check points at npm run ledger:record', /ledger:record/.test(r.stderr || ''));
  ok('--check wrote nothing', sha(join(dir, 'data/daily-history.js')) === before);
  rmSync(dir, { recursive: true, force: true });
}
{ // 17. --write modifies only daily-history
  const dir = mkFixture({ order: { [T_PREV]: rec(1), [T_THRU]: rec(2) }, history: { [T_PREV]: rec(1) } });
  const orderBefore = sha(join(dir, 'data/daily-order.js'));
  const w = runCLI(dir, ['--write']);
  ok('--write exits 0', w.status === 0);
  const h = parse(join(dir, 'data/daily-history.js'), 'ARTEFACTUM_DAILY_HISTORY');
  ok('--write appended the missing date', !!h[T_THRU]);
  ok('--write appended it verbatim from daily-order', JSON.stringify(h[T_THRU]) === JSON.stringify(rec(2)));
  ok('--write left daily-order.js byte-identical', sha(join(dir, 'data/daily-order.js')) === orderBefore);
  const histAfter = sha(join(dir, 'data/daily-history.js'));
  const w2 = runCLI(dir, ['--write']);
  ok('second --write is a no-op, exit 0', w2.status === 0);
  ok('second --write leaves daily-history byte-identical', sha(join(dir, 'data/daily-history.js')) === histAfter);
  ok('canonical format preserved (no spaces around =)', readFileSync(join(dir, 'data/daily-history.js'), 'utf8').startsWith('window.ARTEFACTUM_DAILY_HISTORY={'));
  rmSync(dir, { recursive: true, force: true });
}
{ // drift must fail closed at the CLI with every file byte-identical
  const drift = { ...rec(1), easy: ['x1', 'x2', 'x3', 'x4', 'x5'] };
  const dir = mkFixture({ order: { [T_THRU]: drift }, history: { [T_THRU]: rec(1) } });
  const hb = sha(join(dir, 'data/daily-history.js')), ob = sha(join(dir, 'data/daily-order.js'));
  const r = runCLI(dir, ['--write']);
  ok('CLI --write refuses on drift', r.status !== 0);
  ok('CLI drift refusal leaves BOTH files byte-identical',
     sha(join(dir, 'data/daily-history.js')) === hb && sha(join(dir, 'data/daily-order.js')) === ob);
  rmSync(dir, { recursive: true, force: true });
}

console.log('\nGATE CLASSIFICATION (check-pool)');
{ // 18. missing recoverable -> warning/exit 0 ; drift -> hard/nonzero
  const through = servedThroughDate();
  const realOrder = parse(join(REPO, 'data/daily-order.js'), 'ARTEFACTUM_DAILY');
  const realHist = parse(join(REPO, 'data/daily-history.js'), 'ARTEFACTUM_DAILY_HISTORY');
  const missing = { ...realHist }; delete missing[through];
  const dirA = mkFixture({ order: realOrder, history: missing });
  const a = spawnSync(process.execPath, [CHECKPOOL], { cwd: dirA, encoding: 'utf8' });
  const outA = (a.stdout || '') + (a.stderr || '');
  ok('missing-but-recoverable history is reported as ledger-missing', /ledger-missing/.test(outA));
  ok('missing-but-recoverable does NOT appear as a hard violation', a.status === 0 && !/ledger-drift/.test(outA));
  ok('missing-but-recoverable does not hard-fail check-pool (exit 0)', a.status === 0);
  ok('warning names ledger:record', /ledger:record/.test(outA));
  rmSync(dirA, { recursive: true, force: true });

  const drifted = { ...realHist };
  const anyServed = Object.keys(drifted).filter(d => realOrder[d] && d <= through).sort().pop();
  drifted[anyServed] = { ...drifted[anyServed], easy: ['zz1', 'zz2', 'zz3', 'zz4', 'zz5'] };
  const dirB = mkFixture({ order: realOrder, history: drifted });
  const b = spawnSync(process.execPath, [CHECKPOOL], { cwd: dirB, encoding: 'utf8' });
  const outB = (b.stdout || '') + (b.stderr || '');
  ok('actual ledger drift is still HARD (nonzero exit + hard violation line)',
     b.status !== 0 && /ledger-drift/.test(outB) && /hard violation/.test(outB));
  rmSync(dirB, { recursive: true, force: true });
}

// ---------------------------------------------------------------- malformed sources must FAIL CLOSED
console.log('\nSTRICT CALENDAR DATES');
{ // 6.
  for (const bad of ['2026-02-29', '2026-02-31', '2023-02-29', '2026-04-31', '2026-13-01', '2026-00-10'])
    ok(`impossible date rejected: ${bad}`, isIsoDate(bad) === false);
  for (const good of ['2024-02-29', '2026-09-01', '2026-12-31'])
    ok(`real date accepted: ${good}`, isIsoDate(good) === true);
  const r = reconcile({ order: { '2026-02-29': rec(1) }, history: {}, throughDate: '2026-03-01' });
  ok('reconcile rejects an impossible date key in daily-order', !r.ok && !r.changed);
}

console.log('\nMALFORMED SOURCES FAIL CLOSED (freeze / check-pool / CLI)');
{
  const GOOD_ORDER = `window.ARTEFACTUM_DAILY=${JSON.stringify({ byDate: { '2026-08-21': rec(21) } })};\n`;
  const GOOD_HIST  = `window.ARTEFACTUM_DAILY_HISTORY=${JSON.stringify({ byDate: { '2026-08-21': rec(21) } })};\n`;
  const BROKEN = {
    'syntax error':     'window.ARTEFACTUM_X={"byDate":{',
    'missing global':   'window.SOMETHING_ELSE={"byDate":{}};\n',
    'non-object byDate':'window.ARTEFACTUM_X={"byDate":[]};\n',
    'missing byDate':   'window.ARTEFACTUM_X={"nope":1};\n',
  };
  const mkRaw = (orderRaw, histRaw) => {
    const dir = mkdtempSync('/private/tmp/gesso-bad-');
    mkdirSync(join(dir, 'data'));
    for (const f of readdirSync(join(REPO, 'data'))) {
      if (f === 'daily-order.js' || f === 'daily-history.js') continue;
      try { symlinkSync(join(REPO, 'data', f), join(dir, 'data', f)); } catch {}
    }
    writeFileSync(join(dir, 'data/daily-order.js'), orderRaw);
    writeFileSync(join(dir, 'data/daily-history.js'), histRaw);
    try { symlinkSync(join(REPO, 'index.html'), join(dir, 'index.html')); } catch {}
    return dir;
  };
  const run = (dir, script) => spawnSync(process.execPath, [script], { cwd: dir, encoding: 'utf8', timeout: 180000 });

  for (const [label, raw] of Object.entries(BROKEN)) {
    for (const target of ['daily-history', 'daily-order']) {
      const g = target === 'daily-history' ? 'ARTEFACTUM_DAILY_HISTORY' : 'ARTEFACTUM_DAILY';
      const bad = raw.replace('ARTEFACTUM_X', g);
      const dir = mkRaw(target === 'daily-order' ? bad : GOOD_ORDER, target === 'daily-history' ? bad : GOOD_HIST);
      const hb = sha(join(dir, 'data/daily-history.js')), ob = sha(join(dir, 'data/daily-order.js'));

      const f = run(dir, FREEZE);                                                    // 1,2,3
      ok(`freeze fails closed on ${target} ${label}`, f.status !== 0);
      ok(`freeze names ${target} in the error`, new RegExp(target).test((f.stderr || '') + (f.stdout || '')));
      ok(`freeze left BOTH daily files byte-identical (${target} ${label})`,
         sha(join(dir, 'data/daily-history.js')) === hb && sha(join(dir, 'data/daily-order.js')) === ob);

      const c = run(dir, CHECKPOOL);                                                 // 4
      const co = (c.stdout || '') + (c.stderr || '');
      ok(`check-pool is HARD ledger-invalid on ${target} ${label}`, c.status !== 0 && /ledger-invalid/.test(co));
      ok(`check-pool does NOT report PASS on ${target} ${label}`, !/PASS — no hard violations/.test(co));

      const cli = spawnSync(process.execPath, [CLI, '--write'], { cwd: dir, encoding: 'utf8' });   // 11
      ok(`ledger --write fails closed on ${target} ${label}`, cli.status !== 0);
      ok(`ledger --write wrote nothing (${target} ${label})`,
         sha(join(dir, 'data/daily-history.js')) === hb && sha(join(dir, 'data/daily-order.js')) === ob);
      rmSync(dir, { recursive: true, force: true });
    }
  }

  { // 5. syntactically VALID but structurally malformed ledger records are HARD
    const bads = {
      'impossible date key': { '2026-02-29': rec(1) },
      'missing tier':        { '2026-08-21': (() => { const r = rec(21); delete r.hard; return r; })() },
      'four-item tier':      { '2026-08-21': { ...rec(21), easy: ids('a').slice(0, 4) } },
      'non-string id':       { '2026-08-21': { ...rec(21), easy: ['a', 'b', 'c', 'd', 9] } },
      'duplicate tier id':   { '2026-08-21': { ...rec(21), easy: ['a', 'b', 'c', 'd', 'd'] } },
    };
    for (const [label, hist] of Object.entries(bads)) {
      const dir = mkRaw(GOOD_ORDER, `window.ARTEFACTUM_DAILY_HISTORY=${JSON.stringify({ byDate: hist })};\n`);
      const c = run(dir, CHECKPOOL);
      const co = (c.stdout || '') + (c.stderr || '');
      ok(`check-pool HARD on structurally malformed ledger: ${label}`, c.status !== 0 && /ledger-invalid/.test(co));
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

console.log('\nFREEZE CONTRACT (real corpus, disposable fixtures)');
// HISTORY-INDEPENDENT BY DESIGN. An earlier revision of this suite extracted the pre-fix freeze with
// `git show HEAD:scripts/freeze-daily.mjs` and asserted that it LOST a served date. That reproduction did
// its job during review, but it was self-invalidating: the moment the fix was committed, HEAD stopped
// containing the broken code and the assertions inverted. Pinning to an ancestor SHA would fail too —
// GitHub Actions uses a shallow checkout, so the ancestor object is not guaranteed to exist in CI.
// The permanent suite therefore enforces the CURRENT contract against the CURRENT freeze only, and
// requires no Git history whatsoever.
{
  const through = servedThroughDate();
  const realOrder = parse(join(REPO, 'data/daily-order.js'), 'ARTEFACTUM_DAILY');
  const realHist  = parse(join(REPO, 'data/daily-history.js'), 'ARTEFACTUM_DAILY_HISTORY');
  const runFreeze = dir => spawnSync(process.execPath, [FREEZE], { cwd: dir, encoding: 'utf8', timeout: 180000 });

  // ---- PRESERVATION: a served date older than the regenerated today-3 window must survive a freeze.
  // This is the behaviour whose absence was the original defect; it is asserted directly, not by
  // comparison against a historical script.
  const staleDate = Object.keys(realOrder).filter(d => realHist[d] && d <= through).sort()[0];
  const holed = { ...realHist }; delete holed[staleDate];
  ok(`selected a served date older than the regenerated window: ${staleDate}`, !!staleDate && !!realOrder[staleDate]);

  const dPres = mkFixture({ order: realOrder, history: holed });
  const rPres = runFreeze(dPres);
  const hPres = rPres.status === 0 ? parse(join(dPres, 'data/daily-history.js'), 'ARTEFACTUM_DAILY_HISTORY') : {};
  ok('freeze runs clean against a stale ledger', rPres.status === 0);
  ok(`freeze PRESERVES ${staleDate} into the ledger before the window is trimmed`, !!hPres[staleDate]);
  ok('the preserved record is verbatim equal to daily-order', JSON.stringify(hPres[staleDate]) === JSON.stringify(realOrder[staleDate]));
  ok(`${staleDate} is absent from the regenerated daily-order window (so the ledger is its only home)`,
     !parse(join(dPres, 'data/daily-order.js'), 'ARTEFACTUM_DAILY')[staleDate]);

  // ---- DETERMINISM: two byte-identical fixtures must freeze to byte-identical outputs, and an
  // already-current ledger must not be semantically disturbed.
  const current = reconcile({ order: realOrder, history: realHist, throughDate: through });
  ok('built an already-reconciled ledger for the determinism fixtures', current.ok);
  const dA = mkFixture({ order: realOrder, history: current.value });
  const dB = mkFixture({ order: realOrder, history: current.value });
  ok('the two fixtures start byte-identical',
     sha(join(dA, 'data/daily-order.js'))   === sha(join(dB, 'data/daily-order.js')) &&
     sha(join(dA, 'data/daily-history.js')) === sha(join(dB, 'data/daily-history.js')));
  const rA = runFreeze(dA), rB = runFreeze(dB);
  ok('determinism: first freeze exits 0', rA.status === 0);
  ok('determinism: second freeze exits 0', rB.status === 0);
  ok('determinism: resulting daily-order.js files are byte-identical',
     sha(join(dA, 'data/daily-order.js')) === sha(join(dB, 'data/daily-order.js')));
  ok('determinism: resulting daily-history.js files are byte-identical',
     sha(join(dA, 'data/daily-history.js')) === sha(join(dB, 'data/daily-history.js')));
  ok('an already-current ledger is not semantically changed by a freeze',
     JSON.stringify(parse(join(dA, 'data/daily-history.js'), 'ARTEFACTUM_DAILY_HISTORY')) === JSON.stringify(current.value));

  for (const d of [dPres, dA, dB]) rmSync(d, { recursive: true, force: true });
}

console.log(`\n${fail ? '❌' : '✅'} daily-history: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
