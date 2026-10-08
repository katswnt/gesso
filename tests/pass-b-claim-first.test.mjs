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
  // the writer gets B3's neutral note, never B1's candidate wording; a confirmed row with no note is dropped
  const out = { verifications: [{ requestId: 'a', found: true, bbox: [0.2, 0.2, 0.2, 0.2], confidence: 0.8, note: 'Two hands rest on a kneeling figure.' }] };
  assert.deepEqual(CF.confirmedVisuals(r, out), [{ id: 'a', text: 'Two hands rest on a kneeling figure.', bbox: [0.1, 0.1, 0.2, 0.2] }]);
  assert.deepEqual(CF.confirmedVisuals(r, { verifications: [{ requestId: 'a', note: '  ' }] }), []);
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
  assert.deepEqual(w.sentences.filter(x => x.issues.length).map(x => `${x.id}:${x.issues.join('|')}`), ['n0.b1:unknown id zz', 'n1.h:no ids', 'h1.h:text does not cite its own pin'], 'v11: a hotspot whose text does not cite its own pin is flagged');
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

check('identities: verbatim quote required, visual link only to confirmed visuals, judge input pairs passage with visual', () => {
  const input = CF.buildIdentityInput({ workId: 'w', title: 'Triptych', passages: ['The work was commissioned by the Castilian merchant Jean de Sedano , who kneels at left.'], visuals: [{ id: 'd1', text: 'A kneeling man in black at lower left.' }] });
  const out = { v: CF.IDENT_VERSION, ids: [
    { claim: 'The kneeling man at left is the donor Jean de Sedano.', name: 'Jean de Sedano', kind: 'person', e: 'P1', quote: 'the Castilian merchant Jean de Sedano, who kneels at left', visual: 'd1' },
    { claim: 'Saint John stands at right.', name: 'Saint John', kind: 'religious', e: 'P1', quote: 'Saint John stands at right', visual: 'none' },
    { claim: 'X', name: 'X', kind: 'other', e: 'P1', quote: 'commissioned by … Sedano', visual: 'd9' }] };
  const a = CF.controlIdentity(out, input);
  assert.deepEqual(a.rows.map(r => r.issues.length), [0, 1, 2]); // spacing tolerated; invented quote and elision rejected
  assert.equal(a.rows[0].visual, 'd1'); assert.equal(a.rows[1].visual, null); assert.equal(a.rows[2].visual, null);
  const j = CF.buildIdentityJudgeInput({ workId: 'w', identInput: input, identAudit: a });
  // identity and visual link are judged as two separate questions
  assert.deepEqual(j.pairs.map(p => [p.id, p.evidence.map(e => e.ref).join('+')]), [['id1', 'E1'], ['id1-v', 'E1+E2']]);
  assert.match(j.pairs[1].claim, /unnamed description/);
  const row = (id, verdict) => ({ id, verdict, ref: verdict === 'supported' ? 'E1' : 'none', issues: [] });
  assert.deepEqual(CF.supportedIdentities(j, { rows: [row('id1', 'supported'), row('id1-v', 'supported')] }, a).map(x => [x.name, x.visual]), [['Jean de Sedano', 'd1']]);
  // identity passes, link fails: still named, but not anchored to a hotspot
  assert.deepEqual(CF.supportedIdentities(j, { rows: [row('id1', 'supported'), row('id1-v', 'unsupported')] }, a).map(x => [x.name, x.visual]), [['Jean de Sedano', null]]);
  // link alone never names anyone
  assert.deepEqual(CF.supportedIdentities(j, { rows: [row('id1', 'unsupported'), row('id1-v', 'supported')] }, a), []);
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
check('write /6 guide: a Q&A survives only with its question AND >= 1 checked answer; questions are checked for presuppositions', () => {
  const input = { claims: [{ id: 'c0', text: 'It was shown at the 1834 Salon.' }, { id: 'c1', text: 'The real execution took place at Tower Green.' }], visuals: [{ id: 'v1', text: 'a block', bbox: [0.4, 0.7, 0.1, 0.1] }] };
  const out = { v: CF.WRITE_VERSION, why: [{ s: 'Why.', ids: ['c0'] }], notes: [], hotspots: [], guide: [
    { q: { s: 'Is the scene accurate?', ids: ['c1'] }, a: [{ s: 'No: it happened outdoors.', ids: ['c1'] }, { s: 'Added fact.', ids: ['c1'] }, { s: 'Look at the walls.', ids: ['c1'] }] },
    { q: { s: 'Why is she afraid?', ids: ['v1'] }, a: [{ s: 'Answer.', ids: ['v1'] }] },
    { q: { s: 'Where is the block?', ids: ['v1'] }, a: [{ s: 'Lost answer.', ids: ['v1'] }] }] };
  const w = CF.controlWrite(out, input);
  assert.deepEqual(w.sentences.filter(x => x.section === 'g0').map(x => x.id), ['g0.q', 'g0.a0', 'g0.a1', 'g0.a2']);
  const ci = CF.buildCheckInput({ workId: 'w', writeInput: input, writeAudit: w });
  assert.match(ci.sentences.find(x => x.id === 'g1.q').kind, /^question/);
  const verdicts = { 'g0.a1': 'adds', 'g1.q': 'adds', 'g2.a0': 'adds' };
  const a = CF.assemble({ writeAudit: w, checkAudit: { rows: ci.sentences.map(x => ({ id: x.id, verdict: verdicts[x.id] || 'ok' })) }, visuals: input.visuals });
  assert.deepEqual(a.guide, [{ q: 'Is the scene accurate?', a: 'No: it happened outdoors. Look at the walls.' }]);
  assert(a.trimmed.some(x => x.id === 'g1.q') && a.trimmed.some(x => x.id === 'g0.a1'));
  assert.ok(CF.WRITE_WIRE_SCHEMA.required.includes('guide'));
});
check('write /7: label-answerable guide questions are trimmed; usable counts guide questions when notes fold in', () => {
  for (const q of ['What style is it?', 'Where and when was it made?', 'What is the medium?', 'What is it made of, and in what style?', 'Who painted this?', 'When was it painted?'])
    assert.ok(CF.LABEL_QUESTION.test(q), q);
  for (const q of ['Why make Fuji so tiny?', 'Where is Mount Fuji in this picture?', 'Is the sky invented?', 'How can we date it to the mid-1400s in Florence?', 'What style markers point to Van Gogh?', 'Why use oil paint for this scene?'])
    assert.ok(!CF.LABEL_QUESTION.test(q), q);
  const input = { claims: [{ id: 'c0', text: 'w' }, { id: 'c1', text: 'x' }], visuals: [{ id: 'v1', text: 'y', bbox: [0, 0, 0.2, 0.2] }, { id: 'v2', text: 'z', bbox: [0.5, 0.5, 0.2, 0.2] }] };
  const S = (s, ids = ['c1']) => ({ s, ids });
  const out = { v: CF.WRITE_VERSION, why: [S('Why.', ['c0'])], notes: [], hotspots: [{ anchor: 'v1', head: S('A', ['v1']), body: [S('a.', ['v1'])] }, { anchor: 'v2', head: S('B', ['v2']), body: [S('b.', ['v2'])] }],
    guide: [{ q: S('What style is it?'), a: [S('Romanticism.')] }, ...['Q1?', 'Q2?', 'Q3?'].map(q => ({ q: S(q), a: [S('A.')] }))] };
  const w = CF.controlWrite(out, input), ci = CF.buildCheckInput({ workId: 'w', writeInput: input, writeAudit: w });
  assert.deepEqual(w.sentences.find(x => x.id === 'g0.q').issues, ['label question']);
  const a = CF.assemble({ writeAudit: w, checkAudit: { rows: ci.sentences.map(x => ({ id: x.id, verdict: 'ok' })) }, visuals: input.visuals });
  assert.equal(a.guide.length, 3); assert.deepEqual(a.usable, { minimal: true, strict: true });
  assert.match(CF.WRITE_PROMPT, /Never ask what the label\s+answers/); assert.match(CF.WRITE_PROMPT, /Why would a water jar carry a scene from the\s+Iliad/, 'worked examples are in the prompt');
});
check('write /8: self-narrated limits are pipeline language and are trimmed', () => {
  for (const x of ['How to read that is left to the viewer, since calling her serene is interpretation.', 'Its sources are not stated here, so it is best read as a visual form.'])
    assert.ok(CF.PIPELINE_LANGUAGE.test(x), x);
  for (const x of ['Notice how the light sets her apart.', 'Scholars read it as a scene of the Flood.', 'The viewer looks at the pair rather than meeting a gaze.'])
    assert.ok(!CF.PIPELINE_LANGUAGE.test(x), x);
});
check('write /9: hotspots carry an axis; an axis without a kept claim-citing sentence becomes delight; schema requires axis', () => {
  const input = { claims: [{ id: 'c1', text: 'Shell ornament is a hallmark of Neo-Classical design.' }], visuals: [{ id: 'v1', text: 'shell relief', bbox: [0.1, 0.1, 0.2, 0.2] }, { id: 'v2', text: 'lattice', bbox: [0.5, 0.5, 0.2, 0.2] }] };
  const S = (s, ids) => ({ s, ids });
  const out = { v: CF.WRITE_VERSION, why: [S('Why.', ['c1'])], notes: [], guide: [], hotspots: [
    { anchor: 'v1', axis: 'style', head: S('Shell relief', ['v1']), body: [S('Notice the shell.', ['v1']), S('It is a hallmark of Neo-Classical design.', ['c1', 'v1'])] },
    { anchor: 'v2', axis: 'when', head: S('Lattice', ['v2']), body: [S('A diamond lattice band.', ['v2'])] }] };
  const w = CF.controlWrite(out, input), ci = CF.buildCheckInput({ workId: 'w', writeInput: input, writeAudit: w });
  const a = CF.assemble({ writeAudit: w, checkAudit: { rows: ci.sentences.map(x => ({ id: x.id, verdict: 'ok' })) }, visuals: input.visuals });
  assert.deepEqual(a.hotspots.map(h => h.axis), ['style', 'delight']);
  const b = CF.assemble({ writeAudit: w, checkAudit: { rows: ci.sentences.map(x => ({ id: x.id, verdict: x.id === 'h0.b1' ? 'adds' : 'ok' })) }, visuals: input.visuals });
  assert.equal(b.hotspots[0].axis, 'delight', 'the sourced link was trimmed, so the tag cannot claim it');
  assert.ok(CF.WRITE_WIRE_SCHEMA.properties.hotspots.items.required.includes('axis'));
  assert.match(CF.WRITE_PROMPT, /WORKED EXAMPLES/); assert.match(CF.WRITE_PROMPT, /Don't repeat an answer/);
});
check('v9 review: any mention of the catalog in player copy is trimmed', () => {
  for (const x of ["That absence fits the catalog's label of abstract art.", 'The catalog classes the painting as Baroque.', 'It is catalogued as Romanticism.', 'The catalog gives Munich, Germany, and 1913.'])
    assert.ok(CF.PIPELINE_LANGUAGE.test(x), x);
  assert.ok(!CF.PIPELINE_LANGUAGE.test('Look for the detailed Tudor dress.')); assert.ok(!CF.PIPELINE_LANGUAGE.test('A catalog of saints fills the border.'));
});
check('write /10 + assembly /3: gk is citable; a why that lost its opening is dropped; shared evidence ids are NOT treated as repeats', () => {
  const input = { claims: [{ id: 'c1', text: 'Thought destroyed after the 1928 flood; rediscovered in 1973.' }, { id: 'c2', text: 'A sensation at the 1834 Salon.' }], visuals: [{ id: 'v1', text: 'thick curved strokes', bbox: [0.1, 0.8, 0.2, 0.1] }, { id: 'v2', text: 'awning', bbox: [0.3, 0.3, 0.2, 0.2] }] };
  const S = (s, ids) => ({ s, ids });
  const out = { v: CF.WRITE_VERSION, notes: [],
    why: [S('Delaroche made a sensation at the 1834 Salon.', ['c2']), S('It was later thought destroyed in 1928, then found in 1973.', ['c1'])],
    hotspots: [{ anchor: 'v1', axis: 'artist', head: S('Cobblestones', ['v1']), body: [S('Each stone is one thick curved stroke, a habit typical of Van Gogh.', ['v1', 'gk'])] },
      { anchor: 'v2', axis: 'delight', head: S('Awning', ['v2']), body: [S('The gold awning pulls the eye.', ['v2'])] }],
    guide: [{ q: S('Did it survive?', ['c1']), a: [S('It was thought destroyed in 1928.', ['c1'])] }, { q: S('Why was it a sensation?', ['c2']), a: [S('Look at the staging.', ['gk']), S('Repeat of the why.', ['c2']), S('Notice the light.', ['gk'])] }] };
  const w = CF.controlWrite(out, input);
  assert.deepEqual(w.sentences.find(x => x.id === 'h0.b0').issues, [], 'gk is a known id');
  const ci = CF.buildCheckInput({ workId: 'w', writeInput: input, writeAudit: w });
  assert.match(ci.sentences.find(x => x.id === 'h0.b0').items.find(i => i.id === 'gk').text, /^general knowledge/);
  const ok = CF.assemble({ writeAudit: w, checkAudit: { rows: ci.sentences.map(x => ({ id: x.id, verdict: 'ok' })) }, visuals: input.visuals });
  assert.equal(ok.hotspots[0].axis, 'artist', 'gk counts as a source for the axis');
  assert.deepEqual(ok.guide.map(g => g.q), ['Did it survive?', 'Why was it a sensation?'], 'assembly /3: reusing an evidence id is not repetition (Codex audit)');
  assert.equal(ok.guide[1].a, 'Look at the staging. Repeat of the why. Notice the light.');
  const frag = CF.assemble({ writeAudit: w, checkAudit: { rows: ci.sentences.map(x => ({ id: x.id, verdict: x.id === 'why.0' ? 'adds' : 'ok' })) }, visuals: input.visuals });
  assert.equal(frag.why, null, 'a why starting "It was later…" without its opening is not published');
  assert.match(CF.CHECK_PROMPT, /"gk"/); assert.match(CF.CHECK_PROMPT, /framed possible reading/); assert.match(CF.WRITE_PROMPT, /never just names or describes an\s+object/);
});
check('assembly /3: hotspot-detail reuse is kept (no ID de-dup); "museum classes" is trimmed at assembly, not in the S3 control', () => {
  const input = { claims: [{ id: 'c0', text: 'w' }, { id: 'c1', text: 'x' }, { id: 'cat.style', text: 'style' }], visuals: [{ id: 'v1', text: 'cobbles', bbox: [0.1, 0.8, 0.2, 0.1] }, { id: 'v2', text: 'stars', bbox: [0.5, 0.1, 0.2, 0.1] }] };
  const S = (s, ids) => ({ s, ids });
  const out = { v: CF.WRITE_VERSION, notes: [], why: [S('Why.', ['c0'])],
    hotspots: [{ anchor: 'v1', axis: 'style', head: S('Cobbles', ['v1']), body: [S('Single strokes, typical of Van Gogh.', ['v1', 'gk'])] }, { anchor: 'v2', axis: 'delight', head: S('Stars', ['v2']), body: [S('Bursts.', ['v2'])] }],
    guide: [{ q: S('How was the pavement made?', ['v1']), a: [S('Each cobble is one curved stroke.', ['v1'])] },
      { q: S('How do I spot Van Gogh elsewhere?', ['gk']), a: [S('The museum classes it as Post-Impressionism.', ['cat.style']), S('Look for thick strokes.', ['gk'])] }] };
  const w = CF.controlWrite(out, input), ci = CF.buildCheckInput({ workId: 'w', writeInput: input, writeAudit: w });
  assert.deepEqual(w.sentences.find(x => x.id === 'g1.a0').issues, [], 'S3 control unchanged, so accepted results re-derive identically');
  const a = CF.assemble({ writeAudit: w, checkAudit: { rows: ci.sentences.map(x => ({ id: x.id, verdict: 'ok' })) }, visuals: input.visuals });
  assert.deepEqual(a.guide, [{ q: 'How was the pavement made?', a: 'Each cobble is one curved stroke.' }, { q: 'How do I spot Van Gogh elsewhere?', a: 'Look for thick strokes.' }]);
  assert.ok(a.trimmed.some(t => t.why === 'source-speak') && !a.trimmed.some(t => /repeats/.test(t.why)));
});
check('v11 regression pack (Codex audit fixtures): dangling "that approach", Composition-style guide survives, multi-sentence rows split, caveats stripped', () => {
  const S = (s, ids) => ({ s, ids });
  const input = { claims: [{ id: 'c1', text: 'Neoclassical marble.' }, { id: 'c2', text: 'Made in 1794.' }], visuals: [{ id: 'v1', text: 'polished skin', bbox: [0.4, 0.4, 0.2, 0.2] }, { id: 'v2', text: 'black lines over color', bbox: [0.2, 0.3, 0.2, 0.2] }] };
  const out = { v: CF.WRITE_VERSION, notes: [], why: [S('A marble group made in 1794.', ['c2'])],
    hotspots: [{ anchor: 'v1', axis: 'medium', head: S('Polished skin', ['v1']), body: [S('The skin is polished smooth, as marble allows.', ['v1', 'gk'])] }],
    guide: [
      { q: S('What makes this Neoclassical?', ['c1']), a: [S('Neoclassical sculptors looked back to ancient models. That approach shows in the smooth skin.', ['c1', 'gk', 'v1'])] },
      { q: S('How do the black lines change the color?', ['v2']), a: [S('Thin black lines sit over broad color fields.', ['v2']), S('They work as a drawn layer on top of the painted areas.', ['v2', 'gk'])] }] };
  const w = CF.controlWrite(out, input);
  assert.deepEqual(w.sentences.filter(x => x.section === 'g0').map(x => x.id), ['g0.q', 'g0.a0', 'g0.a0~1'], 'a two-sentence row is split; parts keep the citations');
  const ci = CF.buildCheckInput({ workId: 'w', writeInput: input, writeAudit: w });
  assert.match(ci.sentences.find(x => x.id === 'g0.a0~1').unit, /^answer to: What makes this Neoclassical/);
  assert.match(ci.sentences.find(x => x.id === 'h0.b0').unit, /pinned on: polished skin/);
  const a = CF.assemble({ writeAudit: w, checkAudit: { rows: ci.sentences.map(x => ({ id: x.id, verdict: x.id === 'g0.a0' ? 'adds' : 'ok' })) }, visuals: input.visuals });
  assert.ok(!a.guide.some(g => /That approach/.test(g.a)), 'Psyche case: "That approach…" after a trimmed sentence is not published');
  assert.ok(a.trimmed.some(t => t.id === 'g0.a0~1' && /antecedent/.test(t.why)));
  assert.deepEqual(a.guide.map(g => g.q), ['How do the black lines change the color?'], 'Composition case: a question building on a pinned detail survives');
  assert.equal(CF.cleanVisualText('A blindfolded figure in white. Whether she looks serene is a matter of interpretation. Straw lies around the block.'), 'A blindfolded figure in white. Straw lies around the block.');
  assert.ok(CF.buildWriteInput({ workId: 'w', catalog: {}, claims: [], visuals: [{ id: 'v', text: 'It is unclear whether this is a lamp.' }] }).visuals.length === 0, 'a visual left empty after cleaning is dropped');
  assert.ok(CF.WORKED_EXAMPLES.startsWith('## 1.') && CF.WORKED_EXAMPLES.length > 10000);
});
check('v12 / assembly /4: "Later it…" after a trimmed sentence is dangling; hotspot headings lose trailing punctuation; prompt carries restraint and optional closer', () => {
  const S = (s, ids) => ({ s, ids });
  const input = { claims: [{ id: 'c1', text: 'x' }, { id: 'c2', text: 'y' }], visuals: [{ id: 'v1', text: 'z', bbox: [0.1, 0.1, 0.2, 0.2] }] };
  const out = { v: CF.WRITE_VERSION, notes: [], guide: [], why: [S('A hushed theatrical scene.', ['c1']), S('Later it was thought destroyed in a flood.', ['c2'])],
    hotspots: [{ anchor: 'v1', axis: 'delight', head: S('The lit dress.', ['v1']), body: [S('It draws the eye.', ['v1'])] }] };
  const w = CF.controlWrite(out, input), ci = CF.buildCheckInput({ workId: 'w', writeInput: input, writeAudit: w });
  const a = CF.assemble({ writeAudit: w, checkAudit: { rows: ci.sentences.map(x => ({ id: x.id, verdict: x.id === 'why.0' ? 'adds' : 'ok' })) }, visuals: input.visuals });
  assert.equal(a.why, null); assert.ok(a.trimmed.some(t => t.id === 'why.1' && /antecedent/.test(t.why)));
  assert.equal(a.hotspots[0].head, 'The lit dress');
  assert.match(CF.WRITE_PROMPT, /optional/); assert.match(CF.WRITE_PROMPT, /Restraint/); assert.match(CF.CHECK_PROMPT, /Romanticism/);
  assert.ok(!/only way to make tone/.test(CF.WORKED_EXAMPLES));
});
check('assembly /5: "He painted it…" after a trimmed sentence survives; "That makes…" and "Later it…" do not', () => {
  const S = (s, ids) => ({ s, ids });
  const input = { claims: [{ id: 'c1', text: 'x' }, { id: 'c2', text: 'y' }, { id: 'c3', text: 'z' }], visuals: [] };
  const out = { v: CF.WRITE_VERSION, notes: [], guide: [], hotspots: [], why: [S('A night scene without black.', ['c1']), S('He painted it outdoors at night.', ['c2']), S('That makes it a record of a moment.', ['c3'])] };
  const w = CF.controlWrite(out, input), ci = CF.buildCheckInput({ workId: 'w', writeInput: input, writeAudit: w });
  const verd = id => id === 'why.0' ? 'adds' : 'ok';
  let a = CF.assemble({ writeAudit: w, checkAudit: { rows: ci.sentences.map(x => ({ id: x.id, verdict: verd(x.id) })) }, visuals: [] });
  assert.equal(a.why, 'He painted it outdoors at night. That makes it a record of a moment.');
  assert.ok(!/later/.test(CF.assemble({ writeAudit: CF.controlWrite({ ...out, why: [S('A scene.', ['c1']), S('It was later thought lost.', ['c2'])] }, input), checkAudit: { rows: [{ id: 'why.0', verdict: 'adds' }, { id: 'why.1', verdict: 'ok' }] }, visuals: [] }).why || ''), '"It was later…" still depends on the cut sentence');
  a = CF.assemble({ writeAudit: w, checkAudit: { rows: ci.sentences.map(x => ({ id: x.id, verdict: x.id === 'why.1' ? 'adds' : 'ok' })) }, visuals: [] });
  assert.equal(a.why, 'A night scene without black.', '"That makes…" after a trimmed sentence is dropped');
});
check('v13 / assembly /6: editorial flags surface lost why openings, one-sentence stubs and thin guides without deleting anything', () => {
  const S = (s, ids) => ({ s, ids });
  const input = { claims: [{ id: 'c1', text: 'x' }, { id: 'c2', text: 'y' }], visuals: [] };
  const out = { v: CF.WRITE_VERSION, notes: [], hotspots: [], why: [S('Bold claim.', ['c1']), S('He worked outdoors.', ['c2'])],
    guide: [{ q: S('What is happening?', ['c1']), a: [S('A rescue.', ['c1']), S('Cupid bends to kiss her.', ['c2'])] }] };
  const w = CF.controlWrite(out, input), ci = CF.buildCheckInput({ workId: 'w', writeInput: input, writeAudit: w });
  const a = CF.assemble({ writeAudit: w, checkAudit: { rows: ci.sentences.map(x => ({ id: x.id, verdict: ['why.0', 'g0.a1'].includes(x.id) ? 'adds' : 'ok' })) }, visuals: [] });
  assert.equal(a.why, 'He worked outdoors.'); assert.equal(a.guide[0].a, 'A rescue.');
  assert.deepEqual(a.flags, ['why lost its opening sentence', 'g0: answer cut to one sentence', 'only 1 follow-up questions']);
  assert.match(CF.WRITE_PROMPT, /CITATION PATTERNS/); assert.match(CF.CHECK_PROMPT, /seem to move at different speeds/);
});
console.log(`pass-b-claim-first.test: ${n} checks passed`);
