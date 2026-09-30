// Lease / status CLI for the evidence repo (cloud plan). Used by the cloud entry script and, deliberately, by the
// owner from a phone session: `status` shows who holds the lease and the last night's summary; `release --force`
// frees a lease left by a run that died, ONLY after checking that run (a lease is never stolen automatically).
//   node scripts/pass-b-cloud-lease.mjs status|acquire <holder>|release <holder>|release --force|write-status <json>
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { remoteRoot, acquireLease, releaseLease, readLease, writeStatus, LeaseBusyError } from './lib/pass-b-remote-evidence.mjs';

const [cmd, arg] = process.argv.slice(2), root = remoteRoot();
if (!root) { console.error('set PASS_B_REMOTE_EVIDENCE to the evidence checkout'); process.exit(2); }
try {
  if (cmd === 'status') {
    const s = join(root, 'state', 'status.json');
    console.log(JSON.stringify({ lease: readLease(root), lastStatus: existsSync(s) ? JSON.parse(readFileSync(s, 'utf8')) : null }, null, 1));
  } else if (cmd === 'acquire') { console.log(`lease acquired: ${JSON.stringify(acquireLease(root, arg))}`); }
  else if (cmd === 'release') { console.log(releaseLease(root, arg === '--force' ? 'owner' : arg, { force: arg === '--force' }) ? 'lease released' : 'no lease held'); }
  else if (cmd === 'write-status') { writeStatus(root, JSON.parse(arg)); console.log('status written'); }
  else { console.error('usage: status | acquire <holder> | release <holder> | release --force | write-status <json>'); process.exit(2); }
} catch (e) {
  if (e instanceof LeaseBusyError) { console.log(`LEASE BUSY: ${e.message}`); process.exit(3); }
  console.error(`FAIL-CLOSED: ${e.message}`); process.exit(1);
}
