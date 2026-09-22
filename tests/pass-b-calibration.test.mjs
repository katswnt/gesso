// Offline contract tests for the lean Pass B calibration controller (B0/B1 + conditional B2; Read-tool
// image transport; stream-json execution evidence). No network, no model calls.
import assert from 'node:assert';
import { readFileSync, mkdtempSync, rmSync, writeFileSync as wf, readdirSync as rdir, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureStageCompletion, verifyCapturedStage, completionKey } from '../scripts/lib/vision-content-capture.mjs';
import { validateStageBody } from '../scripts/lib/vision-content-schema.mjs';
import { renderReviewPacket, rowNeedsAttention, mandatoryWhyEdit } from '../scripts/lib/pass-b-review-packet.mjs';
import { sha256 } from '../scripts/lib/vision-legacy.mjs';
import {
  validateSelection, trustedCatalog, planCalls, buildStageCommand, b2InputFor, b2Plan, b3Plan, MAX_B3_REQUESTS, compactB4Input,
  producerEvidence, protectedHoursBlock, syntheticFixture, runWorkStages,
  neutralImageFile, parseStreamTranscript, transcriptFinal, verifyB1ImageRead, verifyB2WebEvents, webFetchRetrieved,
  legacyContentInput, primaryModelFromEnvelope, stripJsonFence, IMAGE_TRANSPORT_VERSION, CONTROLLER_VERSION,
  contractHash, VALIDATION_CONTRACT_VERSION, B4_VALIDATION_CONTRACT_VERSION, verifyStageEvidence, findTranscriptBySha, loadOrArchiveCompletion,
} from '../scripts/lib/pass-b-calibration.mjs';
import { buildB1Prompt, buildB2Prompt, buildB3Prompt, buildB4Prompt, promptHashes } from '../scripts/lib/pass-b-prompts.mjs';
import { WIRE_SCHEMAS, validateAgainstWire, B4_DELTA, B4_DELTA_V2, WIRE_B4_FULL } from '../scripts/lib/pass-b-wire-schema.mjs';
import { compactB4DeltaInput } from '../scripts/lib/pass-b-calibration.mjs';
import { validateB4Delta, assembleAndValidateB4, b1Grounding, b4Lineage, guideLineageMetrics, HOTSPOT_MAX_BBOX_AREA } from '../scripts/lib/pass-b-b4-delta.mjs';
import { EDITORIAL_REVIEW_VERSION, hotspotReviewRows } from '../scripts/lib/pass-b-editorial-review.mjs';
import {
  CONFIRMATION_RESULT_VERSION, CONFIRMATION_WIRE_SCHEMA, NEW_POINT_CONFIRMATION_DISTANCE,
  SPATIAL_CALIBRATION_VERSION, LOCALIZATION_RESULT_VERSION, LOCALIZATION_WIRE_SCHEMA, legacyHotspotCandidate, legacyImageSha256FromB0, spatialRowsForWork,
  buildConfirmationInput, buildConfirmationPrompt, buildLocalizationInput, buildLocalizationPrompt,
  validateConfirmationResult, validateLocalizationResult, resolveConfirmedLocalization, resolveLocalization,
  quantile, summarizeOwnerSpatialReview, summarizePointDistances,
} from '../scripts/lib/pass-b-spatial-policy.mjs';

const tests = []; const t = (n, fn) => tests.push({ n, fn });

const sel = JSON.parse(readFileSync('tasks/pass-b-calibration-50-selection.json', 'utf8'));
const w = {}; new Function('window', readFileSync('data/pool.js', 'utf8'))(w);
const poolIds = new Set(w.ARTEFACTUM_POOL.map(x => x.id));
const controllerSrc = readFileSync('scripts/pass-b-calibration.mjs', 'utf8').replace(/\/\/.*$/gm, '');
const libSrc = readFileSync('scripts/lib/pass-b-calibration.mjs', 'utf8');
const fullPacketSrc = readFileSync('scripts/pass-b-b4-review-packet.mjs', 'utf8');
const spatialCanarySrc = readFileSync('scripts/pass-b-spatial-localization-canary.mjs', 'utf8');
const spatialCalibrationSrc = readFileSync('scripts/pass-b-spatial-calibration.mjs', 'utf8');
const confirmationCanarySrc = readFileSync('scripts/pass-b-spatial-confirmation-canary.mjs', 'utf8');
const spatialResolutionPacketSrc = readFileSync('scripts/pass-b-spatial-resolution-packet.mjs', 'utf8');
const SHA = 'a'.repeat(64);

// ---- stream-json transcript fixtures ----
const streamJson = events => events.map(e => JSON.stringify(e)).join('\n') + '\n';
const asst = blocks => ({ type: 'assistant', message: { content: blocks } });
const usr = blocks => ({ type: 'user', message: { content: blocks } });
const toolUse = (name, input, id) => ({ type: 'tool_use', name, input, id });
const toolResult = (id, { isError = false, image = false, text = 'ok' } = {}) => ({ type: 'tool_result', tool_use_id: id, is_error: isError, content: image ? [{ type: 'image' }] : [{ type: 'text', text }] });
const resultEv = (extra = {}) => ({ type: 'result', subtype: 'success', is_error: false, structured_output: { ok: 1 }, modelUsage: { 'claude-sonnet-4-6': { output_tokens: 100 } }, num_turns: 3, ...extra });

t('selection validates: 50 unique in-pool, 25/25, 10/band, 25/25', () => {
  const c = validateSelection(sel, poolIds);
  assert(c.ok, c.errors.join('; '));
  assert.deepEqual(c.guideStatus, { legacyCandidate: 25, missing: 12, templateThin: 13 });
});
t('validateSelection rejects a broken composition', () => {
  assert(!validateSelection({ works: sel.works.slice(0, 49) }, poolIds).ok);
});

t('call plan: B0/B1 + conditional B2 + conditional targeted B3 + compact B4', () => {
  const p = planCalls(sel.works);
  assert.equal(p.works, 50); assert.equal(p.B0, 50); assert.equal(p.B1, 50);
  assert.equal(p.B2Max, 50); assert.equal(p.B3Max, 50); assert.equal(p.B4Max, 50);
  assert.equal(p.b2Conditional, true); assert.equal(p.b3Conditional, true);
  assert.equal(p.maxProcesses, 200);
});
t('B2 is conditional: runs on B1 research questions OR legacy content; skipped when neither', () => {
  assert.equal(b2Plan({ researchQuestions: [{ questionId: 'q1' }] }, { counts: {} }).run, true);
  assert.equal(b2Plan({ researchQuestions: [] }, { counts: { notes: 3 } }).run, true);
  assert.equal(b2Plan({ researchQuestions: [] }, { counts: {}, teaching: { why: 'x' } }).run, true);
  assert.equal(b2Plan({ researchQuestions: [] }, { counts: {} }).run, false);
});
t('B3 is conditional on B2 targeted requests', () => {
  assert.equal(b3Plan(syntheticFixture().bodies.B2).run, true);
  assert.equal(b3Plan({ targetedVerificationRequests: [] }).run, false);
});
t('compact B4 input preserves noteCandidate evidenceRefs + ONLY referenced evidence/delight rows; no prose', () => {
  const fx = syntheticFixture();
  const b1 = JSON.parse(JSON.stringify(fx.bodies.B1));
  b1.noteCandidates[0].evidenceRef = 'ev_medium'; // references one evidence row
  const legacyInput = legacyContentInput({ workId: 'w', teaching: { why: 'W' }, counts: {} });
  const c = compactB4Input({ b1, b2: fx.bodies.B2, b3: fx.bodies.B3, legacyInput });
  // note carries its evidenceRef
  assert.equal(c.b1.noteCandidates[0].evidenceRef, 'ev_medium');
  // ONLY the referenced evidence row is included, projected with id/feature/bbox/confidence + axis
  assert.equal(c.b1.evidence.length, 1);
  assert.equal(c.b1.evidence[0].id, 'ev_medium');
  assert(c.b1.evidence[0].axis === 'medium' && 'feature' in c.b1.evidence[0] && 'bbox' in c.b1.evidence[0]);
  // no verbose B1 visual prose or raw transcript leaks into the projection
  const blob = JSON.stringify(c);
  assert(!blob.includes('pose description') && !blob.includes('gesture description'), 'B1 visual prose must not reach B4');
  assert(!/transcript|tool_use|stream/i.test(blob), 'no transcript in B4 input');
  // B2 structured facts + B3 verifications are carried
  assert(c.b2.factChecks.length >= 1 && Array.isArray(c.b3.verifications));
});

