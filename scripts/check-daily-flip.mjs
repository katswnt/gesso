#!/usr/bin/env node
// NETWORKED predeploy guard (NOT in offline test:ci). Before deploying a change that touches data/daily-order.js,
// compare the repo's byDate assignment for every date that could currently be "today" somewhere on Earth against
// what production is serving right now. If any tier of any such date differs, the deploy would flip an
// already-live puzzle mid-day — STOP and pin instead (a pin is a separately reviewed change to BOTH
// data/daily-order.js and data/daily-history.js; this script never rewrites anything).
//
// The app keys the daily on each player's LOCAL calendar date, so "today" spans UTC-12 … UTC+14: we check every
// distinct date in [now-12h, now+14h]. Fails CLOSED on network / parse / missing-date / malformed-tier.
//   node scripts/check-daily-flip.mjs   (optional: PROD_ORIGIN=https://gesso.katswint.com)
import { readFileSync } from 'node:fs';

const ORIGIN = (process.env.PROD_ORIGIN || 'https://gesso.katswint.com').replace(/\/$/, '');
const TIERS = ['easy', 'medium', 'hard', 'impossible'];
const fail = m => { console.error('❌ FAIL — daily-flip guard: ' + m); process.exit(1); };

// distinct UTC dates covering every player-local "today" (UTC-12 … UTC+14)
function todaySet() {
  const now = Date.now(), out = new Set();
  for (let h = -12; h <= 14; h++) out.add(new Date(now + h * 3600000).toISOString().slice(0, 10));
  return [...out].sort();
}
const parseByDate = (text, label) => {
  let o; try { o = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch { fail(`could not parse ${label} daily-order.js`); }
  if (!o || typeof o.byDate !== 'object' || !o.byDate) fail(`${label} daily-order.js has no byDate`);
  return o.byDate;
};

async function main() {
  // repo (what we would deploy)
  let repoText; try { repoText = readFileSync(new URL('../data/daily-order.js', import.meta.url), 'utf8'); } catch { fail('cannot read repo data/daily-order.js'); }
  const repo = parseByDate(repoText, 'repo');

  // production (what is live), cache-busted
  let prodText;
  try {
    const r = await fetch(`${ORIGIN}/data/daily-order.js?_cb=${Date.now()}`, { headers: { 'cache-control': 'no-cache' } });
    if (!r.ok) fail(`production fetch returned HTTP ${r.status}`);
    prodText = await r.text();
  } catch (e) { fail(`production fetch error: ${e && e.message}`); }
  const prod = parseByDate(prodText, 'production');

  const dates = todaySet();
  const diffs = [];
  for (const d of dates) {
    const R = repo[d], P = prod[d];
    if (!R) fail(`repo daily-order has no byDate[${d}] (a live date must be pinned)`);
    if (!P) fail(`production daily-order has no byDate[${d}] (a live date must be pinned)`);
    for (const t of TIERS) {
      for (const [side, arr] of [['repo', R[t]], ['production', P[t]]]) {
        if (!Array.isArray(arr) || arr.length !== 5) fail(`${side} tier ${t} for ${d} is not a 5-item array`);
        if (!arr.every(x => typeof x === 'string' && x.length > 0)) fail(`${side} tier ${t} for ${d} has a non-string/empty id`);
        if (new Set(arr).size !== 5) fail(`${side} tier ${t} for ${d} has duplicate ids`);
      }
      if (JSON.stringify(R[t]) !== JSON.stringify(P[t])) diffs.push({ date: d, tier: t, prod: P[t], repo: R[t] });
    }
  }

  console.log(`checked ${dates.length} live date(s) [${dates[0]} … ${dates[dates.length - 1]}] × ${TIERS.length} tiers against ${ORIGIN}`);
  if (diffs.length) {
    console.error(`\n❌ FAIL — deploying would FLIP ${diffs.length} already-live tier-day(s) mid-day:`);
    for (const x of diffs) console.error(`  - ${x.date} ${x.tier}: prod=${JSON.stringify(x.prod)}  →  repo=${JSON.stringify(x.repo)}`);
    console.error('\nDo NOT deploy. Pin these dates to the currently-served set first (a separately reviewed edit to BOTH data/daily-order.js and data/daily-history.js). This script never rewrites data.');
    process.exit(1);
  }
  console.log('✅ PASS — every currently-live date matches production; deploying will not flip a live puzzle.');
}
main().catch(e => fail(e && e.message || String(e)));
