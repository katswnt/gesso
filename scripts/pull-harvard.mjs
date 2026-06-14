import { mkdir, writeFile } from "node:fs/promises";

const SOURCE = "harvard";
const OUT_PATH = "data/incoming/harvard.json";
const BASE = "https://api.harvardartmuseums.org/object";
const SIZE = 100;
const TARGET = 350;
const FIELDS = [
  "id",
  "title",
  "people",
  "dated",
  "datebegin",
  "dateend",
  "culture",
  "classification",
  "medium",
  "primaryimageurl",
  "division",
  "rank",
  "totalpageviews",
  "verificationlevel",
  "accesslevel",
  "imagepermissionlevel",
].join(",");

const HARVARD_KEY = process.env.HARVARD_KEY;
if (!HARVARD_KEY) {
  throw new Error("Missing required environment variable HARVARD_KEY");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function clean(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function urlFor(params) {
  const url = new URL(BASE);
  url.searchParams.set("apikey", HARVARD_KEY);
  url.searchParams.set("fields", FIELDS);
  url.searchParams.set("size", String(SIZE));
  url.searchParams.set("hasimage", "1");
  url.searchParams.set("accesslevel", "1");
  url.searchParams.set("imagepermissionlevel", "0");
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

async function fetchJson(url, attempt = 1) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "ArtGuessrDataAdapter/1.0",
    },
  });

  if ((response.status === 429 || response.status >= 500) && attempt <= 5) {
    const retryAfter = Number(response.headers.get("retry-after"));
    const wait = Number.isFinite(retryAfter) ? retryAfter * 1000 : 600 * attempt;
    await sleep(wait);
    return fetchJson(url, attempt + 1);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${body.slice(0, 240)}`);
  }

  return response.json();
}

async function pullPage(plan, page) {
  const json = await fetchJson(urlFor({ ...plan.params, page }));
  await sleep(180);
  return json.records ?? [];
}

async function collectPlan(plan) {
  const records = [];
  for (let page = 1; page <= plan.pages; page++) {
    const pageRecords = await pullPage(plan, page);
    if (!pageRecords.length) break;
    records.push(...pageRecords);
    if (pageRecords.length < SIZE) break;
  }
  return records;
}

function midpointYear(start, end) {
  const a = Number(start);
  const b = Number(end);
  if (Number.isFinite(a) && Number.isFinite(b)) return Math.round((a + b) / 2);
  if (Number.isFinite(a)) return Math.round(a);
  if (Number.isFinite(b)) return Math.round(b);
  return null;
}

function artistFrom(people) {
  if (!Array.isArray(people)) return "";
  const artist = people.find((person) => /^artist$/i.test(clean(person?.role)));
  return clean((artist ?? people[0])?.name);
}

const PLACE_HINTS = [
  [/japan|japanese|edo period|meiji period|tokugawa|kyoto|nara/i, "Japan"],
  [/china|chinese|qing dynasty|ming dynasty|song dynasty|tang dynasty|yuan dynasty|han dynasty/i, "China"],
  [/korea|korean|joseon|goryeo|silla/i, "Korea"],
  [/india|indian|mughal|rajput|deccan|gujarat|rajasthan|chola|bengal/i, "India"],
  [/iran|iranian|persia|persian|safavid|qajar|sasanian|seljuk/i, "Iran"],
  [/turkey|turkish|ottoman|anatolia|iznik/i, "Turkey"],
  [/syria|syrian|damascus|levant/i, "Syria"],
  [/iraq|iraqi|mesopotamia|mesopotamian|babylon|sumer|assyria/i, "Iraq"],
  [/egypt|egyptian|mamluk|coptic/i, "Egypt"],
  [/afghanistan|gandhara|bactria/i, "Afghanistan / Pakistan"],
  [/pakistan|indus/i, "Pakistan"],
  [/tibet|tibetan/i, "Tibet"],
  [/nepal|nepalese/i, "Nepal"],
  [/thailand|thai|siam/i, "Thailand"],
  [/cambodia|khmer/i, "Cambodia"],
  [/vietnam|vietnamese/i, "Vietnam"],
  [/indonesia|java|javanese|sumatra|bali/i, "Indonesia"],
  [/burma|myanmar/i, "Myanmar"],
  [/islam|islamic/i, "Islamic world"],
  [/byzantine|byzantium/i, "Byzantine Empire"],
  [/greece|greek|attic|cycladic|hellenistic/i, "Greece"],
  [/rome|roman|etruscan/i, "Italy"],
  [/france|french/i, "France"],
  [/italy|italian|venice|florence|siena/i, "Italy"],
  [/netherlands|dutch|flemish|flanders/i, "Netherlands / Flanders"],
  [/spain|spanish/i, "Spain"],
  [/germany|german/i, "Germany"],
  [/england|britain|british/i, "United Kingdom"],
  [/america|american|united states/i, "United States"],
  [/mexico|mexican|maya|aztec|mixtec|zapotec|teotihuacan|olmec/i, "Mexico"],
  [/peru|peruvian|moche|inca|chimu|nasca|nazca|wari/i, "Peru"],
  [/benin|yoruba|edo peoples|nigeria/i, "Nigeria"],
  [/mali|dogon|bamana|djenne/i, "Mali"],
];

function placeFrom(culture, division) {
  const text = `${culture} ${division}`;
  for (const [pattern, place] of PLACE_HINTS) {
    if (pattern.test(text)) return place;
  }
  return clean(culture || division);
}

function bucketFor(record, raw) {
  const text = `${record.culture} ${record.place} ${raw.classification || ""} ${raw.medium || ""}`.toLowerCase();
  if (/islam|iran|persia|ottoman|turkey|syria|iraq|mamluk|mughal|qajar|safavid/.test(text)) return "islamic";
  if (/egypt|greece|greek|rome|roman|etruscan|byzantine|ancient near eastern|mesopotamia|assyrian|sumerian/.test(text)) return "ancient";
  if (/asia|asian|japan|japanese|china|chinese|korea|korean|india|indian|tibet|tibetan|nepal|nepalese|thai|cambodia|vietnam|indonesia|burma|myanmar|buddh|edo|gandhara/.test(text)) return "asian";
  if (/africa|benin|yoruba|mali|dogon|bamana|akan|asante|kongo|kuba|luba|ethiopia/.test(text)) return "african";
  if (/mexico|peru|colombia|maya|aztec|inca|moche|native north american|americas|andean|pre-columbian/.test(text)) return "americas";
  return "euroamerican";
}

function isPreferredObject(record, raw) {
  const text = `${record.title} ${record.medium} ${raw.classification || ""}`.toLowerCase();
  return /\b(painting|sculpture|statue|relief|vessel|bowl|jar|ewer|tile|ceramic|porcelain|bronze|jade|textile|carpet|rug|screen|scroll|manuscript|miniature|album|calligraphy|mask|figure|figurine|ritual|icon|panel|tomb|stela)\b/.test(text);
}

function normalize(raw) {
  const image = clean(raw.primaryimageurl);
  if (!/^https:\/\//i.test(image)) return null;
  if (Number(raw.imagepermissionlevel) !== 0 || Number(raw.accesslevel) !== 1) return null;

  const year = midpointYear(raw.datebegin, raw.dateend);
  if (!Number.isInteger(year)) return null;

  const culture = clean(raw.culture);
  const division = clean(raw.division);
  const place = placeFrom(culture, division);
  if (!place && !culture) return null;

  const fameHint = Number(raw.totalpageviews);
  const record = {
    id: `${SOURCE}${raw.id}`.replace(/\s+/g, ""),
    title: clean(raw.title) || "Untitled",
    artist: artistFrom(raw.people),
    year,
    place,
    culture,
    movement: "",
    medium: clean(raw.classification || raw.medium),
    image,
    src: SOURCE,
    fameHint: Number.isFinite(fameHint) ? fameHint : null,
  };

  const bucket = bucketFor(record, raw);
  let score = Number.isFinite(fameHint) ? fameHint : 0;
  const rank = Number(raw.rank);
  if (Number.isFinite(rank) && rank > 0) score += Math.max(0, 250000 - rank) / 1000;
  if (isPreferredObject(record, raw)) score += 220;
  if (bucket === "asian") score += 260;
  if (bucket === "islamic") score += 300;
  if (bucket === "ancient" || bucket === "african" || bucket === "americas") score += 140;
  if (record.artist) score += 80;
  if (/fragment|sherd|sample|negative|photograph|postcard|letter|bookplate/i.test(`${record.title} ${record.medium}`)) score -= 220;

  return { record, bucket, score };
}

function takeBalanced(candidates) {
  const unique = [];
  const seen = new Set();
  for (const item of candidates.sort((a, b) => b.score - a.score || a.record.id.localeCompare(b.record.id))) {
    if (seen.has(item.record.id)) continue;
    seen.add(item.record.id);
    unique.push(item);
  }

  const quotas = [
    ["asian", 115],
    ["islamic", 70],
    ["ancient", 50],
    ["african", 25],
    ["americas", 25],
    ["euroamerican", 65],
  ];
  const selected = [];
  const selectedIds = new Set();

  for (const [bucket, quota] of quotas) {
    for (const item of unique) {
      if (selected.filter((candidate) => candidate.bucket === bucket).length >= quota) break;
      if (item.bucket !== bucket || selectedIds.has(item.record.id)) continue;
      selected.push(item);
      selectedIds.add(item.record.id);
    }
  }

  for (const item of unique) {
    if (selected.length >= TARGET) break;
    if (selectedIds.has(item.record.id)) continue;
    selected.push(item);
    selectedIds.add(item.record.id);
  }

  return selected
    .sort((a, b) => b.score - a.score || a.record.title.localeCompare(b.record.title))
    .slice(0, TARGET)
    .map((item) => item.record);
}

const plans = [
  { label: "popular", pages: 12, params: { sort: "totalpageviews", sortorder: "desc" } },
  { label: "ranked", pages: 10, params: { sort: "rank", sortorder: "asc" } },
  {
    label: "asian-division-popular",
    pages: 12,
    params: { division: "Asian and Mediterranean Art", sort: "totalpageviews", sortorder: "desc" },
  },
  {
    label: "asian-division-ranked",
    pages: 10,
    params: { division: "Asian and Mediterranean Art", sort: "rank", sortorder: "asc" },
  },
  ...[
    "Chinese",
    "Japanese",
    "Korean",
    "Indian",
    "Tibetan",
    "Nepalese",
    "Thai",
    "Cambodian",
    "Vietnamese",
    "Indonesian",
  ].map((culture) => ({
    label: `culture:${culture}`,
    pages: 5,
    params: { culture, sort: "totalpageviews", sortorder: "desc" },
  })),
  ...[
    "Iranian",
    "Persian",
    "Islamic",
    "Turkish",
    "Ottoman",
    "Mughal",
    "Syrian",
    "Iraqi",
    "Egyptian",
  ].map((culture) => ({
    label: `islamic-culture:${culture}`,
    pages: 5,
    params: { culture, sort: "totalpageviews", sortorder: "desc" },
  })),
  ...[
    "Islamic",
    "Iran",
    "Persian",
    "Ottoman",
    "Mughal",
    "China",
    "Japan",
    "Korea",
    "India",
    "Buddhist",
    "ceramic",
    "bronze",
    "textile",
    "manuscript",
    "screen",
    "scroll",
  ].map((q) => ({
    label: `query:${q}`,
    pages: 3,
    params: { q, sort: "totalpageviews", sortorder: "desc" },
  })),
];

const byId = new Map();
for (const plan of plans) {
  const records = await collectPlan(plan);
  for (const record of records) {
    if (record?.id !== undefined && !byId.has(String(record.id))) {
      byId.set(String(record.id), record);
    }
  }
}

const normalized = [...byId.values()].map(normalize).filter(Boolean);
if (process.env.DEBUG_HARVARD) {
  const counts = normalized.reduce((acc, item) => {
    acc[item.bucket] = (acc[item.bucket] ?? 0) + 1;
    return acc;
  }, {});
  console.error(JSON.stringify({ candidates: normalized.length, buckets: counts }));
}
const records = takeBalanced(normalized);

await mkdir("data/incoming", { recursive: true });
await writeFile(OUT_PATH, `${JSON.stringify(records, null, 2)}\n`);

console.log(`${SOURCE}: ${records.length} records written to ${OUT_PATH}`);
