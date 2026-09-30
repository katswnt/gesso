// Offline edit pass for the repaired B4 run (b4r-8f1f74ddc30f).
// NO model, NO network, NO merge. Reads the PRESERVED b4r completions (immutable),
// applies ONLY fully-authorized edits, re-validates strict + leak-gates, and writes
// QUARANTINED approved-DRAFT records + a review diff. Nothing here touches production
// or the preserved works/ completions.
//
// Authorized scope (owner messages, verbatim intent):
//   A) The 10 deferred-conflict research resolutions + the owner's editorial ruling
//      ("Adopt / Adopt cautiously / hedge / deprioritize / drop"), tagging each
//      visible-in-image vs established-by-research.
//   B) Finding-3 hedges: revise the handful of claims that blur "visible" with
//      "researched" (owner's Codex-relayed list), preserving sourced teaching.
// NOT in scope here (needs owner input, deliberately left untouched):
//   - The 20 remaining visible-vs-research conflicts (browser verdicts never submitted).
//   - #2 targeted re-localization (model calls).
//   - #3 met450509 legacy guide re-insertion (optional; needs legacy guide text + go).

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { validateStageBody } from './lib/vision-content-schema.mjs';
import { scanTeachEntry } from './lib/public-output-leak.mjs';

const RUN = 'data/incoming/vision-calibration/b4r-8f1f74ddc30f';
const SRC = `${RUN}/works`;
const OUT = `${RUN}/approved-draft`;
mkdirSync(OUT, { recursive: true });

// ---- A) RESOLUTIONS: keyed by workId -> [{ field, status, resolution, tag }] ----
// tag: 'research' (established-by-research) or 'visible' (visible-in-image).
// status 'resolved' requires a non-empty resolution (validateB4 conflict rule).
const RES = 'research';
const RESOLUTIONS = {
  'met247010': [{ field: 'red pigment identification (cinnabar vs red ochre)', status: 'resolved', tag: RES,
    resolution: 'ADOPT. The red is cinnabar (natural vermilion, HgS). Established by research (Met publication), not by appearance alone.' }],
  'met256169': [{ field: 'kantharos iconographic association with Dionysos', status: 'resolved', tag: RES,
    resolution: 'ADOPT. The kantharos is an attribute associated with Dionysos (iconographic association) — this does not assert the cup depicts him. Established by research (Harvard object record).' }],
  'wikidata:Q17021261': [{ field: 'secondAttribute', status: 'resolved', tag: RES,
    resolution: 'ADOPT. Sickle (harpe) in the right hand, mace in the left — known iconography, not a legible label. Established by research (British Museum record; page Cloudflare-blocked, confirmed via snippet).' }],
  'wikidata:Q4950181': [{ field: 'redCoatIdentity', status: 'resolved', tag: RES,
    resolution: 'ADOPT. The red-coated figures are postmen (GPO postal carriers), not soldiers. Established by research (NGA record 403-blocked; confirmed via eMelbourne reference).' }],
  'wikidata:Q56825917': [{ field: 'relocationYear', status: 'resolved', tag: RES,
    resolution: 'ADOPT CAUTIOUSLY. Sculpture relocated to Vladslo in 1956 (with the graves); note that the graves themselves may have moved in 1954. Established by research (Volksbund cemetery authority).' }],
  'wikidata:Q48881623': [{ field: 'production context — imperial kiln', status: 'resolved', tag: RES,
    resolution: 'HEDGE (owner ruling). Keep Guangxu-reign (1875-1908) marked porcelain, cong/zong form; hedge kiln status. REFINEMENT FOR OWNER: the primary NPM object record shows only the reign mark, no imperial-kiln/Jingdezhen — recommend DROPPING the imperial-kiln claim outright. Established by research (NPM record).' }],
  'http://www.wikidata.org/entity/Q63247474': [{ field: 'divine beard type', status: 'resolved', tag: RES,
    resolution: 'HEDGE (owner ruling). Do not assert straight-vs-curved beard type. REFINEMENT FOR OWNER: the MAHG record identifies the head as a deified Amenemhat III and the beard is preserved (not a stub), type uncharacterized — divinity comes from the catalog, not the beard. Established by research (MAHG Geneva record).' }],
  'met57329': [{ field: 'school', status: 'resolved', tag: RES,
    resolution: 'DEPRIORITIZE in player copy. Zeshin trained in the Maruyama-Shijo school; cut unless it directly improves a teaching question (it is biography, not a visibly transferable lesson). Established by research (tertiary; upgrade if retained).' }],
  'wd:Q7166365': [{ field: 'location / where made', status: 'resolved', tag: RES,
    resolution: 'DEPRIORITIZE in player copy. Made in Carmel, California; cut unless it directly improves a teaching question (location fact, not a visibly transferable lesson). Established by research (tertiary; upgrade if retained).' }],
  'aic124043': [{ field: 'Inscription application method', status: 'resolved', tag: RES,
    resolution: 'DROP. Do not assert stylus-vs-pencil in player copy; Atget used both (negative-scratched numbers + verso pencil). Refer to it simply as Atget’s catalogue number. Established by research (tertiary; dropped anyway).' }],
};

