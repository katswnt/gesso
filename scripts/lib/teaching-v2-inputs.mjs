// Teaching-v2 Phase A input binding (VSD-093). Offline only: reads the preserved 50-work calibration evidence
// (cal50-0a47b6f7f332: B0 catalog/legacy/image, B1/B2/B3 completions, sanitized images) and the known regression
// cases, verifies every reused body against its hash-bound raw bytes, and derives the frozen development plan.
// Reused B1 is a fallible inventory; old B2 is an untrusted lead inventory; old B3 boxes are candidate locations.
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { sha256, stableJson } from './vision-legacy.mjs';
import { EVIDENCE_AXES } from './vision-content-schema.mjs';
import { verifyCapturedStage, completionKey } from './vision-content-capture.mjs';
import { verifyStageEvidence, producerEvidence, parseStreamTranscript, transcriptFinal, findTranscriptBySha, b2InputFor, b3Plan, legacyContentInput, CALIBRATION_MODEL, IMAGE_TRANSPORT_VERSION } from './pass-b-calibration.mjs';
import { stagePrompts, promptHashes } from './pass-b-prompts.mjs';
import { BROKER_POLICY_VERSION } from './img-broker.mjs';
import { sha256Bytes, bboxError } from './teaching-v2-contract.mjs';

export const CAL50_RUN = 'cal50-0a47b6f7f332';
export const CAL50_IMGS = 'imgs-235e7ebf51';
export const SELECTION_FILE = 'tasks/pass-b-calibration-50-selection.json';
export const PLAN_FILE = 'tasks/teaching-v2-phase-a/plan.json';
export const PLAN_SALT = 'teaching-v2-phase-a/1';
export const workKey = id => sha256(id).slice(0, 24);

// The 23 north-star ids (docs/vision-study-guide-style.md) and the three bundle works (examples 1, 2, 5).
export const GOLD_IDS = Object.freeze(['wikidata:Q19883817', 'http://www.wikidata.org/entity/Q549847', 'harvard303460', 'harvard303830', 'http://www.wikidata.org/entity/Q2304870', 'harvard173617', 'harvard303416', 'harvard290813', 'harvard303419', 'http://www.wikidata.org/entity/Q512755', 'harvard292377', 'aic24573', 'wikidata:Q6455615', 'http://www.wikidata.org/entity/Q687182', 'wikidata:Q2454480', 'harvard211411', 'wikidata:Q110776566', 'aic33671', 'harvard288090', 'harvard300021', 'http://www.wikidata.org/entity/Q1212937', 'http://www.wikidata.org/entity/Q586035', 'vaO40991']);
export const GOLD_BUNDLE_IDS = Object.freeze(['harvard303416', 'aic24573', 'wikidata:Q6455615']);

