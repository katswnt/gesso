// Regressions for Codex's round-6 review of pass-b-research-stopgap, blocker R6-S1: conflicting raw Read inputs could
// still verify as confined, because the shared validator saw only lossy parser output (JSON.parse keeps the last
// duplicate member and decodes escaped names; an incomplete stream was discarded by id; a partial scan saw only the first
// literal key). The fix is a strict raw-input allowlist (verifyB1ImageRead in scripts/lib/pass-b-calibration.mjs).
// Reproduction = Codex's probes (round6/probes/path-evidence.mjs, 26 cases; round6/probes/path-import.mjs). Synthetic
// transcripts, injected executors: no model calls, no network, no live flags, no evidence writes outside tmp.
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { sha256 } from '../scripts/lib/vision-legacy.mjs';
import { syntheticFixture, parseStreamTranscript, verifyB1ImageRead, verifyAttemptConfinement, producerEvidence, IMAGE_TRANSPORT_VERSION, rawTranscriptLine } from '../scripts/lib/pass-b-calibration.mjs';
import { captureStageCompletion } from '../scripts/lib/vision-content-capture.mjs';
import { BROKER_POLICY_VERSION } from '../scripts/lib/img-broker.mjs';

let n = 0; const tests = [];
const t = (name, fn) => tests.push([name, fn]);
process.env.PASS_B_RESEARCH_VERSION = 'stopgap-1';
const C = await import('../scripts/pass-b-corpus-collect.mjs');
const F = syntheticFixture(), RT = '2.1.280', ev = JSON.stringify;

// ---- transcript shapes (Codex's probe, verbatim) ----
const start = id => ev({ type: 'stream_event', event: { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id, name: 'Read', input: {} } } });
const delta = raw => ev({ type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: raw } } });
const stop = ev({ type: 'stream_event', event: { type: 'content_block_stop', index: 1 } });
const read = (raw, model) => `{"type":"assistant","message":{"model":${ev(model)},"content":[{"type":"tool_use","id":"r","name":"Read","input":${raw}}]}}`;
const result = ev({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'r', content: [{ type: 'image' }] }] } });
// `safe` is the actual controller-created call directory plus the exact image basename.
const cases = safe => ({
  canonical: { raw: ev({ file_path: safe }), mode: 'completed', control: 'ok' },
  'partial-literal-outside-reconciled': { raw: `{"file_path":"/etc/passwd","offset":`, mode: 'reconciled' },
  'partial-escaped-outside-reconciled': { raw: `{"file_\\u0070ath":"/etc/passwd","offset":`, mode: 'reconciled' },
  'partial-safe-then-literal-outside': { raw: `{"file_path":${ev(safe)},"file_path":"/etc/passwd","offset":`, mode: 'extra' },
  'partial-safe-then-escaped-outside': { raw: `{"file_path":${ev(safe)},"file_\\u0070ath":"/etc/passwd","offset":`, mode: 'extra' },
  'partial-escaped-outside-quota': { raw: `{"file_\\u0070ath":"/etc/passwd","offset":`, mode: 'quota' },
  'stream-duplicate-outside-first': { raw: `{"file_path":"/etc/passwd","file_path":${ev(safe)}}`, mode: 'stream' },
  'stream-duplicate-outside-first-stopped': { raw: `{"file_path":"/etc/passwd","file_path":${ev(safe)}}`, mode: 'stopped' },
  'stream-escaped-duplicate-outside-first': { raw: `{"file_\\u0070ath":"/etc/passwd","file_path":${ev(safe)}}`, mode: 'stream' },
  'completed-duplicate-outside-first': { raw: `{"file_path":"/etc/passwd","file_path":${ev(safe)}}`, mode: 'completed' },
  'completed-escaped-duplicate-outside-first': { raw: `{"file_\\u0070ath":"/etc/passwd","file_path":${ev(safe)}}`, mode: 'completed' },
  'stream-duplicate-outside-last-control': { raw: `{"file_path":${ev(safe)},"file_path":"/etc/passwd"}`, mode: 'stream', control: 'fatal' },
  'completed-duplicate-outside-last-control': { raw: `{"file_path":${ev(safe)},"file_path":"/etc/passwd"}`, mode: 'completed', control: 'fatal' },
});
function transcript(collector, stage, dir, file, c) {
  const M = collector.COLLECTION_MODEL;
  const init = ev({ type: 'system', subtype: 'init', cwd: dir, apiKeySource: 'none', model: M, claude_code_version: RT, tools: ['Read', 'StructuredOutput'], mcp_servers: [] });
  const safe = ev({ file_path: `${dir}/${file}` });
  const lines = [init];
  if (c.mode === 'completed') lines.push(read(c.raw, M), result);
  else if (c.mode === 'stream' || c.mode === 'stopped') lines.push(start('r'), delta(c.raw), ...(c.mode === 'stopped' ? [stop] : []), result);
  else if (c.mode === 'reconciled') lines.push(start('r'), delta(c.raw), read(safe, M), result);
  else lines.push(read(safe, M), result, start('extra'), delta(c.raw));
  lines.push(ev(c.mode === 'quota'
    ? { type: 'result', subtype: 'error', is_error: true, api_error_status: 429, result: 'usage limit reached' }
    : { type: 'result', subtype: 'success', is_error: false, structured_output: F.bodies[stage], modelUsage: { [M]: { output_tokens: 10 } } }));
  return lines.join('\n');
}

