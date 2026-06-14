import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const SOURCE = "wikidata";
const OUTPUT_PATH = path.join("data", "incoming", "wikidata-extra.json");
const ENDPOINT = "https://query.wikidata.org/sparql";
const USER_AGENT =
  "artguessr-extra-wikidata-pull/1.0 (https://github.com/; contact: artguessr local data script)";
const TARGET_COUNT = 350;
const PER_CLASS_LIMIT = 90;
const BATCH_SIZE = 40;

const artworkClasses = [
  { id: "Q3305213", label: "painting", subclasses: true },
  { id: "Q860861", label: "sculpture", subclasses: true },
  { id: "Q838948", label: "work of art", subclasses: false, limit: 45 },
  { id: "Q93184", label: "drawing", subclasses: true },
  { id: "Q1064538", label: "ukiyo-e", subclasses: true },
  { id: "Q11060274", label: "print", subclasses: true },
  { id: "Q179700", label: "statue", subclasses: true },
  { id: "Q245117", label: "relief", subclasses: true },
  { id: "Q15711026", label: "altarpiece", subclasses: true },
  { id: "Q133067", label: "mosaic", subclasses: true },
  { id: "Q184296", label: "tapestry", subclasses: true },
  { id: "Q191851", label: "vase", subclasses: true },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function baseQuery(artworkClass) {
  const instancePattern = artworkClass.subclasses
    ? `?item wdt:P31/wdt:P279* wd:${artworkClass.id}`
    : `?item wdt:P31 wd:${artworkClass.id}`;
  const limit = artworkClass.limit ?? PER_CLASS_LIMIT;

  return `
SELECT
  ?item
  ?itemLabel
  ?image
  ?inception
  ?country
  ?countryLabel
  ?sitelinks
WHERE {
  ${instancePattern} ;
        wdt:P18 ?image ;
        wdt:P571 ?inception ;
        wdt:P495 ?country ;
        wikibase:sitelinks ?sitelinks .

  ?country wdt:P625 ?countryCoord .

  SERVICE wikibase:label {
    bd:serviceParam wikibase:language "en" .
    ?item rdfs:label ?itemLabel .
    ?country rdfs:label ?countryLabel .
  }
}
ORDER BY DESC(?sitelinks)
LIMIT ${limit}
`;
}

function metadataQuery(qids) {
  const values = qids.map((qid) => `wd:${qid}`).join(" ");
  return `
SELECT
  ?item
  (SAMPLE(?creatorLabel) AS ?artistLabel)
  (GROUP_CONCAT(DISTINCT ?movementLabel; separator="; ") AS ?movementLabels)
  (GROUP_CONCAT(DISTINCT ?materialLabel; separator="; ") AS ?materialLabels)
WHERE {
  VALUES ?item { ${values} }

  OPTIONAL { ?item wdt:P170 ?creator . }
  OPTIONAL { ?item wdt:P135 ?movement . }
  OPTIONAL { ?item wdt:P186 ?material . }

  SERVICE wikibase:label {
    bd:serviceParam wikibase:language "en" .
    ?creator rdfs:label ?creatorLabel .
    ?movement rdfs:label ?movementLabel .
    ?material rdfs:label ?materialLabel .
  }
}
GROUP BY ?item
`;
}

async function fetchWithRetry(url, options, attempts = 5) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);

    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      if (response.ok) {
        return response;
      }

      const retryable = response.status === 429 || response.status >= 500;
      const body = await response.text().catch(() => "");
      if (!retryable || attempt === attempts) {
        throw new Error(`HTTP ${response.status}: ${body.slice(0, 300)}`);
      }
    } catch (error) {
      lastError = error;
      if (attempt === attempts) {
        break;
      }
    } finally {
      clearTimeout(timeout);
    }

    await sleep(800 * attempt);
  }

  throw lastError;
}

function bindingValue(row, key) {
  return row[key]?.value ?? "";
}

function qidFromEntityUrl(entityUrl) {
  return entityUrl.match(/\/(Q\d+)$/)?.[1] ?? "";
}