// ---- B) FINDING-3 HEDGES: exact find/replace on body player copy ----
// Each: { work, locator, find, replace, why }. Applied only if `find` occurs EXACTLY once.
// locator is informational; the applier searches all player-copy string fields.
const HEDGES = [
  { work: 'wikidata:Q15284134', why: 'staining cause is research/inference, not a visible fact',
    find: 'iron oxide from prolonged outdoor exposure — the lion spent centuries outside at Knidos before reaching London in 1859.',
    replace: 'consistent with iron-oxide staining from prolonged outdoor exposure — the lion spent centuries outside at Knidos before reaching London in 1859.' },
  { work: 'wikidata:Q15284134', why: 'staining identity is inferred from research, not established by pixels',
    find: 'The warm orange-brown staining is iron oxide — a mineral deposit that builds up over prolonged outdoor exposure, especially in wet Mediterranean climates.',
    replace: 'The warm orange-brown staining is consistent with iron-oxide buildup — a mineral deposit that forms over prolonged outdoor exposure, especially in wet Mediterranean climates.' },
  { work: 'met450509', why: 'cause of central wear is inference, not visibly established',
    find: 'reflects heavy foot traffic accumulated over centuries — the center of a large carpet endures the most use.',
    replace: 'is consistent with heavy foot traffic accumulated over centuries — the center of a large carpet endures the most use.' },
  { work: 'met450509', why: 'workshop/drawn-cartoon is a sourced conclusion, not visible',
    find: 'and is evidence of a professional workshop executing a drawn cartoon',
    replace: 'and suggests a professional workshop working from a drawn cartoon' },
  { work: 'wikidata:Q110776566', why: 'authorial intent is an interpretation (Symbolist reading), hedge it',
    find: 'to express anxiety about female power',
    replace: 'in what is read as an expression of anxiety about female power' },
  { work: 'cleveland125571', why: 'type-not-portrait is an art-historical reading, hedge the certainty',
    find: 'is not a portrait but a visual formula for beauty codified in Persian poetry and painting.',
    replace: 'reads less as an individual portrait than as a visual formula for beauty codified in Persian poetry and painting.' },
  { work: 'wikidata:Q1211814', why: 'meaningfulness is interpretive, soften "almost certainly"',
    find: 'and its placement here is almost certainly meaningful rather than',
    replace: 'and its placement here is likely meaningful rather than' },
];

// ---- helpers ----
const safe = id => id.replace(/[^a-z0-9]+/gi, '_');
const PLAYER_STRING_PATHS = body => {
  const cells = [];
  if (typeof body.proposedWhy === 'string') cells.push(['proposedWhy', () => body.proposedWhy, v => { body.proposedWhy = v; }]);
  (body.proposedCues || []).forEach((c, i) => cells.push([`proposedCues[${i}]`, () => body.proposedCues[i], v => { body.proposedCues[i] = v; }]));
  (body.notes || []).forEach((n, i) => {
    cells.push([`notes[${i}].head`, () => body.notes[i].head, v => { body.notes[i].head = v; }]);
    cells.push([`notes[${i}].body`, () => body.notes[i].body, v => { body.notes[i].body = v; }]);
  });
  (body.guide || []).forEach((g, i) => {
    cells.push([`guide[${i}].q`, () => body.guide[i].q, v => { body.guide[i].q = v; }]);
    cells.push([`guide[${i}].a`, () => body.guide[i].a, v => { body.guide[i].a = v; }]);
  });
  return cells;
};

