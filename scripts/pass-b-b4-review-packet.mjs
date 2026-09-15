// Offline editorial-review packet for a B4-v2 continuation run (VSD-026/028). EVIDENCE READ-ONLY: no model
// calls, evidence edits, approvals, or merges. Renders one self-contained, browser-viewable HTML covering all completed records + a
// quarantined section, with old-vs-proposed content, hotspot overlays, per-guide action/kind/grounding,
// conflicts/corrections/uncertainty, char counts, cohort, client-side filters, review notes/decisions,
// click-to-place hotspot corrections, JSON export, and a nominated first-10 set.
// Usage: node scripts/pass-b-b4-review-packet.mjs [<b4c-run-dir>]
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { projectToProduction } from './lib/pass-b-approval.mjs';
import { b4Lineage, guideLineageMetrics } from './lib/pass-b-b4-delta.mjs';
import { EDITORIAL_REVIEW_VERSION, hotspotReviewRows } from './lib/pass-b-editorial-review.mjs';

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
  // The assembler drops `remove` actions. Join final items to the SURVIVING lineage, never by the raw
  // delta array index (which shifts every badge after the first removal).
  const lineage = rec.hydration?.lineage || b4Lineage(rd);
  const guideLineage = (lineage.guide || []).filter(x => x.survives);
  const noteLineage = (lineage.notes || []).filter(x => x.survives);
  if (guideLineage.length !== (body.guide || []).length) throw new Error(`${id}: guide lineage/body length mismatch`);
  if (noteLineage.length !== (body.notes || []).length) throw new Error(`${id}: note lineage/body length mismatch`);
  const guide = (body.guide || []).map((g, i) => ({ ...g, action: guideLineage[i]?.action || '?', ref: guideLineage[i]?.ref || null, legacyDerived: !!guideLineage[i]?.legacyDerived, deltaIndex: guideLineage[i]?.deltaIndex ?? null }));
  const notes = (body.notes || []).map((n, i) => ({ ...n, action: noteLineage[i]?.action || '?', ref: noteLineage[i]?.ref || null, legacyDerived: !!noteLineage[i]?.legacyDerived, deltaIndex: noteLineage[i]?.deltaIndex ?? null }));
  const guideMetrics = guideLineageMetrics(rd, (legacy.guide || []).length);
  const overwriteStrong = (m.cohort === 'strongLegacy') && [...(lineage.guide || []), ...(lineage.notes || [])].some((x) => x.legacyDerived && ['revise', 'replace', 'remove'].includes(x.action));
  const cons = body.corrections?.consequential || [];
  const conflicts = (body.conflicts || []).filter((c) => c.status === 'humanReview');
  const srcDep = (body.hotspots || []).filter((h) => h.sourceDependent).length + guide.filter((g) => (g.sourceRefs || []).length).length + notes.filter((n) => (n.sourceRefs || []).length).length;
  const maxAns = Math.max(0, ...guide.map((g) => (g.a || '').length));
  const entryType = teach[id] ? 'overwrite' : 'new';
  const needsAttention = conflicts.length > 0 || cons.length > 0 || overwriteStrong || (guideMetrics.legacyTotal > 0 && guideMetrics.legacyDerived === 0) || maxAns >= 660 || (rec.hydration?.hotspots?.suppressed || []).length > 0;
  const changeScore = [...guide, ...notes].filter((x) => x.action !== 'keep').length;
  const hotspotReview = hotspotReviewRows({ delta: rd, body, hydration: rec.hydration });
  return { id, meta: m, catalog: b0.trustedCatalog, image: b0.image, legacy, oldHot, body, guide, notes, proj, guideMetrics, lineage, hotspotQuality: rec.hydration?.hotspots || null, hotspotReview, overwriteStrong, cons, conflicts, uncertainty: body.uncertainty || '', srcDep, maxAns, entryType, needsAttention, changeScore, evidence: rec.evidence, reused: !!rec.reused };
}

