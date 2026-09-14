// Offline editorial-review packet for a B4-v2 continuation run (VSD-026). READ-ONLY: no model calls, edits,
// approvals, or merges. Renders one self-contained, browser-viewable HTML covering all completed records + a
// quarantined section, with old-vs-proposed content, hotspot overlays, per-guide action/kind/grounding,
// conflicts/corrections/uncertainty, char counts, cohort, client-side filters, and a nominated first-10 set.
// Usage: node scripts/pass-b-b4-review-packet.mjs [<b4c-run-dir>]
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { projectToProduction } from './lib/pass-b-approval.mjs';

const RUN = process.argv[2] || 'data/incoming/vision-calibration/b4c-f45fac18da2e';
const ROOT = 'data/incoming/vision-calibration';
const SRC = join(ROOT, 'cal50-0a47b6f7f332');
const sha = (s) => createHash('sha256').update(s).digest('hex');
const wd = (id) => sha(id).slice(0, 24);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const imgsDir = readdirSync(ROOT).find((n) => /^imgs-/.test(n));

// production membership -> new vs overwrite
const teach = (() => { const w = {}; new Function('window', readFileSync('data/teach-works.js', 'utf8'))(w); return (w.ARTEFACTUM_CUES || {}).work || {}; })();
const meta = Object.fromEntries((JSON.parse(readFileSync(join(SRC, 'run-manifest.json'), 'utf8')).selection || []).map((s) => [s.id, s]));

function collect(id) {
  const b0 = JSON.parse(readFileSync(join(SRC, 'works', wd(id), 'b0-prep.json'), 'utf8'));
  const rec = JSON.parse(readFileSync(join(RUN, 'works', `${id.replace(/[^a-z0-9]+/gi, '_')}.b4.json`), 'utf8'));
  const m = meta[id] || {};
  const legacy = b0.legacy?.teaching || {};
  const oldHot = Array.isArray(b0.legacy?.hotspots) ? b0.legacy.hotspots.map((h) => ({ n: h.n, x: h.x, y: h.y })) : [];
  const body = rec.body || {};
  const rd = rec.rawDelta || {};
  const proj = rec.ok ? projectToProduction(body) : null;
  // pair hydrated guide/notes with their delta action/ref (assembler preserves order)
  const guide = (body.guide || []).map((g, i) => ({ ...g, action: rd.guide?.[i]?.action || '?', ref: rd.guide?.[i]?.ref || null }));
  const notes = (body.notes || []).map((n, i) => ({ ...n, action: rd.notes?.[i]?.action || '?', ref: rd.notes?.[i]?.ref || null }));
  const keptLegacyGuide = guide.filter((g) => g.action === 'keep' && /^legacy-/.test(String(g.ref || ''))).length;
  const overwriteStrong = (m.cohort === 'strongLegacy') && [...guide, ...notes].some((x) => /^legacy-/.test(String(x.ref || '')) && ['revise', 'replace', 'remove'].includes(x.action));
  const cons = body.corrections?.consequential || [];
  const conflicts = (body.conflicts || []).filter((c) => c.status === 'humanReview');
  const srcDep = (body.hotspots || []).filter((h) => h.sourceDependent).length + guide.filter((g) => (g.sourceRefs || []).length).length + notes.filter((n) => (n.sourceRefs || []).length).length;
  const maxAns = Math.max(0, ...guide.map((g) => (g.a || '').length));
  const entryType = teach[id] ? 'overwrite' : 'new';
  const needsAttention = conflicts.length > 0 || cons.length > 0 || overwriteStrong || (keptLegacyGuide === 0 && (legacy.guide || []).length > 0) || maxAns >= 660;
  const changeScore = [...guide, ...notes].filter((x) => x.action !== 'keep').length;
  return { id, meta: m, catalog: b0.trustedCatalog, image: b0.image, legacy, oldHot, body, guide, notes, proj, keptLegacyGuide, hadLegacyGuide: (legacy.guide || []).length, overwriteStrong, cons, conflicts, uncertainty: body.uncertainty || '', srcDep, maxAns, entryType, needsAttention, changeScore, evidence: rec.evidence, reused: !!rec.reused };
}

