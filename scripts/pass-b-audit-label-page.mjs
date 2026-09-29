// Owner labeling page for the auto-audit evaluation sample (offline, no model calls). Evidence-complete: the artwork
// image, the trusted catalog, each cited source's URL with the research digest actually retrieved during B2 (clearly
// labeled as a digest, not the page), model observations marked unverified, and open claims. The automatic gate's
// verdict is deliberately NOT shown. Answers autosave locally and download as JSON.
//   node scripts/pass-b-audit-label-page.mjs   -> data/incoming/vision-calibration/audit-eval-v1/label.html
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from './lib/vision-legacy.mjs';

const ROOT = 'data/incoming/vision-calibration', CORPUS = join(ROOT, 'corpus-b3-6401bc543ead'), OUT = join(ROOT, 'audit-eval-v1');
const sample = JSON.parse(readFileSync(join(OUT, 'owner-sample.json'), 'utf8'));
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function workEvidence(workId) {
  const dir = join(CORPUS, 'works', sha256(workId).slice(0, 24));
  const b0 = JSON.parse(readFileSync(join(dir, 'b0-prep.json'), 'utf8'));
  const compFile = readdirSync(join(dir, 'completions')).find(f => f.startsWith('b2-'));
  const b2 = compFile ? JSON.parse(readFileSync(join(dir, 'completions', compFile), 'utf8')) : null;
  const urlById = {}, digests = {};
  for (const fc of b2?.body?.factChecks || []) for (const s of fc.sources || []) urlById[s.sourceId] = { url: s.url, title: s.title };
  if (b2) for (const f of readdirSync(join(dir, 'attempts')).filter(n => n.startsWith('b2-') && n.endsWith('.transcript.jsonl'))) {
    const text = readFileSync(join(dir, 'attempts', f), 'utf8'); if (sha256(text) !== b2.transcriptSha256) continue;
    const uses = {};
    for (const line of text.split('\n').filter(Boolean)) { let e; try { e = JSON.parse(line); } catch { continue; }
      for (const b of Array.isArray(e.message?.content) ? e.message.content : []) {
        if (b.type === 'tool_use' && b.name === 'WebFetch') uses[b.id] = b.input?.url;
        if (b.type === 'tool_result' && uses[b.tool_use_id]) { const c = b.content; digests[uses[b.tool_use_id]] = typeof c === 'string' ? c : (c || []).map(x => x?.text || '').join('\n'); }
      } }
  }
  return { catalog: b0.trustedCatalog, image: `../corpus-b3-6401bc543ead/imgs/${b0.image.imgSha256}.${b0.image.ext}`, urlById, digests };
}

