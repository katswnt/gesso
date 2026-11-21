// Research stopgap (VSD-092, owner 2026-11-20; design-2 §2.1–2.3): deterministic helpers for the corrected
// B1/B2/B3 collection format. No model calls here. Network use is limited to captureSources(), which receives an
// injected fetcher (the hardened broker in production, a fake in tests).
//
//   - b2PlanStopgap:   B2 runs for every usable work lacking a new-version dossier, with or without B1 topics/legacy.
//   - b3DispatchPlan:  B3 is a physical-locate task. Until a typed dispatch contract exists, NOTHING dispatches
//                      unattended: a request reaches B3 only after an append-only inspected review names it.
//   - deriveCoverage:  core-subject/function/context/mechanism presence, reported apart from stage validity.
//   - captureSources:  literal source text after B2 (URL, redirect chain, retrieval time, byte hash, extraction
//                      version, normalized text hash, object identity, exact passages verified as substrings).
//   - banked import:   reuse compatible banked B0/image and B1 artifacts with their original provenance; the banked run
//                      (B1/B2/B3 bytes, epochs, ledger, done state) is only read, never written.
import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { sha256, stableJson } from './vision-legacy.mjs';
import { RESEARCH_STOPGAP_VERSION } from './pass-b-prompts.mjs';
import { B2_CONTRACT_STOPGAP, B2_CORE_QUESTION_IDS, validateStageCompletion } from './vision-content-schema.mjs';
import { extractSourceText, SOURCE_TEXT_EXTRACTION } from './pass-b-source-text.mjs';
import { completionKey } from './vision-content-capture.mjs';
import { BROKER_POLICY_VERSION } from './img-broker.mjs';
import {
  CALIBRATION_MODEL, IMAGE_TRANSPORT_VERSION, MAX_B3_REQUESTS, b1PromptText, findTranscriptBySha, neutralImageFile,
  parseStreamTranscript, producerEvidence, transcriptFinal, verifyStageEvidence, verifyStageCapabilities, verifyAttemptConfinement,
} from './pass-b-calibration.mjs';

export { RESEARCH_STOPGAP_VERSION, B2_CONTRACT_STOPGAP };
export const RESEARCH_VERSIONS = Object.freeze(['banked', 'stopgap-1']);
export const researchVersionFromEnv = (env = process.env) => env.PASS_B_RESEARCH_VERSION === 'stopgap-1' ? 'stopgap-1' : 'banked';
export const COVERAGE_VERSION = 'passBResearchCoverage/1';
export const SOURCE_CAPTURE_VERSION = 'passBSourceCapture/2'; // /2: raw bytes + full text retained, real byte SHA-256, explicit gaps
export const IMPORT_VERSION = 'passBResearchImport/1';
export const B3_DISPATCH_REVIEW_VERSION = 'passBB3DispatchReview/1';
export const B3_DISPATCH_REQUEST_VERSION = 'passBB3DispatchReviewRequest/1';
// design-2 §3.2 envelope: at most four capture attempts per work and 40,000 normalized characters kept in total.
// maxRawBytesPerWork: retained raw bytes per work (disk budget; review fix 8). Typical pages are 0.1–1 MB.
export const CAPTURE_LIMITS = Object.freeze({ maxSources: 4, perSourceChars: 12000, totalChars: 40000, minPassageChars: 1, maxBytes: 8 * 1024 * 1024, timeoutMs: 20000, maxRawBytesPerWork: 24 * 1024 * 1024 });
export const COPY_ELIGIBILITY = 'not-eligible: stopgap research is a reusable lead inventory, not a validated dossier (VSD-092)';
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const files = path => existsSync(path) ? readdirSync(path) : [];
const rawFileSha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const HISTORICAL_MODEL = CALIBRATION_MODEL; // attempts with no epoch-bearing reservation (VSD-054 historical rule)

// ---- B2 trigger: every usable work (VSD-092 replaces "only when B1 topics or legacy claims exist") ----
export function b2PlanStopgap(b1Body) {
  if (!b1Body) return { run: false, reasons: ['no-b1'] };
  const state = b1Body.imageFitness?.imageState;
  if (state === 'blocked' || state === 'unplayable' || b1Body.playable === false) return { run: false, reasons: [`image-${state || 'unplayable'}`] };
  return { run: true, reasons: ['stopgap-core-dossier'] };
}

