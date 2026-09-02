// AFTER-COLLECTION preservation anchor for the corrected Study-B run. This did NOT exist before
// collection; it independently rederives and binds every planned call to its verified raw bytes so the
// gitignored run can be checked for tampering later. Offline, read-only over the run; writes only the
// evidence manifest under docs/research/recognition-studyb/. No network, no mutation of raw responses.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalJson, sha256 } from './lib/recognition-pilot.mjs';
import { STUDYB_REQUEST_POLICY, buildStudyBPrompt } from './lib/recognition-studyb.mjs';

const FROZEN = 'docs/research/recognition-pilot';
const OUT = 'docs/research/recognition-studyb';
const draft = JSON.parse(readFileSync(join(OUT, 'studyb-manifest.draft.json'), 'utf8'));
const callManifest = JSON.parse(readFileSync(join(OUT, 'studyb-call-manifest.draft.json'), 'utf8'));
const renderedSchema = JSON.parse(readFileSync(join(OUT, 'prompt-schema.facets.draft.json'), 'utf8'));
const promptAssets = { facets: readFileSync(join(FROZEN, 'prompts/facets.md'), 'utf8'), facetsCued: readFileSync(join(FROZEN, 'prompts/facets-cued.md'), 'utf8') };
const worksById = new Map(draft.works.map(w => [w.id, w]));
const runDir = join('data/incoming/recognition-studyb', draft.protocolId, 'attempts');
if (callManifest.sha256 !== sha256(canonicalJson({ ...callManifest, sha256: undefined }))) throw new Error('call manifest hash drift');

const price = STUDYB_REQUEST_POLICY.pricing;
const billed = u => (u ? ((u.input_tokens || 0) * price.inputPerMillionUsd + (u.output_tokens || 0) * price.outputPerMillionUsd) / 1e6 : 0);
const errors = [];
const rows = [];
const seen = new Set();

for (const call of callManifest.calls) {
  const p = join(runDir, call.callId, 'attempt-1.result.json');
  if (!existsSync(p)) { errors.push(`missing result: ${call.callId}`); continue; }
  const r = JSON.parse(readFileSync(p, 'utf8'));
  if (seen.has(call.callId)) { errors.push(`duplicate: ${call.callId}`); continue; }
  seen.add(call.callId);
  if (r.callId !== call.callId) errors.push(`callId mismatch: ${call.callId}`);
  if (r.workId !== call.workId) errors.push(`workId mismatch: ${call.callId}`);
  if (r.condition !== call.condition) errors.push(`condition mismatch: ${call.callId}`);
  const w = worksById.get(call.workId);
  if (!w) { errors.push(`unknown work: ${call.callId}`); continue; }
  if (r.imageSha256 !== w.image.fullViewSha256) errors.push(`image SHA mismatch: ${call.callId}`);
  // Rederive the prompt SHA from the frozen prompt + rendered schema (tamper check).
  const promptSha = sha256(buildStudyBPrompt(w, call.condition, promptAssets, renderedSchema));
  if (r.promptSha256 !== promptSha) errors.push(`prompt SHA mismatch: ${call.callId}`);
  // Recompute the raw-response SHA from stored bytes.
  if (r.rawResponse != null && sha256(r.rawResponse) !== r.responseSha256) errors.push(`rawResponse SHA mismatch (tampered bytes): ${call.callId}`);
  // Returned model: valid/invalid content outcomes must carry the requested model; transport/api errors may be null.
  const contentful = !['transport-exhausted', 'api-error', 'malformed-envelope'].includes(r.outcome);
  if (contentful && r.returnedModel !== STUDYB_REQUEST_POLICY.model) errors.push(`returned-model drift: ${call.callId} -> ${r.returnedModel}`);
  const recomputedUsd = billed(r.usage);
  if (typeof r.billedUsd === 'number' && Math.abs(recomputedUsd - r.billedUsd) > 1e-9) errors.push(`cost mismatch: ${call.callId}`);
  rows.push({
    callId: call.callId, workId: call.workId, condition: call.condition, order: call.order, replicate: call.replicate,
    imageSha256: r.imageSha256, promptSha256: r.promptSha256, requestedModel: STUDYB_REQUEST_POLICY.model, returnedModel: r.returnedModel || null,
    responseSha256: r.responseSha256 || null, stopReason: r.stopReason || null, outcome: r.outcome, usageBilledUsd: +recomputedUsd.toFixed(8), transportAttempts: r.transportAttempts ?? 1,
  });
}
// Reject extras: result files with no manifest row.
if (existsSync(runDir)) for (const cid of readdirSync(runDir)) if (!callManifest.calls.some(c => c.callId === cid)) errors.push(`extra result not in manifest: ${cid}`);

if (errors.length) { console.error('COLLECTION-EVIDENCE ANCHOR BLOCKED:'); for (const e of errors) console.error('  ' + e); process.exit(2); }

rows.sort((a, b) => a.order - b.order);
const totalUsd = rows.reduce((n, r) => n + r.usageBilledUsd, 0);
const evidence = {
  version: 'recognition-studyb-collection-evidence/1',
  provenance: 'AFTER-COLLECTION preservation anchor — generated post-hoc; did NOT exist before or during collection.',
  protocolId: draft.protocolId,
  callManifestSha256: callManifest.sha256,
  researchSchemaSha256: draft.reuseBindings.researchSchemaSha256,
  promptSchemaSha256: draft.reuseBindings.promptSchemaSha256,
  disclosedButUnverifiable: 'A discarded first attempt (~13 calls, ~$0.17) is not preserved locally and is NOT anchored here; only this 119-call collection is verifiable.',
  totals: { calls: rows.length, billedUsd: +totalUsd.toFixed(6) },
  calls: rows,
};
evidence.sha256 = sha256(canonicalJson({ ...evidence, sha256: undefined }));
writeFileSync(join(OUT, 'collection-evidence.json'), JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
console.log(`collection evidence anchored: ${rows.length} calls, verified cost $${totalUsd.toFixed(6)}`);
console.log(`evidence sha256: ${evidence.sha256}`);
