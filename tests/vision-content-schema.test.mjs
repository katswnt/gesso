import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CONTENT_VISION_SCHEMA, buildB2Input, buildStageCompletion, parseStageBody,
  validateStageBody, validateStageCompletion, isCorroboratingSource, sourceHost,
  PLAYER_WHY_MAX, PLAYER_NOTE_BODY_MAX, GUIDE_MIN, GUIDE_MAX, GUIDE_ANSWER_MAX,
} from '../scripts/lib/vision-content-schema.mjs';
import { captureStageCompletion, verifyCapturedStage } from '../scripts/lib/vision-content-capture.mjs';

let passed = 0;
function ok(name, condition) { assert.equal(condition, true, name); passed++; console.log(`ok - ${name}`); }
const clone = value => structuredClone(value);
const na = reason => ({ notApplicable: true, reason });

const evidence = {
  when: [{ evidenceId: 'e_when_1', feature: 'pointed arch', why: 'Supports a medieval date.', bbox: [0.1, 0.1, 0.2, 0.2], confidence: 0.8 }],
  where: [], medium: [], style: [], artist: [], format: [],
};
const visual = {
  pose: 'standing', gesture: 'raised hand', gaze: 'left', bodyOrientation: 'frontal',
  relationships: 'one central figure', tone: 'warm', format: 'vertical',
  composition: 'centralized', viewpoint: 'frontal', subject: 'standing figure',
  objectFunction: na('Not visible from this view.'), material: 'painted surface',
  surface: 'matte', technique: 'layered color', condition: 'stable', damage: na('None visible.'),
  signature: na('No signature visible.'), inscriptions: na('No inscription visible.'),
  photoArtifacts: na('No photographic artifact visible.'),
  figures: [{ who: 'standing figure', role: 'subject' }],
  palette: { colors: ['red', 'blue'], character: 'saturated' }, lighting: 'diffuse',
  iconography: ['raised hand'],
  delights: [{ delightId: 'd_1', note: 'A tiny red accent.', bbox: [0.2, 0.2, 0.1, 0.1], confidence: 0.7 }],
};
const b1 = {
  imageFitness: { ok: true, issue: 'none', quality: 'good', framing: 'ok', mediumLegible: true, imageState: 'usable', reason: '', suggestedUrl: null },
  playable: true, playableReason: 'Several visible clues support inference.', noPinsVerdict: false,
  seen: 'A standing figure under a pointed arch.', evidence, visual,
  tags: { controlled: ['figure'], free: ['pointed arch'] },
  noteCandidates: [{ noteId: 'n_1', head: 'Pointed arch', body: 'The pointed arch frames the figure.', pin: { x: 20, y: 20 }, role: 'diagnostic', confidence: 0.8, evidenceRef: 'e_when_1' }],
  researchQuestions: [{ questionId: 'q_1', topic: 'date', evidenceId: 'e_when_1' }],
  uncertainty: '',
};
const source = { sourceId: 's_1', url: 'https://museum.example/object', title: 'Museum record', retrievedAt: '2026-09-02T00:00:00Z' };
const catalog = {
  mediumFull: 'tempera on panel', anonReason: na('Named maker.'), living: false,
  movementSuggestion: 'Gothic', styleKind: 'period', provenanceNote: na('No special note.'),
  displacementCue: na('No documented cue.'), sensitivity: [],
};
const b2 = {
  catalog,
  factChecks: [{ claimId: 'c_1', claim: 'The work was made in the fourteenth century.', verdict: 'supported', confidence: 0.9, sources: [source] }],
  guideAnswers: Array.from({ length: 5 }, (_, i) => ({ questionId: `g_${i + 1}`, q: `What does detail ${i + 1} show?`, a: 'It connects a visible detail to the work context.', kind: i ? 'context' : 'image', evidenceRef: i ? null : 'e_when_1', sourceRefs: ['s_1'] })),
  targetedVerificationRequests: [{ requestId: 'r_1', claimId: 'c_1', whatToLocate: 'Look for a dated inscription.' }],
  uncertainty: '',
};
const b3 = { verifications: [{ requestId: 'r_1', found: false, bbox: null, note: 'No dated inscription is visible.', confidence: 0.8 }], uncertainty: '' };
const b4Notes = Array.from({ length: 5 }, (_, i) => ({ noteId: `pn_${i + 1}`, head: `Detail ${i + 1}`, body: 'This detail supports a specific visual lesson.', pin: i ? null : { x: 20, y: 20 }, role: i ? 'technique' : 'diagnostic', evidenceRef: 'e_when_1', sourceRefs: ['s_1'] }));
const b4Guide = Array.from({ length: 5 }, (_, i) => ({ questionId: `pg_${i + 1}`, q: `Why does detail ${i + 1} matter here?`, a: 'It links the visible evidence to a supported historical context.', kind: i < 3 ? 'image' : 'context', evidenceRef: i < 3 ? 'e_when_1' : null, sourceRefs: ['s_1'] }));
const b4 = {
  imageState: 'usable', playable: true, playableReason: 'The work has specific visual clues.',
  catsAdjustments: { removeMedium: false },
  dispositions: [
    { component: 'why', disposition: 'revise', reason: 'sharper one-liner' }, { component: 'cues', disposition: 'keep', reason: 'still accurate' },
    { component: 'notes', disposition: 'revise', reason: 'reground on a visible feature' }, { component: 'hotspots', disposition: 'add', reason: 'add a diagnostic pin' },
    { component: 'guide', disposition: 'add', reason: 'add a technique question' }, { component: 'imageState', disposition: 'keep', reason: 'usable' },
    { component: 'playability', disposition: 'keep', reason: 'clear anchors' },
  ],
  proposedWhy: 'A pointed-arch interior that dates and places the scene.',
  proposedCues: ['pointed arch → Gothic', 'oil sheen → oil on panel'],
  notes: b4Notes,
  hotspots: [{ hotspotId: 'h_1', observationId: 'pn_1', x: 20, y: 20, region: null, rank: 1, role: 'diagnostic', conciseText: 'Pointed arch', deepText: 'The same pointed arch anchors the longer lesson.', evidenceRef: 'e_when_1', confidence: 0.8, sourceDependent: false }],
  guide: b4Guide, richDescriptors: { visual, catalog, tags: b1.tags }, evidence,
  sources: [source], corrections: { consequential: [] }, conflicts: [], uncertainty: '',
};

