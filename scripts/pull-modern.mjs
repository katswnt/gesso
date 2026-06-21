import { mkdir, writeFile } from "node:fs/promises";

const OUT_PATH = "data/incoming/modern.json";
const TARGET_TOTAL = 400;
const AIC_TARGET = TARGET_TOTAL;
const MET_TARGET = 140;

const AIC_API = "https://api.artic.edu/api/v1/artworks/search";
const AIC_IMAGE_BASE = "https://www.artic.edu/iiif/2";
const AIC_FIELDS = [
  "id",
  "title",
  "artist_display",
  "date_start",
  "date_end",
  "place_of_origin",
  "classification_title",
  "medium_display",
  "image_id",
  "is_public_domain",
  "is_on_view",
].join(",");

const MET_API = "https://collectionapi.metmuseum.org/public/collection/v1";
const MET_FALLBACK_DEPARTMENTS = [
  { id: 21, name: "Modern Art" },
  { id: 11, name: "European Paintings" },
];

const REQUEST_GAP_MS = 650;
const MET_CONCURRENCY = 1;

const movementNames = [
  "Impressionism",
  "Post-Impressionism",
  "Art Nouveau",
  "Fauvism",
  "Cubism",
  "Expressionism",
  "Bauhaus",
  "Surrealism",
  "American Modernism",
];

const aicQueries = [
  "",
  "painting",
  "modern",
  "impressionism",
  "post-impressionism",
  "art nouveau",
  "fauvism",
  "cubism",
  "expressionism",
  "bauhaus",
  "surrealism",
  "american modernism",
];

const metQueries = [
  "painting",
  "modern",
  "impressionism",
  "post-impressionism",
  "art nouveau",
  "fauvism",
  "cubism",
  "expressionism",
  "bauhaus",
  "surrealism",
  "american modernism",
];

const famousArtists = [
  "Claude Monet",
  "Pablo Picasso",
  "Henri Matisse",
  "Paul Cezanne",
  "Georgia O'Keeffe",
  "Edward Hopper",
  "Grant Wood",
  "Wassily Kandinsky",
  "Paul Klee",
  "Joan Miro",
  "Marc Chagall",
  "Piet Mondrian",
  "Marsden Hartley",
  "Arthur Dove",
  "Charles Demuth",
  "Stuart Davis",
];

