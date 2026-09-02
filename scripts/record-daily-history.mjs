#!/usr/bin/env node
// LEDGER-ONLY reconciliation. Copies every already-served daily-order assignment into the append-only
// data/daily-history.js and does NOTHING else — no schedule generation, no network, no image audit.
//
// WHY THIS EXISTS SEPARATELY FROM freeze: freeze regenerates the schedule (and npm run freeze also runs a
// networked image audit). Ledger upkeep is a different, cheap, offline job. Coupling them meant that simply
// letting days pass could hard-fail unrelated builds, because daily-order keeps only a short window while the
// ledger must keep everything.
//
//   node scripts/record-daily-history.mjs [--check]   read-only; exit 0 iff current, nonzero + list if not
//   node scripts/record-daily-history.mjs --write     append the missing served dates, atomically
import { readGlobal, writeAtomic } from './lib/static-module.mjs';
import { reconcile, servedThroughDate, serializeHistory, byDateOf } from './lib/daily-history.mjs';

const ORDER_PATH = 'data/daily-order.js', HISTORY_PATH = 'data/daily-history.js';
const WRITE = process.argv.includes('--write');
const die = m => { console.error('❌ ledger: ' + m); process.exit(1); };

// FAIL CLOSED on read, parse or shape. `|| {}` anywhere here would silently treat a corrupt or
// wrong-shaped source as "empty", which is exactly how a corrupt ledger could look reconcilable.
const readByDate = (file, globalName) => {
  let mod;
  try { mod = readGlobal(file, globalName); } catch (e) { die(`cannot read/parse ${file}: ${e.message}`); }
  const v = byDateOf(mod, globalName, file);
  if (!v.ok) die(v.error);
  return v.byDate;
};
const order = readByDate(ORDER_PATH, 'ARTEFACTUM_DAILY');
const history = readByDate(HISTORY_PATH, 'ARTEFACTUM_DAILY_HISTORY');

const throughDate = servedThroughDate();
const r = reconcile({ order, history, throughDate });
if (!r.ok) { console.error(`❌ ledger: refusing to reconcile through ${throughDate}:`); for (const e of r.errors) console.error('  - ' + e); process.exit(1); }

if (!r.changed) { console.log(`✅ ledger current through ${throughDate} — ${Object.keys(r.value).length} served days recorded, nothing to append.`); process.exit(0); }

if (!WRITE) {
  console.error(`❌ ledger: ${r.addedDates.length} served date(s) missing from data/daily-history.js (through ${throughDate}):`);
  for (const d of r.addedDates) console.error('  - ' + d);
  console.error('\nRun:  npm run ledger:record     (history-only append; does NOT regenerate the schedule)');
  process.exit(1);
}
writeAtomic(HISTORY_PATH, serializeHistory(r.value));
console.log(`✅ ledger: appended ${r.addedDates.length} served date(s) through ${throughDate} — ${r.addedDates.join(', ')}`);
console.log(`   ${Object.keys(r.value).length} served days now recorded. data/daily-order.js untouched.`);