const results = [];
for (const f of readdirSync(SRC)) {
  const rec = JSON.parse(readFileSync(`${SRC}/${f}`, 'utf8'));
  if (!rec.body) continue; // quarantined record — nothing to edit
  const id = rec.id;
  const body = structuredClone(rec.body);
  const applied = { resolutions: [], hedges: [], misses: [] };

  // A) resolutions
  for (const r of (RESOLUTIONS[id] || [])) {
    const c = (body.conflicts || []).find(x => x.field === r.field);
    if (!c) { applied.misses.push(`resolution field not found: ${r.field}`); continue; }
    if (c.status !== 'humanReview') { applied.misses.push(`resolution field not humanReview: ${r.field} (${c.status})`); continue; }
    c.status = 'resolved';
    c.resolution = r.resolution.slice(0, 800);
    applied.resolutions.push({ field: r.field, tag: r.tag, resolution: c.resolution });
  }

  // B) hedges
  for (const h of HEDGES.filter(x => x.work === id)) {
    const cells = PLAYER_STRING_PATHS(body);
    const matches = cells.filter(([, get]) => (get() || '').includes(h.find));
    if (matches.length !== 1) { applied.misses.push(`hedge match=${matches.length} for "${h.find.slice(0, 40)}..."`); continue; }
    const [loc, get, set] = matches[0];
    set(get().replace(h.find, h.replace));
    applied.hedges.push({ locator: loc, why: h.why, from: h.find, to: h.replace });
  }

  if (!applied.resolutions.length && !applied.hedges.length && !applied.misses.length) continue;

  // re-validate strict + leak gate
  const v = validateStageBody('B4', body);
  const leaks = [];
  const scan = scanTeachEntry({
    why: body.proposedWhy,
    cues: body.proposedCues,
    notes: (body.notes || []).map(n => ({ head: n.head, body: n.body })),
    guide: (body.guide || []).map(g => ({ q: g.q, a: g.a })),
  });
  if (scan && scan.length) leaks.push(...scan);

  // write quarantined approved-draft record (body + editPass sidecar; preserved completion untouched)
  const draft = {
    id, sourceRun: 'b4r-8f1f74ddc30f', kind: 'approved-draft',
    note: 'OFFLINE edit pass. Quarantined. Not merged. Preserved B4 completion unchanged.',
    editPass: applied,
    strictValid: v.ok, strictErrors: v.ok ? [] : v.errors,
    leakClean: leaks.length === 0, leaks,
    b4CompletionSha: rec.evidence?.b4CompletionSha || rec.source?.b4CompletionSha || null,
    body,
  };
  writeFileSync(`${OUT}/${safe(id)}.approved.json`, `${JSON.stringify(draft, null, 1)}\n`);
  results.push({ id, res: applied.resolutions.length, hedges: applied.hedges.length, misses: applied.misses, strictValid: v.ok, leakClean: leaks.length === 0 });
}

// summary
const okAll = results.every(r => r.strictValid && r.leakClean && !r.misses.length);
console.log(`edit pass over b4r: ${results.length} records edited -> ${OUT}`);
for (const r of results) {
  const flag = (r.strictValid && r.leakClean && !r.misses.length) ? 'OK' : 'CHECK';
  console.log(`  [${flag}] ${r.id}: ${r.res} resolution(s), ${r.hedges} hedge(s)${r.misses.length ? `, MISSES: ${r.misses.join('; ')}` : ''}${r.strictValid ? '' : ' STRICT-FAIL'}${r.leakClean ? '' : ' LEAK'}`);
}
console.log(okAll ? '\nALL edited records strict-valid + leak-clean + no misses.' : '\nSOME records need attention (see CHECK rows).');
writeFileSync(`${OUT}/edit-pass-summary.json`, `${JSON.stringify({ generated: 'offline edit pass (no model/network/merge)', run: 'b4r-8f1f74ddc30f', results }, null, 1)}\n`);
