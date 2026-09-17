// Corpus-scale Pass B evidence collection, B0-B3 ONLY (no B4/reconciliation/release-policy/approval/owner
// decisions/production). Smallest wrapper around the verified primitives: img-broker, runWorkStages(skipB4),
// stage validators + capture, loadOrArchiveCompletion (verified resume). Repaired per owner spec:
//  1. run identity binds model + collector version + broker + transport + validation + B1-B3 (NOT B4) prompt
//     hashes; a B4 change never invalidates B0-B3. Verified migration of prior completed works, old run kept.
//  2. canonical vision-system.md scheduling priority (not alphabetical), with region/source/medium rotation.
//  3. held works terminal by default; narrow named requeue; a B2 schema fail that spent its retry is not re-called.
//  4. monotonic exclusive attempt ids (identical/empty stdout never overwrites); attempt + retry counters
//     persisted across resumes; global stage totals recomputed from verified artifacts; no negative totals;
//     queue derived from verified terminal states (no fragile cursor).
//  5. failure taxonomy: retryable transport (1 retry) | usage-limit (stop, never retry) | fatal
//     (apiKeySource!=none, model drift, contract mismatch, checkpoint-integrity, confinement) -> abort.
//  6. exclusive run lease + per-work-stage leases; a second collector is refused.
//  7. cached derivatives rehashed before every reuse; b0-prep reopened + verified vs image/catalog/legacy.
//  8. robust CLI main guard (relative invocation runs).
//   node scripts/pass-b-corpus-collect.mjs                      # DRY: queue+ledger+migration check, no calls
//   PASS_B_CORPUS_LIVE=1 node scripts/pass-b-corpus-collect.mjs --run
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, copyFileSync, mkdtempSync, rmSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import broker, { BROKER_POLICY_VERSION } from './lib/img-broker.mjs';
import { sha256, stableJson } from './lib/vision-legacy.mjs';
import { captureStageCompletion, verifyCapturedStage } from './lib/vision-content-capture.mjs';
import { stagePrompts } from './lib/pass-b-prompts.mjs';
import {
  RUN_ROOT, CALIBRATION_MODEL, IMAGE_TRANSPORT_VERSION, VALIDATION_CONTRACT_VERSION,
  trustedCatalog, snapshotLegacy, runWorkStages, neutralImageFile, parseStreamTranscript, transcriptFinal,
  verifyB1ImageRead, verifyB2WebEvents, primaryModelFromEnvelope, loadOrArchiveCompletion,
  legacyContentInput, b2InputFor, b2Plan, b3Plan,
} from './lib/pass-b-calibration.mjs';

export const COLLECTOR_VERSION = 'passBCorpusCollector/2';
const LANES = 4;
const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const execFileP = promisify(execFile);
const prompts = stagePrompts();
const PROMPT_HASHES_B0B3 = { B1: sha256(prompts.B1), B2: sha256(prompts.B2), B3: sha256(prompts.B3) }; // B4 EXCLUDED
// Hash the FULL contract directly (calibrationContract/contractHash intentionally ignores non-calibration
// fields like model/broker, so we must not route through it here — item 1 requires binding all of them).
export function computeRunId(contract) { return 'corpus-b3-' + sha256(stableJson(contract)).slice(0, 12); }
// Run identity binds model + collector + broker + transport + validation + B1-B3 prompt hashes ONLY. A B4
// prompt/schema change is deliberately excluded, so it can never invalidate B0-B3 collection.
export function runIdFor({ promptHashes, model = CALIBRATION_MODEL, collector = COLLECTOR_VERSION }) {
  return computeRunId({ scope: 'corpus-through-b3', collector, prompts: { B1: promptHashes.B1, B2: promptHashes.B2, B3: promptHashes.B3 }, model, broker: BROKER_POLICY_VERSION, transport: IMAGE_TRANSPORT_VERSION, validation: VALIDATION_CONTRACT_VERSION });
}
// Queue is derived from verified terminal states: priority order minus done minus held (no fragile cursor).
export function computeQueue(order, { eligibleSet, doneSet, heldSet }) { return order.filter(id => eligibleSet.has(id) && !doneSet.has(id) && !heldSet.has(id)); }
export function derivativeMatches(path, sha) { try { return existsSync(path) && createHash('sha256').update(readFileSync(path)).digest('hex') === sha; } catch { return false; } }
const RUN_ID = runIdFor({ promptHashes: { ...PROMPT_HASHES_B0B3, B4: sha256(prompts.B4) } });
const RUN_DIR = join(RUN_ROOT, RUN_ID);
const IMGS_DIR = join(RUN_DIR, 'imgs');
const IMAGE_INDEX = join(IMGS_DIR, 'image-index.json');
const LEDGER = join(RUN_DIR, 'ledger.json');
const RUN_LEASE = join(RUN_DIR, 'collector.lease');
const PRIOR_RUN = 'corpus-b3-d0d9f638d9c1'; // pre-fork run to migrate verified works from (kept unchanged)