let lastRequestAt = 0;
const metSkipCounts = new Map();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function cleanText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchJson(url, attempt = 1) {
  const wait = Math.max(0, REQUEST_GAP_MS - (Date.now() - lastRequestAt));
  if (wait) await sleep(wait);
  lastRequestAt = Date.now();

  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "artguessr-modern-pull/1.0",
    },
  });

  if ((response.status === 403 || response.status === 429 || response.status >= 500) && attempt <= 3) {
    const retryAfter = Number(response.headers.get("retry-after"));
    const backoff = Number.isFinite(retryAfter)
      ? retryAfter * 1000
      : 1500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 500);
    await sleep(backoff);
    return fetchJson(url, attempt + 1);
  }

  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`HTTP ${response.status} for ${url}: ${body.slice(0, 220)}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

function midpointYear(start, end) {
  const a = Number(start);
  const b = Number(end);
  if (Number.isFinite(a) && Number.isFinite(b) && b !== 0) return Math.round((a + b) / 2);
  if (Number.isFinite(a)) return Math.round(a);
  if (Number.isFinite(b)) return Math.round(b);
  return null;
}

function cleanArtist(value, place = "") {
  const firstLine = String(value ?? "").split(/\r?\n/).map(cleanText).find(Boolean) ?? "";
  const cleaned = firstLine
    .replace(/\([^)]*\b\d{3,4}\s*[-–]\s*\d{0,4}[^)]*\)/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\b\d{3,4}\s*[-–]\s*\d{0,4}\b/g, "")
    .replace(/[;,]\s*$/g, "")
    .trim();

  if (!cleaned) return "";
  if (place && cleaned.toLowerCase() === place.toLowerCase()) return "";
  if (/^(unknown|unidentified|artist unknown|maker unknown)$/i.test(cleaned)) return "";
  return cleaned;
}

function movementFromMetadata(...values) {
  const text = values.map(cleanText).join(" ").toLowerCase();
  if (!text) return "";

  for (const movement of movementNames) {
    const pattern = movement
      .toLowerCase()
      .replace("-", "[-\\s]")
      .replace(/\s+/g, "\\s+");
    if (new RegExp(`\\b${pattern}\\b`, "i").test(text)) return movement;
  }
  return "";
}

function fameHintFor(record, raw = {}, candidateScore = 0) {
  const artist = record.artist.toLowerCase();
  const artistBoost = famousArtists.some((name) => artist.includes(name.toLowerCase())) ? 8 : 0;
  const viewBoost = raw.is_on_view || raw.isOnView ? 4 : 0;
  const highlightBoost = raw.isHighlight ? 8 : 0;
  const timelineBoost = raw.isTimelineWork ? 3 : 0;
  const score = candidateScore + artistBoost + viewBoost + highlightBoost + timelineBoost;
  return score > 0 ? Math.round(score * 100) / 100 : null;
}

function finalRecordIsValid(record) {
  return (
    record &&
    typeof record.id === "string" &&
    typeof record.image === "string" &&
    record.image.trim() &&
    Number.isInteger(record.year) &&
    record.year >= 1900 &&
    typeof record.place === "string" &&
    record.place.trim() &&
    (record.src === "aic" || record.src === "met")
  );
}

function makeAicUrl({ q, page }) {
  const url = new URL(AIC_API);
  url.searchParams.set("fields", AIC_FIELDS);
  url.searchParams.set("limit", "100");
  url.searchParams.set("page", String(page));
  if (q) url.searchParams.set("q", q);
  url.searchParams.set("query[bool][must][0][term][is_public_domain]", "true");
  url.searchParams.set("query[bool][must][1][exists][field]", "image_id");
  url.searchParams.set("query[bool][must][2][range][date_start][gte]", "1900");
  return url;
}

function normalizeAic(work) {
  const place = cleanText(work.place_of_origin);
  const year = midpointYear(work.date_start, work.date_end);
  if (work.is_public_domain !== true || !work.image_id || !place || !Number.isInteger(year) || year < 1900) {
    return null;
  }

  const artist = cleanArtist(work.artist_display, place);
  const record = {
    id: `aic${work.id}`,
    title: cleanText(work.title) || "Untitled",
    artist,
    year,
    place,
    culture: "",
    movement: movementFromMetadata(
      work.title,
      work.artist_display,
      work.classification_title,
      work.medium_display,
    ),
    medium: cleanText(work.medium_display || work.classification_title),
    image: `${AIC_IMAGE_BASE}/${work.image_id}/full/843,/0/default.jpg`,
    src: "aic",
    fameHint: null,
  };
  record.fameHint = fameHintFor(record, work, Number(work._score || 0) / 1_000_000);
  return record;
}

function recordScore(record) {
  const movementBoost = record.movement ? 10 : 0;
  const mediumBoost = /\b(painting|oil|canvas|tempera|panel|watercolor|gouache|print|lithograph|woodcut)\b/i.test(
    record.medium,
  )
    ? 5
    : 0;
  const artistBoost = record.artist ? 2 : 0;
  return (record.fameHint ?? 0) + movementBoost + mediumBoost + artistBoost;
}

async function pullAic() {
  const rawById = new Map();

  for (const q of aicQueries) {
    const maxPages = q ? 3 : 8;
    for (let page = 1; page <= maxPages; page += 1) {
      const json = await fetchJson(makeAicUrl({ q, page }));
      for (const work of json.data ?? []) {
        if (!rawById.has(work.id)) rawById.set(work.id, work);
      }
      if ((json.data ?? []).length === 0) break;
    }
  }

  return [...rawById.values()]
    .map(normalizeAic)
    .filter(finalRecordIsValid)
    .sort((a, b) => recordScore(b) - recordScore(a) || a.id.localeCompare(b.id))
    .slice(0, AIC_TARGET);
}

function metSearchUrl({ departmentId, q }) {
  const url = new URL(`${MET_API}/search`);
  url.searchParams.set("hasImages", "true");
  url.searchParams.set("departmentId", String(departmentId));
  url.searchParams.set("q", q);
  return url;
}

async function metDepartments() {
  try {
    const json = await fetchJson(`${MET_API}/departments`);
    const departments = json.departments ?? [];
    const wanted = departments.filter((dept) =>
      /^(Modern Art|Modern and Contemporary Art|European Paintings)$/i.test(dept.displayName),
    );
    if (wanted.length >= 2) {
      return wanted.map((dept) => ({ id: dept.departmentId, name: dept.displayName }));
    }
  } catch (error) {
    console.warn(`Met departments fallback: ${error.message}`);
  }
  return MET_FALLBACK_DEPARTMENTS;
}

async function searchMetCandidates() {
  const departments = await metDepartments();
  const candidates = new Map();

  for (const dept of departments) {
    for (const q of metQueries) {
      try {
        const json = await fetchJson(metSearchUrl({ departmentId: dept.id, q }));
        const ids = Array.isArray(json.objectIDs) ? json.objectIDs : [];
        ids.slice(0, 160).forEach((objectID, index) => {
          const current = candidates.get(objectID) ?? {
            objectID,
            departmentId: dept.id,
            departmentName: dept.name,
            score: 0,
          };
          const movementBoost = movementNames.some((name) => name.toLowerCase() === q) ? 8 : 0;
          current.score += 1 + movementBoost + Math.max(0, 120 - index) / 120;
          candidates.set(objectID, current);
        });
      } catch (error) {
        console.warn(`Met search skipped (${dept.name}, ${q}): ${error.message}`);
      }
    }
  }

  return [...candidates.values()]
    .sort((a, b) => b.score - a.score || a.objectID - b.objectID)
    .slice(0, 500);
}

function bestMetPlace(object) {
  return [
    object.country,
    object.region,
    object.subregion,
    object.locale,
    object.city,
    object.state,
    object.county,
    object.culture,
  ].map(cleanText).find(Boolean) ?? "";
}

function metMetadataText(object) {
  const tags = Array.isArray(object.tags)
    ? object.tags.map((tag) => tag.term || tag.AAT_URL || "").join(" ")
    : "";
  return [
    object.title,
    object.objectName,
    object.classification,
    object.medium,
    object.artistDisplayBio,
    object.artistNationality,
    object.culture,
    object.period,
    object.dynasty,
    object.reign,
    tags,
  ].join(" ");
}

function normalizeMet(object, candidate) {
  const image = cleanText(object.primaryImage);
  const place = bestMetPlace(object);
  const begin = Number(object.objectBeginDate);
  const year = midpointYear(object.objectBeginDate, object.objectEndDate);

  if (
    object.isPublicDomain !== true ||
    !image ||
    !place ||
    !Number.isFinite(begin) ||
    begin < 1900 ||
    !Number.isInteger(year) ||
    year < 1900
  ) {
    return null;
  }

  const artist = cleanText(object.artistDisplayName);
  const record = {
    id: `met${object.objectID}`,
    title: cleanText(object.title) || "Untitled",
    artist: /^(unknown|unidentified)$/i.test(artist) ? "" : artist,
    year,
    place,
    culture: "",
    movement: movementFromMetadata(metMetadataText(object), candidate?.departmentName),
    medium: cleanText(object.medium || object.classification || object.objectName),
    image,
    src: "met",
    fameHint: null,
  };
  record.fameHint = fameHintFor(record, object, candidate?.score ?? 0);
  return record;
}

async function mapPool(items, limit, mapper) {
  const results = [];
  let index = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      results.push(await mapper(item));
    }
  });
  await Promise.all(workers);
  return results;
}

async function pullMet() {
  const candidates = await searchMetCandidates();
  const accepted = [];
  let consecutiveForbidden = 0;

  await mapPool(candidates, MET_CONCURRENCY, async (candidate) => {
    if (accepted.length >= MET_TARGET * 2) return null;
    if (consecutiveForbidden >= 5) return null;
    try {
      const object = await fetchJson(`${MET_API}/objects/${candidate.objectID}`);
      consecutiveForbidden = 0;
      const record = normalizeMet(object, candidate);
      if (finalRecordIsValid(record)) accepted.push(record);
    } catch (error) {
      const key = `HTTP ${error.status ?? "error"}`;
      metSkipCounts.set(key, (metSkipCounts.get(key) ?? 0) + 1);
      if (error.status === 403) consecutiveForbidden += 1;
    }
    return null;
  });

  const deduped = new Map();
  for (const record of accepted) deduped.set(record.id, record);

  return [...deduped.values()]
    .sort((a, b) => recordScore(b) - recordScore(a) || a.id.localeCompare(b.id))
    .slice(0, MET_TARGET);
}

function dedupe(records) {
  const byId = new Map();
  for (const record of records) {
    if (finalRecordIsValid(record) && !byId.has(record.id)) byId.set(record.id, record);
  }
  return [...byId.values()].slice(0, TARGET_TOTAL);
}

async function main() {
  const aic = await pullAic();
  const met = await pullMet();
  const records = dedupe([...met, ...aic]);

  if (records.length === 0) {
    throw new Error("No public-domain modern records collected; leaving output untouched.");
  }

  await mkdir("data/incoming", { recursive: true });
  await writeFile(OUT_PATH, `${JSON.stringify(records, null, 2)}\n`);

  console.log(`aic: ${records.filter((record) => record.src === "aic").length}`);
  console.log(`met: ${records.filter((record) => record.src === "met").length}`);
  if (metSkipCounts.size > 0) {
    console.log(
      `met skipped: ${[...metSkipCounts.entries()]
        .map(([key, count]) => `${key}=${count}`)
        .join(", ")}`,
    );
  }
  console.log(`output: ${OUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
