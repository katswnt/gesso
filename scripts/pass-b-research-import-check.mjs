// VSD-092 review: offline real-bank B1 import receipt check. Downloads a few REAL banked works (B0, image, B1
// completion/raw/transcript/reservation/meta and the execution epoch the reservation names) read-only via `gh api`
// into a scratch copy of the banked run layout, then runs the stopgap import exactly as the collector would:
// inspectBankedWork -> writeImport -> verifyImportedB1 (bindings, original model/epoch, prompt hash, strict schema,
// transcript, exact-image receipt and the stage capability policy). It proves the banked copy is unchanged afterwards.
// No model calls, no clone, no writes to the evidence repo or to data/incoming.
//
//   node scripts/pass-b-research-import-check.mjs [workId ...]     # default: three canary works with banked B1
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

process.env.PASS_B_RESEARCH_VERSION = 'stopgap-1';
const C = await import('./pass-b-corpus-collect.mjs');
const { trustedCatalog, snapshotLegacy } = await import('./lib/pass-b-calibration.mjs');
const { inspectBankedWork, writeImport, verifyImportedB1 } = await import('./lib/pass-b-research-stopgap.mjs');
const { stagePrompts } = await import('./lib/pass-b-prompts.mjs');

const REPO = 'katswnt/gesso-pass-b-evidence', REF = 'claude/pass-b-state', RUN = `incoming/vision-calibration/${C.BANKED_RUN_ID}`;
const DEFAULT = ['aic67362', 'cleveland136178', 'met53573'];
const sha = b => createHash('sha256').update(b).digest('hex');
const gh = (path, raw = false) => execFileSync('gh', ['api', path, ...(raw ? ['-H', 'Accept: application/vnd.github.raw'] : [])], { maxBuffer: 256 * 1024 * 1024, ...(raw ? {} : { encoding: 'utf8' }) });
const tree = sub => JSON.parse(gh(`repos/${REPO}/git/trees/${REF}:${RUN}/${sub}?recursive=1`)).tree.filter(t => t.type === 'blob');
const blob = s => gh(`repos/${REPO}/git/blobs/${s}`, true);
const load = (file, name) => { const w = {}; new Function('window', readFileSync(file, 'utf8'))(w); return w[name]; };
const snapshot = dir => { const out = {}; const walk = (d, p = '') => { for (const e of readdirSync(d, { withFileTypes: true })) { const k = `${p}${e.name}`; if (e.isDirectory()) walk(join(d, e.name), `${k}/`); else out[k] = sha(readFileSync(join(d, e.name))); } }; walk(dir); return out; };

const pool = load('data/pool.js', 'ARTEFACTUM_POOL'), byId = new Map(pool.map(p => [p.id, p]));
const teach = (load('data/teach-works.js', 'ARTEFACTUM_CUES') || {}).work || {}, hotspots = load('data/hotspots.js', 'ARTEFACTUM_HOTSPOTS') || {}, vision = load('data/vision.js', 'ARTEFACTUM_VISION') || {};
const auditIds = new Set(JSON.parse(readFileSync('data/vision-audit.json', 'utf8')).ids || []);
const ids = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT;
const scratch = mkdtempSync(join(tmpdir(), 'b1-import-check-')), banked = join(scratch, 'banked'), fresh = join(scratch, 'new');
const results = [];
try {
  for (const id of ids) {
    const p = byId.get(id); if (!p) { results.push({ id, ok: false, reason: 'not in the pool' }); continue; }
    const h = sha(id).slice(0, 24), wd = join(banked, 'works', h);
    // B0 + B1 evidence only (B2/B3 are never imported).
    for (const t of tree(`works/${h}`).filter(t => t.path === 'b0-prep.json' || /^(attempts|completions)\/b1-/.test(t.path) || t.path.startsWith('raw/'))) {
      mkdirSync(dirname(join(wd, t.path)), { recursive: true }); writeFileSync(join(wd, t.path), blob(t.sha));
    }
    const b0 = JSON.parse(readFileSync(join(wd, 'b0-prep.json'), 'utf8'));
    const img = `${b0.image.imgSha256}.${b0.image.ext}`, imgEntry = JSON.parse(gh(`repos/${REPO}/contents/${RUN}/imgs/${img}?ref=${encodeURIComponent(REF)}`));
    if (imgEntry) { mkdirSync(join(banked, 'imgs'), { recursive: true }); writeFileSync(join(banked, 'imgs', img), blob(imgEntry.sha)); }
    for (const r of readdirSync(join(wd, 'attempts')).filter(f => f.endsWith('.reserved.json'))) {
      const n = JSON.parse(readFileSync(join(wd, 'attempts', r), 'utf8')).executionEpoch ?? 0;
      const rel = n === 0 ? 'execution-policy.json' : `execution-policies/${String(n).padStart(6, '0')}.json`;
      mkdirSync(dirname(join(banked, rel)), { recursive: true });
      writeFileSync(join(banked, rel), gh(`repos/${REPO}/contents/${RUN}/${rel}?ref=${encodeURIComponent(REF)}`, true));
    }
    const catalog = trustedCatalog(p), legacy = snapshotLegacy(id, { teach, hotspots, vision, auditIds });
    const before = snapshot(banked);
    const ins = inspectBankedWork({ bankedRunDir: banked, bankedRunId: C.BANKED_RUN_ID, id, catalog, legacy, bankedB1Prompt: stagePrompts().B1 });
    if (!ins.ok || !ins.b1) { results.push({ id, ok: false, reason: ins.reason || ins.b1Reason }); continue; }
    const nwd = join(fresh, 'works', h); mkdirSync(nwd, { recursive: true });
    const manifest = writeImport({ workDir: nwd, imgsDir: join(fresh, 'imgs'), runId: C.CORPUS_RUN_ID, bankedRunId: C.BANKED_RUN_ID, id, catalog, legacy, banked: ins, now: new Date('2026-11-20T00:00:00Z') });
    const v = verifyImportedB1({ workDir: nwd, runId: C.CORPUS_RUN_ID, id, catalog, legacy, b0: ins.b0, bankedB1Prompt: stagePrompts().B1, manifest });
    const unchanged = JSON.stringify(before) === JSON.stringify(snapshot(banked));
    const same = JSON.stringify(v.body) === JSON.stringify(ins.b1.body);
    results.push({ id, ok: unchanged && same, model: v.model, epoch: manifest.b1.epochNumber, promptHash: manifest.b1.promptHash.slice(0, 12), imgSha256: ins.b0.image.imgSha256.slice(0, 12),
      completionSha256: manifest.b1.completionSha256.slice(0, 12), transcriptSha256: manifest.b1.transcriptSha256.slice(0, 12), bankedUnchanged: unchanged, bodyIdentical: same });
  }
} finally { rmSync(scratch, { recursive: true, force: true }); }
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.id}${r.ok ? ` | model ${r.model} epoch ${r.epoch} | prompt ${r.promptHash} | image ${r.imgSha256} | completion ${r.completionSha256} | transcript ${r.transcriptSha256} | banked copy unchanged, imported body identical` : ` | ${r.reason || JSON.stringify(r)}`}`);
console.log(`real-bank B1 import receipts: ${results.filter(r => r.ok).length}/${results.length} verified (banked run ${C.BANKED_RUN_ID} -> stopgap run ${C.CORPUS_RUN_ID}). No calls, no evidence writes.`);
if (results.some(r => !r.ok)) process.exit(1);
