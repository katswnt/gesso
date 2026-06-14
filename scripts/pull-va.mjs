import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const SOURCE = "va";
const API = "https://api.vam.ac.uk/v2";
const OUT = "data/incoming/va.json";
const TARGET = 350;
const PAGE_SIZE = 35;
const DETAIL_LIMIT = 760;
const UA = "ArtGuessr/0.1 data adapter (V&A public API; contact via local project)";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchJSON(url, tries = 5) {
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": UA },
      });
      if (res.status === 429 || res.status >= 500) {
        await sleep(550 * (attempt + 1));
        continue;
      }
      if (!res.ok) return null;
      return await res.json();
    } catch {
      await sleep(450 * (attempt + 1));
    }
  }
  return null;
}

const clean = value => String(value || "").replace(/\s+/g, " ").trim();
const uniq = values => [...new Set(values.map(clean).filter(Boolean))];

function firstText(value) {
  if (!value) return "";
  if (typeof value === "string") return clean(value);
  if (Array.isArray(value)) return value.map(firstText).find(Boolean) || "";
  if (typeof value === "object") return clean(value.text || value.name || value.value || "");
  return "";
}

function parseDateYear(value) {
  const s = clean(value).toLowerCase();
  if (!s) return null;

  const bce = /\b(bc|bce)\b/.test(s);
  const century = s.match(/(\d{1,2})(?:st|nd|rd|th)?\s*century/);
  if (century) {
    const n = Number(century[1]);
    let y = bce ? -(n * 100 - 50) : (n - 1) * 100 + 50;
    if (/\bearly\b/.test(s)) y = bce ? -(n * 100 - 75) : (n - 1) * 100 + 25;
    if (/\blate\b/.test(s)) y = bce ? -(n * 100 - 25) : (n - 1) * 100 + 75;
    return y;
  }

  const nums = [...s.matchAll(/\d{1,4}/g)].map(m => Number(m[0])).filter(Boolean);
  if (!nums.length) return null;
  if (bce) return -Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);

  const years = nums.filter(n => n >= 1000 && n <= 2100);
  if (years.length) return Math.round(years.reduce((a, b) => a + b, 0) / years.length);
  return null;
}

function yearFromRecord(searchRecord, detailRecord) {
  const prod = detailRecord?.productionDates?.find(d => d?.date?.earliest || d?.date?.latest || d?.date?.text);
  const years = [prod?.date?.earliest, prod?.date?.latest]
    .map(v => String(v || "").match(/^-?\d{1,4}/)?.[0])
    .map(v => v == null ? null : Number(v))
    .filter(v => Number.isFinite(v) && v !== 0);
  if (years.length) return Math.round(years.reduce((a, b) => a + b, 0) / years.length);
  return parseDateYear(prod?.date?.text) || parseDateYear(searchRecord?._primaryDate);
}

function imageURL(searchRecord, detail) {
  const base = searchRecord?._images?._iiif_image_base_url || detail?.meta?.images?._iiif_image;
  if (base) return `${base.replace(/\/?$/, "/")}full/843,/0/default.jpg`.replace(/^http:/, "https:");
  const thumb = searchRecord?._images?._primary_thumbnail || detail?.meta?.images?._primary_thumbnail;
  if (!thumb) return "";
  return thumb.replace(/^http:/, "https:").replace(/\/full\/[^/]+\/0\/default\.jpg$/, "/full/843,/0/default.jpg");
}

function maker(searchRecord, record) {
  const names = [
    searchRecord?._primaryMaker?.name,
    ...(record?.artistMakerPerson || []).map(p => p?.name?.text),
    ...(record?.artistMakerPeople || []).map(p => p?.name?.text),
    ...(record?.artistMakerOrganisations || []).map(p => p?.name?.text),
  ];
  const name = uniq(names).find(v => !/^(unknown|unrecorded|anonymous|unknown artist)$/i.test(v));
  return name || "";
}

