// Usage pacing for unattended Pass B runs (owner 2026-09-30; Codex review 2026-09-30). Offline decision logic plus
// an append-only observation log. Every CLI call's stream-json transcript carries a rate_limit_event with BOTH
// windows (unifiedWindows.seven_day / five_hour: utilization + resetsAt). We record each observation with the time
// it was observed and decide before EVERY call; no model is ever called just to learn the budget.
//
// Rule (seven-day window, its own resetsAt; never a hardcoded weekday):
//   allowed = min(CEILING, elapsedFractionOfWeek + MARGIN)   -- stay on or near pace, never above the ceiling
//   go only if weekly utilization < allowed AND five-hour utilization < FIVE_HOUR_CEILING
// Missing, stale, or pre-reset readings never mean zero use: a bounded PROBE allowance lets actual work produce
// fresh readings. Native nightly/collector calls share durable probe and call allowances across process restarts
// and schedule firings, because utilization per call is not known in advance.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const PACING_VERSION = 'passBPacing/2';
export const CALL_BUDGET_VERSION = 'passBCallBudget/1';
export const DEFAULTS = Object.freeze({ ceiling: 0.85, margin: 0.03, fiveHourCeiling: 0.9, maxAgeMs: 3 * 3600 * 1000, probeCalls: 2, weekMs: 7 * 24 * 3600 * 1000 });

// The LAST rate_limit_event in a transcript (the freshest reading of that call), or null.
export function rateLimitFrom(transcriptText) {
  let last = null;
  for (const line of String(transcriptText).split('\n')) {
    if (!line.includes('rate_limit_event')) continue;
    try { const e = JSON.parse(line); if (e.type === 'rate_limit_event' && e.rate_limit_info) last = e.rate_limit_info; } catch { /* partial line */ }
  }
  if (!last) return null;
  const w = last.unifiedWindows || {};
  const pick = k => (w[k] && Number.isFinite(w[k].utilization) && Number.isFinite(w[k].resetsAt)) ? { utilization: w[k].utilization, resetsAt: w[k].resetsAt * 1000 } : null;
  const sevenDay = pick('seven_day'), fiveHour = pick('five_hour');
  if (!sevenDay && last.rateLimitType === 'seven_day' && Number.isFinite(last.utilization)) return { sevenDay: { utilization: last.utilization, resetsAt: last.resetsAt * 1000 }, fiveHour: null, status: last.status };
  return sevenDay || fiveHour ? { sevenDay, fiveHour, status: last.status ?? null } : null;
}

export function recordObservation(logPath, transcriptText, { observedAt = new Date(), source = 'unknown' } = {}) {
  const r = rateLimitFrom(transcriptText);
  if (!r) return null;
  const row = { version: PACING_VERSION, observedAt: observedAt.toISOString(), source, ...r };
  mkdirSync(dirname(logPath), { recursive: true, mode: 0o700 });
  appendFileSync(logPath, `${JSON.stringify(row)}\n`, { mode: 0o600 });
  return row;
}
const validWindow = w => w && Number.isFinite(w.utilization) && w.utilization >= 0 && w.utilization <= 1 && Number.isFinite(w.resetsAt);
export function latestObservation(logPath, now = new Date()) {
  if (!existsSync(logPath)) return null;
  const rows = readFileSync(logPath, 'utf8').split('\n').flatMap(line => {
    try { const r = JSON.parse(line); return ['passBPacing/1', PACING_VERSION].includes(r.version) && Number.isFinite(Date.parse(r.observedAt)) && Date.parse(r.observedAt) <= now.getTime() ? [r] : []; }
    catch { return []; }
  }).sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  let best = null, completeKey = null;
  for (const r of rows) {
    best ||= { sevenDay: null, fiveHour: null };
    for (const key of ['sevenDay', 'fiveHour']) {
      const w = r[key];
      if (!validWindow(w) || w.resetsAt <= Date.parse(r.observedAt)) continue;
      // A partial observation cannot erase a known limit in an unreset window.
      const prior = best[key];
      best[key] = { ...w, observedAt: r.observedAt,
        utilization: prior?.resetsAt === w.resetsAt ? Math.max(prior.utilization, w.utilization) : w.utilization };
    }
    if (['sevenDay', 'fiveHour'].every(k => validWindow(r[k]) && r[k].resetsAt > Date.parse(r.observedAt))) completeKey = r.observedAt;
    best.observedAt = r.observedAt;
  }
  return best ? { ...best, completeKey } : null;
}