const rawFileSha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const loadGlobal = (file, name) => { const w = {}; new Function('window', readFileSync(file, 'utf8'))(w); return w[name]; };
const wdirOf = (id) => join(RUN_DIR, 'works', sha256(id).slice(0, 24));
const atomicWrite = (path, text) => { const tmp = `${path}.tmp-${process.pid}`; writeFileSync(tmp, text, { mode: 0o600 }); renameSync(tmp, path); };

class UsageLimitError extends Error {}
class FatalError extends Error {}
class RetryableError extends Error {}
const USAGE_MARKER = /usage limit|spend limit|rate.?limit|quota/i;

// ---- item 2: canonical scheduling priority + rotation ----
const normQ = (id) => { const m = String(id).match(/Q\d+/i); return m ? m[0].toUpperCase() : String(id); };
export function buildPriorityQueue(pool, daily, { today }) {
  const poolIds = new Set(pool.map(p => p.id));
  const byQ = new Map(); for (const p of pool) byQ.set(normQ(p.id), p.id);
  const resolve = (id) => poolIds.has(id) ? id : (byQ.get(normQ(id)) || null);
  const meta = new Map(pool.map(p => [p.id, p]));
  const dates = Object.keys(daily.byDate || {}).sort();
  const dayIds = (from, to) => { const out = []; for (const d of dates) if (d >= from && d < to) for (const tier of ['easy', 'medium', 'hard', 'impossible']) for (const raw of (daily.byDate[d][tier] || [])) { const r = resolve(raw); if (r) out.push(r); } return out; };
  const plus = (n) => { const dt = new Date(`${today}T00:00:00Z`); dt.setUTCDate(dt.getUTCDate() + n); return dt.toISOString().slice(0, 10); };
  const tierIds = (t) => (daily[t] || []).map(resolve).filter(Boolean);
  const fameQuintile = (ids) => { const withFame = ids.map(id => ({ id, fame: meta.get(id)?.fame ?? 0 })).sort((a, b) => b.fame - a.fame); const cut = Math.ceil(withFame.length / 5); return new Set(withFame.slice(0, cut).map(x => x.id)); };
  const medium = tierIds('medium'), hard = tierIds('hard'), impossible = tierIds('impossible');
  const topFame = fameQuintile([...medium, ...hard, ...impossible]);
  // rotation within a band: round-robin across region|src|medium buckets so coverage isn't host/region-concentrated.
  const rotate = (ids) => {
    const seen = new Set(); const buckets = new Map(); const order = [];
    for (const id of ids) { if (seen.has(id) || !meta.has(id)) continue; seen.add(id); const p = meta.get(id); const k = `${p.region || '?'}|${p.src || '?'}|${p.medium || '?'}`; if (!buckets.has(k)) { buckets.set(k, []); order.push(k); } buckets.get(k).push(id); }
    const out = []; let live = true; while (live) { live = false; for (const k of order) { const b = buckets.get(k); if (b.length) { out.push(b.shift()); live = true; } } } return out;
  };
  const bands = [
    dayIds(today, plus(7)),                                   // 1: next 7 scheduled days
    dayIds(plus(7), plus(30)),                                // 2: days 8-30
    tierIds('easy'),                                          // 3: Easy tier (missing/stale filtered later by done)
    [...medium, ...hard, ...impossible].filter(id => topFame.has(id)), // 4: highest-fame quintile of M/H/I
    medium, hard, impossible,                                 // 5,6,7: remaining Medium / Hard / Impossible
    pool.map(p => p.id),                                      // 8: any remaining corpus work (fallback) — fame order
  ];
  const placed = new Set(); const queue = [];
  bands.forEach((band, i) => { const rb = i === 7 ? band.filter(id => !placed.has(id)).sort((a, b) => (meta.get(b)?.fame ?? 0) - (meta.get(a)?.fame ?? 0)) : rotate(band); for (const id of rb) if (!placed.has(id)) { placed.add(id); queue.push(id); } });
  return queue;
}

