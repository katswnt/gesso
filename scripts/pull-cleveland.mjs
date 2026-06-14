import { mkdirSync, writeFileSync } from "node:fs";

const API = "https://openaccess-api.clevelandart.org/api/artworks/";
const OUT = "data/incoming/cleveland.json";
const SRC = "cleveland";
const LIMIT = 1000;
const TARGET = 350;
const UA = "ArtGuessrDataAdapter/1.0 (https://openaccess-api.clevelandart.org/)";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchJson(url, tries = 5) {
  for (let attempt = 0; attempt < tries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": UA },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (response.status === 429 || response.status >= 500) {
        await sleep(500 * (attempt + 1));
        continue;
      }
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.json();
    } catch (error) {
      clearTimeout(timeout);
      if (attempt === tries - 1) throw error;
      await sleep(500 * (attempt + 1));
    }
  }
  return null;
}

function urlFor(params) {
  const search = new URLSearchParams({
    cc0: "1",
    has_image: "1",
    limit: String(LIMIT),
    ...params,
  });
  return `${API}?${search}`;
}

async function fetchPages(extra = {}) {
  const first = await fetchJson(urlFor({ ...extra, skip: "0" }));
  const total = Number(first?.info?.total || 0);
  const data = [...(first?.data || [])];
  await sleep(180);

  for (let skip = LIMIT; skip < total; skip += LIMIT) {
    const page = await fetchJson(urlFor({ ...extra, skip: String(skip) }));
    data.push(...(page?.data || []));
    await sleep(180);
  }
  return data;
}

