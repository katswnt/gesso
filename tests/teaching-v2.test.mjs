// Teaching-v2 Phase A (VSD-093) offline regressions: schemas + referential validation, exact-quote validation,
// projection (0-1 -> percent exactly once, no renumbering around no-dot notes), current-renderer model, attempt
// budget, pass/hold rules, controller end-to-end with a fake invoke, confinement classification, hardened capture.
// No model calls, no network, no repository data/incoming dependency.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { sha256 } from '../scripts/lib/vision-legacy.mjs';
import * as C from '../scripts/lib/teaching-v2-contract.mjs';
import * as P from '../scripts/lib/teaching-v2-prompts.mjs';
import { buildConfinedCommand, classifyTranscript, CONFINED_FLAGS } from '../scripts/lib/teaching-v2-stage.mjs';
import { buildStageCommand } from '../scripts/lib/pass-b-calibration.mjs';
import { projectLesson, validateProjection, faithfulView, renderPreviewPage } from '../scripts/lib/teaching-v2-projection.mjs';
import { loadCurrentRenderer } from '../scripts/lib/teaching-v2-current-render.mjs';
import { runWork, PauseRun, LatchStop, telemetry, candidateBinding, bindingSha } from '../scripts/lib/teaching-v2-controller.mjs';
import { assemblePacket, buildSections, applyBudget, vetUrls, createSourceCapture, lexicalKeywordHits } from '../scripts/lib/teaching-v2-capture.mjs';
import { diagnosticRequests, validateLocalization, b3Lesson, compareMethods } from '../scripts/lib/teaching-v2-pins.mjs';
import { importB3Candidates, derivePlan } from '../scripts/lib/teaching-v2-inputs.mjs';

let n = 0; const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const clone = v => JSON.parse(JSON.stringify(v));

// ---------- fixtures ----------
const HTML = `<html><head><title>Example Jar | Museum</title></head><body><nav>Home Shop Visit</nav>
<p>This water jar was made in Athens around 505 BCE and shows Priam asking Achilles for the body of Hector.</p>
<p>The painter left the figures in the color of the clay and covered the background with black slip.</p>
<p>Menu</p><p>Jars like this were used for carrying water from the fountain house.</p></body></html>`;
const snap = { meta: { contentType: 'text/html; charset=utf-8', status: 200, rawSha256: 'r'.repeat(64), retrievedAt: '2026-11-20T00:00:00Z', finalUrl: 'https://museum.example.org/jar', bytes: HTML.length, chain: [] }, raw: Buffer.from(HTML) };
const vetted = [{ url: 'https://museum.example.org/jar', kind: 'holdingInstitution', relationshipToWork: 'thisObject (catalog id)', objectIds: ['1'] }, { url: 'https://missing.example.org/x', kind: 'scholarly', relationshipToWork: 'undeclared (B2 lead)', objectIds: [] }];
const { packet, texts } = assemblePacket({ workId: 'fx1', catalogId: 'fx1', vetted, snapshots: { [vetted[0].url]: snap } });
const S1 = packet.sources[0]; const sec = S1.sections[0];
const QUOTE = 'shows Priam asking Achilles for the body of Hector.';
const slotsRows = (fn) => C.SLOTS.map(fn);
function writerResult() {
  return {
    dossier: {
      status: 'ready',
      identity: { status: 'matched', explanation: 'The record names this jar.', sourceRefs: ['S1#P1'] },
      catalogChecks: [{ field: 'date', proposedValue: 'about 505 BCE', status: 'supported', sourceRefs: ['S1#P1'] }],
      essentials: slotsRows(slot => ({ slot, applicability: 'required', status: 'supported', answer: `answer for ${slot}`, sourceRefs: slot === 'transfer' ? [] : ['S1#P1'], limitation: '' })),
      facts: [{ id: 'F1', proposition: 'Priam asks Achilles for Hector.', scope: 'thisWork', sourceRefs: ['S1#P1'], qualifications: '' }],
      passages: [{ id: 'P1', sourceId: 'S1', sectionId: sec.id, quote: QUOTE }],
      visualBindings: [{ id: 'VB1', factId: 'F1', appearanceToCheck: 'two figures facing', evidenceIds: ['O1'], alternatives: '' }],
      gaps: [], conflicts: [],
    },
    draft: {
      status: 'candidate', holdReasons: [],
      lesson: {
        why: 'This Athenian jar shows the old king Priam asking Achilles to return the body of his son.',
        hotspots: [
          { id: 'h1', tag: 'medium', head: 'Red figures', body: 'The figures are bare clay on black.', x: 0.25, y: 0.5 },
          { id: 'h2', tag: 'style', head: 'Bodies in motion', body: 'Overlapping limbs show the new ambition.', x: null, y: null },
          { id: 'h3', tag: 'format', head: 'Jar shape', body: 'Side handles mark a water jar.', x: 0.8, y: 0.3 },
        ],
        questions: [
          { id: 'q1', q: 'What is happening?', a: 'Priam asks for his son.' }, { id: 'q2', q: 'How does red-figure work?', a: 'Figures are reserved.' },
          { id: 'q3', q: 'What was the jar for?', a: 'Carrying water.' }, { id: 'q4', q: 'How can I spot this elsewhere?', a: 'Look for red figures on black.' },
        ],
      },
      anchors: [
        { hotspotId: 'h1', scope: 'unique', targetDescription: 'the left figure', observationId: 'O1', bbox: [0.1, 0.3, 0.3, 0.4] },
        { hotspotId: 'h2', scope: 'distributed', targetDescription: 'limbs across the scene', observationId: 'O2', bbox: null },
        { hotspotId: 'h3', scope: 'unique', targetDescription: 'the right handle', observationId: 'O3', bbox: [0.7, 0.2, 0.2, 0.2] },
      ],
      observations: [{ id: 'O1', description: 'two figures', region: [0.1, 0.3, 0.6, 0.4] }, { id: 'O2', description: 'overlapping limbs', region: null }, { id: 'O3', description: 'a side handle', region: [0.7, 0.2, 0.2, 0.2] }],
      support: [
        { surface: '/why', assertion: 'Priam asks Achilles', kind: 'sourced', observationIds: [], factIds: ['F1'], sourceRefs: ['S1#P1'], qualification: '' },
        { surface: '/hotspots/0/body', assertion: 'bare clay figures', kind: 'visible', observationIds: ['O1'], factIds: [], sourceRefs: [], qualification: '' },
        { surface: '/hotspots/2/body', assertion: 'side handles', kind: 'visible', observationIds: ['O3'], factIds: [], sourceRefs: [], qualification: '' },
      ],
      coverage: slotsRows(slot => ({ slot, surfaces: ['/questions/3/a'], explanation: '' })),
    },
    localizationRequests: [],
  };
}
const verification = (over = {}) => ({ decision: 'pass', coverage: slotsRows(slot => ({ slot, result: 'adequate', explanation: '' })), issues: [], pins: [{ hotspotId: 'h1', targetMatches: 'yes', pointOnTarget: 'yes', explanation: '' }, { hotspotId: 'h3', targetMatches: 'yes', pointOnTarget: 'yes', explanation: '' }], replacement: null, ...over });
const ctxOpts = () => ({ packet, b1EvidenceIds: new Set() });
const errsOf = wr => C.validateWriterResult(wr, ctxOpts()).errors.join(' | ');