// ---- item 5: pure failure classifier ----
export function classifySpawn({ usageLimit, apiKeySource, model, expectedModel, exitCode, final, isError, subtype, structuredOutputPresent, imageReceipt, webEvents }) {
  if (usageLimit) return { kind: 'usage-limit' };
  if (apiKeySource !== 'none') return { kind: 'fatal', reason: `apiKeySource must be none, got ${apiKeySource}` };
  if (imageReceipt && Array.isArray(imageReceipt.bad) && imageReceipt.bad.length) return { kind: 'fatal', reason: `confinement violation: ${imageReceipt.bad.join(',')}` };
  if (exitCode !== 0 || !final) return { kind: 'retryable', reason: `process failed (exit ${exitCode})` };
  if (isError === true || (subtype && subtype !== 'success')) return { kind: 'retryable', reason: `stage errored (subtype=${subtype})` };
  if (!model) return { kind: 'fatal', reason: 'no resolved model — cannot confirm identity' };
  if (model !== expectedModel) return { kind: 'fatal', reason: `model drift: ${model} != ${expectedModel}` };
  if (!structuredOutputPresent) return { kind: 'retryable', reason: 'no structured_output' };
  if (imageReceipt && !imageReceipt.ok) return { kind: 'retryable', reason: `image receipt: ${imageReceipt.reason}` };
  if (webEvents && !webEvents.ok) return { kind: 'retryable', reason: webEvents.reason };
  return { kind: 'ok' };
}

// ---- item 4: monotonic exclusive attempt filename ----
export function attemptFilename(stage, seq, stdout) { return `${stage.toLowerCase()}-${String(seq).padStart(6, '0')}-${sha256(String(stdout)).slice(0, 8)}.transcript.jsonl`; }

// ---- reconstruct the exact effective prompt (for promptHash verification on reuse/migration) ----
function effectivePromptFor(stage, { id, catalog, legacy, imageFile, b1body, b2body, b3body }) {
  const legacyInput = legacyContentInput(legacy);
  if (stage === 'B1') return `${prompts.B1}\n\nThe working directory contains exactly one image file: ./${imageFile}\nCall the Read tool on ./${imageFile} to view the artwork, then inventory ONLY what you actually see. If Read fails or returns no image, set imageFitness.ok=false and do not invent content.`;
  if (stage === 'B2') return `${prompts.B2}\n\nCATALOG+SIGNALS:\n${JSON.stringify(b2InputFor(id, catalog, b1body))}\n\nEXISTING CONTENT:\n${JSON.stringify(legacyInput)}`;
  if (stage === 'B3') return `${prompts.B3}\n\nThe working directory contains exactly one image file: ./${imageFile}\nCall the Read tool on ./${imageFile}, then answer ONLY these targeted requests.\n\nLOCATE:\n${JSON.stringify(b3Plan(b2body).requests)}`;
  return null;
}

// ---- run-wide counters recomputed from verified artifacts (item 4) ----
function countAttempts(runDir) { const wd = join(runDir, 'works'); if (!existsSync(wd)) return 0; let n = 0; for (const w of readdirSync(wd)) { const a = join(wd, w, 'attempts'); if (existsSync(a)) n += readdirSync(a).filter(f => f.endsWith('.transcript.jsonl')).length; } return n; }
// derive whether a work is terminally DONE (through B3) from its verified completions + planning.
function deriveDone(id, legacy) {
  const dir = join(wdirOf(id), 'completions'); if (!existsSync(dir)) return false;
  const body = (stage) => { const f = readdirSync(dir).find(x => x.startsWith(`${stage.toLowerCase()}-`)); return f ? JSON.parse(readFileSync(join(dir, f), 'utf8')).body : null; };
  const b1 = body('B1'); if (!b1) return false;
  const needB2 = b2Plan(b1, legacy).run; const b2 = body('B2'); if (needB2 && !b2) return false;
  const needB3 = b2 ? b3Plan(b2).run : false; const b3 = body('B3'); if (needB3 && !b3) return false;
  return true;
}

