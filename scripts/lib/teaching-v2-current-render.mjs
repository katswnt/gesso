// Teaching-v2 "current renderer" (review finding 15): runs index.html's REAL reveal code (renderReveal, notesHTML,
// guideHTML, visionMarks, the teaser rule and declutterMarks) in the stubbed-DOM sandbox, instead of a hand copy.
// Given a projected entry (or the frozen legacy entry for a hold) it reports exactly what the daily reveal shows:
// the teaser, which notes and questions are listed, which dots are drawn from which source, and where each dot is
// DISPLAYED after decluttering at specified plate sizes. Limits: no CSS layout, object-fit, zoom or font metrics;
// plate size = stated width x the image's aspect ratio. It is evidence of current behaviour, not of mobile fidelity.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createIndexSandbox } from './index-app-sandbox.mjs';

export const CURRENT_RENDER_VERSION = 'teachingV2CurrentRender/1-index.html';
// Plate widths in CSS px: a 375px phone minus the 16px gutters, and a desktop reveal column.
export const VIEWPORTS = Object.freeze([{ name: 'phone', plateWidth: 343 }, { name: 'desktop', plateWidth: 560 }]);
export const RENDER_DATA = Object.freeze(['data/cues.js', 'data/cues-ext.js', 'data/pool.js', 'data/fame.js', 'data/regions.js', 'data/countries.js', 'data/museums.js']);
const sha = b => createHash('sha256').update(b).digest('hex');
const unesc = s => String(s).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

export function loadCurrentRenderer({ root = '.' } = {}) {
  const hotspots = {}, vision = {};
  const sb = createIndexSandbox({ root, dataFiles: RENDER_DATA, globals: { ARTEFACTUM_HOTSPOTS: hotspots, ARTEFACTUM_VISION: vision } });
  sb.ctx.ARTEFACTUM_CUES.work = {};
  const identity = { version: CURRENT_RENDER_VERSION, indexAppSha256: sb.appSha256, data: Object.fromEntries(RENDER_DATA.map(f => [f, sha(readFileSync(join(root, f)))])), viewports: VIEWPORTS };
  // index.html's POOL keeps only records with img and cats. A calibration work outside it is never shown by the
  // game; it is still rendered from its raw pool record (cats defaulted to []) and flagged, never silently skipped.
  const rawPool = sb.ctx.ARTEFACTUM_POOL || [];
  const poolItem = id => {
    const it = sb.ctx.qaResolve(id); if (it) return { it, inPlayablePool: true };
    const q = (String(id).match(/Q\d+/) || [])[0];
    const raw = rawPool.find(p => p.id === id) || (q && rawPool.find(p => (String(p.id).match(/Q\d+/) || [])[0] === q));
    return raw ? { it: { ...raw, cats: Array.isArray(raw.cats) ? raw.cats : [] }, inPlayablePool: false } : null;
  };

  // entry: the teach entry the reveal reads ({why,cues,notes,guide}) or null (no per-work entry: style/region
  // fallback); hotspotEntry: data/hotspots.js rows; visionRecord: data/vision.js record (legacy pins fallback).
  function render({ workId, entry, hotspotEntry = null, visionRecord = null, imageSize = null, viewports = VIEWPORTS }) {
    const found = poolItem(workId);
    if (!found) throw new Error(`current renderer: ${workId} is not in data/pool.js`);
    const { it, inPlayablePool } = found;
    const work = sb.ctx.ARTEFACTUM_CUES.work;
    for (const k of Object.keys(work)) delete work[k]; for (const k of Object.keys(hotspots)) delete hotspots[k]; for (const k of Object.keys(vision)) delete vision[k];
    if (entry) work[it.id] = JSON.parse(JSON.stringify(entry));
    if (hotspotEntry) hotspots[it.id] = JSON.parse(JSON.stringify(hotspotEntry));
    if (visionRecord) vision[it.id] = JSON.parse(JSON.stringify(visionRecord));
    sb.ctx.__tv2Item = it; sb.stage.innerHTML = '';
    sb.run('results=[{it:__tv2Item,coreCats:[],cells:{},guess:{},coreNet:0,bonus:0,baseMax:0,hintPen:0}]; infinite=false; runArchive=false; renderReveal(results[0],0,false);');
    const out = parseReveal(sb.stage.innerHTML, { entry, imageSize, viewports, declutter: plate => sb.ctx.declutterMarks(plate) });
    return { ...out, inPlayablePool, losses: inPlayablePool ? out.losses : ['not in the playable pool (index.html POOL needs img and cats): the game never shows this work', ...out.losses] };
  }
  return { identity, render, poolItem };
}