ok('B1 fixture is valid', validateStageBody('B1', b1).ok);
// Canary-found robustness: a malformed (non-array) evidence axis must be recorded schema-invalid, never crash.
ok('malformed evidence axis is rejected, not thrown', (() => { try { const r = validateStageBody('B1', { ...b1, evidence: { ...b1.evidence, when: { notAnArray: true } } }); return r.ok === false; } catch { return false; } })());
ok('B2 fixture resolves B1 evidence references', validateStageBody('B2', b2, { evidenceIds: ['e_when_1'] }).ok);
ok('B3 fixture resolves B2 request references', validateStageBody('B3', b3, { requestIds: ['r_1'] }).ok);
ok('B4 fixture is valid and enforces five notes/guides for playable work', validateStageBody('B4', b4).ok);

// VSD-022 mop-up: internal free-text caps relaxed so blind/verbose research prose isn't rejected on length
// (validator-only, runId-stable). B4 caps are deliberately left untouched (owner hold on B4).
const bigStr = (n) => 'x'.repeat(n);
ok('B1 uncertainty accepts up to 2000 chars (was 1000)', validateStageBody('B1', { ...clone(b1), uncertainty: bigStr(1500) }).ok);
ok('B1 uncertainty still rejects beyond 2000', !validateStageBody('B1', { ...clone(b1), uncertainty: bigStr(2500) }).ok);
{ const v = clone(b2); v.catalog.mediumFull = bigStr(700); ok('B2 catalog.mediumFull accepts up to 800 chars (was 500)', validateStageBody('B2', v, { evidenceIds: ['e_when_1'] }).ok); }
{ const v = clone(b2); v.catalog.mediumFull = bigStr(900); ok('B2 catalog.mediumFull still rejects beyond 800', !validateStageBody('B2', v, { evidenceIds: ['e_when_1'] }).ok); }
{ const v = clone(b3); v.verifications[0] = { requestId: 'r_1', found: true, bbox: [0, 0, 1, 1], note: bigStr(1500), confidence: 0.7 }; ok('B3 verification note accepts up to 2000 chars (was 1000)', validateStageBody('B3', v, { requestIds: ['r_1'] }).ok); }
{ const v = clone(b3); v.verifications[0] = { requestId: 'r_1', found: true, bbox: [0, 0, 1, 1], note: bigStr(2500), confidence: 0.7 }; ok('B3 verification note still rejects beyond 2000', !validateStageBody('B3', v, { requestIds: ['r_1'] }).ok); }
{ const v = clone(b4); v.uncertainty = bigStr(1500); ok('B4 uncertainty cap stays at 1000', !validateStageBody('B4', v).ok); }
// VSD-023: player-copy caps restored to proposedWhy=500, note body=600 (shared constants; brevity is editorial).
{ const v = clone(b4); v.proposedWhy = 'w'.repeat(480); ok('B4 proposedWhy accepts up to 500 chars', validateStageBody('B4', v).ok); }
{ const v = clone(b4); v.proposedWhy = 'w'.repeat(650); ok('B4 proposedWhy rejects beyond 500 (no accept-then-truncate)', !validateStageBody('B4', v).ok); }
{ const v = clone(b4); v.notes[0].body = 'b'.repeat(560); ok('B4 published note body accepts up to 600 chars', validateStageBody('B4', v).ok); }
{ const v = clone(b4); v.notes[0].body = 'b'.repeat(650); ok('B4 published note body rejects beyond 600 (no accept-then-truncate)', !validateStageBody('B4', v).ok); }
// VSD-025: B4 guide contract (playable) — 5-7, strict image majority, image needs a resolving evidenceRef, answer<=700.
ok('guide contract constants: 5/7/700', GUIDE_MIN === 5 && GUIDE_MAX === 7 && GUIDE_ANSWER_MAX === 700);
{ const v = clone(b4); v.guide.push({ ...clone(v.guide[0]), questionId: 'pg_6' }, { ...clone(v.guide[0]), questionId: 'pg_7' }, { ...clone(v.guide[0]), questionId: 'pg_8' }); ok('B4 guide rejects more than 7 items', !validateStageBody('B4', v).ok); }
{ const v = clone(b4); v.guide = v.guide.slice(0, 4); ok('B4 guide rejects fewer than 5 items when playable', !validateStageBody('B4', v).ok); }
{ const v = clone(b4); v.guide = v.guide.map((g, i) => ({ ...g, kind: i < 2 ? 'image' : 'context', evidenceRef: i < 2 ? 'e_when_1' : null })); ok('B4 guide rejects a non-image majority (2 image / 3 context)', !validateStageBody('B4', v).ok); }
{ const v = clone(b4); v.guide[0].kind = 'image'; v.guide[0].evidenceRef = null; ok('B4 guide rejects a kind:image item with null evidenceRef', !validateStageBody('B4', v).ok); }
{ const v = clone(b4); v.guide[0].kind = 'image'; v.guide[0].evidenceRef = 'made_up_id'; ok('B4 guide rejects a kind:image item whose evidenceRef does not resolve', !validateStageBody('B4', v).ok); }
{ const v = clone(b4); v.guide[0].a = 'x'.repeat(690); ok('B4 guide answer accepts up to 700', validateStageBody('B4', v).ok); }
{ const v = clone(b4); v.guide[0].a = 'x'.repeat(750); ok('B4 guide answer rejects beyond 700 (no accept-then-truncate)', !validateStageBody('B4', v).ok); }
ok('player caps: PLAYER_WHY_MAX=500, PLAYER_NOTE_BODY_MAX=600', PLAYER_WHY_MAX === 500 && PLAYER_NOTE_BODY_MAX === 600);
// Source-host normalization (VSD-023): decode/lowercase/strip terminal dots before the denylist.
ok('host norm: en.wikipedia.org is non-corroborating', isCorroboratingSource('https://en.wikipedia.org/wiki/X') === false);
ok('host norm: foo.blogspot.com is non-corroborating', isCorroboratingSource('https://foo.blogspot.com/p') === false);
ok('host norm: en.wikipedia.org%2e (encoded trailing dot) is non-corroborating', isCorroboratingSource('https://en.wikipedia.org%2e/wiki/X') === false);
ok('host norm: trailing-dot FQDN en.wikipedia.org. is non-corroborating', isCorroboratingSource('https://en.wikipedia.org./wiki/X') === false);

