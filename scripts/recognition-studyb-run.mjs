// Corrected Study-B mini-pilot runner. Prompt-level JSON (no tools, no output_config). Sequential,
// one call at a time, resumable, append-only. Per-call intent before send; raw response checkpointed
// immediately with SHA/model/usage/condition/prompt-hash/image-hash/attempt. Transport-only retry
// (429/5xx/network); never retries a substantive invalid response. Verifies returned model. Tracks
// measured + reserved cost and HARD STOPS before any call that could exceed the $10 authorization.
// Sequential smoke gate after the first 6 calls. Reads full-view image bytes READ-ONLY from the frozen
// store; never mutates the original pilot.
//
// Requires --live AND RECOGNITION_STUDYB_LIVE=1 AND ANTHROPIC_API_KEY AND not CI.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalJson, sha256, validateFacets } from './lib/recognition-pilot.mjs';
import { deterministicJsonParse } from './lib/recognition-pilot-runtime.mjs';
import { STUDYB_REQUEST_POLICY, buildStudyBPrompt, buildStudyBRequestBody } from './lib/recognition-studyb.mjs';

const LIVE = process.argv.includes('--live');
const OUT = 'docs/research/recognition-studyb';
const FROZEN = 'docs/research/recognition-pilot';
const FROZEN_VIEWS = 'data/incoming/recognition-pilot/gesso-recognition-pilot-2026-08-31-v1/views';
const BUDGET_USD = 10;

const draft = JSON.parse(readFileSync(join(OUT, 'studyb-manifest.draft.json'), 'utf8'));
const callManifest = JSON.parse(readFileSync(join(OUT, 'studyb-call-manifest.draft.json'), 'utf8'));
const renderedSchema = JSON.parse(readFileSync(join(OUT, 'prompt-schema.facets.draft.json'), 'utf8'));
if (draft.reuseBindings.promptSchemaSha256 !== sha256(canonicalJson(renderedSchema))) throw new Error('prompt schema hash drift');
if (callManifest.sha256 !== sha256(canonicalJson({ ...callManifest, sha256: undefined }))) throw new Error('call manifest hash drift');
const promptAssets = { facets: readFileSync(join(FROZEN, 'prompts/facets.md'), 'utf8'), facetsCued: readFileSync(join(FROZEN, 'prompts/facets-cued.md'), 'utf8') };
if (sha256(promptAssets.facets) !== draft.reuseBindings.promptFacetsSha256) throw new Error('facets prompt drift');
if (sha256(promptAssets.facetsCued) !== draft.reuseBindings.promptFacetsCuedSha256) throw new Error('facets-cued prompt drift');
const worksById = new Map(draft.works.map(w => [w.id, w]));
const runDir = join('data/incoming/recognition-studyb', draft.protocolId);
const perCallCeiling = draft.conservativePerCallUsd;

if (!LIVE) { console.log(`DRY: ${callManifest.calls.length} Study-B calls prepared (prompt-level, cap ${STUDYB_REQUEST_POLICY.facetsMaxTokens}). Pass --live + RECOGNITION_STUDYB_LIVE=1 to execute.`); process.exit(0); }
if (process.env.RECOGNITION_STUDYB_LIVE !== '1' || !process.env.ANTHROPIC_API_KEY || process.env.CI) { console.error('REFUSED: live run requires RECOGNITION_STUDYB_LIVE=1, ANTHROPIC_API_KEY, and not CI.'); process.exit(2); }
const key = process.env.ANTHROPIC_API_KEY;

