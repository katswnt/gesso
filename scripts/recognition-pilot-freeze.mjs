// Offline finalizer for the prospective pilot protocol freeze.
//
// It validates curator decisions plus isolated image/multilingual evidence, computes the exact cost
// report, and creates immutable-by-convention *.frozen.json artifacts. It does NOT commit,
// fetch, or call a model. The paid runner still refuses until these bytes exist in exactly one
// dedicated git commit whose subject is printed below.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PILOT_FREEZE_ID, PILOT_VERSION, PILOT_WORKS, PILOT_CALLS, PILOT_BUDGET_USD,
  VIEW_SPECS, FACETS, REQUEST_POLICY, buildCallManifest, buildModelPrompt, disclosureMask,
  opaqueSham, estimateCost, canonicalJson, sha256,
  validateWorkShape, validateCuratorChecks, curatorChecksAllTrue, applicableEligibleFacets, unresolvedBlockingIssues, normalizedWorkId,
} from './lib/recognition-pilot.mjs';
import { safeRegisteredViewPath } from './lib/recognition-pilot-runtime.mjs';
import { BROKER_POLICY_VERSION } from './lib/img-broker.mjs';

const ROOT = process.cwd();
const DIR = 'docs/research/recognition-pilot';
const RUN_DIR = join('data/incoming/recognition-pilot', PILOT_FREEZE_ID);
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const hex64 = value => /^[0-9a-f]{64}$/.test(value || '');
const fail = message => { console.error(`FREEZE BLOCKED: ${message}`); process.exit(2); };
const writeNew = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o644 });

if (!process.argv.includes('--finalize')) fail('explicit --finalize required (offline; no fetch/model call)');
for (const path of [join(RUN_DIR, 'image-evidence.json'), join(RUN_DIR, 'multilingual-fame.json')]) if (!existsSync(path)) fail(`missing isolated prerequisite ${path}`);

const draft = readJson(join(DIR, 'pilot-manifest.draft.json'));
const draftCalls = readJson(join(DIR, 'call-manifest.draft.json'));
const styles = readJson(join(DIR, 'style-taxonomy.snapshot.json'));
const images = readJson(join(RUN_DIR, 'image-evidence.json'));
const multilingual = readJson(join(RUN_DIR, 'multilingual-fame.json'));

if (draft.status !== 'DRAFT_NOT_FROZEN_NO_COLLECTION' || draft.version !== PILOT_VERSION) fail('wrong draft status/version');
if (draft.freezeCandidateId !== PILOT_FREEZE_ID) fail('freeze id drift');
if (draft.works?.length !== PILOT_WORKS || new Set(draft.works.map(w => w.id)).size !== PILOT_WORKS) fail('work count/identity');
if (new Set(draft.works.map(w => normalizedWorkId(w.id))).size !== PILOT_WORKS) fail('duplicate normalized (conceptual) work ids');
if (styles.curatorReview?.complete !== true || !styles.curatorReview.reviewer || !styles.curatorReview.reviewedAt) fail('style taxonomy curator review');
if (styles.status !== 'READY_FOR_FREEZE') fail('style taxonomy status');

// Independently validate the legacy comparison baseline (do not trust a prior gate run).
const legacy = readJson(join(DIR, 'legacy-comparison.snapshot.json'));
if (legacy.sha256 !== sha256(canonicalJson(Object.fromEntries(Object.entries(legacy).filter(([k]) => k !== 'sha256'))))) fail('legacy comparison internal hash');
if (legacy.poolCommit !== draft.selection?.poolCommit) fail('legacy comparison poolCommit drift');
{
  const draftIds = draft.works.map(w => w.id), legacyIds = Object.keys(legacy.works || {});
  const eqSet = (a, b) => a.length === b.length && new Set(a).size === b.length && a.every(x => b.includes(x));
  if (!eqSet(draftIds, legacyIds)) fail('legacy comparison raw id-set mismatch');
  if (!eqSet(draftIds.map(normalizedWorkId), legacyIds.map(normalizedWorkId))) fail('legacy comparison normalized id-set mismatch');
}
if (images.freezeId !== PILOT_FREEZE_ID || images.brokerPolicyVersion !== BROKER_POLICY_VERSION || images.items?.length !== PILOT_WORKS) fail('image evidence set/policy');
if (images.sha256 !== sha256(canonicalJson({ ...images, sha256: undefined }))) fail('image evidence hash');
if (multilingual.rows?.length !== PILOT_WORKS || new Set(multilingual.rows.map(x => x.id)).size !== PILOT_WORKS || multilingual.sha256 !== sha256(canonicalJson({ ...multilingual, sha256: undefined }))) fail('multilingual evidence');