function readLedger() { if (existsSync(LEDGER)) { try { return JSON.parse(readFileSync(LEDGER, 'utf8')); } catch { /* fall through */ } } return { version: 'passBCorpusLedger/2', runId: RUN_ID, heldIds: [], attemptSeq: 0, transportRetries: 0, validationRetries: 0 }; }

let STOP = false, FATAL = null, ATTEMPT_SEQ = 0, TRANSPORT_RETRIES = 0;

function makeSpawnStage(workRunDir, imgSha256, ext, id) {
  const attemptsDir = join(workRunDir, 'attempts'); mkdirSync(attemptsDir, { recursive: true, mode: 0o700 });
  const once = async (stage, command, imageFile) => {
    const lease = join(workRunDir, `${stage}.lease`);
    try { writeFileSync(lease, `${process.pid} ${new Date().toISOString()}`, { flag: 'wx' }); } catch (e) { if (e.code === 'EEXIST') throw new FatalError(`stage ${stage} leased by another collector`); throw e; }
    const call = mkdtempSync(join(tmpdir(), 'corpus-'));
    try {
      if (imageFile) copyFileSync(join(IMGS_DIR, `${imgSha256}.${ext}`), join(call, imageFile));
      const env = { ...process.env }; for (const k of command.env.removeKeys) delete env[k];
      let stdout = '', exitCode = 0;
      try { ({ stdout } = await execFileP(command.bin, command.argv, { cwd: call, env, maxBuffer: 64 * 1024 * 1024 })); }
      catch (e) { exitCode = e.code ?? 1; stdout = e.stdout || ''; }
      const seq = ++ATTEMPT_SEQ;
      writeFileSync(join(attemptsDir, attemptFilename(stage, seq, stdout)), stdout, { flag: 'wx', mode: 0o600 }); // exclusive; never overwrites
      const transcript = parseStreamTranscript(stdout); const final = transcriptFinal(transcript);
      const rl = stdout.split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).find(o => o && o.type === 'rate_limit_event');
      const usageLimit = (rl && rl.rate_limit_info?.status === 'rejected') || final?.api_error_status === 429 || (final?.is_error && USAGE_MARKER.test(String(final?.result || '')));
      const imageReceipt = (stage === 'B1' || stage === 'B3') ? verifyB1ImageRead(transcript, { callDir: call, imageBasename: imageFile }) : null;
      const webEvents = stage === 'B2' ? verifyB2WebEvents(transcript) : null;
      const cls = classifySpawn({ usageLimit, apiKeySource: transcript.init?.apiKeySource ?? null, model: primaryModelFromEnvelope(final), expectedModel: CALIBRATION_MODEL, exitCode, final, isError: final?.is_error, subtype: final?.subtype, structuredOutputPresent: final?.structured_output != null, imageReceipt, webEvents });
      if (cls.kind === 'usage-limit') { STOP = true; throw new UsageLimitError('subscription usage limit'); }
      if (cls.kind === 'fatal') { FATAL = `${id}/${stage}: ${cls.reason}`; throw new FatalError(cls.reason); }
      if (cls.kind === 'retryable') throw new RetryableError(cls.reason);
      return { raw: JSON.stringify(final.structured_output), transcriptSha256: sha256(stdout) };
    } finally { rmSync(call, { recursive: true, force: true }); rmSync(lease, { force: true }); }
  };
  return async (stage, { command, imageFile }) => {
    try { return await once(stage, command, imageFile); }
    catch (e) {
      if (e instanceof UsageLimitError || e instanceof FatalError) throw e; // never retry usage/fatal
      TRANSPORT_RETRIES += 1; // one bounded transport retry; both attempts preserved
      return await once(stage, command, imageFile);
    }
  };
}
const makeCapture = (workRunDir) => async ({ stage, rawResponse, trusted, producer, context }) => {
  const cap = captureStageCompletion({ runDir: workRunDir, stage, rawResponse, trusted, producer, createdAt: new Date().toISOString(), context });
  const v = verifyCapturedStage({ completionPath: cap.completionPath, runDir: workRunDir, trusted, producer, context });
  if (!v.ok) throw new Error(v.errors.join(','));
  return cap;
};
const makeLoadCompletion = (workRunDir, id, imgSha256, ext) => (stage, { promptHash, context, bodies = {}, legacy = null }) =>
  loadOrArchiveCompletion({ stage, workRunDir, id, imgSha256, ext, promptHash, context, bodies, legacy, brokerPolicyVersion: BROKER_POLICY_VERSION, imageTransportVersion: IMAGE_TRANSPORT_VERSION, runtimeVersion: process.env.CLAUDE_CODE_VERSION || 'unknown' });