const files = readdirSync(join(RUN, 'works')).filter((f) => f.endsWith('.b4.json'));
const all = files.map((f) => JSON.parse(readFileSync(join(RUN, 'works', f), 'utf8')));
const completed = all.filter((r) => r.ok).map((r) => collect(r.id));
const quarantined = all.filter((r) => !r.ok);
const lineageSummary = completed.reduce((s, w) => {
  if (w.guideMetrics.legacyTotal) s.legacyWorks++;
  if (w.guideMetrics.legacyTotal && !w.guideMetrics.legacyDerived) s.zeroLegacyDerived++;
  for (const k of ['legacyTotal', 'verbatim', 'reworked', 'removed', 'removedExplicit', 'removedImplicit', 'added', 'invalidLegacyRefs']) s[k] += w.guideMetrics[k];
  return s;
}, { legacyWorks: 0, zeroLegacyDerived: 0, legacyTotal: 0, verbatim: 0, reworked: 0, removed: 0, removedExplicit: 0, removedImplicit: 0, added: 0, invalidLegacyRefs: 0 });
const hotspotSummary = completed.reduce((s, w) => {
  s.proposed += w.hotspotQuality?.proposed || (w.body.hotspots || []).length;
  s.published += (w.body.hotspots || []).length;
  s.suppressed += w.hotspotQuality?.suppressed?.length || 0;
  return s;
}, { proposed: 0, published: 0, suppressed: 0 });
const packetRunManifest = existsSync(join(RUN, 'run-manifest.json')) ? JSON.parse(readFileSync(join(RUN, 'run-manifest.json'), 'utf8')) : {};
const packetRunId = RUN.split('/').pop();
const reviewMetadata = {
  version: EDITORIAL_REVIEW_VERSION,
  runId: packetRunId,
  evidenceManifestSha256: packetRunManifest.evidenceManifestSha256 || null,
  sourceRun: packetRunManifest.sourceRun || null,
  works: [
    ...completed.map(w => ({ workId: w.id, title: w.catalog.title || w.id, kind: 'completed', imageSha256: w.image?.imgSha256 || null, hotspots: w.hotspotReview })),
    ...quarantined.map(w => ({ workId: w.id, title: w.id, kind: 'quarantined', imageSha256: null, hotspots: [] })),
  ],
};
const reviewMetadataJson = JSON.stringify(reviewMetadata).replaceAll('<', '\\u003c');

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
  const point = p => Number.isFinite(p?.x) && Number.isFinite(p?.y);
  const oldM = w.oldHot.filter(point).map((p) => `<span class="pin old" style="left:${p.x}%;top:${p.y}%">${p.n}</span>`).join('');
  const newM = w.hotspotReview.map((h) => `<button type="button" class="pin proposed review-pin${h.state === 'suppressed' ? ' is-hidden' : ''}" data-hotspot-key="${esc(h.key)}" aria-label="${esc(`${h.label}: ${h.title}. Select to move`)}"${point(h) ? ` style="left:${h.x}%;top:${h.y}%"` : ''}>${esc(h.label)}</button>`).join('');
  const regions = (w.body.hotspots || []).filter(h => h?.region && [h.region.x, h.region.y, h.region.w, h.region.h].every(Number.isFinite)).map(h => `<span class="region proposed" style="left:${h.region.x}%;top:${h.region.y}%;width:${h.region.w}%;height:${h.region.h}%">${h.rank}</span>`).join('');
  const suppressed = w.hotspotQuality?.suppressed?.length || 0;
  return `<div class="ov"><div class="ovlabel"><span class="dot old"></span> OLD (${w.oldHot.length}) &nbsp; <span class="dot proposed"></span> PUBLISHED PROPOSED (${(w.body.hotspots || []).length})${suppressed ? ` &nbsp; <span class="warn">${suppressed} unlocalized/duplicate proposal${suppressed === 1 ? '' : 's'} retained for review</span>` : ''}</div>${src ? `<div class="imgwrap" data-image-wrap><img class="review-image" loading="lazy" src="${src}" alt="${esc(w.catalog.title || w.id)}. Select Move or Place below, then click the desired location on this image.">${oldM}${newM}${regions}</div>` : '<div class="noimg">image unavailable</div>'}</div>`;
}
const cn = (t) => `<span class="cn">${(t || '').length}</span>`;
const actionBadge = (a) => `<span class="act a-${a}">${a}</span>`;
const kindBadge = (k, ref) => `<span class="kind k-${k}">${k}${ref ? '→' + esc(ref) : ''}</span>`;

