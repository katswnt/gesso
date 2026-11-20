// Catalog support/date conflicts (VSD-089): the support classifier, B2 and Wikidata conflict rules, the committed
// baseline, and the gate failing on a NEW conflict. Run: node tests/catalog-support.test.mjs
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { supportClass, b2Conflicts, wikidataConflicts, knownConflicts, contradictedFields } from '../scripts/lib/catalog-support.mjs';
import { auditConflicts, buildSnapshot } from '../scripts/audit-medium-support.mjs';

let pass = 0; const fail = m => { console.error('❌ catalog-support:', m); process.exit(1); };
const eq = (got, want, msg) => { if (JSON.stringify(got) !== JSON.stringify(want)) fail(`${msg}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); pass++; };

// supportClass: the primary support, edge cases included
eq(supportClass('Oil on canvas'), 'canvas', 'plain canvas');
eq(supportClass('Oil on oak panel'), 'panel', 'oak panel');
eq(supportClass('Oil on wood'), 'panel', 'on wood is a panel');
eq(supportClass('Wood'), null, 'a carved wood figure has no painted support');
eq(supportClass('Oil on canvas, mounted on panel'), 'canvas', 'first support wins over the mount');
eq(supportClass('Oil on paper laid down on canvas'), 'paper', 'paper laid down');
eq(supportClass('Oil on panel, transferred to canvas'), 'canvas', 'a transfer replaces the support');
eq(supportClass('transferred on canvas; oil paint'), 'canvas', 'Wikidata transfer wording');
eq(supportClass('panel; oil paint'), 'panel', 'Wikidata materials list');
eq(supportClass('paper; panel'), null, 'two supports without "on" are ambiguous');
eq(supportClass('Oil on cardboard'), 'board', 'cardboard is board, not paper');
eq(supportClass('Copper engraving'), null, 'an engraving plate is not a support');
eq(supportClass('Oil on copper'), 'copper', 'painted on copper');
eq(supportClass('Bronze'), null, 'no support');
eq(supportClass(''), null, 'empty');

// B2: mediumFull support differs; a refuted claim stating the catalog year as the date of making
const cat = { title: 'T', artist: 'A', date: '1884', place: 'P', medium: 'Oil on canvas', style: 'S', catalogId: 'w1' };
eq(Object.keys(b2Conflicts(cat, { catalog: { mediumFull: 'Oil on poplar panel' } })), ['medium'], 'B2 panel vs canvas');
eq(b2Conflicts(cat, { catalog: { mediumFull: 'Oil on linen canvas' } }), {}, 'linen is canvas');
eq(Object.keys(b2Conflicts(cat, { catalog: {}, factChecks: [{ claim: 'The painting was made in 1884.', verdict: 'refuted' }] })), ['date'], 'refuted making date');
eq(b2Conflicts(cat, { catalog: {}, factChecks: [{ claim: 'The painting was made in 1884.', verdict: 'qualified' }] }), {}, 'only refuted counts');
eq(b2Conflicts(cat, { catalog: {}, factChecks: [{ claim: 'It was found in 1884 in a Paris attic.', verdict: 'refuted' }] }), {}, 'a refuted claim about something else');
eq(b2Conflicts(cat, { catalog: {}, factChecks: [{ claim: 'It was painted in 18840 copies.', verdict: 'refuted' }] }), {}, 'year must be a whole number');

// Wikidata: support and year with precision tolerance and cache artifacts
const p = { id: 'w1', medium: 'Oil on canvas', y: 1520 };
eq(Object.keys(wikidataConflicts(p, { support: 'panel', year: 1522 })), ['medium'], 'support conflict, year within 10');
eq(wikidataConflicts(p, { support: 'canvas', year: 1600 }), {}, 'round Wikidata year = century precision');
eq(Object.keys(wikidataConflicts(p, { year: 1650 })), ['date'], 'beyond the half-century tolerance');
eq(wikidataConflicts({ id: 'x', medium: 'Clay', y: -539 }, { year: 539 }), {}, 'lost BCE sign is a cache artifact');
eq(wikidataConflicts({ id: 'x', medium: 'Oil on canvas', y: 1889 }, { support: 'canvas', year: 198 }), {}, 'truncated year is a cache artifact');
eq(buildSnapshot([{ id: 'wikidata:Q1' }, { id: 'met9' }], { Q1: { materials: ['poplar panel', 'oil paint'], inception: '1503-01-01T00:00:00Z' } }), { 'wikidata:Q1': { support: 'panel', year: 1503 } }, 'snapshot');

// Baseline + union, and the gate: a conflict not in the baseline is NEW
const dir = mkdtempSync(join(tmpdir(), 'catalog-support-')), file = join(dir, 'c.json');
writeFileSync(file, JSON.stringify({ conflicts: [{ id: 'w1', field: 'date', source: 'wikidata', pool: '1884', other: '1950' }] }));
const known = knownConflicts(file);
eq([...known.keys()], ['w1'], 'baseline loads');
eq([...contradictedFields(cat, { catalog: { mediumFull: 'Oil on panel' } }, known)].sort(), ['date', 'medium'], 'union of B2 and baseline');
eq([...contradictedFields({ ...cat, catalogId: 'w2' }, null, known)], [], 'no conflicts for another work');
const rows = auditConflicts([{ id: 'w1', medium: 'Oil on canvas', y: 1884 }, { id: 'w3', medium: 'Oil on panel', y: 1700 }],
  { w1: { year: 1950 }, w3: { support: 'canvas' } }, new Map());
const knownKeys = new Set(JSON.parse(JSON.stringify([{ id: 'w1', field: 'date', source: 'wikidata' }])).map(r => `${r.id}|${r.field}|${r.source}`));
eq(rows.filter(r => !knownKeys.has(`${r.id}|${r.field}|${r.source}`)).map(r => `${r.id}:${r.field}`), ['w3:medium'], 'new conflict detected by the gate');

console.log(`✅ catalog-support: ${pass} checks — support classes, B2/Wikidata conflict rules, baseline gate`);
