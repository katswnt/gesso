// Fetch ALL-LANGUAGE monthly Wikipedia pageviews for every Wikidata-linked pool work, so the fame
// metric measures true global recognition instead of English-only traffic (the current en.wikipedia-only
// pageview term buries non-Western works whose readership lives in non-English Wikipedias).
//
// STAGING ONLY: writes data/incoming/alllang-pv.jsonl (one {id, qid, sitelinks, langWikis, enPv, allPv}
// per line). Does NOT touch fame.json / fame.js / pool.js — the before/after tiers are computed separately
// for review before anything ships. Resumable: skips ids already present in the jsonl on restart.
//
// Run: node scripts/grab-alllang-pageviews.mjs        (plain node, needs network)
import fs from "node:fs";

const OUT = "data/incoming/alllang-pv.jsonl";
const UA = "GessoFameHarvest/1.0 (kathryn.swint@gmail.com) all-language pageview de-bias";
const sleep = ms => new Promise(r => setTimeout(r, ms));

// last full calendar month
const now = new Date();
const s = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
const e = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
const stamp = d => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
const START = stamp(s) + "00", END = stamp(e) + "00";

async function jget(url, tries = 0) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (r.status === 429 || r.status >= 500) { if (tries < 5) { await sleep(1500 * 2 ** tries); return jget(url, tries + 1); } return null; }
    if (!r.ok) return null;               // 404 = no article / no data for that title+project → treat as 0
    return await r.json();
  } catch { if (tries < 4) { await sleep(1000 * 2 ** tries); return jget(url, tries + 1); } return null; }
}

// only real Wikipedia language editions (exclude commons/species/wikidata/meta/… and *wikisource etc.)
const NON_LANG = new Set(["commonswiki","specieswiki","metawiki","wikidatawiki","mediawikiwiki","incubatorwiki","sourceswiki","foundationwiki","outreachwiki","testwiki"]);
const isLangWiki = k => /^[a-z0-9_]+wiki$/.test(k) && !NON_LANG.has(k);
const projOf = k => k.slice(0, -4).replace(/_/g, "-") + ".wikipedia";  // "zhwiki" -> "zh.wikipedia"

async function pageviews(project, title) {
  const t = encodeURIComponent(title.replace(/ /g, "_"));
  const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/${project}/all-access/user/${t}/monthly/${START}/${END}`;
  const j = await jget(url);
  const v = j && j.items && j.items[0] && j.items[0].views;
  return Number.isFinite(v) ? v : 0;
}

async function getSitelinks(qids, tries = 0) {   // batch of up to 50 QIDs -> { qid: {sitelinks} }
  const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qids.join("|")}&props=sitelinks&format=json`;
  const j = await jget(url);
  const ents = (j && j.entities) || {};
  // A whole-batch empty result is almost always a transient failure, not 50 genuinely-empty works.
  // Retry rather than write 50 famous works as langs=0 (which resume would then skip forever).
  if (Object.keys(ents).length === 0 && tries < 4) { await sleep(2500 * (tries + 1)); return getSitelinks(qids, tries + 1); }
  return ents;
}

async function mapLimit(items, limit, fn) {
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; await fn(items[i]); } };
  await Promise.all(Array.from({ length: limit }, worker));
}

// ---- load pool, keep only Wikidata-linked works ----
const w = {}; new Function("window", fs.readFileSync("data/pool.js", "utf8"))(w);
const POOL = w.ARTEFACTUM_POOL;
const qidOf = id => { const m = String(id).match(/Q\d+/); return m ? m[0] : null; };
const targets = POOL.map(p => ({ id: p.id, qid: qidOf(p.id) })).filter(x => x.qid);

const done = new Set();
if (fs.existsSync(OUT)) for (const line of fs.readFileSync(OUT, "utf8").split("\n")) { if (!line.trim()) continue; try { done.add(JSON.parse(line).id); } catch {} }
const todo = targets.filter(x => !done.has(x.id));
console.log(`Wikidata-linked: ${targets.length} | already done: ${done.size} | to fetch: ${todo.length}`);
console.log(`Month window: ${START}..${END}`);

const out = fs.createWriteStream(OUT, { flags: "a" });
let n = 0, tSum = 0;

for (let i = 0; i < todo.length; i += 50) {
  const batch = todo.slice(i, i + 50);
  const ents = await getSitelinks(batch.map(x => x.qid));
  // Only process works whose entity actually came back. A work whose entity is missing (transient fetch
  // miss) is left UNWRITTEN so the next resume run retries it — never recorded as a false langs=0.
  const agg = batch.map(x => {
    const ent = ents[x.qid];
    if (!ent || ent.missing !== undefined) return { x, skip: true };
    const sl = ent.sitelinks || {};
    const langs = Object.keys(sl).filter(isLangWiki);
    return { x, slCount: Object.keys(sl).length, langs, titles: sl, enPv: 0, allPv: 0 };
  });
  const live = agg.filter(a => !a.skip);
  const tasks = [];
  for (const a of live) for (const k of a.langs) tasks.push({ a, k, title: a.titles[k].title });
  await mapLimit(tasks, 8, async t => { const v = await pageviews(projOf(t.k), t.title); t.a.allPv += v; if (t.k === "enwiki") t.a.enPv = v; });
  for (const a of live) { out.write(JSON.stringify({ id: a.x.id, qid: a.x.qid, sitelinks: a.slCount, langWikis: a.langs.length, enPv: a.enPv, allPv: a.allPv }) + "\n"); n++; }
  const skipped = agg.length - live.length; if (skipped) console.log(`   (${skipped} works had no entity this pass -> will retry on resume)`);
  console.log(`  ${n}/${todo.length} works | batch ${batch.length} works / ${tasks.length} lang-fetches | e.g. ${agg[0]?.x.qid}: en=${agg[0]?.enPv} all=${agg[0]?.allPv} (${agg[0]?.langs.length} langs)`);
  await sleep(120);
}
out.end();
console.log(`\nDONE — wrote ${n} works to ${OUT}. (staging only; run the tier recompute next)`);
