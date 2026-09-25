// Move cloud-credit B1–B3 evidence home (VSD-047). The cloud lane writes the same run layout as the local
// collector inside a Claude Code cloud session. This tool ships finished works through a PRIVATE evidence repo
// and imports them into the local corpus run only after full re-verification. Never used for B4 or publication.
//
//   node scripts/pass-b-cloud-bundle.mjs skip   --repo <evidence-repo>          (local) write state/skip.json
//   node scripts/pass-b-cloud-bundle.mjs export --repo <evidence-repo> [--push] (cloud) bundle finished works
//   node scripts/pass-b-cloud-bundle.mjs import --repo <evidence-repo>          (local) verify + import bundles
//
// Import copies ONLY b0-prep.json, completions/, raw/, the transcripts the completions reference, and the image.
// Cloud reservations/epochs stay behind (they belong to the cloud run's own history). Each work is staged in a
// temp run dir and must pass inspectWork (hashes, transcripts, provenance, image receipts, validation) before
// anything is copied; existing local evidence is never overwritten and a local work always wins.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { sha256, stableJson } from './lib/vision-legacy.mjs';
import { trustedCatalog, snapshotLegacy } from './lib/pass-b-calibration.mjs';
import { CORPUS_RUN_ID, CORPUS_RUN_DIR, inspectWork, readLedger, runSpendUsd, executionEpochs } from './pass-b-corpus-collect.mjs';

export const BUNDLE_VERSION = 'passBCloudBundle/1';
const MAX_BUNDLE_RAW_BYTES = 80 * 1024 * 1024; // transcripts compress well; keeps each .tar.gz comfortably under git limits
const fileSha = p => createHash('sha256').update(readFileSync(p)).digest('hex');
const readJson = p => JSON.parse(readFileSync(p, 'utf8'));
const files = p => existsSync(p) ? readdirSync(p) : [];
const workKey = id => sha256(id).slice(0, 24);
const loadGlobal = (file, name) => { const w = {}; new Function('window', readFileSync(file, 'utf8'))(w); return w[name]; };

export function loadContext() {
  const pool = loadGlobal('data/pool.js', 'ARTEFACTUM_POOL');
  const teach = (loadGlobal('data/teach-works.js', 'ARTEFACTUM_CUES') || {}).work || {};
  const hotspots = loadGlobal('data/hotspots.js', 'ARTEFACTUM_HOTSPOTS') || {};
  const vision = loadGlobal('data/vision.js', 'ARTEFACTUM_VISION') || {};
  const auditIds = new Set(JSON.parse(readFileSync('data/vision-audit.json', 'utf8')).ids || []);
  return { pool, byId: new Map(pool.map(p => [p.id, p])), legacyOf: id => snapshotLegacy(id, { teach, hotspots, vision, auditIds }) };
}

// The minimal, sufficient evidence for one finished work (relative to the run dir).
export function workEvidenceFiles(runDir, id) {
  const w = join('works', workKey(id)), abs = join(runDir, w), out = [join(w, 'b0-prep.json')];
  const wanted = new Set();
  for (const f of files(join(abs, 'completions'))) {
    out.push(join(w, 'completions', f));
    const c = readJson(join(abs, 'completions', f));
    out.push(join(w, 'raw', `${c.rawResponseSha256}.json`));
    wanted.add(c.transcriptSha256);
  }
  for (const f of files(join(abs, 'attempts'))) if (f.endsWith('.transcript.jsonl') && wanted.has(sha256(readFileSync(join(abs, 'attempts', f), 'utf8')))) out.push(join(w, 'attempts', f));
  const b0 = readJson(join(abs, 'b0-prep.json'));
  out.push(join('imgs', `${b0.image.imgSha256}.${b0.image.ext}`));
  return out;
}

// ---------- global cloud spend across sessions ----------
// Each cloud container is a fresh run dir, so its own attempt costs reset per session. state/spend.json keeps one
// entry per container run (keyed by that run's first execution-epoch hash), overwritten on each export, so the
// total across sessions never double-counts and a new session can compute its remaining budget.
export const TOTAL_BUDGET_USD = 240;
export function recordSpend({ repo, runDir = CORPUS_RUN_DIR }) {
  const key = executionEpochs(runDir)[0]?.sha256; if (!key) return readSpend(repo);
  const path = join(repo, 'state', 'spend.json'), cur = existsSync(path) ? readJson(path) : { sessions: {} };
  cur.sessions[key] = { usd: Number(runSpendUsd(runDir).toFixed(4)), at: new Date().toISOString() };
  mkdirSync(join(repo, 'state'), { recursive: true }); writeFileSync(path, `${JSON.stringify(cur, null, 1)}\n`);
  return readSpend(repo);
}
export function readSpend(repo) {
  const path = join(repo, 'state', 'spend.json'), cur = existsSync(path) ? readJson(path) : { sessions: {} };
  const total = Object.values(cur.sessions).reduce((a, s) => a + s.usd, 0);
  return { totalUsd: total, remainingUsd: Math.max(0, TOTAL_BUDGET_USD - total), sessions: Object.keys(cur.sessions).length };
}

