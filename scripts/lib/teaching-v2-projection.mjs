// Teaching-v2 thin projection + two render models (VSD-093; design draft 2 §5). Pure; no writes to production.
// projectLesson converts 0-1 coordinates to percent EXACTLY ONCE, keeps every word, and numbers dots by the
// note's own position (no renumbering around no-dot notes). The current renderer is index.html itself, run by
// teaching-v2-current-render.mjs; the "faithful" preview is the proposed renderer, separately labelled. Neither
// is the main-lane renderer change, which is a separate owner-merged PR.
import { validateProductionProjection } from './pass-b-approval.mjs';
import { scanTeachEntry } from './public-output-leak.mjs';

export const PROJECTION_VERSION = 'teachingV2Projection/1';

export function projectLesson(lesson) {
  const hs = lesson.hotspots;
  return {
    version: PROJECTION_VERSION,
    entry: {
      why: lesson.why,
      cues: [],
      notes: hs.map(h => ({ head: h.head, body: h.body, x: h.x === null ? null : 100 * h.x, y: h.y === null ? null : 100 * h.y })),
      guide: lesson.questions.map(q => ({ q: q.q, a: q.a })),
    },
    hotspotEntry: hs.flatMap((h, i) => h.x === null ? [] : [{ n: i + 1, x: 100 * h.x, y: 100 * h.y }]),
  };
}

export function validateProjection(proj, lesson) {
  const errors = [];
  const base = validateProductionProjection({ teach: proj.entry, hotspots: proj.hotspotEntry });
  errors.push(...base.errors);
  const { entry, hotspotEntry } = proj;
  if (entry.why !== lesson.why) errors.push('why changed in projection');
  if (entry.cues.length !== 0) errors.push('cues must be [] for a replaced entry');
  if (entry.notes.length !== lesson.hotspots.length) errors.push('note count changed');
  if (entry.guide.length !== lesson.questions.length) errors.push('question count changed');
  lesson.hotspots.forEach((h, i) => {
    const n = entry.notes[i];
    if (!n || n.head !== h.head || n.body !== h.body) errors.push(`note ${i + 1} text changed`);
    if ((n.x === null) !== (n.y === null)) errors.push(`note ${i + 1}: unpaired coordinates`);
    if (h.x === null ? n.x !== null : (n.x !== 100 * h.x || n.y !== 100 * h.y)) errors.push(`note ${i + 1}: coordinate is not exactly 100 x the approved 0-1 value`);
    const dots = hotspotEntry.filter(d => d.n === i + 1);
    if (h.x === null ? dots.length !== 0 : (dots.length !== 1 || dots[0].x !== n.x || dots[0].y !== n.y)) errors.push(`note ${i + 1}: dot/note mismatch`);
  });
  lesson.questions.forEach((q, i) => { const g = entry.guide[i]; if (!g || g.q !== q.q || g.a !== q.a) errors.push(`question ${i + 1} text changed`); });
  const ns = hotspotEntry.map(d => d.n);
  if (new Set(ns).size !== ns.length) errors.push('duplicate dot number');
  if (ns.some((n, i) => i > 0 && n <= ns[i - 1])) errors.push('dot numbers not in note order');
  for (const l of scanTeachEntry(entry)) errors.push(`leak ${l.field}: ${l.label}`);
  return { ok: errors.length === 0, errors };
}

// What the daily reveal shows TODAY is computed by running index.html itself (teaching-v2-current-render.mjs,
// review finding 15); this module no longer carries a hand copy of its filters.
export function faithfulView({ entry, hotspotEntry }) {
  return { model: 'teachingV2FaithfulPreview/1', why: entry.why, notes: entry.notes.map((n, i) => ({ ...n, i, dot: n.x !== null })), guide: entry.guide, dots: hotspotEntry.map(h => ({ label: h.n, x: h.x, y: h.y, note: h.n - 1 })) };
}
// The manifest V sees: exactly what the current renderer (run on this projection) shows, loses and where it
// displays each dot after decluttering, plus the separately labelled proposed faithful renderer.
export function renderManifest(proj, { current }) {
  if (!current || typeof current !== 'object') throw new Error('renderManifest needs the current index.html render of this projection');
  return {
    projection: proj,
    currentRenderer: { model: current.model, whyShown: current.whyShown, notesShown: current.notesShown, questionsShown: current.questionsShown, dotSource: current.dotSource, dots: current.dots, displayedAfterDeclutter: current.displayed, losses: current.losses },
    proposedFaithfulRenderer: { whyShown: proj.entry.why, notesShown: proj.entry.notes.map((_, i) => i + 1), questionsShown: proj.entry.guide.map((_, i) => i + 1), dots: proj.hotspotEntry, note: 'proposed renderer (not deployed): every note and question, dots at their verified coordinates, no declutter' },
  };
}

