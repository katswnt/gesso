// Catalog support/date conflicts (VSD-089, owner-approved cleaning script 2026-11-20). Pure functions, no network.
// The claim-first writer receives catalog fields as citable facts (cat.medium, cat.date), so a pool record that says
// "on canvas" for a panel painting becomes a confident factual error in player copy. This module classifies the
// physical SUPPORT of a medium string and compares it with Wikidata (a compact tracked snapshot) and with B2's
// researched mediumFull; contradicted fields are withheld from the writer (VSD-088).
import { readFileSync, existsSync } from 'node:fs';

export const CONFLICTS_FILE = new URL('../../data/catalog-support-conflicts.json', import.meta.url);

// Support words, most specific first. "wood" alone is ambiguous (a carved figure is "wood" too), so it counts as a
// panel only after "on" ("oil on wood") or beside a paint word.
const SUPPORTS = [
  ['canvas', /\b(canvas|linen)\b/i],
  ['copper', /\bcopper\b(?!\s*(alloy|-based|engraving|etching|plate|print))/i],
  ['board', /\b(cardboard|paperboard|millboard|pasteboard|board)\b/i],
  ['paper', /\b(paper|papier)\b/i],
  ['panel', /\b(panel|oak|poplar|walnut|limewood|lime\s*wood|linden|pine\s*wood|beech)\b/i],
];
const PAINT = /\b(oil|tempera|paint|gouache|watercolou?r|distemper|encaustic)\b/i;
const TRANSFERRED = /\btransferred\b[^;,.]*?\b(?:to|on(?:to)?)\s+(canvas|panel|paper|board)\b/i;

function classesIn(text) {
  const t = String(text || ''), out = [];
  for (const [cls, re] of SUPPORTS) { const m = re.exec(t); if (m) out.push({ cls, at: m.index }); }
  const wood = /\bwood(en)?\b/i.exec(t);
  if (wood && !out.some(x => x.cls === 'panel') && (/\bon\s+(?:a\s+)?wood/i.test(t) || PAINT.test(t))) out.push({ cls: 'panel', at: wood.index });
  return out.sort((a, b) => a.at - b.at);
}

// The PRIMARY support of a medium description, or null when there is none or it is ambiguous.
// Edge cases (tests/catalog-support.test.mjs):
//   "Oil on canvas, mounted on panel"          -> canvas (the first "on" names the painted support)
//   "Oil on paper laid down on canvas"         -> paper
//   "Oil on panel, transferred to canvas"      -> canvas (a transfer replaces the support)
//   Wikidata list "panel; oil paint"           -> panel; "paper; panel" (no "on", two supports) -> null
//   "Bronze" / "Oil paint" (no support)        -> null; "Copper" statue -> copper (equal classes never conflict)
export function supportClass(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const tr = TRANSFERRED.exec(t);
  if (tr) return tr[1].toLowerCase();
  const on = /\bon\s+(?:an?\s+|the\s+)?(.*)$/i.exec(t);
  if (on) { const first = classesIn(on[1])[0]; if (first) return first.cls; }
  const all = [...new Set(classesIn(t).map(x => x.cls))];
  return all.length === 1 ? all[0] : null;
}

// A plain year from a catalog/pool date ("1908", "-500"); null for ranges or text.
export const yearOf = d => { const m = /^\s*(-?\d{1,4})\s*$/.exec(String(d ?? '')); return m ? Number(m[1]) : null; };
// Tolerance for a Wikidata inception year: pool years are often rounded or give the completion year. The cache stores
// no precision, so a round Wikidata value (1600, -500, 1650) is read as century/half-century precision.
export const DATE_TOLERANCE = 10;
const tolerance = y => y % 100 === 0 ? 100 : y % 50 === 0 ? 50 : DATE_TOLERANCE;
// Cache artifacts, not evidence: a lost BCE sign ("0539" for -539) or a truncated year ("0198" for 1889 Irises).
const cacheArtifact = (pool, wd) => Math.abs(pool) === Math.abs(wd) || (Math.abs(wd) < 1000 && Math.abs(pool) >= 1400);
export function wikidataConflicts(pool, wd) {
  const out = {};
  if (!wd) return out;
  const a = supportClass(pool.medium), b = wd.support ?? null;
  if (a && b && a !== b) out.medium = `pool "${pool.medium}" (${a}) vs Wikidata ${b}`;
  const y = yearOf(pool.yr ?? pool.y);
  if (y != null && Number.isFinite(wd.year) && !cacheArtifact(y, wd.year) && Math.abs(y - wd.year) > tolerance(wd.year)) out.date = `pool ${y} vs Wikidata inception ${wd.year}`;
  return out;
}

// B2 (no-image research) findings that contradict the trusted catalog.
//   medium: B2's researched catalog.mediumFull names a different support class than the catalog medium.
//   date:   a factCheck B2 marked `refuted` that states the catalog year as when the work was made.
// The year must follow a making/dating word closely ("was painted in 1884", "dates from 1794", "date of 1535"), so a
// claim refuted for something else that merely mentions the year ("found ... circa 2500 BCE") does not count.
const MADE_IN = y => new RegExp(`\\b(made|painted|dated?|dates|dating|created|completed|executed|carved|cast|produced|finished)\\b[^.;]{0,30}?(?<![\\d])${y}(?![\\d])`, 'i');
export function b2Conflicts(catalog, b2) {
  const out = {};
  const a = supportClass(catalog?.medium), full = b2?.catalog?.mediumFull, b = typeof full === 'string' ? supportClass(full) : null;
  if (a && b && a !== b) out.medium = `catalog "${catalog.medium}" (${a}) vs B2 "${full}" (${b})`;
  const y = yearOf(catalog?.date);
  if (y != null) for (const fc of b2?.factChecks || []) {
    if (fc?.verdict !== 'refuted' || typeof fc.claim !== 'string') continue;
    if (MADE_IN(Math.abs(y)).test(fc.claim)) { out.date = `B2 refuted "${fc.claim.slice(0, 160)}"`; break; }
  }
  return out;
}

// The committed baseline (data/catalog-support-conflicts.json): Map<workId, { medium?, date? }>.
export function knownConflicts(file = CONFLICTS_FILE) {
  const map = new Map();
  if (!existsSync(file)) return map;
  for (const c of JSON.parse(readFileSync(file, 'utf8')).conflicts || []) {
    const e = map.get(c.id) || {}; if (!e[c.field]) e[c.field] = `${c.source}: pool "${c.pool}" vs "${c.other}"`; map.set(c.id, e);
  }
  return map;
}

// Fields the writer must not receive as catalog facts for this work.
export function contradictedFields(catalog, b2, known = knownConflicts()) {
  const out = new Set(Object.keys(b2Conflicts(catalog, b2)));
  for (const f of Object.keys(known.get(catalog?.catalogId) || {})) out.add(f);
  return out;
}