// One fresh attempt through `collector` (default: the current one) in a temp run, the B1 completion captured when it was
// accepted, then the current collector's resume inspection and the shared validators on the preserved bytes.
async function attempt(stage, name, { collector = C, keep = false, inspect = true, build = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'r6-path-')), id = 'work', img = sha256('img'), file = `${img}.png`, wd = join(root, 'works', sha256(id).slice(0, 24));
  mkdirSync(wd, { recursive: true }); mkdirSync(join(root, 'imgs')); writeFileSync(join(root, 'imgs', file), 'img');
  writeFileSync(join(wd, 'b0-prep.json'), ev({ work: { id }, trustedCatalog: {}, legacy: {}, image: { ok: true, imgSha256: img, ext: 'png' } }));
  let text, dir, out, error;
  const prompt = collector.effectivePromptFor(stage, { id, catalog: {}, legacy: {}, imageFile: file, b1body: F.bodies.B1, b2body: F.bodies.B2, b3Requests: F.bodies.B2.targetedVerificationRequests });
  try {
    out = await collector.executeCorpusAttempt({ runDir: root, workRunDir: wd, id, imgSha256: img, ext: 'png', stage, seq: 1, runtimeVersion: RT, imageFile: file,
      command: { bin: 'NEVER-EXECUTED', argv: ['-p', prompt, '--model', collector.COLLECTION_MODEL, '--effort', 'medium'], env: { removeKeys: [] } }, now: () => new Date('2026-11-20T10:00:00Z'),
      execute: async (_b, _a, opts) => { dir = opts.cwd; text = build ? build({ M: collector.COLLECTION_MODEL, dir, file, safe: `${dir}/${file}`, stage }) : transcript(collector, stage, dir, file, cases(`${dir}/${file}`)[name]); return { stdout: text }; } });
  } catch (e) { error = e.message; }
  const meta = JSON.parse(readFileSync(join(wd, 'attempts', `${stage.toLowerCase()}-000001.meta.json`), 'utf8'));
  const reservation = JSON.parse(readFileSync(join(wd, 'attempts', `${stage.toLowerCase()}-000001.reserved.json`), 'utf8'));
  if (stage === 'B1' && out?.raw) captureStageCompletion({ runDir: wd, stage, rawResponse: out.raw,
    trusted: { workId: id, imgSha256: img, promptHash: sha256(prompt), brokerPolicyVersion: BROKER_POLICY_VERSION, imageTransportVersion: IMAGE_TRANSPORT_VERSION, transcriptSha256: sha256(text) },
    producer: producerEvidence(stage, { model: collector.COLLECTION_MODEL, runtimeVersion: RT }), createdAt: '2026-11-20T10:00:00Z', context: {} });
  if (existsSync(join(root, 'fatal.json'))) rmSync(join(root, 'fatal.json')); // resume re-derives it from the preserved attempt
  // a resume either reports a preserved fatal on the row or refuses outright (a captured completion's evidence check)
  let row = null, resumeError = null;
  if (inspect) { try { row = C.inspectWork({ runDir: root, id, catalog: {}, legacy: {}, priorDir: join(root, 'none') }); } catch (e) { resumeError = e.message; } }
  const receipt = verifyB1ImageRead(parseStreamTranscript(text), { callDir: dir, imageBasename: file });
  const conf = verifyAttemptConfinement(text, { stage, callDir: dir, imageBasename: file });
  const unrecorded = verifyAttemptConfinement(text, { stage, callDir: null, imageBasename: file });
  const r = { meta, reservation, accepted: !!out?.raw, error, row, resumeError, receipt, conf, unrecorded, root, id, wd, dir, text };
  if (!keep) rmSync(root, { recursive: true, force: true });
  return r;
}

