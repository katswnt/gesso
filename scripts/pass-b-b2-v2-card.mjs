// Render the B2 v1-vs-v2 comparison as a self-contained review card (VSD-022, Phase 2).
// Usage: node scripts/pass-b-b2-v2-card.mjs data/incoming/vision-calibration/b2-v2-compare/<runId>
// Reads the *.compare.json files and writes b2-v1-vs-v2.html in that dir. No model call, no merge.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isCorroboratingSource } from './lib/vision-content-schema.mjs';

const dir = process.argv[2];
if (!dir) { console.error('usage: node scripts/pass-b-b2-v2-card.mjs <compare-run-dir>'); process.exit(2); }
const files = readdirSync(dir).filter((f) => /\.compare\.json$/.test(f));
if (!files.length) { console.error(`no *.compare.json in ${dir}`); process.exit(2); }
const rows = files.map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const verdictStr = (v) => Object.entries(v || {}).map(([k, n]) => `${k} ${n}`).join(', ') || '—';
const num = (n) => (n == null ? '—' : n);

function factRows(body) {
  if (!body || !body.factChecks) return '<tr><td colspan="4" class="muted">no fact-checks</td></tr>';
  return body.factChecks.map((f) => {
    const srcs = (f.sources || []).map((s) => s.url || '').filter(Boolean);
    const hasCorrob = srcs.some((u) => isCorroboratingSource(u));
    const cls = f.verdict === 'refuted' ? 'v-ref' : /qualif|partly/i.test(f.verdict) ? 'v-qual' : f.verdict === 'supported' ? 'v-sup' : 'v-unr';
    const warn = f.verdict === 'refuted' && (f.confidence || 0) >= 0.8 && !hasCorrob ? ' <span class="warn">no corrob. src</span>' : '';
    return `<tr><td>${esc((f.claim || '').slice(0, 160))}</td><td class="${cls}">${esc(f.verdict)}</td><td class="tn">${(f.confidence ?? '')}</td><td class="tn">${srcs.length}${srcs.length && !hasCorrob ? ' <span class="wiki">no corrob.</span>' : ''}${warn}</td></tr>`;
  }).join('');
}

const cards = rows.map((r) => {
  const v1 = r.v1?.metrics, v2 = r.v2?.metrics;
  const v1web = r.v1?.web, v2ex = r.v2?.exec;
  const v2ok = r.v2Valid;
  return `<section class="work">
  <h2>${esc(r.title || r.workId)} <span class="wid">${esc(r.workId)}</span></h2>
  <div class="grid">
    <div class="col">
      <h3>v1 (prior B2)</h3>
      <ul class="stats">
        <li>research: <b>${num(v1web?.searches)}</b> searches / <b>${num(v1web?.fetches)}</b> pages retrieved${v1web && v1web.fetchAttempts != null ? ` (of ${v1web.fetchAttempts} tried)` : ''}</li>
        <li>fact-checks: <b>${num(v1?.factChecks)}</b> · sources: <b>${num(v1?.distinctSources)}</b> (${num(v1?.corroboratingSources)} corroborating)</li>
        <li>verdicts: ${esc(verdictStr(v1?.verdicts))}</li>
        <li>hi-conf refuted w/o corroborating source: <b class="${v1?.hiConfRefutedWithoutCorroboratingSource ? 'bad' : ''}">${num(v1?.hiConfRefutedWithoutCorroboratingSource)}</b></li>
      </ul>
      <table><thead><tr><th>claim</th><th>verdict</th><th>conf</th><th>src</th></tr></thead><tbody>${factRows(r.v1?.body)}</tbody></table>
    </div>
    <div class="col">
      <h3>v2 ${v2ok ? '<span class="ok">valid</span>' : '<span class="bad">' + (r.v2?.error ? 'failed' : 'invalid') + '</span>'}</h3>
      ${r.v2?.error ? `<p class="bad">${esc(r.v2.error)}</p>` : ''}
      ${(r.v2?.validationErrors || []).length ? `<p class="bad">${esc((r.v2.validationErrors || []).join('; '))}</p>` : ''}
      <ul class="stats">
        <li>research: <b>${num(v2ex?.b2WebEvents?.searches)}</b> searches / <b>${num(v2ex?.b2WebEvents?.fetches)}</b> pages retrieved${v2ex?.b2WebEvents?.fetchAttempts != null ? ` (of ${v2ex.b2WebEvents.fetchAttempts} tried)` : ''} · ${num(v2ex ? Math.round(v2ex.durationMs / 1000) : null)}s</li>
        <li>fact-checks: <b>${num(v2?.factChecks)}</b> · sources: <b>${num(v2?.distinctSources)}</b> (${num(v2?.corroboratingSources)} corroborating)</li>
        <li>verdicts: ${esc(verdictStr(v2?.verdicts))}</li>
        <li>hi-conf refuted w/o corroborating source: <b class="${v2?.hiConfRefutedWithoutCorroboratingSource ? 'bad' : 'ok'}">${num(v2?.hiConfRefutedWithoutCorroboratingSource)}</b></li>
      </ul>
      <table><thead><tr><th>claim</th><th>verdict</th><th>conf</th><th>src</th></tr></thead><tbody>${factRows(r.v2?.body)}</tbody></table>
    </div>
  </div>
</section>`;
}).join('\n');

