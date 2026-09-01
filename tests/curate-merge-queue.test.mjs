// Offline regression for the clean-checkout review-queue defect in the ACTIVE `curate-merge --run` path.
// data/incoming/ is gitignored, so a clean checkout has no data/incoming/curate/. The queue write used to run
// AFTER every authoritative write, so an ENOENT there aborted the command non-zero with pool/teach/hotspots/
// evidence/ledger ALREADY written. Queue preparation now completes BEFORE the first authoritative write.
// Fixtures are disposable and live under /private/tmp — never the worktree's authoritative files.
//   node tests/curate-merge-queue.test.mjs
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, openSync, writeSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createRunDir, completionFile, sha256, promptHashOf, runHeader, metaShaOf, workStateSha } from '../scripts/lib/vision-run.mjs';

// CURATE_MERGE_SCRIPT lets this suite be pointed at the pre-fix script to prove it fails there.
const SCRIPT = process.env.CURATE_MERGE_SCRIPT || fileURLToPath(new URL('../scripts/curate-merge.mjs', import.meta.url));
const ID = 'http://www.wikidata.org/entity/Q999001';
const MODEL = 'claude-sonnet-4-6';
const AUTH = ['index.html', 'data/pool.js', 'data/teach-works.js', 'data/hotspots.js',
              'data/no-pins-reviewed.json', 'data/vision-audit.json', 'data/vision-evidence.json'];

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  FAIL ' + m); } };

const hashes = root => Object.fromEntries(AUTH.map(f => {
  const p = join(root, f);
  return [f, existsSync(p) ? sha256(readFileSync(p)) : '<absent>'];
}));

async function makeFixture() {
  const root = mkdtempSync('/private/tmp/curate-queue-');
  mkdirSync(join(root, 'data'), { recursive: true });
  writeFileSync(join(root, 'index.html'),
    'const MOVEMENTS={\n  "Baroque":{dates:[1600,1750],region:"Europe",palette:["#1","#2","#3","#4"]},\n};\nconst MOV_FAMILY={};\n');
  const pool = [{ id: ID, title: 'Fixture Work', artist: 'A', place: 'P', y: 1600, medium: 'Unknown', style: 'Baroque', styleKind: 'movement', play: true }];
  writeFileSync(join(root, 'data/pool.js'), 'window.ARTEFACTUM_POOL=' + JSON.stringify(pool) + ';\n');
  writeFileSync(join(root, 'data/teach-works.js'), 'window.ARTEFACTUM_CUES=window.ARTEFACTUM_CUES||{};\nwindow.ARTEFACTUM_CUES.work=' + JSON.stringify({}) + ';\n');
  writeFileSync(join(root, 'data/hotspots.js'), 'window.ARTEFACTUM_HOTSPOTS=' + JSON.stringify({}) + ';\n');
  writeFileSync(join(root, 'data/vision-audit.json'), JSON.stringify({ appliedRuns: {}, entries: {}, ids: [] }, null, 1) + '\n');
  writeFileSync(join(root, 'data/no-pins-reviewed.json'), '[]\n');

  const runsBase = join(root, 'data/incoming/vision/runs');
  mkdirSync(runsBase, { recursive: true });
  const run = createRunDir(runsBase);

  const img = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#37a' } }).jpeg().toBuffer();
  const imgSha = sha256(img);
  writeFileSync(join(run.imgsDir, `${imgSha}.jpg`), img);

  const manHeader = runHeader(run.runId, promptHashOf('PROMPT v1'));
  const meta = { title: 'Fixture Work', artist: 'A' };
  const BASE = workStateSha(pool[0], undefined, null, null, false);
  writeFileSync(run.manifestPath, JSON.stringify({ header: manHeader,
    items: [{ id: ID, firstDate: 'x', tier: 'easy', meta, imgStatus: 'ok', sha256: imgSha, ext: 'jpg', imgFile: `imgs/${imgSha}.jpg`, baseSha: BASE }] }));

  // fields.medium applies (authoritative change); fields.style is unmapped -> QUEUED as style-unmapped
  const fields = { style: 'UnmappedStyleX', styleKind: 'movement', medium: 'tempera' };
  const result = { id: ID, image: { ok: true, issue: 'none', reason: 'clear', suggestedUrl: null }, playable: true,
    playableReason: 'legible', imageQuality: 'good', qualityReason: 'sharp', framing: 'ok', mediumLegible: true,
    fields, notes: [{ head: 'H', body: 'B', x: 50, y: 40 }] };
  const compRec = { header: { ...manHeader, modelId: MODEL }, id: ID, imgSha256: imgSha, baseSha: BASE,
    metaSha: metaShaOf(ID, meta, imgSha, BASE), result };
  const compPath = join(run.completionsDir, completionFile(ID));
  writeFileSync(compPath, JSON.stringify(compRec));

  const approved = { header: { ...manHeader, modelId: MODEL }, items: [{ id: ID, imgSha256: imgSha,
    completionSha256: sha256(readFileSync(compPath)),
    approved: { image: result.image, playable: true, imageQuality: 'good', framing: 'ok', mediumLegible: true, fields } }] };
  const fd = openSync(run.approvedPath, 'wx'); writeSync(fd, JSON.stringify(approved)); closeSync(fd);

  return { root, run, compPath };
}