const files = readdirSync(join(RUN, 'works')).filter((f) => f.endsWith('.b4.json'));
const all = files.map((f) => JSON.parse(readFileSync(join(RUN, 'works', f), 'utf8')));
const completed = all.filter((r) => r.ok).map((r) => collect(r.id));
const quarantined = all.filter((r) => !r.ok);

// ---- nominate first-10: 5 strongLegacy + 5 thin/missing, include harvard303416, diverse culture/medium/fame/change ----
function nominate() {
  const strong = completed.filter((w) => w.meta.cohort === 'strongLegacy');
  const thin = completed.filter((w) => w.meta.cohort !== 'strongLegacy');
  const pickDiverse = (pool, n, seedIds = []) => {
    const chosen = pool.filter((w) => seedIds.includes(w.id));
    const seenReg = new Set(chosen.map((w) => w.meta.regionGroup)); const seenFame = new Set(chosen.map((w) => w.meta.fameBand)); const seenMed = new Set(chosen.map((w) => (w.catalog.medium || '').toLowerCase()));
    const rest = pool.filter((w) => !seedIds.includes(w.id)).sort((a, b) => b.changeScore - a.changeScore);
    while (chosen.length < n && rest.length) {
      // prefer a work adding a new region/fame/medium; tiebreak by change score
      let best = -1, bestScore = -1;
      rest.forEach((w, i) => {
        const div = (!seenReg.has(w.meta.regionGroup) ? 3 : 0) + (!seenFame.has(w.meta.fameBand) ? 2 : 0) + (!seenMed.has((w.catalog.medium || '').toLowerCase()) ? 2 : 0) + Math.min(2, w.changeScore / 4);
        if (div > bestScore) { bestScore = div; best = i; }
      });
      const w = rest.splice(best, 1)[0]; chosen.push(w); seenReg.add(w.meta.regionGroup); seenFame.add(w.meta.fameBand); seenMed.add((w.catalog.medium || '').toLowerCase());
    }
    return chosen;
  };
  const s5 = pickDiverse(strong, 5, strong.some((w) => w.id === 'harvard303416') ? ['harvard303416'] : []);
  const t5 = pickDiverse(thin, 5);
  return [...s5, ...t5].map((w) => w.id);
}
const first10 = nominate();

