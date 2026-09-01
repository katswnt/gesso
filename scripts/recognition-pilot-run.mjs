// Frozen-pilot runner. Fail-closed by default: a DRAFT cannot run, and live use requires both
// --live and RECOGNITION_PILOT_LIVE=1. No model call is possible from the preparation workflow.
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  PILOT_BUDGET_USD, PILOT_MODEL, REQUEST_POLICY, validateIdentification, validateFacets,
  validateIdentityFirst, remainingBudgetAllows, sha256, canonicalJson, deriveExpectedEvidence,
} from './lib/recognition-pilot.mjs';
import {
  verifyCollectedCall, beginAttempt, finishAttempt, safeRegisteredViewPath, deterministicJsonParse,
  billedUsd, spentAndUnknown, atomicJson, verifyGitFreeze, loadFrozenPromptAssets,
} from './lib/recognition-pilot-runtime.mjs';

const args = new Set(process.argv.slice(2));
const live = args.has('--live');
const registrationDir = 'docs/research/recognition-pilot';
const manifestPath = join(registrationDir, 'pilot-manifest.frozen.json');
const callsPath = join(registrationDir, 'call-manifest.frozen.json');
if (!existsSync(manifestPath) || !existsSync(callsPath)) {
  console.error('REFUSED: frozen manifests do not exist; the DRAFT cannot run'); process.exit(2);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const callManifest = JSON.parse(readFileSync(callsPath, 'utf8'));
if (manifest.status !== 'PILOT_PROTOCOL_FROZEN_BEFORE_COLLECTION' || manifest.freeze?.method !== 'dedicated-git-commit') {
  console.error('REFUSED: pilot is not frozen in a dedicated protocol-freeze commit'); process.exit(2);
}
if (manifest.sha256 !== sha256(canonicalJson({ ...manifest, sha256: undefined }))) { console.error('REFUSED: frozen manifest hash mismatch'); process.exit(2); }
for (const [path, expected] of Object.entries(manifest.freeze?.artifactHashes || {})) {
  if (!/^[0-9a-f]{64}$/.test(expected) || !existsSync(path) || sha256(readFileSync(path)) !== expected) {
    console.error(`REFUSED: frozen artifact hash mismatch (${path})`); process.exit(2);
  }
}
const frozenPaths = manifest.freeze?.frozenPaths;
const mandatoryFrozen = [manifestPath, callsPath, 'scripts/recognition-pilot-run.mjs', 'scripts/lib/recognition-pilot.mjs'];
if (!Array.isArray(frozenPaths) || mandatoryFrozen.some(path => !frozenPaths.includes(path))) { console.error('REFUSED: freeze omits a mandatory execution artifact'); process.exit(2); }
if (frozenPaths.some(path => path !== manifestPath && !Object.hasOwn(manifest.freeze.artifactHashes || {}, path))) { console.error('REFUSED: freeze omits an artifact hash'); process.exit(2); }
const gitFreeze = verifyGitFreeze(process.cwd(), manifest.freeze?.id, frozenPaths);
if (!gitFreeze.ok) { console.error(`REFUSED: git freeze is not intact (${gitFreeze.reason})`); process.exit(2); }
if (!live) { console.log(`DRY RUN ONLY: frozen ${callManifest.calls.length} calls; pass --live plus explicit env to execute`); process.exit(0); }
if (process.env.RECOGNITION_PILOT_LIVE !== '1') { console.error('REFUSED: set RECOGNITION_PILOT_LIVE=1'); process.exit(2); }
if (process.env.CI) { console.error('REFUSED: never run the paid pilot in CI'); process.exit(2); }
const key = process.env.ANTHROPIC_API_KEY;
if (!key) { console.error('REFUSED: ANTHROPIC_API_KEY missing'); process.exit(2); }

const runDir = join('data/incoming/recognition-pilot', manifest.freeze.id);
mkdirSync(join(runDir, 'attempts'), { recursive: true, mode: 0o700 });
const freezeEvidence = join(runDir, 'protocol-freeze-evidence.json');
if (!existsSync(freezeEvidence)) atomicJson(freezeEvidence, { version: 'recognition-protocol-freeze-evidence/1', freezeId: manifest.freeze.id, commit: gitFreeze.commit, subject: gitFreeze.subject, frozenPaths: gitFreeze.frozenPaths, verifiedBeforeFirstCallAt: new Date().toISOString() });
else {
  const prior = JSON.parse(readFileSync(freezeEvidence, 'utf8'));
  if (prior.commit !== gitFreeze.commit || prior.freezeId !== manifest.freeze.id) { console.error('REFUSED: run freeze evidence conflicts with current freeze'); process.exit(2); }
}
const runEvidence = JSON.parse(readFileSync(freezeEvidence, 'utf8'));
const collectionStarted = Date.parse(runEvidence.verifiedBeforeFirstCallAt);
if (!Number.isFinite(collectionStarted)) { console.error('REFUSED: invalid run freeze timestamp'); process.exit(2); }
if (Date.now() - collectionStarted > REQUEST_POLICY.maxCollectionHours * 60 * 60 * 1000) {
  console.error(`REFUSED: the frozen ${REQUEST_POLICY.maxCollectionHours}h pilot collection window expired`); process.exit(2);
}
const works = new Map(manifest.works.map(w => [w.id, w]));
if (manifest.callManifest?.sha256 !== sha256(canonicalJson(callManifest))) { console.error('REFUSED: call manifest hash mismatch'); process.exit(2); }
// ONE shared derivation: the expected request-evidence registry AND the very promptRegistry/images/cost
// the run sends. registrationCommit comes from the independently verified git freeze, never the run file.
const { promptAssets, schemaAssets } = loadFrozenPromptAssets(registrationDir);
const { expected, cost, promptRegistry, images } = deriveExpectedEvidence({ manifest, calls: callManifest, promptAssets, schemaAssets, registrationCommit: gitFreeze.commit });
if (!cost.ok || cost.authorizedUpperBoundUsd > PILOT_BUDGET_USD) { console.error('REFUSED: exact conservative preflight exceeds $15'); process.exit(2); }

const validators = { identify: validateIdentification, facets: validateFacets, 'identity-first': validateIdentityFirst };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const windowMs = REQUEST_POLICY.maxCollectionHours * 60 * 60 * 1000;
const collectionWindow = { startMs: collectionStarted, maxMs: windowMs };
for (const call of callManifest.calls.sort((a, b) => a.order - b.order)) {
  const w = works.get(call.workId), image = images[`${call.workId}:${call.source}:${call.view}`];
  if (!w || !image?.sha256) throw new Error(`frozen view missing: ${call.callId}`);
  const imagePath = safeRegisteredViewPath(runDir, image.sha256);
  if (!imagePath) throw new Error(`unsafe/missing view: ${call.callId}`);
  const bytes = readFileSync(imagePath);
  if (sha256(bytes) !== image.sha256) throw new Error(`view hash drift: ${call.callId}`);
  const prompt = promptRegistry[call.callId];
  // The intent records exactly the shared-derivation row (image/prompt/model/commit/policy); the cost is
  // stored separately by beginAttempt. No hand-built request-evidence object here.
  const { conservativeUsd, ...requestEvidence } = expected.get(call.callId);
  // Shared attempt state machine governs resume: complete → skip; model drift → abort the whole run;
  // any tamper/window/sequence/violation → abort; otherwise a retryable prior attempt may continue.
  const vc = verifyCollectedCall(runDir, call, { model: PILOT_MODEL, validator: validators[call.task], expectedRequestEvidence: expected.get(call.callId), collectionWindow });
  if (vc.fatal) { console.error(`ABORTED: model drift on ${call.callId}; the frozen run is invalidated`); process.exit(2); }
  if (vc.tampered.length) { console.error(`ABORTED: ${call.callId} failed byte/window/sequence verification: ${vc.tampered.join('; ')}`); process.exit(2); }
  if (vc.complete) continue;
  if (vc.intents > 0 && !vc.retryAllowed) { console.error(`ABORTED: ${call.callId} has no retryable prior attempt (no outcome-retry permitted)`); process.exit(2); }
  // Enforce the frozen 24h window before EVERY network attempt, not once per process.
  if (Date.now() - collectionStarted > windowMs) { console.error(`STOP: the frozen ${REQUEST_POLICY.maxCollectionHours}h pilot collection window expired`); break; }
  const spend = spentAndUnknown(runDir, cost.rows);
  if (!remainingBudgetAllows(cost, spend.committed, call.callId)) { console.error('STOP: remaining authorization cannot cover next conservative call'); break; }
  const begun = beginAttempt(runDir, call, conservativeUsd, REQUEST_POLICY.maxTransportAttemptsPerCall, requestEvidence);
  if (!begun.ok) { if (begun.reason === 'attempt-limit') console.error(`attempt limit: ${call.callId}`); continue; }
  let response, responseText = '';
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: AbortSignal.timeout(REQUEST_POLICY.requestTimeoutMs),
      headers: { 'x-api-key': key, 'anthropic-version': REQUEST_POLICY.anthropicVersion, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: REQUEST_POLICY.model,
        max_tokens: call.task === 'identify' ? REQUEST_POLICY.tokenCaps.identify : (call.task === 'identity-first' ? REQUEST_POLICY.tokenCaps.identityFirst : REQUEST_POLICY.tokenCaps.facets),
        temperature: REQUEST_POLICY.temperature,
        // SECURITY: intentionally no tools field. The model receives pixels + frozen study text only.
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: bytes.toString('base64') } },
          { type: 'text', text: prompt },
        ] }],
      }),
    });
    responseText = await response.text();
  } catch (e) {
    finishAttempt(runDir, call.callId, begun.attempt, { status: 'no-response-transport', error: String(e.message), billedUsd: conservativeUsd });
    await sleep(2000 * begun.attempt); continue;
  }
  if (!response.ok) {
    // SECURITY: never persist the raw error body (it may contain an auth-error payload); keep only the
    // sanitized status + request id. The verifier derives terminal/retryable from httpStatus.
    const retryable = response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500;
    finishAttempt(runDir, call.callId, begun.attempt, { status: retryable ? 'no-substantive-response' : 'terminal-api-error', httpStatus: response.status, requestId: response.headers.get('request-id'), reason: `provider returned HTTP ${response.status}`, billedUsd: 0 });
    if (retryable) { await sleep(Math.min(60_000, 3000 * 2 ** (begun.attempt - 1))); continue; }
    throw new Error(`non-retryable API status ${response.status}`);
  }
  // A successful HTTP envelope (any model, JSON or not) is stored as verifiable raw bytes so the state
  // machine derives model/usage/validity from them. A non-JSON 200 body is terminal schema-invalid.
  let envelope;
  try { envelope = JSON.parse(responseText); }
  catch {
    finishAttempt(runDir, call.callId, begun.attempt, { status: 'schema-invalid', requestId: response.headers.get('request-id'), rawResponse: responseText, responseSha256: sha256(responseText), billedUsd: conservativeUsd });
    continue;
  }
  if (envelope.model !== PILOT_MODEL) {
    // Model drift stops the whole run and is never retryable. Store the exact bytes so the verifier
    // re-derives the drift from them; the resume gate then aborts on the fatal outcome.
    const driftCost = billedUsd(envelope.usage, REQUEST_POLICY.pricing) ?? conservativeUsd;
    finishAttempt(runDir, call.callId, begun.attempt, { status: 'model-drift', returnedModel: envelope.model || null, requestId: response.headers.get('request-id'), rawResponse: responseText, responseSha256: sha256(responseText), billedUsd: driftCost });
    throw new Error(`model drift: ${envelope.model}`);
  }
  const rawText = (envelope.content || []).map(c => c.type === 'text' ? c.text : '').join('');
  const parsed = deterministicJsonParse(rawText);
  const validated = parsed.ok ? validators[call.task](parsed.value) : { ok: false, errors: [parsed.reason] };
  const actualUsd = billedUsd(envelope.usage, REQUEST_POLICY.pricing);
  finishAttempt(runDir, call.callId, begun.attempt, {
    status: validated.ok ? 'valid-response' : 'schema-invalid',
    requestId: response.headers.get('request-id'), returnedModel: envelope.model,
    usage: envelope.usage, billedUsd: actualUsd ?? conservativeUsd, costEstimated: actualUsd == null, responseSha256: sha256(responseText),
    rawResponse: responseText, parsed: parsed.ok ? parsed.value : null, validationErrors: validated.errors || [],
  });
  if (actualUsd == null) throw new Error('provider usage missing; stopped after conservatively reserving the call');
}

const incomplete = callManifest.calls.filter(call => !verifyCollectedCall(runDir, call, { model: PILOT_MODEL, validator: validators[call.task], expectedRequestEvidence: expected.get(call.callId), collectionWindow }).complete);
if (incomplete.length) {
  console.error(`PAUSED/INCOMPLETE: ${incomplete.length} frozen calls have no terminal result`);
  process.exitCode = 2;
} else console.log(`COMPLETE: ${callManifest.calls.length} frozen calls have append-only terminal results`);
