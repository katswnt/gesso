// VSD-037 offline owner-review regeneration (no model calls). For the two fresh runs it shows: the flawed
// proposed copy, the deterministic precedence/omission result (removed false claims + held-for-review pins), an AUTHORED
// corrected candidate (from the sealed audit ground truth + retrieval-hash-bound authoritative spans, unpinned),
// the reconciliation readiness, the blocked-findings verdict, and the exact owner decisions required. All owner
// decisions and blocked-finding resolutions remain empty. Also preserves both failed runs as regression fixtures.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { sha256, stableJson } from './lib/vision-legacy.mjs';
import { projectToProduction } from './lib/pass-b-approval.mjs';
import { applyPrecedence, assertNoDisputedAffirmative } from './lib/pass-b-identity-precedence.mjs';
import { loadCanonicalFindings, findingsForWork } from './lib/pass-b-blocked-findings.mjs';

// The VSD-037 owner-REVIEW projection, composed here (NOT in guarded approval): project to production, then
// apply the conservative identity omission and assert the fail-closed gate. Review aid only.
function projectForReview(b4, conflicts, blockedClaims) {
  const projected = projectToProduction(b4);
  const precedence = applyPrecedence({ projected, conflicts, blockedClaims });
  assertNoDisputedAffirmative(precedence);
  return { teach: precedence.affirmative.teach, hotspots: precedence.affirmative.hotspots, precedence };
}

const RUN_ID = 'cr2-af3d6ed79c1c';
const FAILED_CONFORMANCE_RUN = 'cr2-bc45fa3a2cd6';
const RUN_DIR = join('data/incoming/vision-calibration', RUN_ID);
const OUT_DIR = join(RUN_DIR, 'owner-review');
const FIX_DIR = 'tests/fixtures/pass-b-content-repair';
const WORKS = [
  { name: 'La Gloire', workId: 'wikidata:Q16467705' },
  { name: 'St. John Chrysostom', workId: 'wikidata:Q1211814' },
];
const wdirOf = (workId) => join(RUN_DIR, 'works', sha256(workId).slice(0, 24));
const b4BodyOf = (workId) => { const d = join(wdirOf(workId), 'completions'); const f = readdirSync(d).find((x) => x.startsWith('b4-')); return JSON.parse(readFileSync(join(d, f), 'utf8')); };

// AUTHORED corrected candidates — grounded ONLY in the sealed audit ground truth + the retrieval-hash-bound
// authoritative spans available offline. Presented as owner-review CANDIDATES (not model output, not approved).
// Both are UNPINNED: the model's visual binding is unreliable/wrong, so we keep the knowledge and hold the pin.
const CANDIDATES = {
  'wikidata:Q16467705': {
    authority: 'sealed audit finding cb-273b4c707b9c (audit-confirmed against the Musée Carnavalet record) + in-run spans',
    sourceTierNote: 'DEFINITIVE primary span (Musée Carnavalet catalogue) is ABSENT from the offline evidence and is a REQUIRED fetch/owner step before ship. In-run retrieved spans are Wikipedia (en/fr) + a UGC site (weak tier); they support maker/subject only, not the figure binding.',
    binding: 'unpinned — the model inverted the two figures; region binding UNRESOLVED',
    why: "A plaster maquette (c. 1906) by Frédéric Brou for an unrealized funerary monument to the Symbolist writer Villiers de l'Isle-Adam. Its title names the action: Glory drawing the writer from his eternal sleep.",
    notes: [
      { head: 'Who the two figures are', body: "Below is the allegory of Glory — a nude/draped woman reaching upward. Above is Villiers, a clothed man, asleep in the coffin. Glory pulls the writer from his eternal sleep.", pinned: false },
      { head: 'An unrealized monument', body: 'The plaster is a model for a funerary monument to Villiers that was never built; the attribution to Brou rests on Salon and monument-committee documents.', pinned: false },
    ],
    guide: [{ q: 'What is this, and what is it made of?', a: "A plaster maquette by Frédéric Brou for an unbuilt monument to the writer Villiers de l'Isle-Adam." }],
    excludedByGroundTruth: ['skull', 'skull-bearing child', 'memento-mori / vanitas', 'transi / cadaver reading', 'wings on any figure', 'nude male below', 'carved wood / mixed-media medium', 'reversed figure roles'],
  },
  'wikidata:Q1211814': {
    authority: 'authoritative in-run span src-01 (Cleveland Museum of Art, acc. 1934.339) + sealed audit finding cb-d4c407b953ac',
    sourceTierNote: 'Cleveland Museum span is authoritative and retrieval-hash-bound; it establishes maker/medium/subject. It does not localize the crawling figure — B3 could not confirm its position.',
    binding: 'unpinned — B3 could not localize the crawling human; region binding UNRESOLVED',
    why: "An engraving (c. 1497) by Albrecht Dürer, 'The Penance of St. John Chrysostom.' It illustrates a medieval legend in which the penitent atones by crawling on the ground and refusing to look at the sky until he is absolved.",
    notes: [
      { head: 'The crawling figure is a man', body: 'The figure on the ground is the human penitent of the legend, crawling on all fours as atonement — the subject of the scene, not an animal.', pinned: false },
      { head: "Dürer's engraved line", body: 'Fine burin crosshatching builds continuous tone and a deep landscape entirely without color, characteristic of Dürer’s mature printmaking.', pinned: false },
    ],
    guide: [{ q: 'Who is the figure crawling on the ground?', a: 'The human penitent of the legend, atoning by crawling on all fours — not an animal.' }],
    excludedByGroundTruth: ['lion', 'lion-like animal', 'quadruped', 'any animal/species language for the penitent'],
  },
};

