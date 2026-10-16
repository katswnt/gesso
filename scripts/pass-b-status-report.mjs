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
const statuses = log.filter(c => /^status:/.test(c.s));
const status = read('state/status.json'), lease = read('state/lease.json'), pin = read('state/pin.json');

// Allowance for the current schedule night (state/call-budgets/nightly-<date>.json, date in the schedule time zone).
const budgets = existsSync(join(EV, 'state', 'call-budgets')) ? readdirSync(join(EV, 'state', 'call-budgets')).filter(f => f.startsWith('nightly-')).sort() : [];
const lastBudget = budgets.at(-1) ? read(`state/call-budgets/${budgets.at(-1)}`) : null;

// Latest usage reading.
let usage = null;
try { const lines = readFileSync(join(EV, 'incoming', 'vision-ops', 'usage-observations.jsonl'), 'utf8').trim().split('\n'); usage = JSON.parse(lines.at(-1)); } catch { /* none */ }

// Plain-words verdict.
const summary = String(status?.summary || '');
let verdict;
const lastActivity = log[0]?.at ? new Date(log[0].at) : null, quietMin = lastActivity ? (Date.now() - lastActivity) / 60000 : Infinity;
if (lease && quietMin <= 60) verdict = `⏳ RUNNING NOW: a run holds the lock (since ${local(lease.acquiredAt)}); last activity ${Math.round(quietMin)} min ago.`;
else if (lease) verdict = `⚠️ STUCK: a run has held the lock since ${local(lease.acquiredAt)} with no activity for ${Number.isFinite(quietMin) ? Math.round(quietMin) + ' min' : 'this whole period'}. It stopped and needs review.`;
else if (status?.exit && status.exit !== 0) verdict = `⚠️ STOPPED ON PURPOSE (${status.updatedAt ? local(status.updatedAt) : "?"}): ${summary.match(/FAIL-CLOSED: [^\n]*/)?.[0] || summary.slice(-160)}`;
else if (/call cap \d+ reached/.test(summary) && reserves === 0) verdict = '⚠️ IDLE: the call allowance is used up, so nothing ran.';
else if (/pacing/.test(summary) && reserves === 0) verdict = 'Paused by usage pacing (the week is ahead of schedule). Nothing is wrong.';
else if (/protected-hours/.test(summary) && reserves === 0) verdict = 'Outside the allowed hours; nothing ran. Nothing is wrong.';
else if (reserves > 0) verdict = '✅ Worked normally.';
else verdict = 'No activity in this period.';

const out = [
  `Gesso nightly (${HOURS}h, times in ${TZ})`,
  verdict,
  `Calls made: ${reserves}${lastBudget ? ` · allowance ${budgets.at(-1).replace(/\.json$/, '')}: ${lastBudget.allowances.length}/${lastBudget.limit}` : ''}`,
  `Works finished (copy written): ${copies.length}${copies.length ? ` (latest ${local(copies[0].at)})` : ''}`,
  fatals.length ? `Fatal outcomes: ${fatals.length}: ${fatals.map(f => f.s.replace(/^outcome /, '')).join('; ')}` : null,
  `Runs completed: ${statuses.length}${statuses[0] ? ` · last ${local(statuses[0].at)}` : ''}`,
  usage ? `Weekly usage: ${Math.round(usage.sevenDay?.utilization * 100)}% · 5-hour: ${Math.round(usage.fiveHour?.utilization * 100)}% (read ${local(usage.observedAt)})` : null,
  `Code pinned: ${pin?.commit?.slice(0, 7) || '?'} · lock: ${lease ? `held by ${lease.holder}` : 'free'}`,
].filter(Boolean);
console.log(out.join('\n'));
