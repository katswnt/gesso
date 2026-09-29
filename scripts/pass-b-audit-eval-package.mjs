// Auto-audit evaluation package (offline, no model calls). Assembles every player-facing component of the accepted
// structured-B4 outputs (the window run + the canary's sealed works) with the evidence it cites, joins the tracked
// known-failure labels, draws a deterministic stratified sample for owner labeling, and measures one cheap
// deterministic gate ("open-claim echo"). Output goes to a quarantined, gitignored folder.
//   node scripts/pass-b-audit-eval-package.mjs
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256, stableJson } from './lib/vision-legacy.mjs';

const ROOT = 'data/incoming/vision-calibration';
const SOURCES = [{ run: 'b4w-04b88c97e6eb', label: 'window' }, { run: 'b4s-06e99464c52b', label: 'canary', only: ['wikidata:Q16467705', 'wikidata:Q1211814'] }];
const OUT = join(ROOT, 'audit-eval-v1');
const known = JSON.parse(readFileSync('data/pass-b-audit-eval-known-failures.json', 'utf8'));

// Words that describe the pipeline or are too generic to signal a disputed claim.
const STOP = new Set(('the and for with that this from into over under than then there their they them these those have has had was were been being are is its it not but also only such which what when where while whether would could should about after before between both each more most other some very much many main large small figure figures work image visual inventory legacy notes note source sources claim claims record records catalog verified verification confirmed describe describes described shows show shown appears appear visible evidence stage content entry text model structured unresolved uncertain uncertainty possible possibly likely whether cannot identified identification based rather though because since without within specific exact exactly precise precisely').split(' '));
const words = t => new Set(String(t).toLowerCase().match(/[a-z][a-z'-]{3,}/g)?.map(w => w.replace(/'s$/, '').replace(/s$/, '')).filter(w => !STOP.has(w)) || []);

function componentsOf(body) {
  const out = [{ componentId: 'why', surface: 'why', text: typeof body.proposedWhy === 'string' ? body.proposedWhy : '' }];
  (body.proposedCues || []).forEach((c, i) => out.push({ componentId: `cue:c_${sha256(`${i}|${c}`).slice(0, 10)}`, surface: 'cue', text: c }));
  for (const n of body.notes || []) out.push({ componentId: `note:${n.noteId}`, surface: 'note', text: `${n.head} — ${n.body}` });
  for (const g of body.guide || []) out.push({ componentId: `guide:${g.questionId}`, surface: 'guide', text: `${g.q} || ${g.a}` });
  for (const h of body.hotspots || []) out.push({ componentId: `hotspot:${h.hotspotId}`, surface: 'hotspot', text: `${h.conciseText} — ${h.deepText}` });
  return out.filter(c => c.text);
}

const works = [];
for (const src of SOURCES) {
  const dir = join(ROOT, src.run, 'works'); if (!existsSync(dir)) continue;
  for (const w of readdirSync(dir)) for (const f of readdirSync(join(dir, w)).filter(x => /^attempt-\d+\.result\.json$/.test(x))) {
    const r = JSON.parse(readFileSync(join(dir, w, f), 'utf8'));
    const meta = JSON.parse(readFileSync(join(dir, w, f.replace('result.json', 'meta.json')), 'utf8'));
    if (r.kind !== 'accepted' || !r.body || !r.bundle || (src.only && !src.only.includes(meta.workId))) continue;
    works.push({ workId: meta.workId, source: src.label, run: src.run, body: r.body, bundle: r.bundle });
  }
}

