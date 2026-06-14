import { mkdir, readFile, writeFile } from "node:fs/promises";

const API = "https://collectionapi.metmuseum.org/public/collection/v1";
const OUT = "data/incoming/met-extra.json";
const TARGET = 350;
const CONCURRENCY = 1;
const REQUEST_GAP_MS = 350;

const broadQueries = [
  "painting",
  "sculpture",
  "mask",
  "vessel",
  "figure",
  "manuscript",
  "textile",
  "scroll",
];

const departments = [
  { id: 6, name: "Asian Art", quota: 92, weight: 8 },
  { id: 14, name: "Islamic Art", quota: 62, weight: 7 },
  { id: 5, name: "Arts of Africa, Oceania, and the Americas", quota: 92, weight: 8 },
  { id: 10, name: "Egyptian Art", quota: 56, weight: 6 },
  { id: 3, name: "Ancient Near Eastern Art", quota: 34, weight: 5 },
  { id: 13, name: "Greek and Roman Art", quota: 14, weight: 1 },
];

const artsOfAmericasQueries = [
  "Americas",
  "Native American",
  "Precolumbian",
  "Maya",
  "Aztec",
  "Inca",
  "Peru",
  "Moche",
  "Navajo",
  "Pueblo",
];

const importantBoostQueries = [
  "highlight",
  "masterpiece",
  "ritual",
  "ceremonial",
  "Buddha",
  "bodhisattva",
  "samurai",
  "calligraphy",
  "Qur'an",
  "mihrab",
  "shahnameh",
  "mummy",
  "coffin",
  "sarcophagus",
  "relief",
  "stela",
  "lamassu",
  "power figure",
  "reliquary",
];

let lastRequestAt = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function politeFetchJson(url, attempt = 1) {
  const wait = Math.max(0, REQUEST_GAP_MS - (Date.now() - lastRequestAt));
  if (wait) await sleep(wait);
  lastRequestAt = Date.now();

  const response = await fetch(url, {
    headers: {
      "user-agent": "artguessr-met-extra-pull/1.0",
      accept: "application/json",
    },
  });
  if ((response.status === 403 || response.status === 429 || response.status >= 500) && attempt <= 5) {
    const backoff = 1500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 500);
    await sleep(backoff);
    return politeFetchJson(url, attempt + 1);
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.json();
}

function searchUrl(params) {
  const url = new URL(`${API}/search`);
  url.searchParams.set("hasImages", "true");
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

async function searchIds(params, meta, candidates) {
  try {
    const data = await politeFetchJson(searchUrl(params));
    const ids = Array.isArray(data.objectIDs) ? data.objectIDs : [];
    ids.forEach((objectID, index) => {
      const current = candidates.get(objectID) ?? {
        objectID,
        score: 0,
        searches: 0,
        deptId: meta.deptId ?? null,
        deptWeight: meta.deptWeight ?? 0,
      };
      current.searches += 1;
      current.deptId = current.deptId ?? meta.deptId ?? null;
      current.deptWeight = Math.max(current.deptWeight, meta.deptWeight ?? 0);
      current.score += (meta.boost ?? 1) + Math.max(0, 80 - index) / 80;
      candidates.set(objectID, current);
    });
  } catch (error) {
    console.warn(`Search skipped: ${error.message}`);
  }
}

function parseExistingMetIds(source) {
  const ids = new Set();
  for (const match of source.matchAll(/"id"\s*:\s*"met(\d+)"/g)) {
    ids.add(`met${match[1]}`);
  }
  return ids;
}

function bestYear(object) {
  const begin = Number(object.objectBeginDate);
  const end = Number(object.objectEndDate);
  if (!Number.isFinite(begin) && !Number.isFinite(end)) return null;
  if (Number.isFinite(begin) && Number.isFinite(end)) {
    return Math.round((begin + end) / 2);
  }
  return Math.round(Number.isFinite(begin) ? begin : end);
}

function bestPlace(object) {
  return [
    object.country,
    object.region,
    object.culture,
  ].find((value) => typeof value === "string" && value.trim())?.trim() ?? "";
}

function normalizeObject(object) {
  const year = bestYear(object);
  const place = bestPlace(object);
  const culture = typeof object.culture === "string" ? object.culture.trim() : "";
  const image = typeof object.primaryImage === "string" ? object.primaryImage.trim() : "";

  if (!object.isPublicDomain || !image || year === null || (!place && !culture)) {
    return null;
  }

  return {
    id: `met${object.objectID}`,
    title: object.title || "",
    artist: object.artistDisplayName || "",
    year,
    place,
    culture,
    movement: "",
    medium: object.medium || "",
    image,
    src: "met",
    fameHint: object.isHighlight ? 2 : object.isTimelineWork ? 1 : 0,
  };
}

function objectScore(record, raw, candidate) {
  const title = `${record.title} ${record.medium} ${record.culture}`.toLowerCase();
  const typeBoost = [
    "painting",
    "sculpture",
    "statue",
    "figure",
    "mask",
    "vessel",
    "manuscript",
    "textile",
    "scroll",
    "relief",
    "coffin",
    "stela",
  ].some((word) => title.includes(word)) ? 4 : 0;
  return (
    candidate.score +
    candidate.deptWeight * 3 +
    (raw.isHighlight ? 30 : 0) +
    (raw.isTimelineWork ? 15 : 0) +
    (raw.isOnView ? 8 : 0) +
    typeBoost
  );
}

async function mapPool(items, limit, mapper) {
  const results = [];
  let index = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (index < items.length) {
      const item = items[index++];
      results.push(await mapper(item));
    }
  });
  await Promise.all(workers);
  return results;
}