function preserveFixtures(rows) {
  mkdirSync(FIX_DIR, { recursive: true });
  const manifest = { version: 'passBContentRepairFixtures/1', note: 'VSD-034/037 fixtures. The two content-repair-failure B4 bodies below are tested regressions (see tests/pass-b-identity-precedence.test.mjs). The conformance-failure run is REFERENCE evidence only — its failing run is not test-asserted here (no hydrated body was produced to preserve).', runs: [] };
  manifest.runs.push({ runId: FAILED_CONFORMANCE_RUN, kind: 'reference-evidence-not-tested', demonstrates: 'corrective B1-B3 completed; B4 (La Gloire) + B2 (St John) fail-closed on schema caps/id-namespace — no hydrated content produced; referenced for provenance, not asserted by a test' });
  for (const r of rows) {
    const path = join(FIX_DIR, `${sha256(r.workId).slice(0, 12)}.b4-body.json`);
    writeFileSync(path, `${JSON.stringify({ runId: RUN_ID, workId: r.workId, name: r.name, b4Body: r.b4Body, note: 'content-repair FAILURE: fresh run re-introduced the sealed false claims (see disputedAxes/removedFalseClaims). Preserved as regression fixture.' }, null, 1)}\n`);
    manifest.runs.push({ runId: RUN_ID, workId: r.workId, kind: 'content-repair-failure', b4BodyFixture: path, disputedAxes: r.precedence.precedence.disputedAxes, removedFalseClaims: r.precedence.precedence.disputedDiagnostic.map((d) => `${d.surface}:${(d.text || '').slice(0, 60)}`) });
  }
  writeFileSync(join(FIX_DIR, 'fixtures.json'), `${JSON.stringify(manifest, null, 1)}\n`);
  return manifest;
}

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const findings = loadCanonicalFindings();
  const rows = [];
  for (const w of WORKS) {
    const b4Body = b4BodyOf(w.workId).body;
    const conflicts = b4Body.conflicts || [];
    const forWork = findingsForWork(findings, w.workId);
    const blockedClaims = forWork.flatMap((f) => f.blockedClaims);
    const flawed = projectToProduction(b4Body); // the proposed copy AS GENERATED (with false claims)
    const precedence = projectForReview(b4Body, conflicts, blockedClaims); // review-only omission + fail-closed gate
    const spanFile = join(OUT_DIR, `${sha256(w.workId).slice(0, 12)}.source-spans.json`);
    const spans = existsSync(spanFile) ? JSON.parse(readFileSync(spanFile, 'utf8')).spans : [];
    rows.push({ ...w, b4Body, flawed, precedence, candidate: CANDIDATES[w.workId], spans, forWork });
    console.log(`\n=== ${w.name} ===`);
    console.log(`  disputed identity axes: ${precedence.precedence.disputedAxes.join(', ')}`);
    console.log(`  false claims removed from affirmative copy: ${precedence.precedence.disputedDiagnostic.length}`);
    console.log(`  bindings held for owner review (not adjudicated): ${precedence.precedence.heldPins.length}`);
    console.log(`  post-omission affirmative notes surviving from the run: ${precedence.teach.notes.length} (candidate copy is authored separately, unpinned)`);
    console.log(`  blocked finding: ${forWork.map((f) => f.findingId).join(',')} (${blockedClaims.length} sealed claims) — decisions/resolutions EMPTY`);
  }
  const fixtures = preserveFixtures(rows);
  writeOwnerReview(rows);
  console.log(`\nfixtures: ${join(FIX_DIR, 'fixtures.json')} (${fixtures.runs.length} run entries)`);
  console.log(`owner review v2: ${join(OUT_DIR, 'owner-review-v2.html')}`);
}

