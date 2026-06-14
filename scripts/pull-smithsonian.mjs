import { mkdir, writeFile } from "node:fs/promises";

const API = "https://api.si.edu/openaccess/api/v1.0/search";
const SOURCE = "smithsonian";
const OUT_PATH = "data/incoming/smithsonian.json";
const ROWS = 100;
const TARGET = 350;
const SLEEP_MS = 160;

const UNIT_PLANS = [
  { requested: "NMAfA", unit: "NMAfA", target: 175 },
  // Smithsonian's current Open Access unit code for the Freer|Sackler / National Museum of Asian Art.
  { requested: "FSG", unit: "NMAA", target: 175 },
];

const OBJECT_TERMS = [
  "masterpiece",
  "highlight",
  "on view",
  "painting",
  "sculpture",
  "buddha",
  "mask",
  "figure",
  "vessel",
  "textile",
  "manuscript",
  "ceramic",
  "bronze",
  "jade",
  "screen",
  "print",
  "ritual",
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function cleanText(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function values(items) {
  return Array.isArray(items) ? items.map((item) => cleanText(item?.content ?? item)).filter(Boolean) : [];
}

function firstValue(...groups) {
  for (const group of groups) {
    const value = Array.isArray(group) ? group.find(Boolean) : cleanText(group);
    if (value) return value;
  }
  return "";
}

function makeUrl(q, start) {
  const url = new URL(API);
  url.searchParams.set("q", q);
  url.searchParams.set("rows", String(ROWS));
  url.searchParams.set("start", String(start));
  url.searchParams.set("api_key", process.env.SI_KEY);
  return url;
}

async function fetchJson(url, attempt = 1) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if ((response.status === 429 || response.status >= 500) && attempt <= 5) {
    const retryAfter = Number(response.headers.get("retry-after"));
    const wait = Number.isFinite(retryAfter) ? retryAfter * 1000 : 600 * attempt;
    await sleep(wait);
    return fetchJson(url, attempt + 1);
  }
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${body.slice(0, 220)}`);
  }
  return response.json();
}

async function pullQuery(q, maxPages = 6) {
  const rows = [];
  for (let start = 0; start < ROWS * maxPages; start += ROWS) {
    const json = await fetchJson(makeUrl(q, start));
    const page = json.response?.rows ?? [];
    rows.push(...page);
    if (page.length < ROWS || rows.length >= Number(json.response?.rowCount ?? 0)) break;
    await sleep(SLEEP_MS);
  }
  await sleep(SLEEP_MS);
  return rows;
}

function hasOpenRights(record, media) {
  const mediaRights = [
    media?.usage?.access,
    media?.usage?.text,
    media?.usage?.label,
    media?.usage,
    ...(record.content?.indexedStructured?.online_media_rights ?? []),
    ...values(record.content?.freetext?.objectRights),
  ]
    .map((value) => cleanText(value).toLowerCase())
    .join(" ");

  return /\bcc0\b|creative commons zero|open access|public domain|no known copyright/.test(mediaRights);
}

function imageFrom(record) {
  const mediaItems = record.content?.descriptiveNonRepeating?.online_media?.media ?? [];
  for (const media of mediaItems) {
    const urls = [
      media?.resources?.find((resource) => /jpeg|screen image/i.test(resource?.label ?? ""))?.url,
      media?.content,
      media?.thumbnail,
    ];
    const image = urls.find((url) => /^https:\/\/.+/i.test(url ?? ""));
    if (image && hasOpenRights(record, media)) return image;
  }
  return "";
}

function parseCentury(text) {
  const normalized = text.toLowerCase();
  const match = normalized.match(/\b(early|mid|middle|late)?\s*(\d{1,2})(?:st|nd|rd|th)?\s*centur(?:y|ies)\b/);
  if (!match) return null;
  const century = Number(match[2]);
  if (!Number.isFinite(century)) return null;
  const offset = match[1]?.startsWith("early") ? 25 : match[1]?.startsWith("late") ? 75 : 50;
  const year = (century - 1) * 100 + offset;
  return /\b(bce|bc|b\.c)/i.test(text) ? -year : year;
}

function parseYearText(text) {
  const cleaned = cleanText(text)
    .replace(/[\u2012-\u2015]/g, "-")
    .replace(/\b(ca|circa|c|probably|possibly|before|after)\.?\b/gi, " ");
  if (!cleaned) return null;

  const century = parseCentury(cleaned);
  if (century !== null) return century;

  const isBce = /\b(bce|bc|b\.c)/i.test(cleaned);
  const isCe = /\b(ce|ad|a\.d)/i.test(cleaned);
  const matches = [...cleaned.matchAll(/\b\d{1,4}s?\b/g)]
    .map((match) => match[0])
    .map((value) => (value.endsWith("s") ? Number(value.slice(0, -1)) + 50 : Number(value)))
    .filter((year) => Number.isFinite(year) && year > 0);

  if (!matches.length) return null;
  const years = matches.slice(0, 2).map((year) => (isBce && !isCe ? -year : year));
  return Math.round(years.reduce((sum, year) => sum + year, 0) / years.length);
}

function yearFrom(record) {
  const freetext = record.content?.freetext ?? {};
  const structured = record.content?.indexedStructured ?? {};
  const dateTexts = [
    ...values(freetext.date),
    ...values(record.content?.descriptiveNonRepeating?.date),
    ...(structured.date ?? []).map(cleanText),
  ];
  for (const text of dateTexts) {
    const year = parseYearText(text);
    if (year !== null) return year;
  }
  return null;
}

function artistFrom(record) {
  const names = record.content?.freetext?.name ?? [];
  const preferred = names.find((name) => /artist|maker|creator|painter|sculptor|calligrapher|potter/i.test(name?.label ?? ""));
  const fallback = names[0];
  const artist = cleanText((preferred ?? fallback)?.content);
  return /^(unknown|unidentified|anonymous|artist unknown|maker unknown)$/i.test(artist) ? "" : artist;
}

function geoValues(record) {
  const geo = record.content?.indexedStructured?.geoLocation ?? [];
  const out = [];
  for (const item of geo) {
    for (const value of Object.values(item ?? {})) {
      const content = cleanText(value?.content);
      if (content) out.push(content);
    }
  }
  return out;
}

function placeFrom(record) {
  return firstValue(
    values(record.content?.freetext?.place),
    record.content?.indexedStructured?.place ?? [],
    geoValues(record),
  );
}

function cultureFrom(record) {
  return firstValue(record.content?.indexedStructured?.culture ?? [], geoValues(record));
}

function mediumFrom(record) {
  return firstValue(
    values(record.content?.freetext?.physicalDescription).filter((value) => !/^\s*(h|w|d|diam|overall|dimensions?)\b/i.test(value)),
    record.content?.indexedStructured?.object_type ?? [],
    values(record.content?.freetext?.objectType),
  );
}

function nativeId(record) {
  return cleanText(record.content?.descriptiveNonRepeating?.record_ID || record.url || record.id).replace(/^edanmdm:/, "");
}

function normalize(record) {
  const image = imageFrom(record);
  const year = yearFrom(record);
  const place = placeFrom(record);
  const culture = cultureFrom(record);
  if (!image || year === null || (!place && !culture)) return null;

  return {
    id: `si${nativeId(record)}`.replace(/\s+/g, ""),
    title: cleanText(record.content?.descriptiveNonRepeating?.title?.content || record.title) || "Untitled",
    artist: artistFrom(record),
    year,
    place,
    culture,
    movement: "",
    medium: mediumFrom(record),
    image,
    src: SOURCE,
    fameHint: null,
  };
}

function score(record, normalized, queryIndex) {
  const freetext = record.content?.freetext ?? {};
  const structured = record.content?.indexedStructured ?? {};
  const text = [
    normalized.title,
    normalized.artist,
    normalized.medium,
    normalized.place,
    normalized.culture,
    ...values(freetext.notes),
    ...(structured.onPhysicalExhibit ?? []),
    ...(structured.object_type ?? []),
  ]
    .join(" ")
    .toLowerCase();

  let total = 1000 - queryIndex * 8;
  if ((structured.onPhysicalExhibit ?? []).length || /\bon view\b|exhibition history/.test(text)) total += 1800;
  if (/highlight|masterpiece|important|renowned|famous|signature/.test(text)) total += 1500;
  if (/painting|sculpture|mask|figure|vessel|buddha|textile|manuscript|ceramic|bronze|jade|screen|ritual/.test(text)) total += 700;
  if (normalized.artist && !/ artist$/i.test(normalized.artist)) total += 220;
  if (normalized.year < 1700) total += 160;
  if (/fragment|sherd|sample|negative|photograph|postcard|envelope|letter|coin|button/.test(text)) total -= 650;
  return total;
}

async function pullUnit(plan) {
  const base = `unit_code:${plan.requested} AND online_media_type:Images`;
  let rows = await pullQuery(base, 2);
  const unit = rows.length ? plan.requested : plan.unit;
  const queries = [
    `unit_code:${unit} AND online_media_type:Images`,
    ...OBJECT_TERMS.map((term) => `unit_code:${unit} AND online_media_type:Images AND ${term}`),
  ];

  const candidates = [];
  const seenRaw = new Set();
  for (const [queryIndex, q] of queries.entries()) {
    const pages = queryIndex === 0 ? 8 : 3;
    for (const row of await pullQuery(q, pages)) {
      const key = row.url || row.id;
      if (seenRaw.has(key)) continue;
      seenRaw.add(key);
      const normalized = normalize(row);
      if (normalized) candidates.push({ normalized, score: score(row, normalized, queryIndex) });
    }
  }

  const seenIds = new Set();
  return candidates
    .sort((a, b) => b.score - a.score || a.normalized.title.localeCompare(b.normalized.title))
    .filter((item) => {
      if (seenIds.has(item.normalized.id)) return false;
      seenIds.add(item.normalized.id);
      return true;
    })
    .slice(0, plan.target)
    .map((item) => item.normalized);
}

function balance(units) {
  const selected = units.flat();
  if (selected.length <= TARGET) return selected;

  const out = [];
  const queues = units.map((items) => [...items]);
  while (out.length < TARGET && queues.some((queue) => queue.length)) {
    for (const queue of queues) {
      const item = queue.shift();
      if (item) out.push(item);
      if (out.length >= TARGET) break;
    }
  }
  return out;
}

if (!process.env.SI_KEY) {
  throw new Error("Missing required SI_KEY environment variable");
}

const units = [];
for (const plan of UNIT_PLANS) {
  units.push(await pullUnit(plan));
}

const records = balance(units);
await mkdir("data/incoming", { recursive: true });
await writeFile(OUT_PATH, `${JSON.stringify(records, null, 2)}\n`);

console.log(`${SOURCE} ${records.length} ${OUT_PATH}`);