// ---- Imported-stage provenance (review finding 5) ----
// The cal50 run's ORIGINAL contract: Sonnet 4.6, img-broker/1, readtool-confined-dir/1, and the B1/B2/B3 base
// prompts whose hashes its run manifest records (still byte-identical at HEAD; checked, never assumed).
export const CAL50_CONTRACT = Object.freeze({ model: CALIBRATION_MODEL, brokerPolicyVersion: BROKER_POLICY_VERSION, imageTransportVersion: IMAGE_TRANSPORT_VERSION });
// The exact effective prompt each historical stage was bound to (pass-b-calibration.mjs runWorkStages).
export function historicalEffectivePrompt(stage, { id, catalog, legacy, imageFile, b1, b2, prompts = stagePrompts() }) {
  if (stage === 'B1') return `${prompts.B1}\n\nThe working directory contains exactly one image file: ./${imageFile}\nCall the Read tool on ./${imageFile} to view the artwork, then inventory ONLY what you actually see. If Read fails or returns no image, set imageFitness.ok=false and do not invent content.`;
  if (stage === 'B2') return `${prompts.B2}\n\nCATALOG+SIGNALS:\n${JSON.stringify(b2InputFor(id, catalog, b1))}\n\nEXISTING CONTENT:\n${JSON.stringify(legacyContentInput(legacy))}`;
  if (stage === 'B3') return `${prompts.B3}\n\nThe working directory contains exactly one image file: ./${imageFile}\nCall the Read tool on ./${imageFile}, then answer ONLY these targeted requests.\n\nLOCATE:\n${JSON.stringify(b3Plan(b2).requests)}`;
  throw new Error(`no historical prompt for ${stage}`);
}
// One historical stage, verified with the SHARED captured-stage and execution-evidence verifiers against its
// original contract: exactly one completion file at its canonical key, the strict stage schema with the work/image/
// effective-prompt bindings, the raw response, the transcript found by hash (answering model, subscription auth,
// exact image Read for B1/B3, real web retrieval for B2), and transcript structured output == body. Returns null
// when the stage never ran; throws on anything ambiguous or unverifiable. Producer model is kept as recorded.
export function loadHistoricalStage(workDir, stage, { id, catalog, legacy, image, bodies, contract = CAL50_CONTRACT }) {
  const dir = join(workDir, 'completions');
  const found = existsSync(dir) ? readdirSync(dir).filter(f => f.startsWith(`${stage.toLowerCase()}-`) && f.endsWith('.json')) : [];
  if (!found.length) return null;
  const name = `${stage.toLowerCase()}-${completionKey(stage, id)}.json`;
  if (found.length !== 1 || found[0] !== name) throw new Error(`${id} ${stage}: ambiguous or misnamed completion files (${found.join(', ')})`);
  const realDir = realpathSync(workDir), completionPath = join(realDir, 'completions', name);
  const c = JSON.parse(readFileSync(completionPath, 'utf8'));
  const imageFile = `${image.imgSha256}.${image.ext}`;
  const promptHash = sha256(historicalEffectivePrompt(stage, { id, catalog, legacy, imageFile, b1: bodies.B1, b2: bodies.B2 }));
  const context = stage === 'B2' ? { evidenceIds: b2InputFor(id, catalog, bodies.B1).visibleSignals.map(x => x.evidenceId) } : stage === 'B3' ? { requestIds: b3Plan(bodies.B2).requestIds } : {};
  const v = verifyCapturedStage({ completionPath, runDir: realDir, context,
    trusted: { workId: id, imgSha256: image.imgSha256, promptHash, brokerPolicyVersion: contract.brokerPolicyVersion, imageTransportVersion: contract.imageTransportVersion },
    producer: producerEvidence(stage, { model: contract.model, runtimeVersion: c.producer?.runtimeVersion }) });
  if (!v.ok) throw new Error(`${id} ${stage}: completion does not verify against its original contract: ${v.errors.join(',')}`);
  const ev = verifyStageEvidence({ stage, workRunDir: realDir, completion: c, imageBasename: imageFile, expectedModel: contract.model });
  if (!ev.ok) throw new Error(`${id} ${stage}: execution evidence: ${ev.errors.join(',')}`);
  const t = findTranscriptBySha(realDir, stage, c.transcriptSha256);
  if (stableJson(transcriptFinal(parseStreamTranscript(t.bytes))?.structured_output) !== stableJson(c.body)) throw new Error(`${id} ${stage}: transcript/body mismatch`);
  return { body: c.body, receipt: { stage, completionSha256: sha256(readFileSync(completionPath, 'utf8')), rawResponseSha256: c.rawResponseSha256, transcriptSha256: c.transcriptSha256, promptHash, producerModel: c.producer.model, runtimeVersion: c.producer.runtimeVersion, verifiedWith: 'verifyCapturedStage+verifyStageEvidence/cal50' } };
}
export function b1EvidenceIds(b1) {
  const ids = new Set();
  for (const ax of EVIDENCE_AXES) for (const e of b1?.evidence?.[ax] || []) ids.add(e.evidenceId);
  for (const d of b1?.visual?.delights || []) ids.add(d.delightId);
  return ids;
}
export function b2Sources(b2) {
  const out = []; const seen = new Set();
  for (const f of b2?.factChecks || []) for (const s of f.sources || []) if (s?.url && !seen.has(s.url)) { seen.add(s.url); out.push({ sourceId: s.sourceId, url: s.url, title: s.title ?? null }); }
  return out;
}
// Old B2 as untrusted leads for W/V: catalog proposal, every non-"supported" fact check, and its uncertainty.
export function catalogConflicts(b2) {
  if (!b2) return { note: 'no earlier research stage output', catalogProposal: null, unresolvedFactChecks: [], uncertainty: '' };
  return {
    note: 'Earlier no-image research output. UNTRUSTED leads to audit, not evidence; its summaries may be wrong.',
    catalogProposal: b2.catalog ?? null,
    unresolvedFactChecks: (b2.factChecks || []).filter(f => f.verdict !== 'supported').map(f => ({ claim: f.claim, verdict: f.verdict, confidence: f.confidence })),
    uncertainty: b2.uncertainty || '',
  };
}
// Old B3 import (design §2.3): candidate locations only. Documentary/verdict requests and not-found rows are
// rejected with a recorded reason; the original evidence is untouched. A keyword screen cannot prove a request
// is physical; W/V still judge meaning.
const DOCUMENTARY = /\b(confirm|determine|verify|whether|refute|supports?|legacy|catalog|museum|cma|source|attribut\w*|dat(e|ing)|provenance|workshop|hand|original use|identity|identif\w*|inscription reads?|species|ritual)\b/i;
export function importB3Candidates(b2, b3) {
  const reqs = new Map((b2?.targetedVerificationRequests || []).map(r => [r.requestId, r]));
  const kept = [], rejected = [], seen = new Set();
  for (const v of b3?.verifications || []) {
    const r = reqs.get(v.requestId);
    const what = r?.whatToLocate || '';
    if (!r) { rejected.push({ requestId: v.requestId, reason: 'originating request not recoverable' }); continue; }
    if (seen.has(v.requestId)) { rejected.push({ requestId: v.requestId, reason: 'duplicate request id' }); continue; }
    seen.add(v.requestId);
    if (!v.found || !v.bbox) { rejected.push({ requestId: v.requestId, reason: 'not found' }); continue; }
    const be = bboxError(v.bbox); if (be) { rejected.push({ requestId: v.requestId, reason: `invalid box: ${be}` }); continue; }
    if (DOCUMENTARY.test(what)) { rejected.push({ requestId: v.requestId, reason: 'documentary or verdict-seeking request (keyword screen)' }); continue; }
    kept.push({ requestId: v.requestId, physicalRequest: what, bbox: v.bbox, observed: v.note, confidence: v.confidence, caveat: 'Candidate location from an earlier image pass. A box shows where something visible was found; it does not verify any identity or history.' });
  }
  return { kept, rejected };
}