mkdirSync(join(runDir, 'attempts'), { recursive: true, mode: 0o700 });
// New corrected-run manifest, hashed, written before the first call.
const runManifestPath = join(runDir, 'run-manifest.json');
if (!existsSync(runManifestPath)) {
  const rm = { version: 'recognition-studyb-run/1', protocolId: draft.protocolId, startedAt: new Date().toISOString(), model: STUDYB_REQUEST_POLICY.model, method: STUDYB_REQUEST_POLICY.method, facetsMaxTokens: STUDYB_REQUEST_POLICY.facetsMaxTokens, budgetUsd: BUDGET_USD, callManifestSha256: callManifest.sha256, researchSchemaSha256: draft.reuseBindings.researchSchemaSha256, promptSchemaSha256: draft.reuseBindings.promptSchemaSha256 };
  rm.sha256 = sha256(canonicalJson(rm));
  writeFileSync(runManifestPath, JSON.stringify(rm, null, 2) + '\n', { mode: 0o600 });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const price = STUDYB_REQUEST_POLICY.pricing;
const billed = u => (u ? ((u.input_tokens || 0) * price.inputPerMillionUsd + (u.output_tokens || 0) * price.outputPerMillionUsd) / 1e6 : 0);
const resultPath = cid => join(runDir, 'attempts', cid, 'attempt-1.result.json');

function measuredSoFar() {
  let sum = 0;
  for (const c of callManifest.calls) { const p = resultPath(c.callId); if (existsSync(p)) sum += JSON.parse(readFileSync(p, 'utf8')).billedUsd || 0; }
  return sum;
}
function classify(envelope, text) {
  if (envelope?.stop_reason === 'refusal') return { outcome: 'refusal', stopReason: 'refusal', validationErrors: ['refusal'], titleTypeEcho: false };
  if (envelope?.stop_reason === 'max_tokens') return { outcome: 'max-tokens', stopReason: 'max_tokens', validationErrors: ['max-tokens-truncation'], titleTypeEcho: false };
  // Fence-tolerant, non-lossy JSON extraction (the original prompt-level method's parser). It strips a
  // ```json code fence but still REJECTS truncated/malformed content, so strictness is preserved.
  const p = deterministicJsonParse(text);
  if (!p.ok) return { outcome: 'schema-invalid', stopReason: envelope?.stop_reason || null, validationErrors: ['not-json'], titleTypeEcho: false };
  const parsed = p.value;
  const titleTypeEcho = !!parsed && typeof parsed === 'object' && ('title' in parsed || 'type' in parsed);
  const v = validateFacets(parsed);
  if (!v.ok) return { outcome: 'local-constraint', stopReason: envelope?.stop_reason || null, validationErrors: v.errors, titleTypeEcho };
  return { outcome: 'valid', stopReason: envelope?.stop_reason || null, validationErrors: [], titleTypeEcho: false, parsed };
}

async function transportCall(body) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': STUDYB_REQUEST_POLICY.anthropicVersion, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(STUDYB_REQUEST_POLICY.requestTimeoutMs) });
      const text = await response.text();
      if (response.status === 429 || response.status >= 500) { lastErr = `http ${response.status}`; await sleep(1000 * 2 ** attempt); continue; }
      return { text, status: response.status, requestId: response.headers.get('request-id'), attempt };
    } catch (e) { lastErr = e.message; await sleep(1000 * 2 ** attempt); }
  }
  return { transportExhausted: true, error: lastErr };
}

