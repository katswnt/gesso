// Morning status report for the Pass B nightly (owner 2026-10-16: an unreviewed fail-closed stop went unnoticed for
// 8 days). Reads ONLY the evidence repo checkout: no model calls, no writes. Plain words, phone-sized.
//   node scripts/pass-b-status-report.mjs [--evidence ../gesso-pass-b-evidence] [--hours 24]
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2), opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const EV = resolve(opt('--evidence', process.env.PASS_B_REMOTE_EVIDENCE || '../gesso-pass-b-evidence'));
const HOURS = Number(opt('--hours', 24));
const TZ = (() => { try { return JSON.parse(readFileSync(join(EV, 'state', 'schedule.json'), 'utf8')).timeZone; } catch { return 'America/Los_Angeles'; } })();
const read = p => { try { return JSON.parse(readFileSync(join(EV, p), 'utf8')); } catch { return null; } };
const local = iso => new Date(iso).toLocaleString('en-GB', { timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit' });

const log = execFileSync('git', ['-C', EV, 'log', `--since=${HOURS} hours ago`, '--format=%aI\t%s'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
  .map(l => { const [at, ...s] = l.split('\t'); return { at, s: s.join('\t') }; });
const count = re => log.filter(c => re.test(c.s)).length;
const reserves = count(/^reserve /), copies = log.filter(c => /^copy /.test(c.s)), fatals = log.filter(c => /: fatal$/.test(c.s));
const statuses = log.filter(c => /^status:/.test(c.s)), recoveries = log.filter(c => /^lease: recover crashed /.test(c.s));
const status = read('state/status.json'), lease = read('state/lease.json'), pin = read('state/pin.json');

// Allowance for the current schedule night (state/call-budgets/nightly-<date>.json, date in the schedule time zone).
const budgets = existsSync(join(EV, 'state', 'call-budgets')) ? readdirSync(join(EV, 'state', 'call-budgets')).filter(f => /^(nightly|slot)-/.test(f)).sort() : [];
const lastBudget = budgets.at(-1) ? read(`state/call-budgets/${budgets.at(-1)}`) : null;

// Latest usage reading.
let usage = null;
try { const lines = readFileSync(join(EV, 'incoming', 'vision-ops', 'usage-observations.jsonl'), 'utf8').trim().split('\n'); usage = JSON.parse(lines.at(-1)); } catch { /* none */ }

// Plain-words verdict.
const summary = String(status?.summary || '');
let verdict;
const lastActivity = log[0]?.at ? new Date(log[0].at) : null, quietMin = lastActivity ? (Date.now() - lastActivity) / 60000 : Infinity;
if (lease && quietMin <= 60) verdict = `⏳ RUNNING NOW: a run holds the lock (since ${local(lease.acquiredAt)}); last activity ${Math.round(quietMin)} min ago.`;
else if (lease && /^(routine|schedule)-/.test(lease.holder) && !(status?.holder === lease.holder && Number(status.exit) !== 0))
  verdict = `🔧 A run crashed (lock held since ${local(lease.acquiredAt)}, quiet ${Number.isFinite(quietMin) ? Math.round(quietMin) + ' min' : 'all period'}). The next firing recovers it automatically after 90 quiet minutes.`;
else if (lease) verdict = `⚠️ STUCK: a run has held the lock since ${local(lease.acquiredAt)} with no activity for ${Number.isFinite(quietMin) ? Math.round(quietMin) + ' min' : 'this whole period'}. It stopped and needs review.`;
else if (status?.exit && status.exit !== 0) verdict = `⚠️ STOPPED ON PURPOSE (${status.updatedAt ? local(status.updatedAt) : "?"}): ${summary.match(/FAIL-CLOSED: [^\n]*/)?.[0] || summary.slice(-160)}`;
else if (/call cap \d+ reached/.test(summary) && reserves === 0) verdict = '⚠️ IDLE: the call allowance is used up, so nothing ran.';
else if (/pacing/.test(summary) && reserves === 0) verdict = 'Paused by usage pacing (the week is ahead of schedule). Nothing is wrong.';
else if (/protected-hours/.test(summary) && reserves === 0) verdict = 'Outside the allowed hours; nothing ran. Nothing is wrong.';
else if (reserves > 0) verdict = '✅ Worked normally.';
else verdict = 'No activity in this period.';

// Alarm mode (owner 2026-10-21, after a 2.5-day silent stall): print one loud line when the pipeline is stuck, else "OK".
// Stuck = a deliberate stop holding the lock, a lock nobody has touched for 4 h (self-healing should have acted by
// then), or no calls for 6 h while nothing explains it (pacing, usage limit, allowance). Alerts at the first check
// after the stall starts, then once a day (the 09:00–10:59 local check) until it is fixed.
if (args.includes('--alarm')) {
  const now = Date.now(), H = 3600000, lastAt = re => { const c = log.find(x => re.test(x.s)); return c ? Date.parse(c.at) : null; };
  const lastPush = log[0] ? Date.parse(log[0].at) : 0, lastReserve = lastAt(/^reserve /);
  let since = null, why = null;
  if (lease && status?.holder === lease.holder && Number(status.exit) !== 0) { since = Date.parse(status.updatedAt); why = `stopped on purpose: ${summary.match(/FAIL-CLOSED: [^\n]*/)?.[0] || summary.slice(-160)}`; }
  else if (lease && now - lastPush > 4 * H) { since = lastPush + 4 * H; why = `lock held by ${lease.holder} with no activity since ${local(new Date(lastPush).toISOString())}`; }
  else if (!lease && !/pacing|usage-limit|call cap/.test(summary) && now - (lastReserve || 0) > 6 * H) { since = (lastReserve || now - 6 * H) + 6 * H; why = `no calls since ${lastReserve ? local(new Date(lastReserve).toISOString()) : 'over ' + HOURS + ' h'}; last status: ${summary.slice(-120) || 'none'}`; }
  const hour = Number(new Date().toLocaleString('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }));
  if (!since) console.log('OK');
  else if (now - since <= 125 * 60000 || hour === 9 || hour === 10) console.log(`ALERT: Gesso pipeline stuck since ${local(new Date(since).toISOString())}: ${why}`);
  else console.log(`STILL STUCK (already alerted): since ${local(new Date(since).toISOString())}: ${why}`);
  process.exit(0);
}
const out = [
  `Gesso nightly (${HOURS}h, times in ${TZ})`,
  verdict,
  `Calls made: ${reserves}${lastBudget ? ` · allowance ${budgets.at(-1).replace(/\.json$/, '')}: ${lastBudget.allowances.length}/${lastBudget.limit}` : ''}`,
  `Works finished (copy written): ${copies.length}${copies.length ? ` (latest ${local(copies[0].at)})` : ''}`,
  fatals.length ? `Fatal outcomes: ${fatals.length}: ${fatals.map(f => f.s.replace(/^outcome /, '')).join('; ')}` : null,
  recoveries.length ? `Self-healed: recovered ${recoveries.length} crashed run lock(s) (${recoveries.map(r => local(r.at)).join(', ')})` : null,
  `Runs completed: ${statuses.length}${statuses[0] ? ` · last ${local(statuses[0].at)}` : ''}`,
  usage ? `Weekly usage: ${Math.round(usage.sevenDay?.utilization * 100)}% · 5-hour: ${Math.round(usage.fiveHour?.utilization * 100)}% (read ${local(usage.observedAt)})` : null,
  `Code pinned: ${pin?.commit?.slice(0, 7) || '?'} · lock: ${lease ? `held by ${lease.holder}` : 'free'}`,
].filter(Boolean);
console.log(out.join('\n'));