// ---------------- static HTML previews for owner review ----------------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CSS = `:root{--bg:#f7f4ee;--ink:#1d1b18;--muted:#6b665c;--line:#d9d2c4;--accent:#9b3d24;--dot:#9b3d24;--card:#fff;--warn:#8a5a00}
@media (prefers-color-scheme:dark){:root{--bg:#171512;--ink:#ece6da;--muted:#a59e90;--line:#3a352d;--accent:#e07a5c;--dot:#e07a5c;--card:#211e1a;--warn:#e0b45c}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:1100px;margin:0 auto;padding:20px 16px 60px}h1{font-size:20px;margin:0 0 4px}.sub{color:var(--muted);margin:0 0 20px;font-size:13px}
.work{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:16px;margin:0 0 22px;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:18px}
@media (max-width:760px){.work{grid-template-columns:1fr}}.plate{position:relative;line-height:0}.plate img{width:100%;height:auto;display:block}
.dot{position:absolute;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:var(--dot);color:#fff;font:700 12px/22px system-ui;text-align:center;box-shadow:0 0 0 2px #fff}
.dot.fb{background:#666}.meta{font-size:12px;color:var(--muted)}.why{font-size:16px;margin:6px 0 10px}.lbl{font:700 11px system-ui;letter-spacing:.12em;text-transform:uppercase;margin:14px 0 6px}
.n{display:inline-block;min-width:20px;height:20px;border-radius:50%;background:var(--dot);color:#fff;font:700 11px/20px system-ui;text-align:center;margin-right:6px}.n.nodot{background:transparent;color:var(--muted);border:1px dashed var(--muted)}
.item{margin:0 0 8px}.item b{display:inline}.loss{color:var(--warn);font-size:13px;margin:2px 0}.st{font:600 12px system-ui;color:var(--muted)}`;
// kind "current": each work carries w.current (the real index.html render) and w.shown ('candidate' or
// 'frozen legacy'); a hold or unrun work shows the frozen legacy rendering, labelled. kind "faithful": proposed.
export function renderPreviewPage({ kind, works, generatedFrom }) {
  const body = works.map(w => {
    const head = `<div class="st">${esc(w.status)} · ${esc(w.id)}</div><h2 style="font-size:17px;margin:2px 0 0">${esc(w.title)}</h2><div class="meta">${esc([w.artist, w.date].filter(Boolean).join(' · '))}</div>`;
    if (kind === 'current') {
      const c = w.current; const view = c?.displayed?.phone;
      if (!c) return `<section class="work"><div>${head}<p>Not rendered.</p></div></section>`;
      const dots = (view ? view.dots : c.dots).map(d => `<span class="dot${c.dotSource === 'notes' ? '' : ' fb'}" style="left:${d.x}%;top:${d.y}%">${esc(d.label)}</span>`).join('');
      const plate = `<div class="plate"><img src="${esc(w.imageRel)}" alt="${esc(w.title)}">${dots}</div>`;
      const notes = w.entry?.notes || []; const guide = w.entry?.guide || [];
      const text = `<div class="lbl">${esc(w.shown === 'candidate' ? 'Candidate lesson' : 'Frozen legacy (what stays live on a hold)')}</div><p class="why">${esc(c.whyShown)}</p><div class="lbl">Study notes</div>${c.notesShown.map(n => `<div class="item"><span class="n">${n}</span><b>${esc(notes[n - 1]?.head)}</b> ${esc(notes[n - 1]?.body)}</div>`).join('')}${c.cuesShown.map((t, k) => `<div class="item"><span class="n nodot">${k + 1}</span>${esc(t)}</div>`).join('')}
<div class="lbl">Follow-up questions · ${c.questionsShown.length}</div>${c.questionsShown.map((n, k) => `<div class="item"><span class="n nodot">${k + 1}</span><b>${esc(guide[n - 1]?.q)}</b> ${esc(guide[n - 1]?.a)}</div>`).join('')}
${c.losses.length ? `<div class="lbl">Lost or moved in the current renderer</div>${c.losses.map(l => `<div class="loss">${esc(l)}</div>`).join('')}` : ''}<div class="meta">dots: ${esc(c.dotSource)} · drawn at their displayed positions on a ${esc((view?.plate || []).join('x'))}px phone plate after index.html declutter</div>`;
      return `<section class="work"><div>${head}${plate}</div><div>${text}</div></section>`;
    }
    if (!w.projection) return `<section class="work"><div>${head}<p>No candidate lesson (${esc(w.status)}). The frozen legacy copy stays live; see the current-renderer page.</p></div></section>`;
    const v = faithfulView(w.projection);
    const dots = v.dots.map(d => `<span class="dot" style="left:${d.x}%;top:${d.y}%">${esc(d.label)}</span>`).join('');
    const plate = `<div class="plate"><img src="${esc(w.imageRel)}" alt="${esc(w.title)}">${dots}</div>`;
    const text = `<p class="why">${esc(v.why)}</p><div class="lbl">Notes</div>${v.notes.map(n => `<div class="item"><span class="n${n.dot ? '' : ' nodot'}">${n.i + 1}</span><b>${esc(n.head)}</b> ${esc(n.body)}${n.dot ? '' : ' <span class="meta">(no dot)</span>'}</div>`).join('')}
<div class="lbl">Follow-up questions · ${v.guide.length}</div>${v.guide.map((g, k) => `<div class="item"><span class="n nodot">${k + 1}</span><b>${esc(g.q)}</b> ${esc(g.a)}</div>`).join('')}`;
    return `<section class="work"><div>${head}${plate}</div><div>${text}</div></section>`;
  }).join('\n');
  const title = kind === 'current' ? 'Current renderer preview' : 'Proposed faithful renderer preview';
  const sub = kind === 'current' ? 'Rendered by running index.html\'s own reveal code (renderReveal, notes/question filters, teaser, legacy pin fallback, declutterMarks). Dots are drawn where the current renderer displays them on a phone plate. Holds show the frozen legacy copy that stays live. No CSS layout, object-fit or zoom fidelity.' : 'PROPOSED renderer, not deployed: everything approved, including no-dot notes and all questions, dots at verified coordinates. Estimates teaching potential; it is NOT what the game shows today.';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${CSS}</style></head><body><main><h1>${title}</h1><p class="sub">${esc(sub)} Development evidence only (teaching-v2 Phase A, VSD-093). ${esc(generatedFrom || '')}</p>${body}</main></body></html>\n`;
}
