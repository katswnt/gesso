// Frozen pilot diagnostic analysis (thin wrapper). Reads only frozen, append-only response
// artifacts and writes only under data/incoming. The excluded pilot estimates nuisance quantities;
// its observed treatment effect is explicitly NOT an input to main-study sample size. All response-
// derived analysis lives in the pure analyzePilot() so it is unit-testable without the freeze.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  REQUEST_POLICY, PILOT_MODEL, analyzePilot, styleDedupFromSnapshot, canonicalJson, sha256, validateAdjudicationArtifact,
  buildAdjudicationArtifacts, deriveExpectedEvidence, validateIdentification, validateFacets, validateIdentityFirst,
} from './lib/recognition-pilot.mjs';
import { buildCollectionEvidence, verifyGitFreeze, verifyGitCollectionSeal, loadFrozenPromptAssets, billedUsd } from './lib/recognition-pilot-runtime.mjs';

const regDir = 'docs/research/recognition-pilot';
const manifest = JSON.parse(readFileSync(join(regDir, 'pilot-manifest.frozen.json'), 'utf8'));
const calls = JSON.parse(readFileSync(join(regDir, 'call-manifest.frozen.json'), 'utf8'));
const styles = JSON.parse(readFileSync(join(regDir, 'style-taxonomy.frozen.json'), 'utf8'));
if (manifest.status !== 'PILOT_PROTOCOL_FROZEN_BEFORE_COLLECTION') throw new Error('frozen pilot required');
if (manifest.sha256 !== sha256(canonicalJson({ ...manifest, sha256: undefined }))) throw new Error('frozen manifest hash mismatch');
for (const [path, expected] of Object.entries(manifest.freeze?.artifactHashes || {})) if (!existsSync(path) || sha256(readFileSync(path)) !== expected) throw new Error(`frozen artifact hash mismatch: ${path}`);
const freeze = verifyGitFreeze(process.cwd(), manifest.freeze?.id, manifest.freeze?.frozenPaths);
if (!freeze.ok) throw new Error(`git freeze is not intact: ${freeze.reason}`);
const runDir = join('data/incoming/recognition-pilot', manifest.freeze.id);

// The one style dedup map the grader consumes, taken from the frozen taxonomy.
const styleDedup = styleDedupFromSnapshot(styles);

// --- ONE shared attempt state machine + collection-evidence builder (sealer AND analyzer use it). ---
const validators = { identify: validateIdentification, facets: validateFacets, 'identity-first': validateIdentityFirst };
const freezeEvidencePath = join(runDir, 'protocol-freeze-evidence.json');
// Shared, fail-closed expected request-evidence (registrationCommit from the verified git freeze), so the
// analyzer verifies the SAME request binding the runner sent and the sealer anchored.
const { promptAssets, schemaAssets } = loadFrozenPromptAssets(regDir);
const { expected } = deriveExpectedEvidence({ manifest, calls, promptAssets, schemaAssets, registrationCommit: freeze.commit });
const built = buildCollectionEvidence({ runDir, manifest, calls, model: PILOT_MODEL, validators, freezeEvidencePath, expectedEvidence: expected, verifiedFreeze: freeze });
const verified = built.verified;
const resultForCallId = callId => verified.get(callId)?.primary?.parsed || null;

// Pass 1 (no resolver): discover the exact queued cells (with controller context) so rulings can be
// checked against them and the blinded packet built.
const pass1 = analyzePilot({ manifest, calls, resultForCallId, styleDedup });
const requiredCells = pass1.adjudication.requiredCells;
const queued = new Set(requiredCells.map(c => c.cellId));

// Blinded reviewer packet + private controller (opaque ids; no condition leaks into the packet).
const works = new Map(manifest.works.map(w => [w.id, w]));
const responseFor = callId => { const p = verified.get(callId)?.primary; return p ? { parsed: p.parsed, responseSha256: p.responseSha256 } : null; };
const arts = buildAdjudicationArtifacts(requiredCells, { works, responseFor, freezeId: manifest.freeze.id });
const collectionEvidenceSha = built.evidenceSha256;

