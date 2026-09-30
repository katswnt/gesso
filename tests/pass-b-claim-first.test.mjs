// Claim-first prototype: candidate building, visual confirmation rule, write/check controllers, trim-and-survive
// assembly, and the image-stage safeguards against a REAL preserved B3 transcript. Offline.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RUN_ROOT, parseStreamTranscript } from '../scripts/lib/pass-b-calibration.mjs';
import * as CF from '../scripts/lib/pass-b-claim-first.mjs';
import { deriveStageAttempt } from '../scripts/pass-b-shadow-audit.mjs';

let n = 0; const check = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`FAIL ${name}`); throw e; } };
check('visual candidates: delights with boxes plus point pins as 10% boxes, capped and ordered', () => {
  const b1 = { visual: { delights: Array.from({ length: 7 }, (_, i) => ({ delightId: `d${i}`, note: `Detail ${i}. It means something.`, bbox: [0.1, 0.1, 0.2, 0.2], confidence: i / 10 })) },
    noteCandidates: [{ noteId: 'n1', body: 'A red cap. Symbolic.', pin: { x: 50, y: 50 }, confidence: 0.95 }, { noteId: 'n2', body: 'No pin.', confidence: 0.99 }] };
  const c = CF.visualCandidates(b1);
  assert.equal(c.length, 8); assert.equal(c[0].id, 'pin-n1'); assert.deepEqual(c[0].bbox, [0.45, 0.45, 0.1, 0.1]);
  assert.equal(c[0].text, 'A red cap.'); assert.ok(!c.some(x => x.id === 'pin-n2'));
});
check('confirmation needs found, confidence >= 0.6 and an overlapping region', () => {
  const input = { candidates: [{ id: 'a', text: 'x', bbox: [0.1, 0.1, 0.2, 0.2] }, { id: 'b', text: 'y', bbox: [0.1, 0.1, 0.2, 0.2] }, { id: 'c', text: 'z', bbox: [0.1, 0.1, 0.2, 0.2] }, { id: 'd', text: 'w', bbox: [0.1, 0.1, 0.2, 0.2] }] };
  const r = CF.controlConfirm({ verifications: [
    { requestId: 'a', found: true, bbox: [0.2, 0.2, 0.2, 0.2], confidence: 0.8 }, { requestId: 'b', found: true, bbox: [0.6, 0.6, 0.2, 0.2], confidence: 0.9 },
    { requestId: 'c', found: true, bbox: [0.2, 0.2, 0.1, 0.1], confidence: 0.5 }, { requestId: 'zz', found: true, bbox: null }] }, input);
  assert.deepEqual(r.rows.map(x => x.confirmed), [true, false, false, false]);
  assert.deepEqual(r.errors, ['unknown request zz']);
  assert.deepEqual(CF.confirmedVisuals(r).map(v => v.id), ['a']);
});
check('only supported claims with a real evidence ref and no issues are writable', () => {
  const s1Input = { pairs: [{ id: 'f1', claim: 'A' }, { id: 'f2', claim: 'B' }, { id: 'f3', claim: 'C' }, { id: 'f4', claim: 'D' }] };
  const audit = { rows: [{ id: 'f1', verdict: 'supported', ref: 'E1', issues: [] }, { id: 'f2', verdict: 'supported', ref: 'none', issues: ['supported without a ref'] },
    { id: 'f3', verdict: 'unsupported', ref: 'none', issues: [] }, { id: 'f4', verdict: 'supported', ref: 'E9', issues: ['unknown ref E9'] }] };
  assert.deepEqual(CF.supportedClaims(s1Input, audit), [{ id: 'f1', text: 'A' }]);
});
const writeInput = { unit: 'w', catalog: {}, claims: [{ id: 'f1', text: 'Painted in 1668 by Rembrandt.' }], visuals: [{ id: 'd1', text: 'A bare foot.', bbox: [0.1, 0.8, 0.2, 0.1] }] };
const S = (s, ids) => ({ s, ids });
const written = { v: CF.WRITE_VERSION,
  why: [S('Rembrandt painted it in 1668.', ['f1']), S('It changed everything.', ['f1'])],
  notes: [{ head: S('A late work', ['f1']), body: [S('It dates from 1668.', ['f1']), S('Made for a king.', ['zz'])] }, { head: S('Invented heading', []), body: [S('It dates from 1668.', ['f1'])] }],
  hotspots: [{ anchor: 'd1', head: S('The bare foot', ['d1']), body: [S('Notice the bare foot.', ['d1'])] }, { anchor: 'dX', head: S('Other', ['d1']), body: [S('Look.', ['d1'])] }] };
