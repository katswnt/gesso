import { buildVisionCoverage, guideStatus, normalizeVisionWorkId, parseWindowAssignment, validateCoverage } from '../scripts/lib/vision-inventory.mjs';
import { SCHEMA_VERSION } from '../scripts/lib/vision-ledger.mjs';

let passed = 0;
function ok(name, condition) {
  if (!condition) throw new Error(`FAIL: ${name}`);
  passed++;
  console.log(`ok - ${name}`);
}
function throws(name, fn, pattern) {
  let error = null;
  try { fn(); } catch (caught) { error = caught; }
  ok(name, !!error && pattern.test(error.message));
}

ok('only complete Wikidata spellings canonicalize', normalizeVisionWorkId('wd:Q1') === 'wikidata:Q1' && normalizeVisionWorkId('museum-Q1-copy') === 'museum-Q1-copy');
ok('window assignment parser accepts repository spacing and ignores earlier prose mentions', parseWindowAssignment('// window.TEST is named here\nwindow.TEST = {"ok":true};', 'window.TEST').ok === true);
throws('duplicate conceptual pool ids fail closed', () => buildVisionCoverage({
  pool: [{ id: 'wd:Q1' }, { id: 'http://www.wikidata.org/entity/Q1' }], asOf: '2026-09-02',
}), /duplicate normalized pool id/);

const notes = Array.from({ length: 5 }, (_, i) => ({ head: `Head ${i}`, body: `Body ${i}`, ...(i === 0 ? { x: 10, y: 20 } : {}) }));
const approved = { image: { ok: true, issue: 'none', reason: '', suggestedUrl: null }, playable: true, playableReason: '', imageQuality: 'good', qualityReason: '', framing: 'ok', mediumLegible: true, notes };
const run = 'a'.repeat(32), imgSha = 'b'.repeat(64), completionSha = 'c'.repeat(64), baseSha = 'd'.repeat(64), promptHash = 'e'.repeat(64);
const pool = [
  { id: 'wd:Q1', title: 'One', img: 'https://example.test/1.jpg', fame: 100, region: 'Europe', medium: 'Oil paint' },
  { id: 'museum2', title: 'Two', img: 'https://example.test/2.jpg', fame: 5, region: 'Asia', medium: 'Ceramic' },
];
const daily = { easy: ['wd:Q1'], medium: [], hard: [], impossible: ['museum2'], byDate: { '2026-09-04': { easy: ['wikidata:Q1'], medium: [], hard: [], impossible: [] } } };
const ledger = { ids: ['museum2'], legacyPass: 'legacy/pre-g03', entries: { 'wd:Q1': { status: 'complete', pass: SCHEMA_VERSION, run, imgSha, completionSha } } };
const evidence = { [run]: { header: { schemaVersion: SCHEMA_VERSION, promptHash, brokerPolicyVersion: 'broker/1', modelId: 'model' }, items: [{ id: 'wd:Q1', imgSha, completionSha, baseSha, approved }] } };
const coverage = buildVisionCoverage({
  pool,
  teach: { 'http://www.wikidata.org/entity/Q1': { guide: Array.from({ length: 5 }, (_, i) => ({ q: `Specific object question ${i}?`, a: 'Answer' })), notes } },
  hotspots: {}, vision: { museum2: { seen: 'legacy only' } }, ledger, evidence, noPins: [], daily,
  research: { guessability: { 'wikidata:Q1': {} }, adaptiveProbe: ['wd:Q1'], ease: {} },
  asOf: '2026-09-02',
});
ok('coverage emits exactly one row per pool work', coverage.rows.length === pool.length);
ok('secure narrow pass completes only its implemented components', coverage.rows[0].components.imageEligibility === 'complete' && coverage.rows[0].components.teachingNotes === 'complete' && coverage.rows[0].components.hotspots === 'complete' && coverage.rows[0].components.richVisualRecord === 'missing');
ok('legacy-only evidence never earns current completion', coverage.rows[1].overallStatus === 'missing' && coverage.rows[1].legacy.canonicalAudit && coverage.rows[1].legacy.rich);
ok('next-seven-day blocker is reported, not hard-gated', coverage.queues.dailyOrHorizonBlockers.includes('wd:Q1') && coverage.policy.horizonGate === 'report-only');
ok('priority queue contains each incomplete work once', coverage.queues.priority.length === 2 && new Set(coverage.queues.priority).size === 2);
ok('research coverage stays separate from Pass B completion', coverage.rows[0].research.guessability && coverage.rows[0].research.adaptiveProbe && coverage.rows[0].overallStatus === 'missing');
ok('generated coverage validates', validateCoverage(coverage, pool.length).ok);

const badState = structuredClone(coverage); badState.rows[0].components.richVisualRecord = 'banana';
ok('falsifiability: unknown component status fails validation', !validateCoverage(badState, pool.length).ok);
ok('falsifiability: row-count mismatch fails validation', !validateCoverage(coverage, pool.length + 1).ok);
const badSummary = structuredClone(coverage); badSummary.summary.provablyComplete = 99;
ok('falsifiability: summary drift fails validation', !validateCoverage(badSummary, pool.length).ok);
const missingPriority = structuredClone(coverage); missingPriority.queues.priority.pop();
ok('falsifiability: incomplete work omitted from priority fails validation', !validateCoverage(missingPriority, pool.length).ok);
ok('five generic guide prompts are template-thin', guideStatus({ guide: Array.from({ length: 5 }, () => ({ q: 'What technique should I notice?', a: 'Answer' })) }) === 'templateThin');
ok('strong-looking legacy guides remain candidates, not falsely reviewed', guideStatus({ guide: Array.from({ length: 5 }, (_, i) => ({ q: `What does the red seal beside figure ${i} reveal?`, a: 'Answer' })) }) === 'legacyCandidate');

const blocked = buildVisionCoverage({ pool: [pool[1]], ledger: { entries: { museum2: { status: 'needs-image', pass: SCHEMA_VERSION } } }, daily: { impossible: ['museum2'] }, asOf: '2026-09-02' });
ok('current needs-image blocks every image-dependent component', blocked.rows[0].components.imageEligibility === 'blocked' && blocked.rows[0].components.richVisualRecord === 'blocked' && blocked.rows[0].components.guideQuestions === 'blocked');
const stale = buildVisionCoverage({ pool: [pool[1]], ledger: { entries: { museum2: { status: 'complete', pass: 'old/1' } } }, daily: {}, asOf: '2026-09-02' });
ok('old-pass narrow evidence is stale rather than complete', stale.rows[0].components.imageEligibility === 'stale' && stale.rows[0].overallStatus === 'stale');

console.log(`\nvision-inventory.test: ${passed} checks passed`);