// One calibration work, bound to its preserved evidence. Throws on any integrity failure.
export function loadCalibrationWork(id, { evidenceRoot }) {
  const workDir = join(evidenceRoot, CAL50_RUN, 'works', workKey(id));
  const manifest = JSON.parse(readFileSync(join(evidenceRoot, CAL50_RUN, 'run-manifest.json'), 'utf8'));
  const cur = promptHashes();
  for (const st of ['B1', 'B2', 'B3']) if (manifest.promptHashes?.[st] !== cur[st]) throw new Error(`${CAL50_RUN}: the ${st} base prompt at HEAD differs from the run manifest; its completions cannot be re-bound`);
  if (manifest.model !== CAL50_CONTRACT.model || manifest.imageTransportVersion !== CAL50_CONTRACT.imageTransportVersion || manifest.brokerPolicyVersion !== CAL50_CONTRACT.brokerPolicyVersion) throw new Error(`${CAL50_RUN}: run manifest contract mismatch`);
  const b0Text = readFileSync(join(workDir, 'b0-prep.json'), 'utf8'); const b0 = JSON.parse(b0Text);
  if (b0.work.id !== id) throw new Error(`${id}: b0 binds ${b0.work.id}`);
  const imgPath = join(evidenceRoot, CAL50_IMGS, `${b0.image.imgSha256}.${b0.image.ext}`);
  if (!existsSync(imgPath)) throw new Error(`${id}: sanitized image missing`);
  if (sha256Bytes(readFileSync(imgPath)) !== b0.image.imgSha256) throw new Error(`${id}: image bytes do not match the B0 SHA`);
  const bodies = {}, receipts = { b0Sha256: sha256(b0Text), runManifestSha256: sha256(stableJson(manifest)), contract: CAL50_CONTRACT };
  for (const st of ['B1', 'B2', 'B3']) {
    const r = loadHistoricalStage(workDir, st, { id, catalog: b0.trustedCatalog, legacy: b0.legacy, image: b0.image, bodies });
    if (r) { bodies[st] = r.body; receipts[st] = r.receipt; }
  }
  return {
    id, key: workKey(id), origin: `calibration:${CAL50_RUN}`,
    catalog: b0.trustedCatalog, legacy: b0.legacy, work: b0.work,
    image: { sha256: b0.image.imgSha256, ext: b0.image.ext, width: b0.image.width, height: b0.image.height, transform: b0.image.transform ?? null, path: imgPath },
    b1: bodies.B1 ?? null, b2: bodies.B2 ?? null, b3: bodies.B3 ?? null,
    receipts, provenance: { ok: true, producers: Object.fromEntries(['B1', 'B2', 'B3'].filter(st => receipts[st]).map(st => [st, receipts[st].producerModel])) },
  };
}