const imageById = new Map(images.items.map(x => [x.id, x]));
const multiIds = new Set(multilingual.rows.map(x => x.id));
const works = structuredClone(draft.works);
for (const w of works) {
  const shape = validateWorkShape(w);
  if (!shape.ok) fail(`${w.id}: work shape invalid — ${shape.errors.join('; ')}`);
  const cc = validateCuratorChecks(w.curatorChecks);
  if (!cc.ok) fail(`${w.id}: curator checks malformed — ${cc.errors.join('; ')}`);
  if (!curatorChecksAllTrue(w.curatorChecks)) fail(`${w.id}: curator checks not all true`);
  const blocking = unresolvedBlockingIssues(w);
  if (blocking.length) fail(`${w.id}: unresolved blocking curation issue(s): ${blocking.map(i => i.code).join(', ')}`);
  if (w.strata.regionSource !== 'creation-place' && w.strata.regionSource !== 'culture-region-fallback') fail(`${w.id}: origin lineage unverified`);
  if (w.imageFitness?.state !== 'usable') fail(`${w.id}: image is not marked usable`);
  if (!w.source?.rights || !w.source?.license) fail(`${w.id}: source rights/license missing`);
  if (!Array.isArray(w.recognitionKey?.acceptedTitles) || !w.recognitionKey.acceptedTitles.length) fail(`${w.id}: recognition key has no accepted title`);
  if (!Number.isInteger(w.truth?.date?.lo) || !Number.isInteger(w.truth?.date?.hi) || w.truth.date.lo > w.truth.date.hi) fail(`${w.id}: invalid date truth`);
  const row = imageById.get(w.id);
  if (!row?.canonical?.ok || row.canonical.requestedUrl !== w.source.requestedUrl || !hex64(row.canonical.sha256)) fail(`${w.id}: canonical evidence mismatch`);
  if (Object.keys(row.views || {}).sort().join(',') !== VIEW_SPECS.map(v => v.id).sort().join(',')) fail(`${w.id}: incomplete view panel`);
  for (const spec of VIEW_SPECS) {
    const view = row.views[spec.id];
    if (!hex64(view?.sha256) || !Number.isInteger(view.width) || !Number.isInteger(view.height) || view.width <= 0 || view.height <= 0 || view.width > 1568 || view.height > 1568 || view.mime !== 'image/jpeg') fail(`${w.id}: invalid ${spec.id} view`);
    const path = safeRegisteredViewPath(RUN_DIR, view.sha256);
    const bytes = path ? readFileSync(path) : null;
    if (!bytes || bytes.length > 7_500_000 || sha256(bytes) !== view.sha256) fail(`${w.id}: ${spec.id} view bytes missing/drifted/too-large`);
  }
  w.source.sanitizedSha256 = row.canonical.sha256;
  w.source.canonicalViewSha256 = row.views.full.sha256;
  w.source.finalUrl = row.canonical.finalUrl;
  w.source.host = row.canonical.host;
  w.transform.views = row.views;
  if (w.studyC) {
    if (!w.alternate?.sameObjectOwnerApproved || !w.alternate?.source || !w.alternate?.license || !w.alternate?.comparability || !row.alternate?.ok || row.alternate.requestedUrl !== w.alternate.candidateUrl || !hex64(row.alternate.view?.sha256)) fail(`${w.id}: alternate evidence mismatch`);
    const altPath = safeRegisteredViewPath(RUN_DIR, row.alternate.view.sha256);
    const altBytes = altPath ? readFileSync(altPath) : null;
    if (!altBytes || altBytes.length > 7_500_000 || sha256(altBytes) !== row.alternate.view.sha256) fail(`${w.id}: alternate view bytes missing/drifted/too-large`);
    w.alternate.sanitizedSha256 = row.alternate.sourceSha256;
    w.alternate.viewSha256 = row.alternate.view.sha256;
    w.alternate.finalUrl = row.alternate.finalUrl;
    w.alternate.sourceHost = row.alternate.sourceHost;
    w.alternate.view = row.alternate.view;
  }
  if (!multiIds.has(w.id)) fail(`${w.id}: multilingual evidence missing`);
  const mask = disclosureMask(w.cue.correct, w.cue.acceptedAliasesByFacet);
  if (canonicalJson(mask) !== canonicalJson({ disclosedFacets: w.cue.disclosedFacets, eligibleFacets: w.cue.eligibleFacets })) fail(`${w.id}: cue mask drift`);
  if (w.cue.sham !== opaqueSham(w.cue.correct, w.id) || [...w.cue.disclosedFacets, ...w.cue.eligibleFacets].sort().join(',') !== [...FACETS].sort().join(',')) fail(`${w.id}: cue/sham invalid`);
  if (!applicableEligibleFacets(w).length) fail(`${w.id}: no eligible/applicable Study B primary facet`);
  delete w.draftStatus;
}
const registeredCells = {};
for (const w of works) registeredCells[`${w.strata.fameBand}:${w.strata.regionGroup}`] = (registeredCells[`${w.strata.fameBand}:${w.strata.regionGroup}`] || 0) + 1;
if (Object.keys(registeredCells).length !== 10 || Object.values(registeredCells).some(n => n !== 3 && n !== 4)) fail('verified origin changes broke the 10-cell 3–4-work quota');

