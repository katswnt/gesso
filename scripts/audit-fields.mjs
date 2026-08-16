// Field-provenance audit (network; run with plain `node`). Near-zero model tokens — pure SPARQL + string compare.
// For every pool work with a Wikidata QID, pulls creator (P170), title (P1476/label), material (P186),
// movement (P135), and compares to the pool's artist/title/medium/style. Writes a per-field review report.
// Conservative: ARTIST + MOVEMENT compare cleanly; TITLE + MEDIUM are noisy so only egregious cases flag.
// Usage: node scripts/audit-fields.mjs        (gather + analyze; cache resumable)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { readGlobal } from "./lib/static-module.mjs";
import { loadWdEntities } from "./lib/wd-cache.mjs";

const DIR = "data/incoming/field-audit";
mkdirSync(DIR, { recursive: true });

const pool = readGlobal("data/pool.js", "ARTEFACTUM_POOL");
const qidOf = p => { const m = String(p.id).match(/Q\d+/); return (m && /^(wikidata:|http:\/\/www\.wikidata)/.test(p.id)) ? m[0] : null; };
const works = pool.map(p => ({ p, qid: qidOf(p) })).filter(x => x.qid);

// creator / title / material / movement now come from the shared Wikidata cache — no separate sweep.
const ents = await loadWdEntities(works.map(w => w.qid), { onProgress: (d, t) => { if (d % 600 < 100) console.error(`  ${d}/${t} fetched`); } });
const cache = {};
for (const w of works) { const e = ents.get(w.qid);
  cache[w.qid] = { creator: e.creators.map(c => c.l).filter(Boolean), title: e.title ? [e.title] : [], material: e.materials, movement: e.movements }; }

// ---- analyze ----
const strip = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const words = s => new Set(strip(s).replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(w => w.length > 2));
const overlap = (a, b) => { const A = words(a), B = words(b); for (const w of A) if (B.has(w)) return true; return false; };
// strip attribution qualifiers the pool keeps but WD's creator label won't have
const baseArtist = s => strip(s).replace(/^(attributed to|workshop of|circle of|follower of|after|studio of|school of|manner of|imitator of)\s+/i, "").trim();
const isAnon = s => { const a = strip(s); return !a || /^(unknown|anon|unidentified|various|attributed)/.test(a); };

const ARTIST = [], MOVEMENT = [], TITLE = [], MEDIUM = [];
for (const w of works) {
  const c = cache[w.qid]; if (!c) continue;
  const p = w.p;
  // ARTIST: flag when pool names an artist, WD names creator(s), and NO surname/word overlaps any WD creator
  if (!isAnon(p.artist) && (c.creator || []).length) {
    const pa = baseArtist(p.artist);
    if (!c.creator.some(cr => overlap(pa, cr))) ARTIST.push({ id: p.id, title: (p.title || "").slice(0, 36), pool: p.artist, wd: c.creator.join(" | ") });
  }
  // MOVEMENT: flag when both pool.style and WD movement exist and share no word (WD movements are lowercase)
  if (p.style && (c.movement || []).length) {
    if (!c.movement.some(mv => overlap(p.style, mv))) MOVEMENT.push({ id: p.id, title: (p.title || "").slice(0, 36), pool: p.style, wd: c.movement.join(" | ") });
  }
  // TITLE (noisy): only flag if pool title shares NO word with any WD title AND neither side is generic/untitled
  if (p.title && (c.title || []).length && !/untitled|^\W*$/i.test(p.title)) {
    if (!c.title.some(t => overlap(p.title, t))) TITLE.push({ id: p.id, pool: p.title, wd: c.title.join(" | ") });
  }
  // MEDIUM (noisy): flag if pool medium word doesn't appear in any WD material label (and WD has materials)
  if (p.medium && (c.material || []).length) {
    if (!c.material.some(m => overlap(p.medium, m))) MEDIUM.push({ id: p.id, title: (p.title || "").slice(0, 30), pool: p.medium, wd: c.material.join(" | ") });
  }
}
writeFileSync(`${DIR}/report.json`, JSON.stringify({ ARTIST, MOVEMENT, TITLE, MEDIUM }, null, 1));
const n = a => a.length;
console.error(`\nflagged — ARTIST:${n(ARTIST)}  MOVEMENT:${n(MOVEMENT)}  TITLE:${n(TITLE)}  MEDIUM:${n(MEDIUM)}  (of ${works.length} works)`);
console.error("\n-- ARTIST (first 20) --"); for (const r of ARTIST.slice(0, 20)) console.error(`  pool "${r.pool}" vs WD "${r.wd}"  | ${r.title}`);
console.error("\n-- MOVEMENT (first 20) --"); for (const r of MOVEMENT.slice(0, 20)) console.error(`  pool "${r.pool}" vs WD "${r.wd}"  | ${r.title}`);