// ---- item 7: rehash-before-reuse image prep + b0-prep re-verification ----
async function prepImage(id, imgUrl, catalog, legacy, imageIndex) {
  const b0Path = join(wdirOf(id), 'b0-prep.json');
  const verifyB0 = (prep) => existsSync(join(IMGS_DIR, `${prep.imgSha256}.${prep.ext}`)) && rawFileSha(join(IMGS_DIR, `${prep.imgSha256}.${prep.ext}`)) === prep.imgSha256;
  if (existsSync(b0Path)) { // reopen + verify, never trust by existence
    try { const b0 = JSON.parse(readFileSync(b0Path, 'utf8'));
      if (b0.image?.ok && verifyB0(b0.image) && stableJson(b0.trustedCatalog) === stableJson(catalog) && stableJson(b0.legacy) === stableJson(legacy)) return b0.image;
    } catch { /* re-fetch below */ }
  }
  if (imageIndex[id]?.ok && verifyB0(imageIndex[id])) return imageIndex[id];
  for (const d of readdirSync(RUN_ROOT).filter(x => /^imgs-|^corpus-b3-/.test(x))) { // reuse a prior verified derivative
    const idxP = join(RUN_ROOT, d, d.startsWith('imgs-') ? 'image-index.json' : 'imgs/image-index.json'); if (!existsSync(idxP)) continue;
    let idx; try { idx = JSON.parse(readFileSync(idxP, 'utf8')); } catch { continue; }
    const e = idx[id]; if (!e?.ok) continue;
    const src = join(RUN_ROOT, d, d.startsWith('imgs-') ? '' : 'imgs', `${e.imgSha256}.${e.ext}`);
    if (existsSync(src) && rawFileSha(src) === e.imgSha256) { const dst = join(IMGS_DIR, `${e.imgSha256}.${e.ext}`); if (!existsSync(dst)) copyFileSync(src, dst); imageIndex[id] = { id, ok: true, imgSha256: e.imgSha256, ext: e.ext, reusedFrom: d }; atomicWrite(IMAGE_INDEX, `${JSON.stringify(imageIndex, null, 1)}\n`); return imageIndex[id]; }
  }
  await new Promise(r => setTimeout(r, 500));
  const f = await broker.fetchImageToModelFile(imgUrl, IMGS_DIR, { userAgent: BROWSER, referer: true });
  const prep = f.ok ? { id, ok: true, imgSha256: f.sha256, ext: f.ext, width: f.width, height: f.height, mime: f.mime, bytes: f.bytes } : { id, ok: false, reason: `${f.reason || 'fetch-failed'}${f.host ? ' @' + f.host : ''}` };
  if (prep.ok) { imageIndex[id] = prep; atomicWrite(IMAGE_INDEX, `${JSON.stringify(imageIndex, null, 1)}\n`); }
  return prep;
}