let completed = 0, smokeChecked = false;
const ordered = [...callManifest.calls].sort((a, b) => a.order - b.order);
for (const call of ordered) {
  const dir = join(runDir, 'attempts', call.callId);
  if (existsSync(resultPath(call.callId))) { completed++; continue; } // resume, no duplication
  // Cost hard-stop BEFORE the call.
  const measured = measuredSoFar();
  const remaining = ordered.filter(c => !existsSync(resultPath(c.callId))).length;
  const reserved = remaining * perCallCeiling;
  if (measured + reserved > BUDGET_USD) { console.error(`HARD STOP: measured $${measured.toFixed(4)} + reserved $${reserved.toFixed(4)} would exceed $${BUDGET_USD}. Stopping before ${call.callId}.`); break; }

  const w = worksById.get(call.workId);
  const promptText = buildStudyBPrompt(w, call.condition, promptAssets, renderedSchema);
  const promptSha = sha256(promptText);
  const imgPath = join(FROZEN_VIEWS, `${w.image.fullViewSha256}.jpg`);
  const bytes = readFileSync(imgPath);
  if (sha256(bytes) !== w.image.fullViewSha256) throw new Error(`full-view hash drift: ${call.callId}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // Intent BEFORE send.
  writeFileSync(join(dir, 'attempt-1.intent.json'), JSON.stringify({ callId: call.callId, workId: call.workId, condition: call.condition, order: call.order, attempt: 1, model: STUDYB_REQUEST_POLICY.model, imageSha256: w.image.fullViewSha256, promptSha256: promptSha, startedAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });

  const body = buildStudyBRequestBody({ model: STUDYB_REQUEST_POLICY.model, maxTokens: STUDYB_REQUEST_POLICY.facetsMaxTokens, temperature: STUDYB_REQUEST_POLICY.temperature, promptText, imageBase64: bytes.toString('base64') });
  const tc = await transportCall(body);
  let record;
  if (tc.transportExhausted) {
    record = { outcome: 'transport-exhausted', stopReason: null, validationErrors: ['transport-exhausted'], titleTypeEcho: false, returnedModel: null, usage: null, rawResponse: null, responseSha256: null, transportError: tc.error, requestId: null, transportAttempts: 4 };
  } else if (tc.status !== 200) {
    record = { outcome: 'api-error', stopReason: null, validationErrors: [`http-${tc.status}`], titleTypeEcho: false, returnedModel: null, usage: null, rawResponse: tc.text, responseSha256: sha256(tc.text), requestId: tc.requestId, transportAttempts: tc.attempt };
  } else {
    let envelope = null, content = ''; try { envelope = JSON.parse(tc.text); content = Array.isArray(envelope?.content) ? envelope.content.map(c => (c.type === 'text' ? c.text : '')).join('') : ''; } catch { /* malformed */ }
    if (envelope == null) record = { outcome: 'malformed-envelope', stopReason: null, validationErrors: ['malformed-envelope'], titleTypeEcho: false, returnedModel: null, usage: null, rawResponse: tc.text, responseSha256: sha256(tc.text), requestId: tc.requestId, transportAttempts: tc.attempt };
    else {
      const cls = classify(envelope, content);
      const modelOk = envelope.model === STUDYB_REQUEST_POLICY.model;
      record = { outcome: modelOk ? cls.outcome : 'model-drift', stopReason: cls.stopReason, validationErrors: modelOk ? cls.validationErrors : ['model-drift'], titleTypeEcho: cls.titleTypeEcho, returnedModel: envelope.model || null, usage: envelope.usage || null, rawResponse: tc.text, responseSha256: sha256(tc.text), requestId: tc.requestId, transportAttempts: tc.attempt };
    }
  }
  const full = { version: 'recognition-studyb-result/2', protocolId: draft.protocolId, callId: call.callId, attempt: 1, finishedAt: new Date().toISOString(), condition: call.condition, workId: call.workId, imageSha256: w.image.fullViewSha256, promptSha256: promptSha, ...record, billedUsd: billed(record.usage), requestPolicyVersion: STUDYB_REQUEST_POLICY.version, researchSchemaSha256: draft.reuseBindings.researchSchemaSha256, promptSchemaSha256: draft.reuseBindings.promptSchemaSha256 };
  writeFileSync(resultPath(call.callId), JSON.stringify(full, null, 2) + '\n', { mode: 0o600 });
  completed++;
  console.log(`[${completed}] ${call.condition} ${call.callId} -> ${full.outcome}${full.titleTypeEcho ? ' (TITLE/TYPE ECHO!)' : ''} model=${full.returnedModel} $${full.billedUsd.toFixed(5)}`);

  // Sequential smoke gate after the first 6 completed calls.
  if (!smokeChecked && completed >= 6) {
    smokeChecked = true;
    const first6 = ordered.slice(0, 6).map(c => JSON.parse(readFileSync(resultPath(c.callId), 'utf8')));
    const drift = first6.filter(r => r.outcome === 'model-drift').length;
    const transport = first6.filter(r => r.outcome === 'transport-exhausted' || r.outcome === 'api-error').length;
    const echoes = first6.filter(r => r.titleTypeEcho).length;
    const valid = first6.filter(r => r.outcome === 'valid').length;
    const systemic = drift > 0 || transport > 0 || echoes > 0 || valid === 0;
    console.log(`SMOKE GATE (first 6): valid=${valid} drift=${drift} transport=${transport} titleTypeEcho=${echoes}`);
    if (systemic) { console.error('SMOKE GATE FAILED — systemic instrument problem. Stopping before further spend.'); break; }
    console.log('SMOKE GATE PASSED — no systemic instrument failure; continuing.');
  }
}
const finalMeasured = measuredSoFar();
console.log(`DONE. completed=${completed}/${ordered.length} measured=$${finalMeasured.toFixed(4)} budget=$${BUDGET_USD}`);
