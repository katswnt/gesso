// Shared contract for the tool-less vision pass (G-03). Defines the run-scoped provenance layout, the STRICT
// completion schema + a nonempty-subset approval-patch schema (fail-closed), and the approval verifier both merges
// must use so schema-valid-but-false model output can never auto-apply: only a human-reviewed approved.json — bound
// to runId + sanitized-image sha + the reviewed completion file's sha + the completion's own full header (prompt +
// schema + broker-policy + MODEL), with the exact approved VALUES copied in — may mutate data.
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, lstatSync, existsSync, readFileSync, realpathSync, openSync, writeSync, closeSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { BROKER_POLICY_VERSION } from './img-broker.mjs';
import { SCHEMA_VERSION } from './vision-ledger.mjs';

export { SCHEMA_VERSION, BROKER_POLICY_VERSION };
// Re-export the dependency-free ledger contract so the merge/provenance side imports everything from one place.
export { LEGACY_PASS, MIN_NOTES, imageDefect, imageTrusted, visionPassStatus, notesComplete, ledgerTransition, auditedOracle, legacyEvidenceIds, blockedIds } from './vision-ledger.mjs';

// ---------- run directory (fresh, random, 0700, exclusive, symlink-refusing) ----------
export function createRunDir(base = 'data/incoming/vision/runs') {
  mkdirSync(base, { recursive: true });
  if (lstatSync(base).isSymbolicLink()) throw new Error('run base is a symlink');   // a symlinked base would place the run (and imgs/) outside the tree
  const realBase = realpathSync(base);   // canonical base (ancestor symlinks resolved consistently)
  const runId = randomBytes(16).toString('hex');
  const dir = join(base, runId);
  if (existsSync(dir)) throw new Error('run collision');
  mkdirSync(dir, { recursive: false, mode: 0o700 });
  if (lstatSync(dir).isSymbolicLink()) throw new Error('run dir is a symlink');
  // the created run dir must REALLY live directly under base (a symlinked path component must not redirect it elsewhere)
  if (realpathSync(dir) !== join(realBase, runId)) throw new Error('run dir resolves outside its base (symlinked path component)');
  const imgsDir = join(dir, 'imgs'); mkdirSync(imgsDir, { mode: 0o700 });
  const completionsDir = join(dir, 'completions'); mkdirSync(completionsDir, { mode: 0o700 });
  return { runId, dir, imgsDir, completionsDir, manifestPath: join(dir, 'manifest.json'), approvedPath: join(dir, 'approved.json') };
}
// The manifest header is FROZEN at run-build time and carries NO modelId (the model is decided by the runner and
// recorded inside each completion record's own full header, so a later re-run with a different model cannot relabel
// existing completions through a mutable manifest).
export function runHeader(runId, promptHash) {
  return { runId, promptHash, schemaVersion: SCHEMA_VERSION, brokerPolicyVersion: BROKER_POLICY_VERSION };
}
export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
export const promptHashOf = (text) => sha256(Buffer.from(String(text), 'utf8'));
// completion filenames are id-HASHED (pool ids can contain '/', ':' etc. — never used as a raw path component)
export const completionFile = (id) => sha256(Buffer.from(String(id), 'utf8')) + '.json';
// canonical (key-sorted) JSON so a hash is stable regardless of key order
export function canonicalJson(obj) {
  const sort = (v) => Array.isArray(v) ? v.map(sort) : (v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sort(v[k])])) : v);
  return JSON.stringify(sort(obj));
}
// binds the EXACT text the model was given (id + meta) to the image it was shown, so a manifest edited after the
// run (e.g. a changed title) is detected at approval time
// binds id + meta + image sha + the base-state hash (baseSha) the run was built from. Including baseSha here means a
// post-run manifest edit of baseSha no longer matches the completion's metaSha → the stale-state guard can't be defeated.
export const metaShaOf = (id, meta, imgSha256, baseSha) => sha256(Buffer.from(canonicalJson({ id, meta, imgSha256, baseSha }), 'utf8'));

// The strict completion / approved-patch schemas live in the dependency-free vision-schema.mjs so vision-ledger can
// cross-validate evidence with the SAME validator. Imported (for local use in verifyApproval) + re-exported here.
import { validateCompletion, validateApprovedPatch } from './vision-schema.mjs';
export { validateCompletion, validateApprovedPatch };

