// Render the B4-only comparison (VSD-024) as one browser-viewable card. Read-only over the compare dir.
// Usage: node scripts/pass-b-b4-v2-card.mjs data/incoming/vision-calibration/b4v2-<id>
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const dir = process.argv[2];
if (!dir) { console.error('usage: pass-b-b4-v2-card.mjs <compare-dir>'); process.exit(2); }
const rows = readdirSync(join(dir, 'works')).filter((f) => f.endsWith('.compare.json')).map((f) => JSON.parse(readFileSync(join(dir, 'works', f), 'utf8')));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const guide = (b) => (b?.guide || []).map((g, i) => `<div class="qa"><div class="q">Q${i + 1}. ${esc(g.q)}</div><div class="a">${esc(g.a)} <span class="len">(${(g.a || '').length})</span></div></div>`).join('') || '<p class="muted">—</p>';
const notes = (b) => (b?.notes || []).map((n) => `<div class="note"><b>${esc(n.head)}</b> <span class="len">(${(n.body || '').length})</span><div>${esc(n.body)}</div></div>`).join('') || '<p class="muted">—</p>';
const cues = (b) => `<ul>${(b?.proposedCues || []).map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`;
const hots = (b) => `<ul>${(b?.hotspots || []).map((h) => `<li>#${h.rank} ${esc(h.conciseText)}</li>`).join('')}</ul>`;

const section = (r) => {
  const ok = r.ok;
  const head = `<h2>${esc(r.id)} — ${ok ? '<span class="ok">assembled</span>' : '<span class="bad">FAILED assembly</span>'} · leaks old ${r.oldLeaks?.length ?? '?'} → new ${ok ? r.newLeaks?.length ?? '?' : 'n/a'}</h2>`;
  if (!ok) {
    return `<section>${head}<div class="warn">Rejected before any output: <b>${esc((r.errors || []).slice(0, 6).join(' · '))}</b>. The attempted new delta was not persisted (assembly rejected). Old B4 shown for context.</div>
      <div class="col"><h3>OLD why (${r.oldWhyLen})</h3><div class="why">${esc(r.oldBody?.proposedWhy)}</div>
      <h3>OLD guide (${(r.oldBody?.guide || []).length})</h3>${guide(r.oldBody)}</div></section>`;
  }
  return `<section>${head}
  <div class="grid">
    <div class="col"><h3>OLD why (${r.oldWhyLen})</h3><div class="why old">${esc(r.oldBody?.proposedWhy)}</div></div>
    <div class="col"><h3>NEW why (${r.newWhyLen}) <span class="ok">owner-edited elsewhere; here model-generated</span></h3><div class="why">${esc(r.newBody?.proposedWhy)}</div></div>
  </div>
  <h3>NEW cues</h3>${cues(r.newBody)}
  <h3>NEW study guide (${(r.newBody?.guide || []).length} Qs) — answer lengths shown; target was 2–4 sentences</h3>${guide(r.newBody)}
  <h3>NEW notes (${(r.newBody?.notes || []).length})</h3>${notes(r.newBody)}
  <h3>NEW hotspots</h3>${hots(r.newBody)}
  <details><summary>OLD study guide (${(r.oldBody?.guide || []).length}) + notes</summary>${guide(r.oldBody)}${notes(r.oldBody)}</details>
  </section>`;
};

const html = `<!doctype html><meta charset="utf-8"><title>B4 v2 comparison</title><style>
body{font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:1000px;margin:24px auto;padding:0 18px;color:#1c1a17;background:#faf9f7}
h1{font-size:21px}h2{font-size:17px;margin:26px 0 4px;border-top:2px solid #e4e0d8;padding-top:14px}h3{font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#6b665e;margin:16px 0 4px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:760px){.grid{grid-template-columns:1fr}}
.why{background:#fff;border:1px solid #e4e0d8;border-radius:8px;padding:10px 12px}.why.old{background:#f3f1ec;color:#555}
.qa{margin:8px 0}.q{font-weight:600}.a{color:#333}.note{margin:8px 0}.len{color:#9a8f7e;font-size:11px}
.ok{color:#2f7d4f;font-weight:600;font-size:12px}.bad{color:#b23b3b;font-weight:700}.muted{color:#9a8f7e}
.warn{background:#fdeaea;border:1px solid #e2a5a5;border-radius:8px;padding:10px 14px;color:#8a2b2b;margin:8px 0}
ul{margin:4px 0 0 18px}details{margin:10px 0;color:#555}summary{cursor:pointer;color:#6b665e}
</style>
<h1>Pass B — B4-only comparison (corrected prompt)</h1>
<p class="muted">3 works, B4 re-run under the corrected editorial prompt using the existing verified B1/B2/B3. Nothing merged. Duration/token usage was not captured this run (harness gap).</p>
<div class="warn"><b>Result:</b> 1 of 3 assembled (cleveland170810, leaks 6→0). 2 failed assembly on length caps (note body &gt;600; cleveland120847 why &gt;500) — the corrected prompt fixed leaks but did not constrain note length, and its guide answers still run 5–8 sentences (target was 2–4). For Kat's editorial review.</div>
${rows.map(section).join('\n')}`;

const out = join(dir, 'b4-v2-comparison.html');
writeFileSync(out, html);
console.log(`wrote ${out}`);
