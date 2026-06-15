// Backfill blank medium for Wikidata works from P186 (material used), resolving Q-ids to English labels.
// Run AFTER enrich-dimensions.mjs (both write pool.js). Resumable: only touches works still missing medium.
import { readFileSync, writeFileSync } from "node:fs";
const UA = "GessoArtGame/1.0 (kathryn.swint@gmail.com)";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const raw = readFileSync("data/pool.js", "utf8");
const pre = raw.slice(0, raw.indexOf("[")), post = raw.slice(raw.lastIndexOf("]") + 1);
const pool = JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1));
const save = () => writeFileSync("data/pool.js", pre + JSON.stringify(pool) + post);

async function getJSON(url) {
  for (let t = 0; t < 3; t++) {
    try { const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
      if (r.status === 429 || r.status >= 500) { await sleep(1500 * (t + 1)); continue; }
      if (!r.ok) return null; return await r.json();
    } catch { await sleep(1000 * (t + 1)); }
  } return null;
}
const todo = pool.filter(p => /Q\d+/.test(p.id) && !p.medium);
console.error(`wd-medium: ${todo.length} Wikidata works missing medium`);

const labelCache = {};
async function labels(qids) {
  const need = [...new Set(qids)].filter(q => !(q in labelCache));
  for (let i = 0; i < need.length; i += 45) {
    const batch = need.slice(i, i + 45);
    const j = await getJSON(`https://www.wikidata.org/w/api.php?action=wbgetentities&props=labels&languages=en&format=json&origin=*&ids=${batch.join("|")}`);
    for (const q of batch) labelCache[q] = j?.entities?.[q]?.labels?.en?.value || null;
    await sleep(120);
  }
}
let n = 0, done = 0;
for (let i = 0; i < todo.length; i += 6) {
  const batch = todo.slice(i, i + 6);
  // fetch P186 claims for each work
  const claims = await Promise.all(batch.map(async p => {
    const q = p.id.match(/Q\d+/)[0];
    const j = await getJSON(`https://www.wikidata.org/w/api.php?action=wbgetentities&props=claims&ids=${q}&format=json&origin=*`);
    const mats = (j?.entities?.[q]?.claims?.P186 || []).map(c => c?.mainsnak?.datavalue?.value?.id).filter(Boolean);
    return mats;
  }));
  await labels(claims.flat());
  batch.forEach((p, k) => { done++;
    const names = claims[k].map(q => labelCache[q]).filter(Boolean);
    if (names.length) { p.medium = names.map(s => s[0].toUpperCase() + s.slice(1)).join(", "); n++; }
  });
  if (i % 60 === 0) { save(); console.error(`  ${done}/${todo.length} | +medium ${n}`); }
  await sleep(120);
}
save();
console.error(`DONE: ${n} Wikidata mediums backfilled of ${todo.length}.`);