{ const v = clone(b1); v.extra = true; ok('B1 rejects extra top-level keys', !validateStageBody('B1', v).ok); }
{ const v = clone(b1); v.imageFitness.issue = 'wrong-art'; ok('B1 rejects image ok/issue contradiction', !validateStageBody('B1', v).ok); }
{ const v = clone(b1); v.evidence.where = [clone(v.evidence.when[0])]; ok('B1 rejects duplicate evidence ids', !validateStageBody('B1', v).ok); }
{ const v = clone(b1); v.noteCandidates[0].evidenceRef = 'e_missing'; ok('B1 rejects dangling note evidenceRef', !validateStageBody('B1', v).ok); }
{ const v = clone(b1); v.researchQuestions[0].evidenceId = 'd_1'; ok('B1 research question may reference a delight id (union with evidence)', validateStageBody('B1', v).ok); }
{ const v = clone(b1); v.researchQuestions[0].evidenceId = 'nope'; ok('B1 rejects a dangling research-question evidenceId', !validateStageBody('B1', v).ok); }
{ const v = clone(b1); v.noPinsVerdict = true; ok('B1 rejects no-pins plus a pinned note', !validateStageBody('B1', v).ok); }
{ const v = clone(b1); v.evidence.when[0].bbox = [0, 0, 2, 1]; ok('B1 rejects out-of-range bbox', !validateStageBody('B1', v).ok); }