const CONFLICTING = Object.entries(cases('/unused')).filter(([, c]) => !c.control).map(([name]) => name);
const CONTROLS = Object.entries(cases('/unused')).filter(([, c]) => c.control).map(([name]) => name);

// ---- the 26-case matrix: 18 conflicting successes + 2 conflicting quota outcomes are now confinement fatals ----
for (const stage of ['B1', 'B3'])
  for (const name of CONFLICTING)
    t(`R6-S1: ${stage}: ${name} is a confinement fatal (fresh, on resume, shared validator), never ok/usage-limit`, async () => {
      const r = await attempt(stage, name);
      assert.strictEqual(r.meta.kind, 'fatal', `meta ${JSON.stringify(r.meta)}`); assert.ok(!r.accepted, 'raw output was accepted');
      assert.match(r.error || '', /confinement violation/, 'quota/success must not take precedence');
      assert.strictEqual(r.resumeError, null, r.resumeError);
      assert.match(r.row.fatal || '', /confinement violation/, `resume: ${r.row.fatal}`);
      assert.strictEqual(r.row.bodies?.B1, undefined, 'never a B1 body');
      assert.strictEqual(r.receipt.ok, false); assert.ok(r.receipt.bad.some(b => b.startsWith('/etc/passwd')), `bad ${JSON.stringify(r.receipt.bad)}`);
      assert.strictEqual(r.conf.status, 'violation'); assert.strictEqual(r.unrecorded.status, 'violation', 'proven without a recorded directory too');
    });
for (const stage of ['B1', 'B3'])
  t(`R6-S1: ${stage}: controls: canonical Read verifies and resumes clean; outside-last duplicates stay fatal`, async () => {
    const ok = await attempt(stage, 'canonical');
    assert.deepStrictEqual([ok.meta.kind, ok.accepted, ok.row.fatal, ok.conf.status, ok.receipt.ok, ok.receipt.good], ['ok', true, null, 'confined', true, 1], ok.error);
    if (stage === 'B1') assert.ok(ok.row.bodies.B1, 'the captured canonical B1 is present on resume');
    for (const name of CONTROLS.filter(x => x !== 'canonical')) {
      const r = await attempt(stage, name);
      assert.deepStrictEqual([r.meta.kind, r.accepted, r.conf.status], ['fatal', false, 'violation'], name);
      assert.match(r.row.fatal || '', /preserved confinement violation/, name);
    }
  });

// ---- capture/resume: evidence that the pre-fix collector (75148dc) accepted and captured is a fatal on resume ----
const archiveRoot = mkdtempSync(join(tmpdir(), 'r6-archive-'));
process.on('exit', () => rmSync(archiveRoot, { recursive: true, force: true }));
async function collectorAt(rev, version) {
  const dir = join(archiveRoot, `${rev}-${version || 'banked'}`); mkdirSync(dir, { recursive: true });
  execFileSync('tar', ['-x', '-C', dir], { input: execFileSync('git', ['archive', rev, 'scripts'], { maxBuffer: 1 << 28 }) });
  execFileSync('ln', ['-s', join(process.cwd(), 'node_modules'), join(dir, 'node_modules')]);
  const prev = process.env.PASS_B_RESEARCH_VERSION, fresh = process.env.PASS_B_RESEARCH_FRESH_B1;
  process.env.PASS_B_RESEARCH_VERSION = version; delete process.env.PASS_B_RESEARCH_FRESH_B1;
  try { return await import(`${pathToFileURL(join(dir, 'scripts', 'pass-b-corpus-collect.mjs')).href}?r6-${rev}-${version || 'banked'}`); }
  finally { process.env.PASS_B_RESEARCH_VERSION = prev; if (fresh != null) process.env.PASS_B_RESEARCH_FRESH_B1 = fresh; }
}
const PRE_FIX = await collectorAt('75148dc', 'stopgap-1');       // the reviewed tip: records callDir, accepted these cases
const PRE_FIX_BANKED = await collectorAt('75148dc', '');          // the same revision writing a banked-run attempt
for (const stage of ['B1', 'B3'])
  t(`R6-S1: ${stage}: capture/resume: an attempt the pre-fix collector accepted (and captured) is a preserved confinement fatal`, async () => {
    for (const name of ['partial-escaped-outside-reconciled', 'partial-safe-then-escaped-outside', 'stream-duplicate-outside-first', 'stream-duplicate-outside-first-stopped', 'completed-escaped-duplicate-outside-first']) {
      const r = await attempt(stage, name, { collector: PRE_FIX });
      assert.ok(r.reservation.callDir, 'the pre-fix collector recorded its call directory');
      assert.deepStrictEqual([r.meta.kind, r.accepted], ['ok', true], `${name}: precondition: the pre-fix collector accepted it`);
      // B3 (no capture): a preserved fatal; B1 (captured completion): the evidence re-check refuses the resume outright
      if (r.row) { assert.match(r.row.fatal || '', /preserved confinement violation/, `${name}: resume ${r.row.fatal}`); assert.strictEqual(r.row.bodies?.B1, undefined, `${name}: never reused`); }
      else assert.match(r.resumeError || '', /B1 evidence: .*(read target escaped confinement: \/etc\/passwd|malformed-transcript:.*non-image path \/etc\/passwd)/, `${name}: resume ${r.resumeError}`);
      if (stage === 'B1') assert.strictEqual(r.row, null, `${name}: the captured B1 is never reused`);
    }
  });