const calls = buildCallManifest(works, draftCalls.seed);
if (calls.calls.length !== PILOT_CALLS || canonicalJson(calls) !== canonicalJson(draftCalls)) fail('exact call manifest changed');
const promptAssets = {
  identify: readFileSync(join(DIR, 'prompts/identify.md'), 'utf8'),
  facets: readFileSync(join(DIR, 'prompts/facets.md'), 'utf8'),
  'facets-cued': readFileSync(join(DIR, 'prompts/facets-cued.md'), 'utf8'),
  'identity-first': readFileSync(join(DIR, 'prompts/identity-first.md'), 'utf8'),
};
const schemaAssets = {
  identification: readJson(join(DIR, 'schemas/identification.schema.json')),
  facets: readJson(join(DIR, 'schemas/facets.schema.json')),
};
const byWork = new Map(works.map(w => [w.id, w]));
const promptRegistry = Object.fromEntries(calls.calls.map(call => [call.callId, buildModelPrompt(call, byWork.get(call.workId), promptAssets, schemaAssets)]));
const imageRegistry = {};
for (const w of works) {
  for (const [view, rec] of Object.entries(w.transform.views)) imageRegistry[`${w.id}:canonical:${view}`] = rec;
  if (w.studyC) imageRegistry[`${w.id}:alternate:full`] = w.alternate.view;
}
const cost = estimateCost(calls, promptRegistry, imageRegistry, REQUEST_POLICY);
if (!cost.ok || cost.authorizedUpperBoundUsd > PILOT_BUDGET_USD) fail(`cost upper bound ${cost.authorizedUpperBoundUsd} exceeds $${PILOT_BUDGET_USD}`);
const costReport = {
  version: 'recognition-cost/1', requestPolicy: REQUEST_POLICY,
  callManifestSha256: sha256(canonicalJson(calls)),
  promptHashes: Object.fromEntries(Object.entries(promptRegistry).map(([id, text]) => [id, sha256(text)])),
  ...cost,
};

const registeredCallsPath = join(DIR, 'call-manifest.frozen.json');
const registeredProtocolPath = join(DIR, 'pilot-protocol.frozen.md');
const registeredStylePath = join(DIR, 'style-taxonomy.frozen.json');
const registeredDeviationsBaselinePath = join(DIR, 'deviations-baseline.frozen.md');
const registeredMultiPath = join(DIR, 'multilingual-fame.snapshot.json');
const registeredCostPath = join(DIR, 'cost-preflight.frozen.json');
const registeredManifestPath = join(DIR, 'pilot-manifest.frozen.json');
for (const path of [registeredCallsPath, registeredProtocolPath, registeredStylePath, registeredDeviationsBaselinePath, registeredMultiPath, registeredCostPath, registeredManifestPath]) if (existsSync(path)) fail(`${path} already exists (never overwrite a freeze candidate)`);
const protocol = readFileSync(join(DIR, 'pilot-protocol-draft.md'), 'utf8').replace(
  '**STATUS: DRAFT, NOT FROZEN, NO MODEL RESPONSES COLLECTED**',
  `**STATUS: PILOT PROTOCOL FROZEN BEFORE COLLECTION — ${PILOT_FREEZE_ID}**`,
);
if (!protocol.includes('PILOT PROTOCOL FROZEN BEFORE COLLECTION') || protocol.includes('**STATUS: DRAFT,')) fail('protocol status promotion failed');
const registeredStyles = { ...styles, status: 'PILOT_PROTOCOL_FROZEN_BEFORE_COLLECTION' };
delete registeredStyles.sha256;
registeredStyles.sha256 = sha256(canonicalJson(registeredStyles));
writeNew(registeredCallsPath, calls);
writeFileSync(registeredProtocolPath, protocol, { flag: 'wx', mode: 0o644 });
writeNew(registeredStylePath, registeredStyles);
writeFileSync(registeredDeviationsBaselinePath, readFileSync(join(DIR, 'deviations.md')), { flag: 'wx', mode: 0o644 });
writeNew(registeredMultiPath, multilingual);
writeNew(registeredCostPath, costReport);

