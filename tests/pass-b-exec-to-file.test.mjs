// VSD-075 (2026-11-09): from the 3-worker change (VSD-070, Nov 1) about half the S2 image calls lost the end of their
// transcript (cut inside the ~300 KB image line, exit 0, "no-structured-output"). The CLI exits while output still
// waits on a full pipe; a busy parent (another worker's synchronous git push) makes the pipe fill. The CLI's stdout
// now goes to a file. No model calls: a stand-in child writes the same shape and exits at once.
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { execToFile } from '../scripts/lib/pass-b-exec-to-file.mjs';

let n = 0; const check = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error(`FAIL ${name}`); throw e; } };
const dir = mkdtempSync(join(tmpdir(), 'exec-to-file-'));
const child = (name, body) => { const f = join(dir, name); writeFileSync(f, body); return f; };
const cli = child('cli.mjs', `process.stdout.write('{"type":"system","subtype":"init"}\\n');
process.stdout.write(JSON.stringify({ type: 'user', blob: 'x'.repeat(300000) }) + '\\n');
process.stdout.write('{"type":"result","subtype":"success"}\\n'); process.exit(0);`);
const whole = s => /"type":"result"/.test(s.trim().split('\n').at(-1));
const busy = () => execFileSync('sleep', ['1']); // the parent cannot read for a second

try {
  await check('a pipe loses the end of a large transcript when the parent is busy (the bug)', async () => {
    const pending = promisify(execFile)(process.execPath, [cli], { maxBuffer: 64 << 20 }); busy();
    const { stdout } = await pending;
    // Platform-dependent (Linux pipes write synchronously from Node; the real CLI does not): record, don't require.
    if (!whole(stdout)) console.log(`  pipe truncated to ${stdout.length} bytes with exit 0 (reproduced)`);
  });
  await check('a file keeps every byte whatever the parent is doing', async () => {
    for (const block of [false, true]) {
      const pending = execToFile(process.execPath, [cli]); if (block) busy();
      const { stdout } = await pending;
      assert.ok(whole(stdout), `ends with the result line (busy=${block})`); assert.equal(stdout.split('\n').filter(Boolean).length, 3);
    }
  });
  await check('non-zero exit rejects with code and the partial stdout, like execFile', async () => {
    const f = child('fail.mjs', `process.stdout.write('partial'); process.exit(3);`);
    await assert.rejects(execToFile(process.execPath, [f]), e => e.code === 3 && e.stdout === 'partial' && e.killed === false);
  });
  await check('timeout kills with the given signal; callers still read it as a timeout', async () => {
    const f = child('hang.mjs', `process.stdout.write('started\\n'); setInterval(() => {}, 1000);`);
    await assert.rejects(execToFile(process.execPath, [f], { timeout: 300, killSignal: 'SIGKILL' }),
      e => e.killed === true && e.signal === 'SIGKILL' && e.code == null && e.stdout === 'started\n');
  });
  await check('a missing binary rejects with ENOENT', async () => {
    await assert.rejects(execToFile(join(dir, 'nope'), []), e => e.code === 'ENOENT');
  });
  await check('cwd and env reach the child; the output folder is not the call folder', async () => {
    const f = child('where.mjs', `process.stdout.write(process.cwd() + '|' + process.env.PASS_B_X);`);
    const { stdout } = await execToFile(process.execPath, [f], { cwd: dir, env: { ...process.env, PASS_B_X: 'y' } });
    assert.equal(stdout.split('|')[1], 'y'); assert.ok(stdout.split('|')[0].endsWith(dir.split('/').at(-1)));
  });
} finally { rmSync(dir, { recursive: true, force: true }); }
console.log(`pass-b-exec-to-file.test: ${n} checks passed`);
