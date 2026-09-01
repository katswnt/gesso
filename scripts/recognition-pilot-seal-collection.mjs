// Post-collection sealer: after a run, VERIFY every call from raw evidence and write a small, tracked
// collection-evidence manifest (per-call verified SHAs, derived status/model/usage/cost). This file is
// the EXTERNAL anchor: freeze it in a dedicated git commit before any adjudication or final analysis,
// so a later edit of a raw response no longer matches the committed manifest. Offline; no model call.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  PILOT_FREEZE_ID, PILOT_MODEL, canonicalJson, sha256, deriveExpectedEvidence,
  validateIdentification, validateFacets, validateIdentityFirst,
} from './lib/recognition-pilot.mjs';
import { buildCollectionEvidence, verifyGitFreeze, loadFrozenPromptAssets } from './lib/recognition-pilot-runtime.mjs';

const DIR = 'docs/research/recognition-pilot';
const manifestPath = join(DIR, 'pilot-manifest.frozen.json');
const callsPath = join(DIR, 'call-manifest.frozen.json');
const fail = m => { console.error(`COLLECTION SEAL BLOCKED: ${m}`); process.exit(2); };
if (!existsSync(manifestPath) || !existsSync(callsPath)) fail('frozen manifests do not exist; freeze the protocol first');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const calls = JSON.parse(readFileSync(callsPath, 'utf8'));
if (manifest.status !== 'PILOT_PROTOCOL_FROZEN_BEFORE_COLLECTION') fail('pilot is not frozen');
const freeze = verifyGitFreeze(process.cwd(), manifest.freeze?.id, manifest.freeze?.frozenPaths);
if (!freeze.ok) fail(`git freeze is not intact (${freeze.reason})`);
const runDir = join('data/incoming/recognition-pilot', manifest.freeze.id);
const freezeEvidencePath = join(runDir, 'protocol-freeze-evidence.json');
if (!existsSync(freezeEvidencePath)) fail('run has no protocol-freeze-evidence.json; nothing was collected in the frozen window');
const validators = { identify: validateIdentification, facets: validateFacets, 'identity-first': validateIdentityFirst };

// Shared, fail-closed expected request-evidence — registrationCommit from the VERIFIED git freeze, not
// the run file — consumed identically by the runner, this sealer, and the analyzer.
const { promptAssets, schemaAssets } = loadFrozenPromptAssets(DIR);
const { expected } = deriveExpectedEvidence({ manifest, calls, promptAssets, schemaAssets, registrationCommit: freeze.commit });
// One shared builder: verifies every call from raw bytes, binds each to its expected request evidence,
// and validates the run freeze-evidence file against the verified git freeze.
const built = buildCollectionEvidence({ runDir, manifest, calls, model: PILOT_MODEL, validators, freezeEvidencePath, expectedEvidence: expected, verifiedFreeze: freeze });
if (built.freezeEvidenceErrors.length) { for (const e of built.freezeEvidenceErrors) console.error(`  freeze-evidence: ${e}`); fail(`run freeze evidence does not match the verified git freeze`); }
if (built.tampered.length) { for (const t of built.tampered) console.error(`  tampered ${t.callId}: ${t.why.join('; ')}`); fail(`${built.tampered.length} call(s) failed byte/window/request-evidence verification`); }
if (built.fatalCalls.length) fail(`${built.fatalCalls.length} model-drift/fatal call(s); the run is invalidated`);
if (built.protocolViolationCalls.length) fail(`${built.protocolViolationCalls.length} call(s) violate the no-outcome-retry rule`);
if (built.nonTerminal.length) fail(`${built.nonTerminal.length} call(s) are not terminal; complete the run first`);
if (built.usageMissingCalls.length) fail(`${built.usageMissingCalls.length} valid call(s) have no measurable usage; cost cannot be measured`);

const evidence = built.evidence;
const evidenceSha = built.evidenceSha256;
const outPath = join(DIR, `collection-evidence.${evidenceSha.slice(0, 16)}.json`);
if (existsSync(outPath)) fail(`${outPath} already exists (never overwrite a seal candidate)`);
writeFileSync(outPath, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx', mode: 0o644 });
console.log(`wrote ${outPath}`);
console.log(`collection-evidence sha256: ${evidenceSha}`);
console.log(`NOW COMMIT it in a dedicated commit with the EXACT subject:`);
console.log(`  PILOT COLLECTION SEALED: ${PILOT_FREEZE_ID}`);
console.log('Then run analyze-recognition-pilot.mjs; a FINAL analysis re-derives this manifest and requires it committed and byte-identical.');
