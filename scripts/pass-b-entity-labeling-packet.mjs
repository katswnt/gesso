// VSD-034 item 4: compact OWNER-LABELING packet for a frozen holdout. Offline; no model calls.
// It PREFILLS proposed regions + entity types from an entity-canary run's emitted graphs so the owner only
// ACCEPTS / ADJUSTS (type or geometry) / REJECTS each proposal, or adds a missed entity — never authoring
// ground truth from scratch. Produces a self-contained review HTML + a machine prefill JSON. The owner's
// exported decisions become the frozen owner-labeled holdout (a separate, later offline step seals it).
//   node scripts/pass-b-entity-labeling-packet.mjs <run-dir>
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from './lib/vision-legacy.mjs';
import { parseStreamTranscript, transcriptFinal, neutralImageFile } from './lib/pass-b-calibration.mjs';
import { ENTITY_TYPES } from './lib/pass-b-entity-contract.mjs';

const runDir = process.argv[2] || 'data/incoming/vision-calibration/b6c-aafea89438d0';
const CAL_ROOT = 'data/incoming/vision-calibration';
const UPSTREAM = join(CAL_ROOT, 'cal50-0a47b6f7f332');
const safeId = (id) => id.replace(/[^a-z0-9]+/gi, '_');
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const mimeFor = (ext) => (ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg');

function imageDataUri(workId) {
  const b0 = JSON.parse(readFileSync(join(UPSTREAM, 'works', sha256(workId).slice(0, 24), 'b0-prep.json'), 'utf8'));
  const file = neutralImageFile(b0.image.imgSha256, b0.image.ext);
  for (const d of readdirSync(CAL_ROOT).filter((x) => /^imgs-/.test(x))) {
    const p = join(CAL_ROOT, d, file);
    if (existsSync(p)) return `data:${mimeFor(b0.image.ext)};base64,${readFileSync(p).toString('base64')}`;
  }
  return null;
}

const man = JSON.parse(readFileSync(join(runDir, 'run-manifest.json'), 'utf8'));
const works = [];
for (const w of readdirSync(join(runDir, 'works'))) {
  const tPath = join(runDir, 'works', w, 'attempt-1.transcript.jsonl');
  if (!existsSync(tPath)) continue;
  const g = transcriptFinal(parseStreamTranscript(readFileSync(tPath, 'utf8')))?.structured_output;
  if (!g) continue;
  const rById = new Map((g.regions || []).map((r) => [r.regionId, r.geometry]));
  const wid = JSON.parse(readFileSync(join(runDir, 'works', w, 'input.json'), 'utf8')).workId;
  works.push({
    workId: wid, imageDataUri: imageDataUri(wid),
    prefill: (g.entities || []).map((e) => ({ entityId: e.entityId, entityType: e.entityType, regions: e.regionRefs.map((rid) => rById.get(rid)).filter(Boolean) })),
    uncertainty: g.uncertainty || '',
  });
}

const holdoutId = `holdout-${sha256(JSON.stringify({ runId: man.runId, works: works.map((w) => w.workId) })).slice(0, 10)}`;
const prefillJson = { version: 'passBOwnerLabelingPrefill/1', holdoutId, sourceRunId: man.runId, note: 'Prefilled proposals from the entity-canary emission. Owner accepts/adjusts/rejects; nothing here is ground truth until the owner exports decisions.', works: works.map(({ imageDataUri: _u, ...rest }) => rest) };
writeFileSync(join(runDir, 'owner-labeling-prefill.json'), `${JSON.stringify(prefillJson, null, 2)}\n`);

const workHtml = works.map((w) => {
  const rows = w.prefill.map((e, i) => `
      <tr data-e="${esc(e.entityId)}">
        <td>${esc(e.entityId)}</td>
        <td><select data-role="type">${ENTITY_TYPES.map((t) => `<option${t === e.entityType ? ' selected' : ''}>${t}</option>`).join('')}</select></td>
        <td class="geo">${e.regions.map((r) => `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.w)}×${Math.round(r.h)}`).join(' ; ') || '—'}</td>
        <td class="verdict">
          <label><input type="radio" name="v-${esc(w.workId)}-${i}" value="accept" checked>accept</label>
          <label><input type="radio" name="v-${esc(w.workId)}-${i}" value="adjust">adjust</label>
          <label><input type="radio" name="v-${esc(w.workId)}-${i}" value="reject">reject</label>
        </td>
        <td><input type="text" data-role="note" placeholder="note / corrected geometry"></td>
      </tr>`).join('');
  return `<section data-work="${esc(w.workId)}">
    <h3>${esc(w.workId)}</h3>
    ${w.imageDataUri ? `<img src="${w.imageDataUri}" alt="">` : '<p><em>image unavailable</em></p>'}
    <p class="unc"><b>model uncertainty:</b> ${esc(w.uncertainty)}</p>
    <table><thead><tr><th>entity</th><th>type</th><th>region(s) %</th><th>verdict</th><th>note</th></tr></thead><tbody>${rows}</tbody></table>
    <p><label>Missed entities the model did not propose: <input type="text" data-role="missed" size="60" placeholder="type@x,y,w,h; …"></label></p>
  </section>`;
}).join('\n');

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Owner labeling — ${esc(holdoutId)}</title>
<style>body{font:15px/1.5 -apple-system,system-ui,sans-serif;margin:24px;max-width:1000px}section{border:1px solid #ddd;border-radius:8px;padding:16px;margin:16px 0}img{max-width:520px;height:auto;border:1px solid #ccc}table{border-collapse:collapse;width:100%;margin-top:10px}td,th{border:1px solid #e3e3e3;padding:5px 7px;font-size:13px;vertical-align:top}.geo{font-family:ui-monospace,monospace;font-size:12px}.unc{color:#555;font-size:13px}button{font-size:15px;padding:8px 14px}textarea{width:100%;height:120px}</style></head>
<body>
<h1>VSD-034 owner-labeling packet</h1>
<p>Holdout <code>${esc(holdoutId)}</code> · source run <code>${esc(man.runId)}</code>. Proposals are <b>prefilled</b> from the model's emission — accept, adjust (type via the dropdown; geometry/other via the note), or reject each, and list any missed entities. Your export is the ground truth; it is not a VSD-034 measurement until sealed separately.</p>
<button id="exp">Export owner labels</button>
${workHtml}
<h3>Export</h3><textarea id="out" readonly></textarea>
<script>
const HOLDOUT=${JSON.stringify(holdoutId)}, RUN=${JSON.stringify(man.runId)};
function collect(){const works=[...document.querySelectorAll('section[data-work]')].map(s=>{
  const workId=s.dataset.work;
  const decisions=[...s.querySelectorAll('tbody tr')].map(tr=>({entityId:tr.dataset.e,verdict:(tr.querySelector('input[type=radio]:checked')||{}).value||'accept',correctedType:tr.querySelector('[data-role=type]').value,note:tr.querySelector('[data-role=note]').value}));
  const missed=s.querySelector('[data-role=missed]').value;
  return {workId,decisions,missed};});
  return {version:'passBOwnerLabeledHoldout/1',holdoutId:HOLDOUT,sourceRunId:RUN,works};}
function save(){try{localStorage.setItem('vsd034-'+HOLDOUT,JSON.stringify(collect()))}catch{}}
document.addEventListener('input',save);
try{const s=localStorage.getItem('vsd034-'+HOLDOUT);if(s){/* restore is best-effort; left simple */}}catch{}
document.getElementById('exp').onclick=()=>{document.getElementById('out').value=JSON.stringify(collect(),null,2);document.getElementById('out').select()};
</script></body></html>`;
writeFileSync(join(runDir, 'owner-labeling-packet.html'), `${html}\n`);
console.log(`wrote ${join(runDir, 'owner-labeling-packet.html')} + owner-labeling-prefill.json`);
console.log(`  holdoutId ${holdoutId}; ${works.length} works; prefilled entities: ${works.reduce((s, w) => s + w.prefill.length, 0)}`);
for (const w of works) console.log(`    ${w.workId}: ${w.prefill.length} prefilled entities`);