// ---- banked import and imported-copy reinspection (Codex's path-import probe) ----
// A banked B1 made by the pre-fix collector in banked mode (records callDir, accepted the conflicting transcript),
// imported by the current importer (explicit stop) and, separately, by the pre-fix importer and then reinspected.
const IMPORT_CASES = ['partial-escaped-outside-reconciled', 'stream-duplicate-outside-first', 'completed-duplicate-outside-first'];
async function bankedB1(name) {
  const banked = PRE_FIX_BANKED;
  const r = await attempt('B1', name, { collector: banked, keep: true, inspect: false });
  assert.ok(r.reservation.callDir, 'banked attempt records its call directory');
  assert.deepStrictEqual([r.meta.kind, r.accepted], ['ok', true], `${name}: precondition: the pre-fix banked collector accepted it`);
  const cur = join(r.root, 'target'), nwd = join(cur, 'works', sha256(r.id).slice(0, 24)); mkdirSync(nwd, { recursive: true });
  return { ...r, args: { id: r.id, workRunDir: nwd, catalog: {}, legacy: {}, bankedRunDir: r.root, imgsDir: join(cur, 'imgs') }, cur, nwd,
    done: () => rmSync(r.root, { recursive: true, force: true }) };
}
t('R6-S1: import: a banked B1 with conflicting raw Read inputs is an explicit stop; nothing is imported', async () => {
  for (const name of IMPORT_CASES) {
    const f = await bankedB1(name);
    try {
      assert.throws(() => C.importBanked(f.args), /work\/B1: banked B1 confinement violation/, name);
      assert.ok(!existsSync(join(f.nwd, 'imports', 'manifest.json')), `${name}: nothing imported`);
    } finally { f.done(); }
  }
});
t('R6-S1: reinspection: a copy the pre-fix importer made is an imported-B1 confinement fatal, never a body', async () => {
  for (const name of IMPORT_CASES) {
    const f = await bankedB1(name);
    try {
      const m = PRE_FIX.importBanked(f.args); assert.ok(m?.b1, `${name}: precondition: the pre-fix importer copied the B1`);
      const row = C.inspectWork({ runDir: f.cur, id: f.id, catalog: {}, legacy: {} });
      assert.match(row.fatal || '', /work\/B1: imported B1 confinement violation/, `${name}: ${row.fatal}`);
      assert.strictEqual(row.bodies.B1, undefined, `${name}: never a body`);
    } finally { f.done(); }
  }
});