// --- Blinded adjudication resolutions (optional): bound to the exact packet, the exact collection
//     state, AND each cell's verified response SHA. Any drift refuses. ---
const adjPath = join(runDir, 'adjudications.json');
let adjArtifactSha = null;
const resolutions = new Map();
if (existsSync(adjPath)) {
  const raw = readFileSync(adjPath, 'utf8');
  adjArtifactSha = sha256(raw);
  const artifact = JSON.parse(raw);
  const v = validateAdjudicationArtifact(artifact);
  if (!v.ok) throw new Error(`invalid adjudications.json: ${v.errors.join('; ')}`);
  if (artifact.freezeId !== manifest.freeze.id) throw new Error('adjudications.json freezeId does not match the frozen pilot');
  if (artifact.packetSha256 !== arts.packetSha256) throw new Error('adjudications.json packetSha256 does not match the current blinded packet');
  if (artifact.collectionEvidenceSha256 !== collectionEvidenceSha) throw new Error('adjudications.json collectionEvidenceSha256 does not match the current collection evidence');
  for (const r of artifact.resolutions) { if (!queued.has(r.cellId)) throw new Error(`adjudications.json rules on a non-queued cell: ${r.cellId}`); resolutions.set(r.cellId, r); }
}
// A ruling resolves only when it matches the VERIFIED response SHA (recomputed from raw bytes).
const resolveAdjudication = cell => {
  const r = resolutions.get(cell.cellId);
  if (!r) return null;
  const responseSha = verified.get(cell.callId)?.primary?.responseSha256 || null;
  if (!responseSha || responseSha !== r.responseSha256) return null;
  return cell.kind === 'identification' ? r.resolvedExact : r.resolvedCredit;
};
// Pass 2: final grading with bound resolutions.
const diagnostics = analyzePilot({ manifest, calls, resultForCallId, styleDedup, resolveAdjudication });

// --- Completion + integrity gates for a FINAL analysis. ---
const terminalCalls = calls.calls.filter(c => verified.get(c.callId).complete).length;
const tamperedCells = built.tampered.map(t => t.callId);
const fatalCells = built.fatalCalls;              // model drift → whole run invalid
const usageMissingCells = built.usageMissingCalls; // valid answer, no usage → cost unmeasurable, block
const allTerminal = terminalCalls === calls.calls.length;
const pendingAdj = diagnostics.adjudication.requiredCount > 0;

// Collection-evidence external anchor: recomputed here and required committed + byte-identical, in a
// dedicated commit that DESCENDS from the protocol-freeze commit, before any FINAL analysis.
const sealPath = join(regDir, `collection-evidence.${collectionEvidenceSha.slice(0, 16)}.json`);
const sealMatches = existsSync(sealPath) && sha256(canonicalJson(JSON.parse(readFileSync(sealPath, 'utf8')))) === collectionEvidenceSha;
const freeze2 = verifyGitFreeze(process.cwd(), manifest.freeze.id, manifest.freeze.frozenPaths);
const sealCommitted = sealMatches && freeze2.ok && verifyGitCollectionSeal(process.cwd(), manifest.freeze.id, sealPath, freeze2.commit).ok;
const freezeEvidenceErrors = built.freezeEvidenceErrors;   // run file must match the verified git freeze
const isFinal = allTerminal && !pendingAdj && tamperedCells.length === 0 && fatalCells.length === 0 && usageMissingCells.length === 0 && freezeEvidenceErrors.length === 0 && sealCommitted;