// ---------- path confinement (defends the runner + verifier against a tampered manifest) ----------
// A manifest is a local file that could be tampered. NEVER build an image path from a manifest string directly
// (imgFile / sha256 / ext) — a value like "../../etc/passwd" would escape imgs/ and let the runner send an
// arbitrary local file to the model. Derive the path ONLY from a strictly-validated 64-hex sha + short-alnum ext,
// then confirm the resolved path stays inside <runDir>/imgs/. Returns the safe absolute path or null.
export function safeImgPath(runDir, sha256hex, ext) {
  if (typeof runDir !== 'string' || !runDir) return null;
  if (typeof sha256hex !== 'string' || !/^[0-9a-f]{64}$/.test(sha256hex)) return null;
  if (typeof ext !== 'string' || !/^[a-z0-9]{1,5}$/.test(ext)) return null;   // hex+alnum can't form '/' or '..'
  const imgsDir = resolve(runDir, 'imgs');
  const name = `${sha256hex}.${ext}`;
  const p = resolve(imgsDir, name);
  if (p !== imgsDir + sep + name) return null;                                // lexical confinement
  // SYMLINK defense — lexical resolve() does NOT follow filesystem links (ancestor components included). realpath
  // resolves EVERY link: imgs/ must be a REAL directory that is EXACTLY <realRunDir>/imgs (so imgs/ — or any parent
  // component — can't be a link pointing OUT of the run), and the derivative (if present) must be a REAL, non-symlink
  // regular file directly under it. This closes the "symlinked ancestor / imgs / derivative" escape.
  try {
    const realImgs = realpathSync(imgsDir);
    if (realImgs !== realpathSync(runDir) + sep + 'imgs') return null;
    if (!lstatSync(realImgs).isDirectory()) return null;
    try { const fS = lstatSync(p); if (fS.isSymbolicLink()) return null; if (realpathSync(p) !== realImgs + sep + name) return null; }
    catch { /* not-yet-existing file: safe; the caller's read surfaces the real error */ }
  } catch { return null; }
  return p;
}

// ---------- per-work base-state hash (guards against a STALE run overwriting a newer merge) ----------
// A run's approval binds to the state the run was BUILT from. If a NEWER run changed a work between build and apply,
// re-applying the older run would clobber the newer data. workStateSha hashes exactly the authoritative fields a
// vision merge reads/writes for one work; vision-next records it per item at build time and curate-merge refuses to
// apply a work whose LIVE state no longer matches (reject-before-write). Also closes the crash window (a half-applied
// run changes the live state, so the same run no longer matches and can't be blindly re-applied).
// Covers EVERY authoritative per-work state a vision merge can change: pool fields, teach notes, hotspots, the work's
// CURRENT ledger status (so an older run can't demote/replace a newer terminal ledger entry when the art-content
// fields happen to be unchanged), and no-pins membership. (The global MOVEMENTS registry is deliberately excluded:
// movement inserts are additive + idempotent — re-adding an existing key is a no-op — so it isn't a per-work
// demotion vector, and folding a global into every work's hash would mass-invalidate runs on any movement add.)
export function workStateSha(p, c, h, entry, noPinsMember) {
  p = p || {}; c = c || {};
  const state = {
    style: p.style ?? null, styleKind: p.styleKind ?? null, medium: p.medium ?? null,
    play: p.play ?? null, cats: Array.isArray(p.cats) ? p.cats : null, img: p.img ?? null, y: p.y ?? null,
    notes: Array.isArray(c.notes) ? c.notes : null, hot: h ?? null,
    // the FULL semantic ledger entry: status + pass + the blocked-image identity (img + imgSha). A needs-image blocker
    // carries its failed derivative hash; WITHOUT imgSha in the base state, two same-URL re-audits that produced
    // DIFFERENT derivatives would hash identically, letting a stale older run replace a newer blocker result.
    ledger: entry ? { status: entry.status ?? null, pass: entry.pass ?? null, img: entry.img ?? null, imgSha: entry.imgSha ?? null } : null,
    noPins: !!noPinsMember,
  };
  return sha256(Buffer.from(canonicalJson(state), 'utf8'));
}