// ---- the allowlist itself, on the shared validator ----
const DIR = '/tmp/corpus-Ab12Cd', IMG = 'abc.png', SAFE = `${DIR}/${IMG}`;
const raw = lines => lines.join('\n');
const msgRead = (input, id = 'r') => `{"type":"assistant","message":{"content":[{"type":"tool_use","id":"${id}","name":"Read","input":${input}}]}}`;
const res = (id = 'r', image = true) => ev({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: image ? [{ type: 'image' }] : 'text' }] } });
const v = (lines, callDir = DIR) => verifyB1ImageRead(parseStreamTranscript(raw(lines)), { callDir, imageBasename: IMG });
t('R6-S1: allowlist: only the exact single-member {"file_path":"<SAFE>"} verifies (whitespace aside)', () => {
  assert.ok(v([msgRead(ev({ file_path: SAFE })), res()]).ok, 'control: canonical');
  assert.ok(v([msgRead(` { "file_path" :\t "${SAFE}"\r } `), res()]).ok, 'control: insignificant whitespace');
  assert.ok(v([msgRead(ev({ file_path: `/private${SAFE}` })), res()]).ok, 'control: the macOS /private realpath form');
  for (const [why, input] of [
    ['an extra member', ev({ file_path: SAFE, limit: 5 })],
    ['a safe duplicate', `{"file_path":"${SAFE}","file_path":"${SAFE}"}`],
    ['an escaped member name', `{"file_\\u0070ath":"${SAFE}"}`],
    ['a non-canonical value encoding', `{"file_path":"${SAFE.replace(/\//g, '\\/')}"}`],
    ['a relative path', ev({ file_path: IMG })],
    ['an empty object', '{}'],
    ['a non-string path', `{"file_path":["${SAFE}"]}`],
  ]) {
    const r = v([msgRead(input), res()]);
    assert.deepStrictEqual([r.ok, r.good], [false, 0], why); assert.ok(r.bad.length >= 1, `${why}: fatal, not merely unverified`);
  }
});
t('R6-S1: allowlist: an outside duplicate in a completed input is fatal in either order, with or without a recorded directory', () => {
  for (const input of [`{"file_path":"/etc/passwd","file_path":"${SAFE}"}`, `{"file_path":"${SAFE}","file_path":"/etc/passwd"}`, `{"file_\\u0070ath":"/etc/passwd","file_path":"${SAFE}"}`]) {
    const r = v([msgRead(input), res()]);
    assert.ok(r.bad.includes('/etc/passwd') && r.bad.some(b => /malformed transcript line 1: duplicate member .*file_path \(tool block\)/.test(b)), `${input}: ${JSON.stringify(r.bad)}`);
    assert.strictEqual(verifyAttemptConfinement(raw([msgRead(input), res()]), { stage: 'B1', callDir: null, imageBasename: IMG }).status, 'violation', `${input}: no recorded dir`);
  }
});
t('R6-S1: allowlist: every raw form of one invocation must pass; a later safe block or result cannot erase an outside form', () => {
  const s = ev({ type: 'stream_event', event: { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'r', name: 'Read', input: {} } } });
  const d = p => ev({ type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: p } } });
  const sStart = input => ev({ type: 'stream_event', event: { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'r', name: 'Read', input } } });
  // the safe completed block arrives after an outside streamed form for the same id
  assert.deepStrictEqual(v([s, d('{"file_path":"/etc/passwd"}'), msgRead(ev({ file_path: SAFE })), res()]).bad, ['/etc/passwd']);
  assert.deepStrictEqual(v([s, d('{"file_path":"/etc/pa'), msgRead(ev({ file_path: SAFE })), res()]).bad, ['/etc/pa…']);
  // a non-empty streamed start input is a form of its own
  assert.deepStrictEqual(v([sStart({ file_path: '/etc/passwd' }), msgRead(ev({ file_path: SAFE })), res()]).bad, ['/etc/passwd']);
  // a streamed safe prefix that continues with another member is not a prefix of the canonical object: with a result it is fatal
  assert.strictEqual(v([s, d(`{"file_path":"${SAFE}","offset":`), res()]).bad.length, 1);
  assert.strictEqual(v([s, d(`{"file_path":"${SAFE}","offset":`), msgRead(ev({ file_path: SAFE })), res()]).bad.length, 1, 'the extra member is seen even beside a canonical block');
  // controls: a safe prefix reconciles with the completed canonical block; the start placeholder is only a placeholder
  assert.ok(v([s, d(`{"file_path":"${DIR}/a`), msgRead(ev({ file_path: SAFE })), res()]).ok, 'control: safe prefix reconciliation');
  assert.ok(v([s, d(ev({ file_path: SAFE })), msgRead(ev({ file_path: SAFE })), res()]).ok, 'control: both envelopes, one call');
  assert.ok(v([s, d('{"file_pa'), d(`th":"${SAFE}"}`), res()]).ok, 'control: deltas split mid-name');
});
t('R6-S1: allowlist: control: benign incomplete starts keep their outcome but never establish a receipt', () => {
  const s = id => ev({ type: 'stream_event', event: { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id, name: 'Read', input: {} } } });
  const d = p => ev({ type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: p } } });
  for (const tail of [[s('r')], [s('r'), d('')], [s('r'), d('{')], [s('r'), d('{"file_path":')], [s('r'), d(`{"file_path":"${DIR}/a`)], [s('r'), d(`{"file_path":"${SAFE}"`)]]) {
    const alone = v(tail), executed = v([...tail, res()]);
    assert.deepStrictEqual([alone.ok, alone.good, alone.bad.length], [false, 0, 0], `benign, no receipt: ${tail.join(' ')}`);
    assert.deepStrictEqual([executed.ok, executed.good, executed.bad.length], [false, 0, 1], `executed with an unestablished input: ${tail.join(' ')}`);
    const beside = v([msgRead(ev({ file_path: SAFE }), 'ok'), res('ok'), ...tail.map(l => l.replace('"id":"r"', '"id":"p"'))]);
    assert.ok(beside.ok, 'control: an unexecuted benign start beside a real read');
  }
});
t('R6-S1: allowlist: a duplicate member in a tool-locating envelope is fatal (a whole-line JSON.parse would keep one)', () => {
  const hidden = `{"type":"assistant","message":{"content":[{"type":"tool_use","id":"x","name":"Read","input":{"file_path":"/etc/passwd"}}]},"message":{"content":[]}}`;
  assert.strictEqual(parseStreamTranscript(hidden).toolUses.length, 0, 'precondition: JSON.parse sees no Read');
  assert.strictEqual(v([msgRead(ev({ file_path: SAFE })), res(), hidden]).ok, false);
  assert.strictEqual(verifyAttemptConfinement(raw([hidden]), { stage: 'B1', callDir: DIR, imageBasename: IMG }).status, 'violation', 'not "no-read"');
  const dupInput = `{"type":"assistant","message":{"content":[{"type":"tool_use","id":"r","name":"Read","input":{"file_path":"/etc/passwd"},"input":${ev({ file_path: SAFE })}}]}}`;
  assert.strictEqual(v([dupInput, res()]).ok, false, 'duplicate input members in a content block');
  // control: payload stays payload: tool-shaped data inside a StructuredOutput input or a tool result is not an executed Read
  const payload = ev({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 's', name: 'StructuredOutput', input: { a: { type: 'tool_use', name: 'Read', input: { file_path: '/etc/passwd' } } } }] } });
  const resultPayload = ev({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'r', content: [{ type: 'image' }, { type: 'text', text: ev({ file_path: '/etc/passwd' }) }] }] } });
  assert.ok(v([msgRead(ev({ file_path: SAFE })), resultPayload, payload]).ok, 'control: nested data and tool-result payloads are not executed tools');
});

