// VSD-075 (2026-11-09): run the CLI with stdout and stderr going to files, not pipes. The CLI exits as soon as it
// finishes; output still waiting on a full pipe (the parent is busy, e.g. another worker's synchronous git push) is
// lost and the call still exits 0. From the 3-worker change (VSD-070) about half the S2 image calls lost their result
// that way. A file write never waits on the reader, so nothing is lost and nothing depends on timing.
// Drop-in for promisify(execFile): resolves { stdout, stderr }; rejects with code / signal / killed / stdout / stderr.
import { spawn } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function execToFile(bin, argv, { cwd, env, timeout = 0, killSignal = 'SIGTERM', maxBuffer = Infinity } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pass-b-out-')); // its own folder, never inside the confined call folder
  const outPath = join(dir, 'stdout'), errPath = join(dir, 'stderr');
  const out = openSync(outPath, 'w', 0o600), err = openSync(errPath, 'w', 0o600);
  return new Promise((resolve, reject) => {
    let killed = false, timer = null, done = false;
    const finish = (code, signal, spawnError = null) => {
      if (done) return; done = true; clearTimeout(timer);
      let stdout = '', stderr = '', tooBig = false;
      try {
        tooBig = statSync(outPath).size > maxBuffer;
        stdout = readFileSync(outPath, 'utf8'); stderr = readFileSync(errPath, 'utf8');
      } finally { rmSync(dir, { recursive: true, force: true }); }
      if (!spawnError && !tooBig && code === 0) return resolve({ stdout, stderr });
      const e = spawnError || new Error(tooBig ? `stdout maxBuffer length exceeded: ${bin}` : `Command failed: ${bin}`);
      if (!spawnError) Object.assign(e, { code: tooBig ? 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' : code, signal });
      reject(Object.assign(e, { killed, stdout, stderr }));
    };
    let child;
    try { child = spawn(bin, argv, { cwd, env, stdio: ['ignore', out, err] }); }
    catch (e) { closeSync(out); closeSync(err); return finish(null, null, e); }
    closeSync(out); closeSync(err); // the child holds its own copies
    if (timeout > 0) timer = setTimeout(() => { killed = true; child.kill(killSignal); }, timeout);
    child.on('error', e => finish(null, null, e));
    child.on('close', (code, signal) => finish(code, signal));
  });
}