t('B1 gets ONLY the Read tool; B2 ONLY web; neither exposes title/id/catalog/repo path', () => {
  const b1 = buildStageCommand({ stage: 'B1', promptText: 'inventory', imageFile: neutralImageFile(SHA, 'jpg') });
  const after = (argv, flag) => { const i = argv.indexOf(flag); return i === -1 ? null : argv[i + 1]; };
  assert.equal(after(b1.argv, '--tools'), 'Read');
  assert.equal(after(b1.argv, '--allowedTools'), 'Read');
  assert(!b1.argv.includes('WebSearch') && !b1.argv.includes('WebFetch') && !b1.argv.includes('Bash') && !b1.argv.includes('Write') && !b1.argv.includes('Edit'), 'B1 must have no tool other than Read');
  assert(b1.argv.includes('--restricted') && b1.argv.includes('--safe-mode') && b1.argv.includes('--strict-mcp-config'));
  assert.equal(after(b1.argv, '--mcp-config'), '{"mcpServers":{}}');
  assert.equal(after(b1.argv, '--output-format'), 'stream-json');
  assert(b1.argv.includes('--verbose'), 'stream-json needs --verbose');
  // No answer-bearing text in the command: only the bare <sha>.<ext> filename, never a title/id/catalog/repo path.
  const flat = JSON.stringify(b1.argv);
  assert(!/artguessr|pool\.js|cleveland|Julius|Caesar|catalogId|\/Users\//.test(flat), 'B1 command leaks identity/path');
  const b2 = buildStageCommand({ stage: 'B2', promptText: 'research' });
  assert.equal(after(b2.argv, '--tools'), 'WebSearch WebFetch');
  assert.equal(after(b2.argv, '--allowedTools'), 'WebSearch WebFetch');
  assert(!b2.imageAttached);
  assert.throws(() => buildStageCommand({ stage: 'B2', promptText: 'x', imageFile: neutralImageFile(SHA, 'jpg') }), /must NOT receive an image/);
  assert.throws(() => buildStageCommand({ stage: 'B1', promptText: 'x' }), /requires a confined image filename/);
  assert(b1.env.removeKeys.includes('ANTHROPIC_API_KEY') && b1.env.removeKeys.includes('ANTHROPIC_AUTH_TOKEN'));
});

t('B1 completion requires a real Read of the EXACT image; out-of-dir Read is rejected', () => {
  const img = neutralImageFile(SHA, 'jpg'); const callDir = '/tmp/passb-call-xyz';
  const good = parseStreamTranscript(streamJson([
    asst([toolUse('Read', { file_path: `${callDir}/${img}` }, 't1')]), usr([toolResult('t1', { image: true })]),
    asst([toolUse('StructuredOutput', {}, 't2')]), resultEv(),
  ]));
  assert.equal(verifyB1ImageRead(good, { callDir, imageBasename: img }).ok, true);
  // No Read at all -> reject (this is the hallucination case: model answered without opening the file).
  const noRead = parseStreamTranscript(streamJson([asst([toolUse('StructuredOutput', {}, 't2')]), resultEv()]));
  assert.equal(verifyB1ImageRead(noRead, { callDir, imageBasename: img }).ok, false);
  // Read that returned no image content block -> not proven delivered -> reject.
  const noImage = parseStreamTranscript(streamJson([asst([toolUse('Read', { file_path: `${callDir}/${img}` }, 't1')]), usr([toolResult('t1', { image: false })]), resultEv()]));
  assert.equal(verifyB1ImageRead(noImage, { callDir, imageBasename: img }).ok, false);
  // Read targeting OUTSIDE the confined dir -> reject the whole stage.
  const escape = parseStreamTranscript(streamJson([asst([toolUse('Read', { file_path: '/etc/passwd' }, 't1')]), usr([toolResult('t1', { image: false })]), resultEv()]));
  assert.equal(verifyB1ImageRead(escape, { callDir, imageBasename: img }).ok, false);
  // Read of a different file in-dir -> reject.
  const wrong = parseStreamTranscript(streamJson([asst([toolUse('Read', { file_path: `${callDir}/other.jpg` }, 't1')]), usr([toolResult('t1', { image: true })]), resultEv()]));
  assert.equal(verifyB1ImageRead(wrong, { callDir, imageBasename: img }).ok, false);
  // macOS /tmp -> /private/tmp symlink: the Read tool reports the realpath; must still count as inside the dir.
  const realpathForm = parseStreamTranscript(streamJson([asst([toolUse('Read', { file_path: `/private${callDir}/${img}` }, 't1')]), usr([toolResult('t1', { image: true })]), resultEv()]));
  assert.equal(verifyB1ImageRead(realpathForm, { callDir, imageBasename: img }).ok, true);
  // Path traversal is rejected even if the basename matches.
  const traverse = parseStreamTranscript(streamJson([asst([toolUse('Read', { file_path: `${callDir}/../${img}` }, 't1')]), usr([toolResult('t1', { image: true })]), resultEv()]));
  assert.equal(verifyB1ImageRead(traverse, { callDir, imageBasename: img }).ok, false);
});

t('B2 requires genuine WebSearch AND WebFetch events (not usage counters)', () => {
  const both = parseStreamTranscript(streamJson([
    asst([toolUse('WebSearch', { query: 'x' }, 's1')]), usr([toolResult('s1')]),
    asst([toolUse('WebFetch', { url: 'https://x' }, 'f1')]), usr([toolResult('f1', { text: '# Retrieved page\n' + 'substantive body '.repeat(20) })]), resultEv(),
  ]));
  assert.equal(verifyB2WebEvents(both).ok, true);
  // A WebFetch that returns a non-error 4xx envelope with no page body must NOT count as a retrieval.
  const failedFetch = parseStreamTranscript(streamJson([
    asst([toolUse('WebSearch', {}, 's1')]), usr([toolResult('s1')]),
    asst([toolUse('WebFetch', {}, 'f1')]), usr([toolResult('f1', { text: 'The server returned HTTP 403 Forbidden. The response body was not retrieved.' })]), resultEv(),
  ]));
  assert.equal(verifyB2WebEvents(failedFetch).ok, false);
  const searchOnly = parseStreamTranscript(streamJson([asst([toolUse('WebSearch', {}, 's1')]), usr([toolResult('s1')]), resultEv()]));
  assert.equal(verifyB2WebEvents(searchOnly).ok, false);
  const fetchOnly = parseStreamTranscript(streamJson([asst([toolUse('WebFetch', {}, 'f1')]), usr([toolResult('f1')]), resultEv()]));
  assert.equal(verifyB2WebEvents(fetchOnly).ok, false);
  // Zero web tool-use but a model that emitted remembered URLs in structured_output -> still rejected.
  const none = parseStreamTranscript(streamJson([asst([toolUse('StructuredOutput', { factChecks: [{ verdict: 'supported', sources: [{ url: 'https://en.wikipedia.org/x' }] }] }, 'o1')]), resultEv()]));
  assert.equal(verifyB2WebEvents(none).ok, false);
});

t('transcriptFinal returns the terminal result event with structured_output', () => {
  const tr = parseStreamTranscript(streamJson([asst([toolUse('Read', { file_path: '/tmp/x' }, 't1')]), resultEv({ structured_output: { z: 9 } })]));
  assert.deepEqual(transcriptFinal(tr).structured_output, { z: 9 });
  assert.equal(primaryModelFromEnvelope(transcriptFinal(tr)), 'claude-sonnet-4-6');
});

t('B1→B2 boundary passes ONLY allowlisted signals (no image-derived prose)', () => {
  const fx = syntheticFixture();
  const input = b2InputFor(fx.workId, fx.trustedCatalog, fx.bodies.B1);
  assert.deepEqual(Object.keys(input).sort(), ['catalog', 'researchQuestions', 'version', 'visibleSignals', 'workId'].sort());
  for (const s of input.visibleSignals) assert.deepEqual(Object.keys(s).sort(), ['axis', 'bbox', 'confidence', 'evidenceId'].sort());
  const blob = JSON.stringify(input);
  assert(!blob.includes(fx.bodies.B1.seen) && !blob.includes('Visible brushwork'), 'image prose leaked to B2');
});

t('producer evidence is subscription-kind with hashed tool/network policy', () => {
  const pr = producerEvidence('B1', { runtimeVersion: '2.1.259' });
  assert.equal(pr.kind, 'claude-code-subscription');
  assert(/^[0-9a-f]{64}$/.test(pr.toolPolicyHash) && /^[0-9a-f]{64}$/.test(pr.networkPolicyHash));
  assert.notEqual(producerEvidence('B2', { runtimeVersion: 'x' }).networkPolicyHash, pr.networkPolicyHash);
});
t('protected-hours guard blocks daytime unattended, allows foreground', () => {
  assert.equal(protectedHoursBlock(14, false), true);
  assert.equal(protectedHoursBlock(14, true), false);
  assert.equal(protectedHoursBlock(23, false), false);
});

t('capture chain binds transport version + transcript SHA; resume re-verifies', () => {
  const dir = mkdtempSync(join(tmpdir(), 'passb-'));
  try {
    const fx = syntheticFixture();
    const base = { workId: fx.workId, imgSha256: sha256('img'), promptHash: sha256('p'), brokerPolicyVersion: 'img-broker/1', imageTransportVersion: IMAGE_TRANSPORT_VERSION, transcriptSha256: sha256('transcript') };
    for (const stage of ['B1', 'B2']) {
      const producer = producerEvidence(stage, { runtimeVersion: 'test' });
      const cap = captureStageCompletion({ runDir: dir, stage, rawResponse: JSON.stringify(fx.bodies[stage]), trusted: base, producer, createdAt: '2026-09-02T00:00:00Z', context: fx.contexts[stage] || {} });
      // completion carries the new bindings
      const stored = JSON.parse(readFileSync(cap.completionPath, 'utf8'));
      assert.equal(stored.imageTransportVersion, IMAGE_TRANSPORT_VERSION);
      assert.equal(stored.transcriptSha256, sha256('transcript'));
      // live verify (with transcriptSha256) and resume verify (without it) both pass
      assert(verifyCapturedStage({ completionPath: cap.completionPath, runDir: dir, trusted: base, producer, context: fx.contexts[stage] || {} }).ok);
      const { transcriptSha256, ...resumeTrusted } = base;
      assert(verifyCapturedStage({ completionPath: cap.completionPath, runDir: dir, trusted: resumeTrusted, producer, context: fx.contexts[stage] || {} }).ok, 'resume without transcript SHA must still verify');
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
t('completion binding rejects a missing transport version / transcript SHA', () => {
  const dir = mkdtempSync(join(tmpdir(), 'passb-bind-'));
  try {
    const fx = syntheticFixture();
    const producer = producerEvidence('B1', { runtimeVersion: 't' });
    const bad = { workId: fx.workId, imgSha256: sha256('i'), promptHash: sha256('p'), brokerPolicyVersion: 'img-broker/1' }; // no transport/transcript
    assert.throws(() => captureStageCompletion({ runDir: dir, stage: 'B1', rawResponse: JSON.stringify(fx.bodies.B1), trusted: bad, producer, createdAt: '2026-09-02T00:00:00Z' }), /trusted completion binding/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

t('live loop threads B1 → B2 → conditional B3 → compact B4 (image only on B1/B3)', async () => {
  const fx = syntheticFixture();
  const spawned = [];
  const spawnStage = async (stage, { command, imageFile }) => {
    spawned.push({ stage, tools: command.toolsEnforced, image: !!imageFile });
    return { raw: JSON.stringify(fx.bodies[stage === 'B4' ? 'B4Delta' : stage]), transcriptSha256: sha256(`t-${stage}`) };
  };
  const capture = async ({ stage, rawResponse, trusted }) => { assert.equal(trusted.imageTransportVersion, IMAGE_TRANSPORT_VERSION); assert(/^[0-9a-f]{64}$/.test(trusted.transcriptSha256)); return { completion: { body: JSON.parse(rawResponse) } }; };
  const { status, bodies } = await runWorkStages({ workId: fx.workId, catalog: fx.trustedCatalog, legacy: { counts: { notes: 2 } }, imgSha256: SHA, ext: 'jpg', prompts: { B1: 'p1', B2: 'p2', B3: 'p3', B4: 'p4' }, runtimeVersion: 't', spawnStage, capture });
  assert.deepEqual(status, { B1: 'complete', B2: 'complete', B3: 'complete', B4: 'complete' });
  assert(bodies.B1 && bodies.B2 && bodies.B3 && bodies.B4);
  // ONLY B1 and B3 attach the image (Read tool); B2 has web and no image; B4 has no tools and no image.
  assert.deepEqual(spawned.map(s => `${s.stage}:${s.tools}:${s.image}`), ['B1:Read:true', 'B2:WebSearch WebFetch:false', 'B3:Read:true', 'B4:none:false']);
});
t('B2 validation failure retries exactly once with a fresh process, then completes', async () => {
  const fx = syntheticFixture();
  let b2Spawns = 0, b2Captures = 0;
  const spawnStage = async (stage) => { if (stage === 'B2') b2Spawns++; return { raw: JSON.stringify(fx.bodies[stage]), transcriptSha256: sha256(stage + b2Spawns) }; };
  const capture = async ({ stage, rawResponse }) => { if (stage === 'B2') { b2Captures++; if (b2Captures === 1) throw new Error('invalid B2 body: guideAnswers'); } return { completion: { body: JSON.parse(rawResponse) } }; };
  const { status, retries } = await runWorkStages({ workId: fx.workId, catalog: fx.trustedCatalog, legacy: { counts: { notes: 1 } }, imgSha256: SHA, ext: 'jpg', prompts: { B1: 'p', B2: 'p', B3: 'p', B4: 'p' }, runtimeVersion: 't', spawnStage, capture });
  assert.equal(status.B2, 'complete');
  assert.equal(b2Spawns, 2, 'B2 re-spawned a fresh process exactly once');
  assert.equal(retries.B2.attempts, 1); assert.equal(retries.B2.errors.length, 1);
});
t('B2 failing validation twice stops B2, retains B1, no third attempt', async () => {
  const fx = syntheticFixture();
  let b2Spawns = 0;
  const spawnStage = async (stage) => { if (stage === 'B2') b2Spawns++; return { raw: JSON.stringify(fx.bodies[stage]), transcriptSha256: sha256(stage + b2Spawns) }; };
  const capture = async ({ stage, rawResponse }) => { if (stage === 'B2') throw new Error('invalid B2 body: guideAnswers'); return { completion: { body: JSON.parse(rawResponse) } }; };
  const { status, bodies, retries } = await runWorkStages({ workId: fx.workId, catalog: fx.trustedCatalog, legacy: { counts: { notes: 1 } }, imgSha256: SHA, ext: 'jpg', prompts: { B1: 'p', B2: 'p', B3: 'p', B4: 'p' }, runtimeVersion: 't', spawnStage, capture });
  assert(status.B2.startsWith('failed:')); assert.equal(b2Spawns, 2, 'exactly original + one retry, no third');
  assert.equal(retries.B2.attempts, 2); assert(bodies.B1, 'B1 retained'); assert.equal(status.B3, 'not-requested'); assert.equal(status.B4, 'not-requested');
});
t('a process/web failure is NOT retried (only validation failures retry)', async () => {
  const fx = syntheticFixture();
  let b2Spawns = 0;
  const spawnStage = async (stage) => { if (stage === 'B2') { b2Spawns++; throw new Error('B2 research-not-performed'); } return { raw: JSON.stringify(fx.bodies[stage]), transcriptSha256: sha256(stage) }; };
  const { status, retries } = await runWorkStages({ workId: fx.workId, catalog: fx.trustedCatalog, legacy: { counts: { notes: 1 } }, imgSha256: SHA, ext: 'jpg', prompts: { B1: 'p', B2: 'p', B3: 'p', B4: 'p' }, runtimeVersion: 't', spawnStage, capture: async ({ rawResponse }) => ({ completion: { body: JSON.parse(rawResponse) } }) });
  assert(status.B2.startsWith('failed:')); assert.equal(b2Spawns, 1, 'process/web failure must NOT retry'); assert(!retries.B2);
});
t('B3 is skipped when B2 raises no targeted requests; B4 still runs', async () => {
  const fx = syntheticFixture();
  const b2 = JSON.parse(JSON.stringify(fx.bodies.B2)); b2.targetedVerificationRequests = [];
  const spawnStage = async (stage) => ({ raw: JSON.stringify(stage === 'B2' ? b2 : (stage === 'B4' ? fx.bodies.B4Delta : fx.bodies[stage])), transcriptSha256: sha256(stage) });
  const { status } = await runWorkStages({ workId: fx.workId, catalog: fx.trustedCatalog, legacy: { counts: { notes: 1 } }, imgSha256: SHA, ext: 'jpg', prompts: { B1: 'p', B2: 'p', B3: 'p', B4: 'p' }, runtimeVersion: 't', spawnStage, capture: async ({ rawResponse }) => ({ completion: { body: JSON.parse(rawResponse) } }) });
  assert.equal(status.B3, 'not-requested'); assert.equal(status.B4, 'complete');
});
t('B2 is skipped when neither B1 questions nor legacy content exist', async () => {
  const b1 = JSON.parse(JSON.stringify(syntheticFixture().bodies.B1)); b1.researchQuestions = [];
  const spawnStage = async (stage) => ({ raw: JSON.stringify(stage === 'B1' ? b1 : {}), transcriptSha256: sha256(stage) });
  const { status } = await runWorkStages({ workId: 'w', catalog: {}, legacy: { counts: {} }, imgSha256: SHA, ext: 'jpg', prompts: { B1: 'p', B2: 'p' }, runtimeVersion: 't', spawnStage, capture: async ({ rawResponse }) => ({ completion: { body: JSON.parse(rawResponse) } }) });
  assert.equal(status.B1, 'complete'); assert.equal(status.B2, 'not-requested');
});
t('a failed B1 blocks B2 but never throws out of the work', async () => {
  const spawnStage = async stage => { if (stage === 'B1') throw new Error('boom'); return { raw: '{}', transcriptSha256: sha256('x') }; };
  const { status, bodies } = await runWorkStages({ workId: 'x', catalog: {}, legacy: { counts: { notes: 1 } }, imgSha256: SHA, ext: 'jpg', prompts: { B1: 'p1', B2: 'p2' }, runtimeVersion: 't', spawnStage, capture: async () => ({ completion: { body: {} } }) });
  assert(status.B1.startsWith('failed:')); assert.equal(status.B2, 'not-requested'); assert(!bodies.B2);
});
t('resume skips B1 when its completion exists, then proceeds to B2', async () => {
  const fx = syntheticFixture();
  let b1Spawns = 0;
  const spawnStage = async (stage) => { if (stage === 'B1') b1Spawns++; return { raw: JSON.stringify(fx.bodies[stage]), transcriptSha256: sha256(stage) }; };
  const { status } = await runWorkStages({ workId: fx.workId, catalog: fx.trustedCatalog, legacy: { counts: { notes: 1 } }, imgSha256: SHA, ext: 'jpg', prompts: { B1: 'p1', B2: 'p2' }, runtimeVersion: 't', spawnStage, capture: async ({ rawResponse }) => ({ completion: { body: JSON.parse(rawResponse) } }), loadCompletion: async s => s === 'B1' ? fx.bodies.B1 : null });
  assert.equal(b1Spawns, 0, 'B1 must be skipped when its completion exists');
  assert.equal(status.B1, 'complete'); assert.equal(status.B2, 'complete');
});
t('effective prompt binding changes when legacy content changes (B2)', async () => {
  const fx = syntheticFixture();
  const cap = hashes => async ({ stage, trusted }) => { hashes[stage] = trusted.promptHash; return { completion: { body: stage === 'B1' ? fx.bodies.B1 : fx.bodies.B2 } }; };
  const spawnStage = async (stage) => ({ raw: JSON.stringify(stage === 'B1' ? fx.bodies.B1 : fx.bodies.B2), transcriptSha256: sha256(stage) });
  const hA = {}; await runWorkStages({ workId: fx.workId, catalog: fx.trustedCatalog, legacy: { counts: { notes: 1 }, teaching: { why: 'A' } }, imgSha256: SHA, ext: 'jpg', prompts: { B1: 'p', B2: 'p' }, runtimeVersion: 't', spawnStage, capture: cap(hA) });
  const hB = {}; await runWorkStages({ workId: fx.workId, catalog: fx.trustedCatalog, legacy: { counts: { notes: 1 }, teaching: { why: 'DIFFERENT' } }, imgSha256: SHA, ext: 'jpg', prompts: { B1: 'p', B2: 'p' }, runtimeVersion: 't', spawnStage, capture: cap(hB) });
  assert.notEqual(hA.B2, hB.B2, 'different legacy must change the B2 effective prompt hash');
});

t('review packet renders existing + B1 proposal + B2 research + B4 synthesis + image + overlay pins', () => {
  const fx = syntheticFixture();
  const row = { id: 'w', legacyTitle: 'W', cohort: 'strongLegacy', fameBand: 'f3', regionGroup: 'europe', guideStatus: 'legacyCandidate',
    image: { ok: true, imgSha256: SHA, ext: 'jpg', width: 100, height: 100 },
    legacy: { counts: { notes: 1, guide: 1, hotspots: 1 }, teaching: { why: 'OLDWHY', cues: ['oldcue'], notes: [{ head: 'n', body: 'b', x: 10, y: 20 }], guide: [{ q: 'q', a: 'a' }] }, hotspots: [{ n: 1, x: 30, y: 40 }] },
    b1: fx.bodies.B1, b2: fx.bodies.B2, b3: fx.bodies.B3, b4: fx.bodies.B4, stageStatus: { B1: 'complete', B2: 'complete', B3: 'complete', B4: 'complete' } };
  const p = renderReviewPacket([row], { runId: 'x', mode: 'live', generatedAt: 'now', imageBase: '../imgs-abc' });
  assert(p.html.includes('<img src="../imgs-abc/' + SHA + '.jpg"'), 'embedded image missing');
  assert(p.html.includes('class="pin old before"') && p.html.includes('class="pin new after"'), 'before/after hotspot overlays missing');
  assert(p.html.includes('Before → after') && p.html.includes('Study guide'), 'focused before/after comparison missing');
  assert(p.html.includes(fx.bodies.B4.hotspots[0].conciseText), 'proposed B4 hotspot missing from comparison');
  assert(p.html.includes(fx.bodies.B4.guide[0].q), 'proposed B4 guide missing from comparison');
  assert(p.html.includes('<details class="audit-details">'), 'full evidence should be collapsible beneath the comparison');
  assert(p.html.includes('OLDWHY'), 'existing content missing');
  assert(p.html.includes(fx.bodies.B1.seen), 'B1 proposal (seen) missing');
  assert(p.html.includes('image-first proposal') && p.html.includes('no-image research'), 'B1/B2 sections missing');
  assert(p.html.includes(fx.bodies.B2.factChecks[0].claim), 'B2 fact-check missing');
  // B4 synthesis section renders keep/revise/replace dispositions + proposed why.
  assert(p.html.includes('Component dispositions') && p.html.includes('disp-revise'), 'B4 synthesis section missing');
  assert(p.html.includes(fx.bodies.B4.proposedWhy), 'B4 proposed why missing');
  assert(/^[0-9a-f]{64}$/.test(p.json.packetSha256));
});

t('needsAttention is true on a B4 humanReview conflict OR a consequential correction (not just stage failure)', () => {
  const base = { id: 'w', cohort: 'strongLegacy', stageStatus: { B1: 'complete', B2: 'complete', B3: 'complete', B4: 'complete' }, b4: { conflicts: [], corrections: { consequential: [] } } };
  assert.equal(rowNeedsAttention(base), false, 'clean completed row does not need attention');
  assert.equal(rowNeedsAttention({ ...base, b4: { conflicts: [{ status: 'humanReview', resolution: '' }], corrections: { consequential: [] } } }), true, 'humanReview conflict -> needs attention');
  assert.equal(rowNeedsAttention({ ...base, b4: { conflicts: [], corrections: { consequential: [{ field: 'medium', from: 'a', to: 'b' }] } } }), true, 'consequential correction -> needs attention');
  assert.equal(rowNeedsAttention({ ...base, b4: { conflicts: [{ status: 'resolved', resolution: 'x' }], corrections: { consequential: [] } } }), false, 'a resolved (non-humanReview) conflict alone does not flag');
  assert.equal(rowNeedsAttention({ ...base, stageStatus: { ...base.stageStatus, B2: 'failed:invalid B2 body' } }), true, 'a stage failure still flags');
  // VSD-023: a B4 proposedWhy over the player cap is a MANDATORY why-edit and must flag for attention.
  assert.equal(mandatoryWhyEdit({ b4: { proposedWhy: 'x'.repeat(650) } }), true, 'why over cap requires a mandatory edit');
  assert.equal(mandatoryWhyEdit({ b4: { proposedWhy: 'x'.repeat(400) } }), false, 'why within cap needs no edit');
  assert.equal(rowNeedsAttention({ ...base, b4: { conflicts: [], corrections: { consequential: [] }, proposedWhy: 'x'.repeat(650) } }), true, 'over-cap why -> needs attention');
  // Surfaced in the packet: badge + filter + summary count.
  const p = renderReviewPacket([{ ...base, legacyTitle: 'W', fameBand: 'f3', regionGroup: 'europe', guideStatus: 'x', image: { ok: true, imgSha256: SHA, ext: 'jpg', width: 1, height: 1 }, legacy: { counts: {} }, b1: syntheticFixture().bodies.B1, b2: syntheticFixture().bodies.B2, b4: { conflicts: [{ status: 'humanReview', resolution: '' }], corrections: { consequential: [] }, dispositions: [], proposedCues: [], notes: [], guide: [], hotspots: [] } }], { runId: 'x', mode: 'live', generatedAt: 'now', imageBase: '../i' });
  assert(p.html.includes('NEEDS ATTENTION') && p.html.includes('data-attn="1"'), 'packet must badge a needs-attention row');
  assert(/Needs attention \(1\)/.test(p.html), 'packet filter shows the needs-attention count');
});

t('controller reaches NO authoritative writer/merge and never calls the paid API', () => {
  assert(!/api\.anthropic\.com|messages\.create/.test(controllerSrc), 'no paid API path');
  // No authoritative SINK: no merge, no review-approval consumption. (Reading teach-works/hotspots for the
  // legacy snapshot is legitimate; only WRITING an authoritative file is forbidden.)
  assert(!/curate-merge|vision-review|approved\.json/.test(controllerSrc), 'no merge/approval sink reachable');
  assert(!/writeFileSync\([^)]*(pool|teach-works|hotspots|vision-audit|vision-evidence)\.js/.test(controllerSrc), 'must never write an authoritative game-data file');
  assert(/removeKeys|PASS_B_CALIB_LIVE/.test(controllerSrc), 'live is gated');
});
t('spawn uses a FRESH confined temp dir holding only the SHA image, stream-json, keys stripped', () => {
  assert(/mkdtempSync\(join\(tmpdir\(\)/.test(controllerSrc), 'fresh per-call temp dir');
  assert(/copyFileSync\(join\(imgsDir/.test(controllerSrc), 'only the SHA image is copied into the call dir');
  assert(/stream-json|parseStreamTranscript/.test(controllerSrc), 'stream-json transcript');
  assert(/delete env\.ANTHROPIC_API_KEY|removeKeys/.test(controllerSrc) || /command\.env\.removeKeys/.test(controllerSrc), 'API keys stripped');
  assert(/verifyB1ImageRead/.test(controllerSrc) && /verifyB2WebEvents/.test(controllerSrc), 'evidence gates wired');
});

// ---- schema/prompt regressions retained from prior rounds (schemas survive; prompts stay in sync) ----
t('synthetic fixture B1..B4 bodies still validate (schemas retained)', () => {
  const fx = syntheticFixture();
  assert(validateStageBody('B1', fx.bodies.B1).ok);
  assert(validateStageBody('B2', fx.bodies.B2, fx.contexts.B2).ok);
  assert(validateStageBody('B3', fx.bodies.B3, fx.contexts.B3).ok);
  assert(validateStageBody('B4', fx.bodies.B4).ok);
});
t('each valid fixture satisfies BOTH the wire schema and the strict JS validator', () => {
  const fx = syntheticFixture();
  for (const stage of ['B1', 'B2', 'B3']) {
    assert.equal(validateAgainstWire(WIRE_SCHEMAS[stage], fx.bodies[stage]).length, 0, `${stage} wire`);
    assert(validateStageBody(stage, fx.bodies[stage], fx.contexts[stage] || {}).ok, `${stage} JS validator`);
  }
  // B4: the MODEL output is the compact delta (wire = B4_DELTA); the strict JS validator checks the ASSEMBLED
  // full record (which the controller hydrates), never the delta.
  assert.equal(WIRE_SCHEMAS.B4, B4_DELTA, 'B4 wire schema is now the delta');
  assert.equal(validateAgainstWire(WIRE_SCHEMAS.B4, fx.bodies.B4Delta).length, 0, 'B4 delta wire');
  assert(validateStageBody('B4', fx.bodies.B4).ok, 'B4 full-record JS validator');
});
t('B1 prompt instructs Read-tool use and carries the coordinate convention', () => {
  const p = buildB1Prompt();
  assert(/Read tool/.test(p), 'B1 prompt must instruct Read-tool use');
  assert(p.includes('Bounding boxes are [x, y, width, height] normalized to 0-1 fractions'), 'coordinate convention missing');
  assert(/percentages from 0-100/.test(p), 'pin-percentage note missing');
});
t('B4/B5 run at low effort; B1/B2/B3 keep session default effort', () => {
  const after = (argv, flag) => { const i = argv.indexOf(flag); return i === -1 ? null : argv[i + 1]; };
  const b4 = buildStageCommand({ stage: 'B4', promptText: 'synthesize' });
  assert.equal(after(b4.argv, '--effort'), 'low', 'B4 must run at low effort');
  const b1 = buildStageCommand({ stage: 'B1', promptText: 'x', imageFile: neutralImageFile(SHA, 'jpg') });
  const b2 = buildStageCommand({ stage: 'B2', promptText: 'x' });
  const b3 = buildStageCommand({ stage: 'B3', promptText: 'x', imageFile: neutralImageFile(SHA, 'jpg') });
  const b5 = buildStageCommand({ stage: 'B5', promptText: 'localize', imageFile: neutralImageFile(SHA, 'jpg'), wireSchema: LOCALIZATION_WIRE_SCHEMA });
  for (const [n, c] of [['B1', b1], ['B2', b2], ['B3', b3]]) assert(!c.argv.includes('--effort'), `${n} must not pin effort`);
  assert.equal(after(b5.argv, '--effort'), 'low');
  assert.equal(after(b5.argv, '--tools'), 'Read');
});
t('B4 prompt mandates the Unicode arrow → for cues (not ASCII ->) and routes B2/B3 contradictions to humanReview', () => {
  const p = buildB4Prompt();
  assert(p.includes('feature → signal') && !p.includes('feature -> signal'), 'B4 must mandate the Unicode arrow →');
  assert(/humanReview/.test(p) && /contradict/i.test(p), 'B4 must route a B2/B3 contradiction to humanReview');
  assert(/speculative|uncertain/i.test(p), 'B4 must not convert speculative/uncertain into an affirmative cue');
});
t('B3 verification note allows up to 2000 chars (concise still requested); B4 guide may cite a delight id', () => {
  const fx = syntheticFixture();
  const b3ok = JSON.parse(JSON.stringify(fx.bodies.B3)); b3ok.verifications[0].note = 'x'.repeat(1500);
  assert(validateStageBody('B3', b3ok, fx.contexts.B3).ok, 'B3 note up to 2000 must pass');
  const b3big = JSON.parse(JSON.stringify(fx.bodies.B3)); b3big.verifications[0].note = 'x'.repeat(2100);
  assert(!validateStageBody('B3', b3big, fx.contexts.B3).ok, 'B3 note over 2000 must fail');
  const b4d = JSON.parse(JSON.stringify(fx.bodies.B4)); b4d.guide[0].evidenceRef = 'd1'; // d1 is a declared delight
  assert(validateStageBody('B4', b4d).ok, 'B4 guide may reference a delight id (evidence/delight union)');
  const b4bad = JSON.parse(JSON.stringify(fx.bodies.B4)); b4bad.guide[0].evidenceRef = 'nope';
  assert(!validateStageBody('B4', b4bad).ok, 'B4 guide dangling evidenceRef still rejected');
});
t('B2 prompt requires genuine retrieval before supported/refuted', () => {
  const p = buildB2Prompt();
  assert(/MUST use|MUST run WebSearch|actually retrieve/i.test(p), 'B2 must be told to actually retrieve');
  assert(/unresolved/.test(p), 'B2 must fall back to unresolved when retrieval fails');
});
t('legacyContentInput is bounded and carries all legacy surfaces', () => {
  const li = legacyContentInput({ workId: 'w', teaching: { why: 'W', cues: ['C'], notes: [{ head: 'h', body: 'b' }], guide: [{ q: 'q', a: 'a' }] }, hotspots: [{ n: 1, x: 1, y: 1 }], rich: { pose: 'P' }, counts: { guide: 1 } });
  assert(li.why === 'W' && li.cues[0] === 'C' && li.notes[0].body === 'b' && li.guide[0].a === 'a' && li.hotspots[0].n === 1 && li.rich.pose === 'P');
});
t('legacy content reaches B2 but NEVER the blind B1', async () => {
  const fx = syntheticFixture();
  const legacy = { workId: fx.workId, teaching: { why: 'WHY_SENT', cues: ['CUE_SENT'], notes: [{ head: 'h', body: 'NOTE_SENT' }], guide: [{ q: 'q', a: 'GUIDE_SENT' }] }, hotspots: [{ n: 1, x: 5, y: 5 }], rich: { pose: 'POSE_SENT' }, counts: { notes: 1 } };
  const seenPrompt = {};
  const spawnStage = async (stage, { command }) => { seenPrompt[stage] = command.argv[command.argv.indexOf('-p') + 1]; return { raw: JSON.stringify(fx.bodies[stage]), transcriptSha256: sha256(stage) }; };
  await runWorkStages({ workId: fx.workId, catalog: fx.trustedCatalog, legacy, imgSha256: SHA, ext: 'jpg', prompts: { B1: 'p1', B2: 'p2' }, runtimeVersion: 't', spawnStage, capture: async ({ rawResponse }) => ({ completion: { body: JSON.parse(rawResponse) } }) });
  for (const s of ['WHY_SENT', 'CUE_SENT', 'NOTE_SENT', 'GUIDE_SENT', 'POSE_SENT']) { assert(seenPrompt.B2.includes(s), `B2 missing ${s}`); assert(!seenPrompt.B1.includes(s), `B1 leaked ${s}`); }
  // B1 prompt DOES name the confined image file for Read.
  assert(/Read tool on \.\/[0-9a-f]{64}\.jpg/.test(seenPrompt.B1), 'B1 prompt must name the confined image for Read');
});
t('--through-b3 mode runs B1→B2→B3 and does NOT spawn B4; default still runs B4', async () => {
  const fx = syntheticFixture();
  const mk = () => { const spawned = []; return { spawned, spawnStage: async (stage) => { spawned.push(stage); return { raw: JSON.stringify(fx.bodies[stage === 'B4' ? 'B4Delta' : stage]), transcriptSha256: sha256(stage) }; }, capture: async ({ rawResponse }) => ({ completion: { body: JSON.parse(rawResponse) } }) }; };
  const base = { workId: fx.workId, catalog: fx.trustedCatalog, legacy: { counts: { notes: 1 } }, imgSha256: SHA, ext: 'jpg', prompts: { B1: 'p', B2: 'p', B3: 'p', B4: 'p' }, runtimeVersion: 't' };
  const a = mk(); const r1 = await runWorkStages({ ...base, spawnStage: a.spawnStage, capture: a.capture, skipB4: true });
  assert(!a.spawned.includes('B4'), 'through-b3 must NOT spawn B4');
  assert.equal(r1.status.B4, 'skipped:through-b3');
  assert(a.spawned.includes('B1') && a.spawned.includes('B2') && a.spawned.includes('B3'), 'B1-B3 still run in through-b3 mode');
  const b = mk(); const r2 = await runWorkStages({ ...base, spawnStage: b.spawnStage, capture: b.capture }); // default (skipB4 defaults false)
  assert(b.spawned.includes('B4') && r2.status.B4 === 'complete', 'default mode still runs B4');
});
t('run-identity contract binds transport + validation-contract versions; each participates in runId', () => {
  assert(/readtool-confined-dir\/1/.test(libSrc), 'transport version defined');
  assert(/imageTransport: imageTransportVersion/.test(libSrc), 'contract includes the transport version');
  assert(/validationContract: validationContractVersion/.test(libSrc), 'contract includes the validation-contract version');
  assert(/b4ValidationContract: b4ValidationContractVersion/.test(libSrc), 'contract includes the separate B4 validation-contract version');
  assert(/passBCalibration\/5-b4-delta/.test(CONTROLLER_VERSION), 'controller version present');
  // VSD-023: a validation-contract-version change changes the runId (contractHash is a pure function).
  const base = { selIds: ['a', 'b'], prompts: { B1: 'h1' } };
  const h1 = contractHash({ ...base, validationContractVersion: 'passBValidation/1' });
  const h2 = contractHash({ ...base, validationContractVersion: 'passBValidation/2' });
  assert(h1 !== h2, 'changing VALIDATION_CONTRACT_VERSION must change the contract hash / runId');
  assert.equal(contractHash({ ...base, validationContractVersion: 'passBValidation/1' }), h1, 'contractHash is deterministic');
  assert(contractHash({ ...base, b4ValidationContractVersion: 'b4/1' }) !== contractHash({ ...base, b4ValidationContractVersion: 'b4/2' }), 'B4 contract version participates without changing the shared B1-B3 validation version');
  // transport version also still participates
  assert(contractHash({ ...base, imageTransportVersion: 'x/1' }) !== contractHash({ ...base, imageTransportVersion: 'x/2' }), 'transport version participates');
});

t('B4 study-guide editorial standard: incorporated, example-fact-free, per-work facts still flow', () => {
  const p = buildB4Prompt();
  // (1) the editorial standard is incorporated (selection + style + the identify-from-evidence transfer goal)
  assert(/STUDY-GUIDE EDITORIAL STANDARD/.test(p), 'B4 prompt must carry the editorial standard');
  assert(/5.7 questions|5–7|5-7/.test(p) && /visually self-evident/i.test(p) && /sourceRefs/.test(p), 'standard must cover 5-7 selection + citations-in-sourceRefs');
  assert(/date, place, maker or tradition, movement, and medium/.test(p), 'standard must state the identify-from-evidence transfer goal');
  assert(/2.4 sentences/.test(p), 'guide answers normally 2-4 sentences');
  assert(/PLAYER-COPY PURITY/.test(p) && /\bB1, B2, B3, B4\b/.test(p) && /visual verification/i.test(p), 'B4 must carry the player-copy no-pipeline-language hard rule');
  assert(/pigment or material identification from appearance/i.test(p), 'B4 must forbid appearance-only material ID without B2 technical evidence');
  assert(/VOICE EXAMPLE/.test(p) && /never as a structural template/i.test(p), 'B4 carries a voice-only example (VSD-024, owner-authorized)');
  // (2) B1/B2/B3 stay fact-free; the B4 prompt MAY carry the labeled Julius VOICE example (owner-authorized).
  const nonB4 = [buildB1Prompt(), buildB2Prompt(), buildB3Prompt()].join('\n');
  for (const fact of ['Mino', 'Fiesole', 'Medici', 'Caesar', 'IVLIVS', 'lunette', 'bole', 'Poppi', '1455']) {
    assert(!nonB4.includes(fact), `a B1/B2/B3 prompt leaks the example-specific fact "${fact}"`);
  }
  assert(/Julius Caesar/.test(p), 'the B4 voice example is present (and confined to B4)');
  // (3) B4 still receives THIS work's facts + sourceRefs through the existing validated compact input
  const fx = syntheticFixture();
  const c = compactB4Input({ b1: fx.bodies.B1, b2: fx.bodies.B2, b3: fx.bodies.B3, legacyInput: legacyContentInput({ workId: 'w', teaching: { why: 'W' }, counts: {} }) });
  assert(c.b2.factChecks.length >= 1 && (c.b2.factChecks[0].sources || []).length >= 1, 'per-work fact-checks + sources reach B4');
  assert(c.b2.guideAnswers.every(g => 'sourceRefs' in g), 'guide answers carry sourceRefs into B4');
  assert(Array.isArray(c.b1.evidence), 'per-work B1 evidence reaches B4');
});

t('B4 compact delta + deterministic hydration (VSD-022)', () => {
  const fx = syntheticFixture();
  // (1) the delta wire schema exposes NO registry keys — the model cannot emit evidence/delights/sources/catalog/coords
  const props = Object.keys(B4_DELTA.properties);
  for (const forbidden of ['evidence', 'delights', 'sources', 'catalog', 'richDescriptors']) assert(!props.includes(forbidden), `delta wire must not expose ${forbidden}`);
  assert('pinRef' in B4_DELTA.properties.hotspots.items.properties, 'B4 wire separates hotspot spatial pinRef from editorial ref');
  assert(/ref.*EDITORIAL ancestry/i.test(buildB4Prompt()) && /pinRef.*SPATIAL anchor/i.test(buildB4Prompt()), 'B4 prompt explains the two independent references');
  assert(/contentVisionB4Delta\/3/.test(buildB4Prompt()) && /Grounding is NOT authority/i.test(buildB4Prompt()), 'B4 fork requires structured grounding without granting authority');
  assert(validateAgainstWire(B4_DELTA, { ...fx.bodies.B4Delta, evidence: {} }).length > 0, 'delta wire rejects an injected registry (additionalProperties:false)');
  // (5) the fixture delta assembles into a record that passes the UNCHANGED strict validateB4
  const r = assembleAndValidateB4({ delta: fx.bodies.B4Delta, b1: fx.bodies.B1, b2: fx.bodies.B2, b3: fx.bodies.B3, legacy: { teaching: {} } });
  assert(r.ok, 'assembled fixture must pass strict validateB4: ' + (r.errors || []).join('; '));
  // (2) hydration reproduces the B1 evidence + delight registries EXACTLY (from B1, never the model)
  const collect = (obj) => { const out = []; for (const ax of ['when', 'where', 'medium', 'style', 'artist', 'format']) for (const it of (obj[ax] || [])) out.push(it.evidenceId); return out.sort(); };
  assert.deepEqual(collect(r.body.evidence), collect(fx.bodies.B1.evidence), 'assembled evidence ids == B1 evidence ids');
  assert.deepEqual(r.body.richDescriptors.visual.delights.map(d => d.delightId).sort(), fx.bodies.B1.visual.delights.map(d => d.delightId).sort(), 'assembled delights == B1 delights');
  assert.equal(r.body.structuredGrounding.version, 'passBStructuredGrounding/1', 'v3 hydration emits controller-translated structured grounding');
  assert(r.body.structuredGrounding.components.some(c => c.target === 'note:0' && c.componentId === `note:${r.body.notes[0].noteId}` && c.claimRefs.includes('c1')), 'delta target translates to stable final component id');
  assert(!JSON.stringify(r.body.structuredGrounding).includes('groundingAuthority'), 'hydrated model proposal carries no authority/state/eligibility');
  // (3) invented references are rejected before any assembly
  const badEv = JSON.parse(JSON.stringify(fx.bodies.B4Delta)); badEv.notes[0].evidenceRef = 'made_up_id';
  assert(!validateB4Delta(badEv, { b1: fx.bodies.B1, b2: fx.bodies.B2 }).ok, 'invented evidenceRef rejected');
  const badSrc = JSON.parse(JSON.stringify(fx.bodies.B4Delta)); badSrc.notes[0].sourceRefs = ['not_a_source'];
  assert(!validateB4Delta(badSrc, { b1: fx.bodies.B1, b2: fx.bodies.B2 }).ok, 'invented sourceRef rejected');
  // (4) B4 cannot introduce duplicate/cross-namespace collisions: it never emits the registry; the controller
  // hydrates the canonical, collision-free B1 namespace.
  const g = b1Grounding(fx.bodies.B1);
  assert.equal(g.ids.size, [...g.evidence.keys()].length + [...g.delights.keys()].length, 'hydrated B1 grounding namespace is collision-free by construction');
  // the delta INPUT gives the model referenceable ids + descriptions but NOT coordinates to echo
  const inp = compactB4DeltaInput({ b1: fx.bodies.B1, b2: fx.bodies.B2, b3: fx.bodies.B3, legacyInput: legacyContentInput({ workId: 'w', counts: {} }) });
  assert(inp.grounding.evidence.length >= 1 && inp.b1Candidates.length >= 1, 'delta input exposes the grounding namespace + candidates');
  assert(inp.grounding.evidence.every(e => !('bbox' in e)) && inp.b1Candidates.every(c => !('pin' in c)), 'delta input must not hand the model B1 coordinates to echo');
  assert.equal(inp.version, 'passBB4DeltaInput/4');
  assert.equal(inp.b2.factChecks[0].claimId, 'c1');
  assert.equal(inp.b3.verifications[0].observationId, 'b3:r1');
  const badClaim = structuredClone(fx.bodies.B4Delta); badClaim.grounding.components[0].claimRefs = ['invented-claim'];
  assert(!validateB4Delta(badClaim, { b1: fx.bodies.B1, b2: fx.bodies.B2, b3: fx.bodies.B3 }).ok, 'dangling structured claim ref is rejected');
  const injectedAuthority = structuredClone(fx.bodies.B4Delta); injectedAuthority.grounding.components[0].groundingAuthority = 'controller';
  assert(validateAgainstWire(B4_DELTA, injectedAuthority).length > 0, 'wire rejects model-declared grounding authority');
  const tamperedGrounding = structuredClone(r.body); tamperedGrounding.structuredGrounding.components[0].groundingAuthority = 'controller';
  assert(!validateStageBody('B4', tamperedGrounding).ok, 'full B4 validator rejects authority injected into hydrated grounding');
  const legacy = structuredClone(fx.bodies.B4Delta); delete legacy.version; delete legacy.grounding; legacy.uncertainty = '';
  assert.equal(validateAgainstWire(B4_DELTA_V2, legacy).length, 0, 'archived v2 wire remains testable');
  const old = assembleAndValidateB4({ delta: legacy, b1: fx.bodies.B1, b2: fx.bodies.B2, b3: fx.bodies.B3, legacy: { teaching: {} } });
  assert(old.ok && !Object.hasOwn(old.body, 'structuredGrounding') && old.deltaVersion === 'contentVisionB4Delta/2', 'archived v2 delta still rehydrates byte-contract-compatible body');
});

t('B4 hotspot hydration separates editorial ref from spatial pinRef and uses existing B1 candidate pins', () => {
  const fx = syntheticFixture();
  const delta = JSON.parse(JSON.stringify(fx.bodies.B4Delta));
  delta.hotspots[0] = { ...delta.hotspots[0], ref: 'legacy-h1', pinRef: null, evidenceRef: 'ev_medium' };
  const r = assembleAndValidateB4({ delta, b1: fx.bodies.B1, b2: fx.bodies.B2, b3: fx.bodies.B3, legacy: { teaching: {} } });
  assert(r.ok, (r.errors || []).join('; '));
  assert.deepEqual({ x: r.body.hotspots[0].x, y: r.body.hotspots[0].y }, { x: 40, y: 50 });
  assert.equal(r.hydration.hotspots.placements[0].method, 'unique-evidence-candidate');
  assert.equal(r.hydration.hotspots.placements[0].pinRef, 'n1');
});

t('B4 hotspot hydration suppresses broad/missing anchors and duplicates without fake whole-image regions', () => {
  const fx = syntheticFixture();
  const b1 = JSON.parse(JSON.stringify(fx.bodies.B1));
  b1.evidence.format[0].bbox = [0, 0, 1, 1];
  const delta = JSON.parse(JSON.stringify(fx.bodies.B4Delta));
  const base = delta.hotspots[0];
  delta.hotspots = [
    { ...base, ref: 'legacy-h1', pinRef: 'n1', evidenceRef: 'ev_medium' },
    { ...base, ref: 'legacy-h2', pinRef: 'n1', evidenceRef: 'ev_medium' },
    { ...base, ref: 'legacy-h3', pinRef: null, evidenceRef: 'ev_format' },
    { ...base, ref: 'legacy-h4', pinRef: null, evidenceRef: 'ev_where' },
  ];
  const r = assembleAndValidateB4({ delta, b1, b2: fx.bodies.B2, b3: fx.bodies.B3, legacy: { teaching: {} } });
  assert(r.ok, (r.errors || []).join('; '));
  assert.equal(r.body.hotspots.length, 1, 'only the genuinely localized, first unique hotspot publishes');
  assert(r.body.hotspots.every(h => h.region === null && Number.isFinite(h.x) && Number.isFinite(h.y)), 'no fake whole-image region is emitted');
  assert.deepEqual(r.hydration.hotspots.suppressed.map(x => x.reason), ['duplicate-evidence-ref', 'near-full-frame-bbox', 'missing-localized-anchor']);
  assert.equal(HOTSPOT_MAX_BBOX_AREA, 0.65);
});

t('B4 structured scope fails closed when its targeted hotspot is suppressed', () => {
  const fx = syntheticFixture();
  const b1 = structuredClone(fx.bodies.B1);
  b1.noteCandidates = [];
  b1.evidence.medium[0].bbox = null;
  const delta = structuredClone(fx.bodies.B4Delta);
  delta.hotspots[0].pinRef = null;
  delta.conflicts = [{ field: 'medium detail', left: 'A', right: 'B', resolution: '', status: 'humanReview' }];
  delta.grounding.conflicts = [{ conflictIndex: 0, componentTargets: ['hotspot:0'], claimRefs: ['c1'] }];
  const r = assembleAndValidateB4({ delta, b1, b2: fx.bodies.B2, b3: fx.bodies.B3, legacy: { teaching: {} } });
  assert(r.ok, (r.errors || []).join('; '));
  assert.equal(r.body.hotspots.length, 0, 'unlocalized hotspot is suppressed');
  assert.deepEqual(r.body.structuredGrounding.unresolvedComponentTargets, ['hotspot:0']);
  assert.equal(r.body.structuredGrounding.conflicts[0].workScope, true, 'unresolved target widens the conflict to work scope');
  assert.deepEqual(r.body.structuredGrounding.conflicts[0].componentRefs, []);
});

t('VSD-029 keeps legacy points as candidates and routes spatial suppression without deleting content', () => {
  const fx = syntheticFixture();
  const b1 = JSON.parse(JSON.stringify(fx.bodies.B1));
  b1.evidence.format[0].bbox = [0, 0, 1, 1];
  const delta = JSON.parse(JSON.stringify(fx.bodies.B4Delta));
  const base = delta.hotspots[0];
  delta.hotspots = [
    { ...base, action: 'keep', ref: 'legacy-h1', pinRef: 'n1', evidenceRef: 'ev_medium' },
    { ...base, action: 'revise', ref: 'legacy-h2', pinRef: null, evidenceRef: 'ev_format' },
    { ...base, action: 'revise', ref: 'legacy-h3', pinRef: 'n1', evidenceRef: 'ev_medium' },
  ];
  const legacy = {
    teaching: { notes: [
      { head: 'Old material point', body: 'Old body.', x: 41, y: 49 },
      { head: 'Overall format', body: 'Broad body.' },
      { head: 'Duplicate material', body: 'Duplicate body.' },
    ] },
    hotspots: [{ n: 1, x: 41, y: 49 }, { n: 2, x: 50, y: 50 }, { n: 3, x: 42, y: 50 }],
  };
  const assembled = assembleAndValidateB4({ delta, b1, b2: fx.bodies.B2, b3: fx.bodies.B3, legacy });
  assert(assembled.ok, (assembled.errors || []).join('; '));
  const rows = spatialRowsForWork({ workId: 'fixture-synthetic-1', imageSha256: SHA, legacyImageSha256: SHA, delta, body: assembled.body, hydration: assembled.hydration, legacy });
  assert.equal(rows.length, 3);
  assert.deepEqual(legacyHotspotCandidate(legacy, 'legacy-h1').point, { x: 41, y: 49 });
  assert.equal(legacyHotspotCandidate(legacy, 'legacy-h1').head, 'Old material point', 'hotspot n joins the associated legacy note');
  assert.deepEqual(rows.map(row => [row.state, row.automaticRoute.presentation, row.contentDisposition]), [
    ['published', 'pin', 'retain'],
    ['suppressed', 'note', 'retain'],
    ['suppressed', 'merge', 'retain'],
  ]);
  assert.equal(rows[0].automaticRoute.source, 'legacy', 'an unchanged feature keeps the old spatial judgment');
  const changedImageRows = spatialRowsForWork({ workId: 'fixture-synthetic-1', imageSha256: SHA, legacyImageSha256: 'b'.repeat(64), delta, body: assembled.body, hydration: assembled.hydration, legacy });
  assert.equal(changedImageRows[0].legacyCoordinateEligible, false);
  assert.notEqual(changedImageRows[0].automaticRoute.source, 'legacy', 'an old coordinate cannot cross an image change');
});

t('legacy spatial candidates require an explicit historical-image receipt, never the current B0 SHA', () => {
  assert.equal(legacyImageSha256FromB0({ image: { imgSha256: SHA } }), null, 'the current image is not proof of the historical image');
  assert.equal(legacyImageSha256FromB0({ legacyImageReceipt: { version: 'passBLegacyImageReceipt/1', basis: 'captured-at-generation', imgSha256: 'bad' } }), null);
  assert.equal(legacyImageSha256FromB0({ legacyImageReceipt: { version: 'passBLegacyImageReceipt/1', basis: 'unverified-url-inference', imgSha256: SHA } }), null);
  assert.equal(legacyImageSha256FromB0({ legacyImageReceipt: { version: 'passBLegacyImageReceipt/1', basis: 'captured-at-generation', imgSha256: SHA } }), SHA);
  assert.equal(legacyImageSha256FromB0({ legacyImageReceipt: { version: 'passBLegacyImageReceipt/1', basis: 'verified-immutable-artifact', imgSha256: SHA } }), SHA);
  for (const [name, source] of [
    ['review packet', fullPacketSrc],
    ['spatial calibration', spatialCalibrationSrc],
    ['localization canary', spatialCanarySrc],
    ['confirmation canary', confirmationCanarySrc],
    ['resolution packet', spatialResolutionPacketSrc],
  ]) {
    assert(!source.includes('legacyImageSha256: b0.image'), `${name} must not fabricate historical-image equality from the current B0 image`);
    assert(source.includes('legacyImageSha256FromB0'), `${name} must use the fail-closed provenance reader`);
  }
});

t('VSD-029 localization input is spatial-only, excludes human answers, and validates scope/point semantics', () => {
  const rows = [{
    deltaIndex: 2, state: 'published', target: 'Small inscription at lower right', groundingTarget: 'small mark',
    candidates: [{ candidateId: 'legacy', source: 'legacy', point: { x: 80, y: 90 } }, { candidateId: 'current', source: 'b1', point: { x: 60, y: 60 } }],
    automaticRoute: { presentation: 'localize', reason: 'candidate disagreement' },
  }];
  const input = buildLocalizationInput({ workId: 'w1', imageSha256: SHA, imageExt: 'jpg', rows, mode: 'exceptions' });
  assert.equal(input.targets.length, 1);
  const longGrounding = buildLocalizationInput({ workId: 'w1', imageSha256: SHA, imageExt: 'jpg', rows: [{ ...rows[0], groundingTarget: 'x'.repeat(161) }], mode: 'exceptions' });
  assert(!('groundingTarget' in longGrounding.targets[0]), 'grounding/explanatory prose never enters the spatial prompt');
  assert(!JSON.stringify(input).includes('owner') && !JSON.stringify(input).includes('review'), 'owner labels never enter localization input');
  const prompt = buildLocalizationPrompt(input, `${SHA}.jpg`);
  assert(prompt.includes('spatial-localization') && prompt.includes('notFound') && prompt.includes('only when EVERY supplied candidate is invalid') && !prompt.includes('historical explanation'));
  const good = { version: LOCALIZATION_RESULT_VERSION, decisions: [{
    requestId: 'sp-2', scope: 'representative',
    candidateAssessments: [
      { candidateId: 'legacy', verdict: 'valid', note: 'It lands on the mark.' },
      { candidateId: 'current', verdict: 'invalid', note: 'It misses the mark.' },
    ],
    suggestedPoint: null, confidence: 0.9, note: 'The prior point is an honest example.',
  }], uncertainty: '' };
  assert(validateLocalizationResult(input, good).ok);
  assert.deepEqual(resolveLocalization(rows[0], good.decisions[0]), { presentation: 'pin', point: { x: 80, y: 90 }, candidateId: 'legacy', status: 'auto', trustTier: 'validated-existing-candidate', reason: 'validated-candidate-representative' }, 'a validated candidate preserves its exact stored coordinate');
  const bothValid = JSON.parse(JSON.stringify(good)); bothValid.decisions[0].candidateAssessments[1].verdict = 'valid';
  assert.deepEqual(resolveLocalization(rows[0], bothValid.decisions[0]), { presentation: 'pin', point: { x: 60, y: 60 }, candidateId: 'current', status: 'auto', trustTier: 'validated-existing-candidate', reason: 'validated-candidate-representative' }, 'when both are valid, the current coordinate wins only as a no-churn tie-breaker');

  const inventedDespiteValid = JSON.parse(JSON.stringify(good));
  inventedDespiteValid.decisions[0].suggestedPoint = { x: 79, y: 91 };
  assert(!validateLocalizationResult(input, inventedDespiteValid).ok, 'a new point is forbidden while any existing candidate is valid');

  const alternative = JSON.parse(JSON.stringify(good));
  alternative.decisions[0].candidateAssessments[0].verdict = 'invalid';
  alternative.decisions[0].suggestedPoint = { x: 79, y: 91 };
  assert(validateLocalizationResult(input, alternative).ok, 'a new point is allowed only after every candidate is rejected');
  assert.deepEqual(resolveLocalization(rows[0], alternative.decisions[0]), { presentation: 'hold', point: null, proposedPoint: { x: 79, y: 91 }, candidateId: null, status: 'confirmation-required', trustTier: 'unconfirmed-new-point', reason: 'new-point-needs-confirmation-representative' });

  const uncertain = JSON.parse(JSON.stringify(alternative)); uncertain.decisions[0].candidateAssessments[0].verdict = 'uncertain';
  assert(validateLocalizationResult(input, uncertain).ok, 'a syntactically valid fallback may accompany uncertainty without failing the whole work');
  assert.deepEqual(resolveLocalization(rows[0], uncertain.decisions[0], { minimumConfidence: 0.75 }), { presentation: 'hold', point: null, status: 'human-review', trustTier: 'review-required', reason: 'uncertain-existing-candidate' }, 'the controller never applies a fallback while an existing candidate remains uncertain');

  const distributed = JSON.parse(JSON.stringify(alternative));
  distributed.decisions[0].scope = 'distributed'; distributed.decisions[0].suggestedPoint = null;
  assert(validateLocalizationResult(input, distributed).ok);
  assert.deepEqual(resolveLocalization(rows[0], distributed.decisions[0]), { presentation: 'note', point: null, status: 'auto', trustTier: 'validated-note-scope', reason: 'spatial-scope-distributed' });

  const notFound = JSON.parse(JSON.stringify(distributed)); notFound.decisions[0].scope = 'notFound';
  assert(validateLocalizationResult(input, notFound).ok);
  assert.deepEqual(resolveLocalization(rows[0], notFound.decisions[0]), { presentation: 'hold', point: null, status: 'claim-review', trustTier: 'review-required', reason: 'visual-target-not-found' });

  const missingAssessment = JSON.parse(JSON.stringify(good)); missingAssessment.decisions[0].candidateAssessments.pop();
  assert(!validateLocalizationResult(input, missingAssessment).ok, 'every candidate must receive an independent assessment');
  assert(spatialCanarySrc.includes("const result = response?.ok ? response.result : null"), 'failed localizer output is excluded from owner scoring');
});

t('VSD-031/032 independently confirms new points and never exposes the first point to the second checker', () => {
  const rows = [{
    deltaIndex: 2, state: 'published', target: 'Small inscription at lower right',
    candidates: [{ candidateId: 'legacy', source: 'legacy', point: { x: 80, y: 90 } }, { candidateId: 'current', source: 'b1', point: { x: 60, y: 60 } }],
    automaticRoute: { presentation: 'localize', reason: 'candidate disagreement' },
  }];
  const input = buildLocalizationInput({ workId: 'w1', imageSha256: SHA, imageExt: 'jpg', rows, mode: 'exceptions' });
  const primary = { version: LOCALIZATION_RESULT_VERSION, decisions: [{
    requestId: 'sp-2', scope: 'point',
    candidateAssessments: [
      { candidateId: 'legacy', verdict: 'invalid', note: 'Misses.' },
      { candidateId: 'current', verdict: 'invalid', note: 'Misses.' },
    ],
    suggestedPoint: { x: 79, y: 91 }, confidence: 0.9, note: 'Visible mark.',
  }], uncertainty: '' };
  const confirmationInput = buildConfirmationInput({ localizationInput: input, localizationResult: primary });
  assert.deepEqual(confirmationInput.targets, [{ requestId: 'sp-2', deltaIndex: 2, visualTarget: 'Small inscription at lower right' }]);
  const serialized = JSON.stringify(confirmationInput);
  for (const forbidden of ['candidateId', 'suggestedPoint', 'firstPoint', 'owner', 'review', '79', '91']) {
    assert(!serialized.includes(forbidden), `confirmation input must exclude ${forbidden}`);
  }
  const prompt = buildConfirmationPrompt(confirmationInput, `${SHA}.jpg`);
  assert(prompt.includes('independent second spatial checker') && prompt.includes('not been given any earlier candidate or suggested coordinates'));
  assert.equal(CONFIRMATION_WIRE_SCHEMA.properties.version.enum[0], CONFIRMATION_RESULT_VERSION);
  assert.equal(NEW_POINT_CONFIRMATION_DISTANCE, 5);

  const agreed = { version: CONFIRMATION_RESULT_VERSION, decisions: [{ requestId: 'sp-2', scope: 'point', point: { x: 81, y: 89 }, confidence: 0.9, note: 'The mark is here.' }], uncertainty: '' };
  assert(validateConfirmationResult(confirmationInput, agreed).ok);
  assert.deepEqual(resolveConfirmedLocalization(rows[0], primary.decisions[0], agreed.decisions[0]), {
    presentation: 'pin', point: { x: 79, y: 91 }, proposedPoint: { x: 79, y: 91 },
    confirmationPoint: { x: 81, y: 89 }, confirmationDistance: Math.sqrt(8), candidateId: null,
    status: 'auto', trustTier: 'blind-confirmed-new-point', reason: 'blind-confirmed-new-point-point',
  });

  const far = JSON.parse(JSON.stringify(agreed)); far.decisions[0].point = { x: 20, y: 20 };
  const farResolution = resolveConfirmedLocalization(rows[0], primary.decisions[0], far.decisions[0]);
  assert.equal(farResolution.presentation, 'hold'); assert.equal(farResolution.reason, 'blind-confirmation-point-disagreement');

  const representativePrimary = JSON.parse(JSON.stringify(primary.decisions[0])); representativePrimary.scope = 'representative';
  const representativeFar = JSON.parse(JSON.stringify(far.decisions[0])); representativeFar.scope = 'representative';
  assert.deepEqual(resolveConfirmedLocalization(rows[0], representativePrimary, representativeFar), {
    presentation: 'note', point: null, confirmationDistance: Math.hypot(59, 71),
    status: 'auto', trustTier: 'validated-note-scope', reason: 'independent-representatives-diverge',
  }, 'two honest but distant representative examples retain the observation as a note');

  const distributedConfirmation = JSON.parse(JSON.stringify(agreed.decisions[0]));
  distributedConfirmation.scope = 'distributed'; distributedConfirmation.point = null;
  assert.deepEqual(resolveConfirmedLocalization(rows[0], primary.decisions[0], distributedConfirmation), {
    presentation: 'note', point: null, status: 'auto', trustTier: 'validated-note-scope', reason: 'confirmation-scope-distributed',
  }, 'a high-confidence second look can safely downgrade a compound target to an unpinned note');

  const scopeMismatch = JSON.parse(JSON.stringify(agreed)); scopeMismatch.decisions[0].scope = 'representative';
  assert.equal(resolveConfirmedLocalization(rows[0], primary.decisions[0], scopeMismatch.decisions[0]).reason, 'blind-confirmation-scope-disagreement');

  const notFound = JSON.parse(JSON.stringify(agreed)); notFound.decisions[0].scope = 'notFound'; notFound.decisions[0].point = null;
  assert(validateConfirmationResult(confirmationInput, notFound).ok);
  assert.equal(resolveConfirmedLocalization(rows[0], primary.decisions[0], notFound.decisions[0]).status, 'claim-review');

  const malformed = JSON.parse(JSON.stringify(agreed)); malformed.decisions[0].point = null;
  assert(!validateConfirmationResult(confirmationInput, malformed).ok, 'point scope requires a point');
  assert(confirmationCanarySrc.includes('const review = JSON.parse(readFileSync(resolve(reviewPath)') && confirmationCanarySrc.indexOf('const review = JSON.parse(readFileSync(resolve(reviewPath)') > confirmationCanarySrc.indexOf('for (const work of selected) {\n    const response = await callConfirmer(work);'), 'owner review is opened only after every second-pass call');
  assert(confirmationCanarySrc.includes("transcript.init?.apiKeySource !== 'none'") && confirmationCanarySrc.includes('validateLocalizationResult(input, response.result)'), 'primary evidence and subscription provenance are re-verified before confirmation');
});

t('VSD-032 resolves safe spatial evidence offline and renders only held exceptions', () => {
  for (const required of [
    'resolveConfirmedLocalization(row, primaryDecision, confirmationDecision)',
    "target.resolution.presentation === 'hold'",
    "transcript.init?.apiKeySource !== 'none'",
    'verifyB1ImageRead(transcript',
    'validateLocalizationResult(input, response.result)',
    'validateConfirmationResult(input, response.result)',
    'primaryManifestSha256',
    'confirmationManifestSha256',
    'compoundSpatialSignal',
    'Keep as unpinned note',
    'Split or rewrite',
    'Discard this idea',
    'Place manually',
    'getBoundingClientRect',
    'localStorage',
    'Copy review JSON',
    'Download review JSON',
    'position:sticky',
    '100dvh',
  ]) assert(spatialResolutionPacketSrc.includes(required), `spatial exception packet must contain ${required}`);
  assert(!/from ['"].*pass-b-approval/.test(spatialResolutionPacketSrc), 'resolver must not reach approval/merge code');
  assert(!/child_process|execFile|spawn\(/.test(spatialResolutionPacketSrc), 'offline resolver must have no model/process execution path');
  assert(spatialResolutionPacketSrc.indexOf("filter(target => target.resolution.presentation === 'hold')") < spatialResolutionPacketSrc.indexOf('const workHtml = exceptionWorks.map'), 'packet data is exception-filtered before rendering');
});

t('VSD-029 scope-aware score summaries use interpolated quantiles and keep representative distance diagnostic', () => {
  assert.equal(quantile([0, 7, 12, 20], 0.5), 9.5);
  assert.equal(quantile([0, 10, 20], 0.9), 18);
  assert.deepEqual(summarizePointDistances([0, 2, 7, null, 12]), {
    comparable: 4, within3: 2, within5: 2, within10: 3, median: 4.5, p90: 10.5,
  });
});

t('VSD-029 owner-review learning treats blanks as abstentions and v1 drops as spatial-only', () => {
  const workRows = [{ workId: 'w1', rows: [
    { deltaIndex: 0, state: 'published', currentPoint: { x: 50, y: 50 }, legacyCandidate: { point: { x: 20, y: 20 } }, placementMethod: 'unique-evidence-candidate', evidenceAxis: 'style' },
    { deltaIndex: 1, state: 'published', currentPoint: { x: 60, y: 60 }, legacyCandidate: null, placementMethod: 'localized-bbox-center', evidenceAxis: 'format' },
    { deltaIndex: 2, state: 'suppressed', currentPoint: null, legacyCandidate: null, placementMethod: null, evidenceAxis: 'medium' },
  ] }];
  const review = { version: 'passBEditorialReview/1', runId: 'r1', works: [{ workId: 'w1', kind: 'completed', hotspots: [
    { deltaIndex: 0, review: { decision: 'move', x: 21, y: 19 } },
    { deltaIndex: 1, review: null },
    { deltaIndex: 2, review: { decision: 'drop' } },
  ] }] };
  const report = summarizeOwnerSpatialReview({ workRows, review });
  assert.equal(report.version, SPATIAL_CALIBRATION_VERSION);
  assert.deepEqual(report.totals.choices, { keep: 0, move: 1, note: 0, auto: 0, discard: 0, drop: 1, abstain: 1 });
  assert.equal(report.movement.closer.legacy, 1);
  assert.equal(report.movement.comparableLegacyPointLabels, 1);
  assert.deepEqual(report.movement.pointLabelCloser, { legacy: 1, current: 0, tie: 0 });
  assert.equal(report.rows[1].owner.decision, 'abstain');
  assert.deepEqual({ spatial: report.rows[2].owner.spatialSignal, content: report.rows[2].owner.contentSignal }, { spatial: 'unpin', content: 'unknown' });
});

t('editorial packet identifies every hotspot and preserves enough information for click-to-place review', () => {
  const fx = syntheticFixture();
  const b1 = JSON.parse(JSON.stringify(fx.bodies.B1));
  b1.evidence.format[0].bbox = [0, 0, 1, 1];
  const delta = JSON.parse(JSON.stringify(fx.bodies.B4Delta));
  const base = delta.hotspots[0];
  delta.hotspots = [
    { ...base, ref: 'legacy-h1', pinRef: 'n1', evidenceRef: 'ev_medium' },
    { ...base, ref: 'legacy-h2', pinRef: null, evidenceRef: 'ev_format' },
  ];
  const assembled = assembleAndValidateB4({ delta, b1, b2: fx.bodies.B2, b3: fx.bodies.B3, legacy: { teaching: {} } });
  assert(assembled.ok, (assembled.errors || []).join('; '));
  const rows = hotspotReviewRows({ delta, body: assembled.body, hydration: assembled.hydration });
  assert.deepEqual(rows.map(row => [row.label, row.state, row.evidenceRef]), [['P1', 'published', 'ev_medium'], ['S1', 'suppressed', 'ev_format']]);
  assert(rows.every(row => row.title && row.description && row.statusText), 'each marker must explain what it describes and why it is/is not placed');
  assert.equal(EDITORIAL_REVIEW_VERSION, 'passBEditorialReview/2');
  for (const required of ['data-work-decision', 'data-work-note', 'data-hotspot-action', 'data-hotspot-action="note"', 'data-hotspot-action="discard"', 'data-hotspot-action="abstain"', 'Keep as note', 'No opinion', 'keep this observation as an unpinned note', "{decision:'abstain',explicit:false}", 'getBoundingClientRect', 'localStorage', 'Download review JSON', 'Copy review JSON', '<details class="workdetails', 'position:sticky', '100dvh', 'Collapse all']) {
    assert(fullPacketSrc.includes(required), `full packet must contain ${required}`);
  }
});

t('B4 delta rejects an invented/mismatched explicit pinRef', () => {
  const fx = syntheticFixture(); const delta = JSON.parse(JSON.stringify(fx.bodies.B4Delta));
  delta.hotspots[0].pinRef = 'made-up';
  assert(!validateB4Delta(delta, { b1: fx.bodies.B1, b2: fx.bodies.B2 }).ok);
  delta.hotspots[0].pinRef = 'n1'; delta.hotspots[0].evidenceRef = 'ev_when';
  assert(!validateB4Delta(delta, { b1: fx.bodies.B1, b2: fx.bodies.B2 }).ok, 'pinRef must ground the same evidenceRef');
});

t('B4 lineage filters remove actions before joining and distinguishes verbatim/reworked/removed/new', () => {
  const delta = { notes: [], hotspots: [], guide: [
    { action: 'remove', ref: 'legacy-g1' },
    { action: 'keep', ref: 'legacy-g2' },
    { action: 'replace', ref: 'legacy-g3' },
    { action: 'add', ref: null },
  ] };
  const surviving = b4Lineage(delta).guide.filter(x => x.survives);
  assert.deepEqual(surviving.map(x => [x.deltaIndex, x.action, x.ref]), [[1, 'keep', 'legacy-g2'], [2, 'replace', 'legacy-g3'], [3, 'add', null]]);
  assert.deepEqual(guideLineageMetrics(delta, 3), { legacyTotal: 3, verbatim: 1, reworked: 1, legacyDerived: 2, removed: 1, removedExplicit: 1, removedImplicit: 0, added: 1, invalidLegacyRefs: 0, duplicateLegacyRefs: 0 });
  const incomplete = { notes: [], hotspots: [], guide: [
    { action: 'revise', ref: 'legacy-g2' },
    { action: 'replace', ref: 'legacy-n1' },
    { action: 'add', ref: null },
  ] };
  assert.deepEqual(guideLineageMetrics(incomplete, 4), { legacyTotal: 4, verbatim: 0, reworked: 1, legacyDerived: 1, removed: 3, removedExplicit: 0, removedImplicit: 3, added: 2, invalidLegacyRefs: 1, duplicateLegacyRefs: 0 });
});

t('B2 v2 prompt: teaching audience, conditional research, research+B3 budget, source priority', () => {
  const p = buildB2Prompt();
  assert(/SAT reading\/writing|excel on SAT/i.test(p), 'B2 must state the SAT-caliber non-specialist reader');
  assert(/Prioritize WHY visible details matter|connections to artistic traditions/i.test(p), 'B2 must aim at teaching-relevant why-it-matters');
  assert(/only where B1 questions or consequential legacy claims/i.test(p), 'B2 research must be conditional, not reflexive');
  assert(/RESEARCH BUDGET/.test(p) && /1.2 focused WebSearch/i.test(p) && /2.4 WebFetch/i.test(p) && /at most 2 targeted B3/i.test(p), 'B2 must carry the research + B3 budget');
  assert(/holding museum\/collection record/i.test(p) && /Wikipedia may orient/i.test(p) && /not be the sole authority/i.test(p), 'B2 must state the source-priority ladder');
});
t('B2 v2 prompt: legacy untrusted, atomic claims, calibrated verdicts, attribution-vs-prototype (Clouet)', () => {
  const p = buildB2Prompt();
  assert(/UNTRUSTED editorial material/i.test(p), 'B2 must treat legacy content as untrusted');
  assert(/Split a compound legacy statement into atomic/i.test(p), 'B2 must split compound statements into atomic claims');
  assert(/supported \| refuted \| qualified/i.test(p) && /"refuted" ONLY when/i.test(p), 'B2 must offer qualified and reserve refuted for a false central proposition');
  assert(/Distinguish attribution from prototype/i.test(p), 'B2 must distinguish attribution from prototype/lineage (Clouet lesson)');
  assert(/refutation requires authoritative museum\/scholarly support/i.test(p), 'B2 high-confidence refutations need authoritative support');
});
t('B3 request budget: at most two targeted second-look requests; extras dropped and reported', () => {
  const many = { targetedVerificationRequests: [1, 2, 3, 4, 5].map(i => ({ requestId: `r${i}`, claimId: `c${i}`, whatToLocate: `x${i}` })) };
  const plan = b3Plan(many);
  assert.equal(MAX_B3_REQUESTS, 2);
  assert.equal(plan.requests.length, 2, 'only the two most important requests run');
  assert.equal(plan.requestIds.length, 2);
  assert.equal(plan.dropped, 3, 'the caller is told how many were dropped');
  assert(plan.run === true);
});
t('B4 compact input carries a qualified B2 verdict; B2 command stays web-only / no-image', () => {
  const fx = syntheticFixture();
  const b2 = JSON.parse(JSON.stringify(fx.bodies.B2)); b2.factChecks[0].verdict = 'qualified';
  const inp = compactB4DeltaInput({ b1: fx.bodies.B1, b2, b3: null, legacyInput: legacyContentInput({ workId: 'w', counts: {} }) });
  assert(inp.b2.factChecks.some(f => f.verdict === 'qualified'), 'a qualified verdict flows through to the B4 delta input');
  const cmd = buildStageCommand({ stage: 'B2', promptText: 'x' });
  const after = (a, f) => { const i = a.indexOf(f); return i < 0 ? null : a[i + 1]; };
  assert.equal(after(cmd.argv, '--tools'), 'WebSearch WebFetch', 'B2 uses only web tools');
  assert(!cmd.imageAttached, 'B2 remains no-image (integrity boundary unchanged)');
});

t('verifyB2WebEvents counts only genuinely-retrieved fetches (a 4xx/redirect envelope is not a retrieval)', () => {
  const mk = (blocks) => JSON.stringify({ message: { content: blocks } });
  const tu = (id, name, input = {}) => ({ type: 'tool_use', id, name, input });
  const tr = (id, txt, is_error = false) => ({ type: 'tool_result', tool_use_id: id, is_error, content: [{ type: 'text', text: txt }] });
  const good = 'Web search results for query: foo. '.padEnd(400, '.');
  const page = '# Retrieved Page\n' + 'substantive retrieved body content. '.repeat(20);
  const ok = [mk([tu('s1', 'WebSearch')]), mk([tr('s1', good)]), mk([tu('f1', 'WebFetch', { url: 'https://a.org' })]),
    mk([tr('f1', 'The server returned HTTP 403 Forbidden. The response body was not retrieved.')]),
    mk([tu('f2', 'WebFetch', { url: 'https://b.org' })]), mk([tr('f2', page)])].join('\n');
  const w = verifyB2WebEvents(parseStreamTranscript(ok));
  assert.equal(w.searches, 1); assert.equal(w.fetchAttempts, 2); assert.equal(w.fetches, 1); assert.equal(w.fetchFailed, 1); assert(w.ok, 'one real search + one real fetch passes');
  const onlyFailed = [mk([tu('s1', 'WebSearch')]), mk([tr('s1', good)]), mk([tu('f1', 'WebFetch')]), mk([tr('f1', 'The server returned HTTP 429. response body was not retrieved.')])].join('\n');
  const w2 = verifyB2WebEvents(parseStreamTranscript(onlyFailed));
  assert.equal(w2.fetches, 0); assert(!w2.ok, 'a search with only a failed fetch must NOT pass');
  assert.equal(webFetchRetrieved({ isError: false, textLen: 500, head: '# real page content' }), true);
  assert.equal(webFetchRetrieved({ isError: false, textLen: 215, head: 'The server returned HTTP 403 Forbidden. The response body was not retrieved.' }), false);
  assert.equal(webFetchRetrieved({ isError: true, textLen: 999, head: 'x' }), false);
  assert.equal(webFetchRetrieved({ isError: false, textLen: 10, head: 'tiny' }), false, 'a substanceless retrieval does not count');
  // A fetch that returns a non-error envelope but no actual page (the "I don't see any web page content
  // provided in your message" case) is NOT a retrieval, even though it is long and has no HTTP marker.
  assert.equal(webFetchRetrieved({ isError: false, textLen: 549, head: "I don't see any web page content provided in your message. You included a header that says Khan Academy and a list of topics." }), false, 'empty-page narration is not a retrieval');
});
t('runWorkStages surfaces b3Dropped (no silent cap) when B2 raises more than MAX_B3_REQUESTS requests', async () => {
  const fx = syntheticFixture();
  const b2many = JSON.parse(JSON.stringify(fx.bodies.B2));
  b2many.targetedVerificationRequests = [1, 2, 3, 4, 5].map((i) => ({ requestId: `r${i}`, claimId: 'c1', whatToLocate: `locate ${i}` }));
  const bodies = { B1: fx.bodies.B1, B2: b2many, B3: fx.bodies.B3 };
  const r = await runWorkStages({ workId: fx.workId, catalog: fx.trustedCatalog, legacy: { counts: { notes: 1 } }, imgSha256: SHA, ext: 'jpg', prompts: { B1: 'p', B2: 'p', B3: 'p', B4: 'p' }, runtimeVersion: 't', skipB4: true,
    spawnStage: async (stage) => ({ raw: JSON.stringify(bodies[stage]), transcriptSha256: sha256(stage) }),
    capture: async ({ rawResponse }) => ({ completion: { body: JSON.parse(rawResponse) } }) });
  assert.equal(r.status.b3Dropped, 3, 'controller must surface the 3 dropped B3 requests');
});

t('B4 delta guide answer cap shared at 700 (VSD-025)', () => {
  const fx = syntheticFixture();
  const ctx = { b1: fx.bodies.B1, b2: fx.bodies.B2 };
  const ok690 = JSON.parse(JSON.stringify(fx.bodies.B4Delta)); ok690.guide[0] = { ...ok690.guide[0], action: 'add', ref: null, kind: 'context', evidenceRef: null, a: 'x'.repeat(690) };
  assert(validateB4Delta(ok690, ctx).ok, 'delta guide answer up to 700 passes');
  const bad750 = JSON.parse(JSON.stringify(fx.bodies.B4Delta)); bad750.guide[0] = { ...bad750.guide[0], action: 'add', ref: null, kind: 'context', evidenceRef: null, a: 'x'.repeat(750) };
  assert(!validateB4Delta(bad750, ctx).ok, 'delta guide answer over 700 is rejected');
});

t('B4 player-copy caps restored (why=500, note body=600) and never accept-then-truncate (VSD-023)', () => {
  const fx = syntheticFixture();
  const ctx = { b1: fx.bodies.B1, b2: fx.bodies.B2 };
  const dWhyOk = JSON.parse(JSON.stringify(fx.bodies.B4Delta)); dWhyOk.why = { action: 'replace', text: 'w'.repeat(480) };
  assert(validateB4Delta(dWhyOk, ctx).ok, 'delta why up to 500 passes');
  const dWhyBad = JSON.parse(JSON.stringify(fx.bodies.B4Delta)); dWhyBad.why = { action: 'replace', text: 'w'.repeat(650) };
  assert(!validateB4Delta(dWhyBad, ctx).ok, 'delta why over 500 is rejected');
  // A 650-char note is REJECTED by the delta validator (not silently sliced to 600).
  const dNote = JSON.parse(JSON.stringify(fx.bodies.B4Delta));
  dNote.notes = [{ ref: null, action: 'add', head: 'A head', body: 'b'.repeat(650), evidenceRef: dNote.notes?.[0]?.evidenceRef ?? null, sourceRefs: [] }];
  assert(!validateB4Delta(dNote, ctx).ok, 'delta note body over 600 is rejected');
  // No accept-then-truncate in assembly: an over-cap note reassembled directly must NOT come back sliced to 600.
  const asm = assembleAndValidateB4({ delta: { ...JSON.parse(JSON.stringify(fx.bodies.B4Delta)), notes: [{ ref: null, action: 'add', head: 'H', body: 'z'.repeat(650), evidenceRef: fx.bodies.B4Delta.notes?.[0]?.evidenceRef ?? null, sourceRefs: [] }] }, b1: fx.bodies.B1, b2: fx.bodies.B2, b3: fx.bodies.B3, legacy: { teaching: {} } });
  assert(!asm.ok, 'assembled record with a 650-char note is rejected, not truncated');
  const longNote = (asm.body?.notes || []).find(n => (n.body || '').length === 650);
  assert(asm.body ? !!longNote || asm.body.notes.every(n => n.body.length !== 600) : true, 'note body must be preserved exactly (never sliced to 600)');
});

t('resume evidence + stale-vs-corrupt: valid load, fabricated transcript, corrupt, missing-promptHash, stale (VSD-023)', () => {
  const id = 'ev-test-work', imgSha = SHA, ext = 'jpg', imageBasename = `${imgSha}.${ext}`;
  const B1body = syntheticFixture().bodies.B1;
  const H = (x) => sha256(x); // promptHash must be 64-hex per the completion binding
  const initEv = { type: 'system', subtype: 'init', apiKeySource: 'none', claude_code_version: '2.1.259', model: 'claude-sonnet-4-6' };
  const transcript = streamJson([initEv,
    asst([toolUse('Read', { file_path: `./${imageBasename}` }, 'r1')]), usr([toolResult('r1', { image: true })]),
    resultEv({ structured_output: B1body })]);
  const tsha = sha256(transcript);
  const setup = ({ promptHash = H('p1'), tSha = tsha, corrupt = false, stripPromptHash = false } = {}) => {
    const runDir = realpathSync(mkdtempSync(join(tmpdir(), 'passb-ev-'))); // resolve /tmp->/private/tmp so path-confinement matches
    mkdirSync(join(runDir, 'attempts'), { recursive: true });
    wf(join(runDir, 'attempts', 'b1-fixture.transcript.jsonl'), transcript);
    const trusted = { workId: id, imgSha256: imgSha, promptHash, brokerPolicyVersion: 'bpv', imageTransportVersion: 'itv', transcriptSha256: tSha };
    captureStageCompletion({ runDir, stage: 'B1', rawResponse: JSON.stringify(B1body), trusted, producer: producerEvidence('B1', { runtimeVersion: 'x' }), createdAt: '2026-01-01T00:00:00Z', context: {} });
    const cp = join(runDir, 'completions', `b1-${completionKey('B1', id)}.json`);
    if (corrupt) wf(cp, '{not json');
    else if (stripPromptHash) { const c = JSON.parse(readFileSync(cp, 'utf8')); delete c.promptHash; wf(cp, `${JSON.stringify(c)}\n`); }
    return { runDir, cp };
  };
  const call = (runDir, promptHash) => loadOrArchiveCompletion({ stage: 'B1', workRunDir: runDir, id, imgSha256: imgSha, ext, promptHash, context: {}, bodies: {}, legacy: null, brokerPolicyVersion: 'bpv', imageTransportVersion: 'itv', runtimeVersion: 'x' });
  // valid current-input load returns the body; evidence (transcript-by-sha, model, apiKeySource, Read) all check
  { const { runDir } = setup({ promptHash: H('p1') }); assert.ok(call(runDir, H('p1')), 'a valid completion with real evidence loads'); }
  // a fabricated 64-hex transcript SHA has no matching transcript file -> must fail
  { const { runDir } = setup({ promptHash: H('p1'), tSha: 'f'.repeat(64) }); assert.throws(() => call(runDir, H('p1')), /evidence failed|transcript-sha-not-found/); }
  // CORRUPT completion -> throws AND is preserved (never deleted)
  { const { runDir, cp } = setup({ corrupt: true }); assert.throws(() => call(runDir, H('p1')), /unreadable/); assert.ok(existsSync(cp), 'corrupt completion preserved'); }
  // MISSING promptHash is corruption, not staleness -> throws (preserved)
  { const { runDir, cp } = setup({ stripPromptHash: true }); assert.throws(() => call(runDir, H('p1')), /no promptHash/); assert.ok(existsSync(cp), 'missing-promptHash completion preserved'); }
  // STALE (different promptHash, old artifact fully verifies) -> archived to stale/ and re-run (null)
  { const { runDir, cp } = setup({ promptHash: H('p-old') }); const res = call(runDir, H('p-new')); assert.equal(res, null, 'stale returns null (re-run)'); assert.ok(!existsSync(cp), 'stale moved out of completions'); assert.equal(rdir(join(runDir, 'stale')).length, 1, 'stale artifact archived'); }
});

const passN = { n: 0 };
(async () => {
  for (const { n, fn } of tests) { try { await fn(); passN.n++; console.log('ok -', n); } catch (e) { console.error('FAIL -', n, '\n   ', e.message); process.exitCode = 1; } }
  console.log(`\n${passN.n} checks passed`);
})();