const CULTURES = [
  [/japan|edo|meiji|kyoto|nara|tokyo|ukiyo/i, "Japan"],
  [/china|chinese|ming|qing|tang|song|yuan|beijing|canton|jingdezhen/i, "China"],
  [/korea|korean|joseon|goryeo/i, "Korea"],
  [/india|indian|mughal|mysore|delhi|calcutta|rajasthan|jaipur|deccan|chola|gujarat|kashmir/i, "India"],
  [/pakistan|lahore|gandhara/i, "Pakistan"],
  [/sri lanka|ceylon/i, "Sri Lanka"],
  [/nepal|tibet|himalaya|kathmandu/i, "Himalayan"],
  [/iran|persia|persian|safavid|qajar|isfahan|shiraz/i, "Iran"],
  [/iraq|mesopotamia|assyria|babylon|sumer/i, "Mesopotamia"],
  [/syria|damascus|levant/i, "Syria"],
  [/turkey|ottoman|iznik|constantinople|istanbul|anatolia/i, "Turkey"],
  [/egypt|coptic|cairo|alexandria/i, "Egypt"],
  [/morocco|fez|rabat/i, "Morocco"],
  [/spain|spanish|hispano-moresque/i, "Spain"],
  [/italy|italian|florence|venice|rome|rimini|maiolica/i, "Italy"],
  [/france|french|paris|sevres|limoges/i, "France"],
  [/netherlands|dutch|delft/i, "Netherlands"],
  [/germany|german|meissen/i, "Germany"],
  [/britain|british|england|english|london|scotland|scottish|wales/i, "Britain"],
  [/ireland|irish/i, "Ireland"],
  [/russia|russian/i, "Russia"],
  [/mexico|mexican|maya|aztec/i, "Mexico"],
  [/peru|inca|moche|nazca/i, "Peru"],
  [/nigeria|benin|yoruba|ife|igbo|edo peoples/i, "Nigeria"],
  [/ghana|asante|ashanti|akan/i, "Ghana"],
  [/congo|kongo|kuba|luba/i, "DR Congo"],
  [/ethiopia|ethiopian/i, "Ethiopia"],
  [/indonesia|java|javanese|bali|sumatra/i, "Indonesia"],
  [/thailand|thai|siam/i, "Thailand"],
  [/myanmar|burma|burmese/i, "Myanmar"],
  [/cambodia|khmer/i, "Cambodia"],
  [/vietnam|vietnamese/i, "Vietnam"],
];

const MOVEMENT_RE = /\b(art nouveau|art deco|arts and crafts|aesthetic movement|gothic revival|renaissance|baroque|rococo|neoclassical|pre-raphaelite|modernist|bauhaus|de stijl|memphis)\b/i;

function cultureAndMovement(searchRecord, record) {
  const styles = uniq((record?.styles || []).map(s => s?.text));
  const cats = uniq((record?.categories || []).map(c => c?.text));
  const places = uniq([
    searchRecord?._primaryPlace,
    ...(record?.placesOfOrigin || []).map(p => p?.place?.text),
    ...(record?.contentPlaces || []).map(firstText),
    ...(record?.associatedPlaces || []).map(firstText),
  ]);
  const strongSignals = uniq([...styles, ...places, ...cats]).join(" ");
  const movementSignals = uniq([...styles, record?.briefDescription, record?.historicalContext]).join(" ");
  const movement = styles.find(s => MOVEMENT_RE.test(s)) || (movementSignals.match(MOVEMENT_RE)?.[1] || "");
  const culture = styles.find(s => !MOVEMENT_RE.test(s) && CULTURES.some(([re]) => re.test(s)))
    || CULTURES.find(([re]) => re.test(strongSignals))?.[1]
    || "";
  return { culture, movement: clean(movement) };
}

function title(searchRecord, record) {
  return clean(
    searchRecord?._primaryTitle
    || record?.titles?.find(t => t?.title)?.title
    || record?.titles?.find(t => t?.text)?.text
    || record?.objectType
    || searchRecord?.objectType
    || "Untitled"
  );
}

function medium(searchRecord, record) {
  return clean(record?.materialsAndTechniques || [
    ...(record?.materials || []).map(m => m?.text),
    ...(record?.techniques || []).map(t => t?.text),
  ].filter(Boolean).join(", ") || searchRecord?.objectType || "");
}

function place(searchRecord, record) {
  return uniq([
    searchRecord?._primaryPlace,
    ...(record?.placesOfOrigin || []).map(p => p?.place?.text),
  ])[0] || "";
}

function allowedImage(detail) {
  const meta = detail?.meta?.images;
  if (!meta || meta.imageResolution === "low") return false;
  const images = meta._images_meta || [];
  return !images.some(img => img?.sensitiveImage);
}

function normalize(searchRecord, detail) {
  const record = detail?.record || {};
  const y = yearFromRecord(searchRecord, record);
  const p = place(searchRecord, record);
  const { culture, movement } = cultureAndMovement(searchRecord, record);
  const img = imageURL(searchRecord, detail);
  if (!searchRecord?.systemNumber || !img || !Number.isInteger(y) || (!p && !culture)) return null;
  if (!allowedImage(detail)) return null;

  return {
    id: `${SOURCE}${searchRecord.systemNumber}`.replace(/\s+/g, ""),
    title: title(searchRecord, record),
    artist: maker(searchRecord, record),
    year: y,
    place: p,
    culture,
    movement,
    medium: medium(searchRecord, record),
    image: img,
    src: SOURCE,
    fameHint: score(searchRecord, record, { culture, movement }),
  };
}