// ---- item 1: verified migration of prior completed works (old run preserved) ----
function migrateVerified(pool, teach, hotspots, vision, auditIds) {
  const oldDir = join(RUN_ROOT, PRIOR_RUN); if (!existsSync(join(oldDir, 'works'))) return { migrated: 0, skipped: 0 };
  const poolById = new Map(pool.map(p => [p.id, p]));
  let migrated = 0, skipped = 0;
  const oldLedger = existsSync(join(oldDir, 'ledger.json')) ? JSON.parse(readFileSync(join(oldDir, 'ledger.json'), 'utf8')) : { doneIds: [] };
  for (const id of oldLedger.doneIds || []) {
    const p = poolById.get(id); if (!p) { skipped++; continue; }
    const oldW = join(oldDir, 'works', sha256(id).slice(0, 24)); const newW = wdirOf(id);
    if (existsSync(join(newW, 'completions'))) { migrated++; continue; } // already migrated
    const catalog = trustedCatalog(p); const legacy = snapshotLegacy(id, { teach, hotspots, vision, auditIds });
    try {
      const b0 = JSON.parse(readFileSync(join(oldW, 'b0-prep.json'), 'utf8'));
      const imgFile = `${b0.image.imgSha256}.${b0.image.ext}`; const oldImg = join(oldDir, 'imgs', imgFile);
      if (!existsSync(oldImg) || rawFileSha(oldImg) !== b0.image.imgSha256) { skipped++; continue; } // image integrity
      if (stableJson(b0.trustedCatalog) !== stableJson(catalog) || stableJson(b0.legacy) !== stableJson(legacy)) { skipped++; continue; } // catalog/legacy snapshot
      const compDir = join(oldW, 'completions'); const attDir = join(oldW, 'attempts');
      const bodies = {}; let ok = true;
      for (const stage of ['B1', 'B2', 'B3']) {
        const cf = existsSync(compDir) ? readdirSync(compDir).find(x => x.startsWith(`${stage.toLowerCase()}-`)) : null;
        if (!cf) continue; const comp = JSON.parse(readFileSync(join(compDir, cf), 'utf8'));
        // transcript by recorded sha
        const tf = existsSync(attDir) ? readdirSync(attDir).find(x => sha256(readFileSync(join(attDir, x), 'utf8')) === comp.transcriptSha256) : null;
        if (!tf) { ok = false; break; }
        const tr = parseStreamTranscript(readFileSync(join(attDir, tf), 'utf8')); const final = transcriptFinal(tr);
        if ((tr.init?.apiKeySource ?? null) !== 'none') { ok = false; break; }
        if (primaryModelFromEnvelope(final) !== CALIBRATION_MODEL) { ok = false; break; }
        if (sha256(JSON.stringify(final.structured_output)) !== comp.rawResponseSha256) { ok = false; break; }
        const promptHash = sha256(effectivePromptFor(stage, { id, catalog, legacy, imageFile: imgFile, b1body: bodies.B1, b2body: bodies.B2 }));
        if (comp.promptHash !== promptHash) { ok = false; break; }
        if ((stage === 'B1' || stage === 'B3') && !verifyB1ImageRead(tr, { callDir: null, imageBasename: imgFile }).ok) { ok = false; break; }
        if (stage === 'B2' && !verifyB2WebEvents(tr).ok) { ok = false; break; }
        bodies[stage] = comp.body;
      }
      if (!ok || !bodies.B1) { skipped++; continue; }
      // copy image + whole work dir (b0-prep + completions + attempts) into the new run
      const dst = join(IMGS_DIR, imgFile); if (!existsSync(dst)) copyFileSync(oldImg, dst);
      mkdirSync(newW, { recursive: true, mode: 0o700 });
      for (const sub of ['completions', 'attempts']) { const s = join(oldW, sub); if (!existsSync(s)) continue; mkdirSync(join(newW, sub), { recursive: true, mode: 0o700 }); for (const f of readdirSync(s)) copyFileSync(join(s, f), join(newW, sub, f)); }
      copyFileSync(join(oldW, 'b0-prep.json'), join(newW, 'b0-prep.json'));
      const ii = existsSync(IMAGE_INDEX) ? JSON.parse(readFileSync(IMAGE_INDEX, 'utf8')) : {}; ii[id] = { id, ok: true, imgSha256: b0.image.imgSha256, ext: b0.image.ext, migratedFrom: PRIOR_RUN }; atomicWrite(IMAGE_INDEX, `${JSON.stringify(ii, null, 1)}\n`);
      migrated++;
    } catch { skipped++; }
  }
  return { migrated, skipped };
}

