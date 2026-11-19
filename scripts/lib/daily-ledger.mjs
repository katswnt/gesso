// The served-days ledger (data/daily-history.js) is append-only. foldServed copies every day on or before today
// from a calendar into it; an existing entry is never overwritten. freeze-daily folds the PRIOR calendar in before
// it truncates daily-order to today-3, so a served day can never be lost by a refreeze (2026-11-18: a refreeze would
// have dropped Aug 31 – Nov 15, which lived only in daily-order).
const dayNumOf = k => Math.floor(Date.parse(k + "T00:00:00Z") / 86400000);
export function foldServed(ledger, byDate, todayNum) {
  const out = { ...ledger }; let added = 0;
  for (const [k, rec] of Object.entries(byDate || {})) if (dayNumOf(k) <= todayNum && !out[k]) { out[k] = rec; added++; }
  return { ledger: out, added };
}