function score(searchRecord, record, extra = {}) {
  let s = 0;
  const type = `${searchRecord?.objectType || ""} ${record?.objectType || ""}`;
  const text = `${searchRecord?._primaryTitle || ""} ${record?.briefDescription || ""} ${record?.summaryDescription || ""}`;
  if (searchRecord?._currentLocation?.onDisplay) s += 50;
  if (record?.galleryLabels?.length) s += 18;
  if (record?.objectHistory) s += 8;
  if (record?.historicalContext) s += 6;
  if (/painting|sculpture|statue|figure|relief|vessel|bowl|dish|tile|carpet|textile|robe|screen|altar|shrine|mask|jewellery|ceramic|porcelain|glass|metalwork|furniture/i.test(type)) s += 14;
  if (/design|photograph|postcard|poster|trade card|fragment|sample|proof|reproduction/i.test(type)) s -= 18;
  if (/tippoo|ardabil|great bed|valkyrie|three graces|cast courts|raphael|michelangelo|donatello|morris|mackintosh|wedgwood|bernini|rodin|hokusai|hiroshige|rembrandt|botticelli/i.test(text)) s += 25;
  if (extra.culture) s += 5;
  if (extra.movement) s += 4;
  return s;
}

function candidateScore(record, queryBoost = 0) {
  let s = queryBoost;
  const type = clean(record.objectType);
  if (record._currentLocation?.onDisplay) s += 55;
  if (/painting|sculpture|statue|figure|relief|vessel|bowl|dish|tile|carpet|textile|robe|screen|altar|shrine|mask|jewellery|ceramic|porcelain|glass|metalwork|furniture/i.test(type)) s += 20;
  if (/design|photograph|postcard|poster|trade card|fragment|sample|proof|reproduction/i.test(type)) s -= 30;
  if (record._primaryTitle) s += 8;
  if (record._primaryPlace) s += 8;
  if (parseDateYear(record._primaryDate)) s += 8;
  return s;
}

async function searchPage(params) {
  const qs = new URLSearchParams({ images_exist: "1", page_size: String(PAGE_SIZE), ...params });
  const data = await fetchJSON(`${API}/objects/search?${qs}`);
  await sleep(180);
  return data?.records || [];
}

async function collectCandidates() {
  const byId = new Map();
  const searches = [
    { boost: 45, pages: 2, q: "Tippoo Tiger" },
    { boost: 45, pages: 2, q: "Ardabil Carpet" },
    { boost: 38, pages: 2, q: "Great Bed of Ware" },
    { boost: 34, pages: 2, q: "William Morris" },
    { boost: 32, pages: 2, q: "Arts and Crafts" },
    { boost: 32, pages: 2, q: "Art Nouveau" },
    { boost: 28, pages: 2, q: "Mughal" },
    { boost: 28, pages: 2, q: "Safavid" },
    { boost: 28, pages: 2, q: "Iznik" },
    { boost: 28, pages: 2, q: "Edo Japan" },
    { boost: 25, pages: 2, q: "Qing China" },
    { boost: 25, pages: 2, q: "Benin" },
    { boost: 25, pages: 2, q: "Renaissance sculpture" },
    { boost: 25, pages: 2, q: "medieval ivory" },
    { boost: 20, pages: 3, q_object_type: "Painting" },
    { boost: 20, pages: 3, q_object_type: "Sculpture" },
    { boost: 18, pages: 3, q_object_type: "Figure" },
    { boost: 18, pages: 3, q_object_type: "Vessel" },
    { boost: 18, pages: 3, q_object_type: "Dish" },
    { boost: 16, pages: 3, q_object_type: "Tile" },
    { boost: 16, pages: 3, q_object_type: "Carpet" },
    { boost: 16, pages: 3, q_object_type: "Textile" },
    { boost: 15, pages: 3, q_object_type: "Mask" },
    { boost: 15, pages: 3, q_object_type: "Jewellery" },
    { boost: 12, pages: 4 },
  ];

  for (const spec of searches) {
    for (let page = 1; page <= spec.pages; page++) {
      const { boost, pages, ...params } = spec;
      const records = await searchPage({ ...params, page: String(page) });
      for (const record of records) {
        if (!record?.systemNumber || !record?._images) continue;
        const old = byId.get(record.systemNumber);
        const nextScore = candidateScore(record, boost);
        if (!old || nextScore > old._candidateScore) {
          byId.set(record.systemNumber, { ...record, _candidateScore: nextScore });
        }
      }
    }
  }
  return [...byId.values()].sort((a, b) => b._candidateScore - a._candidateScore);
}

async function detail(systemNumber) {
  const data = await fetchJSON(`${API}/object/${encodeURIComponent(systemNumber)}`);
  await sleep(140);
  return data;
}

async function main() {
  const candidates = await collectCandidates();
  const out = [];
  const seen = new Set();
  let fetched = 0;

  for (const candidate of candidates) {
    if (fetched >= DETAIL_LIMIT || out.length >= TARGET) break;
    fetched += 1;
    const d = await detail(candidate.systemNumber);
    const item = normalize(candidate, d);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }

  out.sort((a, b) => (b.fameHint ?? 0) - (a.fameHint ?? 0) || a.year - b.year);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(out.slice(0, TARGET), null, 2)}\n`);
  console.log(`${SOURCE}: wrote ${Math.min(out.length, TARGET)} records to ${OUT}`);
}

await main();