async function main() {
  const live = process.argv.includes('--run');
  if (live && process.env.PASS_B_CORPUS_LIVE !== '1') { console.error('refusing --run: set PASS_B_CORPUS_LIVE=1'); process.exit(2); }
  const pool = loadGlobal('data/pool.js', 'ARTEFACTUM_POOL');
  const poolById = new Map(pool.map(p => [p.id, p]));
  const daily = loadGlobal('data/daily-order.js', 'ARTEFACTUM_DAILY') || { byDate: {} };
  const teach = (loadGlobal('data/teach-works.js', 'ARTEFACTUM_CUES') || {}).work || {};
  const hotspots = loadGlobal('data/hotspots.js', 'ARTEFACTUM_HOTSPOTS') || {};
  const vision = loadGlobal('data/vision.js', 'ARTEFACTUM_VISION') || {};
  const auditIds = new Set(JSON.parse(readFileSync('data/vision-audit.json', 'utf8')).ids || []);
  const today = new Date().toISOString().slice(0, 10);
  mkdirSync(join(RUN_DIR, 'works'), { recursive: true, mode: 0o700 }); mkdirSync(IMGS_DIR, { recursive: true, mode: 0o700 });

  const mig = migrateVerified(pool, teach, hotspots, vision, auditIds);
  const led = readLedger(); ATTEMPT_SEQ = Math.max(led.attemptSeq || 0, countAttempts(RUN_DIR)); TRANSPORT_RETRIES = led.transportRetries || 0;
  const heldSet = new Set(led.heldIds || []);
  // item 3: explicit narrow requeue of named held works
  const requeue = process.env.PASS_B_CORPUS_REQUEUE ? process.env.PASS_B_CORPUS_REQUEUE.split(',').map(s => s.trim()).filter(Boolean) : [];
  for (const id of requeue) heldSet.delete(id);

  const order = buildPriorityQueue(pool, daily, { today });
  const eligible = order.filter(id => { const p = poolById.get(id); return p && typeof p.img === 'string' && p.img.trim(); });
  const legacyOf = (id) => snapshotLegacy(id, { teach, hotspots, vision, auditIds });
  const doneSet = new Set(eligible.filter(id => deriveDone(id, legacyOf(id)))); // recomputed from verified artifacts
  const queue = eligible.filter(id => !doneSet.has(id) && !heldSet.has(id));
  // item 4: global stage-completion totals recomputed from VERIFIED artifacts (not session counters), each persist.
  const recomputeStageTotals = () => { const wd = join(RUN_DIR, 'works'); let b1 = 0, b2 = 0, b3 = 0; if (existsSync(wd)) for (const w of readdirSync(wd)) { const c = join(wd, w, 'completions'); if (!existsSync(c)) continue; const has = (s) => readdirSync(c).some(f => f.startsWith(s)); if (has('b1-')) b1++; if (has('b2-')) b2++; if (has('b3-')) b3++; } return { b1, b2, b3 }; };
  const stageTotals = recomputeStageTotals();

  const totals = { queued: eligible.length, done: doneSet.size, held: heldSet.size, remaining: Math.max(0, eligible.length - doneSet.size - heldSet.size), b1Complete: stageTotals.b1, b2Complete: stageTotals.b2, b3Complete: stageTotals.b3, attempts: ATTEMPT_SEQ, transportRetries: TRANSPORT_RETRIES };
  console.log(`runId: ${RUN_ID}`);
  console.log(`migration from ${PRIOR_RUN}: migrated ${mig.migrated}, skipped ${mig.skipped}`);
  console.log(`eligible ${eligible.length} | done(verified) ${doneSet.size} | held(terminal) ${heldSet.size} | remaining ${totals.remaining}${requeue.length ? ` | requeued ${requeue.length}` : ''}`);
  console.log(`prompt hashes (B1-B3 only, B4 excluded): B1=${PROMPT_HASHES_B0B3.B1.slice(0, 8)} B2=${PROMPT_HASHES_B0B3.B2.slice(0, 8)} B3=${PROMPT_HASHES_B0B3.B3.slice(0, 8)} | model ${CALIBRATION_MODEL} | lanes ${LANES} | attempts ${ATTEMPT_SEQ}`);
  const persist = () => { const st = recomputeStageTotals(); led.heldIds = [...heldSet]; led.attemptSeq = ATTEMPT_SEQ; led.transportRetries = TRANSPORT_RETRIES; led.totals = { queued: eligible.length, done: doneSet.size, held: heldSet.size, remaining: Math.max(0, eligible.length - doneSet.size - heldSet.size), b1Complete: st.b1, b2Complete: st.b2, b3Complete: st.b3, attempts: ATTEMPT_SEQ, transportRetries: TRANSPORT_RETRIES, validationRetries: led.validationRetries || 0 }; led.updatedAt = new Date().toISOString(); led.stopReason = FATAL ? `fatal:${FATAL}` : (STOP ? 'usage-limit (cursor derived from verified terminal states; resume when capacity resets)' : null); atomicWrite(LEDGER, `${JSON.stringify(led, null, 1)}\n`); };
  persist();
  if (!live) { console.log('\nDRY CHECK: queue built (priority order), ledger + migration verified, checkpoints resumable. No calls/fetches. Re-run with PASS_B_CORPUS_LIVE=1 --run.'); return; }

  // item 6: exclusive run lease
  try { writeFileSync(RUN_LEASE, `${process.pid} ${new Date().toISOString()}`, { flag: 'wx' }); } catch (e) { if (e.code === 'EEXIST') { console.error(`REFUSED: another collector holds the run lease (${readFileSync(RUN_LEASE, 'utf8')}). Remove ${RUN_LEASE} if stale.`); process.exit(3); } throw e; }
  const releaseLease = () => { try { unlinkSync(RUN_LEASE); } catch { /* ignore */ } };
  process.on('exit', releaseLease);

  const imageIndex = existsSync(IMAGE_INDEX) ? JSON.parse(readFileSync(IMAGE_INDEX, 'utf8')) : {};
  let processed = 0, cursor = 0;
  const processOne = async (id) => {
    const p = poolById.get(id); const workRunDir = wdirOf(id); mkdirSync(workRunDir, { recursive: true, mode: 0o700 });
    const catalog = trustedCatalog(p); const legacy = legacyOf(id);
    let prep;
    try { prep = await prepImage(id, p.img, catalog, legacy, imageIndex); } catch (e) { if (e instanceof UsageLimitError) throw e; prep = { ok: false, reason: `b0:${e.message.slice(0, 60)}` }; }
    if (!prep.ok) { heldSet.add(id); console.log(`HELD ${id} B0:${prep.reason}`); return; }
    if (!existsSync(join(workRunDir, 'b0-prep.json'))) writeFileSync(join(workRunDir, 'b0-prep.json'), `${JSON.stringify({ version: 'passBCalibrationB0/1', work: { id }, trustedCatalog: catalog, legacy, image: prep }, null, 1)}\n`, { mode: 0o600 });
    const { status, retries } = await runWorkStages({ workId: id, catalog, legacy, imgSha256: prep.imgSha256, ext: prep.ext, prompts, runtimeVersion: process.env.CLAUDE_CODE_VERSION || 'unknown', spawnStage: makeSpawnStage(workRunDir, prep.imgSha256, prep.ext, id), capture: makeCapture(workRunDir), loadCompletion: makeLoadCompletion(workRunDir, id, prep.imgSha256, prep.ext), skipB4: true });
    if (retries?.B2?.attempts) led.validationRetries = (led.validationRetries || 0) + retries.B2.attempts;
    if (deriveDone(id, legacy)) doneSet.add(id);
    else { heldSet.add(id); console.log(`HELD ${id}: ${JSON.stringify(status)}`); } // B2 schema fail after its retry is terminal here (not re-called next resume)
  };
  const lane = async () => {
    while (!STOP && !FATAL) {
      const idx = cursor++; if (idx >= queue.length) break; const id = queue[idx];
      try { await processOne(id); }
      catch (e) {
        if (e instanceof UsageLimitError) { STOP = true; console.log(`USAGE-LIMIT at ${id} — stopping cleanly`); break; }
        if (e instanceof FatalError) { FATAL = FATAL || `${id}: ${e.message}`; console.error(`FATAL at ${id}: ${e.message} — aborting run`); break; }
        heldSet.add(id); console.log(`WORK ERROR ${id}: ${e.message}`);
      }
      processed++; persist();
      if (processed % 100 === 0) console.log(`... processed ${processed} this session | done ${doneSet.size} | held ${heldSet.size} | attempts ${ATTEMPT_SEQ} | transportRetries ${TRANSPORT_RETRIES} | remaining ${Math.max(0, eligible.length - doneSet.size - heldSet.size)}`);
    }
  };
  await Promise.all(Array.from({ length: LANES }, lane));
  persist(); releaseLease();
  if (FATAL) { console.error(`\nFATAL ABORT: ${FATAL}. Run halted; artifacts preserved.`); process.exit(1); }
  console.log(`\n${STOP ? 'STOPPED (usage limit) — resume when capacity resets.' : 'CORPUS PASS COMPLETE (this session).'} done ${doneSet.size}/${eligible.length} | held ${heldSet.size} | attempts ${ATTEMPT_SEQ} | transportRetries ${TRANSPORT_RETRIES}`);
}

// item 8: robust main guard — relative or absolute invocation both run.
const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) main().catch(e => { console.error(`FAIL-CLOSED: ${e.message}`); process.exit(1); });