check('write controller flags unknown ids, missing ids and unconfirmed hotspot anchors', () => {
  const w = CF.controlWrite(written, writeInput);
  assert.deepEqual(w.sentences.filter(x => x.issues.length).map(x => `${x.id}:${x.issues.join('|')}`), ['n0.b1:unknown id zz', 'n1.h:no ids']);
  assert.deepEqual(w.anchorIssues, ['h1: anchor dX is not a confirmed visual']);
  const ci = CF.buildCheckInput({ workId: 'w', writeInput, writeAudit: w });
  assert.ok(!ci.sentences.some(x => x.id === 'n0.b1' || x.id === 'n1.h'));
  assert.equal(ci.sentences.find(x => x.id === 'h0.b0').items[0].text, 'visible detail: A bare foot.');
});
check('assembly trims failing sentences; a note or hotspot needs its head and one body sentence; usable thresholds', () => {
  const w = CF.controlWrite(written, writeInput);
  const ci = CF.buildCheckInput({ workId: 'w', writeInput, writeAudit: w });
  const verdicts = { 'why.1': 'adds' };
  const chk = CF.controlCheck({ v: CF.CHECK_VERSION, j: ci.sentences.map(x => ({ id: x.id, verdict: verdicts[x.id] || 'ok', reason: 'r' })) }, ci);
  const a = CF.assemble({ writeAudit: w, checkAudit: chk, visuals: writeInput.visuals });
  assert.equal(a.why, 'Rembrandt painted it in 1668.');
  assert.deepEqual(a.notes, [{ head: 'A late work', body: 'It dates from 1668.' }]); // n1 dropped: head had no ids
  assert.equal(a.hotspots.length, 1); assert.equal(a.hotspots[0].anchor, 'd1'); assert.ok(Math.abs(a.hotspots[0].x - 0.2) < 1e-9);
  assert.deepEqual(a.usable, { minimal: true, strict: false });
  assert.ok(a.trimmed.some(t => t.id === 'why.1' && /adds/.test(t.why)) && a.trimmed.some(t => t.id === 'n0.b1'));
});
check('a missing check verdict trims the sentence (fail closed)', () => {
  const w = CF.controlWrite(written, writeInput);
  const a = CF.assemble({ writeAudit: w, checkAudit: { rows: [] }, visuals: writeInput.visuals });
  assert.equal(a.why, null); assert.deepEqual(a.usable, { minimal: false, strict: false });
});

import('../scripts/pass-b-b4-structured-canary.mjs').then(({ noToolCallProvenance }) => {
  const t = model => `${[{ type: 'system', subtype: 'init', apiKeySource: 'none', model, tools: ['StructuredOutput'] },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't0', name: 'StructuredOutput', input: {} }] } },
    { type: 'result', subtype: 'success', is_error: false, structured_output: {}, modelUsage: { [model]: { output_tokens: 1 } }, usage: { output_tokens: 1 } }].map(r => JSON.stringify(r)).join('\n')}\n`;
  assert.equal(noToolCallProvenance(t('claude-sonnet-5-5'), 0).kind, 'fatal'); // default still pins 4.6
  assert.notEqual(noToolCallProvenance(t('claude-sonnet-5-5'), 0, { expectedModel: 'claude-sonnet-5-5' }).kind, 'fatal');
  assert.equal(noToolCallProvenance(t('claude-sonnet-4-6'), 0, { expectedModel: 'claude-sonnet-5-5' }).kind, 'fatal');
  console.log('pass-b-claim-first.test: model pin checks passed');
});