// ---- R7 (Codex round-7, Phase A sibling; same class here): evidence a last-wins parse or a start overwrite would lose ----
// Each builder returns a whole transcript for the real collector; `quota` swaps the success tail for a usage limit.
const initLine = (M, dir) => ev({ type: 'system', subtype: 'init', cwd: dir, apiKeySource: 'none', model: M, claude_code_version: RT, tools: ['Read', 'StructuredOutput'], mcp_servers: [] });
const finalLine = (M, stage, quota) => ev(quota ? { type: 'result', subtype: 'error', is_error: true, api_error_status: 429, result: 'usage limit reached' }
  : { type: 'result', subtype: 'success', is_error: false, structured_output: F.bodies[stage], modelUsage: { [M]: { output_tokens: 10 } } });
const block = (M, members) => `{"type":"assistant","message":{"model":${ev(M)},"content":[{"type":"tool_use","id":"r","name":"Read",${members}}]}}`;
const startWith = input => ev({ type: 'stream_event', event: { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'r', name: 'Read', input } } });
const R7 = {
  // R7-A1: duplicate `input` members on one completed tool block (escaped name included); a harmless extra form too
  'completed-duplicate-input-outside-first': ({ M, safe }) => [block(M, `"input":{"file_path":"/etc/passwd"},"input":${ev({ file_path: safe })}`), result],
  'control-completed-duplicate-input-outside-last': ({ M, safe }) => [block(M, `"input":${ev({ file_path: safe })},"input":{"file_path":"/etc/passwd"}`), result],
  'completed-escaped-duplicate-input-outside-first': ({ M, safe }) => [block(M, `"in\\u0070ut":{"file_path":"/etc/passwd"},"input":${ev({ file_path: safe })}`), result],
  'completed-duplicate-input-extra-field-first': ({ M, safe }) => [block(M, `"input":${ev({ file_path: safe, offset: 1 })},"input":${ev({ file_path: safe })}`), result],
  // R7-A2: a populated start input followed by safe deltas (with and without a stop and a completed twin)
  'populated-start-outside-then-safe-deltas-twin': ({ M, safe }) => [startWith({ file_path: '/etc/passwd' }), delta(ev({ file_path: safe })), stop, read(ev({ file_path: safe }), M), result],
  'populated-start-outside-then-safe-deltas': ({ safe }) => [startWith({ file_path: '/etc/passwd' }), delta(ev({ file_path: safe })), result],
  'populated-start-extra-field-then-safe-deltas-twin': ({ M, safe }) => [startWith({ file_path: safe, offset: 1 }), delta(ev({ file_path: safe })), stop, read(ev({ file_path: safe }), M), result],
  'populated-start-extra-field-then-safe-deltas': ({ safe }) => [startWith({ file_path: safe, offset: 1 }), delta(ev({ file_path: safe })), stop, result],
};
const r7build = (name, quota) => a => [initLine(a.M, a.dir), ...R7[name](a), finalLine(a.M, a.stage, quota)].join('\n');
for (const stage of ['B1', 'B3'])
  for (const name of Object.keys(R7))
    t(`R7: ${stage}: ${name} is a fatal in success and quota modes (fresh and on resume)`, async () => {
      for (const quota of [false, true]) {
        const r = await attempt(stage, name, { build: r7build(name, quota) });
        assert.deepStrictEqual([r.meta.kind, r.accepted], ['fatal', false], `${quota ? 'quota' : 'success'}: ${JSON.stringify(r.meta)}`);
        assert.match(r.error || '', /confinement violation|malformed transcript evidence/);
        assert.strictEqual(r.resumeError, null, r.resumeError); assert.match(r.row.fatal || '', /preserved (confinement violation|malformed transcript evidence)/, `resume: ${r.row.fatal}`);
        assert.strictEqual(r.conf.status, 'violation');
      }
    });