function clean(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function firstCulture(culture) {
  if (Array.isArray(culture)) return clean(culture[0] || "");
  return clean(culture);
}

function artistFrom(creators) {
  const creator = Array.isArray(creators) ? creators[0] : null;
  return clean(creator?.description || creator?.name || "");
}

function imageFrom(images) {
  const url = images?.web?.url || images?.print?.url || "";
  return /^https:\/\/.+\.(jpe?g|png|webp)(\?.*)?$/i.test(url) ? url : "";
}

function yearFrom(earliest, latest) {
  const start = Number(earliest);
  const end = Number(latest);
  if (!Number.isFinite(start) && !Number.isFinite(end)) return null;
  if (Number.isFinite(start) && Number.isFinite(end)) return Math.round((start + end) / 2);
  return Math.round(Number.isFinite(start) ? start : end);
}

const PLACE_HINTS = [
  [/japan|okinawa|ryukyu|edo period|meiji period|heian period|momoyama|nara period/i, "Japan"],
  [/china|chinese|qing|ming|song dynasty|tang dynasty|yuan dynasty|han dynasty|liao dynasty/i, "China"],
  [/korea|korean|joseon|goryeo/i, "Korea"],
  [/tibet|tibetan/i, "Tibet"],
  [/nepal|nepalese/i, "Nepal"],
  [/afghanistan|gandhara/i, "Afghanistan / Pakistan"],
  [/india|indian|mughal|rajput|deccan|pahari|bengal|gujarat|rajasthan|kashmir|chola/i, "India"],
  [/iran|persia|persian|safavid|qajar|sasanian|seljuk/i, "Iran"],
  [/egypt|egyptian|coptic/i, "Egypt"],
  [/syria|syrian|damascus|levant/i, "Syria"],
  [/iraq|mesopotamia|mesopotamian|babylon|sumer|assyria/i, "Iraq"],
  [/turkey|turkish|ottoman|anatolia|iznik/i, "Turkey"],
  [/thailand|thai|siam/i, "Thailand"],
  [/cambodia|khmer/i, "Cambodia"],
  [/vietnam|vietnamese/i, "Vietnam"],
  [/indonesia|java|javanese|sumatra|bali/i, "Indonesia"],
  [/burma|myanmar/i, "Myanmar"],
  [/nigeria|benin|yoruba|edo peoples|igbo/i, "Nigeria"],
  [/mali|dogon|bamana|djenne/i, "Mali"],
  [/ghana|akan|asante|ashanti/i, "Ghana"],
  [/congo|kongo|kuba|luba|songye/i, "Central Africa"],
  [/ethiopia|ethiopian/i, "Ethiopia"],
  [/sierra leone|sapi/i, "Sierra Leone"],
  [/cameroon|grassfields/i, "Cameroon"],
  [/mexico|mexican|maya|aztec|mixtec|zapotec|teotihuacan|olmec/i, "Mexico"],
  [/peru|peruvian|moche|inca|chimu|nasca|nazca|wari/i, "Peru"],
  [/colombia|colombian|muisca/i, "Colombia"],
  [/native north american|navajo|hopi|pueblo|haida|tlingit|inuit/i, "North America"],
  [/greece|greek|attic|cycladic|hellenistic/i, "Greece"],
  [/rome|roman|etruscan/i, "Italy"],
  [/byzantine|byzantium/i, "Byzantine Empire"],
  [/france|french/i, "France"],
  [/italy|italian|venice|florence/i, "Italy"],
  [/netherlands|dutch|flemish|flanders/i, "Netherlands / Flanders"],
  [/spain|spanish/i, "Spain"],
  [/germany|german/i, "Germany"],
  [/england|britain|british/i, "United Kingdom"],
  [/america|american|united states/i, "United States"],
];

function placeFrom(...fields) {
  const text = fields.map(clean).filter(Boolean).join(" ");
  for (const [pattern, place] of PLACE_HINTS) {
    if (pattern.test(text)) return place;
  }
  return "";
}

function hasPreferredType(type, medium) {
  const text = `${type} ${medium}`.toLowerCase();
  return [
    "painting",
    "sculpture",
    "statue",
    "relief",
    "vessel",
    "bowl",
    "jar",
    "mask",
    "figure",
    "figurine",
    "textile",
    "carpet",
    "tapestry",
    "ceramic",
    "bronze",
    "jade",
    "manuscript",
    "screen",
    "icon",
    "altar",
    "ritual",
  ].some(word => text.includes(word));
}

function bucketFor(record, raw) {
  const text = `${record.culture} ${record.place} ${raw.department || ""} ${raw.collection || ""}`.toLowerCase();
  if (/islam|iran|persia|ottoman|turkey|syria|iraq|egypt|mamluk|mughal/.test(text)) return "islamic";
  if (/japan|china|korea|india|tibet|nepal|thai|cambodia|vietnam|indonesia|burma|myanmar|asian/.test(text)) return "asian";
  if (/africa|nigeria|benin|yoruba|edo peoples|mali|dogon|bamana|ghana|akan|asante|congo|kuba|luba|ethiopia|sierra leone|cameroon/.test(text)) return "african";
  if (/mexico|peru|colombia|maya|aztec|inca|moche|native north american|navajo|hopi|pueblo|americas|oceania|polynesia|melanesia/.test(text)) return "americas";
  if (/egypt|greece|greek|rome|roman|etruscan|byzantine|ancient near eastern|mesopotamia/.test(text)) return "ancient";
  return "euroamerican";
}

function normalize(raw, markedOnView) {
  const image = imageFrom(raw.images);
  const year = yearFrom(raw.creation_date_earliest, raw.creation_date_latest);
  const culture = firstCulture(raw.culture);
  const medium = clean(raw.technique);
  const place = placeFrom(culture) || placeFrom(raw.department, raw.collection, raw.current_location);
  if (!image || year === null || (!place && !culture)) return null;

  const onView = markedOnView.has(String(raw.id)) || Boolean(clean(raw.current_location));
  const highlighted = Boolean(raw.is_highlight);
  const fameHint = highlighted ? 100 : onView ? 60 : null;

  const record = {
    id: `${SRC}${raw.id}`.replace(/\s+/g, ""),
    title: clean(raw.title) || "Untitled",
    artist: artistFrom(raw.creators),
    year,
    place,
    culture,
    movement: "",
    medium,
    image,
    src: SRC,
    fameHint,
  };

  const bucket = bucketFor(record, raw);
  let score = 0;
  if (highlighted) score += 10000;
  if (onView) score += 2500;
  if (hasPreferredType(raw.type, medium)) score += 1200;
  if (bucket === "asian" || bucket === "islamic" || bucket === "african") score += 900;
  if (clean(raw.description) || clean(raw.did_you_know)) score += 250;
  if (record.artist) score += 120;
  if (year < 1700) score += 80;
  if (/fragment|study|sample|coin|photograph|print|drawing/i.test(`${raw.type || ""} ${medium}`)) score -= 650;

  return { record, bucket, score };
}

function takeBalanced(candidates) {
  const seen = new Set();
  const unique = candidates
    .filter(item => {
      if (!item || seen.has(item.record.id)) return false;
      seen.add(item.record.id);
      return true;
    })
    .sort((a, b) => b.score - a.score || a.record.title.localeCompare(b.record.title));

  const selected = [];
  const selectedIds = new Set();
  const quotas = [
    ["asian", 95],
    ["islamic", 45],
    ["african", 45],
    ["ancient", 55],
    ["americas", 35],
    ["euroamerican", 75],
  ];

  for (const [bucket, quota] of quotas) {
    for (const item of unique.filter(candidate => candidate.bucket === bucket)) {
      if (selected.filter(candidate => candidate.bucket === bucket).length >= quota) break;
      if (selectedIds.has(item.record.id)) continue;
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
    .map(item => item.record);
}

const highlighted = await fetchPages({ highlight: "1" });
const onView = await fetchPages({ currently_on_view: "1" });
const onViewIds = new Set(onView.map(item => String(item.id)));
const broad = await fetchPages();

const byId = new Map();
for (const item of [...highlighted, ...onView, ...broad]) {
  if (item?.id !== undefined && !byId.has(String(item.id))) byId.set(String(item.id), item);
}

const normalized = [...byId.values()].map(item => normalize(item, onViewIds)).filter(Boolean);
const records = takeBalanced(normalized);

mkdirSync("data/incoming", { recursive: true });
writeFileSync(OUT, `${JSON.stringify(records, null, 2)}\n`);

console.log(`${SRC}: ${records.length} records written to ${OUT}`);