import('../scripts/lib/pass-b-calibration.mjs').then(({ buildStageCommand }) => {
  const items = CF.catalogItems({ title: 'Night', artist: 'Arkhip Kuindzhi', date: '1908', catalogId: 'Q1', medium: '' });
  assert.deepEqual(items.map(i => i.id), ['cat.title', 'cat.artist', 'cat.date']);
  const wi = CF.buildWriteInput({ workId: 'w', catalog: { date: '1908' }, claims: [{ id: 'f1', text: 'x' }], visuals: [] });
  const w = CF.controlWrite({ why: [{ s: 'It was painted in 1908.', ids: ['cat.date'] }, { s: 'The catalog entry omits the support.', ids: ['cat.date'] }, { s: 'The research note says so.', ids: ['f1'] }], notes: [], hotspots: [] }, wi);
  assert.deepEqual(w.sentences.map(x => x.issues.join('|')), ['', 'pipeline language', 'pipeline language']);
  for (const ok of ['The claim of divine right runs through the scene.', 'A catalog of saints fills the border.', 'The sources of the river are shown at left.']) assert.ok(!CF.PIPELINE_LANGUAGE.test(ok), ok);
  for (const bad of ['According to the sources, it dates from 1908.', 'The cited claims say it is Florentine.', 'Its metadata lists oil.']) assert.ok(CF.PIPELINE_LANGUAGE.test(bad), bad);
  const argv = (stage, effort) => buildStageCommand({ stage, promptText: 'x', imageFile: stage === 'B3' ? `${'0'.repeat(64)}.jpg` : null, effort }).argv;
  assert.ok(!argv('B3', null).includes('--effort')); // collector B3 unchanged
  assert.equal(argv('B3', 'low')[argv('B3', 'low').indexOf('--effort') + 1], 'low');
  assert.equal(argv('B4', 'high')[argv('B4', 'high').indexOf('--effort') + 1], 'low'); // B4 stays pinned low
  console.log('pass-b-claim-first.test: pilot-1 fix checks passed');
});

// ---- image-stage safeguards against a REAL preserved B3 transcript (skipped where absent) ----
const corpus = join(RUN_ROOT, 'corpus-b3-6401bc543ead', 'works');
const realB3 = existsSync(corpus) ? readdirSync(corpus).map(d => join(corpus, d, 'attempts')).filter(existsSync)
  .flatMap(a => readdirSync(a).filter(f => f.startsWith('b3-') && f.endsWith('.jsonl')).map(f => join(a, f))).at(-1) : null;
if (realB3) {
  check('real B3 transcript: Read+StructuredOutput provenance passes, confinement enforced, wrong image is fatal', () => {
    const t = readFileSync(realB3, 'utf8'), tr = parseStreamTranscript(t);
    const imageFile = tr.toolUses.find(u => u.name === 'Read').input.file_path.split('/').pop();
    const reqIds = (tr.final?.structured_output?.verifications || []).map(v => v.requestId);
    const plan = { imageFile, input: { candidates: reqIds.map(id => ({ id, text: 'x', bbox: [0, 0, 1, 1] })) }, stageSpec: { allowedTools: ['Read', 'StructuredOutput'], image: true, control: CF.controlConfirm } };
    const d = deriveStageAttempt(plan, t, 0);
    assert.equal(d.kind, 'accepted', d.errors.join('; ')); assert.equal(d.imageReceipt.ok, true);
    assert.equal(deriveStageAttempt({ ...plan, imageFile: `x${imageFile}` }, t, 0).kind, 'fatal');
    assert.equal(deriveStageAttempt({ ...plan, stageSpec: { ...plan.stageSpec, allowedTools: ['StructuredOutput'] } }, t, 0).kind, 'fatal');
  });
}
console.log(`pass-b-claim-first.test: ${n} checks passed`);