// ---------- gold bundle + prompts ----------
test('gold bundle is examples 1, 2 and 5 verbatim and matches its frozen hash', () => {
  const g = C.extractGoldBundle(readFileSync('docs/teaching-copy-examples.md', 'utf8'));
  assert.equal(g.sha256, C.FROZEN_GOLD_SHA256);
  assert.match(g.text, /^## 1\. Hydria/); assert.match(g.text, /## 2\. Fujimigahara/); assert.match(g.text, /## 5\. The Red Studio/);
  assert.doesNotMatch(g.text, /## 3\.|## 4\.|## 6\.|Prodigal/);
  assert.equal(C.loadGoldBundle('.').sha256, C.FROZEN_GOLD_SHA256);
});
test('section 4 core prompt text is frozen; W and V carry every placeholder block in order', () => {
  assert.equal(sha256(P.WRITER_CORE), P.WRITER_CORE_SHA256); assert.equal(sha256(P.VERIFIER_CORE), P.VERIFIER_CORE_SHA256);
  assert.match(P.WRITER_CORE, /^Write Gesso’s teaching layer/); assert.match(P.VERIFIER_CORE, /Return Verification JSON only\.$/);
  const gold = C.loadGoldBundle('.');
  const w = P.buildWriterPrompt({ gold, catalog: { title: 't' }, b1: { seen: 's' }, packet, conflicts: {}, b3Candidates: [], imageFile: `${'a'.repeat(64)}.jpg` });
  const wl = ['[GOLD_EXAMPLES_1_2_5: voice/structure only, never evidence]', '[UNVERIFIED_CATALOG]', '[COMPLETE_B1]', '[LITERAL_SOURCE_PACKET_AND_ANY_PRIOR_DOSSIER]', '[UNRESOLVED_CATALOG_CONFLICTS]', '[PHYSICAL_B3_CANDIDATES_AND_CAVEATS]', '[SANITIZED_IMAGE_PATH]', '[SCHEMAS_AND_LIMITS]'];
  let at = -1; for (const l of wl) { const i = w.indexOf(`\n${l}\n`); assert.ok(i > at, l); at = i; }
  assert.ok(w.startsWith(P.WRITER_CORE)); assert.ok(w.includes(gold.text) && w.includes(`bundleSha256=${gold.sha256}`));
  const v = P.buildVerifierPrompt({ allowReplacement: false, gold, catalog: {}, b1: {}, packet, conflicts: {}, b3Candidates: [], dossier: {}, draft: {}, projection: {}, imageFile: `${'a'.repeat(64)}.jpg` });
  at = -1; for (const l of ['[ALLOW_REPLACEMENT]', '[GOLD_EXAMPLES_1_2_5]', '[SAME_IMAGE_CATALOG_B1_SOURCE_PACKET_CONFLICTS_AND_DOSSIER]', '[COMPLETE_DRAFT_AND_SUPPORT_MAP]', '[EXACT_PROJECTION_AND_RENDER_MANIFEST]', '[SCHEMA_AND_FAILURE_RUBRIC]']) { const i = v.indexOf(`\n${l}\n`); assert.ok(i > at, l); at = i; }
  assert.match(v, /ALLOW_REPLACEMENT=false/);
});

// ---------- confinement ----------
test('W/V use sonnet-5-5 at high effort with the same confinement flags, bypassing the forced-low B4 branch', () => {
  const schema = C.WRITER_RESULT_WIRE, img = `${'b'.repeat(64)}.png`;
  const w = buildConfinedCommand({ stage: 'W', promptText: 'x', imageFile: img, wireSchema: schema });
  const a = w.argv; const at = f => a[a.indexOf(f) + 1];
  assert.equal(at('--model'), 'claude-sonnet-5-5'); assert.equal(at('--effort'), 'high'); assert.equal(at('--tools'), 'Read'); assert.equal(at('--allowedTools'), 'Read');
  assert.ok(!a.includes('low'));
  assert.equal(buildConfinedCommand({ stage: 'B3D', promptText: 'x', imageFile: img, wireSchema: schema }).effort, 'medium');
  const b1 = buildStageCommand({ stage: 'B1', model: 'claude-sonnet-5-5', promptText: 'x', imageFile: img }).argv;
  assert.deepEqual(b1.slice(b1.indexOf('--json-schema') + 2), [...CONFINED_FLAGS]);
  const b4 = buildStageCommand({ stage: 'B4', promptText: 'x' }).argv; assert.equal(b4[b4.indexOf('--effort') + 1], 'low'); // the branch we bypass
  assert.deepEqual(w.env.removeKeys, ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']);
  assert.throws(() => buildConfinedCommand({ stage: 'W', promptText: 'x', imageFile: img, wireSchema: schema, model: 'claude-opus-5-5' }));
  assert.throws(() => buildConfinedCommand({ stage: 'W', promptText: 'x', imageFile: 'title.jpg', wireSchema: schema }));
  assert.throws(() => buildConfinedCommand({ stage: 'B4', promptText: 'x', imageFile: img, wireSchema: schema }));
});
const IMG = `${'c'.repeat(64)}.jpg`, DIR = '/tmp/tv2-call-x';
function transcript({ model = 'claude-sonnet-5-5', apiKeySource = 'none', readPath = `${DIR}/${IMG}`, image = true, extraTool = null, result = true, answer = model } = {}) {
  const ev = [{ type: 'system', subtype: 'init', apiKeySource, model, claude_code_version: '9.9.9', cwd: DIR, tools: ['Read', 'StructuredOutput'], mcp_servers: [], permissionMode: 'dontAsk' },
    { type: 'assistant', message: { model: answer, content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: readPath } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: image ? [{ type: 'image' }] : 'File does not exist.' }] } }];
  if (extraTool) ev.push({ type: 'assistant', message: { model: answer, content: [{ type: 'tool_use', id: 't2', name: extraTool, input: {} }] } });
  ev.push({ type: 'assistant', message: { model: answer, content: [{ type: 'tool_use', id: 't3', name: 'StructuredOutput', input: {} }] } });
  if (result) ev.push({ type: 'result', subtype: 'success', is_error: false, structured_output: { ok: 1 }, usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30 }, modelUsage: { [model]: { outputTokens: 20 } } });
  return ev.map(e => JSON.stringify(e)).join('\n');
}
test('transcript classification: ok, transport, and fatal confinement/provenance cases', () => {
  const c = s => classifyTranscript(s, { exitCode: 0, callDir: DIR, imageFile: IMG, runtimeVersion: '9.9.9' }).kind;
  assert.equal(c(transcript()), 'ok');
  assert.equal(classifyTranscript(transcript(), { exitCode: 0, callDir: DIR, imageFile: IMG, runtimeVersion: '9.9.9' }).usage.outputTokens, 20);
  assert.equal(c(transcript({ result: false })), 'interrupted', 'a missing result is not a proven transient failure');
  assert.equal(c(transcript({ extraTool: 'WebFetch' })), 'fatal');
  assert.equal(c(transcript({ apiKeySource: 'ANTHROPIC_API_KEY' })), 'fatal');
  assert.equal(c(transcript({ model: 'claude-sonnet-4-6', answer: 'claude-sonnet-4-6' })), 'fatal');
  assert.equal(c(transcript({ readPath: '/etc/passwd' })), 'fatal');
  assert.equal(c(transcript({ image: false })), 'fatal');
  assert.equal(classifyTranscript('', { exitCode: 1, callDir: DIR, imageFile: IMG, runtimeVersion: '9.9.9' }).kind, 'transport-failure');
});

