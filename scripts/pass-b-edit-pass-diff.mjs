// Render a browser-viewable review diff for the offline edit pass (b4r-8f1f74ddc30f).
// Reads the PRESERVED b4r bodies + the approved-draft records, shows every change.
// No model/network/merge. Output: <run>/edit-pass-diff.html
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const RUN = 'data/incoming/vision-calibration/b4r-8f1f74ddc30f';
const safe = id => id.replace(/[^a-z0-9]+/gi, '_');
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// inline word-level highlight of from->to
function diffPair(from, to) {
  return `<div class="pair"><div class="from"><span class="tag">was</span> ${esc(from)}</div>`
    + `<div class="to"><span class="tag">now</span> ${esc(to)}</div></div>`;
}

const drafts = readdirSync(`${RUN}/approved-draft`).filter(f => f.endsWith('.approved.json'))
  .map(f => JSON.parse(readFileSync(`${RUN}/approved-draft/${f}`, 'utf8')));

let cards = '';
let nRes = 0, nHedge = 0;
for (const d of drafts.sort((a, b) => a.id.localeCompare(b.id))) {
  const ep = d.editPass;
  nRes += ep.resolutions.length; nHedge += ep.hedges.length;
  let inner = '';
  if (ep.resolutions.length) {
    inner += '<h4>Conflict resolutions</h4>';
    for (const r of ep.resolutions) {
      inner += `<div class="res"><div class="field">${esc(r.field)} <span class="chip ${r.tag}">${r.tag === 'research' ? 'established by research' : 'visible in image'}</span></div><div class="rtext">${esc(r.resolution)}</div></div>`;
    }
  }
  if (ep.hedges.length) {
    inner += '<h4>Finding-3 hedges (visible vs researched)</h4>';
    for (const h of ep.hedges) {
      inner += `<div class="hedge"><div class="why">${esc(h.locator)} — ${esc(h.why)}</div>${diffPair(h.from, h.to)}</div>`;
    }
  }
  const status = `${d.strictValid ? '<span class="ok">strict-valid</span>' : '<span class="bad">STRICT-FAIL</span>'} ${d.leakClean ? '<span class="ok">leak-clean</span>' : '<span class="bad">LEAK</span>'}${ep.misses.length ? ` <span class="bad">${ep.misses.length} miss</span>` : ''}`;
  cards += `<section><h3>${esc(d.id)} <span class="st">${status}</span></h3>${inner}</section>`;
}

const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Edit-pass review — b4r</title>
<style>
:root{--bg:#faf8f4;--fg:#26221c;--mut:#6b655a;--line:#e6e0d6;--card:#fff;--was:#f4e7e4;--now:#e6f0e8;--acc:#7a5c3e}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
header{padding:28px 24px 18px;border-bottom:2px solid var(--line);background:var(--card)}
h1{margin:0 0 6px;font-size:22px;letter-spacing:-.01em}
.lede{color:var(--mut);max-width:70ch;font-size:14px}
main{max-width:960px;margin:0 auto;padding:20px 24px 80px}
.banner{background:#fff5e6;border:1px solid #e8c98a;border-radius:8px;padding:14px 16px;margin:18px 0;font-size:14px}
.banner b{color:#8a5a00}
section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px 18px;margin:14px 0}
h3{margin:0 0 10px;font-size:16px;font-family:ui-monospace,Menlo,monospace;word-break:break-all}
h4{margin:14px 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut)}
.st{font-size:11px;font-weight:400}
.ok{color:#2e7d4f}.bad{color:#b3261e;font-weight:600}
.res{border-left:3px solid var(--acc);padding:4px 0 4px 12px;margin:8px 0}
.field{font-weight:600;font-size:14px}
.rtext{color:#3a352c;font-size:14px;margin-top:2px}
.chip{font-size:11px;font-weight:600;padding:1px 8px;border-radius:20px;vertical-align:middle}
.chip.research{background:#eae2f5;color:#5a3f8a}.chip.visible{background:#e2eff5;color:#2f6b8a}
.hedge{margin:10px 0}
.why{font-size:12px;color:var(--mut);margin-bottom:4px}
.pair{display:grid;gap:4px}
.from,.to{padding:8px 10px;border-radius:6px;font-size:14px}
.from{background:var(--was)}.to{background:var(--now)}
.tag{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;opacity:.6;margin-right:6px}
</style></head><body>
<header><h1>Offline edit pass — review diff</h1>
<div class="lede">Run <code>b4r-8f1f74ddc30f</code> · ${drafts.length} records · ${nRes} conflict resolutions · ${nHedge} hedges · offline, no model / no network / no merge. These are QUARANTINED approved-drafts; the preserved B4 completions are untouched. Nothing ships until you approve the guarded merge.</div></header>
<main>
<div class="banner"><b>Two refinements need your yes/no</b> before merge (both go beyond your stated hedge, backed by the primary museum record I reached):<br>
1. <b>Imperial-kiln (Q48881623):</b> the NPM primary record shows only the reign mark — recommend <b>dropping</b> the imperial-kiln claim, not just hedging it.<br>
2. <b>Egyptian head (Q63247474):</b> the MAHG record identifies it as a <b>deified Amenemhat III</b>; the beard is <b>preserved</b> (not a stub), type uncharacterized. Currently applied as a hedge.</div>
${cards}
</main></body></html>`;

writeFileSync(`${RUN}/edit-pass-diff.html`, html);
console.log(`wrote ${RUN}/edit-pass-diff.html (${drafts.length} records, ${nRes} resolutions, ${nHedge} hedges)`);