const b2Input = buildB2Input({ workId: 'work_1', trustedCatalog: { title: 'Title', artist: 'Artist', date: '1300', place: 'Italy', medium: 'Tempera', style: 'Gothic', catalogId: 'museum:1' }, b1 });
const b2InputText = JSON.stringify(b2Input);
ok('B2 boundary includes coded signals and stable refs', b2Input.visibleSignals[0].evidenceId === 'e_when_1' && b2Input.researchQuestions[0].topic === 'date');
ok('B2 boundary excludes raw B1 feature/why/seen prose', !b2InputText.includes('pointed arch') && !b2InputText.includes('medieval date') && !b2InputText.includes('standing figure'));
{ const v = clone(b2); v.factChecks[0].sources[0].url = 'http://museum.example'; ok('B2 rejects non-HTTPS sources', !validateStageBody('B2', v, { evidenceIds: ['e_when_1'] }).ok); }
{ const v = clone(b2); v.targetedVerificationRequests[0].claimId = 'c_missing'; ok('B2 rejects dangling claim refs', !validateStageBody('B2', v, { evidenceIds: ['e_when_1'] }).ok); }
{ const v = clone(b2); v.guideAnswers.length = 4; ok('B2 rejects fewer than five guide answers', !validateStageBody('B2', v, { evidenceIds: ['e_when_1'] }).ok); }
{ const v = clone(b2); v.factChecks.push({ ...clone(v.factChecks[0]), claimId: 'c_2', sources: [{ ...source, url: 'https://other.example' }] }); ok('B2 rejects one sourceId bound to conflicting source records', !validateStageBody('B2', v, { evidenceIds: ['e_when_1'] }).ok); }

// Source-grounding rule: supported/refuted must be sourced; unresolved may cite none; every guide answer must cite a source.
// A second factCheck re-declares s_1 so guide answers stay valid while the factCheck source rule is probed in isolation.
const withKeep = () => { const v = clone(b2); v.factChecks.push({ claimId: 'c_keep', claim: 'A sourced claim that keeps s_1 declared.', verdict: 'supported', confidence: 0.8, sources: [source] }); return v; };
{ const v = clone(b2); v.factChecks.push({ claimId: 'c_u', claim: 'A detail whose date cannot be pinned from available sources.', verdict: 'unresolved', confidence: 0.3, sources: [] }); ok('B2 allows an unresolved factCheck with zero sources', validateStageBody('B2', v, { evidenceIds: ['e_when_1'] }).ok); }
{ const v = withKeep(); v.factChecks[0].sources = []; ok('B2 rejects a supported factCheck with no source', !validateStageBody('B2', v, { evidenceIds: ['e_when_1'] }).ok); }
{ const v = withKeep(); v.factChecks[0].verdict = 'refuted'; v.factChecks[0].sources = []; ok('B2 rejects a refuted factCheck with no source', !validateStageBody('B2', v, { evidenceIds: ['e_when_1'] }).ok); }
{ const v = clone(b2); v.guideAnswers[0].sourceRefs = []; ok('B2 rejects a guide answer that cites no source', !validateStageBody('B2', v, { evidenceIds: ['e_when_1'] }).ok); }