// ---- render ---- images DOWNSCALED + embedded as data URIs (self-contained + portable); cached per sha.
const uriCache = new Map();
async function prepImages(worksList) {
  for (const w of worksList) {
    const key = w.image?.imgSha256; if (!key || uriCache.has(key)) continue;
    const p = imgsDir ? join(ROOT, imgsDir, `${key}.${w.image.ext}`) : '';
    if (!p || !existsSync(p)) { uriCache.set(key, ''); continue; }
    try { const buf = await sharp(readFileSync(p)).resize({ width: 760, withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer(); uriCache.set(key, `data:image/jpeg;base64,${buf.toString('base64')}`); }
    catch { uriCache.set(key, ''); }
  }
}
// ONE image per work carrying BOTH old (grey) and proposed (orange) hotspot markers.
function overlay(w) {
  const src = uriCache.get(w.image?.imgSha256) || '';
  const oldM = w.oldHot.map((p) => `<span class="pin old" style="left:${p.x}%;top:${p.y}%">${p.n}</span>`).join('');
  const newM = (w.body.hotspots || []).map((h) => `<span class="pin proposed" style="left:${h.x}%;top:${h.y}%">${h.rank}</span>`).join('');
  return `<div class="ov"><div class="ovlabel"><span class="dot old"></span> OLD (${w.oldHot.length}) &nbsp; <span class="dot proposed"></span> PROPOSED (${(w.body.hotspots || []).length})</div>${src ? `<div class="imgwrap"><img loading="lazy" src="${src}" alt="">${oldM}${newM}</div>` : '<div class="noimg">image unavailable</div>'}</div>`;
}
const cn = (t) => `<span class="cn">${(t || '').length}</span>`;
const actionBadge = (a) => `<span class="act a-${a}">${a}</span>`;
const kindBadge = (k, ref) => `<span class="kind k-${k}">${k}${ref ? '→' + esc(ref) : ''}</span>`;

function guideBlock(w) {
  const oldQ = (w.legacy.guide || []);
  const rows = w.guide.map((g) => {
    const overwrote = /^legacy-/.test(String(g.ref || '')) && ['revise', 'replace'].includes(g.action) && w.meta.cohort === 'strongLegacy';
    return `<div class="qa ${overwrote ? 'overwrote' : ''}"><div class="q">${actionBadge(g.action)} ${kindBadge(g.kind, g.evidenceRef)} ${esc(g.q)} ${cn(g.q)}</div><div class="a">${esc(g.a)} ${cn(g.a)}</div>${overwrote ? '<div class="ow">⚑ overwrites strong legacy question</div>' : ''}</div>`;
  }).join('');
  const old = oldQ.length ? `<details class="oldg"><summary>OLD legacy guide (${oldQ.length}) — kept: ${w.keptLegacyGuide}</summary>${oldQ.map((q) => `<div class="qa old"><div class="q">${esc(q.q)}</div><div class="a">${esc(q.a)}</div></div>`).join('')}</details>` : '<p class="muted">no legacy guide (new entry)</p>';
  return `<h4>Proposed guide (${w.guide.length})</h4>${rows}${old}`;
}
function workCard(w) {
  const flags = [w.overwriteStrong ? 'overwrite-strong' : '', w.conflicts.length ? 'conflicts' : '', w.cons.length ? 'corrections' : '', (w.keptLegacyGuide === 0 && w.hadLegacyGuide) ? 'zero-legacy-kept' : '', w.needsAttention ? 'needs-attention' : ''].filter(Boolean);
  return `<section class="work" data-cohort="${w.meta.cohort}" data-entry="${w.entryType}" data-flags="${flags.join(' ')}" data-maxans="${w.maxAns}" data-id="${esc(w.id)}">
  <h3>${esc(w.catalog.title || w.id)} <span class="wid">${esc(w.id)}</span></h3>
  <div class="meta">${w.meta.cohort} · ${w.meta.fameBand} · ${esc(w.meta.regionGroup)} · ${esc(w.catalog.medium)} · <b>${w.entryType}</b>${w.reused ? ' · <span class="reused">reused</span>' : ''}${flags.map((f) => `<span class="flag">${f}</span>`).join('')}</div>
  ${overlay(w)}
  <div class="grid2">
    <div><h4>OLD why</h4><div class="why old">${esc(w.legacy.why) || '<span class=muted>—</span>'}</div>
      <h4>OLD cues</h4><ul>${(w.legacy.cues || []).map((c) => `<li>${esc(c)}</li>`).join('') || '<li class=muted>—</li>'}</ul></div>
    <div><h4>PROPOSED why ${cn(w.body.proposedWhy)} <span class="disp">${(w.body.dispositions.find((d) => d.component === 'why') || {}).disposition || ''}</span></h4><div class="why">${esc(w.body.proposedWhy)}</div>
      <h4>PROPOSED cues <span class="disp">${(w.body.dispositions.find((d) => d.component === 'cues') || {}).disposition || ''}</span></h4><ul>${(w.body.proposedCues || []).map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div>
  </div>
  ${guideBlock(w)}
  <h4>Proposed notes (${w.notes.length})</h4>${w.notes.map((n) => `<div class="note"><b>${actionBadge(n.action)} ${esc(n.head)}</b> ${cn(n.body)} ${n.evidenceRef ? kindBadge('image', n.evidenceRef) : ''}<div>${esc(n.body)}</div></div>`).join('')}
  ${w.cons.length ? `<div class="box corr"><b>Consequential corrections (${w.cons.length}):</b>${w.cons.map((c) => `<div>${esc(c.field)}: ${esc(c.from)} → ${esc(c.to)} (conf ${c.confidence}${(c.sourceRefs || []).length ? ', sourced' : ''})</div>`).join('')}</div>` : ''}
  ${w.conflicts.length ? `<div class="box conf"><b>Conflicts → humanReview (${w.conflicts.length}):</b>${w.conflicts.map((c) => `<div>${esc(c.field)} — left: ${esc(c.left)} | right: ${esc(c.right)}</div>`).join('')}</div>` : ''}
  ${w.uncertainty ? `<div class="box unc"><b>Uncertainty:</b> ${esc(w.uncertainty)}</div>` : ''}
  <div class="muted small">source-dependent claims: ${w.srcDep} · max answer ${w.maxAns} · change score ${w.changeScore} · ${w.evidence ? Math.round((w.evidence.durationMs || 0) / 1000) + 's' : ''}</div>
  </section>`;
}
function quarCard(r) {
  const rd = r.rawDelta || {};
  const g = (rd.guide || []).map((q) => `<div class="qa"><div class="q">${q.action || ''} ${esc(q.q)}</div><div class="a">${esc(q.a)}</div></div>`).join('') || '<p class=muted>no guide in attempt</p>';
  return `<section class="work quar" data-id="${esc(r.id)}"><h3>${esc(r.id)} <span class="bad">QUARANTINED</span></h3>
  <div class="box conf"><b>Exact rejection:</b> ${esc(r.why)}</div>
  <h4>Attempted why ${rd.why ? cn(rd.why.text) : ''}</h4><div class="why">${esc(rd.why?.text) || '<span class=muted>—</span>'}</div>
  <h4>Attempted cues</h4><ul>${(rd.cues?.items || []).map((c) => `<li>${esc(c)}</li>`).join('') || '<li class=muted>—</li>'}</ul>
  <h4>Attempted guide</h4>${g}
  <h4>Attempted notes</h4>${(rd.notes || []).map((n) => `<div class="note"><b>${n.action || ''} ${esc(n.head)}</b> ${n.body ? cn(n.body) : ''}<div>${esc(n.body)}</div></div>`).join('') || '<p class=muted>—</p>'}
  </section>`;
}

await prepImages(completed); // downscale + embed images before rendering

const html = `<!doctype html><meta charset="utf-8"><title>B4-v2 editorial review</title><style>
body{font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;margin:0;color:#1c1a17;background:#faf9f7}
header{position:sticky;top:0;background:#fff;border-bottom:1px solid #e4e0d8;padding:12px 18px;z-index:10}
h1{font-size:18px;margin:0 0 6px}h3{font-size:16px;margin:20px 0 2px}h4{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#6b665e;margin:12px 0 3px}
main{max-width:1100px;margin:0 auto;padding:14px 18px}
.work{border-top:2px solid #e4e0d8;padding-top:14px;margin-top:18px}.wid{color:#9a8f7e;font-size:11px;font-weight:400}
.meta{color:#6b665e;font-size:12px;margin:2px 0 8px}.flag{background:#f3 e;background:#f6efe6;color:#8a5a12;border-radius:4px;padding:1px 6px;margin-left:6px;font-size:11px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}@media(max-width:820px){.grid2{grid-template-columns:1fr}}
.why{background:#fff;border:1px solid #e4e0d8;border-radius:6px;padding:8px 10px}.why.old{background:#f3f1ec;color:#555}
.qa{margin:6px 0;padding:6px 8px;border-left:3px solid #e4e0d8}.qa.overwrote{border-left-color:#c9822b;background:#fdf5ea}.qa.old{border-left-color:#ccc;color:#666}
.q{font-weight:600}.a{color:#333}.ow{color:#a4601a;font-size:11px;margin-top:2px}
.note{margin:6px 0}.cn{color:#b6ab98;font-size:10px}.small{font-size:11px}.muted{color:#9a8f7e}
.act{font-size:10px;text-transform:uppercase;border-radius:3px;padding:0 4px;margin-right:4px}.a-keep{background:#e7efe7;color:#2f7d4f}.a-revise{background:#fdf0dd;color:#9a6a12}.a-replace{background:#fbe4e4;color:#a33}.a-add{background:#e4ecf7;color:#2a5aa0}.a-remove{background:#eee;color:#777}
.kind{font-size:10px;border-radius:3px;padding:0 4px;margin-right:4px}.k-image{background:#e4ecf7;color:#2a5aa0}.k-context{background:#f0ece6;color:#7a6f5e}
.disp{font-size:10px;color:#9a6a12}.reused{color:#2f7d4f;font-weight:600}
.box{border-radius:6px;padding:8px 10px;margin:8px 0;font-size:13px}.corr{background:#fdf6e8;border:1px solid #e6cf96}.conf{background:#fdeaea;border:1px solid #e2a5a5}.unc{background:#f2f0ff;border:1px solid #c9c3e8}
.ov{}.imgwrap{position:relative;display:inline-block;max-width:100%}.imgwrap img{max-width:100%;border:1px solid #ddd;border-radius:6px;display:block}
.pin{position:absolute;transform:translate(-50%,-50%);width:20px;height:20px;border-radius:50%;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 2px #fff}
.pin.old{background:#8a8a8a;opacity:.85}.pin.proposed{background:#c9822b}.ovlabel{font-size:11px;color:#6b665e;margin-bottom:3px}.noimg{color:#b23b3b;font-size:12px}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%;vertical-align:middle}.dot.old{background:#8a8a8a}.dot.proposed{background:#c9822b}.imgwrap{max-width:520px}
.bad{color:#b23b3b;font-weight:700;font-size:12px}
button.f{margin:2px 4px 2px 0;padding:3px 9px;border:1px solid #cfc7ba;background:#fff;border-radius:14px;cursor:pointer;font-size:12px}button.f.on{background:#1c1a17;color:#fff;border-color:#1c1a17}
.first10{background:#fff8ee;border:1px solid #e6cf96;border-radius:8px;padding:10px 14px;margin:10px 0}.first10 a{color:#8a5a12}
</style>
<header>
<h1>Pass B — B4-v2 editorial review (${completed.length} completed · ${quarantined.length} quarantined) · run ${esc(RUN.split('/').pop())}</h1>
<div>Filter:
 <button class="f on" data-f="all">all</button>
 <button class="f" data-f="strongLegacy">strongLegacy</button>
 <button class="f" data-f="thin">thin/missing</button>
 <button class="f" data-f="new">new entry</button>
 <button class="f" data-f="overwrite">overwrite</button>
 <button class="f" data-f="conflicts">conflicts/corrections</button>
 <button class="f" data-f="zero-legacy-kept">zero legacy kept</button>
 <button class="f" data-f="needs-attention">needs attention</button>
 <button class="f" data-f="longest">longest answers</button>
</div></header>
<main>
<div class="first10"><b>Recommended first-review set (10)</b> — 5 strongLegacy + 5 thin/missing, harvard303416 included, diverse culture/medium/fame/change:<br>${first10.map((id) => `<a href="#${esc(id)}">${esc(id)}</a>`).join(' · ')}</div>
<h2>Completed (${completed.length})</h2>
${completed.map((w) => `<a name="${esc(w.id)}"></a>${workCard(w)}`).join('\n')}
<h2 style="border-top:3px solid #b23b3b;padding-top:14px;margin-top:26px">Quarantined attempts (${quarantined.length}) — not repaired, not rerun</h2>
${quarantined.map(quarCard).join('\n')}
</main>
<script>
const works=[...document.querySelectorAll('.work:not(.quar)')];
document.querySelectorAll('button.f').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('button.f').forEach(x=>x.classList.remove('on'));b.classList.add('on');
  const f=b.dataset.f;let vis=works.slice();
  if(f==='longest'){vis.sort((a,c)=>c.dataset.maxans-a.dataset.maxans);const main=works[0]?.parentNode;vis.forEach(w=>main.insertBefore(w,document.querySelector('h2+*')?null:null));}
  works.forEach(w=>{let show=true;
    if(f==='strongLegacy')show=w.dataset.cohort==='strongLegacy';
    else if(f==='thin')show=w.dataset.cohort!=='strongLegacy';
    else if(f==='new')show=w.dataset.entry==='new';
    else if(f==='overwrite')show=w.dataset.entry==='overwrite';
    else if(f==='conflicts')show=/conflicts|corrections/.test(w.dataset.flags);
    else if(f==='zero-legacy-kept')show=/zero-legacy-kept/.test(w.dataset.flags);
    else if(f==='needs-attention')show=/needs-attention/.test(w.dataset.flags);
    else if(f==='longest')show=Number(w.dataset.maxans)>=550;
    w.style.display=show?'':'none';});
});
</script>`;

const out = join(RUN, 'editorial-review-packet.html');
writeFileSync(out, html);
console.log(`wrote ${out}`);
console.log(`completed ${completed.length} | quarantined ${quarantined.length}`);
console.log('first-10:', first10.join(', '));