for (const stage of ['B1', 'B3'])
  t(`R7: ${stage}: control: the ordinary empty-start placeholder with safe deltas, a stop and a completed twin is accepted`, async () => {
    const r = await attempt(stage, 'empty-start', { build: a => [initLine(a.M, a.dir), start('r'), delta(ev({ file_path: a.safe })), stop, read(ev({ file_path: a.safe }), a.M), result, finalLine(a.M, a.stage, false)].join('\n') });
    assert.deepStrictEqual([r.meta.kind, r.accepted, r.row.fatal, r.conf.status, r.receipt.good], ['ok', true, null, 'confined', 1], r.error);
  });
for (const stage of ['B1', 'B3'])
  t(`R7: ${stage}: a duplicate member in a line with no tool block and no path is held, never ok/usage-limit, never reused`, async () => {
    for (const quota of [false, true]) {
      const dupResult = a => finalLine(a.M, a.stage, quota).replace(/^\{/, '{"session_id":"s1","session_id":"s2",');
      const r = await attempt(stage, 'held', { build: a => [initLine(a.M, a.dir), read(ev({ file_path: a.safe }), a.M), result, dupResult(a)].join('\n') });
      assert.deepStrictEqual([r.meta.kind, r.accepted], ['held', false], `${quota ? 'quota' : 'success'}: ${JSON.stringify(r.meta)}`);
      assert.match(r.meta.reason, /malformed transcript evidence/);
      assert.strictEqual(r.resumeError, null, r.resumeError);
      assert.strictEqual(r.row.fatal, null, 'held, not a pipeline fatal');
      assert.ok(r.row.terminalReasons.some(x => x.includes(C.MALFORMED_HELD)), JSON.stringify(r.row.terminalReasons));
      assert.strictEqual(r.row.bodies?.[stage], undefined, 'never a body');
      assert.deepStrictEqual([r.receipt.ok, r.receipt.bad.length, r.conf.status], [false, 0, 'malformed']);
    }
  });
t('R7: a malformed line holding a tool block or a non-image path is fatal; otherwise only unverifiable', () => {
  const dup = '{"type":"system","subtype":"note","x":1,"x":2}';
  assert.deepStrictEqual([v([msgRead(ev({ file_path: SAFE })), res(), dup]).bad.length, v([msgRead(ev({ file_path: SAFE })), res(), dup]).ok], [0, false], 'held: unverifiable');
  const withPath = '{"type":"system","subtype":"note","x":1,"x":"/etc/passwd"}';
  assert.ok(v([msgRead(ev({ file_path: SAFE })), res(), withPath]).bad.some(b => /non-image path \/etc\/passwd/.test(b)));
  const withImage = `{"type":"system","subtype":"note","x":1,"x":"${SAFE}"}`;
  assert.strictEqual(v([msgRead(ev({ file_path: SAFE })), res(), withImage]).bad.length, 0, 'the exact image path alone is not a non-image path');
  const toolDeep = '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"r","content":[{"type":"text","text":"a","text":"b"}]}]}}';
  assert.ok(v([msgRead(ev({ file_path: SAFE })), res(), toolDeep]).bad.some(b => /\(tool block\)/.test(b)), 'a duplicate deep inside a tool block');
});

// ---- the strict raw line parser itself ----
t('R7 parser: strict lines parse exactly like JSON.parse (escapes, surrogate pairs, nesting, arrays, numbers, literals)', () => {
  const lines = [
    '{"a":"q\\"b\\\\s\\/f\\b\\f\\n\\r\\t","e":"\\u00e9\\u0000","p":"\\ud83d\\ude00","l":"😀é"}',
    '{"n":[0,-0,1e5,1.5E-3,-2.25e+2,123456789012345678901234567890],"t":true,"f":false,"z":null,"o":{},"a":[]}',
    '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"r","name":"Read","input":{ "file_path" : "/tmp/x/a.png" , "deep":[[{"k":[1,{"m":"v"}]}]] }},{"type":"text","text":"x"}]}}',
    ' \t{"\\u0061b":"c","nested":{"a":{"a":{"a":1}}},"arr":[{"a":1},{"a":1}]}\r',
  ];
  for (const line of lines) {
    const r = rawTranscriptLine(line), parsed = JSON.parse(line);
    assert.strictEqual(r.malformed, null, `${line}: ${JSON.stringify(r.malformed)}`);
    const content = parsed?.message?.content;
    if (content) assert.deepStrictEqual(r.contentInputs.map(x => (x == null ? undefined : JSON.parse(x))), content.map(b => b.input), 'raw input slices parse to the same inputs');
  }
  assert.strictEqual(JSON.parse(lines[0]).p, '😀', 'precondition: the escaped surrogate pair is one character');
});
t('R7 parser: a duplicate member name at any depth is malformed, compared after decoding escapes', () => {
  for (const [line, where] of [
    ['{"a":1,"a":2}', '$.a'],
    ['{"o":{"x":{"y":[{"k":1},{"k":1,"k":2}]}}}', '$.o.x.y[1].k'],
    ['{"a":1,"\\u0061":2}', '$.a'],
    ['{"😀":1,"\\ud83d\\ude00":2}', '$.😀'],
    ['[{"type":"x"},[[{"q":1,"\\u0071":2}]]]', '$[1][0][0].q'],
  ]) {
    const r = rawTranscriptLine(line);
    assert.ok(r.malformed && r.malformed.reason.includes(where), `${line}: ${JSON.stringify(r.malformed)}`);
  }
  for (const line of ['{"a":1,"A":2}', '{"a":{"b":1},"b":{"a":1}}', '{"a":[{"b":1},{"b":1}]}', '{"\\u00e9":1,"e\\u0301":2}'])
    assert.strictEqual(rawTranscriptLine(line).malformed, null, `distinct names: ${line}`);
  const deep = rawTranscriptLine('{"type":"user","message":{"content":[{"type":"tool_result","content":[{"t":1,"t":"/etc/passwd"}]}]}}').malformed;
  assert.deepStrictEqual([deep.toolBlock, deep.paths], [true, ['/etc/passwd']]);
  assert.deepStrictEqual(rawTranscriptLine('{"x":1,"x":"plain"}').malformed.toolBlock, false);
  for (const bad of ['{"a":1} x', '{"a":"\u0001"}', '{"a":"\\x"}', '{"a":01}', '{"a":1,}', '{"a" 1}', '{"a":tru}', '{"a":"\\u12"}'])
    assert.match(rawTranscriptLine(bad).malformed?.reason || '', /not strict JSON/, bad);
});

const failed = [];
for (const [name, fn] of tests) { try { await fn(); n++; console.log('ok', name); } catch (e) { failed.push(name); console.log('FAIL', name, '-', String(e?.message || e).split('\n')[0].slice(0, 240)); } }
if (failed.length) { console.log(`pass-b-stopgap-review6.test: ${failed.length} FAILED, ${n} passed`); process.exit(1); }
console.log(`pass-b-stopgap-review6.test: ${n} checks passed`);