function diversifyCandidates(candidates, limit) {
  const groups = new Map();
  for (const candidate of candidates) {
    const key = candidate.deptId ?? "global";
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => b.score + b.deptWeight - (a.score + a.deptWeight));
  }

  const diversified = [];
  while (diversified.length < limit) {
    let added = false;
    for (const group of groups.values()) {
      const candidate = group.shift();
      if (candidate) {
        diversified.push(candidate);
        added = true;
        if (diversified.length >= limit) break;
      }
    }
    if (!added) break;
  }
  return diversified;
}

async function main() {
  const poolSource = await readFile("data/pool.js", "utf8");
  const existingIds = parseExistingMetIds(poolSource);
  const candidates = new Map();

  for (const dept of departments) {
    await searchIds(
      { departmentId: dept.id, q: dept.name, isHighlight: "true" },
      { deptId: dept.id, deptWeight: dept.weight, boost: 12 },
      candidates,
    );
    await searchIds(
      { departmentId: dept.id, q: dept.name, isOnView: "true" },
      { deptId: dept.id, deptWeight: dept.weight, boost: 6 },
      candidates,
    );
    for (const q of broadQueries) {
      await searchIds(
        { departmentId: dept.id, q },
        { deptId: dept.id, deptWeight: dept.weight, boost: 4 },
        candidates,
      );
    }
  }

  for (const q of artsOfAmericasQueries) {
    await searchIds(
      { departmentId: 5, q },
      { deptId: 5, deptWeight: 9, boost: 7 },
      candidates,
    );
  }

  for (const q of importantBoostQueries) {
    await searchIds(
      { q, isHighlight: "true" },
      { deptId: null, deptWeight: 3, boost: 8 },
      candidates,
    );
  }

  const orderedCandidates = diversifyCandidates([...candidates.values()]
    .filter((candidate) => !existingIds.has(`met${candidate.objectID}`))
    .sort((a, b) => b.score + b.deptWeight - (a.score + a.deptWeight)), 2500);

  const acceptedByDept = new Map();
  const accepted = [];

  await mapPool(orderedCandidates, CONCURRENCY, async (candidate) => {
    if (accepted.length >= TARGET) return null;
    const dept = departments.find((item) => item.id === candidate.deptId);
    const currentDeptCount = acceptedByDept.get(candidate.deptId) ?? 0;
    if (dept && currentDeptCount >= dept.quota) return null;

    try {
      const raw = await politeFetchJson(`${API}/objects/${candidate.objectID}`);
      const normalized = normalizeObject(raw);
      if (!normalized || existingIds.has(normalized.id)) return null;
      const score = objectScore(normalized, raw, candidate);
      accepted.push({ record: normalized, score, deptId: candidate.deptId });
      acceptedByDept.set(candidate.deptId, currentDeptCount + 1);
    } catch (error) {
      console.warn(`Object skipped: ${candidate.objectID}: ${error.message}`);
    }
    return null;
  });

  const deduped = new Map();
  for (const item of accepted) {
    const existing = deduped.get(item.record.id);
    if (!existing || item.score > existing.score) {
      deduped.set(item.record.id, item);
    }
  }

  const records = [...deduped.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, TARGET)
    .map((item) => item.record);

  if (records.length === 0) {
    throw new Error("No Met records collected; leaving existing output untouched.");
  }

  await mkdir("data/incoming", { recursive: true });
  await writeFile(`${OUT}`, `${JSON.stringify(records, null, 2)}\n`);
  console.log(`met ${records.length} ${OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
