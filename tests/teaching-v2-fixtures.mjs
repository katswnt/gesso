// Teaching-v2 Phase A shared test fixtures (synthetic works, transcripts and an injected-executor runner world),
// used by tests/teaching-v2-review2.test.mjs and tests/teaching-v2-review3.test.mjs. No model call, network or git.
// Library modules are imported lazily so a check against older code fails per check, not at import.
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export const L = p => import(new URL(`../scripts/lib/${p}`, import.meta.url));
export const clone = v => JSON.parse(JSON.stringify(v));

// ---------- shared fixtures (the same fixture work as tests/teaching-v2-review.test.mjs) ----------
export const MODEL = 'claude-sonnet-5-5', RT = '9.9.9', IMG = `${'c'.repeat(64)}.jpg`, DIR = '/tmp/tv2-call-fixture';
export const ev = e => JSON.stringify(e);
export const classify = async (stdout, o = {}) => (await L('teaching-v2-stage.mjs')).classifyTranscript(stdout, { exitCode: 0, callDir: DIR, imageFile: IMG, runtimeVersion: RT, ...o });
export async function fixtures() {
  const C = await L('teaching-v2-contract.mjs');
  const { assemblePacket } = await L('teaching-v2-capture.mjs');
  const HTML = `<html><head><title>Example Jar | Museum</title></head><body><nav>Home Shop Visit</nav>
<p>This water jar was made in Athens around 505 BCE and shows Priam asking Achilles for the body of Hector.</p>
<p>The painter left the figures in the color of the clay and covered the background with black slip.</p>
<p>Jars like this were used for carrying water from the fountain house.</p></body></html>`;
  const snap = { meta: { contentType: 'text/html', status: 200, rawSha256: 'r'.repeat(64), retrievedAt: '2026-11-20T00:00:00Z', finalUrl: 'https://museum.example.org/jar', bytes: HTML.length, chain: [] }, raw: Buffer.from(HTML) };
  const vetted = [{ url: 'https://museum.example.org/jar', kind: 'holdingInstitution', relationshipToWork: 'thisObject (catalog id)', objectIds: ['1'] }];
  const { packet, texts } = assemblePacket({ workId: 'fx1', catalogId: 'fx1', vetted, snapshots: { [vetted[0].url]: snap } });
  const sec = packet.sources[0].sections[0];
  const QUOTE = 'shows Priam asking Achilles for the body of Hector.';
  const slots = fn => C.SLOTS.map(fn);
  const writerResult = () => ({
    dossier: {
      status: 'ready', identity: { status: 'matched', explanation: 'The record names this jar.', sourceRefs: ['S1#P1'] },
      catalogChecks: [], essentials: slots(slot => ({ slot, applicability: 'required', status: 'supported', answer: `answer for ${slot}`, sourceRefs: slot === 'transfer' ? [] : ['S1#P1'], limitation: '' })),
      facts: [{ id: 'F1', proposition: 'Priam asks Achilles for Hector.', scope: 'thisWork', sourceRefs: ['S1#P1'], qualifications: '' }],
      passages: [{ id: 'P1', sourceId: 'S1', sectionId: sec.id, quote: QUOTE }], visualBindings: [], gaps: [], conflicts: [],
    },
    draft: {
      status: 'candidate', holdReasons: [],
      lesson: { why: 'This Athenian jar shows the old king Priam asking Achilles to return the body of his son.',
        hotspots: [{ id: 'h1', tag: 'medium', head: 'Red figures', body: 'The figures are bare clay on black.', x: 0.25, y: 0.5 }, { id: 'h2', tag: 'style', head: 'Bodies in motion', body: 'Overlapping limbs show the new ambition.', x: null, y: null }, { id: 'h3', tag: 'format', head: 'Jar shape', body: 'Side handles mark a water jar.', x: 0.8, y: 0.3 }],
        questions: [{ id: 'q1', q: 'What is happening?', a: 'Priam asks for his son.' }, { id: 'q2', q: 'How does red-figure work?', a: 'Figures are reserved.' }, { id: 'q3', q: 'What was the jar for?', a: 'Carrying water.' }, { id: 'q4', q: 'How can I spot this elsewhere?', a: 'Look for red figures on black.' }] },
      anchors: [{ hotspotId: 'h1', scope: 'unique', targetDescription: 'the left figure', observationId: 'O1', bbox: [0.1, 0.3, 0.3, 0.4] }, { hotspotId: 'h2', scope: 'distributed', targetDescription: 'limbs', observationId: 'O2', bbox: null }, { hotspotId: 'h3', scope: 'unique', targetDescription: 'the right handle', observationId: 'O3', bbox: [0.7, 0.2, 0.2, 0.2] }],
      observations: [{ id: 'O1', description: 'two figures', region: [0.1, 0.3, 0.6, 0.4] }, { id: 'O2', description: 'limbs', region: null }, { id: 'O3', description: 'a handle', region: [0.7, 0.2, 0.2, 0.2] }],
      support: [{ surface: '/why', assertion: 'Priam asks Achilles', kind: 'sourced', observationIds: [], factIds: ['F1'], sourceRefs: ['S1#P1'], qualification: '' }, { surface: '/hotspots/0/body', assertion: 'bare clay', kind: 'visible', observationIds: ['O1'], factIds: [], sourceRefs: [], qualification: '' }, { surface: '/hotspots/2/body', assertion: 'handles', kind: 'visible', observationIds: ['O3'], factIds: [], sourceRefs: [], qualification: '' }],
      coverage: slots(slot => ({ slot, surfaces: ['/questions/3/a'], explanation: '' })),
    },
    localizationRequests: [],
  });
  const verification = (over = {}) => ({ decision: 'pass', coverage: slots(slot => ({ slot, result: 'adequate', explanation: '' })), issues: [], pins: [{ hotspotId: 'h1', targetMatches: 'yes', pointOnTarget: 'yes', explanation: '' }, { hotspotId: 'h3', targetMatches: 'yes', pointOnTarget: 'yes', explanation: '' }], replacement: null, ...over });
  const replacement = () => { const r = writerResult().draft; r.lesson.questions[0].a = 'Priam asks Achilles to return his son for burial.'; return r; };
  const work = { id: 'fx1', key: 'k', origin: 'synthetic', catalog: { title: 'Hydria with Priam' }, b1: { imageFitness: { ok: true, imageState: 'usable' }, playable: true, seen: 'a jar' }, b2: null, b3: null, image: { sha256: 'c'.repeat(64), ext: 'jpg' } };
  const gold = { sha256: C.FROZEN_GOLD_SHA256, text: 'gold' };
  const ok = s => ({ kind: 'ok', structured: s, usage: { outputTokens: 100, inputTokens: 5 }, wallMs: 10, transcriptSha256: 't' });
  const render = proj => ({ model: 'stub', whyShown: proj.entry.why, notesShown: [], questionsShown: [], cuesShown: [], dotSource: 'notes', dots: [], displayed: {}, losses: [] });
  return { C, packet, texts, writerResult, verification, replacement, work, gold, ok, render, sec };
}
// Drive one runWork. Every dispatch is recorded by seq, so `recover` can rebuild exactly what was dispatched.
export async function drive(F, responses, state, extra = {}) {
  const { runWork } = await L('teaching-v2-controller.mjs');
  const calls = []; const q = [...responses];
  const invoke = extra.invoke || (async (stage, o = {}) => { calls.push(stage); const r = q.shift(); if (!r) throw new Error(`unexpected call ${stage}`); const out = typeof r === 'function' ? r() : r; if (extra.bySeq && o.seq != null) extra.bySeq.set(o.seq, out); return out; });
  const st = await runWork({ work: extra.work || F.work, packet: F.packet, texts: F.texts, gold: F.gold, state, render: F.render, ...extra, invoke });
  return { st, calls };
}