// ---- B2 v2 (VSD-022): qualified/partlySupported verdicts + authoritative-source rule for high-conf refutations ----
{ const v = clone(b2); v.factChecks[0].verdict = 'qualified'; ok('B2 accepts a qualified verdict (with a source)', validateStageBody('B2', v, { evidenceIds: ['e_when_1'] }).ok); }
{ const v = clone(b2); v.factChecks[0].verdict = 'partlySupported'; ok('B2 accepts partlySupported', validateStageBody('B2', v, { evidenceIds: ['e_when_1'] }).ok); }
{ const v = clone(b2); v.factChecks[0].verdict = 'qualified'; v.factChecks[0].sources = []; ok('B2 rejects a qualified verdict with no source', !validateStageBody('B2', v, { evidenceIds: ['e_when_1'] }).ok); }
// Clouet lesson, encoded structurally: a confident refutation cannot rest on Wikipedia alone.
{ const v = clone(b2); v.factChecks[0].verdict = 'refuted'; v.factChecks[0].confidence = 0.9; v.factChecks[0].sources = [{ ...source, url: 'https://en.wikipedia.org/wiki/Jean_Clouet' }]; ok('B2 rejects a high-confidence refutation sourced only from Wikipedia (Clouet lesson)', !validateStageBody('B2', v, { evidenceIds: ['e_when_1'] }).ok); }
{ const v = clone(b2); v.factChecks[0].verdict = 'refuted'; v.factChecks[0].confidence = 0.9; v.factChecks[0].sources = [{ ...source, url: 'https://www.clevelandart.org/art/1' }]; ok('B2 accepts a high-confidence refutation backed by an authoritative (non-Wikipedia) source', validateStageBody('B2', v, { evidenceIds: ['e_when_1'] }).ok); }
{ const v = clone(b2); v.factChecks[0].verdict = 'refuted'; v.factChecks[0].confidence = 0.6; v.factChecks[0].sources = [{ ...source, url: 'https://en.wikipedia.org/wiki/X' }]; ok('B2 allows a LOW-confidence refutation from Wikipedia (authority rule is for high confidence only)', validateStageBody('B2', v, { evidenceIds: ['e_when_1'] }).ok); }
// Source-authority classifier proves the ACTUAL policy (host-parsed), not merely "not Wikipedia".
ok('isCorroboratingSource: real museum host corroborates', isCorroboratingSource('https://www.clevelandart.org/art/1') === true);
ok('isCorroboratingSource: encoded-dot wikipedia evasion is rejected (host parse, not substring)', isCorroboratingSource('https://en.wikipedia%2Eorg/wiki/X') === false);
ok('isCorroboratingSource: museum URL with "wikipedia.org" in the PATH still corroborates', isCorroboratingSource('https://www.metmuseum.org/art/wikipedia.org/1') === true);
ok('isCorroboratingSource: blog/UGC host does NOT corroborate', isCorroboratingSource('https://someone.blogspot.com/post') === false && isCorroboratingSource('https://foo.wordpress.com/x') === false);
ok('isCorroboratingSource: malformed URL cannot corroborate', isCorroboratingSource('not a url') === false);
ok('sourceHost strips www and lowercases', sourceHost('https://WWW.Example.ORG/x') === 'example.org');
{ const v = clone(b2); v.factChecks[0].verdict = 'refuted'; v.factChecks[0].confidence = 0.9; v.factChecks[0].sources = [{ ...source, url: 'https://en.wikipedia%2Eorg/wiki/X' }]; ok('B2 rejects a high-conf refutation whose only source is an encoded-dot wikipedia evasion', !validateStageBody('B2', v, { evidenceIds: ['e_when_1'] }).ok); }
{ const v = clone(b2); v.factChecks[0].verdict = 'refuted'; v.factChecks[0].confidence = 0.9; v.factChecks[0].sources = [{ ...source, url: 'https://x.blogspot.com/p' }]; ok('B2 rejects a high-conf refutation whose only source is a blog host', !validateStageBody('B2', v, { evidenceIds: ['e_when_1'] }).ok); }

