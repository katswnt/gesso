import { readFileSync, writeFileSync } from "node:fs";

const UA = "ArtefactumGame/0.3 (kathryn.swint@gmail.com)";
const POOL_PATH = new URL("../data/pool.js", import.meta.url);
const OUT_PATH = new URL("../data/fame.json", import.meta.url);
const MIN_REQUEST_GAP_MS = 150;
const CONCURRENCY = 3;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

let requestGate = Promise.resolve();
async function throttle() {
  const wait = requestGate.then(() => sleep(MIN_REQUEST_GAP_MS));
  requestGate = wait.catch(() => {});
  await wait;
}

async function fetchJson(url, options = {}, tries = 5) {
  for (let attempt = 0; attempt < tries; attempt++) {
    await throttle();
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          Accept: "application/json",
          "User-Agent": UA,
          ...(options.headers || {}),
        },
      });

      if (response.status === 429 || response.status >= 500) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const delay = Number.isFinite(retryAfter)
          ? retryAfter * 1000
          : 700 * (attempt + 1) ** 2;
        await sleep(delay);
        continue;
      }

      if (!response.ok) return null;
      const text = await response.text();
      return text ? JSON.parse(text) : null;
    } catch {
      await sleep(500 * (attempt + 1));
    }
  }
  return null;
}

function readPool() {
  const source = readFileSync(POOL_PATH, "utf8");
  const match = source.match(/window\.ARTEFACTUM_POOL\s*=\s*(\[[\s\S]*\])\s*;?\s*$/);
  if (!match) throw new Error("Could not find window.ARTEFACTUM_POOL JSON array in data/pool.js");
  return JSON.parse(match[1]);
}

function qidFromId(id) {
  const match = String(id || "").match(/wikidata\.org\/entity\/(Q\d+)/i);
  return match ? match[1].toUpperCase() : null;
}

