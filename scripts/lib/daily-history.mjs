// Pure ledger/date logic shared by the daily-history reconciler, freeze-daily and check-daily-flip.
// NO filesystem, NO network, NO clock reads except the explicit nowMs argument — everything here is
// deterministic so it can be unit-tested and so callers can inject a fixed instant.
//
// WHY A SHARED live-date MODEL: the app keys each daily on the PLAYER'S LOCAL calendar date, so at any
// instant "today" spans UTC-12 … UTC+14. UTC midnight and Pacific midnight are both wrong: a date is
// already live for someone in Kiritimati 14h before UTC midnight, and still live in Baker Island 12h
// after. check-daily-flip has always used this window; the ledger must use the SAME one or the two
// disagree about which days are "served".

export const TIERS = ['easy', 'medium', 'hard', 'impossible'];
export const ROUNDS = 5;

const ISO = /^\d{4}-\d\d-\d\d$/;
// STRICT: Date.parse alone NORMALISES impossible dates (2026-02-29 -> 2026-03-01) and would accept them.
// Round-trip through toISOString and require the exact same string back, so only real calendar dates pass.
// Valid leap days (2024-02-29) round-trip unchanged and remain accepted.
export const isIsoDate = d => {
  if (typeof d !== 'string' || !ISO.test(d)) return false;
  const t = Date.parse(d + 'T00:00:00Z');
  if (Number.isNaN(t)) return false;
  return new Date(t).toISOString().slice(0, 10) === d;
};
const dayNum = d => Math.floor(Date.parse(d + 'T00:00:00Z') / 86400000);
const isoOf = n => new Date(n * 86400000).toISOString().slice(0, 10);

// Every distinct calendar date that is "today" somewhere on Earth right now (UTC-12 … UTC+14).
export function liveDateSet(nowMs = Date.now()) {
  const out = new Set();
  for (let h = -12; h <= 14; h++) out.add(new Date(nowMs + h * 3600000).toISOString().slice(0, 10));
  return [...out].sort();
}
// The latest date that has begun anywhere — the through-date for ledger reconciliation.
export function servedThroughDate(nowMs = Date.now()) {
  const s = liveDateSet(nowMs);
  return s[s.length - 1];
}

// A day record must carry all four tiers, each exactly ROUNDS distinct non-empty string ids.
export function validateRecord(rec, label) {
  const e = [];
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return [`${label}: not an object`];
  for (const t of TIERS) {
    const a = rec[t];
    if (!Array.isArray(a)) { e.push(`${label}/${t}: missing or not an array`); continue; }
    if (a.length !== ROUNDS) { e.push(`${label}/${t}: ${a.length} ids (expected ${ROUNDS})`); continue; }
    if (!a.every(x => typeof x === 'string' && x.length > 0)) { e.push(`${label}/${t}: non-string or empty id`); continue; }
    if (new Set(a).size !== a.length) e.push(`${label}/${t}: duplicate id within the tier`);
  }
  return e;
}
// Order-sensitive equality — a reordered tier is a DIFFERENT served day, not the same one.
export const sameRecord = (a, b) => TIERS.every(t => JSON.stringify((a || {})[t]) === JSON.stringify((b || {})[t]));

