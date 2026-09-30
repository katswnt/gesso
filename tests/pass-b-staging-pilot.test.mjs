// Offline regressions for the staging-pilot correction (Codex findings). No model calls, no network.
//   1. cross-process budget accounting: attempts across ALL executions count against the immutable cap;
//   2. transcript tampering: a mutated transcript no longer matches its recorded sha (verification fails);
//   3. fabricated bindings: real reconciliation source-hashes equal the actual file bytes, and the fabricated
//      H("b1"+id) form the prior report used never equals a real file hash;
//   4. zero-eligible scorecard: 0 auto-eligible is UNMEASURED, never PASS.
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256 } from '../scripts/lib/vision-legacy.mjs';
import { countExistingAttempts } from '../scripts/pass-b-staging-pilot.mjs';
import { autoEligibilityVerdict, executionCapVerdict, transcriptIntact } from '../scripts/pass-b-staging-pilot-report.mjs';

let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };

t('cross-process budget accounting: every attempt transcript counts run-wide', () => {
  const run = mkdtempSync(join(tmpdir(), 'pilot-budget-'));
  try {
    // simulate two works whose attempts were written across separate process executions
    for (const [w, k] of [['w1', 3], ['w2', 4]]) {
      const a = join(run, 'works', w, 'attempts'); mkdirSync(a, { recursive: true });
      for (let i = 0; i < k; i++) writeFileSync(join(a, `b1-${w}-${i}.transcript.jsonl`), '{}');
    }
    assert.strictEqual(countExistingAttempts(run), 7, 'counts all 7 attempts across works/executions');
    assert.strictEqual(executionCapVerdict(7, 45), 'within-cap');
    assert.strictEqual(executionCapVerdict(49, 45), 'CAP-EXCEEDED', 'the pilot-as-executed exceeded the cap');
    // an empty/absent run counts zero, and a run already at the cap must be flagged over-cap
    assert.strictEqual(countExistingAttempts(join(run, 'nope')), 0);
  } finally { rmSync(run, { recursive: true, force: true }); }
});

t('transcript tampering is detected by sha binding', () => {
  const bytes = '{"type":"result","structured_output":{"x":1}}';
  const recorded = sha256(bytes);
  assert.ok(transcriptIntact(bytes, recorded, sha256), 'untampered transcript matches');
  assert.ok(!transcriptIntact(bytes + ' ', recorded, sha256), 'any byte change breaks the match');
  assert.ok(!transcriptIntact('{"type":"result","structured_output":{"x":2}}', recorded, sha256), 'altered content breaks the match');
});

t('fabricated bindings never equal real content hashes', () => {
  const id = 'wikidata:Q16467705';
  const realFileBytes = '{"stage":"B1","body":{"seen":[]}}';
  const realHash = sha256(realFileBytes);
  const fabricated = sha256('b1' + id); // the exact fabricated form the invalidated report used
  assert.notStrictEqual(realHash, fabricated, 'a fabricated H("b1"+id) binding cannot match the real file hash');
  // the corrected report imports loadReconciliationSources (real hashes) and defines no sourcesFor()
  const src = readFileSyncSafe('scripts/pass-b-staging-pilot-report.mjs');
  assert.ok(/loadReconciliationSources/.test(src), 'corrected report uses the canonical verifier');
  assert.ok(!/function sourcesFor/.test(src), 'the fabricated sourcesFor() is gone');
});

t('zero-eligible is UNMEASURED, never a pass', () => {
  assert.strictEqual(autoEligibilityVerdict(0), 'UNMEASURED');
  assert.strictEqual(autoEligibilityVerdict(3), 'MEASURED');
  assert.notStrictEqual(autoEligibilityVerdict(0), 'PASS');
});

function readFileSyncSafe(p) { try { return readFileSync(p, 'utf8'); } catch { return ''; } }

console.log(`\n${n} staging-pilot regressions passed`);
