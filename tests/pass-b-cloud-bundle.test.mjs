// Round-trip regressions for the cloud-credit evidence bundle (VSD-047), using REAL finished works from the
// local corpus run when it is present (skipped in CI checkouts that do not carry gitignored evidence).
import assert from 'node:assert';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { sha256 } from '../scripts/lib/vision-legacy.mjs';
import { CORPUS_RUN_DIR, readLedger, laneWindow, setSpentUsd, CLOUD_BUDGET_USD } from '../scripts/pass-b-corpus-collect.mjs';
import { exportBundles, importBundles, workEvidenceFiles, loadContext } from '../scripts/pass-b-cloud-bundle.mjs';

if (!existsSync(join(CORPUS_RUN_DIR, 'ledger.json'))) { console.log('pass-b-cloud-bundle.test: skipped (no local corpus evidence)'); process.exit(0); }
let n = 0; const ok = (v, m) => { assert(v, m); n++; };
const ctx = loadContext();
const ids = (readLedger(CORPUS_RUN_DIR).doneIds || []).slice(0, 2);
ok(ids.length === 2, 'two real finished works available');
const root = mkdtempSync(join(tmpdir(), 'cloud-bundle-test-'));
const cloud = join(root, 'cloud-run'), repo = join(root, 'evidence'), local = join(root, 'local-run');
// "cloud" run = the minimal evidence of two real works
for (const id of ids) for (const f of workEvidenceFiles(CORPUS_RUN_DIR, id)) { mkdirSync(dirname(join(cloud, f)), { recursive: true }); copyFileSync(join(CORPUS_RUN_DIR, f), join(cloud, f)); }

const made = exportBundles({ repo, runDir: cloud, ctx });
ok(made.length === 1 && made[0].works === 2, 'finished cloud works are bundled');
ok(exportBundles({ repo, runDir: cloud, ctx }).length === 0, 'already-exported works are not bundled twice');

// import into an empty local run: both verified and imported, byte-identical to the source evidence
let res = importBundles({ repo, runDir: local, ctx });
ok(res.length === 1 && res[0].imported.length === 2 && res[0].rejected.length === 0, 'verified import of both works');
for (const id of ids) for (const f of workEvidenceFiles(CORPUS_RUN_DIR, id))
  ok(readFileSync(join(local, f)).equals(readFileSync(join(CORPUS_RUN_DIR, f))), `imported bytes identical: ${f.split('/').pop()}`);
ok(importBundles({ repo, runDir: local, ctx }).length === 0, 'a bundle imports once');

// local wins: a work that already exists locally is skipped, never overwritten
const local2 = join(root, 'local-run-2');
const w0 = workEvidenceFiles(CORPUS_RUN_DIR, ids[0]);
mkdirSync(join(local2, 'works', sha256(ids[0]).slice(0, 24)), { recursive: true });
res = importBundles({ repo, runDir: local2, ctx });
ok(res[0].skipped.some(s => s.id === ids[0]) && res[0].imported.includes(ids[1]), 'existing local work is skipped (local wins)');

// tampered evidence inside a well-formed bundle is rejected per work
const cloud3 = join(root, 'cloud-3'), repo3 = join(root, 'evidence-3');
for (const f of w0) { mkdirSync(dirname(join(cloud3, f)), { recursive: true }); copyFileSync(join(CORPUS_RUN_DIR, f), join(cloud3, f)); }
const comp = w0.find(f => f.includes('/completions/'));
const c = JSON.parse(readFileSync(join(cloud3, comp), 'utf8')); c.body = { ...c.body, tampered: true }; writeFileSync(join(cloud3, comp), JSON.stringify(c));
exportBundles({ repo: repo3, runDir: cloud3, ctx }); // inspectWork refuses to export a non-verifying work
ok(!existsSync(join(repo3, 'bundles')) || readdirSync(join(repo3, 'bundles')).length === 0, 'a tampered cloud work is never exported');

// a corrupted bundle file fails closed before anything is imported
const b = readdirSync(join(repo, 'bundles')).find(f => f.endsWith('.tar.gz'));
const buf = readFileSync(join(repo, 'bundles', b)); buf[buf.length - 20] ^= 0xff; writeFileSync(join(repo, 'bundles', b), buf);
assert.throws(() => importBundles({ repo, runDir: join(root, 'local-run-3'), ctx }), /bundle hash mismatch/); n++;

// cloud lane: no hours gate, but a hard dollar cap on client-reported spend
setSpentUsd(CLOUD_BUDGET_USD - 0.01); ok(laneWindow('cloud', new Date('2026-09-25T18:00:00Z')).timeout > 0, 'cloud lane may start during Pacific daytime while under the cap');
setSpentUsd(CLOUD_BUDGET_USD); assert.throws(() => laneWindow('cloud'), /budget-cap/); n++;
assert.throws(() => laneWindow('local', new Date('2026-09-25T18:00:00Z')), /protected-hours/); n++;
setSpentUsd(0);

rmSync(root, { recursive: true, force: true });
console.log(`pass-b-cloud-bundle.test: ${n} checks passed`);