function writeOwnerReview(rows) {
  const sections = rows.map((r) => {
    const c = r.candidate; const p = r.precedence.precedence;
    const removed = p.disputedDiagnostic.map((d) => `<li><span class="axis">${esc(d.axes.join('/'))}</span> <b>${esc(d.surface)}:</b> ${esc((d.text || '').slice(0, 140))}</li>`).join('');
    const candNotes = c.notes.map((n) => `<li><b>${esc(n.head)}</b> <span class="pin">${n.pinned ? 'pinned' : 'UNPINNED'}</span><br>${esc(n.body)}</li>`).join('');
    const candGuide = c.guide.map((g) => `<li><b>${esc(g.q)}</b><br>${esc(g.a)}</li>`).join('');
    const excluded = c.excludedByGroundTruth.map((x) => `<li>${esc(x)}</li>`).join('');
    const spanRows = r.spans.filter((s) => s.recovered).map((s) => `<tr><td>${esc(s.atomicClaim || '')}</td><td>${esc(s.sourceId)}<br><a href="${esc(s.url)}">${esc((s.title || '').slice(0, 44))}</a></td><td><code>${esc((s.retrievedContentSha256 || '').slice(0, 12))}</code><br><span class="ex">${esc((s.excerpt || '').slice(0, 160))}</span></td></tr>`).join('');
    const sealed = r.forWork[0].blockedClaims.map((x) => `<li>${esc(x)}</li>`).join('');
    return `<section>
      <h2>${esc(r.name)} <span class="qid">${esc(r.workId)}</span></h2>
      <p class="verdict bad">content-repair FAILURE (fresh run re-introduced sealed errors) · caught by every layer · blocked-findings: <b>content-blocked-work-needs-resolution</b> · reconciliation: <b>contentReadiness=blocked</b></p>
      <div class="grid">
        <div class="col">
          <h3>Corrected candidate copy <span class="tag">authored offline · for owner review · unpinned</span></h3>
          <p class="prov"><b>Authority:</b> ${esc(c.authority)}</p>
          <p class="tier"><b>Source tier:</b> ${esc(c.sourceTierNote)}</p>
          <p class="binding"><b>Binding:</b> ${esc(c.binding)}</p>
          <p class="why"><b>Why:</b> ${esc(c.why)}</p>
          <h4>Notes (all unpinned)</h4><ul>${candNotes}</ul>
          <h4>Guide</h4><ul>${candGuide}</ul>
          <h4>Excluded by ground truth (must never appear)</h4><ul class="excl">${excluded}</ul>
        </div>
        <div class="col">
          <h3>What the fresh run proposed, and what VSD-037 removed</h3>
          <p>Disputed identity axes: <b>${esc(p.disputedAxes.join(', '))}</b>. Bindings held for owner review (not individually adjudicated): <b>${p.heldPins.length}</b>.</p>
          <h4>False/disputed claims removed from affirmative copy</h4><ul class="removed">${removed || '<li><i>none</i></li>'}</ul>
          <h4>Sealed blocked claims (owner must truthfully resolve ALL to release)</h4><ul class="sealed">${sealed}</ul>
          <h3>Owner decisions required</h3>
          <ol class="todo">
            <li>Decide each disputed identity axis above; a vision-only claim may be kept only as disputed diagnostic evidence, never affirmative copy.</li>
            <li>Confirm the corrected candidate copy (or edit it) — it is authored, not model-approved.</li>
            <li>For La Gloire: obtain/attach the definitive Musée Carnavalet primary span before ship (offline evidence has only Wikipedia/UGC).</li>
            <li>Resolve region bindings: both are currently UNPINNED / unresolved — approve unpinned, or supply owner coordinates on the current image.</li>
            <li>Only then may a blocked-finding resolution attest freshRun + every sealed claim resolved. <b>All decisions/resolutions are currently EMPTY.</b></li>
          </ol>
        </div>
      </div>
      <h3>Retrieval-hash-bound authoritative/source spans</h3>
      <table><thead><tr><th>atomic claim</th><th>source</th><th>excerpt (hash-bound)</th></tr></thead><tbody>${spanRows || '<tr><td colspan=3><i>no recovered spans</i></td></tr>'}</tbody></table>
    </section>`;
  }).join('\n');
  const html = `<!doctype html><meta charset="utf-8"><title>Content-repair canary — corrected owner review (VSD-037)</title>
  <style>body{font:14px/1.55 -apple-system,system-ui,sans-serif;max-width:1120px;margin:24px auto;padding:0 18px;color:#1a1a1a}
  h1{font-size:22px}h2{font-size:18px;border-top:2px solid #ddd;padding-top:16px;margin-top:26px}.qid{font:12px monospace;color:#888}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:22px}.col h3{font-size:14px;margin:14px 0 6px}h4{font-size:12.5px;margin:10px 0 4px;color:#333}
  ul,ol{margin:4px 0;padding-left:18px}li{margin:5px 0}
  .verdict{padding:6px 10px;border-radius:4px;font-weight:600}.verdict.bad{background:#fde8e6;color:#b3261e}
  .tag{font-size:11px;background:#e8f0fe;color:#1a56b3;padding:2px 6px;border-radius:3px;font-weight:500}
  .prov,.tier,.binding{font-size:12px;background:#f6f6f6;padding:6px 8px;border-radius:4px;margin:4px 0}.tier{color:#8a5a00;background:#fff7e6}.binding{color:#5a2ca0;background:#f3ecff}
  .why{background:#eef6ee;padding:8px;border-radius:4px}.pin{font-size:10px;color:#b3261e;font-weight:700}
  .excl li,.removed li,.sealed li{color:#b3261e}.axis{font:11px monospace;background:#fde8e6;color:#b3261e;padding:1px 4px;border-radius:3px}
  table{border-collapse:collapse;width:100%;margin:8px 0 18px;font-size:12px}th,td{border:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top}th{background:#f5f5f5}
  code{font-size:11px;color:#555}.ex{color:#444;font-style:italic}.todo li{margin:6px 0}</style>
  <h1>Content-repair canary — corrected owner review (VSD-037)</h1>
  <p>Run <code>${esc(RUN_ID)}</code>. Both sealed works were re-run fresh under the corrected contract and <b>both re-introduced their canonical errors</b> — content-repair failures, safety-layer successes. Under VSD-037's conservative review projection, disputed vision-only identity/medium/iconography claims are removed from affirmative copy and <b>all bindings are held for owner review</b> (never auto-published or individually adjudicated). The corrected candidate copy below is authored offline from the sealed audit findings plus the available retrieval-hash-bound spans; <b>La Gloire's definitive Musée Carnavalet primary span remains required</b> before ship. Nothing is approved; every owner decision and blocked-finding resolution is empty. Only the two content-failure B4 bodies are asserted regression fixtures; the conformance-failure run is reference evidence only.</p>
  ${sections}`;
  writeFileSync(join(OUT_DIR, 'owner-review-v2.html'), html);
  writeFileSync(join(OUT_DIR, 'owner-review-v2.json'), `${JSON.stringify({ version: 'passBContentRepairOwnerReview/2', runId: RUN_ID, works: rows.map((r) => ({ workId: r.workId, name: r.name, disputedAxes: r.precedence.precedence.disputedAxes, removedFalseClaims: r.precedence.precedence.disputedDiagnostic, heldPinsForReview: r.precedence.precedence.heldPins.length, candidate: r.candidate, sealedClaims: r.forWork[0].blockedClaims, decisions: [], blockedFindingResolutions: [] })) }, null, 1)}\n`);
}

main();
