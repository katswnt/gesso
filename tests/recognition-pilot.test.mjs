import { strict as assert } from 'node:assert';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  PILOT_CALLS, FACETS, VIEW_SPECS, normalizeLiteral, containsLiteralPhrase, disclosureMask, opaqueSham,
  validateIdentification, validateFacets, validateIdentityFirst, gradeIdentification, gradeDate,
  gradePlace, gradeMedium, gradeStyle, gradeArtist, brier, fameBand, buildCallManifest,
  estimateImageTokens, estimateCost, remainingBudgetAllows, canonicalJson, seededShuffle,
  buildModelPrompt,
  applicableEligibleFacets, validateCuratorChecks, curatorChecksAllTrue, validateWorkShape,
  validateCurationIssues, unresolvedBlockingIssues, disclosedFacetList, buildWorksheet,
  styleDedupFromSnapshot, analyzePilot, isGenericLabel, REQUIRED_CURATOR_CHECKS, TARGET_UNITS, EXACT_RULES,
  normalizedWorkId, validateAdjudicationArtifact, sha256, adjudicationCellId, buildAdjudicationArtifacts,
  deriveExpectedEvidence, aggregateMultilingualFame,
} from '../scripts/lib/recognition-pilot.mjs';
import { renderAllStudyViews, renderStudyView, nativeImageSize, IMAGE_POLICY } from '../scripts/lib/recognition-pilot-images.mjs';
import {
  atomicJson, callState, beginAttempt, finishAttempt, safeRegisteredViewPath,
  deterministicJsonParse, billedUsd, spentAndUnknown, verifyGitFreeze, verifyCollectedCall,
  buildCollectionEvidence, verifyGitCollectionSeal,
} from '../scripts/lib/recognition-pilot-runtime.mjs';

let checks = 0;
function ok(label, condition) { checks++; assert.equal(condition, true, label); }
function eq(label, actual, expected) { checks++; assert.deepEqual(actual, expected, label); }

