// Catalog support/date audit (VSD-089, owner-approved 2026-11-20). Compares each pool work's physical support
// (canvas vs panel vs paper vs copper vs board) and year against Wikidata, and against B2's researched mediumFull and
// refuted date claims where local Pass B evidence exists. Reports only: live catalog fixes go to main by a separate PR.
//   node scripts/audit-medium-support.mjs              # report
//   node scripts/audit-medium-support.mjs --snapshot   # refresh data/wikidata-support.json from data/incoming/wd-entities.json
//   node scripts/audit-medium-support.mjs --write      # regenerate the committed baseline data/catalog-support-conflicts.json
//   node scripts/audit-medium-support.mjs --check      # gate (npm test): fail on any conflict not in the baseline
// The gate's Wikidata side reads only the tracked snapshot, so it is stable without data/incoming. The B2 side runs only
// when local evidence exists; baseline B2 entries never fail the gate when the evidence is absent.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { supportClass, wikidataConflicts, b2Conflicts, CONFLICTS_FILE } from './lib/catalog-support.mjs';
import { trustedCatalog } from './lib/pass-b-calibration.mjs';

const SNAPSHOT = 'data/wikidata-support.json', ENTITIES = 'data/incoming/wd-entities.json';
const EVIDENCE = 'data/incoming/vision-calibration';
const loadGlobal = (file, name) => { const w = {}; new Function('window', readFileSync(file, 'utf8'))(w); return w[name]; };
const qidOf = p => (String(p.id).match(/^(?:wikidata:|wd:|https?:\/\/(?:www\.)?wikidata\.org\/entity\/)(Q\d+)$/i) || [])[1] || p.wikidataid || null;

// Compact tracked Wikidata view: { workId: { support, year } } for pool works the local cache knows.
export function buildSnapshot(pool, entities) {
  const out = {};
  for (const p of pool) {
    const e = entities[qidOf(p)]; if (!e) continue;
    const support = e.materials?.length ? supportClass(e.materials.join('; ')) : null;
    const m = /^([+-]?\d{1,4})-/.exec(String(e.inception || '')), year = m ? Number(m[1]) : null;
    if (support || year != null) out[p.id] = { ...(support ? { support } : {}), ...(year != null ? { year } : {}) };
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

// Latest local B2 body per work id (any corpus run), or an empty map without evidence.
export function localB2() {
  const out = new Map();
  if (!existsSync(EVIDENCE)) return out;
  for (const run of readdirSync(EVIDENCE).filter(d => d.startsWith('corpus-b3')).sort()) {
    const wd = join(EVIDENCE, run, 'works'); if (!existsSync(wd)) continue;
    for (const k of readdirSync(wd)) {
      const c = join(wd, k, 'completions'); if (!existsSync(c)) continue;
      const f = readdirSync(c).find(x => x.startsWith('b2-')); if (!f) continue;
      const j = JSON.parse(readFileSync(join(c, f), 'utf8')); if (j.workId && !out.has(j.workId)) out.set(j.workId, j.body);
    }
  }
  return out;
}

export function auditConflicts(pool, snapshot, b2s) {
  const rows = [];
  for (const p of pool) {
    const w = wikidataConflicts(p, snapshot[p.id]);
    if (w.medium) rows.push({ id: p.id, field: 'medium', source: 'wikidata', pool: p.medium, other: snapshot[p.id].support });
    if (w.date) rows.push({ id: p.id, field: 'date', source: 'wikidata', pool: String(p.yr ?? p.y), other: String(snapshot[p.id].year) });
    const b2 = b2s.get(p.id); if (!b2) continue;
    const cat = trustedCatalog(p), b = b2Conflicts(cat, b2);
    if (b.medium) rows.push({ id: p.id, field: 'medium', source: 'b2', pool: p.medium, other: b2.catalog.mediumFull });
    if (b.date) rows.push({ id: p.id, field: 'date', source: 'b2', pool: cat.date, other: b.date.replace(/^B2 refuted /, '') });
  }
  return rows.sort((a, b) => a.id.localeCompare(b.id) || a.field.localeCompare(b.field) || a.source.localeCompare(b.source));
}
const key = r => `${r.id}|${r.field}|${r.source}`;

function main() {
  const args = process.argv.slice(2), pool = loadGlobal('data/pool.js', 'ARTEFACTUM_POOL');
  if (args.includes('--snapshot')) {
    if (!existsSync(ENTITIES)) throw new Error(`${ENTITIES} missing`);
    const snap = buildSnapshot(pool, JSON.parse(readFileSync(ENTITIES, 'utf8')));
    writeFileSync(SNAPSHOT, `${JSON.stringify({ version: 'wikidataSupport/1', from: 'wd-entities.json', works: snap }, null, 0).replace(/},"/g, '},\n"')}\n`);
    console.log(`wrote ${SNAPSHOT}: ${Object.keys(snap).length} works`); return;
  }
  const snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8')).works, b2s = localB2();
  const rows = auditConflicts(pool, snapshot, b2s);
  const count = (f, s) => rows.filter(r => r.field === f && r.source === s).length;
  const summary = `wikidata ${Object.keys(snapshot).length} works (medium ${count('medium', 'wikidata')}, date ${count('date', 'wikidata')}) | B2 ${b2s.size} works (medium ${count('medium', 'b2')}, date ${count('date', 'b2')})`;
  if (args.includes('--write')) {
    writeFileSync(CONFLICTS_FILE, `${JSON.stringify({ version: 'catalogSupportConflicts/1', note: 'Known conflicts (VSD-089). The writer withholds these catalog fields; fixes to data/pool.js go to main by PR.', conflicts: rows }, null, 1)}\n`);
    console.log(`wrote baseline: ${rows.length} conflicts | ${summary}`); return;
  }
  const known = existsSync(CONFLICTS_FILE) ? JSON.parse(readFileSync(CONFLICTS_FILE, 'utf8')).conflicts : [];
  const knownKeys = new Set(known.map(key)), fresh = rows.filter(r => !knownKeys.has(key(r)));
  if (args.includes('--check')) {
    if (fresh.length) {
      console.error(`❌ catalog support: ${fresh.length} NEW conflict(s) not in the baseline:`);
      for (const r of fresh) console.error(`  ${r.id} ${r.field} [${r.source}] pool "${r.pool}" vs "${r.other}"`);
      console.error('  fix data/pool.js (via a main PR) or, if reviewed, re-run --write'); process.exit(1);
    }
    console.log(`✅ PASS — catalog support: no new conflicts (${rows.length} known) | ${summary}`); return;
  }
  for (const r of rows) console.log(`${r.id}\t${r.field}\t${r.source}\tpool "${r.pool}"\tvs "${r.other}"`);
  console.log(`${rows.length} conflicts (${fresh.length} new) | ${summary}`);
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) main();