const totV1 = rows.reduce((a, r) => a + (r.v1?.web?.searches || 0), 0);
const totV1f = rows.reduce((a, r) => a + (r.v1?.web?.fetches || 0), 0);
const totV1fa = rows.reduce((a, r) => a + (r.v1?.web?.fetchAttempts || 0), 0);
const totV2 = rows.reduce((a, r) => a + (r.v2?.exec?.b2WebEvents?.searches || 0), 0);
const totV2f = rows.reduce((a, r) => a + (r.v2?.exec?.b2WebEvents?.fetches || 0), 0);
const totV2fa = rows.reduce((a, r) => a + (r.v2?.exec?.b2WebEvents?.fetchAttempts || 0), 0);

const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>B2 v1 vs v2</title><style>
:root{--bg:#faf9f7;--fg:#1c1a17;--mut:#6b665e;--line:#e4e0d8;--card:#fff;--sup:#2f7d4f;--ref:#b23b3b;--qual:#9a6a12;--unr:#6b665e;--ok:#2f7d4f;--bad:#b23b3b}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#16150f;--fg:#ece7dc;--mut:#a49d8f;--line:#332f26;--card:#201e17;--sup:#6cc08a;--ref:#e88a8a;--qual:#e0b25a;--unr:#a49d8f;--ok:#6cc08a;--bad:#e88a8a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:24px}
h1{font-size:22px;margin:0 0 4px}.sub{color:var(--mut);margin:0 0 20px;font-size:13px}
.summary{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 18px;margin-bottom:24px}
.summary b{font-variant-numeric:tabular-nums}
.work{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px 18px;margin-bottom:20px}
h2{font-size:17px;margin:0 0 12px}.wid{color:var(--mut);font-weight:400;font-size:12px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}@media(max-width:760px){.grid{grid-template-columns:1fr}}
h3{font-size:14px;margin:0 0 8px;text-transform:uppercase;letter-spacing:.04em;color:var(--mut)}
.stats{list-style:none;padding:0;margin:0 0 10px;font-size:13px}.stats li{padding:2px 0}
table{width:100%;border-collapse:collapse;font-size:12px;display:block;overflow-x:auto}
th,td{text-align:left;padding:4px 6px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--mut);font-weight:600}.tn{font-variant-numeric:tabular-nums;white-space:nowrap}
.v-sup{color:var(--sup);font-weight:600}.v-ref{color:var(--ref);font-weight:600}.v-qual{color:var(--qual);font-weight:600}.v-unr{color:var(--unr)}
.ok{color:var(--ok);font-weight:700}.bad{color:var(--bad);font-weight:700}.muted{color:var(--mut)}
.note{color:var(--mut);font-size:12px;margin-top:8px;line-height:1.45}
.warn,.wiki{color:var(--bad);font-size:10px;text-transform:uppercase;letter-spacing:.03em}.wiki{color:var(--qual)}
</style></head><body>
<h1>Pass B — B2 v1 vs v2</h1>
<p class="sub">${esc(rows.length)} works · each v1/v2 pair built from the SAME B1 grounding + catalog + legacy (input digest bound per row) · the B2 prompt/schema/validator is the only deliberate variable. Generation + live web are stochastic, so this is a paired qualitative comparison, not a literal single-variable experiment. Quarantined; no merge.</p>
<div class="summary">
  <div>Research volume — v1: <b>${totV1}</b> searches / <b>${totV1f}</b> pages retrieved (of ${totV1fa} tried) &nbsp;→&nbsp; v2: <b>${totV2}</b> searches / <b>${totV2f}</b> pages retrieved (of ${totV2fa} tried), across ${rows.length} works.</div>
  <div>v2 strict-valid: <b>${rows.filter((r) => r.v2Valid).length}/${rows.length}</b> · v2 high-conf refutations without a corroborating (non-Wikipedia/non-UGC) source: <b class="${rows.reduce((a, r) => a + (r.v2?.metrics?.hiConfRefutedWithoutCorroboratingSource || 0), 0) ? 'bad' : 'ok'}">${rows.reduce((a, r) => a + (r.v2?.metrics?.hiConfRefutedWithoutCorroboratingSource || 0), 0)}</b> (schema-enforced 0).</div>
  <div class="note">Strict-valid means shape + reference integrity, NOT that every claim is entailed by its cited page — human review remains the factual gate. "Corroborating source" currently guarantees non-Wikipedia/non-UGC, not a positive museum/scholarly allowlist (pending owner decision).</div>
</div>
${cards}
</body></html>`;

const outPath = join(dir, 'b2-v1-vs-v2.html');
writeFileSync(outPath, html);
console.log(`wrote ${outPath}`);
