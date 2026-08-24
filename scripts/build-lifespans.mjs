// Bake each named-artist work's creator LIFESPAN (born/died years) onto the pool, so check-pool can gate a
// work's `y` against it WITHOUT network (an artist can't have made a work before ~age 8 or long after death;
// also catches the mounter/restorer attribution bug where a much-older object is credited to a later hand).
//
// Phase 1: works that HAVE a Wikidata creator QID (from the shared WD cache) — no extra fetch for the QID.
// Phase 2: works with a named artist but NO creator QID (accession works: Met/AIC/etc.) — resolve the artist
//          NAME -> a WD person entity via wbsearchentities, with STRICT verification (must be a human whose
//          label/alias matches the name AND has a birth or death year; art occupation breaks ties). The strict
//          name+human+dates match is what avoids the wrong-person bug (the Jaume-Serra / wrong-Colman class).
// Only birth/death years are fetched; both caches are resumable. Run LOCALLY (network). Then: check-pool.
//   node scripts/build-lifespans.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { readGlobal, writeAssignment } from "./lib/static-module.mjs";

const UA = "GessoBot/1.0 (kathryn.swint@gmail.com)";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const yr = v => { const m = String(v || "").match(/^([+-]?)0*(\d+)/); return m ? (m[1] === "-" ? -1 : 1) * parseInt(m[2], 10) : null; };
const isNamedArtist = a => a && !/(century|workshop|school|dynasty|period|culture|anonymous|unknown|master of|circle of|follower|after |artist$|people$|maker$|tribe)/i.test(a);
const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[.,'’]/g, "").replace(/\s+/g, " ").trim();
// art-related P106 occupations (tie-breaker, not a hard requirement)
const ART_OCC = new Set(["Q1028181","Q1281618","Q11569986","Q33231","Q644687","Q483501","Q211423","Q18939491","Q42973","Q1925963","Q10862983","Q15296811","Q329439","Q1114448","Q7241844","Q3391743","Q1281618"]);

const jget = async url => { for (let a = 0; a < 5; a++) { if (a) await sleep(1200 * a); try { const r = await fetch(url, { headers: { "User-Agent": UA } }); if (r.ok) return await r.json(); } catch {} } return null; };

const pool = readGlobal("data/pool.js", "ARTEFACTUM_POOL");
const cache = JSON.parse(readFileSync("data/incoming/wd-entities.json", "utf8"));
const workQid = p => { const m = String(p.id).match(/Q\d+/); return (m && /^(wikidata:|http:\/\/www\.wikidata)/.test(p.id)) ? m[0] : null; };

// ---- Phase 1: work -> creator QIDs (from the cache) ----
const workCreators = new Map(); const need = new Set();
for (const p of pool) {
  if (!isNamedArtist(p.artist)) continue;
  const q = workQid(p); const e = q && cache[q];
  const cq = e ? (e.creators || []).map(c => c.q).filter(Boolean) : [];
  if (!cq.length) continue;
  workCreators.set(p.id, cq); cq.forEach(x => need.add(x));
}
const LC = "data/incoming/lifespans-cache.json";
const life = existsSync(LC) ? JSON.parse(readFileSync(LC, "utf8")) : {};
const missing = [...need].filter(q => !(q in life));
console.error(`Phase 1: ${workCreators.size} works via creator QID; fetching born/died for ${missing.length} creators (${need.size - missing.length} cached)…`);
for (let i = 0; i < missing.length; i += 40) {
  const batch = missing.slice(i, i + 40);
  const j = await jget(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${batch.join("|")}&props=claims&format=json`);
  for (const q of batch) { const c = j?.entities?.[q]?.claims || {};
    life[q] = { born: yr(c.P569?.[0]?.mainsnak?.datavalue?.value?.time), died: yr(c.P570?.[0]?.mainsnak?.datavalue?.value?.time) }; }
  if (i % 400 === 0) writeFileSync(LC, JSON.stringify(life));
  process.stderr.write(`\r  ${Math.min(i + 40, missing.length)}/${missing.length}`); await sleep(150);
}
writeFileSync(LC, JSON.stringify(life)); console.error("");

// helper: lifespan for a work from its creator QIDs (union: earliest birth, latest death)
const lifeFromCreators = cq => { let born = null, died = null;
  for (const q of cq || []) { const L = life[q]; if (!L) continue;
    if (L.born != null) born = born == null ? L.born : Math.min(born, L.born);
    if (L.died != null) died = died == null ? L.died : Math.max(died, L.died); }
  return (born != null || died != null) ? { born, died } : null; };

// ---- Phase 2: named-artist works with NO usable creator lifespan -> resolve by NAME ----
const stillMissing = pool.filter(p => isNamedArtist(p.artist) && Array.isArray(p.cats) && p.cats.includes("when")
  && !lifeFromCreators(workCreators.get(p.id)));
const names = [...new Set(stillMissing.map(p => p.artist.trim()))];
const NC = "data/incoming/name-lifespans-cache.json";
const nameLife = existsSync(NC) ? JSON.parse(readFileSync(NC, "utf8")) : {};
const nameMissing = names.filter(n => !(n in nameLife));
console.error(`Phase 2: ${stillMissing.length} works have no creator-QID lifespan (${names.length} distinct names); resolving ${nameMissing.length} names (${names.length - nameMissing.length} cached)…`);
let resolved = 0;
for (let i = 0; i < nameMissing.length; i++) {
  const name = nameMissing[i]; const want = norm(name);
  nameLife[name] = null; // default: unresolved (cache the miss so we don't retry every run)
  const s = await jget(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&type=item&language=en&limit=7&format=json`);
  const ids = (s?.search || []).map(x => x.id).filter(Boolean);
  if (ids.length) {
    const j = await jget(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.join("|")}&props=claims|labels|aliases&languages=en&format=json`);
    const quals = [];
    for (const q of ids) { const e = j?.entities?.[q]; if (!e) continue; const cl = e.claims || {};
      const isHuman = (cl.P31 || []).some(c => c.mainsnak?.datavalue?.value?.id === "Q5");
      const born = yr(cl.P569?.[0]?.mainsnak?.datavalue?.value?.time), died = yr(cl.P570?.[0]?.mainsnak?.datavalue?.value?.time);
      if (!isHuman || (born == null && died == null)) continue;
      const labels = [e.labels?.en?.value, ...((e.aliases?.en || []).map(a => a.value))].filter(Boolean).map(norm);
      if (!labels.includes(want)) continue;                                  // name must match exactly (label/alias)
      if (!(cl.P106 || []).some(c => ART_OCC.has(c.mainsnak?.datavalue?.value?.id))) continue; // HARD: must be an artist (kills kings/poets/modern-namesakes)
      quals.push({ qid: q, born, died });
    }
    // UNAMBIGUOUS only: exactly one distinct art-person with this exact name. >1 (same-name artists) → skip, can't
    // tell which; 0 → skip. This is what prevents the wrong-person bakes (Andrea Amati→1963, Clodion→Frankish king).
    const uniq = [...new Map(quals.map(c => [c.qid, c])).values()];
    if (uniq.length === 1) { nameLife[name] = { born: uniq[0].born, died: uniq[0].died }; resolved++; }
  }
  if (i % 25 === 0) writeFileSync(NC, JSON.stringify(nameLife));
  process.stderr.write(`\r  ${i + 1}/${nameMissing.length} (resolved ${resolved})`); await sleep(150);
}
writeFileSync(NC, JSON.stringify(nameLife)); console.error("");

// ---- bake: born/died from creator-QID lifespan, else name lifespan ----
let set = 0, cleared = 0, nameBaked = 0;
for (const p of pool) {
  let L = lifeFromCreators(workCreators.get(p.id));
  // name-resolved lifespan (Phase 2) is lower-confidence, so only trust it for y>=1400 works AND when the
  // resolved life is era-plausible for THIS work (artist not born after it, not dead >120y before it). This
  // rejects wrong-modern namesakes / copies-of-ancient-masters while still catching decade/century date errors.
  if (!L && isNamedArtist(p.artist) && p.y != null && p.y >= 1400) {
    const nl = nameLife[p.artist?.trim()];
    if (nl && (nl.born == null || nl.born <= p.y + 5) && (nl.died == null || nl.died >= p.y - 120)) { L = nl; nameBaked++; }
  }
  const born = L?.born ?? null, died = L?.died ?? null;
  if (born != null || died != null) { if (p.born !== born || p.died !== died) set++; if (born != null) p.born = born; else delete p.born; if (died != null) p.died = died; else delete p.died; }
  else if (p.born != null || p.died != null) { delete p.born; delete p.died; cleared++; }
}
writeAssignment("data/pool.js", "ARTEFACTUM_POOL", pool);
const covered = pool.filter(p => p.born != null || p.died != null).length;
console.error(`baked lifespan on ${covered} works (${set} changed, ${cleared} cleared) — Phase 2: ${resolved} names resolved (art+unambiguous), ${nameBaked} works baked via name (y>=1400, era-plausible)`);