const cache = new Map(); const ev = id => cache.get(id) || (cache.set(id, workEvidence(id)), cache.get(id));
const cards = sample.map((s, i) => {
  const w = ev(s.workId), c = w.catalog || {};
  const claims = s.cites.claims.map(cl => {
    const srcs = (cl.sources || []).map(id => w.urlById[id]).filter(Boolean);
    const srcHtml = srcs.length ? srcs.map(src => { const d = w.digests[src.url];
      return `<div class="src"><a href="${esc(src.url)}" target="_blank" rel="noopener">${esc(src.title || src.url)}</a> <span class="url">${esc(src.url)}</span>
        ${d ? `<details><summary>Research digest of this page (written by the fetch tool, not the page itself)</summary><pre>${esc(d)}</pre></details>` : '<div class="muted">Not fetched during research (cited from search results); open the link to check.</div>'}</div>`; }).join('')
      : '<div class="muted">No source cited.</div>';
    return `<li><b>Research claim:</b> ${esc(cl.proposition)} <span class="muted">(model's research verdict: ${esc(cl.verdict)})</span>${srcHtml}</li>`;
  }).join('') || '<li class="muted">Cites no research claims.</li>';
  const obs = s.cites.observations.map(o => `<li><b>Model observation (${esc(o.by)}, unverified):</b> ${esc(o.proposition)}</li>`).join('') || '<li class="muted">Cites no visual observations.</li>';
  const open = (s.openClaims || []).map(o => `<li>${esc(o)}</li>`).join('');
  return `<section class="card" id="c${i}" data-key="${esc(s.workId)}|${esc(s.componentId)}">
  <div class="head"><span class="n">${i + 1}/${sample.length}</span> <b>${esc(c.title || s.workId)}</b> <span class="muted">— ${esc(c.artist || 'unknown artist')}, ${esc(c.date || '')}, ${esc(c.medium || '')}</span></div>
  <div class="grid"><a href="${esc(w.image)}" target="_blank"><img src="${esc(w.image)}" alt="artwork" loading="lazy"></a>
  <div><div class="surface">${esc(s.surface)}</div><div class="copy">${esc(s.text)}</div>
  <h4>What it cites</h4><ul>${claims}${obs}</ul>
  ${open ? `<h4>Open questions the pipeline itself flagged for this work</h4><ul>${open}</ul>` : ''}
  <div class="choice">Is everything this ${esc(s.surface)} asserts supported by the image and the real sources?
    <label><input type="radio" name="r${i}" value="supported"> Supported</label>
    <label><input type="radio" name="r${i}" value="unsupported"> Unsupported or wrong</label>
    <label><input type="radio" name="r${i}" value="unsure"> Unsure</label>
    <input class="note" placeholder="Optional note: what's wrong or what you checked" data-i="${i}"></div></div></div></section>`;
}).join('\n');

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Audit labels</title>
<style>:root{--bg:#faf8f2;--ink:#1b1916;--muted:#6b6557;--line:#ddd8ca;--accent:#2230b8}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,sans-serif}
header{position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--line);padding:10px 16px;z-index:2;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
main{max-width:1100px;margin:0 auto;padding:16px}.card{border:1px solid var(--line);border-radius:6px;padding:14px;margin:0 0 18px;background:#fff}
.grid{display:grid;grid-template-columns:minmax(0,340px) 1fr;gap:16px}@media(max-width:760px){.grid{grid-template-columns:1fr}}img{width:100%;border-radius:4px}
.surface{text-transform:uppercase;font-size:12px;letter-spacing:.06em;color:var(--muted)}.copy{font-size:16px;margin:4px 0 10px;padding:8px;background:#f6f4ee;border-left:3px solid var(--accent)}
.muted{color:var(--muted)}.url{color:var(--muted);font-size:12px;word-break:break-all}.src{margin:6px 0 6px 12px}pre{white-space:pre-wrap;font-size:13px;background:#f6f4ee;padding:8px}
.choice{margin-top:12px;padding-top:10px;border-top:1px solid var(--line)}.choice label{margin-right:14px;white-space:nowrap}.note{width:100%;margin-top:8px;padding:6px}
button{background:var(--accent);color:#fff;border:0;border-radius:4px;padding:8px 12px;cursor:pointer}h4{margin:12px 0 4px}</style></head><body>
<header><b>Audit evaluation labels</b><span id="prog" class="muted"></span><button id="dl">Download labels JSON</button>
<span class="muted">Judge each component against the image and the real sources (open the links). Model research verdicts and observations are NOT evidence on their own. Answers save automatically in this browser.</span></header>
<main>${cards}</main>
<script>
const KEY='gesso-audit-labels-v1'; let state={}; try{state=JSON.parse(localStorage.getItem(KEY)||'{}')}catch{}
const cards=[...document.querySelectorAll('.card')];
function save(){try{localStorage.setItem(KEY,JSON.stringify(state))}catch{} const n=Object.values(state).filter(v=>v.label).length; document.getElementById('prog').textContent=n+' / '+cards.length+' labeled';}
cards.forEach((c,i)=>{const k=c.dataset.key, s=state[k]||{};
  c.querySelectorAll('input[type=radio]').forEach(r=>{ if(s.label===r.value) r.checked=true; r.onchange=()=>{state[k]={...(state[k]||{}),label:r.value}; save();}; });
  const note=c.querySelector('.note'); note.value=s.note||''; note.oninput=()=>{state[k]={...(state[k]||{}),note:note.value}; save();}; });
document.getElementById('dl').onclick=()=>{const rows=cards.map(c=>{const [workId,componentId]=c.dataset.key.split('|'); return {workId,componentId,...(state[c.dataset.key]||{})};});
  const blob=new Blob([JSON.stringify({version:'passBAuditOwnerLabels/1',labeledAt:new Date().toISOString(),rows},null,1)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='audit-owner-labels.json'; a.click();};
save();
</script></body></html>`;
writeFileSync(join(OUT, 'label.html'), html);
console.log(`wrote ${join(OUT, 'label.html')} (${sample.length} components, ${cache.size} works)`);