// Runtime nuisance from verified attempt artifacts (nuisance-only; never a treatment-effect input).
let attempts = 0, retries = 0, inputTokens = 0, outputTokens = 0, billed = 0;
for (const c of calls.calls) { const v = verified.get(c.callId);
  attempts += v.intents; if (v.intents > 1) retries += v.intents - 1;
  for (const r of v.attempts) { const u = r.usage; if (u) { inputTokens += Number(u.input_tokens || 0); outputTokens += Number(u.output_tokens || 0); } }
  billed += v.billedUsd;
}
diagnostics.runtimeNuisance = { plannedCalls: calls.calls.length, terminalCalls, transportRetries: retries, totalAttempts: attempts, measuredInputTokens: inputTokens, measuredOutputTokens: outputTokens, measuredCostUsd: billedUsd({ input_tokens: inputTokens, output_tokens: outputTokens }, REQUEST_POLICY.pricing), billedUsdFromResults: +billed.toFixed(8), costFullyMeasured: usageMissingCells.length === 0 };
diagnostics.freezeId = manifest.freeze.id;
diagnostics.final = isFinal;
diagnostics.tamperedCells = tamperedCells;
diagnostics.fatalCells = fatalCells;
diagnostics.usageMissingCells = usageMissingCells;
diagnostics.freezeEvidenceErrors = freezeEvidenceErrors;
diagnostics.collectionEvidenceSha = collectionEvidenceSha;
diagnostics.blindedPacketSha = arts.packetSha256;
diagnostics.collectionSealCommitted = sealCommitted;
diagnostics.adjudicationArtifactSha = adjArtifactSha;

mkdirSync(runDir, { recursive: true });
// Blinded review packet + separately written private controller. The packet is keyed by an OPAQUE
// adjudication id, carries the exact response and the minimum frozen ground truth to grade it, and hides
// all experimental condition (work/call/view/source/image/cue/fame/region/arm). The controller — a
// different file — is the only mapping back to the call/response.
if (requiredCells.length) {
  writeFileSync(join(runDir, `blinded-review-packet.${arts.packetSha256.slice(0, 16)}.json`), JSON.stringify(arts.packet, null, 2) + '\n', { mode: 0o600 });
  writeFileSync(join(runDir, `adjudication-controller.${arts.controllerSha256.slice(0, 16)}.json`), JSON.stringify(arts.controller, null, 2) + '\n', { mode: 0o600 });
}

if (!isFinal) {
  const reasons = [!allTerminal && `${calls.calls.length - terminalCalls} non-terminal call(s)`, pendingAdj && `${diagnostics.adjudication.requiredCount} unresolved adjudication(s)`, tamperedCells.length && `${tamperedCells.length} tampered cell(s)`, fatalCells.length && `${fatalCells.length} model-drift/fatal call(s)`, usageMissingCells.length && `${usageMissingCells.length} valid call(s) with no measurable usage`, freezeEvidenceErrors.length && `run freeze evidence mismatch (${freezeEvidenceErrors.length})`, !sealCommitted && 'collection evidence not sealed in a dedicated commit'].filter(Boolean).join('; ');
  if (!process.argv.includes('--interim')) {
    console.error(`REFUSED: not a FINAL analysis (${reasons}). Complete the run, seal collection evidence (recognition-pilot-seal-collection.mjs) and commit it, resolve adjudications, or pass --interim for a uniquely named interim report.`);
    process.exit(2);
  }
  diagnostics.sha256 = sha256(canonicalJson({ ...diagnostics, sha256: undefined }));
  const p = join(runDir, `diagnostics-interim.${diagnostics.sha256.slice(0, 16)}.json`);
  writeFileSync(p, JSON.stringify(diagnostics, null, 2) + '\n', { mode: 0o600 });
  console.error(`INTERIM ONLY (final:false) — ${reasons}. Wrote ${p}`);
  process.exit(0);
}

diagnostics.sha256 = sha256(canonicalJson({ ...diagnostics, sha256: undefined }));
writeFileSync(join(runDir, 'diagnostics.json'), JSON.stringify(diagnostics, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify(diagnostics, null, 2));
