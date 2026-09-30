// Seed / refresh the private evidence repo's state branch from this laptop (cloud plan). Append-only: copies the
// corpus run, the claim-first nightly runs and the usage log into <evidence>/incoming/ (same layout as
// data/incoming), refuses to overwrite a DIFFERENT existing file, commits in batches (GitHub caps a push at 2 GB)
// and pushes each batch. Also records the owner-pinned code commit in state/pin.json. No model calls.
//   node scripts/pass-b-cloud-seed.mjs            # dry run: what would be copied
//   node scripts/pass-b-cloud-seed.mjs --push     # copy, commit, push
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { createHash } from 'node:crypto';

const GAME = process.cwd(), EV = join(GAME, '..', 'gesso-pass-b-evidence'), BRANCH = 'claude/pass-b-state';
const SRC = join(GAME, 'data', 'incoming'), DST = join(EV, 'incoming');
const RUNS = ['vision-calibration/corpus-b3-6401bc543ead', 'vision-calibration/claim-first-v1/snapshots', 'vision-calibration/claim-first-nightly', 'vision-ops'];
const EXCLUDE = /(\.lease$|\/\.DS_Store$)/;
const git = (...a) => execFileSync('git', ['-C', EV, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const sha = p => createHash('sha256').update(readFileSync(p)).digest('hex');
const walk = d => !existsSync(d) ? [] : readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);

// Nightly claim-first stage runs are cf-<id> dirs whose manifest names passBClaimFirstNightly/1.
const nightlyRuns = readdirSync(join(SRC, 'vision-calibration')).filter(d => d.startsWith('cf-') && existsSync(join(SRC, 'vision-calibration', d, 'run-manifest.json'))
  && /passBClaimFirstNightly\/1/.test(readFileSync(join(SRC, 'vision-calibration', d, 'run-manifest.json'), 'utf8'))).map(d => `vision-calibration/${d}`);

function plan() {
  const copies = [], conflicts = [];
  for (const r of [...RUNS, ...nightlyRuns]) for (const f of walk(join(SRC, r))) {
    if (EXCLUDE.test(f)) continue;
    const to = join(DST, relative(SRC, f));
    if (!existsSync(to)) copies.push({ from: f, to, bytes: statSync(f).size });
    else if (sha(f) !== sha(to)) conflicts.push(relative(SRC, f));
  }
  return { copies, conflicts };
}

const push = process.argv.includes('--push');
git('fetch', '-q', 'origin');
const hasState = git('ls-remote', '--heads', 'origin', BRANCH).trim().length > 0;
if (push) {
  if (git('status', '--porcelain').trim()) throw new Error('evidence checkout has uncommitted changes; refusing');
  git('checkout', '-q', '-B', BRANCH, hasState ? `origin/${BRANCH}` : 'origin/main');
}
const { copies, conflicts } = plan();
const gb = copies.reduce((n, c) => n + c.bytes, 0) / 1e9;
console.log(`seed: ${copies.length} new files (${gb.toFixed(2)} GB) from ${RUNS.length + nightlyRuns.length} runs; ${conflicts.length} conflicting existing files`);
if (conflicts.length) { console.log(conflicts.slice(0, 10).join('\n')); throw new Error('an existing evidence file differs; refusing (append-only)'); }
if (!push) { console.log('DRY RUN: nothing copied. Re-run with --push.'); process.exit(0); }

// batches of <= ~400 MB, pushed one at a time
let batch = [], size = 0, n = 0;
const flush = () => {
  if (!batch.length) return;
  git('add', '--', ...batch.map(c => relative(EV, c.to)));
  git('commit', '-q', '-m', `seed evidence batch ${++n} (${batch.length} files)`);
  git('push', '-q', 'origin', `HEAD:${BRANCH}`);
  console.log(`  pushed batch ${n}: ${batch.length} files, ${(size / 1e6).toFixed(0)} MB`);
  batch = []; size = 0;
};
for (const c of copies) { mkdirSync(dirname(c.to), { recursive: true }); copyFileSync(c.from, c.to); batch.push(c); size += c.bytes; if (size > 400e6 || batch.length > 3000) flush(); }
flush();
// repo hygiene + owner-pinned code commit (must already be pushed to the game repo)
writeFileSync(join(EV, '.gitignore'), '*.lease\n.DS_Store\n');
const commit = execFileSync('git', ['-C', GAME, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
execFileSync('git', ['-C', GAME, 'branch', '-r', '--contains', commit], { encoding: 'utf8' }).trim() || (() => { throw new Error('pin commit is not pushed to the game repo'); })();
mkdirSync(join(EV, 'state'), { recursive: true });
writeFileSync(join(EV, 'state', 'pin.json'), `${JSON.stringify({ commit, branch: execFileSync('git', ['-C', GAME, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim(), pinnedAt: new Date().toISOString(), pinnedBy: 'owner via laptop seed' }, null, 1)}\n`);
git('add', '.gitignore', 'state/pin.json'); if (git('diff', '--cached', '--name-only').trim()) { git('commit', '-q', '-m', `pin code ${commit.slice(0, 7)}`); git('push', '-q', 'origin', `HEAD:${BRANCH}`); }
console.log(`seeded ${copies.length} files in ${n} batches; pinned ${commit.slice(0, 7)} on ${BRANCH}`);
