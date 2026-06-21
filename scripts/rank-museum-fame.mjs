// Rank staged museum-harvest works by Wikidata sitelink count.
// Run: node scripts/rank-museum-fame.mjs
import { readFileSync, writeFileSync } from "node:fs";

const UA = "GessoMuseumFame/1.0 (kathryn.swint@gmail.com)";
const BATCH_SIZE = 200;
const BATCH_GAP_MS = 1200;
const OUT = "data/incoming/museum-fame-ranking.json";
const SOURCES = [
  "britishmuseum",
  "quaibranly",
  "lacma",
  "brooklyn",
  "walters",
];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function sparql(qy) {
  const u = "https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(qy);
  for (let t = 0; t < 6; t++) {
    try {
      const r = await fetch(u, {
        headers: {
          "User-Agent": UA,
          "Accept": "application/sparql-results+json",
        },
      });
      if (r.status === 429 || r.status >= 500) {
        const retryAfter = Number(r.headers.get("retry-after"));
        const delay = Number.isFinite(retryAfter) ? retryAfter * 1000 : 3000 * (t + 1);
        await sleep(delay);
        continue;
      }
      if (!r.ok) {
        const body = await r.text().catch(() => "");
        console.error("sparql", r.status, body.slice(0, 300));
        return null;
      }
      return await r.json();
    } catch (error) {
      console.error(`sparql attempt ${t + 1} failed: ${error.message}`);
      await sleep(1500 * (t + 1));
    }
  }
  return null;
}

function qidFromWork(work) {
  const match = String(work.id || "").match(/^wikidata:(Q\d+)$/i);
  return match ? match[1].toUpperCase() : null;
}

function readWorks() {
  return SOURCES.flatMap(src => {
    const path = `data/incoming/collection-${src}.json`;
    const works = JSON.parse(readFileSync(path, "utf8"));
    return works.map(work => ({ ...work, src: work.src || src, qid: qidFromWork(work) }));
  });
}

function chunks(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function fetchSitelinks(qids) {
  const counts = new Map(qids.map(qid => [qid, 0]));
  const batches = chunks(qids, BATCH_SIZE);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const values = batch.map(qid => `wd:${qid}`).join(" ");
    const query = `SELECT ?item ?sitelinks WHERE {
      VALUES ?item { ${values} }
      ?item wikibase:sitelinks ?sitelinks.
    }`;
    const json = await sparql(query);
    if (!json?.results?.bindings) {
      throw new Error(`No SPARQL results for batch ${i + 1}/${batches.length}`);
    }

    for (const binding of json.results.bindings) {
      const qid = binding.item?.value?.match(/\/entity\/(Q\d+)$/)?.[1];
      const sitelinks = Number(binding.sitelinks?.value);
      if (qid && Number.isFinite(sitelinks)) counts.set(qid, sitelinks);
    }

    console.error(`Fetched sitelinks batch ${i + 1}/${batches.length} (${batch.length} ids)`);
    if (i < batches.length - 1) await sleep(BATCH_GAP_MS);
  }

  return counts;
}

function label(value, fallback) {
  const text = String(value || "").trim();
  return text || fallback;
}

function sortRanked(a, b) {
  return b.sitelinks - a.sitelinks
    || a.title.localeCompare(b.title)
    || a.src.localeCompare(b.src)
    || a.id.localeCompare(b.id);
}

function printRows(rows) {
  rows.forEach((work, index) => {
    console.log(`${index + 1}. ${work.sitelinks} sitelinks — "${work.title}" — ${label(work.artist, "anon")} — ${label(work.place, "?")} [${work.src}]`);
  });
}

const works = readWorks();
const qids = [...new Set(works.map(work => work.qid).filter(Boolean))].sort();

console.error(`Loaded ${works.length} works from ${SOURCES.length} museums; ${qids.length} unique Wikidata ids.`);
const sitelinks = await fetchSitelinks(qids);

const ranked = works
  .map(work => ({ ...work, sitelinks: work.qid ? sitelinks.get(work.qid) ?? 0 : 0 }))
  .sort(sortRanked)
  .map((work, index) => ({ rank: index + 1, ...work }));

writeFileSync(OUT, JSON.stringify(ranked, null, 2) + "\n");

console.log("\nTOP 30 most famous works overall");
printRows(ranked.slice(0, 30));

for (const src of SOURCES) {
  console.log(`\nTOP 8 for ${src}`);
  printRows(ranked.filter(work => work.src === src).slice(0, 8));
}

console.error(`\nSaved ${ranked.length} ranked works to ${OUT}`);