// Reconcile daily-order into the append-only history through `throughDate`.
// Pure: returns a NEW history value; never mutates its inputs and never touches disk.
export function reconcile({ order = {}, history = {}, throughDate }) {
  const errors = [];
  if (!isIsoDate(throughDate)) return { ok: false, errors: [`throughDate "${throughDate}" is not YYYY-MM-DD`], addedDates: [], changed: false, value: history };

  for (const [d, rec] of Object.entries(history)) {
    if (!isIsoDate(d)) errors.push(`history key "${d}" is not YYYY-MM-DD`);
    else if (d > throughDate) errors.push(`history contains ${d}, later than servedThrough ${throughDate} — future-history corruption`);
    errors.push(...validateRecord(rec, `history ${d}`));
  }
  for (const [d, rec] of Object.entries(order)) {
    if (!isIsoDate(d)) { errors.push(`daily-order key "${d}" is not YYYY-MM-DD`); continue; }
    if (d > throughDate) continue;                       // unserved future — not our concern
    errors.push(...validateRecord(rec, `daily-order ${d}`));
  }
  // IMMUTABILITY: a date present in both must match verbatim. Drift means a refreeze altered a served day.
  for (const d of Object.keys(history)) {
    if (!isIsoDate(d) || !order[d]) continue;
    if (!sameRecord(history[d], order[d])) errors.push(`ledger drift at ${d}: daily-order differs from the recorded ledger entry`);
  }
  if (errors.length) return { ok: false, errors, addedDates: [], changed: false, value: history };

  const hKeys = Object.keys(history).filter(isIsoDate).sort();
  const oKeys = Object.keys(order).filter(isIsoDate).filter(d => d <= throughDate).sort();
  // ANCHOR THE WALK AT THE EARLIEST *RECOVERABLE* DATE, i.e. the earliest served daily-order entry — NOT the
  // earliest ledger entry. daily-order keeps only a short window, so any hole older than that window is a
  // permanent historical fact: the assignment exists in neither source and no reconciliation can ever fill it.
  // Anchoring on the ledger's own start would therefore hard-fail forever on real data (the live ledger has
  // four such holes at 2026-07-16 and 2026-07-29..31, all predating the daily-order window), which would brick
  // freeze and ledger:check. Anchoring here still rejects every gap INSIDE the recoverable window — the only
  // gap that represents recoverable data actually being lost.
  // SCOPE OF THE GUARANTEE (qualified): this ensures COMPLETENESS ACROSS THE RECOVERABLE WINDOW — every
  // served assignment still present in daily-order is recorded. It does NOT repair pre-window history, and
  // it never fabricates a missing assignment; those holes are preserved as known gaps.
  const start = oKeys.length ? oKeys[0] : null;
  if (start === null) return { ok: true, errors: [], addedDates: [], changed: false, value: { ...history } };

  const added = [];
  for (let n = dayNum(start); n <= dayNum(throughDate); n++) {
    const d = isoOf(n);
    if (history[d]) continue;
    if (order[d]) { added.push(d); continue; }
    return { ok: false, addedDates: [], changed: false, value: history,
      errors: [`unrecoverable gap at ${d}: absent from BOTH daily-history and daily-order, so the served assignment cannot be recovered`] };
  }
  // Rebuild chronologically. Existing records are copied VERBATIM and never reordered relative to one
  // another (real history is already ascending, so this is identity for it); new dates slot into place.
  const value = {};
  for (const d of [...new Set([...hKeys, ...added])].sort()) value[d] = history[d] ? history[d] : order[d];
  return { ok: true, errors: [], addedDates: added, changed: added.length > 0, value };
}

// FAIL-CLOSED SHAPE CHECK for a `window.<GLOBAL> = { …, byDate: {…} }` data module. Pure: the caller does the
// filesystem read (readGlobal) and passes the evaluated global here. Returns the byDate map or a precise error.
// A missing global, a non-object global, or a missing/non-object byDate is an ERROR — never an empty {}.
export function byDateOf(mod, globalName, file) {
  if (mod === undefined || mod === null) return { ok: false, error: `${file}: window.${globalName} is missing` };
  if (typeof mod !== 'object' || Array.isArray(mod)) return { ok: false, error: `${file}: window.${globalName} is not an object` };
  const bd = mod.byDate;
  if (bd === undefined || bd === null) return { ok: false, error: `${file}: window.${globalName}.byDate is missing` };
  if (typeof bd !== 'object' || Array.isArray(bd)) return { ok: false, error: `${file}: window.${globalName}.byDate is not an object` };
  return { ok: true, byDate: bd };
}

// Canonical serialized form. NOTE: static-module's writeAssignment emits `window.X = <json>` WITH spaces,
// which would rewrite data/daily-history.js in a different shape and cause unrelated formatting churn.
// The canonical on-disk form has no spaces, so we build the exact body and hand it to writeAtomic.
export const serializeHistory = byDate => `window.ARTEFACTUM_DAILY_HISTORY=${JSON.stringify({ byDate })};\n`;
