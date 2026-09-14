// Interactive human-review adjudication page for B4-v2 `humanReview` conflicts (B2/text vs B3/visible
// disagreements the pipeline left for a human). READ-ONLY over the run; produces one self-contained,
// browser-viewable HTML. No model calls, edits, approvals, or merges. Decisions are recorded in the
// viewer's own browser (localStorage) and exportable as text to hand back. Usage:
//   node scripts/pass-b-humanreview-page.mjs [<b4c-run-dir>]
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const RUN = process.argv[2] || 'data/incoming/vision-calibration/b4c-f45fac18da2e';
const ROOT = 'data/incoming/vision-calibration';
const SRC = join(ROOT, 'cal50-0a47b6f7f332');
const runId = RUN.split('/').pop();
const sha = (s) => createHash('sha256').update(s).digest('hex');
const wd = (id) => sha(id).slice(0, 24);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const imgsDir = readdirSync(ROOT).find((n) => /^imgs-/.test(n));

const rows = [];
for (const f of readdirSync(join(RUN, 'works')).filter((x) => x.endsWith('.b4.json'))) {
  const r = JSON.parse(readFileSync(join(RUN, 'works', f), 'utf8'));
  if (!r.ok) continue;
  const conflicts = (r.body.conflicts || []).filter((c) => c.status === 'humanReview');
  if (!conflicts.length) continue;
  const b0 = JSON.parse(readFileSync(join(SRC, 'works', wd(r.id), 'b0-prep.json'), 'utf8'));
  rows.push({ id: r.id, title: b0.trustedCatalog?.title || r.id, catalog: b0.trustedCatalog, image: b0.image, conflicts, hotspots: (r.body.hotspots || []).map((h) => ({ n: h.rank, x: h.x, y: h.y, t: h.conciseText })), corrections: r.body.corrections?.consequential || [] });
}
const totalConflicts = rows.reduce((a, r) => a + r.conflicts.length, 0);

const uri = new Map();
for (const r of rows) {
  const k = r.image?.imgSha256; if (!k || uri.has(k)) continue;
  const p = imgsDir ? join(ROOT, imgsDir, `${k}.${r.image.ext}`) : '';
  if (p && existsSync(p)) { try { uri.set(k, `data:image/jpeg;base64,${(await sharp(readFileSync(p)).resize({ width: 820, withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer()).toString('base64')}`); } catch { uri.set(k, ''); } } else uri.set(k, '');
}

function card(r) {
  const src = uri.get(r.image?.imgSha256) || '';
  const pins = r.hotspots.map((h) => `<span class="pin" style="left:${h.x}%;top:${h.y}%" title="${esc(h.t)}">${h.n}</span>`).join('');
  const conflicts = r.conflicts.map((c, i) => {
    const key = `${r.id}@@${c.field}`;
    return `<div class="conflict" data-key="${esc(key)}">
      <div class="field">${esc(c.field)}</div>
      <div class="sides">
        <div class="side left"><div class="lbl">B2 · text / research</div>${esc(c.left)}</div>
        <div class="side right"><div class="lbl">B3 · what's visible</div>${esc(c.right)}</div>
      </div>
      <div class="decide">
        <button data-d="text">Trust text (B2)</button>
        <button data-d="visible">Trust visible (B3)</button>
        <button data-d="neither">Neither / drop</button>
        <button data-d="edit">Needs my edit</button>
        <input class="note" placeholder="optional note / your resolution text">
      </div>
    </div>`;
  }).join('');
  const corr = r.corrections.length ? `<details class="corr"><summary>${r.corrections.length} auto-applied correction(s) (context, already applied from sources)</summary>${r.corrections.map((c) => `<div>${esc(c.field)}: ${esc(c.from)} → ${esc(c.to)} (conf ${c.confidence})</div>`).join('')}</details>` : '';
  return `<section class="work"><h2>${esc(r.title)} <span class="wid">${esc(r.id)}</span></h2>
    <div class="row">${src ? `<div class="imgwrap"><img src="${src}" alt="">${pins}</div>` : '<div class="noimg">image unavailable</div>'}<div class="cc">${conflicts}${corr}</div></div></section>`;
}

