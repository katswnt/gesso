import { mkdir, writeFile } from "node:fs/promises";

const SOURCE = "aic";
const OUT_PATH = "data/incoming/aic.json";
const BASE = "https://api.artic.edu/api/v1/artworks/search";
const IMAGE_BASE = "https://www.artic.edu/iiif/2";
const LIMIT = 100;
const TARGET = 350;
const FIELDS = [
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
  "colorfulness",
].join(",");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const famousArtists = [
  "Vincent van Gogh",
  "Claude Monet",
  "Georges Seurat",
  "Pablo Picasso",
  "Henri Matisse",
  "Paul Cezanne",
  "Pierre-Auguste Renoir",
  "Edgar Degas",
  "Mary Cassatt",
  "Georgia O'Keeffe",
  "Edward Hopper",
  "Grant Wood",
  "Gustave Caillebotte",
  "Amedeo Modigliani",
  "Katsushika Hokusai",
  "Utagawa Hiroshige",
  "Rembrandt",
  "El Greco",
  "Francisco de Goya",
  "Berthe Morisot",
  "Camille Pissarro",
  "John Singer Sargent",
  "Winslow Homer",
  "James McNeill Whistler",
  "Thomas Eakins",
  "Auguste Rodin",
  "Constantin Brancusi",
  "Wassily Kandinsky",
  "Paul Klee",
  "Joan Miro",
  "Marc Chagall",
];

const objectQueries = [
  "painting",
  "sculpture",
  "statue",
  "buddha",
  "mask",
  "vessel",
  "figure",
  "textile",
  "screen",
  "scroll",
  "print",
  "ritual",
  "manuscript",
  "ceramic",
  "bronze",
];

const cultureNames = new Set([
  "Africa",
  "Akan",
  "Aztec",
  "Benin",
  "Byzantine",
  "China",
  "Chinese",
  "Egypt",
  "Egyptian",
  "Edo",
  "Etruscan",
  "Greek",
  "Hellenistic",
  "India",
  "Indian",
  "Iran",
  "Islamic",
  "Japan",
  "Japanese",
  "Korea",
  "Korean",
  "Maya",
  "Mesopotamia",
  "Moche",
  "Mughal",
  "Navajo",
  "Nepal",
  "Persia",
  "Persian",
  "Roman",
  "Thailand",
  "Tibet",
  "Tibetan",
  "Yoruba",
]);

const majorArtistNeedles = famousArtists.map((name) => name.toLowerCase());

function appendCommonFilters(url, onViewOnly = false) {
  let index = 0;
  url.searchParams.set(
    `query[bool][must][${index++}][term][is_public_domain]`,
    "true",
  );
  url.searchParams.set(`query[bool][must][${index++}][exists][field]`, "image_id");
  if (onViewOnly) {
    url.searchParams.set(`query[bool][must][${index++}][term][is_on_view]`, "true");
  }
}

function makeUrl({ page, q = "", onViewOnly = false }) {
  const url = new URL(BASE);
  url.searchParams.set("fields", FIELDS);
  url.searchParams.set("limit", String(LIMIT));
  url.searchParams.set("page", String(page));
  if (q) url.searchParams.set("q", q);
  appendCommonFilters(url, onViewOnly);
  return url;
}

