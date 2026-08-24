// Bake each named-artist work's creator LIFESPAN (born/died years) onto the pool, so check-pool can gate a
// work's `y` against it WITHOUT network (an artist can't have made a work before ~age 8 or long after death;
// this also catches the mounter/restorer attribution bug where a much-older object is credited to a later hand).
// Work→creator QID comes from the existing shared WD cache (no full refetch); only the missing BIRTH/DEATH years
// are fetched (targeted, resumable). Run LOCALLY (network). Then: check-pool.
//   node scripts/build-lifespans.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { readGlobal, writeAssignment } from "./lib/static-module.mjs";

const UA = "GessoBot/1.0 (kathryn.swint@gmail.com)";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const yr = v => { const m = String(v || "").match(/^([+-]?)0*(\d+)/); return m ? (m[1] === "-" ? -1 : 1) * parseInt(m[2], 10) : null; };
// same rule check-pool uses: a real individual, not a workshop/period/culture stand-in
const isNamedArtist = a => a && !/(century|workshop|school|dynasty|period|culture|anonymous|unknown|master of|circle of|follower|after |artist$|people$|maker$|tribe)/i.test(a);

const pool = readGlobal("data/pool.js", "ARTEFACTUM_POOL");
const cache = JSON.parse(readFileSync("data/incoming/wd-entities.json", "utf8"));
const workQid = p => { const m = String(p.id).match(/Q\d+/); return (m && /^(wikidata:|http:\/\/www\.wikidata)/.test(p.id)) ? m[0] : null; };

// work → its creator QIDs (from the cache)
const workCreators = new Map(); const need = new Set();
for (const p of pool) {
  if (!isNamedArtist(p.artist)) continue;
  const q = workQid(p); const e = q && cache[q];
  const cq = e ? (e.creators || []).map(c => c.q).filter(Boolean) : [];
  if (!cq.length) continue;
  workCreators.set(p.id, cq); cq.forEach(x => need.add(x));
}
console.error(`named-artist works with a resolvable creator QID: ${workCreators.size} | distinct creators: ${need.size}`);

// resumable lifespan cache: creatorQID → {born, died}
const LC = "data/incoming/lifespans-cache.json";
const life = existsSync(LC) ? JSON.parse(readFileSync(LC, "utf8")) : {};
const missing = [...need].filter(q => !(q in life));
console.error(`fetching born/died for ${missing.length} creators (${need.size - missing.length} cached)…`);
for (let i = 0; i < missing.length; i += 40) {
  const batch = missing.slice(i, i + 40);
  let j = null;
  for (let a = 0; a < 5 && !j; a++) { if (a) await sleep(1500 * a);
    try { const r = await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${batch.join("|")}&props=claims&format=json`, { headers: { "User-Agent": UA } }); if (r.ok) j = await r.json(); } catch {} }
  for (const q of batch) { const c = j?.entities?.[q]?.claims || {};
    life[q] = { born: yr(c.P569?.[0]?.mainsnak?.datavalue?.value?.time), died: yr(c.P570?.[0]?.mainsnak?.datavalue?.value?.time) }; }
  if (i % 400 === 0) writeFileSync(LC, JSON.stringify(life));
  process.stderr.write(`\r  ${Math.min(i + 40, missing.length)}/${missing.length}`);
  await sleep(150);
}
writeFileSync(LC, JSON.stringify(life));
console.error("");

// bake born/died onto each work: generous window (earliest birth, latest death across its creators)
let set = 0, cleared = 0;
for (const p of pool) {
  const cq = workCreators.get(p.id);
  let born = null, died = null;
  if (cq) for (const q of cq) { const L = life[q]; if (!L) continue;
    if (L.born != null) born = born == null ? L.born : Math.min(born, L.born);
    if (L.died != null) died = died == null ? L.died : Math.max(died, L.died); }
  if (born != null || died != null) { if (p.born !== born || p.died !== died) set++; if (born != null) p.born = born; else delete p.born; if (died != null) p.died = died; else delete p.died; }
  else if (p.born != null || p.died != null) { delete p.born; delete p.died; cleared++; } // artist no longer resolvable
}
writeAssignment("data/pool.js", "ARTEFACTUM_POOL", pool);
console.error(`baked lifespan on ${pool.filter(p => p.born != null || p.died != null).length} works (${set} changed, ${cleared} cleared)`);
