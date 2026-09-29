// Player-facing components of an accepted structured-B4 body, with the stable ids the reconciliation bundle uses.
import { sha256 } from './vision-legacy.mjs';

export function componentsOf(body) {
  const out = [{ componentId: 'why', surface: 'why', text: typeof body.proposedWhy === 'string' ? body.proposedWhy : '' }];
  (body.proposedCues || []).forEach((c, i) => out.push({ componentId: `cue:c_${sha256(`${i}|${c}`).slice(0, 10)}`, surface: 'cue', text: c }));
  for (const n of body.notes || []) out.push({ componentId: `note:${n.noteId}`, surface: 'note', text: `${n.head} — ${n.body}` });
  for (const g of body.guide || []) out.push({ componentId: `guide:${g.questionId}`, surface: 'guide', text: `${g.q} || ${g.a}` });
  for (const h of body.hotspots || []) out.push({ componentId: `hotspot:${h.hotspotId}`, surface: 'hotspot', text: `${h.conciseText} — ${h.deepText}` });
  return out.filter(c => c.text);
}