function sparqlString(value) {
  return JSON.stringify(String(value || ""));
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

async function resolveBySparql(work) {
  if (!work.title) return null;

  const artist = String(work.artist || "").trim();
  const artistFilter = artist
    ? `OPTIONAL {
        ?item wdt:P170 ?creator.
        ?creator rdfs:label ?creatorLabel.
        FILTER(LANG(?creatorLabel) = "en")
      }
      FILTER(!BOUND(?creatorLabel) || CONTAINS(LCASE(STR(?creatorLabel)), ${sparqlString(artist.toLowerCase())}))`
    : "";

  const query = `SELECT ?item WHERE {
    VALUES ?artType { wd:Q838948 wd:Q3305213 wd:Q860861 wd:Q93184 wd:Q11060274 }
    ?item wdt:P31/wdt:P279* ?artType.
    ?item rdfs:label ${sparqlString(work.title)}@en.
    ${artistFilter}
  } LIMIT 5`;
  const url = "https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(query);
  const data = await fetchJson(url);
  const entity = data?.results?.bindings?.[0]?.item?.value;
  const match = entity && entity.match(/\/entity\/(Q\d+)$/);
  return match ? match[1] : null;
}

async function filterArtworkQids(qids) {
  const unique = [...new Set(qids.filter(qid => /^Q\d+$/.test(qid)))];
  if (!unique.length) return [];

  const query = `SELECT ?item WHERE {
    VALUES ?item { ${unique.map(qid => `wd:${qid}`).join(" ")} }
    VALUES ?artType { wd:Q838948 wd:Q3305213 wd:Q860861 wd:Q93184 wd:Q11060274 }
    ?item wdt:P31/wdt:P279* ?artType.
  }`;
  const url = "https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(query);
  const data = await fetchJson(url);
  const allowed = new Set(
    (data?.results?.bindings || [])
      .map(binding => binding.item?.value?.match(/\/entity\/(Q\d+)$/)?.[1])
      .filter(Boolean)
  );

  return unique.filter(qid => allowed.has(qid));
}

async function resolveBySearch(work) {
  const title = String(work.title || "").trim();
  if (!title) return null;

  const query = [title, work.artist || ""].filter(Boolean).join(" ");
  const url = new URL("https://www.wikidata.org/w/api.php");
  url.search = new URLSearchParams({
    action: "wbsearchentities",
    format: "json",
    language: "en",
    uselang: "en",
    type: "item",
    limit: "5",
    search: query,
  }).toString();

  const data = await fetchJson(url);
  const results = data?.search || [];
  if (!results.length) return null;

  const titleNorm = normalizeText(title);
  const artistNorm = normalizeText(work.artist || "");
  const candidateIds = results.map(result => result.id).filter(Boolean);
  const artworkIds = new Set(await filterArtworkQids(candidateIds));
  const artworkResults = results.filter(result => artworkIds.has(result.id));
  if (!artworkResults.length) return null;

  const strong = artworkResults.find(result => {
    const label = normalizeText(result.label);
    const description = normalizeText(result.description);
    return label === titleNorm || (label.includes(titleNorm) && (!artistNorm || description.includes(artistNorm)));
  });

  return (strong || artworkResults[0]).id || null;
}

async function resolveWikidata(work) {
  const direct = qidFromId(work.id);
  if (direct) return direct;
  return (await resolveBySparql(work)) || (await resolveBySearch(work));
}

async function fetchEntity(qid) {
  const url = new URL("https://www.wikidata.org/w/api.php");
  url.search = new URLSearchParams({
    action: "wbgetentities",
    format: "json",
    ids: qid,
    props: "sitelinks/urls",
  }).toString();
  return fetchJson(url);
}

async function fetchSitelinksAndTitle(qid) {
  const data = await fetchEntity(qid);
  const entity = data?.entities?.[qid];
  if (!entity || entity.missing !== undefined) {
    return { sitelinks: null, enwikiTitle: null };
  }

  return {
    sitelinks: Number(entity.sitelinks?.length ?? Object.keys(entity.sitelinks || {}).length ?? 0),
    enwikiTitle: entity.sitelinks?.enwiki?.title || null,
  };
}

function previousMonthRange(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const stamp = date => {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    const d = String(date.getUTCDate()).padStart(2, "0");
    return `${y}${m}${d}`;
  };
  return { start: `${stamp(start)}00`, end: `${stamp(end)}00` };
}

async function fetchMonthlyPageviews(enwikiTitle) {
  if (!enwikiTitle) return null;
  const { start, end } = previousMonthRange();
  const title = encodeURIComponent(enwikiTitle.replaceAll(" ", "_"));
  const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${title}/monthly/${start}/${end}`;
  const data = await fetchJson(url);
  const views = data?.items?.[0]?.views;
  return Number.isFinite(views) ? views : null;
}

function compositeFame({ sitelinks, pageviews, fallback }) {
  if (Number.isFinite(sitelinks)) {
    return 100 * Math.log(sitelinks + 1) + 15 * Math.log((pageviews || 0) + 1);
  }
  return 100 * Math.log((Number(fallback) || 0) + 1);
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

function assignTiers(scored) {
  const ranked = [...scored].sort((a, b) => b.result.fame - a.result.fame);
  const n = ranked.length;

  ranked.forEach((entry, index) => {
    const fraction = index / n;
    entry.result.tier =
      fraction < 0.25 ? "easy" :
      fraction < 0.5 ? "medium" :
      fraction < 0.75 ? "hard" :
      "impossible";
  });
}

function printSummary(scored) {
  const resolved = scored.filter(entry => entry.result.wikidata).length;
  const tierCounts = { easy: 0, medium: 0, hard: 0, impossible: 0 };
  for (const entry of scored) tierCounts[entry.result.tier]++;

  const ranked = [...scored].sort((a, b) => b.result.fame - a.result.fame);
  const fmt = entry => `${entry.work.title} (${entry.work.artist || "unknown"}): ${entry.result.fame.toFixed(1)}`;

  console.log(`Resolved to Wikidata: ${resolved}/${scored.length}`);
  console.log(`Tier counts: easy=${tierCounts.easy}, medium=${tierCounts.medium}, hard=${tierCounts.hard}, impossible=${tierCounts.impossible}`);
  console.log("\n10 highest-fame titles:");
  ranked.slice(0, 10).forEach((entry, index) => console.log(`${index + 1}. ${fmt(entry)}`));
  console.log("\n10 lowest-fame titles:");
  ranked.slice(-10).reverse().forEach((entry, index) => console.log(`${index + 1}. ${fmt(entry)}`));
}

async function scoreWork(work, index, total) {
  const wikidata = await resolveWikidata(work);
  let sitelinks = null;
  let pageviews = null;

  if (wikidata) {
    const entity = await fetchSitelinksAndTitle(wikidata);
    sitelinks = entity.sitelinks;
    pageviews = await fetchMonthlyPageviews(entity.enwikiTitle);
  }

  const fame = compositeFame({ sitelinks, pageviews, fallback: work.fame });
  if ((index + 1) % 25 === 0 || index + 1 === total) {
    console.log(`Scored ${index + 1}/${total}`);
  }

  return {
    work,
    result: {
      wikidata,
      sitelinks,
      pageviews,
      fame: Number(fame.toFixed(3)),
      tier: "impossible",
    },
  };
}

async function main() {
  const pool = readPool();
  const scored = await mapLimit(pool, CONCURRENCY, (work, index) => scoreWork(work, index, pool.length));
  assignTiers(scored);

  const output = {};
  for (const entry of scored) output[entry.work.id] = entry.result;
  writeFileSync(OUT_PATH, JSON.stringify(output, null, 2) + "\n");
  printSummary(scored);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