async function fetchJson(url, attempt = 1) {
  const response = await fetch(url);
  if ((response.status === 429 || response.status >= 500) && attempt <= 4) {
    const retryAfter = Number(response.headers.get("retry-after"));
    const wait = Number.isFinite(retryAfter) ? retryAfter * 1000 : 500 * attempt;
    await sleep(wait);
    return fetchJson(url, attempt + 1);
  }
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${body.slice(0, 220)}`);
  }
  return response.json();
}

async function pullPage(plan, page) {
  const url = makeUrl({ ...plan, page });
  const json = await fetchJson(url);
  await sleep(140);
  return json.data ?? [];
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanArtist(value, place) {
  const firstLine = String(value ?? "").split(/\r?\n/).map(cleanText).find(Boolean) ?? "";
  const cleaned = firstLine
    .replace(/\([^)]*\b\d{3,4}\s*[-–]\s*\d{0,4}[^)]*\)/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\b\d{3,4}\s*[-–]\s*\d{0,4}\b/g, "")
    .replace(/[;,]\s*$/g, "")
    .trim();

  if (!cleaned) return "";
  if (place && cleaned.toLowerCase() === place.toLowerCase()) return "";
  if (cultureNames.has(cleaned)) return "";
  if (/^(unknown|unidentified|artist unknown|maker unknown)$/i.test(cleaned)) return "";
  return cleaned;
}

function midpointYear(start, end) {
  const a = Number(start);
  const b = Number(end);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((a + b) / 2);
}

function cultureFromPlace(place) {
  if (!place) return "";
  const tokens = place
    .split(/[,;/()]|\s+-\s+/)
    .map((part) => cleanText(part))
    .filter(Boolean);

  for (const token of tokens) {
    if (cultureNames.has(token)) return token;
  }

  if (/\b(Edo|Yoruba|Maya|Moche|Mughal|Navajo|Akan|Benin|Tibetan|Persian)\b/i.test(place)) {
    return place;
  }
  return "";
}

function mediumFor(work) {
  return cleanText(work.classification_title || work.medium_display);
}

function artistBoost(artist) {
  const text = artist.toLowerCase();
  if (!text) return 0;
  return majorArtistNeedles.some((name) => text.includes(name)) ? 8 : 0;
}

function normalize(work) {
  if (!work?.is_public_domain || !work.image_id) return null;

  const year = midpointYear(work.date_start, work.date_end);
  if (!Number.isInteger(year)) return null;

  const place = cleanText(work.place_of_origin);
  const culture = cultureFromPlace(place);
  if (!place && !culture) return null;

  const artist = cleanArtist(work.artist_display, place);
  const score = Number(work._score) || 0;
  const fameHint =
    Math.round(((score / 1_000_000) + (work.is_on_view ? 5 : 0) + artistBoost(artist)) * 100) /
    100;

  return {
    id: `${SOURCE}${work.id}`,
    title: cleanText(work.title) || "Untitled",
    artist,
    year,
    place,
    culture,
    movement: "",
    medium: mediumFor(work),
    image: `${IMAGE_BASE}/${work.image_id}/full/843,/0/default.jpg`,
    src: SOURCE,
    fameHint,
  };
}

function qualityScore(item) {
  const medium = item.medium.toLowerCase();
  const preferredMedium =
    /\b(painting|oil|canvas|tempera|panel|sculpture|statue|stone|bronze|wood|ceramic|vessel|mask|textile|screen|scroll|print|manuscript|ritual|figure)\b/.test(
      medium,
    )
      ? 4
      : 0;
  const hasNamedArtist = item.artist ? 2 : 0;
  return (item.fameHint ?? 0) + preferredMedium + hasNamedArtist;
}

async function collect() {
  const rawById = new Map();
  const plans = [
    ...Array.from({ length: 10 }, (_, i) => ({
      label: "on-view",
      page: i + 1,
      onViewOnly: true,
    })),
    ...Array.from({ length: 10 }, (_, i) => ({
      label: "public-domain",
      page: i + 1,
    })),
    ...famousArtists.map((q) => ({ label: `artist:${q}`, page: 1, q })),
    ...objectQueries.map((q) => ({ label: `object:${q}`, page: 1, q })),
  ];

  for (const plan of plans) {
    let data;
    try {
      data = await pullPage(plan, plan.page);
    } catch (error) {
      if (String(error.message).includes("Invalid number of results")) continue;
      throw error;
    }
    for (const work of data) {
      if (!rawById.has(work.id)) rawById.set(work.id, work);
    }
  }

  return [...rawById.values()];
}

const raw = await collect();
const normalized = raw
  .map(normalize)
  .filter(Boolean)
  .sort((a, b) => qualityScore(b) - qualityScore(a) || a.id.localeCompare(b.id))
  .slice(0, TARGET);

await mkdir("data/incoming", { recursive: true });
await writeFile(OUT_PATH, `${JSON.stringify(normalized, null, 2)}\n`);

console.log(`${SOURCE}: wrote ${normalized.length} records to ${OUT_PATH}`);
