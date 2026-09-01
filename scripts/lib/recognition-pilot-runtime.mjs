// Append-only, crash-resumable runtime primitives for the recognition pilot.
// Files are written non-overwriting (O_EXCL) but remain ordinary writable files: integrity comes from
// recomputing each stored SHA and re-parsing the answer from the verified raw bytes on every read,
// plus binding the final diagnostics to a collection-evidence hash — not from filesystem immutability.
// No authoritative game path is accepted here; every artifact lives under the caller's isolated run dir.
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, realpathSync, lstatSync, linkSync, unlinkSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { sha256, canonicalJson, REQUEST_POLICY } from './recognition-pilot.mjs';

const HEX64 = /^[0-9a-f]{64}$/;

export function atomicJson(path, value) {
  mkdirSync(resolve(path, '..'), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  // linkSync is an atomic, non-overwriting publish: unlike rename, it fails if final already exists.
  // The fully-written temp remains recoverable if publishing fails; otherwise its extra link is removed.
  try { linkSync(tmp, path); unlinkSync(tmp); }
  catch (e) { throw Object.assign(new Error(`append-only artifact publish failed: ${path}`), { code: e.code, cause: e }); }
  return path;
}

// Read one result file and VERIFY it rather than trusting stored fields: the callId/attempt must match
// the filename, and when a provider body is present its SHA is recomputed and the answer re-parsed from
// those verified bytes. A mismatch is flagged tampered and never surfaces as a usable result.
function readVerifiedResult(dir, file, callId) {
  const m = file.match(/^attempt-(\d+)\.result\.json$/);
  const attempt = m ? Number(m[1]) : null;
  let obj;
  try { obj = JSON.parse(readFileSync(join(dir, file), 'utf8')); }
  catch { return { file, attempt, status: 'result-file-unparseable', verified: false, tampered: 'unparseable-result-file' }; }
  if (obj.callId !== callId || obj.attempt !== attempt) return { ...obj, verified: false, parsed: null, tampered: 'callId/attempt vs filename mismatch' };
  if (typeof obj.rawResponse === 'string') {
    if (sha256(obj.rawResponse) !== obj.responseSha256) return { ...obj, verified: false, parsed: null, tampered: 'response bytes edited (SHA mismatch)' };
    let content = null;
    try { const env = JSON.parse(obj.rawResponse); content = Array.isArray(env?.content) ? env.content.map(c => (c.type === 'text' ? c.text : '')).join('') : ''; }
    catch { return { ...obj, verified: false, parsed: null, tampered: 'raw response is not a JSON envelope' }; }
    const p = deterministicJsonParse(content);
    // Re-derive the answer from verified bytes; the stored parsed field is never trusted.
    return { ...obj, verified: true, parsed: obj.status === 'valid-response' && p.ok ? p.value : null, reparseOk: p.ok };
  }
  return { ...obj, verified: true, parsed: null };
}

export function callDir(runDir, callId) {
  if (!/^[0-9a-f]{24}$/.test(callId || '')) throw new Error('invalid callId');
  const root = resolve(runDir, 'attempts'), dir = resolve(root, callId);
  if (dir !== root + sep + callId) throw new Error('call path escape');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function callState(runDir, callId) {
  const dir = callDir(runDir, callId);
  const files = readdirSync(dir).sort();
  const intents = files.filter(f => /^attempt-\d+\.intent\.json$/.test(f));
  const results = files.filter(f => /^attempt-\d+\.result\.json$/.test(f));
  const parsed = results.map(f => readVerifiedResult(dir, f, callId));
  const tampered = parsed.filter(r => r.tampered);
  const primary = parsed.find(r => r.verified && r.status === 'valid-response') || null;
  const terminalInvalid = parsed.find(r => r.verified && r.status === 'schema-invalid') || null;
  const terminalApiError = parsed.find(r => r.verified && r.status === 'terminal-api-error') || null;
  return { dir, intents: intents.length, results: parsed, tampered, primary, terminalInvalid, terminalApiError, complete: !!(primary || terminalInvalid || terminalApiError) };
}

const RETRYABLE_HTTP = s => s === 408 || s === 425 || s === 429 || s >= 500;
const finiteUsage = u => !!u && Number.isFinite(u.input_tokens) && Number.isFinite(u.output_tokens) && u.input_tokens >= 0 && u.output_tokens >= 0;
const REQUEST_EVIDENCE_KEYS = ['freezeId', 'registrationCommit', 'imageSha256', 'promptSha256', 'requestPolicyVersion', 'requestedModel'];

// Derive ONE attempt's terminal/retryable outcome purely from its verified bytes (the SHA is checked by
// the caller before this runs). Every successful HTTP envelope — valid, schema-invalid, or model-drift —
// is terminal; only transport/rate-limit failures with no substantive answer are retryable.
function deriveOutcome(obj, { model, validator, pricing }) {
  const zero = { model: null, usage: null, usageMissing: false, billedUsd: 0, parsed: null, responseSha256: null };
  if (typeof obj.rawResponse === 'string') {
    let env = null; try { env = JSON.parse(obj.rawResponse); } catch { /* non-JSON success body */ }
    if (!env || typeof env !== 'object') return { outcome: 'schema-invalid', terminal: true, retryable: false, ...zero, responseSha256: obj.responseSha256 };
    const derivedModel = env.model || null;
    if (derivedModel && derivedModel !== model) return { outcome: 'model-drift', terminal: true, retryable: false, model: derivedModel, usage: env.usage || null, usageMissing: false, billedUsd: billedUsd(env.usage, pricing) || 0, parsed: null, responseSha256: obj.responseSha256 };
    const content = Array.isArray(env.content) ? env.content.map(c => (c.type === 'text' ? c.text : '')).join('') : '';
    const p = deterministicJsonParse(content);
    const valid = p.ok && !!validator && validator(p.value).ok && derivedModel === model;
    return { outcome: valid ? 'valid-response' : 'schema-invalid', terminal: true, retryable: false, model: derivedModel, usage: env.usage || null, usageMissing: valid && !finiteUsage(env.usage), billedUsd: billedUsd(env.usage, pricing) || 0, parsed: valid ? p.value : null, responseSha256: obj.responseSha256 };
  }
  const httpStatus = Number(obj.httpStatus);
  if (Number.isFinite(httpStatus)) {
    if (RETRYABLE_HTTP(httpStatus)) return { outcome: 'transport-retryable', terminal: false, retryable: true, ...zero, httpStatus };
    return { outcome: 'terminal-api-error', terminal: true, retryable: false, ...zero, httpStatus };
  }
  return { outcome: 'no-response-transport', terminal: false, retryable: true, ...zero };
}

// Authoritative post-collection ATTEMPT STATE MACHINE, shared by the runner's resume gate, the
// collection sealer, and the analyzer. It (1) requires contiguous intent attempts 1..N; (2) binds every
// intent to the frozen call hash AND — when expectedRequestEvidence is supplied — the exact frozen
// image/prompt/policy/model/freeze/conservative-cost the request must have used; (3) binds every result
// to exactly one verified intent; (4) derives each outcome from the verified raw bytes; (5) forbids any
// attempt after a terminal outcome (valid / schema-invalid / terminal-api-error / model-drift) and flags
// it as a protocol violation; (6) treats model drift as fatal for the whole run; (7) preserves the FIRST
// valid response as primary and never lets a later valid response erase an earlier violation; and, when
// collectionWindow is supplied, (8) requires every timestamp to be finite, ordered, and inside the
// frozen window. Nothing here trusts a stored status/model/usage/billed field.
export function verifyCollectedCall(runDir, call, { model, validator, pricing = REQUEST_POLICY.pricing, expectedRequestEvidence = null, collectionWindow = null, maxAttempts = REQUEST_POLICY.maxTransportAttemptsPerCall }) {
  const dir = callDir(runDir, call.callId);
  const files = readdirSync(dir).sort();
  const num = f => Number(f.match(/attempt-(\d+)\./)[1]);
  const intentFiles = files.filter(f => /^attempt-\d+\.intent\.json$/.test(f));
  const resultFiles = files.filter(f => /^attempt-\d+\.result\.json$/.test(f));
  const nums = intentFiles.map(num).sort((a, b) => a - b);
  const tampered = [];
  const contiguous = nums.every((n, i) => n === i + 1) && new Set(nums).size === nums.length;
  if (!contiguous) tampered.push('intent attempts are not a contiguous 1..N sequence');
  const N = nums.length;
  const callSha = sha256(canonicalJson(call));
  const windowStart = collectionWindow && Number.isFinite(collectionWindow.startMs) ? collectionWindow.startMs : null;
  const windowEnd = windowStart != null ? windowStart + collectionWindow.maxMs : null;
  const inWindow = (iso, label) => {
    if (windowStart == null) return true;
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) { tampered.push(`${label} timestamp is not parseable`); return false; }
    if (t < windowStart || t > windowEnd) { tampered.push(`${label} timestamp is outside the frozen collection window`); return false; }
    return true;
  };
  const intentByAttempt = new Map();
  for (const f of intentFiles) {
    let obj; try { obj = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { tampered.push(`intent ${f} unparseable`); continue; }
    if (obj.callId !== call.callId || obj.attempt !== num(f) || obj.callSha256 !== callSha) { tampered.push(`intent ${f} not bound to the frozen call`); continue; }
    if (expectedRequestEvidence) {
      const ev = obj.requestEvidence || {};
      for (const k of REQUEST_EVIDENCE_KEYS) if (ev[k] !== expectedRequestEvidence[k]) tampered.push(`intent ${f} requestEvidence.${k} does not match the frozen request`);
      if (Number(obj.conservativeUsd) !== Number(expectedRequestEvidence.conservativeUsd)) tampered.push(`intent ${f} conservativeUsd does not match the frozen cost row`);
    }
    inWindow(obj.startedAt, `intent ${f} startedAt`);
    intentByAttempt.set(obj.attempt, { sha256: sha256(readFileSync(join(dir, f))), obj });
  }
  const resultByAttempt = new Map();
  for (const f of resultFiles) {
    const attempt = num(f);
    let obj; try { obj = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { tampered.push(`result ${f} unparseable`); continue; }
    if (obj.callId !== call.callId || obj.attempt !== attempt) { tampered.push(`result ${f} callId/attempt vs filename mismatch`); continue; }
    if (!intentByAttempt.has(attempt)) { tampered.push(`result ${f} has no matching verified intent`); continue; }
    if (typeof obj.rawResponse === 'string' && sha256(obj.rawResponse) !== obj.responseSha256) { tampered.push(`result ${f} response bytes edited (SHA mismatch)`); continue; }
    inWindow(obj.finishedAt, `result ${f} finishedAt`);
    resultByAttempt.set(attempt, obj);
  }
  const attempts = [];
  for (let n = 1; n <= N; n++) {
    const intent = intentByAttempt.get(n);
    const result = resultByAttempt.get(n);
    const o = result ? deriveOutcome(result, { model, validator, pricing }) : { outcome: 'crash-no-result', terminal: false, retryable: true, model: null, usage: null, usageMissing: false, billedUsd: 0, parsed: null, responseSha256: null };
    attempts.push({ attempt: n, ...o, intentSha256: intent?.sha256 || null, requestEvidence: intent?.obj?.requestEvidence || null, conservativeUsd: intent?.obj?.conservativeUsd ?? null, startedAt: intent?.obj?.startedAt || null, finishedAt: result?.finishedAt || null, requestId: (typeof result?.requestId === 'string' ? result.requestId : null) });
  }
  // A terminal outcome must be the LAST attempt; any attempt after it is an outcome-retry (protocol
  // violation). A later valid response therefore cannot erase an earlier terminal/violation.
  const protocolViolations = [];
  for (let i = 0; i < attempts.length - 1; i++) if (attempts[i].terminal) protocolViolations.push(`outcome-retry after ${attempts[i].outcome} at attempt ${attempts[i].attempt}`);
  const modelDrift = attempts.find(a => a.outcome === 'model-drift') || null;
  const fatal = !!modelDrift;
  const primary = attempts.find(a => a.outcome === 'valid-response') || null;
  const terminalInvalid = attempts.find(a => a.outcome === 'schema-invalid') || null;
  const terminalApiError = attempts.find(a => a.outcome === 'terminal-api-error') || null;
  const terminalAttempt = attempts.find(a => a.terminal) || null;
  const complete = !!terminalAttempt;
  const last = attempts[attempts.length - 1] || null;
  const retryAllowed = !complete && !fatal && protocolViolations.length === 0 && contiguous && N < maxAttempts && (N === 0 || (last && last.retryable));
  const usageMissing = !!(primary && primary.usageMissing);
  return {
    callId: call.callId, dir, intents: N, attempts, results: attempts, primary, terminalInvalid, terminalApiError, modelDrift,
    complete, fatal, protocolViolations, retryAllowed, usageMissing,
    tampered: [...tampered, ...protocolViolations],
    billedUsd: +attempts.reduce((n, a) => n + Number(a.billedUsd || 0), 0).toFixed(8),
  };
}

// ONE shared collection-evidence builder used by BOTH the sealer and the analyzer, so the external
// anchor and the final-analysis re-derivation cannot drift. It binds the protocol-freeze identity +
// evidence-file hash + window, the frozen call-manifest hash, and — per call, per attempt — the intent
// artifact hash, validated request evidence, timestamps, request id, response bytes, derived status,
// verified usage, and actual/reserved cost. Mutating any of those changes the evidence hash.
export function buildCollectionEvidence({ runDir, manifest, calls, model, validators, pricing = REQUEST_POLICY.pricing, freezeEvidencePath, expectedEvidence, verifiedFreeze = null }) {
  // FAIL CLOSED: production evidence verification must never run with an absent or incomplete expected
  // request-evidence registry (that was the silent hole — verification with no bound expectation passes
  // a wrong image/prompt/model). Require one row for every frozen call.
  if (!(expectedEvidence instanceof Map)) throw new Error('buildCollectionEvidence: expectedEvidence registry (Map keyed by callId) is required');
  for (const c of calls.calls) if (!expectedEvidence.has(c.callId)) throw new Error(`buildCollectionEvidence: missing expected request evidence for call ${c.callId}`);
  let freezeEvidence = null, freezeEvidenceSha256 = null, collectionWindow = null;
  const freezeEvidenceErrors = [];
  if (freezeEvidencePath && existsSync(freezeEvidencePath)) {
    const bytes = readFileSync(freezeEvidencePath);
    freezeEvidenceSha256 = sha256(bytes);
    try { freezeEvidence = JSON.parse(bytes.toString('utf8')); } catch { freezeEvidence = null; freezeEvidenceErrors.push('run freeze evidence is not valid JSON'); }
    // The mutable run file records WHEN collection began; it must NOT redefine WHICH git commit / frozen
    // protocol is authoritative. Validate it against the independently verified git freeze before trusting
    // its timestamp/window.
    const fv = validateRunFreezeEvidence(freezeEvidence, { manifest, verifiedFreeze });
    freezeEvidenceErrors.push(...fv.errors);
    if (fv.ok) { const startMs = Date.parse(freezeEvidence.verifiedBeforeFirstCallAt); if (Number.isFinite(startMs)) collectionWindow = { startMs, maxMs: REQUEST_POLICY.maxCollectionHours * 3600 * 1000 }; }
  } else if (freezeEvidencePath) {
    freezeEvidenceErrors.push('run freeze evidence file is missing');
  }
  const verified = new Map();
  const tampered = [], nonTerminal = [], fatalCalls = [], usageMissingCalls = [], protocolViolationCalls = [];
  const rows = [];
  const startsAt = [], endsAt = [];
  for (const c of calls.calls) {
    const v = verifyCollectedCall(runDir, c, { model, validator: validators[c.task], pricing, expectedRequestEvidence: expectedEvidence.get(c.callId), collectionWindow });
    verified.set(c.callId, v);
    if (v.tampered.length) tampered.push({ callId: c.callId, why: v.tampered });
    if (!v.complete) nonTerminal.push(c.callId);
    if (v.fatal) fatalCalls.push(c.callId);
    if (v.usageMissing) usageMissingCalls.push(c.callId);
    if (v.protocolViolations.length) protocolViolationCalls.push(c.callId);
    for (const a of v.attempts) { if (a.startedAt) startsAt.push(a.startedAt); if (a.finishedAt) endsAt.push(a.finishedAt); }
    rows.push({
      callId: c.callId, callSha256: sha256(canonicalJson(c)), intents: v.intents,
      status: v.primary ? 'valid-response' : (v.terminalInvalid ? 'schema-invalid' : (v.terminalApiError ? 'terminal-api-error' : (v.modelDrift ? 'model-drift' : 'incomplete'))),
      fatal: v.fatal, protocolViolation: v.protocolViolations.length > 0,
      model: v.primary?.model ?? v.modelDrift?.model ?? null,
      requestId: v.primary?.requestId ?? null,
      responseSha256: v.primary?.responseSha256 ?? v.terminalInvalid?.responseSha256 ?? null,
      usage: v.primary?.usage ?? null, usageMissing: v.usageMissing, billedUsd: v.billedUsd,
      attempts: v.attempts.map(a => ({ attempt: a.attempt, outcome: a.outcome, intentSha256: a.intentSha256, requestEvidence: a.requestEvidence, conservativeUsd: a.conservativeUsd, startedAt: a.startedAt, finishedAt: a.finishedAt, requestId: a.requestId, responseSha256: a.responseSha256, usage: a.usage, usageMissing: a.usageMissing, billedUsd: a.billedUsd })),
    });
  }
  const evidence = {
    version: 'recognition-collection-evidence/2', freezeId: manifest.freeze.id,
    freezeCommit: freezeEvidence?.commit ?? null, freezeEvidenceSha256,
    collectionStartedAt: freezeEvidence?.verifiedBeforeFirstCallAt ?? null,
    collectionWindowHours: REQUEST_POLICY.maxCollectionHours,
    callManifestSha256: sha256(canonicalJson(calls)),
    earliestAttemptAt: startsAt.length ? startsAt.slice().sort()[0] : null,
    latestAttemptAt: endsAt.length ? endsAt.slice().sort().at(-1) : null,
    calls: rows.sort((a, b) => a.callId.localeCompare(b.callId)),
  };
  return { evidence, evidenceSha256: sha256(canonicalJson(evidence)), verified, tampered, nonTerminal, fatalCalls, usageMissingCalls, protocolViolationCalls, collectionWindow, freezeEvidenceSha256, freezeEvidenceErrors };
}

// Load the frozen prompt/schema asset bytes ONE way, so the runner, sealer, and analyzer feed the shared
// evidence derivation identical inputs (no per-consumer asset drift).
export function loadFrozenPromptAssets(registrationDir) {
  const read = f => readFileSync(join(registrationDir, 'prompts', f), 'utf8');
  return {
    promptAssets: { identify: read('identify.md'), facets: read('facets.md'), 'facets-cued': read('facets-cued.md'), 'identity-first': read('identity-first.md') },
    schemaAssets: {
      identification: JSON.parse(readFileSync(join(registrationDir, 'schemas/identification.schema.json'), 'utf8')),
      facets: JSON.parse(readFileSync(join(registrationDir, 'schemas/facets.schema.json'), 'utf8')),
    },
  };
}

// Validate the mutable run freeze-evidence file against the INDEPENDENTLY verified git freeze. The run
// file may record when collection began; it may not become the source of truth for the authoritative
// commit, frozen protocol id, or frozen path set.
export function validateRunFreezeEvidence(fe, { manifest, verifiedFreeze }) {
  const errors = [];
  if (!fe || typeof fe !== 'object') return { ok: false, errors: ['run freeze evidence missing/unparseable'] };
  if (fe.version !== 'recognition-protocol-freeze-evidence/1') errors.push('run freeze evidence version');
  if (fe.freezeId !== manifest?.freeze?.id) errors.push('run freeze evidence freezeId does not match the frozen manifest');
  if (verifiedFreeze) {
    if (fe.commit !== verifiedFreeze.commit) errors.push('run freeze evidence commit does not match the independently verified git freeze');
    if (verifiedFreeze.subject != null && fe.subject !== verifiedFreeze.subject) errors.push('run freeze evidence subject does not match the verified freeze');
    if (Array.isArray(verifiedFreeze.frozenPaths)) {
      const a = Array.isArray(fe.frozenPaths) ? [...fe.frozenPaths].sort() : null;
      const b = [...verifiedFreeze.frozenPaths].sort();
      if (!a || a.length !== b.length || a.some((p, i) => p !== b[i])) errors.push('run freeze evidence frozenPaths do not match the verified freeze');
    }
  } else errors.push('no independently verified git freeze supplied to validate the run freeze evidence against');
  if (!Number.isFinite(Date.parse(fe.verifiedBeforeFirstCallAt))) errors.push('run freeze evidence timestamp is invalid');
  return { ok: errors.length === 0, errors };
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

// A file cannot contain the hash of the commit that contains that file: doing so would change the
// commit hash. Instead, the registered manifest freezes a stable registration id. A dedicated git
// commit names that id in its subject; execution derives the commit, proves every frozen path is
// tracked and byte-identical to that commit, and records the derived hash in run evidence.
// Prove a set of tracked paths is byte-identical to exactly one commit whose subject is `subject`,
// in later commits, the index, AND the working tree. Unrelated dirty work is deliberately allowed.
export function verifyGitCommittedPaths(root, subject, paths, opts = {}) {
  if (!Array.isArray(paths) || paths.length === 0 || paths.some(p => typeof p !== 'string' || p.startsWith('/') || p.includes('..'))) return { ok: false, reason: 'bad-paths' };
  let commit;
  try {
    const lines = git(root, ['log', '--format=%H%x09%s']).split('\n').filter(Boolean);
    const matches = lines.filter(line => line.slice(41) === subject);
    if (matches.length !== 1) return { ok: false, reason: matches.length ? 'ambiguous-commit' : 'commit-not-found' };
    commit = matches[0].slice(0, 40);
    git(root, ['ls-files', '--error-unmatch', '--', ...paths]);
    git(root, ['diff', '--quiet', commit, '--', ...paths]);
    git(root, ['diff', '--cached', '--quiet', '--', ...paths]);
    git(root, ['diff', '--quiet', '--', ...paths]);
    // Chronology: the named commit must descend from a required ancestor (e.g. collection AFTER freeze).
    if (opts.mustDescendFrom) {
      if (!/^[0-9a-f]{40}$/.test(opts.mustDescendFrom)) return { ok: false, reason: 'bad-ancestor' };
      if (opts.mustDescendFrom === commit) return { ok: false, reason: 'not-a-descendant' };
      try { git(root, ['merge-base', '--is-ancestor', opts.mustDescendFrom, commit]); }
      catch { return { ok: false, reason: 'not-a-descendant' }; }
    }
    // "Dedicated" commit: its changed-path set must be EXACTLY the expected paths, nothing else.
    if (opts.exactChangedPathSet) {
      const changed = git(root, ['diff-tree', '--no-commit-id', '--name-only', '-r', commit]).split('\n').filter(Boolean).sort();
      const want = [...paths].sort();
      if (changed.length !== want.length || changed.some((p, i) => p !== want[i])) return { ok: false, reason: 'commit-not-dedicated', detail: `changed ${changed.join(', ')}` };
    }
  } catch (error) {
    return { ok: false, reason: 'git-mismatch', detail: String(error.stderr || error.message || error) };
  }
  return { ok: true, commit, subject };
}

export function verifyGitFreeze(root, freezeId, frozenPaths) {
  if (!/^[a-z0-9][a-z0-9-]{7,80}$/.test(freezeId || '')) return { ok: false, reason: 'bad-freeze-id' };
  const r = verifyGitCommittedPaths(root, `PILOT PROTOCOL FROZEN BEFORE COLLECTION: ${freezeId}`, frozenPaths);
  if (!r.ok) return { ok: false, reason: r.reason === 'bad-paths' ? 'bad-frozen-paths' : (r.reason === 'commit-not-found' ? 'freeze-commit-not-found' : (r.reason === 'ambiguous-commit' ? 'ambiguous-freeze-commit' : 'git-freeze-mismatch')), detail: r.detail };
  return { ok: true, commit: r.commit, subject: r.subject, frozenPaths: [...frozenPaths] };
}

// The external anchor for collected responses: a DEDICATED commit that freezes the collection-evidence
// manifest AFTER (descended from) the protocol-freeze commit and BEFORE adjudication/analysis. Raw
// responses may stay gitignored; the committed manifest is what a later analysis re-derives and matches.
// Chronology is proven, not assumed: the seal commit must descend from `freezeCommit` and change exactly
// the one evidence path.
export function verifyGitCollectionSeal(root, freezeId, evidencePath, freezeCommit = null) {
  if (!/^[a-z0-9][a-z0-9-]{7,80}$/.test(freezeId || '')) return { ok: false, reason: 'bad-freeze-id' };
  return verifyGitCommittedPaths(root, `PILOT COLLECTION SEALED: ${freezeId}`, [evidencePath], { mustDescendFrom: freezeCommit || undefined, exactChangedPathSet: true });
}

export function beginAttempt(runDir, call, conservativeUsd, maxAttempts = 3, requestEvidence = {}) {
  const state = callState(runDir, call.callId);
  if (state.complete) return { ok: false, reason: 'call-complete', state };
  if (state.intents >= maxAttempts) return { ok: false, reason: 'attempt-limit', state };
  const attempt = state.intents + 1;
  const intent = {
    version: 'recognition-attempt/1', callId: call.callId, attempt,
    callSha256: sha256(canonicalJson(call)), conservativeUsd,
    requestEvidence,
    startedAt: new Date().toISOString(), status: 'started-before-network',
  };
  atomicJson(join(state.dir, `attempt-${attempt}.intent.json`), intent);
  return { ok: true, attempt, intent, dir: state.dir };
}

export function finishAttempt(runDir, callId, attempt, result) {
  const dir = callDir(runDir, callId);
  const path = join(dir, `attempt-${attempt}.result.json`);
  return atomicJson(path, { version: 'recognition-attempt-result/1', callId, attempt, finishedAt: new Date().toISOString(), ...result });
}

export function safeRegisteredViewPath(runDir, sha) {
  if (!HEX64.test(sha || '')) return null;
  try {
    const realRun = realpathSync(runDir);
    const views = resolve(realRun, 'views');
    if (realpathSync(views) !== realRun + sep + 'views' || lstatSync(views).isSymbolicLink()) return null;
    const path = resolve(views, `${sha}.jpg`);
    if (path !== views + sep + `${sha}.jpg`) return null;
    if (lstatSync(path).isSymbolicLink() || realpathSync(path) !== views + sep + `${sha}.jpg`) return null;
    return path;
  } catch { return null; }
}

export function deterministicJsonParse(text) {
  let s = String(text || '').trim();
  const fenced = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) s = fenced[1].trim();
  try { return { ok: true, value: JSON.parse(s), recoveredFenceOnly: !!fenced }; }
  catch { return { ok: false, reason: 'not-exact-json' }; }
}

export function billedUsd(usage, pricing) {
  if (!usage || !Number.isFinite(usage.input_tokens) || !Number.isFinite(usage.output_tokens)) return null;
  const input = Number(usage.input_tokens), output = Number(usage.output_tokens);
  if (!Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) return null;
  return +(((input * pricing.inputPerMillionUsd + output * pricing.outputPerMillionUsd) / 1_000_000) * pricing.batchMultiplier).toFixed(8);
}

export function spentAndUnknown(runDir, costRows) {
  let billed = 0, unknownReserved = 0;
  const byCall = new Map(costRows.map(r => [r.callId, r]));
  const attemptsRoot = resolve(runDir, 'attempts');
  if (!existsSync(attemptsRoot)) return { billed, unknownReserved, committed: 0 };
  for (const callId of readdirSync(attemptsRoot)) {
    if (!byCall.has(callId)) continue;
    const state = callState(runDir, callId);
    const resultAttempts = new Set(state.results.map(r => r.attempt));
    // Recompute each cost from VERIFIED usage bytes, never the trusted billedUsd field. A result whose
    // bytes fail verification is treated as an unknown conservative reserve (fail-safe for the budget).
    for (const r of state.results) {
      let usage = null;
      if (typeof r.rawResponse === 'string' && sha256(r.rawResponse) === r.responseSha256) { try { usage = JSON.parse(r.rawResponse).usage || null; } catch { usage = null; } }
      const recomputed = billedUsd(usage, REQUEST_POLICY.pricing);
      if (recomputed != null) billed += recomputed;
      else unknownReserved += byCall.get(callId).conservativeUsd;
    }
    for (let n = 1; n <= state.intents; n++) if (!resultAttempts.has(n)) unknownReserved += byCall.get(callId).conservativeUsd;
  }
  return { billed: +billed.toFixed(8), unknownReserved: +unknownReserved.toFixed(8), committed: +(billed + unknownReserved).toFixed(8) };
}
