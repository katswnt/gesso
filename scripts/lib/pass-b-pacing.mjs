// Usage pacing for unattended Pass B runs (owner 2026-09-30; Codex review 2026-09-30). Offline decision logic plus
// an append-only observation log. Every CLI call's stream-json transcript carries a rate_limit_event with BOTH
// windows (unifiedWindows.seven_day / five_hour: utilization + resetsAt). We record each observation with the time
// it was observed and decide before EVERY call; no model is ever called just to learn the budget.
//
// Rule (seven-day window, its own resetsAt; never a hardcoded weekday):
//   allowed = min(CEILING, elapsedFractionOfWeek + MARGIN)   -- stay on or near pace, never above the ceiling
//   go only if weekly utilization < allowed AND five-hour utilization < FIVE_HOUR_CEILING
// Missing, stale, or pre-reset readings never mean zero use: the session gets a PROBE budget of a few calls whose
// own transcripts produce a fresh reading, then the normal rule applies. A separate per-session call cap is a
// backstop, because utilization per call is not known in advance.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const PACING_VERSION = 'passBPacing/1';
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
export function latestObservation(logPath) {
  if (!existsSync(logPath)) return null;
  let best = null;
  for (const line of readFileSync(logPath, 'utf8').split('\n')) {
    try { const r = JSON.parse(line); if (r.version === PACING_VERSION && (!best || Date.parse(r.observedAt) > Date.parse(best.observedAt))) best = r; } catch { /* skip */ }
  }
  return best;
}

// Decision before one call. probeUsed = calls already spent this session without a fresh reading.
export function pacingDecision({ obs, now = new Date(), probeUsed = 0, opts = {} }) {
  const o = { ...DEFAULTS, ...opts }, t = now.getTime();
  const stale = !obs?.sevenDay ? 'no usage reading' : (t - Date.parse(obs.observedAt) > o.maxAgeMs) ? 'usage reading is stale'
    : (obs.sevenDay.resetsAt <= t) ? 'weekly window reset since the reading' : null;
  if (stale) {
    return probeUsed < o.probeCalls ? { go: true, mode: 'probe', reason: `${stale}; probe call ${probeUsed + 1}/${o.probeCalls} to get a fresh reading` }
      : { go: false, mode: 'stop', reason: `${stale} after ${o.probeCalls} probe calls; stopping (never assume zero use)` };
  }
  const elapsed = Math.min(1, Math.max(0, 1 - (obs.sevenDay.resetsAt - t) / o.weekMs));
  const allowed = Math.min(o.ceiling, elapsed + o.margin), used = obs.sevenDay.utilization;
  const five = obs.fiveHour && obs.fiveHour.resetsAt > t ? obs.fiveHour.utilization : null;
  const base = { elapsed: +elapsed.toFixed(4), allowed: +allowed.toFixed(4), used, fiveHour: five };
  if (used >= o.ceiling) return { go: false, mode: 'stop', reason: `weekly ${Math.round(used * 100)}% at or above the ${Math.round(o.ceiling * 100)}% ceiling`, ...base };
  if (used >= allowed) return { go: false, mode: 'stop', reason: `weekly ${Math.round(used * 100)}% is ahead of pace (${Math.round(elapsed * 100)}% of the week elapsed)`, ...base };
  if (five != null && five >= o.fiveHourCeiling) return { go: false, mode: 'stop', reason: `five-hour window ${Math.round(five * 100)}% used`, ...base };
  return { go: true, mode: 'normal', reason: `weekly ${Math.round(used * 100)}% < allowed ${Math.round(allowed * 100)}%`, ...base };
}

// Session gate: combines the pacing decision with the per-session call cap. Stateful per session.
export function makePacer({ logPath, maxCalls, now = () => new Date(), opts = {} }) {
  let calls = 0, probeUsed = 0, lastSeenAt = null;
  return {
    check() {
      if (calls >= maxCalls) return { go: false, mode: 'stop', reason: `session call cap ${maxCalls} reached` };
      const obs = latestObservation(logPath);
      if (obs && obs.observedAt !== lastSeenAt) { lastSeenAt = obs.observedAt; probeUsed = 0; } // a fresh reading resets the probe budget
      const d = pacingDecision({ obs, now: now(), probeUsed, opts });
      if (d.go) { calls++; if (d.mode === 'probe') probeUsed++; }
      return d;
    },
    get calls() { return calls; },
  };
}