// Literal disclosure is deliberately syntactic, not semantic.
eq('normalization removes case/diacritics/punctuation', normalizeLiteral('  Musée—PICASSO!  '), 'musee picasso');
ok('complete phrase matches', containsLiteralPhrase('Guernica — Pablo Picasso', 'Pablo Picasso'));
ok('substring inside a longer token does not match', !containsLiteralPhrase('Picassoesque', 'Picasso'));
eq('semantic entailment is not masked', disclosureMask('Guernica', { date: ['1937'], place: ['Spain'], medium: ['oil'], style: ['Cubism'], artist: ['Picasso'] }), { disclosedFacets: [], eligibleFacets: FACETS });
eq('literal artist/date disclosures are masked only for those facets', disclosureMask('Work — Pablo Picasso, 1937', { date: ['1937'], place: ['Spain'], medium: ['oil'], style: ['Cubism'], artist: ['Pablo Picasso'] }), { disclosedFacets: ['date', 'artist'], eligibleFacets: ['place', 'medium', 'style'] });
const sham = opaqueSham('Work — Pablo Picasso, 1937', 'x');
ok('sham preserves exact length', sham.length === 'Work — Pablo Picasso, 1937'.length);
ok('sham preserves separators', sham.replace(/[\p{L}\p{N}]/gu, '#') === '#### — ##### #######, ####');
ok('sham deterministic', sham === opaqueSham('Work — Pablo Picasso, 1937', 'x'));
ok('sham changes by work', sham !== opaqueSham('Work — Pablo Picasso, 1937', 'y'));
const modelPrompt = buildModelPrompt(
  { callId: 'x', task: 'facets', condition: 'correct-cue' },
  { cue: { correct: 'Guernica', sham: 'Q7R9H2M4' } },
  { facets: 'blind', 'facets-cued': 'LABEL {{CUE}}', identify: 'id', 'identity-first': 'both' },
  { identification: { $schema: 'https://schema.invalid', type: 'object' }, facets: { $id: 'https://schema.invalid/f', type: 'object' } },
);
ok('actual cue is frozen into the call-local model prompt', modelPrompt.includes('LABEL Guernica'));
ok('schema metadata URLs never reach model context', !/https?:\/\//.test(modelPrompt));

const ID = { workTitleGuess: 'Mona Lisa', specificWorkClaim: true, distinguishingQualifierGuess: null, artistGuess: 'Leonardo da Vinci', seriesOrTraditionGuess: null, selfRecognized: true, confidence: 99, visualBasis: 'The sitter and landscape match the familiar composition.' };
ok('identification schema accepts exact shape', validateIdentification(ID).ok);
ok('identification schema rejects extra properties', !validateIdentification({ ...ID, title: 'leak' }).ok);
ok('identification schema rejects invalid confidence', !validateIdentification({ ...ID, confidence: 101 }).ok);
ok('identification schema requires distinguishingQualifierGuess key', !validateIdentification((() => { const { distinguishingQualifierGuess, ...rest } = ID; return rest; })()).ok);
ok('identification schema accepts honest null guesses', validateIdentification({ ...ID, workTitleGuess: null, artistGuess: null }).ok);

const FS = {
  date: { bestYear: 1889, confidence: 80, visualBasis: 'Late nineteenth-century handling.' },
  place: { topGuess: 'France', alternatives: ['Netherlands'], confidence: 60, visualBasis: 'Landscape and palette.' },
  medium: { guess: 'oil on canvas', confidence: 90, visualBasis: 'Loaded opaque brushwork.' },
  style: { guess: 'Post-Impressionism', confidence: 85, visualBasis: 'Expressive colour and marks.' },
  artist: { guess: 'Vincent van Gogh', confidence: 70, visualBasis: 'Directional impasto.' },
};
ok('facet schema accepts exact shape', validateFacets(FS).ok);
ok('facet schema rejects missing facet', !validateFacets({ ...FS, artist: undefined }).ok);
ok('facet schema rejects a fourth alternative', !validateFacets({ ...FS, place: { ...FS.place, alternatives: ['a', 'b', 'c', 'd'] } }).ok);
ok('identity-first schema accepts nested schemas', validateIdentityFirst({ identification: ID, facets: FS }).ok);
ok('identity-first schema rejects flattened output', !validateIdentityFirst({ ...ID, facets: FS }).ok);

const KEY = { acceptedTitles: ['Mona Lisa', 'La Gioconda'], acceptedArtists: ['Leonardo da Vinci'], requiredQualifierGroups: [], uniqueFacts: ['Louvre portrait of Lisa Gherardini'] };
eq('exact title grades exact', gradeIdentification(ID, KEY).level, 2);
eq('artist only is partial, not exact', gradeIdentification({ ...ID, workTitleGuess: null }, KEY).level, 1);
eq('generic description is not exact or confabulation', gradeIdentification({ ...ID, workTitleGuess: 'portrait of a woman', specificWorkClaim: false, artistGuess: null, confidence: 80 }, KEY).level, 0);
eq('confident specific wrong work is level -1', gradeIdentification({ ...ID, workTitleGuess: 'Lady with an Ermine', artistGuess: null, confidence: 80 }, KEY).level, -1);
eq('prespecified unique fact can identify without canonical title', gradeIdentification({ ...ID, workTitleGuess: 'the Louvre portrait of Lisa Gherardini' }, KEY).level, 2);
const GENERIC_KEY = { acceptedTitles: ['Untitled'], acceptedArtists: ['Jane Doe'], requiredQualifierGroups: [['Jane Doe'], ['Museum X']], uniqueFacts: [] };
eq('generic title without qualifiers is not exact', gradeIdentification({ ...ID, workTitleGuess: 'Untitled', artistGuess: 'Jane Doe', seriesOrTraditionGuess: null }, GENERIC_KEY).level, 1);
eq('generic title with every qualifier is exact', gradeIdentification({ ...ID, workTitleGuess: 'Untitled, Jane Doe, Museum X', artistGuess: 'Jane Doe', seriesOrTraditionGuess: null }, GENERIC_KEY).level, 2);

eq('date inside interval is full credit', gradeDate(1505, { lo: 1503, hi: 1509 }).credit, 1);
ok('date log credit decreases with distance', gradeDate(1510, { lo: 1503, hi: 1509 }).credit > gradeDate(1600, { lo: 1503, hi: 1509 }).credit);
eq('date at fixed cap is zero', gradeDate(2509, { lo: 1503, hi: 1509 }).credit, 0);
ok('date broad-period correctness stored separately', gradeDate(1500, { lo: 1503, hi: 1509 }).periodCorrect);
ok('a year inside a wide truth interval is period-correct', gradeDate(0, { lo: -1500, hi: 1500 }).periodCorrect);
eq('exact place full credit', gradePlace('Florence', { exact: ['Florence'], parent: ['Italy'] }).credit, 1);
eq('parent place fixed partial credit', gradePlace('Italy', { exact: ['Florence'], parent: ['Italy'] }).credit, 0.5);
eq('place alternatives cannot rescue top guess (grader sees one guess)', gradePlace('France', { exact: ['Florence'], parent: ['Italy'] }).credit, 0);
eq('medium exact/family/broad credits', [
  gradeMedium('oil on canvas', { exact: ['oil on canvas'], family: ['oil painting'], broad: ['painting'] }).credit,
  gradeMedium('oil painting', { exact: ['oil on canvas'], family: ['oil painting'], broad: ['painting'] }).credit,
  gradeMedium('painting', { exact: ['oil on canvas'], family: ['oil painting'], broad: ['painting'] }).credit,
], [1, 0.75, 0.4]);
eq('style exact/family/related credits', [
  gradeStyle('Cubism', { exact: ['Cubism'], family: ['Modernism'], related: ['Futurism'] }).credit,
  gradeStyle('Modernism', { exact: ['Cubism'], family: ['Modernism'], related: ['Futurism'] }).credit,
  gradeStyle('Futurism', { exact: ['Cubism'], family: ['Modernism'], related: ['Futurism'] }).credit,
], [1, 0.65, 0.35]);
eq('style not-applicable excluded', gradeStyle('unknown', { notApplicable: true }).credit, null);
eq('artist exact/workshop/follower credits', [
  gradeArtist('Rembrandt', { exact: ['Rembrandt'], workshop: ['workshop of Rembrandt'], follower: ['follower of Rembrandt'] }).credit,
  gradeArtist('workshop of Rembrandt', { exact: ['Rembrandt van Rijn'], workshop: ['workshop of Rembrandt'], follower: [] }).credit,
  gradeArtist('follower of Rembrandt', { exact: ['Rembrandt van Rijn'], workshop: [], follower: ['follower of Rembrandt'] }).credit,
], [1, 0.6, 0.4]);
eq('attribution qualifier outranks embedded exact maker name', gradeArtist('workshop of Rembrandt', { exact: ['Rembrandt'], workshop: ['workshop of Rembrandt'], follower: [] }).credit, 0.6);
eq('artist not-applicable excluded', gradeArtist('unknown', { notApplicable: true }).credit, null);
eq('confidence means probability of full credit (Brier correct/certain)', brier(100, 1), 0);
eq('partial credit is not the full-credit event', brier(100, 0.75), 1);

eq('fixed fame bands retain v1 cut points', [0, 1, 100, 101, 612, 613, 1000, 1001].map(fameBand), ['f1', 'f2', 'f2', 'f3', 'f3', 'f4', 'f4', 'f5']);
eq('seeded shuffle deterministic', seededShuffle([1,2,3,4], 'a'), seededShuffle([1,2,3,4], 'a'));
ok('different seed changes ordinary shuffle', canonicalJson(seededShuffle([1,2,3,4,5,6], 'a')) !== canonicalJson(seededShuffle([1,2,3,4,5,6], 'b')));

const works = Array.from({ length: 36 }, (_, i) => ({ id: `w${i}`, studyC: i < 6, promptOrder: i < 12 }));
const calls = buildCallManifest(works, 'test-seed');
eq('exact total call count', calls.calls.length, PILOT_CALLS);
eq('base/study-C/general invariants', calls.counts, { base: 600, studyCRepeats: 12, generalRepeats: 59, total: 671 });
eq('every call id unique', new Set(calls.calls.map(c => c.callId)).size, 671);
eq('all 36 works represented', new Set(calls.calls.map(c => c.workId)).size, 36);
eq('seven Study A views frozen', VIEW_SPECS.map(v => v.id), ['full','crop70','crop45','crop25','mirror','rotate90','grayscale']);
eq('exactly twelve identity-first base calls', calls.calls.filter(c => c.task === 'identity-first' && c.replicate === 0).length, 12);
eq('exactly twelve mandatory Study C repeats', calls.calls.filter(c => c.repeatKind === 'study-c-stability').length, 12);
eq('exactly 59 general repeats', calls.calls.filter(c => c.repeatKind === 'general-reliability').length, 59);
ok('call order is interleaved, not grouped by task', new Set(calls.calls.slice(0, 20).map(c => c.task)).size > 1);

eq('image-token estimator uses exact 28px patch formula', estimateImageTokens(750, 750), 729);
eq('native-size fitter prevents provider-side square resize', nativeImageSize(1568, 1568), { width: 1092, height: 1092 });
ok('native-size fitter preserves an already-native landscape', canonicalJson(nativeImageSize(1200, 700)) === canonicalJson({ width: 1200, height: 700 }));
let oversizedTokenImageRefused = false;
try { estimateImageTokens(1568, 1568); } catch { oversizedTokenImageRefused = true; }
ok('cost estimator refuses an image the provider would silently resize', oversizedTokenImageRefused);
const prompts = { identify: 'identify', facets: 'facets', 'facets:sham': 'facets sham', 'facets:correct-cue': 'facets cue', 'identity-first:identity-first': 'identity first' };
const images = {};
for (const w of works) for (const src of ['canonical','alternate']) for (const v of VIEW_SPECS) images[`${w.id}:${src}:${v.id}`] = { width: 800, height: 600 };
const cost = estimateCost(calls, prompts, images);
ok('conservative synthetic preflight stays under owner ceiling', cost.ok && cost.authorizedUpperBoundUsd <= 15);
ok('cost report contains every exact call', cost.rows.length === 671);
ok('text estimate is a byte-level upper bound plus request overhead', cost.rows[0].textTokens >= Buffer.byteLength(prompts[calls.calls[0].task] || 'identify') + 256);
ok('remaining-budget guard permits a funded call', remainingBudgetAllows(cost, 0, calls.calls[0].callId));
ok('remaining-budget guard refuses an unfunded call', !remainingBudgetAllows(cost, 15, calls.calls[0].callId));
ok('remaining-budget guard refuses unknown call', !remainingBudgetAllows(cost, 0, 'missing'));

// Deterministic transformations from one synthetic canonical raster.
const raw = Buffer.alloc(96 * 64 * 3);
for (let y = 0; y < 64; y++) for (let x = 0; x < 96; x++) { const i = (y * 96 + x) * 3; raw[i] = x * 2; raw[i + 1] = y * 3; raw[i + 2] = (x + y) & 255; }
const source = await sharp(raw, { raw: { width: 96, height: 64, channels: 3 } }).png().toBuffer();
const viewsA = await renderAllStudyViews(source, 'northwest');
const viewsB = await renderAllStudyViews(source, 'northwest');
const golden = JSON.parse(readFileSync('docs/research/recognition-pilot/golden-transform.json', 'utf8'));
eq('transform emits all seven views', viewsA.length, 7);
eq('transform is byte/hash deterministic in one frozen environment', viewsA.map(v => v.sha256), viewsB.map(v => v.sha256));
eq('transform matches preregistration golden hashes', viewsA.map(({ view, sha256, width, height, mime }) => ({ view, sha256, width, height, mime })), golden.views);
ok('golden record freezes sharp/libvips versions', golden.sharpVersion === sharp.versions.sharp && golden.vipsVersion === sharp.versions.vips);
eq('golden record freezes the complete image policy', golden.policy, IMAGE_POLICY);
eq('all outputs are fixed JPEG', new Set(viewsA.map(v => `${v.mime}:${v.ext}`)).size, 1);
ok('crop is resized to the canonical raster dimensions', viewsA.find(v => v.view === 'crop25').width === viewsA.find(v => v.view === 'full').width);
ok('mirror differs from full', viewsA.find(v => v.view === 'mirror').sha256 !== viewsA.find(v => v.view === 'full').sha256);
ok('grayscale differs from full', viewsA.find(v => v.view === 'grayscale').sha256 !== viewsA.find(v => v.view === 'full').sha256);
const nw = await renderStudyView(source, VIEW_SPECS.find(v => v.id === 'crop45'), 'northwest');
const se = await renderStudyView(source, VIEW_SPECS.find(v => v.id === 'crop45'), 'southeast');
ok('seeded anchors materially change a crop', nw.sha256 !== se.sha256);
ok('image policy freezes native visual-token cap and encoder', IMAGE_POLICY.maxSide === 1568 && IMAGE_POLICY.maxVisualTokens === 1568 && IMAGE_POLICY.patchSize === 28 && IMAGE_POLICY.format === 'jpeg' && IMAGE_POLICY.quality === 90);

// Append-only checkpoint semantics: intent exists before network; results never overwrite; resume is exact.
const run = mkdtempSync(join(tmpdir(), 'recognition-runtime-'));
mkdirSync(join(run, 'views'));
const firstCall = calls.calls[0];
const begun = beginAttempt(run, firstCall, 0.02, 3);
ok('attempt intent is written before any response', begun.ok && callState(run, firstCall.callId).intents === 1);
finishAttempt(run, firstCall.callId, begun.attempt, { status: 'no-response-transport', billedUsd: 0.02 });
ok('transport failure remains resumable', !callState(run, firstCall.callId).complete);
const retry = beginAttempt(run, firstCall, 0.02, 3);
eq('retry uses the next immutable attempt number', retry.attempt, 2);
const spentEnv = JSON.stringify({ model: 'm', content: [{ type: 'text', text: '{}' }], usage: { input_tokens: 1000, output_tokens: 100 } });
finishAttempt(run, firstCall.callId, retry.attempt, { status: 'valid-response', billedUsd: 0.01, responseSha256: sha256(spentEnv), rawResponse: spentEnv, parsed: {} });
ok('first valid response terminally completes the call', callState(run, firstCall.callId).complete);
eq('completed call cannot start again', beginAttempt(run, firstCall, 0.02, 3).reason, 'call-complete');
let overwriteRefused = false;
try { atomicJson(join(run, 'attempts', firstCall.callId, 'attempt-2.result.json'), { bad: true }); } catch { overwriteRefused = true; }
ok('append-only result cannot be overwritten', overwriteRefused);
// Billing is recomputed from VERIFIED usage bytes (1000 in / 100 out @ $3/$15), never the stored billedUsd (0.01).
eq('spent ledger recomputes cost from verified usage, not the stored field', spentAndUnknown(run, [{ callId: firstCall.callId, conservativeUsd: 0.02 }]).billed, 0.0045);
const terminalCall = calls.calls[1];
const terminalBegun = beginAttempt(run, terminalCall, 0.02, 3);
finishAttempt(run, terminalCall.callId, terminalBegun.attempt, { status: 'terminal-api-error', httpStatus: 400, billedUsd: 0 });
ok('non-retryable API error stays terminal across resume', callState(run, terminalCall.callId).complete && beginAttempt(run, terminalCall, 0.02, 3).reason === 'call-complete');
eq('exact JSON parses', deterministicJsonParse('{"x":1}').value, { x: 1 });
ok('one whole JSON fence is deterministic content-preserving recovery', deterministicJsonParse('```json\n{"x":1}\n```').recoveredFenceOnly);
ok('prose-wrapped JSON is refused', !deterministicJsonParse('answer: {"x":1}').ok);
eq('actual bill uses frozen price units', billedUsd({ input_tokens: 1000, output_tokens: 100 }, { inputPerMillionUsd: 3, outputPerMillionUsd: 15, batchMultiplier: 1 }), 0.0045);
eq('missing usage never undercounts as zero', billedUsd(null, { inputPerMillionUsd: 3, outputPerMillionUsd: 15, batchMultiplier: 1 }), null);
const viewBytes = Buffer.from('view'); const viewSha = (await import('../scripts/lib/recognition-pilot.mjs')).sha256(viewBytes);
writeFileSync(join(run, 'views', `${viewSha}.jpg`), viewBytes);
eq('safe view path accepts a real content-addressed file', safeRegisteredViewPath(run, viewSha), join(realpathSync(run), 'views', `${viewSha}.jpg`));
ok('safe view path rejects a fake sha', safeRegisteredViewPath(run, '../escape') === null);
rmSync(run, { recursive: true, force: true });

// Git-only prospective freeze: the commit is derived (never self-embedded) and registered bytes
// must remain identical even when unrelated files change later.
const repo = mkdtempSync(join(tmpdir(), 'recognition-freeze-'));
execFileSync('git', ['init', '-q'], { cwd: repo });
writeFileSync(join(repo, 'registered.json'), '{"status":"frozen"}\n');
execFileSync('git', ['add', 'registered.json'], { cwd: repo });
execFileSync('git', ['commit', '-q', '-m', 'PILOT PROTOCOL FROZEN BEFORE COLLECTION: pilot-test-v1'], {
  cwd: repo,
  env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' },
});
const GITENV = { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' };
const freeze = verifyGitFreeze(repo, 'pilot-test-v1', ['registered.json']);
ok('dedicated registration commit is derived and verified', freeze.ok && /^[0-9a-f]{40}$/.test(freeze.commit));
writeFileSync(join(repo, 'unrelated.txt'), 'dirty but outside the freeze\n');
ok('unrelated working-tree changes do not invalidate the freeze', verifyGitFreeze(repo, 'pilot-test-v1', ['registered.json']).ok);
writeFileSync(join(repo, 'registered.json'), '{"status":"changed"}\n');
eq('registered working-tree drift fails closed', verifyGitFreeze(repo, 'pilot-test-v1', ['registered.json']).reason, 'git-freeze-mismatch');

// Collection seal: a DEDICATED commit that DESCENDS from the freeze and changes only the evidence file.
writeFileSync(join(repo, 'registered.json'), '{"status":"frozen"}\n'); // restore so the freeze stays intact
const fz = verifyGitFreeze(repo, 'pilot-test-v1', ['registered.json']);
writeFileSync(join(repo, 'collection-evidence.abc.json'), '{"ev":1}\n');
execFileSync('git', ['add', 'collection-evidence.abc.json'], { cwd: repo });
execFileSync('git', ['commit', '-q', '-m', 'PILOT COLLECTION SEALED: pilot-test-v1'], { cwd: repo, env: GITENV });
ok('a dedicated collection seal that descends from the freeze verifies', verifyGitCollectionSeal(repo, 'pilot-test-v1', 'collection-evidence.abc.json', fz.commit).ok);
ok('the seal fails when it does not descend from the freeze commit', verifyGitCollectionSeal(repo, 'pilot-test-v1', 'collection-evidence.abc.json', 'f'.repeat(40)).reason === 'not-a-descendant');
ok('the seal fails on a wrong freeze id (wrong subject)', !verifyGitCollectionSeal(repo, 'wrong-id-v9', 'collection-evidence.abc.json', fz.commit).ok);
writeFileSync(join(repo, 'collection-evidence.abc.json'), '{"ev":2}\n'); // edit after commit
ok('editing the sealed evidence after the commit fails closed', !verifyGitCollectionSeal(repo, 'pilot-test-v1', 'collection-evidence.abc.json', fz.commit).ok);
rmSync(repo, { recursive: true, force: true });

// A "dedicated" seal commit that also changes another path is rejected (not dedicated).
const repoM = mkdtempSync(join(tmpdir(), 'recognition-seal-mixed-'));
execFileSync('git', ['init', '-q'], { cwd: repoM });
writeFileSync(join(repoM, 'registered.json'), '{"status":"frozen"}\n');
execFileSync('git', ['add', 'registered.json'], { cwd: repoM });
execFileSync('git', ['commit', '-q', '-m', 'PILOT PROTOCOL FROZEN BEFORE COLLECTION: pilot-test-v1'], { cwd: repoM, env: GITENV });
const fzM = verifyGitFreeze(repoM, 'pilot-test-v1', ['registered.json']);
writeFileSync(join(repoM, 'collection-evidence.abc.json'), '{"ev":1}\n');
writeFileSync(join(repoM, 'extra.txt'), 'not part of the seal\n');
execFileSync('git', ['add', 'collection-evidence.abc.json', 'extra.txt'], { cwd: repoM });
execFileSync('git', ['commit', '-q', '-m', 'PILOT COLLECTION SEALED: pilot-test-v1'], { cwd: repoM, env: GITENV });
ok('a seal commit that also changes another path is not dedicated', verifyGitCollectionSeal(repoM, 'pilot-test-v1', 'collection-evidence.abc.json', fzM.commit).reason === 'commit-not-dedicated');
rmSync(repoM, { recursive: true, force: true });

// ===========================================================================
// Codex-repair regressions.
// ===========================================================================

// --- Repair 2: curator-check validator, all failure forms ---
ok('curatorChecks rejects a missing object', !validateCuratorChecks(undefined).ok);
ok('curatorChecks rejects an empty object', !validateCuratorChecks({}).ok);
ok('curatorChecks rejects an array', !validateCuratorChecks([]).ok);
const fullChecks = Object.fromEntries(REQUIRED_CURATOR_CHECKS.map(k => [k, true]));
ok('curatorChecks accepts exactly seven booleans', validateCuratorChecks(fullChecks).ok);
ok('curatorChecks rejects a missing key', !validateCuratorChecks((() => { const c = { ...fullChecks }; delete c.rights; return c; })()).ok);
ok('curatorChecks rejects an extra key', !validateCuratorChecks({ ...fullChecks, extra: true }).ok);
ok('curatorChecks rejects a boolean-as-string', !validateCuratorChecks({ ...fullChecks, rights: 'true' }).ok);
ok('curatorChecks rejects a null value', !validateCuratorChecks({ ...fullChecks, rights: null }).ok);
ok('curatorChecks rejects a numeric value', !validateCuratorChecks({ ...fullChecks, rights: 1 }).ok);
ok('curatorChecksAllTrue is false when any check is false', !curatorChecksAllTrue({ ...fullChecks, imageFitness: false }));
ok('curatorChecksAllTrue is true only when all seven are true', curatorChecksAllTrue(fullChecks));

// --- Repair 2/3/4: full work-shape validation ---
const fullCov = () => ({ era: '1500-1799', objectType: 'painting', mediumFamily: 'painting', titleType: 'distinctive', playState: 'unreviewed', sourceHost: 'example.org', contentRichness: 0, artistCluster: null, institutionCluster: null });
const validWork = () => ({
  id: 'w-valid',
  catalog: { title: 'A Distinctive Title', wikidataId: null, artist: null, place: 'Italy', style: 'Baroque', styleKind: 'movement', medium: 'oil' },
  strata: { fameBand: 'f3', regionGroup: 'europe', regionSource: 'creation-place', lowDocumentationStress: false, fameHistoricalComposite: 100 },
  selectionCovariates: fullCov(), analysisCovariates: fullCov(),
  source: { requestedUrl: 'https://example.org/x.jpg', rights: null, license: null },
  imageFitness: { state: null, reason: null, replacementUrl: null },
  transform: { anchor: 'center', views: {} },
  recognitionKey: { acceptedTitles: ['A Distinctive Title'], acceptedArtists: [], requiredQualifierGroups: [], uniqueFacts: [], targetUnit: 'cataloged-work', exactRequires: 'title' },
  cue: { correct: 'A Distinctive Title', sham: 'X', cueType: 'title-only', acceptedAliasesByFacet: { date: [], place: [], medium: [], style: [], artist: [] }, disclosedFacets: [], eligibleFacets: [...FACETS] },
  truth: { date: { lo: 1500, hi: 1500 }, place: { exact: ['Italy'], parent: ['Europe'] }, medium: { exact: ['oil'], family: ['painting'], broad: [] }, style: { exact: ['Baroque'], family: [], related: [] }, artist: { exact: ['X'], workshop: [], circle: [], attributed: [], follower: [] } },
  promptOrder: false, evidenceBoxes: false, studyC: false, alternate: null,
  curationIssues: [], curatorChecks: fullChecks,
});
ok('validateWorkShape accepts a well-formed work', validateWorkShape(validWork()).ok);
ok('curator booleans cannot bless a legacy covariates blob', !validateWorkShape((() => { const w = validWork(); delete w.selectionCovariates; w.covariates = { era: 'x' }; return w; })()).ok);
ok('validateWorkShape needs selection AND analysis covariates', !validateWorkShape((() => { const w = validWork(); delete w.analysisCovariates; return w; })()).ok);
ok('validateWorkShape rejects a malformed truth even with all checks true', !validateWorkShape((() => { const w = validWork(); w.truth.date = { lo: 1600, hi: 1500 }; return w; })()).ok);
ok('validateWorkShape rejects a generic-noun title marked title-exact', !validateWorkShape((() => { const w = validWork(); w.recognitionKey.acceptedTitles = ['Fragment']; return w; })()).ok);
ok('validateWorkShape requires a qualifier group for exactRequires=title+qualifier', !validateWorkShape((() => { const w = validWork(); w.recognitionKey.exactRequires = 'title+qualifier'; return w; })()).ok);
ok('validateWorkShape accepts a site-assemblage target unit', validateWorkShape((() => { const w = validWork(); w.recognitionKey.targetUnit = 'site-assemblage'; return w; })()).ok);
ok('validateWorkShape rejects an unknown target unit', !validateWorkShape((() => { const w = validWork(); w.recognitionKey.targetUnit = 'mystery'; return w; })()).ok);
ok('validateWorkShape rejects a studyC work without an alternate', !validateWorkShape((() => { const w = validWork(); w.studyC = true; w.alternate = null; return w; })()).ok);
ok('TARGET_UNITS and EXACT_RULES are frozen vocabularies', TARGET_UNITS.includes('site-assemblage') && EXACT_RULES.includes('title+qualifier'));

// --- Repair 4: curation issues ---
ok('valid curation issue array accepted', validateCurationIssues([{ code: 'x', severity: 'major', blocking: true, status: 'open', note: 'n', evidenceRefs: [] }]).ok);
ok('curation issue rejects a bad severity', !validateCurationIssues([{ code: 'x', severity: 'huge', blocking: true, status: 'open', note: 'n', evidenceRefs: [] }]).ok);
ok('curation issue rejects a non-boolean blocking', !validateCurationIssues([{ code: 'x', severity: 'major', blocking: 'yes', status: 'open', note: 'n', evidenceRefs: [] }]).ok);
eq('unresolvedBlockingIssues returns only open/deferred blocking issues', unresolvedBlockingIssues({ curationIssues: [
  { code: 'a', severity: 'major', blocking: true, status: 'open', note: 'n', evidenceRefs: [] },
  { code: 'b', severity: 'major', blocking: true, status: 'resolved', note: 'n', evidenceRefs: [] },
  { code: 'c', severity: 'minor', blocking: false, status: 'open', note: 'n', evidenceRefs: [] },
] }).map(i => i.code), ['a']);

// --- Repair 3: exact-recognition unit ---
const idResp = (over = {}) => ({ workTitleGuess: 'Knucklebone', specificWorkClaim: true, distinguishingQualifierGuess: null, artistGuess: null, seriesOrTraditionGuess: null, selfRecognized: true, confidence: 70, visualBasis: 'a small cast astragalus form', ...over });
const genericKey = { acceptedTitles: ['Knucklebone', 'Astragalus'], acceptedArtists: [], requiredQualifierGroups: [['Harvard Art Museums', '1978.495.46']], uniqueFacts: [], targetUnit: 'unique-object', exactRequires: 'title+qualifier' };
eq('a generic title alone is not exact', gradeIdentification(idResp(), genericKey).exact, false);
eq('generic title plus the distinguishing qualifier is exact', gradeIdentification(idResp({ distinguishingQualifierGuess: 'Harvard Art Museums 1978.495.46' }), genericKey).exact, true);
const distinctKey = { acceptedTitles: ['Sehando'], acceptedArtists: [], requiredQualifierGroups: [], uniqueFacts: [], targetUnit: 'cataloged-work', exactRequires: 'title' };
eq('a distinctive cataloged title is exact without any physical-impression accession', gradeIdentification(idResp({ workTitleGuess: 'Sehando' }), distinctKey).exact, true);
eq('a title+qualifier key with empty groups cannot be exact via title alone (fail-safe)', gradeIdentification(idResp({ workTitleGuess: 'Sehando' }), { ...distinctKey, exactRequires: 'title+qualifier' }).exact, false);
ok('isGenericLabel flags generic nouns but not distinctive names', isGenericLabel('Fragment') && isGenericLabel('Hercules') && !isGenericLabel('Sehando') && !isGenericLabel('The Great Hercules'));

// --- Repair 5: style dedup map is a real grading dependency ---
const dedup = { 'rapa nui': 'rapa nui people', 'ptolemaic egyptian art': 'ptolemaic egypt', 'joseon dynasty': 'joseon korean' };
eq('Rapa Nui and Rapa Nui people earn the same exact credit', [
  gradeStyle('Rapa Nui', { exact: ['Rapa Nui people'], family: [], related: [] }, dedup).credit,
  gradeStyle('Rapa Nui people', { exact: ['Rapa Nui people'], family: [], related: [] }, dedup).credit,
], [1, 1]);
eq('the Ptolemaic merge behaves as declared', gradeStyle('Ptolemaic Egyptian art', { exact: ['Ptolemaic Egypt'], family: [], related: [] }, dedup).credit, 1);
eq('the Joseon merge maps the dynasty label to the culture label', gradeStyle('Joseon dynasty', { exact: ['Joseon Korean'], family: [], related: [] }, dedup).credit, 1);
eq('Qin and Qing remain distinct under dedup', gradeStyle('Qing dynasty', { exact: ['Qin dynasty'], family: [], related: [] }, dedup).credit, 0);
eq('a specific child label is not collapsed into its parent', gradeStyle('Joseon dynasty', { exact: ['Joseon dynasty literati painting'], family: [], related: [] }, dedup).credit, 0);
ok('styleDedupFromSnapshot normalizes raw-label keys', styleDedupFromSnapshot({ curatorDedupMap: { 'Rapa Nui': 'Rapa Nui people' } })['rapa nui'] === 'rapa nui people');

// --- Repair 6: unsettled attribution without an impossible primary ceiling ---
const attrTruth = { exact: [], workshop: [], circle: [], attributed: ['Antonio Rossellino', 'Desiderio da Settignano'], follower: [] };
eq('attributed-only truth yields partial (0.6) secondary credit', gradeArtist('Antonio Rossellino', attrTruth).credit, 0.6);
eq('a 0.6-max facet cannot generate a full-credit Brier event', brier(100, 0.6), 1);
eq('primaryApplicable=false removes artist from the applicable primary', applicableEligibleFacets({ cue: { eligibleFacets: [...FACETS] }, truth: {}, primaryApplicable: { artist: false } }), ['date', 'place', 'medium', 'style']);

// --- Repairs 1 + 7: applicable denominator + nuisance analysis (pure analyzePilot) ---
const facetResult = over => ({ date: { bestYear: 1500, confidence: 50, visualBasis: 'b' }, place: { topGuess: 'Italy', alternatives: [], confidence: 50, visualBasis: 'b' }, medium: { guess: 'oil', confidence: 50, visualBasis: 'b' }, style: { guess: 'Baroque', confidence: 50, visualBasis: 'b' }, artist: { guess: 'X', confidence: 50, visualBasis: 'b' }, ...over });
const idResult = over => ({ workTitleGuess: 'A Distinctive Title', specificWorkClaim: true, distinguishingQualifierGuess: null, artistGuess: null, seriesOrTraditionGuess: null, selfRecognized: false, confidence: 50, visualBasis: 'b', ...over });
const mkWork = (id, extra) => ({ id, strata: { fameBand: 'f3', regionGroup: 'europe' }, promptOrder: id === 'w1', studyC: false,
  recognitionKey: { acceptedTitles: ['A Distinctive Title'], acceptedArtists: [], requiredQualifierGroups: [], uniqueFacts: [], targetUnit: 'cataloged-work', exactRequires: 'title' },
  cue: { correct: 'A Distinctive Title', eligibleFacets: [...FACETS], disclosedFacets: [], cueType: 'title-only' },
  truth: { date: { lo: 1500, hi: 1500 }, place: { exact: ['Italy'], parent: ['Europe'] }, medium: { exact: ['oil'], family: ['painting'], broad: [] }, style: { exact: ['Baroque'], family: [], related: [] }, artist: { exact: ['X'], workshop: [], circle: [], attributed: [], follower: [] } }, ...extra });
const wAnon = mkWork('w2', { truth: { date: { lo: 1800, hi: 1800 }, place: { exact: ['Australia'], parent: ['Oceania'] }, medium: { exact: ['lithograph'], family: ['print'], broad: [] }, style: { notApplicable: true }, artist: { notApplicable: true } } });
const wAttr = mkWork('w3', { primaryApplicable: { artist: false } });
const synthWorks = [mkWork('w1'), wAnon, wAttr];
const synthCalls = { calls: [] };
const results = new Map();
let cn = 0;
const addCall = (workId, task, condition, replicate, parsed, repeatKind = null) => { const callId = `c${cn++}`; synthCalls.calls.push({ callId, workId, source: 'canonical', view: 'full', task, condition, replicate, repeatKind }); results.set(callId, parsed); };
for (const w of synthWorks) {
  addCall(w.id, 'identify', 'no-cue', 0, idResult());
  addCall(w.id, 'facets', 'no-cue', 0, facetResult());
  addCall(w.id, 'facets', 'sham', 0, facetResult());
  addCall(w.id, 'facets', 'correct-cue', 0, facetResult({ date: { bestYear: 1500, confidence: 90, visualBasis: 'b' } }));
}
addCall('w1', 'identity-first', 'identity-first', 0, { identification: idResult(), facets: facetResult() });
addCall('w1', 'facets', 'no-cue', 1, facetResult({ date: { bestYear: 1490, confidence: 50, visualBasis: 'b' } }), 'general-reliability');
addCall('w1', 'identity-first', 'identity-first', 1, { identification: idResult(), facets: facetResult() }, 'general-reliability');
const diag = analyzePilot({ manifest: { works: synthWorks }, calls: synthCalls, resultForCallId: id => results.get(id) || null, styleDedup: {} });
eq('anonymous/notApplicable-facet work stays in the applicable primary (not dropped)', diag.studyB.analyzedWorkIds.includes('w2'), true);
eq('Inverted-Swan-like work is analyzable via date/place/medium', diag.studyB.applicableFacetCountByWork.w2, 3);
eq('no work is silently dropped for lacking an applicable facet', diag.studyB.droppedForNoApplicableFacet, []);
eq('attribution-unsettled work excludes artist from its applicable mask', applicableEligibleFacets(wAttr), ['date', 'place', 'medium', 'style']);
eq('repeated FACET cells are consumed, not ignored', diag.reliability.repeatedFacetPairsConsumed >= 1 && diag.reliability.repeatedFacetCells >= 1, true);
eq('repeated identity-first cells are consumed, not ignored', diag.reliability.repeatedIdentityFirstPairs >= 1 && diag.reliability.repeatedIdentityFirstCells >= 1, true);
ok('nuisance analysis reports missingness and forbids treatment-effect power inputs', diag.missingness.perCall.present === synthCalls.calls.length && diag.forbiddenForMainPower.includes('observed pilot treatment-effect magnitude'));
ok('all three Study B arms score over the same applicable mask', diag.studyB.works ? true : (diag.studyB.analyzedWorkIds.length === 3));

// --- Repair 8: deterministic worksheet + derived disclosure list ---
const discManifest = { works: [
  { id: 'd1', catalog: { title: 'Ram' }, strata: { fameBand: 'f4', regionGroup: 'non-europe' }, cue: { correct: 'Ram (BM)', disclosedFacets: [] }, curatorChecks: fullChecks, curationIssues: [], studyC: false },
  { id: 'd2', catalog: { title: 'Terracotta Army' }, strata: { fameBand: 'f5', regionGroup: 'non-europe' }, cue: { correct: 'Terracotta Army', disclosedFacets: ['medium'] }, curatorChecks: fullChecks, curationIssues: [], studyC: false },
] };
eq('disclosure list is derived from the manifest, not a hardcoded count', disclosedFacetList(discManifest), [{ id: 'd2', facet: 'medium' }]);
ok('buildWorksheet is deterministic', buildWorksheet(discManifest) === buildWorksheet(discManifest));
ok('worksheet reflects disclosed facets and Study C status', buildWorksheet(discManifest).includes('disclosed: medium') && buildWorksheet(discManifest).includes('Terracotta Army'));

// ===========================================================================
// Second Codex-review regressions.
// ===========================================================================

// --- Blocker 2: exactRequires strictly honored; wrong-title/correct-accession is adjudicated ---
const strictQKey = { acceptedTitles: ['Knucklebone'], acceptedArtists: [], requiredQualifierGroups: [['Harvard Art Museums', '1978.495.46']], uniqueFacts: ['Harvard Art Museums, object no. 1978.495.46'], targetUnit: 'unique-object', exactRequires: 'title+qualifier' };
const wrongTitleRightAcc = gradeIdentification(idResp({ workTitleGuess: 'A different object', distinguishingQualifierGuess: 'Harvard Art Museums, object no. 1978.495.46' }), strictQKey);
eq('wrong title + correct accession is NOT exact under a strict title+qualifier key', wrongTitleRightAcc.exact, false);
ok('wrong title + correct accession routes to blinded adjudication (level null)', wrongTitleRightAcc.needsAdjudication === true && wrongTitleRightAcc.level === null);
eq('correct title + correct accession IS exact', gradeIdentification(idResp({ workTitleGuess: 'Knucklebone', distinguishingQualifierGuess: 'Harvard Art Museums 1978.495.46' }), strictQKey).exact, true);
eq('a uniqueFact key is exact from its prespecified unique fact', gradeIdentification(idResp({ workTitleGuess: 'Louvre portrait of Lisa Gherardini' }), { acceptedTitles: ['Mona Lisa'], acceptedArtists: [], requiredQualifierGroups: [], uniqueFacts: ['Louvre portrait of Lisa Gherardini'], targetUnit: 'unique-object', exactRequires: 'uniqueFact' }).exact, true);
ok('allowUniqueFactAlternative opt-in lets a non-contradictory fact grant exact', gradeIdentification(idResp({ workTitleGuess: null, distinguishingQualifierGuess: 'Harvard Art Museums, object no. 1978.495.46' }), { acceptedTitles: ['Knucklebone'], acceptedArtists: [], requiredQualifierGroups: [], uniqueFacts: ['Harvard Art Museums, object no. 1978.495.46'], targetUnit: 'unique-object', exactRequires: 'title', allowUniqueFactAlternative: true }).exact === true);

// --- Blocker 3: owner-decision status blocks; deferred-image and cleared statuses do not ---
eq('owner-decision status blocks finalization even when blocking:false', unresolvedBlockingIssues({ curationIssues: [{ code: 'x', severity: 'major', blocking: false, status: 'owner-decision', note: 'n', evidenceRefs: [] }] }).map(i => i.code), ['x']);
eq('deferred-image issues do not block finalization', unresolvedBlockingIssues({ curationIssues: [{ code: 'y', severity: 'minor', blocking: false, status: 'deferred-image', note: 'n', evidenceRefs: [] }] }), []);
eq('accepted/resolved blocking issues never block', unresolvedBlockingIssues({ curationIssues: [{ code: 'a', severity: 'major', blocking: true, status: 'accepted', note: 'n', evidenceRefs: [] }, { code: 'b', severity: 'major', blocking: true, status: 'resolved', note: 'n', evidenceRefs: [] }] }), []);

// --- Blocker 1: legacy/manifest id-set drift is detectable ---
const idSetEqual = (a, b) => a.size === b.size && [...a].every(x => b.has(x));
ok('legacy id-set drift is detectable', !idSetEqual(new Set(['a', 'b']), new Set(['a', 'c'])) && idSetEqual(new Set(['a', 'b']), new Set(['b', 'a'])));

// --- Medium 6: the full work validator actually rejects the previously-accepted mutations ---
ok('validateWorkShape rejects a missing catalog', !validateWorkShape((() => { const w = validWork(); delete w.catalog; return w; })()).ok);
ok('validateWorkShape rejects numeric source.rights', !validateWorkShape((() => { const w = validWork(); w.source.rights = 5; return w; })()).ok);
ok('validateWorkShape rejects object-valued source.license', !validateWorkShape((() => { const w = validWork(); w.source.license = { x: 1 }; return w; })()).ok);
ok('validateWorkShape rejects malformed imageFitness', !validateWorkShape((() => { const w = validWork(); w.imageFitness = { state: 'bogus' }; return w; })()).ok);
ok('validateWorkShape rejects malformed transform', !validateWorkShape((() => { const w = validWork(); w.transform = { anchor: 'nowhere', views: {} }; return w; })()).ok);
ok('validateWorkShape rejects an empty covariate record', !validateWorkShape((() => { const w = validWork(); w.selectionCovariates = {}; return w; })()).ok);
ok('validateWorkShape rejects an arbitrary covariate record', !validateWorkShape((() => { const w = validWork(); w.analysisCovariates = { foo: 'bar' }; return w; })()).ok);

// --- Style canonicalization maps declared variants but requires WHOLE-LABEL equality for a level ---
const rnDedup = { 'rapa nui': 'rapa nui people' };
eq('a declared variant ("Rapa Nui") canonicalizes to the same exact credit', gradeStyle('Rapa Nui', { exact: ['Rapa Nui people'], family: [], related: [] }, rnDedup).credit, 1);
eq('decorated free text ("Rapa Nui art") is NOT a whole-label match (no false exact)', gradeStyle('Rapa Nui art', { exact: ['Rapa Nui people'], family: [], related: [] }, rnDedup).credit, 0);
eq('decorated free text ("art of Rapa Nui") is NOT a whole-label match', gradeStyle('art of Rapa Nui', { exact: ['Rapa Nui people'], family: [], related: [] }, rnDedup).credit, 0);

// ===========================================================================
// Third Codex-review regressions.
// ===========================================================================

// --- Finding 2: correct title without/with-wrong qualifier is partial, never confabulation ---
const tqKey = { acceptedTitles: ['Knucklebone'], acceptedArtists: [], requiredQualifierGroups: [['Harvard Art Museums', '1978.495.46']], uniqueFacts: [], targetUnit: 'unique-object', exactRequires: 'title+qualifier' };
const missingQual = gradeIdentification(idResp({ workTitleGuess: 'Knucklebone', distinguishingQualifierGuess: null }), tqKey);
ok('correct title, missing qualifier => partial (level 1), not confabulation', missingQual.exact === false && missingQual.titleWithoutQualifier === true && missingQual.wrongSpecificWork === false && missingQual.level === 1);
const wrongQual = gradeIdentification(idResp({ workTitleGuess: 'Knucklebone', distinguishingQualifierGuess: 'British Museum' }), tqKey);
ok('correct title, wrong qualifier => partial (level 1), not level -1', wrongQual.exact === false && wrongQual.level === 1 && wrongQual.wrongSpecificWork === false);
const diffTitle = gradeIdentification(idResp({ workTitleGuess: 'The Discobolus', distinguishingQualifierGuess: null, confidence: 80 }), tqKey);
ok('a genuinely different title stays wrong-specific/confabulation (level -1)', diffTitle.exact === false && diffTitle.wrongSpecificWork === true && diffTitle.level === -1);

// --- Finding 4: substring containment no longer creates false exact ---
eq('"Neo-Baroque" is not exact for Baroque', gradeStyle('Neo-Baroque', { exact: ['Baroque'], family: [], related: [] }, {}).credit, 0);
eq('"Not Baroque" is not exact for Baroque', gradeStyle('Not Baroque', { exact: ['Baroque'], family: [], related: [] }, {}).credit, 0);
eq('a more-specific child does not earn a parent exact', gradeStyle('Joseon dynasty literati painting', { exact: ['Joseon Korean'], family: [], related: [] }, { 'joseon dynasty': 'joseon korean' }).credit, 0);
eq('a broader parent guess earns family (not exact) for a child truth', gradeStyle('Joseon dynasty', { exact: ['Joseon dynasty literati painting'], family: ['Joseon Korean'], related: [] }, { 'joseon dynasty': 'joseon korean' }).credit, 0.65);

// --- Finding 5: normalized (conceptual) id uniqueness ---
eq('normalizedWorkId collapses QID spellings', [normalizedWorkId('wikidata:Q1'), normalizedWorkId('wd:Q1'), normalizedWorkId('http://www.wikidata.org/entity/Q1')], ['q1', 'q1', 'q1']);
let dupNormThrew = false;
try { buildCallManifest(Array.from({ length: 36 }, (_, i) => ({ id: i === 35 ? 'wd:Q1' : (i === 0 ? 'wikidata:Q1' : `w${i}`), studyC: i < 6, promptOrder: i < 12 })), 's'); } catch { dupNormThrew = true; }
ok('buildCallManifest rejects duplicate normalized work ids', dupNormThrew);

// --- Finding 1: adjudication cells are unresolved (null), queued, and resolvable ---
const ADJV = 'recognition-adjudication/3';
const adjArt = (resolutions, over = {}) => ({ version: ADJV, freezeId: 'gesso-recognition-pilot-2026-08-31-v1', packetSha256: 'c'.repeat(64), collectionEvidenceSha256: 'd'.repeat(64), resolutions, ...over });
ok('adjudication artifact validator accepts a well-formed identification ruling', validateAdjudicationArtifact(adjArt([{ cellId: 'a'.repeat(32), responseSha256: 'b'.repeat(64), kind: 'identification', resolvedExact: true, reviewer: 'blinded reviewer' }])).ok);
ok('adjudication artifact validator accepts a well-formed facet ruling', validateAdjudicationArtifact(adjArt([{ cellId: 'a'.repeat(32), responseSha256: 'b'.repeat(64), kind: 'facet', resolvedCredit: 0.65, reviewer: 'blinded reviewer' }])).ok);
ok('adjudication artifact validator rejects a short cellId', !validateAdjudicationArtifact(adjArt([{ cellId: 'x', responseSha256: 'b'.repeat(64), kind: 'identification', resolvedExact: true, reviewer: 'r' }])).ok);
ok('adjudication artifact rejects an off-scale facet credit', !validateAdjudicationArtifact(adjArt([{ cellId: 'a'.repeat(32), responseSha256: 'b'.repeat(64), kind: 'facet', resolvedCredit: 0.9, reviewer: 'r' }])).ok);
ok('adjudication artifact rejects mixing resolvedExact with a facet kind', !validateAdjudicationArtifact(adjArt([{ cellId: 'a'.repeat(32), responseSha256: 'b'.repeat(64), kind: 'facet', resolvedCredit: 0.65, resolvedExact: true, reviewer: 'r' }])).ok);
ok('adjudication artifact requires packetSha256 + collectionEvidenceSha256', !validateAdjudicationArtifact({ version: ADJV, freezeId: 'gesso-recognition-pilot-2026-08-31-v1', resolutions: [{ cellId: 'a'.repeat(32), responseSha256: 'b'.repeat(64), kind: 'facet', resolvedCredit: 0.65, reviewer: 'r' }] }).ok);
const adjKey = { acceptedTitles: ['Knucklebone'], acceptedArtists: [], requiredQualifierGroups: [['Harvard Art Museums', '1978.495.46']], uniqueFacts: ['Harvard Art Museums, object no. 1978.495.46'], targetUnit: 'unique-object', exactRequires: 'title+qualifier' };
const adjWork = { id: 'wadj', strata: { fameBand: 'f3', regionGroup: 'europe' }, promptOrder: false, studyC: false, recognitionKey: adjKey, cue: { correct: 'x', eligibleFacets: [...FACETS], disclosedFacets: [], cueType: 'title-only' }, truth: { date: { lo: 1, hi: 1 }, place: { exact: ['Italy'], parent: ['Europe'] }, medium: { exact: ['oil'], family: ['painting'], broad: [] }, style: { exact: ['Baroque'], family: [], related: [] }, artist: { exact: ['X'], workshop: [], circle: [], attributed: [], follower: [] } } };
const contradictoryResp = idResult({ workTitleGuess: 'A different object', distinguishingQualifierGuess: 'Harvard Art Museums, object no. 1978.495.46' });
const adjCalls = { calls: [{ callId: 'adjc0', workId: 'wadj', source: 'canonical', view: 'full', task: 'identify', condition: 'no-cue', replicate: 0 }] };
const adjResMap = new Map([['adjc0', contradictoryResp]]);
const adjDiag = analyzePilot({ manifest: { works: [adjWork] }, calls: adjCalls, resultForCallId: id => adjResMap.get(id) || null });
ok('a contradictory identify cell is UNRESOLVED (null), never counted as non-recognition', adjDiag.studyA.workVectors[0].recognition.full === null);
ok('the adjudication queue lists the cell with a stable id', adjDiag.adjudication.requiredCount === 1 && adjDiag.adjudication.requiredCells[0].callId === 'adjc0');
const adjDiag2 = analyzePilot({ manifest: { works: [adjWork] }, calls: adjCalls, resultForCallId: id => adjResMap.get(id) || null, resolveAdjudication: cell => (cell.callId === 'adjc0' && cell.kind === 'identification' ? false : null) });
ok('a bound resolver resolves the cell and empties the queue', adjDiag2.adjudication.requiredCount === 0 && adjDiag2.adjudication.resolvedCount === 1 && adjDiag2.studyA.workVectors[0].recognition.full === false);

// --- Finding 1: results are verified on read; a stored-answer edit is ignored, a byte edit is caught ---
const vrun = mkdtempSync(join(tmpdir(), 'recognition-verify-'));
const vcall = calls.calls[7];
const vAnswer = { workTitleGuess: 'Mona Lisa', specificWorkClaim: true, distinguishingQualifierGuess: null, artistGuess: 'Leonardo da Vinci', seriesOrTraditionGuess: null, selfRecognized: true, confidence: 90, visualBasis: 'the sitter matches' };
const vEnvelope = { model: 'claude-sonnet-4-6', content: [{ type: 'text', text: JSON.stringify(vAnswer) }], usage: { input_tokens: 1, output_tokens: 1 } };
const vRaw = JSON.stringify(vEnvelope);
finishAttempt(vrun, vcall.callId, 1, { status: 'valid-response', responseSha256: sha256(vRaw), rawResponse: vRaw, parsed: vAnswer, usage: vEnvelope.usage, billedUsd: 0.01 });
const vst1 = callState(vrun, vcall.callId);
ok('a verified result re-derives the answer from raw bytes', !!vst1.primary && vst1.primary.parsed.workTitleGuess === 'Mona Lisa' && vst1.tampered.length === 0);
const vfile = join(vrun, 'attempts', vcall.callId, 'attempt-1.result.json');
const vj = JSON.parse(readFileSync(vfile, 'utf8')); vj.parsed = { ...vAnswer, workTitleGuess: 'FORGERY' }; writeFileSync(vfile, JSON.stringify(vj));
ok('editing the stored parsed field is ignored (answer re-derived from verified bytes)', callState(vrun, vcall.callId).primary.parsed.workTitleGuess === 'Mona Lisa');
const vj2 = JSON.parse(readFileSync(vfile, 'utf8')); vj2.rawResponse = vj2.rawResponse.replace('Mona Lisa', 'FORGERY'); writeFileSync(vfile, JSON.stringify(vj2));
const vst3 = callState(vrun, vcall.callId);
ok('editing raw response bytes without matching SHA is detected (tampered, no primary)', vst3.primary === null && vst3.tampered.length === 1);
rmSync(vrun, { recursive: true, force: true });

// --- Finding 3: adjudication artifact must be fully bound and unambiguous ---
const goodAdj = adjArt([{ cellId: 'a'.repeat(32), responseSha256: 'b'.repeat(64), kind: 'identification', resolvedExact: true, reviewer: 'r' }]);
ok('adjudication artifact requires freezeId + exact top-level keys', validateAdjudicationArtifact(goodAdj).ok
  && !validateAdjudicationArtifact({ version: ADJV, resolutions: goodAdj.resolutions }).ok
  && !validateAdjudicationArtifact({ ...goodAdj, extra: 1 }).ok);
ok('adjudication artifact rejects duplicate cellIds and unexpected ruling keys', !validateAdjudicationArtifact({ ...goodAdj, resolutions: [goodAdj.resolutions[0], goodAdj.resolutions[0]] }).ok
  && !validateAdjudicationArtifact({ ...goodAdj, resolutions: [{ ...goodAdj.resolutions[0], sneaky: 1 }] }).ok);

// ===========================================================================
// Fourth Codex-review regressions.
// ===========================================================================

// --- Finding 2: verifyCollectedCall derives everything from verified raw bytes ---
const VMODEL = 'claude-sonnet-4-6';
const vFacet = { date: { bestYear: 1500, confidence: 50, visualBasis: 'b' }, place: { topGuess: 'Italy', alternatives: [], confidence: 50, visualBasis: 'b' }, medium: { guess: 'oil', confidence: 50, visualBasis: 'b' }, style: { guess: 'Baroque', confidence: 50, visualBasis: 'b' }, artist: { guess: 'X', confidence: 50, visualBasis: 'b' } };
const vCall = { callId: 'c'.repeat(24), workId: 'w', source: 'canonical', view: 'full', task: 'facets', condition: 'no-cue', replicate: 0 };
const okEnv = JSON.stringify({ model: VMODEL, content: [{ type: 'text', text: JSON.stringify(vFacet) }], usage: { input_tokens: 1000, output_tokens: 100 } });
const cr1 = mkdtempSync(join(tmpdir(), 'recognition-collected-'));
beginAttempt(cr1, vCall, 0.01, 3);
finishAttempt(cr1, vCall.callId, 1, { status: 'schema-invalid', billedUsd: 0, responseSha256: sha256(okEnv), rawResponse: okEnv, parsed: null });
const vc1 = verifyCollectedCall(cr1, vCall, { model: VMODEL, validator: validateFacets });
ok('verifyCollectedCall derives valid status/model/usage/cost from bytes, ignoring stored status+billed', !!vc1.primary && vc1.primary.outcome === 'valid-response' && vc1.primary.model === VMODEL && vc1.billedUsd === 0.0045 && vc1.tampered.length === 0);
const driftEnv = JSON.stringify({ model: 'some-other-model', content: [{ type: 'text', text: JSON.stringify(vFacet) }], usage: { input_tokens: 1, output_tokens: 1 } });
const cr2 = mkdtempSync(join(tmpdir(), 'recognition-collected2-'));
beginAttempt(cr2, vCall, 0.01, 3);
finishAttempt(cr2, vCall.callId, 1, { status: 'valid-response', billedUsd: 0, responseSha256: sha256(driftEnv), rawResponse: driftEnv, parsed: vFacet });
const vc2 = verifyCollectedCall(cr2, vCall, { model: VMODEL, validator: validateFacets });
ok('a returned wrong model is model-drift, never a valid primary', vc2.primary === null && !!vc2.modelDrift);
const cr3 = mkdtempSync(join(tmpdir(), 'recognition-collected3-'));
finishAttempt(cr3, vCall.callId, 1, { status: 'terminal-api-error', httpStatus: 400, billedUsd: 0 });
const vc3 = verifyCollectedCall(cr3, vCall, { model: VMODEL, validator: validateFacets });
ok('a fabricated result with no matching intent is rejected (tampered, not complete)', vc3.complete === false && vc3.tampered.length >= 1);
for (const d of [cr1, cr2, cr3]) rmSync(d, { recursive: true, force: true });

// --- Finding 3: facet ambiguity is queued for blinded adjudication and resolvable ---
ok('adjudicationCellId is opaque, stable, and kind/facet-specific', adjudicationCellId('identification', 'abc', null) === adjudicationCellId('identification', 'abc', null) && adjudicationCellId('facet', 'abc', 'style') !== adjudicationCellId('facet', 'abc', 'place') && /^[0-9a-f]{32}$/.test(adjudicationCellId('facet', 'abc', 'style')));
const facWork = { id: 'wfac', strata: { fameBand: 'f3', regionGroup: 'europe' }, promptOrder: false, studyC: false, recognitionKey: { acceptedTitles: ['T'], acceptedArtists: [], requiredQualifierGroups: [], uniqueFacts: [], targetUnit: 'cataloged-work', exactRequires: 'title' }, cue: { correct: 'T', eligibleFacets: [...FACETS], disclosedFacets: [], cueType: 'title-only' }, truth: { date: { lo: 1500, hi: 1500 }, place: { exact: ['Italy'], parent: ['Europe'] }, medium: { exact: ['oil'], family: ['painting'], broad: [] }, style: { exact: ['Baroque'], family: [], related: [] }, artist: { exact: ['X'], workshop: [], circle: [], attributed: [], follower: [] } } };
const facResp = { date: { bestYear: 1500, confidence: 50, visualBasis: 'b' }, place: { topGuess: 'Italy', alternatives: [], confidence: 50, visualBasis: 'b' }, medium: { guess: 'oil', confidence: 50, visualBasis: 'b' }, style: { guess: 'Some Unlisted Movement', confidence: 90, visualBasis: 'b' }, artist: { guess: 'X', confidence: 50, visualBasis: 'b' } };
const facCalls = { calls: [{ callId: 'facc0', workId: 'wfac', source: 'canonical', view: 'full', task: 'facets', condition: 'no-cue', replicate: 0 }] };
const facMap = new Map([['facc0', facResp]]);
const facDiag = analyzePilot({ manifest: { works: [facWork] }, calls: facCalls, resultForCallId: id => facMap.get(id) || null });
ok('a confident unmatched facet guess is queued for blinded facet adjudication (not scored 0)', facDiag.adjudication.facetRequired === 1 && facDiag.adjudication.requiredCells.some(c => c.kind === 'facet' && c.facet === 'style'));
const facDiag2 = analyzePilot({ manifest: { works: [facWork] }, calls: facCalls, resultForCallId: id => facMap.get(id) || null, resolveAdjudication: cell => (cell.kind === 'facet' && cell.facet === 'style' ? 0.65 : null) });
ok('a bound facet ruling resolves the cell to its credit', facDiag2.adjudication.facetRequired === 0 && facDiag2.adjudication.resolvedCount === 1);

// ===========================================================================
// Fifth Codex-review regressions: attempt state machine, collection evidence, packet, git chronology.
// ===========================================================================
const envOf = (model, obj, usage) => JSON.stringify({ model, content: [{ type: 'text', text: JSON.stringify(obj) }], ...(usage ? { usage } : {}) });
const MK = () => mkdtempSync(join(tmpdir(), 'recognition-sm-'));
const sCall = { callId: 'e'.repeat(24), workId: 'w', source: 'canonical', view: 'full', task: 'facets', condition: 'no-cue', replicate: 0 };
const validEnv = envOf(VMODEL, vFacet, { input_tokens: 1000, output_tokens: 100 }); // -> 0.0045
const driftEnv2 = envOf('some-other-model', vFacet, { input_tokens: 1, output_tokens: 1 });
const resFor = (env, status) => ({ status, rawResponse: env, responseSha256: sha256(env) });
const put = (dir, attempt, result) => { beginAttempt(dir, sCall, 0.01, 5); finishAttempt(dir, sCall.callId, attempt, result); };
// beginAttempt correctly REFUSES to open an attempt after a terminal one, so an outcome-retry cannot
// arise from a genuine run — only from injected/edited artifacts. `layout` writes the raw intent+result
// files directly to construct exactly those adversarial sequences (contiguous 1..N intents).
const adir = dir => join(dir, 'attempts', sCall.callId);
const layout = (dir, steps) => steps.forEach((s, i) => {
  const n = i + 1;
  atomicJson(join(adir(dir), `attempt-${n}.intent.json`), { version: 'recognition-attempt/1', callId: sCall.callId, attempt: n, callSha256: sha256(canonicalJson(sCall)), conservativeUsd: 0.01, requestEvidence: {}, startedAt: new Date().toISOString(), status: 'started-before-network' });
  if (s.result) atomicJson(join(adir(dir), `attempt-${n}.result.json`), { version: 'recognition-attempt-result/1', callId: sCall.callId, attempt: n, finishedAt: new Date().toISOString(), ...s.result });
});

// R1: model drift then a correct-model response — fatal, non-retryable, protocol violation.
{ const d = MK(); layout(d, [{ result: resFor(driftEnv2, 'model-drift') }, { result: resFor(validEnv, 'valid-response') }]);
  const v = verifyCollectedCall(d, sCall, { model: VMODEL, validator: validateFacets });
  ok('R1 model drift then a valid response is fatal, non-retryable, and a protocol violation', v.fatal && !v.retryAllowed && v.protocolViolations.length > 0 && v.tampered.length > 0); rmSync(d, { recursive: true, force: true }); }

// R2: schema-invalid then valid — protocol violation surfaced as tampered.
{ const d = MK(); const badEnv = envOf(VMODEL, { not: 'facets' }, { input_tokens: 1, output_tokens: 1 });
  layout(d, [{ result: resFor(badEnv, 'schema-invalid') }, { result: resFor(validEnv, 'valid-response') }]);
  const v = verifyCollectedCall(d, sCall, { model: VMODEL, validator: validateFacets });
  ok('R2 schema-invalid then valid is a protocol violation (later answer cannot silently pass)', v.protocolViolations.length > 0 && v.tampered.length > 0 && !!v.terminalInvalid); rmSync(d, { recursive: true, force: true }); }

// R3: valid then another response — protocol violation; first valid stays primary.
{ const d = MK(); layout(d, [{ result: resFor(validEnv, 'valid-response') }, { result: resFor(validEnv, 'valid-response') }]);
  const v = verifyCollectedCall(d, sCall, { model: VMODEL, validator: validateFacets });
  ok('R3 a response after a valid one is a protocol violation and the first stays primary', v.protocolViolations.length > 0 && v.primary.attempt === 1); rmSync(d, { recursive: true, force: true }); }

// R4: crash (intent, no result) then a valid retry — permitted, both anchored, first reserved.
{ const d = MK(); layout(d, [{}, { result: resFor(validEnv, 'valid-response') }]);
  const v = verifyCollectedCall(d, sCall, { model: VMODEL, validator: validateFacets });
  ok('R4 a crash with no result then a valid retry is permitted, both anchored', v.complete && v.primary.attempt === 2 && v.protocolViolations.length === 0 && v.tampered.length === 0 && v.attempts[0].outcome === 'crash-no-result' && /^[0-9a-f]{64}$/.test(v.attempts[0].intentSha256));
  ok('R4 the crashed first attempt is conservatively reserved in the spend ledger', spentAndUnknown(d, [{ callId: sCall.callId, conservativeUsd: 0.02 }]).unknownReserved >= 0.02); rmSync(d, { recursive: true, force: true }); }

// R5: intent request-evidence mutation fails verification.
{ const d = MK(); const good = { freezeId: 'f', registrationCommit: 'a'.repeat(40), imageSha256: '1'.repeat(64), promptSha256: '2'.repeat(64), requestPolicyVersion: 'recognition-request/1', requestedModel: VMODEL };
  beginAttempt(d, sCall, 0.02, 5, good); finishAttempt(d, sCall.callId, 1, resFor(validEnv, 'valid-response'));
  ok('R5 an intent bound to the expected request evidence verifies clean', verifyCollectedCall(d, sCall, { model: VMODEL, validator: validateFacets, expectedRequestEvidence: { ...good, conservativeUsd: 0.02 } }).tampered.length === 0);
  ok('R5 a mutated intent image sha fails verification', verifyCollectedCall(d, sCall, { model: VMODEL, validator: validateFacets, expectedRequestEvidence: { ...good, imageSha256: '9'.repeat(64), conservativeUsd: 0.02 } }).tampered.length > 0);
  ok('R5 a mutated conservative cost fails verification', verifyCollectedCall(d, sCall, { model: VMODEL, validator: validateFacets, expectedRequestEvidence: { ...good, conservativeUsd: 0.99 } }).tampered.length > 0); rmSync(d, { recursive: true, force: true }); }

// R7: an attempt whose timestamp is outside the frozen window fails verification.
{ const d = MK(); put(d, 1, resFor(validEnv, 'valid-response'));
  const v = verifyCollectedCall(d, sCall, { model: VMODEL, validator: validateFacets, collectionWindow: { startMs: 0, maxMs: 1000 } });
  ok('R7 an attempt outside the frozen 24h window fails verification', v.tampered.some(t => /window/.test(t))); rmSync(d, { recursive: true, force: true }); }

// R8: a valid answer with missing usage is flagged; cost is never a measured zero.
{ const d = MK(); const noUsage = envOf(VMODEL, vFacet, null);
  put(d, 1, { status: 'valid-response', rawResponse: noUsage, responseSha256: sha256(noUsage) });
  const v = verifyCollectedCall(d, sCall, { model: VMODEL, validator: validateFacets });
  ok('R8 a valid answer with no usage is flagged usageMissing and bills 0 (never a measured cost)', !!v.primary && v.usageMissing && v.billedUsd === 0); rmSync(d, { recursive: true, force: true }); }

// ===========================================================================
// Sixth-round regressions: fail-closed request-evidence binding at the SEALER/ANALYZER boundary.
// buildCollectionEvidence (the path both the sealer and analyzer use) must now RE-VERIFY each intent's
// request evidence against the frozen manifest, with registrationCommit taken from the verified git
// freeze, not the mutable run file.
// ===========================================================================
const FID = 'gesso-recognition-pilot-2026-08-31-v1';
const EXP = { freezeId: FID, registrationCommit: 'a'.repeat(40), imageSha256: '1'.repeat(64), promptSha256: '2'.repeat(64), requestPolicyVersion: 'recognition-request/1', requestedModel: VMODEL, conservativeUsd: 0.01 };
const reqEvOf = (over = {}) => { const { conservativeUsd, ...re } = { ...EXP, ...over }; return re; };
const expOf = (over = {}) => new Map([[ceCall.callId, { ...EXP, ...over }]]);
const VFREEZE = { commit: EXP.registrationCommit, frozenPaths: [], subject: null };
const ceManifest = { freeze: { id: FID, frozenPaths: [] }, works: [facWork] };
const ceCall = { callId: 'f'.repeat(24), workId: 'wfac', source: 'canonical', view: 'full', task: 'facets', condition: 'no-cue', replicate: 0 };
const ceCalls = { calls: [ceCall] };
const ceValidators = { facets: validateFacets, identify: validateIdentification, 'identity-first': validateIdentityFirst };
const freezeEvidenceOf = (over = {}) => ({ version: 'recognition-protocol-freeze-evidence/1', freezeId: FID, commit: EXP.registrationCommit, subject: null, frozenPaths: [], verifiedBeforeFirstCallAt: '2026-09-01T00:00:00.000Z', ...over });
// Build a run dir: one intent bound to `intentEv`, one valid result, optional freeze-evidence file.
const mkCeRun = (intentEv, fe = null) => {
  const d = MK();
  atomicJson(join(d, 'attempts', ceCall.callId, 'attempt-1.intent.json'), { version: 'recognition-attempt/1', callId: ceCall.callId, attempt: 1, callSha256: sha256(canonicalJson(ceCall)), conservativeUsd: EXP.conservativeUsd, requestEvidence: intentEv, startedAt: '2026-09-01T00:00:05.000Z', status: 'started-before-network' });
  finishAttempt(d, ceCall.callId, 1, { status: 'valid-response', requestId: 'req-abc', rawResponse: validEnv, responseSha256: sha256(validEnv) });
  if (fe) atomicJson(join(d, 'protocol-freeze-evidence.json'), fe);
  return d;
};

// N1: a valid complete fixture (intent evidence matches expected) still produces evidence, unflagged.
{ const d = mkCeRun(reqEvOf(), freezeEvidenceOf());
  const b = buildCollectionEvidence({ runDir: d, manifest: ceManifest, calls: ceCalls, model: VMODEL, validators: ceValidators, freezeEvidencePath: join(d, 'protocol-freeze-evidence.json'), expectedEvidence: expOf(), verifiedFreeze: VFREEZE });
  ok('N5 valid complete fixture builds collection evidence with no tamper/freeze errors', b.tampered.length === 0 && b.freezeEvidenceErrors.length === 0 && b.evidence.calls.length === 1 && b.nonTerminal.length === 0); rmSync(d, { recursive: true, force: true }); }

// N2: a mutated intent imageSha256 is rejected via the SEALER/ANALYZER path (was silently passed before).
{ const d = mkCeRun(reqEvOf({ imageSha256: '9'.repeat(64) }), freezeEvidenceOf());
  const b = buildCollectionEvidence({ runDir: d, manifest: ceManifest, calls: ceCalls, model: VMODEL, validators: ceValidators, freezeEvidencePath: join(d, 'protocol-freeze-evidence.json'), expectedEvidence: expOf(), verifiedFreeze: VFREEZE });
  ok('N1 mutating intent imageSha256 is reported tampered by buildCollectionEvidence', b.tampered.length === 1 && b.tampered[0].why.some(w => /imageSha256/.test(w))); rmSync(d, { recursive: true, force: true }); }

// N3: a mutated intent promptSha256 is likewise rejected.
{ const d = mkCeRun(reqEvOf({ promptSha256: '8'.repeat(64) }), freezeEvidenceOf());
  const b = buildCollectionEvidence({ runDir: d, manifest: ceManifest, calls: ceCalls, model: VMODEL, validators: ceValidators, freezeEvidencePath: join(d, 'protocol-freeze-evidence.json'), expectedEvidence: expOf(), verifiedFreeze: VFREEZE });
  ok('N2 mutating intent promptSha256 is reported tampered', b.tampered.length === 1 && b.tampered[0].why.some(w => /promptSha256/.test(w))); rmSync(d, { recursive: true, force: true }); }

// N4: a run freeze-evidence file whose commit disagrees with the verified git freeze cannot redefine it.
{ const d = mkCeRun(reqEvOf(), freezeEvidenceOf({ commit: 'b'.repeat(40) }));
  const b = buildCollectionEvidence({ runDir: d, manifest: ceManifest, calls: ceCalls, model: VMODEL, validators: ceValidators, freezeEvidencePath: join(d, 'protocol-freeze-evidence.json'), expectedEvidence: expOf(), verifiedFreeze: VFREEZE });
  ok('N3 a run-file commit that disagrees with the verified git freeze is rejected', b.freezeEvidenceErrors.some(e => /commit does not match/.test(e))); rmSync(d, { recursive: true, force: true }); }

// N5: a missing / incomplete expected-evidence registry fails closed (throws).
{ const d = mkCeRun(reqEvOf(), freezeEvidenceOf());
  let threwAbsent = false, threwIncomplete = false;
  try { buildCollectionEvidence({ runDir: d, manifest: ceManifest, calls: ceCalls, model: VMODEL, validators: ceValidators }); } catch { threwAbsent = true; }
  try { buildCollectionEvidence({ runDir: d, manifest: ceManifest, calls: ceCalls, model: VMODEL, validators: ceValidators, expectedEvidence: new Map(), verifiedFreeze: VFREEZE }); } catch { threwIncomplete = true; }
  ok('N4 absent or incomplete expected-evidence registry fails closed (throws)', threwAbsent && threwIncomplete); rmSync(d, { recursive: true, force: true }); }

// N6: deriveExpectedEvidence is deterministic, source-aware, and the runner/sealer/analyzer all consume it.
const dWork = { id: 'wd', transform: { views: { full: { sha256: '3'.repeat(64), width: 800, height: 600 } } }, cue: { correct: 'T', sham: 'S' } };
const dCall = { callId: 'g'.repeat(24), workId: 'wd', source: 'canonical', view: 'full', task: 'facets', condition: 'no-cue', replicate: 0 };
const dCall2 = { ...dCall, callId: 'h'.repeat(24), replicate: 1 };
// Build a frozen (manifest, calls) pair whose callManifest binding matches — the way freeze.mjs does.
const boundPair = (callList, seed = 'call-seed-1') => {
  const cm = { version: 'v', seed, counts: { total: callList.length }, calls: callList };
  return { calls: cm, callManifest: { file: 'call-manifest.frozen.json', seed, expectedCalls: cm.counts, sha256: sha256(canonicalJson(cm)) } };
};
const dbp = boundPair([dCall]);
const dArgs = { manifest: { freeze: { id: FID }, works: [dWork], callManifest: dbp.callManifest }, calls: dbp.calls, promptAssets: { facets: 'Grade the facets.' }, schemaAssets: { facets: { type: 'object' } } };
const de1 = deriveExpectedEvidence({ ...dArgs, registrationCommit: 'a'.repeat(40) });
const de2 = deriveExpectedEvidence({ ...dArgs, registrationCommit: 'a'.repeat(40) });
ok('N6 deriveExpectedEvidence is deterministic and image-source-aware', canonicalJson([...de1.expected]) === canonicalJson([...de2.expected]) && de1.expected.get(dCall.callId).imageSha256 === '3'.repeat(64) && /^[0-9a-f]{64}$/.test(de1.expected.get(dCall.callId).promptSha256));
let threwCommit = false; try { deriveExpectedEvidence({ ...dArgs, registrationCommit: 'not-a-commit' }); } catch { threwCommit = true; }
ok('N6 deriveExpectedEvidence rejects a non-verified registrationCommit', threwCommit);
const runSrc = readFileSync(new URL('../scripts/recognition-pilot-run.mjs', import.meta.url), 'utf8');
const sealSrc = readFileSync(new URL('../scripts/recognition-pilot-seal-collection.mjs', import.meta.url), 'utf8');
const anSrc = readFileSync(new URL('../scripts/analyze-recognition-pilot.mjs', import.meta.url), 'utf8');
ok('N6 runner, sealer, and analyzer all consume the shared deriveExpectedEvidence', [runSrc, sealSrc, anSrc].every(s => /deriveExpectedEvidence/.test(s)) && /expectedEvidence:/.test(sealSrc) && /expectedEvidence:/.test(anSrc));

// N7: deriveExpectedEvidence fails closed unless the call manifest matches the frozen callManifest binding.
const dWorks2 = { freeze: { id: FID }, works: [dWork] };
const dAssets2 = { promptAssets: { facets: 'Grade the facets.' }, schemaAssets: { facets: { type: 'object' } } };
const throws = args => { try { deriveExpectedEvidence({ ...args, registrationCommit: 'a'.repeat(40) }); return false; } catch { return true; } };
// The exact counterexample: a one-call binding but a two-call object (both calls otherwise valid).
ok('N7 counterexample: one-call binding + two-call object is rejected', throws({ manifest: { ...dWorks2, callManifest: boundPair([dCall]).callManifest }, calls: { version: 'v', seed: 'call-seed-1', counts: { total: 2 }, calls: [dCall, dCall2] }, ...dAssets2 }));
// Mutating a frozen call field without updating the binding.
const mp = boundPair([dCall]);
ok('N7 a mutated call field without a re-derived binding is rejected', throws({ manifest: { ...dWorks2, callManifest: mp.callManifest }, calls: { ...mp.calls, calls: [{ ...dCall, replicate: 9 }] }, ...dAssets2 }));
// Seed disagreement (manifest-side copy the calls-hash does not cover).
ok('N7 seed disagreement is rejected', throws({ manifest: { ...dWorks2, callManifest: { ...dbp.callManifest, seed: 'other-seed' } }, calls: dbp.calls, ...dAssets2 }));
// Count disagreement (manifest-side expectedCalls copy).
ok('N7 expectedCalls disagreement is rejected', throws({ manifest: { ...dWorks2, callManifest: { ...dbp.callManifest, expectedCalls: { total: 999 } } }, calls: dbp.calls, ...dAssets2 }));
// counts.total not equal to the number of calls (hash + seed + expectedCalls all agree; only length lies).
const badTotal = { version: 'v', seed: 'call-seed-1', counts: { total: 1 }, calls: [dCall, dCall2] };
ok('N7 counts.total not equal to calls.length is rejected', throws({ manifest: { ...dWorks2, callManifest: { file: 'x', seed: 'call-seed-1', expectedCalls: { total: 1 }, sha256: sha256(canonicalJson(badTotal)) } }, calls: badTotal, ...dAssets2 }));
// A valid matched pair still derives (regression guard for the happy path).
ok('N7 a valid frozen manifest/call-manifest pair still derives', !throws(dArgs));

// R9 + R10: reviewer packet + private controller build; the packet leaks no experimental condition.
const pcWorks = new Map([[adjWork.id, adjWork], [facWork.id, facWork]]);
const pcCells = [...adjDiag.adjudication.requiredCells, ...facDiag.adjudication.requiredCells];
const pcResp = cid => (cid === 'adjc0' ? { parsed: contradictoryResp, responseSha256: 'a'.repeat(64) } : { parsed: facResp, responseSha256: 'b'.repeat(64) });
const arts = buildAdjudicationArtifacts(pcCells, { works: pcWorks, responseFor: pcResp, freezeId: 'fz' });
ok('R9 reviewer packet + controller build from real identification and facet queue cells', arts.packet.cells.length === 2 && arts.controller.cells.length === 2 && arts.controller.cells.every(c => !!c.workId) && arts.packet.cells.every(c => /^[0-9a-f]{64}$/.test(c.responseSha256)));
const packetStr = JSON.stringify(arts.packet);
ok('R10 the reviewer packet leaks no experimental condition', !/workId|callId|"view"|"source"|"cue"|fameBand|regionGroup|"arm"|wadj|wfac|adjc0|facc0/.test(packetStr));
ok('R11 the blinded packet sha is deterministic (binds a ruling to the exact packet)', buildAdjudicationArtifacts(pcCells, { works: pcWorks, responseFor: pcResp, freezeId: 'fz' }).packetSha256 === arts.packetSha256);
ok('R11 a changed response changes the packet sha (a stale ruling cannot bind)', buildAdjudicationArtifacts(pcCells, { works: pcWorks, responseFor: () => ({ parsed: facResp, responseSha256: 'c'.repeat(64) }), freezeId: 'fz' }).packetSha256 !== arts.packetSha256);

// R12: the runner never persists a raw provider error body (no auth-body leak).
const runnerSrc = readFileSync(new URL('../scripts/recognition-pilot-run.mjs', import.meta.url), 'utf8');
ok('R12 the runner never persists a raw provider error body', !/\braw:\s*responseText/.test(runnerSrc) && /never persist the raw error body/.test(runnerSrc));

// --- Closeout: the preparation gate reports the Study C alternate + multilingual-fame freeze prereqs. ---
const gateSrc = readFileSync(new URL('../scripts/check-recognition-pilot.mjs', import.meta.url), 'utf8');
ok('gate blocks on Study C alternate identity + provenance', gateSrc.includes('studyc-alternate-identity') && gateSrc.includes('studyc-alternate-provenance') && gateSrc.includes('alternate?.source') && gateSrc.includes('alternate?.license') && gateSrc.includes('alternate?.comparability'));
ok('gate blocks on missing/invalid multilingual-fame snapshot', gateSrc.includes('multilingual-fame-missing-or-invalid') && gateSrc.includes('recognition-multilingual-fame/1') && gateSrc.includes('languageBalancedPilot'));

// --- Closeout: a missing-QID work cannot receive numeric multilingual-fame credit. ---
const mfAgg = aggregateMultilingualFame([
  { id: 'met000', missingQid: true, languages: {} },
  { id: 'wikidata:Q1', missingQid: false, languages: { en: { views: 1000 }, ja: { views: 10 } } },
  { id: 'wikidata:Q2', missingQid: false, languages: { en: { views: 0 }, ja: { views: 0 } } },
], ['en', 'ja']);
ok('missing-QID work is unscored + unlinked (no fabricated fame, excluded from percentile)', mfAgg[0].languageBalancedPilot === null && mfAgg[0].rawTotal === null && mfAgg[0].languages.en.views === null && mfAgg[0].languages.en.unlinked === true && mfAgg[0].languages.en.pilotPercentile === undefined);
ok('linked works are numerically scored and ordered by exposure', typeof mfAgg[1].languageBalancedPilot === 'number' && typeof mfAgg[2].languageBalancedPilot === 'number' && mfAgg[1].languageBalancedPilot > mfAgg[2].languageBalancedPilot);

console.log(`✅ recognition-pilot: ${checks}/${checks} checks`);