{ const v = clone(b3); v.verifications[0].requestId = 'r_missing'; ok('B3 rejects unknown requests', !validateStageBody('B3', v, { requestIds: ['r_1'] }).ok); }
{ const v = clone(b3); v.verifications[0].bbox = [0, 0, 0.1, 0.1]; ok('B3 rejects a bbox when found is false', !validateStageBody('B3', v, { requestIds: ['r_1'] }).ok); }
{ const v = clone(b4); v.notes.pop(); ok('B4 rejects fewer than five notes on a playable work', !validateStageBody('B4', v).ok); }
{ const v = clone(b4); v.hotspots[0].region = { x: 1, y: 1, w: 2, h: 2 }; ok('B4 hotspot must be a point XOR a region', !validateStageBody('B4', v).ok); }
{ const v = clone(b4); v.hotspots.push({ ...clone(v.hotspots[0]), hotspotId: 'h_2' }); ok('B4 rejects duplicate hotspot ranks', !validateStageBody('B4', v).ok); }

ok('strict parser accepts one bare JSON object', parseStageBody(JSON.stringify(b1), 'B1').ok);
ok('strict parser rejects fenced model output', !parseStageBody('```json\n{}\n```', 'B1').ok);
const trusted = { workId: 'work_1', imgSha256: 'a'.repeat(64), promptHash: 'b'.repeat(64), brokerPolicyVersion: 'broker/1', imageTransportVersion: 'readtool-confined-dir/1', transcriptSha256: 'c'.repeat(64) };
const producer = { kind: 'claude-code-subscription', model: 'claude-sonnet-4-6', runtimeVersion: '1.0', toolPolicyHash: 'c'.repeat(64), networkPolicyHash: 'd'.repeat(64) };
const completion = buildStageCompletion({ stage: 'B1', rawResponse: JSON.stringify(b1), trusted, producer, createdAt: '2026-09-02T00:00:00Z' });
ok('controller builds a trusted provenance envelope around body-only output', completion.schemaVersion === CONTENT_VISION_SCHEMA && completion.workId === 'work_1' && JSON.stringify(completion.body) === JSON.stringify(b1) && validateStageCompletion(completion, { trusted, producer }).ok);
{ const v = clone(completion); v.body.extra = 'model-authored provenance'; ok('completion rejects a body trying to add envelope fields', !validateStageCompletion(v).ok); }
{ const v = clone(completion); v.imgSha256 = '0'.repeat(64); ok('trusted manifest check rejects a changed controller image binding', !validateStageCompletion(v, { trusted, producer }).ok); }

const runDir = mkdtempSync(join(tmpdir(), 'gesso-vision-content-'));
const captured = captureStageCompletion({ runDir, stage: 'B1', rawResponse: JSON.stringify(b1), trusted, producer, createdAt: '2026-09-02T00:00:00Z' });
ok('controller exclusively captures validated stdout and exact raw bytes', readFileSync(captured.rawPath, 'utf8') === JSON.stringify(b1) && verifyCapturedStage({ ...captured, runDir, trusted, producer }).ok);
let duplicateRefused = false;
try { captureStageCompletion({ runDir, stage: 'B1', rawResponse: JSON.stringify(b1), trusted, producer, createdAt: '2026-09-02T00:00:00Z' }); } catch { duplicateRefused = true; }
ok('controller refuses to overwrite an existing stage completion', duplicateRefused);
writeFileSync(captured.rawPath, '{}');
ok('verification detects edited raw response bytes', !verifyCapturedStage({ ...captured, runDir, trusted, producer }).ok);
rmSync(runDir, { recursive: true, force: true });

console.log(`\nvision-content-schema.test: ${passed} checks passed`);