function yearFromWikidataTime(value) {
  const match = value.match(/^([+-]?\d{1,})-/);
  if (!match) {
    return null;
  }

  const year = Number.parseInt(match[1].replace(/^\+/, ""), 10);
  return Number.isFinite(year) ? year : null;
}

function commonsFilePathUrl(value) {
  const marker = "/Special:FilePath/";
  const markerIndex = value.indexOf(marker);
  if (markerIndex === -1) {
    return "";
  }

  const fileName = decodeURIComponent(value.slice(markerIndex + marker.length));
  const encodedName = encodeURIComponent(fileName).replace(/%20/g, "_");
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodedName}?width=900`;
}

function normalizeRow(row) {
  const qid = qidFromEntityUrl(bindingValue(row, "item"));
  const title = bindingValue(row, "itemLabel").trim();
  const country = bindingValue(row, "countryLabel").trim();
  const image = commonsFilePathUrl(bindingValue(row, "image"));
  const year = yearFromWikidataTime(bindingValue(row, "inception"));
  const fameHint = Number.parseInt(bindingValue(row, "sitelinks"), 10);

  if (!qid || !title || !image || year === null || !country) {
    return null;
  }

  return {
    id: `${SOURCE}:${qid}`,
    title,
    artist: bindingValue(row, "artistLabel").trim(),
    year,
    place: country,
    culture: country,
    movement: bindingValue(row, "movementLabels").trim(),
    medium: bindingValue(row, "materialLabels").trim(),
    image,
    src: SOURCE,
    fameHint: Number.isFinite(fameHint) ? fameHint : null,
  };
}

async function runSparql(sparql) {
  const url = `${ENDPOINT}?format=json&query=${encodeURIComponent(sparql)}`;
  const response = await fetchWithRetry(url, {
    headers: {
      Accept: "application/sparql-results+json",
      "User-Agent": USER_AGENT,
    },
  });

  return response.json();
}

async function main() {
  const recordsById = new Map();

  for (const artworkClass of artworkClasses) {
    await sleep(400);
    const data = await runSparql(baseQuery(artworkClass)).catch((error) => {
      console.warn(`Skipping ${artworkClass.label} (${artworkClass.id}): ${error.message}`);
      return null;
    });

    for (const row of data?.results?.bindings ?? []) {
      const record = normalizeRow(row);
      if (!record) {
        continue;
      }

      const current = recordsById.get(record.id);
      if (!current || (record.fameHint ?? 0) > (current.fameHint ?? 0)) {
        recordsById.set(record.id, record);
      }
    }
  }

  const sortedRecords = [...recordsById.values()]
    .sort((a, b) => (b.fameHint ?? 0) - (a.fameHint ?? 0))
    .slice(0, TARGET_COUNT);

  for (let index = 0; index < sortedRecords.length; index += BATCH_SIZE) {
    const batch = sortedRecords.slice(index, index + BATCH_SIZE);
    await sleep(400);
    const qids = batch.map((record) => record.id.split(":")[1]);
    const data = await runSparql(metadataQuery(qids)).catch((error) => {
      console.warn(`Skipping metadata batch ${index / BATCH_SIZE + 1}: ${error.message}`);
      return null;
    });

    for (const row of data?.results?.bindings ?? []) {
      const qid = qidFromEntityUrl(bindingValue(row, "item"));
      const record = sortedRecords.find((candidate) => candidate.id === `${SOURCE}:${qid}`);
      if (!record) {
        continue;
      }

      record.artist = bindingValue(row, "artistLabel").trim();
      record.movement = bindingValue(row, "movementLabels").trim();
      record.medium = bindingValue(row, "materialLabels").trim();
    }
  }

  const records = sortedRecords.slice(0, TARGET_COUNT);

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(`${OUTPUT_PATH}`, `${JSON.stringify(records, null, 2)}\n`);

  console.log(`${SOURCE}: wrote ${records.length} records to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