// deep structural equality via canonical (key-sorted) JSON — used to enforce the approval ALLOWLIST
const deepEq = (a, b) => canonicalJson(a) === canonicalJson(b);

// ---------- exclusive merge lock (serializes curate-merge; concurrent merges would race the stale-state check) ----------
// A merge reads + validates canonical state, then writes several files. Without a lock, two mergers can both validate
// the same base state and the second silently clobbers the first (losing ledger / applied-run updates). acquireLock is
// an O_EXCL create: it succeeds for exactly ONE holder; a second caller gets false until the holder releases.
export function acquireLock(lockPath) {
  try { const fd = openSync(lockPath, 'wx'); writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() })); closeSync(fd); return true; }
  catch (e) { if (e.code === 'EEXIST') return false; throw e; }
}
export function releaseLock(lockPath) { try { rmSync(lockPath, { force: true }); } catch {} }

// ---------- approval verifier (used by BOTH merges; reject-before-write) ----------
// approved.json = { header:{runId,promptHash,schemaVersion,brokerPolicyVersion,modelId}, items:[ { id, imgSha256,
//   completionSha256, approved:{...exact subset copied from the reviewed completion...} } ] }
// completion record = { header:{runId,promptHash,schemaVersion,brokerPolicyVersion,modelId}, id, imgSha256, result }
// Verifies: approved header ⊆ frozen manifest header + a modelId; every derivative re-hashes to manifest sha; every
// completion FILE re-hashes to the recorded completionSha256, and its PARSED record binds the same id/imgSha/header/
// model and carries a schema-valid full result; every approved patch re-validates as a nonempty subset.
export function verifyApproval(runDir) {
  const errors = [];
  // the run dir AND its imgs/ + completions/ subdirs must be REAL dirs, not symlinks (a symlinked subdir would let a
  // tampered tree redirect derivative/completion reads outside the run — lexical path checks alone don't catch this)
  try {
    if (lstatSync(runDir).isSymbolicLink()) return { ok: false, errors: ['run dir is a symlink'] };
    for (const sub of ['imgs', 'completions']) { const st = lstatSync(join(runDir, sub)); if (st.isSymbolicLink() || !st.isDirectory()) return { ok: false, errors: [`${sub}/ is not a real directory (symlink?)`] }; }
  } catch { return { ok: false, errors: ['run dir tree not a real directory'] }; }
  let approved, manifest;
  try { approved = JSON.parse(readFileSync(join(runDir, 'approved.json'), 'utf8')); } catch { return { ok: false, errors: ['approved.json unreadable'] }; }
  try { manifest = JSON.parse(readFileSync(join(runDir, 'manifest.json'), 'utf8')); } catch { return { ok: false, errors: ['manifest.json unreadable'] }; }
  const mh = manifest.header || {}, ah = approved.header || {};
  for (const k of ['runId', 'promptHash', 'schemaVersion', 'brokerPolicyVersion']) if (!ah[k] || ah[k] !== mh[k]) errors.push(`approved header ${k} mismatch`);
  if (ah.schemaVersion !== SCHEMA_VERSION) errors.push('schemaVersion not supported');
  if (ah.brokerPolicyVersion !== BROKER_POLICY_VERSION) errors.push('brokerPolicyVersion not supported');
  if (!ah.modelId || typeof ah.modelId !== 'string') errors.push('approved header missing modelId');
  // DUPLICATE-ID rejection: a manifest OR approval listing the same id twice is rejected outright — two patches for
  // one work (e.g. a trusted playable:false then an incomplete) would otherwise both apply and corrupt the ledger.
  const manIds = (manifest.items || []).map(m => m.id);
  if (new Set(manIds).size !== manIds.length) errors.push('duplicate id in manifest');
  const appIds = (approved.items || []).map(it => it.id);
  if (new Set(appIds).size !== appIds.length) errors.push('duplicate id in approved.json');
  if (errors.length) return { ok: false, errors };
  const byId = new Map((manifest.items || []).map(m => [m.id, m]));
  const batch = [];
  for (const it of (approved.items || [])) {
    const m = byId.get(it.id);
    if (!m) { errors.push(`approved id not in manifest: ${it.id}`); continue; }
    if (m.imgStatus !== 'ok' || !m.sha256) { errors.push(`manifest has no sanitized derivative for ${it.id}`); continue; }
    // 1) re-hash the on-disk sanitized derivative — path derived ONLY from a validated hex sha + alnum ext,
    //    confined to <runDir>/imgs/ (a tampered manifest can't point the read outside imgs/)
    const imgPath = safeImgPath(runDir, m.sha256, m.ext);
    if (!imgPath) { errors.push(`unsafe/invalid derivative path for ${it.id}`); continue; }
    if (m.imgFile != null && m.imgFile !== `imgs/${m.sha256}.${m.ext}`) { errors.push(`manifest imgFile mismatch for ${it.id}`); continue; }
    let db; try { db = readFileSync(imgPath); } catch { errors.push(`derivative unreadable for ${it.id}`); continue; }
    if (sha256(db) !== m.sha256 || it.imgSha256 !== m.sha256) { errors.push(`derivative sha mismatch for ${it.id}`); continue; }
    // 2) re-hash + PARSE the reviewed completion file
    let cb; try { cb = readFileSync(join(runDir, 'completions', completionFile(it.id))); } catch { errors.push(`completion unreadable for ${it.id}`); continue; }
    if (sha256(cb) !== it.completionSha256) { errors.push(`completion sha mismatch for ${it.id} (edited after review?)`); continue; }
    let rec; try { rec = JSON.parse(cb.toString('utf8')); } catch { errors.push(`completion unparseable for ${it.id}`); continue; }
    const rh = rec.header || {};
    if (rec.id !== it.id) { errors.push(`completion id mismatch for ${it.id}`); continue; }
    if (rec.imgSha256 !== m.sha256) { errors.push(`completion imgSha mismatch for ${it.id}`); continue; }
    // baseSha (the run's per-work base-state hash) must be a 64-hex string, bound into the completion, and unchanged
    // in the manifest since the run — so the stale-state guard can't be defeated by editing the manifest baseSha.
    if (typeof m.baseSha !== 'string' || !/^[0-9a-f]{64}$/.test(m.baseSha)) { errors.push(`missing/invalid baseSha for ${it.id}`); continue; }
    if (rec.baseSha !== m.baseSha) { errors.push(`completion baseSha mismatch for ${it.id}`); continue; }
    let hdrBad = false;
    for (const k of ['runId', 'promptHash', 'schemaVersion', 'brokerPolicyVersion']) if (rh[k] !== mh[k]) { errors.push(`completion header ${k} mismatch for ${it.id}`); hdrBad = true; }
    if (rh.modelId !== ah.modelId) { errors.push(`completion model mismatch for ${it.id}`); hdrBad = true; }
    if (hdrBad) continue;
    // bind id+meta+image+baseSha the model run recorded: recompute from the CURRENT manifest item — a post-run edit fails
    if (rec.metaSha !== metaShaOf(m.id, m.meta, m.sha256, m.baseSha)) { errors.push(`metadata mismatch for ${it.id} (manifest meta/baseSha edited after the run?)`); continue; }
    if (!validateCompletion(rec.result).ok) { errors.push(`completion result not schema-valid for ${it.id}`); continue; }
    // 3) the human's approved subset must be a valid nonempty patch AND an ALLOWLIST of the reviewed completion:
    // every approved field must DEEP-EQUAL the model's own value (this path SELECTS which model fields to apply; it is
    // NOT a human-correction path — a changed value is rejected, so "exact approved values from the completion" holds).
    const pv = validateApprovedPatch({ id: it.id, ...(it.approved || {}) });
    if (!pv.ok) { errors.push(`approved values invalid for ${it.id}: ${pv.errors.join(',')}`); continue; }
    let valBad = false;
    for (const k of Object.keys(it.approved || {})) { if (!deepEq(it.approved[k], (rec.result || {})[k])) { errors.push(`approved '${k}' for ${it.id} differs from the reviewed completion (corrections not allowed via this path)`); valBad = true; } }
    if (valBad) continue;
    batch.push({ id: it.id, approved: it.approved, imgSha256: m.sha256, baseSha: m.baseSha, completionSha256: it.completionSha256 });   // imgSha = the sanitized derivative; baseSha = the built-from work-state; completionSha = the reviewed completion file
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, header: ah, runId: ah.runId, batch };
}
