// Stuck alarm (owner 2026-10-21): silent when healthy or explained; ALERT on a deliberate stop, an abandoned lock,
// or hours with no calls. Builds throwaway evidence repos with backdated commits. Offline.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let n = 0; const check = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`FAIL ${name}`); throw e; } };
const ago = h => new Date(Date.now() - h * 3600000).toISOString();
function evidence({ commits, lease, status }) {
  const d = mkdtempSync(join(tmpdir(), 'alarm-'));
  execFileSync('git', ['init', '-q', d]); mkdirSync(join(d, 'state'));
  writeFileSync(join(d, 'state', 'schedule.json'), JSON.stringify({ timeZone: 'Europe/Paris', hours: 'all-day' }));
  if (lease) writeFileSync(join(d, 'state', 'lease.json'), JSON.stringify(lease));
  if (status) writeFileSync(join(d, 'state', 'status.json'), JSON.stringify(status));
  for (const [h, msg] of commits) execFileSync('git', ['-C', d, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', msg],
    { env: { ...process.env, GIT_AUTHOR_DATE: ago(h), GIT_COMMITTER_DATE: ago(h) } });
  return d;
}
const alarm = d => execFileSync('node', ['scripts/pass-b-status-report.mjs', '--evidence', d, '--alarm'], { encoding: 'utf8' }).trim();

check('healthy run in progress: OK', () => {
  const d = evidence({ commits: [[0.5, 'lease: acquire by routine-x'], [0.1, 'reserve cf-1 w']], lease: { holder: 'routine-x', acquiredAt: ago(0.5) } });
  assert.equal(alarm(d), 'OK'); rmSync(d, { recursive: true });
});
check('fresh deliberate stop holding the lock: ALERT', () => {
  const d = evidence({ commits: [[1, 'reserve cf-1 w'], [0.5, 'status: FAIL-CLOSED: x']], lease: { holder: 'routine-x', acquiredAt: ago(2) },
    status: { holder: 'routine-x', exit: 1, summary: 'FAIL-CLOSED: preserved-pause: w/B3', updatedAt: ago(0.5) } });
  assert.match(alarm(d), /^ALERT: .*stopped on purpose: FAIL-CLOSED: preserved-pause/); rmSync(d, { recursive: true });
});
check('abandoned lock (no activity 5 h): ALERT; at 3 h it is still self-healing territory: OK', () => {
  const d = evidence({ commits: [[5, 'reserve cf-1 w']], lease: { holder: 'routine-x', acquiredAt: ago(6) } });
  assert.match(alarm(d), /^ALERT: .*lock held by routine-x/); rmSync(d, { recursive: true });
  const e = evidence({ commits: [[3, 'reserve cf-1 w']], lease: { holder: 'routine-x', acquiredAt: ago(4) } });
  assert.equal(alarm(e), 'OK'); rmSync(e, { recursive: true });
});
check('no calls for 7 h with nothing explaining it: ALERT; a pacing pause: OK', () => {
  const d = evidence({ commits: [[7, 'reserve cf-1 w'], [6.9, 'status: done']], status: { holder: 'routine-x', exit: 0, summary: 'finished', updatedAt: ago(6.9) } });
  assert.match(alarm(d), /^ALERT: .*no calls since/); rmSync(d, { recursive: true });
  const e = evidence({ commits: [[7, 'reserve cf-1 w'], [6.9, 'status: paced']], status: { holder: 'routine-x', exit: 0, summary: 'stop=pacing: weekly ahead', updatedAt: ago(6.9) } });
  assert.equal(alarm(e), 'OK'); rmSync(e, { recursive: true });
});
console.log(`pass-b-status-alarm.test: ${n} checks passed`);