function guideBlock(w) {
  const oldQ = (w.legacy.guide || []);
  const rows = w.guide.map((g) => {
    const overwrote = g.legacyDerived && ['revise', 'replace'].includes(g.action) && w.meta.cohort === 'strongLegacy';
    return `<div class="qa ${overwrote ? 'overwrote' : ''}"><div class="q">${actionBadge(g.action)} ${kindBadge(g.kind, g.evidenceRef)} ${esc(g.q)} ${cn(g.q)}</div><div class="a">${esc(g.a)} ${cn(g.a)}</div>${overwrote ? '<div class="ow">⚑ overwrites strong legacy question</div>' : ''}</div>`;
  }).join('');
  const m = w.guideMetrics;
  const old = oldQ.length ? `<details class="oldg"><summary>OLD legacy guide (${oldQ.length}) — final lineage: ${m.verbatim} verbatim · ${m.reworked} revised/replaced · ${m.removed} removed (${m.removedExplicit} explicit, ${m.removedImplicit} omitted) · ${m.added} new${m.invalidLegacyRefs ? ` · ${m.invalidLegacyRefs} mismatched legacy refs treated as new` : ''}</summary>${oldQ.map((q) => `<div class="qa old"><div class="q">${esc(q.q)}</div><div class="a">${esc(q.a)}</div></div>`).join('')}</details>` : '<p class="muted">no legacy guide (new entry)</p>';
  return `<h4>Proposed guide (${w.guide.length})</h4>${rows}${old}`;
}
function hotspotReviewBlock(w) {
  const rows = w.hotspotReview.map((h) => {
    const buttons = h.state === 'published'
      ? `<button type="button" data-hotspot-action="keep">Keep here</button><button type="button" data-hotspot-action="move">Move</button><button type="button" data-hotspot-action="drop">Drop</button>`
      : `<button type="button" data-hotspot-action="drop">Leave out</button><button type="button" data-hotspot-action="note">Keep as note</button><button type="button" data-hotspot-action="move">Place on image</button>`;
    return `<div class="hotrow" data-hotspot-key="${esc(h.key)}" data-original-x="${h.x ?? ''}" data-original-y="${h.y ?? ''}">
      <div class="hotlabel ${h.state}">${esc(h.label)}</div>
      <div class="hotcopy"><div><b>${esc(h.title)}</b> <span class="kind k-image">${esc(h.evidenceAxis || 'image')}→${esc(h.evidenceRef)}</span></div><div>${esc(h.description)}</div><div class="hotstatus">${esc(h.statusText)}</div><div class="hotchoice" aria-live="polite"></div></div>
      <div class="hotactions" role="group" aria-label="Review ${esc(h.label)}">${buttons}</div>
    </div>`;
  }).join('');
  return `<section class="hotreview"><h4>Hotspot placement review (${w.hotspotReview.length})</h4><p class="reviewhelp">The P-numbers match orange markers on the image. S-numbers were withheld because their old location was missing, too broad, or duplicative. If an S-point is useful but has no honest single location, choose <b>Keep as note</b>. To localize one, choose <b>Move</b> or <b>Place on image</b>, then click the exact feature.</p>${rows}</section>`;
}
function workReviewBlock({ quarantined = false } = {}) {
  const buttons = quarantined
    ? `<button type="button" data-work-decision="retry">Retry B4</button><button type="button" data-work-decision="manual_edit">Edit manually</button><button type="button" data-work-decision="skip">Skip</button>`
    : `<button type="button" data-work-decision="looks_good">Looks good</button><button type="button" data-work-decision="needs_changes">Needs changes</button><button type="button" data-work-decision="do_not_use">Do not use</button>`;
  return `<section class="reviewbox"><div class="reviewchoice"><b>Your review</b> <span>Saved in this browser only; this is not production approval.</span><div class="decisionbuttons" role="group" aria-label="Work decision">${buttons}</div></div><label class="notelabel">Notes for this work<textarea data-work-note rows="3" placeholder="What should change? What do you want Claude or Codex to know?"></textarea></label><div class="worksave" aria-live="polite"></div></section>`;
}
function workCard(w) {
  const flags = [w.overwriteStrong ? 'overwrite-strong' : '', w.conflicts.length ? 'conflicts' : '', w.cons.length ? 'corrections' : '', (w.guideMetrics.legacyTotal > 0 && w.guideMetrics.legacyDerived === 0) ? 'zero-legacy-derived' : '', (w.hotspotQuality?.suppressed || []).length ? 'hotspot-attention' : '', w.needsAttention ? 'needs-attention' : ''].filter(Boolean);
  const openReasons = [(w.hotspotQuality?.suppressed || []).length ? 'hotspots need placement' : '', (w.guideMetrics.legacyTotal > 0 && w.guideMetrics.legacyDerived === 0) ? 'no legacy question retained' : ''].filter(Boolean);
  const openNow = openReasons.length > 0;
  return `<section class="work" data-cohort="${w.meta.cohort}" data-entry="${w.entryType}" data-flags="${flags.join(' ')}" data-maxans="${w.maxAns}" data-id="${esc(w.id)}" data-review-kind="completed" data-reviewed="false">
  <details class="workdetails${openNow ? ' attention-now' : ''}"${openNow ? ' open' : ''}>
  <summary><span class="summarytitle">${esc(w.catalog.title || w.id)}</span> <span class="wid">${esc(w.id)}</span><span class="summarymeta">${w.meta.cohort} · ${w.meta.fameBand} · ${esc(w.meta.regionGroup)} · ${esc(w.catalog.medium)} · ${w.entryType}</span>${openReasons.map(reason => `<span class="flag review-now">${esc(reason)}</span>`).join('')}${flags.filter(flag => !['hotspot-attention', 'zero-legacy-derived', 'needs-attention'].includes(flag)).map(flag => `<span class="flag">${flag}</span>`).join('')}</summary>
  <div class="worklayout">
  <aside class="visualcolumn">${overlay(w)}</aside>
  <div class="textcolumn">
  ${workReviewBlock()}
  ${hotspotReviewBlock(w)}
  <div class="grid2">
    <div><h4>OLD why</h4><div class="why old">${esc(w.legacy.why) || '<span class=muted>—</span>'}</div>
      <h4>OLD cues</h4><ul>${(w.legacy.cues || []).map((c) => `<li>${esc(c)}</li>`).join('') || '<li class=muted>—</li>'}</ul></div>
    <div><h4>PROPOSED why ${cn(w.body.proposedWhy)} <span class="disp">${(w.body.dispositions.find((d) => d.component === 'why') || {}).disposition || ''}</span></h4><div class="why">${esc(w.body.proposedWhy)}</div>
      <h4>PROPOSED cues <span class="disp">${(w.body.dispositions.find((d) => d.component === 'cues') || {}).disposition || ''}</span></h4><ul>${(w.body.proposedCues || []).map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div>
  </div>
  ${guideBlock(w)}
  <h4>Proposed notes (${w.notes.length})</h4>${w.notes.map((n) => `<div class="note"><b>${actionBadge(n.action)} ${esc(n.head)}</b> ${cn(n.body)} ${n.evidenceRef ? kindBadge('image', n.evidenceRef) : ''}<div>${esc(n.body)}</div></div>`).join('')}
  ${w.hotspotQuality?.suppressed?.length ? `<div class="box pinq"><b>Hotspot proposals retained for attention (${w.hotspotQuality.suppressed.length}):</b>${w.hotspotQuality.suppressed.map(h => `<div>delta[${h.deltaIndex}] · ${esc(h.evidenceRef)} · ${esc(h.reason)}</div>`).join('')}</div>` : ''}
  ${w.cons.length ? `<div class="box corr"><b>Consequential corrections (${w.cons.length}):</b>${w.cons.map((c) => `<div>${esc(c.field)}: ${esc(c.from)} → ${esc(c.to)} (conf ${c.confidence}${(c.sourceRefs || []).length ? ', sourced' : ''})</div>`).join('')}</div>` : ''}
  ${w.conflicts.length ? `<div class="box conf"><b>Conflicts → humanReview (${w.conflicts.length}):</b>${w.conflicts.map((c) => `<div>${esc(c.field)} — left: ${esc(c.left)} | right: ${esc(c.right)}</div>`).join('')}</div>` : ''}
  ${w.uncertainty ? `<div class="box unc"><b>Uncertainty:</b> ${esc(w.uncertainty)}</div>` : ''}
  <div class="muted small">source-dependent claims: ${w.srcDep} · max answer ${w.maxAns} · change score ${w.changeScore} · ${w.evidence ? Math.round((w.evidence.durationMs || 0) / 1000) + 's' : ''}</div>
  </div></div></details>
  </section>`;
}
function quarCard(r) {
  const rd = r.rawDelta || {};
  const g = (rd.guide || []).map((q) => `<div class="qa"><div class="q">${q.action || ''} ${esc(q.q)}</div><div class="a">${esc(q.a)}</div></div>`).join('') || '<p class=muted>no guide in attempt</p>';
  return `<section class="work quar" data-id="${esc(r.id)}" data-review-kind="quarantined" data-reviewed="false"><details class="workdetails attention-now" open><summary><span class="summarytitle">${esc(r.id)}</span> <span class="bad">QUARANTINED — needs a decision</span></summary><div class="quarbody">
  ${workReviewBlock({ quarantined: true })}
  <div class="box conf"><b>Exact rejection:</b> ${esc(r.why)}</div>
  <h4>Attempted why ${rd.why ? cn(rd.why.text) : ''}</h4><div class="why">${esc(rd.why?.text) || '<span class=muted>—</span>'}</div>
  <h4>Attempted cues</h4><ul>${(rd.cues?.items || []).map((c) => `<li>${esc(c)}</li>`).join('') || '<li class=muted>—</li>'}</ul>
  <h4>Attempted guide</h4>${g}
  <h4>Attempted notes</h4>${(rd.notes || []).map((n) => `<div class="note"><b>${n.action || ''} ${esc(n.head)}</b> ${n.body ? cn(n.body) : ''}<div>${esc(n.body)}</div></div>`).join('') || '<p class=muted>—</p>'}
  </div></details></section>`;
}