// Stale readings can forbid spending until their own reset; they cannot establish available capacity.
export function pacingDecision({ obs, now = new Date(), probeUsed = 0, opts = {} }) {
  const o = { ...DEFAULTS, ...opts }, t = now.getTime();
  const current = w => validWindow(w) && w.resetsAt > t;
  const weekly = current(obs?.sevenDay) ? obs.sevenDay : null, five = current(obs?.fiveHour) ? obs.fiveHour : null;
  const elapsed = weekly ? Math.min(1, Math.max(0, 1 - (weekly.resetsAt - t) / o.weekMs)) : null;
  const allowed = elapsed == null ? null : Math.min(o.ceiling, elapsed + o.margin);
  const base = { elapsed, allowed, used: weekly?.utilization ?? null, fiveHour: five?.utilization ?? null };
  if (weekly?.utilization >= o.ceiling) return { go: false, mode: 'stop', reason: `weekly ${Math.round(weekly.utilization * 100)}% at or above the ${Math.round(o.ceiling * 100)}% ceiling`, ...base };
  if (weekly && weekly.utilization >= allowed) return { go: false, mode: 'stop', reason: `weekly ${Math.round(weekly.utilization * 100)}% is ahead of pace (${Math.round(elapsed * 100)}% of the week elapsed)`, ...base };
  if (five?.utilization >= o.fiveHourCeiling) return { go: false, mode: 'stop', reason: `five-hour window ${Math.round(five.utilization * 100)}% used`, ...base };
  const fresh = w => current(w) && Number.isFinite(Date.parse(w.observedAt || obs.observedAt)) &&
    t >= Date.parse(w.observedAt || obs.observedAt) && t - Date.parse(w.observedAt || obs.observedAt) <= o.maxAgeMs;
  if (!fresh(obs?.sevenDay) || !fresh(obs?.fiveHour)) {
    const why = 'missing, stale or pre-reset usage reading';
    return probeUsed < o.probeCalls ? { go: true, mode: 'probe', reason: `${why}; probe call ${probeUsed + 1}/${o.probeCalls}` }
      : { go: false, mode: 'stop', reason: `${why} after ${o.probeCalls} probe calls; stopping (never assume zero use)` };
  }
  return { go: true, mode: 'normal', reason: `weekly ${Math.round(weekly.utilization * 100)}% < allowed ${Math.round(allowed * 100)}%`, ...base };
}

// The optional budget file is shared by the parent, collector and subsequent routine firings. Its allowance
// entries are flushed before the attempt reservation; callers push BOTH before invoking the model. A failed
// reservation may consume an allowance conservatively, never refund one. Existing budget limits cannot change.
export function makePacer({ logPath, maxCalls, now = () => new Date(), opts = {}, statePath = null }) {
  if (!Number.isSafeInteger(maxCalls) || maxCalls < 0) throw new Error('call cap must be a nonnegative integer');
  let calls = 0, memory = { version: CALL_BUDGET_VERSION, limit: maxCalls, allowances: [] };
  const state = () => {
    const s = statePath && existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : memory;
    if (s.version !== CALL_BUDGET_VERSION || s.limit !== maxCalls || !Array.isArray(s.allowances) || s.allowances.length > s.limit ||
        s.allowances.some((a, i) => a.slot !== i + 1 || !Number.isFinite(Date.parse(a.at)) || !(a.probeKey === null || typeof a.probeKey === 'string')))
      throw new Error('call budget binding/history mismatch; preserve for review');
    return s;
  };
  return {
    check() {
      const s = state();
      if (s.allowances.length >= s.limit) return { go: false, mode: 'stop', reason: `session call cap ${maxCalls} reached${statePath ? ' (shared across resumes)' : ''}` };
      const t = now(), obs = latestObservation(logPath, t);
      // Only a complete reading or an observed window's actual reset opens another probe allowance.
      const probeKey = JSON.stringify([obs?.completeKey || null, ...['sevenDay', 'fiveHour'].map(k => obs?.[k]?.resetsAt <= t.getTime() ? obs[k].resetsAt : null)]);
      const probeUsed = s.allowances.filter(a => a.probeKey === probeKey).length;
      const d = pacingDecision({ obs, now: t, probeUsed, opts });
      if (d.go) {
        s.allowances.push({ slot: s.allowances.length + 1, at: t.toISOString(), probeKey: d.mode === 'probe' ? probeKey : null });
        if (statePath) {
          mkdirSync(dirname(statePath), { recursive: true, mode: 0o700 });
          const temp = `${statePath}.tmp-${process.pid}`;
          writeFileSync(temp, `${JSON.stringify(s)}\n`, { flag: 'wx', mode: 0o600, flush: true });
          renameSync(temp, statePath);
        }
        memory = s; calls++;
      }
      return d;
    },
    statePath,
    get calls() { return calls; },
    get remaining() { return Math.max(0, state().limit - state().allowances.length); },
  };
}
