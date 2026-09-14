// Owner review packet for the Pass B calibration: one static HTML + one JSON companion.
// It presents legacy and proposed hotspots/study guides side by side, followed by the complete B1-B4
// evidence trail. It is a quarantined comparison only: nothing is applied and it performs no network work.
import { sha256 } from './vision-legacy.mjs';
import { PLAYER_WHY_MAX } from './vision-content-schema.mjs';

// A B4 record whose proposed why exceeds the player-copy cap CANNOT ship as-is: it requires a MANDATORY
// human why-edit in the approved output (the preserved B4 completion is never altered). VSD-023.
export function mandatoryWhyEdit(row) {
  const why = row?.b4?.proposedWhy;
  return typeof why === 'string' && why.length > PLAYER_WHY_MAX;
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const HEX = /^[0-9a-f]{64}$/; const EXT = /^[a-z0-9]{1,5}$/;
// Confined relative image href: <base>/<sha>.<ext>, validated; empty string if not a real local derivative.
function imageHref(row, base) {
  if (!row.image?.ok || !HEX.test(row.image.imgSha256 || '') || !EXT.test(row.image.ext || '') || !base) return '';
  return `${base}/${row.image.imgSha256}.${row.image.ext}`;
}

const done = (list, s) => list.filter(r => r.stageStatus?.[s] === 'complete').length;
const sum = (arr, f) => arr.reduce((n, x) => n + f(x), 0);

// A row needs owner attention when any stage failed/errored, OR B4 raised a humanReview conflict, OR B4
// proposes a consequential correction awaiting approval. Single source of truth for the flag + the filter.
export function rowNeedsAttention(row) {
  const stageFailed = ['B1', 'B2', 'B3', 'B4'].some(s => /^(failed|error)/.test(String(row?.stageStatus?.[s] || '')));
  const b4 = row?.b4;
  const humanReview = Array.isArray(b4?.conflicts) && b4.conflicts.some(c => c?.status === 'humanReview');
  const consequential = Array.isArray(b4?.corrections?.consequential) && b4.corrections.consequential.length > 0;
  return stageFailed || humanReview || consequential || mandatoryWhyEdit(row);
}

function cohortSummary(rows) {
  const stat = list => ({
    works: list.length,
    b1Complete: done(list, 'B1'),
    b2Complete: done(list, 'B2'),
    b2Requested: list.filter(r => r.stageStatus?.B2 && r.stageStatus.B2 !== 'not-requested' && r.stageStatus.B2 !== 'skipped').length,
    b3Complete: done(list, 'B3'),
    b3Requested: list.filter(r => r.stageStatus?.B3 && !['not-requested', 'skipped'].includes(r.stageStatus.B3)).length,
    b4Complete: done(list, 'B4'),
    needsAttention: list.filter(rowNeedsAttention).length,
    dispositions: (() => { const d = {}; for (const r of list) for (const x of (r.b4?.dispositions || [])) d[x.disposition] = (d[x.disposition] || 0) + 1; return ['keep', 'revise', 'replace', 'add', 'remove'].map(k => `${k[0]}${d[k] || 0}`).join(' '); })(),
    corrections: sum(list, r => (r.b4?.corrections?.consequential || []).length),
    conflicts: sum(list, r => (r.b4?.conflicts || []).length),
    imageProblems: list.filter(r => !r.image?.ok).length + list.filter(r => r.b1?.imageFitness && !r.b1.imageFitness.ok).length,
    blocked: list.filter(r => r.b1?.imageFitness?.imageState === 'blocked').length,
    notPlayable: list.filter(r => r.b1 && r.b1.playable === false).length,
    guideBefore: sum(list, r => r.legacy?.counts?.guide || 0),
    b2GuideAnswers: sum(list, r => (r.b2?.guideAnswers || []).length),
    notesBefore: sum(list, r => r.legacy?.counts?.notes || 0),
    b1NoteCandidates: sum(list, r => (r.b1?.noteCandidates || []).length),
    b1ResearchQuestions: sum(list, r => (r.b1?.researchQuestions || []).length),
    b2FactChecks: sum(list, r => (r.b2?.factChecks || []).length),
    b2Sources: sum(list, r => { const s = new Set(); for (const f of (r.b2?.factChecks || [])) for (const src of (f.sources || [])) s.add(src.url); return s.size; }),
    failures: list.filter(r => ['B1', 'B2'].some(s => r.stageStatus?.[s] && !['complete', 'planned', 'not-requested', 'skipped', 'skipped:no-image', 'requested'].includes(r.stageStatus[s]))).length,
  });
  return { strongLegacy: stat(rows.filter(r => r.cohort === 'strongLegacy')), thinLegacy: stat(rows.filter(r => r.cohort === 'thinLegacy')) };
}

// Comparison template: records owner decisions per existing component versus the quarantined proposals.
// It applies nothing; the owner decides whether the proposed material is better.
function reviewTemplate(rows) {
  return {
    version: 'passBCalibrationReview/2', note: 'Comparison only. Nothing applied. Records the owner\'s review of legacy content against the B4 synthesis, with the B1-B3 evidence trail available for inspection.',
    works: rows.map(r => ({
      id: r.id, cohort: r.cohort,
      existing: { why: r.legacy?.teaching?.why ?? null, notes: r.legacy?.counts?.notes || 0, guide: r.legacy?.counts?.guide || 0, hotspots: r.legacy?.counts?.hotspots || 0 },
      b1: { imageState: r.b1?.imageFitness?.imageState ?? null, playable: r.b1?.playable ?? null, noteCandidates: (r.b1?.noteCandidates || []).length, researchQuestions: (r.b1?.researchQuestions || []).length },
      b2: { requested: r.stageStatus?.B2 !== 'not-requested', factChecks: (r.b2?.factChecks || []).length, guideAnswers: (r.b2?.guideAnswers || []).length },
      ownerVerdict: null, ownerNote: '',
    })),
  };
}

const ul = (arr, f) => (arr && arr.length) ? `<ul>${arr.map(f).join('')}</ul>` : '<p class="muted">none</p>';

const percent = n => Number.isFinite(n) && n >= 0 && n <= 100;

function legacyHotspots(row) {
  const notes = row.legacy?.teaching?.notes || [];
  const stored = row.legacy?.hotspots || [];
  if (stored.length) return stored.filter(h => percent(h.x) && percent(h.y)).map((h, i) => {
    const note = notes[Number.isInteger(h.n) ? h.n - 1 : i] || {};
    return { label: i + 1, x: h.x, y: h.y, title: note.head || `Legacy hotspot ${i + 1}`, text: note.body || '' };
  });
  return notes.filter(n => percent(n.x) && percent(n.y)).map((n, i) => ({ label: i + 1, x: n.x, y: n.y, title: n.head || `Legacy hotspot ${i + 1}`, text: n.body || '' }));
}

function proposedHotspots(row) {
  return (row.b4?.hotspots || []).map((h, i) => ({
    label: Number.isInteger(h.rank) ? h.rank : i + 1,
    x: h.x, y: h.y, region: h.region,
    title: h.conciseText || `Proposed hotspot ${i + 1}`,
    text: h.deepText || '',
  }));
}

function hotspotOverlay(items, cls) {
  return items.map(p => {
    if (percent(p.x) && percent(p.y)) return `<span class="pin ${cls}" style="left:${p.x}%;top:${p.y}%" title="${esc(p.title)}">${esc(p.label)}</span>`;
    const r = p.region;
    if (r && [r.x, r.y, r.w, r.h].every(percent)) return `<span class="hotspot-region ${cls}" style="left:${r.x}%;top:${r.y}%;width:${r.w}%;height:${r.h}%" title="${esc(p.title)}"><b>${esc(p.label)}</b></span>`;
    return '';
  }).join('');
}

function hotspotList(items) {
  return items.length ? `<ol class="hotspot-list">${items.map(p => `<li value="${esc(p.label)}"><b>${esc(p.title)}</b>${p.text ? `<span>${esc(p.text)}</span>` : ''}</li>`).join('')}</ol>` : '<p class="empty">No hotspots available.</p>';
}

function guideList(items) {
  return items?.length ? `<ol class="guide-list">${items.map(q => `<li><b>${esc(q.q)}</b><p>${esc(q.a)}</p></li>`).join('')}</ol>` : '<p class="empty">No study guide available.</p>';
}

function beforeAfter(row, href) {
  const beforePins = legacyHotspots(row);
  const afterPins = proposedHotspots(row);
  const image = (label, pins, cls) => href
    ? `<div class="compare-image"><img src="${esc(href)}" alt="${esc(row.legacyTitle || row.id)} — ${esc(label)} hotspots" loading="lazy">${hotspotOverlay(pins, cls)}</div>`
    : '<div class="compare-image empty">Image unavailable.</div>';
  return `<section class="before-after" aria-label="Before and after comparison">
    <div class="section-heading"><div><h4>Before → after</h4><p>Legacy content beside the quarantined B4 proposal. Nothing here has been applied.</p></div></div>
    <h5 class="compare-title">Hotspots</h5>
    <div class="compare-grid hotspot-compare">
      <figure class="compare-panel"><figcaption><span class="status-dot before"></span><b>Before</b> · ${beforePins.length} legacy hotspots</figcaption>${image('legacy', beforePins, 'old before')}${hotspotList(beforePins)}</figure>
      <figure class="compare-panel"><figcaption><span class="status-dot after"></span><b>After</b> · ${afterPins.length} proposed hotspots</figcaption>${image('proposed', afterPins, 'new after')}${afterPins.length ? hotspotList(afterPins) : '<p class="empty">No synthesized hotspot proposal yet.</p>'}</figure>
    </div>
    <h5 class="compare-title">Study guide</h5>
    <div class="compare-grid guide-compare">
      <section class="compare-panel"><h6>Before · ${(row.legacy?.teaching?.guide || []).length} questions</h6>${guideList(row.legacy?.teaching?.guide || [])}</section>
      <section class="compare-panel"><h6>After · ${(row.b4?.guide || []).length} proposed questions</h6>${row.b4?.guide?.length ? guideList(row.b4.guide) : '<p class="empty">No synthesized study-guide proposal yet.</p>'}</section>
    </div>
  </section>`;
}

function b2SourceList(r) {
  const seen = new Map();
  for (const f of (r.b2?.factChecks || [])) for (const s of (f.sources || [])) if (s?.url && !seen.has(s.url)) seen.set(s.url, s.title || s.url);
  return [...seen.entries()];
}

function workCard(r, base) {
  const href = imageHref(r, base);
  const imageMeta = href
    ? `<p class="muted image-meta"><code>${esc(r.image.imgSha256.slice(0, 12))}…</code> ${esc(r.image.width)}×${esc(r.image.height)}</p>`
    : `<div class="warn">image ${r.image?.ok ? '(no local derivative to embed)' : 'FAILED (B0 skipped): ' + esc(r.image?.reason || 'unknown')}</div>`;
  const fitness = r.b1?.imageFitness
    ? `image: <b>${esc(r.b1.imageFitness.imageState)}</b> · ok=${r.b1.imageFitness.ok} · quality=${esc(r.b1.imageFitness.quality)} · framing=${esc(r.b1.imageFitness.framing)} · playable=${r.b1.playable}`
    : '<span class="muted">no B1 (dry-run)</span>';
  // Existing (legacy) content.
  const oldWhy = r.legacy?.teaching?.why;
  const oldCues = ul(r.legacy?.teaching?.cues, c => `<li>${esc(c)}</li>`);
  const oldNotes = ul(r.legacy?.teaching?.notes, n => `<li><b>${esc(n.head)}</b> — ${esc(n.body)}</li>`);
  const oldGuide = ul(r.legacy?.teaching?.guide, q => `<li><b>Q:</b> ${esc(q.q)}<br><b>A:</b> ${esc(q.a)}</li>`);
  // B1 image-first proposal.
  const b1Seen = r.b1?.seen ? `<p>${esc(r.b1.seen)}</p>` : '<p class="muted">—</p>';
  const b1Notes = ul(r.b1?.noteCandidates, (n, i) => `<li>#${i + 1} <b>${esc(n.head)}</b> — ${esc(n.body)} <span class="tag">${esc(n.role)}</span></li>`);
  const b1Questions = ul(r.b1?.researchQuestions, q => `<li>${esc(q.topic || q.question || JSON.stringify(q))}</li>`);
  const b1Tags = r.b1?.tags ? `${(r.b1.tags.controlled || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')}${(r.b1.tags.free || []).map(t => `<span class="tag free">${esc(t)}</span>`).join('')}` : '';
  // B2 no-image research.
  const b2Facts = ul(r.b2?.factChecks, f => `<li><span class="disp disp-${f.verdict === 'supported' ? 'keep' : f.verdict === 'refuted' ? 'replace' : 'revise'}">${esc(f.verdict)}</span> ${esc(f.claim)} <span class="muted">(${(f.sources || []).length} src)</span></li>`);
  const b2Guide = ul(r.b2?.guideAnswers, q => `<li><b>Q:</b> ${esc(q.q)}<br><b>A:</b> ${esc(q.a)} <span class="tag">${esc(q.kind)}</span></li>`);
  const b2Sources = ul(b2SourceList(r), ([url, title]) => `<li><a href="${esc(url)}" target="_blank" rel="noopener">${esc(title)}</a></li>`);
  // B4 synthesis proposal (present only when B4 ran).
  const b4 = r.b4;
  const b4Block = b4 ? `
  <h4>B4 — synthesis proposal (keep / revise / replace)</h4>
  <div class="cols">
    <section><h5>Component dispositions</h5>${ul(b4.dispositions, d => `<li><span class="disp disp-${esc(d.disposition)}">${esc(d.disposition)}</span> <b>${esc(d.component)}</b> — ${esc(d.reason)}</li>`)}<h5>Proposed why</h5><p>${esc(b4.proposedWhy) || '<span class="muted">—</span>'}</p><h5>Proposed cues</h5>${ul(b4.proposedCues, c => `<li>${esc(c)}</li>`)}</section>
    <section><h5>Proposed notes (${(b4.notes || []).length})</h5>${ul(b4.notes, n => `<li><b>${esc(n.head)}</b> — ${esc(n.body)}</li>`)}<h5>Proposed guide (${(b4.guide || []).length})</h5>${ul(b4.guide, q => `<li><b>Q:</b> ${esc(q.q)}<br><b>A:</b> ${esc(q.a)}</li>`)}<h5>Corrections (owner review)</h5>${ul(b4.corrections?.consequential, c => `<li><b>${esc(c.field)}</b>: ${esc(JSON.stringify(c.from))} → ${esc(JSON.stringify(c.to))}</li>`)}<h5>Conflicts</h5>${ul(b4.conflicts, c => `<li><b>${esc(c.field)}</b>: ${esc(c.status)}${c.status === 'humanReview' ? ' <span class="warn">owner</span>' : ''}</li>`)}</section>
  </div>` : '';
  const failures = ['B1', 'B2', 'B3', 'B4'].filter(s => r.stageStatus?.[s] && !['complete', 'planned', 'not-requested', 'skipped', 'skipped:no-image', 'requested'].includes(r.stageStatus[s])).map(s => `${s}:${r.stageStatus[s]}`);
  const attn = rowNeedsAttention(r);
  return `<article class="work ${esc(r.cohort)}" data-cohort="${esc(r.cohort)}" data-attn="${attn ? '1' : '0'}">
  <header><h3>${esc(r.legacyTitle || r.id)}${attn ? ' <span class="attn">NEEDS ATTENTION</span>' : ''}</h3><div class="meta">${esc(r.cohort)} · ${esc(r.fameBand)} · ${esc(r.regionGroup)} · guide:${esc(r.guideStatus)} · B2:${esc(r.stageStatus?.B2 || '—')}</div></header>
  ${imageMeta}<p class="fitness">${fitness}${failures.length ? ` · <span class="warn">${esc(failures.join(' '))}</span>` : ''}</p>
  ${beforeAfter(r, href)}
  <details class="audit-details"><summary>Full pipeline evidence</summary>
  <div class="cols">
    <section><h4>Existing content</h4><h5>Why</h5><p>${esc(oldWhy) || '<span class="muted">none</span>'}</p><h5>Cues (${r.legacy?.counts?.cues || 0})</h5>${oldCues}<h5>Notes (${r.legacy?.counts?.notes || 0})</h5>${oldNotes}<h5>Guide (${r.legacy?.counts?.guide || 0})</h5>${oldGuide}</section>
    <section><h4>B1 — image-first proposal</h4><h5>What B1 sees</h5>${b1Seen}<h5>Candidate notes / hotspots (${(r.b1?.noteCandidates || []).length})</h5>${b1Notes}<h5>Research questions (${(r.b1?.researchQuestions || []).length})</h5>${b1Questions}<h5>Tags</h5><p>${b1Tags || '<span class="muted">none</span>'}</p></section>
  </div>
  <h4>B2 — no-image research (sourced)</h4>
  <div class="cols">
    <section><h5>Fact checks (${(r.b2?.factChecks || []).length})</h5>${b2Facts}<h5>Sources</h5>${b2Sources}</section>
    <section><h5>Proposed contextual guide (${(r.b2?.guideAnswers || []).length})</h5>${b2Guide}<h5>Uncertainty</h5><p class="muted">${esc(r.b2?.uncertainty || r.b1?.uncertainty || '')}</p></section>
  </div>
  ${b4Block}
  </details>
  </article>`;
}

export function renderReviewPacket(rows, meta = {}) {
  const summary = cohortSummary(rows);
  const template = reviewTemplate(rows);
  const base = typeof meta.imageBase === 'string' && /^[.\w/-]+$/.test(meta.imageBase) ? meta.imageBase : null; // confined relative prefix only
  const sumCell = (a, b) => `<td>${a}</td><td>${b}</td>`;
  const S = summary.strongLegacy, T = summary.thinLegacy;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pass B Calibration Review</title><style>
:root{--bg:#faf9f7;--fg:#1c1a17;--muted:#8a827a;--line:#e6e1da;--accent:#7a5a2f;--warn:#a3341f;--card:#fff}
body{font:15px/1.55 -apple-system,system-ui,Segoe UI,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
header.top{padding:18px 22px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bg);z-index:5}
h1{font-size:19px;margin:0 0 4px}.controls{margin-top:8px}button{font:inherit;padding:5px 12px;border:1px solid var(--line);background:var(--card);border-radius:6px;cursor:pointer}
button.on{background:var(--accent);color:#fff;border-color:var(--accent)}
main{padding:18px 22px;max-width:1240px;margin:0 auto}table{border-collapse:collapse;margin:8px 0 20px;font-size:13px}th,td{border:1px solid var(--line);padding:5px 9px;text-align:right}th:first-child,td:first-child{text-align:left}
.work{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:14px 0}
.work h3{margin:0;font-size:16px}.meta{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.03em}
.compare-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}.compare-panel{margin:0;padding:12px;border:1px solid var(--line);border-radius:8px;min-width:0}.compare-panel figcaption,.compare-panel h6{font:inherit;margin:0 0 10px}.compare-image{position:relative;width:100%;background:var(--bg);border:1px solid var(--line);border-radius:6px;overflow:hidden}.compare-image img{width:100%;height:auto;display:block}.compare-image.empty{display:grid;place-items:center;min-height:180px;color:var(--muted)}
.section-heading{display:flex;align-items:start;justify-content:space-between;gap:12px;margin-top:14px}.section-heading h4{margin:0}.section-heading p{margin:2px 0 0;color:var(--muted);font-size:13px}.compare-title{margin-top:14px}.status-dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px}.status-dot.before{background:#777}.status-dot.after{background:var(--warn)}
.pin{position:absolute;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;font-size:9px;line-height:14px;text-align:center;color:#fff;box-shadow:0 0 0 1px #fff}
.pin.old{background:rgba(120,120,120,.85)}.pin.new{background:var(--warn)}.pin.inline{position:static;display:inline-block;margin:0 2px;vertical-align:middle}
.hotspot-region{position:absolute;border:2px solid currentColor;background:transparent;color:#777}.hotspot-region.after{color:var(--warn)}.hotspot-region b{position:absolute;top:-1px;left:-1px;background:currentColor;color:#fff;font-size:10px;line-height:16px;min-width:16px;text-align:center}.hotspot-list,.guide-list{padding-left:22px;margin-top:10px}.hotspot-list li,.guide-list li{margin:9px 0}.hotspot-list span{display:block;color:var(--muted);font-size:13px}.guide-list p{margin:2px 0;color:#4a453e}.empty{color:var(--muted);font-size:13px}.image-meta{margin:7px 0}.audit-details{margin-top:16px;border-top:1px solid var(--line);padding-top:12px}.audit-details summary{cursor:pointer;color:var(--accent);font-weight:600}.audit-details[open] summary{margin-bottom:10px}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:8px 0}.cols section{min-width:0}
h4{margin:10px 0 4px;font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:var(--accent)}h5{margin:10px 0 3px;font-size:12px;color:var(--muted)}
ul{margin:2px 0;padding-left:18px}li{margin:3px 0}.muted{color:var(--muted)}.warn{color:var(--warn);font-weight:600}
.tag{display:inline-block;background:#efeae2;border-radius:4px;padding:0 6px;font-size:11px;margin:1px}.tag.free{background:#e3ecef}
.disp{display:inline-block;border-radius:4px;padding:0 6px;font-size:11px;font-weight:600;color:#fff}
.disp-keep{background:#3f7a3f}.disp-revise{background:#7a5a2f}.disp-replace{background:#a3341f}.disp-add{background:#2f5a7a}.disp-remove{background:#6a6a6a}
.fitness{font-size:13px;color:#4a453e}a{color:var(--accent)}code{background:#efeae2;padding:1px 5px;border-radius:4px}
.attn{display:inline-block;background:var(--warn);color:#fff;border-radius:4px;padding:0 6px;font-size:10px;font-weight:700;vertical-align:middle;letter-spacing:.04em}
@media(max-width:760px){.compare-grid,.cols{grid-template-columns:1fr}header.top,main{padding-left:14px;padding-right:14px}.work{padding:12px}}
@media(prefers-color-scheme:dark){:root{--bg:#1a1815;--fg:#ece7e0;--muted:#9a928a;--line:#332f2a;--accent:#d0a86a;--warn:#e0785f;--card:#232019}.tag{background:#332f2a}.tag.free{background:#243033}code{background:#332f2a}.guide-list p{color:#d8d1c8}}
</style></head><body>
<header class="top"><h1>Pass B Calibration Review — ${esc(rows.length)} works</h1>
<div class="meta">${esc(meta.runId || '')} · ${esc(meta.mode || 'dry-run')} · generated ${esc(meta.generatedAt || '')} · quarantined proposals · nothing applied</div>
<div class="controls"><button class="filt on" data-f="all">All (${rows.length})</button> <button class="filt" data-f="strongLegacy">Strong (${rows.filter(r => r.cohort === 'strongLegacy').length})</button> <button class="filt" data-f="thinLegacy">Thin (${rows.filter(r => r.cohort === 'thinLegacy').length})</button> <button class="filt" data-f="attn">Needs attention (${rows.filter(rowNeedsAttention).length})</button></div></header>
<main>
<h4>Cohort summary</h4>
<table><tr><th>Metric</th><th>strongLegacy</th><th>thinLegacy</th></tr>
<tr><td>works</td>${sumCell(S.works, T.works)}</tr>
<tr><td>B1 complete</td>${sumCell(S.b1Complete, T.b1Complete)}</tr>
<tr><td>B2 requested / complete</td>${sumCell(`${S.b2Requested}/${S.b2Complete}`, `${T.b2Requested}/${T.b2Complete}`)}</tr>
<tr><td>B3 targeted / complete</td>${sumCell(`${S.b3Requested}/${S.b3Complete}`, `${T.b3Requested}/${T.b3Complete}`)}</tr>
<tr><td>B4 synthesis complete</td>${sumCell(S.b4Complete, T.b4Complete)}</tr>
<tr><td><b>needs attention (humanReview / correction / failure)</b></td>${sumCell(`<b>${S.needsAttention}</b>`, `<b>${T.needsAttention}</b>`)}</tr>
<tr><td>dispositions (k/r/rp/a/rm)</td>${sumCell(S.dispositions, T.dispositions)}</tr>
<tr><td>corrections · conflicts (owner)</td>${sumCell(`${S.corrections} · ${S.conflicts}`, `${T.corrections} · ${T.conflicts}`)}</tr>
<tr><td>image problems · blocked · not-playable</td>${sumCell(`${S.imageProblems} · ${S.blocked} · ${S.notPlayable}`, `${T.imageProblems} · ${T.blocked} · ${T.notPlayable}`)}</tr>
<tr><td>notes: legacy → B1 candidates</td>${sumCell(`${S.notesBefore}→${S.b1NoteCandidates}`, `${T.notesBefore}→${T.b1NoteCandidates}`)}</tr>
<tr><td>guide: legacy → B2 answers</td>${sumCell(`${S.guideBefore}→${S.b2GuideAnswers}`, `${T.guideBefore}→${T.b2GuideAnswers}`)}</tr>
<tr><td>B1 research questions</td>${sumCell(S.b1ResearchQuestions, T.b1ResearchQuestions)}</tr>
<tr><td>B2 fact-checks · unique sources</td>${sumCell(`${S.b2FactChecks} · ${S.b2Sources}`, `${T.b2FactChecks} · ${T.b2Sources}`)}</tr>
<tr><td>stage failures</td>${sumCell(S.failures, T.failures)}</tr></table>
<p class="muted">Nothing here is applied. Review the before/after hotspots and study guide first; expand the full pipeline evidence only when you want the underlying visual observations, research, corrections, and conflicts.</p>
${rows.map(r => workCard(r, base)).join('\n')}
</main>
<script>
const btns=[...document.querySelectorAll('.filt')];btns.forEach((b,i)=>b.setAttribute('aria-pressed',i===0?'true':'false'));btns.forEach(b=>b.onclick=()=>{btns.forEach(x=>{x.classList.remove('on');x.setAttribute('aria-pressed','false')});b.classList.add('on');b.setAttribute('aria-pressed','true');const f=b.dataset.f;document.querySelectorAll('.work').forEach(w=>{w.style.display=(f==='all'||w.dataset.cohort===f||(f==='attn'&&w.dataset.attn==='1'))?'':'none'});});
</script></body></html>`;
  const json = { version: 'passBCalibrationPacket/2', runId: meta.runId || null, generatedAt: meta.generatedAt || null, mode: meta.mode || 'dry-run', summary, rows, reviewTemplate: template, packetSha256: '' };
  json.packetSha256 = sha256(JSON.stringify(json));
  return { html, json };
}