// ---------- schemas + referential validation ----------
test('a complete WriterResult validates and its quote is located exactly', () => {
  const r = C.validateWriterResult(writerResult(), ctxOpts());
  assert.ok(r.ok, r.errors.join(' | '));
  const loc = r.located[0]; assert.equal(texts.S1.slice(loc.start, loc.end), QUOTE);
});
const mutations = {
  'slot missing': w => { w.dossier.essentials.pop(); },
  'slot duplicated': w => { w.draft.coverage[5].slot = 'identity'; },
  'surface not in lesson': w => { w.draft.support[1].surface = '/hotspots/9/body'; },
  'unknown fact': w => { w.draft.support[0].factIds = ['F9']; },
  'unresolved source ref': w => { w.dossier.facts[0].sourceRefs = ['S9#P1']; },
  'supported essential without source': w => { w.dossier.essentials[0].sourceRefs = []; },
  'why two sentences': w => { w.draft.lesson.why = 'It is a jar. It shows Priam.'; },
  'why teaser cut by an abbreviation': w => { w.draft.lesson.why = 'This shows St. Martin sharing his cloak.'; },
  'why with no end punctuation': w => { w.draft.lesson.why = 'This jar shows Priam'; },
  'three questions': w => { w.draft.lesson.questions.pop(); },
  'eight questions': w => { for (let i = 5; i <= 8; i++) w.draft.lesson.questions.push({ id: `q${i}`, q: 'More?', a: 'Yes.' }); },
  'one note': w => { w.draft.lesson.hotspots.splice(1, 2); w.draft.anchors.splice(1, 2); },
  'two delights': w => { w.draft.lesson.hotspots[0].tag = 'delight'; w.draft.lesson.hotspots[1].tag = 'delight'; },
  'unpaired coordinate': w => { w.draft.lesson.hotspots[1].x = 0.5; },
  'coordinate above 1 (percent leaked in)': w => { w.draft.lesson.hotspots[0].x = 25; },
  'distributed anchor with a dot': w => { w.draft.anchors[0].scope = 'distributed'; },
  'two anchors for one note': w => { w.draft.anchors.push({ ...w.draft.anchors[0] }); },
  'dot outside its anchor box': w => { w.draft.lesson.hotspots[0].x = 0.9; },
  'bbox leaves the image': w => { w.draft.anchors[2].bbox = [0.9, 0.2, 0.2, 0.2]; },
  'HTML in player text': w => { w.draft.lesson.hotspots[0].body = 'Bare <b>clay</b>.'; },
  'hold that still carries a lesson': w => { w.draft.status = 'hold'; w.draft.holdReasons = ['x']; },
  'candidate on an unready dossier': w => { w.dossier.status = 'needsResearch'; },
  'B3 request for a hotspot that already has a dot': w => { w.localizationRequests = [{ kind: 'visualLocate', id: 'r1', hotspotId: 'h1', literalTarget: 'figure', positionHint: '' }]; },
  'fewer than two observation links': w => { w.draft.support.splice(2, 1); },
  'extra property': w => { w.draft.lesson.extra = 1; },
};
for (const [name, mut] of Object.entries(mutations)) test(`schema rejects: ${name}`, () => { const w = writerResult(); mut(w); const e = errsOf(w); if (process.env.TV2_DEBUG) console.log(`${name} => ${e.slice(0, 170)}`); assert.ok(e.length > 0, `${name} accepted`); });
test('a writer hold with no lesson and a reason is valid (legacy stays live)', () => {
  const w = writerResult(); w.draft = { ...w.draft, status: 'hold', holdReasons: ['central function unresearched'], lesson: null, anchors: [], support: [] };
  w.dossier.status = 'needsResearch';
  const r = C.validateWriterResult(w, ctxOpts()); assert.ok(r.ok, r.errors.join('|')); assert.equal(r.hold, true);
});

