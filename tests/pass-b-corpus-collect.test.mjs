// Offline regressions for the repaired corpus B0-B3 collector (no model calls, no network).
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { runIdFor, computeQueue, classifySpawn, attemptFilename, derivativeMatches, buildPriorityQueue, isUsageInterrupted, heldToRequeue } from '../scripts/pass-b-corpus-collect.mjs';
import { sha256 } from '../scripts/lib/vision-legacy.mjs';

let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const PH = { B1: sha256('b1'), B2: sha256('b2'), B3: sha256('b3'), B4: sha256('b4') };

t('1. a model change changes run identity', () => {
  assert.notStrictEqual(runIdFor({ promptHashes: PH, model: 'claude-sonnet-4-6' }), runIdFor({ promptHashes: PH, model: 'claude-opus-5' }));
});
t('2. a B4-only change does NOT change run identity', () => {
  assert.strictEqual(runIdFor({ promptHashes: { ...PH, B4: sha256('b4-v1') } }), runIdFor({ promptHashes: { ...PH, B4: sha256('b4-v2-totally-different') } }));
});
t('2b. a B1/B2/B3 change DOES change run identity', () => {
  assert.notStrictEqual(runIdFor({ promptHashes: PH }), runIdFor({ promptHashes: { ...PH, B2: sha256('b2-changed') } }));
});
t('3. held work is excluded without requeue, included after requeue', () => {
  const order = ['a', 'b', 'c']; const eligibleSet = new Set(order); const doneSet = new Set();
  const held = new Set(['b']);
  assert.deepStrictEqual(computeQueue(order, { eligibleSet, doneSet, heldSet: held }), ['a', 'c']);
  held.delete('b'); // narrow requeue
  assert.deepStrictEqual(computeQueue(order, { eligibleSet, doneSet, heldSet: held }), ['a', 'b', 'c']);
});
t('4. no PASS_B_CORPUS_IDS subset filter exists (cannot rewrite corpus totals)', () => {
  const src = readFileSync('scripts/pass-b-corpus-collect.mjs', 'utf8');
  assert.ok(!/PASS_B_CORPUS_IDS/.test(src), 'the totals-corrupting subset filter must be gone');
  assert.ok(/PASS_B_CORPUS_REQUEUE/.test(src), 'the narrow requeue mechanism is present');
});
t('5. identical/empty stdout preserves distinct attempts (monotonic seq)', () => {
  assert.notStrictEqual(attemptFilename('B1', 1, ''), attemptFilename('B1', 2, ''));
  assert.notStrictEqual(attemptFilename('B1', 1, 'same'), attemptFilename('B1', 2, 'same'));
});
t('6. fatal provenance failures classify as fatal (never retried)', () => {
  assert.strictEqual(classifySpawn({ apiKeySource: 'ANTHROPIC_API_KEY', model: 'claude-sonnet-4-6', expectedModel: 'claude-sonnet-4-6', exitCode: 0, final: {}, structuredOutputPresent: true }).kind, 'fatal');
  assert.strictEqual(classifySpawn({ apiKeySource: 'none', model: 'claude-opus-5', expectedModel: 'claude-sonnet-4-6', exitCode: 0, final: {}, structuredOutputPresent: true }).kind, 'fatal');
  assert.strictEqual(classifySpawn({ apiKeySource: 'none', model: 'claude-sonnet-4-6', expectedModel: 'claude-sonnet-4-6', exitCode: 0, final: {}, structuredOutputPresent: true, imageReceipt: { ok: false, bad: ['/etc/passwd'] } }).kind, 'fatal');
});
t('6b. usage-limit and transport classify correctly (stop vs retry)', () => {
  assert.strictEqual(classifySpawn({ usageLimit: true }).kind, 'usage-limit');
  assert.strictEqual(classifySpawn({ apiKeySource: 'none', model: 'claude-sonnet-4-6', expectedModel: 'claude-sonnet-4-6', exitCode: 1, final: null }).kind, 'retryable');
  assert.strictEqual(classifySpawn({ apiKeySource: 'none', model: 'claude-sonnet-4-6', expectedModel: 'claude-sonnet-4-6', exitCode: 0, final: {}, structuredOutputPresent: true, imageReceipt: { ok: true, bad: [] } }).kind, 'ok');
});
t('7. an exclusive lease refuses a second holder (wx)', () => {
  const d = mkdtempSync(join(tmpdir(), 'lease-')); const p = join(d, 'collector.lease');
  try { writeFileSync(p, '1', { flag: 'wx' }); assert.throws(() => writeFileSync(p, '2', { flag: 'wx' }), /EEXIST/); } finally { rmSync(d, { recursive: true, force: true }); }
});
t('8. a tampered cached image is rejected by rehash-before-reuse', () => {
  const d = mkdtempSync(join(tmpdir(), 'img-')); const f = join(d, 'x.jpg'); writeFileSync(f, 'imagebytes');
  const good = createHash('sha256').update(readFileSync(f)).digest('hex'); // exact bytes hash
  try {
    assert.ok(derivativeMatches(f, good), 'untampered derivative matches its sha');
    writeFileSync(f, 'tampered-bytes'); assert.ok(!derivativeMatches(f, good), 'tampered derivative rejected');
  } finally { rmSync(d, { recursive: true, force: true }); }
});
t('9. resume reuses verified checkpoints without spawning (done => empty queue)', () => {
  const order = ['a', 'b']; const eligibleSet = new Set(order);
  assert.deepStrictEqual(computeQueue(order, { eligibleSet, doneSet: new Set(order), heldSet: new Set() }), [], 'all-done => nothing to spawn');
});
t('10. priority order: next-7 scheduled works precede fallback; region rotation spreads', () => {
  const pool = [
    { id: 'sched1', img: 'u', fame: 1, region: 'Asia', src: 's', medium: 'm' },
    { id: 'famous', img: 'u', fame: 9999, region: 'Europe', src: 's', medium: 'm' },
    { id: 'r-eu1', img: 'u', fame: 5, region: 'Europe', src: 's', medium: 'm' },
    { id: 'r-as1', img: 'u', fame: 4, region: 'Asia', src: 's', medium: 'm' },
  ];
  const daily = { easy: [], medium: ['r-eu1', 'r-as1'], hard: [], impossible: [], byDate: { '2026-09-17': { easy: ['sched1'], medium: [], hard: [], impossible: [] } } };
  const q = buildPriorityQueue(pool, daily, { today: '2026-09-17' });
  assert.strictEqual(q[0], 'sched1', 'a work scheduled today comes first');
  assert.ok(q.indexOf('r-eu1') < q.indexOf('famous'), 'tiered Medium precedes ungrouped fallback');
});
t('11. relative CLI invocation executes main (dry run prints runId)', () => {
  const out = execFileSync('node', ['scripts/pass-b-corpus-collect.mjs'], { cwd: process.cwd(), encoding: 'utf8', timeout: 60000 });
  assert.ok(/^runId: corpus-b3-/m.test(out), 'relative invocation ran main and printed the runId');
});

t('12. usage-limit interruption is not terminal; genuine stage-fail is', () => {
  assert.ok(isUsageInterrupted({ B1: 'complete', B2: 'failed:subscription usage limit', B3: 'not-requested' }), 'usage-limit mid-pipeline => interrupted (not held)');
  assert.ok(!isUsageInterrupted({ B1: 'complete', B2: 'failed:invalid B2 body: guideAnswers', B3: 'not-requested' }), 'schema fail => genuine hold');
});
t('13. held ids without a recorded reason are requeued (self-heal for leaked usage holds)', () => {
  assert.deepStrictEqual(heldToRequeue(['a', 'b', 'c'], { b: 'B0:http-status' }), ['a', 'c'], 'unreasoned holds requeued; reasoned hold stays');
});

console.log(`\n${n} corpus-collector regressions passed`);