await prepImages(completed); // downscale + embed images before rendering

const html = `<!doctype html><meta charset="utf-8"><title>B4-v2 editorial review</title><style>
body{font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;margin:0;color:#1c1a17;background:#faf9f7}
header{position:sticky;top:0;background:#fff;border-bottom:1px solid #e4e0d8;padding:12px 18px;z-index:10}
h1{font-size:18px;margin:0 0 6px}h3{font-size:16px;margin:20px 0 2px}h4{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#6b665e;margin:12px 0 3px}
main{max-width:1500px;margin:0 auto;padding:14px 18px}
.work{border-top:2px solid #e4e0d8;margin-top:14px;scroll-margin-top:150px}.wid{color:#9a8f7e;font-size:11px;font-weight:400}
.workdetails>summary{cursor:pointer;padding:12px 10px;list-style-position:outside;background:#fff;border-radius:6px}.workdetails>summary:focus-visible{outline:3px solid #2a5aa0;outline-offset:2px}.workdetails[open]>summary{border-bottom:1px solid #e4e0d8;border-radius:6px 6px 0 0}.workdetails.attention-now>summary{background:#fff8ee}.summarytitle{font-size:16px;font-weight:700}.summarymeta{display:block;color:#6b665e;font-size:12px;margin:2px 0 0 18px}.review-now{background:#f8ddbb;color:#7a4708}.worklayout{display:grid;grid-template-columns:minmax(300px,44%) minmax(0,1fr);gap:22px;align-items:start;padding:12px 0}.visualcolumn{position:sticky;top:calc(env(safe-area-inset-top) + 126px);align-self:start}.visualcolumn .imgwrap img{max-height:calc(100dvh - 155px);width:auto;object-fit:contain}.textcolumn{min-width:0}.quarbody{max-width:900px;padding:10px}
@media(max-width:900px){.worklayout{grid-template-columns:1fr}.visualcolumn{position:static}.visualcolumn .imgwrap img{max-height:none}}
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
.ov{}.imgwrap{position:relative;display:inline-block;max-width:100%}.imgwrap img{max-width:100%;border:1px solid #ddd;border-radius:6px;display:block}.imgwrap.placing img{cursor:crosshair;outline:3px solid #c9822b;outline-offset:2px}
.pin{position:absolute;transform:translate(-50%,-50%);width:24px;height:24px;border-radius:50%;border:0;color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 2px #fff;padding:0}
.pin.old{background:#8a8a8a;opacity:.85;width:20px;height:20px}.pin.proposed{background:#c9822b;cursor:pointer}.pin.proposed:focus-visible{outline:3px solid #111;outline-offset:2px}.pin.proposed.armed{background:#111}.pin.proposed.dropped{opacity:.35;text-decoration:line-through}.pin.is-hidden{display:none}.ovlabel{font-size:11px;color:#6b665e;margin-bottom:3px}.noimg{color:#b23b3b;font-size:12px}
.region{position:absolute;border:2px solid #c9822b;background:#c9822b22;color:#7f4b0c;font-size:11px;font-weight:700;box-sizing:border-box}.warn{color:#a4601a;font-weight:600}.pinq{background:#fff8ee;border:1px solid #e6cf96}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%;vertical-align:middle}.dot.old{background:#8a8a8a}.dot.proposed{background:#c9822b}.imgwrap{max-width:520px}
.bad{color:#b23b3b;font-weight:700;font-size:12px}
button.f{margin:2px 4px 2px 0;padding:3px 9px;border:1px solid #cfc7ba;background:#fff;border-radius:14px;cursor:pointer;font-size:12px}button.f.on{background:#1c1a17;color:#fff;border-color:#1c1a17}
.first10{background:#fff8ee;border:1px solid #e6cf96;border-radius:8px;padding:10px 14px;margin:10px 0}.first10 a{color:#8a5a12}
.reviewbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:8px 0}.reviewbar button,.decisionbuttons button,.hotactions button{border:1px solid #bdb4a6;background:#fff;color:#1c1a17;border-radius:5px;padding:6px 10px;cursor:pointer;font:inherit}.reviewbar button:hover,.decisionbuttons button:hover,.hotactions button:hover{border-color:#6b665e}.reviewbar button:focus-visible,.decisionbuttons button:focus-visible,.hotactions button:focus-visible,textarea:focus-visible{outline:3px solid #2a5aa0;outline-offset:2px}.reviewbar button.primary{background:#1c1a17;color:#fff;border-color:#1c1a17}.progress{font-variant-numeric:tabular-nums;font-weight:600}.savestate{color:#6b665e;font-size:12px}
.reviewbox{background:#f4f7fa;border:1px solid #c8d6e5;border-radius:7px;padding:10px 12px;margin:10px 0}.reviewchoice>span{color:#59636d;font-size:12px;margin-left:6px}.decisionbuttons{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px}.decisionbuttons button.selected,.hotactions button.selected{background:#1c1a17;color:#fff;border-color:#1c1a17}.notelabel{display:block;font-weight:600;margin-top:9px}.notelabel textarea{display:block;width:100%;box-sizing:border-box;margin-top:4px;border:1px solid #b8c1ca;border-radius:5px;padding:8px;font:inherit;resize:vertical;background:#fff}.worksave{color:#59636d;font-size:11px;min-height:1em;margin-top:4px}
.hotreview{margin:10px 0 16px}.reviewhelp{max-width:760px;color:#59636d;margin:0 0 8px}.hotrow{display:grid;grid-template-columns:36px minmax(0,1fr) auto;gap:9px;align-items:start;border:1px solid #ddd6ca;background:#fff;border-radius:7px;padding:9px;margin:6px 0}.hotrow.armed{border-color:#c9822b;background:#fff8ee}.hotrow.reviewed{border-left:5px solid #2f7d4f}.hotlabel{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;background:#c9822b;font-size:11px;font-weight:700}.hotlabel.suppressed{background:#786b5b}.hotcopy{min-width:0}.hotstatus{color:#6b665e;font-size:12px;margin-top:3px}.hotchoice{color:#2f5d42;font-weight:600;font-size:12px;margin-top:3px;min-height:1em}.hotactions{display:flex;flex-wrap:wrap;gap:5px;justify-content:flex-end}@media(max-width:720px){.hotrow{grid-template-columns:36px 1fr}.hotactions{grid-column:1/-1;justify-content:flex-start}}
.reviewnotice{background:#eef5fb;border:1px solid #b9d0e5;border-radius:7px;padding:9px 12px;margin:9px 0}.reviewnotice b{display:block}.exportstatus{font-size:12px;color:#2f5d42;min-height:1em}
</style>
<header>
<h1>Pass B — B4-v2 editorial review (${completed.length} completed · ${quarantined.length} quarantined) · run ${esc(RUN.split('/').pop())}</h1>
<div class="reviewbar"><span class="progress" id="review-progress">0/${completed.length + quarantined.length} works decided</span><button type="button" class="primary" id="download-review">Download review JSON</button><button type="button" id="copy-review">Copy review JSON</button><button type="button" id="open-attention">Open attention</button><button type="button" id="collapse-all">Collapse all</button><span class="savestate" id="save-state" aria-live="polite">Loading saved review…</span><span class="exportstatus" id="export-status" aria-live="polite"></span></div>
<div>Filter:
 <button class="f on" data-f="all">all</button>
 <button class="f" data-f="strongLegacy">strongLegacy</button>
 <button class="f" data-f="thin">thin/missing</button>
 <button class="f" data-f="new">new entry</button>
 <button class="f" data-f="overwrite">overwrite</button>
 <button class="f" data-f="conflicts">conflicts/corrections</button>
 <button class="f" data-f="zero-legacy-derived">zero legacy-derived</button>
 <button class="f" data-f="hotspot-attention">hotspot attention</button>
 <button class="f" data-f="needs-attention">needs attention</button>
 <button class="f" data-f="unreviewed">unreviewed</button>
 <button class="f" data-f="reviewed">reviewed/touched</button>
 <button class="f" data-f="longest">longest answers</button>
</div></header>
<main>
<div class="reviewnotice"><b>This packet now records your review.</b> Choose a work decision, write notes, and review hotspot locations. Your input auto-saves in this browser; download the JSON before handing it to Claude or Codex. Nothing here changes the site or constitutes production approval.</div>
<div class="first10"><b>Corrected audit metrics</b> — hotspot proposals ${hotspotSummary.proposed}: ${hotspotSummary.published} published, ${hotspotSummary.suppressed} retained as duplicate/unlocalized attention items. Of ${lineageSummary.legacyTotal} old guide questions across ${lineageSummary.legacyWorks} works: ${lineageSummary.verbatim} survive verbatim, ${lineageSummary.reworked} survive revised/replaced, and ${lineageSummary.removed} do not survive (${lineageSummary.removedExplicit} explicit removals, ${lineageSummary.removedImplicit} omitted); ${lineageSummary.added} final questions are new. ${lineageSummary.zeroLegacyDerived} works retain no legacy-derived final question.${lineageSummary.invalidLegacyRefs ? ` ${lineageSummary.invalidLegacyRefs} cross-component legacy refs are conservatively counted as new.` : ''}</div>
<div class="first10"><b>Recommended first-review set (10)</b> — 5 strongLegacy + 5 thin/missing, harvard303416 included, diverse culture/medium/fame/change:<br>${first10.map((id) => `<a href="#${esc(id)}">${esc(id)}</a>`).join(' · ')}</div>
<h2>Completed (${completed.length})</h2>
${completed.map((w) => `<a name="${esc(w.id)}"></a>${workCard(w)}`).join('\n')}
<h2 style="border-top:3px solid #b23b3b;padding-top:14px;margin-top:26px">Quarantined attempts (${quarantined.length}) — not repaired, not rerun</h2>
${quarantined.map(quarCard).join('\n')}
</main>
<script>
const REVIEW_META=${reviewMetadataJson};
const STORAGE_KEY='gesso:'+REVIEW_META.version+':'+REVIEW_META.runId+':'+(REVIEW_META.evidenceManifestSha256||'unbound');
const sections=[...document.querySelectorAll('.work')];
const metaById=new Map(REVIEW_META.works.map(w=>[w.workId,w]));
let activePlacement=null;
let reviewState={version:REVIEW_META.version,runId:REVIEW_META.runId,evidenceManifestSha256:REVIEW_META.evidenceManifestSha256,works:{}};
const saveLabel=document.getElementById('save-state');
try{
  const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');
  if(saved&&saved.version===REVIEW_META.version&&saved.runId===REVIEW_META.runId&&saved.evidenceManifestSha256===REVIEW_META.evidenceManifestSha256)reviewState=saved;
  saveLabel.textContent='Saved locally in this browser';
}catch(error){saveLabel.textContent='Browser storage unavailable — download JSON before closing';}

function stateFor(id){
  if(!reviewState.works[id])reviewState.works[id]={decision:null,note:'',hotspots:{}};
  if(!reviewState.works[id].hotspots)reviewState.works[id].hotspots={};
  return reviewState.works[id];
}
function isTouched(state){return !!(state.decision||(state.note||'').trim()||Object.keys(state.hotspots||{}).length);}
function sectionFor(id){return sections.find(section=>section.dataset.id===id);}
function persist(){
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify(reviewState));saveLabel.textContent='Saved in this browser at '+new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});}
  catch(error){saveLabel.textContent='Could not save locally — download JSON now';}
  updateProgress();
}
function updateProgress(){
  const decided=REVIEW_META.works.filter(meta=>stateFor(meta.workId).decision).length;
  const touched=REVIEW_META.works.filter(meta=>isTouched(stateFor(meta.workId))).length;
  document.getElementById('review-progress').textContent=decided+'/'+REVIEW_META.works.length+' works decided · '+touched+' touched';
}
function setActive(workId,key){activePlacement={workId,key};refreshAll();const row=sectionFor(workId)?.querySelector('.hotrow[data-hotspot-key="'+key+'"]');row?.scrollIntoView({block:'nearest'});}
function refreshSection(section){
  const id=section.dataset.id;const state=stateFor(id);section.dataset.reviewed=isTouched(state)?'true':'false';
  section.querySelectorAll('[data-work-decision]').forEach(button=>{const on=button.dataset.workDecision===state.decision;button.classList.toggle('selected',on);button.setAttribute('aria-pressed',String(on));});
  const note=section.querySelector('[data-work-note]');if(note&&document.activeElement!==note)note.value=state.note||'';
  const save=section.querySelector('.worksave');if(save)save.textContent=isTouched(state)?'Review input saved locally.':'';
  section.querySelectorAll('.hotrow').forEach(row=>{
    const key=row.dataset.hotspotKey;const choice=state.hotspots[key]||null;const isActive=activePlacement&&activePlacement.workId===id&&activePlacement.key===key;
    row.classList.toggle('armed',!!isActive);row.classList.toggle('reviewed',!!choice);
    row.querySelectorAll('[data-hotspot-action]').forEach(button=>{const on=choice&&button.dataset.hotspotAction===choice.decision;button.classList.toggle('selected',!!on);button.setAttribute('aria-pressed',String(!!on));});
    const marker=section.querySelector('.review-pin[data-hotspot-key="'+key+'"]');
    const hasOriginal=row.dataset.originalX!==''&&row.dataset.originalY!=='';
    const x=choice?.decision==='move'?choice.x:(hasOriginal?Number(row.dataset.originalX):null);
    const y=choice?.decision==='move'?choice.y:(hasOriginal?Number(row.dataset.originalY):null);
    if(marker){
      const visible=Number.isFinite(x)&&Number.isFinite(y)&&(choice?.decision!=='drop'||hasOriginal);
      marker.classList.toggle('is-hidden',!visible);marker.classList.toggle('dropped',choice?.decision==='drop');marker.classList.toggle('armed',!!isActive);
      if(visible){marker.style.left=x+'%';marker.style.top=y+'%';}else{marker.style.removeProperty('left');marker.style.removeProperty('top');}
    }
    const out=row.querySelector('.hotchoice');
    if(isActive)out.textContent='Click the image where this hotspot belongs.';
    else if(choice?.decision==='move')out.textContent='Your choice: place at '+choice.x.toFixed(1)+'%, '+choice.y.toFixed(1)+'%.';
    else if(choice?.decision==='keep')out.textContent='Your choice: keep the current location.';
    else if(choice?.decision==='note')out.textContent='Your choice: keep this observation as an unpinned note.';
    else if(choice?.decision==='drop')out.textContent=hasOriginal?'Your choice: drop this hotspot.':'Your choice: leave this proposal unpublished.';
    else out.textContent='';
  });
  section.querySelectorAll('[data-image-wrap]').forEach(wrap=>wrap.classList.toggle('placing',!!activePlacement&&activePlacement.workId===id));
}
function refreshAll(){sections.forEach(refreshSection);updateProgress();}

sections.forEach(section=>{
  const id=section.dataset.id;
  section.querySelectorAll('[data-work-decision]').forEach(button=>button.addEventListener('click',()=>{stateFor(id).decision=button.dataset.workDecision;persist();refreshSection(section);}));
  const note=section.querySelector('[data-work-note]');if(note)note.addEventListener('input',()=>{stateFor(id).note=note.value;persist();section.dataset.reviewed='true';});
  section.querySelectorAll('[data-hotspot-action]').forEach(button=>button.addEventListener('click',()=>{
    const row=button.closest('.hotrow');const key=row.dataset.hotspotKey;const action=button.dataset.hotspotAction;
    if(action==='move'){setActive(id,key);return;}
    const prior=stateFor(id).hotspots[key]||{};stateFor(id).hotspots[key]={...prior,decision:action};
    if(activePlacement&&activePlacement.workId===id&&activePlacement.key===key)activePlacement=null;
    persist();refreshSection(section);
  }));
  section.querySelectorAll('.review-pin').forEach(marker=>marker.addEventListener('click',()=>setActive(id,marker.dataset.hotspotKey)));
  const image=section.querySelector('.review-image');if(image)image.addEventListener('click',event=>{
    if(!activePlacement||activePlacement.workId!==id)return;
    const rect=image.getBoundingClientRect();
    const x=Math.max(0,Math.min(100,(event.clientX-rect.left)/rect.width*100));
    const y=Math.max(0,Math.min(100,(event.clientY-rect.top)/rect.height*100));
    const key=activePlacement.key;const meta=(metaById.get(id)?.hotspots||[]).find(h=>h.key===key)||{};
    stateFor(id).hotspots[key]={decision:'move',x:Number(x.toFixed(2)),y:Number(y.toFixed(2)),deltaIndex:meta.deltaIndex,evidenceRef:meta.evidenceRef};
    activePlacement=null;persist();refreshSection(section);
  });
});

function exportPayload(){
  return {...REVIEW_META,exportedAt:new Date().toISOString(),works:REVIEW_META.works.map(meta=>{
    const state=stateFor(meta.workId);
    return {...meta,decision:state.decision||null,note:state.note||'',hotspots:(meta.hotspots||[]).map(h=>({...h,review:state.hotspots[h.key]||null}))};
  })};
}
function exportText(){return JSON.stringify(exportPayload(),null,2)+'\\n';}
document.getElementById('download-review').addEventListener('click',()=>{
  const blob=new Blob([exportText()],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='pass-b-editorial-review-'+REVIEW_META.runId+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),0);document.getElementById('export-status').textContent='Downloaded review JSON.';
});
document.getElementById('copy-review').addEventListener('click',async()=>{
  const text=exportText();let copied=false;
  try{await navigator.clipboard.writeText(text);copied=true;}catch(error){const area=document.createElement('textarea');area.value=text;area.style.position='fixed';area.style.left='-9999px';document.body.appendChild(area);area.select();copied=document.execCommand('copy');area.remove();}
  document.getElementById('export-status').textContent=copied?'Copied review JSON.':'Copy was blocked; use Download review JSON.';
});
document.getElementById('open-attention').addEventListener('click',()=>sections.forEach(section=>{const details=section.querySelector('.workdetails');if(details?.classList.contains('attention-now'))details.open=true;}));
document.getElementById('collapse-all').addEventListener('click',()=>sections.forEach(section=>{const details=section.querySelector('.workdetails');if(details)details.open=false;}));

document.querySelectorAll('button.f').forEach(button=>button.addEventListener('click',()=>{
  document.querySelectorAll('button.f').forEach(x=>x.classList.remove('on'));button.classList.add('on');const filter=button.dataset.f;
  sections.forEach(section=>{let show=true;
    if(filter==='strongLegacy')show=section.dataset.cohort==='strongLegacy';
    else if(filter==='thin')show=section.dataset.reviewKind==='completed'&&section.dataset.cohort!=='strongLegacy';
    else if(filter==='new')show=section.dataset.entry==='new';
    else if(filter==='overwrite')show=section.dataset.entry==='overwrite';
    else if(filter==='conflicts')show=/conflicts|corrections/.test(section.dataset.flags||'');
    else if(filter==='zero-legacy-derived')show=/zero-legacy-derived/.test(section.dataset.flags||'');
    else if(filter==='hotspot-attention')show=/hotspot-attention/.test(section.dataset.flags||'');
    else if(filter==='needs-attention')show=/needs-attention/.test(section.dataset.flags||'')||section.dataset.reviewKind==='quarantined';
    else if(filter==='unreviewed')show=section.dataset.reviewed!=='true';
    else if(filter==='reviewed')show=section.dataset.reviewed==='true';
    else if(filter==='longest')show=Number(section.dataset.maxans)>=550;
    section.style.display=show?'':'none';
  });
}));
refreshAll();
</script>`;

const out = join(RUN, 'editorial-review-packet.html');
if (/\b(?:left|top):(null|undefined|NaN)%/.test(html)) throw new Error('refusing to render an invalid hotspot coordinate');
writeFileSync(out, html);
console.log(`wrote ${out}`);
console.log(`completed ${completed.length} | quarantined ${quarantined.length}`);
console.log('first-10:', first10.join(', '));
