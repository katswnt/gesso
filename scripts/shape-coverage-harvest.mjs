// Shape staged harvest candidates into clean, promotable pool records — STAGES to
// data/incoming/promote-ready.json for review (does NOT write pool.js). Dedups vs pool, filters junk/no-year/
// no-place/in-copyright, assigns a GUESSABLE style (Oceania by place; others only if the style is already a
// recognized movement/culture — else dropped, because a wrong style makes bad guessing data), computes cats
// per work (artist only when a real creator), and balances to per-category targets.
//   node scripts/shape-coverage-harvest.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { normalizeArtist, canonicalizeStyle, isInCopyright } from "./lib/domain.mjs";
import { canonicalizePlace, continentOf } from "./lib/places.mjs";

const w = {}; new Function("window", readFileSync("data/pool.js", "utf8"))(w);
const pool = w.ARTEFACTUM_POOL || [];
const poolIds = new Set(pool.map(p => String(p.id)));
const poolQs = new Set(pool.map(p => (String(p.id).match(/Q\d+/) || [])[0]).filter(Boolean));
const poolImgs = new Set(pool.map(p => p.img));
const poolStyles = new Set(pool.map(p => p.style).filter(Boolean));   // styles already live in the pool = safe/guessable

// valid movement/culture styles = MOVEMENTS keys in index.html PLUS styles already in the pool
const html = readFileSync("index.html", "utf8");
const a = html.indexOf("const MOVEMENTS={"), b = html.indexOf("const MOV_FAMILY=");
const movKeys = new Set([...html.slice(a, b).matchAll(/"([^"]+)":\{dates:/g)].map(m => m[1]));
// place-as-style guard: a bare country/place is NOT a guessable movement (the label audit flags these)
const cw = {}; new Function("window", readFileSync("data/countries.js", "utf8"))(cw);
const placeNames = new Set((cw.ARTEFACTUM_COUNTRIES || []).map(c => c.n.toLowerCase()));
["egypt", "ancient egypt", "iran", "persia", "iraq", "syria", "anatolia", "mesopotamia", "levant", "greece", "rome", "byzantium"].forEach(p => placeNames.add(p));
const isPlaceName = s => placeNames.has(String(s || "").toLowerCase().replace(/\s*\(.*$/, "").trim());
const validStyle = s => s && (movKeys.has(s) || poolStyles.has(s)) && !isPlaceName(s);

// per-category promotion targets (balanced, belonging-weighted)
const TARGET = { oceania: 80, "middle-east": 80, "canonical-prints": 60, "early-medieval-europe": 50, "euro-sculpture-1400-1700": 40, "south-america": 40 };

// Oceania: assign a guessable culture style from the place
function oceaniaStyle(place) {
  const p = String(place || "").toLowerCase();
  if (/new zealand|aotearoa|maori|māori/.test(p)) return "Māori art";
  if (/fiji|papua|new guinea|solomon|vanuatu|new caledonia|new ireland|new britain|sepik|melanesia|bismarck|admiralty/.test(p)) return "Melanesian art";
  if (/samoa|tonga|cook|tahiti|hawaii|marquesas|austral|society|polynesia|niue|tokelau|easter|rapa nui/.test(p)) return "Polynesian art";
  if (/micronesia|palau|marshall|caroline|kiribati|nauru|guam|yap/.test(p)) return "Micronesian art";
  return "Oceanic art";
}
// junk: accession-number titles, non-art items (newspapers/serials), book/print-series plate refs, and coins
// (weak visual targets + museum data records the ruler as the "artist", which is wrong)
const junk = t => /\d{2,}[.\-]\d|[-_]\d{3,}|inv\.?|\bMS\b|\d{5,}/i.test(t || "")
  || /\btimes\b|gazette|newspaper|magazine|\bvolume\b|\bvol\.|\bno\.\s*\d|\bplate\s*\d|folio\s*\d/i.test(t || "")
  || /miliaresion|histamenon|solidus|follis|nomisma|tremissis|denarius|\bcoin\b|drachm|obol|\bstater\b|billon|tetarteron|semissis|hexagram|nummus|siliqua|scyphate|\bseal of\b|kommerkia|ounce weight|\bunesco\b/i.test(t || "");
// anonymous = no creator, an "unknown/workshop/after" tag, OR a Wikidata blank-node genid/URL (creator query
// returned no real person — showing the raw URL as an artist is a bug)
const isAnon = a => { const s = String(a || "").trim(); return !s || /^https?:|genid|\.well-known/i.test(s) || /^(unknown|anonymous|unidentified|attributed|circle of|workshop|follower|after )/i.test(s); };
const tidyMedium = m => { m = String(m || "").trim(); return m ? m.charAt(0).toUpperCase() + m.slice(1) : ""; };

const CATS = ["middle-east", "south-america", "early-medieval-europe", "euro-sculpture-1400-1700", "canonical-prints", "oceania"];
const seenImg = new Set(), seenId = new Set();
const shaped = {}; const stats = {};
for (const cat of CATS) {
  let cand = []; try { cand = JSON.parse(readFileSync(`data/incoming/${cat}/candidates.json`, "utf8")); } catch {}
  const out = []; const s = stats[cat] = { total: cand.length, dup: 0, junk: 0, noYear: 0, noPlace: 0, copyright: 0, noStyle: 0, kept: 0 };
  for (const c of cand) {
    const q = (String(c.id).match(/Q\d+/) || [])[0];
    if (poolIds.has(String(c.id)) || (q && poolQs.has(q)) || poolImgs.has(c.img) || seenImg.has(c.img) || seenId.has(String(c.id))) { s.dup++; continue; }
    if (junk(c.title)) { s.junk++; continue; }
    if (c.y == null) { s.noYear++; continue; }
    if (c.y > 1928) { s.copyright++; continue; }        // hard US-PD safety cutoff — no modern/in-copyright works
    if (!c.place || !String(c.place).trim()) { s.noPlace++; continue; }
    const artist = isAnon(c.artist) ? "" : normalizeArtist(c.artist);
    if (artist && isInCopyright(artist)) { s.copyright++; continue; }
    // Oceania styling means traditional taonga — which are ANONYMOUS. A named artist at Te Papa = settler/modern
    // fine art (van der Velden, Léger), NOT Māori/Pacific art. Drop those from the Oceania coverage push.
    if (cat === "oceania" && artist) { s.copyright++; continue; }
    // style: Oceania from place; others keep the raw style only if it's a recognized movement/culture (not a
    // bare place). A no-valid-style work is still keepable if it has a real artist (prints/sculpture guess by
    // artist) — it just won't carry the style axis. Drop only anonymous + no-valid-style works.
    let style = cat === "oceania" ? oceaniaStyle(c.place) : (validStyle(canonicalizeStyle(c.style || "")) ? canonicalizeStyle(c.style || "") : "");
    if (cat !== "oceania" && !style && !artist) { s.noStyle++; continue; }
    const cats = ["when", "where"];
    const medium = tidyMedium(c.medium);
    if (medium) cats.push("medium");
    if (style) cats.push("style");
    if (artist) cats.push("artist");
    const rec = { id: c.id, title: c.title, artist, y: c.y, lat: c.lat, lng: c.lng,
      place: canonicalizePlace(c.place), region: continentOf(c.place) || c.region, medium, style,
      styleKind: cat === "oceania" ? "culture" : (c.styleKind || (style ? "movement" : "")), fame: 0, img: c.img, src: c.src, cats };
    if (q) rec.wikidataid = "Q" + q.slice(1) === q ? q : q;
    seenImg.add(c.img); seenId.add(String(c.id)); out.push(rec); s.kept++;
  }
  // rank: richer records first (has medium + real style + distinct place), then take target
  out.sort((x, y2) => (y2.cats.length - x.cats.length) || (String(y2.medium ? 1 : 0) - String(x.medium ? 1 : 0)));
  shaped[cat] = out.slice(0, TARGET[cat] * 2); // 2x shortlist; resolution pass trims to target next
}

const all = Object.values(shaped).flat();
writeFileSync("data/incoming/promote-ready.json", JSON.stringify({ targets: TARGET, byCat: Object.fromEntries(Object.entries(shaped).map(([k, v]) => [k, v.length])), ready: all }, null, 1));
console.log("SHAPE stats per category:");
for (const cat of CATS) { const s = stats[cat]; console.log(`  ${cat}: kept ${s.kept} (shortlisted ${shaped[cat].length}) | dropped: dup ${s.dup}, junk ${s.junk}, no-year ${s.noYear}, no-place ${s.noPlace}, no-style ${s.noStyle}, copyright ${s.copyright}`); }
console.log(`\nshortlist total (2x target): ${all.length} -> data/incoming/promote-ready.json`);
console.log("style distribution:", JSON.stringify(all.reduce((o, r) => { o[r.style] = (o[r.style] || 0) + 1; return o; }, {})));