// ---------- runner-level world: real teaching-v2-phase.mjs, injected executor, local files only ----------
export async function phaseWorld() {
  const F = await fixtures();
  const C = F.C, { candidateBinding, bindingSha } = await L('teaching-v2-controller.mjs');
  const P = await L('teaching-v2-phase.mjs'), { writeLatch } = await L('teaching-v2-ops.mjs');
  const root = mkdtempSync(join(tmpdir(), 'tv2-r2-')), phaseDir = join(root, 'phase-a');
  const imgPath = join(root, IMG); writeFileSync(imgPath, 'image-bytes');
  const runtime = { version: RT, bin: '/fixture/claude' };
  const mkItem = (id, key) => { const work = { ...clone(F.work), id, key, image: { ...F.work.image, path: imgPath } }; return { id, work, packet: F.packet, texts: F.texts, binding: candidateBinding({ work, packet: F.packet, texts: F.texts, gold: F.gold }) }; };
  const stageOf = argv => { const s = argv[argv.indexOf('--json-schema') + 1]; return s === JSON.stringify(C.WRITER_RESULT_WIRE) ? 'W' : s === JSON.stringify(C.VERIFICATION_WIRE) ? 'V' : 'V2'; };
  const okStdout = (cwd, structured) => [
    ev({ type: 'system', subtype: 'init', apiKeySource: 'none', model: MODEL, claude_code_version: RT, cwd, tools: ['Read', 'StructuredOutput'], mcp_servers: [], permissionMode: 'dontAsk' }),
    ev({ type: 'assistant', message: { model: MODEL, content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: `${cwd}/${IMG}` } }] } }),
    ev({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'image' }] }] } }),
    ev({ type: 'assistant', message: { model: MODEL, content: [{ type: 'tool_use', id: 't9', name: 'StructuredOutput', input: structured }] } }),
    ev({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't9', content: 'ok' }] } }),
    ev({ type: 'result', subtype: 'success', is_error: false, structured_output: structured, usage: { input_tokens: 10, output_tokens: 20 }, modelUsage: { [MODEL]: { outputTokens: 20 } } }),
  ].join('\n');
  const fatalStdout = cwd => [ev({ type: 'system', subtype: 'init', apiKeySource: 'none', model: MODEL, claude_code_version: RT, cwd, tools: ['Read', 'StructuredOutput'], mcp_servers: [], permissionMode: 'dontAsk' }),
    ev({ type: 'assistant', message: { model: MODEL, content: [{ type: 'tool_use', id: 'w', name: 'WebFetch', input: { url: 'https://example.org' } }] } })].join('\n');
  // responses: 'fatal' | structured object, consumed in order; calls records each dispatched stage.
  const executor = responses => { const calls = [], q = [...responses]; return { calls, execute: async (bin, argv, opts) => { calls.push(stageOf(argv)); const r = q.shift(); if (r === undefined) throw new Error(`unexpected ${stageOf(argv)} call`); return { stdout: r === 'fatal' ? fatalStdout(opts.cwd) : okStdout(opts.cwd, r) }; } }; };
  const ops = (over = {}) => ({ allowance: { budgetId: 'teaching-v2-phase-a-test' }, gate: () => ({ go: true }), persist: () => true, record: () => null, latch: info => writeLatch(phaseDir, info), ...over });
  const base = { fixture: 'tv2-review2' };
  const identityOf = (items, parent = null) => P.runIdentity({ base, items, bindingSha, parent });
  // execute: an optional executor override (e.g. one that times out); clearances: the injected committed records.
  const run = async ({ items, responses = [], opsOver = {}, parent = null, runId = null, clearances = [], execute = null }) => {
    const identity = identityOf(items, parent?.runId ?? null), id = runId ?? P.runIdOf(identity), ex = executor(responses);
    const result = await P.runPhase({ phaseDir, runId: id, identity, items, gold: F.gold, ops: ops(opsOver), runtime, execute: execute ?? ex.execute, renderFor: () => F.render, parent, clearances, log: () => {}, logError: process.env.TV2_DEBUG ? console.error : () => {} });
    return { result, calls: ex.calls, runId: id };
  };
  const stateOf = (runId, key) => JSON.parse(readFileSync(join(phaseDir, 'runs', runId, 'works', key, 'state.json'), 'utf8'));
  const adirOf = (runId, key) => join(phaseDir, 'runs', runId, 'works', key, 'attempts');
  return { F, P, root, phaseDir, runtime, mkItem, run, stateOf, identityOf, adirOf, executor, ops, okStdout, fatalStdout, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