// ---- B3 dispatch: physical-locate requests, dispatched only after an inspected review ----
export function loadB3DispatchReviews(runDir, runId) {
  const dir = join(runDir, 'b3-dispatch-reviews'), out = [], names = files(dir).sort();
  for (let i = 0; i < names.length; i++) {
    if (names[i] !== `${String(i + 1).padStart(6, '0')}.json`) throw new Error('B3 dispatch review sequence mismatch');
    const r = readJson(join(dir, names[i]));
    if (r.version !== B3_DISPATCH_REVIEW_VERSION || r.runId !== runId || r.number !== i + 1 || r.previousSha256 !== (out.at(-1)?.sha256 || null)
        || typeof r.workId !== 'string' || !/^[0-9a-f]{64}$/.test(r.b2BodySha256 || '') || !Array.isArray(r.decisions)
        || !String(r.reviewedBy || '').trim() || !Number.isFinite(Date.parse(r.reviewedAt))
        || r.decisions.some(d => !['dispatch', 'reject'].includes(d.decision) || typeof d.requestId !== 'string' || !/^[0-9a-f]{64}$/.test(d.whatToLocateSha256 || ''))
        || r.decisions.filter(d => d.decision === 'dispatch').length > MAX_B3_REQUESTS)
      throw new Error(`B3 dispatch review ${names[i]} is malformed or out of chain`);
    if (out.some(o => o.workId === r.workId)) throw new Error(`B3 dispatch review ${names[i]}: second review for ${r.workId}`);
    out.push({ ...r, sha256: sha256(stableJson(r)) });
  }
  return out;
}
// The exact request list B3 receives for this work. No review = nothing dispatches (requests await inspection).
export function b3DispatchPlan(workId, b2Body, reviews = []) {
  const all = Array.isArray(b2Body?.targetedVerificationRequests) ? b2Body.targetedVerificationRequests : [];
  const review = reviews.find(r => r.workId === workId) || null;
  if (!review) return { run: false, requests: [], requestIds: [], dropped: 0, status: all.length ? 'awaiting-inspection' : 'no-requests', pending: all.map(r => r.requestId) };
  if (review.b2BodySha256 !== sha256(stableJson(b2Body))) throw new Error(`${workId}: B3 dispatch review is bound to a different B2 body`);
  const decided = new Map(review.decisions.map(d => [d.requestId, d]));
  if (decided.size !== all.length || all.some(r => decided.get(r.requestId)?.whatToLocateSha256 !== sha256(r.whatToLocate)))
    throw new Error(`${workId}: B3 dispatch review must decide every request against its exact text`);
  const reqs = all.filter(r => decided.get(r.requestId).decision === 'dispatch');
  return { run: reqs.length > 0, requests: reqs.map(r => ({ requestId: r.requestId, whatToLocate: r.whatToLocate })), requestIds: reqs.map(r => r.requestId), dropped: 0, status: 'reviewed', pending: [] };
}
// Offline append (under the run lease). `bodiesById` = verified B2 bodies of the works the request names.
export function appendB3DispatchReviews(runDir, runId, request, bodiesById) {
  if (request?.version !== B3_DISPATCH_REQUEST_VERSION || request.runId !== runId || !String(request.reviewedBy || '').trim()
      || !String(request.reason || '').trim() || !Number.isFinite(Date.parse(request.reviewedAt)) || !Array.isArray(request.works) || !request.works.length)
    throw new Error('explicit B3 dispatch review request (version/runId/reviewedBy/reason/reviewedAt/works) required');
  const existing = loadB3DispatchReviews(runDir, runId), written = [];
  const dir = join(runDir, 'b3-dispatch-reviews'); mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const w of request.works) {
    const b2 = bodiesById.get(w.workId);
    if (!b2) throw new Error(`${w.workId}: no verified B2 to review`);
    if (existing.some(r => r.workId === w.workId)) throw new Error(`${w.workId}: already reviewed`);
    const prev = existing.at(-1) || null;
    const record = { version: B3_DISPATCH_REVIEW_VERSION, runId, number: (prev?.number || 0) + 1, previousSha256: prev?.sha256 || null,
      workId: w.workId, b2BodySha256: sha256(stableJson(b2)),
      decisions: (w.decisions || []).map(d => ({ requestId: d.requestId, whatToLocateSha256: d.whatToLocateSha256, decision: d.decision, note: String(d.note || '').slice(0, 500) })),
      reviewedBy: request.reviewedBy, reason: request.reason, reviewedAt: request.reviewedAt };
    if (record.decisions.some(d => !['dispatch', 'reject'].includes(d.decision))) throw new Error(`${w.workId}: every decision must be "dispatch" or "reject"`);
    b3DispatchPlan(w.workId, b2, [{ ...record, sha256: 'x' }]); // every request decided against its exact text
    if (record.decisions.filter(d => d.decision === 'dispatch').length > MAX_B3_REQUESTS) throw new Error(`${w.workId}: at most ${MAX_B3_REQUESTS} requests may dispatch`);
    writeFileSync(join(dir, `${String(record.number).padStart(6, '0')}.json`), `${JSON.stringify(record, null, 1)}\n`, { flag: 'wx', mode: 0o600, flush: true });
    existing.push({ ...record, sha256: sha256(stableJson(record)) }); written.push(record);
  }
  return written;
}

// ---- core coverage sidecar: presence of core-* answers is a model claim, never supported coverage ----
export function deriveCoverage(b2Body) {
  const answers = Array.isArray(b2Body?.guideAnswers) ? b2Body.guideAnswers : [];
  const urlOf = new Map();
  for (const f of b2Body?.factChecks || []) for (const s of f.sources || []) if (!urlOf.has(s.sourceId)) urlOf.set(s.sourceId, s.url);
  const core = B2_CORE_QUESTION_IDS.map(questionId => {
    const a = answers.find(x => x.questionId === questionId);
    return { questionId, answered: !!a, sourceRefs: a ? [...a.sourceRefs] : [], sourceUrls: a ? a.sourceRefs.map(r => urlOf.get(r)).filter(Boolean) : [] };
  });
  const gaps = core.filter(c => !c.answered).map(c => c.questionId);
  return {
    version: COVERAGE_VERSION, b2Contract: B2_CONTRACT_STOPGAP, b2BodySha256: sha256(stableJson(b2Body)),
    stageValid: true, core, gaps, otherAnswers: answers.filter(a => !B2_CORE_QUESTION_IDS.includes(a.questionId)).length,
    uncertainty: String(b2Body?.uncertainty || ''),
    coverageStatus: gaps.length ? 'gaps-reported' : 'core-answers-present-unverified',
    note: 'A core-* answer is B2’s claim from fetched summaries, not verified coverage; gaps are explicit, not failures.',
  };
}