// ---------- local: tell the cloud lane what not to touch ----------
export function writeSkip({ repo, runDir = CORPUS_RUN_DIR }) {
  const ledger = readLedger(runDir);
  const ids = new Set([...(ledger.doneIds || []), ...(ledger.heldIds || [])]);
  const { pool } = loadContext();
  for (const p of pool) if (existsSync(join(runDir, 'works', workKey(p.id)))) ids.add(p.id); // anything touched locally
  mkdirSync(join(repo, 'state'), { recursive: true });
  writeFileSync(join(repo, 'state', 'skip.json'), `${JSON.stringify({ version: 'passBCloudSkip/1', sourceRunId: CORPUS_RUN_ID, at: new Date().toISOString(), ids: [...ids].sort() }, null, 1)}\n`);
  return ids.size;
}

// ---------- cloud: bundle finished, not-yet-exported works ----------
export function exportBundles({ repo, runDir = CORPUS_RUN_DIR, ctx = loadContext(), now = new Date() }) {
  const exportedPath = join(repo, 'state', 'exported.json');
  const exported = new Set(existsSync(exportedPath) ? readJson(exportedPath).ids : []);
  const ready = [];
  for (const d of files(join(runDir, 'works'))) {
    const b0p = join(runDir, 'works', d, 'b0-prep.json'); if (!existsSync(b0p)) continue;
    const id = readJson(b0p).work.id; if (exported.has(id)) continue;
    const p = ctx.byId.get(id); if (!p) continue;
    let r; try { r = inspectWork({ runDir, id, catalog: trustedCatalog(p), legacy: ctx.legacyOf(id) }); } catch { continue; }
    if (r.done) ready.push({ id, files: workEvidenceFiles(runDir, id) });
  }
  const groups = []; let cur = [], size = 0;
  for (const w of ready) {
    const bytes = w.files.reduce((a, f) => a + statSync(join(runDir, f)).size, 0);
    if (cur.length && size + bytes > MAX_BUNDLE_RAW_BYTES) { groups.push(cur); cur = []; size = 0; }
    cur.push(w); size += bytes;
  }
  if (cur.length) groups.push(cur);
  mkdirSync(join(repo, 'bundles'), { recursive: true });
  const made = [];
  for (const g of groups) {
    const listed = [...new Set(g.flatMap(w => w.files))].sort();
    const manifestCore = { version: BUNDLE_VERSION, sourceRunId: CORPUS_RUN_ID, createdAt: now.toISOString(),
      works: g.map(w => ({ id: w.id, files: w.files.map(f => ({ path: f, sha256: fileSha(join(runDir, f)) })) })) };
    const bundleId = `cb-${sha256(stableJson(manifestCore.works)).slice(0, 12)}`;
    const tarPath = join(repo, 'bundles', `${bundleId}.tar.gz`);
    execFileSync('tar', ['-czf', tarPath, '-C', runDir, ...listed]);
    const manifest = { ...manifestCore, bundleId, tarSha256: fileSha(tarPath), spentUsdAtExport: runSpendUsd(runDir) };
    writeFileSync(join(repo, 'bundles', `${bundleId}.manifest.json`), `${JSON.stringify(manifest, null, 1)}\n`);
    for (const w of g) exported.add(w.id);
    made.push({ bundleId, works: g.length, bytes: statSync(tarPath).size });
  }
  mkdirSync(join(repo, 'state'), { recursive: true });
  writeFileSync(exportedPath, `${JSON.stringify({ ids: [...exported].sort() }, null, 1)}\n`);
  return made;
}