const items = [];
for (const w of works) {
  const b = w.bundle, claims = new Map(b.claimAssertions.map(c => [c.claimId, c])), obs = new Map(b.observations.map(o => [o.observationId, o]));
  const grounding = new Map(b.components.map(c => [c.componentId, c]));
  // Terms that appear ONLY in the work's open claims / conflicts, never in its supported claims or its observations.
  const supportedText = [...b.claimAssertions.filter(c => ['supported', 'qualified', 'partlySupported'].includes(c.proposedVerdict)).map(c => c.proposition), ...b.observations.map(o => o.proposition)].join(' ');
  const supportedWords = words(supportedText);
  const disputed = new Set([...b.openClaims.map(o => o.proposition), ...b.conflicts.map(c => `${c.left} ${c.right}`)].flatMap(t => [...words(t)]).filter(t => !supportedWords.has(t)));
  for (const c of componentsOf(w.body)) {
    const g = grounding.get(c.componentId) || {};
    const echo = [...words(c.text)].filter(t => disputed.has(t));
    const label = known.items.find(k => k.workId === w.workId && k.componentId === c.componentId);
    items.push({
      workId: w.workId, source: w.source, componentId: c.componentId, surface: c.surface, text: c.text,
      cites: {
        claims: (g.claimRefs || []).map(id => claims.get(id)).filter(Boolean).map(x => ({ id: x.claimId, proposition: x.proposition, verdict: x.proposedVerdict, confidence: x.confidence, sources: x.sourceRefs })),
        observations: (g.observationRefs || []).map(id => obs.get(id)).filter(Boolean).map(x => ({ id: x.observationId, by: x.principal, proposition: x.proposition })),
      },
      openClaims: b.openClaims.filter(o => o.workScope || (o.componentRefs || []).includes(c.componentId)).map(o => o.proposition),
      conflicts: b.conflicts.filter(x => x.workScope || (x.componentRefs || []).includes(c.componentId)).map(x => `${x.left} vs ${x.right}`),
      gate: { openClaimEcho: echo.length ? 'hold' : 'pass', echoTerms: echo },
      expected: label ? label.expected : null, expectedClass: label?.class ?? null, expectedWhy: label?.why ?? null,
    });
  }
}

// Deterministic stratified sample for owner labeling (window works only, unlabeled components).
const QUOTA = { why: 6, cue: 4, note: 10, guide: 8, hotspot: 6 };
const pool = items.filter(i => i.source === 'window' && !i.expected).sort((a, b) => sha256(`${a.workId}|${a.componentId}`).localeCompare(sha256(`${b.workId}|${b.componentId}`)));
const sample = []; const perWork = new Map();
for (const [surface, n] of Object.entries(QUOTA)) for (const it of pool.filter(i => i.surface === surface)) {
  if (sample.filter(s => s.surface === surface).length >= n) break;
  if ((perWork.get(it.workId) || 0) >= 2) continue; // spread across works
  perWork.set(it.workId, (perWork.get(it.workId) || 0) + 1); sample.push(it);
}

const knownItems = items.filter(i => i.expected);
const report = {
  version: 'passBAuditEvalPackage/1', createdAt: new Date().toISOString(), sources: SOURCES.map(s => s.run),
  works: works.length, components: items.length, bySurface: Object.fromEntries(Object.keys(QUOTA).map(s => [s, items.filter(i => i.surface === s).length])),
  knownLabels: knownItems.length, knownLabelsFound: `${knownItems.length}/${known.items.length}`,
  deterministicGate: {
    name: 'open-claim echo (component uses a term found only in the work\'s own open claims/conflicts)',
    caughtKnownHolds: `${knownItems.filter(i => i.expected === 'hold' && i.gate.openClaimEcho === 'hold').length}/${knownItems.filter(i => i.expected === 'hold').length}`,
    heldOverHoldingControls: knownItems.filter(i => i.expected !== 'hold' && i.gate.openClaimEcho === 'hold').length,
    holdRateAllComponents: `${items.filter(i => i.gate.openClaimEcho === 'hold').length}/${items.length}`,
    caveat: 'Hold rate on unlabeled components is NOT a false-positive rate: some held components may be genuinely unsupported. Owner labels on the sample measure that.',
  },
  ownerSample: sample.length,
  note: 'Offline package; no model calls. Accepted B4 = structural validity only, not publication approval.',
};
mkdirSync(OUT, { recursive: true, mode: 0o700 });
writeFileSync(join(OUT, 'package.json'), `${JSON.stringify({ report, items }, null, 1)}\n`);
writeFileSync(join(OUT, 'owner-sample.json'), `${JSON.stringify(sample.map(s => ({ workId: s.workId, componentId: s.componentId, surface: s.surface, text: s.text, cites: s.cites, openClaims: s.openClaims, gate: s.gate })), null, 1)}\n`);
console.log(JSON.stringify(report, null, 1));
for (const k of knownItems) console.log(`${k.expected.padEnd(15)} gate=${k.gate.openClaimEcho.padEnd(4)} ${k.workId} ${k.componentId} echo=[${k.gate.echoTerms.join(',')}]`);