// ---- literal source capture ----
// Ordered, deduplicated capture targets: sources behind core answers first, then other cited sources, then pages B2
// fetched but did not cite. Bounded by CAPTURE_LIMITS.maxSources; no replacement-URL loop.
export function captureTargets(b2Body, b2TranscriptText = '') {
  const byUrl = new Map(), order = [];
  const add = (url, why, sourceId = null) => {
    if (typeof url !== 'string' || !/^https:\/\//i.test(url)) return;
    const key = url.replace(/#.*$/, '');
    if (!byUrl.has(key)) { byUrl.set(key, { url: key, why, sourceIds: [] }); order.push(key); }
    if (sourceId && !byUrl.get(key).sourceIds.includes(sourceId)) byUrl.get(key).sourceIds.push(sourceId);
  };
  const urlOf = new Map();
  for (const f of b2Body?.factChecks || []) for (const s of f.sources || []) if (!urlOf.has(s.sourceId)) urlOf.set(s.sourceId, s.url);
  for (const a of (b2Body?.guideAnswers || []).filter(x => B2_CORE_QUESTION_IDS.includes(x.questionId))) for (const r of a.sourceRefs || []) add(urlOf.get(r), 'core-answer', r);
  for (const [id, url] of urlOf) add(url, 'cited', id);
  for (const u of parseStreamTranscript(b2TranscriptText).toolUses.filter(t => t.name === 'WebFetch')) add(u.input?.url, 'fetched-uncited');
  return order.slice(0, CAPTURE_LIMITS.maxSources).map(k => byUrl.get(k));
}
// Identity clues only (never a verdict): does the page name the title, and does the catalog id appear?
export function identityClues(catalog, url, text) {
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  const raw = String(catalog?.catalogId || ''), tail = raw.replace(/^(wikidata:|met|aic|cleveland|sinmafa_|sifsg_|nga|rijks|moma)/i, '');
  const tokens = [...new Set([tail, ...(raw.match(/Q\d+|\d{4,}/g) || [])].filter(x => x && x.length >= 3))];
  const title = norm(catalog?.title), body = norm(text);
  return { titleInText: !!title && title.length >= 4 && body.includes(title), idTokens: tokens.map(token => ({ token, inUrl: String(url).includes(token), inText: String(text).includes(token) })) };
}
// Complete lines (paragraphs) of the normalized text, kept in order up to the cap and never cut mid-passage.
export function keepPassages(fullText, cap) {
  const lines = fullText.split('\n'), passages = []; let at = 0, kept = '';
  for (const line of lines) {
    const start = at, end = at + line.length; at = end + 1;
    const next = kept ? `${kept}\n${line}` : line;
    if (next.length > cap) break;
    kept = next;
    if (line.length >= CAPTURE_LIMITS.minPassageChars) passages.push({ id: `p${passages.length + 1}`, start, end, chars: line.length });
  }
  for (const p of passages) if (fullText.slice(p.start, p.end) !== kept.slice(p.start, p.end)) throw new Error('passage offset invariant broken');
  return { text: kept, passages, truncated: kept.length < fullText.length };
}
const TRANSIENT = new Set(['timeout', 'network-error', 'dns-failed', 'no-ipv4', 'remote-addr-mismatch']);
export const captureIsTransient = s => TRANSIENT.has(s.status) || (s.status === 'http-status' && (s.httpStatus == null || s.httpStatus === 408 || s.httpStatus === 429 || s.httpStatus >= 500));
// SHA-256 of the exact received bytes (review fix 8: never the project helper's stable-JSON serialization of a Buffer).
export const bytesSha256 = buf => createHash('sha256').update(buf).digest('hex');
// ---- raw-source store (review fix 8): immutable files OUTSIDE the model packet, under the work's research/sources ----
// Raw bytes are kept gzip-compressed (deterministic level 9) at sources/<bytesSha256>.raw.gz; the full normalized text
// at sources/<textSha256>.txt. Content-addressed and exclusive, so a later extraction fix can be audited against them.
export const sourceStore = researchDir => {
  const dir = join(researchDir, 'sources');
  const put = (name, data) => {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, name);
    if (!existsSync(path)) writeFileSync(path, data, { flag: 'wx', mode: 0o600, flush: true });
    return `sources/${name}`;
  };
  return {
    putRaw: (buf, sha) => { const gz = gzipSync(buf, { level: 9 }); return { file: put(`${sha}.raw.gz`, gz), storedBytes: gz.length }; },
    putText: (text, sha) => ({ file: put(`${sha}.txt`, text) }),
  };
};
export async function captureSources({ targets, fetchDoc, catalog, store, now = () => new Date(), extract = extractSourceText }) {
  if (!store) throw new Error('captureSources needs a raw-source store (raw bytes are always retained)');
  const sources = []; let remaining = CAPTURE_LIMITS.totalChars, rawTotal = 0;
  for (const [i, t] of targets.entries()) {
    const base = { id: `src${i + 1}`, url: t.url, requestedBecause: t.why, sourceIds: t.sourceIds, retrievedAt: now().toISOString() };
    let r;
    try { r = await fetchDoc(t.url, { maxBytes: CAPTURE_LIMITS.maxBytes, timeoutMs: CAPTURE_LIMITS.timeoutMs }); }
    catch (e) { r = { ok: false, reason: 'network-error', detail: String(e?.message || e).slice(0, 100) }; }
    if (!r.ok) { sources.push({ ...base, status: r.reason || 'fetch-failed', httpStatus: r.status ?? null, chain: r.chain || [t.url], finalUrl: null }); continue; }
    const sha = bytesSha256(r.buffer);
    const head = { ...base, chain: r.chain || [t.url], finalUrl: r.finalUrl || t.url, contentType: String(r.declaredMime || '').slice(0, 120), bytes: r.buffer.length, bytesSha256: sha, extraction: SOURCE_TEXT_EXTRACTION };
    // Per-work raw cap (disk budget): a source over it is an explicit failure, never text without its bytes.
    if (rawTotal + r.buffer.length > CAPTURE_LIMITS.maxRawBytesPerWork) { sources.push({ ...head, status: 'raw-retention-cap', detail: `per-work raw cap ${CAPTURE_LIMITS.maxRawBytesPerWork} bytes` }); continue; }
    rawTotal += r.buffer.length;
    head.raw = store.putRaw(r.buffer, sha);
    const x = await extract(r.buffer, r.declaredMime);
    if (!x.ok) { sources.push({ ...head, kind: x.kind, status: x.status, detail: x.detail ?? null, ...(x.pdf ? { pdf: x.pdf } : {}) }); continue; }
    const fullSha = sha256(x.text);
    const facts = { kind: x.kind, ...(x.pdf ? { pdf: x.pdf } : {}), fullTextChars: x.text.length, fullTextSha256: fullSha, fullText: store.putText(x.text, fullSha), identity: identityClues(catalog, r.finalUrl || t.url, x.text) };
    const kept = keepPassages(x.text, Math.max(0, Math.min(CAPTURE_LIMITS.perSourceChars, remaining)));
    if (!kept.text) { sources.push({ ...head, ...facts, status: 'over-total-budget', omitted: [{ fromOffset: 0, chars: x.text.length, reason: 'packet total budget spent' }] }); continue; }
    // Every kept passage is an exact slice of the full extracted text (the kept text is its prefix, cut at a line end).
    if (!x.text.startsWith(kept.text) || kept.passages.some(p => x.text.slice(p.start, p.end) !== kept.text.slice(p.start, p.end))) throw new Error('captured passage is not a substring of the extracted text');
    remaining -= kept.text.length;
    // The packet keeps whole paragraphs; anything beyond it is an explicit gap pointing at the full text on disk.
    const omitted = kept.truncated ? [{ fromOffset: kept.text.length + 1, chars: x.text.length - kept.text.length - 1, reason: remaining <= 0 ? 'packet total budget' : 'per-source packet cap' }] : [];
    sources.push({ ...head, ...facts, status: 'captured', storedChars: kept.text.length, truncated: kept.truncated, omitted, storedTextSha256: sha256(kept.text), text: kept.text, passages: kept.passages });
  }
  return sources;
}
export function captureStatus(sources) {
  if (!sources.length) return 'no-sources';
  const ok = sources.filter(s => s.status === 'captured').length;
  return ok === sources.length ? 'captured' : ok ? 'partial' : 'failed';
}
export const rawBytesRetained = sources => sources.reduce((n, s) => n + (s.raw ? s.bytes : 0), 0);
export function buildCaptureSidecar({ runId, workId, b2Completion, b2Body, sources, attemptedAt, priorAttempts = [] }) {
  const urlCaptured = new Map(sources.map(s => [s.url, s.status === 'captured' ? s.id : null]));
  const urlOf = new Map();
  for (const f of b2Body?.factChecks || []) for (const s of f.sources || []) if (!urlOf.has(s.sourceId)) urlOf.set(s.sourceId, String(s.url).replace(/#.*$/, ''));
  const coreLinks = B2_CORE_QUESTION_IDS.map(questionId => {
    const a = (b2Body?.guideAnswers || []).find(x => x.questionId === questionId);
    const urls = a ? [...new Set(a.sourceRefs.map(r => urlOf.get(r)).filter(Boolean))] : [];
    return { questionId, answered: !!a, urls, capturedSourceIds: urls.map(u => urlCaptured.get(u)).filter(Boolean) };
  });
  return { version: SOURCE_CAPTURE_VERSION, runId, workId, b2: { bodySha256: b2Completion.bodySha256, transcriptSha256: b2Completion.transcriptSha256 },
    attemptedAt, priorAttempts, limits: CAPTURE_LIMITS, extraction: SOURCE_TEXT_EXTRACTION, status: captureStatus(sources), rawBytesRetained: rawBytesRetained(sources), sources, coreLinks,
    note: 'Literal captured text is the evidence; B2 summaries remain leads. A core link means B2 cited that page, not that a passage entails the answer. Raw bytes and full text are on disk under sources/.' };
}
// Re-verify a stored sidecar against the work's B2 completion: binding, text hashes, passage offsets and, given the
// research dir, the retained raw bytes (SHA-256 of the decompressed bytes), the full text and the prior attempts.
export function verifyCaptureSidecar(sidecar, { runId, workId, b2Completion, researchDir = null }) {
  const e = [];
  if (sidecar?.version !== SOURCE_CAPTURE_VERSION || sidecar.runId !== runId || sidecar.workId !== workId) e.push('binding');
  if (sidecar?.b2?.bodySha256 !== b2Completion.bodySha256 || sidecar?.b2?.transcriptSha256 !== b2Completion.transcriptSha256) e.push('b2-binding');
  if (!Array.isArray(sidecar?.sources) || sidecar.sources.length > CAPTURE_LIMITS.maxSources) e.push('sources');
  const file = rel => (researchDir && typeof rel === 'string' && /^sources\/[0-9a-f]{64}\.(raw\.gz|txt)$/.test(rel) ? join(researchDir, rel) : null);
  let total = 0;
  for (const s of sidecar?.sources || []) {
    if (s.raw && researchDir) {
      const p = file(s.raw.file);
      let ok = false; try { const b = gunzipSync(readFileSync(p)); ok = b.length === s.bytes && bytesSha256(b) === s.bytesSha256; } catch { ok = false; }
      if (!ok) e.push(`${s.id}: raw bytes missing or changed`);
    }
    if (s.status !== 'captured') { if (s.text != null || s.passages != null) e.push(`${s.id}: failed source carries text`); continue; }
    if (!s.raw) e.push(`${s.id}: captured text without retained raw bytes`);
    total += s.text.length;
    if (sha256(s.text) !== s.storedTextSha256 || s.text.length !== s.storedChars || s.text.length > CAPTURE_LIMITS.perSourceChars) e.push(`${s.id}: text hash/length`);
    if (researchDir) {
      let full = null; try { full = readFileSync(file(s.fullText?.file), 'utf8'); } catch { full = null; }
      if (full == null || sha256(full) !== s.fullTextSha256 || full.length !== s.fullTextChars || !full.startsWith(s.text)) e.push(`${s.id}: full text missing, changed or not the packet's source`);
    }
    if (s.truncated && !(Array.isArray(s.omitted) && s.omitted.length)) e.push(`${s.id}: truncation without an explicit gap`);
    let at = 0;
    for (const p of s.passages) { if (p.start < at || p.end > s.text.length || p.end - p.start !== p.chars) e.push(`${s.id}/${p.id}: offsets`); at = p.end; }
  }
  if (total > CAPTURE_LIMITS.totalChars) e.push('total text over budget');
  if (sidecar && captureStatus(sidecar.sources || []) !== sidecar.status) e.push('status');
  if (researchDir) for (const a of sidecar?.priorAttempts || []) {
    const p = join(researchDir, 'capture-attempts', String(a.file || ''));
    if (!/^\d{6}\.json$/.test(a.file || '') || !existsSync(p) || bytesSha256(readFileSync(p)) !== a.sha256) e.push(`prior capture attempt ${a.file} missing or changed`);
  }
  return e.length ? { ok: false, errors: e } : { ok: true };
}
// ---- persisted capture attempts (review: an all-transient outcome is recorded, never discarded) ----
// Each session whose capture failed only transiently writes research/capture-attempts/NNNNNN.json. One later session
// may retry (the bounded transport retry); after MAX_CAPTURE_SESSIONS the sidecar is written with the failures, so
// the four-fetch envelope can never repeat indefinitely.
export const MAX_CAPTURE_SESSIONS = 2;
export function captureAttempts(researchDir) {
  const dir = join(researchDir, 'capture-attempts'), names = files(dir).filter(n => /^\d{6}\.json$/.test(n)).sort();
  names.forEach((n, i) => { if (n !== `${String(i + 1).padStart(6, '0')}.json`) throw new Error('capture attempt sequence mismatch'); });
  return names.map(n => ({ file: n, sha256: bytesSha256(readFileSync(join(dir, n))), record: readJson(join(dir, n)) }));
}
export function writeCaptureAttempt(researchDir, { runId, workId, b2Completion, sources, attemptedAt }) {
  const prior = captureAttempts(researchDir), dir = join(researchDir, 'capture-attempts'); mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = `${String(prior.length + 1).padStart(6, '0')}.json`;
  const record = { version: 'passBSourceCaptureAttempt/1', runId, workId, b2: { bodySha256: b2Completion.bodySha256, transcriptSha256: b2Completion.transcriptSha256 }, attemptedAt, outcome: 'all-transient',
    sources: sources.map(s => ({ id: s.id, url: s.url, status: s.status, httpStatus: s.httpStatus ?? null, chain: s.chain })) };
  writeFileSync(join(dir, file), `${JSON.stringify(record, null, 1)}\n`, { flag: 'wx', mode: 0o600, flush: true });
  return [...prior, { file, sha256: bytesSha256(readFileSync(join(dir, file))), record }];
}
export const passageText = (source, passageId) => { const p = source.passages.find(x => x.id === passageId); return p ? source.text.slice(p.start, p.end) : null; };

// ---- banked B0/image + B1 import (migration receipts) ----
// Verify a banked work's B0 and (if present) B1 exactly as the banked collector would, reading only the banked run.
function bankedModelFor(bankedRunDir, bankedRunId, workDir, transcriptFile) {
  const stem = String(transcriptFile).slice(0, 9), resPath = join(workDir, 'attempts', `${stem}.reserved.json`);
  if (!/^b1-\d{6}$/.test(stem) || !existsSync(resPath)) return { model: HISTORICAL_MODEL, reservationPath: null, epochPath: null, callDir: null };
  const r = readJson(resPath), number = r.executionEpoch ?? 0;
  if (r.runId !== bankedRunId || r.stage !== 'B1') throw new Error('banked reservation binding mismatch');
  const epochPath = number === 0 ? join(bankedRunDir, 'execution-policy.json') : join(bankedRunDir, 'execution-policies', `${String(number).padStart(6, '0')}.json`);
  if (!existsSync(epochPath)) throw new Error('banked epoch missing');
  const policy = number === 0 ? readJson(epochPath) : readJson(epochPath).policy;
  if (sha256(stableJson(policy)) !== r.executionPolicySha256 || policy?.evidenceRunId !== bankedRunId) throw new Error('banked epoch policy binding mismatch');
  const metaPath = join(workDir, 'attempts', `${stem}.meta.json`);
  if (existsSync(metaPath) && readJson(metaPath).kind !== 'ok') throw new Error('banked B1 attempt was not accepted');
  return { model: policy.model ?? HISTORICAL_MODEL, reservationPath: resPath, epochPath, epochNumber: number, callDir: r.callDir ?? null };
}
// Review-5: classify a banked/imported B1 transcript with the shared validator (verifyAttemptConfinement).
export const NOT_REUSABLE_UNVERIFIABLE = 'not reusable: confinement unverifiable (legacy attempt with no controller-recorded call directory); needs a fresh B1';
function bankedConfinement(text, callDir, imageFile) {
  const conf = verifyAttemptConfinement(text, { stage: 'B1', callDir, imageBasename: imageFile });
  if (conf.status === 'violation') return { conf, violation: `confinement violation: ${String(conf.reason).slice(0, 240)}` };
  if (conf.status === 'unverifiable') return { conf, notReusable: NOT_REUSABLE_UNVERIFIABLE };
  if (conf.status !== 'confined' || !conf.receipt?.ok) return { conf, notReusable: `not reusable: ${conf.receipt?.reason || 'no Read of the image'}` };
  return { conf };
}
export function inspectBankedWork({ bankedRunDir, bankedRunId, id, catalog, legacy, bankedB1Prompt }) {
  const workDir = join(bankedRunDir, 'works', sha256(id).slice(0, 24)), b0Path = join(workDir, 'b0-prep.json');
  if (!existsSync(b0Path)) return { ok: false, reason: 'no banked B0' };
  const b0 = readJson(b0Path);
  if (b0.work?.id !== id || stableJson(b0.trustedCatalog) !== stableJson(catalog) || stableJson(b0.legacy) !== stableJson(legacy)) return { ok: false, reason: 'banked B0 input differs (catalog/legacy drift)' };
  if (!b0.image?.ok) return { ok: false, reason: 'banked B0 has no usable image' };
  const imageFile = neutralImageFile(b0.image.imgSha256, b0.image.ext), imagePath = join(bankedRunDir, 'imgs', imageFile);
  if (!existsSync(imagePath) || rawFileSha(imagePath) !== b0.image.imgSha256) return { ok: false, reason: 'banked image missing or changed' };
  // Review-5: b1Violation = a PROVEN boundary violation in the banked B1 (outside path/prefix or forbidden tool): an
  // explicit stop for review, never ordinary missing research. b1Reason alone = not reusable; the work runs a fresh B1.
  const out = { ok: true, workDir, b0, b0Path, imageFile, imagePath, b1: null, b1Reason: null, b1Violation: null };
  const name = `b1-${completionKey('B1', id)}.json`, cPath = join(workDir, 'completions', name);
  if (!existsSync(cPath)) { out.b1Reason = 'no banked B1 completion'; return out; }
  try {
    const c = readJson(cPath);
    const found = findTranscriptBySha(workDir, 'B1', c.transcriptSha256);
    if (!found) throw new Error('banked B1 transcript missing');
    const { model, reservationPath, epochPath, epochNumber, callDir } = bankedModelFor(bankedRunDir, bankedRunId, workDir, found.file);
    // Review-5 R5-1/R5-2: the shared directory-aware check, ahead of every other gate, against the banked reservation's
    // controller-recorded directory. A legacy attempt (none recorded) is not reusable; a proven violation stops.
    const caps = verifyStageCapabilities(found.bytes, 'B1');
    if (!caps.ok) { out.b1Violation = `banked B1 capability violation: ${caps.bad.join(', ')}`.slice(0, 300); out.b1Reason = out.b1Violation; return out; }
    const conf = bankedConfinement(found.bytes, callDir, imageFile);
    if (conf.violation) { out.b1Violation = `banked B1 ${conf.violation}`; out.b1Reason = out.b1Violation; return out; }
    if (conf.notReusable) { out.b1Reason = `banked B1 ${conf.notReusable}`; return out; }
    const promptHash = sha256(b1PromptText(bankedB1Prompt, imageFile));
    const v = validateStageCompletion(c, { trusted: { workId: id, imgSha256: b0.image.imgSha256, promptHash, brokerPolicyVersion: BROKER_POLICY_VERSION, imageTransportVersion: IMAGE_TRANSPORT_VERSION }, producer: producerEvidence('B1', { model, runtimeVersion: c.producer?.runtimeVersion }) });
    if (!v.ok) throw new Error(`banked B1 completion invalid: ${v.errors.join(',')}`);
    const rawPath = join(workDir, 'raw', `${c.rawResponseSha256}.json`);
    if (!existsSync(rawPath) || rawFileSha(rawPath) !== c.rawResponseSha256 || stableJson(readJson(rawPath)) !== stableJson(c.body)) throw new Error('banked B1 raw missing or mismatched');
    const ev = verifyStageEvidence({ stage: 'B1', workRunDir: workDir, completion: c, imageBasename: imageFile, expectedModel: model, confinement: { callDir } });
    if (!ev.ok) throw new Error(`banked B1 evidence: ${ev.errors.join(',')}`);
    if (stableJson(transcriptFinal(parseStreamTranscript(found.bytes))?.structured_output) !== stableJson(c.body)) throw new Error('banked B1 transcript/body mismatch');
    out.b1 = { completionPath: cPath, completionName: name, rawPath, transcriptFile: found.file, transcriptPath: join(workDir, 'attempts', found.file), reservationPath, epochPath, epochNumber: epochNumber ?? null, model, promptHash, body: c.body };
  } catch (e) { out.b1Reason = String(e.message).slice(0, 200); }
  return out;
}
// Write the migration receipt and byte copies into the NEW run's work dir (exclusive; never overwrites).
export function writeImport({ workDir, imgsDir, runId, bankedRunId, id, catalog, legacy, banked, freshB1 = false, now = new Date() }) {
  const manifestPath = join(workDir, 'imports', 'manifest.json');
  if (existsSync(manifestPath)) throw new Error(`${id}: import manifest already exists`);
  mkdirSync(join(workDir, 'imports'), { recursive: true, mode: 0o700 }); mkdirSync(imgsDir, { recursive: true, mode: 0o700 });
  const imgTarget = join(imgsDir, banked.imageFile);
  if (!existsSync(imgTarget)) copyFileSync(banked.imagePath, imgTarget);
  if (rawFileSha(imgTarget) !== banked.b0.image.imgSha256) throw new Error(`${id}: imported image hash mismatch`);
  let b1 = null;
  if (banked.b1 && !freshB1) {
    const d = join(workDir, 'imports', 'b1');
    for (const sub of ['completions', 'raw', 'attempts']) mkdirSync(join(d, sub), { recursive: true, mode: 0o700 });
    const copy = (from, to) => { writeFileSync(to, readFileSync(from), { flag: 'wx', mode: 0o600 }); return rawFileSha(to); };
    b1 = { completionFile: banked.b1.completionName, completionSha256: copy(banked.b1.completionPath, join(d, 'completions', banked.b1.completionName)),
      rawFile: `${readJson(banked.b1.completionPath).rawResponseSha256}.json`, rawSha256: null, transcriptFile: banked.b1.transcriptFile,
      transcriptSha256: copy(banked.b1.transcriptPath, join(d, 'attempts', banked.b1.transcriptFile)),
      reservationSha256: banked.b1.reservationPath ? copy(banked.b1.reservationPath, join(d, 'reservation.json')) : null,
      epochNumber: banked.b1.epochNumber, epochFileSha256: banked.b1.epochPath ? copy(banked.b1.epochPath, join(d, 'epoch.json')) : null,
      model: banked.b1.model, promptHash: banked.b1.promptHash, promptVersion: 'banked' };
    b1.rawSha256 = copy(banked.b1.rawPath, join(d, 'raw', b1.rawFile));
  }
  const manifest = { version: IMPORT_VERSION, runId, workId: id, sourceRunId: bankedRunId, importedAt: now.toISOString(),
    b0: { sourceB0PrepSha256: rawFileSha(banked.b0Path), image: banked.b0.image, trustedCatalogSha256: sha256(stableJson(catalog)), legacySha256: sha256(stableJson(legacy)) },
    b1, b1NotImported: b1 ? null : (freshB1 && banked.b1 ? 'fresh B1 requested at the new prompt version (canary)' : banked.b1Reason),
    preserved: 'The banked run was only read: its B1/B2/B3 bytes, execution epochs, ledger and done state are unchanged.' };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 1)}\n`, { flag: 'wx', mode: 0o600, flush: true });
  return manifest;
}
export const readImport = workDir => existsSync(join(workDir, 'imports', 'manifest.json')) ? readJson(join(workDir, 'imports', 'manifest.json')) : null;
// Re-verify an imported B1 from its copies alone (offline): hashes, completion bindings, original model and transcript.
// Review-5 R5-2: the copied transcript is re-checked with the shared directory-aware validator against the COPIED
// reservation's controller-recorded callDir. Returns { status: 'reusable', body, ... }, or { status: 'not-reusable',
// reason } for a legacy copy with no recorded directory (the work then needs a fresh B1), or { status: 'violation',
// reason } for a proven boundary violation (an explicit stop for review). Integrity failures still throw.
export function verifyImportedB1({ workDir, runId, id, catalog, legacy, b0, bankedB1Prompt, manifest }) {
  const m = manifest, d = join(workDir, 'imports', 'b1');
  if (m.version !== IMPORT_VERSION || m.runId !== runId || m.workId !== id || !m.b1) throw new Error(`${id}: import manifest binding mismatch`);
  if (stableJson(m.b0.image) !== stableJson(b0.image) || m.b0.trustedCatalogSha256 !== sha256(stableJson(catalog)) || m.b0.legacySha256 !== sha256(stableJson(legacy))) throw new Error(`${id}: imported B1 is bound to different B0 inputs`);
  const b1 = m.b1, cPath = join(d, 'completions', b1.completionFile), rawPath = join(d, 'raw', b1.rawFile), trPath = join(d, 'attempts', b1.transcriptFile);
  for (const [p, want] of [[cPath, b1.completionSha256], [rawPath, b1.rawSha256], [trPath, b1.transcriptSha256]]) if (!existsSync(p) || rawFileSha(p) !== want) throw new Error(`${id}: imported B1 copy missing or changed`);
  let model = HISTORICAL_MODEL, callDir = null;
  if (b1.reservationSha256) {
    const rp = join(d, 'reservation.json'), ep = join(d, 'epoch.json');
    if (!existsSync(rp) || rawFileSha(rp) !== b1.reservationSha256 || !existsSync(ep) || rawFileSha(ep) !== b1.epochFileSha256) throw new Error(`${id}: imported B1 reservation/epoch copy changed`);
    const r = readJson(rp), e = readJson(ep), policy = b1.epochNumber === 0 ? e : e.policy;
    if (r.runId !== m.sourceRunId || sha256(stableJson(policy)) !== r.executionPolicySha256) throw new Error(`${id}: imported B1 epoch binding mismatch`);
    model = policy.model ?? HISTORICAL_MODEL; callDir = r.callDir ?? null;
  }
  const imported = readFileSync(trPath, 'utf8'), importedImage = neutralImageFile(b0.image.imgSha256, b0.image.ext);
  const caps = verifyStageCapabilities(imported, 'B1');
  if (!caps.ok) return { status: 'violation', reason: `imported B1 capability violation: ${caps.bad.join(', ')}`.slice(0, 300) };
  const conf = bankedConfinement(imported, callDir, importedImage);
  if (conf.violation) return { status: 'violation', reason: `imported B1 ${conf.violation}` };
  if (conf.notReusable) return { status: 'not-reusable', reason: `imported B1 ${conf.notReusable}` };
  if (model !== b1.model) throw new Error(`${id}: imported B1 model mismatch`);
  const imageFile = neutralImageFile(b0.image.imgSha256, b0.image.ext), promptHash = sha256(b1PromptText(bankedB1Prompt, imageFile));
  if (promptHash !== b1.promptHash) throw new Error(`${id}: imported B1 prompt binding mismatch`);
  const c = readJson(cPath);
  const v = validateStageCompletion(c, { trusted: { workId: id, imgSha256: b0.image.imgSha256, promptHash, brokerPolicyVersion: BROKER_POLICY_VERSION, imageTransportVersion: IMAGE_TRANSPORT_VERSION }, producer: producerEvidence('B1', { model, runtimeVersion: c.producer?.runtimeVersion }) });
  if (!v.ok) throw new Error(`${id}: imported B1 completion invalid: ${v.errors.join(',')}`);
  if (stableJson(readJson(rawPath)) !== stableJson(c.body)) throw new Error(`${id}: imported B1 raw/body mismatch`);
  const ev = verifyStageEvidence({ stage: 'B1', workRunDir: d, completion: c, imageBasename: imageFile, expectedModel: model, confinement: { callDir } });
  if (!ev.ok) throw new Error(`${id}: imported B1 evidence: ${ev.errors.join(',')}`);
  if (stableJson(transcriptFinal(parseStreamTranscript(imported))?.structured_output) !== stableJson(c.body)) throw new Error(`${id}: imported B1 transcript/body mismatch`);
  return { status: 'reusable', body: c.body, model, sourceRunId: m.sourceRunId };
}

// ---- status axes (design-2 §2.1 item 6): four separate answers, never one "done" ----
export function researchStatus({ done, held, b2Planned, bodies, coverage, capture, b3 }) {
  return {
    operationalStatus: done ? 'done' : held ? 'held' : 'pending',
    sourceCaptureStatus: !b2Planned ? 'not-applicable' : capture ? capture.status : bodies.B2 ? 'not-attempted' : 'awaiting-b2',
    coverageStatus: !b2Planned ? 'not-applicable' : coverage ? coverage.coverageStatus : 'not-researched',
    b3DispatchStatus: b3 ? b3.status : 'not-applicable',
    copyEligibility: COPY_ELIGIBILITY,
  };
}

// ---- daily-hold diagnosis (design-2 §2.2): image, retrieval, catalog or evidence problems ----
export function classifyHold(reason) {
  const r = String(reason || '');
  if (/B0:|image|imageFitness|misread|confinement/i.test(r)) return 'image';
  if (/research-not-performed|WebFetch|WebSearch|retriev|fetch/i.test(r)) return 'retrieval';
  if (/input drift|catalog|trustedCatalog/i.test(r)) return 'catalog';
  if (/invalid body|provenance|set-aside|unknown|uncaptured|timeout|interrupted|stage-fail|evidence:/i.test(r)) return 'evidence';
  return 'other';
}