// Known regression cases (design §6.1): the six-work editorial audit and the 21-work research assessment. Their
// evidence was read from the evidence branch into a local folder (one dir per case: b0.json or catalog.json,
// b1.json, b2.json, optional b3.json/b3-boxes.json, image.jpg). Reported separately from the 50.
// Their imports are BODY-ONLY copies (no completion envelopes or transcripts), so their stage provenance cannot be
// verified (review finding 5): the import receipt's file hashes are checked and the work is marked unverifiable,
// which holds it before W. Re-import with completions + transcripts (via gh api) before any regression run.
export function loadRegressionWork(dir, { id, label }) {
  const j = f => existsSync(join(dir, f)) ? JSON.parse(readFileSync(join(dir, f), 'utf8')) : null;
  const receipt = j('import-receipt.json');
  const receiptErr = !receipt ? 'no import receipt' : receipt.id !== id ? `import receipt binds ${receipt.id}` :
    (receipt.files || []).find(f => !existsSync(join(dir, f.f)) || sha256Bytes(readFileSync(join(dir, f.f))) !== f.sha256)?.f;
  if (receiptErr) throw new Error(`${label}: import receipt check failed (${receiptErr})`);
  const b0 = j('b0.json'); const cat = j('catalog.json');
  const catalog = b0?.trustedCatalog || (cat && { title: cat.title ?? '', artist: cat.artist ?? '', date: String(cat.year ?? cat.date ?? ''), place: cat.place ?? '', medium: cat.medium ?? '', style: cat.style ?? '', catalogId: cat.id });
  const imgPath = join(dir, 'image.jpg');
  const bytes = existsSync(imgPath) ? readFileSync(imgPath) : null;
  return {
    id, key: workKey(id), origin: `regression:${label}`, catalog, legacy: b0?.legacy ?? null, work: { id },
    image: bytes ? { sha256: sha256Bytes(bytes), ext: 'jpg', width: b0?.image?.width ?? null, height: b0?.image?.height ?? null, path: imgPath } : null,
    b1: j('b1.json'), b2: j('b2.json'), b3: j('b3.json') || j('b3-boxes.json'), receipts: { importedFrom: dir, importReceiptSha256: sha256(stableJson(receipt)) },
    provenance: { ok: false, reason: 'body-only regression import: no completion envelope or transcript to verify (re-import with stage evidence before running)' },
  };
}

// Known regression cases (design §6.1). Ids and evidence-branch provenance only; bytes are imported locally.
export const REGRESSIONS = Object.freeze([
  ...[['03', 'http://www.wikidata.org/entity/Q1091086'], ['05', 'wikidata:Q15461864'], ['07', 'wikidata:Q21585351'], ['08', 'http://www.wikidata.org/entity/Q185255'], ['09', 'wd:Q3595955'], ['12', 'wd:Q674846'], ['17', 'cleveland155537']]
    .map(([n, id]) => ({ id, label: `editorial-audit-${n}`, set: 'editorial-audit', caseNo: n })),
  ...['aic32623', 'met308540', 'wikidata:Q19883613', 'met54961', 'cleveland136178', 'met331619', 'met53573', 'aic30661', 'wikidata:Q60152111', 'wikidata:Q18709475', 'cleveland310353', 'cleveland137276', 'sinmafa_86-12-1', 'met327401', 'met469960', 'sifsg_F1904.61', 'aic67362', 'wikidata:Q17647883', 'http://www.wikidata.org/entity/Q12418', 'http://www.wikidata.org/entity/Q45585', 'http://www.wikidata.org/entity/Q151047']
    .map((id, i) => ({ id, label: `research-audit-${String(i + 1).padStart(2, '0')}`, set: 'research-audit', caseNo: String(i + 1).padStart(2, '0') })),
]);

// ---- Frozen development plan: deterministic order (salted SHA, no judgment), first ten serial, 20 pin works. ----
export function derivePlan(selection, { regressions = [] } = {}) {
  const works = selection.works.map(w => w.id);
  const order = [...works].sort((a, b) => sha256(`${PLAN_SALT}:${a}`).localeCompare(sha256(`${PLAN_SALT}:${b}`)));
  const flags = Object.fromEntries(works.map(id => [id, { goldOverlap: GOLD_IDS.includes(id), goldBundleOverlap: GOLD_BUNDLE_IDS.includes(id) }]));
  return {
    version: 'teachingV2PhaseAPlan/1', namespace: 'teaching-v2/2', salt: PLAN_SALT, selectionFile: SELECTION_FILE,
    selectionSha256: sha256(stableJson(selection.works.map(w => w.id))),
    rule: 'order = ascending sha256("teaching-v2-phase-a/1:" + id); firstTen = order[0..9]; pinDiagnostic = order[0..19]',
    order, firstTen: order.slice(0, 10), rest: order.slice(10), pinDiagnostic: order.slice(0, 20),
    flags,
    goldNote: 'Gold-overlap works still run but are excluded from the Phase A gate denominators and reported separately; a bundle-overlap work (W/V see its own gold lesson) is contaminated by construction.',
    regressions,
  };
}