const html = `<!doctype html><meta charset="utf-8"><title>Human review — ${esc(runId)}</title><style>
body{font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;margin:0;color:#1c1a17;background:#faf9f7}
header{position:sticky;top:0;background:#fff;border-bottom:1px solid #e4e0d8;padding:12px 18px;z-index:5}
h1{font-size:18px;margin:0 0 4px}h2{font-size:16px;margin:0 0 8px}.wid{color:#9a8f7e;font-size:11px;font-weight:400}
main{max-width:1050px;margin:0 auto;padding:14px 18px}
.work{border-top:2px solid #e4e0d8;padding-top:14px;margin-top:16px}
.row{display:grid;grid-template-columns:340px 1fr;gap:16px}@media(max-width:800px){.row{grid-template-columns:1fr}}
.imgwrap{position:relative;align-self:start}.imgwrap img{max-width:100%;border:1px solid #ddd;border-radius:6px;display:block}
.pin{position:absolute;transform:translate(-50%,-50%);width:20px;height:20px;border-radius:50%;background:#c9822b;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 2px #fff}
.conflict{border:1px solid #e4e0d8;border-radius:8px;padding:10px 12px;margin-bottom:12px;background:#fff}
.conflict.done{border-color:#2f7d4f;background:#f2f8f3}
.field{font-weight:700;margin-bottom:6px}
.sides{display:grid;grid-template-columns:1fr 1fr;gap:10px}@media(max-width:560px){.sides{grid-template-columns:1fr}}
.side{border-radius:6px;padding:8px 10px;font-size:14px}.side.left{background:#f3f0ff;border:1px solid #d5cdf0}.side.right{background:#eef6f0;border:1px solid #bfe0c9}
.lbl{font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#6b665e;margin-bottom:3px}
.decide{margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.decide button{padding:4px 10px;border:1px solid #cfc7ba;background:#fff;border-radius:14px;cursor:pointer;font-size:13px}
.decide button.sel{background:#1c1a17;color:#fff;border-color:#1c1a17}
.note{flex:1;min-width:180px;padding:4px 8px;border:1px solid #ddd;border-radius:6px;font-size:13px}
.corr{margin-top:6px;color:#6b665e;font-size:13px}
#bar{font-size:13px;color:#6b665e}#exp{margin-left:10px;padding:4px 12px;border:1px solid #1c1a17;background:#1c1a17;color:#fff;border-radius:14px;cursor:pointer}
#out{width:100%;height:120px;margin-top:8px;display:none;font-family:ui-monospace,monospace;font-size:12px}
.noimg{color:#b23b3b}
</style>
<header><h1>Human-review adjudication — ${totalConflicts} conflicts across ${rows.length} works · run ${esc(runId)}</h1>
<div><span id="bar">0 / ${totalConflicts} decided</span><button id="exp">Export my decisions</button></div>
<textarea id="out" readonly></textarea></header>
<main>
<p style="color:#6b665e">Each item is a place where the research text (B2) and what's actually visible (B3) disagree, left blank for you. Pick a side per item; your choices save in this browser. When done, click <b>Export my decisions</b> and paste the box back to me. Nothing is applied or merged.</p>
${rows.map(card).join('\n')}
</main>
<script>
const RUN=${JSON.stringify(runId)};
const K=k=>'hr:'+RUN+':'+k;
function load(k){try{return localStorage.getItem(K(k))}catch{return null}}
function save(k,v){try{localStorage.setItem(K(k),v)}catch{}}
const conflicts=[...document.querySelectorAll('.conflict')];
function refresh(){let n=0;for(const c of conflicts){const st=load(c.dataset.key);if(st&&JSON.parse(st).d){n++;c.classList.add('done')}else c.classList.remove('done')}document.getElementById('bar').textContent=n+' / '+conflicts.length+' decided'}
for(const c of conflicts){
  const key=c.dataset.key;const saved=load(key)?JSON.parse(load(key)):{};
  const note=c.querySelector('.note');if(saved.note)note.value=saved.note;
  c.querySelectorAll('.decide button').forEach(b=>{
    if(saved.d===b.dataset.d)b.classList.add('sel');
    b.onclick=()=>{c.querySelectorAll('.decide button').forEach(x=>x.classList.remove('sel'));b.classList.add('sel');save(key,JSON.stringify({d:b.dataset.d,note:note.value}));refresh()};
  });
  note.oninput=()=>{const cur=load(key)?JSON.parse(load(key)):{};save(key,JSON.stringify({d:cur.d||'',note:note.value}))};
}
document.getElementById('exp').onclick=()=>{
  const out=[];for(const c of conflicts){const [id,field]=c.dataset.key.split('@@');const st=load(c.dataset.key)?JSON.parse(load(c.dataset.key)):{};out.push({work:id,field,decision:st.d||'(none)',note:st.note||''})}
  const t=document.getElementById('out');t.style.display='block';t.value='B4-v2 human-review decisions ('+RUN+')\\n'+out.map(o=>o.work+' | '+o.field+' | '+o.decision+(o.note?' | '+o.note:'')).join('\\n')+'\\n\\nJSON:\\n'+JSON.stringify(out,null,1);t.select();
};
refresh();
</script>`;

const out = join(RUN, 'human-review.html');
writeFileSync(out, html);
console.log(`wrote ${out}`);
console.log(`${totalConflicts} conflicts across ${rows.length} works`);