// ---------- local: verify and import ----------
export function importBundles({ repo, runDir = CORPUS_RUN_DIR, ctx = loadContext() }) {
  const doneDir = join(runDir, 'cloud-imports'); mkdirSync(doneDir, { recursive: true });
  const results = [];
  for (const m of files(join(repo, 'bundles')).filter(f => f.endsWith('.manifest.json')).sort()) {
    const manifest = readJson(join(repo, 'bundles', m));
    const recordPath = join(doneDir, `${manifest.bundleId}.json`);
    if (existsSync(recordPath)) continue;
    const tarPath = join(repo, 'bundles', `${manifest.bundleId}.tar.gz`);
    if (manifest.version !== BUNDLE_VERSION || manifest.sourceRunId !== CORPUS_RUN_ID) throw new Error(`${manifest.bundleId}: contract/run mismatch`);
    if (!existsSync(tarPath) || fileSha(tarPath) !== manifest.tarSha256) throw new Error(`${manifest.bundleId}: bundle hash mismatch`);
    const extract = mkdtempSync(join(tmpdir(), 'cloud-import-'));
    const record = { bundleId: manifest.bundleId, tarSha256: manifest.tarSha256, importedAt: new Date().toISOString(), imported: [], skipped: [], rejected: [] };
    try {
      execFileSync('tar', ['-xzf', tarPath, '-C', extract]);
      for (const w of manifest.works) {
        if (!w.files.every(f => !f.path.includes('..') && existsSync(join(extract, f.path)) && fileSha(join(extract, f.path)) === f.sha256)) { record.rejected.push({ id: w.id, reason: 'file hash mismatch' }); continue; }
        if (existsSync(join(runDir, 'works', workKey(w.id)))) { record.skipped.push({ id: w.id, reason: 'local evidence exists (local wins)' }); continue; }
        const p = ctx.byId.get(w.id); if (!p) { record.rejected.push({ id: w.id, reason: 'not in pool' }); continue; }
        // Stage exactly this work's files in a clean run dir, then require full verification.
        const stage = mkdtempSync(join(tmpdir(), 'cloud-stage-'));
        try {
          for (const f of w.files) { mkdirSync(dirname(join(stage, f.path)), { recursive: true }); copyFileSync(join(extract, f.path), join(stage, f.path)); }
          const r = inspectWork({ runDir: stage, id: w.id, catalog: trustedCatalog(p), legacy: ctx.legacyOf(w.id), priorDir: stage });
          if (!r.done || r.fatal) { record.rejected.push({ id: w.id, reason: r.fatal || 'not complete' }); continue; }
        } catch (e) { record.rejected.push({ id: w.id, reason: String(e.message).slice(0, 200) }); continue; }
        finally { rmSync(stage, { recursive: true, force: true }); }
        for (const f of w.files) {
          const dst = join(runDir, f.path);
          if (existsSync(dst)) { if (fileSha(dst) !== f.sha256) throw new Error(`${w.id}: ${f.path} differs locally; preserved`); continue; }
          mkdirSync(dirname(dst), { recursive: true, mode: 0o700 });
          writeFileSync(dst, readFileSync(join(extract, f.path)), { flag: 'wx', mode: 0o600 });
        }
        record.imported.push(w.id);
      }
    } finally { rmSync(extract, { recursive: true, force: true }); }
    writeFileSync(recordPath, `${JSON.stringify(record, null, 1)}\n`, { flag: 'wx' });
    results.push(record);
  }
  return results;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const ri = rest.indexOf('--repo'), repo = ri >= 0 ? rest[ri + 1] : null;
  if (!repo) throw new Error('usage: pass-b-cloud-bundle.mjs <skip|export|import> --repo <evidence-repo> [--push]');
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'inherit' });
  if (cmd === 'budget') {
    const b = readSpend(repo); console.log(`cloud spend so far $${b.totalUsd.toFixed(2)} across ${b.sessions} session(s); remaining $${b.remainingUsd.toFixed(2)} of $${TOTAL_BUDGET_USD}`);
    console.log(`export PASS_B_CLOUD_BUDGET_USD=${b.remainingUsd.toFixed(2)}`);
  } else if (cmd === 'skip') {
    const n = writeSkip({ repo }); console.log(`skip list: ${n} ids -> ${join(repo, 'state', 'skip.json')}`);
  } else if (cmd === 'export') {
    const made = exportBundles({ repo });
    const spend = recordSpend({ repo });
    console.log(`cloud spend recorded: total $${spend.totalUsd.toFixed(2)}, remaining $${spend.remainingUsd.toFixed(2)}`);
    console.log(made.length ? made.map(b => `${b.bundleId}: ${b.works} works, ${(b.bytes / 1048576).toFixed(1)} MB`).join('\n') : 'nothing new to export');
    if (rest.includes('--push')) { git('add', 'bundles', 'state'); git('commit', '-q', '-m', `cloud B1-B3 evidence: ${made.map(b => b.bundleId).join(', ')}`); git('push', '-q'); }
  } else if (cmd === 'import') {
    const res = importBundles({ repo });
    for (const r of res) console.log(`${r.bundleId}: imported ${r.imported.length}, skipped ${r.skipped.length}, rejected ${r.rejected.length}${r.rejected.length ? ' — ' + r.rejected.slice(0, 3).map(x => `${x.id}: ${x.reason}`).join('; ') : ''}`);
    if (!res.length) console.log('no new bundles');
  } else throw new Error(`unknown command ${cmd}`);
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main().catch(e => { console.error(`FAIL-CLOSED: ${e.message}`); process.exit(1); });