const runMerge = (root, runDir) => spawnSync(process.execPath, [SCRIPT, '--run', runDir], { cwd: root, encoding: 'utf8' });
const QP = root => join(root, 'data/incoming/curate/review-queue.json');
const ledger = root => JSON.parse(readFileSync(join(root, 'data/vision-audit.json'), 'utf8'));
const readQueue = root => { try { return JSON.parse(readFileSync(QP(root), 'utf8')); } catch { return null; } };
const readPool = root => { try { return JSON.parse(readFileSync(join(root, 'data/pool.js'), 'utf8').match(/\[.*\]/s)[0]); } catch { return null; } };

console.log('\n1. SUCCESS — data/incoming/curate/ initially ABSENT');
{ const { root, run } = await makeFixture();
  ok('precondition: data/incoming/curate/ absent', !existsSync(join(root, 'data/incoming/curate')));
  const r = runMerge(root, run.dir);
  ok('exit 0', r.status === 0);
  ok('review-queue.json created', existsSync(QP(root)));
  const q = readQueue(root);
  ok('queue holds the style-unmapped entry', !!q && q.length === 1 && q[0].id === ID && q[0].type === 'style-unmapped' && q[0].suggested === 'UnmappedStyleX');
  const poolAfter = readPool(root);
  ok('authoritative change applied (medium -> Tempera)', !!poolAfter && poolAfter[0].medium === 'Tempera');
  ok('unmapped style NOT applied', !!poolAfter && poolAfter[0].style === 'Baroque');
  ok('appliedRuns records the run', !!ledger(root).appliedRuns[run.runId]);
  ok('evidence store written', existsSync(join(root, 'data/vision-evidence.json')));
  rmSync(root, { recursive: true, force: true }); }

console.log('\n2. SUCCESS — accumulation + id|type dedup preserved');
{ const { root, run } = await makeFixture();
  mkdirSync(join(root, 'data/incoming/curate'), { recursive: true });
  writeFileSync(QP(root), JSON.stringify([
    { id: 'other-work', type: 'date', from: 1, to: 2 },
    { id: ID, type: 'style-unmapped', suggested: 'StaleDuplicate' },
  ], null, 1));
  const r = runMerge(root, run.dir);
  ok('exit 0', r.status === 0);
  const q = readQueue(root) || [];
  ok('prior unrelated entry retained (accumulation)', q.some(e => e.id === 'other-work' && e.type === 'date'));
  ok('id|type duplicate collapsed to one', q.filter(e => e.id === ID && e.type === 'style-unmapped').length === 1);
  ok('prior wins on dedup (first-seen kept)', (q.find(e => e.id === ID) || {}).suggested === 'StaleDuplicate');
  ok('queue length 2', q.length === 2);
  rmSync(root, { recursive: true, force: true }); }

console.log('\n3. FAILURE — queue DIRECTORY preparation fails => abort before any authoritative write');
{ const { root, run } = await makeFixture();
  mkdirSync(join(root, 'data/incoming'), { recursive: true });
  writeFileSync(join(root, 'data/incoming/curate'), 'not a directory');   // mkdir must fail
  const before = hashes(root);
  const r = runMerge(root, run.dir);
  ok('exit non-zero', r.status !== 0);
  const after = hashes(root);
  ok('every authoritative file byte-identical', JSON.stringify(before) === JSON.stringify(after));
  ok('no appliedRuns record', !ledger(root).appliedRuns[run.runId]);
  ok('no evidence file written', !existsSync(join(root, 'data/vision-evidence.json')));
  rmSync(root, { recursive: true, force: true }); }

console.log('\n4. FAILURE — queue WRITE fails => abort before any authoritative write');
{ const { root, run } = await makeFixture();
  mkdirSync(QP(root), { recursive: true });   // review-queue.json is a DIRECTORY -> writeFileSync EISDIR
  const before = hashes(root);
  const r = runMerge(root, run.dir);
  ok('exit non-zero', r.status !== 0);
  const after = hashes(root);
  ok('every authoritative file byte-identical', JSON.stringify(before) === JSON.stringify(after));
  ok('no appliedRuns record', !ledger(root).appliedRuns[run.runId]);
  ok('no evidence file written', !existsSync(join(root, 'data/vision-evidence.json')));
  ok('failure not swallowed (stderr or stack present)', (r.stderr || '').length > 0);
  rmSync(root, { recursive: true, force: true }); }

console.log('\n5. Provenance/tamper rejection still precedes every write');
{ const { root, run, compPath } = await makeFixture();
  const rec = JSON.parse(readFileSync(compPath, 'utf8'));
  rec.result.playable = false;                       // completion edited after approval -> completionSha mismatch
  writeFileSync(compPath, JSON.stringify(rec));
  const before = hashes(root);
  const r = runMerge(root, run.dir);
  ok('exit non-zero', r.status !== 0);
  ok('rejected before write', JSON.stringify(before) === JSON.stringify(hashes(root)));
  ok('no appliedRuns record', !ledger(root).appliedRuns[run.runId]);
  rmSync(root, { recursive: true, force: true }); }

console.log(`\n${fail ? '❌' : '✅'} curate-merge queue regression: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