const frozenPaths = [
  'docs/research/recognition-pilot/pilot-protocol.frozen.md',
  'docs/research/recognition-pilot/pilot-manifest.frozen.json',
  'docs/research/recognition-pilot/call-manifest.frozen.json',
  'docs/research/recognition-pilot/style-taxonomy.frozen.json',
  'docs/research/recognition-pilot/multilingual-fame.snapshot.json',
  'docs/research/recognition-pilot/cost-preflight.frozen.json',
  'docs/research/recognition-pilot/legacy-comparison.snapshot.json',
  'docs/research/recognition-pilot/golden-transform.json',
  'docs/research/recognition-pilot/deviations-baseline.frozen.md',
  'docs/research/recognition-pilot/image-fitness-and-source-view-protocol.md',
  'docs/research/recognition-pilot/evidence-box-protocol.md',
  'docs/research/recognition-pilot/power-simulation-spec.md',
  'docs/research/recognition-pilot/prompts/identify.md',
  'docs/research/recognition-pilot/prompts/facets.md',
  'docs/research/recognition-pilot/prompts/facets-cued.md',
  'docs/research/recognition-pilot/prompts/identity-first.md',
  'docs/research/recognition-pilot/schemas/identification.schema.json',
  'docs/research/recognition-pilot/schemas/facets.schema.json',
  'docs/research/recognition-pilot/schemas/identity-first.schema.json',
  'scripts/lib/recognition-pilot.mjs',
  'scripts/lib/recognition-pilot-images.mjs',
  'scripts/lib/recognition-pilot-runtime.mjs',
  'scripts/lib/img-broker.mjs',
  'scripts/recognition-pilot-prepare.mjs',
  'scripts/recognition-pilot-build-images.mjs',
  'scripts/recognition-pilot-multilingual-fame.mjs',
  'scripts/recognition-pilot-preflight.mjs',
  'scripts/recognition-pilot-seal-curation.mjs',
  'scripts/recognition-pilot-freeze.mjs',
  'scripts/recognition-pilot-run.mjs',
  'scripts/recognition-pilot-seal-collection.mjs',
  'scripts/analyze-recognition-pilot.mjs',
  'tests/recognition-pilot.test.mjs',
  'scripts/check-recognition-pilot.mjs',
];
const artifactHashes = {};
for (const path of frozenPaths) if (path !== 'docs/research/recognition-pilot/pilot-manifest.frozen.json') artifactHashes[path] = sha256(readFileSync(path));
const registered = {
  ...draft,
  status: 'PILOT_PROTOCOL_FROZEN_BEFORE_COLLECTION',
  freeze: {
    id: PILOT_FREEZE_ID,
    method: 'dedicated-git-commit',
    requiredCommitSubject: `PILOT PROTOCOL FROZEN BEFORE COLLECTION: ${PILOT_FREEZE_ID}`,
    frozenPaths,
    artifactHashes,
    note: 'The commit hash is intentionally derived at execution; embedding a commit hash in its own contents is impossible.',
  },
  callManifest: { file: 'call-manifest.frozen.json', seed: calls.seed, expectedCalls: calls.counts, sha256: sha256(canonicalJson(calls)) },
  protocol: { file: 'pilot-protocol.frozen.md', sha256: sha256(protocol) },
  styleTaxonomy: { file: 'style-taxonomy.frozen.json', sha256: registeredStyles.sha256 },
  multilingualFame: { file: 'multilingual-fame.snapshot.json', sha256: multilingual.sha256 },
  costPreflight: { file: 'cost-preflight.frozen.json', sha256: sha256(canonicalJson(costReport)), authorizedUpperBoundUsd: cost.authorizedUpperBoundUsd },
  works,
};
delete registered.freezeCandidateId;
delete registered.sha256;
registered.sha256 = sha256(canonicalJson({ ...registered, sha256: undefined }));
writeNew(registeredManifestPath, registered);

console.log('READY TO COMMIT — NO MODEL CALL MADE');
console.log(`commit subject (exact): ${registered.freeze.requiredCommitSubject}`);
console.log(`freeze id: ${PILOT_FREEZE_ID}`);
console.log(`cost upper bound: $${cost.authorizedUpperBoundUsd.toFixed(6)} / $${PILOT_BUDGET_USD}`);
console.log('After the dedicated commit, the runner derives and verifies its hash before any response.');