// ---------- quotes + packet ----------
test('quote validation: exact substrings only, bounded, never from unavailable sources', () => {
  assert.ok(C.validateQuotes([{ id: 'P1', sourceId: 'S1', sectionId: sec.id, quote: QUOTE }], packet).ok);
  const bad = q => !C.validateQuotes([{ id: 'P1', sourceId: 'S1', sectionId: sec.id, ...q }], packet).ok;
  assert.ok(bad({ quote: QUOTE.replace('Priam', 'Priam ') }), 'whitespace change accepted');
  assert.ok(bad({ quote: 'Priam begged Achilles.' }), 'paraphrase accepted');
  assert.ok(bad({ sectionId: 'S1.s999', quote: QUOTE }));
  assert.ok(!C.validateQuotes([{ id: 'P1', sourceId: 'S2', sectionId: 'S2.s001', quote: 'x' }], packet).ok, 'unavailable source accepted');
  assert.ok(!C.validateQuotes([{ id: 'P1', sourceId: 'S1', sectionId: sec.id, quote: 'a'.repeat(2001) }], packet).ok);
  assert.ok(!C.validateQuotes(Array.from({ length: 13 }, (_, i) => ({ id: `P${i}`, sourceId: 'S1', sectionId: sec.id, quote: QUOTE })), packet).ok);
});
test('packet: boilerplate stripped, sections are exact substrings, tampering detected, unavailable source recorded', () => {
  assert.equal(S1.status, 'captured'); assert.equal(packet.sources[1].status, 'unavailable'); assert.ok(packet.gaps.some(g => g.sourceId === 'S2'));
  assert.ok(!S1.sections.some(s => /Home Shop Visit|^Menu$/.test(s.text)));
  assert.ok(C.validatePacketIntegrity(packet, texts).ok);
  const t = clone(packet); t.sources[0].sections[0].text = t.sources[0].sections[0].text.replace('Athens', 'Corinth');
  assert.ok(!C.validatePacketIntegrity(t, texts).ok);
  assert.equal(S1.title, 'Example Jar | Museum');
});
test('packet budget keeps whole sections in source order and records every omission', () => {
  const text = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} is a long substantive sentence about the object and its making, repeated to fill space ${'x'.repeat(1900)}.`).join('\n');
  const secs = buildSections('S1', text, 'html');
  assert.ok(secs.every(s => text.slice(s.start, s.end) === s.text));
  const [src] = applyBudget([{ id: 'S1', status: 'captured', allSections: secs }], 10000);
  assert.ok(src.sections.reduce((k, s) => k + s.text.length, 0) <= 10000);
  assert.equal(src.selection.omittedSections + src.sections.length, secs.length);
  assert.ok(src.selection.omittedSections > 0);
});
test('URL vetting: holding record first, commercial/aggregator/Wikidata never captured, four-source cap', () => {
  const v = vetUrls({ workId: 'cleveland123', b2Sources: [{ url: 'https://www.artelino.com/x' }, { url: 'https://artsandculture.google.com/y' }, { url: 'https://www.wikidata.org/wiki/Q1' }, { url: 'https://en.wikipedia.org/wiki/A' }, { url: 'https://www.clevelandart.org/art/1' }, { url: 'https://press.princeton.edu/b' }, { url: 'https://other.example.org/c' }, { url: 'http://insecure.example.org/d' }] });
  assert.equal(v.vetted[0].url, 'https://openaccess-api.clevelandart.org/api/artworks/123');
  assert.equal(v.vetted.length, 4);
  assert.ok(!v.vetted.some(x => /artelino|artsandculture|wikidata|insecure/.test(x.url)));
  assert.equal(v.vetted.find(x => x.url.includes('clevelandart.org/art')).kind, 'holdingInstitution');
});
test('lexical keyword hits are word counts, never slot coverage', () => {
  const lex = lexicalKeywordHits(packet, { title: 'Hydria with Priam' });
  assert.deepEqual(Object.keys(lex), ['titleWord', 'depictionWords', 'useWords', 'makingWords', 'significanceWords']);
  assert.ok(lex.depictionWords >= 1 && lex.useWords >= 1 && lex.makingWords >= 1);
});

// ---------- hardened capture (offline, injected DNS/request) ----------
function fakeNet({ ip = '93.184.216.34', status = 200, headers = { 'content-type': 'text/html' }, body = '<p>hello world page body</p>', peer = ip } = {}) {
  const resolve = (h, o, cb) => cb(null, [{ address: ip, family: 4 }]);
  const request = (opts, onRes) => {
    const req = new EventEmitter(); req.end = () => setImmediate(() => {
      const res = new EventEmitter(); Object.assign(res, { statusCode: typeof status === 'function' ? status(opts) : status, headers: typeof headers === 'function' ? headers(opts) : headers, socket: { remoteAddress: peer }, resume() {} });
      onRes(res); setImmediate(() => { const b = Buffer.from(body); for (let i = 0; i < b.length; i += 4096) res.emit('data', b.subarray(i, i + 4096)); res.emit('end'); });
    }); req.destroy = () => {}; return req;
  };
  return createSourceCapture({ resolve, request });
}
test('capture refuses http, private addresses, peer mismatch, http redirects and oversize bodies', async () => {
  assert.equal((await fakeNet().captureUrl('https://museum.example.org/a')).ok, true);
  assert.equal((await fakeNet().captureUrl('http://museum.example.org/a')).error, 'scheme-not-https');
  assert.equal((await fakeNet({ ip: '10.0.0.5' }).captureUrl('https://museum.example.org/a')).error, 'blocked-ip');
  assert.equal((await fakeNet({ ip: '127.0.0.1' }).captureUrl('https://museum.example.org/a')).error, 'blocked-ip');
  assert.equal((await fakeNet({ peer: '93.184.216.35' }).captureUrl('https://museum.example.org/a')).error, 'remote-addr-mismatch');
  const redir = fakeNet({ status: o => (o.path === '/a' ? 302 : 200), headers: o => (o.path === '/a' ? { location: 'http://museum.example.org/b' } : { 'content-type': 'text/html' }) });
  assert.equal((await redir.captureUrl('https://museum.example.org/a')).error, 'redirect-not-https');
  const big = await fakeNet({ body: 'x'.repeat(50000) }).captureUrl('https://museum.example.org/a', { limits: { maxBytes: 10000, timeoutMs: 5000, maxRedirects: 4 } });
  assert.equal(big.error, 'too-large');
  assert.equal((await fakeNet({ status: 403 }).captureUrl('https://museum.example.org/a')).error, 'http 403');
});

// ---------- projection ----------
test('projection converts 0-1 to percent exactly once and never renumbers around a no-dot note', () => {
  const lesson = writerResult().draft.lesson;
  const proj = projectLesson(lesson);
  assert.deepEqual(proj.hotspotEntry, [{ n: 1, x: 25, y: 50 }, { n: 3, x: 80, y: 30 }]);
  assert.deepEqual(proj.entry.notes.map(x => [x.x, x.y]), [[25, 50], [null, null], [80, 30]]);
  assert.deepEqual(proj.entry.cues, []);
  assert.ok(validateProjection(proj, lesson).ok);
  const twice = clone(proj); twice.entry.notes[0].x = 2500; twice.hotspotEntry[0].x = 2500;
  assert.ok(!validateProjection(twice, lesson).ok, 'double conversion accepted');
  const renum = clone(proj); renum.hotspotEntry[1].n = 2;
  assert.ok(!validateProjection(renum, lesson).ok, 'renumbering accepted');
  const reword = clone(proj); reword.entry.notes[0].body += ' More.';
  assert.ok(!validateProjection(reword, lesson).ok, 'wording change accepted');
});
test('current renderer runs index.html itself: hidden unpinned note, generic filter, teaser, legacy pin fallback', () => {
  const R = loadCurrentRenderer(); const id = 'harvard216218';
  const lesson = writerResult().draft.lesson;
  lesson.questions.unshift({ id: 'q0', q: 'What is the story behind it?', a: 'A generic stem.' });
  const cur = R.render({ workId: id, ...projectLesson(lesson), imageSize: { width: 300, height: 300 } });
  assert.deepEqual(cur.notesShown, [1, 3], 'the unpinned note is hidden while two notes are pinned');
  assert.ok(!cur.questionsShown.includes(1), 'the generic stem is filtered');
  assert.deepEqual(cur.dots.map(d => d.label), [1, 3]);
  const noPins = writerResult().draft.lesson; noPins.hotspots.forEach(h => { h.x = null; h.y = null; });
  const fb = R.render({ workId: id, ...projectLesson(noPins), visionRecord: { pins: [{ x: 0.5, y: 0.5, label: 'old' }] } });
  assert.equal(fb.dotSource, 'legacy-fallback'); assert.ok(fb.losses.some(l => /fallback/.test(l)));
  const f = faithfulView(projectLesson(lesson)); assert.equal(f.notes.length, 3); assert.equal(f.guide.length, 5);
  const page = renderPreviewPage({ kind: 'current', works: [{ id, title: 'T', imageRel: 'img/x.jpg', status: 'accepted-for-review', shown: 'candidate', current: cur, entry: projectLesson(lesson).entry }] });
  assert.match(page, /Lost or moved in the current renderer/); assert.match(page, /Candidate lesson/);
});

// ---------- attempt budget ----------
test('attempt budget: planned W,V; one extra (V2 or a transport retry); never above five', () => {
  const A = C.authorizeCall;
  assert.ok(A([], { kind: 'W', reason: 'planned' }).ok);
  assert.ok(!A([], { kind: 'V', reason: 'planned' }).ok, 'V before W');
  const wv = [{ kind: 'W', reason: 'planned', outcome: 'candidate' }];
  assert.ok(A(wv, { kind: 'V', reason: 'planned' }).ok);
  const revised = [...wv, { kind: 'V', reason: 'planned', outcome: 'revise' }];
  assert.ok(A(revised, { kind: 'V2', reason: 'v2' }).ok);
  assert.ok(!A([...wv, { kind: 'V', reason: 'planned', outcome: 'hold' }], { kind: 'V2', reason: 'v2' }).ok, 'V2 without a revise');
  assert.ok(!A([...revised, { kind: 'V2', reason: 'v2', outcome: 'transport-failure' }], { kind: 'V2', reason: 'transportRetry' }).ok, 'second extra');
  const retried = [{ kind: 'W', reason: 'planned', outcome: 'transport-failure' }, { kind: 'W', reason: 'transportRetry', outcome: 'candidate' }, { kind: 'V', reason: 'planned', outcome: 'revise' }];
  assert.ok(A(retried.slice(0, 2), { kind: 'V', reason: 'planned' }).ok);
  assert.ok(!A(retried, { kind: 'V2', reason: 'v2' }).ok, 'V2 after the extra was spent on a retry');
  assert.ok(!A([{ kind: 'W', reason: 'planned', outcome: 'invalid' }], { kind: 'W', reason: 'transportRetry' }).ok, 'bad content retried');
  assert.ok(!A([{ kind: 'W', reason: 'planned', outcome: 'transport-failure' }], { kind: 'V', reason: 'transportRetry' }).ok);
  const five = Array.from({ length: 5 }, () => ({ kind: 'W', reason: 'planned', outcome: 'x' }));
  assert.ok(!A(five, { kind: 'V', reason: 'planned' }).ok);
  assert.ok(!A(['W', 'V', 'B3', 'V2', 'X'].map(k => ({ kind: k })), { kind: 'V2', reason: 'v2' }, { planned: ['B1', 'R', 'W', 'B3', 'V'] }).ok, 'five-call path has no extra');
});

// ---------- pass/hold ----------
test('pass/hold: the controller recomputes pass and never trusts a self-declared one', () => {
  const draft = writerResult().draft, o = (v, allow = true) => C.verificationOutcome(v, { draft, allowReplacement: allow, packet, dossier: writerResult().dossier });
  assert.equal(o(verification()).decision, 'pass');
  const minor = o(verification({ issues: [{ surface: '/why', severity: 'minor', category: 'voice', explanation: 'x', sourceRefs: [], observation: '' }] }));
  assert.equal(minor.decision, 'pass'); assert.equal(minor.minors, 1);
  assert.equal(o(verification({ issues: [{ surface: '/questions/0/a', severity: 'major', category: 'answerRelevance', explanation: 'nonanswer', sourceRefs: [], observation: '' }] })).decision, 'hold');
  assert.equal(o(verification({ pins: [{ hotspotId: 'h1', targetMatches: 'yes', pointOnTarget: 'uncertain', explanation: '' }, { hotspotId: 'h3', targetMatches: 'yes', pointOnTarget: 'yes', explanation: '' }] })).decision, 'hold');
  assert.equal(o(verification({ pins: [{ hotspotId: 'h1', targetMatches: 'yes', pointOnTarget: 'yes', explanation: '' }] })).decision, 'hold', 'a dot left unjudged');
  assert.equal(o(verification({ decision: 'hold' })).decision, 'hold');
  const rep = clone(draft); rep.lesson.questions[0].a = 'Priam asks Achilles to return his son for burial.';
  assert.equal(o(verification({ decision: 'revise', replacement: rep })).decision, 'revise');
  assert.equal(o(verification({ decision: 'revise', replacement: rep }), false).decision, 'hold', 'revise when replacement is not allowed');
  assert.equal(o(verification({ decision: 'revise', replacement: null })).decision, 'hold');
  const badRep = clone(rep); badRep.lesson.questions.splice(0, 2);
  assert.equal(o(verification({ decision: 'revise', replacement: badRep })).decision, 'hold', 'invalid replacement');
});

// ---------- controller end-to-end (fake invoke) ----------
const gold = { sha256: C.FROZEN_GOLD_SHA256, text: 'gold' };
const work = { id: 'fx1', key: 'k', catalog: { title: 'Hydria with Priam' }, b1: { imageFitness: { imageState: 'usable' }, seen: 'a jar' }, b2: null, b3: null, image: { sha256: 'c'.repeat(64), ext: 'jpg' } };
const ok = s => ({ kind: 'ok', structured: s, usage: { outputTokens: 100, inputTokens: 5 }, wallMs: 10, transcriptSha256: 't' });
const stubRender = proj => ({ model: 'stub', whyShown: proj.entry.why, notesShown: [], questionsShown: [], cuesShown: [], dotSource: 'notes', dots: [], displayed: {}, losses: [] });
async function drive(responses, state = {}, extra = {}) {
  const calls = []; const queue = [...responses];
  const invoke = async (stage, { reason }) => { calls.push(`${stage}:${reason}`); const r = queue.shift(); if (!r) throw new Error(`unexpected call ${stage}`); return typeof r === 'function' ? r() : r; };
  const st = await runWork({ work, packet, texts, gold, state, invoke, render: stubRender, ...extra });
  return { st, calls };
}
test('controller: W ok + V pass = accepted-for-review in two calls (never an approval)', async () => {
  const { st, calls } = await drive([ok(writerResult()), ok(verification())]);
  assert.equal(st.status, 'accepted-for-review'); assert.deepEqual(calls, ['W:planned', 'V:planned']); assert.equal(st.final.source, 'W');
  assert.equal(telemetry(st).outputTokens, 200);
});
test('controller: V revise -> fresh V2 pass = accepted replacement in three calls', async () => {
  const rep = clone(writerResult().draft); rep.lesson.questions[0].a = 'Priam asks Achilles to return his son for burial.';
  const { st, calls } = await drive([ok(writerResult()), ok(verification({ decision: 'revise', replacement: rep })), ok(verification())]);
  assert.equal(st.status, 'accepted-for-review'); assert.deepEqual(calls, ['W:planned', 'V:planned', 'V2:v2']); assert.equal(st.final.source, 'V-replacement');
});
test('controller: W transport failure uses the one extra, so a later revise holds on budget', async () => {
  const rep = clone(writerResult().draft); rep.lesson.questions[0].a = 'Priam asks Achilles to return his son for burial.';
  const { st, calls } = await drive([{ kind: 'transport-failure', reason: 'no result' }, ok(writerResult()), ok(verification({ decision: 'revise', replacement: rep }))]);
  assert.deepEqual(calls, ['W:planned', 'W:transportRetry', 'V:planned']); assert.equal(st.status, 'hold'); assert.match(st.holdReasons[0], /extra invocation is already used/);
});
test('controller: invalid writer output holds after one call (no schema-fix retry)', async () => {
  const bad = writerResult(); bad.draft.lesson.questions.splice(0, 2);
  const { st, calls } = await drive([ok(bad)]);
  assert.equal(st.status, 'hold'); assert.equal(calls.length, 1); assert.match(st.holdReasons[0], /strict validation/);
});
test('controller: a confinement failure holds the work and pauses the run', async () => {
  await assert.rejects(drive([{ kind: 'fatal', reason: 'forbidden tool use: WebFetch' }]), PauseRun);
});
test('controller: no captured literal text holds before W with zero calls', async () => {
  const empty = clone(packet); empty.sources.forEach(s => { s.status = 'unavailable'; s.sections = []; });
  let called = 0; const st = await runWork({ work, packet: empty, texts: {}, gold, state: {}, invoke: async () => { called++; }, render: stubRender });
  assert.equal(st.status, 'hold'); assert.equal(called, 0); assert.equal(st.stage, 'preflight');
});
test('controller: an interrupted reservation is rebuilt from its transcript, or latches as an unknown outcome', async () => {
  const mk = () => { const binding = candidateBinding({ work, packet, texts, gold }); return { ledger: [{ seq: 1, kind: 'W', reason: 'planned', outcome: 'reserved' }], artifacts: {}, binding, bindingSha256: bindingSha(binding) }; };
  // no transcript -> unknown outcome, latched, never re-called
  const s1 = mk();
  await assert.rejects(drive([], s1, { attempts: { recover: () => null } }), LatchStop); assert.equal(s1.ledger[0].outcome, 'unknown');
  // a flushed transcript -> its result is reused without a new W call
  const s2 = mk();
  const { st, calls } = await drive([ok(verification())], s2, { attempts: { recover: () => ({ ...ok(writerResult()), reason: null }) } });
  assert.deepEqual(calls, ['V:planned']); assert.equal(st.status, 'accepted-for-review'); assert.equal(telemetry(st).calls, 2);
  const again = await drive([], st, { attempts: { recover: e => e.kind === 'W' ? ok(writerResult()) : ok(verification()) } }); assert.deepEqual(again.calls, []); // terminal works are not re-called
});

// ---------- coordinate diagnostic + inputs ----------
test('pin diagnostic: literal-target requests, strict localization, same text with B3 points or no dot', () => {
  const d = writerResult().draft; const reqs = diagnosticRequests(d);
  assert.deepEqual(reqs.map(r => r.literalTarget), ['the left figure', 'the right handle']);
  const loc = { verifications: [{ requestId: 'loc-h1', found: true, bbox: [0.1, 0.3, 0.3, 0.4], point: { x: 0.2, y: 0.5 }, observedDescription: 'a figure', alternatives: [], confidence: 0.8 }, { requestId: 'loc-h3', found: false, bbox: null, point: null, observedDescription: 'not clear', alternatives: [], confidence: 0.2 }], uncertainty: [] };
  assert.ok(validateLocalization(loc, reqs).ok);
  const bad = clone(loc); bad.verifications[0].point = { x: 0.9, y: 0.9 }; assert.ok(!validateLocalization(bad, reqs).ok);
  const bad2 = clone(loc); bad2.verifications[1].bbox = [0.1, 0.1, 0.1, 0.1]; assert.ok(!validateLocalization(bad2, reqs).ok);
  const b = b3Lesson(d.lesson, loc, reqs);
  assert.deepEqual(b.hotspots.map(h => [h.x, h.y]), [[0.2, 0.5], [null, null], [null, null]]);
  assert.deepEqual(b.hotspots.map(h => h.body), d.lesson.hotspots.map(h => h.body));
  const cmp = compareMethods(d.lesson, b); assert.equal(cmp.b3Abstentions, 1); assert.equal(cmp.rows[0].distancePct, 5);
});
test('old B3 import keeps physical found boxes only and records every rejection', () => {
  const b2 = { targetedVerificationRequests: [{ requestId: 'r1', whatToLocate: 'the dog at lower left' }, { requestId: 'r2', whatToLocate: 'Confirm whether the inscription supports the attribution' }, { requestId: 'r3', whatToLocate: 'a halo' }] };
  const b3 = { verifications: [{ requestId: 'r1', found: true, bbox: [0.1, 0.1, 0.2, 0.2], note: 'dog', confidence: 0.8 }, { requestId: 'r2', found: true, bbox: [0.1, 0.1, 0.2, 0.2], note: 'x', confidence: 0.8 }, { requestId: 'r3', found: false, bbox: null, note: 'none', confidence: 0.4 }] };
  const r = importB3Candidates(b2, b3);
  assert.deepEqual(r.kept.map(k => k.requestId), ['r1']); assert.deepEqual(r.rejected.map(k => k.requestId), ['r2', 'r3']);
});
test('the frozen plan is a deterministic, judgment-free order of the 50', () => {
  const sel = JSON.parse(readFileSync('tasks/pass-b-calibration-50-selection.json', 'utf8'));
  const a = derivePlan(sel), b = derivePlan(sel);
  assert.deepEqual(a.order, b.order); assert.equal(a.firstTen.length, 10); assert.equal(a.pinDiagnostic.length, 20); assert.equal(new Set(a.order).size, 50);
  assert.equal(a.flags.harvard303416.goldBundleOverlap, true);
  const frozen = JSON.parse(readFileSync('tasks/teaching-v2-phase-a/plan.json', 'utf8'));
  assert.deepEqual(frozen.order, a.order, 'plan.json drifted from the deterministic derivation');
});

for (const [name, fn] of tests) {
  try { await fn(); n++; } catch (e) { console.error(`FAIL - ${name}\n${e.stack}`); process.exit(1); }
}
console.log(`teaching-v2.test: ${n} checks passed`);