// Read the rendered reveal back: teaser, listed notes/cues, listed questions, dots (with their source) and the
// displayed dot positions after index.html's own declutterMarks at each plate size.
export function parseReveal(html, { entry, imageSize, declutter, viewports = VIEWPORTS }) {
  const blurb = html.match(/<div class="workblurb">([\s\S]*?)<\/div>/);
  const notesPart = html.split('study-notes-label')[1]?.split('class="study-guide"')[0] || '';
  const guidePart = html.split('study-guide-label')[1] || '';
  const notesShown = [...notesPart.matchAll(/<div class="agrow" data-note="(\d+)">/g)].map(m => Number(m[1]) + 1);
  const cuesShown = [...notesPart.matchAll(/<div class="cue"><span class="num">(\d+)<\/span><span class="tx">([\s\S]*?)<\/span>/g)].map(m => unesc(m[2]));
  const guideTexts = [...guidePart.matchAll(/<span class="agqt">([\s\S]*?)<\/span>/g)].map(m => unesc(m[1]));
  const guide = Array.isArray(entry?.guide) ? entry.guide : [];
  const used = new Set();
  const questionsShown = guideTexts.map(t => { const i = guide.findIndex((g, k) => !used.has(k) && g.q === t); if (i >= 0) used.add(i); return i >= 0 ? i + 1 : null; });
  const plate = html.match(/class="plate">([\s\S]*?)<div class="worktitle-row">/)?.[1] || '';
  const dots = [...plate.matchAll(/<button class="lookmark" style="top:([-\d.]+)%;left:([-\d.]+)%"([^>]*)>(\d+)<\/button>/g)].map(m => {
    const note = m[3].match(/data-note="(\d+)"/), cue = m[3].match(/data-cue="(\d+)"/);
    return { label: Number(m[4]), x: Number(m[2]), y: Number(m[1]), source: note ? 'notes' : cue ? 'hotspots' : 'vision-or-hotspots-fallback', note: note ? Number(note[1]) + 1 : null };
  });
  const dotSource = !dots.length ? 'none' : dots.every(d => d.source === 'notes') ? 'notes' : dots.some(d => d.source === 'notes') ? 'mixed' : 'legacy-fallback';
  const aspect = imageSize?.width && imageSize?.height ? imageSize.height / imageSize.width : 1;
  const displayed = Object.fromEntries(viewports.map(v => {
    const W = v.plateWidth, H = Math.round(W * aspect);
    const marks = dots.map(d => ({ style: { left: `${d.x}%`, top: `${d.y}%` } }));
    declutter({ clientWidth: W, clientHeight: H, querySelectorAll: () => marks });
    const pts = dots.map((d, k) => { const x = parseFloat(marks[k].style.left), y = parseFloat(marks[k].style.top); return { label: d.label, x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000, movedPct: Math.round(Math.hypot(x - d.x, y - d.y) * 1000) / 1000 }; });
    return [v.name, { plate: [W, H], dots: pts, moved: pts.filter(p => p.movedPct > 0.001).map(p => p.label) }];
  }));
  const notes = Array.isArray(entry?.notes) ? entry.notes : [];
  const losses = [
    ...notes.map((_, i) => i + 1).filter(n => !notesShown.includes(n)).map(n => `note ${n} not listed`),
    ...guide.map((_, i) => i + 1).filter(n => !questionsShown.includes(n)).map(n => `question ${n} not listed`),
    ...(entry?.why && unesc(blurb?.[1] ?? '') !== String(entry.why).trim() ? ['why shown only up to its first ". "'] : []),
    ...(dotSource === 'legacy-fallback' && notes.length ? ['no note is pinned: legacy pins are drawn instead (fallback)'] : []),
    ...Object.entries(displayed).filter(([, d]) => d.moved.length).map(([name, d]) => `declutter moves dot(s) ${d.moved.join(', ')} at the ${name} plate (${d.plate.join('x')}px)`),
  ];
  return { model: CURRENT_RENDER_VERSION, whyShown: blurb ? unesc(blurb[1]) : '', notesShown, cuesShown, questionsShown, dots, dotSource, displayed, losses };
}
