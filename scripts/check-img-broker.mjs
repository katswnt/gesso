#!/usr/bin/env node
// FAIL-CLOSED offline gate for the G-03 corpus-image / AI-agent boundary. Statically enforces that the hardened
// broker keeps its guards, that the vision audit is TOOL-LESS with URLs kept out of model context, that both merge
// paths apply only human-approved + hash-bound output, that every tool-capable image-agent entry point is retired,
// and that no test-only bypass leaks into production. No network.
//   node scripts/check-img-broker.mjs
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const R = p => join(ROOT, p);
const read = p => { try { return readFileSync(R(p), 'utf8'); } catch { return null; } };
const fails = [];
const need = (c, m) => { if (!c) fails.push(m); };
const has = (s, re) => !!s && re.test(s);

// ---- 1. broker guards ----
const broker = read('scripts/lib/img-broker.mjs');
need(broker, 'missing scripts/lib/img-broker.mjs');
if (broker) {
  for (const [re, m] of [
    [/export function classifyIp/, 'classifyIp export'], [/export function checkUrl/, 'checkUrl export'],
    [/export function redirectDecision/, 'redirectDecision export'], [/export async function validateAndReencode/, 'validateAndReencode export'],
    [/export function createBroker/, 'createBroker factory'], [/fetchImageToModelFile/, 'fetchImageToModelFile'],
    [/'metadata'/, 'metadata-IP guard'], [/'cgnat'/, 'CGNAT guard'], [/'ula'/, 'ULA guard'],
    [/'linklocal'/, 'link-local guard'], [/::ffff:|mapped/, 'IPv4-mapped guard'],
    [/limitInputPixels/, 'decode pixel limit'], [/failOn:\s*'warning'/, 'sharp failOn'],
    [/agent:\s*false/, 'no keep-alive (agent:false)'], [/servername:/, 'SNI preserved'],
    [/family:\s*pinned\.family/, 'connection family pinned'], [/o && o\.all/, 'pinLookup honors {all:true}'],
    [/socket\.remoteAddress/, 'peer-address verification'], [/!peer \|\|/, 'missing-peer fails closed'],
    [/remote-addr-mismatch/, 'remote-addr-mismatch reason'], [/dTimer\s*=\s*setTimeout/, 'hard chain-deadline timer'],
    [/boundedDerivativeUrl/, 'bounded upstream derivative'],
    [/maxRedirects/, 'redirect cap'], [/maxBytes/, 'byte cap'], [/deadlineAt/, 'per-chain wall-clock deadline'],
    [/openSync\([^)]*['"]wx['"]/, 'exclusive temp create (O_EXCL/wx)'], [/renameSync/, 'atomic rename'],
    [/modelCapPx|resize\(/, 'resolution cap'], [/scheme-not-https/, 'https-only'],
    [/mime-signature-mismatch/, 'MIME signature cross-check'],
  ]) need(has(broker, re), `broker: ${m} missing`);
  // negative checks run on comment-stripped code so explanatory prose can name what's forbidden
  const brokerCode = broker.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  need(!/\.withMetadata\(/.test(brokerCode), 'broker must NOT call .withMetadata() (would preserve EXIF)');
  need(!/return\s*\{[^}]*\bstream\b/.test(brokerCode) && !/\bprobeImage\b/.test(brokerCode), 'broker must not expose a public stream/probeImage (raw bytes could skip validation)');
  need(!/avif/i.test(brokerCode), 'Accept must not advertise AVIF (not in the MIME allowlist)');
  // DI default wires the REAL implementations; callers may not override the transport/TLS knobs per call
  need(has(broker, /createBroker\(\)\s*;?\s*$|const broker = createBroker\(\)/m), 'default broker must construct with real lookup/request');
  for (const bad of ['opts.agent', 'opts.lookup', 'opts.servername', 'opts.rejectUnauthorized', 'o.rejectUnauthorized'])
    need(!broker.includes(bad), `broker must not expose per-call ${bad} override`);
}

// ---- 2. no bypass seams anywhere ----
function walk(dir) { const out = []; for (const e of readdirSync(R(dir), { withFileTypes: true })) { if (e.name === 'node_modules' || e.name.startsWith('.')) continue; const p = join(dir, e.name); if (e.isDirectory()) out.push(...walk(p)); else if (/\.(mjs|js)$/.test(e.name)) out.push(p); } return out; }
const SELF = 'scripts/check-img-broker.mjs';
const codeFiles = [...walk('scripts'), ...walk('tests'), ...(existsSync(R('api')) ? walk('api') : []), ...(existsSync(R('server')) ? walk('server') : [])].filter(f => f !== SELF);
for (const tok of ['allowPrivate' + 'ForTest', 'IMG_BROKER' + '_BYPASS', '_' + 'lookup:']) {   // split so the gate can't self-match
  const hit = codeFiles.filter(f => (read(f) || '').includes(tok));
  need(hit.length === 0, `forbidden bypass token "${tok}" in: ${hit.join(', ')}`);
}

// ---- 3. tool-less prompt (no shell / URL / download) ----
const prompt = read('scripts/vision-audit-prompt.md');
need(prompt, 'missing vision-audit-prompt.md');
if (prompt) {
  for (const re of [/\bcurl\b/, /\bwget\b/, /-o\s+\/tmp/, /<img>/, /https?:\/\//]) need(!re.test(prompt), `prompt must not contain ${re}`);
  need(/tool-?less/i.test(prompt), 'prompt must state it is tool-less');
  need(/\bnot\b[\s\S]{0,80}(download|fetch|shell|open a link|read a file)/i.test(prompt), 'prompt must forbid download/fetch/shell/link/file');
}

// ---- 4. tool-less runner: no tools/agent wrapper, no URL in model payload, cost-gated, schema-validated ----
const runner = read('scripts/vision-audit-run.mjs');
need(runner, 'missing vision-audit-run.mjs');
if (runner) {
  need(!/tools\s*:/.test(runner), 'runner must not send a `tools` field (must be tool-less)');
  need(!/requestedUrl|finalUrl|item\.img\b|\.imgProvenance/.test(runner), 'runner must not put any URL/provenance into the model payload');
  need(/const userText =/.test(runner) && !/const userText =[^\n]*item\.id/.test(runner), 'model payload text must not include item.id (pool ids can be Wikidata URLs)');
  need(/metaShaOf\(item\.id, item\.meta, item\.sha256, item\.baseSha\)/.test(runner) && /baseSha: item\.baseSha/.test(runner),
    'runner must bind baseSha into the completion record + metaSha (so a post-run baseSha edit is detected)');
  need(/VISION_RUN_LIVE/.test(runner), 'runner must be cost-gated (VISION_RUN_LIVE)');
  need(/validateCompletion/.test(runner), 'runner must strict-schema-validate output');
}

// ---- 5. run dir hardening ----
const vrun = read('scripts/lib/vision-run.mjs');
need(vrun, 'missing lib/vision-run.mjs');
if (vrun) {
  need(/randomBytes\(/.test(vrun), 'run id must be cryptographically random');
  need(/0o700/.test(vrun), 'run dir must be mode 0700');
  need(/recursive:\s*false/.test(vrun) && /isSymbolicLink/.test(vrun), 'run dir must be exclusive + symlink-refusing');
  { const sc = read('scripts/lib/vision-schema.mjs') || ''; need(/only\(/.test(sc) && /badText/.test(sc), 'strict schema (no extra keys, no HTML/control chars) in vision-schema.mjs'); }
  need(/completionSha256/.test(vrun) && /verifyApproval/.test(vrun), 'approval verifier binds completion sha');
}

// ---- 6. both merge paths approval-gated + reject-before-write ----
const curate = read('scripts/curate-merge.mjs');
need(curate, 'missing curate-merge.mjs');
if (curate) {
  need(/verifyApproval/.test(curate) && /--run/.test(curate), 'curate-merge must require an approved --run manifest');
  need(/REJECT before write/i.test(curate), 'curate-merge must reject before write');
  need(!/files\.flatMap/.test(curate), 'curate-merge must NOT consume raw agent output files');
  // component-level completion: classification comes from the shared visionPassStatus; ledger mutation goes through
  // the shared, tested ledgerTransition (demotes a stale terminal, PRESERVES a needs-image blocker on an incomplete retry).
  need(/visionPassStatus\(w\)/.test(curate) && /ledgerTransition\(/.test(curate),
    'curate-merge must classify via visionPassStatus and mutate the ledger through the shared ledgerTransition');
  need(!/ensureLegacyPass/.test(curate), 'curate-merge must NOT auto-stamp legacyPass at runtime (no retroactive promotion of legacy evidence)');
  need(!/for \(const w of out\) ids\.add/.test(curate), 'curate-merge must NOT mark every approved id audited (partial approval must not complete the pass)');
  // IMAGE TRUST GATE: POSITIVE, explicit trust (image.ok+good+ok) must gate EVERY authoritative mutation — style,
  // medium, MOVEMENTS, playability, medium-drop, notes — computed BEFORE any mutation. A wrong-image approval that
  // still carried fields must not touch pool.js / index.html / teach-works.js / hotspots.js.
  need(/const trusted = imageTrusted\(w\)/.test(curate), 'curate-merge must compute positive image trust (imageTrusted) before any mutation');
  { const ti = curate.search(/const trusted = imageTrusted\(w\)/);
    const styleIdx = curate.search(/---- STYLE/);
    need(ti > 0 && styleIdx > 0 && ti < styleIdx, 'curate-merge must compute imageTrusted BEFORE the style/medium mutation block');
    need(/if \(trusted && f\.style\)/.test(curate) && /if \(trusted && f\.medium/.test(curate) && /if \(trusted\)/.test(curate) && /if \(trusted && Array\.isArray\(w\.notes\)/.test(curate),
      'curate-merge must gate style, medium, playability, and notes on positive image trust'); }
  // blocker state MUST live in the tracked ledger, not the gitignored priority.json
  need(!/writeFileSync\([^\n]*priority\.json/.test(curate), 'curate-merge must NOT write blockers to the gitignored data/incoming/vision/priority.json — persist needs-image in tracked data/vision-audit.json');
  // the audited-ledger commit must NOT be swallowed: a failed commit must fail the merge (non-zero exit)
  need(!/could not update vision-audit ledger/.test(curate), 'curate-merge must not swallow ledger-commit errors (a failed commit must fail the merge)');
  const applyIdx = curate.search(/writeFileSync\("data\/pool\.js"/);
  const verifyIdx = curate.search(/verifyApproval\(/);
  need(verifyIdx > 0 && (applyIdx < 0 || verifyIdx < applyIdx), 'verifyApproval must run before any pool write');
}

// ---- 6b. one SHARED, dependency-free eligibility oracle across selector + coverage gate ----
const ledgerSrc = read('scripts/lib/vision-ledger.mjs') || '';
need(ledgerSrc, 'missing scripts/lib/vision-ledger.mjs (shared ledger contract)');
need(ledgerSrc && !/img-broker|from ['"]sharp|node:dns|node:https|node:net/.test(ledgerSrc),
  'vision-ledger.mjs must stay dependency-free (no broker/sharp/dns/https/net) so check-pool can share it without loading the image broker');
for (const f of ['vision-next', 'check-pool']) {
  const s = read(`scripts/${f}.mjs`) || '';
  need(/auditedOracle\(/.test(s) && /vision-ledger\.mjs/.test(s),
    `${f}.mjs must derive vision eligibility from the shared auditedOracle (scripts/lib/vision-ledger.mjs), not bare ledger.ids`);
}
// check-pool must not fall back to reading bare vision-audit ids for coverage (the round-5 false-green source)
need(!/new Set\(\(JSON\.parse\(readFileSync\("data\/vision-audit\.json"[\s\S]{0,60}\.ids\)/.test(read('scripts/check-pool.mjs') || ''),
  'check-pool must not read bare vision-audit ids for coverage — use the shared auditedOracle');
// LEGACY EVIDENCE is never a current-pass completion: distinct immutable sentinel, and auditedOracle grants ONLY
// current-pass entries (no legacyPass grandfathering path). Positive image trust is required for a terminal status.
const ledgerCode = ledgerSrc.replace(/^\s*\/\/.*$/gm, '');   // strip line comments — assert on executable code only
need(/export const LEGACY_PASS/.test(ledgerSrc) && /export function imageTrusted/.test(ledgerSrc),
  'vision-ledger must export a distinct LEGACY_PASS sentinel + a positive imageTrusted predicate');
need(!/legacyCurrent|legacyPass === SCHEMA_VERSION|led\.legacyPass/.test(ledgerCode),
  'auditedOracle must NOT grandfather bare legacy ids via legacyPass (legacy evidence never satisfies current-pass eligibility)');
need(/if \(imageDefect\(w\)\) return 'needs-image'/.test(ledgerCode) && /if \(!imageTrusted\(w\)\) return 'incomplete'/.test(ledgerCode),
  'visionPassStatus must require positive image trust before any terminal status (a {playable:false}-only approval cannot exclude)');
// image.issue must be honored: a non-'none' issue is a defect / not trusted (rejects contradictory {ok:true,issue:wrong-art})
need(/issue != null && w\.image\.issue !== 'none'/.test(ledgerCode) && /w\.image\.issue == null \|\| w\.image\.issue === 'none'/.test(ledgerCode),
  "imageDefect/imageTrusted must honor image.issue (a non-'none' issue is untrusted, even with ok:true)");
// completion requires ENOUGH non-blank notes — a single/blank note can't mark a work complete
need(/export const MIN_NOTES/.test(ledgerCode) && /w\.notes\.length < MIN_NOTES/.test(ledgerCode) && /\.head\.trim\(\)/.test(ledgerCode),
  'notesComplete must enforce MIN_NOTES + non-blank head/body (a thin/blank note cannot complete the pass)');
const runSrc = (read('scripts/lib/vision-run.mjs') || '').replace(/^\s*\/\/.*$/gm, '');
// strict schema lives in the DEPENDENCY-FREE vision-schema.mjs (so vision-ledger can cross-validate evidence with the
// SAME validator); it must reject blank notes, contradictory image ok/issue, x-without-y pins, and noPins+pins.
{ const sc = (read('scripts/lib/vision-schema.mjs') || '');
  need(sc && !/img-broker|from ['"]sharp|node:dns|node:https|node:net|node:crypto|node:fs/.test(sc.replace(/^\s*\/\/.*$/gm, '')),
    'vision-schema.mjs must stay dependency-free (no crypto/fs/sharp/network) so vision-ledger + check-pool can share it');
  const scc = sc.replace(/^\s*\/\/.*$/gm, '');
  need(/n\.head\.trim\(\) === ''/.test(scc) && /v\.ok === \(v\.issue === 'none'\)/.test(scc) && /noPinsConsistent/.test(scc) && /hx !== hy/.test(scc) && /export function validateApprovedPatch/.test(scc),
    'vision-schema must reject blank notes, contradictory image ok/issue, x-without-y pins, and noPins+pins, and export validateApprovedPatch');
  need(/from '\.\/vision-schema\.mjs'/.test(runSrc), 'vision-run must re-export the schema from vision-schema.mjs (single source of truth)'); }
// path confinement: BOTH the runner and the verifier derive the image path via safeImgPath, never a raw manifest string
need(/export function safeImgPath/.test(runSrc), 'vision-run must export safeImgPath (confines derivative reads to imgs/)');
{ const runner = (read('scripts/vision-audit-run.mjs') || '').replace(/^\s*\/\/.*$/gm, '');
  need(/safeImgPath\(runDir, item\.sha256, item\.ext\)/.test(runner) && !/readFileSync\(join\(runDir, item\.imgFile\)\)/.test(runner),
    'vision-audit-run must read the derivative via safeImgPath(runDir, sha256, ext), NOT a raw item.imgFile path');
  need(/safeImgPath\(runDir, m\.sha256, m\.ext\)/.test(read('scripts/lib/vision-run.mjs') || ''),
    'verifyApproval must build the derivative path via safeImgPath, not join(runDir,"imgs",`${m.sha256}.${m.ext}`)'); }
// deep-pool selection must NOT skip play:false (legacy play:false decisions are unverified and must be re-auditable)
{ const vn = read('scripts/vision-next.mjs') || '';
  need(!/POOL\.filter\(p => p && p\.play !== false/.test(vn), 'vision-next deep-pool must not exclude play:false works (legacy unplayable decisions must be re-auditable)');
  // non-https images can never pass the HTTPS-only broker → must be filtered out of selection (else the pipeline loops)
  need(/const fetchable = /.test(vn) && /fetchable\(/.test(vn), 'vision-next must filter selection to fetchable (https) images so broker-unfetchable works do not loop');
  // a blocked work is dropped when its re-fetched derivative matches the blocked imgSha (in-place fix detection)
  need(/imgSha === r\.sha256/.test(vn), 'vision-next must drop a blocked work whose re-fetched derivative equals the recorded blocked imgSha'); }
// check-pool must surface non-https images (mixed-content + broker-unfetchable) as a tracked violation
need(/non-https-image/.test(read('scripts/check-pool.mjs') || ''), 'check-pool must flag non-https pool images (tracked status for the broker-unfetchable class)');
// SINGLE-USE runs + no-pins repin cleanup in curate-merge
if (curate) {
  need(/appliedRuns/.test(curate) && /already applied/.test(curate), 'curate-merge must refuse replay of an already-applied run (single-use, recorded in the tracked ledger)');
  need(/reviewedNoPins = reviewedNoPins\.filter/.test(curate), 'curate-merge must drop a stale no-pins exemption when a later pinned pass arrives');
}
// symlink confinement in the run-dir contract (lexical resolve() does NOT follow filesystem links)
need(/lstatSync\(base\)\.isSymbolicLink\(\)/.test(runSrc), 'createRunDir must reject a symlinked base dir');
need(/is not a real directory \(symlink\?\)/.test(runSrc), 'verifyApproval must reject symlinked imgs/ or completions/ subdirs');
{ // safeImgPath must REALPATH-confine (ancestor symlinks) — imgs must resolve to <realRunDir>/imgs, file non-symlink
  const spBody = (runSrc.split('export function safeImgPath')[1] || '').split('export function')[0] || '';
  need(/realpathSync\(imgsDir\)/.test(spBody) && /realpathSync\(runDir\)/.test(spBody) && /isSymbolicLink\(\)/.test(spBody),
    'safeImgPath must realpath-confine imgs/ to <realRunDir>/imgs and reject symlinked derivatives (ancestor symlinks too, not just lexical/direct)'); }
need(/resolves outside its base \(symlinked path component\)/.test(runSrc), 'createRunDir must realpath-verify the run dir lives under its base (ancestor symlink defense)');
need(/duplicate id in manifest/.test(runSrc) && /duplicate id in approved/.test(runSrc), 'verifyApproval must reject duplicate ids in the manifest and the approval');
// baseSha must be bound (64-hex + metaSha) and the approval must be an ALLOWLIST of the reviewed completion values
need(/typeof m\.baseSha !== 'string' \|\| !\/\^\[0-9a-f\]\{64\}/.test(runSrc) && /rec\.baseSha !== m\.baseSha/.test(runSrc) && /metaShaOf\(m\.id, m\.meta, m\.sha256, m\.baseSha\)/.test(runSrc),
  'verifyApproval must validate baseSha (64-hex), bind it via metaSha, and reject a manifest/completion baseSha mismatch');
need(/differs from the reviewed completion \(corrections not allowed/.test(runSrc) && /deepEq\(it\.approved\[k\]/.test(runSrc),
  'verifyApproval must enforce the approval ALLOWLIST — every approved value must deep-equal the reviewed completion (no silent corrections)');
// BASE-STATE guard: curate-merge must refuse a stale run whose live work-state drifted from the run's baseSha
need(!curate || (/workStateSha\(/.test(curate) && /base-state drift/i.test(curate) && /w\.baseSha/.test(curate) && /led\.entries\[w\.id\]/.test(curate)),
  'curate-merge must reject-before-write on base-state drift including the per-work LEDGER entry (a stale run must not demote a newer ledger status)');
// workStateSha must cover the per-work ledger entry + no-pins membership (not only art-content fields)
need(/ledger: entry \?/.test(runSrc) && /noPins:/.test(runSrc) && /imgSha: entry\.imgSha/.test(runSrc) && /img: entry\.img/.test(runSrc),
  'workStateSha must include the per-work ledger status+pass AND the blocked-image identity (img+imgSha) + no-pins membership (else two same-url re-audits with different derivatives hash identically)');
{ const vn = read('scripts/vision-next.mjs') || '';
  need(/workStateSha\(p, c, HOT\[id\] \|\| null, ledgerEntries\[id\] \|\| null, NOPINS\.has\(id\)\)/.test(vn), 'vision-next must record baseSha over pool+notes+hotspots+ledger-entry+no-pins (same inputs curate-merge checks)');
  // permanent broker failures (not just non-https) must be tracked + backed off; TRANSIENT failures retried, not skipped
  need(/vision-fetch-failures\.json/.test(vn) && /backedOff/.test(vn) && /MAX_FETCH_ATTEMPTS/.test(vn) && /isTransientFail/.test(vn) && /stableAttempts/.test(vn) && !/const isTransientFail = /.test(vn),
    'vision-next must back off on a SEPARATE stableAttempts counter (transient failures must not contaminate it) via the shared isTransientFail helper'); }
// isTransientFail is a shared, testable helper covering the full 5xx range (not a hardcoded subset) — not inlined regex-only
{ const lg = read('scripts/lib/vision-ledger.mjs') || '';
  need(/export function isTransientFail/.test(lg) && /s >= 500 && s <= 599/.test(lg),
    'isTransientFail must live in the shared ledger module and treat the whole 5xx range as transient'); }
// vision-review must be SELECT-ONLY: reject an edited value before writing, and not leave a poisoned approval file
{ const rv = read('scripts/vision-review.mjs') || '';
  need(!/optionally human-edited/.test(rv), 'vision-review instructions must not invite human edits (select-only)');
  need(/canonicalJson\(d\.approved\[k\]\) !== canonicalJson\(\(rec\.result/.test(rv), 'vision-review must reject an edited value (deep-eq vs the completion) before writing approved.json');
  need(/rmSync\(join\(runDir, "approved\.json"\)/.test(rv), 'vision-review must remove approved.json if self-verification fails (no poisoned exclusive file left behind)'); }
// DURABLE PROVENANCE: auditedOracle must CROSS-VERIFY against the evidence store (not just syntax-check hashes)
{ const lg = read('scripts/lib/vision-ledger.mjs') || '';
  need(/export function evidenceVerified/.test(lg) && /evidenceVerified\(id, e, evidence\)/.test(lg),
    'auditedOracle must cross-verify terminal entries against the evidence store (evidenceVerified), not merely syntax-check the hashes');
  need(/items\.length !== 1/.test(lg) && /h\.schemaVersion !== SCHEMA_VERSION/.test(lg),
    'evidenceVerified must fail closed on missing/duplicate items and a non-current evidence header');
  need(/hex64\(h\.promptHash\)/.test(lg) && /nonEmptyStr\(h\.brokerPolicyVersion\)/.test(lg) && /nonEmptyStr\(h\.modelId\)/.test(lg) && /hex64\(it\.baseSha\)/.test(lg) && /it\.approved/.test(lg),
    'evidenceVerified must require the FULL header (promptHash 64-hex + brokerPolicyVersion + modelId) and a valid item shape (baseSha 64-hex + approved object)');
  // the evidence approval must ACTUALLY PRODUCE the recorded terminal status (a thin/unplayable approval can't back 'complete')
  need(/visionPassStatus\(it\.approved\) === e\.status/.test(lg),
    'evidenceVerified must require visionPassStatus(it.approved) === entry.status (evidence must prove the recorded status, not just the hashes)');
  need(/validateApprovedPatch\(\{ id, \.\.\.it\.approved \}\)\.ok/.test(lg) && /from '\.\/vision-schema\.mjs'/.test(lg),
    'evidenceVerified must ALSO run the strict validateApprovedPatch (schema-invalid evidence must never earn credit)'); }
// both callers must LOAD + PASS the evidence store to the oracle
{ const vn = read('scripts/vision-next.mjs') || '', cp = read('scripts/check-pool.mjs') || '';
  need(/auditedOracle\(ledger, evidence\)/.test(vn) && /vision-evidence\.json/.test(vn), 'vision-next must load + pass the evidence store to auditedOracle');
  need(/auditedOracle\(JSON\.parse\(readFileSync\("data\/vision-audit\.json","utf8"\)\), ev\)/.test(cp) && /vision-evidence\.json/.test(cp), 'check-pool must load + pass the evidence store to auditedOracle'); }
need(!curate || (/t\.setEntry\.run = RUN_ID/.test(curate) && /t\.setEntry\.completionSha/.test(curate) && /data\/vision-evidence\.json/.test(curate)),
  'curate-merge must stamp each entry with run+imgSha+completionSha AND write the tracked data/vision-evidence.json audit trail');
// the `out` mapping must carry completionSha256 (dropping it makes every terminal entry fail hasEvidence — the v10 bug)
need(!curate || /completionSha256: b\.completionSha256/.test(curate), 'curate-merge out-mapping must carry completionSha256 from the verifyApproval batch (else terminal entries have no completionSha)');
// the evidence store must be LOADED + VALIDATED under the lock BEFORE any canonical write (malformed → reject, never silently reset to {})
{ const evLoad = (curate || '').search(/JSON\.parse\(readFileSync\("data\/vision-evidence\.json"/);
  const firstCanonWrite = (curate || '').search(/writeFileSync\("data\/pool\.js"/);
  need(!curate || (evLoad > 0 && firstCanonWrite > 0 && evLoad < firstCanonWrite), 'curate-merge must load the evidence store BEFORE the first canonical write');
  need(!curate || /is not a JSON object/.test(curate), 'curate-merge must reject a malformed/array-shaped evidence store (not silently replace it with {})'); }
// WRITE ORDER: evidence must be committed BEFORE the ledger (an evidence-less terminal entry must be impossible)
{ const ei = (curate || '').indexOf('data/vision-evidence.json", JSON'); const li = (curate || '').indexOf('data/vision-audit.json", JSON');
  need(ei > 0 && li > 0 && ei < li, 'curate-merge must write vision-evidence.json BEFORE vision-audit.json (evidence-first ordering)'); }
// the tracked evidence store must exist + be valid JSON (seed {}) so a clean checkout has the durable trail
{ const es = read('data/vision-evidence.json'); need(es != null, 'data/vision-evidence.json must be tracked (seed as {})'); try { JSON.parse(es); } catch { need(false, 'data/vision-evidence.json must be valid JSON'); } }
// EXCLUSIVE MERGE LOCK: curate-merge must acquire a lock before reading canonical state and release on exit
need(/export function acquireLock/.test(runSrc) && /O_EXCL|'wx'/.test(runSrc), 'vision-run must provide an O_EXCL acquireLock');
need(!curate || (/acquireLock\(LOCK\)/.test(curate) && /curate-merge\.lock/.test(curate) && /releaseLock\(LOCK\)/.test(curate)),
  'curate-merge must acquire an exclusive merge lock (held through writes) and release it on exit');
// v6-only hosts get a DISTINCT stable reason (not transient dns-failed) so they back off instead of looping forever
need(/err\('no-ipv4'/.test(read('scripts/lib/img-broker.mjs') || ''), "broker must return a distinct 'no-ipv4' reason for a v6-only host (stable, not transient)");
// check-pool must surface permanently broker-blocked images (backed-off inventory)
need(/vision-fetch-blocked/.test(read('scripts/check-pool.mjs') || ''), 'check-pool must surface permanently broker-blocked images (backed-off works)');
// the no-pins exemption evidence must be TRACKED (reproducible across clean checkouts), not under gitignored data/incoming
need(!/data\/incoming\/no-pins-reviewed\.json/.test(curate || '') && /data\/no-pins-reviewed\.json/.test(curate || ''),
  'no-pins-reviewed.json must live at the tracked data/ path, not gitignored data/incoming/');
// the committed ledger must carry the sentinel, not a real pass, so its 6k bare ids are not retroactively "complete"
try { const L = JSON.parse(read('data/vision-audit.json') || '{}');
  need(!L.legacyPass || L.legacyPass !== 'vision-audit/1', 'data/vision-audit.json legacyPass must not equal the current SCHEMA_VERSION (would retroactively promote legacy evidence)');
  const anyEntry = L.entries && Object.keys(L.entries).length;
  need(!anyEntry || Object.values(L.entries).every(e => e && typeof e.pass === 'string'), 'every vision-audit entry must carry a pass version');
} catch { need(false, 'data/vision-audit.json must be valid JSON'); }

// ---- 7. every tool-capable / unbrokered entry point retired (fail-closed) ----
for (const f of ['hotspot-codex', 'staged-hotspots', 'next-hotspots', 'hotspot-manifest', 'vision-v2-prep', 'vision-v2-merge',
                 'apply-review-verdicts', 'merge-hotspots', 'save-hotspots', 'vision-mark',
                 'guides-regen', 'merge-notes', 'merge-enrich', 'drain-queue', 'merge-v2notes', 'gen-verify']) {
  const s = read(`scripts/${f}.mjs`);
  need(s && /RETIRED \(G-03/.test(s) && /process\.exit\(1\)/.test(s), `${f}.mjs must be a fail-closed tombstone`);
  // verify INERTNESS from executable code only (strip // comments so explanatory prose can mention codex/fetch/etc.)
  const code = (s || '').replace(/^\s*\/\/.*$/gm, '');
  need(!/\bimport\b|\brequire\(|\bfetch\(|exec(File)?Sync|\bspawn\(|@vercel|\bput\(|arrayBuffer/.test(code), `${f}.mjs tombstone body must be inert (console.error + process.exit only)`);
}

// ---- 8. every active image→model consumer fetches corpus bytes via the broker; none buffers a raw fetch ----
for (const f of ['vision-next', 'vision-guess', 'vision-verify', 'vision-predict-human']) {
  const s = read(`scripts/${f}.mjs`) || '';
  const code = s.replace(/^\s*\/\/.*$/gm, '');
  need(/fetchImageToModelFile/.test(code), `${f}.mjs must acquire corpus images via the broker`);
  need(!/arrayBuffer/.test(code), `${f}.mjs must not buffer a raw corpus fetch (arrayBuffer)`);
}
// ---- 9. no shell URL interpolation OR concatenation, and no curl, in live vision/curate scripts ----
for (const f of codeFiles.filter(p => /scripts\/(vision-|curate-)/.test(p))) {
  const s = read(f) || '';
  const code = s.replace(/^\s*\/\/.*$/gm, '');
  need(!/exec(Sync)?\(`[^`]*\$\{[^}]*\}[^`]*`/.test(code), `${f}: no shell-string interpolation (use execFileSync(cmd,[args]))`);
  need(!/\bcurl\b/.test(code), `${f}: no curl in executable code`);
  need(!/(exec\w*|spawn)\([^)]*\bhttps?:\/\//.test(code) && !/(exec\w*|spawn)\([^)]*\+\s*\w*url/i.test(code), `${f}: no URL concatenation into a subprocess`);
}

// ---- 10. writer inventory (STRUCTURAL): EVERY writer of the 4 authoritative data files must be classified ----
// Detects writes via writeFileSync / appendFileSync / writeAtomic / writeAssignment (LITERAL, VARIABLE, or
// path.join first-arg) and the writeTeachWorks helper — so a new agent-output sink can't hide behind a variable,
// a helper, path.join, or append. A detected writer must be the approval-gated curate-merge, a retired tombstone,
// or an explicitly-allowlisted deterministic (non-agent) data op; anything else fails the gate.
const TGT = /(?:pool\.js|teach-works\.js|hotspots\.js|vision-audit\.json)/;
function dataWriters(src) {
  const binds = {};
  // ANY `name = "…target…"` (no const/let/var prefix required) so a comma-declaration (const A=.., OUT="…", B=..) is caught
  for (const m of src.matchAll(/(\w+)\s*=\s*[`'"][^`'"]*(?:pool\.js|teach-works\.js|hotspots\.js|vision-audit\.json)[`'"]/g)) binds[m[1]] = 1;
  for (const m of src.matchAll(/\b(?:writeFileSync|appendFileSync|writeAtomic|writeAssignment)\s*\(([\s\S]{0,160})/g)) {
    const arg = m[1];
    if (TGT.test(arg)) return true;                                  // literal or path.join(...literal...)
    const id = (arg.trim().match(/^(\w+)/) || [])[1];
    if (id && binds[id]) return true;                                // writeFileSync(VAR) where VAR = "...target..."
  }
  return /\bwriteTeachWorks\s*\(/.test(src);
}
const GUARDED = ['curate-merge.mjs'];   // the ONLY approval- + hash-bound agent sink; also the sole audited-ledger writer
const ALLOW = new Set([   // deterministic, human-run data ops (NOT model/agent-output sinks) — frozen inventory
  'apply-aat-merges.mjs', 'apply-endonym-canonical.mjs', 'apply-lowres-swaps.mjs', 'apply-museums.mjs', 'apply-review-mechanical.mjs',
  'audit-place.mjs', 'backfill-pool.mjs', 'border-trim.mjs', 'build-lifespans.mjs', 'build-teach-shards.mjs', 'clean-style.mjs',
  'collapse-theme-compounds.mjs', 'consolidate-styles.mjs', 'consolidate.mjs', 'dedup-pool.mjs', 'dedup-qid.mjs', 'dedupe-guides.mjs',
  'enrich-dimensions.mjs', 'enrich-wd-medium.mjs', 'fetch-yr.mjs', 'fix-blank-artists.mjs', 'fix-country-coords.mjs', 'fix-modern.mjs',
  'fix-place-coords.mjs', 'fix-support-medium.mjs', 'fix-surfaced-aic.mjs', 'fix-surfaced-aic2.mjs', 'fix-wrong-images.mjs',
  'geo-p937.mjs', 'harvest-aic-images.mjs', 'manual-notes.mjs', 'medium-revalidate.mjs', 'merge-harvest.mjs', 'merge-v1-to-v2.mjs',
  'normalize-images.mjs', 'patch-advisories.mjs', 'patch-coords.mjs', 'promote-canon.mjs', 'promote-coverage.mjs', 'promote-harvest.mjs',
  'promote-modern.mjs', 'promote-shortlist.mjs', 'promote-wishlist.mjs', 'queue-apply.mjs', 'queue-museum.mjs', 'queue-places.mjs',
  'reconcile-where.mjs', 'rehost-aic-blob.mjs', 'rehost-blob.mjs', 'rehost-harvard-blob.mjs', 'reresolve-aic.mjs',
  'resolve-commons-renames.mjs', 'resolve-harvard.mjs', 'resource-aic-fuzzy.mjs', 'resource-aic.mjs', 'resync-fame.mjs',
  'split-metacategories.mjs', 'verify-swaps.mjs',
]);
const classified = new Set([...GUARDED, ...ALLOW]);
const NOT_A_SINK = new Set(['check-img-broker.mjs', 'static-module.mjs']);   // this gate + the write-helper LIBRARY (defines the API)
for (const f of walk('scripts')) {
  const base = f.split('/').pop();
  if (NOT_A_SINK.has(base)) continue;
  if (dataWriters(read(f) || '')) need(classified.has(base), `unclassified writer of an authoritative data file: scripts/${base} — route it through curate-merge --run, retire it as a tombstone, or (if it is a deterministic non-agent op) allowlist it in check-img-broker.mjs`);
}
// mutation self-test: the detector must catch variable / path.join / writeAssignment / writeTeachWorks / append forms
for (const [frag, why] of [
  ['const OUT="data/pool.js";\nwriteFileSync(OUT, x)', 'writeFileSync(variable)'],
  ['const A="x", OUT="data/teach-works.js", B=18;\nwriteFileSync(OUT, y)', 'comma-declaration variable (gen-verify shape)'],
  ['writeFileSync(join("data", "teach-works.js"), x)', 'path.join first-arg'],
  ['writeAssignment("data/pool.js", "ARTEFACTUM_POOL", x)', 'writeAssignment helper'],
  ['appendFileSync("data/vision-audit.json", x)', 'appendFileSync'],
  ['const TW="data/teach-works.js"; writeTeachWorks(TW, m)', 'writeTeachWorks helper'],
]) need(dataWriters(frag), `writer detector misses ${why}`);
need(!dataWriters('const x = readFileSync("data/pool.js"); doThing(x)'), 'writer detector must not flag a read-only script');

if (fails.length) { console.error(`❌ FAIL — img-broker/G-03 gate (${fails.length}):`); for (const f of fails) console.error('  - ' + f); process.exit(1); }
console.log('✅ PASS — G-03: broker guards intact (IANA-derived SSRF v4/v6 + IPv4-only resolution + pin + peer-verify + agent:false + stream/decode caps + MIME/sig + EXIF-strip + bounded/clamped derivative, O_EXCL), no bypass seams, tool-less prompt + image-URL-free/id-free runner binding prompt+model+image+meta, run-dir hardened, both merges approval+hash-bound reject-before-write, every authoritative-data-file writer classified (guarded/retired/allowlisted), all tool-capable + raw-agent-output entry points retired, no shell URL interpolation');
