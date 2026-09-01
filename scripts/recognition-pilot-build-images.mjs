// Approval-gated image preparation only (no model calls). Fetches through G-03, renders the frozen
// seven-view panel, and writes isolated content-addressed evidence. It never edits the tracked draft.
// A curator/finalizer must review this evidence and explicitly copy its hashes into the protocol freeze.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import broker, { BROKER_POLICY_VERSION } from './lib/img-broker.mjs';
import { renderAllStudyViews, renderStudyView, IMAGE_POLICY } from './lib/recognition-pilot-images.mjs';
import { VIEW_SPECS, PILOT_FREEZE_ID, sha256, canonicalJson } from './lib/recognition-pilot.mjs';

if (!process.argv.includes('--fetch') || process.env.RECOGNITION_PILOT_IMAGE_FETCH !== '1') {
  console.error('REFUSED: image preparation needs --fetch and RECOGNITION_PILOT_IMAGE_FETCH=1'); process.exit(2);
}
if (process.env.CI) { console.error('REFUSED: never fetch pilot images in CI'); process.exit(2); }
const tracked = 'docs/research/recognition-pilot/pilot-manifest.draft.json';
const manifest = JSON.parse(readFileSync(tracked, 'utf8'));
if (manifest.freezeCandidateId !== PILOT_FREEZE_ID) throw new Error('draft freeze id drift');
const freezeId = PILOT_FREEZE_ID;
const runDir = join('data/incoming/recognition-pilot', freezeId);
const canonicalDir = join(runDir, 'canonical');
const viewsDir = join(runDir, 'views');
const jsonl = join(runDir, 'image-evidence.jsonl');
const finalPath = join(runDir, 'image-evidence.json');
mkdirSync(canonicalDir, { recursive: true, mode: 0o700 });
mkdirSync(viewsDir, { recursive: true, mode: 0o700 });
if (existsSync(finalPath)) { console.error('REFUSED: final image evidence already exists'); process.exit(2); }
const priorRows = existsSync(jsonl) ? readFileSync(jsonl, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : [];
const latestFor = w => [...priorRows].reverse().find(row => row.id === w.id
  && row.canonical?.requestedUrl === w.source.requestedUrl
  && (!w.studyC || row.alternate?.requestedUrl === w.alternate?.candidateUrl)) || null;

const saveView = rec => {
  const path = join(viewsDir, `${rec.sha256}.jpg`);
  if (!existsSync(path)) writeFileSync(path, rec.buffer, { flag: 'wx', mode: 0o600 });
  return { sha256: rec.sha256, width: rec.width, height: rec.height, mime: rec.mime, ext: rec.ext, view: rec.view, anchor: rec.anchor };
};

for (let i = 0; i < manifest.works.length; i++) {
  const w = manifest.works[i];
  const prior = latestFor(w);
  if (prior?.canonical?.ok && (!w.studyC || prior.alternate?.ok)) { console.log(`${i + 1}/${manifest.works.length} ${w.id} resume-skip`); continue; }
  const row = { id: w.id, canonical: null, views: {}, alternate: null };
  const fetched = await broker.fetchImageToModelFile(w.source.requestedUrl, canonicalDir, { userAgent: 'GessoRecognitionPilot/1.0 (kathryn.swint@gmail.com)', referer: true });
  if (!fetched.ok) {
    row.canonical = { ok: false, requestedUrl: w.source.requestedUrl, reason: fetched.reason, httpStatus: fetched.httpStatus || null };
    appendFileSync(jsonl, JSON.stringify(row) + '\n', { mode: 0o600 });
    console.log(`${i + 1}/${manifest.works.length} ${w.id} ${fetched.reason}`);
    continue;
  }
  const canonical = readFileSync(fetched.savedPath);
  row.canonical = { ok: true, requestedUrl: w.source.requestedUrl, sha256: fetched.sha256, width: fetched.width, height: fetched.height, mime: fetched.mime, host: fetched.host, finalUrl: fetched.finalUrl };
  for (const view of await renderAllStudyViews(canonical, w.transform.anchor)) row.views[view.view] = saveView(view);
  if (w.studyC) {
    if (!w.alternate?.sameObjectOwnerApproved) row.alternate = { ok: false, reason: 'owner-approval-required-before-fetch' };
    else {
      const af = await broker.fetchImageToModelFile(w.alternate.candidateUrl, canonicalDir, { userAgent: 'GessoRecognitionPilot/1.0 (kathryn.swint@gmail.com)', referer: true });
      if (!af.ok) row.alternate = { ok: false, reason: af.reason, httpStatus: af.httpStatus || null };
      else {
        const av = await renderStudyView(readFileSync(af.savedPath), VIEW_SPECS.find(v => v.id === 'full'), 'center');
        row.alternate = { ok: true, requestedUrl: w.alternate.candidateUrl, sourceSha256: af.sha256, sourceHost: af.host, finalUrl: af.finalUrl, view: saveView(av) };
      }
    }
  }
  appendFileSync(jsonl, JSON.stringify(row) + '\n', { mode: 0o600 });
  console.log(`${i + 1}/${manifest.works.length} ${w.id} ${row.canonical.ok ? 'ok' : row.canonical.reason}`);
}
const allRows = readFileSync(jsonl, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const items = manifest.works.map(w => [...allRows].reverse().find(row => row.id === w.id
  && row.canonical?.requestedUrl === w.source.requestedUrl
  && (!w.studyC || row.alternate?.requestedUrl === w.alternate?.candidateUrl)) || null);
if (items.some((row, i) => !row?.canonical?.ok || (manifest.works[i].studyC && !row?.alternate?.ok))) {
  console.error('INCOMPLETE: image evidence has failures/unapproved alternates; fix inputs and rerun (JSONL checkpoints preserved)');
  process.exit(2);
}
const evidence = { version: 'recognition-image-evidence/1', freezeId, brokerPolicyVersion: BROKER_POLICY_VERSION, imagePolicy: IMAGE_POLICY, items };
evidence.sha256 = sha256(canonicalJson({ ...evidence, sha256: undefined }));
writeFileSync(finalPath, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(`wrote isolated image evidence ${evidence.sha256}; tracked manifest unchanged; NO model calls`);
