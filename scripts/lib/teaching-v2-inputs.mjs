// Teaching-v2 Phase A input binding (VSD-093). Offline only: reads the preserved 50-work calibration evidence
// (cal50-0a47b6f7f332: B0 catalog/legacy/image, B1/B2/B3 completions, sanitized images) and the known regression
// cases, verifies every reused body against its hash-bound raw bytes, and derives the frozen development plan.
// Reused B1 is a fallible inventory; old B2 is an untrusted lead inventory; old B3 boxes are candidate locations.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { sha256, stableJson } from './vision-legacy.mjs';
import { EVIDENCE_AXES } from './vision-content-schema.mjs';
import { sha256Bytes } from './teaching-v2-contract.mjs';

export const CAL50_RUN = 'cal50-0a47b6f7f332';
export const CAL50_IMGS = 'imgs-235e7ebf51';
export const SELECTION_FILE = 'tasks/pass-b-calibration-50-selection.json';
export const PLAN_FILE = 'tasks/teaching-v2-phase-a/plan.json';
export const PLAN_SALT = 'teaching-v2-phase-a/1';
export const workKey = id => sha256(id).slice(0, 24);

// The 23 north-star ids (docs/vision-study-guide-style.md) and the three bundle works (examples 1, 2, 5).
export const GOLD_IDS = Object.freeze(['wikidata:Q19883817', 'http://www.wikidata.org/entity/Q549847', 'harvard303460', 'harvard303830', 'http://www.wikidata.org/entity/Q2304870', 'harvard173617', 'harvard303416', 'harvard290813', 'harvard303419', 'http://www.wikidata.org/entity/Q512755', 'harvard292377', 'aic24573', 'wikidata:Q6455615', 'http://www.wikidata.org/entity/Q687182', 'wikidata:Q2454480', 'harvard211411', 'wikidata:Q110776566', 'aic33671', 'harvard288090', 'harvard300021', 'http://www.wikidata.org/entity/Q1212937', 'http://www.wikidata.org/entity/Q586035', 'vaO40991']);
export const GOLD_BUNDLE_IDS = Object.freeze(['harvard303416', 'aic24573', 'wikidata:Q6455615']);

// Verified body of a captured stage: the raw file must hash to rawResponseSha256 and reparse to the stored body.
export function loadVerifiedBody(workDir, stage) {
  const dir = join(workDir, 'completions');
  if (!existsSync(dir)) return null;
  const f = readdirSync(dir).find(x => x.startsWith(`${stage.toLowerCase()}-`) && x.endsWith('.json'));
  if (!f) return null;
  const c = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const raw = readFileSync(join(workDir, 'raw', `${c.rawResponseSha256}.json`), 'utf8');
  if (sha256(raw) !== c.rawResponseSha256) throw new Error(`${workDir} ${stage}: raw hash mismatch`);
  if (stableJson(JSON.parse(raw)) !== stableJson(c.body)) throw new Error(`${workDir} ${stage}: raw/body mismatch`);
  return { body: c.body, completionSha256: sha256(readFileSync(join(dir, f), 'utf8')), rawResponseSha256: c.rawResponseSha256, promptHash: c.promptHash, model: c.producer?.model ?? null, stage };
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
  const kept = [], rejected = [];
  for (const v of b3?.verifications || []) {
    const r = reqs.get(v.requestId);
    const what = r?.whatToLocate || '';
    if (!r) { rejected.push({ requestId: v.requestId, reason: 'originating request not recoverable' }); continue; }
    if (!v.found || !v.bbox) { rejected.push({ requestId: v.requestId, reason: 'not found' }); continue; }
    if (DOCUMENTARY.test(what)) { rejected.push({ requestId: v.requestId, reason: 'documentary or verdict-seeking request (keyword screen)' }); continue; }
    kept.push({ requestId: v.requestId, physicalRequest: what, bbox: v.bbox, observed: v.note, confidence: v.confidence, caveat: 'Candidate location from an earlier image pass. A box shows where something visible was found; it does not verify any identity or history.' });
  }
  return { kept, rejected };
}


// One calibration work, bound to its preserved evidence. Throws on any integrity failure.
export function loadCalibrationWork(id, { evidenceRoot }) {
  const workDir = join(evidenceRoot, CAL50_RUN, 'works', workKey(id));
  const b0 = JSON.parse(readFileSync(join(workDir, 'b0-prep.json'), 'utf8'));
  if (b0.work.id !== id) throw new Error(`${id}: b0 binds ${b0.work.id}`);
  const B1 = loadVerifiedBody(workDir, 'B1'), B2 = loadVerifiedBody(workDir, 'B2'), B3 = loadVerifiedBody(workDir, 'B3');
  const imgPath = join(evidenceRoot, CAL50_IMGS, `${b0.image.imgSha256}.${b0.image.ext}`);
  if (!existsSync(imgPath)) throw new Error(`${id}: sanitized image missing`);
  const imgBytes = readFileSync(imgPath);
  if (sha256Bytes(imgBytes) !== b0.image.imgSha256) throw new Error(`${id}: image bytes do not match the B0 SHA`);
  return {
    id, key: workKey(id), origin: `calibration:${CAL50_RUN}`,
    catalog: b0.trustedCatalog, legacy: b0.legacy, work: b0.work,
    image: { sha256: b0.image.imgSha256, ext: b0.image.ext, width: b0.image.width, height: b0.image.height, path: imgPath },
    b1: B1?.body ?? null, b2: B2?.body ?? null, b3: B3?.body ?? null,
    receipts: { b0Sha256: sha256(readFileSync(join(workDir, 'b0-prep.json'), 'utf8')), B1: B1 && { completionSha256: B1.completionSha256, model: B1.model }, B2: B2 && { completionSha256: B2.completionSha256, model: B2.model }, B3: B3 && { completionSha256: B3.completionSha256, model: B3.model } },
  };
}

// Known regression cases (design §6.1): the six-work editorial audit and the 21-work research assessment. Their
// evidence was read from the evidence branch into a local folder (one dir per case: b0.json or catalog.json,
// b1.json, b2.json, optional b3.json/b3-boxes.json, image.jpg). Reported separately from the 50.
export function loadRegressionWork(dir, { id, label }) {
  const j = f => existsSync(join(dir, f)) ? JSON.parse(readFileSync(join(dir, f), 'utf8')) : null;
  const b0 = j('b0.json'); const cat = j('catalog.json');
  const catalog = b0?.trustedCatalog || (cat && { title: cat.title ?? '', artist: cat.artist ?? '', date: String(cat.year ?? cat.date ?? ''), place: cat.place ?? '', medium: cat.medium ?? '', style: cat.style ?? '', catalogId: cat.id });
  const imgPath = join(dir, 'image.jpg');
  const bytes = existsSync(imgPath) ? readFileSync(imgPath) : null;
  return {
    id, key: workKey(id), origin: `regression:${label}`, catalog, legacy: b0?.legacy ?? null, work: { id },
    image: bytes ? { sha256: sha256Bytes(bytes), ext: 'jpg', width: b0?.image?.width ?? null, height: b0?.image?.height ?? null, path: imgPath } : null,
    b1: j('b1.json'), b2: j('b2.json'), b3: j('b3.json') || j('b3-boxes.json'), receipts: { importedFrom: dir },
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
